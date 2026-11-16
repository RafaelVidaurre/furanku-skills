#!/usr/bin/env python3
"""Checks an imported asset must pass in this engine. The adapter's `check` command.

    engine_check.py --kind sources /Game/<asset> ...
        no listed asset's file stores an absolute machine path (the `strings` test, read from the files in this checkout)
    engine_check.py --kind skinned --source <mesh.fbx> --name <Name> --skeleton <profile id> [--dcc-joints <folder>] [--tolerance <cm>]
        the FBX imports as a skeletal mesh on the profile's skeleton, its root bone has scale 1, and (with --dcc-joints,
        a folder of <animation label>.json written by dcc/joint_positions.py) animated joints sit where the DCC tool put them
    engine_check.py --kind bones-in-game --skeleton <profile id>
        during Play In Editor, every character mesh has the reference mesh's bones in the same order
    engine_check.py --kind collision /Game/<static mesh> ...
        each mesh's simple collision covers its render mesh (docs/collision.md)
Common: [--report <file.json>] writes everything measured. Prints {"problems": [{"message", "fix"?}], "report"?: "<file>"}.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, coverage, joints, machine_paths, paths  # noqa: E402
from jam_unreal.errors import AdapterError  # noqa: E402


def check_sources(cfg, a):
    problems, report = [], {}
    for asset in a.assets:
        relative = paths.asset_file(paths.package_of(asset), cfg.facts)
        full = os.path.join(cfg.project, *relative.split("/"))
        if not os.path.isfile(full):
            raise AdapterError("missing-asset", "%s is not in this checkout (%s)" % (asset, relative), fix="pull or sync the engine binaries first")
        found = machine_paths.find_in_file(full)
        report[relative] = found
        if found:
            problems.append({"message": "%s stores machine paths: %s" % (relative, ", ".join(found[:3])),
                             "fix": "import again from a source inside the project checkout (docs/import.md)"})
    return problems, report


def check_skinned(cfg, a):
    if not (a.source and a.name and a.skeleton):
        raise AdapterError("invalid", "--kind skinned needs --source, --name and --skeleton")
    source, digest = paths.source_stamp(cfg.project, a.source)
    skeleton = cfg.skeleton(a.skeleton)
    scratch = cfg.option("checks", "scratchContent", default="/Game/JamCheck")
    name = cli.asset_name(a.name)
    steps = [("import", "check_skinned_import", {"sources": [{"source": source, "sha256": digest, "name": name}], "skeleton": skeleton["skeleton"], "scratch": scratch})]
    posed = bool(skeleton.get("referenceMesh") and skeleton.get("animations") and skeleton.get("poseBones"))
    if posed:
        steps.append(("pose", "check_pose", {"source": source, "sha256": digest, "name": name, "scratch": scratch, "skeleton": skeleton["skeleton"],
                                             "referenceMesh": skeleton["referenceMesh"], "animations": skeleton["animations"],
                                             "bones": skeleton["poseBones"], "localBones": skeleton.get("localBones") or [skeleton.get("root", "root")]}))
    results = cli.editor(cfg, "check-skinned", steps)
    imported = results[0]["imports"].get(name, {})
    report = {"import": results[0]}
    problems = []
    if "error" in imported:
        problems.append({"message": "%s did not import: %s" % (source, imported["error"])})
    elif imported.get("class") != "SkeletalMesh":
        problems.append({"message": "%s imported as %s, not as a skeletal mesh" % (source, imported.get("class"))})
    elif not imported.get("usesSkeleton"):
        problems.append({"message": "%s was imported on %s, not on %s" % (source, imported.get("skeleton"), skeleton["skeleton"]),
                         "fix": "match the reference skeleton's bone names and hierarchy (docs/skeletons.md)"})
    if posed:
        pose = results[1]
        report["pose"] = pose
        root = skeleton.get("root", "root")
        root_scale = ((pose.get("local", {}).get("character", {}).get(root) or {}).get("local") or {}).get("s")
        comparison = {}
        if a.dcc_joints:
            folder = os.path.join(cfg.project, *paths.portable(a.dcc_joints.rstrip("/"), "--dcc-joints").split("/"))
            dcc = {}
            for anim in skeleton["animations"]:
                path = os.path.join(folder, anim["label"] + ".json")
                if not os.path.isfile(path):
                    raise AdapterError("missing-source", "no DCC joint positions for %s: %s" % (anim["label"], path), fix="write them with dcc/joint_positions.py (docs/skeletons.md)")
                with open(path, encoding="utf-8") as f:
                    dcc[anim["label"]] = json.load(f)
            try:
                comparison = joints.compare(pose, dcc, anchor=skeleton.get("poseAnchor", "pelvis"))
            except (ValueError, KeyError) as e:
                raise AdapterError("invalid", "engine and DCC joint positions do not line up: %s" % e)
            report["comparison"] = comparison
        tolerance = a.tolerance if a.tolerance is not None else cfg.option("checks", "poseToleranceCm", default=5)
        problems += joints.problems(comparison, root_scale, tolerance)
    return problems, report


def check_bones(cfg, a):
    if not a.skeleton:
        raise AdapterError("invalid", "--kind bones-in-game needs --skeleton")
    skeleton = cfg.skeleton(a.skeleton)
    if not skeleton.get("referenceMesh"):
        raise AdapterError("missing-config", "skeleton %s names no referenceMesh" % a.skeleton)
    result, = cli.editor(cfg, "check-bones", [("bones", "compare_bones_in_game", {"reference": paths.object_name(skeleton["referenceMesh"])})])
    problems = []
    for mesh, entry in sorted(result["meshes"].items()):
        if entry["missing"] or entry["extra"] or not entry["sameOrder"]:
            problems.append({"message": "%s differs from %s: missing %s, extra %s, same order %s" % (mesh, result["reference"], entry["missing"][:6], entry["extra"][:6], entry["sameOrder"])})
    return problems, result


def check_collision(cfg, a):
    overrides = cfg.option("collision", "rule", default={})
    rule = coverage.rule_with(overrides)
    result, = cli.editor(cfg, "collision-measure", [("measure", "collision", {"mode": "measure", "meshes": [paths.package_of(x) for x in a.assets], "rule": overrides})])
    problems = [{"message": "%s: collision covers %.1f%% of the mesh, worst gap %s cm" % (e["id"], 100 * e["before"]["covered"], e["before"]["worst"]),
                 "fix": "fit it with commands/collision.py fit, or author hulls before import (docs/collision.md)"}
                for e in result["report"] if not coverage.covered(e["before"], rule)]
    return problems, result


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="engine_check.py")
    p.add_argument("--kind", required=True, choices=("sources", "skinned", "bones-in-game", "collision"))
    p.add_argument("assets", nargs="*")
    for flag in ("--source", "--name", "--skeleton", "--dcc-joints", "--report"):
        p.add_argument(flag)
    p.add_argument("--tolerance", type=float)
    a = p.parse_args(argv)
    if a.kind in ("sources", "collision") and not a.assets:
        raise AdapterError("invalid", "--kind %s needs at least one asset id" % a.kind)
    problems, report = {"sources": check_sources, "skinned": check_skinned, "bones-in-game": check_bones, "collision": check_collision}[a.kind](cfg, a)
    receipt = {"problems": problems}
    if a.report:
        cli.write_details(cfg, paths.portable(a.report, "--report"), report)
        receipt["report"] = a.report
    return receipt


if __name__ == "__main__":
    cli.run(build)
