"""Export the rigged, textured character as the runtime GLB of a delivery, for measurement and the catalog viewer.
blender --background --python export_glb.py -- <rigged.blend> <out.glb>"""
import bpy, sys
blend, out = sys.argv[-2:]
bpy.ops.wm.open_mainfile(filepath=blend)
# glTF maps textures through the first UV set: keep only UV0, the layout the maps were baked for (an older layout kept for
# baking, such as UV_Meshy, would scramble every texture in the runtime model while the engine files look right)
for o in bpy.context.scene.objects:
    if o.type == "MESH" and "UV0" in o.data.uv_layers:
        for name in [l.name for l in o.data.uv_layers if l.name != "UV0"]: o.data.uv_layers.remove(o.data.uv_layers[name])
for o in bpy.context.scene.objects: o.select_set(o.type in ("MESH", "ARMATURE"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=False, export_skins=True, export_animations=False)
