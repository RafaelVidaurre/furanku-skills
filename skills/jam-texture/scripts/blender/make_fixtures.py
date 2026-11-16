"""Generate the small models the Blender tests of this skill run on (nothing binary is kept in the repository).

blender --background --factory-startup --python-exit-code 1 --python make_fixtures.py -- <out-dir>

Writes source.glb (a sphere with a coloured grid texture), target.glb (a coarser sphere of the same size with its
own UVs and no texture), bare.glb (the target without UVs) and moved.glb (the bare target scaled 1.3 times and moved).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

out = js.out_dir(sys.argv[sys.argv.index("--") + 1])


def sphere(subdivisions, uvs):
    js.empty_scene()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=0.5)
    ob = bpy.context.active_object
    for poly in ob.data.polygons:
        poly.use_smooth = True
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    if uvs:
        ob.data.uv_layers.new(name="UVMap")
        js.select([ob])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    return ob


source = sphere(4, True)
grid = bpy.data.images.new("grid", 256, 256)
grid.generated_type = "COLOR_GRID"
grid.filepath_raw = js.inside(out, "grid.png")
grid.file_format = "PNG"
grid.save()
material = js.new_material("painted")
texture = material.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = bpy.data.images.load(grid.filepath_raw)
shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
shader.inputs["Roughness"].default_value = 0.4
source.data.materials.append(material)
js.export_glb(js.inside(out, "source.glb"), [source])

js.export_glb(js.inside(out, "target.glb"), [sphere(3, True)])
bare = sphere(3, False)
js.export_glb(js.inside(out, "bare.glb"), [bare])
bare.data.transform(Matrix.Translation((0.4, 0.1, -0.2)) @ Matrix.Scale(1.3, 4))
js.export_glb(js.inside(out, "moved.glb"), [bare])
print("FIXTURES", sorted(os.listdir(out)))
