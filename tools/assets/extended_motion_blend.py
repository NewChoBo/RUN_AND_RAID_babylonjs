"""Make additional Blender scenes for authored keys outside playback and between frames."""

import argparse
import math
import zipfile
from pathlib import Path

import bpy
import numpy as np
from library import WORK, read_json, save_json
from native_mesh_blend import mesh_tables
from package_max_scenes import csv_bytes, pack
from verify_max_scenes import canonical_name, surface


def source_parts(meta):
    return (
        meta["segments"] + meta["offGridPoses"] + meta.get("outsideTimelinePoses", [])
    )


def part_id(row, part):
    return row["source"], part["file"] if "file" in part else f"tick {part['tick']}"


def make_group(base, group, rows, selected=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    out = base / "extended-edit"
    out.mkdir(exist_ok=True)
    temp = out / (group + ".partial.blend")
    checks, indexed, members, tasks = [], [], {}, []
    for r in rows:
        meta = read_json(base / "extended" / (r["sourceSha256"] + ".json"))
        parts = [
            part
            for part in source_parts(meta)
            if selected is None or part_id(r, part) in selected
        ]
        if parts:
            header = base / "extended" / (r["sourceSha256"] + ".json")
            members[header.relative_to(base).as_posix()] = header
        tasks.extend((r, meta, part) for part in parts)
    if not tasks:
        print("All native keys in playback at integer frames:", group, flush=True)
        return
    for check in [False, True]:
        if check:
            for cache in bpy.data.cache_files:
                if cache.filepath:
                    cache.filepath = "//../extended/" + Path(cache.filepath).name
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(temp), compress=True)
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.wm.open_mainfile(
                filepath=str(temp), load_ui=False, use_scripts=False
            )
        for i, (row, meta, part) in enumerate(tasks):
            source = row["source"]
            label = Path(row["blend"]).stem
            is_pose = "tick" in part
            tag = (
                f"tick {part['tick']}"
                if is_pose
                else ("before" if part["first"] < row["start"] else "after")
            )
            if check:
                scene = next(
                    s
                    for s in bpy.data.scenes
                    if s.get("max_path") == source and s.get("interval") == tag
                )
            else:
                scene = bpy.context.scene if i == 0 else bpy.data.scenes.new(label)
                scene.name = label + " - " + tag
                scene["max_path"] = source
                scene["interval"] = tag
                scene["source_sha256"] = row["sourceSha256"]
                scene.render.fps = meta["fps"]
                scene.unit_settings.system = "METRIC"
            bpy.context.window.scene = scene
            if is_pose:
                frame = part["tick"] / meta["ticksPerFrame"]
                if not check:
                    scene["source_key_tick"] = part["tick"]
                    if part in meta.get("outsideTimelinePoses", []):
                        scene.frame_set(0)
                    else:
                        scene.frame_set(math.floor(frame), subframe=frame % 1)
                for info in part["meshes"]:
                    path = base / "extended" / info["file"]
                    members[path.relative_to(base).as_posix()] = path
                    if check:
                        obj = next(
                            o
                            for o in scene.objects
                            if o.get("source_mesh") == path.name
                        )
                    else:
                        obj = bpy.data.objects.new(
                            info["name"], bpy.data.meshes.new(info["name"])
                        )
                        obj["source_mesh"] = path.name
                        obj.scale = (1.0 / meta["perMeter"],) * 3
                        scene.collection.objects.link(obj)
                    mesh_tables(obj.data, path, check)
                if check:
                    indexed.append(
                        {
                            "source": source,
                            "scene": scene.name,
                            "first": frame,
                            "last": frame,
                            "reference": tag,
                        }
                    )
                continue
            path = base / "extended" / part["file"]
            members[path.relative_to(base).as_posix()] = path
            if not check:
                bpy.ops.wm.alembic_import(
                    filepath=str(path),
                    as_background_job=False,
                    set_frame_range=False,
                    validate_meshes=False,
                )
                # Blender embeds static Alembic samples in the mesh and can
                # discard the now-unused cache datablock at save time.
                matches = [
                    c
                    for c in bpy.data.cache_files
                    if Path(bpy.path.abspath(c.filepath)).resolve() == path.resolve()
                ]
                if not matches:
                    bpy.ops.cachefile.open(filepath=str(path))
                    matches = [
                        c
                        for c in bpy.data.cache_files
                        if Path(bpy.path.abspath(c.filepath)).resolve()
                        == path.resolve()
                    ]
                for cache in matches:
                    cache.use_fake_user = True
                lo, hi = int(part["first"]), int(part["last"])
                scene.frame_start, scene.frame_end = max(0, lo), max(0, hi)
                scene.use_preview_range = True
                scene.frame_preview_end, scene.frame_preview_start = hi, lo
                scene.frame_set(lo)
            else:
                refs = {
                    Path(bpy.path.abspath(c.filepath)).resolve()
                    for c in bpy.data.cache_files
                }
                if path.resolve() not in refs:
                    raise ValueError(
                        "Relocated Blender cache cannot resolve: " + str(path)
                    )
            meshes = [o for o in scene.objects if o.type == "MESH"]
            keep = set()
            maximum = 0.0
            verified = 0
            for key, poses in part["samples"].items():
                scene.frame_set(int(key))
                dg = bpy.context.evaluated_depsgraph_get()
                for pose in poses:
                    if not pose["ids"]:
                        continue
                    candidates = [
                        o
                        for o in meshes
                        if len(o.data.vertices) == pose["verts"]
                        and canonical_name(o.name) == canonical_name(pose["node"])
                    ]
                    if len(candidates) != 1:
                        candidates = [
                            o for o in meshes if len(o.data.vertices) == pose["verts"]
                        ]
                    if not candidates:
                        raise ValueError(f"{source}: No mesh for {pose['node']}")
                    expected = np.array(pose["xyz"]) / meta["perMeter"]

                    def error(obj, expected=expected, pose=pose, dg=dg):
                        return float(
                            np.linalg.norm(
                                surface(obj, dg)[pose["ids"]] - expected, axis=1
                            ).max()
                        )

                    obj = min(candidates, key=error)
                    maximum = max(maximum, error(obj))
                    keep.add(obj)
                    verified += len(expected)
            if not check:
                if keep:
                    for obj in set(meshes) - keep:
                        obj.hide_set(True)
                        obj.hide_render = True
                scene.frame_set(int(part["first"]))
            else:
                indexed.append(
                    {
                        "source": source,
                        "scene": scene.name,
                        "first": part["first"],
                        "last": part["last"],
                        "reference": path.relative_to(base).as_posix(),
                    }
                )
                checks.append(
                    {
                        "source": source,
                        "segment": tag,
                        "samplePoints": verified,
                        "maxErrorMetres": maximum,
                    }
                )
    target = out / (group + ".blend")
    temp.replace(target)
    members[target.relative_to(base).as_posix()] = target
    receipt = out / (group + ".json")
    save_json(receipt, {"samples": checks, "scenes": indexed})
    members[receipt.relative_to(base).as_posix()] = receipt
    pack("Extended/" + group, members, csv_bytes(indexed))


def split_large_download(base, group, rows):
    folder = base / "packages/Extended"
    full = folder / (group + ".zip")
    limit = 100 * 1024**2
    if not full.is_file() or full.stat().st_size <= limit:
        return
    whole = base / "packages/Extended-full"
    whole.mkdir(exist_ok=True)
    full = full.replace(whole / full.name)
    with zipfile.ZipFile(full) as z:
        selections, selected, size = [], set(), 0
        for row in rows:
            meta = read_json(base / "extended" / (row["sourceSha256"] + ".json"))
            for part in source_parts(meta):
                files = (
                    [part["file"]]
                    if "file" in part
                    else [m["file"] for m in part["meshes"]]
                )
                cost = sum(z.getinfo("extended/" + f).compress_size for f in files)
                if selected and size + cost > 82 * 1024**2:
                    selections.append(selected)
                    selected, size = set(), 0
                selected.add(part_id(row, part))
                size += cost
        if selected:
            selections.append(selected)
    for i, selected in enumerate(selections, 1):
        name = f"{group}-part{i:02d}"
        make_group(base, name, rows, selected)
        if (folder / (name + ".zip")).stat().st_size > limit:
            raise ValueError("An individual motion download exceeded 100 MiB: " + name)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("groups", nargs="+")
    cli.add_argument(
        "--split-only",
        action="store_true",
        help="Split an existing oversized group ZIP",
    )
    args = cli.parse_args()
    base = WORK / "max-preservation"
    rows = read_json(base / "blend/index.json")["scenes"]
    for group in args.groups:
        chosen = [r for r in rows if r["group"].casefold() == group.casefold()]
        if not chosen:
            cli.error("Unknown group: " + group)
        name = chosen[0]["group"]
        if not args.split_only:
            make_group(base, name, chosen)
        split_large_download(base, name, chosen)
