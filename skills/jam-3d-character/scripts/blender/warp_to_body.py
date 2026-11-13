"""Warp a generated outfit onto a body's proportions, both in the straight-armed modelled pose: each limb of the outfit is
moved, turned and stretched along its length from the outfit's own joints onto the body's joints. Widths are kept; pushing
the cloth outside the body is a later step.
blender --background --python-exit-code 1 --python warp_to_body.py -- <outfit-remesh.blend> <outfit-rigged.glb> <outfit-joints.json> <body-joints.json> <out.blend> <report.json>

- outfit-remesh.blend: the outfit's quad remesh (Meshy's .blend, in the generation's normalised space).
- outfit-rigged.glb, outfit-joints.json: Meshy's auto-rig of the same generation and its joints (meshy_rig_joints.py).
- body-joints.json: the body's joints from Meshy's auto-rig of the body's own generation, in metres with the feet at zero.
The warp is skinned with Meshy's weights for the outfit, carried onto the remesh. Output: the outfit as `Outfit`, in the body's
joint space (metres, feet at zero, facing -Y), with its material and UVs."""
import bpy, sys, json
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
remesh_blend, rigged_glb, outfit_joints_path, body_joints_path, out_blend, report_path = args[:6]
OJ = json.load(open(outfit_joints_path))["bones"]; BJ = json.load(open(body_joints_path))["bones"]

bpy.ops.wm.open_mainfile(filepath=remesh_blend)
outfit = [o for o in bpy.data.objects if o.type == "MESH"][0]
outfit.name = "Outfit"; outfit.data.name = "Outfit"
bpy.ops.import_scene.gltf(filepath=rigged_glb)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
rigged = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o is not outfit and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o not in (outfit, rigged): bpy.data.objects.remove(o)

def zrange(o):
    zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]; return min(zs), max(zs)
# The remesh is the same generation in a normalised space: scale and lift it onto the rigged mesh.
(a0, a1), (b0, b1) = zrange(outfit), zrange(rigged)
s = (b1 - b0) / (a1 - a0)
outfit.matrix_world = Matrix.Translation((0, 0, b0 - a0 * s)) @ Matrix.Scale(s, 4) @ outfit.matrix_world
bpy.ops.object.select_all(action="DESELECT"); outfit.select_set(True); bpy.context.view_layer.objects.active = outfit
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Meshy's weights onto the remesh, from the nearest point of the rigged mesh's surface.
dt = outfit.modifiers.new("weights", "DATA_TRANSFER"); dt.object = rigged
dt.use_vert_data = True; dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
bpy.ops.object.datalayout_transfer(modifier=dt.name); bpy.ops.object.modifier_apply(modifier=dt.name)

# Pose the outfit's skeleton onto the body's joints. Each bone runs from its head to its continuing child's head.
bones = arm.data.bones
def continuation(name):
    # end markers (head_end, the top of whatever is on the head) are not joints: the head stays rigid
    kids = [b.name for b in bones[name].children if b.name in OJ and b.name in BJ and not b.name.endswith("_end") and b.name != "headfront"]
    side = "Left" if "Left" in name else "Right" if "Right" in name else None
    same = [k for k in kids if (side and side in k) or (not side and "Left" not in k and "Right" not in k)]
    return (same or kids or [None])[0] if kids else None
W = arm.matrix_world; Winv = W.inverted()
for b in bones: b.inherit_scale = "NONE"
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode="POSE")
report = {"scale": s, "bones": {}}
turn = {}
order = []
def walk(b):
    order.append(b); [walk(c) for c in b.children]
[walk(b) for b in bones if b.parent is None]
for b in order:
    n = b.name
    if n not in OJ or n not in BJ:
        continue
    h0 = Vector(OJ[n]["head"]); ht = Vector(BJ[n]["head"]); c = continuation(n)
    if c and "Foot" not in n and "Toe" not in n:  # footwear keeps its own length; it must enclose the body's feet
        d0 = Vector(OJ[c]["head"]) - h0; dt_ = Vector(BJ[c]["head"]) - ht
        R = d0.normalized().rotation_difference(dt_.normalized()).to_matrix().to_4x4(); k = dt_.length / max(d0.length, 1e-6)
    else:
        R = turn.get(b.parent.name, Matrix.Identity(4)) if b.parent else Matrix.Identity(4); k = 1.0
    turn[n] = R
    rest = W @ b.matrix_local  # bone rest, world
    # keep the rest orientation and the armature object's own scale (Meshy's is 0.01: bones in centimetres)
    world = Matrix.Translation(ht) @ R @ rest.to_3x3().to_4x4() @ Matrix.Diagonal((1.0, k, 1.0, 1.0))
    arm.pose.bones[n].matrix = Winv @ world
    bpy.context.view_layer.update()
    report["bones"][n] = {"to": c, "lengthRatio": round(k, 4), "moveCm": round((ht - h0).length * 100, 2)}
bpy.ops.object.mode_set(mode="OBJECT")

am = outfit.modifiers.new("warp", "ARMATURE"); am.object = arm
bpy.ops.object.select_all(action="DESELECT"); outfit.select_set(True); bpy.context.view_layer.objects.active = outfit
bpy.ops.object.modifier_apply(modifier=am.name)
outfit.vertex_groups.clear()
for o in list(bpy.data.objects):
    if o is not outfit: bpy.data.objects.remove(o)
zs = [v.co.z for v in outfit.data.vertices]
report["heightAfter"] = round(max(zs) - min(zs), 4); report["feetAt"] = round(min(zs), 4)
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps({k: v for k, v in report.items() if k != "bones"}))
