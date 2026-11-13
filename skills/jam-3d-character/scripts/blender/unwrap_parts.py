"""Deliberate-seam UV unwrap of the character's parts (the spec's body part, and head and hair when it has them).

Seams come from the anatomy (anatomy.py, from the joints), with the borders between the spec's material classes as extra
cuts: the back of the head and hair, a neck loop and a waist loop where no material border already separates head from
body or chest from hips, one continuous side seam per side from the wrist along the underside of the arm and down the
side of the torso to the waist, the seat and inseams when the legs part at a crotch, the ankle, sole and heel of each
foot (the footwear class, or the anatomical foot when the character has none), each wrist and the palm/back outline of
each hand. The layout must pass the gate (no flipped faces, overlap near zero, P95/P5 texel density at most 2.5);
otherwise the script writes its report and stops with an error. A last pass cuts any island that is still
a tube (two boundary loops of similar length) along its back, so every island can lie flat.
Writes a new UV layer "UV0" per part, keeps the old layout as "UV_Meshy", and saves measurements.

blender --background --python-exit-code 1 --python unwrap_parts.py -- <topology.blend> <base_color.png> <meshy-joints.json> <out-dir> --character <character.json>
meshy-joints.json is the joints file of the body's own generation (meshy_rig_joints.py), in metres at the character's height.
"""
import bpy, bmesh, sys, os, json, heapq, colorsys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anatomy

(blend, tex, joints_json, out), spec = charspec.require()
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
img = bpy.data.images.load(tex); W, Hh = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(Hh, W, img.channels)[:, :, :3]
ROLE_OF = {spec.part(r): r for r in ("head", "hair", "body") if spec.part(r)}
objs = {n: bpy.data.objects[n] for n in ROLE_OF}
allz = [v.co.z for o in objs.values() for v in o.data.vertices]
HEIGHT = max(allz) - min(allz); ZMIN = min(allz)
mm = spec.mm(HEIGHT)                 # one millimetre of the real character, in this file's units
# Lengths below are millimetres of the real character, as tuned on the first body built with this script.
# The joints are in metres at the character's height with the feet at 0; bring them into this file's space.
_k = HEIGHT / spec.height
_bones = json.load(open(joints_json))["bones"]
J = {k: Vector((v["head"][0] * _k, v["head"][1] * _k, v["head"][2] * _k + ZMIN)) for k, v in _bones.items()}
AJ = anatomy.joints_from_meshy(_bones, _k, (0.0, 0.0, ZMIN))
report = {"blender": bpy.app.version_string, "height": HEIGHT, "parts": {}}


def dijkstra(bm, starts, targets, allowed, cost):
    """Shortest edge path from any start vertex to any target vertex. Returns a list of edges."""
    dist = {v: 0.0 for v in starts}; prev = {}
    heap = [(0.0, v.index, v) for v in starts]; heapq.heapify(heap); targets = set(targets); done = set()
    while heap:
        d, _, v = heapq.heappop(heap)
        if v in done: continue
        done.add(v)
        if v in targets and v not in starts:
            path = []
            while v in prev: e, v = prev[v]; path.append(e)
            return path
        for e in v.link_edges:
            if not allowed(e): continue
            w = e.other_vert(v); nd = d + cost(e)
            if nd < dist.get(w, 1e18): dist[w] = nd; prev[w] = (e, v); heapq.heappush(heap, (nd, w.index, w))
    return []


def majority(bm, cls, faces, rounds=2):
    for _ in range(rounds):
        change = {}
        for f in faces:
            around = [g for e in f.edges for g in e.link_faces if g is not f and g in cls]
            if not around: continue
            other = [cls[g] for g in around if cls[g] != cls[f]]
            if len(other) > len(around) / 2: change[f] = max(set(other), key=other.count)
        cls.update(change)


def boundary(bm, cls, a, b=None):
    """Edges between a face of class a and a face of class b (or any other class)."""
    res = []
    for e in bm.edges:
        cs = [cls.get(f) for f in e.link_faces]
        if len(cs) == 2 and cs[0] != cs[1] and a in cs and (b is None or b in cs): res.append(e)
    return res


def verts_of(edges): return {v for e in edges for v in e.verts}


def largest_chain(edges):
    """The largest connected group of edges: a garment border, without stray patches of misread colour."""
    left = set(edges); best = []
    while left:
        e = left.pop(); comp = [e]; stack = [e]
        while stack:
            x = stack.pop()
            for v in x.verts:
                for n in v.link_edges:
                    if n in left: left.remove(n); comp.append(n); stack.append(n)
        if len(comp) > len(best): best = comp
    return best


def face_class_body(bm, uv):
    cands = spec.candidates("body")
    cls = {}
    for f in bm.faces:
        cu = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
        cols = []
        for p in [cu] + [(l[uv].uv + cu) / 2 for l in f.loops]:
            cols.append(px[min(Hh - 1, max(0, int(p.y % 1.0 * Hh))), min(W - 1, max(0, int(p.x % 1.0 * W)))])
        cls[f] = spec.classify(tuple(float(x) for x in np.median(np.array(cols), axis=0)), cands)
    majority(bm, cls, list(bm.faces), 2)
    return cls


def anatomy_faces(bm):
    """Anatomical region per face: the most common region of its vertices."""
    lab, _ = anatomy.label(np.array([v.co[:] for v in bm.verts]), [(e.verts[0].index, e.verts[1].index) for e in bm.edges], AJ, HEIGHT)
    out = {}
    for f in bm.faces:
        rs = [lab[v.index] for v in f.verts]; out[f] = max(set(rs), key=rs.count)
    return out


def connected(bm, a, b):
    """True when some face of set a reaches some face of set b without crossing a seam or border."""
    if not a or not b: return False
    seen = set(a); st = list(a)
    while st:
        f = st.pop()
        if f in b: return True
        for e in f.edges:
            if e.seam: continue
            for g in e.link_faces:
                if g not in seen: seen.add(g); st.append(g)
    return False


def loop_between(bm, ana, a_regions, b_regions):
    """Edges between a face in a_regions and a face in b_regions."""
    return [e for e in bm.edges if len(e.link_faces) == 2 and
            ((ana[e.link_faces[0]] in a_regions and ana[e.link_faces[1]] in b_regions) or (ana[e.link_faces[1]] in a_regions and ana[e.link_faces[0]] in b_regions))]


def seam_body(bm, uv):
    cls = face_class_body(bm, uv); notes = {}
    for e in bm.edges:
        cs = {cls[f] for f in e.link_faces}
        if len(cs) > 1: e.seam = True
    counts = {}
    for c in cls.values(): counts[c] = counts.get(c, 0) + 1
    notes["faceClasses"] = counts
    ana = anatomy_faces(bm); notes["anatomyFaces"] = {r: sum(1 for x in ana.values() if x == r) for r in sorted(set(ana.values()))}
    # neck and waist loops from the anatomy, unless material borders already run there (a collar, a waistband)
    def material_near(regions, z, band):
        return [e for e in bm.edges if e.seam and any(ana[f] in regions for f in e.link_faces) and abs((e.verts[0].co.z + e.verts[1].co.z) / 2 - z) < band]
    if not spec.part("head"):
        loop = loop_between(bm, ana, {"head"}, {"neck", "torso"})
        if len(material_near({"head", "neck", "torso"}, AJ["neck"].z, 0.06 * HEIGHT)) < 0.5 * len(loop):
            for e in loop: e.seam = True
            notes["neckLoopEdges"] = len(loop)
        else: notes["neckLoopEdges"] = "material border"
    waist_edges = loop_between(bm, ana, {"torso"}, {"pelvis"})
    mat = material_near({"torso", "pelvis"}, AJ["spine_lo"].z, 0.08 * HEIGHT)
    if len(mat) < 0.5 * len(waist_edges):
        for e in waist_edges: e.seam = True
        notes["waistLoopEdges"] = len(waist_edges)
    else:
        waist_edges = mat; notes["waistFromMaterialBorder"] = len(mat)
    waist_all = {v for e in waist_edges for v in e.verts}
    footwear = spec.role_class("footwear")
    feet_by_class = bool(footwear) and any(c == footwear for c in cls.values())
    hands, feet = {}, {}
    for sign, side, sfx in ((1, "left", "Left"), (-1, "right", "Right")):
        # hand: the faces beyond the wrist joint across the forearm, connected to the hand itself
        Wr, El, Sh = J[sfx + "Hand"], J[sfx + "ForeArm"], J[sfx + "Arm"]; af = (Wr - El).normalized(); flen = (Wr - El).length
        beyond = {f for f in bm.faces if sign * f.calc_center_median().x > 0 and (f.calc_center_median() - Wr).dot(af) > 0 and (f.calc_center_median() - Wr).length < 1.4 * flen}
        seed = min(beyond, key=lambda f: (f.calc_center_median() - (Wr + af * 0.35 * flen)).length)
        hand = {seed}; st = [seed]
        while st:
            f = st.pop()
            for e in f.edges:
                for g in e.link_faces:
                    if g in beyond and g not in hand: hand.add(g); st.append(g)
        part = {f: ("hand" if f in hand else "arm") for f in bm.faces if sign * f.calc_center_median().x > 0}
        wrist_edges = boundary(bm, part, "hand", "arm")
        for e in wrist_edges: e.seam = True
        wrist = verts_of(wrist_edges); hands[side] = hand
        P = np.array([v.co[:] for v in {v for f in hand for v in f.verts}]); P = P - P.mean(axis=0)
        n_h = Vector(np.linalg.svd(P, full_matrices=False)[2][2])
        hs = {f: ("palm" if f.normal.dot(n_h) > 0 else "back") for f in hand}
        majority(bm, hs, list(hand), 3)
        for e in boundary(bm, hs, "palm", "back"): e.seam = True
        # foot: footwear faces on this side, or the faces below the ankle joint when the character has no footwear
        An = J[sfx + "Foot"]
        if feet_by_class: foot = {f for f in bm.faces if cls[f] == footwear and sign * f.calc_center_median().x > 0}
        else: foot = {f for f in bm.faces if ana[f] == "foot" + ("_l" if sign > 0 else "_r")}
        fpart = {f: ("foot" if f in foot else "leg") for f in bm.faces if sign * f.calc_center_median().x > 0}
        ankle_edges = boundary(bm, fpart, "foot", "leg")
        for e in ankle_edges: e.seam = True
        ankle = verts_of(ankle_edges); feet[side] = foot
        # one side seam: from the underside of the wrist along the arm's underside, through the armpit and down the side
        # of the torso to the waist; with no waist (a one-piece garment) it runs on down the outside of the leg to the ankle
        start = min(wrist, key=lambda v: v.co.z)
        targets = {v for v in waist_all if sign * v.co.x > 0} or {v for v in ankle if sign * v.co.x > abs(An.x)}
        ymid = sum(v.co.y for v in targets) / len(targets)
        axis = (Wr - Sh).normalized(); g_ = Vector((-sign * 0.5, 0, -1)); u = (g_ - g_.dot(axis) * axis).normalized()
        def cost(e, Sh=Sh, axis=axis, u=u, ymid=ymid):
            m = (e.verts[0].co + e.verts[1].co) / 2
            if (m - Sh).dot(axis) > 0:          # on the arm: prefer its underside
                r = (m - Sh) - (m - Sh).dot(axis) * axis
                return e.calc_length() * (1 + 6 * (1 - (r.normalized().dot(u) if r.length > 1e-6 else 1)))
            return e.calc_length() * (1 + abs(m.y - ymid) / (19.2653 * mm))     # on the torso: keep to the side line
        allowed = lambda e, sign=sign, hand=hand, foot=foot: any(sign * f.calc_center_median().x > 0 and f not in hand and f not in foot for f in e.link_faces)
        sp = dijkstra(bm, {start}, targets, allowed, cost)
        for e in sp: e.seam = True
        notes[side] = {"wristEdges": len(wrist_edges), "sideSeamEdges": len(sp), "handFaces": len(hand), "ankleEdges": len(ankle_edges), "footFaces": len(foot)}
        # sole and heel
        sc = {f: ("sole" if f.normal.z < -0.5 else "upper") for f in foot}; majority(bm, sc, list(foot), 2)
        sole_edges = boundary(bm, sc, "sole", "upper")
        for e in sole_edges: e.seam = True
        top_ = {f for f in foot if sc[f] == "upper"}; xc = sum(v.co.x for v in ankle) / max(1, len(ankle))
        heel = []
        if ankle and sole_edges:
            heel_start = max(ankle, key=lambda v: v.co.y)
            heel = dijkstra(bm, {heel_start}, verts_of(sole_edges), lambda e, top_=top_: any(f in top_ for f in e.link_faces),
                            lambda e, xc=xc: e.calc_length() * (1 + abs((e.verts[0].co.x + e.verts[1].co.x) / 2 - xc) / (9.63264 * mm)))
            for e in heel: e.seam = True
        notes[side].update({"soleEdges": len(sole_edges), "heelEdges": len(heel)})
    # legs: when they part at a crotch, a seat seam up the back to the waist and an inseam down each leg to the ankle
    off = {f for s_ in ("left", "right") for f in hands[s_] | feet[s_]}
    ok = lambda e: any(f not in off for f in e.link_faces)
    knee_z = (J["LeftLeg"].z + J["RightLeg"].z) / 2; hip_z = (J["LeftUpLeg"].z + J["RightUpLeg"].z) / 2
    mid = [v for f in bm.faces if f not in off for v in f.verts if abs(v.co.x) < 11.5592 * mm and knee_z < v.co.z < hip_z + 0.5 * (hip_z - knee_z)]
    if mid:
        crotch = min(mid, key=lambda v: v.co.z)
        back_targets = {v for v in waist_all if abs(v.co.x) < 28.8979 * mm}
        ymid = sum(v.co.y for v in back_targets) / len(back_targets) if back_targets else crotch.co.y
        back_targets = {v for v in back_targets if v.co.y > ymid}
        seat = dijkstra(bm, {crotch}, back_targets, ok, lambda e: e.calc_length() * (1 + abs((e.verts[0].co.x + e.verts[1].co.x) / 2) / (7.70611 * mm) + max(0.0, ymid - (e.verts[0].co.y + e.verts[1].co.y) / 2) / (9.63264 * mm))) if back_targets else []
        for e in seat: e.seam = True
        notes["seatSeamEdges"] = len(seat)
        for sign, side in ((1, "left"), (-1, "right")):
            ankle = {v for f in feet[side] for v in f.verts if any(g not in feet[side] for e in f.edges for g in e.link_faces)}
            ankle = {v for v in ankle if any(g not in feet[side] and sign * g.calc_center_median().x > 0 for g in v.link_faces)}
            if not ankle: continue
            yleg = sum(v.co.y for v in ankle) / len(ankle)
            def inner(e, sign=sign, yleg=yleg):
                m = (e.verts[0].co + e.verts[1].co) / 2
                return e.calc_length() * (1 + max(0.0, sign * m.x) / (19.2653 * mm) + abs(m.y - yleg) / (28.8979 * mm))
            ins = dijkstra(bm, {crotch}, ankle, ok, inner)
            for e in ins: e.seam = True
            notes[side]["inseamEdges"] = len(ins)
    else:
        notes["crotch"] = "none found between the knees and the hips (a skirt or robe): the tube pass cuts each leg"
    return notes


def cut_tubes(bm, rounds=24):
    """Cut every island that is still a tube: it has two boundary loops of similar length (a sleeve, a leg below a skirt,
    the skin between a hairline and a collar). A flat piece with a small hole in it (a neck opening) is left alone. The cut
    is the shortest path between the two loops, kept to the back of the body."""
    cuts = []
    ymid = sum(v.co.y for v in bm.verts) / len(bm.verts)
    for _ in range(rounds):
        seen = set(); changed = False
        for f0 in bm.faces:
            if f0 in seen: continue
            isl = {f0}; st = [f0]
            while st:
                g = st.pop()
                for e in g.edges:
                    if e.seam: continue
                    for h in e.link_faces:
                        if h not in isl: isl.add(h); st.append(h)
            seen |= isl
            bedges = [e for e in {e for f in isl for e in f.edges} if e.seam or e.is_boundary]
            left = set(bedges); loops = []
            while left:
                e = left.pop(); comp = [e]; st = [e]
                while st:
                    x = st.pop()
                    for v in x.verts:
                        for n in v.link_edges:
                            if n in left: left.remove(n); comp.append(n); st.append(n)
                loops.append(comp)
            if len(loops) < 2: continue
            loops.sort(key=lambda L: -sum(e.calc_length() for e in L))
            la, lb = (sum(e.calc_length() for e in L) for L in loops[:2])
            if lb < 0.5 * la: continue
            path = dijkstra(bm, verts_of(loops[0]), verts_of(loops[1]), lambda e, isl=isl: not e.seam and all(f in isl for f in e.link_faces),
                            lambda e: e.calc_length() * (1 + max(0.0, ymid - (e.verts[0].co.y + e.verts[1].co.y) / 2) / (9.63264 * mm)))
            if path:
                for e in path: e.seam = True
                cuts.append(len(path)); changed = True
                break
        if not changed: break
    return cuts


def seam_back(bm, role):
    """One seam down the back from the crown to the open border (neck for the head, nape for the hair)."""
    border = {v for e in bm.edges if e.is_boundary for v in e.verts}
    ymid = sum(v.co.y for v in bm.verts) / len(bm.verts)
    top = max(bm.verts, key=lambda v: v.co.z)
    targets = {v for v in border if v.co.y > ymid and abs(v.co.x) < 28.8979 * mm} or border
    path = dijkstra(bm, {top}, targets, lambda e: True,
                    lambda e: e.calc_length() * (1 + abs((e.verts[0].co.x + e.verts[1].co.x) / 2) / (5.77958 * mm) + max(0.0, ymid - (e.verts[0].co.y + e.verts[1].co.y) / 2) / (5.77958 * mm)))
    for e in path: e.seam = True
    notes = {"backSeamEdges": len(path)}
    if role == "hair":
        # the hair shell opened by one seam is a long bow-tie that fills little of its texture; a second seam from the
        # crown to the middle of the front hairline makes two compact halves
        front = {v for v in border if v.co.y < ymid and abs(v.co.x) < 28.8979 * mm} or border
        fpath = dijkstra(bm, {top}, front, lambda e: True,
                         lambda e: e.calc_length() * (1 + abs((e.verts[0].co.x + e.verts[1].co.x) / 2) / (5.77958 * mm) + max(0.0, (e.verts[0].co.y + e.verts[1].co.y) / 2 - ymid) / (5.77958 * mm)))
        for e in fpath: e.seam = True
        notes["frontSeamEdges"] = len(fpath)
    return notes


def head_back_seam(bm):
    """One-mesh character: a seam from the crown down the back of the head to the first seam or border below it."""
    ymid = sum(v.co.y for v in bm.verts) / len(bm.verts)
    top = max(bm.verts, key=lambda v: v.co.z)
    marked = {v for e in bm.edges if e.seam or e.is_boundary for v in e.verts}
    targets = {v for v in marked if v.co.y > ymid and abs(v.co.x) < 28.8979 * mm and v.co.z < top.co.z - 20 * mm}
    if not targets: return 0
    path = dijkstra(bm, {top}, targets, lambda e: True,
                    lambda e: e.calc_length() * (1 + abs((e.verts[0].co.x + e.verts[1].co.x) / 2) / (5.77958 * mm) + max(0.0, ymid - (e.verts[0].co.y + e.verts[1].co.y) / 2) / (5.77958 * mm)))
    for e in path: e.seam = True
    return len(path)


def measure(bm, uv, size):
    dens, ang, flipped = [], [], 0
    a3 = au = 0.0
    for f in bm.faces:
        p = [l[uv].uv for l in f.loops]
        s = 0.5 * sum(p[i].x * p[(i + 1) % len(p)].y - p[(i + 1) % len(p)].x * p[i].y for i in range(len(p)))
        if s < 0: flipped += 1
        A = f.calc_area(); a3 += A; au += abs(s)
        if A > 1e-12 and abs(s) > 1e-14: dens.append(np.sqrt(abs(s) / A))
        for l in f.loops:
            a = l.calc_angle()
            u0, u1, u2 = l.link_loop_prev[uv].uv, l[uv].uv, l.link_loop_next[uv].uv
            d1, d2 = (u0 - u1), (u2 - u1)
            if d1.length > 1e-9 and d2.length > 1e-9: ang.append(abs(np.degrees(d1.angle(d2)) - np.degrees(a)))
    dens = np.array(dens); med = float(np.median(dens))
    N = 1024; grid = np.zeros((N, N), dtype=np.uint8)
    for f in bm.faces:
        p = [l[uv].uv for l in f.loops]
        for i in range(1, len(p) - 1):
            tri = np.array([[p[0].x, p[0].y], [p[i].x, p[i].y], [p[i + 1].x, p[i + 1].y]]) * N
            x0, y0 = np.floor(tri.min(axis=0)).astype(int); x1, y1 = np.ceil(tri.max(axis=0)).astype(int)
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, N - 1), min(y1, N - 1)
            if x1 < x0 or y1 < y0: continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = tri
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12: continue
            w1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            w2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            inside = (w1 > 0.02) & (w2 > 0.02) & (1 - w1 - w2 > 0.02)
            grid[y0:y1 + 1, x0:x1 + 1] += inside.astype(np.uint8)
    us = [l[uv].uv for f in bm.faces for l in f.loops]
    return {"textureSize": size, "faces": len(bm.faces), "flippedFaces": flipped,
            "uvCoverage": round(float((grid > 0).mean()), 4), "overlappingTexelShare": round(float((grid > 1).sum() / max(1, (grid > 0).sum())), 5),
            "texelsPerCm": {"median": round(med * size / 100, 2), "p5": round(float(np.percentile(dens, 5)) * size / 100, 2), "p95": round(float(np.percentile(dens, 95)) * size / 100, 2)},
            "densitySpreadP95overP5": round(float(np.percentile(dens, 95) / np.percentile(dens, 5)), 3),
            "angleErrorDegrees": {"mean": round(float(np.mean(ang)), 2), "p95": round(float(np.percentile(ang, 95)), 2)},
            "uvBounds": [round(min(u.x for u in us), 4), round(min(u.y for u in us), 4), round(max(u.x for u in us), 4), round(max(u.y for u in us), 4)]}


SIZES = {n: spec.texture_sizes[r] for n, r in ROLE_OF.items()}
for name, ob in objs.items():
    me = ob.data
    if "UV_Meshy" not in me.uv_layers and me.uv_layers: me.uv_layers[0].name = "UV_Meshy"
    bm = bmesh.new(); bm.from_mesh(me); bm.edges.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.normal_update()
    old = bm.loops.layers.uv["UV_Meshy"]
    for e in bm.edges: e.seam = False
    role = ROLE_OF[name]
    notes = seam_body(bm, old) if role == "body" else seam_back(bm, role)
    if role == "body" and not spec.part("head"):
        notes["headBackSeam"] = head_back_seam(bm)
    notes["tubeCuts"] = cut_tubes(bm)
    notes["seamEdges"] = sum(1 for e in bm.edges if e.seam)
    bm.to_mesh(me); bm.free()
    new = me.uv_layers.new(name="UV0"); me.uv_layers.active = new; new.active_render = True
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", fill_holes=True, correct_aspect=True, margin=0.001)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.012)
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv["UV0"]
    m = measure(bm, uvl, SIZES[name])
    # islands: connected faces without crossing a seam or border
    seen = set(); islands = 0
    for f in bm.faces:
        if f in seen: continue
        islands += 1; stack = [f]; seen.add(f)
        while stack:
            g = stack.pop()
            for e in g.edges:
                if e.seam: continue
                for h in e.link_faces:
                    if h not in seen: seen.add(h); stack.append(h)
    m["islands"] = islands; m["seams"] = notes
    # dump the layout for drawing outside Blender (the PNG exporter needs a GPU context)
    isl = {}; n = 0; seen2 = set()
    for f in bm.faces:
        if f in seen2: continue
        stack = [f]; seen2.add(f)
        while stack:
            g = stack.pop(); isl[g.index] = n
            for e in g.edges:
                if e.seam: continue
                for h in e.link_faces:
                    if h not in seen2: seen2.add(h); stack.append(h)
        n += 1
    json.dump({"faces": [{"island": isl[f.index], "uv": [[round(l[uvl].uv.x, 5), round(l[uvl].uv.y, 5)] for l in f.loops],
                          "seam": [bool(l.edge.seam or l.edge.is_boundary) for l in f.loops]} for f in bm.faces]},
              open(os.path.join(out, f"uv-layout-{name}.json"), "w"))
    bm.free(); report["parts"][name] = m

gate = []
for name, m in report["parts"].items():
    if m["flippedFaces"] > 0: gate.append(f"{name}: {m['flippedFaces']} flipped faces")
    if m["overlappingTexelShare"] > 0.002: gate.append(f"{name}: {m['overlappingTexelShare']:.2%} of texels overlap")
    if m["densitySpreadP95overP5"] > 2.5: gate.append(f"{name}: texel density P95/P5 {m['densitySpreadP95overP5']} (at most 2.5)")
report["gate"] = {"passed": not gate, "failures": gate}
json.dump(report, open(os.path.join(out, "uv-report.json"), "w"), indent=2); print(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "character-uv.blend"))
if gate:
    raise RuntimeError("UV gate failed (layout saved for inspection; see uv-report.json seams):\n  " + "\n  ".join(gate))
