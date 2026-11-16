"""Generate the small models the Blender tests of this skill run on (nothing binary is kept in the repository).

blender --background --factory-startup --python-exit-code 1 --python make_fixtures.py -- <out-dir>

Writes box.glb (a cube with two materials and no UVs), tube.glb (an open tube), capsule.glb (a closed, smooth
shape) and tube-hints.json (one loop around the tube's middle).
"""
import json
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

out = js.out_dir(sys.argv[sys.argv.index("--") + 1])


def export(name, ob, keep_uvs=False):
    while ob.data.uv_layers and not keep_uvs:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    js.export_glb(js.inside(out, name), [ob])


js.empty_scene()
bpy.ops.mesh.primitive_cube_add(size=1.0)
box = bpy.context.active_object
for label, colour in (("wood", (0.5, 0.3, 0.1, 1)), ("metal", (0.6, 0.6, 0.65, 1))):
    material = js.new_material(label)
    material.diffuse_color = colour
    box.data.materials.append(material)
box.data.polygons[0].material_index = 1
export("box.glb", box)

js.empty_scene()
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.2, depth=1.0, end_fill_type="NOTHING")
tube = bpy.context.active_object
bm = bmesh.new()
bm.from_mesh(tube.data)
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.5], cuts=7)
bm.to_mesh(tube.data)
bm.free()
for poly in tube.data.polygons:
    poly.use_smooth = True
export("tube.glb", tube)
with open(js.inside(out, "tube-hints.json"), "w") as handle:      # glTF axes: the tube stands along +Y
    json.dump({"space": "gltf", "loops": [{"name": "middle", "at": [0, 0.03, 0], "axis": [0, 1, 0]}]}, handle)

js.empty_scene()
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.3)
capsule = bpy.context.active_object
capsule.scale = (1, 1, 2)
for poly in capsule.data.polygons:
    poly.use_smooth = True
js.apply_transforms([capsule])
export("capsule.glb", capsule)
print("FIXTURES", sorted(os.listdir(out)))
