#!/usr/bin/env python3
"""Report what the engine holds for one asset. The adapter's `inspect` command.

    engine_inspect.py /Game/<folder>/<Name> [--details <file.json>] [--project <dir>]
Prints {"id", "kind", "bounds": {"min", "max"}, "pivot", "triangles", "vertices", "materials", "skeleton", "collision"}
with lengths in metres in the asset's own space; a fact the engine did not give is absent. --details also writes
what the receipt has no field for: sections, LODs, Nanite, physics asset, stored source, sound and texture facts.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, paths, receipts  # noqa: E402


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="engine_inspect.py")
    p.add_argument("asset")
    p.add_argument("--details")
    a = p.parse_args(argv)
    asset = paths.package_of(a.asset)
    paths.asset_file(asset, cfg.facts)
    raw, = cli.editor(cfg, "inspect", [("asset", "inspect_asset", {"asset": asset})])
    cli.write_details(cfg, a.details, raw)
    for key, why in (raw.get("unavailable") or {}).items():
        receipts.note("the engine did not give %s (%s)" % (key, why))
    return receipts.inspect_receipt(raw, cfg.units_per_meter)


if __name__ == "__main__":
    cli.run(build)
