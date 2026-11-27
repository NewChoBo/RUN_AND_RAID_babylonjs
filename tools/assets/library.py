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
    publish_outfits(manifest["files"])

def publish_outfits(files):
    # Root scenes are bodies/skins; nested scenes include individual action poses.
    outfits = []
    for item in files:
        parts = item["path"].split("/")
        if len(parts) != 2 or item.get("state") not in {"static", "animated"} or not item.get("model"):
            continue
        group, filename = parts
        stem = Path(filename).stem.lower()
        if group.lower() == "base":
            skin = stem
        elif stem == group.lower() and group.lower() in {"demon", "shaman"}:
            skin = "default"
        elif stem.startswith(("ella#bird#", "ella#bigbird#")):
            skin = stem.removeprefix("ella#")
        else:
            fields = stem.split("#")
            if len(fields) != 2 or "_" in fields[1] or fields[1] in {"bullet", "coffin"}:
                continue
            skin = fields[1]
        outfits.append({"group": group.lower(), "skin": skin, "model": item["model"]})
    save_json(ROOT / "src/content/raid/local-outfits.json", outfits)
