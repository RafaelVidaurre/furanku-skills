#!/usr/bin/env python3
"""Rework a character model into a skeleton profile's exact bone names and rest pose. The adapter's `conform-skeleton` command.

    conform_skeleton.py <model.glb|.blend> [--skeleton <profile id>] [--out <folder>] [--landmarks <landmarks.json>]
                        [--height-meters <h>] [--fingers auto|5|0] [--max-influences 4] [--mesh <object name>]
                        [--reference <reference-skeleton.fbx>] [--name <Name>] [--uv <layer>] [--project <dir>]
Paths are project-relative. Joints come from --landmarks; without it, from `<model stem>.landmarks.json` or
`landmarks.json` beside the model; without those, from the rig the model arrives with. --reference defaults to the
profile's `reference` (the FBX written by skeleton_reference.py). --out defaults to `conform` beside the model.
Runs Blender (`blender` in jam.local.json, else on PATH). Prints
{"model": "<out>/engine/<Name>.fbx", "skeleton", "evidence": [rig report, export info], "outputs": [{"role", "path", "sha256"}]}:
`model` is the engine's skinned-mesh file (docs/skinned-export.md), ready for `import --kind skinned`.
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, landmarks, paths  # noqa: E402
from jam_unreal.errors import AdapterError  # noqa: E402


def blender(cfg, script, args, log):
    argv = [cfg.tool("blender"), "--background", "--python-exit-code", "1", "--python", script, "--"] + args
    try:
        done = subprocess.run(argv, cwd=cfg.project, capture_output=True, text=True)
    except FileNotFoundError:
        raise AdapterError("missing-tool", "Blender was not found (%s)" % argv[0], fix="set \"blender\" in jam.local.json to its executable")
    with open(log, "a", encoding="utf-8") as f:
        f.write(done.stdout + done.stderr)
    if done.returncode != 0:
        lines = [line.strip() for line in (done.stdout + done.stderr).splitlines() if line.strip()]
        errors = [line for line in lines if "Error" in line and "script failed" not in line] or lines   # the exception's own line, when there is one
        raise AdapterError("conform-failed", "%s failed: %s" % (os.path.basename(script), errors[-1][-900:]),
                           fix="read %s; the report beside it names the region or finger that did not fit" % os.path.relpath(log, cfg.project).replace(os.sep, "/"))


def find_landmarks(cfg, model, given):
    if given:
        return paths.source_stamp(cfg.project, given, "--landmarks")[0]
    folder, stem = os.path.dirname(model), os.path.splitext(os.path.basename(model))[0]
    for name in (stem + ".landmarks.json", "landmarks.json"):
        candidate = (folder + "/" if folder else "") + name
        if os.path.isfile(paths.absolute(cfg.project, candidate)):
            return candidate
    return None


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="conform_skeleton.py")
    p.add_argument("model")
    p.add_argument("--height", "--height-meters", dest="height_meters", type=float)  # --height is what jam passes
    p.add_argument("--fingers", choices=("auto", "0", "5"), default="auto")
    p.add_argument("--max-influences", type=int, default=4)
    for flag in ("--skeleton", "--out", "--landmarks", "--reference", "--mesh", "--name", "--uv"):
        p.add_argument(flag)
    a = p.parse_args(argv)
    skeleton_id = a.skeleton or cfg.default_skeleton()
    skeleton = cfg.skeleton(skeleton_id)
    if not isinstance(skeleton.get("bones"), dict):
        raise AdapterError("missing-config", "skeleton %s has no landmark-to-bone table" % skeleton_id, fix="add engine.facts.skeletons.%s.bones" % skeleton_id)
    reference = a.reference or skeleton.get("reference")
    if not reference:
        raise AdapterError("missing-config", "no reference skeleton file for %s" % skeleton_id,
                           fix="export it with commands/skeleton_reference.py, then pass --reference or set engine.facts.skeletons.%s.reference in jam.config.json (docs/skeletons.md)" % skeleton_id)
    model, _ = paths.source_stamp(cfg.project, a.model, "model")
    reference, _ = paths.source_stamp(cfg.project, reference, "--reference")
    marks = find_landmarks(cfg, model, a.landmarks)
    if marks:
        try:
            with open(paths.absolute(cfg.project, marks), encoding="utf-8") as f:
                landmarks.validate(json.load(f))
        except (ValueError, landmarks.LandmarkError) as e:
            raise AdapterError("invalid-landmarks", "%s: %s" % (marks, e), fix="docs/skeletons.md describes the landmark file")
    out = paths.portable((a.out or ((os.path.dirname(model) + "/" if os.path.dirname(model) else "") + "conform")).rstrip("/"), "--out")
    out_abs = paths.absolute(cfg.project, out)
    os.makedirs(out_abs, exist_ok=True)
    bones = os.path.join(out_abs, "profile-bones.json")
    with open(bones, "w", encoding="utf-8") as f:
        json.dump(skeleton["bones"], f, indent=1)
    log = os.path.join(out_abs, "conform.log")
    open(log, "w").close()
    args = [paths.absolute(cfg.project, model), paths.absolute(cfg.project, reference), paths.absolute(cfg.project, marks) if marks else "-", out_abs,
            "--fingers", a.fingers, "--max-influences", str(a.max_influences), "--bones", bones]
    if a.height_meters:
        args += ["--height-meters", str(a.height_meters)]
    if a.mesh:
        args += ["--mesh", a.mesh]
    blender(cfg, cli.dcc_script("conform_skeleton"), args, log)
    name = cfg.named("skeletalMesh", cli.asset_name(a.name or os.path.splitext(os.path.basename(model))[0]))
    export_args = [paths.absolute(cfg.project, out + "/character-rigged.blend"), os.path.join(out_abs, "engine"), name, "--armature", skeleton.get("root", "root")]
    if a.uv:
        export_args += ["--uv", a.uv]
    blender(cfg, cli.dcc_script("export_skinned"), export_args, log)
    engine_mesh = "%s/engine/%s.fbx" % (out, name)
    with open(os.path.join(out_abs, "engine", name + ".import.json"), "w", encoding="utf-8") as f:
        json.dump({"skeleton": skeleton_id}, f, indent=1)   # read by `import --kind skinned` (engine_import.py)
    produced = [("engine-mesh", engine_mesh), ("rigged", out + "/character-rigged.blend"), ("fit-pose", out + "/character-rig-fit-pose.blend"),
                ("regions", out + "/vertex-regions.json"), ("export-info", out + "/engine/export-info.json")]
    outputs = []
    for role, path in produced:
        relative, digest = paths.source_stamp(cfg.project, path, role)
        outputs.append({"role": role, "path": relative, "sha256": digest})
    # The host's receipt contract: `files` with the reworked model first, `report` for the check
    # report. The rest is detail a person or the run record can use.
    return {"files": [entry["path"] for entry in outputs], "report": out + "/rig-report.json",
            "model": engine_mesh, "skeleton": skeleton_id, "evidence": [out + "/rig-report.json", out + "/engine/export-info.json"], "outputs": outputs}


if __name__ == "__main__":
    cli.run(build)
