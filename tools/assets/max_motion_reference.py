"""Read scene timing and evaluated Skin landmarks in a separate 3ds Max Batch process."""

import gzip
import hashlib
import json
import os
from pathlib import Path

import pymxs
from pymxs import runtime as rt

root = Path(os.environ["RUN_RAID_PROJECT"])
source = root / "asset-sources/player"
output = root / ".asset-work/max-motion"
output.mkdir(parents=True, exist_ok=True)

# Keep the hot vertex loop inside Max. Prefer rigid vertices so blended cloth and fingers
# do not pull on a rigid attachment. Keep original vertex IDs for topology validation.
groups_for = rt.execute("""(fn raidLandmarkGroups sk = (
    local count = skinOps.getNumberBones sk
    local hard = for b=1 to count collect #()
    local soft = for b=1 to count collect #()
    for v=1 to skinOps.getNumberVertices sk do (
        local best=0, weight=0.0
        for i=1 to skinOps.getVertexWeightCount sk v do (
            local w=skinOps.getVertexWeight sk v i
            if w>weight do (weight=w;best=skinOps.getVertexWeightBoneID sk v i)
        )
        if best>0 and best<=count do (
            if weight>0.999 then append hard[best] v else append soft[best] v
        )
    )
    for b=1 to count where hard[b].count+soft[b].count>0 collect (
        local ids=if hard[b].count>=4 then hard[b] else (hard[b]+soft[b])
        local n=amin 12 ids.count
        local sample=for i=0 to n-1 collect ids[1+((i*(ids.count-1.0)/(amax 1 (n-1))) as integer)]
        #(skinOps.getBoneName sk b 0, hard[b].count, sample)
    )
))""")


def frame_time(t):
    return int(round(float(t.frame) * int(rt.ticksPerFrame)))


def timing():
    tags = rt.frameTagManager
    markers = []
    for i in range(1, tags.getTagCount() + 1):
        key = tags.getTagID(i)
        markers.append([str(tags.getNameByID(key)), frame_time(tags.getTimeByID(key))])
    notes = []
    for obj in [rt.rootNode, *rt.objects]:
        for i in range(1, rt.numNoteTracks(obj) + 1):
            track = rt.getNoteTrack(obj, i)
            for key in track.keys:
                notes.append(
                    [
                        str(obj.name),
                        str(track.name),
                        frame_time(key.time),
                        str(key.value),
                    ]
                )
    return dict(
        fps=int(rt.frameRate),
        ticksPerFrame=int(rt.ticksPerFrame),
        startTick=frame_time(rt.animationRange.start),
        endTick=frame_time(rt.animationRange.end),
        playbackSpeed=int(rt.timeConfiguration.playbackSpeed),
        realTime=bool(rt.timeConfiguration.realTimePlayback),
        loop=bool(rt.timeConfiguration.playbackLoop),
        tags=markers,
        notes=notes,
    )


def save(path, data):
    tmp = path.with_suffix(f".{os.getpid()}.partial")
    with gzip.open(tmp, "wt", encoding="utf8", compresslevel=2) as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(path)


def extract(obj, skin, frames):
    groups = {
        str(name): {"rigid": int(rigid), "ids": [int(i) - 1 for i in ids]}
        for name, rigid, ids in groups_for(skin)
    }
    samples = {}
    for frame in frames:
        with pymxs.attime(frame):
            mesh = rt.snapshotAsMesh(obj)
            tm = obj.objectTransform
            samples[frame] = {
                n: [
                    [round(x, 7) for x in (rt.getVert(mesh, i + 1) * tm)]
                    for i in g["ids"]
                ]
                for n, g in groups.items()
            }
    return dict(
        name=str(obj.name),
        verts=int(rt.skinOps.getNumberVertices(skin)),
        groups=groups,
        frames=samples,
    )


def run():
    groups = set(os.environ.get("RUN_RAID_REFERENCE_GROUPS", "").lower().split())
    single = os.environ.get("RUN_RAID_REFERENCE_FILE", "").lower()
    plan = json.loads((root / ".asset-work/max-motion-plan.json").read_text("utf8"))
    used, bodies = set(plan["motion"]), set(plan["bodies"])
    paths = sorted(
        source.rglob("*.max"),
        key=lambda p: (
            p.relative_to(source).as_posix().lower() not in used,
            p.relative_to(source).as_posix().lower() not in bodies,
            p.as_posix().lower(),
        ),
    )
    failed = []
    for path in paths:
        key = path.relative_to(source).as_posix().lower()
        if single and key != single:
            continue
        if groups and key.split("/")[0] not in groups:
            continue
        dest = output / (hashlib.sha256(key.encode()).hexdigest()[:20] + ".json.gz")
        capture = "motion" if key in used else "bind" if key in bodies else "scene"
        if dest.is_file() and dest.stat().st_mtime_ns >= path.stat().st_mtime_ns:
            with gzip.open(dest, "rt", encoding="utf8") as cache:
                previous = json.load(cache)
            if previous.get("capture") == capture:
                continue
        # Some legacy scenes leave plug-in state behind when another scene opens.
        # Reset before loading, and keep other independent scenes recoverable.
        try:
            already_open = Path(str(rt.maxFilePath)) / str(rt.maxFileName)
            if already_open != path:
                rt.resetMaxFile(rt.name("noPrompt"))
                if not rt.loadMaxFile(str(path), quiet=True, useFileUnits=True):
                    raise RuntimeError("Cannot open " + str(path))
            t = timing()
            first, last = (
                int(rt.animationRange.start.frame),
                int(rt.animationRange.end.frame),
            )
            shapes = [
                str(o.name)
                for o in rt.geometry
                if rt.superClassOf(o) == rt.GeometryClass
            ]
            meshes = []
            if key in used or key in bodies:
                for obj in rt.objects:
                    skin = next(
                        (
                            m
                            for m in getattr(obj, "modifiers", [])
                            if str(rt.classOf(m)).lower() == "skin"
                        ),
                        None,
                    )
                    if skin is not None:
                        meshes.append(
                            extract(
                                obj,
                                skin,
                                range(first, last + 1) if key in used else [first],
                            )
                        )
            save(
                dest,
                dict(
                    source=key,
                    capture=capture,
                    timing=t,
                    geometry=shapes,
                    meshes=meshes,
                ),
            )
        except Exception as error:
            failed.append(key)
            (output / (dest.stem + ".error")).write_text(
                key + "\n" + str(error), encoding="utf8"
            )
            continue
        (output / (dest.stem + ".error")).unlink(missing_ok=True)
        print("Reference", key, flush=True)
    if failed:
        raise RuntimeError(
            f"{len(failed)} Max scenes need an isolated retry: {', '.join(failed)}"
        )


if __name__ == "__main__":
    run()
