"""Check editable Blender triangle winding and per-corner UV against the Max triangle/map tables."""

import argparse
from collections import Counter, defaultdict

import bpy
import numpy as np
from library import ROOT, WORK, read_json, save_json
from verify_max_scenes import (
    AUDIT,
    PORTS,
    canonical_name,
    digest,
    packed_values,
    read_gzip,
)
from verify_native_preservation import Buffer, face_type


def source_triangles(filename):
    buf = Buffer(WORK / "max-preservation/native/surfaces" / filename)
    version, nv, nf = (buf.integer() for _ in range(3))
    if version != 1:
        raise ValueError("Unknown native mesh format")
    buf.array("<f4", nv * 3)
    faces = buf.array(face_type, nf)["verts"]
    uv = None
    for _ in range(buf.integer()):
        channel, values, count = (buf.integer() for _ in range(3))
        coords = buf.array("<f4", values * 3).reshape(-1, 3)
        indices = buf.array("<i4", count * 3).reshape(-1, 3)
        if channel == 1 and count:
            if count != len(faces):
                raise ValueError("Unpaired native UV corners")
            uv = coords[indices][:, :, :2]
    buf.complete()
    return faces, uv


def editable_triangles(mesh):
    mesh.calc_loop_triangles()
    faces = packed_values(mesh.loop_triangles, "vertices", 3, np.int32).reshape(-1, 3)
    uv = None
    if mesh.uv_layers.active:
        coords = packed_values(mesh.uv_layers.active.uv, "vector", 2).reshape(-1, 2)
        indices = packed_values(mesh.loop_triangles, "loops", 3, np.int32).reshape(
            -1, 3
        )
        uv = coords[indices]
    return faces, uv


def keys(faces, uv):
    triangles = Counter()
    oriented = Counter()
    mapped = Counter()
    uv = np.rint(uv * 100_000).astype(np.int64).tolist() if uv is not None else None
    for i, xyz in enumerate(faces.tolist()):
        tri = tuple(sorted(xyz))
        triangles[tri] += 1
        a, b, c = xyz
        oriented[min((a, b, c), (b, c, a), (c, a, b))] += 1
        if uv is not None:
            a, b, c = [(v, *coord) for v, coord in zip(xyz, uv[i], strict=True)]
            mapped[min((a, b, c), (b, c, a), (c, a, b))] += 1
    return triangles, oriented, mapped


def boundary(faces):
    # Replacing the interior diagonal of a quad leaves the oriented boundary intact.
    edges = Counter()
    for (a, b, c), count in faces.items():
        for i, j in [(a, b), (b, c), (c, a)]:
            if i < j:
                edges[(i, j)] += count
            elif i > j:
                edges[(j, i)] -= count
    return edges


def local_basis(positions):
    first, second = positions[1:] - positions[0]
    normal = np.cross(first, second)
    length = np.linalg.norm(normal)
    if not np.isfinite(length) or length == 0:
        raise ValueError("Cannot compare shading on a degenerate native face")
    normal /= length
    tangent = first / np.linalg.norm(first)
    return np.column_stack([tangent, np.cross(normal, tangent), normal])


def check_recovered_corners(obj, filename, details):
    """Match restored corners to original triangle IDs, including split normals in a shared tangent basis."""
    buf = Buffer(WORK / "max-preservation/native/surfaces" / filename)
    version, nv, nf = (buf.integer() for _ in range(3))
    if version != 1:
        raise ValueError("Unknown native mesh format")
    xyz = buf.array("<f4", nv * 3).reshape(-1, 3)
    faces = buf.array(face_type, nf)
    maps = {}
    for _ in range(buf.integer()):
        channel, nv, nf = (buf.integer() for _ in range(3))
        coords = buf.array("<f4", nv * 3).reshape(-1, 3)
        ids = buf.array("<i4", nf * 3).reshape(-1, 3)
        if nf:
            maps[channel] = coords[ids]
    buf.complete()
    mesh = obj.data
    native_materials = defaultdict(set)
    for face in faces:
        key = tuple(sorted(face["verts"].tolist()))
        native_materials[key].add(int(face["material"]))
    material_slots = defaultdict(set)
    mesh.calc_loop_triangles()
    for tri in mesh.loop_triangles:
        if tri.polygon_index >= details["beforeFaces"]:
            continue
        material_ids = native_materials.get(tuple(sorted(tri.vertices)), set())
        if len(material_ids) == 1:
            material_slots[next(iter(material_ids))].add(
                mesh.polygons[tri.polygon_index].material_index
            )
    uv_error = color_error = normal_error = 0.0
    for row in details["faceMappings"]:
        i = row["nativeTriangle"]
        face = faces[i]
        poly = mesh.polygons[row["blenderPolygon"]]
        src = face["verts"].tolist()
        observed = list(poly.vertices)
        if (
            not any(observed == src[n:] + src[:n] for n in range(3))
            or int(face["material"]) != row["nativeMaterialId"]
            or poly.material_index != row["blenderMaterialIndex"]
            or material_slots[int(face["material"])] != {poly.material_index}
        ):
            raise ValueError("Restored Max face orientation or material differs")
        lookup = dict(zip(observed, poly.loop_indices, strict=True))
        native_basis = local_basis(xyz[src].astype(float))
        local = local_basis(np.asarray([mesh.vertices[v].co[:] for v in src]))
        for corner, v in enumerate(src):
            li = lookup[v]
            for name, channel in details["UVChannels"].items():
                uv = np.asarray(mesh.uv_layers[name].uv[li].vector)
                uv_error = max(
                    uv_error, float(np.max(abs(uv - maps[channel][i, corner, :2])))
                )
            for name, channel_property in details["colors"].items():
                color = np.asarray(
                    getattr(mesh.color_attributes[name].data[li], channel_property)
                )
                color_error = max(
                    color_error,
                    float(np.max(abs(color[:3] - maps[0][i, corner]))),
                    abs(float(color[3]) - 1),
                )
            normal = np.asarray(face["normals"][corner])
            actual = np.asarray(mesh.corner_normals[li].vector)
            if min(np.linalg.norm(normal), np.linalg.norm(actual)) <= 0:
                raise ValueError("Missing split normal on a restored face")
            expected = (native_basis.T @ normal) / np.linalg.norm(normal)
            got = (local.T @ actual) / np.linalg.norm(actual)
            normal_error = max(normal_error, float(np.linalg.norm(expected - got)))
    if (
        not np.isfinite([uv_error, color_error, normal_error]).all()
        or uv_error > 1e-5
        or color_error > 1 / 255 + 1e-5
        or normal_error > 1e-3
    ):
        raise ValueError(
            f"Restored face data differs on {obj.name}: {uv_error}, {color_error}, {normal_error}"
        )
    return {
        "faces": len(details["faceMappings"]),
        "materialSlotsVerifiedFromOriginalFaces": True,
        "UVChannels": len(details["UVChannels"]),
        "maxUVError": uv_error,
        "maxColorError": color_error,
        "maxSplitNormalError": normal_error,
    }


def check(row, base):
    port = ROOT / row["blend"]
    sha = digest(port.read_bytes())
    key = digest(row["source"].encode())[:24] + ".json"
    out = AUDIT / "corners" / key
    if (
        out.exists()
        and (previous := read_json(out)).get("blendSha256") == sha
        and previous.get("auditVersion") == 2
        and all(
            "restoredCorners" not in m
            or m["restoredCorners"].get("materialSlotsVerifiedFromOriginalFaces")
            for m in previous["meshes"].values()
        )
    ):
        return
    native = read_gzip(base / "native/scenes" / (row["sourceSha256"] + ".json.gz"))
    cache = read_json(AUDIT / "cache" / key)
    assert cache["blendSha256"] == sha
    result = {
        "auditVersion": 2,
        "source": row["source"],
        "blendSha256": sha,
        "meshes": {},
        "unmatched": [],
    }
    restored = read_json(base / "port-records" / key).get(
        "restoredNativeTriangleInfo", {}
    )
    if cache["meshChecks"]:
        bpy.ops.wm.open_mainfile(filepath=str(port), load_ui=False, use_scripts=False)
        layer = bpy.context.scene.view_layers["Editable rig"]
        pool = [n for n in native["nodes"] if n.get("mesh")]
        for name, original in cache["meshChecks"].items():
            obj = layer.objects[name]
            candidates = [
                n for n in pool if n["mesh"]["vertices"] == len(obj.data.vertices)
            ]
            if len(candidates) != 1:
                candidates = [
                    n
                    for n in candidates
                    if canonical_name(n["name"])
                    in {canonical_name(name), canonical_name(original["cacheMesh"])}
                ]
            if len(candidates) != 1:
                result["unmatched"].append(name)
                continue
            node = candidates[0]
            pool.remove(node)
            source = source_triangles(node["mesh"]["file"])
            actual = editable_triangles(obj.data)
            s, so, suv = keys(*source)
            a, ao, auv = keys(*actual)
            common = (s & a).total()
            oriented = (so & ao).total()
            mapped = (suv & auv).total()
            result["meshes"][name] = {
                "nativeNode": node["name"],
                "nativeTriangles": s.total(),
                "blenderTriangles": a.total(),
                "commonTriangles": common,
                "sameWinding": oriented,
                "sameCornerUV": mapped,
                "sameOrientedBoundary": boundary(so - ao) == boundary(ao - so),
                "sameUVBoundary": boundary(suv - auv) == boundary(auv - suv),
                "nativeHasUV": source[1] is not None,
                "blendHasUV": actual[1] is not None,
            }
            if name in restored:
                result["meshes"][name]["restoredCorners"] = check_recovered_corners(
                    obj, node["mesh"]["file"], restored[name]
                )
    save_json(out, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", default=[])
    args = parser.parse_args()
    base = WORK / "max-preservation"
    for row in read_json(PORTS / "index.json")["scenes"]:
        if args.source and row["source"] not in args.source:
            continue
        if (base / "native/receipts" / (row["sourceSha256"] + ".json")).exists():
            check(row, base)


if __name__ == "__main__":
    main()
