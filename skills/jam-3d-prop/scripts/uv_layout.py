# Dump UV polygons (JSON) and the base colour map (PNG) of a GLB; draw them with uv_overlay.py.
# Usage: blender --background --factory-startup --python-exit-code 1 --python uv_layout.py -- <model.glb> <uv.json> <base.png>
import bpy, sys, json
a=sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
o=[o for o in bpy.context.scene.objects if o.type=='MESH'][0]; uv=o.data.uv_layers.active.data
json.dump([[list(uv[li].uv) for li in p.loop_indices] for p in o.data.polygons],open(a[1],'w'))
bsdf=o.data.materials[0].node_tree.nodes.get('Principled BSDF'); link=bsdf.inputs['Base Color'].links[0]
im=link.from_node.image; im.filepath_raw=a[2]; im.file_format='PNG'; im.save()
