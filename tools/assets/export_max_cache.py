"""Run in 3ds Max Batch. Preserve evaluated geometry beside the editable FBX rig."""

import argparse
import hashlib
import json
import os
from pathlib import Path


def export_scene(source, target):
    from pymxs import runtime as rt

    opened = Path(str(rt.maxFilePath)) / str(rt.maxFileName)
    if opened != source:
        rt.resetMaxFile(rt.name("noPrompt"))
        if not rt.loadMaxFile(str(source), quiet=True, useFileUnits=True):
            raise RuntimeError("Max could not open the scene")
    # Blender's Alembic importer expects the standard Y-up coordinate system.
    exporter = rt.AlembicExport
    exporter.ArchiveType = rt.name("Ogawa")
    exporter.CoordinateSystem = rt.name("YUp")
    exporter.AnimTimeRange = rt.name("TimeSlider")
    exporter.SamplesPerFrame = 1
    for field in (
        "Hidden",
        "UVs",
        "Normals",
        "VertexColors",
        "ExtraChannels",
        "MaterialIDs",
        "Visibility",
        "LayerName",
        "MaterialName",
        "ObjectID",
        "CustomAttributes",
    ):
        setattr(exporter, field, True)
    tmp = target.with_name(f"{target.stem}.{os.getpid()}.partial.abc")
    if not rt.exportFile(
        str(tmp), rt.name("noPrompt"), selectedOnly=False, using=rt.Alembic_Export
    ):
        raise RuntimeError("Alembic export failed")
    with tmp.open("rb") as stream:
        if stream.read(6) != b"Ogawa\xff":
            raise ValueError("Incomplete Ogawa archive")
    tmp.replace(target)
    return {
        "fps": int(rt.frameRate),
        "first": float(rt.animationRange.start.frame),
        "last": float(rt.animationRange.end.frame),
        "objects": len(list(rt.objects)),
        "bytes": target.stat().st_size,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }


def plan(shards):
    from library import INDEX, WORK, read_json, save_json

    if shards < 1:
        raise ValueError("Shard count must be positive")
    unique = {}
    for item in read_json(INDEX)["files"]:
        if item["kind"] in {"scene", "motion"}:
            unique.setdefault(item["sha256"], item["path"])
    sources = sorted(unique.values())
    for i in range(shards):
        save_json(
            WORK / "max-preservation" / f"cache-queue-{i}.json", sources[i::shards]
        )
    print(f"{len(sources)} distinct scenes in {shards} queues")


def main():
    root = Path(os.environ["RUN_RAID_PROJECT"])
    sources = root / "asset-sources/player"
    output = Path(
        os.environ.get(
            "RUN_RAID_CACHE_DIR", root / ".asset-work/max-preservation/cache"
        )
    )
    output.mkdir(parents=True, exist_ok=True)
    paths = json.loads(
        Path(os.environ["RUN_RAID_CACHE_LIST"]).read_text(encoding="utf-8-sig")
    )
    for relative in paths:
        source = sources / relative
        key = hashlib.sha256(source.read_bytes()).hexdigest()
        target = output / (key + ".abc")
        receipt = target.with_suffix(".json")
        if receipt.is_file() and target.is_file():
            data = json.loads(receipt.read_text("utf8"))
            if (
                data["bytes"] == target.stat().st_size
                and data["sha256"] == hashlib.sha256(target.read_bytes()).hexdigest()
            ):
                continue
        print("Caching", relative, flush=True)
        error_path = target.with_suffix(".error")
        try:
            data = export_scene(source, target)
            data.update(source=relative, sourceSha256=key)
            scratch = receipt.with_suffix(".partial.json")
            scratch.write_text(json.dumps(data, ensure_ascii=False), encoding="utf8")
            scratch.replace(receipt)
            error_path.unlink(missing_ok=True)
        except (RuntimeError, ValueError, OSError, TypeError, AttributeError) as error:
            error_path.write_text(relative + "\n" + str(error), encoding="utf8")
            print(relative, error, flush=True)


if __name__ == "__main__":
    if os.environ.get("RUN_RAID_CACHE_LIST"):
        main()
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--plan", type=int, required=True, metavar="SHARDS")
        plan(parser.parse_args().plan)
