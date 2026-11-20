"""Convert a BVH or FBX motion file to a .glb that retarget.py reads. Runs in Blender, through its own BVH or FBX
importer and its glTF exporter.

    blender --background --python-exit-code 1 --python clip_to_glb.py -- <motion.bvh|motion.fbx> <out.glb>
            --up <axis> --facing <axis> --scale <metres per file unit> [--name <animation>] [--armature <name>]
            [--ignore-declared]

Axes are X, Y, Z, -X, -Y or -Z, of the file's own coordinates: --up is the axis the character stands along, --facing
the axis it looks along at rest (a negative axis is written --facing=-Z). --scale turns the file's units into metres
(0.01 for centimetres). All three are required: a BVH file states none of them, and an FBX file's own statement is
checked against them, not taken on trust. An FBX file that declares another up axis or unit than the flags is refused,
since one of the two is wrong; pass --ignore-declared once you have confirmed the flags (the printed height is the
skeleton's real size, and retarget.py accepts the facing).

The file must hold exactly one skeleton (an FBX with several needs --armature <name>) and at least one animation. The
skeleton's rest pose is kept, every frame is kept at the file's own frame rate with the first at time 0, and nothing but
the skeleton is written. A BVH animation is named --name (default: the file's name without its extension); FBX takes
keep their names, or take --name when there is one. Prints one JSON object: the output, the animations, frames, frame
rate, what the file declares (FBX), and the skeleton's height above its lowest joint in metres, for a check of --scale.
"""
import argparse
import json
import os
import sys

import bpy

AXES = ("X", "Y", "Z", "-X", "-Y", "-Z")


def negate(axis):
    return axis[1:] if axis.startswith("-") else "-" + axis


def fail(message):
    print("error: " + message, file=sys.stderr)
    sys.exit(2)


def declared_fbx(path):
    """What an FBX file's GlobalSettings state: its up axis and front axis as Blender's importer reads them, and its
    unit in metres. None for a value the file does not state."""
    from io_scene_fbx import parse_fbx
    from io_scene_fbx.fbx_utils import RIGHT_HAND_AXES
    from io_scene_fbx.import_fbx import elem_find_first, elem_props_get_integer, elem_props_get_number
    try:
        root, _ = parse_fbx.parse(path)
    except Exception as e:                                   # the importer reads binary FBX only
        fail("%s cannot be read as a binary FBX file: %s" % (path, e))
    settings = elem_find_first(root, b"GlobalSettings")
    props = None if settings is None else elem_find_first(settings, b"Properties70")
    if props is None:
        return {"up": None, "front": None, "metresPerUnit": None}
    get = lambda key: elem_props_get_integer(props, key, None)
    keys = (b"UpAxis", b"UpAxisSign", b"FrontAxis", b"FrontAxisSign", b"CoordAxis", b"CoordAxisSign")
    values = [get(k) for k in keys]
    up = front = None
    if None not in values:
        found = {v: k for k, v in RIGHT_HAND_AXES.items()}.get(((values[0], values[1]), (values[2], values[3]), (values[4], values[5])))
        if found:
            up, forward = found                           # Blender's names: the file axis that becomes its up and its +Y
            front = negate(forward)                       # a character facing the scene's front looks along -forward
    unit = elem_props_get_number(props, b"UnitScaleFactor", None)
    return {"up": up, "front": front, "metresPerUnit": None if unit is None else unit / 100.0}


def main():
    p = argparse.ArgumentParser(prog="clip_to_glb.py", description=__doc__.split("\n\n")[0])
    p.add_argument("motion"); p.add_argument("out")
    p.add_argument("--up", choices=AXES, required=True); p.add_argument("--facing", choices=AXES, required=True)
    p.add_argument("--scale", type=float, required=True)
    p.add_argument("--name"); p.add_argument("--armature")
    p.add_argument("--ignore-declared", action="store_true")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if a.facing.strip("-") == a.up.strip("-"):
        p.error("--facing and --up must be different axes")
    if a.scale <= 0:
        p.error("--scale must be positive")
    kind = os.path.splitext(a.motion)[1].lower()
    if kind not in (".bvh", ".fbx"):
        fail("%s: only .bvh and .fbx files are converted; export glTF from the tool that made any other format" % a.motion)
    path = os.path.abspath(a.motion)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # Blender's importers take the file axis that becomes Blender's +Y; a character faces Blender's -Y, which the
    # glTF exporter turns into +Z. So that axis is the opposite of the one the character faces.
    forward = negate(a.facing)
    declared = None
    if kind == ".bvh":
        bpy.ops.import_anim.bvh(filepath=path, global_scale=a.scale, axis_forward=forward, axis_up=a.up, frame_start=0,
                                use_fps_scale=False, update_scene_fps=True, update_scene_duration=True, rotate_mode="NATIVE")
    else:
        declared = declared_fbx(path)
        clash = []
        if declared["up"] is not None and declared["up"] != a.up:
            clash.append("its up axis is %s, not %s" % (declared["up"], a.up))
        if declared["metresPerUnit"] is not None and abs(declared["metresPerUnit"] - a.scale) > 1e-6 * a.scale:
            clash.append("its unit is %g m, not %g" % (declared["metresPerUnit"], a.scale))
        if clash and not a.ignore_declared:
            fail("%s declares that %s. Pass the declared values, or check which is right (the skeleton's printed height, "
                 "retarget.py's facing check) and pass --ignore-declared" % (a.motion, " and ".join(clash)))
        # The importer always multiplies by the file's own unit; divide it out so --scale alone sets the size.
        from io_scene_fbx.fbx_utils import units_blender_to_fbx_factor
        stated = (declared["metresPerUnit"] or 0.01) * 100.0 / units_blender_to_fbx_factor(scene)
        bpy.ops.import_scene.fbx(filepath=path, use_manual_orientation=True, axis_forward=forward, axis_up=a.up,
                                 global_scale=a.scale / stated, use_anim=True, anim_offset=0.0)
    arms = [o for o in scene.objects if o.type == "ARMATURE"]
    if a.armature:
        arms = [o for o in arms if o.name == a.armature]
    if len(arms) != 1:
        names = ", ".join(o.name for o in scene.objects if o.type == "ARMATURE") or "none"
        fail("%s: %s (skeletons in the file: %s)" % (a.motion, "no skeleton named %s" % a.armature if a.armature else
                                                    "the file must hold one skeleton; name it with --armature", names))
    arm = arms[0]
    if kind == ".bvh":
        actions = [arm.animation_data.action] if arm.animation_data and arm.animation_data.action else []
        prefix = ""
    else:                                                 # the FBX importer names a take's action "<object>|<take>"
        prefix = arm.name + "|"
        actions = [act for act in bpy.data.actions if act.name.startswith(prefix)]
    if not actions:
        fail("%s holds no animation on %s" % (a.motion, arm.name))
    if a.name and len(actions) > 1:
        fail("--name renames one animation; %s holds %d (%s)" % (a.motion, len(actions), ", ".join(act.name[len(prefix):] for act in actions)))
    for act in actions:
        act.name = a.name or (act.name[len(prefix):] if prefix else os.path.splitext(os.path.basename(a.motion))[0])
    first = min(act.frame_range[0] for act in actions); last = max(act.frame_range[1] for act in actions)
    scene.frame_start, scene.frame_end = int(round(first)), int(round(last))
    lowest = min((arm.matrix_world @ b.head_local).z for b in arm.data.bones)
    highest = max((arm.matrix_world @ b.head_local).z for b in arm.data.bones)
    bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_force_sampling=True, export_frame_range=False,
                              export_animation_mode="ACTIONS", export_anim_slide_to_zero=True, export_optimize_animation_size=False)
    fps = scene.render.fps / scene.render.fps_base
    print(json.dumps({"model": a.out.replace(os.sep, "/"), "animations": [{"name": act.name, "frames": int(round(act.frame_range[1] - act.frame_range[0])) + 1}
                                                                          for act in actions],
                      "fps": fps, "declared": declared, "applied": {"up": a.up, "facing": a.facing, "metresPerUnit": a.scale},
                      "skeletonHeightMeters": round(highest - lowest, 4)}))


if __name__ == "__main__":
    main()
