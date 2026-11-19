#!/usr/bin/env python3
"""Make a viewable preview of each package the inventory lists. The adapter's `previews` command.

    engine_previews.py --inventory <project path> --out <project path> [--full] [--no-engine] [--only <pattern>]...
                       [--limit <n>]

Textures become their source image, meshes, materials and animations self-contained GLB, sounds WAV, actor
Blueprints a GLB of their components; packages of other classes get the thumbnail the editor stored in them, when
they have one (docs/previews.md). Previews go in --out, named by the package's version, with `index.json` beside
them; a package whose version is unchanged keeps its preview. Thumbnails are read without the editor; everything
else goes through the transport with a renderer (docs/transport.md), unless --no-engine.
Prints {"index", "previews", "made", "reused", "failed", "waiting", "none"}.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, paths, previews  # noqa: E402


def build(cfg, argv, editor=cli.editor):
    p = argparse.ArgumentParser(prog="engine_previews.py")
    p.add_argument("--inventory", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--full", action="store_true")
    p.add_argument("--no-engine", action="store_true")
    p.add_argument("--only", action="append", default=[])
    p.add_argument("--limit", type=int)
    a = p.parse_args(argv)
    inventory = previews.read_inventory(paths.absolute(cfg.project, paths.portable(a.inventory, "--inventory")))
    run = previews.Previews(cfg, inventory, paths.portable(a.out, "--out"), full=a.full, engine=not a.no_engine,
                            only=a.only, limit=a.limit, editor=editor)
    jobs = run.plan()
    run.save()
    if jobs:
        try:
            run.run(jobs)
        finally:
            run.write_details()
    return run.receipt()


if __name__ == "__main__":
    cli.run(build)
