# Textured orthographic views (front, side, threequarter, top) of a GLB: <out>-<view>.png. Prints BOUNDS in metres.
# Usage: blender --background --factory-startup --python-exit-code 1 --python render.py -- <model.glb> <out-prefix>
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--")+1:]
glb, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
mn=Vector((1e9,)*3); mx=Vector((-1e9,)*3)
for o in objs:
    for c in o.bound_box:
        w=o.matrix_world@Vector(c); mn=Vector(map(min,mn,w)); mx=Vector(map(max,mx,w))
ctr=(mn+mx)/2; size=max(mx-mn)
print("BOUNDS", tuple(round(v,3) for v in (mx-mn)))
sc=bpy.context.scene; sc.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x=sc.render.resolution_y=640
w=bpy.data.worlds.new("w"); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.6,0.6,0.62,1); w.node_tree.nodes['Background'].inputs[1].default_value=1.0
sun=bpy.data.objects.new("sun",bpy.data.lights.new("sun",'SUN')); sun.data.energy=3; sun.rotation_euler=(math.radians(50),0,math.radians(30)); sc.collection.objects.link(sun)
cam=bpy.data.objects.new("cam",bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=size*1.3
views={"front":(0,-1,0.0),"side":(1,0,0.0),"threequarter":(0.8,-0.8,0.6),"top":(0,-0.01,1)}
for n,d in views.items():
    dv=Vector(d).normalized(); cam.location=ctr+dv*size*3
    cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=f"{os.path.abspath(out)}-{n}.png"; bpy.ops.render.render(write_still=True)
