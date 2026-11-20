"""Generate the small models the Blender tests of this skill run on (nothing binary is kept in the repository).

blender --background --factory-startup --python-exit-code 1 --python make_fixtures.py -- <out-dir>

Writes dense.glb (a bumpy closed blob, 5,120 triangles), quad-tris.glb (a quad cylinder stored as triangles,
as glTF does), rest.glb and bent.glb (the same tube straight and bent, for the stretch measure).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

out = js.out_dir(sys.argv[sys.argv.index("--") + 1])


def export(name, ob):
    js.export_glb(js.inside(out, name), [ob])


js.empty_scene()
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1.0)
blob = bpy.context.active_object
for vertex in blob.data.vertices:
    p = vertex.co
    vertex.co = p * (1.0 + 0.12 * math.sin(5 * p.x) * math.cos(4 * p.y) + 0.08 * math.sin(7 * p.z))
export("dense.glb", blob)

js.empty_scene()
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.3, depth=2.0, end_fill_type="NOTHING")
tube = bpy.context.active_object
bm = bmesh.new()
bm.from_mesh(tube.data)
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1.0], cuts=15)
bm.to_mesh(tube.data)
bm.free()
export("quad-tris.glb", tube)
export("rest.glb", tube)
for vertex in tube.data.vertices:          # bend the upper half sharply about the middle, as an elbow does
    p = vertex.co
    if p.z > 0:
        angle = math.radians(100) * min(1.0, p.z / 0.15)
        vertex.co = Vector((p.x, p.y * math.cos(angle) - p.z * math.sin(angle), p.y * math.sin(angle) + p.z * math.cos(angle)))
export("bent.glb", tube)
print("FIXTURES", sorted(os.listdir(out)))
