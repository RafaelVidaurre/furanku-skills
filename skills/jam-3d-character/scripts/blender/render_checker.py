"""Render the unwrapped parts with a numbered UV grid through layer UV0, to show stretch and texel density.
blender --background --python-exit-code 1 --python render_checker.py -- <uv.blend> <out-dir> --character <character.json>"""
import bpy, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(blend, out), spec = charspec.require()
bpy.ops.wm.open_mainfile(filepath=blend)
grids = {}
for n, size in ((spec.part(r), spec.texture_sizes[r]) for r in ("head", "hair", "body") if spec.part(r)):
    o = bpy.data.objects[n]
    img = bpy.data.images.new("grid_" + n, size, size); img.generated_type = "COLOR_GRID"
    m = bpy.data.materials.new("Checker_" + n); m.use_nodes = True
    nt = m.node_tree; tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV0"; nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    bsdf = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.active = tex
    o.data.materials.clear(); o.data.materials.append(m); o.data.uv_layers.active = o.data.uv_layers["UV0"]
obs = [bpy.data.objects[n] for n in spec.present_parts(("head", "hair", "body"))]
allv = [o.matrix_world @ v.co for o in obs for v in o.data.vertices]
lo = Vector([min(p[i] for p in allv) for i in range(3)]); hi = Vector([max(p[i] for p in allv) for i in range(3)]); H = hi.z - lo.z; c = (lo + hi) / 2
s = bpy.context.scene; s.render.engine = "BLENDER_WORKBENCH"
s.world = bpy.data.worlds.new("w"); s.world.color = (0.5, 0.5, 0.5)
sh = s.display.shading; sh.light = "FLAT"; sh.color_type = "TEXTURE"; s.view_settings.view_transform = "Standard"
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.clip_start = 0.001
cam = bpy.data.objects.new("c", cd); s.collection.objects.link(cam); s.camera = cam
def shoot(name, target, d, scale, res):
    d = Vector(d).normalized(); cam.location = Vector(target) + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler(); cd.ortho_scale = scale
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = os.path.join(out, name + ".png"); bpy.ops.render.render(write_still=True)
headc = Vector((c.x, c.y, hi.z - H * 0.085))
shoot("checker-front", c, (0, -1, 0), H * 1.06, (700, 1050)); shoot("checker-back", c, (0, 1, 0), H * 1.06, (700, 1050))
shoot("checker-head", headc, (0.5, -1, 0.15), H * 0.24, (900, 900)); shoot("checker-head-back", headc, (-0.4, 1, 0.2), H * 0.24, (900, 900))
shoot("checker-hand", Vector((hi.x - (hi.x - lo.x) * 0.06, c.y, lo.z + H * 0.5)), (0.3, -1, 0.2), H * 0.14, (900, 900))
shoot("checker-legs", Vector((c.x, c.y, lo.z + H * 0.3)), (0.4, -1, 0), H * 0.62, (900, 900))
