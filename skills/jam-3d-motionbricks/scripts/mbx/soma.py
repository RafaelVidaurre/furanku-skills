"""The SOMA skeleton file and the conversion between a rig's world-space pose and SOMA local transforms.

The skeleton file (`soma-skeleton.json`) is written by `generate.py skeleton` from the MotionBricks install itself, so its
joint names, hierarchy and reference pose are the ones the engine uses. Everything here works in the glTF frame, which
is also SOMA model space.

Poses travel between rigs as world-space rotations relative to each rig's own rest pose. That makes the result
independent of how a tool orients its bones: a glTF file re-exported by a DCC, whose bone axes differ from SOMA's joint
frames, still gives the same SOMA pose, as long as its rest pose has SOMA's joint positions.
"""
import json
import math

from . import math3d as m

FORMAT = "jam-3d-motionbricks/skeleton@1"


class SkeletonError(ValueError):
    pass


def load_skeleton(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return check_skeleton(data)


def check_skeleton(data):
    if data.get("format") != FORMAT:
        raise SkeletonError(f"not a SOMA skeleton file (format {data.get('format')!r}, expected {FORMAT!r}); write one with `generate.py skeleton`")
    joints, parents, reference = data.get("joints"), data.get("parents"), data.get("reference")
    if not (isinstance(joints, list) and isinstance(parents, list) and isinstance(reference, list)) or not joints:
        raise SkeletonError("skeleton needs joints, parents and reference lists")
    if not (len(joints) == len(parents) == len(reference)):
        raise SkeletonError("skeleton joints, parents and reference differ in length")
    if len(set(joints)) != len(joints):
        raise SkeletonError("skeleton joint names repeat")
    if parents[0] != -1:
        raise SkeletonError("the skeleton's root must be joint 0")
    for i, p in enumerate(parents):
        if not (p == -1 and i == 0 or 0 <= p < len(joints)) or p == i:
            raise SkeletonError(f"joint {joints[i]} has an invalid parent {p}")
    for i, t in enumerate(reference):
        if len(t) != 7 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in t):
            raise SkeletonError(f"reference transform of {joints[i]} must be 7 finite numbers")
    missing = [j for j in data.get("modelJoints", []) if j not in joints]
    if not data.get("modelJoints") or missing:
        raise SkeletonError(f"skeleton must list modelJoints that it contains; missing: {missing}")
    m.topological_order(parents)
    return data


def index(skel):
    return {name: i for i, name in enumerate(skel["joints"])}


def reference_world(skel):
    return m.forward_kinematics(skel["parents"], skel["reference"])


def rest_mismatch(skel, rest_positions):
    """Largest distance between a rig's rest joint positions (glTF frame) and SOMA's reference, over the joints both
    have. Returns (metres, joint name)."""
    ref = reference_world(skel)
    worst, name = 0.0, None
    for i, joint in enumerate(skel["joints"]):
        if joint in rest_positions:
            d = m.vlen(m.vsub(rest_positions[joint], ref[i][0]))
            if d > worst:
                worst, name = d, joint
    return worst, name


def pack_pose(skel, rest_rotations, pose_rotations, root_position):
    """SOMA local transforms (one 7-list per joint, skeleton order) for one pose of a rig.

    rest_rotations and pose_rotations map joint name to the rig's world rotation of that joint at rest and in the pose,
    glTF frame. A joint the rig lacks keeps its reference local rotation. root_position is the root joint's world
    position in the pose."""
    parents = skel["parents"]
    ref = reference_world(skel)
    world_q = [None] * len(parents)
    for i in m.topological_order(parents):
        name = skel["joints"][i]
        if name in pose_rotations and name in rest_rotations:
            delta = m.qmul(pose_rotations[name], m.qconj(rest_rotations[name]))
            world_q[i] = m.qnormalize(m.qmul(delta, ref[i][1]))
        elif parents[i] < 0:
            world_q[i] = ref[i][1]
        else:
            world_q[i] = m.qnormalize(m.qmul(world_q[parents[i]], tuple(skel["reference"][i][3:])))
    locals_ = m.locals_from_world_rotations(parents, world_q, root_position, skel["reference"])
    return [list(t) for t in locals_]


def unpack_pose(skel, local_pose):
    """For each joint: its world position and the world rotation it underwent from SOMA's reference pose (glTF frame).
    Applying that rotation to another rig's rest rotation of the same joint gives that rig's pose."""
    world = m.forward_kinematics(skel["parents"], local_pose)
    ref = reference_world(skel)
    return [(world[i][0], m.qnormalize(m.qmul(world[i][1], m.qconj(ref[i][1])))) for i in range(len(world))]


def lowest(skel, poses, joints):
    """Lowest height (Y) of the named joints over the poses, and the same over the reference pose."""
    idx = index(skel)
    present = [idx[j] for j in joints if j in idx]
    if not present:
        return None, None
    low = min(m.forward_kinematics(skel["parents"], p)[i][0][1] for p in poses for i in present)
    ref = reference_world(skel)
    return low, min(ref[i][0][1] for i in present)
