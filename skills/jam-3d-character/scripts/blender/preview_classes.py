"""Show how the character spec's colour classes read the texture, before anything is baked or rigged.

Every face takes the class of its texture colour (charspec's one rule, the same the split, UV, bake and rig stages use) and
is drawn flat in that class's reference colour from the front, back, left and right. The report gives each class's share of
the surface and of the covered texels, and two warning shares: texels no `hsv` window holds (classed only by nearest
reference colour) and texels whose two nearest reference colours are nearly equally close (ambiguous). A class that took
faces from its neighbour, or a large ambiguous share, means a colour to resample or a window to set before going on.

blender --background --factory-startup --python-exit-code 1 --python preview_classes.py -- <model.fbx|.glb|.blend> <base_color.png> <out-dir> --character <character.json>
Writes <out-dir>/classes-<view>.png, classes-texture.png (the label map in texture space) and classes-report.json.
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec

(model, tex, out), spec = charspec.require()
os.makedirs(out, exist_ok=True)
AMBIGUOUS_RATIO = 1.25   # nearest reference within this factor of the second nearest (squared distance) is ambiguous

if model.endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=model)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    (bpy.ops.import_scene.gltf if model.endswith(".glb") else bpy.ops.import_scene.fbx)(filepath=model)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit(f"{model}: no mesh")

img = bpy.data.images.load(tex); W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, img.channels)[:, :, :3]
names = list(spec.classes)
labels, _ = spec.label_map(px, names)

# per-texel diagnostics over the texels some face covers
hue, sat, val = charspec._hsv_arrays(px)
windowed = np.zeros((H, W), dtype=bool)
for n in names:
    if spec.classes[n].get("hsv"):
        windowed |= charspec._window_test(hue, sat, val, spec.classes[n]["hsv"])
pa, pb = sat * np.cos(np.radians(hue)), sat * np.sin(np.radians(hue))
ref = np.array([spec.classes[n]["rgb"] for n in names], dtype=np.float32) / 255.0
rh, rs, rv = charspec._hsv_arrays(ref)
d = (pa[..., None] - rs * np.cos(np.radians(rh))) ** 2 + (pb[..., None] - rs * np.sin(np.radians(rh))) ** 2 + charspec.VALUE_WEIGHT * (val[..., None] - rv) ** 2
if len(names) > 1:
    two = np.sort(d, axis=-1)[..., :2]
    ambiguous = ~windowed & (two[..., 1] <= AMBIGUOUS_RATIO * np.maximum(two[..., 0], 1e-9))
else:
    ambiguous = np.zeros((H, W), dtype=bool)

covered = np.zeros((H, W), dtype=bool)
face_cls = {}; area = {n: 0.0 for n in names}
for ob in meshes:
    bm = bmesh.new(); bm.from_mesh(ob.data); uv = bm.loops.layers.uv.active
    if uv is None:
        raise SystemExit(f"{ob.name}: no UV layer to read the texture through")
    for f in bm.faces:
        cu = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
        pts = [cu] + [(l[uv].uv + cu) / 2 for l in f.loops]
        cols = []
        for p in pts:
            x = min(W - 1, max(0, int(p.x % 1.0 * W))); y = min(H - 1, max(0, int(p.y % 1.0 * H)))
            cols.append(px[y, x]); covered[y, x] = True
        c = spec.classify(tuple(float(v) for v in np.median(np.array(cols), axis=0)), names)
        face_cls[(ob.name, f.index)] = c; area[c] += f.calc_area()
    bm.free()

# draw: one flat material per class, unlit
mats = {}
for n in names:
    m = bpy.data.materials.new(f"class_{n}"); r, g, b = (x / 255.0 for x in spec.classes[n]["rgb"])
    m.diffuse_color = (r ** 2.2, g ** 2.2, b ** 2.2, 1); mats[n] = m
for ob in meshes:
    ob.data.materials.clear()
    for n in names: ob.data.materials.append(mats[n])
    for p in ob.data.polygons: p.material_index = names.index(face_cls[(ob.name, p.index)])
sc = bpy.context.scene; sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "FLAT"; sc.display.shading.color_type = "MATERIAL"
sc.display.shading.show_object_outline = False
sc.render.resolution_x, sc.render.resolution_y = 768, 1024
sc.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w"); sc.world = world; world.color = (0.18, 0.18, 0.18)
lo = Vector((min(v[i] for o in meshes for v in [o.matrix_world @ Vector(c) for c in o.bound_box]) for i in range(3)))
hi = Vector((max(v[i] for o in meshes for v in [o.matrix_world @ Vector(c) for c in o.bound_box]) for i in range(3)))
ctr = (lo + hi) / 2; size = max(hi - lo)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = size * 1.1
# the character's front faces -Y (Blender's glTF/FBX import of a Meshy model); views are named for the character
for view, direction in {"front": (0, -1, 0), "back": (0, 1, 0), "left": (1, 0, 0), "right": (-1, 0, 0)}.items():
    dv = Vector(direction); cam.location = ctr + dv * size * 3
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(out, f"classes-{view}.png"); bpy.ops.render.render(write_still=True)

# label map in texture space: each texel in its class's reference colour, uncovered texels dark
lab_rgb = (ref[labels] * 255).astype(np.uint8)
lab_rgb[~covered] = (lab_rgb[~covered] * 0.25).astype(np.uint8)
lab_rgb[ambiguous & covered] = (255, 0, 255)
out_img = bpy.data.images.new("labels", W, H, alpha=False)
a = np.ones((H, W, 4), dtype=np.float32); a[:, :, :3] = lab_rgb / 255.0; out_img.pixels[:] = a.ravel()
out_img.filepath_raw = os.path.join(out, "classes-texture.png"); out_img.file_format = "PNG"; out_img.save()

total_area = sum(area.values()) or 1.0; ncov = max(int(covered.sum()), 1)
faces = {n: sum(1 for c in face_cls.values() if c == n) for n in names}
report = {
    "blender": bpy.app.version_string, "character": spec.name, "model": os.path.basename(model), "texture": os.path.basename(tex),
    "classes": {n: {"faces": faces[n], "surfaceShare": round(area[n] / total_area, 4),
                    "texelShare": round(float((labels[covered] == i).sum()) / ncov, 4),
                    "rgb": spec.classes[n]["rgb"], "window": bool(spec.classes[n].get("hsv"))} for i, n in enumerate(names)},
    "texelsOutsideEveryWindow": round(float((~windowed & covered).sum()) / ncov, 4),
    "ambiguousTexels": round(float((ambiguous & covered).sum()) / ncov, 4),
    "ambiguousRatio": AMBIGUOUS_RATIO,
    "emptyClasses": [n for n in names if faces[n] == 0],
    "renders": [f"classes-{v}.png" for v in ("front", "back", "left", "right")] + ["classes-texture.png"],
}
json.dump(report, open(os.path.join(out, "classes-report.json"), "w"), indent=2)
print(json.dumps(report))
