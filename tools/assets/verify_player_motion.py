"""Reimport game GLBs and compare their skinned vertices and timeline to evaluated Max landmarks."""

import argparse
import json
import re
import struct
from pathlib import Path

import bpy
import numpy as np
from mathutils.kdtree import KDTree

from assemble_player import rig_and_body
from drizz_skin import restore_drizz_skin
from library import ROOT, WORK, read_json
from prepare_motion_reference import (
    REFERENCE,
    body_space,
    fit,
    read_gzip,
    reference_file,
    rms,
    transform,
)


def vertices(obj, evaluated=False):
    if evaluated:
        obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", data)
    return transform(np.asarray(obj.matrix_world)[:3], data.reshape(-1, 3))


def attachment(name, arm):
    # Include the hands themselves (weapons may be weighted directly to a hand).
    if re.search(
        r"prop|weapon|wp_|sword|pistol|gun|shield|rpg|arrow|bowbone|staff|blade|wand",
        name,
        re.I,
    ):
        return True
    bone = arm.data.bones.get(name)
    while bone:
        if re.search(r" [LR] Hand$", bone.name, re.I):
            return "finger" not in name.lower()
        bone = bone.parent
    return False


def native_mesh(scene, obj):
    row = read_gzip(reference_file(scene["source_max"]))
    name = re.sub(r"\.\d{3}$", "", obj.name)
    choices = [m for m in row["meshes"] if m["verts"] == len(obj.data.vertices)]
    if len(choices) > 1:
        choices = [m for m in choices if m["name"].casefold() == name.casefold()]
    if len(choices) != 1:
        raise ValueError(
            f"{scene.name}/{obj.name}: ambiguous native vertex correspondence"
        )
    return row["timing"], choices[0]


def deformation(scene, obj):
    bpy.context.window.scene = scene
    scene.frame_set(scene.frame_start)
    clock, native = native_mesh(scene, obj)
    groups = native["groups"]
    bind = vertices(obj)
    sample = {}
    surfaces = {}
    for frame in sorted(
        set(
            [
                scene.frame_start,
                (scene.frame_start + scene.frame_end) // 2,
                scene.frame_end,
            ]
        )
    ):
        scene.frame_set(frame)
        v = vertices(obj, True)
        actual = {n: v[g["ids"]] for n, g in groups.items()}
        original = {n: np.asarray(p) for n, p in native["frames"][str(frame)].items()}
        basis, span, registration = body_space(original, actual, groups)
        motion = {}
        for n, g in groups.items():
            idx = g["ids"]
            if len(idx) < 3 or g["rigid"] < len(idx):
                continue
            rest = bind[idx]
            if np.linalg.matrix_rank(rest - rest.mean(0), tol=span * 1e-7) < 2:
                continue
            expected = transform(basis, original[n])
            movement = fit(rest, expected, scale=True)
            if (
                rms(transform(movement, rest) - expected) > span * 0.0001
                and np.linalg.matrix_rank(rest - rest.mean(0), tol=span * 1e-7) == 3
            ):
                movement = np.linalg.lstsq(
                    np.column_stack((rest, np.ones(len(rest)))), expected, rcond=None
                )[0].T
            if rms(transform(movement, rest) - expected) < span * 0.001:
                motion[n] = movement
        seconds = (frame - scene.frame_start) / clock["fps"]
        sample[seconds] = motion
        surfaces[seconds] = {n: transform(basis, p) for n, p in original.items()}
    duration = (clock["endTick"] - clock["startTick"]) / (
        clock["ticksPerFrame"] * clock["fps"]
    )
    return duration, sample, bind, groups, surfaces


def expectations(group, outlines):
    blend = next(
        p
        for p in (WORK / "player-release/Blender").glob("*.blend")
        if p.stem.lower() == group
    )
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    scenes = {s["source_max"].lower(): s for s in bpy.data.scenes}
    cached = {}
    results = {}
    reference = read_gzip(REFERENCE / (group + ".json.gz"))
    corrected = {
        name
        for record in reference.values()
        for mesh in record["meshes"].values()
        for name in mesh["corrections"]
    }
    for outfit in outlines:
        filename = Path(outfit["model"]).name
        meta = read_json(
            WORK
            / "player-release/Fighters"
            / group
            / Path(filename).with_suffix(".json")
        )
        if not isinstance(meta["clips"], dict):
            results[filename] = None
            continue
        base = scenes[meta["source"].lower()]
        bpy.context.window.scene = base
        base.frame_set(base.frame_start)
        parts = restore_drizz_skin(base, scenes) if meta.get("skinSources") else []
        arm, obj = rig_and_body(base)
        if parts:
            groups = {}
            for scene, part, indices in parts:
                _, sample = native_mesh(scene, part)
                for n, g in sample["groups"].items():
                    ids = [i for vertex in g["ids"] for i in indices[vertex]]
                    if g["rigid"] >= len(g["ids"]) and n not in groups:
                        groups[n] = {"ids": ids, "rigid": len(ids)}
            native = {"groups": groups}
        else:
            _, native = native_mesh(base, obj)
        bind = vertices(obj)
        span = np.linalg.norm(np.ptp(bind, axis=0))
        points = {
            n: bind[g["ids"]]
            for n, g in native["groups"].items()
            if (
                n in corrected
                or attachment(n, arm)
                or re.search(
                    r" (?:Head|Pelvis|Spine1|[LR] (?:Calf|Foot|Forearm|Finger1))$", n
                )
            )
            and g["rigid"] >= len(g["ids"])
        }
        non_biped = not points
        if non_biped:
            points = {
                n: bind[g["ids"]]
                for n, g in native["groups"].items()
                if g["rigid"] >= len(g["ids"])
            }
        clips = {}
        unmatched = set()
        for clip, source in meta["clips"].items():
            start = 0
            frames = {}
            for take in source.get("stages", [source]):
                key = take["source"].lower()
                scene = scenes[key]
                body = scene.objects.get(take.get("mesh", "")) or rig_and_body(scene)[1]
                cache_key = (key, body.name)
                if cache_key not in cached:
                    cached[cache_key] = deformation(scene, body)
                duration, samples, source_bind, source_groups, surfaces = cached[
                    cache_key
                ]
                # Identical source topology also permits a direct check of soft weights.
                # Preserve the native positions of actual fingers and the grip at each pose.
                direct = {}
                if len(bind) == len(source_bind):
                    for n, g in source_groups.items():
                        if not (
                            non_biped
                            or attachment(n, arm)
                            or n in corrected
                            or "finger" in n.lower()
                        ):
                            continue
                        ids = g["ids"]
                        if n not in native["groups"] or not np.allclose(
                            bind[ids], source_bind[ids], atol=span * 1e-5, rtol=0
                        ):
                            continue
                        label = f"@{key}|{n}"
                        points[label] = bind[ids]
                        direct[label] = n
                for sec, deforms in samples.items():
                    unmatched.update(
                        n
                        for n in points.keys() - deforms.keys()
                        if not n.startswith("@")
                    )
                    frames[round(start + sec, 7)] = {
                        n: transform(deforms[n], v)
                        for n, v in points.items()
                        if n in deforms
                    }
                    frames[round(start + sec, 7)].update(
                        {label: surfaces[sec][n] for label, n in direct.items()}
                    )
                start += duration
            clips[clip] = (start, frames)
        results[filename] = points, clips, float(span), sorted(unmatched)
    return results


def verify_group(group, outlines, folder):
    targets = expectations(group, outlines)
    report = {}
    for name, target in targets.items():
        if target is None:
            report[name] = {"static": True}
            continue
        points, clips, span, missing = target
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        scene.render.fps = 30
        path = folder / name
        data = path.read_bytes()
        doc = json.loads(data[20 : 20 + struct.unpack_from("<I", data, 12)[0]])
        bpy.ops.import_scene.gltf(filepath=str(path))
        arm, obj = rig_and_body(scene)
        rest = vertices(obj)
        indices, kept, omitted = {}, {}, {}
        map_error = 0.0
        for n, ps in points.items():
            # glTF splits seams and omits unused vertices. Match both the bind position
            # and its rigid influence. An unexported source vertex has no posed sample.
            direct = n.startswith("@")
            group = obj.vertex_groups.get(n.rsplit("|", 1)[-1] if direct else n)
            verts = [
                v.index
                for v in obj.data.vertices
                if group
                and any(
                    w.group == group.index and w.weight > (0 if direct else 0.999)
                    for w in v.groups
                )
            ]
            hits = []
            if verts:
                tree = KDTree(len(verts))
                for i in verts:
                    tree.insert(rest[i], i)
                tree.balance()
                for j, p in enumerate(ps):
                    _, i, distance = tree.find(p)
                    if distance < span * 0.0001:
                        map_error = max(map_error, distance / span)
                        hits.append((j, i))
            if len(hits) != len(ps):
                omitted[n] = len(ps) - len(hits)
            if hits:
                kept[n], indices[n] = map(list, zip(*hits))
        ad = arm.animation_data
        ad.action = None
        for track in ad.nla_tracks:
            track.mute = True
        errors = {}
        clock_errors = {}
        samples = 0
        if {t.name for t in ad.nla_tracks} != clips.keys():
            raise ValueError(f"{name}: source and reimported animation sets differ")
        for track in ad.nla_tracks:
            if track.name not in clips:
                continue
            expected_sec, frames = clips[track.name]
            anim = next(a for a in doc["animations"] if a["name"] == track.name)
            inputs = [doc["accessors"][s["input"]] for s in anim["samplers"]]
            actual_sec = max(a["max"][0] for a in inputs) - min(
                a["min"][0] for a in inputs
            )
            if abs(expected_sec - actual_sec) > 1e-4:
                clock_errors[track.name] = [
                    round(expected_sec, 6),
                    round(actual_sec, 6),
                ]
            track.mute = False
            for sec, positions in frames.items():
                frame = sec * 30
                # Old assets with retimed tracks can still be compared at the same source pose.
                if actual_sec != expected_sec and expected_sec:
                    frame *= actual_sec / expected_sec
                whole = round(track.strips[0].frame_start + frame, 5)
                scene.frame_set(int(whole), subframe=whole - int(whole))
                v = vertices(obj, True)
                positions = {n: p[kept[n]] for n, p in positions.items() if n in kept}
                anchors = [
                    n
                    for n in positions
                    if not n.startswith("@")
                    and re.search(
                        r" (?:Head|Pelvis|Spine1|[LR] (?:Hand|Calf|Foot|Forearm|Finger1))$",
                        n,
                    )
                ]
                align = (
                    fit(
                        np.vstack([positions[n] for n in anchors]),
                        np.vstack([v[indices[n]] for n in anchors]),
                    )
                    if anchors
                    else np.eye(4)[:3]
                )
                for n, expected in positions.items():
                    error = rms(v[indices[n]] - transform(align, expected)) / span
                    samples += 1
                    if error > errors.get(n, [0])[0]:
                        errors[n] = [round(error, 7), track.name, sec]
            track.mute = True
        report[name] = dict(
            groups=sorted(points),
            missing=missing,
            samples=samples,
            mappedError=round(map_error, 7),
            omittedVertices=omitted,
            errors=errors,
            times=clock_errors,
        )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("groups", nargs="*")
    parser.add_argument("--skins", nargs="+", help="Only check these outfit IDs")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--models", type=Path, default=ROOT / "public/assets/fighters")
    args = parser.parse_args()
    outfits = read_json(ROOT / "src/content/raid/published-outfits.json")
    if args.skins:
        outfits = [o for o in outfits if o["skin"] in args.skins]
    report = {}
    for group in sorted({o["group"] for o in outfits}):
        if args.groups and group not in args.groups:
            continue
        report.update(
            verify_group(
                group, [o for o in outfits if o["group"] == group], args.models
            )
        )
        args.out.write_text(json.dumps(report, indent=2), encoding="utf8")
        print("Verified", group, flush=True)
    failed = [
        name
        for name, result in report.items()
        if not result.get("static")
        and (
            not result["samples"]
            or result["times"]
            or any(error[0] > 0.001 for error in result["errors"].values())
        )
    ]
    if not report or failed:
        raise SystemExit(f"No matches or failed duration / 0.1% pose check: {failed}")
