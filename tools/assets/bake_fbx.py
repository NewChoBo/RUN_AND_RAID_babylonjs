"""Bake original rigs and motions with a locally installed 3ds Max Batch executable."""
import argparse
import os
import subprocess
from pathlib import Path
from library import INDEX, SOURCE, read_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--maxbatch", required=True, type=Path)
    parser.add_argument("--group")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not args.maxbatch.is_file():
        parser.error("3dsmaxbatch.exe was not found")
    files = [r for r in read_json(INDEX)["files"] if r["kind"] in ("scene", "motion")
             and (not args.group or args.group.casefold() == r["group"].casefold())]
    if not files:
        parser.error("No matching scenes")
    for r in files:
        source = SOURCE / r["path"]
        dest = SOURCE.parent / "baked-fbx" / Path(r["path"]).with_suffix(".fbx")
        if dest.is_file() and not args.force:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        temporary = dest.with_suffix(".partial.fbx")
        temporary.unlink(missing_ok=True)
        env = {**os.environ, "RUN_RAID_MAX_INPUT": str(source), "RUN_RAID_FBX_OUTPUT": str(temporary)}
        subprocess.run([str(args.maxbatch), str(Path(__file__).with_name("bake-fbx.ms"))], env=env, check=True)
        if not temporary.is_file() or temporary.stat().st_size < 32:
            raise RuntimeError(f"3ds Max produced no FBX for {r['path']}")
        temporary.replace(dest)
        print(r["path"], flush=True)


if __name__ == "__main__":
    main()
