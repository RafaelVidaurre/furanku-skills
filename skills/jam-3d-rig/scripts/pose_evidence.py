"""Pose a rig made by bind.py through a fixed set of test poses and render one still of each. Runs in Blender.

    blender --background --python-exit-code 1 --python pose_evidence.py -- <rigged.glb | rigged.blend> <out-dir>
            [--report <rig-report.json> | --map <table.json> [--profile-id <id>]] [--poses rest,arms-raised,...]
            [--views pose|all] [--size 480x640] [--samples 16]

Poses are written in landmark terms (turn the bone at `upper-arm.l` until the arm points up), so they apply to any
humanoid skeleton. Which bone stands at which landmark comes from the report beside the model (rig-report.json, or
--report); for a rig made elsewhere, from --map: a bone-name table or skeleton profile, as landmarks_from_rig.py takes.
Bones are turned about world axes through their joints, whatever their own axes are.

    rest           as bound
    arms-raised    collarbones up a little, arms overhead
    arms-forward   arms straight ahead
    elbows-bent    forearms at a right angle, toward the front
    knee-bend      thighs forward 80 degrees, knees closed 110, feet flat and kept where they stood
    torso-twist    45 degrees about the spine, spread over the spine and chest bones
    head-turn      25 degrees on the neck and 40 on the head
    fingers-curled every finger joint closed to 70 degrees (only when the rig has finger bones)

Each pose is rendered from the one camera that shows it best (--views all adds front, back, left and three-quarter for
every pose). Cameras look along fixed directions and frame the posed character. Writes <pose>.png per still,
pose-sheet.png (all the default stills side by side) and pose-manifest.json: per pose the image, its SHA-256, the
largest edge stretch against the rest pose and how many edges stretched past double.
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamrig  # noqa: E402
from jamrig import landmarks as lm, report, skeleton  # noqa: E402

UP, FRONT, LEFT = Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((1, 0, 0))
VIEWS = {"front": Vector((0, -1, 0.05)), "back": Vector((0, 1, 0.05)), "left": Vector((1, 0, 0.05)),
         "three-quarter": Vector((0.7, -0.7, 0.25))}
POSES = [("rest", "front", "as bound"),
         ("arms-raised", "front", "collarbones up, arms overhead"),
         ("arms-forward", "three-quarter", "arms straight ahead"),
         ("elbows-bent", "three-quarter", "forearms at a right angle toward the front"),
         ("knee-bend", "three-quarter", "thighs forward 80 degrees, knees closed 110, feet kept in place"),
         ("torso-twist", "front", "45 degrees about the spine"),
         ("head-turn", "bust", "25 degrees on the neck, 40 on the head"),
         ("fingers-curled", "hand", "every finger joint closed to 70 degrees")]


def parse(argv):
    p = argparse.ArgumentParser(prog="pose_evidence.py", description=__doc__.split("\n\n")[0])
    p.add_argument("model"); p.add_argument("out")
    p.add_argument("--report"); p.add_argument("--map"); p.add_argument("--profile-id"); p.add_argument("--poses")
    p.add_argument("--views", choices=("pose", "all"), default="pose")
    p.add_argument("--size", default="480x640"); p.add_argument("--samples", type=int, default=16)
    return p.parse_args(argv)


class Rig:
    def __init__(self, arm, bones):
        self.arm = arm
        self.at = {b["landmark"]: b["name"] for b in bones if b["landmark"]}
        self.chain = {}                                   # landmark -> its bone and the in-between bones after it
        for b in bones:
            if b["deform"] and b["anchor"]:
                self.chain.setdefault(b["anchor"], []).append(b["name"])
        self.to_world = arm.matrix_world.copy()
        self.to_arm = arm.matrix_world.inverted().to_3x3()

    def has(self, *landmarks):
        return all(name in self.at for name in landmarks)

    def joint(self, landmark):
        return self.to_world @ self.arm.pose.bones[self.at[landmark]].head

    def turn_bone(self, bone, axis, degrees):
        """Turn one bone about a world axis through its joint."""
        pb = self.arm.pose.bones[bone]
        M = pb.matrix.copy(); at = M.translation.copy()
        q = Quaternion((self.to_arm @ Vector(axis)).normalized(), math.radians(degrees))
        R = q.to_matrix().to_4x4() @ M.to_3x3().to_4x4(); R.translation = at
        pb.matrix = R
        bpy.context.view_layer.update()

    def turn(self, landmark, axis, degrees):
        """Turn the bones of one body part, sharing the angle between them (a spine of five bones twists like one of two)."""
        bones = self.chain.get(landmark, [])
        for bone in bones:
            self.turn_bone(bone, axis, degrees / len(bones))

    def aim(self, landmark, direction):
        """Turn the bone at a landmark until it points along `direction` (toward the next joint of its limb)."""
        child = lm.main_child(landmark)
        if not self.has(landmark, child):
            return
        now = (self.joint(child) - self.joint(landmark)).normalized()
        q = now.rotation_difference(Vector(direction).normalized())
        if q.angle > 1e-6:
            self.turn_bone(self.at[landmark], q.axis, math.degrees(q.angle))

    def limb(self, landmark):
        return (self.joint(lm.main_child(landmark)) - self.joint(landmark)).normalized()

    def move(self, landmark, delta):
        pb = self.arm.pose.bones[self.at[landmark]]
        M = pb.matrix.copy(); M.translation = M.translation + self.to_arm @ Vector(delta)
        pb.matrix = M
        bpy.context.view_layer.update()

    def reset(self):
        for pb in self.arm.pose.bones:
            pb.matrix_basis.identity()
        bpy.context.view_layer.update()


def side_sign(side):
    return 1.0 if side == "l" else -1.0


def apply_pose(rig, pose):
    """Pose the rig; returns None, or the reason the pose does not apply to this rig."""
    if pose == "rest":
        return None
    if pose == "arms-raised":
        for s in lm.SIDES:
            if rig.has("shoulder." + s, "upper-arm." + s):
                rig.aim("shoulder." + s, rig.limb("shoulder." + s) + Vector((0, 0, 0.35)))
            rig.aim("upper-arm." + s, (side_sign(s) * math.sin(math.radians(20)), 0, math.cos(math.radians(20))))
    elif pose == "arms-forward":
        for s in lm.SIDES:
            rig.aim("upper-arm." + s, (side_sign(s) * 0.1, -1, 0))
    elif pose == "elbows-bent":
        for s in lm.SIDES:
            d = rig.limb("lower-arm." + s)
            toward = FRONT - d * d.dot(FRONT)
            if toward.length < 0.2:
                toward = UP - d * d.dot(UP)
            rig.aim("lower-arm." + s, toward)
    elif pose == "knee-bend":
        stood = {s: rig.joint("foot." + s) for s in lm.SIDES}
        for s in lm.SIDES:
            rig.turn_bone(rig.at["upper-leg." + s], LEFT, -80)
            rig.turn_bone(rig.at["lower-leg." + s], LEFT, 110)
            rig.turn_bone(rig.at["foot." + s], LEFT, -30)
        drop = sum(((stood[s] - rig.joint("foot." + s)) for s in lm.SIDES), Vector()) / 2
        rig.move("hips", drop)
    elif pose == "torso-twist":
        rig.turn("spine", UP, 22.5); rig.turn("chest", UP, 22.5)
    elif pose == "head-turn":
        rig.turn("neck", UP, 25); rig.turn("head", UP, 40)
    elif pose == "fingers-curled":
        done = 0
        for s in lm.SIDES:
            fingers = [f for f in lm.FINGER_NAMES[1:] if rig.has("%s-1.%s" % (f, s))]
            if len(fingers) >= 2:
                knuckles = (rig.joint("%s-1.%s" % (fingers[-1], s)) - rig.joint("%s-1.%s" % (fingers[0], s))).normalized()
                palm_side = Vector((-side_sign(s) * 0.5, 0, -1))
                for f in fingers:
                    j = [rig.joint("hand." + s)] + [rig.joint("%s-%d.%s" % (f, k, s)) for k in (1, 2, 3)]
                    seg = [(j[k + 1] - j[k]).normalized() for k in range(3)]
                    sign = 1.0 if knuckles.cross(seg[1]).dot(palm_side) > 0 else -1.0
                    # close each joint to 70 degrees from wherever the bind pose left it (a relaxed hand is part-curled)
                    bent = [math.degrees(seg[0].angle(seg[1])), math.degrees(seg[1].angle(seg[2]))]
                    for k, already in zip((1, 2, 3), (bent[0], bent[1], bent[1])):
                        rig.turn_bone(rig.at["%s-%d.%s" % (f, k, s)], knuckles, max(0.0, 70 - already) * sign)
                done += 1
            if rig.has("thumb-2." + s, "thumb-3." + s) and fingers:
                for k in (2, 3):
                    d = rig.limb("thumb-2." + s)
                    to_index = rig.joint("%s-1.%s" % (fingers[0], s)) - rig.joint("thumb-2." + s)
                    axis = d.cross(to_index)
                    if axis.length > 1e-6:
                        rig.turn_bone(rig.at["thumb-%d.%s" % (k, s)], axis.normalized(), 35)
        if not done:
            return "the rig has no finger bones"
    else:
        raise SystemExit("error: unknown pose %r (known: %s)" % (pose, ", ".join(p for p, _, _ in POSES)))
    return None


def posed_coords(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        ev = o.evaluated_get(dg)
        co = np.empty(len(ev.data.vertices) * 3); ev.data.vertices.foreach_get("co", co)
        M = np.array(ev.matrix_world)
        out.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
    return out


def edge_lengths(meshes, coords):
    out = []
    for o, co in zip(meshes, coords):
        ed = np.empty(len(o.data.edges) * 2, dtype=np.int64); o.data.edges.foreach_get("vertices", ed)
        ed = ed.reshape(-1, 2)
        out.append(np.linalg.norm(co[ed[:, 0]] - co[ed[:, 1]], axis=1))
    return np.concatenate(out)


def main():
    a = parse(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    width, height_px = (int(x) for x in a.size.lower().split("x"))
    report_path = a.map or a.report or os.path.join(os.path.dirname(a.model), "rig-report.json")
    if not os.path.isfile(report_path):
        raise SystemExit("error: no rig report at %s; pass --report <rig-report.json> written by bind.py for this model, or --map <bone-name "
                         "table or profile> for a rig made elsewhere" % report_path)
    with open(report_path, encoding="utf-8") as f:
        rig_report = json.load(f)
    if a.model.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.model))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.model))
    os.makedirs(a.out, exist_ok=True)
    scene = bpy.context.scene
    arms = [o for o in scene.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise SystemExit("error: %s holds %d armatures; one is expected" % (a.model, len(arms)))
    arm = arms[0]
    shapes = {pb.custom_shape for pb in arm.pose.bones if pb.custom_shape}
    for o in [o for o in scene.objects if o in shapes]:
        bpy.data.objects.remove(o)
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if a.map:
        doc = skeleton.load_profile(rig_report, a.profile_id) if a.profile_id or not any(k in rig_report for k in ("bones", "landmarks", "rig")) else rig_report
        bones = skeleton.describe_rig([(b.name, b.parent.name if b.parent else None) for b in arm.data.bones], lm.load_table(doc))
        lacking = [name for name in lm.CORE if name not in {b["landmark"] for b in bones}]
        if lacking:
            raise SystemExit("error: no bone of this rig maps to %s; the table does not fit it" % ", ".join(lacking))
    else:
        bones = rig_report["skeleton"]["bones"]
        absent = [b["name"] for b in bones if b["name"] not in arm.pose.bones]
        if absent:
            raise SystemExit("error: the report names bones this model lacks (%s); it belongs to another rig" % ", ".join(absent[:8]))
    rig = Rig(arm, bones)

    rest = posed_coords(meshes)
    rest_edges = edge_lengths(meshes, rest)
    allrest = np.concatenate(rest)
    H = float(allrest[:, 2].max() - allrest[:, 2].min())

    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("pose-evidence"); world.use_nodes = True; scene.world = world
    bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.5, 0.5, 0.5, 1); bg.inputs[1].default_value = 0.7
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.0; sun.rotation_euler = (0.9, 0.0, 0.5)
    scene.collection.objects.link(sun)
    cam_data = bpy.data.cameras.new("camera"); cam_data.type = "ORTHO"; cam_data.clip_start = 0.001; cam_data.clip_end = 100
    cam = bpy.data.objects.new("camera", cam_data); scene.collection.objects.link(cam); scene.camera = cam
    scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = a.samples; scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = width, height_px, 100
    scene.render.image_settings.file_format = "PNG"; scene.render.film_transparent = False

    def shoot(path, view, coords):
        P = np.concatenate(coords)
        if view == "bust":
            d = Vector((0.25, -1, 0.1)).normalized(); target = rig.joint("head") - Vector((0, 0, 0.05 * H)); scale = 0.5 * H
        elif view == "hand":
            # from the thumb side, along the knuckles, so the curl shows in profile
            side = "l" if rig.has("index-1.l") or not rig.has("index-1.r") else "r"
            tips = [rig.joint(k) for k in rig.at if lm.finger_of(k) and lm.split(k)[1] == side]
            target = sum(tips + [rig.joint("hand." + side)], Vector()) / (len(tips) + 1)
            first = [rig.joint("%s-1.%s" % (f, side)) for f in lm.FINGER_NAMES[1:] if rig.has("%s-1.%s" % (f, side))]
            d = (first[0] - first[-1]).normalized() if len(first) >= 2 else Vector((0.3 * side_sign(side), -1, 0.1))
            d = (d + Vector((0, -0.25, 0.15))).normalized(); scale = 0.16 * H
        else:
            d = VIEWS[view].normalized()
            right = d.cross(UP).normalized(); upward = right.cross(d).normalized()
            u, v = P @ np.array(right), P @ np.array(upward)
            cu, cv = (u.min() + u.max()) / 2, (v.min() + v.max()) / 2
            target = right * cu + upward * cv + d * float((P @ np.array(d)).mean())
            scale = max((u.max() - u.min()) * height_px / width, v.max() - v.min()) * 1.08
            scale = scale if width <= height_px else scale * width / height_px
        cam.location = target + d * (6 * H)
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = scale; cam_data.clip_end = 20 * H
        scene.render.filepath = os.path.abspath(path)
        bpy.ops.render.render(write_still=True)

    wanted = a.poses.split(",") if a.poses else [p for p, _, _ in POSES]
    known = {p: (view, what) for p, view, what in POSES}
    done, skipped, tiles = [], [], []
    for pose in wanted:
        if pose not in known:
            raise SystemExit("error: unknown pose %r (known: %s)" % (pose, ", ".join(known)))
        view, what = known[pose]
        rig.reset()
        why = apply_pose(rig, pose)
        if why:
            skipped.append({"id": pose, "reason": why}); continue
        coords = posed_coords(meshes)
        ratio = edge_lengths(meshes, coords) / np.maximum(rest_edges, 1e-9)
        entry = {"id": pose, "what": what, "maxEdgeStretch": round(float(ratio.max()), 3), "edgesStretchedPastDouble": int((ratio > 2.0).sum()),
                 "images": []}
        for v in ([view] + [x for x in VIEWS if x != view] if a.views == "all" else [view]):
            name = "%s.png" % pose if v == view else "%s-%s.png" % (pose, v)
            path = os.path.join(a.out, name)
            shoot(path, v, coords)
            entry["images"].append(dict(report.stamp("still", path), view=v))
            if v == view:
                tiles.append(path)
        done.append(entry)
    rig.reset()

    sheet = os.path.join(a.out, "pose-sheet.png")
    columns = min(4, len(tiles)) or 1
    rows = -(-len(tiles) // columns)
    canvas = np.zeros((rows * height_px, columns * width, 4), dtype=np.float32); canvas[..., 3] = 1.0; canvas[..., :3] = 0.5
    for k, path in enumerate(tiles):
        img = bpy.data.images.load(path)
        px = np.empty(width * height_px * 4, dtype=np.float32); img.pixels.foreach_get(px)
        r, c = k // columns, k % columns
        canvas[(rows - 1 - r) * height_px:(rows - r) * height_px, c * width:(c + 1) * width] = px.reshape(height_px, width, 4)
        bpy.data.images.remove(img)
    out_img = bpy.data.images.new("pose-sheet", columns * width, rows * height_px, alpha=False)
    out_img.pixels.foreach_set(canvas.reshape(-1)); out_img.filepath_raw = os.path.abspath(sheet); out_img.file_format = "PNG"; out_img.save()

    manifest = {"tool": "jam-3d-rig pose_evidence.py " + jamrig.VERSION, "blender": bpy.app.version_string,
                "rig": report.stamp("model", a.model), "report": report.stamp("map" if a.map else "report", report_path),
                "heightMeters": round(H, 4), "sheet": dict(report.stamp("sheet", sheet), order=[os.path.basename(t) for t in tiles], columns=columns),
                "poses": done, "skipped": skipped}
    out_manifest = os.path.join(a.out, "pose-manifest.json")
    report.write(out_manifest, manifest)
    print(json.dumps({"sheet": sheet.replace(os.sep, "/"), "manifest": out_manifest.replace(os.sep, "/"), "poses": [p["id"] for p in done],
                      "skipped": skipped, "worstEdgeStretch": max((p["maxEdgeStretch"] for p in done), default=1.0)}))


if __name__ == "__main__":
    main()
