"""Join final, hash-matched Max/Blender evidence and list unresolved source dependencies."""

import collections
import csv
import gzip
import io
import json
import math
import zipfile
from pathlib import PureWindowsPath

from export_max_extensions import key_times, motion_ranges
from library import PUBLIC, ROOT, read_json, save_json
from package_max_scenes import PRESERVATION, csv_bytes, file_hash, pack


def native_data(path):
    with gzip.open(path, "rt", encoding="utf8") as stream:
        return json.load(stream)


def extended_download_index(base, by_group):
    expected = {
        (entry["source"], entry["reference"])
        for group in by_group.values()
        for entry in group["scenes"]
    }
    indexed = {}
    for archive in sorted((base / "packages/Extended").glob("*.zip")):
        if archive.name.endswith(".partial.zip"):
            continue
        with zipfile.ZipFile(archive) as z:
            rows = csv.DictReader(io.StringIO(z.read("index.csv").decode("utf-8-sig")))
            for row in rows:
                key = row["source"], row["reference"]
                if key in indexed:
                    raise ValueError(f"Duplicate supplemental download: {key}")
                indexed[key] = {"download": "Extended/" + archive.name, **row}
    if indexed.keys() != expected:
        raise ValueError(
            "Supplemental Blender ZIP coverage differs from the reopened source scenes"
        )
    return [indexed[k] for k in sorted(indexed)]


def build():
    base = PRESERVATION
    output = base / "reports"
    output.mkdir(exist_ok=True)
    source = read_json(base / "native/inventory.json")
    native_check = read_json(base / "native/verification.json")
    if (
        native_check["failed"]
        or native_check["pending"]
        or native_check["verified"] != native_check["total"]
    ):
        raise ValueError("Native source verification is incomplete")
    authoring_check = read_json(base / "native/envelopes/verification.json")
    if (
        authoring_check["failed"]
        or authoring_check["pending"]
        or authoring_check["verified"] != native_check["total"]
    ):
        raise ValueError("Skin and original polygon verification is incomplete")
    originals = {r["source"]: r for r in source["files"]}
    catalog = {r["path"]: r for r in read_json(PUBLIC / "catalog.json")["files"]}
    textures = {
        p.rsplit("/", 1)[-1].casefold()
        for p, r in catalog.items()
        if r["kind"] == "texture"
    }
    refs, materials, rows, missing_modifiers = [], [], [], []
    counts = collections.Counter()
    unique = set()
    by_group = {}
    authoring_groups = {}
    for item in read_json(base / "blend/index.json")["scenes"]:
        name = item["source"]
        original, published = originals[name], catalog[name]
        item_id = published["id"]
        sha = original["sha256"]
        native = base / "native"
        receipt = collections.Counter(read_json(native / "receipts" / (sha + ".json")))
        authored = native_data(native / "scenes" / (sha + ".json.gz"))
        report = read_json(base / "port-records" / (item_id + ".json"))
        verify = base / "verify"
        rig = read_json(verify / "inspect" / (item_id + ".json"))
        mesh = read_json(verify / "cache" / (item_id + ".json"))
        triangles = read_json(verify / "corners" / (item_id + ".json"))
        bone_check = read_json(verify / "nodes" / (item_id + ".json"))
        cache = read_json(base / "cache" / (sha + ".json"))
        extra = read_json(base / "extended" / (sha + ".json"))
        group = item["group"]
        if group not in by_group:
            evidence = base / "extended-edit" / (group + ".json")
            by_group[group] = (
                read_json(evidence)
                if evidence.is_file()
                else {"samples": [], "scenes": []}
            )
            authoring_groups[group] = read_json(base / "authoring" / (group + ".json"))
            if (
                file_hash(base / "authoring" / (group + ".blend"))
                != authoring_groups[group]["blendSha256"]
            ):
                raise ValueError("Stale authoring library: " + group)
        authoring = native_data(native / "envelopes" / (sha + ".json.gz"))
        if authoring["sha256"] != sha:
            raise ValueError("Mismatched authoring data: " + name)
        supplement = by_group[group]
        segments = [s for s in supplement["samples"] if s["source"] == name]
        poses = extra["offGridPoses"] + extra.get("outsideTimelinePoses", [])
        if any(p.get("evaluatedTick") != p["tick"] for p in poses):
            raise ValueError("Missing original tick verification: " + name)
        if len(segments) != len(extra["segments"]) or sum(
            s["source"] == name for s in supplement["scenes"]
        ) != len(segments) + len(poses):
            raise ValueError(
                "Missing Blender scene for additional pose or range: " + name
            )
        extra_max = max((s["maxErrorMetres"] for s in segments), default=0)
        if not math.isfinite(extra_max) or extra_max > max(
            mesh["extent"] * 0.001, 0.00001
        ):
            raise ValueError(f"Additional pose error {extra_max} m: {name}")
        blend = ROOT / item["blend"]
        blend_sha = file_hash(blend)
        if (
            not all(original["zipBytesMatch"])
            or sha != item["sourceSha256"]
            or sha != cache["sourceSha256"]
            or blend_sha != item["blendSha256"]
            or cache["sha256"] != item["cacheSha256"]
        ):
            raise ValueError("Source mismatch: " + name)
        for checked in [rig, mesh, triangles, bone_check]:
            if "error" in checked or checked.get("blendSha256") != blend_sha:
                raise ValueError("Missing or stale Blender inspection: " + name)
        if mesh["cacheSha256"] != cache["sha256"] or not mesh["allFrames"]:
            raise ValueError("Missing full-frame reference check: " + name)
        if any("vertexCountMismatch" in m for m in mesh["meshChecks"].values()):
            raise ValueError("Vertex count changed across frames: " + name)
        if sha not in unique:
            unique.add(sha)
            keys = key_times(sha, native)
            intervals, between, far = motion_ranges(
                keys, *extra["active"], extra["ticksPerFrame"]
            )
            if (
                extra["keyTicks"] != keys
                or [(s["first"], s["last"]) for s in extra["segments"]]
                != [(lo, hi) for _, lo, hi in intervals]
                or [p["tick"] for p in extra["offGridPoses"]] != between
                or [p["tick"] for p in extra.get("outsideTimelinePoses", [])] != far
            ):
                raise ValueError(
                    "Authored key coverage differs from original controller records: "
                    + name
                )
            if any(
                file_hash(base / "extended" / s["file"]) != s["sha256"]
                for s in extra["segments"]
            ):
                raise ValueError("Supplemental Alembic checksum mismatch: " + name)
            counts["uniqueSourceFrames"] += cache["last"] - cache["first"] + 1
            counts["bipFiles"] += receipt["bipeds"]
            counts["readableNativeKeys"] += receipt["keys"]
            counts["uniqueWithKeysOutsidePlayback"] += bool(extra["segments"])
            counts["additionalWholeFrames"] += sum(
                seg["last"] - seg["first"] for seg in extra["segments"]
            )
            counts["distinctOffGridPoses"] += len(extra["offGridPoses"])
            counts["outsideTimelinePoses"] += len(extra.get("outsideTimelinePoses", []))
            counts["bipedFigures"] += receipt["figures"]
        metrics = mesh["meshChecks"]
        worst = max((m["max"] for m in metrics.values()), default=0)
        materials_missing = []
        for image in rig["images"]:
            if not image["packed"]:
                materials_missing.append(image["file"] or "(empty bitmap slot)")
                materials.append(
                    {
                        "source": name,
                        "image": image["file"],
                        "originalPath": image["path"],
                    }
                )
        absent_names = []
        for ref in original["assetBitmaps"]:
            filename = ref.replace("\\", "/").rsplit("/", 1)[-1]
            if filename.casefold() not in textures:
                absent_names.append(filename)
                refs.append({"source": name, "declaredReference": ref})
        node = bone_check["comparison"]
        skin = node.get("skin", {})
        plugin_mods = sorted(
            {
                m["type"]
                for n in authored["nodes"]
                for m in n["modifiers"]
                if "missing" in m["type"].casefold()
            }
        )
        missing_modifiers.extend(
            {"source": name, "object": n["name"], "placeholder": m["type"]}
            for n in authored["nodes"]
            for m in n["modifiers"]
            if "missing" in m["type"].casefold()
        )
        row = {
            "source": name,
            "sourceSha256": sha,
            "blend": blend.relative_to(base).as_posix(),
            "blendSha256": blend_sha,
            "cache": "cache/" + sha + ".abc",
            "cacheSha256": cache["sha256"],
            "first": cache["first"],
            "last": cache["last"],
            "fps": cache["fps"],
            "nativeNodes": receipt["nodes"],
            "nativeMeshes": receipt["meshes"],
            "nativeUVAndMapChannels": receipt["mapChannels"],
            "nativeSkins": receipt["skins"],
            "nativeSkinVertices": receipt["skinVertices"],
            "basePolygonCages": len(authoring["cages"]),
            "skinEnvelopes": len(authoring["skins"]),
            "nativeKeys": receipt["keys"],
            "bipedMotions": receipt["bipeds"],
            "nativeKeyWarnings": receipt["trackWarnings"],
            "outsidePlaybackRanges": json.dumps(
                [[s["first"], s["last"]] for s in extra["segments"]]
            ),
            "authoredSubframeTicks": json.dumps(
                [p["tick"] for p in extra["offGridPoses"]]
            ),
            "keysOutsideBlenderTimeline": json.dumps(
                [p["tick"] for p in extra.get("outsideTimelinePoses", [])]
            ),
            "extendedSamplePoints": sum(s["samplePoints"] for s in segments),
            "extendedMaxErrorMetres": extra_max,
            "constraintSidecar": (
                native / "constraints" / (sha + ".json.gz")
            ).is_file(),
            "blenderDifferencesVsFbx": json.dumps(
                rig["differences"], ensure_ascii=False
            ),
            "correctedBones": json.dumps(
                report.get("restoredBones", {}), ensure_ascii=False
            ),
            "correctiveShapeKeys": json.dumps(
                report.get("correctiveShapeKeys", {}), ensure_ascii=False
            ),
            "restoredNativePaint": json.dumps(
                report.get("restoredNativePaint", {}), ensure_ascii=False
            ),
            "checkedMeshFrames": mesh["frames"],
            "checkedMeshVerticesOverTime": sum(
                m["vertexSamples"] for m in metrics.values()
            ),
            "maxVertexErrorPctOfSceneDiagonal": round(worst * 100, 8),
            "maxVertexErrorMetres": worst * mesh["extent"],
            "unmatchedMeshCount": len(mesh["unmatchedBlend"])
            + len(mesh["additionalCacheMeshes"]),
            "meshesWithDifferentFaces": sum(
                not m["topology"]["sameFaces"] for m in metrics.values()
            ),
            "meshesWithDifferentVertexUVs": sum(
                not m["topology"]["sameVertexUvs"] for m in metrics.values()
            ),
            "nativeTriangleCornerChecks": json.dumps(
                triangles["meshes"], ensure_ascii=False
            ),
            "cacheResolves": mesh["referenceResolves"],
            "nodeSampleFrames": node["frames"],
            "maxNodeErrorMetres": node["maxErrorMeters"],
            "skinWeightsOverTolerance": sum(
                s.get("overTolerance", 0) for s in skin.values()
            ),
            "nativeSkinWithoutEditableMesh": sum(
                s.get("unmatched", False) for s in skin.values()
            ),
            "evaluatedCacheMaxNodeErrorMetres": node["maxEvaluated"]["maxErrorMeters"],
            "maxVertexGroupWeightError": max(
                (s.get("maxError", 0) for s in skin.values()), default=0
            ),
            "pluginPlaceholders": " | ".join(plugin_mods),
            "unpackedImages": " | ".join(materials_missing),
            "declaredImagesAbsentByName": " | ".join(absent_names),
        }
        rows.append(row)
        counts["sources"] += 1
        counts["editableMeshWithinTolerance"] += (
            bool(metrics) and worst <= 0.001 and not row["unmatchedMeshCount"]
        )
        counts["editableMeshOutsideTolerance"] += worst > 0.001
        counts["sourcesWithUnmatchedMesh"] += bool(row["unmatchedMeshCount"])
        counts["sourcesWithMeshChecks"] += bool(metrics)
        counts["meshes"] += len(metrics)
        counts["meshesWithDifferentFaces"] += row["meshesWithDifferentFaces"]
        counts["meshesWithDifferentVertexUVs"] += row["meshesWithDifferentVertexUVs"]
        counts["extendedSamplePoints"] += row["extendedSamplePoints"]
        counts["sourcesWithMeshlessNative"] += receipt["meshes"] == 0
        counts["sampledMeshFrames"] += mesh["frames"]
        counts["vertexSamples"] += row["checkedMeshVerticesOverTime"]
        counts["sourcesWithUnpackedImage"] += bool(materials_missing)
        counts["sourcesWithMissingModifier"] += bool(plugin_mods)
        counts["sourcesWithNodeDifferences"] += bool(node["overTolerance"])
        counts["sourcesWithNativeWeightDifferences"] += bool(
            row["skinWeightsOverTolerance"]
        )
        counts["nativeSkinWithoutEditableMesh"] += row["nativeSkinWithoutEditableMesh"]
        counts["sourcesWithFaceCorrections"] += bool(item.get("restoredFaces"))
        counts["sourcesWithBoneOrShapeCorrections"] += bool(
            item.get("restoredBones") or item.get("correctiveShapeKeys")
        )
        counts["sourcesWithBoneCorrections"] += bool(report.get("restoredBones"))
        counts["sourcesWithRestoredNativePaint"] += bool(
            report.get("restoredNativePaint")
        )
        counts["sourcesWithShapeCorrections"] += bool(report.get("correctiveShapeKeys"))
    (output / "scenes.csv").write_bytes(csv_bytes(rows))
    extra_downloads = extended_download_index(base, by_group)
    if extra_downloads:
        (output / "extended-index.csv").write_bytes(csv_bytes(extra_downloads))
    for filename, entries in [
        ("missing-image-files.csv", refs),
        ("unpacked-material-images.csv", materials),
        ("missing-modifiers.csv", missing_modifiers),
    ]:
        if entries:
            (output / filename).write_bytes(csv_bytes(entries))
    counts["uniqueMaxFiles"] = len(unique)
    if sum(g["scenePaths"] for g in authoring_groups.values()) != len(rows):
        raise ValueError("Underlying polygon libraries do not cover all source paths")
    authoring_counts = collections.Counter()
    for group_report in authoring_groups.values():
        authoring_counts.update(group_report["verified"])
    save_json(output / "authoring-summary.json", dict(authoring_counts))
    missing = collections.defaultdict(set)
    active = collections.defaultdict(set)
    for ref in refs:
        missing[PureWindowsPath(ref["declaredReference"]).name.casefold()].add(
            ref["source"]
        )
    for slot in materials:
        active[PureWindowsPath(slot["image"]).name.casefold()].add(slot["source"])
    availability = read_json(base / "native/texture-reference-summary.json")
    if set(availability["absentArchiveNames"]) != set(missing):
        raise ValueError("Inventory and Blender report disagree on missing image names")
    counts["declaredImageNamesAbsent"] = len(missing)
    counts["unpackedMaterialSlots"] = len(materials)
    counts["missingModifierObjects"] = len(missing_modifiers)
    (output / "missing-images-by-name.csv").write_bytes(
        csv_bytes(
            [
                {
                    "name": name,
                    "declaredInScenes": len(scenes),
                    "unpackedInBlenderScenes": len(active[name]),
                    "installedNamesakes": " | ".join(
                        r["path"]
                        for r in availability["localCandidatesByName"].get(name, [])
                    ),
                    "sourcePaths": " | ".join(sorted(scenes)),
                }
                for name, scenes in sorted(missing.items())
            ]
        )
    )
    save_json(output / "summary.json", dict(counts))
    paths = {f.name: f for f in output.glob("*.csv")}
    paths["summary.json"] = output / "summary.json"
    paths["authoring-summary.json"] = output / "authoring-summary.json"
    authoring_archives = read_json(base / "authoring-verification.json")
    if authoring_archives["pending"] or authoring_archives["scenePaths"] != len(rows):
        raise ValueError("Authoring ZIP verification is incomplete")
    paths["authoring/archives.json"] = base / "authoring-verification.json"
    for group, info in authoring_groups.items():
        check = base / "authoring-edit-mode" / (group + ".json")
        edit = read_json(check)
        if edit["blendSha256"] != info["blendSha256"] or edit["errors"]:
            raise ValueError("Edit mode round trip failed: " + group)
        paths["authoring/edit-mode/" + check.name] = check
    for filename in (
        "source-audit.csv",
        "texture-references.csv",
        "texture-reference-summary.json",
        "inventory.json",
        "compound.json.gz",
        "verification.json",
        "envelopes/verification.json",
        "envelopes/roundtrip.json",
        "envelopes/authoring-audit.csv",
    ):
        paths["native/" + filename] = base / "native" / filename
    paths["README.md"] = ROOT / "docs/MAX-PRESERVATION.md"
    for proof in (
        "verify/final_audit.json",
        "verify/ella-original-polygons.json",
        "verify/extended-zip-reopen.json",
        "verify/group-zip-reopen.json",
        "transfer-blender-verification.json",
        "authoring-edit-mode-summary.json",
    ):
        if (base / proof).is_file():
            paths[proof] = base / proof
    pack(
        "Player-audit",
        paths,
        csv_bytes(
            [{"file": n, "sha256": file_hash(p)} for n, p in sorted(paths.items())]
        ),
    )
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    build()
