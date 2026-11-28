"""Keep pre-stack Editable Mesh triangles, edge display flags and primitive parameters."""

import gzip
import json
import os
import sys
from pathlib import Path

import pymxs
from pymxs import runtime as rt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_max_sources import properties
from max_skin_authoring import matrix_values
from max_surface_reference import compressed_capture, geometry

write_flags = rt.execute("""(fn raidWriteTriFlags node path = (
    local m=copy node.baseObject.mesh, f=fopen path "wb"
    if f==undefined do throw "Cannot open edge flag output"
    try (
        writeLong f 1; writeLong f m.numfaces
        for i=1 to m.numfaces do (
            local mask=0
            for e=1 to 3 where (getEdgeVis m i e) do mask=bit.set mask e true
            writeByte f mask
        )
    ) catch (fclose f; free m; throw())
    local counts=#(m.numverts,m.numfaces)
    fclose f;free m; counts
))""")


def capture(target, sha, obj):
    kind = str(rt.classOf(obj.baseObject))
    info = {
        "node": int(obj.handle),
        "name": str(obj.name),
        "baseClass": kind,
        "frame": float(rt.currentTime.frame),
        "objectWorld": matrix_values(obj.objectTransform),
        "properties": properties(obj.baseObject),
    }
    geometry_node = obj
    clone = None
    try:
        if kind.casefold() != "editable_mesh":
            clone = rt.copy(obj)
            for _ in range(len(clone.modifiers)):
                rt.deleteModifier(clone, 1)
            rt.convertToMesh(clone)
            geometry_node = clone
        path = target / f"{sha}-{int(obj.handle)}.tri.gz"
        masks = target / f"{sha}-{int(obj.handle)}.tri-edges.gz"
        compressed_capture(
            lambda node, file: geometry(node, file, baseMesh=True), path, geometry_node
        )
        nv, nf = compressed_capture(write_flags, masks, geometry_node)
        info["polyShape"] = {
            "file": path.name,
            "edgeVisibility": masks.name,
            "vertices": int(nv),
            "faces": int(nf),
        }
    finally:
        if clone is not None:
            rt.delete(clone)
    return info


def run():
    project = Path(os.environ["RUN_RAID_PROJECT"])
    native = project / ".asset-work/max-preservation/native"
    dest = native / "envelopes"
    plan = json.loads((native / "plan.json").read_text("utf8"))
    for row in plan:
        sha = row["sha256"]
        name = sha + ".json.gz"
        extra = dest / (sha + ".extra.json.gz")
        if (
            extra.exists()
            or not (dest / name).is_file()
            or not (native / "scenes" / name).is_file()
        ):
            continue
        with gzip.open(dest / name, "rt", encoding="utf8") as f:
            cages = {c["node"] for c in json.load(f)["cages"]}
        with gzip.open(native / "scenes" / name, "rt", encoding="utf8") as f:
            source = json.load(f)
        objects = [
            n for n in source["nodes"] if n.get("mesh") and n["handle"] not in cages
        ]
        if not objects:
            continue
        rt.resetMaxFile(rt.name("noPrompt"))
        if not rt.loadMaxFile(
            str(project / "asset-sources/player" / row["source"]),
            quiet=True,
            useFileUnits=True,
        ):
            raise ValueError("Unable to open " + row["source"])
        with pymxs.attime(rt.animationRange.start.frame):
            records = [
                capture(dest, sha, rt.maxOps.getNodeByHandle(n["handle"]))
                for n in objects
            ]
        value = {
            "version": 1,
            "sha256": sha,
            "source": row["source"],
            "objects": records,
        }
        work = extra.with_suffix(".partial")
        with gzip.open(work, "wt", encoding="utf8", compresslevel=2) as f:
            json.dump(
                value, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            )
        work.replace(extra)
        print("Base objects", row["source"], len(records), flush=True)


if __name__ == "__main__":
    run()
