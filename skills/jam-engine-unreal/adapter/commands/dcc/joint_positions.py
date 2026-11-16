"""World positions of key joints at frames of a reference animation played on the rigged character in Blender, in Unreal's units and axes
(centimetres; Unreal X = Blender X, Unreal Y = -Blender Y, Z up), for comparison with the same evaluation in Unreal. Runs in Blender.

blender --background --python-exit-code 1 --python joint_positions.py -- <rigged.blend> <anim.fbx> <frames> <out.json> --bones <a,b,c> [--armature root]
<frames> are Blender frame numbers, comma-separated; the output is keyed by engine frame (Blender frame minus 1).
"""
import bpy, sys, json
args = sys.argv[sys.argv.index("--") + 1:]
def option(flag, default=None):
    if flag in args:
        i = args.index(flag); value = args[i + 1]; del args[i:i + 2]
        return value
    return default
armature_name = option("--armature", "root"); bones = option("--bones")
if not bones: raise SystemExit("--bones <comma-separated bone names> is required (the adapter's skeleton facts list them as poseBones)")
BONES = [b for b in bones.split(",") if b]
blend, anim, frames, out = args[:4]
bpy.ops.wm.open_mainfile(filepath=blend); arm = bpy.data.objects[armature_name]; s = bpy.context.scene
before = set(bpy.data.objects); bpy.ops.import_scene.fbx(filepath=anim, automatic_bone_orientation=False, ignore_leaf_bones=False)
src = next(o for o in bpy.data.objects if o not in before and o.type == "ARMATURE"); act = src.animation_data.action; k = src.matrix_world.to_scale()[0]
bags = [act] if getattr(act, "fcurves", None) else [cb for layer in act.layers for strip in layer.strips for cb in strip.channelbags]
for bag in bags:
    for fc in [f for f in bag.fcurves if not f.data_path.startswith("pose.bones")]: bag.fcurves.remove(fc)
    for fc in bag.fcurves:
        if fc.data_path.endswith("location"):
            for kp in fc.keyframe_points: kp.co.y *= k; kp.handle_left.y *= k; kp.handle_right.y *= k
            fc.update()
arm.animation_data_create(); arm.animation_data.action = act
if hasattr(arm.animation_data, "action_slot") and act.slots: arm.animation_data.action_slot = act.slots[0]
res = {}
for f in [int(x) for x in frames.split(",")]:
    s.frame_set(f); bpy.context.view_layer.update()
    res[str(f - 1)] = {b: [round(v, 2) for v in (lambda p: (p.x * 100, -p.y * 100, p.z * 100))(arm.matrix_world @ arm.pose.bones[b].head)] for b in BONES}
json.dump(res, open(out, "w"), indent=1); print(json.dumps(res)[:300])
