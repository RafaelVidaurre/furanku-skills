"""Export a rigged character from Blender as FBX for Unreal's skeletal mesh import. Runs in Blender.

blender --background --python-exit-code 1 --python export_skinned.py -- <rigged.blend> <out-dir> <name>
        [--armature root] [--uv <layer>] [--per-mesh | --per-mesh-only]
Writes <out-dir>/<name>.fbx holding the armature and every mesh it deforms, and <out-dir>/export-info.json.
--per-mesh also writes <name>_<object name>.fbx for each mesh, each with the same armature; --per-mesh-only writes
those alone. The armature object is named by --armature (default `root`): Unreal reads the armature object as the
root bone, as in Epic's own export.
Normals are exported as the file holds them (custom normals included), so a mesh split from another keeps its seam smooth.
--uv names the UV layer to export; without it each mesh's render layer is kept. Either way the file carries one UV
set per mesh, because Unreal reads the first UV set in the file as channel 0, the one materials sample.
"""
import bpy, sys, os, json

args = sys.argv[sys.argv.index("--") + 1:]
def option(flag, default=None):
    if flag in args:
        i = args.index(flag); value = args[i + 1]; del args[i:i + 2]
        return value
    return default
armature_name = option("--armature", "root"); uv_name = option("--uv")
per_mesh_only = "--per-mesh-only" in args; per_mesh = per_mesh_only or "--per-mesh" in args
args = [a for a in args if a not in ("--per-mesh", "--per-mesh-only")]
blend, out, prefix = args[:3]
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(out, exist_ok=True)
arm = bpy.data.objects[armature_name]
parts = {o.name: o for o in sorted(bpy.data.objects, key=lambda o: o.name)
         if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)}
if not parts: raise SystemExit("no mesh is deformed by the armature object %r" % armature_name)
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
# Unreal reads the first UV set in the file as channel 0, the one materials sample. A file that keeps an older layout
# ahead of the current one makes the engine map every texture through the wrong layout: export one UV set alone.
for n, o in parts.items():
    keep = uv_name or next((l.name for l in o.data.uv_layers if l.active_render), None)
    if keep is None or keep not in o.data.uv_layers: raise SystemExit("mesh %s has no UV layer %s" % (n, uv_name or "to render with"))
    for layer in [l.name for l in o.data.uv_layers if l.name != keep]: o.data.uv_layers.remove(o.data.uv_layers[layer])
    o.data.uv_layers[keep].active = True; o.data.uv_layers[keep].active_render = True
def export(name, objs):
    bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    path = os.path.join(out, name + ".fbx")
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
                             bake_anim=False, mesh_smooth_type="FACE", use_armature_deform_only=False, apply_scale_options="FBX_SCALE_NONE", use_triangles=False, use_tspace=True)
    return path
files = {} if per_mesh_only else {"combined": export(prefix, list(parts.values()))}
if per_mesh:
    for n, o in parts.items(): files[n] = export(prefix + "_" + n, [o])
info = {"bones": len(arm.data.bones), "files": {k: os.path.basename(v) for k, v in files.items()},
        "parts": {n: {"vertices": len(o.data.vertices), "faces": len(o.data.polygons), "quads": sum(1 for p in o.data.polygons if len(p.vertices) == 4),
                      "materials": [m.name for m in o.data.materials if m],
                      "uvSets": [l.name for l in o.data.uv_layers], "vertexGroups": len(o.vertex_groups), "maxInfluences": max(len(v.groups) for v in o.data.vertices)} for n, o in parts.items()}}
json.dump(info, open(os.path.join(out, "export-info.json"), "w"), indent=1); print(json.dumps(info))
