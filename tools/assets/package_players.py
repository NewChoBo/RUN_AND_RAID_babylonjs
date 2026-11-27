"""Package the full private GLB library by group and install approved game outfits."""

import argparse
import csv
import hashlib
import io
import json
import struct
import zipfile
from pathlib import Path

from activate import fighter_materials
from asset_names import fbx_path, outfit_name, source_stem
from convert import fbx_for
from library import PUBLIC, ROOT, SOURCE, WORK, read_json, save_json, write_changed


def inspect(data):
    magic, version, length, size, kind = struct.unpack_from("<4sIII4s", data)
    if (magic, version, length, kind) != (b"glTF", 2, len(data), b"JSON"):
        raise ValueError("Invalid GLB file")
    doc = json.loads(data[20 : 20 + size])
    if any("uri" in resource for resource in doc.get("images", []) + doc.get("buffers", [])):
        raise ValueError("External resource in portable GLB")
    return doc


def package_fbx(groups, work, timeline):
    with timeline.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames)
        records = {}
        for row in reader:
            source = row.get("원본 MAX 경로") or Path(row["FBX 상대경로"]).with_suffix(".max").as_posix()
            if source in records:
                raise ValueError(f"Duplicate FBX timeline entry: {source}")
            records[source] = row
    if "원본 MAX 경로" not in fields:
        fields.insert(fields.index("FBX 상대경로"), "원본 MAX 경로")
    scenes = {i["path"] for rows in groups.values() for i in rows if i["kind"] in {"motion", "scene"}}
    if scenes != records.keys():
        raise ValueError("FBX timeline must cover every original scene")
    folder = work / "FBX"
    folder.mkdir(exist_ok=True)
    for group, rows in groups.items():
        archive = folder / (group + ".zip")
        tmp = archive.with_suffix(".partial.zip")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as bundle:
            for item in rows:
                source = item["path"]
                if source in scenes:
                    member = fbx_path(item).as_posix()
                    records[source].update({"원본 MAX 경로": source, "FBX 상대경로": member})
                    bundle.write(fbx_for(item), member)
                elif item["kind"] == "texture":
                    # External bitmap references in the native scenes use the original TGA names.
                    bundle.write(SOURCE / source, source)
        with zipfile.ZipFile(tmp) as bundle:
            if bundle.testzip():
                raise ValueError(f"FBX archive CRC mismatch: {group}")
        tmp.replace(archive)
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=fields)
    writer.writeheader()
    writer.writerows(records.values())
    write_changed(work / "fbx-index.csv", buf.getvalue().encode("utf-8-sig"))


def write_drive_checksums(work, groups):
    files = [work / kind / (group + ext)
             for kind, ext in [("FBX", ".zip"), ("Blender", ".blend"), ("GLB", ".zip")]
             for group in sorted(groups)]
    sums = []
    for file in [*files, work / "fbx-index.csv"]:
        with file.open("rb") as stream:
            sha = hashlib.file_digest(stream, "sha256").hexdigest()
        sums.append(f"{sha}  {file.relative_to(work).as_posix()}\n")
    write_changed(work / "SHA256SUMS.txt", "".join(sums).encode())


def main(timeline=None, selected=()):
    work = WORK / "player-release"
    groups = {}
    for row in read_json(PUBLIC / "catalog.json")["files"]:
        groups.setdefault(row["group"], []).append(row)
    selected = {g.casefold() for g in selected} or {g.casefold() for g in groups}
    unknown = selected - {g.casefold() for g in groups}
    if unknown:
        raise ValueError(f"Unknown Player groups: {sorted(unknown)}")
    if timeline:
        package_fbx(groups, work, timeline)
    manifest = ROOT / "src/content/raid/published-outfits.json"
    approved = read_json(manifest)
    if len({outfit_name(i["group"], i["skin"]) for i in approved}) != len(approved):
        raise ValueError("Duplicate published outfit filename")
    hashes = ROOT / ".github/pages-assets.sha256"
    checksums = {
        path: sha
        for sha, path in (line.split("  ", 1) for line in hashes.read_text("utf8").splitlines())
    }
    public_root = ROOT / "public"
    archive_folder = work / "GLB"
    archive_folder.mkdir(parents=True, exist_ok=True)
    installed = []
    for group, rows in groups.items():
        if group.casefold() not in selected:
            continue
        archive = archive_folder / (group + ".zip")
        tmp = archive.with_suffix(".partial.zip")
        entries = []
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as bundle:
            for item in rows:
                if item["kind"] not in {"scene", "motion"}:
                    continue
                relative = source_stem(item) + ".glb"
                data = (PUBLIC / item["model"]).read_bytes()
                inspect(data)
                bundle.writestr("Scenes/" + relative, data)
                entries.append(
                    {
                        "source": item["path"],
                        "file": "Scenes/" + relative,
                        "state": item["state"],
                        "missingImages": item["missingBitmaps"],
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                )
            for outfit in approved:
                if outfit["group"] != group.lower():
                    continue
                skin = outfit["skin"]
                filename = outfit_name(group, skin)
                folder = work / "Fighters" / group.lower()
                path = folder / filename
                if not path.exists():
                    path = folder / (skin + ".glb")
                data = fighter_materials(path.read_bytes())
                doc = inspect(data)
                if not doc.get("meshes"):
                    raise ValueError("Missing body mesh: " + str(path))
                sha = hashlib.sha256(data).hexdigest()
                asset = "assets/fighters/" + filename
                write_changed(public_root / asset, data)
                checksums[asset] = sha
                clips = [a["name"] for a in doc.get("animations", [])]
                installed.append(
                    {"group": group.lower(), "skin": skin, "model": "./" + asset, "clips": clips}
                )
                relative = "Outfits/" + filename
                bundle.writestr(relative, data)
                entries.append(
                    dict(file=relative, sha256=sha, **read_json(path.with_suffix(".json")))
                )
            if group.casefold() == "longshot":
                reference = WORK / "longshot-grip.json"
                bundle.write(reference, "Reference/longshot-grip.json")
            bundle.writestr("index.json", json.dumps(entries, ensure_ascii=False, indent=2))
        with zipfile.ZipFile(tmp) as bundle:
            if bundle.testzip():
                raise ValueError("GLB archive CRC mismatch")
        tmp.replace(archive)
    if len(installed) != sum(i["group"] in selected for i in approved):
        raise ValueError("Incomplete game outfit set")
    by_key = {(i["group"], i["skin"]): i for i in installed}
    installed = [by_key.get((i["group"], i["skin"]), i) for i in approved]
    if approved != installed:
        save_json(manifest, installed)
    write_changed(
        hashes, "".join(f"{checksums[p]}  {p}\n" for p in sorted(checksums)).encode("utf8")
    )
    if timeline or (work / "fbx-index.csv").exists():
        write_drive_checksums(work, groups)
    print("Packaged", len(selected), "groups and", len(by_key), "game outfits")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fbx-index", type=Path, help="Also package native FBX files, timeline and Drive checksums")
    parser.add_argument("--groups", nargs="+", help="Only rebuild these groups' game outfits and GLB archives")
    args = parser.parse_args()
    main(args.fbx_index, args.groups or ())
