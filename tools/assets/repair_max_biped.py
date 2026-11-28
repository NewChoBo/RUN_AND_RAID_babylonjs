"""Recover BIP exports from scenes saved in Figure mode without changing the source MAX."""

import gzip
import hashlib
import json
import os
from pathlib import Path

import pymxs
from pymxs import runtime as rt


def sampled_pose(frames, nodes):
    values = []
    for f in frames:
        with pymxs.attime(f):
            for node in nodes:
                matrix = node.transform
                for row in (matrix.row1, matrix.row2, matrix.row3, matrix.row4):
                    values.extend(float(v) for v in row)
    return values


def max_error(actual, expected):
    return max((abs(a - b) for a, b in zip(actual, expected, strict=True)), default=0)


def recover(node, destination, sha):
    controller = node.controller
    modes = {
        key: bool(getattr(controller, key))
        for key in (
            "figureMode",
            "footstepMode",
            "motionMode",
            "mixerMode",
            "bufferMode",
        )
    }
    if not modes["figureMode"]:
        raise ValueError(f"BIP export failed outside Figure mode: {modes}")
    bones = [b for b in rt.objects if str(rt.classOf(b)) == "Biped_Object"]
    handle = str(node.handle)
    first, last = int(rt.animationRange.start.frame), int(rt.animationRange.end.frame)
    frames = sorted({first, (first + last) // 2, last})
    figure = destination / f"{sha}-{handle}.fig"
    temporary = figure.with_suffix(".partial.fig")
    fitted = sampled_pose([first], bones)
    rt.biped.saveFigFile(controller, str(temporary))
    figure_hash = hashlib.sha256(temporary.read_bytes()).hexdigest()
    temporary.replace(figure)
    # Capture both authored states before any reimport can quantise the figure.
    controller.figureMode = False
    original = sampled_pose(frames, bones)
    motion = destination / f"{sha}-{handle}.bip"
    temporary = motion.with_suffix(".partial.bip")
    rt.biped.saveBipFile(controller, str(temporary), rt.name("saveSubAnimControllers"))
    rt.biped.loadBipFile(
        controller,
        str(temporary),
        rt.name("noRedraw"),
        rt.name("loadSubAnimControllers"),
    )
    motion_error = max_error(original, sampled_pose(frames, bones))
    motion_hash = hashlib.sha256(temporary.read_bytes()).hexdigest()
    temporary.replace(motion)
    controller.figureMode = True
    rt.biped.loadFigFile(controller, str(figure), rt.name("noRedraw"))
    fit_error = max_error(fitted, sampled_pose([first], bones))
    return {
        "version": 2,
        "node": handle,
        "originalModes": modes,
        "comparedBoneCount": len(bones),
        "motion": {
            "node": handle,
            "file": motion.name,
            "sha256": motion_hash,
            "frames": frames,
            "maxMatrixDifference": motion_error,
        },
        "figure": {
            "node": handle,
            "file": figure.name,
            "sha256": figure_hash,
            "frames": [first],
            "maxMatrixDifference": fit_error,
        },
    }


def run():
    project = Path(os.environ["RUN_RAID_PROJECT"])
    native = project / ".asset-work/max-preservation/native"
    directory = native / "tracks"
    items = json.loads((native / "plan.json").read_text("utf8"))
    for row in items:
        output = directory / (row["sha256"] + ".json.gz")
        if not output.is_file():
            continue
        with gzip.open(output, "rt", encoding="utf8") as s:
            track = json.load(s)
        blocked = [
            w
            for w in track["warnings"]
            if "Cannot run the operation in this mode" in w["reason"]
        ]
        for previous in track.get("modeRecoveries", []):
            if previous.get("version") != 2:
                blocked.append(
                    {
                        "node": track["roots"][previous["node"]]["name"],
                        "reason": "Refresh BIP from unmodified figure",
                    }
                )
        if not blocked:
            continue
        original = project / "asset-sources/player" / row["source"]
        with original.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != row["sha256"]:
                raise ValueError("Source no longer matches archive")
        for warning in blocked:
            rt.resetMaxFile(rt.name("noPrompt"))
            if not rt.loadMaxFile(str(original), quiet=True, useFileUnits=True):
                raise RuntimeError("Unable to reopen " + row["source"])
            obj = next(
                (
                    n
                    for n in rt.objects
                    if str(n.name) == warning["node"]
                    and str(rt.classOf(n.controller)).lower()
                    == "vertical_horizontal_turn"
                ),
                None,
            )
            if obj is None:
                continue
            try:
                result = recover(obj, directory, row["sha256"])
            except (
                RuntimeError,
                ValueError,
                OSError,
                TypeError,
                AttributeError,
            ) as error:
                print("Unresolved BIP", row["source"], error, flush=True)
                continue
            for key, item in (
                ("modeRecoveries", result),
                ("figures", result["figure"]),
                ("bipeds", result["motion"]),
            ):
                track[key] = [
                    existing
                    for existing in track.get(key, [])
                    if existing["node"] != result["node"]
                ]
                track[key].append(item)
            if warning in track["warnings"]:
                track["warnings"].remove(warning)
            work = output.with_suffix(".repair.partial")
            with gzip.open(work, "wt", encoding="utf8", compresslevel=2) as s:
                json.dump(track, s, separators=(",", ":"), ensure_ascii=False)
            work.replace(output)
            print(
                "Recovered",
                row["source"],
                result["motion"],
                result["figure"],
                flush=True,
            )


if __name__ == "__main__":
    run()
