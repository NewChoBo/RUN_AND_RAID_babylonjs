"""Verify native Skin envelope exports against the independently captured MAX scene."""

import argparse
import csv
import gzip
import hashlib
import json
import math
import struct
from collections import Counter
from pathlib import Path


def read(path):
    with gzip.open(path, "rt", encoding="utf8") as stream:
        return json.load(stream)


def vector(data, length):
    return len(data) == length and all(math.isfinite(v) for v in data)


def verify_cage(directory, cage, required):
    with gzip.open(directory / cage["file"], "rb") as stream:
        data = memoryview(stream.read())
    offset = 0

    def take(fmt):
        nonlocal offset
        packed = struct.Struct("<" + fmt)
        result = packed.unpack_from(data, offset)
        offset += packed.size
        return result

    def indices(limit):
        (n,) = take("i")
        if n < -1:
            raise ValueError("Invalid polygon degree")
        ids = ()
        if n > 0:
            ids = take(f"{n}i")
            if min(ids) < 0 or max(ids) >= limit:
                raise ValueError("Polygon vertex ID out of range")
        return n, ids

    version, nv, ne, nf = take("4i")
    if version != 1 or (nv, ne, nf) != (cage["vertices"], cage["edges"], cage["faces"]):
        raise ValueError("Native cage counts differ")
    for _ in range(nv):
        *xyz, _flags = take("3fI")
        if not vector(xyz, 3):
            raise ValueError("Invalid base-local vertex")
    edge_vertices = []
    for _ in range(ne):
        a, b, _flags = take("2iI")
        if (a, b) != (-1, -1) and (min(a, b) < 0 or max(a, b) >= nv):
            raise ValueError("Invalid native cage edge")
        edge_vertices.append((min(a, b), max(a, b)))
    live = [pair for pair in edge_vertices if pair[0] >= 0]
    duplicated = len(set(live)) < len(live)
    edges_file = directory / cage["file"].replace(".poly.gz", ".edges.gz")
    if required and duplicated and not edges_file.is_file():
        raise ValueError("Original duplicated edges need their face-to-edge sidecar")
    edge_data = None
    edge_offset = 8
    if edges_file.is_file():
        with gzip.open(edges_file, "rb") as fp:
            edge_data = fp.read()
        if struct.unpack_from("<2i", edge_data) != (1, nf):
            raise ValueError("Face-to-edge topology count differs")
    total = Counter(cages=1, cageVertices=nv, cageEdges=ne, cageFaces=nf)
    degree = []
    for _ in range(nf):
        n, vertices = indices(nv)
        if edge_data is not None:
            (count,) = struct.unpack_from("<i", edge_data, edge_offset)
            edge_offset += 4
            if count != n:
                raise ValueError("Original vertex/edge face degree differs")
            if count > 0:
                idx = struct.unpack_from(f"<{count}i", edge_data, edge_offset)
                edge_offset += 4 * count
                for j, edge in enumerate(idx):
                    a, b = vertices[j], vertices[(j + 1) % n]
                    if (
                        edge < 0
                        or edge >= ne
                        or edge_vertices[edge] != (min(a, b), max(a, b))
                    ):
                        raise ValueError(
                            "Explicit face edge and original vertex endpoints differ"
                        )
        degree.append(n)
        total[f"polygons{n}"] += 1
        take("iII")
    (channels,) = take("i")
    if channels < 0:
        raise ValueError("Invalid native cage map count")
    total["cageMaps"] = channels
    for _ in range(channels):
        _id, uv, faces = take("3i")
        if min(uv, faces) < 0 or faces not in (0, nf):
            raise ValueError("Invalid cage map table dimensions")
        if not all(math.isfinite(v) for v in take(f"{uv * 3}f")):
            raise ValueError("Non-finite cage UVW")
        for i in range(faces):
            if indices(uv)[0] != degree[i]:
                raise ValueError("Polygon and map face degrees differ")
    if offset != len(data):
        raise ValueError("Unexpected bytes at end of cage")
    if edge_data is not None and edge_offset != len(edge_data):
        raise ValueError("Unexpected bytes at end of original edge table")
    total["explicitEdgeCages"] += edge_data is not None
    return total


def verify_env_header(stored, skin):
    """3ds Max 2027 writes envelope version 13. Compare its binary bone tables to SkinOps."""
    version, count = struct.unpack_from("<ii", stored)
    if version != 13 or count != len(skin["bones"]):
        raise ValueError("Native ENV version or bone count differs")
    stored_ids = []
    offset = 8
    for bone in skin["bones"]:
        (nbytes,) = struct.unpack_from("<i", stored, offset)
        offset += 4
        name = stored[offset : offset + nbytes]
        offset += nbytes
        bone_id, _flags, *endpoints, sections = struct.unpack_from(
            "<iH6fi", stored, offset
        )
        offset += struct.calcsize("<iH6fi")
        # ENV stores persistent zero-based slots, including holes left by removed bones.
        # SkinOps exposes the dense active-bone index. Their rows use the same order.
        if bone_id < 0 or bone_id in stored_ids:
            raise ValueError("Duplicate or invalid original ENV bone slot")
        stored_ids.append(bone_id)
        if not any(
            name == bone["name"].encode(codec, errors="replace") + b"\0"
            for codec in ("utf8", "cp949", "cp1252")
        ):
            raise ValueError("Native ENV encoded bone name differs")
        if endpoints != bone["start"] + bone["end"] or sections != len(
            bone["sections"]
        ):
            raise ValueError("Native ENV endpoints or section count differ")
        for expected in bone["sections"]:
            inner, outer, u = struct.unpack_from("<3f", stored, offset)
            offset += 12
            if [u, inner, outer] != expected:
                raise ValueError("Native ENV cross section differs from SkinOps")
    return stored_ids


def verify_base_objects(native, data, scene, required):
    directory = native / "envelopes"
    cages = {c["node"] for c in data["cages"]}
    owners = {
        n["handle"]: n
        for n in scene["nodes"]
        if n.get("mesh") and n["handle"] not in cages
    }
    if not owners:
        return {}
    path = directory / (data["sha256"] + ".extra.json.gz")
    if not path.is_file() and not required:
        return {}
    record = read(path)
    if record["source"] != scene["source"] or {
        n["node"] for n in record["objects"]
    } != set(owners):
        raise ValueError("Base geometry owner mismatch")
    result = Counter()
    for entry in record["objects"]:
        owner = owners[entry["node"]]
        shape = entry["polyShape"]
        with gzip.open(directory / shape["file"], "rb") as fp:
            b = fp.read()
        version, nv, nf = struct.unpack_from("<3i", b)
        if version != 1 or (nv, nf) != (shape["vertices"], shape["faces"]):
            raise ValueError("Pre-stack Editable Mesh counts differ")
        offset = 12 + 12 * nv
        vertices = list(struct.iter_unpack("<3f", b[12:offset]))
        if not all(vector(p, 3) for p in vertices):
            raise ValueError("Invalid base object coordinates")
        for a, c, d, _mat, _smoothing, *normals in struct.iter_unpack(
            "<4iI9f", b[offset : offset + 56 * nf]
        ):
            if min(a, c, d) < 0 or max(a, c, d) >= nv or not vector(normals, 9):
                raise ValueError("Invalid base object triangles")
        offset += 56 * nf
        (channels,) = struct.unpack_from("<i", b, offset)
        offset += 4
        for _ in range(channels):
            _channel, nuv, nfaces = struct.unpack_from("<3i", b, offset)
            offset += 12
            uv = struct.unpack_from(f"<{3 * nuv}f", b, offset)
            offset += 12 * nuv
            refs = struct.unpack_from(f"<{3 * nfaces}i", b, offset)
            offset += 12 * nfaces
            if not vector(uv, len(uv)) or (
                refs and (min(refs) < 0 or max(refs) >= nuv)
            ):
                raise ValueError("Invalid base object UV")
        if offset != len(b):
            raise ValueError("Unexpected bytes at end of base triangle table")
        with gzip.open(directory / shape["edgeVisibility"], "rb") as fp:
            flags = fp.read()
        if (
            struct.unpack_from("<2i", flags) != (1, nf)
            or len(flags) != 8 + nf
            or any(f > 7 for f in flags[8:])
        ):
            raise ValueError("Invalid editable mesh edge display flags")
        if not owner["modifiers"]:
            with gzip.open(native / "surfaces" / owner["mesh"]["file"], "rb") as fp:
                observed = fp.read(12 + 12 * nv)
            if struct.unpack_from("<3i", observed) != (version, nv, nf):
                raise ValueError("Primitive and shape counts differ")
            matrix = entry["objectWorld"]
            for xyz, world in zip(
                vertices, struct.iter_unpack("<3f", observed[12:]), strict=True
            ):
                for i in range(3):
                    value = (
                        sum(xyz[j] * matrix[3 * j + i] for j in range(3))
                        + matrix[9 + i]
                    )
                    if not math.isclose(
                        value, world[i], abs_tol=0.0001, rel_tol=0.00001
                    ):
                        raise ValueError(
                            "Primitive local position does not match its evaluated world position"
                        )
        result["extraBaseObjects"] += 1
        result["extraBase_" + entry["baseClass"]] += 1
    return result


def verify_envelope(directory, data, scene, required=True):
    if data["source"] != scene["source"] or data["sha256"] != scene["sha256"]:
        raise ValueError("Skin export source mismatch")
    nodes = {n["handle"]: n for n in scene["nodes"]}
    expected = {
        (n["handle"], i)
        for n in scene["nodes"]
        for i, m in enumerate(n["modifiers"])
        if m["type"] == "Skin"
    }
    if {(s["node"], s["stackIndex"]) for s in data["skins"]} != expected:
        raise ValueError(
            "Different Skin modifiers in original scene and envelope export"
        )
    total = Counter()
    for cage in data["cages"]:
        if (
            nodes[cage["node"]]["name"] != cage["name"]
            or not vector(cage["objectWorld"], 12)
            or cage["frame"] != scene["timing"]["first"]
        ):
            raise ValueError("Cage owner or object-world transform metadata differs")
        total.update(verify_cage(directory, cage, required))
    for s in data["skins"]:
        stored = (directory / s["file"]).read_bytes()
        if len(stored) < 8 or hashlib.sha256(stored).hexdigest() != s["sha256"]:
            raise ValueError("Native envelope file checksum differs")
        env_ids = verify_env_header(stored, s)
        total["persistentBoneSlotsDiffer"] += sum(
            raw + 1 != b["boneID"] for raw, b in zip(env_ids, s["bones"], strict=True)
        )
        m = nodes[s["node"]]["modifiers"][s["stackIndex"]]
        count = s["vertices"]
        if count != m["vertices"] or not vector(s["meshBind"], 12):
            raise ValueError("Mesh bind/count mismatch")
        if len(s["bones"]) != len(m["bones"]):
            raise ValueError("Envelope bone count mismatch")
        bones_by_id = {str(b["boneID"]): b for b in s["bones"]}
        if len(bones_by_id) != len(s["bones"]):
            raise ValueError("Duplicate native envelope bone IDs")
        for id_, name in m["weightedBoneIDs"].items():
            if bones_by_id[id_]["name"] != name:
                raise ValueError("Native paint and envelope bone names differ")
        for b in s["bones"]:
            if (
                b["node"] not in nodes
                or nodes[b["node"]]["name"] != b["name"]
                or not vector(b["bind"], 12)
                or not vector(b["stretch"], 12)
                or not vector(b["start"], 3)
                or not vector(b["end"], 3)
                or not all(vector(row, 3) for row in b["sections"])
            ):
                raise ValueError("Invalid bone bind, envelope or section")
            total["bones"] += 1
            total["sections"] += len(b["sections"])
        for name in ("dq", "modified", "rigid", "unnormalized"):
            values = s[name]
            if len(values) not in (1, count) or not all(
                math.isfinite(v) for v in values
            ):
                raise ValueError("Invalid vertex flags or DQ paint")
            total[name + "NonzeroVertices"] += sum(bool(v) for v in values) * (
                count if len(values) == 1 else 1
            )
        total.update(skins=1, vertices=count, gizmos=s["gizmos"])
    return total


def run(native, partial):
    directory = native / "envelopes"
    plan = json.loads((native / "plan.json").read_text("utf8"))
    result = {
        "version": 1,
        "expected": len(plan),
        "verified": 0,
        "metrics": Counter(),
        "failed": {},
        "pending": [],
    }
    by_sha = {}
    for row in plan:
        file = row["sha256"] + ".json.gz"
        if not (directory / file).is_file() or not (native / "scenes" / file).is_file():
            result["pending"].append(row["source"])
            continue
        try:
            data, scene = read(directory / file), read(native / "scenes" / file)
            total = verify_envelope(directory, data, scene, not partial)
            total.update(verify_base_objects(native, data, scene, not partial))
        except (
            KeyError,
            ValueError,
            OSError,
            EOFError,
            IndexError,
            struct.error,
        ) as error:
            result["failed"][row["source"]] = str(error)
        else:
            result["verified"] += 1
            result["metrics"].update(total)
            modifier_types = sorted(
                {m["type"] for n in scene["nodes"] for m in n["modifiers"]}
            )
            missing = [
                n["name"]
                for n in scene["nodes"]
                if any(m["type"] == "Missing_OSM" for m in n["modifiers"])
            ]
            special = []
            extra = directory / (row["sha256"] + ".extra.json.gz")
            if extra.is_file():
                by_node = {n["handle"]: n["type"] for n in scene["nodes"]}
                special = [
                    f"{obj['name']} ({obj['baseClass']} → {by_node[obj['node']]})"
                    for obj in read(extra)["objects"]
                ]
            by_sha[row["sha256"]] = (total, modifier_types, missing, special)
    files = json.loads((native / "inventory.json").read_text("utf8"))["files"]
    keys = [
        "cages",
        "cageVertices",
        "cageEdges",
        "cageFaces",
        "polygons3",
        "polygons4",
        "cageMaps",
        "skins",
        "vertices",
        "bones",
        "sections",
        "dqNonzeroVertices",
        "extraBaseObjects",
    ]
    canonical = {r["sha256"]: r["source"] for r in plan}
    csv_file = directory / "authoring-audit.csv"
    temporary = csv_file.with_suffix(".partial")
    with temporary.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "원본 경로",
                "SHA-256",
                "동일 원본 대표 경로",
                "검사 결과",
                *keys,
                "원본 모디파이어",
                "원본 플러그인 누락 노드",
                "별도 보존 형상 (기본 형식 → 스택 적용 형식)",
            ]
        )
        for r in files:
            if r["kind"] not in ("scene", "motion"):
                continue
            sha = r["sha256"]
            if sha in by_sha:
                metrics, mods, missing, special = by_sha[sha]
                state = "검증(중간)" if partial else "검증"
                rest = [
                    *(metrics.get(k, 0) for k in keys),
                    ", ".join(mods),
                    ", ".join(missing),
                    ", ".join(special),
                ]
            else:
                state = result["failed"].get(canonical[sha], "대기")
                rest = [""] * (len(keys) + 3)
            writer.writerow([r["source"], sha, canonical[sha], state, *rest])
    temporary.replace(csv_file)
    out = directory / "verification.json"
    work = out.with_suffix(".partial")
    work.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf8")
    work.replace(out)
    print(
        result["verified"],
        result["metrics"],
        "failed",
        len(result["failed"]),
        "pending",
        len(result["pending"]),
    )
    if result["failed"] or (not partial and result["pending"]):
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "native",
        type=Path,
        nargs="?",
        default=Path(".asset-work/max-preservation/native"),
    )
    parser.add_argument("--partial", action="store_true")
    args = parser.parse_args()
    run(args.native, args.partial)
