"""Export original Skin bind transforms, envelopes, DQ weights and editing flags."""

import gzip
import hashlib
import json
import os
import sys
import traceback
from pathlib import Path

import pymxs
from pymxs import runtime as rt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from max_polygon_cage import export_cage

vertex_values = rt.execute("""(fn raidSkinVertexData sk = (
    local n=skinOps.getNumberVertices sk, dq=#(), modified=#(), rigid=#(), unnormalized=#()
    for i=1 to n do (
        append dq (skinOps.getVertexDQWeight sk i)
        append modified (skinOps.isVertexModified sk i)
        append rigid (skinOps.isRigidVertex sk i)
        append unnormalized (skinOps.isUnNormalizeVertex sk i)
    )
    #(dq, modified, rigid, unnormalized)
))""")


def matrix_values(matrix):
    return [
        float(v)
        for row in (matrix.row1, matrix.row2, matrix.row3, matrix.row4)
        for v in row
    ]


def compressed_values(values):
    return [values[0]] if values and min(values) == max(values) else values


def capture_skin(node, skin, index, target, sha):
    envelope = target / f"{sha}-{int(node.handle)}-{index}.env"
    temporary = envelope.with_suffix(".partial.env")
    rt.skinOps.saveEnvelope(skin, str(temporary))
    if temporary.stat().st_size < 8:
        raise ValueError("Native Skin envelope is empty")
    temporary.replace(envelope)
    bones = []
    for id_ in range(1, int(rt.skinOps.getNumberBones(skin)) + 1):
        bone = rt.skinOps.getBoneNode(skin, id_)
        cross = range(1, int(rt.skinOps.getNumberCrossSections(skin, id_)) + 1)
        bones.append(
            {
                "boneID": id_,
                "node": int(bone.handle),
                "name": str(bone.name),
                "bind": matrix_values(rt.skinUtils.getBoneBindTM(node, bone)),
                "stretch": matrix_values(rt.skinUtils.getBoneStretchTM(node, bone)),
                "start": list(rt.skinOps.getStartPoint(skin, id_)),
                "end": list(rt.skinOps.getEndPoint(skin, id_)),
                "falloff": int(rt.skinOps.getBonePropFalloff(skin, id_)),
                "relative": bool(rt.skinOps.getBonePropRelative(skin, id_)),
                "visible": bool(rt.skinOps.getBonePropEnvelopeVisible(skin, id_)),
                "sections": [
                    [
                        float(rt.skinOps.getCrossSectionU(skin, id_, j)),
                        float(rt.skinOps.getInnerRadius(skin, id_, j)),
                        float(rt.skinOps.getOuterRadius(skin, id_, j)),
                    ]
                    for j in cross
                ],
            }
        )
    dq, modified, rigid, unnormalized = vertex_values(skin)
    return {
        "node": int(node.handle),
        "name": str(node.name),
        "stackIndex": index,
        "file": envelope.name,
        "sha256": hashlib.sha256(envelope.read_bytes()).hexdigest(),
        "meshBind": matrix_values(rt.skinUtils.getMeshBindTM(node)),
        "bones": bones,
        "vertices": len(dq),
        "dq": compressed_values([float(v) for v in dq]),
        "modified": compressed_values([bool(v) for v in modified]),
        "rigid": compressed_values([bool(v) for v in rigid]),
        "unnormalized": compressed_values([bool(v) for v in unnormalized]),
        "enableDQ": bool(skin.enableDQ),
        "gizmos": int(rt.skinOps.getNumberOfGizmos(skin)),
    }


def run():
    project = Path(os.environ["RUN_RAID_PROJECT"])
    native = project / ".asset-work/max-preservation/native"
    target = native / "envelopes"
    target.mkdir(exist_ok=True)
    plan = json.loads((native / "plan.json").read_text("utf8"))
    only = os.environ.get("RAID_SKIN_ONLY")
    errors = 0
    for row in plan:
        sha, source = row["sha256"], row["source"]
        if only and only.casefold() not in source.casefold():
            continue
        output = target / (sha + ".json.gz")
        if output.is_file():
            with gzip.open(output, "rt", encoding="utf8") as f:
                if json.load(f).get("version") == 2:
                    continue
        try:
            original = project / "asset-sources/player" / source
            if hashlib.sha256(original.read_bytes()).hexdigest() != sha:
                raise ValueError("Source SHA-256 differs from archive")
            rt.resetMaxFile(rt.name("noPrompt"))
            if not rt.loadMaxFile(str(original), quiet=True, useFileUnits=True):
                raise RuntimeError("Unable to open " + source)
            result = {
                "version": 2,
                "sha256": sha,
                "source": source,
                "skins": [],
                "cages": [],
            }
            with pymxs.attime(rt.animationRange.start.frame):
                for node in rt.objects:
                    cage = export_cage(target, sha, node)
                    if cage is not None:
                        result["cages"].append(cage)
                    for i, mod in enumerate(getattr(node, "modifiers", [])):
                        if str(rt.classOf(mod)) == "Skin":
                            result["skins"].append(
                                capture_skin(node, mod, i, target, sha)
                            )
            work = output.with_suffix(".partial")
            with gzip.open(work, "wt", encoding="utf8", compresslevel=2) as f:
                json.dump(
                    result,
                    f,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    allow_nan=False,
                )
            work.replace(output)
            (target / (sha + ".error")).unlink(missing_ok=True)
            print("Skin", source, len(result["skins"]), flush=True)
        except Exception:
            (target / (sha + ".error")).write_text(traceback.format_exc(), "utf8")
            errors += 1
            if errors == 3:
                raise
    if errors:
        raise RuntimeError(f"{errors} source files require another Skin capture")


if __name__ == "__main__":
    run()
