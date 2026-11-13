"""Close the gap between a hat's opening and the head it sits on: the vertices of the hat's open border are moved onto
the head and hair surface (just outside it), and the move fades out over the hat within `reach` of the border, so the
crown and brim keep their shape. Run it after the hat's rigid fit and the hat hair; without it, a hat lifted to clear the
hair shows sky between its rim and the forehead from below.
blender --background --python-exit-code 1 --python seal_opening.py -- <pieces.blend> <body-rigged.blend> <hat> <hair|-> <out.blend> <report.json> [offset-mm] [reach-cm] --character <body character.json>
<hair> is the hat hair object in pieces.blend, or - when there is none (a body without hair): the opening then seals
onto the head alone. The head comes from body-rigged.blend under the name its character spec gives."""
import bpy, bmesh, sys, os, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import charspec

args, spec = charspec.require()
src, body_blend, hat_name, hair_name, out, report_path = args[:6]
offset = (float(args[6]) if len(args) > 6 else 2.0) / 1000.0
reach = (float(args[7]) if len(args) > 7 else 3.0) / 100.0
bpy.ops.wm.open_mainfile(filepath=src)
hat = bpy.data.objects[hat_name]; hair = None if hair_name == "-" else bpy.data.objects[hair_name]
if spec.part("head") is None: raise SystemExit("sealing a hat needs a separate head part in the body's character spec")
with bpy.data.libraries.load(body_blend) as (s_, d_):
    if spec.part("head") not in s_.objects: raise SystemExit(f"{body_blend}: no object named {spec.part('head')!r} (the body's character spec names its parts)")
    d_.objects = [spec.part("head")]
head = d_.objects[0]
verts, faces = [], []
for o in (head, hair) if hair else (head,):
    base = len(verts); M = o.matrix_world
    verts += [M @ v.co for v in o.data.vertices]; faces += [[base + i for i in p.vertices] for p in o.data.polygons]
tree = BVHTree.FromPolygons(verts, faces)

W = hat.matrix_world; Winv = W.inverted()
bm = bmesh.new(); bm.from_mesh(hat.data); bm.verts.ensure_lookup_table()
border = {v.index for e in bm.edges if e.is_boundary for v in e.verts}
P = np.array([(W @ v.co)[:] for v in bm.verts])
# distance from the border along the hat's edges
import heapq
dist = {i: 0.0 for i in border}; heap = [(0.0, i) for i in border]
while heap:
    d, i = heapq.heappop(heap)
    if d > dist.get(i, 1e9) or d > reach: continue
    for e in bm.verts[i].link_edges:
        j = e.other_vert(bm.verts[i]).index; nd = d + float(np.linalg.norm(P[i] - P[j]))
        if nd < dist.get(j, 1e9): dist[j] = nd; heapq.heappush(heap, (nd, j))
moves = {}
for i in border:
    loc, nor, _, _ = tree.find_nearest(Vector(P[i]))
    moves[i] = np.array((loc + nor * offset)[:]) - P[i]
# each vertex near the border follows the move of its nearest border vertex, fading with distance
bidx = list(border); B = P[bidx]
moved = 0; largest = 0.0
for i, d in dist.items():
    if d > reach: continue
    k = bidx[int(np.argmin(np.linalg.norm(B - P[i], axis=1)))]
    w = 1.0 - d / reach; w = w * w * (3 - 2 * w)
    m = moves[k] * w
    if np.linalg.norm(m) > 1e-5:
        bm.verts[i].co = Winv @ Vector((P[i] + m)[:]); moved += 1; largest = max(largest, float(np.linalg.norm(m)))
bm.to_mesh(hat.data); bm.free()
gaps = [float(np.linalg.norm(m)) for m in moves.values()]
report = {"borderVertices": len(border), "verticesMoved": moved, "largestMoveCm": round(largest * 100, 2),
          "borderGapBeforeCm": {"mean": round(float(np.mean(gaps)) * 100, 2), "max": round(float(np.max(gaps)) * 100, 2)}, "offsetMm": offset * 1000, "reachCm": reach * 100}
bpy.ops.wm.save_as_mainfile(filepath=out)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
