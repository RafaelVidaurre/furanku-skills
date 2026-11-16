"""Add named convex collision hulls to a static model and export it for import. Runs in Blender.

blender -b --factory-startup --python-exit-code 1 -P ucx_collision.py -- <model.glb> <out.glb> <spec.json | JSON text> [--prefix UCX_]
spec: {"boxes": [[xmin,ymin,zmin,xmax,ymax,zmax], ...], "prisms": [[cx,cy,radius,zmin,zmax,sides], ...], "hullBelow": z, "merge": m}
Each shape becomes one convex hull named <prefix><mesh> (numbered _01, _02 when there are several), in metres, in the
model's own frame as Blender shows it (Z up, front -Y). A hull over 48 points has its points merged within m metres
(default 0.012) and is rebuilt. The engine pairs hulls with the render mesh by that name on import.
Writes <out.glb> and, beside it, <out>.collision.json listing each hull's name, point count and bounds.
"""
import json
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from jam_unreal import hulls  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
prefix = "UCX_"
if "--prefix" in args:
    i = args.index("--prefix"); prefix = args[i + 1]; del args[i:i + 2]
src, out, spec = args[:3]
if os.path.isfile(spec):
    with open(spec, encoding="utf-8") as f:
        spec = f.read()
spec = hulls.validate(json.loads(spec))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if len(meshes) != 1:
    raise SystemExit("expected one mesh object in %s, found %d: join them, or add collision per file" % (src, len(meshes)))
o = meshes[0]
mesh_points = [tuple(o.matrix_world @ v.co) for v in o.data.vertices]
shapes = hulls.shape_points(spec, mesh_points)
names = hulls.hull_names(o.name, len(shapes), prefix)
report = []
for name, points in zip(names, shapes):
    if len(points) < 4:
        raise SystemExit("%s has %d points: a hull needs at least 4" % (name, len(points)))
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    if len(bm.verts) > hulls.MAX_HULL_POINTS:
        # Keep the hull light: merge close points, then rebuild it.
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=spec.get('merge', hulls.DEFAULT_MERGE))
        bmesh.ops.convex_hull(bm, input=bm.verts)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    h = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(h)
    lo, hi = hulls.bounds([tuple(v.co) for v in me.vertices])
    report.append({"name": name, "points": len(me.vertices), "min": [round(x, 4) for x in lo], "max": [round(x, 4) for x in hi]})
    print('collision', name, len(me.vertices), 'verts', report[-1]["min"], report[-1]["max"])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
with open(os.path.splitext(out)[0] + ".collision.json", "w", encoding="utf-8") as f:
    json.dump({"mesh": o.name, "hulls": report}, f, indent=1)
