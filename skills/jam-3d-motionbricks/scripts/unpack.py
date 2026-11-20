"""Unpack a MotionBricks result onto the SOMA rig. Runs in Blender, on the authoring side.

    blender --background --python-exit-code 1 --python unpack.py -- <result.json> <out-dir>
            --skeleton <soma-skeleton.json> --rig <soma-skeleton.glb> [--seam-tolerance <metres>] [--name generated]

--rig is any glTF file whose armature carries SOMA's joint names in SOMA's reference rest pose: the rig
soma_skeleton.py builds, or the SOMA file the poses were retargeted onto. Any animation it holds is dropped; the
written clip holds the generated animation only.

--seam-tolerance  how far (metres) a joint may jump at a seam between chained generations, measured as how much more
         its velocity changes there than in the frames around the seam, before the seam counts as a pop. It is the
         person's (for instance the jump their clip spec accepts) and has no default; a result that chains generations
         needs it.

Writes to out-dir:
  <name>.glb     the rig with one animation, <name>, at 30 fps; frame 0 is the last context pose
  contacts.json  the model's foot-contact confidences per frame (LeftFoot and RightFoot are heels, the ToeBase joints toes)
  unpack-report.json  frames, duration, the root's path and height, the largest one-frame joint move, each seam
                      between generations against the motion around it, the lowest foot against SOMA's reference
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


SEAM_WINDOW = generate.POSES_PER_TOKEN  # frames on each side of a seam that it is compared with: one token of motion


def seam_frames(result, frame_count):
    """Index of the first frame of each later generation in the clip (its step from the frame before is the seam)."""
    seams, end = [], 0
    for s in result["segments"][:-1]:
        end += s["playedFrames"] - (1 if seams else 0)
        seams.append(min(end, frame_count - 1))
    return seams


def steps(skel, frames, result, tolerance=None, window=SEAM_WINDOW):
    """The largest one-frame move of any joint, and each seam between generations judged against the motion around it.

    A seam is a pop when a joint's velocity changes there more than it does around it. For every joint the change in
    velocity at a frame j is |p[j+1] - 2 p[j] + p[j-1]|; a jump of d between frames k-1 and k (k the seam's frame)
    changes the velocity by about d at k-1 and again at k, whichever way it jumps, while smooth motion, however fast,
    changes it no more at the seam than in the frames beside it. `metres` is the larger change at k-1 and k, `around`
    the largest change over `window` frames on each side of those two, and `excess` = metres - around. The joint with
    the largest excess is reported, with `ratio` (metres / around, null when the joint moved steadily or not at all
    around the seam) and, given the person's tolerance, `pops`."""
    world = [m.forward_kinematics(skel["parents"], f) for f in frames]
    names = skel["joints"]
    n = len(world)

    def joint_step(k, i):
        return m.vlen(m.vsub(world[k][i][0], world[k - 1][i][0]))

    def velocity_change(j, i):
        p0, p1, p2 = world[j - 1][i][0], world[j][i][0], world[j + 1][i][0]
        return m.vlen([p2[a] - 2 * p1[a] + p0[a] for a in range(3)])

    def step(k):
        d, i = max((joint_step(k, i), i) for i in range(len(names)))
        return {"metres": round(d, 4), "frame": k, "joint": names[i]}
    every = [step(k) for k in range(1, n)]
    seams = []
    for k in seam_frames(result, n):
        at = [j for j in (k - 1, k) if 1 <= j < n - 1]
        around = [j for j in range(k - 1 - window, k + window + 1) if j not in (k - 1, k) and 1 <= j < n - 1]
        worst = None
        for i in range(len(names)):
            here = max((velocity_change(j, i) for j in at), default=0.0)
            near = max((velocity_change(j, i) for j in around), default=0.0)
            if worst is None or here - near > worst[0]:
                worst = (here - near, i, here, near)
        excess, i, here, near = worst
        excess = round(excess, 4)  # judged as reported, so rounding noise in steady motion is no excess
        seams.append({"frame": k, "joint": names[i], "metres": round(here, 4), "around": round(near, 4),
                      "excess": excess, "ratio": round(here / near, 3) if near > 1e-9 else None,
                      "window": window, "pops": None if tolerance is None else excess > tolerance,
                      "largestAnyJoint": step(k)})
    return {"largest": max(every, key=lambda e: e["metres"]) if every else None, "seamTolerance": tolerance, "seams": seams}


def report(skel, frames, result, tolerance=None):
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
        "frameSteps": steps(skel, frames, result, tolerance),
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
    parser.add_argument("--seam-tolerance", type=generate.distance)
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
        if len(result["segments"]) > 1 and args.seam_tolerance is None:
            raise ValueError(f"this result chains {len(result['segments'])} generations: give --seam-tolerance <metres>, "
                             "the person's limit for a jump at a seam, to judge them")
        blend.reset()
        arm = blend.import_armature(args.rig, skel["joints"])
        dropped = blend.clear_animations()
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
    rep = dict(report(skel, frames, result, args.seam_tolerance), clip=out, result={"file": os.path.basename(args.result), "sha256": sha},
               restFit=round(worst, 4), rigAnimationsDropped=dropped)
    with open(os.path.join(args.out_dir, "unpack-report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=2)
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
