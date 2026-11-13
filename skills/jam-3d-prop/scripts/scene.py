# Scene test: place props (GLB) on a floor beside a human-scale reference figure; render a front view, an overview,
# and the project's gameplay camera when the spec supplies one.
# Usage: blender --background --factory-startup --python-exit-code 1 --python scene.py -- <out-prefix> <spec.json>
# spec.json (metres, degrees about Z, Blender axes: Z up):
#   {"props": [{"file": "...glb", "x": 0, "y": 0, "rot": 0}, ...],
#    "figureHeight": 1.8,                         # reference figure; 0 for none
#    "camera": {"position": [x,y,z], "target": [x,y,z], "fov": 75}   # optional: the game's camera -> <out>-gameplay.png
#              or {"position": ..., "target": ..., "ortho": 6},
#    "resolution": [1600, 900]}
# A bare list is read as "props". Writes <out>-front.png and <out>-overview.png framed to the content's bounds.
# rot turns a prop about Z: a prop whose front faces -Y at rot 0 faces +Y at 180, -X at -90, +X at 90.
import bpy, sys, json, math, os
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index("--")+1:]; out, spec = os.path.abspath(a[0]), json.load(open(a[1]))
if isinstance(spec, list): spec = {"props": spec}
fig_h = float(spec.get("figureHeight", 1.8))
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
meshes = []
for it in spec["props"]:
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=it["file"])
    new = [o for o in sc.objects if o not in before]
    M = Matrix.Translation((it.get("x", 0), it.get("y", 0), 0)) @ Matrix.Rotation(math.radians(it.get("rot", 0)), 4, 'Z')
    for o in new:
        if o.parent is None: o.matrix_world = M @ o.matrix_world
    meshes += [o for o in new if o.type == 'MESH']
bpy.context.view_layer.update()
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
if fig_h > 0:   # a simple figure beside the set, its width proportional to its height
    r = fig_h * 0.1; fx = mn.x - 3 * r; fy = (mn.y + mx.y) / 2
    hm = bpy.data.materials.new("figure"); hm.use_nodes = True; hm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.2, 0.45, 0.8, 1)
    body = fig_h * 0.86
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=body, location=(fx, fy, body / 2)); bpy.context.active_object.data.materials.append(hm)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=fig_h * 0.07, location=(fx, fy, fig_h - fig_h * 0.07)); bpy.context.active_object.data.materials.append(hm)
    mn = Vector(map(min, mn, (fx - r, fy - r, 0))); mx = Vector(map(max, mx, (fx + r, fy + r, fig_h)))
ctr = (mn + mx) / 2; size = max(mx - mn)
bpy.ops.mesh.primitive_plane_add(size=size * 3, location=(ctr.x, ctr.y, 0))
fm = bpy.data.materials.new("floor"); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.33, 0.3, 1); bpy.context.active_object.data.materials.append(fm)
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.55, 0.6, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(45), 0, math.radians(35)); sc.collection.objects.link(sun)
sc.render.resolution_x, sc.render.resolution_y = spec.get("resolution", [1600, 900])
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
aspect = sc.render.resolution_x / sc.render.resolution_y
def shot(name, loc, tgt, fov=None, ortho=None):
    cam.location = Vector(loc); cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    if ortho: cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    else: cam.data.type = 'PERSP'; cam.data.angle = math.radians(fov)
    cam.data.clip_end = size * 100
    sc.render.filepath = f"{out}-{name}.png"; bpy.ops.render.render(write_still=True)
ext = mx - mn
shot("front", (ctr.x, mn.y - size * 3, ctr.z), ctr, ortho=max(ext.x, ext.z * aspect) * 1.15)
fov = 50; dist = size * 0.75 / math.tan(math.radians(fov / 2)) + size / 2
d = Vector((-0.5, -1.0, 0.6)).normalized()
shot("overview", ctr + d * dist, ctr, fov=fov)
c = spec.get("camera")
if c: shot("gameplay", c["position"], c["target"], fov=c.get("fov"), ortho=c.get("ortho"))
print("BOUNDS", [round(v, 3) for v in ext])
