"""Reopen native source sidecars, check every buffer, and list per-file exceptions."""

import argparse
import csv
import gzip
import hashlib
import json
import os
import struct
from collections import Counter
from pathlib import Path

import numpy as np


class Buffer:
    def __init__(self, path):
        with gzip.open(path) as stream:
            self.data = stream.read()
        self.offset = 0

    def integer(self):
        (result,) = struct.unpack_from("<i", self.data, self.offset)
        self.offset += 4
        return result

    def array(self, dtype, count):
        values = np.frombuffer(self.data, dtype=dtype, count=count, offset=self.offset)
        self.offset += values.nbytes
        return values

    def complete(self):
        if self.offset != len(self.data):
            raise ValueError("Unexpected bytes at end of native buffer")


face_type = np.dtype(
    [
        ("verts", "<i4", 3),
        ("material", "<i4"),
        ("smooth", "<u4"),
        ("normals", "<f4", (3, 3)),
    ]
)
influence_type = np.dtype([("bone", "<i4"), ("weight", "<f4")])


def compare_surface(path, mesh):
    buf = Buffer(path)
    if [buf.integer() for _ in range(3)] != [1, mesh["vertices"], mesh["faces"]]:
        raise ValueError("Mesh vertex/face counts differ")
    xyz = buf.array("<f4", mesh["vertices"] * 3).reshape(-1, 3)
    faces = buf.array(face_type, mesh["faces"])
    if not np.isfinite(xyz).all() or not np.isfinite(faces["normals"]).all():
        raise ValueError("Non-finite mesh coordinate or corner normal")
    used = np.unique(faces["verts"])
    if used.size != mesh["usedVertices"] or (
        used.size and (used[0] < 0 or used[-1] >= len(xyz))
    ):
        raise ValueError("Triangle indices or used vertex count differ")
    if used.size:
        expected = [xyz[used].min(axis=0), xyz[used].max(axis=0)]
        if not np.allclose(mesh["bounds"], expected, atol=1e-5):
            raise ValueError("Referenced vertices differ from original visible bounds")
    if set(faces["material"].tolist()) != set(mesh["materialIDs"]):
        raise ValueError("Material ID table differs")
    if buf.integer() != len(mesh["mapChannels"]):
        raise ValueError("Map channel count differs")
    for channel, verts, faces in mesh["mapChannels"]:
        if [buf.integer() for _ in range(3)] != [channel, verts, faces]:
            raise ValueError("UV channel counts differ")
        uv = buf.array("<f4", 3 * verts)
        indices = buf.array("<i4", 3 * faces)
        if not np.isfinite(uv).all() or (
            indices.size and (indices.min() < 0 or indices.max() >= verts)
        ):
            raise ValueError("Invalid UV channel coordinates or indices")
    buf.complete()
    return set(used.tolist())


def compare_skin(path, skin, used):
    buf = Buffer(path)
    count = skin["vertices"]
    if [buf.integer(), buf.integer()] != [1, count]:
        raise ValueError("Skin vertex count differs")
    ids, unweighted, nonunit = set(), 0, 0
    used_unweighted = 0
    for index in range(count):
        n = buf.integer()
        if not n:
            unweighted += 1
            if used is not None and index in used:
                used_unweighted += 1
            continue
        weights = buf.array(influence_type, n)
        if not np.isfinite(weights["weight"]).all():
            raise ValueError("Non-finite Skin weight")
        ids.update(weights["bone"].tolist())
        if not np.isclose(weights["weight"].sum(), 1.0, atol=0.0001):
            nonunit += 1
    buf.complete()
    if ids != {int(b) for b in skin["weightedBoneIDs"]}:
        raise ValueError("Unknown bone ID in weight table")
    return {
        "unweightedVertices": unweighted,
        "nonUnitTotals": nonunit,
        "unweightedOnFaces": used_unweighted,
        "unweightedFaceUseUnknown": unweighted if used is None else 0,
    }


def read_json(path):
    with gzip.open(path, "rt", encoding="utf8") as f:
        return json.load(f)


def write_receipt(path, value):
    temporary = path.with_suffix(f".{os.getpid()}.partial")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf8")
    temporary.replace(path)


def verify_constraints(root, sha, source, nodes, timing):
    record = read_json(root / "constraints" / (sha + ".json.gz"))
    if (
        record.get("version") != 1
        or record["source"] != source
        or record["errors"]
        or not record["controllers"]
        or any(record[key] != timing[key] for key in ("first", "last", "ticksPerFrame"))
    ):
        raise ValueError("Constraint source, capture, or timeline differs")
    node_names = {item["handle"]: item["name"] for item in nodes}
    frames = timing["last"] - timing["first"] + 1
    totals = Counter(constraints=len(record["controllers"]))
    for controller in record["controllers"]:
        if not controller["owners"] or any(
            node_names.get(owner["handle"]) != owner["node"]
            for owner in controller["owners"]
        ):
            raise ValueError("Constraint owner does not match source node")
        for target in controller["targets"]:
            if (
                target["handle"] is not None
                and node_names.get(target["handle"]) != target["name"]
            ):
                raise ValueError("Constraint target does not match source node")
            totals["constraintTargets"] += 1
            if "tick" in target:
                if target["tick"] != round(target["frame"] * timing["ticksPerFrame"]):
                    raise ValueError("Link switch time differs")
                totals["linkSwitches"] += 1
                totals["linkToWorld"] += target["handle"] is None
            elif (
                len(target["weights"]) not in (1, frames)
                or not np.isfinite(target["weights"]).all()
            ):
                raise ValueError("Invalid constraint target weights")
    return totals


def audit(root, sha, expected_constraints):
    s = read_json(root / "scenes" / (sha + ".json.gz"))
    if s.get("version") != 3 or s.get("sha256") != sha:
        raise ValueError("Incomplete native audit")
    timing = s["timing"]
    nodes = s["nodes"]
    frames = timing["last"] - timing["first"] + 1
    matrix = Buffer(root / "scenes" / (sha + ".f32.gz"))
    world = matrix.array("<f4", frames * len(nodes) * 12).reshape(
        frames, len(nodes), 12
    )
    matrix.complete()
    if not np.isfinite(world).all() or not np.allclose(
        world[0], [n["world"] for n in nodes], atol=1e-4
    ):
        raise ValueError("Invalid transform track or first pose mismatch")
    tracks = read_json(root / "tracks" / (sha + ".json.gz"))
    if tracks.get("version") != 2 or s.get("trackVersion") != 2:
        raise ValueError("Parameter track audit pending")
    for anim in [*tracks["bipeds"], *tracks.get("figures", [])]:
        p = root / "tracks" / anim["file"]
        if (
            not p.stat().st_size
            or hashlib.sha256(p.read_bytes()).hexdigest() != anim["sha256"]
        ):
            raise ValueError("Native BIP/FIG file contents differ")
    report = Counter(
        nodes=len(nodes),
        frames=frames,
        bipeds=len(tracks["bipeds"]),
        figures=len(tracks.get("figures", [])),
    )
    if expected_constraints:
        report.update(verify_constraints(root, sha, s["source"], nodes, timing))
    for track in tracks["tracks"].values():
        if "unreadableKeys" not in track and "keyAccessError" not in track:
            continue
        amount = track.get("unreadableKeys") or 1
        if track.get("children") and track["class"] in {"Position_XYZ", "Euler_XYZ"}:
            if any(
                str(child) not in tracks["tracks"] for _, child in track["children"]
            ):
                raise ValueError("Missing axis subtrack for composite XYZ controller")
            report["aggregateKeysOnChildren"] += amount
        elif track["class"] == "LinkTimeControl" and report["linkSwitches"]:
            report["linkKeysUsingTargetSchedule"] += amount
        else:
            report["unresolvedKeys_" + track["class"]] += amount
    for node in nodes:
        used = None
        if m := node.get("mesh"):
            used = compare_surface(root / "surfaces" / m["file"], m)
            report.update(
                meshes=1,
                vertices=m["vertices"],
                faces=m["faces"],
                mapChannels=len(m["mapChannels"]),
            )
        for skin in node["modifiers"]:
            if skin["type"] == "Skin":
                report.update(skins=1, skinVertices=skin["vertices"])
                report.update(
                    compare_skin(
                        root / "surfaces" / skin["weightFile"],
                        skin,
                        used
                        if m
                        and len(node["modifiers"]) == 1
                        and m["vertices"] == skin["vertices"]
                        else None,
                    )
                )
    report.update(
        keys=sum(len(t.get("keys", [])) for t in tracks["tracks"].values()),
        trackWarnings=len(tracks["warnings"]),
    )
    return report


def main(root, partial):
    plan = json.loads((root / "plan.json").read_text("utf8"))
    constraint_types = {
        "linkconstraint",
        "lookatconstraint",
        "positionconstraint",
        "orientationconstraint",
        "pathconstraint",
    }
    constrained = {
        sha
        for sha, metadata in read_json(root / "compound.json.gz").items()
        if any(
            name.replace(" ", "").replace("_", "").lower() in constraint_types
            for name, *_ in metadata["classes"]
        )
    }
    receipts = root / "receipts"
    receipts.mkdir(exist_ok=True)
    totals = Counter()
    failed, pending = {}, []
    metrics_by_sha = {}
    for row in plan:
        sha = row["sha256"]
        path = root / "scenes" / (sha + ".json.gz")
        receipt = receipts / (sha + ".json")
        try:
            if not path.is_file():
                pending.append(row["source"])
                continue
            if (
                partial
                and receipt.is_file()
                and receipt.stat().st_mtime_ns
                >= max(
                    path.stat().st_mtime_ns,
                    (root / "tracks" / path.name).stat().st_mtime_ns,
                )
            ):
                metrics = json.loads(receipt.read_text("utf8"))
            else:
                metrics = audit(root, sha, sha in constrained)
                write_receipt(receipt, metrics)
            totals.update(metrics)
            metrics_by_sha[sha] = metrics
        except (
            OSError,
            EOFError,
            ValueError,
            TypeError,
            IndexError,
            KeyError,
            struct.error,
        ) as e:
            failed[row["source"]] = str(e)
    files = json.loads((root / "inventory.json").read_text("utf8"))["files"]
    sources = [row for row in files if row["kind"] in ("motion", "scene")]
    canonical = {row["sha256"]: row["source"] for row in plan}
    csv_path = root / "source-audit.csv"
    temporary = csv_path.with_suffix(f".{os.getpid()}.partial")
    fields = (
        "nodes",
        "frames",
        "meshes",
        "vertices",
        "faces",
        "skinVertices",
        "mapChannels",
        "keys",
        "bipeds",
        "figures",
        "trackWarnings",
        "unweightedVertices",
        "unweightedOnFaces",
        "unweightedFaceUseUnknown",
        "constraints",
        "linkSwitches",
    )
    with temporary.open("w", newline="", encoding="utf-8-sig") as fp:
        rows = csv.writer(fp)
        rows.writerow(
            ["원본 MAX 경로", "SHA-256", "동일 바이트 기준 파일", "검사 상태", *fields]
        )
        for row in sources:
            sha = row["sha256"]
            metrics = metrics_by_sha.get(sha, {})
            state = (
                "검증" if sha in metrics_by_sha else failed.get(canonical[sha], "대기")
            )
            rows.writerow(
                [
                    row["source"],
                    sha,
                    canonical[sha],
                    state,
                    *(metrics.get(key, 0) if metrics else "" for key in fields),
                ]
            )
    temporary.replace(csv_path)
    result = {
        "verified": len(plan) - len(failed) - len(pending),
        "verifiedSourcePaths": sum(row["sha256"] in metrics_by_sha for row in sources),
        "total": len(plan),
        "metrics": totals,
        "failed": failed,
        "pending": pending,
    }
    write_receipt(root / "verification.json", result)
    print(
        json.dumps(
            {
                "verified": result["verified"],
                "failed": len(failed),
                "pending": len(pending),
                **totals,
            },
            ensure_ascii=False,
        )
    )
    if not partial and (pending or failed):
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        type=Path,
        nargs="?",
        default=Path(".asset-work/max-preservation/native"),
    )
    parser.add_argument(
        "--partial",
        action="store_true",
        help="Check completed scenes and reuse receipts while exporting",
    )
    args = parser.parse_args()
    main(args.root, args.partial)
