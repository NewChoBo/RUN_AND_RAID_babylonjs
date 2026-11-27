"""Compare Max Skin surface landmarks with the actual Blender imports selected for baking."""

import argparse
import gzip
import hashlib
import json
import re

import bpy
import numpy as np

from library import SOURCE, WORK

REFERENCE = WORK / "player-release/Reference"


def reference_file(path):
    key = hashlib.sha256(path.lower().encode()).hexdigest()[:20]
    return WORK / "max-motion" / (key + ".json.gz")


def read_gzip(path):
    with gzip.open(path, "rt", encoding="utf8") as stream:
        return json.load(stream)


def fit(a, b, scale=False):
    """Proper rotation, optional uniform scale, and translation in column-vector convention."""
    x, y = a - a.mean(0), b - b.mean(0)
    u, _, vt = np.linalg.svd(x.T @ y)
    if np.linalg.det(vt.T @ u.T) < 0:
        vt[-1] *= -1
    rotation = vt.T @ u.T
    if scale:
        rotation *= np.sum(y * (x @ rotation.T)) / np.sum(x * x)
    return np.column_stack((rotation, b.mean(0) - rotation @ a.mean(0)))


def transform(matrix, points):
    return points @ matrix[:, :3].T + matrix[:, 3]


def rms(delta):
    return float(np.sqrt(np.mean(np.sum(delta * delta, axis=1))))


def body_space(native, imported, groups):
    anchors = [
        k
        for k in groups
        if re.search(
            r"^Bip\d+ (?:[LR] )?(?:Head|Pelvis|Spine\d*|Foot|Calf|Thigh|Hand|UpperArm|Forearm)$",
            k,
            re.I,
        )
    ]
    if not anchors:
        anchors = [k for k in groups if k.lower().startswith("bip")]
    if not anchors:
        # Non-humanoid archived rigs may lack biped names.
        anchors = list(groups)
    # A helper with a displaced bind must not affect the scene-space registration.
    for _ in range(3):
        a, b = (np.vstack([table[k] for k in anchors]) for table in (native, imported))
        if len(a) < 3 or np.linalg.matrix_rank(a - a.mean(0), tol=1e-9) < 2:
            raise ValueError("Insufficient non-collinear body landmarks")
        matrix = fit(a, b, scale=True)
        span = max(float(np.linalg.norm(np.ptp(b, axis=0))), 1e-7)
        residual = [rms(transform(matrix, native[k]) - imported[k]) for k in anchors]
        median = np.median(residual)
        kept = [
            k
            for k, err in zip(anchors, residual)
            if err <= max(3 * median, span * 0.001)
        ]
        if len(kept) == len(anchors) or len(kept) < 3:
            break
        anchors = kept
    return matrix, span, rms(transform(matrix, a) - b) / span


def weighted_corrections(obj, names, ids, world, expected, span, rigid):
    """Recover remaining linear skin transforms from all sampled influences together."""
    arm = obj.find_armature()
    arm_world = np.asarray(arm.matrix_world)
    mesh_to_arm = np.linalg.inv(arm_world) @ np.asarray(obj.matrix_world)
    indices = np.concatenate(list(ids.values()))
    residual = np.vstack(list(expected.values())) - world[indices]
    center = world[indices].mean(0)
    columns = {n: 4 * i for i, n in enumerate(names)}
    coefficients = np.zeros((len(indices), 4 * len(names)))
    bones = {}
    for n in {*names, *rigid}:
        bone = arm.pose.bones.get(n)
        if bone:
            bones[n] = (
                arm_world
                @ np.asarray(bone.matrix)
                @ np.linalg.inv(np.asarray(bone.bone.matrix_local))
                @ mesh_to_arm
            )[:3]
    for i, index in enumerate(indices):
        vertex = obj.data.vertices[int(index)]
        for w in vertex.groups:
            n = obj.vertex_groups[w.group].name
            if n not in bones:
                continue
            p = transform(bones[n], np.asarray(vertex.co))
            if n in rigid:
                residual[i] -= w.weight * (transform(rigid[n], p) - p)
            else:
                c = columns[n]
                coefficients[i, c : c + 4] = w.weight * np.r_[(p - center) / span, 1.0]
    # Prefer the smallest correction for underdetermined blends (cloth tips can be planar).
    regularizer = np.eye(coefficients.shape[1]) * 1e-5
    delta = np.linalg.lstsq(
        np.vstack((coefficients, regularizer)),
        np.vstack((residual, np.zeros((len(regularizer), 3)))),
        rcond=None,
    )[0]
    errors = np.split(
        coefficients @ delta - residual, np.cumsum([len(v) for v in ids.values()])[:-1]
    )
    if any(rms(e) > span * 0.001 for e in errors):
        return {}
    fixes = {}
    for n, c in columns.items():
        linear = delta[c : c + 3].T / span
        fix = np.column_stack((np.eye(3) + linear, delta[c + 3] - linear @ center))
        if not 0.05 < np.linalg.det(fix[:, :3]) < 20:
            return {}
        fixes[n] = fix
    return fixes


def compare(scene, obj, sample, bases):
    groups = sample["groups"]
    ids = {k: v["ids"] for k, v in groups.items()}
    maximum = {k: 0.0 for k in groups}
    remaining = {k: 0.0 for k in groups}
    corrections, small_rigid, worst_registration = {}, {}, 0.0
    # Fetch all coordinates once per frame; indices remain in the original FBX topology.
    for frame, coords in sample["frames"].items():
        scene.frame_set(int(frame))
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.data
        xyz = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", xyz)
        world = transform(np.asarray(evaluated.matrix_world)[:3], xyz.reshape(-1, 3))
        actual = {k: world[v] for k, v in ids.items()}
        native = {k: np.asarray(v) for k, v in coords.items()}
        if frame not in bases:
            bases[frame] = body_space(native, actual, groups)
        matrix, span, registration = bases[frame]
        worst_registration = max(worst_registration, registration)
        expected_by_group = {n: transform(matrix, native[n]) for n in ids}
        rigid, pending = {}, {}
        for name, pos in actual.items():
            expected = expected_by_group[name]
            error = rms(pos - expected) / span
            maximum[name] = max(maximum[name], error)
            if error <= 0.001:
                if (
                    error > 0.00001
                    and groups[name]["rigid"] >= len(pos)
                    and len(pos) >= 3
                    and registration <= 0.001
                    and np.linalg.matrix_rank(pos - pos.mean(0), tol=span * 1e-7) >= 2
                ):
                    correction = fit(pos, expected)
                    if rms(transform(correction, pos) - expected) / span < min(
                        0.0001, error
                    ):
                        small_rigid.setdefault(name, {})[frame] = correction.round(
                            9
                        ).tolist()
                continue
            after = error
            if (
                groups[name]["rigid"] >= len(pos)
                and len(pos) >= 3
                and np.linalg.matrix_rank(pos - pos.mean(0), tol=span * 1e-7) >= 2
            ):
                correction = fit(pos, expected)
                after = rms(transform(correction, pos) - expected) / span
                if (
                    after > 0.001
                    and len(pos) >= 4
                    and np.linalg.matrix_rank(pos - pos.mean(0), tol=span * 1e-6) == 3
                ):
                    affine = np.linalg.lstsq(
                        np.column_stack((pos, np.ones(len(pos)))), expected, rcond=None
                    )[0].T
                    if 0.05 < np.linalg.det(affine[:, :3]) < 20:
                        correction = affine
                        after = rms(transform(correction, pos) - expected) / span
                if after <= 0.001 and registration <= 0.001:
                    corrections.setdefault(name, {})[frame] = correction.round(
                        9
                    ).tolist()
                    rigid[name] = correction
                else:
                    after = error
            if after > 0.001:
                pending[name] = after
        if pending and registration <= 0.001:
            recovered = weighted_corrections(
                obj, list(pending), ids, world, expected_by_group, span, rigid
            )
            for name, correction in recovered.items():
                corrections.setdefault(name, {})[frame] = correction.round(9).tolist()
                del pending[name]
        for name, error in pending.items():
            remaining[name] = max(remaining[name], error)
    # Keep an affected attachment continuous across frames on either side of the audit threshold.
    for name, frames in small_rigid.items():
        if name in corrections:
            corrections[name].update(frames)
    return dict(
        vertices=sample["verts"],
        groups=list(groups),
        registration=round(worst_registration, 8),
        deviations={k: round(v, 7) for k, v in maximum.items() if v > 0.001},
        unresolved={k: round(v, 7) for k, v in remaining.items() if v > 0.001},
        corrections=corrections,
    )


def compare_group(blend, partial=False):
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    group = blend.stem.lower()
    scenes = {s["source_max"].lower(): s for s in bpy.data.scenes}
    result = {}
    for path in sorted((SOURCE / blend.stem).rglob("*.max")):
        key = path.relative_to(SOURCE).as_posix().lower()
        ref = reference_file(key)
        if not ref.exists() and partial:
            continue
        row = read_gzip(ref)
        meshes = {}
        rig_helpers = []
        if row["meshes"]:
            scene = scenes[key]
            bpy.context.window.scene = scene
            bases = {}
            for sample in sorted(row["meshes"], key=lambda m: -m["verts"]):
                choices = [
                    o
                    for o in scene.objects
                    if o.type == "MESH"
                    and o.find_armature()
                    and len(o.data.vertices) == sample["verts"]
                ]
                if len(choices) > 1:
                    choices = [
                        o
                        for o in choices
                        if re.sub(r"\.\d{3}$", "", o.name).casefold()
                        == sample["name"].casefold()
                    ]
                if not choices and any(
                    o.type == "ARMATURE" and sample["name"] in o.data.bones
                    for o in scene.objects
                ):
                    rig_helpers.append(sample["name"])
                    continue
                if len(choices) != 1:
                    raise ValueError(
                        f"{key}: cannot match {sample['name']} to Blender topology"
                    )
                obj = choices[0]
                meshes[obj.name] = compare(scene, obj, sample, bases)
        result[key] = dict(
            timing=row["timing"], geometry=row["geometry"], meshes=meshes
        )
        if rig_helpers:
            result[key]["rigHelpers"] = rig_helpers
    REFERENCE.mkdir(parents=True, exist_ok=True)
    dest = REFERENCE / (group + (".partial" if partial else "") + ".json.gz")
    tmp = dest.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf8") as f:
        json.dump(result, f, separators=(",", ":"), ensure_ascii=False)
    tmp.replace(dest)
    print("Compared", group, len(result), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("groups", nargs="*")
    parser.add_argument(
        "--partial", action="store_true", help="Inspect the subset already extracted"
    )
    args = parser.parse_args()
    for blend in sorted((WORK / "player-release/Blender").glob("*.blend")):
        if not args.groups or blend.stem.lower() in args.groups:
            compare_group(blend, args.partial)
