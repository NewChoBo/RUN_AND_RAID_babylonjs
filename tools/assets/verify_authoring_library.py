"""Read back Authoring ZIPs and re-enter Edit Mode on every original Blender cage."""

import argparse
import csv
import gzip
import io
import json
import zipfile
from collections import Counter

from library import WORK, read_json, save_json
from package_max_scenes import file_hash


def load_gzip(path):
    with gzip.open(path, "rt", encoding="utf8") as stream:
        return json.load(stream)


class MissingSourceGeometry(ValueError):
    """A known primitive has not yet arrived in its supplementary native export."""


def expected_members(base, group, rows):
    members = {f"authoring/{group}.blend", f"authoring/{group}.json"}
    directory = base / "native/envelopes"
    for sha in {s["sourceSha256"] for s in rows}:
        path = directory / (sha + ".json.gz")
        meta = load_gzip(path)
        members.add(path.relative_to(base).as_posix())
        for record in meta["skins"] + meta["cages"]:
            sidecar = directory / record["file"]
            members.add(sidecar.relative_to(base).as_posix())
            if sidecar.name.endswith(".poly.gz"):
                edges = sidecar.with_name(sidecar.name.replace(".poly.gz", ".edges.gz"))
                if edges.is_file():
                    members.add(edges.relative_to(base).as_posix())
        extra = directory / (sha + ".extra.json.gz")
        restored = set()
        if extra.is_file():
            members.add(extra.relative_to(base).as_posix())
            for record in load_gzip(extra)["objects"]:
                restored.add(record["node"])
                if shape := record.get("polyShape"):
                    for key in ("file", "edgeVisibility"):
                        members.add(
                            (directory / shape[key]).relative_to(base).as_posix()
                        )
        source = load_gzip(base / "native/scenes" / (sha + ".json.gz"))
        for node in source["nodes"]:
            if (
                node.get("mesh")
                and node["type"] not in {"PolyMeshObject", "Editable_Poly"}
                and node["handle"] not in restored
            ):
                raise MissingSourceGeometry(
                    f"{source['source']}: {node['name']} ({node['type']}) has no supplementary authoring capture"
                )
    return members


def verify_archive(base, group, rows):
    import hashlib

    path = base / "packages/Authoring" / (group + ".zip")
    with zipfile.ZipFile(path) as archive:
        index = list(
            csv.DictReader(io.StringIO(archive.read("index.csv").decode("utf-8-sig")))
        )
        identifiers = [(s["source"], s["sourceSha256"]) for s in rows]
        if [(s["source"], s["sourceSha256"]) for s in index] != identifiers:
            raise ValueError(f"{group}: original MAX path coverage differs")
        sources = expected_members(base, group, rows)
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != {
            *sources,
            "index.csv",
            "SHA256SUMS.txt",
        }:
            raise ValueError(
                f"{group}: archive member set differs from original sources"
            )
        checksums = {
            member: sha
            for sha, member in (
                line.split("  ", 1)
                for line in archive.read("SHA256SUMS.txt").decode().splitlines()
            )
        }
        if set(checksums) != {*sources, "index.csv"}:
            raise ValueError(f"{group}: checksum coverage differs")
        for name, expected in checksums.items():
            with archive.open(name) as stream:
                stored = hashlib.file_digest(stream, "sha256").hexdigest()
            if (
                stored != expected
                or name in sources
                and file_hash(base / name) != stored
            ):
                raise ValueError(f"{group}/{name}: restored member differs")
        report = json.loads(archive.read(f"authoring/{group}.json"))
        if report["blendSha256"] != checksums[f"authoring/{group}.blend"]:
            raise ValueError(f"{group}: scene reopen receipt is stale")
        metrics = report["verified"]
        summary = {
            "bytes": path.stat().st_size,
            "sha256": file_hash(path),
            "scenePaths": len(rows),
            "distinctMax": len({sha for _, sha in identifiers}),
            "members": len(archive.namelist()),
        }
    return metrics, summary


def check_edit_mode(base, group, force):
    import bpy
    from native_authoring_extras import mesh_extras
    from native_poly_blend import restore_cage
    from verify_native_preservation import Buffer

    path = base / "authoring" / (group + ".blend")
    sha = file_hash(path)
    target = base / "authoring-edit-mode" / (group + ".json")
    if not force and target.is_file():
        previous = read_json(target)
        if previous["blendSha256"] == sha and not previous["errors"]:
            return previous
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    directory = base / "native/envelopes"
    tables = bpy.data.collections["Max map vertex tables"]
    seen = set()
    result = {
        "group": group,
        "blendSha256": sha,
        "passed": 0,
        "triangles": 0,
        "linkedMeshInstances": 0,
        "errors": [],
    }
    for scene in bpy.data.scenes:
        bpy.context.window.scene = scene
        for obj in scene.objects:
            if obj.type != "MESH" or not (
                "max_node_handle" in obj or "max_extra_handle" in obj
            ):
                continue
            key = obj.data.as_pointer()
            if key in seen:
                result["linkedMeshInstances"] += 1
                continue
            seen.add(key)
            try:
                bpy.ops.object.select_all(action="DESELECT")
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.object.mode_set(mode="OBJECT")
                if "max_extra_handle" in obj:
                    meta = load_gzip(
                        directory / (scene["source_sha256"] + ".extra.json.gz")
                    )
                    source = next(
                        r
                        for r in meta["objects"]
                        if r["node"] == obj["max_extra_handle"]
                    )
                    mesh_extras(obj.data, directory, source["polyShape"], tables, True)
                    result["triangles"] += 1
                else:
                    source = directory / obj["max_table"]
                    extra = source.with_name(
                        source.name.replace(".poly.gz", ".edges.gz")
                    )
                    restore_cage(
                        obj.data,
                        Buffer(source),
                        tables,
                        True,
                        Buffer(extra) if extra.is_file() else None,
                    )
                result["passed"] += 1
            except Exception as error:  # noqa: BLE001 -- Preserve evidence for each independent mesh.
                result["errors"].append(
                    {
                        "source": scene["source_max"],
                        "node": obj["max_source_name"],
                        "error": str(error),
                    }
                )
    save_json(target, result)
    return result


def run(mode, partial, force):
    base = WORK / "max-preservation"
    rows = read_json(base / "blend/index.json")["scenes"]
    groups = sorted({s["group"] for s in rows})
    pending = []
    totals = Counter()
    archives = {}
    covered = set()
    unique = set()
    edit_errors = []
    edit_totals = Counter()
    for group in groups:
        if not (base / "packages/Authoring" / (group + ".zip")).is_file():
            pending.append(group)
            continue
        selected = [s for s in rows if s["group"] == group]
        if mode in ("all", "archives"):
            try:
                counts, archives[group] = verify_archive(base, group, selected)
            except MissingSourceGeometry as error:
                print(error, flush=True)
                pending.append(group)
                continue
            totals.update(counts)
            covered.update(s["source"] for s in selected)
            unique.update(s["sourceSha256"] for s in selected)
        if mode in ("all", "edit-mode"):
            proof = check_edit_mode(base, group, force)
            edit_errors.extend(proof["errors"])
            edit_totals.update(
                {k: proof[k] for k in ("passed", "triangles", "linkedMeshInstances")}
            )
    if mode in ("all", "archives"):
        result = {
            "groups": len(archives),
            "scenePaths": len(covered),
            "uniqueMax": len(unique),
            "bytes": sum(s["bytes"] for s in archives.values()),
            "verified": dict(sorted(totals.items())),
            "pending": pending,
            "archives": archives,
        }
        save_json(base / "authoring-verification.json", result)
        print(
            result["groups"],
            "archives;",
            result["scenePaths"],
            "source paths;",
            result["bytes"],
            "bytes",
        )
    if mode in ("all", "edit-mode"):
        report = {
            "groups": len(groups) - len(pending),
            "pending": pending,
            "errors": edit_errors,
            **dict(edit_totals),
        }
        save_json(base / "authoring-edit-mode-summary.json", report)
        print("Edit Mode", dict(edit_totals), "errors", len(edit_errors))
    if edit_errors or not partial and pending:
        raise SystemExit(f"{len(edit_errors)} edit errors; missing groups: {pending}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode", choices=("all", "archives", "edit-mode"), default="all"
    )
    parser.add_argument(
        "--partial",
        action="store_true",
        help="Check only completed archives while native capture is running",
    )
    parser.add_argument(
        "--force-edit",
        action="store_true",
        help="Repeat Edit Mode round trips even on already verified file hashes",
    )
    args = parser.parse_args()
    run(args.mode, args.partial, args.force_edit)
