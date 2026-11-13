"""Bake the high-resolution mesh's base colour onto the quad remesh through the remesh's own UV layout.
Meshy's remesh of an uploaded file returned a corrupted colour texture, so the colour is projected here instead.
The remesh also comes back rescaled, so it is first scaled and moved to match the high-resolution mesh's bounds
and saved as <aligned.fbx> for the later steps.
blender --background --python-exit-code 1 --python transfer_color.py -- <remesh.fbx> <highres.glb> <out.png> <size> <aligned.fbx> --character <character.json>"""
import bpy, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(low_p, hi_p, out, size, aligned), spec = charspec.require(); size = int(size)
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=low_p); low = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=hi_p); hi = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
for o in (low, hi):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def bbox(o):
    cs = [v.co for v in o.data.vertices]; lo = Vector([min(c[i] for c in cs) for i in range(3)]); hi_ = Vector([max(c[i] for c in cs) for i in range(3)]); return lo, hi_
(l0, l1), (h0, h1) = bbox(low), bbox(hi); k = (h1.z - h0.z) / (l1.z - l0.z); lc = (l0 + l1) / 2; hc = (h0 + h1) / 2
for v in low.data.vertices: v.co = (v.co - lc) * k + hc
low.data.update()
mm = spec.mm(h1.z - h0.z)            # one millimetre of the real character, in the source's units
# refine: repeatedly match every remesh vertex to its nearest point on the high-resolution surface and solve for the
# uniform scale and shift that best bring them together (the bounding boxes alone leave a few millimetres of error)
from mathutils.bvhtree import BVHTree
import numpy as np
bvh = BVHTree.FromPolygons([v.co[:] for v in hi.data.vertices], [tuple(p.vertices) for p in hi.data.polygons])
for it in range(10):
    Pn = np.array([v.co[:] for v in low.data.vertices]); Qn = np.array([bvh.find_nearest(v.co)[0][:] for v in low.data.vertices])
    err = float(np.sqrt(((Pn - Qn) ** 2).sum(axis=1)).mean())
    pm, qm = Pn.mean(axis=0), Qn.mean(axis=0); sc = float(((Pn - pm) * (Qn - qm)).sum() / ((Pn - pm) ** 2).sum()); tr = qm - sc * pm
    for v, c in zip(low.data.vertices, Pn * sc + tr): v.co = c
    if it in (0, 9): print("REFINE iteration", it, "mean distance to source mm", round(err / mm, 3), "scale step", round(sc, 5))
low.data.update(); (l0, l1) = bbox(low)
Pn = np.array([v.co[:] for v in low.data.vertices]); dd = np.array([bvh.find_nearest(v.co)[3] for v in low.data.vertices])
print("REFINE final distance mm: mean", round(float(dd.mean()) / mm, 3), "p95", round(float(np.percentile(dd, 95)) / mm, 3), "max", round(float(dd.max()) / mm, 3))
print("ALIGN scale", round(k, 5), "low", [round(x, 4) for x in (l1 - l0)], "high", [round(x, 4) for x in (h1 - h0)], "centre offset", [round(x, 4) for x in ((l0 + l1) / 2 - hc)])
bpy.ops.object.select_all(action="DESELECT"); low.select_set(True); bpy.context.view_layer.objects.active = low
bpy.ops.export_scene.fbx(filepath=aligned, use_selection=True, object_types={"MESH"}, use_triangles=False, mesh_smooth_type="FACE")
for p in low.data.polygons: p.use_smooth = True
if not low.data.uv_layers:
    # a geometry-only remesh has no UVs: make a temporary non-overlapping layout just to carry the colour to the next steps
    bpy.ops.object.select_all(action="DESELECT"); low.select_set(True); bpy.context.view_layer.objects.active = low
    low.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003); bpy.ops.object.mode_set(mode="OBJECT")
    print("TEMP UV created by smart project")
    bpy.ops.export_scene.fbx(filepath=aligned, use_selection=True, object_types={"MESH"}, use_triangles=False, mesh_smooth_type="FACE")
import numpy as np
img = bpy.data.images.new("transfer", size, size, alpha=True); img.colorspace_settings.name = "sRGB"; img.generated_color = (0, 0, 0, 0)
m = bpy.data.materials.new("target"); m.use_nodes = True; t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img; m.node_tree.nodes.active = t
low.data.materials.clear(); low.data.materials.append(m)
s = bpy.context.scene; s.render.engine = "CYCLES"; s.cycles.device = "CPU"; s.cycles.samples = 4
bpy.ops.object.select_all(action="DESELECT"); hi.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active = low
s.render.bake.use_pass_direct = False; s.render.bake.use_pass_indirect = False; s.render.bake.use_pass_color = True
def bake_pass(cage, ray):
    bpy.ops.object.bake(type="DIFFUSE", use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=ray, margin=0)
    return np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4).copy()
# coverage: which texels belong to a face at all
cov = bpy.data.images.new("cov", size, size, alpha=True); cov.generated_color = (0, 0, 0, 0)
t.image = cov; s.render.bake.use_selected_to_active = False
bpy.ops.object.select_all(action="DESELECT"); low.select_set(True); bpy.context.view_layer.objects.active = low
em = m.node_tree.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (1, 1, 1, 1)
outn = next(n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"); old_link = outn.inputs[0].links[0].from_socket
m.node_tree.links.new(em.outputs[0], outn.inputs[0])
bpy.ops.object.bake(type="EMIT", margin=0)
covered = np.array(cov.pixels[:], dtype=np.float32).reshape(size, size, 4)[:, :, 3] > 0.5
m.node_tree.links.new(old_link, outn.inputs[0]); t.image = img; m.node_tree.nodes.active = t
bpy.ops.object.select_all(action="DESELECT"); hi.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active = low
tight = bake_pass(3.85194 * mm, 7.70389 * mm); wide = bake_pass(11.5558 * mm, 28.8896 * mm)   # millimetres of the real character, as tuned on the first body
# a ray that reaches nothing leaves exact black with full alpha, so exact black marks a miss
inside = tight[:, :, 3] > 0.5; covered = inside
ok_t = inside & (tight[:, :, :3].sum(axis=2) > 0); ok_w = inside & (wide[:, :, :3].sum(axis=2) > 0)
res = np.where(ok_t[:, :, None], tight, wide); valid = (ok_t | ok_w)
print("TRANSFER covered texels", int(covered.sum()), "hit by tight pass", round(float((ok_t & covered).sum() / covered.sum()), 4), "after wide pass", round(float((valid & covered).sum() / covered.sum()), 4))
# texels no ray reached take the colour of the nearest texel that was reached; then pad the islands
rgb = res[:, :, :3].copy(); known = valid.copy()
for it in range(400):
    need = ~known
    if not need.any(): break
    acc = np.zeros_like(rgb); cnt = np.zeros(known.shape, dtype=np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        k = np.roll(known, (dy, dx), axis=(0, 1)); c = np.roll(rgb, (dy, dx), axis=(0, 1))
        acc += c * k[:, :, None]; cnt += k
    grow = need & (cnt > 0)
    if not grow.any(): break
    rgb[grow] = acc[grow] / cnt[grow][:, None]; known |= grow
    if it > 24 and not (need & covered).any(): break
out_px = np.ones((size, size, 4), dtype=np.float32); out_px[:, :, :3] = rgb
img.pixels[:] = out_px.ravel()
img.filepath_raw = out; img.file_format = "PNG"; img.save()
