#!/usr/bin/env python3
"""Run the local stages of one character (the default single-mesh flow of references/body.md) from its character.json.

    $P $S/character.py run --character $W/character.json --work $W [--joints F] [--remesh F] [--source F] [--mesh F]
                           [--manny F] [--anim F ...] [--metallic-map F] [--from STAGE] [--to STAGE] [--force] [--dry-run]
    $P $S/character.py status --work $W

Stages, in order (* = review gate: the run stops after it so its evidence can be reviewed):
    fingers*  finger repair of the generated mesh (only with --mesh; before the paid quad remesh)
    transfer  colour of the high-resolution source onto the quad remesh
    classes*  how the spec's colour classes read that texture (preview renders and report)
    topology* the mesh named after the spec's body part, measured
    uv*       unwrap, layout drawing, checker renders, UV exports
    texture*  bake, textured renders, unlit head close-ups
    rig*      rig to the Mannequin, pose renders (and Manny animations given with --anim), edge stretch
    export*   Unreal FBX and runtime GLB

`run` starts at the first stage whose inputs changed (or --from), runs on, and stops after the first review gate it ran
(or after --to). Run it again once the gate's review is recorded to continue. Paths given once (--joints, --remesh, ...)
are remembered in $W/character-run.json, so later runs need only --character and --work. A stage whose recorded inputs,
scripts, spec and options are unchanged and whose outputs are all present is skipped; --force reruns the selected stages.
Blender comes from `blender` in jam.local.json (current directory) or PATH; Python from the one running this script.
Every run writes $W/character-run-summary.json and prints it.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import charspec  # noqa: E402

STATE = "character-run.json"
SUMMARY = "character-run-summary.json"
PATH_OPTIONS = ("joints", "remesh", "source", "mesh", "manny", "metallic_map")
POSES = ("curl", "reach", "crouch", "look")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def blender_command():
    local = {}
    if os.path.isfile("jam.local.json"):
        with open("jam.local.json", encoding="utf-8") as f:
            local = json.load(f)
    exe = local.get("blender", "blender")
    return os.path.abspath(exe) if ("/" in exe or "\\" in exe) else exe


class Runner:
    def __init__(self, work, spec_path, cfg, force=False):
        self.W = os.path.abspath(work); self.spec_path = os.path.abspath(spec_path); self.cfg = cfg; self.force = force
        self.spec = charspec.load(self.spec_path)
        self.blender = blender_command()
        self.log_dir = os.path.join(self.W, "logs"); os.makedirs(self.log_dir, exist_ok=True)

    # ---- paths
    def w(self, *p):
        return os.path.join(self.W, *p)

    def s(self, *p):
        return os.path.join(HERE, *p)

    @property
    def src(self):
        """High-resolution source: the finger-repaired mesh when that stage ran, else --source (or --mesh)."""
        spread = self.w("spread", "model-spread.glb")
        if self.cfg.get("mesh") and os.path.isfile(spread):
            return spread
        return self.cfg.get("source") or self.cfg.get("mesh")

    def need(self, *names):
        missing = [n for n in names if not self.cfg.get(n)]
        if missing:
            raise SystemExit("this stage needs " + ", ".join("--" + n.replace("_", "-") for n in missing))
        for n in names:
            if not os.path.isfile(self.cfg[n]):
                raise SystemExit(f"--{n.replace('_', '-')} {self.cfg[n]}: file not found")

    # ---- commands
    def bl(self, script, *args, spec=True, exit_code=True):
        cmd = [self.blender, "--background"] + (["--python-exit-code", "1"] if exit_code else []) + ["--python", self.s("blender", script), "--", *map(str, args)]
        return cmd + (["--character", self.spec_path] if spec else [])

    def stages(self):
        """name -> (gate, inputs, outputs, commands, evidence). Built lazily: inputs depend on earlier outputs."""
        sp = self.spec
        if sp.part("head"):
            raise SystemExit("the spec has swappable parts: this runner drives the single-mesh flow; follow body.md#swappable-parts")
        aligned, colour = self.w("model-aligned.fbx"), self.w("transfer_base_color.png")
        topo, uvb, textured, rigged = self.w("topology", "character-topology.blend"), self.w("uv", "character-uv.blend"), self.w("texture", "character-textured.blend"), self.w("rig", "character-rigged.blend")
        st = {}

        def fingers():
            self.need("mesh", "joints")
            return dict(gate=True, inputs=[self.cfg["mesh"], self.cfg["joints"]],
                        outputs=[self.w("spread", f) for f in ("model-spread.glb", "model-spread-geometry.glb", "spread-report.json")],
                        commands=[self.bl("spread_fingers.py", self.cfg["mesh"], self.cfg["joints"], self.rig_scale(), self.w("spread"))],
                        evidence=[self.w("spread", "spread-report.json")],
                        note="upload spread/model-spread-geometry.glb for the quad remesh (jam-retopo), then run on with --remesh <model.fbx>")
        st["fingers"] = fingers

        def transfer():
            self.need("remesh")
            if not self.src:
                raise SystemExit("transfer needs --source <high-resolution model.glb> (or --mesh with the fingers stage)")
            return dict(gate=False, inputs=[self.cfg["remesh"], self.src], outputs=[colour, aligned],
                        commands=[self.bl("transfer_color.py", self.cfg["remesh"], self.src, colour, 4096, aligned)], evidence=[])
        st["transfer"] = transfer

        def classes():
            return dict(gate=True, inputs=[aligned, colour], outputs=[self.w("classes", "classes-report.json")],
                        commands=[self.bl("preview_classes.py", aligned, colour, self.w("classes"))],
                        evidence=[self.w("classes", f) for f in ("classes-report.json", "classes-front.png", "classes-back.png", "classes-left.png", "classes-right.png", "classes-texture.png")],
                        note="sample each class's rgb from transfer_base_color.png into the spec until every class covers what the design gives it; the stage reruns when the spec changes")
        st["classes"] = classes

        def topology():
            cmds = [self.bl("export_parts.py", aligned, self.w("topology"))]
            if os.path.isfile(os.path.join("tools", "jam", "jam.mjs")):
                cmds.append(["node", os.path.join("tools", "jam", "jam.mjs"), "measure", "--file", os.path.relpath(self.w("topology", "character-topology.glb"))])
            return dict(gate=True, inputs=[aligned], outputs=[topo, self.w("topology", "character-topology.glb")], commands=cmds,
                        evidence=[self.w("topology", "character-topology.glb")])
        st["topology"] = topology

        def uv():
            self.need("joints")
            return dict(gate=True, inputs=[topo, colour, self.cfg["joints"]], outputs=[uvb, self.w("uv", "uv-report.json")],
                        commands=[self.bl("unwrap_parts.py", topo, colour, self.cfg["joints"], self.w("uv")),
                                  [sys.executable, self.s("blender", "draw_layout.py"), self.w("uv")],
                                  self.bl("render_checker.py", uvb, self.w("uv", "renders")),
                                  self.bl("export_uv.py", uvb, topo, self.w("uv"), spec=False)],
                        evidence=[self.w("uv", "uv-report.json"), self.w("uv", "uv-layouts.png"), self.w("uv", "renders")])
        st["uv"] = uv

        def texture():
            if not self.src:
                raise SystemExit("texture needs --source <high-resolution model.glb>")
            extra = ["--metallic-map", self.cfg["metallic_map"]] if self.cfg.get("metallic_map") else []
            inputs = [uvb, colour, self.src] + ([self.cfg["metallic_map"]] if extra else [])
            return dict(gate=True, inputs=inputs, outputs=[textured, self.w("texture", "texture-report.json")],
                        commands=[self.bl("bake_textures.py", uvb, colour, self.src, self.w("texture"), *extra),
                                  self.bl("render_textured.py", textured, self.w("texture", "renders")),
                                  self.bl("render_hair_check.py", textured, self.w("texture", "head")) + ["--unlit"]],
                        evidence=[self.w("texture", "texture-report.json"), self.w("texture", "renders"), self.w("texture", "head"), self.w("texture", "debug")])
        st["texture"] = texture

        def rig():
            self.need("manny", "joints")
            anims = self.cfg.get("anim") or []
            cmds = [self.bl("fit_rig.py", textured, self.cfg["manny"], self.cfg["joints"], self.w("rig")),
                    self.bl("render_pose.py", rigged, self.w("rig", "poses"), "bind", spec=False)]
            cmds += [self.bl("render_pose.py", rigged, self.w("rig", "poses"), p, "--pose", p, spec=False) for p in POSES]
            cmds += [self.bl("render_pose.py", rigged, self.w("rig", "poses"), os.path.splitext(os.path.basename(a))[0], "--anim", a, "--frames", "1,8,16,24", spec=False) for a in anims]
            cmds.append(self.bl("edge_stretch.py", self.w("rig", "character-rig-fit-pose.blend"), rigged, spec=False, exit_code=False))
            return dict(gate=True, inputs=[textured, self.cfg["manny"], self.cfg["joints"], *anims], outputs=[rigged, self.w("rig", "rig-report.json")],
                        commands=cmds, evidence=[self.w("rig", "rig-report.json"), self.w("rig", "poses"), self.w("logs", "rig-6.log")])
        st["rig"] = rig

        def export():
            return dict(gate=True, inputs=[rigged], outputs=[self.w("unreal", f"SKM_{sp.name}.fbx"), self.w("unreal", "export-info.json"), self.w("model.glb")],
                        commands=[self.bl("export_ue.py", rigged, self.w("unreal")), self.bl("export_glb.py", rigged, self.w("model.glb"), spec=False, exit_code=False)],
                        evidence=[self.w("unreal", "export-info.json"), self.w("model.glb")])
        st["export"] = export
        return st

    def rig_scale(self):
        """heightMeters divided by the generated mesh's height (the joints' space over the mesh's)."""
        expr = ("import bpy,sys;bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=sys.argv[-1]);"
                "z=[(o.matrix_world@v.co).z for o in bpy.context.scene.objects if o.type=='MESH' for v in o.data.vertices];print('HEIGHT',max(z)-min(z))")
        r = subprocess.run([self.blender, "--background", "--python-expr", expr, "--", self.cfg["mesh"]], capture_output=True, text=True)
        line = next((l for l in r.stdout.splitlines() if l.startswith("HEIGHT")), None)
        if r.returncode or not line:
            raise SystemExit(f"could not measure {self.cfg['mesh']}: {r.stderr[-400:]}")
        return round(self.spec.height / float(line.split()[1]), 6)

    # ---- freshness
    def fingerprint(self, name, stage):
        h = hashlib.sha256()
        files = [self.spec_path, os.path.join(HERE, "charspec.py")] + [c for cmd in stage["commands"] for c in cmd if isinstance(c, str) and c.endswith(".py") and os.path.isfile(c)] + stage["inputs"]
        for f in files:
            h.update(f.encode()); h.update(sha(f).encode() if os.path.isfile(f) else b"missing")
        for cmd in stage["commands"]:
            h.update(json.dumps([os.path.basename(c) if isinstance(c, str) else c for c in cmd]).encode())
        return h.hexdigest()


ORDER = ("fingers", "transfer", "classes", "topology", "uv", "texture", "rig", "export")


def cmd_run(a):
    W = os.path.abspath(a.work); os.makedirs(W, exist_ok=True)
    state_path = os.path.join(W, STATE)
    state = json.load(open(state_path)) if os.path.isfile(state_path) else {"config": {}, "stages": {}}
    cfg = state["config"]
    for n in PATH_OPTIONS:
        v = getattr(a, n)
        if v:
            cfg[n] = os.path.abspath(v)
    if a.anim:
        cfg["anim"] = [os.path.abspath(x) for x in a.anim]
    r = Runner(W, a.character, cfg, a.force)
    stages = r.stages()
    first = ORDER.index(a.start) if a.start else (0 if cfg.get("mesh") else 1)
    last = ORDER.index(a.to) if a.to else len(ORDER) - 1
    summary = {"character": r.spec.name, "work": W, "stages": {}, "stoppedAt": None, "next": None}
    started = time.time()
    for i in range(first, last + 1):
        name = ORDER[i]
        stage = stages[name]()
        fp = r.fingerprint(name, stage)
        rec = state["stages"].get(name, {})
        fresh = (not a.force and rec.get("fingerprint") == fp and all(os.path.exists(o) for o in stage["outputs"]))
        if a.dry_run:
            summary["stages"][name] = {"status": "unchanged" if fresh else "would run", "gate": stage["gate"],
                                       "commands": [" ".join(str(c) for c in cmd) for cmd in stage["commands"]]}
            continue
        if fresh:
            summary["stages"][name] = {"status": "unchanged", "evidence": [e for e in stage["evidence"] if os.path.exists(e)]}
            continue
        t0 = time.time(); summary["stages"][name] = {"status": "running"}
        for k, cmd in enumerate(stage["commands"]):
            log = os.path.join(r.log_dir, f"{name}-{k}.log")
            with open(log, "w") as lf:
                res = subprocess.run([str(c) for c in cmd], stdout=lf, stderr=subprocess.STDOUT)
            if res.returncode != 0:
                tail = open(log, errors="replace").read()[-1500:]
                summary["stages"][name] = {"status": "failed", "command": [os.path.basename(str(c)) for c in cmd[:6]], "log": log, "tail": tail}
                summary["stoppedAt"] = name
                summary["next"] = f"fix the failure in {log}, then rerun"
                return finish(state, state_path, summary, started, 1)
        missing = [o for o in stage["outputs"] if not os.path.exists(o)]
        if missing:
            summary["stages"][name] = {"status": "failed", "missingOutputs": missing}
            summary["stoppedAt"] = name
            return finish(state, state_path, summary, started, 1)
        state["stages"][name] = {"fingerprint": fp, "finished": time.strftime("%Y-%m-%dT%H:%M:%S"), "outputs": {o: sha(o) for o in stage["outputs"] if os.path.isfile(o)}}
        summary["stages"][name] = {"status": "ran", "seconds": round(time.time() - t0, 1), "evidence": [e for e in stage["evidence"] if os.path.exists(e)]}
        if stage.get("note"):
            summary["stages"][name]["note"] = stage["note"]
        if stage["gate"] and not a.to and i < len(ORDER) - 1:
            summary["stoppedAt"] = name
            summary["next"] = f"review the {name} evidence under the run's policy, then rerun to continue with {ORDER[i + 1]}"
            return finish(state, state_path, summary, started, 0)
    summary["next"] = "dry run: nothing executed" if a.dry_run else "done through " + ORDER[last]
    return finish(state, state_path, summary, started, 0, dry=a.dry_run)


def finish(state, state_path, summary, started, code, dry=False):
    summary["seconds"] = round(time.time() - started, 1)
    if dry:
        print(json.dumps(summary, indent=2)); return code
    with open(state_path, "w") as f:
        json.dump(state, f, indent=2)
    with open(os.path.join(os.path.dirname(state_path), SUMMARY), "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))
    return code


def cmd_status(a):
    path = os.path.join(os.path.abspath(a.work), STATE)
    state = json.load(open(path)) if os.path.isfile(path) else {"config": {}, "stages": {}}
    print(json.dumps({"config": state["config"], "stages": {n: state["stages"].get(n, {}).get("finished", "not run") for n in ORDER}}, indent=2))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--character", required=True); r.add_argument("--work", required=True)
    for n in PATH_OPTIONS:
        r.add_argument("--" + n.replace("_", "-"), dest=n)
    r.add_argument("--anim", action="append")
    r.add_argument("--from", dest="start", choices=ORDER); r.add_argument("--to", choices=ORDER)
    r.add_argument("--force", action="store_true")
    r.add_argument("--dry-run", action="store_true", help="list the stages and commands without running or recording anything")
    s = sub.add_parser("status"); s.add_argument("--work", required=True)
    a = p.parse_args(argv)
    try:
        return cmd_run(a) if a.cmd == "run" else cmd_status(a)
    except charspec.SpecError as e:
        print(str(e), file=sys.stderr); return 2


if __name__ == "__main__":
    sys.exit(main())
