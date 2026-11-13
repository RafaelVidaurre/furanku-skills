"""Review renders of the textured parts: unlit base colour (Workbench) and lit with normal and roughness maps (Cycles).
blender --background --python-exit-code 1 --python render_textured.py -- <textured.blend> <out-dir> --character <character.json>"""
import bpy, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(blend, out), spec = charspec.require()
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(out, exist_ok=True)
obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
allv = [o.matrix_world @ v.co for o in obs for v in o.data.vertices]
lo = Vector([min(p[i] for p in allv) for i in range(3)]); hi = Vector([max(p[i] for p in allv) for i in range(3)]); H = hi.z - lo.z; c = (lo + hi) / 2
s = bpy.context.scene; s.view_settings.view_transform = "Standard"
s.world = bpy.data.worlds.new("w"); s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1); s.world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.clip_start = 0.001
cam = bpy.data.objects.new("c", cd); s.collection.objects.link(cam); s.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.0; sun.data.angle = 0.05
sun.rotation_euler = (0.9, 0.0, 0.6); s.collection.objects.link(sun)
def shoot(name, target, d, scale, res):
    d = Vector(d).normalized(); cam.location = Vector(target) + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler(); cd.ortho_scale = scale
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = os.path.join(out, name + ".png"); bpy.ops.render.render(write_still=True)
headc = Vector((c.x, c.y, hi.z - H * 0.085)); hand = Vector((hi.x - (hi.x - lo.x) * 0.06, c.y, lo.z + H * 0.5))
views = [("front", c, (0, -1, 0), H * 1.06, (500, 750)), ("left", c, (1, 0, 0), H * 1.06, (500, 750)), ("back", c, (0, 1, 0), H * 1.06, (500, 750)),
         ("three-quarter", c, (0.7, -0.7, 0.15), H * 1.06, (500, 750)), ("face", headc, (0, -1, 0), H * 0.2, (750, 750)),
         ("head-three-quarter", headc, (0.6, -1, 0.2), H * 0.22, (750, 750)), ("head-back", headc, (-0.4, 1, 0.2), H * 0.22, (750, 750)), ("hand", hand, (0.3, -1, 0.2), H * 0.14, (750, 750))]
s.render.engine = "BLENDER_WORKBENCH"; s.display.shading.light = "FLAT"; s.display.shading.color_type = "TEXTURE"
for n, t, d, sc, r in views: shoot("unlit-" + n, t, d, sc, r)
s.render.engine = "CYCLES"; s.cycles.device = "CPU"; s.cycles.samples = 48; s.cycles.use_denoising = True
for n, t, d, sc, r in views: shoot("lit-" + n, t, d, sc, r)
bald = [o for o in obs if o.name == spec.part("hair")]
for o in bald: o.hide_render = True
if bald: shoot("lit-bald-three-quarter", headc, (0.6, -1, 0.2), H * 0.22, (750, 750)); shoot("lit-bald-back", headc, (-0.4, 1, 0.2), H * 0.22, (750, 750))
