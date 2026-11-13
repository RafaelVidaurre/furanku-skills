"""Wireframe-on-clay renders and face statistics for a retopology candidate (.blend, .fbx or .glb).
blender --background --factory-startup --python-exit-code 1 --python render_wire.py -- <model> <out-dir> <label>"""
import bpy, bmesh, sys, os, json
from mathutils import Vector
model, out, label = sys.argv[sys.argv.index("--") + 1:][:3]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(model)[1].lower()
if ext == ".blend":
    with bpy.data.libraries.load(model) as (src, dst): dst.objects = list(src.objects)
    for ob in dst.objects:
        if ob is not None: bpy.context.scene.collection.objects.link(ob)
elif ext == ".fbx": bpy.ops.import_scene.fbx(filepath=model)
else: bpy.ops.import_scene.gltf(filepath=model)
meshes = [x for x in bpy.context.scene.objects if x.type == "MESH"]
stats = {"label": label, "file": model, "blender": bpy.app.version_string, "objects": []}
allv = []
for o in meshes:
    bm = bmesh.new(); bm.from_mesh(o.data)
    stats["objects"].append({"name": o.name, "verts": len(bm.verts), "faces": len(bm.faces), "quads": sum(1 for f in bm.faces if len(f.verts) == 4),
        "tris": sum(1 for f in bm.faces if len(f.verts) == 3), "ngons": sum(1 for f in bm.faces if len(f.verts) > 4),
        "exportTriangles": sum(len(f.verts) - 2 for f in bm.faces), "nonManifoldEdges": sum(1 for e in bm.edges if not e.is_manifold),
        "poles": sum(1 for v in bm.verts if len(v.link_edges) != 4), "uvLayers": [l.name for l in o.data.uv_layers]})
    bm.free(); allv += [o.matrix_world @ v.co for v in o.data.vertices]
lo = Vector([min(p[i] for p in allv) for i in range(3)]); hi = Vector([max(p[i] for p in allv) for i in range(3)])
stats["size"] = list(hi - lo)
up = max(range(3), key=lambda i: (hi - lo)[i])
stats["upAxis"] = "XYZ"[up]
json.dump(stats, open(os.path.join(out, f"{label}-stats.json"), "w"), indent=2); print(json.dumps(stats))
H = (hi - lo)[up]; c = (lo + hi) / 2
for o in meshes:
    o.color = (0.82, 0.82, 0.82, 1)
    w = o.copy(); w.data = o.data.copy(); bpy.context.scene.collection.objects.link(w)
    m = w.modifiers.new("wire", "WIREFRAME"); m.thickness = H * 0.0009; m.use_replace = True
    w.color = (0.05, 0.05, 0.05, 1)
s = bpy.context.scene; s.render.engine = "BLENDER_WORKBENCH"
s.world = bpy.data.worlds.new("w"); s.world.color = (0.5, 0.5, 0.5)
sh = s.display.shading; sh.light = "STUDIO"; sh.color_type = "OBJECT"; sh.show_cavity = False
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.clip_start = 0.001
cam = bpy.data.objects.new("c", cd); s.collection.objects.link(cam); s.camera = cam
def axis(v):  # map canonical (x right, y depth, z up) to this file's axes when Y is up
    return Vector(v) if up == 2 else Vector((v[0], v[2], -v[1]))
def shoot(name, target, d, scale, res):
    d = axis(d).normalized(); cam.location = target + d * (H * 3)
    cam.rotation_euler = (-d).to_track_quat("-Z", "Z" if up == 2 else "Y").to_euler(); cd.ortho_scale = scale
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = os.path.join(out, f"{label}-{name}.png"); bpy.ops.render.render(write_still=True)
def at(x, z):  # point at fraction of width from centre and fraction of height from the feet
    p = Vector(c); p[0] = c[0] + x * (hi - lo)[0]; p[up] = lo[up] + z * H; return p
shoot("front", c, (0, -1, 0), H * 1.06, (800, 1200))
shoot("back", c, (0, 1, 0), H * 1.06, (800, 1200))
shoot("face", at(0, 0.915), (0, -1, 0), H * 0.2, (1000, 1000))
shoot("face-side", at(0, 0.915), (1, 0, 0), H * 0.2, (1000, 1000))
shoot("hand", at(0.44, 0.5), (0.3, -1, 0.2), H * 0.14, (1000, 1000))
shoot("shoulder", at(0.16, 0.76), (0.2, -1, 0.1), H * 0.26, (1000, 1000))
shoot("knee", at(0.05, 0.3), (0.3, -1, 0), H * 0.3, (1000, 1000))
