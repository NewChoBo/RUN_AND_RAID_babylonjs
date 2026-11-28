"""Save one independently editable Blender file for every archived Player MAX scene."""

import argparse
import hashlib
import json
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from asset_names import fbx_path
from convert import fbx_for
from library import INDEX, ROOT, SOURCE, WORK, read_json, save_json


def plan(output):
    from gzip import open as open_gzip

    rows = []
    groups = {}
    manifest = read_json(INDEX)
    for item in manifest["files"]:
        if item["kind"] not in {"scene", "motion"}:
            continue
        group = item["group"]
        if group not in groups:
            with open_gzip(
                WORK / "player-release/Reference" / (group.lower() + ".json.gz"),
                "rt",
                encoding="utf8",
            ) as stream:
                groups[group] = json.load(stream)
        key = item["path"]
        native = groups[group][key.lower()]
        timing = native["timing"]
        first, last = (
            divmod(timing[name], timing["ticksPerFrame"])
            for name in ("startTick", "endTick")
        )
        if first[1] or last[1]:
            raise ValueError("Source has a subframe scene boundary: " + key)
        destination = output / fbx_path(item).with_suffix(".blend")
        if destination.is_relative_to(ROOT):
            destination = destination.relative_to(ROOT)
        rows.append(
            {
                "source": key,
                "sourceSha256": item["sha256"],
                "group": group,
                "kind": item["kind"],
                "groupLibrary": (WORK / "player-release/Blender" / (group + ".blend"))
                .relative_to(ROOT)
                .as_posix(),
                "fbx": fbx_for(item).relative_to(ROOT).as_posix(),
                "blend": destination.as_posix(),
                "start": first[0],
                "end": last[0],
                "fps": timing["fps"],
                "timing": timing,
            }
        )
    if len({r["blend"].lower() for r in rows}) != len(rows):
        raise ValueError("Two sources resolve to the same output name")
    save_json(
        output / "index.json", {"archiveSha256": manifest["sha256"], "scenes": rows}
    )
    return rows


def finish(output, groups=None):
    manifest = read_json(output / "index.json")
    selected = {group.casefold() for group in groups or []}
    count = 0
    for row in manifest["scenes"]:
        if selected and row["group"].casefold() not in selected:
            continue
        count += 1
        key = hashlib.sha256(row["source"].encode()).hexdigest()[:24]
        receipt = read_json(output.parent / "port-records" / (key + ".json"))
        if (
            receipt["source"] != row["source"]
            or receipt["frames"] != row["end"] - row["start"] + 1
            or not receipt.get("referenceDisplay")
            or "packedReferenceImages" not in receipt
        ):
            raise ValueError("Incomplete scene audit: " + row["source"])
        blend = ROOT / row["blend"]
        row["bundleBlend"] = blend.relative_to(output.parent).as_posix()
        row["bundleCache"] = receipt["cache"]
        cache = output.parent / row["bundleCache"]
        cache_meta = read_json(cache.with_suffix(".json"))
        if (
            cache_meta["sourceSha256"] != row["sourceSha256"]
            or cache.stat().st_size != cache_meta["bytes"]
        ):
            raise ValueError("Native cache does not match the source: " + row["source"])
        row["cacheSha256"] = cache_meta["sha256"]
        with blend.open("rb") as stream:
            row["blendSha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        row["blendBytes"] = blend.stat().st_size
        row["restoredBones"] = receipt["restoredBones"]
        row["correctiveShapeKeys"] = receipt.get("correctiveShapeKeys", {})
        row["packedReferenceImages"] = receipt.get("packedReferenceImages", [])
        row["restoredFaces"] = receipt.get("restoredFaces", {})
        row["restoredNativePaint"] = receipt.get("restoredNativePaint", {})
        row["unmatchedMeshes"] = receipt["unmatched"]
        row["maxResidualMeshDiagonalFraction"] = max(
            (v[0] for v in receipt["after"].values()), default=None
        )
    save_json(output / "index.json", manifest)
    print("Indexed", count, "editable scenes and relative native caches")


@lru_cache(maxsize=1)
def source_images():
    files = read_json(INDEX)["files"]
    textures = defaultdict(list)
    for item in files:
        if item["kind"] == "texture":
            textures[Path(item["path"]).name.casefold()].append(item)
    return {item["path"]: item for item in files}, textures


def pack_referenced_images(row):
    """Retain archived Max bitmap references even when no material slot owns the image."""
    import bpy

    by_path, textures = source_images()
    packed = {
        hashlib.sha256(image.packed_file.data).hexdigest()
        for image in bpy.data.images
        if image.packed_file
    }
    extra = []
    for reference in by_path[row["source"]].get("bitmaps", []):
        candidates = textures[Path(reference.replace("\\", "/")).name.casefold()]
        same_group = [entry for entry in candidates if entry["group"] == row["group"]]
        choices = same_group or candidates
        if not choices or len({entry["sha256"] for entry in choices}) != 1:
            continue
        asset = choices[0]
        if asset["sha256"] in packed:
            continue
        image = bpy.data.images.load(str(SOURCE / asset["path"]), check_existing=False)
        image.pack()
        if hashlib.sha256(image.packed_file.data).hexdigest() != asset["sha256"]:
            raise ValueError("Packed image differs from original TGA: " + asset["path"])
        image.use_fake_user = True
        image["source_max_bitmap_path"] = asset["path"]
        packed.add(asset["sha256"])
        extra.append(asset["path"])
    if extra:
        bpy.context.scene["packed_reference_images"] = json.dumps(
            extra, ensure_ascii=False
        )
    return extra


def separate_bone_geometry(scene, matched):
    """Max also emits skinned-rig display shapes as meshes; expose them as optional helpers."""
    editable = scene.view_layers["Editable rig"]
    bone_names = {
        bone.name.casefold()
        for rig in editable.objects
        if rig.type == "ARMATURE"
        for bone in rig.data.bones
    }
    reference = scene.collection.children["MAX evaluated"]
    helpers = reference.children["MAX rig display geometry"]
    moved = False
    for obj in list(reference.objects):
        name = re.sub(r"\.\d{3,}$", "", obj.name).casefold()
        # The Max Alembic exporter appends _ID<handle> to duplicate node names.
        bone_name = re.sub(r"_id\d+$", "", name)
        if obj.type == "MESH" and obj.name not in matched and bone_name in bone_names:
            helpers.objects.link(obj)
            reference.objects.unlink(obj)
            moved = True
    return moved


def update_images(rows, output, force=False):
    import bpy

    for row in rows:
        key = hashlib.sha256(row["source"].encode()).hexdigest()[:24]
        record = output.parent / "port-records" / (key + ".json")
        if not record.is_file():
            continue
        receipt = read_json(record)
        if (
            "packedReferenceImages" in receipt
            and receipt.get("referenceDisplay")
            and not force
        ):
            continue
        path = ROOT / row["blend"]
        bpy.ops.wm.open_mainfile(filepath=str(path), use_scripts=False)
        added = (
            pack_referenced_images(row)
            if "packedReferenceImages" not in receipt
            else []
        )
        moved = separate_bone_geometry(
            bpy.context.scene, set(receipt["topologyPairs"].values())
        )
        if added or moved:
            temporary = path.with_suffix(".images.blend")
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(temporary), compress=True)
            bpy.ops.wm.open_mainfile(filepath=str(temporary), use_scripts=False)
            found = {
                img.get("source_max_bitmap_path")
                for img in bpy.data.images
                if img.packed_file
            }
            if not set(added) <= found:
                raise ValueError("Referenced images did not persist: " + row["source"])
            temporary.replace(path)
        receipt["packedReferenceImages"] = sorted(
            set(receipt.get("packedReferenceImages", [])) | set(added)
        )
        receipt["referenceDisplay"] = True
        save_json(record, receipt)


def save_editable_scene(scene, row, destination):
    import bpy

    source = row["source"]
    if (
        hashlib.sha256((SOURCE / source).read_bytes()).hexdigest()
        != row["sourceSha256"]
    ):
        raise ValueError("Local MAX differs from source archive: " + source)
    if (
        scene.frame_start,
        scene.frame_end,
        scene.render.fps / scene.render.fps_base,
    ) != (max(row["start"], 0), row["end"], row["fps"]):
        raise ValueError("Scene timing mismatch: " + source)
    if row["start"] < 0:
        # Blender's render start is clamped at zero. Its preview range and
        # existing animation keys support the original negative preroll.
        scene.use_preview_range = True
        scene.frame_preview_end = row["end"]
        scene.frame_preview_start = row["start"]
        scene.frame_set(row["start"])
        if scene.frame_preview_start != row["start"]:
            raise ValueError("Unable to restore negative preroll: " + source)
    scene["source_max_sha256"] = row["sourceSha256"]
    scene["source_max_timing"] = json.dumps(row["timing"], ensure_ascii=False)
    destination.parent.mkdir(exist_ok=True, parents=True)
    # The scene is the root of the dependency graph: armatures, actions, image
    # datablocks (including packed byte streams), materials and helpers travel with it.
    bpy.data.libraries.write(
        str(destination), {scene}, path_remap="RELATIVE_ALL", compress=True
    )


def split_group(rows, output):
    import bpy

    bpy.ops.wm.open_mainfile(filepath=str(ROOT / rows[0]["groupLibrary"]))
    scenes = {scene.get("source_max"): scene for scene in bpy.data.scenes}
    if set(scenes) != {r["source"] for r in rows}:
        raise ValueError("Editable group does not cover the original manifest")
    for row in rows:
        dest = ROOT / row["blend"]
        temporary = dest.with_suffix(".partial.blend")
        save_editable_scene(scenes[row["source"]], row, temporary)
        temporary.replace(dest)
        key = hashlib.sha256(row["source"].encode()).hexdigest()[:24]
        (output.parent / "port-records" / (key + ".json")).unlink(missing_ok=True)
    print("Wrote", len(rows), "scenes for", rows[0]["group"], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("plan", "split", "images", "finish"))
    parser.add_argument("--output", type=Path, default=WORK / "max-preservation/blend")
    parser.add_argument("--groups", nargs="+")
    parser.add_argument(
        "--force", action="store_true", help="Replace existing generated Blender files"
    )
    args = parser.parse_args()
    output = args.output.resolve()
    if args.stage == "plan":
        print(len(plan(output)), "MAX scenes mapped")
        return
    if args.stage == "finish":
        finish(output, args.groups)
        return
    rows = read_json(output / "index.json")["scenes"]
    selected = (
        {name.lower() for name in args.groups}
        if args.groups
        else {r["group"].lower() for r in rows}
    )
    for group in sorted(selected):
        scene_rows = [r for r in rows if r["group"].lower() == group]
        if not scene_rows:
            parser.error("Unknown Player group " + group)
        if args.stage == "images":
            update_images(scene_rows, output, args.force)
        else:
            if not args.force and any((ROOT / r["blend"]).exists() for r in scene_rows):
                parser.error(
                    f"{group} already contains generated files; choose another output or use --force"
                )
            split_group(scene_rows, output)


if __name__ == "__main__":
    main()
