"""Skin outfit pieces to the body's own armature with the body's own weights, so the clothes bend exactly where the body
bends and the skeleton is never refitted.
blender --background --python-exit-code 1 --python weight_outfit.py -- <pieces-bind-pose.blend> <body-rigged.blend> <out.blend> <report.json>

Outfit_* pieces copy the weights of the nearest point of the body's surface (all its parts), limited to 4 bones and
normalised. Hat_* and Hair_* (hat hair) pieces follow the head bone rigidly. The output holds the body's armature (`root`, unchanged) and the
pieces only, ready for export_ue.py."""
import bpy, sys, json

args = sys.argv[sys.argv.index("--") + 1:]
src, body_blend, out_blend, report_path = args[:4]
bpy.ops.wm.open_mainfile(filepath=src)
pieces = [o for o in bpy.data.objects if o.type == "MESH"]
with bpy.data.libraries.load(body_blend) as (s_, d_): d_.objects = list(s_.objects)
arm = next(o for o in d_.objects if o and o.type == "ARMATURE"); bpy.context.scene.collection.objects.link(arm)
body = [o for o in d_.objects if o and o.type == "MESH"]
for o in body: bpy.context.scene.collection.objects.link(o)
# one source surface with every body part's weights
bpy.ops.object.select_all(action="DESELECT")
copies = []
for o in body:
    c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c); copies.append(c)
for c in copies: c.select_set(True)
bpy.context.view_layer.objects.active = copies[0]; bpy.ops.object.join(); source = bpy.context.view_layer.objects.active
source.name = "WeightSource"
report = {"bones": len(arm.data.bones), "pieces": {}}
for o in pieces:
    o.vertex_groups.clear()
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    if o.name.startswith(("Hat", "Hair")):  # hats and hat hair are rigid on the head
        g = o.vertex_groups.new(name="head"); g.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
    else:
        dt = o.modifiers.new("weights", "DATA_TRANSFER"); dt.object = source
        dt.use_vert_data = True; dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "POLYINTERP_NEAREST"
        dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
        bpy.ops.object.datalayout_transfer(modifier=dt.name); bpy.ops.object.modifier_apply(modifier=dt.name)
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        used = {o.vertex_groups[g.group].name for v in o.data.vertices for g in v.groups if g.weight > 0}
        for name in [vg.name for vg in o.vertex_groups if vg.name not in used]: o.vertex_groups.remove(o.vertex_groups[name])
    o.parent = arm; o.matrix_parent_inverse = arm.matrix_world.inverted()
    m = o.modifiers.new("Armature", "ARMATURE"); m.object = arm
    unweighted = sum(1 for v in o.data.vertices if not v.groups)
    report["pieces"][o.name] = {"vertexGroups": len(o.vertex_groups), "maxInfluences": max(len(v.groups) for v in o.data.vertices), "unweighted": unweighted}
for o in body + [source]: bpy.data.objects.remove(o)
bpy.ops.wm.save_as_mainfile(filepath=out_blend, relative_remap=True)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
