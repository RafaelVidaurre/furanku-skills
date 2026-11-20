"""Write a small set of constructed SOMA poses for a first end-to-end run. Runs in Blender.

    blender --background --python-exit-code 1 --python make_test_poses.py -- <soma-skeleton.json> <soma-skeleton.glb> <out-dir>
            [--distance 1.5] [--turn-distance 1.0]

The poses are built from SOMA's reference pose alone (arms lowered 75 degrees, the whole body placed and turned); no
motion data goes in, so the files and anything generated from them carry no third-party data terms. Writes:
  context.glb      eight frames standing still at the origin, facing +Z
  target-ahead.glb one pose standing `--distance` metres ahead, facing +Z (a stop)
  target-turn.glb  one pose `--turn-distance` metres to the character's left of that, turned 90 degrees to its left
Use them to prove a host and the round trip work; they are not content.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mbx import math3d as m, soma  # noqa: E402

ARM_DROP = math.radians(75.0)


def standing(skel, x, z, heading):
    """SOMA local pose: reference pose with arms lowered, hips at (x, reference height, z), turned `heading` radians
    about +Y (positive turns the character to its left)."""
    idx = soma.index(skel)
    ref = soma.reference_world(skel)
    turn = m.qaxis_angle((0.0, 1.0, 0.0), heading)
    ref_q = {name: ref[i][1] for i, name in enumerate(skel["joints"])}
    pose_q = {skel["joints"][0]: m.qmul(turn, ref[0][1])}
    for joint, sign in (("LeftArm", -1.0), ("RightArm", 1.0)):
        if joint in idx:
            drop = m.qaxis_angle((0.0, 0.0, 1.0), sign * ARM_DROP)
            pose_q[joint] = m.qmul(turn, m.qmul(drop, ref[idx[joint]][1]))
    root = (x, ref[0][0][1], z)
    return soma.pack_pose(skel, ref_q, pose_q, root)


def main(argv):
    parser = argparse.ArgumentParser(prog="make_test_poses.py", description=__doc__.splitlines()[0])
    parser.add_argument("skeleton")
    parser.add_argument("rig")
    parser.add_argument("out_dir")
    parser.add_argument("--distance", type=float, default=1.5)
    parser.add_argument("--turn-distance", type=float, default=1.0)
    args = parser.parse_args(argv)
    from mbx import blend
    skel = soma.load_skeleton(args.skeleton)
    files = {
        "context.glb": [standing(skel, 0.0, 0.0, 0.0)] * 8,
        "target-ahead.glb": [standing(skel, 0.0, args.distance, 0.0)],
        "target-turn.glb": [standing(skel, args.turn_distance, args.distance, math.pi / 2)],
    }
    os.makedirs(args.out_dir, exist_ok=True)
    written = {}
    for name, poses in files.items():
        blend.reset()
        arm = blend.import_armature(args.rig, skel["joints"])
        keyed = []
        for pose in poses:
            world = soma.unpack_pose(skel, pose)
            keyed.append({j: world[i] for i, j in enumerate(skel["joints"]) if j in arm.data.bones})
        blend.key_poses(arm, keyed, os.path.splitext(name)[0])
        path = os.path.join(args.out_dir, name)
        blend.export_glb(path)
        written[name] = len(poses)
    print(json.dumps({"out": args.out_dir, "files": written}))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
