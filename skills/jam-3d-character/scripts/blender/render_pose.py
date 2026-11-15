"""Render the rigged character in its bind pose, in test poses, or at frames of a Manny animation.

blender --background --python-exit-code 1 --python render_pose.py -- <rigged.blend> <out-dir> <label> [--anim file.fbx --frames 1,10,20] [--pose name]
Test poses turn bones about their own axes, as an animation would: 'curl' closes the fingers, 'reach' raises the arms and bends the elbows,
'crouch' bends hips and knees, 'look' turns the head.
"""
import bpy, sys, os, math
from mathutils import Vector, Quaternion, Matrix
argv = sys.argv[sys.argv.index("--") + 1:]
blend, out, label = argv[:3]
anim = argv[argv.index("--anim") + 1] if "--anim" in argv else None
frames = [int(x) for x in argv[argv.index("--frames") + 1].split(",")] if "--frames" in argv else [1]
pose = argv[argv.index("--pose") + 1] if "--pose" in argv else None
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(out, exist_ok=True)
arm = bpy.data.objects["root"]; s = bpy.context.scene
meshes = [o for o in s.objects if o.type == "MESH"]
# framing scales with the character's height in the bind pose (the rig is in metres, feet at 0)
H = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
if anim:
    before = set(bpy.data.objects); bpy.ops.import_scene.fbx(filepath=anim, automatic_bone_orientation=False, ignore_leaf_bones=False)
    src = next(o for o in bpy.data.objects if o not in before and o.type == "ARMATURE")
    act = src.animation_data.action
    # the animation was authored on a skeleton in centimetres; this rig is in metres, so translations shrink by the source's scale
    k = src.matrix_world.to_scale()[0]
    curves = list(act.fcurves) if getattr(act, "fcurves", None) else [fc for layer in act.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]
    bags = [act] if getattr(act, "fcurves", None) else [cb for layer in act.layers for strip in layer.strips for cb in strip.channelbags]
    for bag in bags:
        # curves on the armature object itself carry the source's 0.01 scale and axis turn: this rig has neither, so drop them
        for fc in [f for f in bag.fcurves if not f.data_path.startswith("pose.bones")]: bag.fcurves.remove(fc)
    curves = [fc for bag in bags for fc in bag.fcurves]
    for fc in curves:
        if fc.data_path.endswith("location"):
            for kp in fc.keyframe_points: kp.co.y *= k; kp.handle_left.y *= k; kp.handle_right.y *= k
            fc.update()
    print("ANIM", act.name, "curves", len(curves), "translation scale", round(k, 4), "frames", tuple(act.frame_range))
    arm.animation_data_create(); arm.animation_data.action = act
    if hasattr(arm.animation_data, "action_slot") and act.slots: arm.animation_data.action_slot = act.slots[0]
    for o in [x for x in bpy.data.objects if x not in before]: bpy.data.objects.remove(o)
def turn(bone, axis_world, degrees):
    pb = arm.pose.bones[bone]; M = pb.matrix.copy(); loc = M.translation.copy()
    R = Quaternion(Vector(axis_world).normalized(), math.radians(degrees)).to_matrix().to_4x4() @ M.to_3x3().to_4x4(); R.translation = loc
    pb.matrix_basis = arm.convert_space(pose_bone=pb, matrix=R, from_space="POSE", to_space="LOCAL"); bpy.context.view_layer.update()
def knuckle_axis(sfx):
    h = arm.pose.bones["hand" + sfx].head; return (arm.pose.bones["pinky_01" + sfx].head - arm.pose.bones["index_01" + sfx].head).normalized()
if pose == "curl":
    for sfx, sg in (("_l", 1), ("_r", -1)):
        ax = knuckle_axis(sfx)
        palm = ax.cross(arm.pose.bones["middle_01" + sfx].head - arm.pose.bones["hand" + sfx].head)
        for f in ("index", "middle", "ring", "pinky"):
            for k in ("01", "02", "03"):
                a0 = knuckle_axis(sfx); turn(f"{f}_{k}{sfx}", a0, 70 * sg)
        for k in ("02", "03"): turn(f"thumb_{k}{sfx}", arm.pose.bones["thumb_02" + sfx].head - arm.pose.bones["index_01" + sfx].head, 35 * sg)
elif pose == "reach":
    for sfx, sg in (("_l", 1), ("_r", -1)):
        turn("upperarm" + sfx, (0, 1, 0), -95 * sg); turn("lowerarm" + sfx, (1, 0, 0), -70)
elif pose == "crouch":
    for sfx in ("_l", "_r"):
        turn("thigh" + sfx, (1, 0, 0), -80); turn("calf" + sfx, (1, 0, 0), 110)
    turn("spine_01", (1, 0, 0), 25)
elif pose == "look":
    for b, d in (("neck_01", 20), ("neck_02", 20), ("head", 40)): turn(b, (0, 0, 1), d)
s.view_settings.view_transform = "Standard"
s.world = bpy.data.worlds.new("w"); s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1); s.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.0; sun.rotation_euler = (0.9, 0.0, 0.5); s.collection.objects.link(sun)
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.clip_start = 0.001
cam = bpy.data.objects.new("c", cd); s.collection.objects.link(cam); s.camera = cam
s.render.engine = "CYCLES"; s.cycles.device = "CPU"; s.cycles.samples = 24; s.cycles.use_denoising = True
def shoot(name, target, d, scale, res):
    d = Vector(d).normalized(); cam.location = Vector(target) + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler(); cd.ortho_scale = scale
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = os.path.join(out, f"{label}-{name}.png"); bpy.ops.render.render(write_still=True)
for fr in frames:
    if anim: s.frame_set(fr)
    bpy.context.view_layer.update()
    tag = f"f{fr:03d}-" if anim else ""
    pel = arm.matrix_world @ arm.pose.bones["pelvis"].head; c = Vector((pel.x, pel.y, 0.508197 * H))
    shoot(tag + "front", c, (0, -1, 0), 1.147541 * H, (560, 800)); shoot(tag + "side", c, (1, 0, 0), 1.147541 * H, (560, 800)); shoot(tag + "three-quarter", c, (0.7, -0.7, 0.2), 1.147541 * H, (560, 800))
    if not anim or pose:
        for sfx in ("_l",):
            h = arm.matrix_world @ arm.pose.bones["hand" + sfx].head; m = arm.matrix_world @ arm.pose.bones["middle_01" + sfx].head; t = h + (m - h) * 1.3
            n = (arm.pose.bones["pinky_01" + sfx].head - arm.pose.bones["index_01" + sfx].head).cross(m - h).normalized()
            shoot(tag + "hand-back", t, n, 0.120219 * H, (700, 700)); shoot(tag + "hand-palm", t, -n, 0.120219 * H, (700, 700)); shoot(tag + "hand-side", t, (m - h).cross(n).normalized(), 0.120219 * H, (700, 700))
        hd = arm.matrix_world @ arm.pose.bones["head"].head
        shoot(tag + "shoulders", Vector((0, hd.y, hd.z - 0.065574 * H)), (0.3, -1, 0.1), 0.409836 * H, (800, 700))
