"""Run or resume the native audit with independent workers sharing a per-source OS lock."""

import argparse
import os
import subprocess
from pathlib import Path


def batch_succeeded(code, log):
    with log.open("rb") as stream:
        stream.seek(max(0, log.stat().st_size - 8192))
        tail = stream.read()
    if b"\x00" in tail:
        tail = tail[len(tail) % 2 :]
        summary = tail.decode("utf-16-le", errors="replace")
    else:
        summary = tail.decode("utf8", errors="replace")
    if "Task Completed with Error" in summary:
        return False
    return code == 0 or (
        code in (-1, 4294967295) and "Task Completed with Warning(s)" in summary
    )


def run(executable, workers, first, profile):
    root = Path(__file__).resolve().parents[2]
    out = root / ".asset-work/max-preservation/native"
    if not (out / "plan.json").is_file():
        raise SystemExit("Run inventory_max_sources.py first")
    processes = []
    for worker in range(workers):
        name = f"worker-{os.getpid()}-{worker}"
        log = out / (name + ".log")
        env = dict(
            os.environ,
            RUN_RAID_PROJECT=str(root),
            RAID_AUDIT_SHARDS="1",
            RAID_AUDIT_SHARD="0",
            RAID_AUDIT_FIRST=first or "",
            RAID_AUDIT_PROFILE="1" if profile else "0",
        )
        with log.open("wb") as stream:
            process = subprocess.Popen(
                [
                    str(executable),
                    str(root / "tools/assets/audit_max_sources.py"),
                    "-listenerlog",
                    str(out / (name + "-listener.log")),
                ],
                env=env,
                stdout=stream,
                stderr=subprocess.STDOUT,
                cwd=root,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            processes.append((process, log))
    failures = []
    for process, log in processes:
        code = process.wait()
        if not batch_succeeded(code, log):
            failures.append((log.name, code))
    if failures:
        raise SystemExit(f"3ds Max Batch failures: {failures}")
    errors = list((out / "scenes").glob("*.error"))
    if errors:
        raise SystemExit(
            f"{len(errors)} sources require inspection in {out / 'scenes'}"
        )


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--max-batch", type=Path, required=True)
    cli.add_argument("--workers", type=int, default=1)
    cli.add_argument(
        "--first", help="Process this source path before the rest of the archive"
    )
    cli.add_argument(
        "--profile", action="store_true", help="Profile key capture once per worker"
    )
    args = cli.parse_args()
    if args.workers < 1:
        cli.error("--workers must be positive")
    run(args.max_batch, args.workers, args.first, args.profile)
