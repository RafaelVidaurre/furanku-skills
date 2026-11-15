"""Make a "hat hair" piece: the body's own hair, pressed in wherever it would show through a hat, so the hat can sit at its
natural height. Hair below the brim (sides, back) is left as it is.
blender --background --python-exit-code 1 --python hair_under_hat.py -- <pieces-bind-pose.blend> <body-rigged.blend> <name> <out.blend> <report.json> [offset-mm] --character <body character.json>

pieces-bind-pose.blend holds Hat_<name> in the body's bind pose (to_bind_pose.py). The body's hair and head parts (named
by its character spec) come from body-rigged.blend. The output is the pieces file plus Hair_<name>: a copy of the body's
hair (same faces, UVs, material and weights) whose vertices that are in front of the hat's crown or brim top are moved behind it by `offset` (default 3 mm),
never closer than 2 mm to the scalp. Hair below the hat's opening (its open border) at the same angle around the
head is visible and is never moved. The moves are smoothed over the hair, as conform_outfit.py smooths its pushes.
A body without hair gets no hat hair: the pieces are saved unchanged and the report says so."""
import bpy, sys, os, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import charspec

args, spec = charspec.require()
src, body_blend, name, out_blend, report_path = args[:5]
offset = (float(args[5]) if len(args) > 5 else 3.0) / 1000.0
bpy.ops.wm.open_mainfile(filepath=src)
hat = bpy.data.objects["Hat_" + name]
if spec.part("hair") is None:
    bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    report = {"hairVertices": 0, "hatHair": None, "reason": "the body has no hair part"}
    json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report)); raise SystemExit(0)
if spec.part("head") is None: raise SystemExit("hat hair needs a separate head part in the body's character spec")
with bpy.data.libraries.load(body_blend) as (s_, d_):
    missing = [n for n in (spec.part("hair"), spec.part("head")) if n not in s_.objects]
    if missing: raise SystemExit(f"{body_blend}: no object named {missing} (the body's character spec names its parts)")
    d_.objects = [spec.part("hair"), spec.part("head")]
hair_src, head = d_.objects
hair = hair_src.copy(); hair.data = hair_src.data.copy(); hair.name = "Hair_" + name; hair.data.name = "Hair_" + name
bpy.context.scene.collection.objects.link(hair)
for m in list(hair.modifiers): hair.modifiers.remove(m)
hair.parent = None

def world_tree(o):
    M = o.matrix_world
    return BVHTree.FromPolygons([M @ v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons])
ht = world_tree(hat); st = world_tree(head)
# the hat's opening (its open border, where the head goes in): hair below it at the same angle around the head is visible
import bmesh, math
bmh = bmesh.new(); bmh.from_mesh(hat.data)
ring = [hat.matrix_world @ v.co for v in {v for e in bmh.edges if e.is_boundary for v in e.verts}]; bmh.free()
rc = sum(ring, Vector()) / len(ring)
ring_by_angle = sorted((math.atan2(p.y - rc.y, p.x - rc.x), p.z) for p in ring)
def ring_height(v):
    a = math.atan2(v.y - rc.y, v.x - rc.x)
    return min(ring_by_angle, key=lambda t: min(abs(t[0] - a), 2 * math.pi - abs(t[0] - a)))[1]
M = hair.matrix_world; Minv = M.inverted()
V = np.array([(M @ v.co)[:] for v in hair.data.vertices]); V0 = V.copy(); n = len(V)
nb = [[] for _ in range(n)]
for e in hair.data.edges: a, b = e.vertices; nb[a].append(b); nb[b].append(a)

def wanted():
    """For each hair vertex in front of the crown or brim top (not under the brim), how far and where to move it."""
    D = np.zeros_like(V); count = 0
    for i in range(n):
        v = Vector(V[i])
        if v.z < ring_height(v) - 0.002: continue  # below the hat's opening: visible hair, left as it is
        # straight up from the strand: the brim's underside first means it hangs below the brim and stays visible;
        # nothing above means it is outside the hat; the hat seen from inside means it is hidden under the crown
        up_loc, up_nor, _, _ = ht.ray_cast(v, Vector((0, 0, 1)))
        if up_loc is not None and up_nor.z < 0: continue
        # nothing above and nothing below: the strand is beside the hat, outside its footprint, and stays as it is
        above_hat = up_loc is None and ht.ray_cast(v, Vector((0, 0, -1)))[0] is not None
        if up_loc is None and not above_hat: continue
        loc, nor, fi, dist = ht.find_nearest(v)
        if loc is None: continue
        d = (v - loc).dot(nor)
        if above_hat or d > -offset:
            D[i] = np.array((-nor * (max(d, 0.0) + offset))[:]); count += 1
    return D, count
D, before = wanted()
for _ in range(12):
    if not D.any(): break
    S = D.copy()
    for _ in range(4):
        S = np.array([S[nb[i]].mean(axis=0) if nb[i] else S[i] for i in range(n)])
        S = np.where(np.linalg.norm(D, axis=1, keepdims=True) > np.linalg.norm(S, axis=1, keepdims=True), D, S)
    V = V + S
    # never into the scalp
    for i in range(n):
        loc, nor, fi, dist = st.find_nearest(Vector(V[i]))
        if loc is not None:
            d = (Vector(V[i]) - loc).dot(nor)
            if d < 0.002: V[i] = np.array((loc + nor * 0.002)[:])
    D, left = wanted()
moved = np.linalg.norm(V - V0, axis=1)
for i, v in enumerate(hair.data.vertices): v.co = Minv @ Vector(V[i])
report = {"hairVertices": n, "inFrontOfHatBefore": before, "inFrontOfHatAfter": int(left if before else 0),
          "verticesMoved": int((moved > 1e-4).sum()), "largestMoveCm": round(float(moved.max()) * 100, 2), "offsetMm": offset * 1000}
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
