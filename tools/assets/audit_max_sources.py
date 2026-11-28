"""Read original MAX files in 3ds Max Batch, retaining authoring metadata and world transforms."""

import gzip
import hashlib
import json
import msvcrt
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

import pymxs
from pymxs import runtime as rt

root = Path(os.environ["RUN_RAID_PROJECT"])
sys.path.insert(0, str(root / "tools/assets"))
from export_max_extensions import capture_extended
from max_constraint_reference import capture_constraints, class_key, classes
from max_edit_tracks import save_tracks
from max_motion_reference import timing as native_timing
from max_surface_reference import save_surfaces

out = root / ".asset-work/max-preservation/native"
source = root / "asset-sources/player"
destination = out / "scenes"
destination.mkdir(parents=True, exist_ok=True)
plan = json.loads((out / "plan.json").read_text("utf8"))
with gzip.open(out / "compound.json.gz", "rt", encoding="utf8") as manifest:
    constraint_scenes = {
        sha
        for sha, info in json.load(manifest).items()
        if any(class_key(name) in classes for name, *_ in info["classes"])
    }
if priority := os.environ.get("RAID_AUDIT_FIRST"):
    plan.sort(key=lambda row: row["source"].casefold() != priority.casefold())

# Write world-space node transforms without crossing the Max/Python boundary per element.
# Row-major 3x3 basis followed by translation (Max system units), frame-major then node-major.
write_tracks = rt.execute("""(fn raidPreserveTransforms nodes path first last = (
    local f = fopen path "wb"
    if f == undefined do throw "Cannot open transform stream"
    try (
        for frame=first to last do at time frame (
            for n in nodes do (
                local m = n.transform
                for row in #(m.row1, m.row2, m.row3, m.row4) do (
                    writeFloat f row.x; writeFloat f row.y; writeFloat f row.z
                )
            )
        )
    ) catch (fclose f; throw())
    fclose f
))""")
mesh_info = rt.execute("""(fn raidPreserveMesh node = (
    local m = snapshotAsMesh node
    if m == undefined do return undefined
    local channels = #()
    for channel=-2 to (meshop.getNumMaps m)-1 where meshop.getMapSupport m channel do (
        append channels #(channel, meshop.getNumMapVerts m channel, meshop.getNumMapFaces m channel)
    )
    local slots = #(), used = #{}
    for i=1 to m.numfaces do (
        appendIfUnique slots (getFaceMatID m i)
        local f=getFace m i
        used[f.x as integer]=true; used[f.y as integer]=true; used[f.z as integer]=true
    )
    local lo=[1e30,1e30,1e30], hi=[-1e30,-1e30,-1e30]
    for i in used do (
        local p=getVert m i
        for c=1 to 3 do (if p[c]<lo[c] do lo[c]=p[c]; if p[c]>hi[c] do hi[c]=p[c])
    )
    local result = #(m.numverts,m.numfaces,channels,slots,lo,hi,used.numberSet)
    free m
    result
))""")
controller_info = rt.execute("""(fn raidPreserveControllers n = (
    local c=n.controller
    local pos=try(c.position.controller)catch(undefined)
    local rot=try(c.rotation.controller)catch(undefined)
    local scl=try(c.scale.controller)catch(undefined)
    for axis in #(c,pos,rot,scl) collect (
        if axis==undefined then undefined else #((classof axis) as string,try(numKeys axis)catch(-1))
    )
))""")


def ctype(value):
    return str(rt.classOf(value)) if value is not None else None


def flat_matrix(m):
    return [float(c) for row in (m.row1, m.row2, m.row3, m.row4) for c in row]


def properties(obj):
    """Store readable scalar/vector settings and the classes of plugin-managed references."""
    if obj is None:
        return {}
    values = {}
    for prop in rt.getPropNames(obj):
        try:
            value = rt.getProperty(obj, prop)
            if value is None or isinstance(value, (bool, int, float, str)):
                values[str(prop)] = value
            elif ctype(value) in (
                "Point2",
                "Point3",
                "Point4",
                "Quat",
                "Color",
                "AColor",
            ):
                components = "rgba" if "color" in ctype(value).lower() else "xyzw"
                values[str(prop)] = [
                    float(getattr(value, axis))
                    for axis in components
                    if hasattr(value, axis)
                ]
            else:
                values[str(prop)] = {"class": ctype(value)}
        except (RuntimeError, AttributeError, TypeError):
            values[str(prop)] = {"unreadable": True}
    return values


def mesh(obj):
    m = mesh_info(obj)
    if m is None:
        return None
    return {
        "vertices": int(m[0]),
        "faces": int(m[1]),
        "mapChannels": [list(v) for v in m[2]],
        "materialIDs": list(m[3]),
        "bounds": [list(m[4]), list(m[5])] if m[6] else None,
        "usedVertices": int(m[6]),
    }


def material_info(material):
    return {
        "name": str(material.name),
        "type": ctype(material),
        "properties": properties(material),
        "subMaterials": [
            str(v.name) if v is not None else None
            for v in (
                rt.getSubMtl(material, i + 1) for i in range(rt.getNumSubMtls(material))
            )
        ],
        "maps": [
            [str(rt.getSubTexmapSlotName(material, i + 1)), ctype(tex), str(tex.name)]
            for i in range(rt.getNumSubTexmaps(material))
            if (tex := rt.getSubTexmap(material, i + 1)) is not None
        ],
    }


def scene(row, objects):
    first, last = int(rt.animationRange.start.frame), int(rt.animationRange.end.frame)
    records = []
    with pymxs.attime(first):
        for obj in objects:
            typ = ctype(obj)
            mods = []
            for mod in getattr(obj, "modifiers", []):
                entry = {
                    "name": str(mod.name),
                    "type": ctype(mod),
                    "properties": properties(mod),
                }
                if entry["type"] == "Skin":
                    entry["bones"] = [
                        str(rt.skinOps.getBoneName(mod, i + 1, 0))
                        for i in range(rt.skinOps.getNumberBones(mod))
                    ]
                    entry["vertices"] = int(rt.skinOps.getNumberVertices(mod))
                mods.append(entry)
            record = {
                "name": str(obj.name),
                "parent": str(obj.parent.name) if obj.parent else None,
                "handle": int(obj.handle),
                "type": typ,
                "superClass": str(rt.superClassOf(obj)),
                "modifiers": mods,
                "controller": [
                    list(v) if v is not None else None for v in controller_info(obj)
                ],
                "world": flat_matrix(obj.transform),
                "objectWorld": flat_matrix(obj.objectTransform),
                "layer": str(obj.layer.name),
                "userProperties": str(rt.getUserPropBuffer(obj)),
                "material": str(obj.material.name) if obj.material else None,
                "hidden": bool(obj.isHidden),
                "renderable": bool(obj.renderable),
            }
            if record["superClass"].lower() == "geometryclass" and typ.lower() not in {
                "biped_object",
                "bonegeometry",
                "biped",
                "dummy",
            }:
                record["mesh"] = mesh(obj)
            records.append(record)
    track_file = destination / (row["sha256"] + ".f32")
    try:
        write_tracks(rt.Array(*objects), str(track_file), first, last)
        expected_bytes = (last - first + 1) * len(objects) * 48
        if track_file.stat().st_size != expected_bytes:
            raise ValueError(f"Expected {expected_bytes} transform bytes")
        compressed = track_file.with_suffix(".partial")
        with (
            track_file.open("rb") as src,
            gzip.open(compressed, "wb", compresslevel=3) as dst,
        ):
            shutil.copyfileobj(src, dst)
        compressed.replace(track_file.with_suffix(".f32.gz"))
    finally:
        track_file.unlink(missing_ok=True)
    result = {
        "source": row["source"],
        "sha256": row["sha256"],
        "nodes": records,
        "units": {
            "system": str(rt.units.SystemType),
            "scale": float(rt.units.SystemScale),
            "perMeter": float(rt.units.decodeValue("1m")),
        },
        "timing": {
            "first": first,
            "last": last,
            "fps": int(rt.frameRate),
            "ticksPerFrame": int(rt.ticksPerFrame),
        },
        "assetBitmaps": row["assetBitmaps"],
    }
    return result


def finish(row, objects, data):
    meshes = data["nodes"]
    if [record["handle"] for record in meshes] != [
        int(node.handle) for node in objects
    ]:
        raise ValueError("Saved and reopened scene node order differ")
    with pymxs.attime(data["timing"]["first"]):
        for obj, record in zip(objects, meshes):
            if record["superClass"].lower() in ("light", "camera", "helper"):
                record["objectProperties"] = properties(obj.baseObject)
        materials = list(rt.sceneMaterials)
        seen = {int(rt.getHandleByAnim(m)) for m in materials}
        for m in materials:
            for i in range(rt.getNumSubMtls(m)):
                sub = rt.getSubMtl(m, i + 1)
                if sub is not None and int(rt.getHandleByAnim(sub)) not in seen:
                    materials.append(sub)
                    seen.add(int(rt.getHandleByAnim(sub)))
        data["materials"] = [material_info(m) for m in materials]
        data["bitmaps"] = [
            {
                "name": str(m.name),
                "path": str(m.filename),
                "properties": properties(m),
                "coordinates": properties(m.coords),
            }
            for m in rt.getClassInstances(rt.Bitmaptexture)
        ]
    save_surfaces(
        out / "surfaces", row["sha256"], objects, meshes, data["timing"]["first"]
    )
    data["version"] = 3
    return data


def run():
    locks = out / "claims"
    locks.mkdir(exist_ok=True)
    shard, count = (
        int(os.environ.get("RAID_AUDIT_SHARD", "0")),
        int(os.environ.get("RAID_AUDIT_SHARDS", "1")),
    )
    sample_profile = os.environ.get("RAID_AUDIT_PROFILE") == "1"
    stop_path = os.environ.get("RAID_AUDIT_STOP_FILE")
    for row in plan[shard::count]:
        if stop_path and Path(stop_path).is_file():
            break
        output = destination / (row["sha256"] + ".json.gz")
        previous = None
        observed_time = output.stat().st_mtime_ns if output.is_file() else 0
        if (
            output.exists()
            and output.with_suffix("").with_suffix(".f32.gz").is_file()
            and (out / "tracks" / output.name).is_file()
        ):
            with gzip.open(output, "rt", encoding="utf8") as f:
                previous = json.load(f)
            if previous.get("version") == 3 and previous.get("trackVersion") == 2:
                continue
        claim = (locks / row["sha256"]).open("a+b")
        try:
            claim.seek(0)
            msvcrt.locking(claim.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            claim.close()
            continue
        error_file = destination / (row["sha256"] + ".error")
        try:
            if output.is_file() and output.stat().st_mtime_ns != observed_time:
                with gzip.open(output, "rt", encoding="utf8") as f:
                    completed = json.load(f)
                if completed.get("version") == 3 and completed.get("trackVersion") == 2:
                    continue
            elapsed = {}
            start = time.perf_counter()
            rt.resetMaxFile(rt.name("noPrompt"))
            original = source / row["source"]
            with original.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != row["sha256"]:
                    raise ValueError("Source bytes differ from archive inventory")
            if not rt.loadMaxFile(str(original), quiet=True, useFileUnits=True):
                raise RuntimeError("3ds Max could not open source")
            objects = list(rt.objects)
            loaded = time.perf_counter()
            data = (
                previous
                if previous and previous.get("version") in (2, 3)
                else scene(row, objects)
            )
            matrices = time.perf_counter()
            if data.get("version") != 3:
                data = finish(row, objects, data)
            data["timing"].update(native_timing())
            data["environment"] = {
                "renderer": ctype(rt.renderers.current),
                "renderWidth": int(rt.renderWidth),
                "renderHeight": int(rt.renderHeight),
                "pixelAspect": float(rt.renderPixelAspect),
                "environmentMap": ctype(rt.environmentMap),
            }
            if row["sha256"] in constraint_scenes:
                capture_constraints(out / "constraints", row["sha256"], row["source"])
            surface = time.perf_counter()
            if sample_profile:
                import cProfile

                profiler = cProfile.Profile()
                profiler.runcall(
                    save_tracks, out / "tracks" / output.name, row["source"], objects
                )
                profiler.dump_stats(
                    str(out / ("key-profile-" + str(os.getpid()) + ".pstats"))
                )
                sample_profile = False
            else:
                save_tracks(out / "tracks" / output.name, row["source"], objects)
            data["trackVersion"] = 2
            elapsed.update(
                load=loaded - start,
                nodesAndMatrices=matrices - loaded,
                surfaces=surface - matrices,
                keysAndBip=time.perf_counter() - surface,
            )
            with (out / f"timing-{os.getpid()}.jsonl").open(
                "a", encoding="utf8"
            ) as log:
                log.write(json.dumps({"source": row["source"], **elapsed}) + "\n")
            partial = output.with_suffix(".partial")
            with gzip.open(partial, "wt", encoding="utf8", compresslevel=2) as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            partial.replace(output)
            error_file.unlink(missing_ok=True)
            # The native snapshot is complete even if one of the extra Alembic ranges
            # needs a retry. Its own receipt is written only after that extraction succeeds.
            extended_dir = out.parent / "extended"
            extended_dir.mkdir(exist_ok=True)
            extended_error = extended_dir / (row["sha256"] + ".error")
            try:
                capture_extended(row, out)
                extended_error.unlink(missing_ok=True)
            except (
                RuntimeError,
                ValueError,
                OSError,
                TypeError,
                KeyError,
                AttributeError,
            ):
                extended_error.write_text(
                    row["source"] + "\n" + traceback.format_exc(), encoding="utf8"
                )
            print("OK", row["source"], flush=True)
        except Exception:  # noqa: BLE001 -- preserve plugin tracebacks and continue the other scenes
            error_file.write_text(
                row["source"] + "\n" + traceback.format_exc(), encoding="utf8"
            )
            print("FAILED", row["source"], flush=True)
            if not any(destination.glob("*.json.gz")):
                break
        finally:
            claim.close()


if __name__ == "__main__":
    run()
