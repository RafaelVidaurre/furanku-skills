"""Clay-with-wireframe renders of the split parts: assembled, exploded, and the bald head from four sides.
blender --background --python-exit-code 1 --python render_parts.py -- <parts.blend> <out-dir> --character <character.json>"""
import bpy, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(blend, out), spec = charspec.require()
HEAD, HAIR, BODY = spec.part("head"), spec.part("hair"), spec.part("body")
bpy.ops.wm.open_mainfile(filepath=blend)
os.makedirs(out, exist_ok=True)
obs = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
allv = [o.matrix_world @ v.co for o in obs.values() for v in o.data.vertices]
lo = Vector([min(p[i] for p in allv) for i in range(3)]); hi = Vector([max(p[i] for p in allv) for i in range(3)]); H = hi.z - lo.z
colors = {HEAD: (0.93, 0.72, 0.58, 1), HAIR: (0.45, 0.27, 0.14, 1), BODY: (0.75, 0.78, 0.82, 1)}
wires = {}
for n, o in obs.items():
    o.color = colors.get(n, (0.8, 0.8, 0.8, 1))
    w = o.copy(); w.data = o.data.copy(); bpy.context.scene.collection.objects.link(w)
    m = w.modifiers.new("wire", "WIREFRAME"); m.thickness = H * 0.0008; m.use_replace = True; w.color = (0.04, 0.04, 0.04, 1); wires[n] = w
s = bpy.context.scene; s.render.engine = "BLENDER_WORKBENCH"
s.world = bpy.data.worlds.new("w"); s.world.color = (0.5, 0.5, 0.5)
sh = s.display.shading; sh.light = "STUDIO"; sh.color_type = "OBJECT"; sh.show_backface_culling = False
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.clip_start = 0.001
cam = bpy.data.objects.new("c", cd); s.collection.objects.link(cam); s.camera = cam
def shoot(name, target, d, scale, res=(900, 900)):
    d = Vector(d).normalized(); cam.location = Vector(target) + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler(); cd.ortho_scale = scale
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = os.path.join(out, name + ".png"); bpy.ops.render.render(write_still=True)
def show(names, wire=True):
    for n in obs:
        obs[n].hide_render = n not in names; wires[n].hide_render = (n not in names) or not wire
c = (lo + hi) / 2; headc = Vector((c.x, c.y, hi.z - H * 0.085))
show(obs.keys()); shoot("assembled-front", c, (0, -1, 0), H * 1.06, (700, 1050)); shoot("assembled-head", headc, (0.5, -1, 0.15), H * 0.24)
show([HEAD or BODY])
for n, d in (("front", (0, -1, 0)), ("side", (1, 0, 0)), ("back", (0, 1, 0)), ("top", (0, -0.25, 1)), ("three-quarter", (0.6, -1, 0.3))):
    shoot("head-" + n, headc, d, H * 0.24)
show([HEAD or BODY], wire=False); shoot("head-clay-three-quarter", headc, (0.6, -1, 0.3), H * 0.24); shoot("head-clay-side", headc, (1, 0, 0), H * 0.24)
if HAIR: show([HAIR]); shoot("hair-three-quarter", headc, (0.6, -1, 0.3), H * 0.24); shoot("hair-below", headc, (0.3, -0.4, -1), H * 0.24)
show([BODY]); shoot("body-front", c, (0, -1, 0), H * 1.06, (700, 1050)); shoot("body-neck", Vector((c.x, c.y, hi.z - H * 0.2)), (0, -0.6, 1), H * 0.3)
show([BODY, HEAD or BODY]); shoot("neck-seam", Vector((c.x, c.y, hi.z - H * 0.17)), (0.5, -1, 0.1), H * 0.18)
