"""Prepare the high-resolution source mesh for a quad remesh: optionally make it symmetric from its clean half, fan the
fingers of each hand slightly apart so the remesh keeps them separate, and write a welded geometry-only copy.

Optional: run it when generated fingers are fused or a hand needs mirroring from its clean side; otherwise the later
steps read the provider's mesh directly (body.md names both inputs). With `hands.fingers` 0 (mittens) no finger is
turned. With a clean side, the mesh is cut on the centre plane, that half is kept and mirrored onto the other, and the
halves are welded (the character's left is +x).

Each finger's free part is found by following it down from its tip in thin slices (a finger is a separate ring until it
merges into the palm). It is then turned in the plane of the hand about its own root by the spec's `hands.fanDegrees`
(positive toward the thumb). The turn fades in over the first 12 mm above the root.

blender --background --python-exit-code 1 --python spread_fingers.py -- <source.glb> <meshy-joints.json> <rig-scale> <out-dir> --character <character.json>
rig-scale is the factor that takes this mesh to the space the joints are in (the character's height in metres, feet at z = 0).
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix, kdtree
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(src, joints_json, S, out), spec = charspec.require(); S = float(S)
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
zmin = min(v.co.z for v in me.vertices)
mj = {k: Vector(v["head"]) for k, v in json.load(open(joints_json))["bones"].items()}
to_src = lambda p: Vector((p.x / S, p.y / S, p.z / S + zmin))
mm = 0.001 / S                      # one millimetre of the real character, in this mesh's units
# Lengths below are millimetres of the real character, as tuned on the first body built with this script.
ANGLES = dict(spec.fan_degrees)
report = {"blender": bpy.app.version_string, "anglesDegrees": ANGLES, "hands": {}}
bm = bmesh.new(); bm.from_mesh(me)
before_faces = len(bm.faces)
if spec.clean_side != "none":
    keep = 1 if spec.clean_side == "left" else -1      # the character's left is +x
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7, plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=keep > 0, clear_outer=keep < 0)
    bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), merge_dist=1e-5, axis="X")
    # the mirror copies faces with their original winding, which faces inward on the copied side: turn exactly those faces over.
    # (Recalculating normals instead would be wrong here: the mesh is still split along its UV seams, and per-island
    # recalculation turns some islands inside-out.)
    bm.faces.ensure_lookup_table()
    bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if keep * f.calc_center_median().x < 0])
bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.verts.index_update()
report["mirror"] = {"facesBefore": before_faces, "facesAfter": len(bm.faces), "keptHalf": {"left": "character's left (x > 0)", "right": "character's right (x < 0)", "none": "both, as generated"}[spec.clean_side]}
# glTF import splits vertices at UV seams: join by position for connectivity only
kd = kdtree.KDTree(len(bm.verts))
for v in bm.verts: kd.insert(v.co, v.index)
kd.balance()
rep = {}
for v in bm.verts:
    if v.index in rep: continue
    for co_, i_, d_ in kd.find_range(v.co, 1e-6): rep.setdefault(i_, v.index)
adj_all = {}
for e in bm.edges:
    a_, b_ = rep[e.verts[0].index], rep[e.verts[1].index]
    if a_ != b_: adj_all.setdefault(a_, set()).add(b_); adj_all.setdefault(b_, set()).add(a_)
members = {}
for i_, r_ in rep.items(): members.setdefault(r_, []).append(i_)

for sign, side, wn, en in (((1, "left", "LeftHand", "LeftForeArm"), (-1, "right", "RightHand", "RightForeArm")) if spec.fingers == 5 and any(ANGLES.values()) else ()):
    W = to_src(mj[wn]); E = to_src(mj[en]); a = (W - E).normalized()
    inreg = lambda i: sign * bm.verts[i].co.x > 0 and (bm.verts[i].co - W).dot(a) > 0.0 and (bm.verts[i].co - W).length < 231.117 * mm
    seed = min((i for i in members if inreg(i)), key=lambda i: (bm.verts[i].co - (W + a * 48.1493 * mm)).length)
    idx = [seed]; seen = {seed}; stack = [seed]
    while stack:
        x = stack.pop()
        for n_ in adj_all.get(x, ()):
            if n_ not in seen and inreg(n_): seen.add(n_); idx.append(n_); stack.append(n_)
    co = {i: bm.verts[i].co.copy() for i in idx}; sel = set(idx)
    adj = {i: [n_ for n_ in adj_all.get(i, ()) if n_ in sel] for i in idx}
    P = np.array([co[i][:] for i in idx]); n_h = Vector(np.linalg.svd(P - P.mean(axis=0), full_matrices=False)[2][2]); c = a.cross(n_h).normalized()
    al = {i: (co[i] - W).dot(a) for i in idx}; ac = {i: (co[i] - W).dot(c) for i in idx}; amax = max(al.values())
    lowv = [ac[i] for i in idx if al[i] < 0.55 * amax]; mid = float(np.median([ac[i] for i in idx if al[i] > 0.75 * amax]))
    tside = 1.0 if (max(lowv) - mid) > (mid - min(lowv)) else -1.0
    u = {i: tside * ac[i] for i in idx}
    step = 1.92597 * mm; umin = min(u.values()); nb = int((max(u.values()) - umin) / step) + 1; prof = [-1.0] * nb; arg = [None] * nb
    for i in idx:
        k = int((u[i] - umin) / step)
        if al[i] > prof[k]: prof[k] = al[i]; arg[k] = i
    for k in range(nb):
        if prof[k] < 0: prof[k] = prof[k - 1] if k else 0.0
    sm = np.convolve(np.array(prof), np.ones(3) / 3, mode="same")
    peaks = sorted([k for k in range(1, nb - 1) if sm[k] >= sm[k - 1] and sm[k] > sm[k + 1] and sm[k] > 0.6 * amax], key=lambda k: -sm[k]); chosen = []
    for k in peaks:
        if all(abs(k - j) * step > 10.5928 * mm for j in chosen): chosen.append(k)
        if len(chosen) == 4: break
    chosen.sort()

    def track(tip, direction):
        proj = {i: (co[i] - W).dot(direction) for i in idx}; samples = []; prev = co[tip]; sdist = 2.88896 * mm
        while sdist < 115.558 * mm:
            level = proj[tip] - sdist; band = [i for i in idx if abs(proj[i] - level) < 2.88896 * mm]; bset = set(band); seen_ = set(); comps = []
            for i in band:
                if i in seen_: continue
                comp = [i]; seen_.add(i); st = [i]
                while st:
                    x = st.pop()
                    for n_ in adj[x]:
                        if n_ in bset and n_ not in seen_: seen_.add(n_); comp.append(n_); st.append(n_)
                comps.append(comp)
            if not comps: break
            cents = [sum((co[i] for i in comp), Vector()) / len(comp) for comp in comps]
            k = min(range(len(comps)), key=lambda q: (cents[q] - prev).length)
            ext = 2 * max((co[i] - cents[k]).length for i in comps[k])
            samples.append((sdist, cents[k], ext)); prev = cents[k]; sdist += 2.88896 * mm
        early = [e for s_, c_, e in samples if 7.70389 * mm <= s_ <= 26.9636 * mm]; base = float(np.median(early)) if early else 14.4448 * mm
        root = next((s_ for s_, c_, e in samples if s_ >= 19.2597 * mm and e > 1.6 * base), samples[-1][0])
        free = [(s_, c_) for s_, c_, e in samples if s_ < root]
        return free, root, base, proj

    hand = {"peaks": len(chosen), "thumbSide": tside, "fingers": {}}; plan = []
    for name, k in zip(["pinky", "ring", "middle", "index"], chosen):
        tip = arg[k]
        free, root, base, proj = track(tip, a)
        if len(free) >= 4:
            d2 = (free[0][1] - free[-1][1]).normalized(); free, root, base, proj = track(tip, d2)
        else: d2 = a
        pivot = min(free, key=lambda t: abs(t[0] - root))[1]
        # the finger's own vertices: connected to the tip while staying above the root level
        own = {tip}; st = [tip]
        while st:
            x = st.pop()
            for n_ in adj[x]:
                if n_ not in own and proj[tip] - proj[n_] < root: own.add(n_); st.append(n_)
        plan.append((name, own, pivot, proj, proj[tip], root))
        hand["fingers"][name] = {"freeLengthMm": round(root / mm, 1), "widthMm": round(base / mm, 1), "vertices": len(own)}
    def gaps():
        # smallest distance between neighbouring fingers over their outer 60% (the webs at the roots always touch)
        g = {}
        outer = lambda own, proj, ptip, root: [i for i in own if ptip - proj[i] < 0.6 * root]
        for (n1, o1, p1, pj1, t1, r1), (n2, o2, p2, pj2, t2, r2) in zip(plan, plan[1:]):
            b_ = outer(o2, pj2, t2, r2); t = kdtree.KDTree(len(b_))
            for i in b_: t.insert(bm.verts[i].co, i)
            t.balance(); g[f"{n1}-{n2}"] = round(min(t.find(bm.verts[i].co)[2] for i in outer(o1, pj1, t1, r1)) / mm, 2)
        return g
    hand["minGapBeforeMm"] = gaps()
    shared = {}
    for name, own, pivot, proj, ptip, root in plan:
        for i in own: shared[i] = shared.get(i, 0) + 1
    hand["verticesClaimedByTwoFingers"] = sum(1 for v_ in shared.values() if v_ > 1)
    sstep = lambda t: 0.0 if t <= 0 else 1.0 if t >= 1 else t * t * (3 - 2 * t)
    for name, own, pivot, proj, ptip, root in plan:
        ang = math.radians(ANGLES[name]) * tside
        for i in own:
            if shared[i] > 1: continue
            w = sstep((root - (ptip - proj[i])) / (11.5558 * mm))
            R = Matrix.Rotation(-ang * w, 3, n_h)
            # turning about the hand normal moves the tip along the across axis; the sign is chosen so positive angles go toward the thumb
            newp = pivot + R @ (bm.verts[i].co - pivot)
            for m_ in members[i]: bm.verts[m_].co = newp
    # make sure positive angles really moved the index toward the thumb; if not, the rotation sense was inverted
    hand["minGapAfterMm"] = gaps()
    report["hands"][side] = hand

bm.to_mesh(me); bm.free(); me.update()
# the imported mesh carries stored per-corner normals; on the mirrored half they still point the old way. Drop them so
# normals come from the geometry itself (smooth), otherwise anything baked from this mesh gets wrong normals on that side.
had = [a.name for a in me.attributes if a.name == "custom_normal"]
for n_ in had: me.attributes.remove(me.attributes[n_])
for pl in me.polygons: pl.use_smooth = True
me.update(); report["storedNormalsRemoved"] = bool(had)
json.dump(report, open(os.path.join(out, "spread-report.json"), "w"), indent=1); print(json.dumps(report))
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "model-spread.glb"), export_format="GLB", use_selection=True, export_apply=True)
# geometry-only copy for remeshing: welded, holes closed, no UVs or materials, so the file has no split seams
g = ob.copy(); g.data = ob.data.copy(); g.name = "geometry"; bpy.context.scene.collection.objects.link(g)
gb = bmesh.new(); gb.from_mesh(g.data)
bmesh.ops.remove_doubles(gb, verts=gb.verts, dist=1e-6)
bmesh.ops.dissolve_degenerate(gb, edges=gb.edges[:], dist=1e-7)
holes = [e for e in gb.edges if e.is_boundary]
for _ in range(6):   # the hair crosses the mirror plane more than once: cut out any non-manifold spots and close the holes
    bad = [e for e in gb.edges if not e.is_manifold and not e.is_boundary]
    if bad: bmesh.ops.delete(gb, geom=list({f for e in bad for f in e.link_faces}), context="FACES")
    loose = [v for v in gb.verts if not v.link_faces]
    if loose: bmesh.ops.delete(gb, geom=loose, context="VERTS")
    be = [e for e in gb.edges if e.is_boundary]
    if not bad and not be: break
    if be: bmesh.ops.holes_fill(gb, edges=be, sides=0)
    ng = [f for f in gb.faces if len(f.verts) > 4]
    if ng: bmesh.ops.triangulate(gb, faces=ng)
bmesh.ops.recalc_face_normals(gb, faces=gb.faces[:])
geo = {"faces": len(gb.faces), "boundaryEdgesAfter": sum(1 for e in gb.edges if e.is_boundary), "nonManifoldEdgesAfter": sum(1 for e in gb.edges if not e.is_manifold and not e.is_boundary), "holesFilledFromBoundaryEdges": len(holes)}
gb.to_mesh(g.data); gb.free()
while g.data.uv_layers: g.data.uv_layers.remove(g.data.uv_layers[0])
g.data.materials.clear()
for pl in g.data.polygons: pl.use_smooth = True
bpy.ops.object.select_all(action="DESELECT"); g.select_set(True); bpy.context.view_layer.objects.active = g
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "model-spread-geometry.glb"), export_format="GLB", use_selection=True, export_apply=True, export_materials="NONE", export_texcoords=False, export_normals=False)
report["geometryOnly"] = geo
json.dump(report, open(os.path.join(out, "spread-report.json"), "w"), indent=1); print("GEOMETRY", json.dumps(geo))
