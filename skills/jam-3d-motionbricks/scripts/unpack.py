"""Unpack a MotionBricks result onto the SOMA rig. Runs in Blender, on the authoring side.

    blender --background --python-exit-code 1 --python unpack.py -- <result.json> <out-dir>
            --skeleton <soma-skeleton.json> --rig <soma-skeleton.glb> [--name generated]

--rig is any glTF file whose armature carries SOMA's joint names in SOMA's reference rest pose: the rig
soma_skeleton.py builds, or the SOMA file the poses were retargeted onto.

Writes to out-dir:
  <name>.glb     the rig with one animation, <name>, at 30 fps; frame 0 is the last context pose
  contacts.json  the model's foot-contact confidences per frame (LeftFoot and RightFoot are heels, the ToeBase joints toes)
  unpack-report.json  frames, duration, the root's path and height, the largest one-frame joint move overall and at
                      each seam between generations, the lowest foot against SOMA's reference
Prints the report. Exits 1 when the result is invalid or does not match the skeleton.
"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate  # noqa: E402
from mbx import math3d as m, soma  # noqa: E402

CONTACTS_FORMAT = "jam-3d-motionbricks/contacts@1"


def reorder(skel, result):
    """Result frames in the skeleton's joint order; joints the result lacks take the reference pose."""
    cols = {name: i for i, name in enumerate(result["joints"])}
    missing = [j for j in skel["modelJoints"] if j not in cols]
    if missing:
        raise ValueError(f"the result lacks model joints {', '.join(missing)}")
    return [[frame[cols[j]] if j in cols else skel["reference"][i] for i, j in enumerate(skel["joints"])]
            for frame in result["frames"]]


def steps(skel, frames, result):
    """The largest one-frame move of any joint, overall and at each seam between generations."""
    world = [m.forward_kinematics(skel["parents"], f) for f in frames]

    def step(k):
        d, i = max((m.vlen(m.vsub(world[k][i][0], world[k - 1][i][0])), i) for i in range(len(skel["joints"])))
        return {"metres": round(d, 4), "frame": k, "joint": skel["joints"][i]}
    every = [step(k) for k in range(1, len(world))]
    seams, end = [], 0
    for s in result["segments"][:-1]:
        end += s["playedFrames"] - (1 if seams else 0)
        seams.append(step(min(end, len(world) - 1)))
    return {"largest": max(every, key=lambda e: e["metres"]) if every else None, "seams": seams}


def report(skel, frames, result):
    roots = [f[0][:3] for f in frames]
    path = sum(m.vlen(m.vsub(b, a)) for a, b in zip(roots, roots[1:]))
    low, ref = soma.lowest(skel, frames, skel.get("footContactJoints") or result["contacts"]["joints"])
    return {
        "frames": len(frames), "fps": generate.FPS, "seconds": round((len(frames) - 1) / generate.FPS, 4),
        "segments": [{k: s.get(k) for k in ("generatedFrames", "playedFrames", "tokens", "transitionEarlyBy")} for s in result["segments"]],
        "root": {"start": [round(v, 4) for v in roots[0]], "end": [round(v, 4) for v in roots[-1]],
                 "groundTravel": round(((roots[-1][0] - roots[0][0]) ** 2 + (roots[-1][2] - roots[0][2]) ** 2) ** 0.5, 4),
                 "pathLength": round(path, 4),
                 "height": {"min": round(min(r[1] for r in roots), 4), "max": round(max(r[1] for r in roots), 4)}},
        "frameSteps": steps(skel, frames, result),
        "floor": {"lowestFoot": round(low, 4), "referenceLowestFoot": round(ref, 4), "floorOffset": round(low - ref, 4)},
        "inference": result.get("inference"), "model": result.get("model"),
    }


def contacts_file(result, source_sha):
    c = result["contacts"]
    return {"format": CONTACTS_FORMAT, "fps": generate.FPS, "frames": len(c["values"]), "joints": c["joints"],
            "meaning": "Model-predicted confidence from 0 to 1 that each heel (Foot) or toe (ToeBase) is planted, "
                       "per frame of the generated clip on SOMA. Verify contacts on the target rig; these are not a "
                       "measurement.",
            "values": c["values"], "result": {"sha256": source_sha}}


def main(argv):
    parser = argparse.ArgumentParser(prog="unpack.py", description=__doc__.splitlines()[0])
    parser.add_argument("result")
    parser.add_argument("out_dir")
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--rig", required=True)
    parser.add_argument("--name", default="generated")
    args = parser.parse_args(argv)
    from mbx import blend
    try:
        skel = soma.load_skeleton(args.skeleton)
        with open(args.result, encoding="utf-8") as f:
            result = json.load(f)
        problems = generate.validate_result(result)
        if problems:
            raise ValueError("result is invalid:\n  " + "\n  ".join(problems))
        frames = reorder(skel, result)
        blend.reset()
        arm = blend.import_armature(args.rig, skel["joints"])
        rest = blend.rest_world(arm)
        worst, joint = soma.rest_mismatch(skel, {n: p for n, (p, _) in rest.items()})
        if worst > 0.01:
            raise ValueError(f"{args.rig}: its rest pose is not SOMA's reference pose ({joint} is {worst:.3f} m off)")
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

    keyed = []
    for frame in frames:
        world = soma.unpack_pose(skel, frame)
        keyed.append({name: world[i] for i, name in enumerate(skel["joints"]) if name in arm.data.bones})
    blend.key_poses(arm, keyed, args.name)
    os.makedirs(args.out_dir, exist_ok=True)
    out = os.path.join(args.out_dir, args.name + ".glb")
    blend.export_glb(out)
    with open(args.result, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    with open(os.path.join(args.out_dir, "contacts.json"), "w", encoding="utf-8") as f:
        json.dump(contacts_file(result, sha), f, indent=1)
    rep = dict(report(skel, frames, result), clip=out, result={"file": os.path.basename(args.result), "sha256": sha},
               restFit=round(worst, 4))
    with open(os.path.join(args.out_dir, "unpack-report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=2)
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
