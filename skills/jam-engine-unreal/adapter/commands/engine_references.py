#!/usr/bin/env python3
"""List what refers to engine assets, and delete assets nothing else refers to. The adapter's `references` command.

    engine_references.py /Game/<asset> ... [--delete] [--project <dir>]
Prints {"references": [{"id", "referencers": [...]}]}. With --delete the listed assets are deleted together, only
when nothing outside the list refers to any of them, each file is committed and unchanged, and (when the project
locks binaries) you hold its lock; the receipt then also holds "deleted": [ids], verified absent on disk.
The asset registry does not see names held as strings in native code or config: search those before deleting.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, locks, paths  # noqa: E402
from jam_unreal.errors import AdapterError  # noqa: E402


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="engine_references.py")
    p.add_argument("assets", nargs="+")
    p.add_argument("--delete", action="store_true")
    a = p.parse_args(argv)
    assets = sorted({paths.package_of(x) for x in a.assets})
    files = {asset: paths.asset_file(asset, cfg.facts) for asset in assets}
    if a.delete and cfg.locks != "off":
        locks.deletable(cfg.project, list(files.values()))
    result, = cli.editor(cfg, "references", [("assets", "references", {"assets": assets, "delete": a.delete})])
    receipt = {"references": result["references"]}
    if a.delete:
        # Inspect the disk whatever the editor said: its answer can be lost or wrong.
        survivors = [f for f in files.values() if os.path.exists(os.path.join(cfg.project, *f.split("/")))]
        refused = [d["id"] for d in result.get("deleted", []) if not d["native"]]
        if survivors or refused:
            raise AdapterError("delete-failed", "the engine left these in place: %s" % ", ".join(survivors or refused),
                               fix="read the editor log for the refusal; when the editor runs on another machine, sync its checkout and look again",
                               details=result)
        receipt["deleted"] = assets
    return receipt


if __name__ == "__main__":
    cli.run(build)
