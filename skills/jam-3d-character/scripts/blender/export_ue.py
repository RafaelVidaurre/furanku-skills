"""Export the rigged character for Unreal: one combined skeletal mesh (drop-in for SKM_Manny_Simple) and one file per swappable part.
Every file carries the same armature object named `root`, which Unreal reads as the root bone, as in Epic's own export.
blender --background --python-exit-code 1 --python export_ue.py -- <rigged.blend> <out-dir> [name-prefix] [--parts-only] [--character <character.json>]
The parts are every mesh deformed by the armature, each exported as <prefix>_<object name>; the prefix defaults to
SKM_<name> from the character spec (SKM_Character without one).
A one-mesh character gets the combined file alone. The combined file <prefix>.fbx is skipped with --parts-only (an outfit's pieces are worn with the body's own).
Normals are exported as the file holds them (custom normals included), so a part split from another keeps its seam smooth."""
import bpy, sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
args, spec = charspec.split_args()
parts_only = "--parts-only" in args; args = [a for a in args if a != "--parts-only"]
blend, out = args[:2]; prefix = args[2] if len(args) > 2 else "SKM_" + (spec.name if spec else "Character")
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(out, exist_ok=True)
arm = bpy.data.objects["root"]
parts = {o.name: o for o in sorted(bpy.data.objects, key=lambda o: o.name)
         if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)}
for o in parts.values():
    # custom normals already define the shading; otherwise smooth every face as before
    if not o.data.has_custom_normals:
        for p in o.data.polygons: p.use_smooth = True
# Unreal reads the armature object as the root bone. Epic's own file stores bones in centimetres under an object scaled 0.01;
# anything else gives the root bone a scale of 100 in the engine. Rebuild that layout: data x100, armature object x0.01.
for o in [arm] + list(parts.values()):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    o.scale = (100, 100, 100); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
arm.scale = (0.01, 0.01, 0.01); bpy.context.view_layer.update()
# Unreal names are case-insensitive, so a mesh object called "Head" would collide with the bone "head": prefix the mesh objects
for n, o in parts.items(): o.name = "Geo_" + n; o.data.name = "Geo_" + n
# Unreal reads the first UV set in the file as channel 0, the one materials sample. The Blender file also keeps the remesh's
# old layout (UV_Meshy) ahead of UV0, which made the engine map every texture through the wrong layout: export UV0 alone.
for o in parts.values():
    for layer in [l.name for l in o.data.uv_layers if l.name != "UV0"]: o.data.uv_layers.remove(o.data.uv_layers[layer])
    o.data.uv_layers["UV0"].active = True; o.data.uv_layers["UV0"].active_render = True
def export(name, objs):
    bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    path = os.path.join(out, name + ".fbx")
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
                             bake_anim=False, mesh_smooth_type="FACE", use_armature_deform_only=False, apply_scale_options="FBX_SCALE_NONE", use_triangles=False, use_tspace=True)
    return path
files = {} if parts_only else {"combined": export(prefix, list(parts.values()))}
if parts_only or len(parts) > 1:   # one mesh: the combined file is the character; no per-part copy of it
    for n, o in parts.items(): files[n] = export(prefix + "_" + n, [o])
info = {"bones": len(arm.data.bones), "files": {k: os.path.basename(v) for k, v in files.items()},
        "parts": {n: {"vertices": len(o.data.vertices), "faces": len(o.data.polygons), "quads": sum(1 for p in o.data.polygons if len(p.vertices) == 4),
                      "uvSets": [l.name for l in o.data.uv_layers], "vertexGroups": len(o.vertex_groups), "maxInfluences": max(len(v.groups) for v in o.data.vertices)} for n, o in parts.items()}}
json.dump(info, open(os.path.join(out, "export-info.json"), "w"), indent=1); print(json.dumps(info))
