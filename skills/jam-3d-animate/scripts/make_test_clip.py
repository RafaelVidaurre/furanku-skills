"""Build a rigged test humanoid and a walk clip on it, optionally with known faults. Runs in Blender.

    blender --background --python-exit-code 1 --python make_test_clip.py -- <out-dir>
            [--names landmark|camel] [--root-bone] [--fps 30] [--period 1.0] [--speed 1.0] [--loop-end open|duplicate]
            [--slide <metres>] [--sink <metres>] [--pop start|end:<metres>] [--seam <metres>] [--step <frame>:<metres> ...]
            [--name walk] [--poses] [--no-mesh]

The figure is 1.7 m tall, made of boxes each weighted wholly to one bone, its soles exactly on the ground at rest. The
walk is computed, not keyed by hand: one cycle lasts --period seconds, the hips travel at --speed (m/s) along the
figure's front with a bob and a sway, each foot is planted for 60% of the cycle and swings for 40%, legs are solved to
reach the feet, arms swing. Faults:

    --slide m      the left foot drifts forward m metres over its first planted window
    --sink m       the right foot sits m metres lower all through the clip (its sole goes below the ground)
    --pop start:m  the first or last frame jumps m metres sideways (--pop end:m: the last; the whole body)
    --seam m       the whole body rises m metres over the second half of the clip, so the last frame does not meet the
                   first
    --step f:m     from frame f to the end the whole body sits m metres further forward (a jump inside the clip);
                   repeat it for several

Writes rig.glb (the rig at rest, no animation), clip.glb (the rig with the walk), map.json (its skeleton map),
truth.json (the planted windows and the size of each fault as built) and, with --poses, poses.glb (two one-key
animations, "contact" and "passing"). --no-mesh leaves the skeleton without a body. A fixture for the tests and a way
to try the scripts with nothing else at hand; no real character is this regular.
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamanim  # noqa: E402
from jamanim import blend  # noqa: E402

FRONT = Vector((0, -1, 0))          # Blender frame: Z up, the figure faces -Y, +X is its left
J = {"hips": (0, 0, 0.95), "spine": (0, 0, 1.05), "chest": (0, 0, 1.30), "neck": (0, 0, 1.45), "head": (0, 0, 1.52)}
for side, sx in (("l", 1.0), ("r", -1.0)):
    J.update({"shoulder." + side: (sx * 0.03, 0, 1.40), "upper-arm." + side: (sx * 0.18, 0, 1.40),
              "lower-arm." + side: (sx * 0.24, 0, 1.13), "hand." + side: (sx * 0.28, -0.02, 0.88),
              "upper-leg." + side: (sx * 0.09, 0, 0.92), "lower-leg." + side: (sx * 0.09, -0.03, 0.50),
              "foot." + side: (sx * 0.09, 0, 0.08), "toes." + side: (sx * 0.09, -0.12, 0.02)})
PARENT = {"hips": None, "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck"}
for s in ("l", "r"):
    PARENT.update({"shoulder." + s: "chest", "upper-arm." + s: "shoulder." + s, "lower-arm." + s: "upper-arm." + s,
                   "hand." + s: "lower-arm." + s, "upper-leg." + s: "hips", "lower-leg." + s: "upper-leg." + s,
                   "foot." + s: "lower-leg." + s, "toes." + s: "foot." + s})
CHILD = {"hips": "spine", "spine": "chest", "chest": "neck", "neck": "head", "shoulder": "upper-arm", "upper-arm": "lower-arm",
         "lower-arm": "hand", "upper-leg": "lower-leg", "lower-leg": "foot", "foot": "toes"}
TAIL = {"head": (0, 0, 0.18), "hand": (0, -0.01, -0.08), "toes": (0, -0.07, 0)}
CAMEL = {"hips": "Hips", "spine": "Spine", "chest": "Chest", "neck": "Neck", "head": "Head", "shoulder": "Shoulder", "upper-arm": "Arm",
         "lower-arm": "ForeArm", "hand": "Hand", "upper-leg": "UpLeg", "lower-leg": "Leg", "foot": "Foot", "toes": "ToeBase"}
PLANTED = 0.6                       # share of the cycle a foot is planted
SWING_HEIGHT, BOB, SWAY, DROP, ARM_SWING = 0.08, 0.015, 0.02, 0.15, 18.0


def bone_name(landmark, names):
    if names == "landmark":
        return landmark
    joint, _, side = landmark.partition(".")
    return ("Left" if side == "l" else "Right" if side == "r" else "") + CAMEL[joint]


def tail_of(landmark):
    joint, _, side = landmark.partition(".")
    child = CHILD.get(joint)
    if child:
        return Vector(J[child + ("." + side if side else "")])
    return Vector(J[landmark]) + Vector(TAIL[joint])


def build_rig(names, root_bone):
    arm_data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    if root_bone:
        r = arm_data.edit_bones.new("root"); r.head = (0, 0, 0); r.tail = (0, -0.2, 0); made["root"] = r
    for lm in PARENT:
        b = arm_data.edit_bones.new(bone_name(lm, names))
        b.head = J[lm]; b.tail = tail_of(lm)
        made[lm] = b
    for lm, parent in PARENT.items():
        if parent:
            made[lm].parent = made[parent]
        elif root_bone:
            made[lm].parent = made["root"]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def box(bm, lo, hi):
    return bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((Vector(lo) + Vector(hi)) / 2)
                                 @ Matrix.Diagonal((hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1)))["verts"]


def limb(bm, a, b, r):
    a, b = Vector(a), Vector(b)
    turn = Vector((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
    return bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=r, depth=(b - a).length,
                                 matrix=Matrix.Translation((a + b) / 2) @ turn)["verts"]


def build_mesh(arm, names):
    bm = bmesh.new()
    parts = []                                   # (bone, verts)
    for lm in PARENT:
        joint, _, side = lm.partition(".")
        p = Vector(J[lm])
        if joint == "foot":
            v = box(bm, (p.x - 0.045, -0.12, 0.0), (p.x + 0.045, 0.05, 0.10))
        elif joint == "toes":
            v = box(bm, (p.x - 0.045, -0.20, 0.0), (p.x + 0.045, -0.12, 0.04))
        elif joint == "head":
            v = box(bm, (-0.08, -0.09, 1.52), (0.08, 0.09, 1.72))
        elif joint in ("hips", "spine", "chest"):
            top = tail_of(lm).z
            v = box(bm, (-0.15, -0.09, p.z - (0.06 if joint == "hips" else 0)), (0.15, 0.09, top))
        elif joint == "hand":
            v = limb(bm, p, tail_of(lm), 0.035)
        else:
            v = limb(bm, p, tail_of(lm), {"neck": 0.05, "shoulder": 0.04, "upper-arm": 0.04, "lower-arm": 0.035,
                                          "upper-leg": 0.065, "lower-leg": 0.05}[joint])
        parts.append((bone_name(lm, names), v))
    index = {}
    bm.verts.index_update()
    for bone, verts in parts:
        index[bone] = [v.index for v in verts]
    mesh = bpy.data.meshes.new("Body"); bm.to_mesh(mesh); bm.free()
    ob = bpy.data.objects.new("Body", mesh); bpy.context.scene.collection.objects.link(ob)
    for bone, idx in index.items():
        ob.vertex_groups.new(name=bone).add(idx, 1.0, "REPLACE")
    ob.parent = arm
    ob.modifiers.new("Armature", "ARMATURE").object = arm
    mat = bpy.data.materials.new("Clay"); mat.diffuse_color = (0.72, 0.62, 0.52, 1.0); mesh.materials.append(mat)
    return ob


class Poser:
    def __init__(self, arm, names):
        self.arm, self.names = arm, names

    def pb(self, lm):
        return self.arm.pose.bones[bone_name(lm, self.names)]

    def joint(self, lm):
        return self.arm.matrix_world @ self.pb(lm).head

    def update(self):
        bpy.context.view_layer.update()

    def turn(self, lm, q):
        pb = self.pb(lm); M = pb.matrix.copy(); at = M.translation.copy()
        R = q.to_matrix().to_4x4() @ M.to_3x3().to_4x4(); R.translation = at
        pb.matrix = R; self.update()

    def aim(self, lm, child_point):
        now = (self.pb(lm).tail - self.pb(lm).head).normalized()
        q = now.rotation_difference((Vector(child_point) - self.pb(lm).head).normalized())
        if q.angle > 1e-9:
            self.turn(lm, q)

    def place(self, lm, location):
        pb = self.pb(lm); R = pb.bone.matrix_local.to_3x3().to_4x4(); R.translation = Vector(location)
        pb.matrix = R; self.update()

    def reset(self):
        for pb in self.arm.pose.bones:
            pb.matrix_basis.identity()
        self.update()

    def key(self, frame, lms=None):
        for pb in self.arm.pose.bones:
            if lms is None or pb.name in {bone_name(x, self.names) for x in lms}:
                pb.keyframe_insert("location", frame=frame); pb.keyframe_insert("rotation_quaternion", frame=frame)


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * x * (x * (6 * x - 15) + 10)        # no speed and no acceleration at either end


def foot_target(side, t, a):
    """Ankle position of one foot at time t: planted at a fixed spot for PLANTED of each cycle, then a swing."""
    T, v = a.period, a.speed
    offset = 0.0 if side == "l" else 0.5
    u = t / T - offset
    k = math.floor(u + 1e-9)
    psi = u - k
    sx = 1.0 if side == "l" else -1.0
    base = lambda n: v * (n + offset + PLANTED / 2) * T     # noqa: E731 - planted under the body at mid-stance
    drift = (a.slide * min(psi, PLANTED) / PLANTED) if (a.slide and side == "l" and k == 0) else 0.0
    if psi < PLANTED:
        fwd, z = base(k) + drift, 0.0
    else:
        s = (psi - PLANTED) / (1 - PLANTED)
        start = base(k) + (a.slide if (a.slide and side == "l" and k == 0) else 0.0)
        fwd, z = start + (base(k + 1) - start) * smooth(s), SWING_HEIGHT * (4 * s * (1 - s)) ** 3
    z -= a.sink if side == "r" else 0.0
    planted = psi <= PLANTED + 1e-9
    return Vector((sx * 0.09, 0, J["foot.l"][2] + z)) + FRONT * fwd, planted, psi


def hips_at(t, a):
    phi = (t / a.period) % 1.0
    return (Vector(J["hips"]) + FRONT * (a.speed * t) + Vector((SWAY * math.sin(2 * math.pi * phi), 0,
            -DROP + BOB * math.cos(4 * math.pi * phi)))), phi


def pose_frame(P, t, a):
    P.reset()
    hips, phi = hips_at(t, a)
    P.place("hips", hips)
    planted = {}
    for s in ("l", "r"):
        target, planted[s], _ = foot_target(s, t, a)
        H = P.joint("upper-leg." + s)
        l1 = (Vector(J["lower-leg." + s]) - Vector(J["upper-leg." + s])).length
        l2 = (Vector(J["foot." + s]) - Vector(J["lower-leg." + s])).length
        d = min((target - H).length, l1 + l2 - 1e-4)
        u = (target - H).normalized()
        along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        n = (FRONT - u * FRONT.dot(u)).normalized()
        knee = H + u * along + n * math.sqrt(max(0.0, l1 * l1 - along * along))
        P.aim("upper-leg." + s, knee)
        P.aim("lower-leg." + s, H + u * d)
        P.place("foot." + s, P.pb("lower-leg." + s).tail)
    for s, sign in (("l", 1.0), ("r", -1.0)):
        P.turn("upper-arm." + s, Quaternion((1, 0, 0), math.radians(sign * ARM_SWING * math.sin(2 * math.pi * phi))))
    return planted


def export(path, objects, animations):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path), export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=animations, export_animation_mode="ACTIONS", export_force_sampling=True,
                              export_optimize_animation_size=False, export_apply=False)


def main():
    p = argparse.ArgumentParser(prog="make_test_clip.py", description=__doc__.split("\n\n")[0])
    p.add_argument("out")
    p.add_argument("--names", choices=("landmark", "camel"), default="landmark"); p.add_argument("--root-bone", action="store_true")
    p.add_argument("--fps", type=float, default=30); p.add_argument("--period", type=float, default=1.0); p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--loop-end", choices=("open", "duplicate"), default="open")
    p.add_argument("--slide", type=float, default=0.0); p.add_argument("--sink", type=float, default=0.0)
    p.add_argument("--pop"); p.add_argument("--seam", type=float, default=0.0); p.add_argument("--step", action="append", default=[])
    p.add_argument("--name", default="walk"); p.add_argument("--poses", action="store_true")
    p.add_argument("--no-mesh", action="store_true")
    a = p.parse_args(jamanim.script_args(sys.argv))
    blend.require_version(lambda msg: sys.exit("error: " + msg))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    blend.gltf_rate(scene, a.fps)
    os.makedirs(a.out, exist_ok=True)
    arm = build_rig(a.names, a.root_bone)
    objects = [arm] if a.no_mesh else [arm, build_mesh(arm, a.names)]
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"

    export(os.path.join(a.out, "rig.glb"), objects, False)

    P = Poser(arm, a.names)
    n = int(round(a.period * a.fps))
    frames = n + (1 if a.loop_end == "duplicate" else 0)
    action = bpy.data.actions.new(a.name)
    arm.animation_data_create(); arm.animation_data.action = action
    planted = {"l": [], "r": []}
    for f in range(frames):
        scene.frame_set(f)
        flags = pose_frame(P, f / a.fps, a)
        P.key(f)
        for s in planted:
            planted[s].append(flags[s])

    truth = {"fps": a.fps, "frames": frames, "period": a.period, "speed": a.speed, "loopEnd": a.loop_end, "names": a.names,
             "rootBone": a.root_bone, "planted": {}, "faults": {}}
    for s in ("l", "r"):
        runs, start = [], None
        for f, flag in enumerate(planted[s] + [False]):
            if flag and start is None:
                start = f
            elif not flag and start is not None:
                runs.append([start, f - 1]); start = None
        truth["planted"]["foot." + s] = runs
    if a.slide:
        first = truth["planted"]["foot.l"][0]
        xs = [foot_target("l", f / a.fps, a)[0] for f in range(first[0], first[1] + 1)]
        truth["faults"]["slide"] = {"limb": "foot.l", "frames": first,
                                    "metres": max((p - q).length for p in xs for q in xs)}
    if a.sink:
        truth["faults"]["sink"] = {"limb": "foot.r", "metres": a.sink}
    offset = {}                                   # frame -> how far the whole body is moved (Blender frame)
    if a.pop:
        where, _, size = a.pop.partition(":")
        f = 0 if where == "start" else frames - 1
        offset[f] = offset.get(f, Vector()) + Vector((float(size), 0, 0))
        truth["faults"]["pop"] = {"at": where, "frame": f, "metres": float(size)}
    if a.seam:
        last = frames - 1
        half = last // 2
        for f in range(half, frames):
            offset[f] = offset.get(f, Vector()) + Vector((0, 0, a.seam * smooth((f - half) / (last - half))))
        truth["faults"]["seam"] = {"metres": a.seam, "from": half}
    for step in a.step:
        at, _, size = step.partition(":")
        for f in range(int(at), frames):
            offset[f] = offset.get(f, Vector()) + FRONT * float(size)
        truth["faults"].setdefault("steps", []).append({"frame": int(at), "metres": float(size)})
    for f in sorted(offset):
        scene.frame_set(f)
        P.reset(); pose_frame(P, f / a.fps, a)
        hips = P.pb("hips"); M = hips.matrix.copy(); M.translation += offset[f]; hips.matrix = M; P.update()
        P.key(f, ["hips"])

    scene.frame_start, scene.frame_end = 0, frames - 1
    for fc in _fcurves(action):
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
    export(os.path.join(a.out, "clip.glb"), objects, True)

    if a.poses:
        arm.animation_data.action = None
        for pose_name, f in (("contact", 0), ("passing", n // 4)):
            act = bpy.data.actions.new(pose_name)
            arm.animation_data.action = act
            scene.frame_set(f)
            P.reset(); pose_frame(P, f / a.fps, a); P.key(0)
            act.use_fake_user = True
        bpy.data.actions.remove(action)
        arm.animation_data.action = None
        export(os.path.join(a.out, "poses.glb"), objects, True)

    names = {bone_name(lm, a.names): lm for lm in PARENT}
    with open(os.path.join(a.out, "map.json"), "w", encoding="utf-8") as f:
        json.dump({"label": "make_test_clip.py figure, %s names" % a.names,
                   "notes": "The bones of the generated test figure%s." % (" under a ground-level root bone" if a.root_bone else ""),
                   "landmarks": names}, f, indent=1)
    with open(os.path.join(a.out, "truth.json"), "w", encoding="utf-8") as f:
        json.dump(truth, f, indent=1)
    print(json.dumps({"clip": os.path.join(a.out, "clip.glb"), "frames": frames, "faults": truth["faults"]}))


def _fcurves(action):
    if hasattr(action, "fcurves") and len(getattr(action, "fcurves", [])):
        return list(action.fcurves)
    out = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


if __name__ == "__main__":
    main()
