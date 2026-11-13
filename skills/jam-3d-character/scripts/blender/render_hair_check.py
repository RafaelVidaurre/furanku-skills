"""Close renders of the head to tell texture faults from the scalp poking through the hair:
both parts together, the hair piece alone, and the head alone, from the same four directions.
blender --background --python-exit-code 1 --python render_hair_check.py -- <textured-or-rigged.blend> <out-dir> --character <character.json> [--flat] [--unlit]
Without a hair part it renders the head alone."""
import bpy, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
args, spec = charspec.require(); blend, out = args[:2]; flat = "--flat" in args   # --flat: plain part colours and quad edges, for meshes without textures
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(out, exist_ok=True)
obs = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
HEAD, HAIR = spec.part("head") or spec.part("body"), spec.part("hair")
hv = [obs[HAIR or HEAD].matrix_world @ v.co for v in obs[HAIR or HEAD].data.vertices]
if not HAIR:   # frame the top of the head on a head-only or one-mesh character
    top = max(p.z for p in hv); hv = [p for p in hv if p.z > top - (top - min(p.z for p in hv)) * (0.12 if HEAD == spec.part("body") else 0.6)]
lo = Vector([min(p[i] for p in hv) for i in range(3)]); hi = Vector([max(p[i] for p in hv) for i in range(3)]); c = (lo + hi) / 2; c.z -= (hi.z - lo.z) * 0.25
size = max(hi - lo) * 1.9
s = bpy.context.scene; s.view_settings.view_transform = "Standard"
s.world = bpy.data.worlds.new("w"); s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1); s.world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 2.5; sun.rotation_euler = (0.9, 0.0, 0.5); s.collection.objects.link(sun)
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.clip_start = 0.001; cd.ortho_scale = size
cam = bpy.data.objects.new("c", cd); s.collection.objects.link(cam); s.camera = cam
s.render.engine = "CYCLES"; s.cycles.device = "CPU"; s.cycles.samples = 32; s.cycles.use_denoising = True
s.render.resolution_x = s.render.resolution_y = 800
if flat:
    cols = {spec.part("head"): (0.85, 0.6, 0.45, 1), spec.part("hair"): (0.35, 0.2, 0.1, 1), spec.part("body"): (0.8, 0.8, 0.8, 1)}
    black = bpy.data.materials.new("wire"); black.use_nodes = True; black.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
    for n, o in list(obs.items()):
        m = bpy.data.materials.new("flat_" + n); m.use_nodes = True; m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = cols.get(n, (0.6, 0.6, 0.6, 1))
        o.data.materials.clear(); o.data.materials.append(m); o.data.materials.append(black)
        w = o.modifiers.new("w", "WIREFRAME"); w.thickness = 0.0025 * size; w.use_replace = False; w.material_offset = 1
if "--unlit" in args:   # base colour only, to tell texture faults from shading faults
    for o in obs.values():
        for m in o.data.materials:
            nt = m.node_tree; b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"); e = nt.nodes.new("ShaderNodeEmission")
            nt.links.new(b.inputs["Base Color"].links[0].from_socket, e.inputs[0]); nt.links.new(e.outputs[0], next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL").inputs[0])
views = {"left": (1, -0.25, 0.1), "right": (-1, -0.25, 0.1), "front-above": (0, -1, 0.45), "back": (0.25, 1, 0.15)}
for label, show in ((("both", (HEAD, HAIR)), ("hair", (HAIR,)), ("head", (HEAD,))) if HAIR else (("head", (HEAD,)),)):
    for n, o in obs.items(): o.hide_render = n not in show
    for vn, d in views.items():
        d = Vector(d).normalized(); cam.location = c + d * 3; cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        s.render.filepath = os.path.join(out, f"{label}-{vn}.png"); bpy.ops.render.render(write_still=True)
