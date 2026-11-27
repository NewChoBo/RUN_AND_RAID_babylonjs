"""Portable filenames shared by the local authoring library, game and Drive packages."""
import re
from pathlib import PurePosixPath


def slug(value):
    name = re.sub(r"[^\w-]+", "-", value.casefold()).strip("-")
    if not name:
        raise ValueError(f"Empty asset name for {value!r}")
    return name


def outfit_name(group, skin):
    return f"{slug(group)}-{slug(skin)}.glb"


def source_stem(item):
    path = PurePosixPath(item["path"])
    group = slug(item["group"])
    stem = slug(path.stem)
    # Two character folders contain scenes identified by their earlier production names.
    alias = {"elfprince": "kein", "silurian": "siluria"}.get(group)
    if alias and (stem == alias or stem.startswith((alias + "-", alias + "_"))):
        stem = group + stem[len(alias):]
    if stem != group and not stem.startswith((group + "-", group + "_")):
        stem = group + "-" + stem
    folders = [slug(p) for p in path.parts[1:-1]
               if p.casefold() not in {"animation", "animaion", "texture", "textures"}]
    return "-".join([stem, *folders] + (["scene"] if item["kind"] == "scene" else []))


def library_file(item, field):
    folder, suffix = {"model": ("models", ".glb"), "texture": ("textures", ".png"),
                      "hierarchy": ("rigs", ".json"), "thumbnail": ("previews", "-preview.png")}[field]
    return f"{folder}/{slug(item['group'])}/{source_stem(item)}{suffix}"


def fbx_path(item):
    return PurePosixPath(item["path"]).with_name(source_stem(item) + ".fbx")
