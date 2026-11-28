"""Preserve authored target schedules and weights, including Max Link-to-World switches."""

import gzip
import json
import os
from pathlib import Path

import pymxs
from pymxs import runtime as rt


def class_key(name):
    return str(name).replace(" ", "").replace("_", "").lower()


classes = {
    "linkconstraint",
    "lookatconstraint",
    "positionconstraint",
    "orientationconstraint",
    "pathconstraint",
}


def capture_constraints(directory, sha, source_name):
    """Call with the original scene open. All frame and tick fields use MAX time."""
    destination = Path(directory)
    destination.mkdir(parents=True, exist_ok=True)
    file = destination / (sha + ".json.gz")
    if file.is_file():
        with gzip.open(file, "rt", encoding="utf8") as stream:
            old = json.load(stream)
        if (
            old.get("version") == 1
            and old.get("source") == source_name
            and not old["errors"]
        ):
            return old
    first, last = int(rt.animationRange.start.frame), int(rt.animationRange.end.frame)
    result = {
        "version": 1,
        "source": source_name,
        "first": first,
        "last": last,
        "ticksPerFrame": int(rt.ticksPerFrame),
        "controllers": [],
        "errors": [],
    }
    located = {}
    for owner in rt.objects:
        visited = set()
        stack = [(owner.controller, [])]
        while stack:
            ctrl, path = stack.pop()
            if ctrl is None:
                continue
            handle = int(rt.getHandleByAnim(ctrl))
            if handle in visited:
                continue
            visited.add(handle)
            kind = str(rt.classOf(ctrl))
            if class_key(kind) in classes:
                if handle not in located:
                    located[handle] = [ctrl, kind, []]
                located[handle][2].append(
                    {
                        "node": str(owner.name),
                        "handle": int(owner.handle),
                        "trackPath": path,
                    }
                )
            for index in range(1, int(ctrl.numSubs) + 1):
                sub = rt.getSubAnim(ctrl, index)
                child = getattr(sub, "controller", None)
                if child is not None:
                    stack.append(
                        (child, [*path, [index, str(rt.getSubAnimName(ctrl, index))]])
                    )
    for ctrl, kind, owners in located.values():
        try:
            record = {"class": kind, "owners": owners, "targets": []}
            is_link = class_key(kind) == "linkconstraint"
            if is_link:
                record["keyMode"] = int(ctrl.key_mode)
            for i in range(1, int(ctrl.getNumTargets()) + 1):
                target = ctrl.getNode(i)
                item = {
                    "index": i,
                    "handle": int(target.handle) if target else None,
                    "name": str(target.name) if target else None,
                }
                if is_link:
                    frame = float(ctrl.getFrameNo(i))
                    item.update(frame=frame, tick=round(frame * rt.ticksPerFrame))
                else:
                    weights = []
                    for frame in range(first, last + 1):
                        with pymxs.attime(frame):
                            weights.append(float(ctrl.getWeight(i)))
                    item["weights"] = weights if len(set(weights)) > 1 else [weights[0]]
                record["targets"].append(item)
            result["controllers"].append(record)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            result["errors"].append(
                {"class": kind, "owners": owners, "reason": str(error)}
            )
    temporary = file.with_suffix(f".{os.getpid()}.partial")
    with gzip.open(temporary, "wt", encoding="utf8", compresslevel=2) as stream:
        json.dump(result, stream, ensure_ascii=False, separators=(",", ":"))
    temporary.replace(file)
    return result


def run():
    project = Path(os.environ["RUN_RAID_PROJECT"])
    out = project / ".asset-work/max-preservation/native"
    plan = json.loads((out / "plan.json").read_text("utf8"))
    with gzip.open(out / "compound.json.gz", "rt", encoding="utf8") as stream:
        manifest = json.load(stream)
    for row in plan:
        sha = row["sha256"]
        if not any(class_key(name) in classes for name, *_ in manifest[sha]["classes"]):
            continue
        path = out / "constraints" / (sha + ".json.gz")
        if path.exists():
            with gzip.open(path, "rt", encoding="utf8") as stream:
                prior = json.load(stream)
            if prior.get("version") == 1 and not prior["errors"]:
                continue
        rt.resetMaxFile(rt.name("noPrompt"))
        if not rt.loadMaxFile(
            str(project / "asset-sources/player" / row["source"]),
            quiet=True,
            useFileUnits=True,
        ):
            raise ValueError("Unable to open " + row["source"])
        capture = capture_constraints(out / "constraints", sha, row["source"])
        print(row["source"], len(capture["controllers"]), capture["errors"], flush=True)


if __name__ == "__main__":
    run()
