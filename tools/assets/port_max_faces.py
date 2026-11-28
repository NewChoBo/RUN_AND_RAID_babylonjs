"""Recover native faces removed by FBX validation without changing the editable vertex indices."""

import json
from collections import defaultdict

import numpy as np


def oriented(face):
    ids = tuple(face.vertices)
    return min(ids[i:] + ids[:i] for i in range(len(ids)))


def tangent_frame(vertices):
    tangent = vertices[1] - vertices[0]
    normal = np.cross(tangent, vertices[2] - vertices[0])
    if np.linalg.norm(tangent) < 1e-12 or np.linalg.norm(normal) < 1e-12:
        return None
    tangent /= np.linalg.norm(tangent)
    normal /= np.linalg.norm(normal)
    return np.column_stack((tangent, np.cross(normal, tangent), normal))


def restore_faces(obj, native):
    mesh, source = obj.data, native.data
    if len(mesh.vertices) != len(source.vertices) or len(mesh.polygons) >= len(
        source.polygons
    ):
        return []
    by_winding = {oriented(p): p for p in source.polygons}
    current = {oriented(p): p for p in mesh.polygons}
    if (
        len(by_winding) != len(source.polygons)
        or len(current) != len(mesh.polygons)
        or not current.keys() <= by_winding.keys()
    ):
        # Retriangulations and genuinely ambiguous overlaps cannot be restored by appending polygons.
        return []
    missing = [p for p in source.polygons if oriented(p) not in current]
    if len(mesh.uv_layers) != len(source.uv_layers):
        return []
    material_map = defaultdict(set)
    native_faces = []
    for p in mesh.polygons:
        face = by_winding[oriented(p)]
        native_faces.append(face.index)
        material_map[face.material_index].add(p.material_index)
        # Match UV channels by their actual values on all existing face corners.
        corners = dict(zip(face.vertices, face.loop_indices))
        for left, right in zip(mesh.uv_layers, source.uv_layers):
            if any(
                (left.data[index].uv - right.data[corners[vertex]].uv).length > 1e-5
                for vertex, index in zip(p.vertices, p.loop_indices)
            ):
                return []
    if any(len(material_map[p.material_index]) != 1 for p in missing):
        return []
    # Preserve the imported bind-space split normals. The reference stores posed
    # surface normals, so rotate new normals into the same triangle's bind frame.
    normals = [n.vector[:] for n in mesh.corner_normals]
    old_loops = len(mesh.loops)
    new_normals = []
    for p in missing:
        indices = list(p.vertices)
        reference = tangent_frame(np.array([source.vertices[i].co[:] for i in indices]))
        rest = tangent_frame(np.array([mesh.vertices[i].co[:] for i in indices]))
        if reference is None or rest is None:
            return []
        rotate = rest @ reference.T
        new_normals.extend(
            rotate @ np.asarray(source.corner_normals[i].vector) for i in p.loop_indices
        )
    if mesh.users > 1:
        mesh = mesh.copy()
        obj.data = mesh
    vertices = [loop.vertex_index for loop in mesh.loops]
    starts = [face.loop_start for face in mesh.polygons]
    first = len(mesh.polygons)
    for p in missing:
        starts.append(len(vertices))
        vertices.extend(p.vertices)
        native_faces.append(p.index)
    mesh.loops.add(len(vertices) - len(mesh.loops))
    mesh.polygons.add(len(missing))
    mesh.polygons.foreach_set("loop_start", starts)
    mesh.loops.foreach_set("vertex_index", vertices)
    mesh.update(calc_edges=True, calc_edges_loose=True)
    for index, p in enumerate(missing, first):
        face = mesh.polygons[index]
        face.material_index = next(iter(material_map[p.material_index]))
        face.use_smooth = p.use_smooth
        for left, right in zip(mesh.uv_layers, source.uv_layers):
            for i, j in zip(face.loop_indices, p.loop_indices):
                left.data[i].uv = right.data[j].uv
    mesh.normals_split_custom_set([*normals, *new_normals])
    for name, values in [
        ("max_face_index", native_faces),
        (
            "max_faceset_index",
            [source.polygons[i].material_index for i in native_faces],
        ),
    ]:
        attribute = mesh.attributes.get(name) or mesh.attributes.new(
            name, "INT", "FACE"
        )
        attribute.data.foreach_set("value", values)
    mesh["max_facesets"] = json.dumps([m.name if m else "" for m in source.materials])
    mesh.update()
    if (
        max(
            (
                np.linalg.norm(np.asarray(mesh.corner_normals[i].vector) - normals[i])
                for i in range(old_loops)
            ),
            default=0,
        )
        > 0.001
    ):
        raise ValueError(
            "Restoring native faces changed existing split normals: " + obj.name
        )
    return [p.index for p in missing]
