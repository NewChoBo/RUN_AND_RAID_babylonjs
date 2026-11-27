"""Sample Longshot's rigid grip and arrow from the evaluated Skin in Autodesk 3ds Max Batch."""
import json
import os
from pathlib import Path

import pymxs
from pymxs import runtime as rt

root = Path(os.environ["RUN_RAID_PROJECT"])
source = root / "asset-sources/player"
dest = root / ".asset-work/longshot-grip.json"
groups = ("Bip001 L Finger1", "Bowbone", "ArrowBn")
roles = {"run", "jump_loop", "die", "attack1", *(f"skill{i}start" for i in range(1, 5))}
references = {}
for path in sorted((source / "longShot/Animation").rglob("*.max")):
    if path.stem.lower().split("#")[-1] not in roles:
        continue
    if not rt.loadMaxFile(str(path), quiet=True, useFileUnits=True):
        raise RuntimeError(f"Cannot open {path}")
    mesh, skin = next((obj, mod) for obj in rt.objects for mod in getattr(obj, "modifiers", [])
                      if str(rt.classOf(mod)).lower() == "skin")
    indices = {name: [] for name in groups}
    for i in range(1, rt.skinOps.getNumberVertices(skin) + 1):
        count = rt.skinOps.getVertexWeightCount(skin, i)
        if count:
            j = max(range(1, count + 1), key=lambda j: rt.skinOps.getVertexWeight(skin, i, j))
            bone = rt.skinOps.getVertexWeightBoneID(skin, i, j)
            name = str(rt.skinOps.getBoneName(skin, bone, 0))
            if name in indices and (name == groups[0] or rt.skinOps.getVertexWeight(skin, i, j) > 0.999):
                indices[name].append(i)
    if min(map(len, indices.values())) < 3:
        raise ValueError(f"Missing grip reference points in {path}: {[(n,len(ids)) for n,ids in indices.items()]}")
    # Keep points across each piece, including the ends of the arrow and both limbs of the bow.
    for name, ids in indices.items():
        count = min(len(ids), 12)
        indices[name] = [ids[round(j * (len(ids) - 1) / (count - 1))] for j in range(count)]
    first, last = int(rt.animationRange.start.frame), int(rt.animationRange.end.frame)
    frames = []
    for frame in range(first, last + 1):
        with pymxs.attime(frame):
            evaluated = rt.snapshotAsMesh(mesh)
            frames.append({name: [list(rt.getVert(evaluated, i) * mesh.objectTransform) for i in ids]
                           for name, ids in indices.items()})
    references[path.relative_to(source).as_posix().lower()] = {
        "first": first, "vertices": {n: [i - 1 for i in ids] for n, ids in indices.items()},
        "frames": frames,
    }
if not references:
    raise ValueError("No Longshot source takes")
temp = dest.with_suffix(".partial.json")
temp.write_text(json.dumps(references, separators=(",", ":")), encoding="utf-8")
temp.replace(dest)
