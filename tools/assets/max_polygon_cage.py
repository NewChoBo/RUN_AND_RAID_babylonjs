"""Write the actual editable-poly base cage before Skin or any other modifier."""

from max_surface_reference import compressed_capture
from pymxs import runtime as rt

write_cage = rt.execute("""(fn raidSavePolyCage base path = (
    fn writePt file p = (writeFloat file p.x; writeFloat file p.y; writeFloat file p.z)
    fn writeIds file ids = (
        if ids == undefined then writeLong file -1 else (
            writeLong file ids.count
            for id in ids do writeLong file (id-1)
        )
    )
    local f=fopen path "wb"
    if f==undefined do throw "Cannot open base cage output"
    try (
        local nv=polyop.getNumVerts base, ne=polyop.getNumEdges base, nf=polyop.getNumFaces base
        writeLong f 1; writeLong f nv; writeLong f ne; writeLong f nf
        for i=1 to nv do (
            local pt=polyop.getVert base i
            if pt==undefined then writePt f [0,0,0] else writePt f pt
            writeLong f (polyop.getVertFlags base i)
        )
        for i=1 to ne do (
            local ids=polyop.getEdgeVerts base i
            if ids==undefined then (writeLong f -1; writeLong f -1) else (writeLong f (ids[1]-1);writeLong f (ids[2]-1))
            writeLong f (polyop.getEdgeFlags base i)
        )
        for i=1 to nf do (
            local ids=polyop.getFaceVerts base i
            writeIds f ids
            writeLong f (polyop.getFaceMatID base i); writeLong f (polyop.getFaceSmoothGroup base i); writeLong f (polyop.getFaceFlags base i)
        )
        local channels=for c=-2 to (polyop.getNumMaps base)-1 where polyop.getMapSupport base c collect c
        writeLong f channels.count
        for c in channels do (
            local uv=polyop.getNumMapVerts base c, faces=polyop.getNumMapFaces base c
            writeLong f c; writeLong f uv; writeLong f faces
            for v=1 to uv do writePt f (polyop.getMapVert base c v)
            for j=1 to faces do writeIds f (polyop.getMapFace base c j)
        )
    ) catch (fclose f; throw())
    fclose f
    true
))""")


def export_cage(directory, sha, node):
    base = node.baseObject
    if str(rt.classOf(base)) != "Editable_Poly":
        return None
    file = directory / f"{sha}-{int(node.handle)}.poly.gz"
    compressed_capture(write_cage, file, base)
    world = node.objectTransform
    return {
        "node": int(node.handle),
        "name": str(node.name),
        "file": file.name,
        "frame": float(rt.currentTime.frame),
        "objectWorld": [
            float(v)
            for row in (world.row1, world.row2, world.row3, world.row4)
            for v in row
        ],
        "vertices": int(rt.polyop.getNumVerts(base)),
        "edges": int(rt.polyop.getNumEdges(base)),
        "faces": int(rt.polyop.getNumFaces(base)),
    }
