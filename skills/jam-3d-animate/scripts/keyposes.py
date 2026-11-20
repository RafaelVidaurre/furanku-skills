"""Write the key-pose file the clip spec names (`keyPoses.file`): the project rig (`rig.model`) with one animation
holding one key per named pose, at the times the spec gives them, and a pose sheet that shows each pose for the person
to accept. Runs in Blender, from the project root.

    blender --background --python-exit-code 1 --python keyposes.py -- <clip.json> [--poses <file.blend | file.glb>]
            [--view side|front|three-quarter|back] [--size 320x400] [--engine workbench|cycles]

Each pose is an action (in a .blend) or an animation (in a .glb) named exactly as the pose is in the spec's
`keyPoses.poses`; its first frame is the pose. They come from --poses (a .blend where the person posed the rig and kept
each pose as an action, such as a pose library, or a .glb), else from rig.model itself. The poses must be on the
project rig: the same bone names, and the same rest pose within a millimetre in the world. Each bone's pose is
carried over as its motion from rest in the world, parents first, so a source armature whose object is scaled or turned
(a rig kept in centimetres under a 0.01 scale) gives the same pose.

Writes keyPoses.file (the animation is named "<spec id>-keyposes"; keys at whole frames of the spec's fps); beside it
with the extension .json, a manifest listing each pose with its time, frame and the action it came from; and beside it
as <name>-sheet.png, one still of the rig per pose, stamped with the pose's name and frame (tiles in <name>-sheet/).
"""
import argparse
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamanim  # noqa: E402
from jamanim import blend, report, spec as specs  # noqa: E402


def fail(msg):
    print("error: " + msg)
    sys.exit(1)


def parse(argv):
    p = argparse.ArgumentParser(prog="keyposes.py", description=__doc__.split("\n\n")[0])
    p.add_argument("spec"); p.add_argument("--poses")
    p.add_argument("--view", choices=("side", "front", "three-quarter", "back"), default="side")
    p.add_argument("--size", default="320x400"); p.add_argument("--engine", choices=("workbench", "cycles"), default="workbench")
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
    bpy.context.view_layer.update()             # world matrices from the objects' own transforms
    return [o for o in bpy.context.scene.objects if o not in before]


def the_armature(objects, path):
    arms = [o for o in objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        fail("%s holds %d armatures; one is expected" % (path, len(arms)))
    return arms[0]


def in_order(arm):
    """Pose bones, every parent before its children."""
    out, todo = [], [b for b in arm.pose.bones if b.parent is None]
    while todo:
        b = todo.pop(0); out.append(b); todo.extend(b.children)
    return out


def pose_sheet(scene, rig, rig_objects, rows, out_glb, a):
    """One still per pose, stamped with its name and frame, over a ground at the rig's lowest point at rest."""
    W = rig.matrix_world
    meshes = [o for o in rig_objects if o.type == "MESH"]
    rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    heights = [(W @ pb.head).z for pb in rig.pose.bones] + [(W @ pb.tail).z for pb in rig.pose.bones]
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        heights += [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    ground, top_rest = min(heights), max(heights)
    rig.data.pose_position = "POSE"; bpy.context.view_layer.update()
    last = max(r["frame"] for r in rows)
    track, xs, ys, top = [], [], [], top_rest
    for f in range(last + 1):
        scene.frame_set(f)
        heads = [W @ pb.head for pb in rig.pose.bones] + [W @ pb.tail for pb in rig.pose.bones]
        root = W @ next(pb for pb in rig.pose.bones if pb.parent is None).head
        track.append((root.x, root.y))
        xs += [p.x for p in heads]; ys += [p.y for p in heads]; top = max([top] + [p.z for p in heads])
    height = top_rest - ground
    size = blend.stage(scene, track, ground, height, top, ((min(xs), min(ys)), (max(xs), max(ys))), a, last + 1, 0, [])
    stem = os.path.splitext(os.path.basename(out_glb))[0] + "-sheet"
    sheet, _ = blend.render_sheet(scene, os.path.dirname(os.path.abspath(out_glb)), 0, [r["frame"] for r in rows], size,
                                  labels=["%s (%.3g s)" % (r["name"], r["time"]) for r in rows], name=stem)
    return os.path.join(os.path.dirname(out_glb), stem + ".png")


def main():
    a = parse(jamanim.script_args(sys.argv))
    blend.require_version(fail)
    try:
        s = specs.load(a.spec)
    except specs.SpecError as e:
        fail("the clip spec is not usable: %s" % e)
    if not s["keyPoses"]:
        fail("the clip spec lists no keyPoses")
    fps = float(s["fps"])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    blend.gltf_rate(scene, fps)
    rig_path = s["rig"]["model"]
    rig_objects = load_into_scene(rig_path)
    rig = the_armature(rig_objects, rig_path)
    pose_objects = load_into_scene(a.poses) if a.poses else []
    source = the_armature(pose_objects, a.poses) if a.poses else rig

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
        fail("no action or animation named %s in %s (it has: %s)" % (", ".join(missing), a.poses or rig_path,
                                                                      ", ".join(x.name for x in bpy.data.actions) or "none"))

    # read each pose off the source as each bone's motion from its rest, in the world
    captured = {}
    S = source.matrix_world
    for pose in s["keyPoses"]["poses"]:
        act = found[pose["name"]]
        blend.assign(source, act)
        scene.frame_set(int(round(act.frame_range[0])))
        captured[pose["name"]] = {pb.name: (S @ pb.matrix) @ (S @ pb.bone.matrix_local).inverted() for pb in source.pose.bones}
    if source is not rig:
        blend.assign(source, None)

    out_action = bpy.data.actions.new("%s-keyposes" % s["id"])
    blend.assign(rig, out_action)
    order = in_order(rig)
    R = rig.matrix_world.copy(); R_inv = R.inverted()
    rows = []
    for pose in s["keyPoses"]["poses"]:
        frame = specs.frame_of(pose["time"], fps)
        for pb in rig.pose.bones:
            pb.matrix_basis.identity()
        for pb in order:
            pb.matrix = R_inv @ captured[pose["name"]][pb.name] @ R @ pb.bone.matrix_local
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
    for ob in pose_objects:                     # whatever else the poses file held (bone shapes, props) stays out
        bpy.data.objects.remove(ob)
    scene.frame_start, scene.frame_end = min(frames), max(frames)
    out_glb = s["keyPoses"]["file"]
    os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in rig_objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(out_glb), export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=False,
                              export_optimize_animation_size=False, export_apply=False)
    sheet = pose_sheet(scene, rig, rig_objects, rows, out_glb, a)
    manifest = {"tool": "jam-3d-animate keyposes.py " + jamanim.VERSION, "blender": bpy.app.version_string,
                "rig": report.stamp("rig", rig_path), "spec": report.stamp("spec", a.spec),
                "poses-from": report.stamp("poses", a.poses) if a.poses else None,
                "animation": out_action.name, "fps": fps, "poses": rows, "output": report.stamp("keyposes", out_glb),
                "sheet": dict(report.stamp("sheet", sheet), view=a.view)}
    manifest_path = os.path.splitext(out_glb)[0] + ".json"
    report.write(manifest_path, manifest)
    print(json.dumps({"keyposes": out_glb.replace(os.sep, "/"), "manifest": manifest_path.replace(os.sep, "/"), "sheet": sheet.replace(os.sep, "/"),
                      "animation": out_action.name, "poses": rows}))


if __name__ == "__main__":
    main()
