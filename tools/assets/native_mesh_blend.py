"""Build a Blender library of Max's original triangle, corner-map and Skin paint tables."""

import argparse
import gzip
import json
from pathlib import Path

import bpy
import numpy as np
from library import WORK
from verify_native_preservation import Buffer, face_type, influence_type


def load_json(path):
    with gzip.open(path, "rt", encoding="utf8") as f:
        return json.load(f)


def attr(mesh, name, kind, domain, field, values, check):
    if check:
        data = mesh.attributes[name].data
        observed = np.empty(values.size, values.dtype)
        data.foreach_get(field, observed)
        if not np.array_equal(observed, values.ravel()):
            raise ValueError(f"Blender changed {mesh.name} / {name}")
    else:
        layer = mesh.attributes.new(name, kind, domain)
        layer.data.foreach_set(field, np.ascontiguousarray(values.ravel()))


def mesh_tables(mesh, path, check):
    table = Buffer(path)
    version, nv, nf = (table.integer() for _ in range(3))
    if version != 1:
        raise ValueError("Unknown mesh format")
    xyz = table.array("<f4", 3 * nv)
    faces = table.array(face_type, nf)
    if not check:
        mesh.vertices.add(nv)
        mesh.loops.add(nf * 3)
        mesh.polygons.add(nf)
        mesh.vertices.foreach_set("co", xyz)
        mesh.loops.foreach_set(
            "vertex_index", np.ascontiguousarray(faces["verts"].ravel())
        )
        mesh.polygons.foreach_set("loop_start", np.arange(0, nf * 3, 3, dtype=np.int32))
        mesh.update(calc_edges=True)
        mesh.normals_split_custom_set(faces["normals"].reshape(-1, 3))
    else:
        restored_xyz = np.empty(nv * 3, dtype=np.float32)
        restored_indices = np.empty(nf * 3, dtype=np.int32)
        mesh.vertices.foreach_get("co", restored_xyz)
        mesh.loops.foreach_get("vertex_index", restored_indices)
        if not np.array_equal(restored_xyz, xyz) or not np.array_equal(
            restored_indices, faces["verts"].ravel()
        ):
            raise ValueError("Blender changed source coordinates or triangle winding")
    attr(mesh, "Max material ID", "INT", "FACE", "value", faces["material"], check)
    attr(
        mesh,
        "Max smoothing bits",
        "INT",
        "FACE",
        "value",
        faces["smooth"].view("<i4"),
        check,
    )
    attr(
        mesh,
        "Max corner normal",
        "FLOAT_VECTOR",
        "CORNER",
        "vector",
        faces["normals"],
        check,
    )
    for _ in range(table.integer()):
        channel, n_values, n_faces = (table.integer() for _ in range(3))
        vectors = table.array("<f4", n_values * 3).reshape(-1, 3)
        ids = table.array("<i4", n_faces * 3)
        if not n_faces:
            continue
        if n_faces != nf:
            raise ValueError(f"Map channel {channel} has a different face table")
        values = vectors[ids]
        attr(mesh, f"Max map {channel} index", "INT", "CORNER", "value", ids, check)
        attr(
            mesh,
            f"Max map {channel} UVW",
            "FLOAT_VECTOR",
            "CORNER",
            "vector",
            values,
            check,
        )
        if 1 <= channel <= 8:
            name = f"Max UV {channel}"
            if check:
                uv = np.empty(len(ids) * 2, np.float32)
                mesh.uv_layers[name].uv.foreach_get("vector", uv)
                if not np.array_equal(uv, values[:, :2].ravel()):
                    raise ValueError("Blender changed UVs: " + name)
            else:
                uv = mesh.uv_layers.new(name=name, do_init=False)
                uv.uv.foreach_set("vector", np.ascontiguousarray(values[:, :2].ravel()))
    table.complete()


def skin_table(obj, modifier, path, check):
    table = Buffer(path)
    if table.integer() != 1 or table.integer() != len(obj.data.vertices):
        raise ValueError("Skin table vertex count differs")
    names = json.loads(obj["max_skin_group_ids"]) if check else {}
    groups = {}
    for id_, name in modifier["weightedBoneIDs"].items():
        groups[int(id_)] = (
            obj.vertex_groups[names[id_]] if check else obj.vertex_groups.new(name=name)
        )
        names[id_] = groups[int(id_)].name
    if not check:
        obj["max_skin_group_ids"] = json.dumps(names, ensure_ascii=False)
    for i, vertex in enumerate(obj.data.vertices):
        entries = table.array(influence_type, table.integer())
        if check:
            expected = {groups[int(b)].index: float(w) for b, w in entries}
            actual = {g.group: g.weight for g in vertex.groups}
            if actual != expected:
                raise ValueError(f"Blender changed Skin paint at {obj.name} vertex {i}")
        else:
            for bone, weight in entries:
                groups[int(bone)].add([i], float(weight), "REPLACE")
    table.complete()


def object_for(scene, existing, filename, title, scale):
    if existing is not None:
        return existing[filename]
    obj = bpy.data.objects.new(title, bpy.data.meshes.new(title))
    obj["max_table"] = filename
    obj.scale = (scale,) * 3
    scene.collection.objects.link(obj)
    return obj


def build(group, rows, base):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    out = base / "native-edit"
    out.mkdir(exist_ok=True)
    temp = out / (group + ".partial.blend")
    natives = {
        r["source"]: load_json(
            base / "native/scenes" / (r["sourceSha256"] + ".json.gz")
        )
        for r in rows
    }

    # Source paths identify scenes even when aliases and Blender IDs share a name.
    def process(check):
        by_source = {s.get("source_max"): s for s in bpy.data.scenes} if check else {}
        for i, row in enumerate(rows):
            source = row["source"]
            native = natives[source]
            if check:
                scene = by_source[source]
            else:
                scene = (
                    bpy.context.scene
                    if i == 0
                    else bpy.data.scenes.new(Path(row["blend"]).stem)
                )
                scene.name = Path(row["blend"]).stem
                scene.unit_settings.system = "METRIC"
                scene["source_max"] = source
                scene["source_sha256"] = row["sourceSha256"]
                scene["evaluated_max_frame"] = int(native["timing"]["first"])
            scale = 1.0 / native["units"]["perMeter"]
            objects = {o.get("max_table"): o for o in scene.objects} if check else None

            for node in native["nodes"]:
                mesh = node.get("mesh")
                obj = None
                if mesh:
                    obj = object_for(scene, objects, mesh["file"], node["name"], scale)
                    mesh_tables(
                        obj.data, base / "native/surfaces" / mesh["file"], check
                    )
                for index, mod in enumerate(
                    m for m in node["modifiers"] if "weightFile" in m
                ):
                    weighted = obj
                    if (
                        obj is None
                        or index
                        or mod["vertices"] != len(obj.data.vertices)
                    ):
                        # Vertex IDs are still meaningful below a topology-changing modifier.
                        weighted = object_for(
                            scene,
                            objects,
                            mod["weightFile"],
                            node["name"] + " - Skin vertex IDs",
                            scale,
                        )
                        if not check:
                            weighted.data.vertices.add(mod["vertices"])
                    skin_table(
                        weighted,
                        mod,
                        base / "native/surfaces" / mod["weightFile"],
                        check,
                    )

    process(False)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(temp), compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(temp), load_ui=False, use_scripts=False)
    process(True)
    temp.replace(out / (group + ".blend"))
    print(group, len(rows), "native mesh scenes reopened and compared", flush=True)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("groups", nargs="+")
    args = cli.parse_args()
    base = WORK / "max-preservation"
    index = json.loads((base / "blend/index.json").read_text(encoding="utf8"))["scenes"]
    for group in args.groups:
        selected = [r for r in index if r["group"].casefold() == group.casefold()]
        if not selected:
            cli.error("Unknown group: " + group)
        build(selected[0]["group"], selected, base)
