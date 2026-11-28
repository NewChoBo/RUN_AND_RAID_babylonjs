"""Preserve authored motion before/after the playback range and exact off-frame key poses."""

import gzip
import json
import math
import os
import sys
from pathlib import Path

if "RUN_RAID_PROJECT" in os.environ:
    sys.path.insert(0, str(Path(os.environ["RUN_RAID_PROJECT"]) / "tools/assets"))

from export_max_cache import export_scene

# Blender's Scene.frame_current RNA limit in either direction.
BLENDER_FRAME_LIMIT = 1048574


def motion_ranges(ticks, first, last, ticks_per_frame):
    outside_blender = [
        t for t in ticks if abs(t) > BLENDER_FRAME_LIMIT * ticks_per_frame
    ]
    playable = [t for t in ticks if abs(t) <= BLENDER_FRAME_LIMIT * ticks_per_frame]
    ranges = []
    if playable and playable[0] < first * ticks_per_frame:
        ranges.append(("before", math.floor(playable[0] / ticks_per_frame), first))
    if playable and playable[-1] > last * ticks_per_frame:
        ranges.append(("after", last, math.ceil(playable[-1] / ticks_per_frame)))
    return ranges, [t for t in playable if t % ticks_per_frame], outside_blender


def key_times(sha, native_dir):
    with gzip.open(
        native_dir / "tracks" / (sha + ".json.gz"), "rt", encoding="utf8"
    ) as f:
        tracks = json.load(f)
    times = {k[0] for track in tracks["tracks"].values() for k in track.get("keys", [])}
    constraints = native_dir / "constraints" / (sha + ".json.gz")
    if constraints.is_file():
        with gzip.open(constraints, "rt", encoding="utf8") as f:
            data = json.load(f)
        times.update(
            target["tick"]
            for ctrl in data["controllers"]
            for target in ctrl.get("targets", [])
            if target.get("tick") is not None
        )
    return sorted(times)


def capture_extended(row, native_dir):
    import pymxs
    from max_surface_reference import compressed_capture, geometry
    from pymxs import runtime as rt

    native_dir = Path(native_dir)
    dest = native_dir.parent / "extended"
    dest.mkdir(parents=True, exist_ok=True)
    sha = row["sha256"]
    times = key_times(sha, native_dir)
    receipt = dest / (sha + ".json")
    if receipt.is_file():
        previous = json.loads(receipt.read_text("utf8"))
        all_poses = previous["offGridPoses"] + previous.get("outsideTimelinePoses", [])
        if (
            previous.get("keyTicks") == times
            and all(p.get("evaluatedTick") == p["tick"] for p in all_poses)
            and all(
                (dest / seg["file"]).is_file()
                and (dest / seg["file"]).stat().st_size == seg["bytes"]
                for seg in previous["segments"]
            )
            and all(
                (dest / m["file"]).is_file()
                for pose in all_poses
                for m in pose["meshes"]
            )
        ):
            return
    source = (
        Path(os.environ["RUN_RAID_PROJECT"]) / "asset-sources/player" / row["source"]
    )
    opened = Path(str(rt.maxFilePath)) / str(rt.maxFileName) == source
    if opened:
        first, last = (
            int(rt.animationRange.start.frame),
            int(rt.animationRange.end.frame),
        )
        fps, tpf = int(rt.frameRate), int(rt.ticksPerFrame)
        per_meter = float(rt.units.decodeValue("1m"))
    else:
        with gzip.open(
            native_dir / "scenes" / (sha + ".json.gz"), "rt", encoding="utf8"
        ) as f:
            data = json.load(f)
        t = data["timing"]
        first, last, fps, tpf = (
            t[n] for n in ("first", "last", "fps", "ticksPerFrame")
        )
        per_meter = data["units"]["perMeter"]
    ranges, off_grid, outside_timeline = motion_ranges(times, first, last, tpf)
    record = {
        "source": row["source"],
        "sourceSha256": sha,
        "keyTicks": times,
        "fps": fps,
        "ticksPerFrame": tpf,
        "active": [first, last],
        "perMeter": per_meter,
        "segments": [],
        "offGridPoses": [],
        "outsideTimelinePoses": [],
    }
    if ranges or off_grid or outside_timeline:
        if not opened:
            rt.resetMaxFile(rt.name("noPrompt"))
            if not rt.loadMaxFile(str(source), quiet=True, useFileUnits=True):
                raise RuntimeError("Cannot open " + str(source))
        original = rt.animationRange
        objects = [
            o
            for o in rt.geometry
            if str(rt.classOf(o)).casefold()
            not in {"biped_object", "bonegeometry", "biped", "dummy"}
        ]
        try:
            for label, start, end in ranges:
                path = dest / f"{sha}-{label}.abc"
                rt.animationRange = rt.interval(start, end)
                meta = export_scene(source, path)
                samples = {}
                for frame in sorted({start, (start + end) // 2, end}):
                    with pymxs.attime(frame):
                        poses = []
                        for obj in objects:
                            mesh = rt.snapshotAsMesh(obj)
                            n = int(mesh.numverts)
                            ids = (
                                sorted({(i * (n - 1)) // 11 for i in range(12)})
                                if n
                                else []
                            )
                            poses.append(
                                {
                                    "node": str(obj.name),
                                    "verts": n,
                                    "ids": ids,
                                    "xyz": [list(rt.getVert(mesh, i + 1)) for i in ids],
                                }
                            )
                            rt.free(mesh)
                        samples[str(frame)] = poses
                record["segments"].append(
                    {"file": path.name, **meta, "samples": samples}
                )
        finally:
            rt.animationRange = original
        for tick in off_grid + outside_timeline:
            with pymxs.attime(tick / tpf):
                evaluated_tick = round(float(rt.currentTime.frame) * tpf)
                if evaluated_tick != tick:
                    raise ValueError(
                        f"Max evaluated tick {evaluated_tick} instead of {tick}"
                    )
                pose = []
                for obj in objects:
                    path = dest / f"{sha}-tick{tick}-{int(obj.handle)}.mesh.gz"
                    compressed_capture(geometry, path, obj)
                    pose.append({"name": str(obj.name), "file": path.name})
                field = (
                    "outsideTimelinePoses"
                    if tick in outside_timeline
                    else "offGridPoses"
                )
                record[field].append(
                    {"tick": tick, "evaluatedTick": evaluated_tick, "meshes": pose}
                )
    temp = receipt.with_suffix(".partial")
    temp.write_text(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")), encoding="utf8"
    )
    temp.replace(receipt)


if __name__ == "__main__":
    base = Path(os.environ["RUN_RAID_PROJECT"]) / ".asset-work/max-preservation"
    for row in json.loads(
        Path(os.environ["RUN_RAID_EXTENDED_LIST"]).read_text("utf-8-sig")
    ):
        capture_extended(row, base / "native")
