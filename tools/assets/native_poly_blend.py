"""Restore native Editable Poly base cages, untriangulated faces and map tables in Blender."""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import bpy
import native_authoring_extras
import numpy as np
from library import WORK, read_json, save_json
from mathutils import Matrix
from native_mesh_blend import attr, load_json
from package_max_scenes import csv_bytes, file_hash, pack
from verify_native_preservation import Buffer


def field(collection, name, values, check):
    expected = np.ascontiguousarray(values.ravel())
    if check:
        observed = np.empty_like(expected)
        collection.foreach_get(name, observed)
        if not np.array_equal(observed, expected):
            raise ValueError(f"Blender changed {name} in {len(collection)} entries")
    else:
        collection.foreach_set(name, expected)


def indices(table):
    degree = table.integer()
    return table.array("<i4", degree) if degree >= 0 else None


class PendingFaceEdges(FileNotFoundError):
    """An ambiguous pair of Max edges requires native face-to-edge incidence."""


def loop_edges_from_max(extra, edge_ids, ends, nf, face_ids, polygons):
    if extra is None:
        raise PendingFaceEdges("Native face-to-edge incidence has not been captured")
    if (extra.integer(), extra.integer()) != (1, nf):
        raise ValueError("Native face-edge incidence has incompatible dimensions")
    ids = [indices(extra) for _ in range(nf)]
    extra.complete()
    max_to_index = {v: i for i, v in enumerate(edge_ids.tolist())}
    result = []
    for index, face in zip(face_ids, polygons, strict=True):
        native = ids[index]
        if native is None or len(native) != len(face):
            raise ValueError("Native face-edge incidence degree differs")
        lookup = {
            tuple(sorted(ends[i])): i for edge in native for i in [max_to_index[edge]]
        }
        for a, b in zip(face, np.roll(face, -1), strict=True):
            result.append(lookup[tuple(sorted((a, b)))])
    return np.asarray(result, dtype="<i4")


def restore_cage(mesh, table, tables, check, extra):
    version, nv, ne, nf = (table.integer() for _ in range(4))
    if version != 1:
        raise ValueError("Unknown Editable Poly table")
    vertices = table.array(np.dtype([("co", "<f4", (3,)), ("flag", "<i4")]), nv)
    edges = table.array(np.dtype([("ends", "<i4", (2,)), ("flag", "<i4")]), ne)
    faces = []
    face_meta = np.empty((nf, 3), dtype="<i4")
    for i in range(nf):
        faces.append(indices(table))
        face_meta[i] = table.array("<i4", 3)
    face_ids = np.array([i for i, f in enumerate(faces) if f is not None], dtype="<i4")
    edge_ids = np.flatnonzero(np.all(edges["ends"] >= 0, axis=1)).astype("<i4")
    polygons = [faces[i] for i in face_ids]
    degrees = np.array([len(f) for f in polygons], dtype="<i4")
    loops = np.concatenate(polygons) if polygons else np.empty(0, dtype="<i4")
    starts = np.cumsum(degrees, dtype="<i4") - degrees
    ends = edges["ends"][edge_ids]
    edge_lookup = {tuple(sorted(pair)): i for i, pair in enumerate(ends.tolist())}
    loop_edges = (
        loop_edges_from_max(extra, edge_ids, ends, nf, face_ids, polygons)
        if len(edge_lookup) != len(ends)
        else np.asarray(
            [
                edge_lookup[tuple(sorted((a, b)))]
                for f in polygons
                for a, b in zip(f, np.roll(f, -1), strict=True)
            ],
            dtype="<i4",
        )
    )
    if not check:
        mesh.vertices.add(nv)
        mesh.edges.add(len(ends))
        mesh.loops.add(len(loops))
        mesh.polygons.add(len(polygons))
    field(mesh.vertices, "co", vertices["co"], check)
    field(mesh.edges, "vertices", ends, check)
    field(mesh.loops, "vertex_index", loops, check)
    field(mesh.loops, "edge_index", loop_edges, check)
    field(mesh.polygons, "loop_start", starts, check)
    if check:
        field(mesh.polygons, "loop_total", degrees, check)
    else:
        mesh.update()
    for title, domain, values in (
        ("vertex flags", "POINT", vertices["flag"]),
        ("edge flags", "EDGE", edges["flag"][edge_ids]),
        ("edge ID", "EDGE", edge_ids),
        ("face ID", "FACE", face_ids),
        ("material ID", "FACE", face_meta[face_ids, 0]),
        ("smoothing bits", "FACE", face_meta[face_ids, 1]),
        ("face flags", "FACE", face_meta[face_ids, 2]),
    ):
        attr(mesh, "Max " + title, "INT", domain, "value", values, check)
    nch = table.integer()
    counts = Counter(
        cages=1,
        vertices=nv,
        edges=len(ends),
        faces=len(polygons),
        deadEdges=ne - len(ends),
        deadFaces=nf - len(polygons),
        mapChannels=nch,
    )
    counts.update({f"polygons{d}": n for d, n in Counter(degrees.tolist()).items()})
    map_names = json.loads(mesh["max_map_tables"]) if check else {}
    for _ in range(nch):
        channel, nverts, nfaces = (table.integer() for _ in range(3))
        uvw = table.array("<f4", nverts * 3).reshape(-1, 3)
        if nfaces not in (0, nf):
            raise ValueError("Map face counts differ from base cage")
        maps = [indices(table) for _ in range(nfaces)]
        # A map table may contain control points never used by a face or a third
        # coordinate a conventional Blender UV layer cannot represent.
        native_authoring_extras.map_points(mesh, tables, map_names, channel, uvw, check)
        counts.update(mapVertices=nverts)
        if not nfaces:
            continue
        corner_ids = (
            np.concatenate([maps[i] for i in face_ids])
            if len(face_ids)
            else np.empty(0, "<i4")
        )
        if len(corner_ids) != len(loops) or any(
            len(maps[i]) != len(faces[i]) for i in face_ids
        ):
            raise ValueError("Map corner degrees differ from the native polygons")
        values = uvw[corner_ids]
        attr(
            mesh,
            f"Max map {channel} index",
            "INT",
            "CORNER",
            "value",
            corner_ids,
            check,
        )
        attr(
            mesh,
            f"Max map {channel} UVW",
            "FLOAT_VECTOR",
            "CORNER",
            "vector",
            values,
            check,
        )
        if channel >= 1:
            layer_name = f"Max UV {channel}"
            if not check:
                if channel <= 8:
                    mesh.uv_layers.new(name=layer_name, do_init=False)
                else:
                    # FLOAT2/CORNER is Blender's UV layer representation. The mesh
                    # UV operator caps new layers at eight, its data model does not.
                    mesh.attributes.new(layer_name, "FLOAT2", "CORNER")
            layer = mesh.uv_layers[layer_name]
            field(layer.uv, "vector", values[:, :2], check)
            counts.update(uvEditorLayers=1)
            if channel > 8:
                counts.update(uvEditorLayersAbove8=1)
        counts.update(mapCorners=len(corner_ids))
    if not check:
        mesh["max_map_tables"] = json.dumps(map_names)
    table.complete()
    return counts


def max_matrix(cage):
    matrix = np.eye(4, dtype=np.float32)
    matrix[:3, :] = np.array(cage["objectWorld"], dtype=np.float32).reshape(4, 3).T
    return matrix


def build(group, rows, base, pilot=False):
    directory = base / "native/envelopes"
    out = base / ("authoring-pilot" if pilot else "authoring")
    out.mkdir(exist_ok=True)
    natives = {}
    paths = {}
    index = []
    for row in rows:
        sha = row["sourceSha256"]
        if sha not in natives:
            native = load_json(base / "native/scenes" / (sha + ".json.gz"))
            meta = directory / (sha + ".json.gz")
            envelope = load_json(meta)
            if envelope["version"] < 2:
                raise ValueError("Envelope predates cage recovery: " + str(meta))
            supplementary = directory / (sha + ".extra.json.gz")
            records = []
            if supplementary.is_file():
                specs = load_json(supplementary)
                if (
                    specs["version"] != 1
                    or specs["sha256"] != sha
                    or specs["source"] != envelope["source"]
                ):
                    raise ValueError(
                        "Supplementary TriMesh source does not match original MAX"
                    )
                records = specs["objects"]
                paths[supplementary.relative_to(base).as_posix()] = supplementary
                for r in records:
                    if r.get("polyShape"):
                        for k in ("file", "edgeVisibility"):
                            p = directory / r["polyShape"][k]
                            paths[p.relative_to(base).as_posix()] = p
            natives[sha] = native, envelope, records
            for path in [
                meta,
                *(directory / c["file"] for c in envelope["cages"]),
                *(directory / s["file"] for s in envelope["skins"]),
            ]:
                paths[path.relative_to(base).as_posix()] = path
        native, envelope, _ = natives[sha]
        index.append(
            {
                "source": row["source"],
                "sourceSha256": sha,
                "blend": f"authoring/{group}.blend",
                "cages": len(envelope["cages"]),
                "skins": len(envelope["skins"]),
                "nativeAuthoring": f"native/envelopes/{sha}.json.gz",
            }
        )
    bpy.ops.wm.read_factory_settings(use_empty=True)

    def process(check):
        counts = Counter()
        scenes = {s.get("source_max"): s for s in bpy.data.scenes} if check else {}
        library = {}
        tables = (
            bpy.data.collections["Max map vertex tables"]
            if check
            else bpy.data.collections.new("Max map vertex tables")
        )
        if not check:
            tables.hide_viewport = True
            tables.hide_render = True
        for idx, row in enumerate(rows):
            source, sha = row["source"], row["sourceSha256"]
            native, envelope, records = natives[sha]
            scale = 1.0 / native["units"]["perMeter"]
            if check:
                scene = scenes[source]
                layer = scene.view_layers[0]
                layer.update()
                if scene["source_sha256"] != sha:
                    raise ValueError("Wrong native source in scene")
                existing = {
                    o.get("max_node_handle"): o
                    for o in scene.objects
                    if "max_node_handle" in o
                }
                if set(existing) != {c["node"] for c in envelope["cages"]}:
                    raise ValueError("Missing or extra native cage nodes")
            else:
                scene = (
                    bpy.context.scene
                    if idx == 0
                    else bpy.data.scenes.new(Path(row["blend"]).stem)
                )
                scene.name = Path(row["blend"]).stem
                scene.unit_settings.system = "METRIC"
                scene["source_max"] = source
                scene["source_sha256"] = sha
                scene["evaluated_max_frame"] = native["timing"]["first"]
                scene.collection.children.link(tables)
                root = bpy.data.objects.new("Max system units", None)
                scene.collection.objects.link(root)
                root.scale = (scale,) * 3
                root.empty_display_size = 0.01
            for cage in envelope["cages"]:
                buf = Buffer(directory / cage["file"])
                extra_path = directory / cage["file"].replace(".poly.gz", ".edges.gz")
                extra = Buffer(extra_path) if extra_path.is_file() else None
                identity = hashlib.sha256(buf.data)
                if extra:
                    identity.update(extra.data)
                    paths[extra_path.relative_to(base).as_posix()] = extra_path
                key = identity.hexdigest()
                world = max_matrix(cage)
                if check:
                    obj = existing[cage["node"]]
                    if (
                        obj["max_table"] != cage["file"]
                        or obj["max_source_name"] != cage["name"]
                    ):
                        raise ValueError("Cage source mapping changed")
                    if not np.array_equal(
                        np.asarray(obj.matrix_parent_inverse, dtype="<f4"), world
                    ):
                        raise ValueError(
                            "Raw Max transform did not survive Blender reopening"
                        )
                    if not np.allclose(
                        obj.parent.scale, [scale] * 3, atol=1e-12, rtol=1e-7
                    ):
                        raise ValueError("Max system units changed")
                    expected = world.copy()
                    expected[:3] *= scale
                    placed = np.asarray(obj.evaluated_get(layer.depsgraph).matrix_world)
                    if not np.allclose(placed, expected, atol=1e-6, rtol=1e-6):
                        raise ValueError("Blender world placement differs from Max")
                if key not in library:
                    mesh = obj.data if check else bpy.data.meshes.new(cage["name"])
                    if check and mesh["max_cage_sha256"] != key:
                        raise ValueError("Unexpected cage array hash")
                    if not check:
                        mesh["max_cage_sha256"] = key
                    library[key] = mesh, restore_cage(mesh, buf, tables, check, extra)
                mesh, metrics = library[key]
                if check:
                    if obj.data != mesh:
                        raise ValueError("Source mesh mapping changed on reopen")
                else:
                    obj = bpy.data.objects.new(cage["name"], mesh)
                    obj["max_table"] = cage["file"]
                    obj["max_node_handle"] = cage["node"]
                    obj["max_source_name"] = cage["name"]
                    obj["max_sample_frame"] = cage["frame"]
                    scene.collection.objects.link(obj)
                    obj.parent = root
                    # Unlike object location/rotation/scale, the parent inverse can
                    # store the full Max affine matrix, including arbitrary shear.
                    obj.matrix_parent_inverse = Matrix(world.tolist())
                counts.update(metrics)
            counts.update(
                native_authoring_extras.objects(
                    scene,
                    None if check else root,
                    records,
                    scale,
                    directory,
                    tables,
                    check,
                )
            )
            counts.update(scenes=1, skins=len(envelope["skins"]))
        counts["distinctCages"] = len(library)
        return counts

    before = process(False)
    guide = bpy.data.texts.new("Using the original polygon cages")
    guide.write(
        "Choose an original MAX file using Blender's Scene selector. The scene's "
        "source_max property is its exact archive path. Editable Poly base objects "
        "retain their original triangle, quad and n-gon faces before modifiers. "
        "Every mesh has named Max face, edge and vertex attributes. Use the UV Editor "
        "for all positive map channels, and the Spreadsheet for every source channel's corner "
        "UVW and original map index. The hidden Max map vertex tables collection "
        "also retains unused map vertices. Its object names are recorded in the "
        "mesh's max_map_tables property. Identical base cages share a mesh datablock. "
        "Use Make Single User before editing one instance independently.\n\n"
        "Where present, original legacy triangle cages and primitive construction "
        "settings are recorded on objects with max_extra_handle. Their editable "
        "geometry precedes Cloth, Bend and Skin. max_properties lists original "
        "Max parameters and Max visible edge bits stores each triangle's edge flags.\n\n"
        "The parent preserves the original scene's unit scale and each child keeps "
        "the original object matrix, including shear, in its parent inverse. "
        "The native/envelopes directory in this ZIP contains the original base cages, "
        "3ds Max Skin envelope files, bind matrices and per-vertex DQ weights. "
        "For the animated, skinned working scenes, open the corresponding Blender archive."
    )
    guide.use_fake_user = True

    def visible_faces(scene):
        return sum(
            len(obj.data.polygons) for obj in scene.objects if "max_node_handle" in obj
        )

    if bpy.context.window:
        bpy.context.window.scene = max(bpy.data.scenes, key=visible_faces)
    target = out / (group + ".blend")
    temp = target.with_suffix(".partial.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(temp), compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(temp), load_ui=False, use_scripts=False)
    after = process(True)
    if before != after:
        raise ValueError("Source coverage changed on reopen")
    temp.replace(target)
    report = {
        "group": group,
        "scenePaths": len(rows),
        "uniqueMax": len(natives),
        "allSourceUVLayersInEditor": True,
        "verified": dict(sorted(after.items())),
        "blendSha256": file_hash(target),
    }
    receipt = out / (group + ".json")
    save_json(receipt, report)
    if not pilot:
        paths[target.relative_to(base).as_posix()] = target
        paths[receipt.relative_to(base).as_posix()] = receipt
        pack("Authoring/" + group, paths, csv_bytes(index))
    print(json.dumps(report, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--groups", nargs="+")
    parser.add_argument(
        "--ready",
        action="store_true",
        help="Only build groups with complete native authoring captures",
    )
    parser.add_argument(
        "--pilot", nargs="+", help="Build sample source SHA prefixes separately"
    )
    args = parser.parse_args()
    base = WORK / "max-preservation"
    rows = read_json(base / "blend/index.json")["scenes"]
    if args.pilot:
        selected = [
            r
            for r in rows
            if any(r["sourceSha256"].startswith(prefix) for prefix in args.pilot)
        ]
        if not selected:
            parser.error("No matching pilot sources")
        build("pilot", selected, base, True)
    else:
        groups = sorted({r["group"] for r in rows})
        for group in args.groups or groups:
            selected = [r for r in rows if r["group"] == group]
            if not selected:
                parser.error("Unknown group " + group)
            if args.ready:
                target = base / "packages/Authoring" / (group + ".zip")
                metas = {
                    base / "native/envelopes" / (r["sourceSha256"] + ".json.gz")
                    for r in selected
                }
                if not all(
                    p.is_file() and (base / "native/scenes" / p.name).is_file()
                    for p in metas
                ):
                    continue
                extras = {
                    base / "native/envelopes" / (row["sourceSha256"] + ".extra.json.gz")
                    for row in selected
                }
                inputs = metas | {p for p in extras if p.is_file()}
                if target.is_file() and all(
                    target.stat().st_mtime_ns >= p.stat().st_mtime_ns for p in inputs
                ):
                    prior = read_json(base / "authoring" / (group + ".json"))
                    if prior.get("allSourceUVLayersInEditor") or not any(
                        ch > 8 and nf > 0
                        for p in metas
                        for node in load_json(base / "native/scenes" / p.name)["nodes"]
                        if node.get("mesh")
                        for ch, _nv, nf in node["mesh"]["mapChannels"]
                    ):
                        continue
                if not all(load_json(p).get("version", 0) >= 2 for p in metas):
                    continue
            try:
                build(group, selected, base)
            except PendingFaceEdges:
                if not args.ready:
                    raise
                print(group, "awaiting native face-to-edge incidence", flush=True)
