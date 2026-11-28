"""Restore missing editable Skin paint from Max and verify every frame before publishing the .blend."""

import argparse
import json

import bpy
import numpy as np
from library import INDEX, ROOT, WORK, read_json, save_json
from native_mesh_blend import skin_table
from verify_max_scenes import (
    AUDIT,
    PORTS,
    canonical_name,
    digest,
    painted_skin,
    read_gzip,
    run,
    surface,
)
from verify_max_scenes_cache import compare
from verify_native_preservation import Buffer, influence_type


def restore_groups(node, skin, objects, aliases):
    names = {int(k): aliases.get(str(k), v) for k, v in skin["weightedBoneIDs"].items()}
    matches = [
        o
        for o in objects
        if o.type == "MESH" and len(o.data.vertices) == skin["vertices"]
    ]
    if len(matches) != 1:
        matches = [
            o for o in matches if canonical_name(o.name) == canonical_name(node["name"])
        ]
    if len(matches) != 1:
        raise ValueError("Editable mesh cannot be matched: " + node["name"])
    mesh = matches[0]
    arm = mesh.find_armature()
    if arm is None:
        arms = [
            a
            for a in objects
            if a.type == "ARMATURE" and all(a.data.bones.get(n) for n in names.values())
        ]
        if len(arms) != 1:
            raise ValueError("Missing a unique rig for " + mesh.name)
        arm = arms[0]
        skin_modifier = mesh.modifiers.new("Original Max Skin", "ARMATURE")
        skin_modifier.object = arm
    if not all(arm.data.bones.get(n) for n in names.values()):
        raise ValueError("Source bones are absent: " + node["name"])
    groups = {
        i: (mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name))
        for i, name in names.items()
    }
    # Clear the old deformation weights, keeping unrelated masks such as shape-key influences.
    indices = list(range(len(mesh.data.vertices)))
    for group in mesh.vertex_groups:
        if arm.data.bones.get(group.name):
            group.remove(indices)
    buf = Buffer(WORK / "max-preservation/native/surfaces" / skin["weightFile"])
    if (buf.integer(), buf.integer()) != (1, len(indices)):
        raise ValueError("Skin paint count differs")
    influences = 0
    for vi in indices:
        for bone, weight in buf.array(influence_type, buf.integer()):
            groups[int(bone)].add([vi], float(weight), "REPLACE")
            influences += 1
    buf.complete()
    return {
        "mesh": mesh.name,
        "rig": arm.name,
        "vertices": len(indices),
        "bones": len(names),
        "influences": influences,
    }


PROXY_LAYER = "MAX rig display geometry"


def restore_proxy(scene, node, skin):
    layer = scene.collection.children["MAX evaluated"].children.get(PROXY_LAYER)
    meshes = (
        [
            o
            for o in layer.objects
            if o.type == "MESH"
            and len(o.data.vertices) == skin["vertices"]
            and canonical_name(o.name) == canonical_name(node["name"])
        ]
        if layer
        else []
    )
    if len(meshes) != 1:
        raise ValueError("Missing unique source display mesh for " + node["name"])
    mesh = meshes[0]
    if mesh.vertex_groups:
        raise ValueError(
            "Source display already contains other vertex groups: " + mesh.name
        )
    path = WORK / "max-preservation/native/surfaces" / skin["weightFile"]
    skin_table(mesh, skin, path, False)
    skin_table(mesh, skin, path, True)
    return {
        "mesh": mesh.name,
        "layer": PROXY_LAYER,
        "vertices": len(mesh.data.vertices),
        "bones": len(skin["weightedBoneIDs"]),
        "influences": sum(len(v.groups) for v in mesh.data.vertices),
        "weightFile": skin["weightFile"],
    }


def verify_proxies(temp, abc, meta, repaired):
    proxies = [(key, p) for key, p in repaired.items() if p.get("layer") == PROXY_LAYER]
    if not proxies:
        return {}
    bpy.ops.wm.open_mainfile(filepath=str(temp), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    reference = scene.view_layers["MAX evaluated"]
    bpy.context.window.view_layer = reference
    reference.layer_collection.children["MAX evaluated"].children[
        PROXY_LAYER
    ].exclude = False
    reference.active_layer_collection = reference.layer_collection
    before = set(bpy.data.objects)
    bpy.ops.wm.alembic_import(
        filepath=str(abc),
        as_background_job=False,
        set_frame_range=False,
        validate_meshes=False,
    )
    imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    pairs = {}
    for key, p in proxies:
        obj = reference.objects[p["mesh"]]
        sources = [
            o
            for o in imported
            if canonical_name(o.name) == canonical_name(key)
            and len(o.data.vertices) == p["vertices"]
        ]
        if len(sources) != 1:
            raise ValueError("Ambiguous native proxy: " + key)
        pairs[key] = (obj, sources[0])
    metrics = {k: {"maxMeters": 0.0, "vertexSamples": 0} for k in pairs}
    for frame in range(int(meta["first"]), int(meta["last"]) + 1):
        scene.frame_set(frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for key, (proxy, source) in pairs.items():
            errors = np.linalg.norm(
                surface(proxy, depsgraph) - surface(source, depsgraph), axis=1
            )
            peak = float(errors.max())
            if not np.isfinite(peak) or peak > 1e-6:
                raise ValueError(
                    f"Proxy differs from the source at frame {frame}: {key} ({peak} m)"
                )
            metrics[key]["maxMeters"] = max(metrics[key]["maxMeters"], peak)
            metrics[key]["vertexSamples"] += len(errors)
    return metrics


def restore(item, row, record_path, journal):
    port = ROOT / row["blend"]
    original_sha = digest(port.read_bytes())
    port_report = read_json(record_path)
    native_base = WORK / "max-preservation"
    source = read_gzip(
        native_base / "native/scenes" / (row["sourceSha256"] + ".json.gz")
    )
    max_cache = native_base / "cache" / (row["sourceSha256"] + ".abc")
    meta = read_json(max_cache.with_suffix(".json"))
    repaired = {}
    bpy.ops.wm.open_mainfile(filepath=str(port), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    bpy.context.window.view_layer = scene.view_layers["Editable rig"]
    objects = list(bpy.context.view_layer.objects)
    native_check = painted_skin(source, objects)
    existing = port_report.get("restoredNativePaint", {})
    for node in source["nodes"]:
        check = native_check.get(node["name"], {})
        proxy = check.get("unmatched") and node["name"] not in existing
        if not proxy and check.get("maxError", 0) <= 0.001:
            continue
        skins = [
            s for s in node["modifiers"] if s["type"] == "Skin" and s.get("weightFile")
        ]
        if len(skins) != 1:
            raise ValueError("Multiple native Skin modifiers on " + node["name"])
        data = (
            restore_proxy(scene, node, skins[0])
            if proxy
            else restore_groups(
                node, skins[0], objects, check.get("duplicateBoneIds", {})
            )
        )
        checked = painted_skin({"nodes": [node]}, [scene.objects[data["mesh"]]])[
            node["name"]
        ]
        if checked.get("maxError", 1) > 1e-6:
            raise ValueError(
                "Native paint could not be represented exactly: " + node["name"]
            )
        repaired[node["name"]] = data
    if not repaired:
        return
    port_report["restoredNativePaint"] = {**existing, **repaired}
    scene["max_surface_audit"] = json.dumps(port_report, ensure_ascii=False)
    scene.frame_set(row["start"])
    temp = port.with_suffix(".paint.partial.blend")
    bpy.context.preferences.filepaths.save_version = 0
    try:
        bpy.ops.wm.save_as_mainfile(filepath=str(temp), compress=True)
        verified = compare(item, temp, max_cache, meta, False)
        verified["restoredReferenceProxies"] = verify_proxies(
            temp, max_cache, meta, repaired
        )
        if (
            not verified["referenceResolves"]
            or verified["unmatchedBlend"]
            or verified["additionalCacheMeshes"]
            or not (verified["meshChecks"] or verified["restoredReferenceProxies"])
            or any(
                m["max"] > 0.001 or "vertexCountMismatch" in m
                for m in verified["meshChecks"].values()
            )
        ):
            raise ValueError(
                "Original evaluated surface differs after restoring Skin: "
                + item["path"]
            )
        if digest(port.read_bytes()) != original_sha:
            raise RuntimeError("The port was edited during verification")
        # The journal lets a retry finish updating the manifests after the atomic scene replacement.
        save_json(
            journal, {"prior": original_sha, "port": port_report, "cache": verified}
        )
        temp.replace(port)
    finally:
        temp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        help="Limit restoration to named original MAX paths",
    )
    args = parser.parse_args()
    index = read_json(PORTS / "index.json")
    by_source = {r["path"]: r for r in read_json(INDEX)["files"]}
    modified = []
    for row in index["scenes"]:
        if args.source and row["source"] not in args.source:
            continue
        item = by_source[row["source"]]
        key = item["id"] + ".json"
        receipt = AUDIT / "nodes" / key
        journal = AUDIT / "paint-pending" / key
        record = WORK / "max-preservation/port-records" / key
        if not receipt.exists() and not journal.exists():
            continue
        if not journal.exists():
            check = read_json(receipt)
            if not any(
                m.get("maxError", 0) > 0.001
                or (m.get("unmatched") and not m.get("referenceProxy"))
                for m in check.get("comparison", {}).get("skin", {}).values()
            ):
                continue
            restore(item, row, record, journal)
        if not journal.exists():
            continue
        pending = read_json(journal)
        current = digest((ROOT / row["blend"]).read_bytes())
        if current == pending["prior"]:
            restore(item, row, record, journal)
            pending = read_json(journal)
            current = digest((ROOT / row["blend"]).read_bytes())
        if current != pending["cache"]["blendSha256"]:
            raise RuntimeError(
                "A different edit replaced the validated scene: " + row["source"]
            )
        save_json(record, pending["port"])
        save_json(AUDIT / "cache" / key, pending["cache"])
        save_json(AUDIT / "inspect" / key, run(item, "inspect"))
        save_json(receipt, run(item, "nodes"))
        latest = read_json(PORTS / "index.json")
        published = next(r for r in latest["scenes"] if r["source"] == row["source"])
        if published.get("blendSha256") not in (None, pending["prior"], current):
            raise RuntimeError("A newer port is recorded for " + row["source"])
        published.update(
            blendSha256=current,
            blendBytes=(ROOT / row["blend"]).stat().st_size,
            restoredNativePaint=pending["port"]["restoredNativePaint"],
        )
        save_json(PORTS / "index.json", latest)
        journal.unlink()
        modified.append(row["source"])
    print("Restored", len(modified), "source scenes:", modified)


if __name__ == "__main__":
    main()
