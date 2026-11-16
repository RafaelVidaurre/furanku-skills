"""Bring a model to delivery conventions in one pass: real size, front direction, pivot, textures within a size.

blender --background --factory-startup --python-exit-code 1 --python <toolkit>/scripts/normalize-model.py -- \
  <source> <destination.glb> <report.json> [--height METERS | --scale F] [--front-from AXIS] [--front-to AXIS]
  [--pivot bottom-center|center|bottom-origin|keep] [--max-texture-size N]

or, with the project's Blender: jam blender --factory-startup toolkit:normalize-model.py -- <the same arguments>

<source> is a .glb, .gltf, .fbx or .obj. Axes are glTF's, as the file itself reads: +Y up, and a delivered model
faces +Z. --front-from is the axis the source's front faces now (+Z, -Z, +X or -X; find it on a front still);
--front-to is where it should face (default +Z; pass another only when `jam engine facts authoring.<budget>.forward`
names one). --height scales uniformly to that many metres tall; --scale multiplies instead. --pivot places the
origin (default bottom-center: on the ground under the middle). --max-texture-size bounds every map on both sides,
keeping its aspect.

The export is read back and described in the report: size in metres before and after, the lowest point, UV sets,
materials and each exported image's pixel size. Exits 1 when an exported image is over --max-texture-size.
This spans the topology, UV and texture steps of a recipe when a generated model already meets its budgets.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
options = {"--height": None, "--scale": None, "--front-from": "+Z", "--front-to": "+Z", "--pivot": "bottom-center", "--max-texture-size": None}
positional, index = [], 0
while index < len(argv):
    if argv[index] in options:
        if index + 1 >= len(argv):
            sys.exit(f"error: {argv[index]} needs a value")
        options[argv[index]] = argv[index + 1]
        index += 2
    elif argv[index].startswith("--"):
        sys.exit(f"error: unknown option {argv[index]}; options are {', '.join(options)}")
    else:
        positional.append(argv[index])
        index += 1
if len(positional) != 3:
    sys.exit("error: usage: normalize-model.py -- <source> <destination.glb> <report.json> [options]")
source, destination, report_path = (str(Path(p).resolve()) for p in positional)
# heading about the up axis, in degrees, of each glTF axis as it lies in Blender after import (glTF +Z is Blender -Y)
HEADING = {"+X": 0, "-Z": 90, "-X": 180, "+Z": 270}
for key in ("--front-from", "--front-to"):
    if options[key] not in HEADING:
        sys.exit(f"error: {key} must be one of {', '.join(HEADING)} (glTF axes; +Y is up)")
if options["--pivot"] not in ("bottom-center", "center", "bottom-origin", "keep"):
    sys.exit("error: --pivot must be bottom-center, center, bottom-origin or keep")
if options["--height"] and options["--scale"]:
    sys.exit("error: pass --height or --scale, not both")
limit = int(options["--max-texture-size"]) if options["--max-texture-size"] else None

bpy.ops.wm.read_factory_settings(use_empty=True)
extension = Path(source).suffix.lower()
if extension in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=source)
elif extension == ".fbx":
    bpy.ops.import_scene.fbx(filepath=source)
elif extension == ".obj":
    bpy.ops.wm.obj_import(filepath=source)
else:
    sys.exit(f"error: unsupported format {extension or '(none)'}: use .glb, .gltf, .fbx or .obj")
objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objects:
    sys.exit(f"error: {source} holds no mesh")
if any(o.type == "ARMATURE" for o in bpy.context.scene.objects):
    sys.exit("error: this model is rigged; scale and orientation of a rigged model belong to the rig step")
for ob in objects:
    world = ob.matrix_world.copy()
    ob.parent = None
    ob.matrix_world = world
bpy.context.view_layer.update()
for ob in bpy.context.scene.objects:
    ob.select_set(ob.type == "MESH")
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds():
    points = [v.co for ob in objects for v in ob.data.vertices]
    return Vector([min(p[i] for p in points) for i in range(3)]), Vector([max(p[i] for p in points) for i in range(3)])


low, high = bounds()
before = high - low
scale = float(options["--height"]) / before.z if options["--height"] else float(options["--scale"] or 1.0)
turn = math.radians(HEADING[options["--front-to"]] - HEADING[options["--front-from"]])
transform = Matrix.Rotation(turn, 4, "Z") @ Matrix.Scale(scale, 4)
for ob in objects:
    ob.data.transform(transform)
low, high = bounds()
offset = {"bottom-center": Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z)), "center": (low + high) / 2,
          "bottom-origin": Vector((0, 0, low.z)), "keep": Vector((0, 0, 0))}[options["--pivot"]]
for ob in objects:
    ob.data.transform(Matrix.Translation(-offset))
    ob.data.update()
low, high = bounds()
resized = []
if limit:
    for image in bpy.data.images:
        width, height = image.size
        if max(width, height) > limit:
            factor = limit / max(width, height)
            new = (max(1, round(width * factor)), max(1, round(height * factor)))
            image.scale(*new)
            image.pack()
            resized.append({"image": image.name, "from": [width, height], "to": list(new)})
Path(destination).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=destination, export_format="GLB", export_image_format="AUTO", export_apply=True, use_selection=True, export_yup=True)

# describe what was actually written
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=destination)
written = [o for o in bpy.context.scene.objects if o.type == "MESH"]
exported = [{"image": image.name, "size": list(image.size)} for image in bpy.data.images if image.size[0]]
over = [e for e in exported if limit and max(e["size"]) > limit]
gltf = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]       # Blender (x, y, z) as glTF (x, y up, z front)
report = {"blender": bpy.app.version_string, "source": Path(source).name, "destination": Path(destination).name,
          "scale": round(scale, 6), "turnDegrees": round(math.degrees(turn), 3), "frontFrom": options["--front-from"], "frontTo": options["--front-to"],
          "pivot": options["--pivot"],
          "sizeBeforeMeters": {"width": round(before.x, 5), "height": round(before.z, 5), "depth": round(before.y, 5)},
          "sizeAfterMeters": {"width": round(high.x - low.x, 5), "height": round(high.z - low.z, 5), "depth": round(high.y - low.y, 5)},
          "lowestPoint": gltf(low), "highestPoint": gltf(high),
          "uvSets": sorted({layer.name for ob in written for layer in ob.data.uv_layers}),
          "materials": sorted({slot.material.name for ob in written for slot in ob.material_slots if slot.material}),
          "maxTextureSize": limit, "resizedImages": resized, "exportedImages": exported, "texturesWithinMax": not over}
Path(report_path).parent.mkdir(parents=True, exist_ok=True)
Path(report_path).write_text(json.dumps(report, indent=2))
print("NORMALIZED", json.dumps({"sizeAfterMeters": report["sizeAfterMeters"], "exportedImages": exported, "texturesWithinMax": not over}))
if over:
    sys.exit(f"error: exported images are over {limit} px: {over}")
