"""Helpers the Blender scripts of jam-retopo, jam-uv and jam-texture share: arguments, loading any model format,
confined output paths, reports, and stills from fixed views.

Each skill ships an identical copy of this file so it works when installed alone; test_glb.py fails when the copies
differ. Axes: Blender's importers turn every format to Z up with the model's front facing -Y (glTF +Z).
(A glTF mesh's left is therefore +X here, and the "left" view looks at the model's left side.)
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

# camera direction (from the subject toward the camera), in Blender axes
VIEWS = {
    "front": (0, -1, 0), "back": (0, 1, 0), "left": (1, 0, 0), "right": (-1, 0, 0),
    "three-quarter": (0.72, -0.72, 0.38), "back-three-quarter": (-0.72, 0.72, 0.38),
    "top": (0, -0.001, 1), "under": (0.45, -0.55, -0.7),
}
DEFAULT_VIEWS = "front,back,left,right,three-quarter,top"


def fail(message, code=1):
    print(f"error: {message}", file=sys.stderr)
    sys.stderr.flush()
    sys.exit(code)


def parse(parser):
    """Parse the arguments after `--`; wrong input exits 2 with argparse's message."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def parser(description):
    return argparse.ArgumentParser(prog="blender ... --python <script> --", description=description, formatter_class=argparse.RawDescriptionHelpFormatter)


def add_view_arguments(p, default=DEFAULT_VIEWS):
    p.add_argument("--views", default=default, help=f"comma-separated views from: {', '.join(VIEWS)} (default {default})")
    p.add_argument("--focus", action="append", default=[], metavar="NAME=X,Y,Z,SIZE",
                   help="extra close-up: centre as shares of the bounding box (0-1, X right, Y up from the base, Z depth from the front) and size as a share of the height; repeat per close-up")
    p.add_argument("--resolution", type=int, default=900, help="pixels on the long side of each still (default 900)")


def out_dir(path):
    path = os.path.abspath(path)
    os.makedirs(path, exist_ok=True)
    return path


def inside(folder, name):
    """A path for `name` inside the output folder; anything that would land outside it is refused."""
    path = os.path.abspath(os.path.join(folder, name))
    if os.path.commonpath([path, os.path.abspath(folder)]) != os.path.abspath(folder):
        fail(f"{name} would be written outside the output folder {folder}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def write_report(folder, name, data):
    path = inside(folder, name)
    with open(path, "w") as handle:
        json.dump(data, handle, indent=2)
    return path


def stem(path, name=None):
    return name or os.path.splitext(os.path.basename(path))[0]


def empty_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path, reset=True):
    """Import a .glb, .gltf, .fbx, .obj or .blend and return its mesh objects (sorted by name)."""
    if not os.path.isfile(path):
        fail(f"no such model file: {path}", 2)
    ext = os.path.splitext(path)[1].lower()
    if reset:
        empty_scene()
    before = set(bpy.data.objects)
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        fail(f"unsupported model format {ext or '(none)'}: use .glb, .gltf, .fbx, .obj or .blend", 2)
    meshes = sorted((o for o in bpy.data.objects if o not in before and o.type == "MESH" and len(o.data.polygons)), key=lambda o: o.name)
    if not meshes:
        fail(f"{path} holds no mesh with faces", 2)
    bpy.context.view_layer.update()
    return meshes


def select(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def apply_transforms(objects):
    """Bake object transforms into the mesh data, so later maths can use vertex coordinates directly."""
    for ob in objects:
        if ob.parent is not None:
            world = ob.matrix_world.copy()
            ob.parent = None
            ob.matrix_world = world
        if ob.data.users > 1:
            ob.data = ob.data.copy()
    bpy.context.view_layer.update()
    select(objects)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(objects):
    points = [ob.matrix_world @ v.co for ob in objects for v in ob.data.vertices]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    return low, high


def triangle_count(objects):
    return sum(len(p.vertices) - 2 for ob in objects for p in ob.data.polygons)


def face_stats(objects):
    """Polygon counts as the file holds them (a .blend, .fbx or .obj keeps quads; glTF holds triangles)."""
    sizes = [len(p.vertices) for ob in objects for p in ob.data.polygons]
    faces = len(sizes)
    quads = sum(1 for s in sizes if s == 4)
    return {"faces": faces, "triangles": sum(1 for s in sizes if s == 3), "quads": quads, "ngons": sum(1 for s in sizes if s > 4),
            "quadShare": round(quads / faces, 4) if faces else 0.0, "exportTriangles": sum(s - 2 for s in sizes),
            "vertices": sum(len(ob.data.vertices) for ob in objects)}


def new_material(name):
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    return material


def surface(objects):
    """(BVH tree of the objects' faces, their vertex positions) in world space."""
    from mathutils.bvhtree import BVHTree
    points, faces = [], []
    for ob in objects:
        base = len(points)
        points += [tuple(ob.matrix_world @ v.co) for v in ob.data.vertices]
        faces += [tuple(base + i for i in poly.vertices) for poly in ob.data.polygons]
    return BVHTree.FromPolygons(points, faces), points


def deviation(objects, source_tree, source_points):
    """How far two surfaces lie apart, as shares of the source's bounding diagonal: candidate vertices to the source
    surface (bulges) and source samples to the candidate surface (lost parts)."""
    tree, points = surface(objects)
    lows = [min(p[i] for p in source_points) for i in range(3)]
    highs = [max(p[i] for p in source_points) for i in range(3)]
    diagonal = Vector([highs[i] - lows[i] for i in range(3)]).length or 1.0
    samples = source_points[::max(1, len(source_points) // 20000)]
    distances = sorted([source_tree.find_nearest(p)[3] for p in points[::max(1, len(points) // 20000)]] + [tree.find_nearest(p)[3] for p in samples])
    return {"max": round(distances[-1] / diagonal, 5), "p95": round(distances[int(len(distances) * 0.95)] / diagonal, 5),
            "mean": round(sum(distances) / len(distances) / diagonal, 6)}


def fit(objects, source_tree, source_points, rounds=12):
    """Scale (uniformly) and move the objects onto the source surface: bounding boxes first, then repeated
    nearest-point matching. Their transforms must be applied. Returns the total scale and offset."""
    import numpy as np
    from mathutils import Matrix
    low, high = bounds(objects)
    src = np.array(source_points)
    s_low, s_high = src.min(axis=0), src.max(axis=0)
    axis = int(np.argmax(s_high - s_low))
    scale = float((s_high - s_low)[axis] / max((high - low)[axis], 1e-12))
    centre, s_centre = (low + high) / 2, Vector((s_low + s_high) / 2)
    total = Matrix.Translation(s_centre) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-centre)
    for ob in objects:
        ob.data.transform(total)
    for _ in range(rounds):
        points = np.array([v.co[:] for ob in objects for v in ob.data.vertices][::max(1, sum(len(ob.data.vertices) for ob in objects) // 20000)])
        nearest = np.array([source_tree.find_nearest(Vector(p))[0][:] for p in points])
        p_mean, n_mean = points.mean(axis=0), nearest.mean(axis=0)
        step = float(((points - p_mean) * (nearest - n_mean)).sum() / max(((points - p_mean) ** 2).sum(), 1e-20))
        move = Matrix.Translation(Vector(n_mean)) @ Matrix.Scale(step, 4) @ Matrix.Translation(Vector(-p_mean))
        for ob in objects:
            ob.data.transform(move)
        total = move @ total
        if abs(step - 1.0) < 1e-6:
            break
    for ob in objects:
        ob.data.update()
    return {"scale": round(total.to_scale()[0], 6), "offset": [round(v, 6) for v in total.to_translation()]}


def export_glb(path, objects, skins=False):
    select(objects)
    extra = [o for o in bpy.data.objects if o.type == "ARMATURE"] if skins else []
    for ob in extra:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=not skins,
                              export_skins=skins, export_animations=False, export_yup=True)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)


def _camera(scene):
    data = bpy.data.cameras.new("jam-camera")
    data.type = "ORTHO"
    camera = bpy.data.objects.new("jam-camera", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def grey_world(scene, value=0.5, strength=1.0):
    world = bpy.data.worlds.new("jam-world")
    scene.world = world
    world.color = (value, value, value)
    try:
        world.use_nodes = True
    except Exception:
        pass
    if world.node_tree and "Background" in world.node_tree.nodes:
        node = world.node_tree.nodes["Background"]
        node.inputs[0].default_value = (value, value, value, 1)
        node.inputs[1].default_value = strength
    return world


def shots(objects, views, focus):
    """[(name, target, direction, ortho scale, aspect)] for the named fixed views and focus close-ups."""
    low, high = bounds(objects)
    size = high - low
    centre = (low + high) / 2
    out = []
    for name in [v.strip() for v in views.split(",") if v.strip()]:
        if name not in VIEWS:
            fail(f"unknown view {name!r}: choose from {', '.join(VIEWS)}", 2)
        direction = Vector(VIEWS[name]).normalized()
        right = Vector((0, 0, 1)).cross(direction)
        right = right.normalized() if right.length > 1e-3 else Vector((1, 0, 0))
        up = direction.cross(right).normalized()
        corners = [Vector((x, y, z)) - centre for x in (low.x, high.x) for y in (low.y, high.y) for z in (low.z, high.z)]
        width = 2 * max(abs(c.dot(right)) for c in corners) or 1e-3
        height = 2 * max(abs(c.dot(up)) for c in corners) or 1e-3
        out.append((name, centre, direction, width * 1.08, height * 1.08))
    for item in focus:
        name, _, numbers = item.partition("=")
        try:
            x, y, z, share = (float(n) for n in numbers.split(","))
        except ValueError:
            fail(f"--focus takes NAME=X,Y,Z,SIZE with four numbers; got {item!r}", 2)
        target = Vector((low.x + x * size.x, low.y + z * size.y, low.z + y * size.z))
        span = max(share * size.z, 1e-3)
        out.append((name, target, Vector((0.35, -1, 0.2)).normalized(), span, span))
    return out


def render_views(objects, folder, label, views=DEFAULT_VIEWS, focus=(), resolution=900):
    """Render the named views of the scene as it is set up (engine, materials, light). Returns the file names."""
    scene = bpy.context.scene
    camera = scene.camera or _camera(scene)
    low, high = bounds(objects)
    reach = max((high - low).length, 1e-3)
    camera.data.clip_start = reach * 0.01
    camera.data.clip_end = reach * 10
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    written = []
    for name, target, direction, width, height in shots(objects, views, focus):
        camera.location = target + direction * reach * 3
        camera.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
        camera.data.ortho_scale = max(width, height)
        if width >= height:
            scene.render.resolution_x, scene.render.resolution_y = resolution, max(16, round(resolution * height / width))
        else:
            scene.render.resolution_x, scene.render.resolution_y = max(16, round(resolution * width / height)), resolution
        scene.render.resolution_percentage = 100
        file_name = f"{label}-{name}.png"
        scene.render.filepath = inside(folder, file_name)
        bpy.ops.render.render(write_still=True)
        written.append(file_name)
    return written


def contact_sheet(folder, files, name, row_height=420, row_width=1680):
    """One image holding every still at the same height, so a reviewer opens one file."""
    import numpy as np
    grey = (0.5, 0.5, 0.5, 1.0)
    rows, row, used = [], [], 0
    for file_name in files:
        image = bpy.data.images.load(os.path.join(folder, file_name))
        width, height = image.size
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)[::-1]
        bpy.data.images.remove(image)
        scale = row_height / height
        new_w = max(1, min(row_width, round(width * scale)))
        tile = pixels[(np.arange(row_height) / scale).astype(int).clip(0, height - 1)][:, (np.arange(new_w) * width / new_w).astype(int).clip(0, width - 1)]
        if row and used + new_w > row_width:
            rows.append(row)
            row, used = [], 0
        row.append(tile)
        used += new_w + 8
    if row:
        rows.append(row)
    if not rows:
        return None
    strips = []
    for row in rows:
        gap = np.full((row_height, 8, 4), grey, dtype=np.float32)
        strips.append(np.concatenate([part for tile in row for part in (tile, gap)][:-1], axis=1))
    width = max(strip.shape[1] for strip in strips)
    padded = [np.concatenate([strip, np.full((row_height, width - strip.shape[1], 4), grey, dtype=np.float32)], axis=1) for strip in strips]
    sheet = np.concatenate([part for strip in padded for part in (strip, np.full((8, width, 4), grey, dtype=np.float32))][:-1], axis=0)
    image = bpy.data.images.new("jam-sheet", sheet.shape[1], sheet.shape[0], alpha=False)
    image.pixels[:] = sheet[::-1].ravel()
    image.filepath_raw = inside(folder, name)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    return name


def workbench(scene, light="STUDIO", color="OBJECT"):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = light
    scene.display.shading.color_type = color
    scene.display.shading.show_cavity = False
    scene.display.shading.show_shadows = False
    scene.view_settings.view_transform = "Standard"


def cycles(scene, samples=32):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "Standard"


def sun(scene, energy=3.0, elevation=50, heading=-35):
    data = bpy.data.lights.new("jam-sun", "SUN")
    data.energy = energy
    data.angle = math.radians(5)
    lamp = bpy.data.objects.new("jam-sun", data)
    direction = Vector((math.sin(math.radians(heading)) * math.cos(math.radians(elevation)),
                        -math.cos(math.radians(heading)) * math.cos(math.radians(elevation)), math.sin(math.radians(elevation))))
    lamp.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(lamp)
    return lamp
