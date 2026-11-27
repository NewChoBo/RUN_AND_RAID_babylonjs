"""Local paths and manifests shared by the Player asset preparation tools."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "asset-sources" / "player"
WORK = ROOT / ".asset-work"
PUBLIC = ROOT / "public" / "player-assets"
INDEX = WORK / "sources.json"
RECORDS = WORK / "conversions"
IMPORTER = WORK / "io_scene_max"
REVISION = "37db107126f956f7219152671443080360565691"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_changed(path, data):
    if path.is_file() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    temporary.write_bytes(data)
    temporary.replace(path)


def save_json(path, value):
    write_changed(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def read_json(path):
    return json.loads(path.read_text("utf-8"))


def publish():
    manifest = read_json(INDEX)
    for item in manifest["files"]:
        record = RECORDS / (item["id"] + ".json")
        if record.exists():
            conversion = read_json(record)
            if conversion.get("archive") == manifest["sha256"]:
                item.update({k: v for k, v in conversion.items() if k != "archive"})
    save_json(PUBLIC / "catalog.json", manifest)
