"""Create an editable Blender file from a Player body and optional motion scenes."""
import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector

from activate import CLIPS
from convert import ensure_importer, fbx_for
from library import IMPORTER, INDEX, SOURCE, WORK, read_json


def import_scene(item):
    original = SOURCE / item["path"]
    baked = fbx_for(item)
    if baked.is_file():
        bpy.ops.wm.fbx_import(filepath=str(baked))
        return baked
    bpy.ops.import_scene.max(
        filepath=str(original), directory=str(original.parent), files=[{"name": original.name}],
        object_filter={"MATERIAL", "UV", "ARMATURE", "EMPTY"}, use_image_search=True,
    )
    return original


def describe(scene):
    meshes = [o for o in scene.objects if o.type == "MESH"]
    weighted = sum(1 for o in meshes for v in o.data.vertices if any(g.weight > 0 for g in v.groups))
    return (f"Mesh {len(meshes)}, Armature {sum(o.type == 'ARMATURE' for o in scene.objects)}, "
            f"Empty {sum(o.type == 'EMPTY' for o in scene.objects)}, 가중치가 있는 정점 {weighted}")


def frame_body(scene):
    meshes = [ob for ob in scene.objects if ob.type == "MESH" and len(ob.data.polygons)]
    if not meshes:
        raise ValueError("No editable body mesh in " + scene.name)
    points = [ob.matrix_world @ Vector(corner) for ob in meshes for corner in ob.bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            view = area.spaces.active
            view.region_3d.view_location = (low + high) / 2
            view.region_3d.view_distance = max((high - low).length, 0.1) * 1.4
            view.shading.color_type = "TEXTURE"
            view.overlay.show_extras = False
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hero", help="Player source folder, e.g. hammer")
    parser.add_argument("--body", help="Body MAX path relative to the hero folder")
    parser.add_argument("--motion", action="append", default=[],
                        help="Motion MAX path relative to the hero folder; repeat for more scenes")
    parser.add_argument("--output", type=Path, help="New .blend file (default .asset-work/blender/<hero>.blend)")
    args = parser.parse_args()
    if not bpy.app.background:
        parser.error("Run in a fresh background Blender Python process.")
    sources = [item for item in read_json(INDEX)["files"] if item["group"].casefold() == args.hero.casefold()]
    if not sources:
        parser.error("Unknown hero folder. Run prepare.py on the Player ZIP first.")
    group = sources[0]["group"]
    scenes = {Path(item["path"]).relative_to(group).as_posix().casefold(): item
              for item in sources if item["kind"] in {"scene", "motion"}}
    inputs = []
    for name in [args.body or group + "#default.max", *args.motion]:
        item = scenes.get(Path(name).as_posix().casefold())
        if item is None:
            parser.error(f"Source not found in {group}: {name}")
        inputs.append(item)
    output = (args.output or WORK / "blender" / (group + ".blend")).resolve()
    if output.suffix.lower() != ".blend" or output.exists():
        parser.error("Choose a new .blend output path to preserve existing artist edits.")
    if any(not fbx_for(item).is_file() for item in inputs):
        ensure_importer()
        sys.path.insert(0, str(IMPORTER))
        from source import register
        register()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    body = bpy.context.scene
    notes = [f"{group} · Blender 애니메이션 포팅", ""]
    for index, item in enumerate(inputs):
        if index:
            bpy.ops.scene.new(type="EMPTY")
        scene = bpy.context.scene
        scene.name = ("Reference · " if index else "Model · ") + Path(item["path"]).stem
        existing_actions = set(bpy.data.actions)
        imported = import_scene(item)
        scene["source_max"] = item["path"]
        actions = sorted(a.name for a in set(bpy.data.actions) - existing_actions)
        notes.extend([scene.name, f"원본: {item['path']}", f"가져온 파일: {imported.name}",
                      describe(scene), "가져온 Action: " + (", ".join(actions) or "0"), ""])
    bpy.context.window.scene = body
    frame_body(body)
    notes.extend(["런타임 클립 이름: " + ", ".join(sorted(CLIPS)),
                  "Model 장면에서 리깅과 Action을 편집합니다. Reference 장면은 모션 소스 비교용입니다.",
                  "원작 키가 필요한 경우 같은 MAX 장면을 스킨·애니메이션을 포함한 FBX로 베이크합니다.",
                  "게임에 내보낼 때 Model 장면만 GLB로 내보낸 뒤 activate.py로 검사합니다.", "",
                  "원본 모션 목록"])
    notes.extend(sorted(item["path"] for item in sources if item["kind"] == "motion"))
    missing_images = set()
    for image in bpy.data.images:
        if image.source != "FILE" or image.packed_file:
            continue
        path = Path(bpy.path.abspath(image.filepath))
        if path.is_file():
            image.pack()
        else:
            missing_images.add(str(path))
    if missing_images:
        notes.extend(["", "원본 경로에서 찾을 수 없는 텍스처", *sorted(missing_images)])
    bpy.data.texts.new("PORTING.txt").write("\n".join(notes) + "\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print(output)


if __name__ == "__main__":
    main()
