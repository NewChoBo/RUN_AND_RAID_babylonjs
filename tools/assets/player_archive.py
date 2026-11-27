"""Build one editable Blender library per Player group or export its scenes to the project."""

import argparse
import csv
import json
import struct
from pathlib import Path

import bpy
from convert import fbx_for, stamp
from asset_names import library_file
from library import INDEX, PUBLIC, RECORDS, SOURCE, WORK, publish, read_json, save_json
from materials import choose_texture, diffuse
from prepare_blend import frame_body

OUTPUT = WORK / "player-release"


def pack_materials(scene, item, textures, shared):
    exact = {Path(t["path"]).name.casefold(): t for t in textures}
    diffuse_maps = [t for t in textures if diffuse(t)]
    missing = set()
    matches = {}
    materials = {
        m
        for obj in scene.objects
        if obj.type == "MESH"
        for m in obj.data.materials
        if m and m.node_tree
    }
    for mat in materials:
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE" or not node.image or node.image.packed_file:
                continue
            image = node.image
            filename = Path(image.filepath.replace("\\", "/")).name
            candidate = exact.get(filename.casefold()) or shared.get(filename.casefold())
            reason = "filename"
            if not candidate and any(
                link.to_socket.name == "Base Color" for link in node.outputs["Color"].links
            ):
                candidate, reason = choose_texture({"name": mat.name}, item, diffuse_maps)
            if candidate:
                replacement = bpy.data.images.load(
                    str(SOURCE / candidate["path"]), check_existing=True
                )
                if not replacement.packed_file:
                    replacement.pack()
                node.image = replacement
                matches[filename] = reason + " / " + candidate["path"]
            elif Path(bpy.path.abspath(image.filepath)).is_file():
                image.pack()
            else:
                missing.add(filename)
    scene["missing_images"] = json.dumps(sorted(missing), ensure_ascii=False)
    scene["texture_matches"] = json.dumps(matches, ensure_ascii=False)


def build_blend(items, textures, timeline, output, shared):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    model = None
    for i, item in enumerate(items):
        if i:
            bpy.ops.scene.new(type="EMPTY")
        scene = bpy.context.scene
        relative = Path(item["path"])
        scene.name = relative.relative_to(item["group"]).with_suffix("").as_posix()
        scene["source_max"] = item["path"]
        meta = timeline[item["path"]]
        bpy.ops.wm.fbx_import(filepath=str(fbx_for(item)), anim_offset=0.0)
        scene.render.fps = meta["fps"]
        scene.frame_start, scene.frame_end = meta["start"], meta["end"]
        scene.frame_set(scene.frame_start)
        pack_materials(scene, item, textures, shared)
        if (
            item["kind"] == "scene"
            and any(o.type == "MESH" and len(o.data.polygons) for o in scene.objects)
            and (model is None or relative.stem.lower().endswith("#default"))
        ):
            model = scene
    if model:
        bpy.context.window.scene = model
        frame_body(model)
        for area in bpy.context.screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.overlay.show_overlays = False
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".partial.blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(temporary), compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(temporary))
    if {s["source_max"] for s in bpy.data.scenes} != {i["path"] for i in items}:
        raise ValueError("Saved Blender scene list differs from source manifest")
    temporary.replace(output)


def export_scenes(items, blend, archive):
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    scenes = {s["source_max"]: s for s in bpy.data.scenes}
    for item in items:
        scene = scenes[item["path"]]
        bpy.context.window.scene = scene
        scene.frame_set(scene.frame_start)
        # Preserve missing source references in the editable file; omit unavailable images from GLB.
        for ob in scene.objects:
            if ob.type == "MESH":
                for mat in ob.data.materials:
                    if mat and mat.node_tree:
                        for node in mat.node_tree.nodes:
                            if (
                                node.type == "TEX_IMAGE"
                                and node.image
                                and not node.image.packed_file
                                and not Path(bpy.path.abspath(node.image.filepath)).is_file()
                            ):
                                node.image = None
        file = library_file(item, "model")
        dest = PUBLIC / file
        dest.parent.mkdir(parents=True, exist_ok=True)
        temp = dest.with_suffix(".partial.glb")
        bpy.ops.export_scene.gltf(
            filepath=str(temp),
            export_format="GLB",
            use_active_scene=True,
            export_animation_mode="ACTIVE_ACTIONS",
            export_frame_range=True,
            export_cameras=False,
            export_lights=False,
        )
        with temp.open("rb") as stream:
            magic, version, length, size, kind = struct.unpack("<4sIII4s", stream.read(20))
            if (magic, version, length, kind) != (b"glTF", 2, temp.stat().st_size, b"JSON"):
                raise ValueError(item["path"])
            doc = json.loads(stream.read(size))
        if not doc.get("nodes") or len(doc.get("scenes", [])) != 1:
            raise ValueError("Expected one populated GLB scene for " + item["path"])
        meshes = len(doc.get("meshes", []))
        skins = len(doc.get("skins", []))
        clips = [a["name"] for a in doc.get("animations", [])]
        temp.replace(dest)
        state = ("animated" if skins and clips else "static") if meshes else "rig"
        record = {
            "archive": archive,
            "recipe": stamp(item, archive),
            "state": state,
            "model": file,
            "meshes": meshes,
            "skins": skins,
            "clips": clips,
            "embeddedImages": len(doc.get("images", [])),
            "missingBitmaps": json.loads(scene["missing_images"]),
            "materialMatches": json.loads(scene["texture_matches"]),
        }
        save_json(RECORDS / (item["id"] + ".json"), record)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["blend", "glb"])
    parser.add_argument("--group")
    parser.add_argument("--timeline", type=Path, default=WORK / "max2027/export.jsonl")
    args = parser.parse_args()
    manifest = read_json(INDEX)
    shared = {}
    for row in manifest["files"]:
        if row["kind"] == "texture":
            key = Path(row["path"]).name.casefold()
            if key not in shared:
                shared[key] = row
            elif shared[key] and shared[key]["sha256"] != row["sha256"]:
                shared[key] = None
    timeline = {}
    if args.stage == "blend":
        if args.timeline.suffix.lower() == ".csv":
            with args.timeline.open(encoding="utf-8-sig", newline="") as stream:
                for row in csv.DictReader(stream):
                    key = row.get("원본 MAX 경로") or Path(row["FBX 상대경로"]).with_suffix(".max").as_posix()
                    timeline[key] = {
                        "start": int(row["원본 시작 프레임"]),
                        "end": int(row["원본 끝 프레임"]),
                        "fps": int(row["원본 FPS"]),
                    }
        else:
            timeline = {
                r["source"]: r
                for r in map(json.loads, args.timeline.read_text("utf8").splitlines())
            }
    groups = sorted({r["group"] for r in manifest["files"]})
    if args.group:
        groups = [g for g in groups if g.casefold() == args.group.casefold()]
        if not groups:
            parser.error("Unknown Player group")
    for group in groups:
        rows = [r for r in manifest["files"] if r["group"] == group]
        items = [r for r in rows if r["kind"] in {"scene", "motion"}]
        blend = OUTPUT / "Blender" / (group + ".blend")
        if args.stage == "blend":
            if blend.exists():
                raise FileExistsError(f"Preserving existing Blender work: {blend}")
            build_blend(items, [r for r in rows if r["kind"] == "texture"], timeline, blend, shared)
        else:
            export_scenes(items, blend, manifest["sha256"])
        print(args.stage, group, len(items), flush=True)
    if args.stage == "glb":
        publish()


if __name__ == "__main__":
    main()
