"""Cut away the faces of a piece that a wearable covers, so nothing of it can show through the wearable (a hair tip
through a hat). Use it on pieces that belong to one outfit, such as hat hair; shared body pieces (head, hands) are masked
per outfit instead, so they stay shared.
blender --background --python-exit-code 1 --python cut_covered.py -- <pieces.blend> <covered-object> <wearable-object> <out.blend> <report.json> [margin-cm]

The wearable is a hat-like piece open at the bottom. A vertex is covered when it is above the wearable's opening at its
angle around the opening's centre by more than `margin` (default 2 cm), and inside the wearable's surface (behind it along the nearest surface normal, and a
ray straight up meets the wearable from inside). A face is removed only when all its vertices are covered. The margin keeps the cut edge deep inside the wearable: a
cut right at the opening shows its ragged edge, and the wearable's inside, through the gap between head and brim."""
import bpy, bmesh, sys, json, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
src, covered_name, wearable_name, out, report_path = args[:5]
margin = (float(args[5]) if len(args) > 5 else 2.0) / 100.0
bpy.ops.wm.open_mainfile(filepath=src)
covered = bpy.data.objects[covered_name]; wearable = bpy.data.objects[wearable_name]
W = wearable.matrix_world
wt = BVHTree.FromPolygons([W @ v.co for v in wearable.data.vertices], [list(p.vertices) for p in wearable.data.polygons])
bw = bmesh.new(); bw.from_mesh(wearable.data)
ring = [W @ v.co for v in {v for e in bw.edges if e.is_boundary for v in e.verts}]; bw.free()
if not ring: raise SystemExit(f"{wearable_name} has no opening (no open border)")
rc = sum(ring, Vector()) / len(ring)
ring_by_angle = sorted((math.atan2(p.y - rc.y, p.x - rc.x), p.z) for p in ring)
def ring_height(v):
    a = math.atan2(v.y - rc.y, v.x - rc.x)
    return min(ring_by_angle, key=lambda t: min(abs(t[0] - a), 2 * math.pi - abs(t[0] - a)))[1]
def is_covered(v):
    if v.z < ring_height(v) + margin: return False
    loc, nor, _, _ = wt.find_nearest(v)
    if loc is None or (v - loc).dot(nor) > 0: return False
    up_loc, up_nor, _, _ = wt.ray_cast(v, Vector((0, 0, 1)))
    return up_loc is not None and up_nor.z > 0  # leaving the wearable through its outside: we are inside it

M = covered.matrix_world
bm = bmesh.new(); bm.from_mesh(covered.data); bm.verts.ensure_lookup_table()
cov = {v.index for v in bm.verts if is_covered(M @ v.co)}
gone = [f for f in bm.faces if all(v.index in cov for v in f.verts)]
before = len(bm.faces)
bmesh.ops.delete(bm, geom=gone, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(covered.data); bm.free()
report = {"marginCm": margin * 100, "covered": covered_name, "by": wearable_name, "facesBefore": before, "facesRemoved": len(gone), "facesLeft": before - len(gone), "coveredVertices": len(cov)}
bpy.ops.wm.save_as_mainfile(filepath=out)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
