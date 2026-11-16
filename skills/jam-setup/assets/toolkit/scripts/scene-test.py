"""Stand models together on a floor beside a figure of human height and render them, to judge real size and
whether a set belongs together.

blender --background --factory-startup --python-exit-code 1 --python <toolkit>/scripts/scene-test.py -- <spec.json> <out-dir>

or, with the project's Blender: jam blender --factory-startup toolkit:scene-test.py -- <spec.json> <out-dir>

spec.json (metres; degrees about the up axis; x to the right and z toward the viewer on the floor, glTF's axes):
  {"models": [{"file": "chair.glb", "x": 0, "z": 0, "turn": 0}, ...],
   "figureHeight": 1.8,                  the reference figure's height; 0 for none
   "camera": {"position": [x, y, z], "target": [x, y, z], "fov": 60},   optional: the game's own camera
   "resolution": [1600, 900]}
File paths are relative to the spec. A bare list is read as "models". A model whose front faces +Z at turn 0
faces +X at 90.

Writes <out-dir>/scene-front.png and scene-overview.png framed to everything placed, scene-camera.png when a camera
is given, and scene-report.json with each model's size in metres.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) != 2:
    sys.exit("error: usage: scene-test.py -- <spec.json> <out-dir>")
spec_path, out = Path(argv[0]).resolve(), Path(argv[1]).resolve()
try:
    spec = json.loads(spec_path.read_text())
except (OSError, ValueError) as error:
    sys.exit(f"error: cannot read {spec_path}: {error}")
if isinstance(spec, list):
    spec = {"models": spec}
if not spec.get("models"):
    sys.exit('error: the spec needs "models": [{"file": ...}]')
out.mkdir(parents=True, exist_ok=True)
figure_height = float(spec.get("figureHeight", 1.8))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
meshes, sizes = [], []
for item in spec["models"]:
    path = (spec_path.parent / item["file"]).resolve()
    if not path.is_file():
        sys.exit(f"error: no such model: {path}")
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in scene.objects if o not in before]
    # floor coordinates in glTF axes: x right, z toward the viewer (Blender -Y)
    place = Matrix.Translation((item.get("x", 0), -item.get("z", 0), 0)) @ Matrix.Rotation(math.radians(item.get("turn", 0)), 4, "Z")
    for ob in new:
        if ob.parent is None:
            ob.matrix_world = place @ ob.matrix_world
    bpy.context.view_layer.update()
    own = [o for o in new if o.type == "MESH"]
    corners = [o.matrix_world @ Vector(c) for o in own for c in o.bound_box]
    low = Vector([min(c[i] for c in corners) for i in range(3)])
    high = Vector([max(c[i] for c in corners) for i in range(3)])
    sizes.append({"file": item["file"], "width": round(high.x - low.x, 4), "height": round(high.z - low.z, 4), "depth": round(high.y - low.y, 4),
                  "lowestPoint": round(low.z, 4)})
    meshes += own
corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])


def material(name, colour):
    new = bpy.data.materials.new(name)
    if new.node_tree is None:
        new.use_nodes = True
    new.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*colour, 1)
    return new


if figure_height > 0:
    radius = figure_height * 0.1
    x, y = low.x - 3 * radius, (low.y + high.y) / 2
    blue = material("figure", (0.2, 0.45, 0.8))
    body = figure_height * 0.86
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=body, location=(x, y, body / 2))
    bpy.context.active_object.data.materials.append(blue)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=figure_height * 0.07, location=(x, y, figure_height * 0.93))
    bpy.context.active_object.data.materials.append(blue)
    low = Vector((min(low.x, x - radius), min(low.y, y - radius), min(low.z, 0)))
    high = Vector((max(high.x, x + radius), max(high.y, y + radius), max(high.z, figure_height)))
centre, extent = (low + high) / 2, high - low
size = max(extent)
bpy.ops.mesh.primitive_plane_add(size=size * 4, location=(centre.x, centre.y, 0))
bpy.context.active_object.data.materials.append(material("floor", (0.35, 0.33, 0.3)))
world = bpy.data.worlds.new("world")
scene.world = world
if world.node_tree is None:
    world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.55, 0.6, 1)
lamp = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
lamp.data.energy = 3.0
lamp.rotation_euler = (math.radians(45), 0, math.radians(35))
scene.collection.objects.link(lamp)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "Standard"
scene.render.resolution_x, scene.render.resolution_y = spec.get("resolution", [1600, 900])
camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
scene.collection.objects.link(camera)
scene.camera = camera
aspect = scene.render.resolution_x / scene.render.resolution_y
written = []


def shot(name, location, target, fov=None, ortho=None):
    camera.location = Vector(location)
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        camera.data.type, camera.data.ortho_scale = "ORTHO", ortho
    else:
        camera.data.type, camera.data.angle = "PERSP", math.radians(fov)
    camera.data.clip_end = size * 100
    scene.render.filepath = str(out / f"scene-{name}.png")
    bpy.ops.render.render(write_still=True)
    written.append(f"scene-{name}.png")


shot("front", (centre.x, low.y - size * 3, centre.z), centre, ortho=max(extent.x, extent.z * aspect) * 1.15)
distance = size * 0.75 / math.tan(math.radians(25)) + size / 2
shot("overview", centre + Vector((-0.5, -1.0, 0.6)).normalized() * distance, centre, fov=50)
view = spec.get("camera")
if view:
    blender = lambda p: (p[0], -p[2], p[1])     # glTF (x, y up, z) to Blender
    shot("camera", blender(view["position"]), blender(view["target"]), fov=view.get("fov", 60))
(out / "scene-report.json").write_text(json.dumps({"blender": bpy.app.version_string, "figureHeight": figure_height, "models": sizes, "stills": written}, indent=2))
print("SCENE", json.dumps({"models": sizes, "stills": written}))
