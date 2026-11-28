"""Compare every evaluated Blender mesh vertex to the matching Max Alembic sample in world space.

One report per original path. Identical original files may share a native cache.
The source cache uses Max's actual world space. No fit or per-frame alignment
is applied, so a lost root transform or detached weapon appears in the result.
"""

import argparse
import hashlib
import re
import traceback
from collections import Counter
from pathlib import Path

import bpy
import numpy as np
from library import INDEX, WORK, read_json, save_json
from verify_max_scenes import (
    AUDIT,
    PORTS,
    canonical_name,
    digest,
    fbx_path,
    packed_values,
    surface,
)


def topology(ob, reference):
    # FBX and Alembic can triangulate or dissolve planar faces differently.
    # Compare the artist's UV assignments by vertex, including UV seams.
    a, b = ob.data, reference.data

    def faces(m):
        return Counter(tuple(sorted(p.vertices)) for p in m.polygons)

    def uv_values(m):
        if not m.uv_layers.active:
            return set()
        indices = packed_values(m.loops, "vertex_index", 1, np.int32)
        uv = packed_values(m.uv_layers.active.uv, "vector", 2).reshape(-1, 2)
        rounded = np.rint(uv * 1e5).astype(np.int64)
        return set(zip(indices, rounded[:, 0], rounded[:, 1]))

    return {
        "polygons": [len(a.polygons), len(b.polygons)],
        "sameFaces": faces(a) == faces(b),
        "uvLayers": [len(a.uv_layers), len(b.uv_layers)],
        "sameVertexUvs": uv_values(a) == uv_values(b),
    }


def compare(item, port, abc, meta, quick):
    opened_mtime = port.stat().st_mtime_ns
    opened_sha = digest(port.read_bytes())
    bpy.ops.wm.open_mainfile(filepath=str(port), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    if scene.view_layers.get("Editable rig"):
        bpy.context.window.view_layer = scene.view_layers["Editable rig"]
    original = list(bpy.context.view_layer.objects)
    reference_paths = [str(bpy.path.abspath(c.filepath)) for c in bpy.data.cache_files]
    # The correction tool may keep an untouched editable rig alongside its preview.
    meshes = [o for o in original if o.type == "MESH"]
    bones = {
        canonical_name(b.name)
        for ob in original
        if ob.type == "ARMATURE"
        for b in ob.data.bones
    }
    empties = {
        canonical_name(ob.name) for ob in original if ob.type in {"EMPTY", "ARMATURE"}
    }
    old = set(bpy.data.objects)
    bpy.ops.wm.alembic_import(
        filepath=str(abc),
        as_background_job=False,
        set_frame_range=False,
        validate_meshes=False,
    )
    imported = [o for o in bpy.data.objects if o not in old]
    bodies = [o for o in imported if o.type == "MESH"]
    matched = []
    unmatched = []
    used = set()
    # Name and vertex count precede vertex count alone; e.g. props may share topology.
    for ob in meshes:
        name = canonical_name(ob.name)
        candidates = [
            other
            for other in bodies
            if other not in used and canonical_name(other.name) == name
        ]
        count = len(ob.data.vertices)
        if len(candidates) != 1:
            pool = (
                candidates
                if candidates
                else [
                    other
                    for other in bodies
                    if other not in used
                    and canonical_name(other.name) not in bones | empties
                ]
            )
            candidates = [other for other in pool if len(other.data.vertices) == count]
        if len(candidates) != 1:
            unmatched.append(
                {
                    "blend": ob.name,
                    "vertices": count,
                    "candidates": [o.name for o in candidates],
                }
            )
            continue
        other = candidates[0]
        used.add(other)
        matched.append((ob, other))
    extra = [
        o.name
        for o in bodies
        if o not in used and canonical_name(o.name) not in bones | empties
    ]
    # Alembic appends the Max node handle to duplicate names. Blender FBX
    # appends .001 instead. Only pair such a handle when a second bone exists.
    bone_counts = Counter(
        canonical_name(b.name)
        for arm in original
        if arm.type == "ARMATURE"
        for b in arm.data.bones
    )
    alias_helpers = []
    for name in extra.copy():
        found = re.search(r"_ID[0-9]+(?:\.[0-9]+)?$", name, re.IGNORECASE)
        if found:
            base = canonical_name(name[: found.start()])
            if bone_counts[base] > 1:
                bone_counts[base] -= 1
                alias_helpers.append(name)
                extra.remove(name)
    # The Biped's mesh-shaped handles are recorded above. Do not evaluate them
    # for each playback frame while verifying the separately imported render meshes.
    required = set(used)
    for ob in tuple(used):
        parent = ob.parent
        while parent:
            required.add(parent)
            parent = parent.parent
    for ob in imported:
        if ob not in required:
            bpy.data.objects.remove(ob, do_unlink=True)
    first, last = int(meta["first"]), int(meta["last"])
    frames = (
        sorted({first, (first + last) // 2, last}) if quick else range(first, last + 1)
    )
    bymesh = {
        o.name: {
            "cacheMesh": c.name,
            "max": 0,
            "rms": 0,
            "vertexSamples": 0,
            "overTolerance": 0,
            "topology": topology(o, c),
        }
        for o, c in matched
    }
    maxExtent = 0.0
    for f in frames:
        if not matched:
            break
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        evaluated = [(o, surface(o, dg), surface(c, dg)) for o, c in matched]
        if maxExtent == 0.0:
            parts = [n for _, _, n in evaluated if len(n)]
            if not parts:
                break
            maxExtent = max(
                float(np.linalg.norm(np.ptp(np.vstack(parts), axis=0))), 1e-6
            )
        for o, actual, expected in evaluated:
            metric = bymesh[o.name]
            if len(actual) != len(expected):
                metric["vertexCountMismatch"] = [len(actual), len(expected)]
                continue
            if not len(actual):
                continue
            err = np.linalg.norm(actual - expected, axis=1) / maxExtent
            if not np.isfinite(err).all():
                raise ValueError("Non-finite evaluated coordinates: " + o.name)
            peak = float(err.max())
            if peak > metric["max"]:
                metric.update(max=peak, worstFrame=f, worstVertex=int(err.argmax()))
            metric["rms"] = max(metric["rms"], float(np.sqrt(np.mean(err * err))))
            metric["overTolerance"] += int(np.count_nonzero(err > 0.001))
            metric["vertexSamples"] += len(err)
    if port.stat().st_mtime_ns != opened_mtime:
        raise RuntimeError("The port changed during verification. Rerun this scene.")
    return {
        "auditVersion": 3,
        "source": item["path"],
        "blendSha256": opened_sha,
        "cacheSha256": meta["sha256"],
        "allFrames": not quick,
        "first": first,
        "last": last,
        "frames": len(frames) if matched else 0,
        "referenceResolves": any(
            abc.resolve() == Path(p).resolve() for p in reference_paths
        ),
        "extent": maxExtent,
        "meshChecks": bymesh,
        "unmatchedBlend": unmatched,
        "additionalCacheMeshes": extra,
        "duplicateBoneDisplays": alias_helpers,
        "cacheMeshCount": len(bodies),
        "armatureHelpersInCache": len(bodies) - len(extra) - len(used),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--group", nargs="+", default=[])
    p.add_argument(
        "--shard", type=int, nargs=2, metavar=("INDEX", "COUNT"), default=(0, 1)
    )
    p.add_argument("--quick", action="store_true")
    p.add_argument("--ready", action="store_true")
    p.add_argument(
        "--ported",
        action="store_true",
        help="Only inspect the finished native-reference ports",
    )
    p.add_argument("--replace", action="store_true")
    args = p.parse_args()
    items = sorted(
        (r for r in read_json(INDEX)["files"] if r["kind"] in {"scene", "motion"}),
        key=lambda r: r["path"].casefold(),
    )
    errors = 0
    for item in items[args.shard[0] :: args.shard[1]]:
        if args.group and item["group"].casefold() not in args.group:
            continue
        abc = WORK / "max-preservation/cache" / (item["sha256"] + ".abc")
        port = PORTS / fbx_path(item).with_suffix(".blend")
        meta_path = abc.with_suffix(".json")
        if (
            args.ported
            and not (
                WORK
                / "max-preservation/port-records"
                / (hashlib.sha256(item["path"].encode()).hexdigest()[:24] + ".json")
            ).exists()
        ):
            continue
        if args.ready and (not port.exists() or not meta_path.exists()):
            continue
        out = (
            AUDIT / ("cache-sample" if args.quick else "cache") / (item["id"] + ".json")
        )
        try:
            meta = read_json(meta_path)
            if not args.replace and out.is_file():
                old = read_json(out)
                if (
                    old.get("auditVersion") == 3
                    and old.get("cacheSha256") == meta["sha256"]
                    and old.get("blendSha256") == digest(port.read_bytes())
                ):
                    continue
            if abc.stat().st_size != meta["bytes"]:
                raise ValueError("Incomplete original cache")
            with abc.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != meta["sha256"]:
                    raise ValueError(
                        "Source cache bytes differ from the native export receipt"
                    )
            result = compare(item, port, abc, meta, args.quick)
        except (OSError, RuntimeError, ValueError, KeyError, IndexError):
            errors += 1
            result = {"source": item["path"], "error": traceback.format_exc()}
        save_json(out, result)
        if "error" in result:
            print(item["path"], result["error"], flush=True)
    if errors:
        raise SystemExit(f"{errors} scene(s) failed native surface verification")


if __name__ == "__main__":
    main()
