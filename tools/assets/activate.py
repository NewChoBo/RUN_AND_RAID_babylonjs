"""Install one fully rigged, self-contained GLB for the playable hero after clip assembly."""
import argparse
import json
import re
import struct
from pathlib import Path
from library import PUBLIC, ROOT, digest, save_json, write_changed

CLIPS = {"run", "walk", "jump", "fall", "basic", "pulse", "bolt", "field", "fury"}

def fighter_materials(data):
    """Player body diffuse alpha stores a mask. All approved game outfits render opaque."""
    json_size = struct.unpack_from("<I", data, 12)[0]
    model = json.loads(data[20:20 + json_size])
    changed = False
    for material in model.get("materials", []):
        if material.get("alphaMode", "OPAQUE") != "OPAQUE":
            material.pop("alphaMode", None)
            material.pop("alphaCutoff", None)
            changed = True
    if not changed:
        return data
    chunk = json.dumps(model, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    chunk += b" " * (-len(chunk) % 4)
    rest = data[20 + json_size:]
    return struct.pack("<4sIII4s", b"glTF", 2, 20 + len(chunk) + len(rest), len(chunk), b"JSON") + chunk + rest


def activate(hero, path):
    ids = re.findall(r"'([a-z0-9-]+)'", (ROOT/"src/game/raid/heroes/hero-id.ts").read_text("utf8"))
    if hero not in ids:
        raise ValueError("Unknown playable hero")
    data = path.read_bytes()
    magic, version, size, jsize, kind = struct.unpack_from("<4sIII4s", data)
    if (magic, version, size, kind) != (b"glTF", 2, len(data), b"JSON"):
        raise ValueError("Expected a complete binary glTF 2.0 file")
    model = json.loads(data[20:20+jsize])
    if not model.get("skins") or not any("skin" in n and "mesh" in n for n in model.get("nodes",[])):
        raise ValueError("This actor needs a skinned mesh")
    if any("uri" in entry for entry in model["buffers"]+model.get("images",[])):
        raise ValueError("Embed buffers and textures in the GLB")
    clips = {a.get("name"): a for a in model.get("animations", [])}
    if missing := CLIPS-clips.keys():
        raise ValueError("Missing clips: "+", ".join(sorted(missing)))
    for name in CLIPS:
        clip = clips[name]
        if not clip["channels"] or any(c["target"].get("path") not in {"translation","rotation","scale"} for c in clip["channels"]):
            raise ValueError(f"Expected transform tracks in {name}")
        times = [model["accessors"][s["input"]] for s in clip["samplers"]]
        if not any(t.get("max",[0])[0]>t.get("min",[0])[0] for t in times):
            raise ValueError(f"No duration for {name}")
    signature=digest(data)
    # The descriptor changes only after the new, immutable GLB is in place.
    file=f"playable/{hero}-{signature[:16]}.glb"
    write_changed(PUBLIC/file,data)
    save_json(ROOT/"src/content/raid/ready-heroes"/(hero+".json"),{"file":file})
    return file


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("hero")
    parser.add_argument("glb",type=Path)
    args=parser.parse_args()
    try:
        print(activate(args.hero,args.glb))
    except (ValueError,KeyError,IndexError,struct.error) as e:
        parser.exit(1,str(e)+"\n")
