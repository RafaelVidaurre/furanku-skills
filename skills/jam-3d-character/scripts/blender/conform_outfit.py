"""Push an outfit's pieces outside the body they are worn on, so no point of the body shows through the cloth.
blender --background --python-exit-code 1 --python conform_outfit.py -- <pieces.blend> <body-modelled.blend> <body-joints.json> <out.blend> <report.json> [offset-mm] --character <body character.json>

Pieces named Outfit_* clear the body's outfit, head and hands parts; pieces named Hat_* clear the head and the body's
hair (only the head with --hat-hair or --hair-under-hat). Part objects are named by the body's character spec. The body is scaled into
the joints' space as split_outfit.py does. Each pass finds, for every vertex, how far it must move out along the nearest
body surface's normal to sit `offset` (default 4 mm) outside it; the moves are smoothed over the cloth's neighbours so a
region pushed out stays smooth, and passes repeat until nothing is inside. Soles below the floor are lifted onto it."""
import bpy, bmesh, sys, os, json
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import charspec

args, spec = charspec.require()
pieces_blend, body_blend, joints_path, out_blend, report_path = args[:5]
offset = (float(args[5]) if len(args) > 5 and not args[5].startswith("--") else 4.0) / 1000.0
# flags: --hat-hair, --hair-under-hat, --no-rigid-hat (see below)
height = json.load(open(joints_path))["meshBounds"][1][2]

bpy.ops.wm.open_mainfile(filepath=pieces_blend)
pieces = [o for o in bpy.data.objects if o.type == "MESH"]
with bpy.data.libraries.load(body_blend) as (src, dst):
    missing = [n for n in spec.present_parts() if n not in src.objects]
    if missing: raise SystemExit(f"{body_blend}: no object named {missing} (the body's character spec names its parts)")
    dst.objects = spec.present_parts()
body = {o.name: o for o in dst.objects}
lo = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in body.values())
hi = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o in body.values())
s = height / (hi - lo); M = Matrix.Translation((0, 0, -lo * s)) @ Matrix.Scale(s, 4)
body_pts = {}
def tree(names):
    verts, faces = [], []
    for n in names:
        o = body[n]; base = len(verts)
        verts += [M @ o.matrix_world @ v.co for v in o.data.vertices]; faces += [[base + i for i in p.vertices] for p in o.data.polygons]
    nrm = []
    for n in names:
        o = body[n]; R = (M @ o.matrix_world).to_3x3()
        nrm += [(R @ v.normal).normalized() for v in o.data.vertices]
    body_pts[tuple(names)] = (np.array([v[:] for v in verts]), np.array([v[:] for v in nrm]))
    return BVHTree.FromPolygons(verts, faces)
hat_hair = "--hat-hair" in args  # the hat carries its own hair: clear only the head; otherwise clear the body's hair too
# --hair-under-hat: the body's hair is adapted to fit under the hat afterwards (hair_under_hat.py), so the hat clears only the head
hair_under = "--hair-under-hat" in args
# a hat is fitted rigidly once; later passes (after smoothing borders) must not lift it again
rigid_hat = "--no-rigid-hat" not in args
# what each kind of piece must clear, by the body's part roles (a role the body lacks is skipped)
names_for = {"Outfit": spec.present_parts(("body", "head", "hands")),
             "Hat": spec.present_parts(("head",) if (hat_hair or hair_under) else ("head", "hair"))}
targets = {k: tree(v) for k, v in names_for.items()}

report = {"offsetMm": offset * 1000}
J = json.load(open(joints_path))["bones"]
# The body's feet as modelled: vertices of its outfit part below the ankles, per side.
shoe = {}
for side, sx in (("Left", 1), ("Right", -1)):
    ankle = Vector(J[side + "Foot"]["head"])  # Meshy's joints: LeftFoot, RightFoot
    pts = [M @ body[spec.part("body")].matrix_world @ v.co for v in body[spec.part("body")].data.vertices]
    pts = [p for p in pts if p.z < ankle.z and p.x * sx > 0]
    shoe[side] = (ankle, Vector((min(p.x for p in pts), min(p.y for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts))))

def fit_hat_rigidly(V, me, P, PN):
    """A hat is rigid: before any per-vertex push, find the smallest lift and uniform scale (about the hat's lowest ring)
    that keep every head and hair point inside it, so the crown is never dented around the hair."""
    faces = [list(p.vertices) for p in me.polygons]
    lo = V[:, 2].min(); base = np.array([V[:, 0].mean(), V[:, 1].mean(), lo])
    def violations(W):
        ct = BVHTree.FromPolygons([Vector(x) for x in W], faces); n = 0
        for b, nb in zip(P, PN):
            nb = Vector(nb); loc, nor, fi, dist = ct.ray_cast(Vector(b) + nb * offset, -nb, offset + 0.03)
            if loc is not None and offset - (loc - Vector(b)).dot(nb) > 0: n += 1
        return n
    best = (violations(V), 0.0, 1.0)
    for lift in np.arange(0.0, 0.0301, 0.0025):
        for k in (1.0, 1.02, 1.04, 1.06, 1.08):
            W = (V - base) * k + base + np.array([0, 0, lift])
            n = violations(W)
            if n < best[0] or (n == best[0] and lift + (k - 1) * 0.1 < best[1] + (best[2] - 1) * 0.1): best = (n, lift, k)
            if n == 0: break
        if best[0] == 0: break
    n, lift, k = best
    return (V - base) * k + base + np.array([0, 0, lift]), {"liftCm": round(float(lift) * 100, 2), "scale": k, "pointsStillThrough": int(n)}

def fit_footwear(V):
    """Centre each piece of footwear on the body's foot below the ankle and widen or lengthen it, never shrink it, to
    cover the foot with `offset` to spare; the change fades out between the ankle and a hand's width above it."""
    out = {}
    for side, sx in (("Left", 1), ("Right", -1)):
        ankle, lo2, hi2 = shoe[side]
        sel = (V[:, 2] < ankle.z) & (V[:, 0] * sx > 0)
        if not sel.any(): continue
        blo = V[sel, :2].min(axis=0); bhi = V[sel, :2].max(axis=0)
        need_lo = np.array(lo2[:]) - offset; need_hi = np.array(hi2[:]) + offset
        k = np.maximum(1.0, (need_hi - need_lo) / np.maximum(bhi - blo, 1e-6))
        c_b = (blo + bhi) / 2; c_t = (need_lo + need_hi) / 2
        w = np.clip((ankle.z + 0.08 - V[:, 2]) / 0.08, 0, 1) * (V[:, 0] * sx > 0)
        moved = (V[:, :2] - c_b) * k + c_t
        V[:, :2] = V[:, :2] * (1 - w[:, None]) + moved * w[:, None]
        out[side] = {"scaleXY": [round(float(x), 3) for x in k], "shiftCm": [round(float(x) * 100, 2) for x in (c_t - c_b)]}
    return out
for o in pieces:
    kind = "Hat" if o.name.startswith("Hat") else "Outfit"
    t = targets[kind]; P, PN = body_pts[tuple(names_for[kind])]
    me = o.data; n = len(me.vertices)
    V = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
    nb = [[] for _ in range(n)]
    for e in me.edges: a, b = e.vertices; nb[a].append(b); nb[b].append(a)
    def push(V):
        D = np.zeros_like(V); inside = 0; worst = 0.0
        for i in range(n):
            loc, nor, _, dist = t.find_nearest(Vector(V[i]))
            if loc is None: continue
            depth = (Vector(V[i]) - loc).dot(nor)
            if depth < offset:
                D[i] = np.array(nor[:]) * (offset - depth); inside += 1; worst = max(worst, offset - depth)
        # The other way round: a body point with cloth just inside it (a tuft through a crown, a heel through a boot)
        # is coming through that cloth: look a little way into the body along its normal, and push out the cloth face found there.
        faces = [list(p.vertices) for p in me.polygons]
        ct = BVHTree.FromPolygons([Vector(x) for x in V], faces)
        for b, nb in zip(P, PN):
            nb = Vector(nb); start = Vector(b) + nb * offset
            loc, nor, fi, dist = ct.ray_cast(start, -nb, offset + 0.03)
            if loc is None: continue
            ahead = offset - (loc - Vector(b)).dot(nb)  # how far the cloth must move out to sit offset outside b
            for vi in faces[fi]:
                want = nb * ahead
                if np.linalg.norm(D[vi]) < ahead: D[vi] = np.array(want[:])
            inside += 1; worst = max(worst, ahead)
        return D, inside, worst
    if o.name.startswith("Outfit"): report["footwear"] = fit_footwear(V)
    if kind == "Hat" and rigid_hat: V, report["hatRigidFit"] = fit_hat_rigidly(V, me, P, PN)
    V0 = V.copy()
    D, inside0, worst0 = push(V); start_inside = inside0
    passes = 0
    for passes in range(1, 31):
        if inside0 == 0: break
        S = D.copy()
        for _ in range(4):  # spread each push over the neighbours, keeping at least the push itself
            S = np.array([S[nb[i]].mean(axis=0) if nb[i] else S[i] for i in range(n)])
            S = np.where(np.linalg.norm(D, axis=1, keepdims=True) > np.linalg.norm(S, axis=1, keepdims=True), D, S)
        V = V + S
        D, inside0, worst = push(V)
    # Relax: smooth how far each point moved (not the shape), so many small pushes read as one smooth change, then
    # restore the clearance the smoothing gave back. Repeat a few times.
    for _ in range(3):
        disp = V - V0
        for _ in range(10):
            disp = 0.5 * disp + 0.5 * np.array([disp[nb[i]].mean(axis=0) if nb[i] else disp[i] for i in range(n)])
        V = V0 + disp
        for _ in range(8):
            D, inside0, worst = push(V)
            if inside0 == 0: break
            V = V + D
    if o.name.startswith("Outfit"):
        V[:, 2] = np.maximum(V[:, 2], -2 * offset)  # soles just under the body's, so they cover them; never deep in the floor
    Minv = o.matrix_world.inverted()
    for i, v in enumerate(me.vertices): v.co = Minv @ Vector(V[i])
    _, inside_end, worst_end = push(V)
    report[o.name] = {"insideBefore": start_inside, "worstStartMm": round(worst0 * 1000, 1), "passes": passes, "insideAfter": inside_end, "worstAfterMm": round(worst_end * 1000, 2)}
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
