"""Restore proven missing native Max triangles to the existing rigged Blender working files."""

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict

import bpy
import numpy as np
from library import ROOT, WORK, read_json, save_json
from native_mesh_blend import load_json
from port_max_faces import oriented, tangent_frame
from verify_max_scenes import packed_values
from verify_max_scenes_corners import boundary
from verify_native_preservation import Buffer, face_type


def rotate_key(ids):
    ids = tuple(map(int, ids))
    return min(ids[i:] + ids[:i] for i in range(len(ids)))


def read_native(path):
    buf = Buffer(path)
    version, nv, nf = (buf.integer() for _ in range(3))
    if version != 1:
        raise ValueError("Unknown native triangle format")
    xyz = buf.array("<f4", nv * 3).reshape(-1, 3)
    triangles = buf.array(face_type, nf)
    maps = {}
    for _ in range(buf.integer()):
        idx, count, faces = (buf.integer() for _ in range(3))
        uv = buf.array("<f4", count * 3).reshape(-1, 3)
        ids = buf.array("<i4", faces * 3).reshape(-1, 3)
        if faces:
            maps[idx] = uv[ids]
    buf.complete()
    return xyz, triangles, maps


def missing_cage_faces(mesh, path):
    buf = Buffer(path)
    version, nv, ne, nf = (buf.integer() for _ in range(4))
    if version != 1 or nv != len(mesh.vertices):
        raise ValueError("Native cage vertex IDs differ")
    buf.array("u1", nv * 16 + ne * 12)
    source = set()
    for _ in range(nf):
        degree = buf.integer()
        if degree >= 0:
            source.add(rotate_key(buf.array("<i4", degree)))
        buf.array("<i4", 3)
    existing = {oriented(f) for f in mesh.polygons}
    if (
        not existing <= source
        or len(source) != nf
        or len(existing) != len(mesh.polygons)
    ):
        raise ValueError(
            "Retriangulation cannot be resolved uniquely from editable polygons"
        )
    return source - existing


def old_structure(obj, nloops, nfaces):
    mesh = obj.data
    digest = hashlib.sha256()

    def put(a):
        digest.update(np.ascontiguousarray(a).tobytes())

    put(packed_values(mesh.vertices, "co", 3))
    put(packed_values(mesh.loops, "vertex_index", 1, np.int32)[:nloops])
    put(packed_values(mesh.polygons, "material_index", 1, np.int32)[:nfaces])
    put(packed_values(mesh.polygons, "loop_start", 1, np.int32)[:nfaces])
    for layer in mesh.uv_layers:
        put(packed_values(layer.uv, "vector", 2)[: nloops * 2])
    for layer in mesh.color_attributes:
        if layer.domain == "CORNER":
            put(packed_values(layer.data, "color", 4)[: nloops * 4])
    if mesh.shape_keys:
        for key in mesh.shape_keys.key_blocks:
            digest.update(key.name.encode())
            put(packed_values(key.points, "co", 3))
    for v in mesh.vertices:
        for group in v.groups:
            put(np.array([group.group, group.weight], np.float64))
    return digest.hexdigest()


def restore(obj, node, base, sha):
    mesh = obj.data
    if mesh.users > 1:
        mesh = mesh.copy()
        obj.data = mesh
    xyz, faces, maps = read_native(base / "native/surfaces" / node["mesh"]["file"])
    mesh.calc_loop_triangles()
    raw = {rotate_key(f): i for i, f in enumerate(faces["verts"])}
    present = {rotate_key(t.vertices): t for t in mesh.loop_triangles}
    if (
        len(raw) != len(faces)
        or len(present) != len(mesh.loop_triangles)
        or len(mesh.vertices) != len(xyz)
    ):
        raise ValueError("Triangle or vertex correspondence is ambiguous")
    chosen = raw.keys() - present.keys()
    extra = present.keys() - raw.keys()
    if extra:
        proven = missing_cage_faces(
            mesh, base / "native/envelopes" / f"{sha}-{node['handle']}.poly.gz"
        )
        if not proven <= chosen or boundary(Counter(chosen - proven)) != boundary(
            Counter(extra)
        ):
            raise ValueError(
                "Native polygon boundaries do not prove the missing triangles"
            )
        chosen = proven
    if len(chosen) != len(faces) - len(mesh.loop_triangles) or not chosen:
        raise ValueError(
            "Missing native triangles do not account for the surface difference"
        )
    ids = sorted(raw[k] for k in chosen)
    source_ids, old_loops = [], []
    material = defaultdict(set)
    for k in raw.keys() & present.keys():
        i = raw[k]
        t = present[k]
        by_vid = dict(zip(t.vertices, t.loops, strict=True))
        source_ids.append(i)
        old_loops.append([by_vid[v] for v in faces[i]["verts"]])
        material[int(faces[i]["material"])].add(
            mesh.polygons[t.polygon_index].material_index
        )
    if any(len(material[int(faces[i]["material"])]) != 1 for i in ids):
        raise ValueError("Cannot match native material slot uniquely")
    source_ids = np.asarray(source_ids)
    old_loops = np.asarray(old_loops)
    uv_channels = {}
    for index, layer in enumerate(mesh.uv_layers, 1):
        m = re.search(r"(\d+)$", layer.name)
        channel = int(m[1]) if m else index
        old_uv = packed_values(layer.uv, "vector", 2).reshape(-1, 2)[old_loops]
        if (
            channel not in maps
            or np.max(np.abs(old_uv - maps[channel][source_ids, :, :2])) > 1e-5
        ):
            raise ValueError(
                "Existing UV does not match native channel " + str(channel)
            )
        uv_channels[layer.name] = channel
    colors = {}
    for layer in mesh.color_attributes:
        if layer.domain != "CORNER":
            continue
        if 0 not in maps:
            raise ValueError("No native vertex color table")
        native = maps[0][source_ids]
        match = []
        for prop in ("color", "color_srgb"):
            old = packed_values(layer.data, prop, 4).reshape(-1, 4)[old_loops]
            match.append(
                (float(np.max(np.abs(old[:, :, :3] - native))), prop, old[:, :, 3])
            )
        diff, prop, alpha = min(match, key=lambda x: x[0])
        if diff > 1 / 255 + 1e-5 or np.any(np.abs(alpha - 1) > 1e-6):
            raise ValueError("Unmatched native color encoding or independent alpha")
        colors[layer.name] = prop
    before_loops, before_faces = len(mesh.loops), len(mesh.polygons)
    old_hash = old_structure(obj, before_loops, before_faces)
    normals = packed_values(mesh.corner_normals, "vector", 3).reshape(-1, 3)
    add_normals = []
    for i in ids:
        f = faces[i]
        posed = tangent_frame(xyz[f["verts"]].astype(np.float64))
        rest = tangent_frame(np.array([mesh.vertices[v].co[:] for v in f["verts"]]))
        if posed is None or rest is None:
            raise ValueError("Missing triangle has undefined normal frame")
        add_normals.extend((rest @ posed.T @ f["normals"].T).T.tolist())
    starts = [p.loop_start for p in mesh.polygons] + [
        before_loops + 3 * k for k in range(len(ids))
    ]
    corners = [c.vertex_index for c in mesh.loops] + faces["verts"][
        ids
    ].ravel().tolist()
    mesh.loops.add(3 * len(ids))
    mesh.polygons.add(len(ids))
    mesh.polygons.foreach_set("loop_start", starts)
    mesh.loops.foreach_set("vertex_index", corners)
    mesh.update(calc_edges=True, calc_edges_loose=True)
    for position, i in enumerate(ids, before_faces):
        poly = mesh.polygons[position]
        poly.material_index = next(iter(material[int(faces[i]["material"])]))
        poly.use_smooth = bool(faces[i]["smooth"])
        for rel, loop in enumerate(poly.loop_indices):
            for name, cid in uv_channels.items():
                mesh.uv_layers[name].uv[loop].vector = maps[cid][i, rel, :2]
            for name, prop in colors.items():
                setattr(
                    mesh.color_attributes[name].data[loop],
                    prop,
                    (*maps[0][i, rel], 1.0),
                )
    mesh.normals_split_custom_set([*normals.tolist(), *add_normals])
    mesh.update()
    if old_structure(obj, before_loops, before_faces) != old_hash:
        raise ValueError(
            "Restoration changed existing editable geometry, paint or UV data"
        )
    after = packed_values(mesh.corner_normals, "vector", 3).reshape(-1, 3)[
        :before_loops
    ]
    drift = float(np.max(np.linalg.norm(after - normals, axis=1)))
    if drift > 0.001:
        raise ValueError("Existing shading changed with added faces")
    return {
        "sourceTriangles": ids,
        "beforeLoops": before_loops,
        "beforeFaces": before_faces,
        "oldGeometrySha256": old_hash,
        "oldNormalMaxDrift": drift,
        "UVChannels": uv_channels,
        "colors": colors,
    }


def native_node(nodes, obj, name):
    matches = [
        n
        for n in nodes
        if n["name"] == name
        and n.get("mesh")
        and n["mesh"]["vertices"] == len(obj.data.vertices)
    ]
    if len(matches) != 1:
        raise ValueError(
            "Cannot uniquely identify native source surface for " + obj.name
        )
    return matches[0]


def patch(row, audit, base):
    key = hashlib.sha256(row["source"].encode()).hexdigest()[:24]
    path = ROOT / row["blend"]
    port_path = base / "port-records" / (key + ".json")
    record = read_json(port_path)
    nodes = load_json(base / "native/scenes" / (row["sourceSha256"] + ".json.gz"))[
        "nodes"
    ]
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    layer = scene.view_layers["Editable rig"]
    details = {}
    for name, a in audit["meshes"].items():
        if a["nativeTriangles"] == a["blenderTriangles"] or a["sameOrientedBoundary"]:
            continue
        obj = layer.objects[name]
        node = native_node(nodes, obj, a["nativeNode"])
        prior = record.get("restoredNativeTriangleInfo", {}).get(name)
        if prior and prior.get("faceMappings"):
            continue
        details[name] = prior or restore(obj, node, base, row["sourceSha256"])
        d = details[name]
        _, native_faces, _ = read_native(
            base / "native/surfaces" / node["mesh"]["file"]
        )
        d["faceMappings"] = [
            {
                "nativeTriangle": i,
                "nativeMaterialId": int(native_faces[i]["material"]),
                "blenderPolygon": k,
                "blenderMaterialIndex": obj.data.polygons[k].material_index,
            }
            for k, i in enumerate(d["sourceTriangles"], d["beforeFaces"])
        ]
    if not details:
        return
    record.setdefault("restoredNativeTriangleInfo", {}).update(details)
    for name, d in details.items():
        record.setdefault("restoredFaces", {})[name] = d["sourceTriangles"]
    scene["max_surface_audit"] = json.dumps(record, ensure_ascii=False)
    bpy.context.preferences.filepaths.save_version = 0
    tmp = path.with_suffix(".native-faces.partial.blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(tmp), compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(tmp), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    for name, d in details.items():
        obj = scene.view_layers["Editable rig"].objects[name]
        if (
            old_structure(obj, d["beforeLoops"], d["beforeFaces"])
            != d["oldGeometrySha256"]
        ):
            raise ValueError("Prior geometry or paint changed on reopening")
        node = native_node(nodes, obj, audit["meshes"][name]["nativeNode"])
        _, tri, maps = read_native(base / "native/surfaces" / node["mesh"]["file"])
        for k, i in enumerate(d["sourceTriangles"], d["beforeFaces"]):
            face = obj.data.polygons[k]
            if tuple(face.vertices) != tuple(tri[i]["verts"]):
                raise ValueError("Restored winding changed")
            mapping = d["faceMappings"][k - d["beforeFaces"]]
            if (
                mapping["nativeMaterialId"] != int(tri[i]["material"])
                or mapping["blenderMaterialIndex"] != face.material_index
            ):
                raise ValueError("Restored material assignment changed")
            for pos, c in enumerate(face.loop_indices):
                for layer, cid in d["UVChannels"].items():
                    if not np.array_equal(
                        obj.data.uv_layers[layer].uv[c].vector[:], maps[cid][i, pos, :2]
                    ):
                        raise ValueError("Restored UV changed")
                for color, prop in d["colors"].items():
                    actual = getattr(obj.data.color_attributes[color].data[c], prop)
                    if not np.allclose(
                        actual, (*maps[0][i, pos, :], 1.0), atol=1 / 255 + 1e-5, rtol=0
                    ):
                        raise ValueError("Restored color changed")
    tmp.replace(path)
    save_json(port_path, record)
    print(
        "RESTORED",
        row["source"],
        {n: v["sourceTriangles"] for n, v in details.items()},
        flush=True,
    )


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--groups", nargs="+")
    cli.add_argument("--sources", nargs="+")
    args = cli.parse_args()
    base = WORK / "max-preservation"
    rows = read_json(base / "blend/index.json")["scenes"]
    for row in rows:
        if (
            args.groups
            and row["group"] not in args.groups
            or args.sources
            and row["source"] not in args.sources
        ):
            continue
        key = hashlib.sha256(row["source"].encode()).hexdigest()[:24]
        qa = base / "verify/corners" / (key + ".json")
        if qa.is_file():
            audit = read_json(qa)
            if any(
                m["nativeTriangles"] != m["blenderTriangles"]
                and not m["sameOrientedBoundary"]
                for m in audit["meshes"].values()
            ):
                patch(row, audit, base)
