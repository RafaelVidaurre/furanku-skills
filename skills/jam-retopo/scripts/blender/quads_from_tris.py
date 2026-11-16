"""Recover the quads of a quad mesh that arrived as triangles (glTF stores triangles, split along UV seams).

blender --background --factory-startup --python-exit-code 1 --python quads_from_tris.py -- <model> <out-dir>
    [--name <stem>] [--min-quad-share F]

Vertices at the same place are welded (UVs live per face corner, so the layout survives) and triangle pairs are
joined back into quads, without crossing material borders. Writes <out-dir>/<stem>.blend, which keeps the quads
for unwrapping, rigging or editing, and <out-dir>/quads-report.json. Exits 1 when the quad share of the result is
under --min-quad-share (default 0.9): the mesh was not a quad mesh, and joining triangles gives it no edge flow.
"""
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamscene as js  # noqa: E402

p = js.parser(__doc__)
p.add_argument("model")
p.add_argument("out_dir")
p.add_argument("--name")
p.add_argument("--min-quad-share", type=float, default=0.9)
args = js.parse(p)
out = js.out_dir(args.out_dir)
name = js.stem(args.model, args.name)

objects = js.load(args.model)
js.apply_transforms(objects)
low, high = js.bounds(objects)
diagonal = (high - low).length or 1.0
before = js.face_stats(objects)
defects = {"openEdges": 0, "nonManifoldEdges": 0}
for ob in objects:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=diagonal * 1e-6)
    bmesh.ops.join_triangles(bm, faces=bm.faces, angle_face_threshold=3.1416, angle_shape_threshold=3.1416, cmp_seam=False, cmp_sharp=False, cmp_uvs=False, cmp_vcols=False, cmp_materials=True)
    defects["openEdges"] += sum(1 for e in bm.edges if e.is_boundary)
    defects["nonManifoldEdges"] += sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    bm.to_mesh(ob.data)
    bm.free()
    for poly in ob.data.polygons:
        poly.use_smooth = True
after = dict(js.face_stats(objects), **defects)
js.save_blend(js.inside(out, f"{name}.blend"))
problems = []
if after["quadShare"] < args.min_quad_share:
    problems.append(f"only {after['quadShare']:.0%} of the faces are quads (at least {args.min_quad_share:.0%} expected of a quad mesh)")
js.write_report(out, "quads-report.json", {"blender": bpy.app.version_string, "source": os.path.basename(args.model), "editable": f"{name}.blend",
                                           "before": before, "after": after, "problems": problems})
print("QUADS", {"before": before["faces"], "after": after, "problems": problems})
if problems:
    js.fail("; ".join(problems))
