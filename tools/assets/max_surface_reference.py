"""Preserve evaluated triangle, map-channel and Skin tables of a loaded MAX scene."""

import gzip
import shutil
from pathlib import Path

import pymxs
from pymxs import runtime as rt

# All indices in the triangle and UV tables are zero-based. Material and Skin bone IDs
# retain the values used by Max. Each file starts with three int32s: version, vertex count,
# face count. See the preservation guide for the order of subsequent arrays.
geometry = rt.execute("""(fn raidWriteMesh node path baseMesh:false = (
    local m=if baseMesh then (copy node.baseObject.mesh) else (snapshotAsMesh node)
    local f=fopen path "wb"
    if f==undefined do throw "Cannot open surface output"
    try (
        writeLong f 1; writeLong f m.numverts; writeLong f m.numfaces
        for v=1 to m.numverts do (
            local p=getVert m v; writeFloat f p.x; writeFloat f p.y; writeFloat f p.z
        )
        for face=1 to m.numfaces do (
            local tri=getFace m face
            writeLong f ((tri.x as integer)-1); writeLong f ((tri.y as integer)-1); writeLong f ((tri.z as integer)-1)
            writeLong f (getFaceMatID m face); writeLong f (getFaceSmoothGroup m face)
            for n in (meshop.getFaceRNormals m face) do (writeFloat f n.x; writeFloat f n.y; writeFloat f n.z)
        )
        local channels=for c=-2 to (meshop.getNumMaps m)-1 where meshop.getMapSupport m c collect c
        writeLong f channels.count
        for c in channels do (
            local verts=meshop.getNumMapVerts m c, faces=meshop.getNumMapFaces m c
            writeLong f c; writeLong f verts; writeLong f faces
            for v=1 to verts do (
                local uv=meshop.getMapVert m c v; writeFloat f uv.x; writeFloat f uv.y; writeFloat f uv.z
            )
            for i=1 to faces do (
                local tri=meshop.getMapFace m c i
                writeLong f ((tri.x as integer)-1); writeLong f ((tri.y as integer)-1); writeLong f ((tri.z as integer)-1)
            )
        )
    ) catch (fclose f; free m; throw())
    fclose f
    free m
))""")

# int32 version, vertex count, then an int32 influence count and (int32 bone ID, float32
# weight) pairs per vertex. Returning actual IDs avoids assumptions about deleted bones.
skin_weights = rt.execute("""(fn raidWriteWeights sk path = (
    local f=fopen path "wb", used=#{}
    if f==undefined do throw "Cannot open weights output"
    try (
        local count=skinOps.getNumberVertices sk
        writeLong f 1; writeLong f count
        for v=1 to count do (
            local influences=skinOps.getVertexWeightCount sk v
            writeLong f influences
            for i=1 to influences do (
                local id=skinOps.getVertexWeightBoneID sk v i
                writeLong f id; writeFloat f (skinOps.getVertexWeight sk v i)
                used[id]=true
            )
        )
    ) catch (fclose f; throw())
    fclose f
    for b in used collect #(b,skinOps.getBoneName sk b 0)
))""")


def compressed_capture(writer, target, obj):
    raw = target.with_suffix(".raw")
    try:
        result = writer(obj, str(raw))
        temporary = target.with_suffix(".partial")
        with (
            raw.open("rb") as data,
            gzip.open(temporary, "wb", compresslevel=3) as output,
        ):
            shutil.copyfileobj(data, output)
        temporary.replace(target)
        return result
    finally:
        raw.unlink(missing_ok=True)


def save_surfaces(directory, sha, nodes, records, frame):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with pymxs.attime(frame):
        for node, record in zip(nodes, records, strict=True):
            key = f"{sha}-{record['handle']}"
            if record.get("mesh"):
                path = directory / (key + ".mesh.gz")
                compressed_capture(geometry, path, node)
                record["mesh"]["file"] = path.name
            for index, mod in enumerate(getattr(node, "modifiers", [])):
                entry = record["modifiers"][index]
                if entry["type"] == "Skin":
                    path = directory / f"{key}-{index}.skin.gz"
                    pairs = compressed_capture(skin_weights, path, mod)
                    entry["weightFile"] = path.name
                    entry["weightedBoneIDs"] = {
                        str(int(i)): str(name) for i, name in pairs
                    }
