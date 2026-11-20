"""Write keyposes.glb: the project rig with one animation holding one key per named pose, at the times the clip spec
gives them. Runs in Blender.

    blender --background --python-exit-code 1 --python keyposes.py -- <rig.glb | rig.blend> <clip.json> <out-dir>
            [--poses <file.blend | file.glb>]

Each pose is an action (in a .blend) or an animation (in a .glb) named exactly as the pose is in the spec's
`keyPoses.poses`; its first frame is the pose. They come from --poses, else from the rig file itself (a .blend where the
person posed the rig and stored each pose as an action, such as a pose library). The poses must be on the project rig:
the same bone names, and the same rest pose within a millimetre. Each bone's pose is copied in the rig's own space,
parents first.

Writes <out-dir>/keyposes.glb (the animation is named "<spec id>-keyposes"; keys at whole frames of the spec's fps) and
keyposes.json, which lists each pose with its time, frame and the action it came from.
"""
import argparse
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamanim  # noqa: E402
from jamanim import report, spec as specs  # noqa: E402


def fail(msg):
    print("error: " + msg)
    sys.exit(1)


def parse(argv):
    p = argparse.ArgumentParser(prog="keyposes.py", description=__doc__.split("\n\n")[0])
    p.add_argument("rig"); p.add_argument("spec"); p.add_argument("out"); p.add_argument("--poses")
    return p.parse_args(argv)


def load_into_scene(path):
    """Objects added to the scene by loading `path`; actions it brings come along in bpy.data."""
    before = set(bpy.context.scene.objects)
    if path.lower().endswith(".blend"):
        with bpy.data.libraries.load(os.path.abspath(path), link=False) as (src, dst):
            dst.objects = list(src.objects); dst.actions = list(src.actions)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), disable_bone_shape=True)
    return [o for o in bpy.context.scene.objects if o not in before]


def the_armature(objects, path):
    arms = [o for o in objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        fail("%s holds %d armatures; one is expected" % (path, len(arms)))
    return arms[0]


def assign(ob, action):
    ad = ob.animation_data or ob.animation_data_create()
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    ad.action = action
    if action is not None and hasattr(ad, "action_slot") and ad.action_slot is None and len(getattr(action, "slots", [])):
        ad.action_slot = action.slots[0]


def in_order(arm):
    """Pose bones, every parent before its children."""
    out, todo = [], [b for b in arm.pose.bones if b.parent is None]
    while todo:
        b = todo.pop(0); out.append(b); todo.extend(b.children)
    return out


def main():
    a = parse(jamanim.script_args(sys.argv))
    try:
        s = specs.load(a.spec, check_files=False)
    except specs.SpecError as e:
        fail("the clip spec is not usable: %s" % e)
    if not s["keyPoses"]:
        fail("the clip spec lists no keyPoses")
    fps = float(s["fps"])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = int(round(fps)), int(round(fps)) / fps
    rig = the_armature(load_into_scene(a.rig), a.rig)
    source = the_armature(load_into_scene(a.poses), a.poses) if a.poses else rig

    names = {b.name for b in rig.data.bones}
    if source is not rig:
        other = {b.name for b in source.data.bones}
        if names != other:
            fail("the poses are on another skeleton: bones only on the rig: %s; only in the poses: %s"
                 % (", ".join(sorted(names - other)[:10]) or "none", ", ".join(sorted(other - names)[:10]) or "none"))
        moved = max((rig.matrix_world @ rig.data.bones[n].head_local - source.matrix_world @ source.data.bones[n].head_local).length for n in names)
        if moved > 1e-3:
            fail("the poses' rig rests elsewhere than the project rig (a joint %.4f m apart); pose the project rig itself" % moved)

    found = {}
    for pose in s["keyPoses"]["poses"]:
        act = bpy.data.actions.get(pose["name"])
        if act is None:
            matches = [x for x in bpy.data.actions if x.name.split("_")[0] == pose["name"] or x.name.startswith(pose["name"] + ".")]
            act = matches[0] if len(matches) == 1 else None
        found[pose["name"]] = act
    missing = [n for n, act in found.items() if act is None]
    if missing:
        fail("no action or animation named %s in %s (it has: %s)" % (", ".join(missing), a.poses or a.rig,
                                                                      ", ".join(x.name for x in bpy.data.actions) or "none"))

    # read each pose off the source, in the rig's own space
    captured = {}
    for pose in s["keyPoses"]["poses"]:
        act = found[pose["name"]]
        assign(source, act)
        scene.frame_set(int(round(act.frame_range[0])))
        captured[pose["name"]] = {pb.name: pb.matrix.copy() for pb in source.pose.bones}
    if source is not rig:
        assign(source, None)

    out_action = bpy.data.actions.new("%s-keyposes" % s["id"])
    assign(rig, out_action)
    order = in_order(rig)
    rows = []
    for pose in s["keyPoses"]["poses"]:
        frame = specs.frame_of(pose["time"], fps)
        for pb in rig.pose.bones:
            pb.matrix_basis.identity()
        for pb in order:
            pb.matrix = captured[pose["name"]][pb.name]
            bpy.context.view_layer.update()
        for pb in rig.pose.bones:
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion" if pb.rotation_mode == "QUATERNION" else "rotation_euler", frame=frame)
            pb.keyframe_insert("scale", frame=frame)
        rows.append({"name": pose["name"], "time": pose["time"], "frame": frame, "from": found[pose["name"]].name})
        if abs(pose["time"] * fps - frame) > 1e-6:
            print("note: %s at %g s falls between frames at %g fps; keyed on frame %d (%g s)" % (pose["name"], pose["time"], fps, frame, frame / fps),
                  file=sys.stderr)
    frames = [r["frame"] for r in rows]
    if len(set(frames)) != len(frames):
        fail("two poses fall on one frame at %s fps: %s" % (fps, ", ".join("%s@%d" % (r["name"], r["frame"]) for r in rows)))

    for act in [x for x in bpy.data.actions if x != out_action]:
        bpy.data.actions.remove(act)
    if source is not rig:
        for ob in [source] + list(source.children):
            bpy.data.objects.remove(ob)
    scene.frame_start, scene.frame_end = min(frames), max(frames)
    os.makedirs(a.out, exist_ok=True)
    out_glb = os.path.join(a.out, "keyposes.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(out_glb), export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=False,
                              export_optimize_animation_size=False, export_apply=False)
    manifest = {"tool": "jam-3d-animate keyposes.py " + jamanim.VERSION, "blender": bpy.app.version_string,
                "rig": report.stamp("rig", a.rig), "spec": report.stamp("spec", a.spec),
                "poses-from": report.stamp("poses", a.poses) if a.poses else None,
                "animation": out_action.name, "fps": fps, "poses": rows, "output": report.stamp("keyposes", out_glb)}
    report.write(os.path.join(a.out, "keyposes.json"), manifest)
    print(json.dumps({"keyposes": out_glb.replace(os.sep, "/"), "animation": out_action.name, "poses": rows}))


if __name__ == "__main__":
    main()
