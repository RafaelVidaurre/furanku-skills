#!/usr/bin/env python3
"""Write two plain test humanoids that differ the ways real rigs do, each with a landmark map and the same two motions.

    python make_test_rigs.py <out-dir>

rig-a.glb: 1.6 m to the head joint area, an A-pose (arms 45 degrees below level), bones whose axes point along the
bone, an armature node scaled 0.01 above them (joint offsets in centimetres), a forearm twist bone at no landmark, no
fingers, no root bone. rig-b.glb: taller with longer thighs and relatively shorter arms, a T-pose, every joint with the
world's axes at rest, a ground-level root joint above the pelvis, three spine bones (the middle one at no landmark),
an upper-arm twist bone and five three-joint fingers per hand. Each has a box per bone, skinned rigidly, so it renders.

Both carry the same two motions, authored once in world terms and posed on each rig separately:
  walk  two strides forward with each ankle held still on the ground while planted (feet placed by IK on each rig's
        own legs), arms swinging at the sides; on rig-b the root bone carries the ground travel.
  arms  arms down at the sides, out level, overhead, forward with the forearms up, crossed in front of the chest, and
        down again; hips and legs still.
rig-a is keyed at 30 fps, rig-b at 24. Writes rig-a.glb, rig-b.glb, rig-a.map.json, rig-b.map.json and motions.json
(the world-space arm directions each motion asks for, per frame, to check a retarget against). A fixture for the tests
and for trying the scripts; no character is this regular.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jamretarget import gltf, mathx  # noqa: E402

UP, FRONT = np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])


def rig_a():
    """[(name, parent, world position, landmark)] of the A-pose rig."""
    bones = [("Hips", None, (0, 0.92, 0), "hips"), ("Spine", "Hips", (0, 1.0, -0.01), "spine"),
             ("Chest", "Spine", (0, 1.25, -0.02), "chest"), ("Neck", "Chest", (0, 1.40, -0.02), "neck"),
             ("Head", "Neck", (0, 1.48, 0.0), "head")]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        s = side.lower()
        arm = np.array([math.cos(math.radians(45)) * sx, -math.sin(math.radians(45)), 0.0])
        upper = np.array([0.17 * sx, 1.36, -0.02]); elbow = upper + 0.27 * arm; wrist = elbow + 0.25 * arm
        bones += [("Clavicle_" + side, "Chest", (0.02 * sx, 1.37, 0.0), "shoulder." + s), ("UpperArm_" + side, "Clavicle_" + side, upper, "upper-arm." + s),
                  ("Forearm_" + side, "UpperArm_" + side, elbow, "lower-arm." + s), ("ForearmTwist_" + side, "Forearm_" + side, (elbow + wrist) / 2, None),
                  ("Hand_" + side, "Forearm_" + side, wrist, "hand." + s),
                  ("Thigh_" + side, "Hips", (0.09 * sx, 0.86, 0.0), "upper-leg." + s), ("Shin_" + side, "Thigh_" + side, (0.09 * sx, 0.47, 0.01), "lower-leg." + s),
                  ("Foot_" + side, "Shin_" + side, (0.09 * sx, 0.08, -0.02), "foot." + s), ("Toe_" + side, "Foot_" + side, (0.09 * sx, 0.02, 0.12), "toes." + s)]
    return bones


def rig_b():
    bones = [("Root", None, (0, 0, 0), None), ("Pelvis", "Root", (0, 1.02, 0.01), "hips"), ("SpineLow", "Pelvis", (0, 1.10, 0.0), "spine"),
             ("SpineMid", "SpineLow", (0, 1.24, -0.01), None), ("SpineHigh", "SpineMid", (0, 1.40, -0.02), "chest"),
             ("Neck", "SpineHigh", (0, 1.56, -0.01), "neck"), ("Head", "Neck", (0, 1.66, 0.01), "head")]
    for side, sx in (("l", 1.0), ("r", -1.0)):
        upper = np.array([0.20 * sx, 1.52, -0.02]); elbow = upper + (0.28 * sx, 0, 0); wrist = elbow + (0.26 * sx, 0, 0)
        bones += [("Collar." + side, "SpineHigh", (0.03 * sx, 1.52, 0.0), "shoulder." + side), ("Arm." + side, "Collar." + side, upper, "upper-arm." + side),
                  ("ArmTwist." + side, "Arm." + side, (upper + elbow) / 2, None), ("Elbow." + side, "Arm." + side, elbow, "lower-arm." + side),
                  ("Wrist." + side, "Elbow." + side, wrist, "hand." + side)]
        for finger, across, lengths in (("index", 0.035, (0.04, 0.025, 0.02)), ("middle", 0.012, (0.045, 0.028, 0.02)),
                                        ("ring", -0.012, (0.042, 0.026, 0.02)), ("pinky", -0.034, (0.034, 0.02, 0.017))):
            p, parent = wrist + (0.095 * sx, 0, across), "Wrist." + side
            for k, length in enumerate(lengths, 1):
                name = "%s%d.%s" % (finger.capitalize(), k, side)
                bones.append((name, parent, p.copy(), "%s-%d.%s" % (finger, k, side)))
                parent, p = name, p + (length * sx, 0, 0)
        p, parent, d = wrist + (0.025 * sx, -0.01, 0.035), "Wrist." + side, mathx.unit(np.array([0.5 * sx, -0.2, 0.85]))
        for k, length in enumerate((0.035, 0.03, 0.025), 1):
            name = "Thumb%d.%s" % (k, side)
            bones.append((name, parent, p.copy(), "thumb-%d.%s" % (k, side)))
            parent, p = name, p + length * d
        bones += [("Thigh." + side, "Pelvis", (0.11 * sx, 0.96, 0.0), "upper-leg." + side), ("Calf." + side, "Thigh." + side, (0.11 * sx, 0.50, 0.01), "lower-leg." + side),
                  ("Ankle." + side, "Calf." + side, (0.11 * sx, 0.09, -0.02), "foot." + side), ("Ball." + side, "Ankle." + side, (0.11 * sx, 0.02, 0.13), "toes." + side)]
    return bones


class Rig:
    def __init__(self, bones, axes):
        self.names = [b[0] for b in bones]
        self.index = {n: i for i, n in enumerate(self.names)}
        self.parent = [self.index[b[1]] if b[1] else -1 for b in bones]
        self.pos = np.array([b[2] for b in bones], dtype=np.float64)
        self.landmark = {b[3]: i for i, b in enumerate(bones) if b[3]}
        self.children = [[j for j, p in enumerate(self.parent) if p == i] for i in range(len(bones))]
        self.rest = np.array([self._axes(i) if axes == "along" else np.eye(3) for i in range(len(bones))])

    def child_dir(self, i):
        """The direction a bone points: to its landmark child when it has one, else to its first child, else its parent's."""
        kids = self.children[i]
        marked = [k for k in kids if k in self.landmark.values()]
        if marked or kids:
            return mathx.unit(self.pos[(marked or kids)[0]] - self.pos[i])
        return self.child_dir(self.parent[i]) if self.parent[i] >= 0 else UP

    def _axes(self, i):
        y = self.child_dir(i)
        ref = FRONT if abs(np.dot(y, FRONT)) < 0.9 else UP
        return _along(y, ref)


def _along(y, ref):
    """Columns (x, y, z) with y along the bone and z toward `ref`."""
    z = mathx.unit(ref - y * np.dot(ref, y))
    return np.stack([np.cross(y, z), y, z], axis=1)


# ---- motions in world terms ------------------------------------------------------------------------------------------

def smooth(u):
    return u * u * (3 - 2 * u)


def keyed_dir(keys, t):
    """Slerp between (time, direction) keys with eased timing."""
    times = [k[0] for k in keys]
    if t <= times[0]:
        return mathx.unit(np.array(keys[0][1]))
    if t >= times[-1]:
        return mathx.unit(np.array(keys[-1][1]))
    i = max(j for j in range(len(times)) if times[j] <= t)
    u = smooth((t - times[i]) / (times[i + 1] - times[i]))
    a, b = mathx.unit(np.array(keys[i][1])), mathx.unit(np.array(keys[i + 1][1]))
    ang = math.acos(max(-1.0, min(1.0, float(np.dot(a, b)))))
    if ang < 1e-6:
        return a
    return mathx.unit((math.sin((1 - u) * ang) * a + math.sin(u * ang) * b) / math.sin(ang))


def arm_keys(sx):
    down = (math.sin(math.radians(10)) * sx, -math.cos(math.radians(10)), 0)
    upper = [(0.0, down), (0.5, (sx, 0, 0)), (1.0, (math.sin(math.radians(15)) * sx, math.cos(math.radians(15)), 0)),
             (1.5, (0.15 * sx, 0, 1)), (2.0, (-0.25 * sx, -0.25, 0.93)), (2.5, down)]
    lower = [(0.0, down), (0.5, (sx, 0, 0)), (1.0, (math.sin(math.radians(15)) * sx, math.cos(math.radians(15)), 0)),
             (1.5, (0, 1, 0.1)), (2.0, (-sx, 0.05, 0.25)), (2.5, down)]
    return upper, lower


def yaw(deg):
    return mathx.axis_angle(UP, math.radians(deg))


def walk_pose(rig, t):
    """{bone: world rotation delta or direction} for the walk at time t on a rig, plus hips and root positions."""
    L = rig.landmark
    leg = np.mean([np.linalg.norm(rig.pos[L["lower-leg." + s]] - rig.pos[L["upper-leg." + s]]) +
                   np.linalg.norm(rig.pos[L["foot." + s]] - rig.pos[L["lower-leg." + s]]) for s in "lr"])
    T, v = 1.0, 0.9 * leg
    hips0 = rig.pos[L["hips"]]
    hips = hips0 + np.array([0.02 * leg * math.sin(2 * math.pi * t / T), -0.08 * leg + 0.015 * leg * math.cos(4 * math.pi * t / T), v * t])
    hips_rot = yaw(5 * math.sin(2 * math.pi * t / T))
    out = {"delta": {"hips": hips_rot, "spine": hips_rot, "chest": yaw(-4 * math.sin(2 * math.pi * t / T)), "neck": np.eye(3), "head": np.eye(3)},
           "dir": {}, "hips": hips, "root": np.array([hips[0], 0.0, hips[2]]), "root_rot": hips_rot}
    for s, offset, sx in (("l", 0.0, 1.0), ("r", 0.5, -1.0)):
        ankle0 = rig.pos[L["foot." + s]]
        tt = t / T - offset
        n = math.floor(tt); phase = tt - n
        plant = lambda m: ankle0 + np.array([0, 0, v * T * (m + 0.3 + offset)])
        if phase < 0.6:
            ankle = plant(n)
        else:
            u = (phase - 0.6) / 0.4
            ankle = plant(n) + (plant(n + 1) - plant(n)) * smooth(u) + np.array([0, 0.08 * leg * math.sin(math.pi * u), 0])
        hip = hips + hips_rot @ (rig.pos[L["upper-leg." + s]] - hips0)
        l1 = np.linalg.norm(rig.pos[L["lower-leg." + s]] - rig.pos[L["upper-leg." + s]])
        l2 = np.linalg.norm(rig.pos[L["foot." + s]] - rig.pos[L["lower-leg." + s]])
        d = np.linalg.norm(ankle - hip); u_ = (ankle - hip) / d
        pole = hips_rot @ FRONT; pole = mathx.unit(pole - u_ * np.dot(pole, u_))
        ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
        if not -1 <= ca <= 1:
            raise SystemExit("walk: the %s ankle is out of reach at t=%.3f" % (s, t))
        knee = hip + l1 * (ca * u_ + math.sqrt(1 - ca * ca) * pole)
        out["dir"]["upper-leg." + s] = knee - hip
        out["dir"]["lower-leg." + s] = ankle - knee
        out["delta"]["foot." + s] = np.eye(3)
        swing = math.radians(-22 * math.sin(2 * math.pi * (t / T - offset)))
        arm = np.array([math.sin(math.radians(8)) * sx, -math.cos(swing), math.sin(swing)])
        out["dir"]["upper-arm." + s] = arm
        out["dir"]["lower-arm." + s] = arm + np.array([0, 0.25, 0.35])
    return out


def arms_pose(rig, t):
    out = {"delta": {"hips": np.eye(3)}, "dir": {}, "hips": rig.pos[rig.landmark["hips"]].copy(), "root": np.zeros(3), "root_rot": np.eye(3)}
    for s, sx in (("l", 1.0), ("r", -1.0)):
        upper, lower = arm_keys(sx)
        out["dir"]["upper-arm." + s] = keyed_dir(upper, t)
        out["dir"]["lower-arm." + s] = keyed_dir(lower, t)
    return out


def pose_world(rig, spec):
    """World rotations [N,3,3] and positions [N,3] of every bone for one pose spec."""
    n = len(rig.names)
    R, P = np.zeros((n, 3, 3)), np.zeros((n, 3))
    by_bone = {rig.landmark[k]: v for k, v in spec["dir"].items() if k in rig.landmark}
    delta = {rig.landmark[k]: v for k, v in spec["delta"].items() if k in rig.landmark}
    hips = rig.landmark["hips"]
    for i in range(n):
        p = rig.parent[i]
        if p < 0 and i != hips:
            R[i] = spec["root_rot"] @ rig.rest[i]; P[i] = spec["root"]
            continue
        if i == hips:
            R[i] = delta[i] @ rig.rest[i]; P[i] = spec["hips"]
            continue
        parent_delta = R[p] @ rig.rest[p].T
        P[i] = P[p] + parent_delta @ (rig.pos[i] - rig.pos[p])
        follow = parent_delta @ rig.rest[i]
        if i in delta:
            R[i] = delta[i] @ rig.rest[i]
        elif i in by_bone:
            R[i] = mathx.arc(parent_delta @ rig.child_dir(i), by_bone[i]) @ follow
        else:
            R[i] = follow
    return R, P


# ---- writing ----------------------------------------------------------------------------------------------------------

def box(a, b, half):
    """Vertices and triangles of a box around the segment a-b."""
    axis = b - a
    y = mathx.unit(axis) if np.linalg.norm(axis) > 1e-9 else UP
    ref = FRONT if abs(np.dot(y, FRONT)) < 0.9 else UP
    x = mathx.unit(np.cross(y, ref)); z = np.cross(x, y)
    corners = [a + sx * half * x + sz * half * z for sx in (-1, 1) for sz in (-1, 1)]
    corners += [c + axis for c in corners]
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return np.array(corners), faces


def write_rig(path, rig, motions, fps, armature_scale=None, armature_name=None):
    n = len(rig.names)
    s = armature_scale or 1.0
    nodes = []
    for i, name in enumerate(rig.names):
        p = rig.parent[i]
        r_local = rig.rest[i] if p < 0 else rig.rest[p].T @ rig.rest[i]
        t_local = rig.pos[i] / s if p < 0 else rig.rest[p].T @ (rig.pos[i] - rig.pos[p]) / s
        node = {"name": name, "translation": [float(v) for v in t_local], "rotation": [float(v) for v in mathx.mat_to_quat(r_local)]}
        if rig.children[i]:
            node["children"] = rig.children[i]
        nodes.append(node)
    roots = [i for i in range(n) if rig.parent[i] < 0]
    if armature_scale:
        nodes.append({"name": armature_name, "scale": [armature_scale] * 3, "children": roots})
        scene_roots = [n]
    else:
        scene_roots = list(roots)
    mesh_node = len(nodes)
    nodes.append({"name": "Body", "mesh": 0, "skin": 0})
    scene_roots.append(mesh_node)
    verts, tris, joints = [], [], []
    height = rig.pos[:, 1].max()
    for i in range(n):
        kids = [k for k in rig.children[i] if k in rig.landmark.values()] or rig.children[i]
        finger = next((k for k, v in rig.landmark.items() if v == i), "").split("-")[0] in ("thumb", "index", "middle", "ring", "pinky")
        half = (0.008 if finger else 0.03 if rig.parent[i] >= 0 else 0.06) * height / 1.6
        ends = [rig.pos[k] for k in kids] if kids else [rig.pos[i] + rig.child_dir(i) * 0.06 * height]
        if rig.landmark.get("head") == i:
            ends = [rig.pos[i] + UP * 0.18]
            half = 0.08
        if rig.parent[i] < 0 and i not in rig.landmark.values():
            continue
        for e in ends:
            v, f = box(rig.pos[i], e, half)
            tris += [(a + len(verts), b + len(verts), c + len(verts)) for a, b, c in f]
            verts += list(v); joints += [i] * len(v)
    verts = np.array(verts) * 1.0
    doc = {"asset": {"version": "2.0", "generator": "jam-3d-retarget make_test_rigs.py"}, "scene": 0,
           "scenes": [{"nodes": scene_roots}], "nodes": nodes}
    pack = gltf.Packer(doc)
    joint_world = np.tile(np.eye(4), (n, 1, 1))
    joint_world[:, :3, :3] = rig.rest * s; joint_world[:, :3, 3] = rig.pos          # the armature's scale is in each joint
    ibm = np.array([np.linalg.inv(joint_world[i]).T.reshape(16) for i in range(n)])
    doc["skins"] = [{"joints": list(range(n)), "inverseBindMatrices": pack.add(ibm, "MAT4")}]
    if armature_scale:
        doc["skins"][0]["skeleton"] = n
    pos_acc = pack.add(verts.astype(np.float32), "VEC3", target=34962, minmax=True)
    j_acc = pack.add(np.array([[j, 0, 0, 0] for j in joints], dtype=np.uint16), "VEC4", component=5123, target=34962)
    w_acc = pack.add(np.array([[1.0, 0, 0, 0]] * len(joints), dtype=np.float32), "VEC4", target=34962)
    i_acc = pack.add(np.array(tris, dtype=np.uint32).reshape(-1, 1), "SCALAR", component=5125, target=34963)
    doc["meshes"] = [{"name": "Body", "primitives": [{"attributes": {"POSITION": pos_acc, "JOINTS_0": j_acc, "WEIGHTS_0": w_acc},
                                                      "indices": i_acc, "material": 0}]}]
    doc["materials"] = [{"name": "Clay", "pbrMetallicRoughness": {"baseColorFactor": [0.72, 0.62, 0.52, 1.0], "metallicFactor": 0.0}}]
    asked = {}
    for name, fn, duration in motions:
        times = np.arange(int(round(duration * fps)) + 1) / fps
        poses = [pose_world(rig, fn(rig, t)) for t in times]
        R = np.array([p[0] for p in poses]); P = np.array([p[1] for p in poses])
        channels = []
        for i in range(n):
            p = rig.parent[i]
            local_r = R[:, i] if p < 0 else np.swapaxes(R[:, p], -1, -2) @ R[:, i]
            channels.append((i, "rotation", mathx.continuous(mathx.mat_to_quat(local_r))))
            if p < 0 or i == rig.landmark["hips"]:
                local_t = P[:, i] / s if p < 0 else np.einsum("fji,fj->fi", R[:, p], P[:, i] - P[:, p]) / s
                channels.append((i, "translation", local_t))
        samplers, chans = [], []
        t_acc = pack.add(times.astype(np.float32).reshape(-1, 1), "SCALAR", minmax=True)
        for node, prop, values in channels:
            samplers.append({"input": t_acc, "output": pack.add(np.asarray(values, dtype=np.float32), "VEC4" if prop == "rotation" else "VEC3"),
                             "interpolation": "LINEAR"})
            chans.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": prop}})
        doc.setdefault("animations", []).append({"name": name, "samplers": samplers, "channels": chans})
        asked[name] = {"fps": fps, "frames": len(times),
                       "directions": {k: [[round(float(x), 6) for x in fn(rig, t)["dir"][k]] for t in times]
                                      for k in ("upper-arm.l", "upper-arm.r", "lower-arm.l", "lower-arm.r")}}
    gltf.write_glb(path, doc, pack.finish())
    return asked


def write_map(path, rig, label):
    data = {"label": label, "notes": "Written by make_test_rigs.py for its test figure.",
            "landmarks": {rig.names[i]: k for k, i in sorted(rig.landmark.items(), key=lambda kv: kv[1])}}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1); f.write("\n")


MOTIONS = [("walk", walk_pose, 2.0), ("arms", arms_pose, 2.5)]


def main(argv=None):
    p = argparse.ArgumentParser(prog="make_test_rigs.py", description=__doc__.split("\n\n")[0])
    p.add_argument("out")
    a = p.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    A, B = Rig(rig_a(), "along"), Rig(rig_b(), "world")
    motions = {"rig-a": write_rig(os.path.join(a.out, "rig-a.glb"), A, MOTIONS, 30, armature_scale=0.01, armature_name="RigA"),
               "rig-b": write_rig(os.path.join(a.out, "rig-b.glb"), B, MOTIONS, 24)}
    write_map(os.path.join(a.out, "rig-a.map.json"), A, "make_test_rigs.py rig A")
    write_map(os.path.join(a.out, "rig-b.map.json"), B, "make_test_rigs.py rig B")
    with open(os.path.join(a.out, "motions.json"), "w", encoding="utf-8") as f:
        json.dump(motions, f)
    print(json.dumps({"rigs": [os.path.join(a.out, n).replace(os.sep, "/") for n in ("rig-a.glb", "rig-b.glb")]}))


if __name__ == "__main__":
    main()
