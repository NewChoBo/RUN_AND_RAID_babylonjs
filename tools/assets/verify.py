"""Verify the entire local library against source hashes, GLB buffers and lossless textures."""
import hashlib
import io
import json
import struct
from collections import Counter
from pathlib import PurePosixPath
from PIL import Image
from library import PUBLIC, SOURCE, read_json


def glb(path, item):
    data = path.read_bytes()
    magic, version, length, jlen, jtype = struct.unpack_from("<4sIII4s", data)
    assert (magic, version, length, jtype) == (b"glTF", 2, len(data), b"JSON")
    doc = json.loads(data[20:20+jlen])
    blen, btype = struct.unpack_from("<I4s", data, 20+jlen)
    binary = memoryview(data)[28+jlen:]
    assert btype==b"BIN\0" and len(binary)==blen and doc["buffers"][0]["byteLength"]<=blen
    for view in doc["bufferViews"]:
        assert view["buffer"]==0 and 0<=view.get("byteOffset",0)<=blen-view["byteLength"]
    for mesh in doc["meshes"]:
        for p in mesh["primitives"]:
            assert doc["accessors"][p["attributes"]["POSITION"]]["count"]>0
    for image in doc.get("images", []):
        view=doc["bufferViews"][image["bufferView"]]
        start=view.get("byteOffset",0)
        with Image.open(io.BytesIO(binary[start:start+view["byteLength"]])) as im:
            im.verify()
    assert len(doc.get("images",[]))==item["embeddedImages"]
    assert len(doc.get("animations",[]))==len(item["clips"])
    assert len(doc.get("skins",[]))==item["skins"]


def main():
    catalog = read_json(PUBLIC / "catalog.json");ids=set();paths=set()
    for r in catalog["files"]:
        try:
            assert r["id"] not in ids and r["path"] not in paths
            ids.add(r["id"]);paths.add(r["path"])
            source=SOURCE.joinpath(*PurePosixPath(r["path"]).parts)
            with source.open("rb") as f:
                assert hashlib.file_digest(f,"sha256").hexdigest()==r["sha256"] and source.stat().st_size==r["bytes"]
            if "thumbnail" in r:
                with Image.open(PUBLIC/r["thumbnail"]) as im:im.verify()
            if r["state"] in ("static","animated"):
                glb(PUBLIC/r["model"],r)
            elif r["state"]=="texture":
                with Image.open(source) as a, Image.open(PUBLIC/r["texture"]) as b:
                    assert a.size==b.size and a.convert("RGBA").tobytes()==b.convert("RGBA").tobytes()
            elif r["state"]=="hierarchy":
                nodes=read_json(PUBLIC/r["hierarchy"])["nodes"]
                names={n["name"] for n in nodes}
                assert len(names)==r["nodes"] and all(n["parent"] is None or n["parent"] in names for n in nodes)
            elif r["state"]=="source-only":
                assert r.get("detail")
            else:
                raise ValueError("Unprocessed or failed asset")
        except Exception as e:
            raise RuntimeError(r["path"]) from e
    counts=Counter(r["state"] for r in catalog["files"])
    models=[r for r in catalog["files"] if r.get("model")]
    print("Verified",len(ids),"sources;",dict(counts))
    print("GLBs with embedded images:",sum(r["embeddedImages"]>0 for r in models),"/",len(models))


if __name__=="__main__":
    main()
