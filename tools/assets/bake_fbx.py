"""Bake original rigs and motions with a locally installed 3ds Max Batch executable."""
import argparse
import os
import subprocess
from pathlib import Path
from asset_names import fbx_path
from convert import fbx_for
from library import INDEX, SOURCE, read_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--maxbatch", required=True, type=Path)
    parser.add_argument("--group")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    maxbatch = args.maxbatch.resolve()
    if not maxbatch.is_file():
        parser.error("3dsmaxbatch.exe was not found")
    manifest = read_json(INDEX)["files"]
    texture_dirs = {}
    for record in manifest:
        if record["kind"] == "texture":
            texture_dirs.setdefault(record["group"], set()).add((SOURCE / record["path"]).parent)
    files = [r for r in manifest if r["kind"] in ("scene", "motion")
             and (not args.group or args.group.casefold() == r["group"].casefold())]
    if not files:
        parser.error("No matching scenes")
    for r in files:
        source = SOURCE / r["path"]
        dest = SOURCE.parent / "baked-fbx" / fbx_path(r)
        if fbx_for(r).is_file() and not args.force:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        temporary = dest.with_suffix(".partial.fbx")
        temporary.unlink(missing_ok=True)
        folders = texture_dirs.get(r["group"], set())
        env = {**os.environ, "RUN_RAID_MAX_INPUT": str(source), "RUN_RAID_FBX_OUTPUT": str(temporary),
               "RUN_RAID_TEXTURE_DIR": str(next(iter(folders))) if len(folders) == 1 else ""}
        subprocess.run([str(maxbatch), str(Path(__file__).resolve().with_name("bake-fbx.ms"))],
                       env=env, cwd=maxbatch.parent, check=True)
        if not temporary.is_file() or temporary.stat().st_size < 32:
            raise RuntimeError(f"3ds Max produced no FBX for {r['path']}")
        temporary.replace(dest)
        print(r["path"], flush=True)


if __name__ == "__main__":
    main()
