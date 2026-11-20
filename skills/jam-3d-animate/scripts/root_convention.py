"""Put a clip's travel where its clip spec says: removed (in-place) or on the root (root-motion). Runs in Blender.

    blender --background --python-exit-code 1 --python root_convention.py -- <clip.glb> <clip.json> <out-dir>
            [--animation <name>] [--travel line|hips] [--loop-end auto|open|duplicate] [--name <file name without .glb>]

Travel is read from the hips' ground projection, in one of two ways (jamanim/travel.py):
    line   a constant velocity from the first frame's position to the last's: sway, and a speed that varies inside
           the clip, stay on the hips (the usual choice for cycles)
    hips   exactly the hips' ground projection: the hips keep no horizontal motion of their own (for clips whose speed
           changes, such as starts and stops, when the root must follow the body closely)

    in-place      the travel is taken off the hips; every bone above the hips is held at its rest pose. Height, bob,
                  sway and turning stay.
    root-motion   with root.bone: that bone carries the travel (translation only, from its rest pose) and the hips keep
                  the rest, so every joint stays where it was in the world. Without root.bone: the travel stays on the
                  hips and any bone above them is held at rest.

Writes <out-dir>/<name>.glb (default: the clip's name with -in-place or -root-motion), the same rig with only this
animation, sampled on every frame, and travel.json: the travel per frame (glTF x and z, metres, from the first frame),
which clip_check.py --travel gives back to an in-place clip when it measures contacts, with the hips' ground travel,
sway and height range before and after.
"""
import argparse
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamanim  # noqa: E402
from jamanim import gltf, measure, report, skelmap, spec as specs, travel as trav  # noqa: E402


def fail(msg):
    print("error: " + msg)
    sys.exit(1)


def parse(argv):
    p = argparse.ArgumentParser(prog="root_convention.py", description=__doc__.split("\n\n")[0])
    p.add_argument("clip"); p.add_argument("spec"); p.add_argument("out")
    p.add_argument("--animation"); p.add_argument("--travel", choices=trav.MODES, default="line"); p.add_argument("--name")
    p.add_argument("--loop-end", choices=("auto", "open", "duplicate"), default="auto")
    return p.parse_args(argv)


def bags(action):
    """Every container of F-curves in an action: the action itself (older Blender) or its channel bags."""
    out = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                out.extend(strip.channelbags)
    if not out and hasattr(action, "fcurves"):
        out.append(action)
    return out


def drop_curves(action, bones):
    for bag in bags(action):
        for fc in list(bag.fcurves):
            if any(fc.data_path.startswith('pose.bones["%s"]' % b) for b in bones):
                bag.fcurves.remove(fc)


def ground_facts(g, along):
    """g [F, 2] (glTF x, z) -> net travel, and the spread along and across a direction (the clip's travel)."""
    n = np.linalg.norm(g[-1] - g[0])
    across = np.array([-along[1], along[0]])
    rel = g - g[0]
    return {"netTravel": report.mm(n), "alongRange": report.mm(np.ptp(rel @ along)), "acrossRange": report.mm(np.ptp(rel @ across))}


def main():
    a = parse(jamanim.script_args(sys.argv))
    try:
        s = specs.load(a.spec)
        smap = skelmap.load(s["rig"]["map"])
        g = gltf.Gltf(a.clip)
        _, anim = g.animation(a.animation)
    except (specs.SpecError, skelmap.MapError, gltf.GltfError) as e:
        fail(str(e))
    name = anim.get("name") or a.animation
    fps = float(s["fps"])
    mode, root_name = s["root"]["mode"], s["root"]["bone"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = int(round(fps)), int(round(fps)) / fps
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.clip), disable_bone_shape=True)
    arms = [o for o in scene.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        fail("%s holds %d armatures; one is expected" % (a.clip, len(arms)))
    arm = arms[0]
    action = bpy.data.actions.get(name) or next((x for x in bpy.data.actions if x.name.startswith(name)), None)
    if action is None:
        fail("Blender did not import the animation %r" % name)
    ad = arm.animation_data or arm.animation_data_create()
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    ad.action = action
    if hasattr(ad, "action_slot") and ad.action_slot is None and len(getattr(action, "slots", [])):
        ad.action_slot = action.slots[0]
    for other in [x for x in bpy.data.actions if x != action]:
        bpy.data.actions.remove(other)

    try:
        at = skelmap.on_rig(smap, [b.name for b in arm.data.bones])
    except skelmap.MapError as e:
        fail(str(e))
    hips = arm.pose.bones[at["hips"]]
    above = []
    b = hips.parent
    while b is not None:
        above.append(b); b = b.parent
    if root_name and root_name not in [x.name for x in above]:
        fail("root.bone %r is not a bone above the hips (%s) in this rig; bones above the hips: %s"
             % (root_name, hips.name, ", ".join(x.name for x in above) or "none"))
    root = arm.pose.bones[root_name] if root_name else None

    f0, f1 = (int(round(x)) for x in action.frame_range)
    frames = f1 - f0 + 1
    W = arm.matrix_world.copy(); Wi = W.inverted()
    world, joints = [], []
    body = [hips] + [arm.pose.bones[x.name] for x in hips.bone.children_recursive]
    for f in range(frames):
        scene.frame_set(f0 + f)
        world.append(W @ hips.matrix)
        joints.append([tuple(W @ pb.head) for pb in body] + [tuple(W @ pb.tail) for pb in body])
    hips_xyz = np.array([[M.translation.x, M.translation.y, M.translation.z] for M in world])
    ground = np.stack([hips_xyz[:, 0], -hips_xyz[:, 1]], axis=1)          # glTF x, z
    loop_end = None
    if s["loop"]:
        loop_end = a.loop_end
        if loop_end == "auto":       # from the spec's length, else the poses relative to the hips' ground position
            rel = np.array(joints); rel[:, :, 0] -= hips_xyz[:, None, 0]; rel[:, :, 1] -= hips_xyz[:, None, 1]
            loop_end, _ = measure.loop_end(frames, fps, s["length"], rel)
    t = trav.curve(ground, a.travel, loop_end)
    shift = [Vector((dx, -dz, 0.0)) for dx, dz in t]                       # back to Blender's frame

    drop_curves(action, [hips.name] + [x.name for x in above])
    for f in range(frames):
        for x in reversed(above):
            x.matrix_basis.identity()
        bpy.context.view_layer.update()
        if root is not None:
            M = root.bone.matrix_local.copy(); M.translation = M.translation + Wi.to_3x3() @ shift[f]
            root.matrix = M
            bpy.context.view_layer.update()
        target = world[f] if mode == "root-motion" else Matrix.Translation(-shift[f]) @ world[f]
        hips.matrix = Wi @ target
        bpy.context.view_layer.update()
        for x in [hips] + above:
            x.keyframe_insert("location", frame=f0 + f)
            x.keyframe_insert("rotation_quaternion" if x.rotation_mode == "QUATERNION" else "rotation_euler", frame=f0 + f)
            x.keyframe_insert("scale", frame=f0 + f)

    after, root_after = [], []
    for f in range(frames):
        scene.frame_set(f0 + f)
        M = W @ hips.matrix
        after.append([M.translation.x, M.translation.y, M.translation.z])
        if root is not None:
            r = W @ root.head
            root_after.append([r.x, -r.y])
    after = np.array(after)

    os.makedirs(a.out, exist_ok=True)
    stem = a.name or "%s-%s" % (os.path.splitext(os.path.basename(a.clip))[0], mode)
    out_glb = os.path.join(a.out, stem + ".glb")
    scene.frame_start, scene.frame_end = f0, f1
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(out_glb), export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
                              export_optimize_animation_size=False, export_apply=False)
    on = "removed" if mode == "in-place" else (root_name or hips.name)
    travel_path = os.path.join(a.out, "travel.json")
    trav.write(travel_path, fps, a.travel, mode, t, loop_end)
    with open(travel_path, encoding="utf-8") as fh:
        doc = json.load(fh)
    after_ground = np.stack([after[:, 0], -after[:, 1]], axis=1)
    net = t[-1] - t[0]
    along = net / np.linalg.norm(net) if np.linalg.norm(net) > 1e-9 else np.array([0.0, 1.0])
    doc.update({"tool": "jam-3d-animate root_convention.py " + jamanim.VERSION, "clip": report.stamp("clip", a.clip),
                "output": report.stamp("clip", out_glb), "animation": name, "travelOn": on,
                "hips": {"bone": hips.name,
                         "before": dict(ground_facts(ground, along), heightRange=report.mm(np.ptp(hips_xyz[:, 2]))),
                         "after": dict(ground_facts(after_ground, along), heightRange=report.mm(np.ptp(after[:, 2])))}})
    if root is not None:
        doc["hips"]["overRoot"] = ground_facts(after_ground - np.array(root_after), along)
        doc["hips"]["overRoot"]["note"] = "the hips' ground position relative to the root bone: what stayed on the hips"
    report.write(travel_path, doc)
    print(json.dumps({"clip": out_glb.replace(os.sep, "/"), "travel": travel_path.replace(os.sep, "/"), "travelOn": on,
                      "hips": doc["hips"]}))


if __name__ == "__main__":
    main()
