"""Verify archive and mirror bytes and index MAX compound streams before a native scene audit."""

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import struct
import uuid
import zipfile
from pathlib import Path, PureWindowsPath

import olefile


def chunks(data):
    index = 0
    if data.startswith(b"\x1f\x8b"):
        data = gzip.decompress(data)
    while index < len(data):
        kind, length = struct.unpack_from("<HI", data, index)
        header = 6
        if length:
            length &= 0x7FFFFFFF
        else:
            length = struct.unpack_from("<Q", data, index + 6)[0] & 0x7FFFFFFFFFFFFFFF
            header += 8
        if not header <= length <= len(data) - index:
            raise ValueError("Invalid MAX directory chunk length")
        yield kind, data[index + header : index + length]
        index += length


def assets(data):
    declarations = []
    offset = 0
    while offset < len(data):
        key = str(uuid.UUID(bytes_le=data[offset : offset + 16]))
        offset += 16
        values = []
        for _ in range(2):
            count = struct.unpack_from("<I", data, offset)[0]
            offset += 4
            end = offset + count * 2
            if data[end : end + 2] != b"\0\0":
                raise ValueError("Invalid length in MAX asset reference")
            values.append(data[offset:end].decode("utf-16le"))
            offset = end + 2
        declarations.append({"id": key, "type": values[0], "path": values[1]})
    return declarations


def compound(data):
    with olefile.OleFileIO(io.BytesIO(data)) as doc:
        streams = {}
        for path in doc.listdir():
            raw = doc.openstream(path).read()
            streams["/".join(path)] = {
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        directory = (
            "ClassDirectory3" if doc.exists("ClassDirectory3") else "ClassDirectory"
        )
        classes, plugins = [], []
        for kind, item in chunks(doc.openstream(directory).read()):
            if kind != 0x2040:
                continue
            fields = dict(chunks(item))
            if 0x2042 in fields and 0x2060 in fields:
                dll, clid, sid = struct.unpack_from("<iQI", fields[0x2060])
                classes.append(
                    [fields[0x2042].decode("utf-16le").rstrip("\0"), dll, clid, sid]
                )
        for kind, item in chunks(doc.openstream("DllDirectory").read()):
            if kind != 0x2038:
                continue
            fields = dict(chunks(item))
            if 0x2037 in fields:
                plugins.append(
                    [
                        fields[key].decode("utf-16le").rstrip("\0")
                        for key in (0x2037, 0x2039)
                    ]
                )
        refs = (
            assets(doc.openstream("FileAssetMetaData2").read())
            if doc.exists("FileAssetMetaData2")
            else []
        )
        return {
            "streams": streams,
            "classes": classes,
            "plugins": plugins,
            "references": refs,
        }


def write_reference_report(items, native, dest, candidate_roots):
    textures = {}
    for row in items:
        if row["kind"] == "texture":
            textures.setdefault(Path(row["source"]).name.casefold(), []).append(
                row["source"]
            )
    declared = {r["path"] for scene in native.values() for r in scene["references"]}
    absent = {
        PureWindowsPath(ref).name.casefold() for ref in declared
    } - textures.keys()
    original = {}
    for ref in sorted(declared):
        path = PureWindowsPath(ref)
        if os.name == "nt" and path.is_absolute() and not path.drive.startswith("\\\\"):
            original[ref] = Path(ref).is_file()
        else:
            original[ref] = None
    candidates = {}
    for directory in candidate_roots:
        if not directory.is_dir():
            raise FileNotFoundError(directory)
        for p in directory.rglob("*"):
            key = p.name.casefold()
            if key in absent and p.is_file():
                with p.open("rb") as f:
                    checksum = hashlib.file_digest(f, "sha256").hexdigest()
                candidates.setdefault(key, []).append(
                    {"path": str(p.resolve()), "sha256": checksum}
                )
    suffix = f".{os.getpid()}.partial"
    refs_file = dest / "texture-references.csv"
    refs_temp = refs_file.with_suffix(suffix)
    with refs_temp.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "원본 MAX",
                "선언된 참조 종류",
                "원본 제작 경로",
                "제작 경로 현존",
                "같은 파일명의 ZIP 항목",
                "ZIP 부재 시 로컬 동명 후보 (원본 동일성 미확인)",
            ]
        )
        for row in items:
            for ref in native.get(row["sha256"], {}).get("references", []):
                name = PureWindowsPath(ref["path"]).name.casefold()
                writer.writerow(
                    [
                        row["source"],
                        ref["type"],
                        ref["path"],
                        {True: "있음", False: "없음", None: "절대경로 미확인"}[
                            original[ref["path"]]
                        ],
                        " | ".join(textures.get(name, [])),
                        " | ".join(c["path"] for c in candidates.get(name, [])),
                    ]
                )
    refs_temp.replace(refs_file)
    report = {
        "declaredPaths": len(declared),
        "originalPaths": original,
        "absentArchiveNames": sorted(absent),
        "candidateRoots": [str(p.resolve()) for p in candidate_roots],
        "localCandidatesByName": candidates,
    }
    report_file = dest / "texture-reference-summary.json"
    report_temp = report_file.with_suffix(suffix)
    report_temp.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf8")
    report_temp.replace(report_file)


def main(archive, mirrors, dest, candidate_roots):
    dest.mkdir(parents=True, exist_ok=True)
    mirrors = [p.resolve() for p in mirrors]
    copies = [
        {
            p.relative_to(base).as_posix().casefold(): p
            for p in base.rglob("*")
            if p.is_file()
        }
        for base in mirrors
    ]
    items, native = [], {}
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            if entry.is_dir():
                continue
            path = entry.filename
            if not entry.flag_bits & 0x800:
                try:
                    path = path.encode("cp437").decode("cp949")
                except UnicodeError:
                    pass
            data = bundle.read(entry)
            sha = hashlib.sha256(data).hexdigest()
            key = path.casefold()
            matches = []
            for mirror in copies:
                candidate = mirror.get(key)
                if candidate:
                    with candidate.open("rb") as f:
                        matches.append(
                            hashlib.file_digest(f, "sha256").hexdigest() == sha
                        )
                else:
                    matches.append(False)
            group = "texture" if key.endswith(".tga") else "source"
            refs = []
            if key.endswith(".max") and not Path(path).name.startswith("._"):
                group = (
                    "motion"
                    if any(
                        part in ("animation", "animaion")
                        for part in key.split("/")[1:-1]
                    )
                    else "scene"
                )
                if sha not in native:
                    native[sha] = compound(data)
                refs = sorted(
                    {
                        Path(r["path"].replace("\\", "/")).name
                        for r in native[sha]["references"]
                        if r["type"].casefold() == "bitmap"
                    }
                )
            items.append(
                {
                    "source": path,
                    "sha256": sha,
                    "bytes": len(data),
                    "kind": group,
                    "zipBytesMatch": matches,
                    "assetBitmaps": refs,
                }
            )
    keys = {r["source"].casefold() for r in items}
    with archive.open("rb") as f:
        archive_hash = hashlib.file_digest(f, "sha256").hexdigest()
    result = {
        "archive": archive.name,
        "sha256": archive_hash,
        "mirrors": [str(p) for p in mirrors],
        "extraFiles": [sorted(set(m) - keys) for m in copies],
        "files": items,
    }
    suffix = f".{os.getpid()}.partial"
    inventory_file = dest / "inventory.json"
    inventory_temp = inventory_file.with_suffix(suffix)
    inventory_temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf8")
    inventory_temp.replace(inventory_file)
    if any(not all(r["zipBytesMatch"]) for r in items) or any(result["extraFiles"]):
        raise SystemExit("Archive and extracted trees differ; see inventory.json")
    compound_file = dest / "compound.json.gz"
    compound_temp = compound_file.with_suffix(suffix)
    with gzip.open(compound_temp, "wt", encoding="utf8") as f:
        json.dump(native, f, ensure_ascii=False, separators=(",", ":"))
    compound_temp.replace(compound_file)
    write_reference_report(items, native, dest, candidate_roots)
    unique = {
        r["sha256"]: r for r in reversed(items) if r["kind"] in ("motion", "scene")
    }
    priority = {"hammer/hammer#default.max", "drizz/drizz#default.max"}
    plan = sorted(
        unique.values(),
        key=lambda r: (r["source"].casefold() not in priority, r["source"].casefold()),
    )
    plan_file = dest / "plan.json"
    plan_temp = plan_file.with_suffix(suffix)
    plan_temp.write_text(json.dumps(plan, ensure_ascii=False), "utf8")
    plan_temp.replace(plan_file)
    print(
        f"{len(items)} archive files match {len(mirrors)} mirrors, {len(unique)} unique MAX files"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("mirrors", nargs="+", type=Path)
    parser.add_argument(
        "--candidate-root",
        type=Path,
        action="append",
        default=[],
        help="Check this directory for same-named missing image references",
    )
    parser.add_argument(
        "--output", type=Path, default=Path(".asset-work/max-preservation/native")
    )
    args = parser.parse_args()
    main(args.archive, args.mirrors, args.output, args.candidate_root)
