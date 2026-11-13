# Untextured (clay) top and three-quarter views, to see carved grooves, rings and dents that textures hide: <out>-top.png, <out>-tq.png.
# Usage: blender --background --factory-startup --python-exit-code 1 --python clay.py -- <model.glb> <out-prefix>
import bpy, sys, math, os
from mathutils import Vector
a=sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
mat=bpy.data.materials.new("clay"); mat.use_nodes=True
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in objs:
    o.data.materials.clear(); o.data.materials.append(mat)
mn=Vector((1e9,)*3); mx=Vector((-1e9,)*3)
for o in objs:
    for c in o.bound_box:
        w=o.matrix_world@Vector(c); mn=Vector(map(min,mn,w)); mx=Vector(map(max,mx,w))
ctr=(mn+mx)/2; size=max(mx-mn); sc=bpy.context.scene
sc.render.resolution_x=sc.render.resolution_y=640
w=bpy.data.worlds.new("w"); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.5,0.5,0.52,1)
sun=bpy.data.objects.new("sun",bpy.data.lights.new("sun",'SUN')); sun.data.energy=4; sun.rotation_euler=(math.radians(35),0,math.radians(60)); sc.collection.objects.link(sun)
cam=bpy.data.objects.new("cam",bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'; cam.data.ortho_scale=size*1.2
for n,d in {"top":(0,-0.01,1),"tq":(0.8,-0.8,0.7)}.items():
    dv=Vector(d).normalized(); cam.location=ctr+dv*size*3; cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=f"{os.path.abspath(a[1])}-{n}.png"; bpy.ops.render.render(write_still=True)
