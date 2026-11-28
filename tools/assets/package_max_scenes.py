"""Package editable Blender scenes, their relative Alembic caches and native audit data."""

import argparse
import csv
import hashlib
import io
import os
import shutil
import zipfile
from pathlib import Path

from library import PUBLIC, ROOT, SOURCE, WORK, read_json

PRESERVATION = WORK / "max-preservation"
PACKAGES = PRESERVATION / "packages"


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def csv_bytes(rows):
    result = io.StringIO(newline="")
    writer = csv.DictWriter(result, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return result.getvalue().encode("utf-8-sig")


def pack(name, paths, index):
    target = PACKAGES / (name + ".zip")
    target.parent.mkdir(exist_ok=True, parents=True)
    temporary = target.with_suffix(".partial.zip")
    checksums = []
    with zipfile.ZipFile(
        temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True
    ) as z:
        for archive_name, path in sorted(paths.items()):
            checksums.append(file_hash(path) + "  " + archive_name)
            z.write(path, archive_name)
        z.writestr("index.csv", index)
        checksums.append(hashlib.sha256(index).hexdigest() + "  index.csv")
        z.writestr("SHA256SUMS.txt", "\n".join(checksums) + "\n")
    with zipfile.ZipFile(temporary) as z:
        for line in checksums:
            expected, member = line.split("  ", 1)
            with z.open(member) as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise ValueError("Archive verification failed: " + member)
    temporary.replace(target)
    print(target.name, target.stat().st_size, file_hash(target), flush=True)


def pack_media():
    from PIL import Image

    assets = read_json(PUBLIC / "catalog.json")["files"]
    rows, paths = [], {}
    for item in assets:
        source = item["path"]
        if item["kind"] == "texture":
            png = PUBLIC / item["texture"]
            with Image.open(SOURCE / source) as tga, Image.open(png) as converted:
                if (
                    tga.size != converted.size
                    or tga.convert("RGBA").tobytes()
                    != converted.convert("RGBA").tobytes()
                ):
                    raise ValueError("RGBA mismatch: " + source)
            name = item["texture"]
        elif item.get("thumbnail"):
            name = item["thumbnail"]
        else:
            continue
        paths[name] = PUBLIC / name
        rows.append({"source": source, "sourceSha256": item["sha256"], "file": name})
    pack("Textures-and-previews", paths, csv_bytes(rows))


def pack_blender_images():
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    images = [
        i for i in read_json(PUBLIC / "catalog.json")["files"] if i["kind"] == "texture"
    ]
    for item in images:
        image = bpy.data.images.load(str(SOURCE / item["path"]), check_existing=False)
        image.name = Path(item["path"]).stem
        image.use_fake_user = True
        image["source_path"] = item["path"]
        image["source_sha256"] = item["sha256"]
        image.pack()
        image.filepath = "//" + item["path"]
    target = PACKAGES / "Player-textures.blend"
    temporary = target.with_suffix(".partial.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(temporary), compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(temporary), use_scripts=False)
    reopened = {im["source_path"]: im for im in bpy.data.images if "source_path" in im}
    if set(reopened) != {item["path"] for item in images}:
        raise ValueError("Texture library lost image datablocks")
    for item in images:
        image = reopened[item["path"]]
        if (
            not image.packed_file
            or hashlib.sha256(image.packed_file.data).hexdigest() != item["sha256"]
        ):
            raise ValueError("Packed source image checksum mismatch: " + item["path"])
    temporary.replace(target)
    print(target.name, len(reopened), "verified original TGA payloads", flush=True)


def up_to_date(target, paths, index):
    if not target.is_file():
        return False
    with zipfile.ZipFile(target) as z:
        if (
            set(z.namelist()) != {*paths, "index.csv", "SHA256SUMS.txt"}
            or z.read("index.csv") != index
        ):
            return False
        sums = {
            n: h
            for h, n in (
                line.split("  ", 1)
                for line in z.read("SHA256SUMS.txt").decode().splitlines()
            )
        }
        return all(sums.get(n) == file_hash(p) for n, p in paths.items())


def pack_group(group, scenes, native_data):
    paths, rows = {}, []
    if native_data:
        precise = PRESERVATION / "native-edit" / (group + ".blend")
        paths[precise.relative_to(PRESERVATION).as_posix()] = precise
    for entry in scenes:
        sha = entry["sourceSha256"]
        blend = ROOT / entry["blend"]
        cache = PRESERVATION / "cache" / (sha + ".abc")
        native = PRESERVATION / "native"
        members = (
            [
                native / "scenes" / (sha + ".json.gz"),
                native / "scenes" / (sha + ".f32.gz"),
                native / "receipts" / (sha + ".json"),
                native / "tracks" / (sha + ".json.gz"),
                *sorted((native / "tracks").glob(sha + "-*.bip")),
                *sorted((native / "tracks").glob(sha + "-*.fig")),
                *sorted((native / "surfaces").glob(sha + "-*.gz")),
            ]
            if native_data
            else [blend, cache, cache.with_suffix(".json")]
        )
        constraint = native / "constraints" / (sha + ".json.gz")
        if native_data and constraint.is_file():
            members.append(constraint)
        for path in members:
            if not path.is_file():
                raise FileNotFoundError(path)
            paths[path.relative_to(PRESERVATION).as_posix()] = path
        rows.append(
            {
                "source": entry["source"],
                "sourceSha256": sha,
                "blend": blend.relative_to(PRESERVATION).as_posix(),
                "cache": cache.relative_to(PRESERVATION).as_posix(),
                "fps": entry["fps"],
                "firstFrame": entry["start"],
                "lastFrame": entry["end"],
            }
        )
    folder = "Native" if native_data else "Blender"
    index = csv_bytes(rows)
    if native_data and up_to_date(PACKAGES / folder / (group + ".zip"), paths, index):
        return
    pack(folder + "/" + group, paths, index)


def prepare_transfer(group):
    # The Drive connector accepts up to 100 MiB per upload. Each smaller ZIP
    # contains complete scenes and their shared caches with the same relative paths.
    limit = 94 * 1024**2
    source = PACKAGES / "Blender" / (group + ".zip")
    folder = PACKAGES / "Transfer" / "Blender"
    folder.mkdir(parents=True, exist_ok=True)
    if source.stat().st_size <= limit:
        dest = folder / source.name
        if not dest.exists() or file_hash(dest) != file_hash(source):
            temp = dest.with_suffix(".partial.zip")
            temp.unlink(missing_ok=True)
            try:
                os.link(source, temp)
            except OSError:
                shutil.copyfile(source, temp)
            temp.replace(dest)
        for old in folder.glob(group + "-part[0-9][0-9].zip"):
            old.unlink()
        return
    with zipfile.ZipFile(source) as full:
        rows = list(
            csv.DictReader(io.StringIO(full.read("index.csv").decode("utf-8-sig")))
        )
        pending, members = [], set()
        size = 0
        part = 1

        def write_part():
            # Input size is based on the actual compressed member sizes. Reverify
            # the resulting ZIP and its independent index before making it visible.
            paths = {name: PRESERVATION / name for name in members}
            name = f"Transfer/Blender/{group}-part{part:02d}"
            index = csv_bytes(pending)
            if not up_to_date(PACKAGES / (name + ".zip"), paths, index):
                pack(name, paths, index)
            if (PACKAGES / (name + ".zip")).stat().st_size > 100 * 1024**2:
                raise ValueError(
                    "A transfer package exceeded the upload limit: " + name
                )

        for row in rows:
            cache = row["cache"]
            files = {row["blend"], cache, cache.removesuffix(".abc") + ".json"}
            added = sum(full.getinfo(n).compress_size + 2048 for n in files - members)
            if pending and size + added > limit:
                write_part()
                pending, members, size = [], set(), 0
                part += 1
                added = sum(full.getinfo(n).compress_size + 2048 for n in files)
            pending.append(row)
            members.update(files)
            size += added
        if pending:
            write_part()
        (folder / source.name).unlink(missing_ok=True)
        for old in folder.glob(group + "-part[0-9][0-9].zip"):
            if int(old.stem[-2:]) > part:
                old.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", action="store_true")
    parser.add_argument("--image-library", action="store_true")
    parser.add_argument(
        "--download-index",
        action="store_true",
        help="Verify scene coverage of all transfer ZIPs and write a download index",
    )
    parser.add_argument(
        "--transfer",
        action="store_true",
        help="Split completed Blender packages into independently usable downloads",
    )
    parser.add_argument(
        "--native",
        action="store_true",
        help="Package the original mesh library and Max tables for each group",
    )
    parser.add_argument("--groups", nargs="+")
    args = parser.parse_args()
    if (
        not args.media
        and not args.image_library
        and not args.download_index
        and not args.groups
    ):
        parser.error("Select --media, --image-library, --download-index, or --groups")
    PACKAGES.mkdir(parents=True, exist_ok=True)
    if args.media:
        pack_media()
    if args.image_library:
        pack_blender_images()
    if args.download_index:
        download_index()
    if args.groups:
        scenes = read_json(PRESERVATION / "blend/index.json")["scenes"]
        for group in args.groups:
            rows = [r for r in scenes if r["group"].casefold() == group.casefold()]
            if not rows:
                parser.error("Unknown group: " + group)
            if args.transfer:
                prepare_transfer(rows[0]["group"])
            else:
                pack_group(rows[0]["group"], rows, args.native)


def download_index():
    by_source = {
        r["source"]: r for r in read_json(PRESERVATION / "blend/index.json")["scenes"]
    }
    indexed, archives = {}, []
    for archive in sorted((PACKAGES / "Transfer/Blender").glob("*.zip")):
        if archive.name.endswith(".partial.zip"):
            continue
        with zipfile.ZipFile(archive) as z:
            sums = {
                n: h
                for h, n in (
                    s.split("  ", 1)
                    for s in z.read("SHA256SUMS.txt").decode().splitlines()
                )
            }
            entries = csv.DictReader(
                io.StringIO(z.read("index.csv").decode("utf-8-sig"))
            )
            for row in entries:
                name = row["source"]
                info = by_source[name]
                if (
                    name in indexed
                    or info["blendSha256"] != sums[row["blend"]]
                    or info["cacheSha256"] != sums[row["cache"]]
                ):
                    raise ValueError(
                        "Duplicate or mismatched Blender download: " + name
                    )
                indexed[name] = {
                    "source": name,
                    "download": "Blender/" + archive.name,
                    **row,
                }
        archives.append(file_hash(archive) + "  " + archive.name)
    if indexed.keys() != by_source.keys():
        raise ValueError("Transfer packages do not cover all source paths")
    (PACKAGES / "Blender-index.csv").write_bytes(
        csv_bytes([indexed[name] for name in sorted(indexed)])
    )
    (PACKAGES / "Blender-SHA256SUMS.txt").write_text(
        "\n".join(archives) + "\n", encoding="utf8"
    )
    print(len(indexed), "scenes in", len(archives), "download packages", flush=True)


if __name__ == "__main__":
    main()
