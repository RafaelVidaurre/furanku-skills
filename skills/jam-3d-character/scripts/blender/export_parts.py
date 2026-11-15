"""The topology stage file: the character's quad mesh (or its split parts), each part with its own preview material,
saved as the quad source, a triangulated GLB for measurement and a quad FBX.
blender --background --python-exit-code 1 --python export_parts.py -- <aligned.fbx | parts.blend> <out-dir> [--character <character.json>]
An aligned FBX (transfer_color.py's output) is the one-mesh path: its single mesh is named after the spec's body part, so
--character is required. A parts file from split_parts.py already carries the part names."""
import bpy, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(src, out), spec = charspec.split_args()
os.makedirs(out, exist_ok=True)
if src.lower().endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    if spec is None: raise SystemExit("an aligned mesh needs --character <character.json> to name its part")
    if spec.part("head"): raise SystemExit("the spec has separate parts: split the mesh with split_parts.py first and pass its parts file")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    (bpy.ops.import_scene.gltf if src.lower().endswith((".glb", ".gltf")) else bpy.ops.import_scene.fbx)(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) != 1: raise SystemExit(f"expected one mesh in {src}, found {len(meshes)}")
    ob = meshes[0]; ob.name = ob.data.name = spec.part("body")
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.context.scene.objects if o is not ob]: bpy.data.objects.remove(o)
    for p in ob.data.polygons: p.use_smooth = True
PALETTE = [(0.93, 0.72, 0.58, 1), (0.45, 0.27, 0.14, 1), (0.75, 0.78, 0.82, 1), (0.6, 0.75, 0.6, 1)]   # preview colours, one per part
for i, o in enumerate(sorted((o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: o.name)):
    m = bpy.data.materials.new("M_" + o.name); m.diffuse_color = PALETTE[i % len(PALETTE)]
    o.data.materials.clear(); o.data.materials.append(m); o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "character-topology.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "character-topology.glb"), export_format="GLB", use_selection=True, export_apply=True)
bpy.ops.export_scene.fbx(filepath=os.path.join(out, "character-topology.fbx"), use_selection=True, object_types={"MESH"}, use_triangles=False, mesh_smooth_type="FACE")
