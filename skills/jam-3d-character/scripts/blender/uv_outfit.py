"""Unwrap outfit pieces with deliberate garment seams, each piece into its own UV0 square. Meshy's layout stays as
UV_Meshy, for baking the generated maps across (bake_outfit.py).
blender --background --python-exit-code 1 --python uv_outfit.py -- <pieces-in-bind-pose.blend> <body-rigged.blend> <out.blend> <out-dir>

Outfit_* pieces: every face takes the region of the body under it (torso, left or right arm, left or right leg, from the
body's strongest bone weight there); the region borders are seams (armholes, waist, crotch), and each region is opened
by one cut along its least visible side: under each arm, the inside of each leg, both sides of the torso. Cuts follow the
mesh's own edges along the cheapest path from one end of the region to the other. When that layout cannot be flattened
(flipped faces or less than 20% of the square used: folded layers such as an open jacket), Smart UV Project at 66 degrees
is used instead and the report says so.
Hat_* pieces: Smart UV Project at 60 degrees: islands split at the hat's folds (brim rim, crown top).
Writes uv-report.json and <piece>-layout.json (draw with scripts/draw_uv_layout.py) in out-dir."""
import bpy, bmesh, sys, os, json, math, heapq
from collections import defaultdict
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
src, body_blend, out_blend, out_dir = args[:4]
bpy.ops.wm.open_mainfile(filepath=src); os.makedirs(out_dir, exist_ok=True)
pieces = [o for o in bpy.data.objects if o.type == "MESH"]
with bpy.data.libraries.load(body_blend) as (s_, d_): d_.objects = list(s_.objects)
body = {o.name: o for o in d_.objects if o and o.type == "MESH"}
arm = next(o for o in d_.objects if o and o.type == "ARMATURE")
J = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}

def region_of(bone):
    side = "l" if bone.endswith("_l") else "r" if bone.endswith("_r") else None
    if side and any(k in bone for k in ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")): return "arm_" + side
    if side and any(k in bone for k in ("thigh", "calf", "foot", "ball")): return "leg_" + side
    return "torso"
# body surface with each face's strongest bone
bv, bf, freg = [], [], []
for o in body.values():
    base = len(bv); bv += [o.matrix_world @ v.co for v in o.data.vertices]
    for p in o.data.polygons:
        bf.append([base + i for i in p.vertices]); w = defaultdict(float)
        for i in p.vertices:
            for g in o.data.vertices[i].groups: w[o.vertex_groups[g.group].name] += g.weight
        freg.append(region_of(max(w, key=w.get)) if w else "torso")
btree = BVHTree.FromPolygons(bv, bf)

def axis_cost(v, a, b, r):
    ax = (b - a).normalized(); d = v - a; d = d - ax * d.dot(ax)
    if d.length < 1e-6: return 1.0
    return 1.0 + 12.0 * (1.0 - d.normalized().dot(r)) / 2.0

def cut_path(bm, verts, a, b, r):
    """Cheapest edge path through `verts` from the end near a to the end near b, keeping to the side r of the a-b axis."""
    ax = (b - a); L = ax.length; ax = ax.normalized()
    t = {v: (v.co - a).dot(ax) / L for v in verts}; lo, hi = min(t.values()), max(t.values())
    def end(near):
        cand = [v for v in verts if abs(t[v] - near) < 0.06]
        return min(cand, key=lambda v: axis_cost(v.co, a, b, r)) if cand else None
    s, e = end(lo), end(hi)
    if not s or not e: return []
    dist = {s: 0.0}; prev = {}; heap = [(0.0, id(s), s)]; done = set()
    while heap:
        d, _, v = heapq.heappop(heap)
        if v in done: continue
        done.add(v)
        if v is e: break
        for ed in v.link_edges:
            w = ed.other_vert(v)
            if w not in verts: continue
            nd = d + ed.calc_length() * (axis_cost(v.co, a, b, r) + axis_cost(w.co, a, b, r)) / 2
            if nd < dist.get(w, 1e9): dist[w] = nd; prev[w] = (v, ed); heapq.heappush(heap, (nd, id(w), w))
    path = []; v = e
    while v in prev: v, ed = prev[v]; path.append(ed)
    return path

report = {}
for o in pieces:
    me = o.data; me.uv_layers.active.name = "UV_Meshy"
    me.uv_layers.new(name="UV0", do_init=True)
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
    for e in bm.edges: e.seam = False
    if o.name.startswith("Hat"):
        hat = True; nseams = 0
    else:
        reg = []
        for f in bm.faces:
            loc, nor, fi, d = btree.find_nearest(o.matrix_world @ f.calc_center_median())
            reg.append(freg[fi] if fi is not None else "torso")
        nbr = [[f2.index for e in f.edges for f2 in e.link_faces if f2 is not f] for f in bm.faces]
        for _ in range(6):  # smooth region borders
            new = reg[:]
            for i, ns in enumerate(nbr):
                c = defaultdict(int)
                for j in ns: c[reg[j]] += 1
                best = max(c, key=c.get)
                if best != reg[i] and c[best] * 2 > len(ns): new[i] = best
            reg = new
        for e in bm.edges:
            fs = e.link_faces
            if len(fs) == 2 and reg[fs[0].index] != reg[fs[1].index]: e.seam = True
        sides = {"l": 1, "r": -1}
        cuts = {}
        for name in set(reg):
            verts = {v for f in bm.faces if reg[f.index] == name for v in f.verts}
            if name.startswith("arm"):
                sx = sides[name[-1]]; a, b = J["upperarm_" + name[-1]], J["hand_" + name[-1]]
                r = Vector((-sx, 0, -1)).normalized()  # under the arm, toward the body
                cuts[name] = cut_path(bm, verts, a, b, r)
            elif name.startswith("leg"):
                sx = sides[name[-1]]; a, b = J["thigh_" + name[-1]], J["ball_" + name[-1]]
                cuts[name] = cut_path(bm, verts, a, b, Vector((-sx, 0.3, 0)).normalized())  # inside of the leg, a little behind
            else:
                a, b = J["pelvis"], J["neck_01"]
                cuts[name + "_l"] = cut_path(bm, verts, a, b, Vector((1, 0, 0)))
                cuts[name + "_r"] = cut_path(bm, verts, a, b, Vector((-1, 0, 0)))
        for path in cuts.values():
            for ed in path: ed.seam = True
        nseams = sum(1 for e in bm.edges if e.seam)
        report.setdefault(o.name, {})["regions"] = {k: reg.count(k) for k in set(reg)}
        report[o.name]["cutEdges"] = {k: len(v) for k, v in cuts.items()}
    bm.to_mesh(me); bm.free()
    me.uv_layers.active = me.uv_layers["UV0"]; me.uv_layers["UV0"].active_render = True
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    # degenerate faces (a re-welded triangulated remesh can leave some) make the unwrap collapse an island to a line
    bmd = bmesh.new(); bmd.from_mesh(me); nf = len(bmd.faces)
    bmesh.ops.dissolve_degenerate(bmd, dist=1e-5, edges=bmd.edges); bmd.to_mesh(me)
    report.setdefault(o.name, {})["degenerateFacesDissolved"] = nf - len(bmd.faces); bmd.free()
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    if o.name.startswith("Hat"):
        # a hat is hard-surface: islands split at its folds (brim rim, crown top) suit it
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.seams_from_islands()
    else:
        bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.003)
    bpy.ops.uv.select_all(action="SELECT"); bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    # stats
    bm = bmesh.new(); bm.from_mesh(me); lay = bm.loops.layers.uv["UV0"]
    parent = list(range(len(bm.faces)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    bm.faces.ensure_lookup_table()
    for e in bm.edges:  # islands: faces joined across an edge whose UVs agree on both sides
        if len(e.link_faces) != 2: continue
        f1, f2 = e.link_faces
        u1 = {l.vert.index: tuple(round(c, 5) for c in l[lay].uv) for l in f1.loops}; u2 = {l.vert.index: tuple(round(c, 5) for c in l[lay].uv) for l in f2.loops}
        if all(u1[v.index] == u2[v.index] for v in e.verts): parent[find(f1.index)] = find(f2.index)
    nseams = sum(1 for e in bm.edges if e.seam)
    ratios, area, flipped = [], 0.0, 0
    for f in bm.faces:
        uvs = [l[lay].uv for l in f.loops]
        sa = sum(uvs[i].x * uvs[(i + 1) % len(uvs)].y - uvs[(i + 1) % len(uvs)].x * uvs[i].y for i in range(len(uvs))) / 2
        area += abs(sa); flipped += sa < 0
        if f.calc_area() > 0 and sa != 0: ratios.append(math.sqrt(abs(sa) / f.calc_area()))
    ratios.sort(); med = ratios[len(ratios) // 2]
    report.setdefault(o.name, {}).update({"islands": len({find(f.index) for f in bm.faces}), "seamEdges": nseams, "uvAreaUsed": round(area, 3), "flippedFaces": flipped,
        "densitySpreadP10P90": [round(ratios[len(ratios) // 10] / med, 2), round(ratios[9 * len(ratios) // 10] / med, 2)]})
    bm.free()
    st = report[o.name]
    if not o.name.startswith("Hat") and (st["flippedFaces"] > 0 or st["uvAreaUsed"] < 0.2) and not st.get("fallback"):
        # the garment cut could not be flattened (folded layers, such as an open jacket over a waistcoat, flip faces):
        # split at the folds instead, as for hats
        bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.seams_from_islands()
        bpy.ops.uv.select_all(action="SELECT"); bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin=0.004)
        bpy.ops.object.mode_set(mode="OBJECT")
        st["fallback"] = {"from": "MINIMUM_STRETCH", "to": "SMART_PROJECT 66", "minimumStretchResult": {k: st[k] for k in ("uvAreaUsed", "flippedFaces", "densitySpreadP10P90")}}
        bm = bmesh.new(); bm.from_mesh(me); lay = bm.loops.layers.uv["UV0"]; ratios, area, flipped = [], 0.0, 0
        for f in bm.faces:
            uvs = [l[lay].uv for l in f.loops]
            sa = sum(uvs[i].x * uvs[(i + 1) % len(uvs)].y - uvs[(i + 1) % len(uvs)].x * uvs[i].y for i in range(len(uvs))) / 2
            area += abs(sa); flipped += sa < 0
            if f.calc_area() > 0 and sa != 0: ratios.append(math.sqrt(abs(sa) / f.calc_area()))
        ratios.sort(); med = ratios[len(ratios) // 2]
        bm.faces.ensure_lookup_table(); parent = list(range(len(bm.faces)))
        for e in bm.edges:
            if len(e.link_faces) != 2: continue
            f1, f2 = e.link_faces
            u1 = {l.vert.index: tuple(round(c, 5) for c in l[lay].uv) for l in f1.loops}; u2 = {l.vert.index: tuple(round(c, 5) for c in l[lay].uv) for l in f2.loops}
            if all(u1[v.index] == u2[v.index] for v in e.verts): parent[find(f1.index)] = find(f2.index)
        st["islands"] = len({find(f.index) for f in bm.faces})
        st.update({"uvAreaUsed": round(area, 3), "flippedFaces": flipped, "densitySpreadP10P90": [round(ratios[len(ratios) // 10] / med, 2), round(ratios[9 * len(ratios) // 10] / med, 2)]})
        bm.free()
    uv = me.uv_layers["UV0"].data
    json.dump([[list(uv[i].uv) for i in p.loop_indices] for p in me.polygons], open(os.path.join(out_dir, o.name + "-layout.json"), "w"))
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
json.dump(report, open(os.path.join(out_dir, "uv-report.json"), "w"), indent=1); print(json.dumps(report))
