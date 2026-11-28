"""Restore face-to-edge identities where multiple editable-poly edges share endpoints."""

import gzip
import json
import os
import struct
import sys
from pathlib import Path

from pymxs import runtime as rt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from max_surface_reference import compressed_capture

write_edges = rt.execute("""(fn raidCageFaceEdges base path = (
    local f=fopen path "wb"
    if f==undefined do throw "Cannot open face edge output"
    try (
        local nf=polyop.getNumFaces base
        writeLong f 1; writeLong f nf
        for i=1 to nf do (
            local ids=polyop.getFaceEdges base i
            if ids==undefined then writeLong f -1 else (
                writeLong f ids.count
                for id in ids do writeLong f (id-1)
            )
        )
    ) catch (fclose f; throw())
    fclose f
))""")


def ambiguous_edges(file):
    with gzip.open(file, "rb") as fp:
        version, nv, ne, _nf = struct.unpack("<4i", fp.read(16))
        if version != 1:
            raise ValueError("Unknown editable poly version")
        fp.seek(nv * 16, 1)
        edges = fp.read(ne * 12)
    pairs = set()
    for a, b, _flags in struct.iter_unpack("<2iI", edges):
        if a < 0 or b < 0:
            continue
        endpoints = (min(a, b), max(a, b))
        if endpoints in pairs:
            return True
        pairs.add(endpoints)
    return False


def run():
    project = Path(os.environ["RUN_RAID_PROJECT"])
    native = project / ".asset-work/max-preservation/native"
    target = native / "envelopes"
    manual = native / "ambiguous-edges.json"
    todo = json.loads(manual.read_text("utf-8-sig")) if manual.is_file() else {}
    for row in json.loads((native / "plan.json").read_text("utf8")):
        sha = row["sha256"]
        file = target / (sha + ".json.gz")
        if not file.is_file():
            continue
        with gzip.open(file, "rt", encoding="utf8") as f:
            cages = json.load(f)["cages"]
        ids = set(todo.get(sha, []))
        for cage in cages:
            if (target / f"{sha}-{cage['node']}.edges.gz").is_file() or ambiguous_edges(
                target / cage["file"]
            ):
                ids.add(cage["node"])
        missing = [
            (node, target / f"{sha}-{node}.edges.gz")
            for node in ids
            if not (target / f"{sha}-{node}.edges.gz").is_file()
        ]
        if not missing:
            continue
        rt.resetMaxFile(rt.name("noPrompt"))
        if not rt.loadMaxFile(
            str(project / "asset-sources/player" / row["source"]),
            quiet=True,
            useFileUnits=True,
        ):
            raise ValueError("Unable to reopen " + row["source"])
        for handle, file in missing:
            obj = rt.maxOps.getNodeByHandle(int(handle))
            if obj is None or str(rt.classOf(obj.baseObject)) != "Editable_Poly":
                raise ValueError(f"Unable to find source editable poly: {handle}")
            compressed_capture(write_edges, file, obj.baseObject)
            print("Face edges", row["source"], handle, flush=True)


if __name__ == "__main__":
    run()
