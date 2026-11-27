"""Package the full private GLB library by group and install approved game outfits."""

import hashlib
import json
import struct
import zipfile
from pathlib import Path

from activate import fighter_materials
from library import PUBLIC, ROOT, WORK, read_json, save_json, write_changed


def inspect(data):
    magic, version, length, size, kind = struct.unpack_from("<4sIII4s", data)
    if (magic, version, length, kind) != (b"glTF", 2, len(data), b"JSON"):
        raise ValueError("Invalid GLB file")
    doc = json.loads(data[20 : 20 + size])
    if any("uri" in resource for resource in doc.get("images", []) + doc.get("buffers", [])):
        raise ValueError("External resource in portable GLB")
    return doc


def main():
    work = WORK / "player-release"
    groups = {}
    for row in read_json(PUBLIC / "catalog.json")["files"]:
        groups.setdefault(row["group"], []).append(row)
    manifest = ROOT / "src/content/raid/published-outfits.json"
    approved = read_json(manifest)
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
        archive = archive_folder / (group + ".zip")
        tmp = archive.with_suffix(".partial.zip")
        entries = []
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as bundle:
            for item in rows:
                if item["kind"] not in {"scene", "motion"}:
                    continue
                relative = Path(item["path"]).relative_to(group).with_suffix(".glb").as_posix()
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
                path = work / "Fighters" / group.lower() / (skin + ".glb")
                data = fighter_materials(path.read_bytes())
                doc = inspect(data)
                if not doc.get("meshes"):
                    raise ValueError("Missing body mesh: " + str(path))
                sha = hashlib.sha256(data).hexdigest()
                asset = "assets/fighters/" + sha[:20] + ".glb"
                write_changed(public_root / asset, data)
                checksums[asset] = sha
                clips = [a["name"] for a in doc.get("animations", [])]
                installed.append(
                    {"group": group.lower(), "skin": skin, "model": "./" + asset, "clips": clips}
                )
                relative = "Outfits/" + path.name
                bundle.writestr(relative, data)
                entries.append(
                    dict(file=relative, sha256=sha, **read_json(path.with_suffix(".json")))
                )
            bundle.writestr("index.json", json.dumps(entries, ensure_ascii=False, indent=2))
        with zipfile.ZipFile(tmp) as bundle:
            if bundle.testzip():
                raise ValueError("GLB archive CRC mismatch")
        tmp.replace(archive)
    if len(installed) != len(approved):
        raise ValueError("Incomplete game outfit set")
    by_key = {(i["group"], i["skin"]): i for i in installed}
    save_json(manifest, [by_key[i["group"], i["skin"]] for i in approved])
    write_changed(
        hashes, "".join(f"{checksums[p]}  {p}\n" for p in sorted(checksums)).encode("utf8")
    )
    print("Packaged", len(groups), "groups and", len(installed), "game outfits")


if __name__ == "__main__":
    main()
