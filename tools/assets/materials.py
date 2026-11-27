"""Reconnect renamed/relocated diffuse atlases without modifying original TGA files."""
import io
import json
import re
import struct
from pathlib import Path
from PIL import Image
from library import INDEX, PUBLIC, RECORDS, publish, read_json, save_json, write_changed


def diffuse(texture):
    name = Path(texture["path"]).stem.lower()
    return not re.search(r"normal|glow|bump|specular|opacity|emiss|mask", name)


def choose_texture(material, item, textures):
    refs = {Path(n).stem.lower() for n in item.get("bitmaps", [])}
    name = material.get("name", "").lower()
    def one(matches, reason):
        return (matches[0], reason) if len(matches) == 1 else (None, "")
    exact = [r for r in textures if Path(r["path"]).stem.lower() in name]
    if exact:
        return one(exact, "material-name")
    linked = [r for r in textures if Path(r["path"]).stem.lower() in refs]
    if len(linked) == 1:
        return one(linked, "scene-reference")
    # The production source often refers to an earlier hero codename or resolution.
    # Require the same hero folder and an unambiguous skin token before guessing.
    tokens = set(re.findall(r"[a-z0-9]+", name))
    scene_tokens = set(re.findall(r"[a-z0-9]+", Path(item["path"]).stem.lower()))
    def match(pool):
        return [r for r in textures if len(t := Path(r["path"]).stem.lower().split("#")) > 1 and t[1] in pool]
    for pool in (tokens, scene_tokens):
        candidates = match(pool)
        if len(candidates) == 1:
            return one(candidates, "skin-name")
    return None, ""


def reconnect(item, record, textures):
    path = PUBLIC / record["model"]
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    binary = bytearray(data[28 + length:][:doc["buffers"][0]["byteLength"]])
    mats = doc.setdefault("materials", [])
    # A primitive can have UVs and no material when the original shader was unsupported.
    used = set()
    default = None
    for mesh in doc["meshes"]:
        for p in mesh["primitives"]:
            if "TEXCOORD_0" not in p.get("attributes", {}):
                continue
            if "material" not in p:
                if default is None:
                    default = len(mats)
                    mats.append({"name": "Source atlas", "doubleSided": True})
                p["material"] = default
            used.add(p["material"])
    matches, indices = {}, {}
    for idx in sorted(used):
        mat = mats[idx]
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            continue
        r, reason = choose_texture(mat, item, textures)
        if not r:
            continue
        if r["id"] not in indices:
            with Image.open(PUBLIC / r["texture"]) as im:
                buffer = io.BytesIO()
                image = im if mat.get("alphaMode", "OPAQUE") != "OPAQUE" else im.convert("RGB")
                image.save(buffer, "PNG", compress_level=2)
            content = buffer.getvalue()
            binary.extend(b"\0" * (-len(binary) % 4))
            offset = len(binary)
            binary.extend(content)
            views = doc.setdefault("bufferViews", [])
            views.append(dict(buffer=0, byteOffset=offset, byteLength=len(content)))
            images = doc.setdefault("images", [])
            images.append(dict(bufferView=len(views)-1, mimeType="image/png", name=Path(r["path"]).stem))
            samplers = doc.setdefault("textures", [])
            samplers.append(dict(source=len(images)-1))
            indices[r["id"]] = len(samplers)-1
        pbr.update(baseColorTexture={"index": indices[r["id"]]}, baseColorFactor=[1,1,1,1], metallicFactor=0)
        matches[str(idx)] = reason + " / " + r["path"]
    if matches:
        doc["buffers"][0]["byteLength"] = len(binary)
        binary.extend(b"\0" * (-len(binary) % 4))
        js = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf8")
        js += b" " * (-len(js) % 4)
        payload = struct.pack("<I4s",len(js),b"JSON")+js+struct.pack("<I4s",len(binary),b"BIN\0")+binary
        write_changed(path, struct.pack("<4sII",b"glTF",2,12+len(payload))+payload)
    record["materialMatches"] = matches
    record["embeddedImages"] = len(doc.get("images", []))
    record["materialsChecked"] = True


def main():
    manifest = read_json(INDEX)
    textures = [r for r in manifest["files"] if r["kind"]=="texture" and diffuse(r)]
    for item in manifest["files"]:
        rp = RECORDS / (item["id"] + ".json")
        if not rp.is_file():
            continue
        record = read_json(rp)
        if record.get("state") != "static" or record.get("materialsChecked") or record.get("recipe", [])[2] != "static":
            continue
        reconnect(item, record, [t for t in textures if t["group"] == item["group"]])
        save_json(rp, record)
    publish()


if __name__ == "__main__":
    main()
