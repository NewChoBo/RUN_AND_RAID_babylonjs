"""Validate the source archive, preserve every entry and decode image resources locally."""
import argparse
import hashlib
import io
import os
import re
import struct
import zipfile
from pathlib import Path, PurePosixPath
import olefile
from PIL import Image
from library import INDEX, PUBLIC, SOURCE, digest, publish, save_json, write_changed


def png(image):
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def preview(document):
    stream = "\x05SummaryInformation"
    if not document.exists(stream):
        return None
    blob = document.getproperties(stream).get(17)
    if not isinstance(blob, bytes):
        return None
    marker = struct.pack("<I", 40)
    for offset in range(min(256, len(blob) - 40)):
        if blob[offset:offset + 4] != marker:
            continue
        _, w, h, planes, depth = struct.unpack_from("<IiiHH", blob, offset)
        if planes != 1 or depth not in (8, 16, 24, 32) or not (0 < w <= 1024 and 0 < abs(h) <= 1024):
            continue
        try:
            with Image.open(io.BytesIO(blob[offset:])) as im:
                return png(im.convert("RGB"))
        except (OSError, ValueError):
            continue
    return None


def bitmap_names(document):
    stream = "FileAssetMetaData2"
    if not document.exists(stream):
        return []
    strings = document.openstream(stream).read().decode("utf-16-le", errors="ignore").split("\0")
    result = set()
    for entry in strings:
        name = entry.replace("\\", "/").rsplit("/", 1)[-1]
        if re.fullmatch(r"[^<>:|?*/\x00-\x1f]+\.(tga|png|bmp|jpg|dds|tif)", name, re.I):
            result.add(name)
    return sorted(result, key=str.casefold)


def main(archive):
    with archive.open("rb") as original:
        archive_hash = hashlib.file_digest(original, "sha256").hexdigest()
    files = []
    seen = set()
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            if entry.is_dir():
                continue
            name = entry.filename
            if not entry.flag_bits & 0x800:
                try:
                    name = name.encode("cp437").decode("cp949")
                except UnicodeError:
                    pass
            path = PurePosixPath(name)
            dest = SOURCE.joinpath(*path.parts).resolve()
            if (not dest.is_relative_to(SOURCE.resolve()) or path.is_absolute() or len(path.parts) < 2
                    or any(p in (".", "..") or ":" in p or "\\" in p or p.endswith((".", " ")) for p in path.parts)
                    or name.casefold() in seen or os.path.isreserved(str(dest.name))):
                raise ValueError(f"Conflicting archive path: {name}")
            seen.add(name.casefold())
            data = source.read(entry)
            write_changed(dest, data)
            key = digest(name.encode())[:24]
            item = dict(id=key, path=name, group=path.parts[0], bytes=len(data), sha256=digest(data))
            if path.suffix.lower() == ".tga":
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
                    item.update(kind="texture", width=image.width, height=image.height,
                                channels=image.mode, texture=f"textures/{key}.png")
                    # Store the original color and alpha channels for authoring.
                    write_changed(PUBLIC / item["texture"], png(image))
                    small = image.convert("RGB")
                    small.thumbnail((180, 140), Image.Resampling.LANCZOS)
                    thumbnail = png(small)
                item["state"] = "texture"
            elif path.suffix.lower() == ".max":
                motion = any(p.casefold() in ("animation", "animaion") for p in path.parts[1:-1])
                with olefile.OleFileIO(io.BytesIO(data)) as document:
                    if not document.exists("Scene"):
                        raise ValueError(f"Missing MAX scene stream: {name}")
                    item.update(kind="motion" if motion else "scene", bitmaps=bitmap_names(document))
                    thumbnail = preview(document)
                item["state"] = "source"
            else:
                item.update(kind="source", state="source")
                thumbnail = None
            if thumbnail:
                item["thumbnail"] = f"previews/{digest(thumbnail)[:24]}.png"
                write_changed(PUBLIC / item["thumbnail"], thumbnail)
            files.append(item)
    if len({i["id"] for i in files}) != len(files):
        raise ValueError("Duplicate asset ID")
    save_json(INDEX, {"version": 1, "archive": archive.name, "sha256": archive_hash, "files": files})
    publish()
    print(f"Prepared {len(files)} source files from {archive.name}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    main(parser.parse_args().archive)
