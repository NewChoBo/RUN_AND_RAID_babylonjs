"""Reopen Player scene ports, compare FBX content, and check independently recorded Max joint positions.

Run with Blender's Python (bpy 5.3) in a fresh background process. The output is
per source and per stage so an interrupted audit can resume in any order.
"""

import argparse
import gzip
import hashlib
import json
import re
import traceback
from collections import Counter, defaultdict
from pathlib import Path

import bpy
import numpy as np
from asset_names import fbx_path
from convert import fbx_for
from library import INDEX, WORK, read_json, save_json
from prepare_motion_reference import (
    read_gzip,
    reference_file,
    transform,
)

AUDIT = WORK / "max-preservation" / "verify"
PORTS = WORK / "max-preservation" / "blend"


def canonical_name(name):
    bare = re.sub(r"\.\d{3}$", "", name)
    return "".join(c for c in bare.casefold() if c.isalnum())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def packed_values(collection, attr, width, dtype=np.float32):
    values = np.empty(len(collection) * width, dtype=dtype)
    collection.foreach_get(attr, values)
    if values.dtype.kind == "f" and not np.isfinite(values).all():
        raise ValueError(f"Non-finite {attr} in the scene")
    return values


def array_digest(*arrays):
    h = hashlib.sha256()
    for a in arrays:
        h.update(np.ascontiguousarray(a))
    return h.hexdigest()


def mesh_signature(obj):
    m = obj.data
    v = packed_values(m.vertices, "co", 3)
    topo = array_digest(
        packed_values(m.edges, "vertices", 2, np.int32),
        packed_values(m.loops, "vertex_index", 1, np.int32),
        packed_values(m.polygons, "loop_total", 1, np.int32),
        packed_values(m.polygons, "material_index", 1, np.int32),
    )
    uv = {
        layer.name: array_digest(packed_values(layer.uv, "vector", 2))
        for layer in m.uv_layers
    }
    groups = {}
    weighted = 0
    for vi, vertex in enumerate(m.vertices):
        used = False
        for group in vertex.groups:
            if not np.isfinite(group.weight):
                raise ValueError("Non-finite skin weight")
            name = obj.vertex_groups[group.group].name
            groups.setdefault(name, []).append((vi, group.weight))
            used |= group.weight > 0
        weighted += used
    return {
        "vertices": len(m.vertices),
        "polygons": len(m.polygons),
        "loops": len(m.loops),
        "basePositions": array_digest(v),
        "topology": topo,
        "uv": uv,
        "weightedVertices": weighted,
        "weights": {
            n: array_digest(np.asarray(g, dtype=np.float64)) for n, g in groups.items()
        },
        "materialSlots": [m is not None for m in m.materials],
    }


def action_signature():
    # Compare every stored FBX pose channel, including all baked key values/times.
    actions = []
    for act in bpy.data.actions:
        curves = []
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        keys = packed_values(curve.keyframe_points, "co", 2)
                        curves.append(
                            (
                                curve.data_path,
                                curve.array_index,
                                len(keys) // 2,
                                array_digest(keys),
                            )
                        )
        actions.append(sorted(curves))
    return sorted(actions)


def surface(ob, depsgraph):
    ev = ob.evaluated_get(depsgraph)
    coords = packed_values(ev.data.vertices, "co", 3).reshape(-1, 3)
    return transform(np.asarray(ev.matrix_world)[:3], coords)


def geometry_fbx(scene, frames):
    objects = sorted(bpy.context.view_layer.objects, key=lambda o: o.name)
    meshes = [o for o in objects if o.type == "MESH"]
    arms = [o for o in objects if o.type == "ARMATURE"]
    known = {}
    for arm in arms:
        for b in arm.data.bones:
            known[b.name] = {
                "parent": b.parent.name if b.parent else None,
                "rest": array_digest(np.asarray(b.matrix_local, dtype=np.float32)),
            }
    poses = []
    for frame in frames:
        scene.frame_set(frame)
        dg = bpy.context.evaluated_depsgraph_get()
        poses.append(
            {
                "frame": frame,
                "skin": sorted(
                    array_digest(v.astype(np.float32))
                    for v in (surface(o, dg) for o in meshes)
                ),
                "poseBones": sorted(
                    (b.name, array_digest(np.asarray(b.matrix, dtype=np.float32)))
                    for a in arms
                    for b in a.evaluated_get(dg).pose.bones
                ),
            }
        )
    meshes_digest = [mesh_signature(m) for m in meshes]
    return {
        "types": {
            t: sum(o.type == t for o in objects)
            for t in sorted({o.type for o in objects})
        },
        "meshes": sorted(
            meshes_digest,
            key=lambda m: (m["vertices"], m["topology"], m["basePositions"]),
        ),
        "bones": known,
        "poses": poses,
        "actions": action_signature(),
    }


def resolve_images(scene):
    images = set()
    for ob in bpy.context.view_layer.objects:
        if ob.type != "MESH":
            continue
        for mat in ob.data.materials:
            if mat and mat.node_tree:
                images.update(
                    n.image
                    for n in mat.node_tree.nodes
                    if n.type == "TEX_IMAGE" and n.image
                )
    result = []
    for im in sorted(images, key=lambda i: i.name):
        packed = im.packed_file
        p = Path(bpy.path.abspath(im.filepath))
        data = packed.data if packed else None
        result.append(
            {
                "file": im.name,
                "path": im.filepath,
                "packed": bool(packed),
                "externalExists": p.is_file(),
                "dimensions": list(im.size),
                "sha256": digest(data) if data else None,
            }
        )
        if packed and (not data or min(im.size) <= 0):
            raise ValueError("Unreadable packed image: " + im.name)
    return result


def painted_skin(native, objects):
    """Compare native vertex paint by original vertex index and the bone's name."""
    from verify_native_preservation import Buffer, influence_type

    folder = WORK / "max-preservation/native/surfaces"
    result = {}
    for node in native["nodes"]:
        for skin in node["modifiers"]:
            if skin["type"] != "Skin" or not skin.get("weightFile"):
                continue
            name = re.sub(r"[^\w]", "", node["name"]).casefold()
            choices = [
                o
                for o in objects
                if o.type == "MESH" and len(o.data.vertices) == skin["vertices"]
            ]
            if len(choices) != 1:
                choices = [
                    o
                    for o in choices
                    if re.sub(r"[^\w]", "", re.sub(r"\.\d{3}$", "", o.name)).casefold()
                    == name
                ]
            if len(choices) != 1:
                result[node["name"]] = {"unmatched": True, "vertices": skin["vertices"]}
                continue
            obj = choices[0]
            buf = Buffer(folder / skin["weightFile"])
            if (buf.integer(), buf.integer()) != (1, len(obj.data.vertices)):
                raise ValueError("Skin metadata/vertex buffer mismatch")
            names = {int(k): v for k, v in skin["weightedBoneIDs"].items()}
            stored_names = json.loads(obj.get("max_skin_group_ids", "{}"))
            duplicates = {
                n for n, count in Counter(names.values()).items() if count > 1
            }
            aliases = {}
            for duplicated in duplicates:
                ids = sorted(i for i, n in names.items() if n == duplicated)
                choices = sorted(
                    g.name
                    for g in obj.vertex_groups
                    if re.fullmatch(re.escape(duplicated) + r"(?:\.\d{3})?", g.name)
                )
                if len(choices) == len(ids):
                    for i, n in zip(ids, choices, strict=True):
                        names[i] = n
                        aliases[str(i)] = n
            for id_, group in stored_names.items():
                if group != names[int(id_)]:
                    aliases[id_] = group
                names[int(id_)] = group
            worst = 0.0
            changed = 0
            for vertex in obj.data.vertices:
                native_weights = buf.array(influence_type, buf.integer())
                expected = {
                    names[int(v["bone"])]: float(v["weight"]) for v in native_weights
                }
                actual = {
                    obj.vertex_groups[w.group].name: w.weight for w in vertex.groups
                }
                err = max(
                    (
                        abs(actual.get(n, 0) - expected.get(n, 0))
                        for n in actual.keys() | expected.keys()
                    ),
                    default=0.0,
                )
                worst = max(worst, err)
                changed += err > 1e-5
            buf.complete()
            result[node["name"]] = {
                "vertices": len(obj.data.vertices),
                "maxError": worst,
                "duplicateBoneIds": aliases,
                "overTolerance": changed,
            }
    return result


def named_nodes(nodes, candidates):
    """Resolve Max handle disambiguation in Alembic and Blender's FBX suffixes."""
    by_name = defaultdict(list)
    groups = defaultdict(list)
    for i, node in enumerate(nodes):
        groups[canonical_name(node["name"])].append((i, node))
    for name, value in candidates:
        base = re.sub(r"_ID[0-9]+(?:\.\d{3})?$", "", name, flags=re.IGNORECASE)
        by_name[canonical_name(base)].append((name, value))
    matches = []
    for key, sources in groups.items():
        available = sorted(by_name[key], key=lambda pair: pair[0])
        for i, node in sorted(sources, key=lambda pair: pair[1]["handle"]):
            if not available:
                break
            suffix = re.compile(
                r"_ID" + str(node["handle"]) + r"(?:\.\d{3})?$", re.IGNORECASE
            )
            index = next(
                (
                    index
                    for index, (name, _) in enumerate(available)
                    if suffix.search(name)
                ),
                0,
            )
            _, value = available.pop(index)
            label = (
                node["name"]
                if len(sources) == 1
                else f"{node['name']} [#{node['handle']}]"
            )
            matches.append((i, label, value))
    return matches


def node_origins(scene, item, sample_frames):
    """Check same-name bone heads and helper origins in world metres, without pose registration."""
    folder = WORK / "max-preservation/native/scenes"
    path = folder / (item["sha256"] + ".json.gz")
    native = read_gzip(path)
    if native["version"] < 3:
        raise ValueError("Expected native audit coordinates in world space")
    matrix_file = folder / (item["sha256"] + ".f32.gz")
    timing = native["timing"]
    raw = gzip.decompress(matrix_file.read_bytes())
    mats = np.frombuffer(raw, dtype="<f4").reshape(
        timing["last"] - timing["first"] + 1, len(native["nodes"]), 4, 3
    )
    if not np.isfinite(mats).all():
        raise ValueError("Non-finite world matrix in native capture")

    objects = list(bpy.context.view_layer.objects)
    arms = [o for o in objects if o.type == "ARMATURE"]
    candidates = [(b.name, (a, b.name)) for a in arms for b in a.data.bones]
    candidates.extend((o.name, (o, None)) for o in objects if o.type == "EMPTY")
    matches = named_nodes(native["nodes"], candidates)
    rig_only = not any(o.type == "MESH" and o.data.polygons for o in objects)
    frames = range(timing["first"], timing["last"] + 1) if rig_only else sample_frames
    worst = {}
    skin = painted_skin(native, objects)
    restorations = json.loads(scene.get("max_surface_audit", "{}")).get(
        "restoredNativePaint", {}
    )
    for node in native["nodes"]:
        restored = restorations.get(node["name"], {})
        if restored.get("layer") != "MAX rig display geometry":
            continue
        proxy = scene.objects[restored["mesh"]]
        checked = painted_skin({"nodes": [node]}, [proxy])[node["name"]]
        skin[node["name"]]["referenceProxy"] = dict(
            checked, mesh=proxy.name, layer=restored["layer"]
        )
    unit = float(native["units"]["perMeter"])
    native_start = mats[0, :, 3, :] / unit
    if matches:
        native_start = native_start[[i for i, _, _ in matches]]
    span = (
        max(float(np.linalg.norm(np.ptp(native_start, axis=0))), 1e-6)
        if len(native_start)
        else 1e-6
    )
    for frame in frames:
        scene.frame_set(frame)
        dg = bpy.context.evaluated_depsgraph_get()
        evaluated = {a: a.evaluated_get(dg) for a in arms}
        for index, label, (object_, bone) in matches:
            if bone is not None:
                ob = evaluated[object_]
                point = ob.matrix_world @ ob.pose.bones[bone].head
            else:
                point = object_.evaluated_get(dg).matrix_world.translation
            err = float(
                np.linalg.norm(
                    np.asarray(point)
                    - mats[frame - timing["first"], index, 3, :] / unit
                )
            )
            if not np.isfinite(err):
                raise ValueError("Non-finite joint origin: " + label)
            if label not in worst or err > worst[label][0]:
                worst[label] = [err, frame]
    archive = {}
    reference = scene.view_layers.get("MAX evaluated")
    if reference:
        bpy.context.window.view_layer = reference
        # Temporarily display the Biped helper geometry for the archived pivot comparison.
        ref_collection = reference.layer_collection.children.get("MAX evaluated")
        helpers = (
            ref_collection.children.get("MAX rig display geometry")
            if ref_collection
            else None
        )
        if helpers:
            helpers.exclude = False
        matched_references = named_nodes(
            native["nodes"], [(o.name, o) for o in reference.objects]
        )
        max_ref = {}
        for f in frames:
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            for i, label, ob in matched_references:
                point = ob.evaluated_get(dg).matrix_world.translation
                err = float(
                    np.linalg.norm(
                        np.asarray(point) - mats[f - timing["first"], i, 3, :] / unit
                    )
                )
                if label not in max_ref or err > max_ref[label][0]:
                    max_ref[label] = [err, f]
        archive = {
            "matched": len(matched_references),
            "overTolerance": {k: v for k, v in max_ref.items() if v[0] > 0.001 * span},
            "maxErrorMeters": max((v[0] for v in max_ref.values()), default=0),
        }
    return {
        "matches": len(matches),
        "maxEvaluated": archive,
        "skin": skin,
        "frames": len(frames) if matches else 0,
        "rigOnly": rig_only,
        "spanMeters": span,
        "maxErrorMeters": max((m[0] for m in worst.values()), default=0),
        "overTolerance": {k: v for k, v in worst.items() if v[0] > 0.001 * span},
    }


def timing(row):
    t = row["timing"]
    return (
        t["startTick"] // t["ticksPerFrame"],
        t["endTick"] // t["ticksPerFrame"],
        t["fps"],
    )


def run(item, phase):
    native = read_gzip(reference_file(item["path"]))
    start, end, fps = timing(native)
    frames = sorted({start, (start + end) // 2, end})
    fbx = fbx_for(item)
    port = PORTS / fbx_path(item).with_suffix(".blend")
    record = {
        "source": item["path"],
        "stage": phase,
        "auditVersion": 3 if phase == "nodes" else 2,
    }
    if phase == "reference":
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        bpy.ops.wm.fbx_import(filepath=str(fbx), anim_offset=0.0)
        scene.render.fps = fps
        scene.frame_start, scene.frame_end = start, end
        record.update(
            fbxSha256=digest(fbx.read_bytes()), geometry=geometry_fbx(scene, frames)
        )
    else:
        opened_mtime = port.stat().st_mtime_ns
        opened_sha = digest(port.read_bytes())
        bpy.ops.wm.open_mainfile(filepath=str(port), load_ui=False, use_scripts=False)
        scene = bpy.context.scene
        if scene.get("source_max", "").casefold() != item["path"].casefold():
            raise ValueError("Blender scene lacks the corresponding Max source path")
        record.update(blendSha256=opened_sha)
        if scene.view_layers.get("Editable rig"):
            bpy.context.window.view_layer = scene.view_layers["Editable rig"]
        if phase == "nodes":
            record["comparison"] = node_origins(scene, item, frames)
        else:
            baseline = read_json(AUDIT / "reference" / (item["id"] + ".json"))[
                "geometry"
            ]
            observed = geometry_fbx(scene, frames)
            observed = json.loads(json.dumps(observed))
            # A corrected Action can coexist with the unmodified source Action.
            source_actions_saved = list(observed["actions"])
            for original in baseline["actions"]:
                if original not in source_actions_saved:
                    break
                source_actions_saved.remove(original)
            else:
                observed["actions"] = baseline["actions"]
            differences = {k for k in observed if observed[k] != baseline[k]}
            first = (
                scene.frame_preview_start
                if start < 0 and scene.use_preview_range
                else scene.frame_start
            )
            if (first, scene.frame_end, scene.render.fps / scene.render.fps_base) != (
                start,
                end,
                fps,
            ) or (start < 0 and scene.frame_preview_end != end):
                differences.add("timeline")
            record.update(
                differences=sorted(differences),
                images=resolve_images(scene),
                geometry={k: observed[k] for k in differences if k in observed},
                counts={k: len(v) for k, v in baseline.items()},
            )
        if port.stat().st_mtime_ns != opened_mtime:
            raise RuntimeError(
                "The port changed during verification. Rerun this scene."
            )
    return record


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("phase", choices=("reference", "inspect", "nodes"))
    ap.add_argument("--group", action="append", default=[])
    ap.add_argument(
        "--shard", type=int, nargs=2, metavar=("INDEX", "COUNT"), default=(0, 1)
    )
    ap.add_argument("--replace", action="store_true")
    ap.add_argument(
        "--ported",
        action="store_true",
        help="Verify finished native-reference ports only",
    )
    ap.add_argument(
        "--ready", action="store_true", help="Only verify existing .blend files"
    )
    args = ap.parse_args()
    rows = [r for r in read_json(INDEX)["files"] if r["kind"] in {"scene", "motion"}]
    shard, shards = args.shard
    errors = 0
    for item in sorted(rows, key=lambda r: r["path"])[shard::shards]:
        if args.group and item["group"].lower() not in args.group:
            continue
        port = PORTS / fbx_path(item).with_suffix(".blend")
        if (
            args.ported
            and not (
                WORK / "max-preservation/port-records" / (item["id"] + ".json")
            ).is_file()
        ):
            continue
        if (
            args.ready
            and args.phase == "nodes"
            and not (
                WORK / "max-preservation/native/receipts" / (item["sha256"] + ".json")
            ).exists()
        ):
            continue
        if args.ready and not port.exists():
            continue
        path = AUDIT / args.phase / (item["id"] + ".json")
        if path.exists() and not args.replace:
            prev = read_json(path)
            inp = fbx_for(item) if args.phase == "reference" else port
            if (
                inp.exists()
                and (
                    args.phase == "reference"
                    or prev.get("auditVersion") == (3 if args.phase == "nodes" else 2)
                )
                and prev.get(
                    "fbxSha256" if args.phase == "reference" else "blendSha256"
                )
                == digest(inp.read_bytes())
                and "error" not in prev
            ):
                continue
        try:
            value = run(item, args.phase)
        except (OSError, RuntimeError, ValueError, KeyError, IndexError):
            errors += 1
            value = {"source": item["path"], "error": traceback.format_exc()}
        save_json(path, value)
        if "error" in value:
            print(item["path"], value["error"], flush=True)
    if errors:
        raise SystemExit(f"{errors} scene(s) failed to open or inspect")


if __name__ == "__main__":
    main()
