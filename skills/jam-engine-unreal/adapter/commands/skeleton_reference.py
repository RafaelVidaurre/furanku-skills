#!/usr/bin/env python3
"""Export a skeleton profile's reference mesh and animations from the project to FBX, for rigging and pose checks.

    skeleton_reference.py --skeleton <profile id> --out <project-relative scratch folder> [--project <dir>]
The profile (engine facts, `skeletons.<id>` with its details under `extra.skeletons.<id>`) names the reference mesh
and animations. The exports are the engine vendor's or the project's content: keep the folder Git-ignored.
Prints {"exports": [{"asset", "file", "exported"}]}.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, paths  # noqa: E402
from jam_unreal.errors import AdapterError  # noqa: E402


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="skeleton_reference.py")
    p.add_argument("--skeleton", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    skeleton = cfg.skeleton(a.skeleton)
    if not skeleton.get("referenceMesh"):
        raise AdapterError("missing-config", "skeleton %s names no referenceMesh" % a.skeleton,
                           fix="set engine.facts.extra.skeletons.%s.referenceMesh in jam.config.json" % a.skeleton)
    exports = [{"asset": skeleton["referenceMesh"], "kind": "skeletal-mesh", "name": paths.object_name(skeleton["referenceMesh"])}]
    animations = [anim["asset"] for anim in skeleton.get("animations", [])] + list(skeleton.get("referenceAnimations", []))
    exports += [{"asset": asset, "kind": "animation", "name": paths.object_name(asset)} for asset in animations]
    result, = cli.editor(cfg, "skeleton-reference", [("export", "export_skeleton_reference", {"outDir": paths.portable(a.out.rstrip("/"), "--out"), "exports": exports})])
    failed = [e["asset"] for e in result["exports"] if not e["exported"]]
    if failed:
        raise AdapterError("export-failed", "the engine did not export %s" % ", ".join(failed), details=result)
    return result


if __name__ == "__main__":
    cli.run(build)
