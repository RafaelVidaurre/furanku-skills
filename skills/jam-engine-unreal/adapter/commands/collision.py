#!/usr/bin/env python3
"""Measure or refit the simple collision of static meshes in the editor (docs/collision.md).

    collision.py measure /Game/<static mesh> ...     coverage of each mesh's collision; changes nothing
    collision.py fit /Game/<static mesh> ...         locks, refits and saves the meshes whose collision does not cover them
Prints {"report": [{"id", "before": {"covered", "worst", "gaps"?}, "shapes", "after"?, "kept"?}], "uncovered": [ids]}.
`fit` needs a live editor (it waits across frames); commit the saved assets from the editor's checkout.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, coverage, locks, paths, receipts  # noqa: E402


def measure(cfg, assets, rule):
    result, = cli.editor(cfg, "collision-measure", [("measure", "collision", {"mode": "measure", "meshes": assets, "rule": rule})])
    return result["report"]


def uncovered(report, rule):
    return [e["id"] for e in report if not coverage.covered(e.get("after") or e["before"], rule)]


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="collision.py")
    p.add_argument("mode", choices=("measure", "fit"))
    p.add_argument("assets", nargs="+")
    a = p.parse_args(argv)
    assets = [paths.package_of(x) for x in a.assets]
    overrides = cfg.option("collision", "rule", default={})
    rule = coverage.rule_with(overrides)
    report = measure(cfg, assets, overrides)
    if a.mode == "fit":
        failing = uncovered(report, rule)
        for path in locks.ensure(cfg.project, [paths.asset_file(i, cfg.facts) for i in failing], cfg.locks):
            receipts.note("locked %s" % path)
        fitted = {}
        for asset in failing:   # one call per mesh: each decomposition takes seconds, and a failure names its mesh
            result, = cli.editor(cfg, "collision-fit", [("fit", "collision", {"mode": "fit", "meshes": [asset], "rule": overrides})])
            fitted[asset] = result["report"][0]
        report = [fitted.get(e["id"], e) for e in report]
    return {"report": report, "uncovered": uncovered(report, rule)}


if __name__ == "__main__":
    cli.run(build)
