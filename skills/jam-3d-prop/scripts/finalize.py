# Scale uniformly to a real height, turn the front to the profile's forward axis, place the pivot, bound embedded maps
# to a maximum size (aspect kept), export GLB, then re-read the export and write a JSON report of what it contains.
# Usage: blender --background --factory-startup --python-exit-code 1 --python finalize.py -- <src.glb> <out.glb> <report.json> <height_m> <max_texture_px> [--front-from -Y] [--front-to -Y] [--pivot bottom-center|center|bottom-origin]
# Axes are Blender's (Z up), which the glTF exporter converts to glTF's Y-up. --front-from is the axis the source
# model's front faces after import (generated meshes usually face -Y); --front-to is the profile's `forward`.
import bpy, sys, json, math
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index("--")+1:]
opts = {"--front-from": "-Y", "--front-to": "-Y", "--pivot": "bottom-center"}
pos = []
i = 0
while i < len(a):
    if a[i] in opts: opts[a[i]] = a[i+1]; i += 2
    else: pos.append(a[i]); i += 1
src, dst, report, height, texmax = pos[0], pos[1], pos[2], float(pos[3]), int(pos[4])
AXES = {"+X": 0, "+Y": 90, "-X": 180, "-Y": 270}   # heading in degrees about +Z
for k in ("--front-from", "--front-to"):
    if opts[k] not in AXES: sys.exit(f"{k} must be one of {list(AXES)}")
if opts["--pivot"] not in ("bottom-center", "center", "bottom-origin"): sys.exit("--pivot must be bottom-center, center or bottom-origin")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def bounds():
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx
mn, mx = bounds(); before = list(mx - mn)
turn = math.radians(AXES[opts["--front-to"]] - AXES[opts["--front-from"]])
xf = Matrix.Rotation(turn, 4, 'Z') @ Matrix.Scale(height / (mx.z - mn.z), 4)
for o in objs: o.data.transform(xf); o.data.update()
mn, mx = bounds()
off = {"bottom-center": Vector(((mn.x+mx.x)/2, (mn.y+mx.y)/2, mn.z)), "center": (mn+mx)/2, "bottom-origin": Vector((0, 0, mn.z))}[opts["--pivot"]]
for o in objs: o.data.transform(Matrix.Translation(-off)); o.data.update()
mn, mx = bounds()
uv = []
for o in objs:
    for layer in o.data.uv_layers:
        us = [d.uv for d in layer.data]; uv.append({"layer": layer.name, "min": [min(u.x for u in us), min(u.y for u in us)], "max": [max(u.x for u in us), max(u.y for u in us)]})
resized = []
for im in bpy.data.images:
    w, h = im.size
    if max(w, h) > texmax:
        f = texmax / max(w, h); nw, nh = max(1, round(w*f)), max(1, round(h*f))
        im.scale(nw, nh); im.pack(); resized.append({"image": im.name, "from": [w, h], "to": [nw, nh]})
materials = sorted({s.material.name for o in objs for s in o.material_slots if s.material})
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_apply=True)

# Verify what was actually written.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=dst)
exported = [{"image": im.name, "size": list(im.size)} for im in bpy.data.images if im.size[0]]
over = [e for e in exported if max(e["size"]) > texmax]
rep = {"blender": bpy.app.version_string, "source": src, "scale": height / (before[2] or 1), "turnDegrees": math.degrees(turn),
       "pivot": opts["--pivot"], "sizeBeforeMeters": before, "sizeAfterMeters": list(mx-mn), "minAfter": list(mn), "uvLayers": uv,
       "materials": materials, "maxTexture": texmax, "resizedImages": resized, "exportedImages": exported, "texturesWithinMax": not over}
json.dump(rep, open(report, 'w'), indent=2)
print("DONE", json.dumps({"after": rep["sizeAfterMeters"], "exportedImages": exported, "texturesWithinMax": not over}))
if over: sys.exit(f"exported images exceed {texmax}px: {over}")
