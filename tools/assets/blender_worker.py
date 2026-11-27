"""A fresh Blender process handles a bounded batch to release native/importer state."""
import sys
from pathlib import Path
import bpy
from PIL import Image
from convert import fbx_for, stamp
from library import INDEX, IMPORTER, PUBLIC, RECORDS, SOURCE, WORK, read_json, save_json

sys.path.insert(0, str(IMPORTER))
from source import register
register()


def bind_textures(meshes, item, textures):
    candidates = {Path(r["path"]).name.casefold(): r for r in textures if r["group"] == item["group"]}
    available = {}
    for name in item.get("bitmaps", []):
        if name.casefold() in candidates:
            available[name.casefold()] = candidates[name.casefold()]
    materials = {m for ob in meshes for m in ob.data.materials if m and m.node_tree}
    bound = set()
    for material in materials:
        for node in material.node_tree.nodes:
            if node.type != "TEX_IMAGE" or not node.image:
                continue
            im = node.image
            name = Path(bpy.path.abspath(im.filepath).replace("\\", "/")).name.casefold()
            candidate = candidates.get(name) or candidates.get(im.name.casefold())
            if not candidate:
                continue
            src = PUBLIC / candidate["texture"]
            has_alpha = any(link.from_node == node and link.from_socket.name == "Alpha" for link in material.node_tree.links)
            # Original diffuse atlases often store a mask in alpha. Sampling premultiplied
            # RGB makes an opaque face black. Keep RGBA for real opacity connections.
            is_color = any(link.from_node == node and link.to_socket.name == "Base Color" for link in material.node_tree.links)
            if is_color and not has_alpha:
                rgb = WORK / "rgb" / src.name
                rgb.parent.mkdir(exist_ok=True)
                with Image.open(src) as original:
                    original.convert("RGB").save(rgb)
                src = rgb
            space = im.colorspace_settings.name
            node.image = bpy.data.images.load(str(src), check_existing=True)
            node.image.colorspace_settings.name = space
            bound.add(candidate["id"])
    missing = [n for n in item.get("bitmaps", []) if n.casefold() not in available]
    return sorted(bound), missing


def convert(item, textures):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = SOURCE / item["path"]
    baked = fbx_for(item)
    if baked.exists():
        bpy.ops.import_scene.fbx(filepath=str(baked))
    else:
        bpy.ops.import_scene.max(filepath=str(src), directory=str(src.parent), files=[{"name": src.name}],
                                 object_filter={"MATERIAL", "UV", "ARMATURE", "EMPTY"}, use_image_search=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.polygons)]
    if not meshes:
        # The importer exposes Biped bones as empties. Preserve only the verified
        # hierarchy, because these transforms cannot reproduce the original bind pose.
        if not baked.exists():
            # Unsupported Max Point/IK helpers never become Blender objects. Read their
            # source names and parent links from the importer's decoded scene graph.
            from source import import_max as reader
            records = []
            for node in reader.SCENE_LIST[0].children:
                parent = reader.get_node_parent(node)
                is_scene_node = (isinstance(node, reader.SceneChunk)
                                 and reader.get_guid(node) == 1 and reader.get_super_id(node) == 1)
                if is_scene_node or parent:
                    records.append((node, parent))
            names = {id(node): reader.get_node_name(node) for node, _ in records}
            nodes = [{"name": names[id(node)], "parent": names.get(id(parent))}
                     for node, parent in records]
        else:
            nodes = [{"name": ob.name, "parent": ob.parent.name if ob.parent else None}
                     for ob in bpy.context.scene.objects if ob.type in ("EMPTY", "ARMATURE")]
        if nodes and any(node["parent"] for node in nodes):
            hierarchy = "rigs/" + item["id"] + ".json"
            save_json(PUBLIC / hierarchy, {"source": item["path"], "nodes": nodes})
            return dict(state="hierarchy", hierarchy=hierarchy, nodes=len(nodes))
        return dict(state="source-only", detail="No editable mesh or named hierarchy was imported")
    if not baked.exists():
        for obj in meshes:
            matrix = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = matrix
        for obj in list(bpy.context.scene.objects):
            if obj not in meshes:
                bpy.data.objects.remove(obj, do_unlink=True)
    bound, missing = bind_textures(meshes, item, textures) if not baked.exists() else ([], [])
    folder = PUBLIC / "models"
    folder.mkdir(exist_ok=True)
    path = folder / (item["id"] + ".glb")
    temporary = folder / (item["id"] + ".part.glb")
    bpy.ops.export_scene.gltf(filepath=str(temporary), export_format="GLB", export_animations=baked.exists(),
                              export_cameras=False, export_lights=False)
    import json
    import struct
    with temporary.open("rb") as f:
        header = f.read(20)
        if header[:4] != b"glTF":
            raise ValueError("Invalid GLB")
        doc = json.loads(f.read(struct.unpack_from("<I", header, 12)[0]))
    if not doc.get("meshes"):
        raise ValueError("Export contains no meshes")
    temporary.replace(path)
    skins = len(doc.get("skins", []))
    clips = [a.get("name", "") for a in doc.get("animations", [])]
    return dict(state="animated" if skins and clips else "static", model="models/" + path.name,
                meshes=len(doc["meshes"]), skins=skins, clips=clips, boundTextures=bound,
                embeddedImages=len(doc.get("images", [])), missingBitmaps=missing)


if __name__ == "__main__":
    manifest = read_json(INDEX)
    files = {r["id"]: r for r in manifest["files"]}
    textures = [r for r in files.values() if r["kind"] == "texture"]
    for key in sys.argv[1:]:
        item = files[key]
        try:
            result = convert(item, textures)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            result = dict(state="failed", detail=type(exc).__name__ + ": " + str(exc)[:180])
        save_json(RECORDS / (key + ".json"), dict(archive=manifest["sha256"], recipe=stamp(item, manifest["sha256"]), **result))
