"""Render a strip of stills of a clip, side by side, to look at the motion. Runs in Blender.

    blender --background --python-exit-code 1 --python clip_strip.py -- <clip.glb> <strip.png> [--every 7] [--view side|front]

Each still shows the skinned figure at one frame (every `--every` frames, plus the last), its travel removed so the
stills stand in a row; side views the character's left side as it starts (it faces +Z in the glTF frame), front its
front. Prints the frames drawn.
"""
import argparse
import json
import sys

import bpy
from mathutils import Matrix, Vector

SPACING = 0.8


def main(argv):
    parser = argparse.ArgumentParser(prog="clip_strip.py", description=__doc__.splitlines()[0])
    parser.add_argument("clip")
    parser.add_argument("out")
    parser.add_argument("--every", type=int, default=7)
    parser.add_argument("--view", choices=("side", "front"), default="side")
    args = parser.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = 30, 1.0
    bpy.ops.import_scene.gltf(filepath=args.clip)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    skinned = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == arm]
    if not skinned or not arm.animation_data or not arm.animation_data.action:
        raise SystemExit("the clip needs an animated armature with a skinned mesh")
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.hide_render = True
    start, end = (int(round(f)) for f in arm.animation_data.action.frame_range)
    frames = list(range(start, end + 1, max(1, args.every)))
    if frames[-1] != end:
        frames.append(end)
    root = next(pb for pb in arm.pose.bones if pb.parent is None)
    # Blender's frame: the character faces -Y. Side view looks along -X and spreads stills along Y; front along +Y.
    spread = Vector((0, 1, 0)) if args.view == "side" else Vector((1, 0, 0))
    for k, f in enumerate(frames):
        scene.frame_set(f)
        hips = arm.matrix_world @ root.head
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for o in skinned:
            mesh = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph))
            still = bpy.data.objects.new(f"{o.name}-{f}", mesh)
            still.matrix_world = Matrix.Translation(Vector((-hips.x, -hips.y, 0)) + spread * (k * SPACING)) @ o.matrix_world
            scene.collection.objects.link(still)
    width = len(frames) * SPACING + 0.6
    cam = bpy.data.objects.new("strip-camera", bpy.data.cameras.new("strip-camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type, cam.data.ortho_scale = "ORTHO", width
    middle = spread * ((len(frames) - 1) * SPACING / 2)
    if args.view == "side":
        cam.location, cam.rotation_euler = middle + Vector((8, 0, 0.9)), (1.5708, 0, 1.5708)
    else:
        cam.location, cam.rotation_euler = middle + Vector((0, -8, 0.9)), (1.5708, 0, 0)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = max(200, int(1800 * 2.2 / width))
    scene.render.filepath = args.out
    bpy.ops.render.render(write_still=True)
    print(json.dumps({"strip": args.out, "frames": frames}))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
