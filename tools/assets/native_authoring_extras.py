"""Restore legacy Max TriMesh cages and the construction parameters of primitives."""

import json
from collections import Counter

import bpy
import numpy as np
from mathutils import Matrix
from native_mesh_blend import attr, mesh_tables
from verify_native_preservation import Buffer, face_type


def map_points(mesh, tables, names, channel, uvw, check):
    key = str(channel)
    if check:
        item = tables.objects[names[key]]
        if item["max_map_channel"] != channel:
            raise ValueError("Channel ID of Max map vertex table changed")
        observed = np.empty(uvw.size, dtype=np.float32)
        item.data.vertices.foreach_get("co", observed)
        if not np.array_equal(observed, uvw.ravel()):
            raise ValueError("Max map vertex table changed")
    else:
        points = bpy.data.meshes.new(f"{mesh.name} map {channel}")
        points.vertices.add(len(uvw))
        points.vertices.foreach_set("co", np.ascontiguousarray(uvw.ravel()))
        item = bpy.data.objects.new(points.name, points)
        item["max_map_channel"] = channel
        tables.objects.link(item)
        names[key] = item.name


def mesh_extras(mesh, directory, shape, tables, check):
    geometry = directory / shape["file"]
    mesh_tables(mesh, geometry, check)
    buf = Buffer(geometry)
    version, nv, nf = (buf.integer() for _ in range(3))
    if (version, nv, nf) != (1, shape["vertices"], shape["faces"]):
        raise ValueError("Unexpected base TriMesh dimensions")
    buf.array("<f4", nv * 3)
    buf.array(face_type, nf)
    names = json.loads(mesh["max_map_tables"]) if check else {}
    counts = Counter(triMeshes=1, triVertices=nv, triFaces=nf)
    for _ in range(buf.integer()):
        channel, nverts, nfaces = (buf.integer() for _ in range(3))
        uvw = buf.array("<f4", nverts * 3).reshape(-1, 3)
        map_points(mesh, tables, names, channel, uvw, check)
        ids = buf.array("<i4", nfaces * 3)
        if channel > 8 and len(ids):
            name = f"Max UV {channel}"
            if check:
                out = np.empty(len(ids) * 2, np.float32)
                mesh.uv_layers[name].uv.foreach_get("vector", out)
                if not np.array_equal(out, uvw[ids, :2].ravel()):
                    raise ValueError("Supplementary high-index UV changed")
            else:
                mesh.attributes.new(name, "FLOAT2", "CORNER")
                mesh.uv_layers[name].uv.foreach_set(
                    "vector", np.ascontiguousarray(uvw[ids, :2].ravel())
                )
            counts.update(uvEditorLayersAbove8=1)
        counts.update(triMapChannels=1, triMapVertices=nverts, triMapCorners=nfaces * 3)
    buf.complete()
    if not check:
        mesh["max_map_tables"] = json.dumps(names)
    flags = Buffer(directory / shape["edgeVisibility"])
    if (flags.integer(), flags.integer()) != (1, nf):
        raise ValueError("Incorrect triangle edge-visibility count")
    visibility = flags.array("u1", nf).astype("<i4")
    flags.complete()
    attr(mesh, "Max visible edge bits", "INT", "FACE", "value", visibility, check)
    return counts


def objects(scene, root, records, scale, directory, tables, check):
    counts = Counter()
    existing = (
        {o["max_extra_handle"]: o for o in scene.objects if "max_extra_handle" in o}
        if check
        else {}
    )
    if check and set(existing) != {r["node"] for r in records}:
        raise ValueError("Unexpected supplemented TriMesh or primitive object list")
    for r in records:
        lookup = r.get("polyShape")
        world = np.eye(4, dtype=np.float32)
        world[:3, :] = np.array(r["objectWorld"], np.float32).reshape(4, 3).T
        params = json.dumps(r["properties"], ensure_ascii=False, sort_keys=True)
        if check:
            obj = existing[r["node"]]
            if (
                obj["max_source_name"],
                obj["max_base_class"],
                obj["max_sample_frame"],
                obj["max_properties"],
            ) != (r["name"], r["baseClass"], r["frame"], params):
                raise ValueError("Primitive construction parameters changed on reopen")
            if not np.array_equal(
                np.asarray(obj.matrix_parent_inverse, np.float32), world
            ):
                raise ValueError("TriMesh or primitive Max affine matrix changed")
            expected = world.copy()
            expected[:3] *= scale
            observed = obj.evaluated_get(scene.view_layers[0].depsgraph).matrix_world
            if not np.allclose(np.asarray(observed), expected, atol=1e-6, rtol=1e-6):
                raise ValueError("TriMesh or primitive world placement changed")
        else:
            mesh = bpy.data.meshes.new(r["name"]) if lookup else None
            obj = bpy.data.objects.new(r["name"], mesh)
            obj["max_extra_handle"] = r["node"]
            obj["max_source_name"] = r["name"]
            obj["max_base_class"] = r["baseClass"]
            obj["max_sample_frame"] = r["frame"]
            obj["max_properties"] = params
            scene.collection.objects.link(obj)
            obj.parent = root
            obj.matrix_parent_inverse = Matrix(world.tolist())
        if lookup:
            counts.update(mesh_extras(obj.data, directory, lookup, tables, check))
        counts.update(supplementedObjects=1)
    return counts
