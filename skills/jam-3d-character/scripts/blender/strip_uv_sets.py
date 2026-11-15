"""Remove every UV set but UV0 from the meshes of a .blend (in place), for files made before bake_outfit.py did it.
blender --background --python-exit-code 1 --python strip_uv_sets.py -- <file.blend>"""
import bpy, sys
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=path); removed = []
for o in bpy.data.objects:
    if o.type == "MESH" and "UV0" in o.data.uv_layers:
        for name in [l.name for l in o.data.uv_layers if l.name != "UV0"]: o.data.uv_layers.remove(o.data.uv_layers[name]); removed.append(f"{o.name}:{name}")
        o.data.uv_layers["UV0"].active = True; o.data.uv_layers["UV0"].active_render = True
bpy.ops.wm.save_mainfile(); print("STRIPPED", removed)
