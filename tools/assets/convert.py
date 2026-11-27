"""Build local static GLBs or import baked FBXs. Restarting resumes finished files."""
import argparse
import os
import subprocess
import sys
from pathlib import Path
from asset_names import fbx_path
from library import INDEX, IMPORTER, PUBLIC, RECORDS, REVISION, ROOT, SOURCE, WORK, digest, publish, read_json, save_json


def ensure_importer():
    if not (IMPORTER / ".git").exists():
        subprocess.run(["git", "clone", "--quiet", "https://github.com/nrgsille76/io_scene_max.git", str(IMPORTER)], check=True)
    subprocess.run(["git", "-C", str(IMPORTER), "checkout", "--quiet", "--detach", REVISION], check=True)


def fbx_for(item):
    folder = SOURCE.parent / "baked-fbx"
    named = folder / fbx_path(item)
    legacy = folder / Path(item["path"]).with_suffix(".fbx")
    return legacy if not named.exists() and legacy.is_file() else named


def stamp(item, archive):
    fbx = fbx_for(item)
    if fbx.is_file():
        return [archive, REVISION, digest(fbx.read_bytes()), 2]
    return [archive, REVISION, "static", 1]


def pending(item, archive):
    p = RECORDS / (item["id"] + ".json")
    if not p.exists():
        return True
    r = read_json(p)
    if r.get("recipe") != stamp(item, archive) or r.get("state") == "failed":
        return True
    return bool(r.get("model") and not (PUBLIC / r["model"]).is_file())


def convert_group(items, archive, worker, logdir):
    ids = [r["id"] for r in items]
    with (logdir / (ids[0] + ".log")).open("wb") as log:
        command = [sys.executable, str(worker), *ids]
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    # Run remaining entries individually if native Blender terminated unexpectedly.
    if result.returncode:
        missing = [r for r in items if pending(r, archive)]
        if len(items) > 1:
            for r in missing:
                convert_group([r], archive, worker, logdir)
        else:
            r = items[0]
            save_json(RECORDS / (r["id"] + ".json"), dict(archive=archive, recipe=stamp(r, archive),
                      state="failed", detail=f"Blender exited with {result.returncode}"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", help="Only process one source folder")
    args = parser.parse_args()
    ensure_importer()
    manifest = read_json(INDEX)
    source = manifest["sha256"]
    selected = [r for r in manifest["files"] if r["kind"] in ("scene", "motion")
                and (not args.group or r["group"].casefold() == args.group.casefold())]
    if not selected:
        parser.error("No matching MAX scenes")
    jobs = [r for r in selected if pending(r, source)]
    logdir = WORK / "logs"
    logdir.mkdir(parents=True, exist_ok=True)
    worker = Path(__file__).with_name("blender_worker.py")
    for start in range(0, len(jobs), 24):
        convert_group(jobs[start:start + 24], source, worker, logdir)
        publish()
        print(f"Converted {min(start + 24, len(jobs))}/{len(jobs)}", flush=True)
    publish()
    from materials import main as reconnect_materials
    reconnect_materials()
    results = [read_json(RECORDS / (r["id"] + ".json")) for r in selected]
    from collections import Counter
    print(dict(Counter(r["state"] for r in results)), flush=True)
    return 1 if any(r["state"] == "failed" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
