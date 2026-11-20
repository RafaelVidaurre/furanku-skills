"""Convert a BVH motion file to a .glb that retarget.py reads. Runs in Blender, through its own BVH importer and glTF
exporter.

    blender --background --python-exit-code 1 --python bvh_to_glb.py -- <motion.bvh> <out.glb>
            [--scale 1.0] [--forward -Z] [--up Y] [--name <animation name>]

BVH declares neither units nor axes. --scale turns the file's units into metres (0.01 for centimetres); --forward and
--up name the file's axes that point where the character faces and up, as Blender's BVH importer takes them (the
defaults read a file that is +Y up with the character facing +Z; write a negative axis as --forward=-Z). When
retarget.py then says the character faces -Z, flip the sign of --forward. The skeleton in the BVH header becomes the
rest pose, every frame is kept at the file's own frame rate with the first at time 0, and the animation is named --name
(default: the file's name without its extension). Writes a skeleton without a mesh. Prints one JSON object: the output,
the animation, frames, frame rate and the skeleton's height above its lowest joint in metres, for a check of --scale.
"""
import argparse
import json
import os
import sys

import bpy

AXES = ("X", "Y", "Z", "-X", "-Y", "-Z")


def main():
    p = argparse.ArgumentParser(prog="bvh_to_glb.py", description=__doc__.split("\n\n")[0])
    p.add_argument("bvh"); p.add_argument("out")
    p.add_argument("--scale", type=float, default=1.0)
    p.add_argument("--forward", choices=AXES, default="-Z"); p.add_argument("--up", choices=AXES, default="Y")
    p.add_argument("--name")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if a.forward.strip("-") == a.up.strip("-"):
        p.error("--forward and --up must be different axes")
    name = a.name or os.path.splitext(os.path.basename(a.bvh))[0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_anim.bvh(filepath=os.path.abspath(a.bvh), global_scale=a.scale, axis_forward=a.forward, axis_up=a.up,
                            frame_start=0, use_fps_scale=False, update_scene_fps=True, update_scene_duration=True, rotate_mode="NATIVE")
    arm = next((o for o in scene.objects if o.type == "ARMATURE"), None)
    if arm is None or not arm.animation_data or not arm.animation_data.action:
        raise SystemExit("error: %s gave no animated skeleton" % a.bvh)
    action = arm.animation_data.action
    action.name = name
    first, last = (int(round(v)) for v in action.frame_range)
    scene.frame_start, scene.frame_end = first, last
    lowest = min((arm.matrix_world @ b.head_local).z for b in arm.data.bones)
    highest = max((arm.matrix_world @ b.head_local).z for b in arm.data.bones)
    bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_force_sampling=True, export_frame_range=True,
                              export_animation_mode="ACTIONS", export_anim_slide_to_zero=True, export_optimize_animation_size=False)
    fps = scene.render.fps / scene.render.fps_base
    print(json.dumps({"model": a.out.replace(os.sep, "/"), "animation": name, "frames": last - first + 1, "fps": fps,
                      "skeletonHeightMeters": round(highest - lowest, 4)}))


if __name__ == "__main__":
    main()
