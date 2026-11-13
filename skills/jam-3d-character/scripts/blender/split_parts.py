"""Swappable parts only: split a quad whole-body mesh into the character spec's parts, keeping every face a quad: head
(with a constructed scalp under the hair), hair, and the body (clothing and limbs). Faces are classified by the base-colour
texture: the hair role's class (searched above hairMinHeightShare of the height), the neckline role's class (its top border
is the head/body border; without one, neckHeightShare cuts the neck at that height), and the rest. A character without hair
gets head and body. A one-mesh character (no head part) needs no split: export_parts.py names its mesh directly.
blender --background --factory-startup --python-exit-code 1 --python split_parts.py -- <model.fbx> <base_color.png> <out-dir> --character <character.json>"""
import bpy, bmesh, sys, os, json, colorsys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
(model, tex, out), spec = charspec.require()
HEAD, HAIR, BODY = spec.part("head"), spec.part("hair"), spec.part("body")
HAIR_CLS = spec.role_class("hair") if HAIR else None
NECK_CLS = spec.role_class("neckline")
CANDS = list(spec.classes)
HMS = spec.hair_min_height_share                    # hair is searched above this share of the height
FIT_SHARE = 1 - (1 - HMS) * 0.625                   # forehead skin used to fit the cranium sits above this share
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=model)
src = [x for x in bpy.context.scene.objects if x.type == "MESH"][0]
bpy.context.view_layer.objects.active = src; src.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
img = bpy.data.images.load(tex); W, Hh = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(Hh, W, img.channels)[:, :, :3]
bm = bmesh.new(); bm.from_mesh(src.data); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
uv = bm.loops.layers.uv.active
zs = [v.co.z for v in bm.verts]; zmin, zmax = min(zs), max(zs); H = zmax - zmin
mm = spec.mm(H)                                    # one millimetre of the real character, in this mesh's units
stats = {"blender": bpy.app.version_string, "character": spec.name, "source": {"faces": len(bm.faces), "quads": sum(1 for f in bm.faces if len(f.verts) == 4)}}
def info(ob):
    b = bmesh.new(); b.from_mesh(ob.data)
    r = {"verts": len(b.verts), "faces": len(b.faces), "quads": sum(1 for f in b.faces if len(f.verts) == 4), "nonQuads": sum(1 for f in b.faces if len(f.verts) != 4),
         "exportTriangles": sum(len(f.verts) - 2 for f in b.faces), "boundaryEdges": sum(1 for e in b.edges if e.is_boundary),
         "nonManifoldEdges": sum(1 for e in b.edges if not e.is_manifold and not e.is_boundary)}
    b.free(); return r
def finish(objs):
    stats["parts"] = {o.name: info(o) for o in objs}
    stats["totalExportTriangles"] = sum(p["exportTriangles"] for p in stats["parts"].values())
    json.dump(stats, open(os.path.join(out, "split-stats.json"), "w"), indent=2); print(json.dumps(stats))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "character-parts.blend"))
if not HEAD:
    # one mesh: nothing to split; the mesh is the body part and the colour still fits it
    bm.free()
    bpy.ops.object.select_all(action="DESELECT"); src.select_set(True); bpy.context.view_layer.objects.active = src
    bpy.ops.export_scene.fbx(filepath=os.path.join(out, "model-snapped.fbx"), use_selection=True, object_types={"MESH"}, use_triangles=False, mesh_smooth_type="FACE")
    src.name = BODY; src.data.name = BODY
    for p_ in src.data.polygons: p_.use_smooth = True
    stats["classified"] = {"body": len(src.data.polygons)}
    finish([src]); raise SystemExit(0)
# one label map of the whole texture (charspec's single classification rule): every per-texel test below reads it
LABELS, LABEL_NAMES = spec.label_map(px, CANDS)
def class_mask(cname): return LABELS == LABEL_NAMES.index(cname)
HAIR_SAMPLES = {}
def face_hsv(f):
    cols = []; pts = []
    cu = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    for p in [cu] + [(l[uv].uv + cu) / 2 for l in f.loops]:
        x = min(W - 1, max(0, int(p.x % 1.0 * W))); y = min(Hh - 1, max(0, int(p.y % 1.0 * Hh)))
        cols.append(px[y, x]); pts.append((y, x))
    HAIR_SAMPLES[f.index] = sum(1 for y, x in pts if LABEL_NAMES[LABELS[y, x]] == HAIR_CLS) if HAIR_CLS else 0
    return tuple(float(x) for x in np.median(np.array(cols), axis=0))
cls = {}
for f in bm.faces:
    rgb = face_hsv(f)
    z = (f.calc_center_median().z - zmin) / H
    if NECK_CLS and spec.belongs(NECK_CLS, rgb, CANDS): c = "neckline"
    elif not NECK_CLS and z < spec.neck_height_share: c = "neckline"     # the neck cut by height: everything below is body
    elif HAIR_CLS and spec.belongs(HAIR_CLS, rgb, CANDS) and z > HMS: c = "hair"
    else: c = "other"
    cls[f.index] = c
def components(faces):
    faces = set(faces); comps = []
    while faces:
        seed = faces.pop(); comp = {seed}; stack = [seed]
        while stack:
            f = bm.faces[stack.pop()]
            for e in f.edges:
                for g in e.link_faces:
                    if g.index in faces: faces.remove(g.index); comp.add(g.index); stack.append(g.index)
        comps.append(comp)
    return sorted(comps, key=len, reverse=True)
neck_comps = components([i for i, c in cls.items() if c == "neckline"])
neckline_faces = neck_comps[0] if NECK_CLS else set().union(*neck_comps)
hair_comps = components([i for i, c in cls.items() if c == "hair"]) if HAIR_CLS else []
hair = set(hair_comps[0]) if hair_comps else set()
if HAIR_CLS and not hair:
    raise SystemExit(f"no faces read as the hair class '{HAIR_CLS}' above {HMS:.2f} of the height: sample its colour (or set an hsv window) from this texture, or set parts.hair and roles.hair to null")
# sideburns can read as separate hair-coloured patches beside the ears; they are hair, not skin. Eyebrows stay on the face:
# they sit near the middle of the face, while sideburns sit at the sides of the head.
hx = [v.co.x for i in hair for v in bm.faces[i].verts] or [0.0]; half = (max(hx) - min(hx)) / 2; cx = (max(hx) + min(hx)) / 2
# faces along the hairline that are partly hair-coloured belong under the hair piece too, or they show as skin patches in it
grown = 0
for _ in range(2):
    add = set()
    for i in hair:
        for e in bm.faces[i].edges:
            for g in e.link_faces:
                if g.index not in hair and g.index not in neckline_faces and HAIR_SAMPLES.get(g.index, 0) >= 2 and (g.calc_center_median().z - zmin) / H > HMS: add.add(g.index)
    hair |= add; grown += len(add)
sideburns = 0
for comp in hair_comps[1:]:
    cen = sum((bm.faces[i].calc_center_median() for i in comp), Vector()) / len(comp)
    if len(comp) >= 4 and abs(cen.x - cx) > 0.62 * half: hair |= comp; sideburns += len(comp)
# fill small non-hair holes fully enclosed by hair (texture noise), and absorb tiny hair-coloured islands touching hair
rest = components([i for i in cls if i not in neckline_faces])
top_face = max(bm.faces, key=lambda f: f.calc_center_median().z).index
headcomp = next(c for c in rest if top_face in c)
nonhair_head = components([i for i in headcomp if i not in hair])
face_skin = nonhair_head[0]
for c in nonhair_head[1:]:
    if len(c) < 60: hair |= c      # small pockets inside the hair mass
head = set(headcomp) - hair
body = set(cls) - set(headcomp)
# ---- part borders follow the colour borders in the texture, not the quad grid ----
# A border between two parts used to run along whichever quad edges were nearest, in stair-steps, so each part
# carried slivers of the other's colour. Here the faces along a border are first assigned by their area share of each
# colour, then the border vertices slide onto the colour border itself and the rings beside them are evened out.
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree
HAIR_MASK = class_mask(HAIR_CLS) if HAIR_CLS else None
NOT_NECK = ~class_mask(NECK_CLS) if NECK_CLS else None
GN = 10; _ab = np.linspace(0.03, 0.97, GN); _A, _B = np.meshgrid(_ab, _ab, indexing="ij")
_Wt = np.stack([(1 - _A) * (1 - _B), _A * (1 - _B), _A * _B, (1 - _A) * _B], axis=-1)
def tex_at(mask, u, v_):
    return mask[np.clip((np.asarray(v_) % 1.0 * Hh).astype(int), 0, Hh - 1), np.clip((np.asarray(u) % 1.0 * W).astype(int), 0, W - 1)]
def face_samples(f, mask):
    """A GN x GN grid of points inside a quad: their positions and whether the texture there has the mask colour."""
    Pc = np.array([l.vert.co[:] for l in f.loops]); Uc = np.array([l[uv].uv[:] for l in f.loops])
    pos = _Wt @ Pc; uvs = _Wt @ Uc
    return pos, tex_at(mask, uvs[:, :, 0], uvs[:, :, 1])
_frac = {}
def frac(i, mask):
    k = (i, id(mask))
    if k not in _frac: _frac[k] = float(face_samples(bm.faces[i], mask)[1].mean())
    return _frac[k]
def across(i, other):
    return sum(1 for e in bm.faces[i].edges for g in e.link_faces if g.index != i and g.index in other)
def refine(A, B, mask):
    """Move faces along the A/B border to the side whose colour covers most of them (mask is A's colour), then
    remove single-face spikes and notches, which would collapse when the border is straightened."""
    changed = 0
    for _ in range(6):
        toB = {i for i in A if across(i, B) and frac(i, mask) < 0.5}
        toA = {i for i in B if across(i, A) and frac(i, mask) >= 0.5}
        if not toA and not toB: break
        A -= toB; B |= toB; B -= toA; A |= toA; changed += len(toA) + len(toB)
    for _ in range(12):
        toB = {i for i in A if across(i, B) >= 3}; A -= toB; B |= toB
        toA = {i for i in B if across(i, A) >= 3}; B -= toA; A |= toA
        if not toA and not toB: break
        changed += len(toA) + len(toB)
    return changed
def colour_border(A, B, mask):
    """Border edges and vertices between face sets A and B, and points on the colour border near them."""
    border = [e for e in bm.edges if len(e.link_faces) == 2 and ({e.link_faces[0].index in A, e.link_faces[1].index in A} == {True, False}) and ({e.link_faces[0].index in B, e.link_faces[1].index in B} == {True, False})]
    bverts = {v for e in border for v in e.verts}
    ring = set(bverts)
    for _ in range(2): ring |= {e.other_vert(v) for v in ring for e in v.link_edges}
    faces = {f for v in ring for f in v.link_faces if f.index in A or f.index in B}
    pts = []
    for f in faces:
        pos, ind = face_samples(f, mask)
        pad = np.pad(ind.astype(int), 1, mode="edge"); ind = sum(pad[1 + a:1 + a + GN, 1 + b_:1 + b_ + GN] for a in (-1, 0, 1) for b_ in (-1, 0, 1)) >= 5
        c = ind[1:, :] != ind[:-1, :]; pts += list(((pos[1:, :] + pos[:-1, :]) / 2)[c])
        c = ind[:, 1:] != ind[:, :-1]; pts += list(((pos[:, 1:] + pos[:, :-1]) / 2)[c])
    # the colour border can also lie exactly on a quad edge, between the two grids
    for e in {e for f in faces for e in f.edges if len(e.link_faces) == 2 and all(g in faces for g in e.link_faces)}:
        v1, v2 = e.verts
        for t in np.linspace(0.06, 0.94, 8):
            vals = []
            for fc in e.link_faces:
                lu = {l.vert: l[uv].uv for l in fc.loops}; cu = sum(lu.values(), Vector((0, 0))) / len(lu)
                q = lu[v1].lerp(lu[v2], float(t)).lerp(cu, 0.08); vals.append(bool(tex_at(mask, q.x, q.y)))
            if vals[0] != vals[1]: pts.append(np.array(v1.co.lerp(v2.co, float(t))[:]))
    return border, bverts, np.array(pts)
def snap(border, bverts, pts):
    """Slide the border vertices onto the colour border and space them evenly along it."""
    kd = KDTree(len(pts))
    for i, p_ in enumerate(pts): kd.insert(Vector(p_), i)
    kd.balance()
    L = float(np.median([e.calc_length() for e in border])); maxd = 1.6 * L
    orig = {v: v.co.copy() for v in bverts}; path = {v: [] for v in bverts}
    for e in border:
        a, b_ = e.verts; path[a].append(b_); path[b_].append(a)
    def near(p_, v):
        co = kd.find(p_)[0]
        return co.copy() if (co - orig[v]).length <= maxd else None
    unsnapped = 0
    for v in bverts:
        q = near(v.co, v)
        if q is None: unsnapped += 1
        else: v.co = q
    for _ in range(30):
        new = {}
        for v in bverts:
            if len(path[v]) == 2:
                q = near(v.co * 0.5 + (path[v][0].co + path[v][1].co) * 0.25, v)
                if q is not None: new[v] = q
        for v, q in new.items(): v.co = q
    moved_mm = [(v.co - orig[v]).length / mm for v in bverts]
    seg = [e.calc_length() / mm for e in border]
    return {"borderVerts": len(bverts), "contourPoints": int(len(pts)), "vertsLeftInPlace": unsnapped, "junctionVerts": sum(1 for v in bverts if len(path[v]) != 2),
            "movedMm": {"mean": round(float(np.mean(moved_mm)), 2), "max": round(float(np.max(moved_mm)), 2)},
            "borderEdgeMm": {"min": round(min(seg), 2), "median": round(float(np.median(seg)), 2), "max": round(max(seg), 2)}}
surface = BVHTree.FromBMesh(bm)                   # the surface before any vertex moves
bm.normal_update(); normal0 = {f.index: f.normal.copy() for f in bm.faces}; area0 = {f.index: f.calc_area() for f in bm.faces}
whole_head = set(headcomp)
border_stats = {"collarFacesReassigned": refine(whole_head, body, NOT_NECK) if NECK_CLS else 0}
hair &= whole_head; head = whole_head - hair
border_stats["hairlineFacesReassigned"] = refine(hair, head, HAIR_MASK) if hair else 0
jobs = ([("hairline", colour_border(hair, head, HAIR_MASK))] if hair else []) + ([("collar", colour_border(whole_head, body, NOT_NECK))] if NECK_CLS else [])
fixed_verts = set()
for label, (border, bverts, pts) in jobs:
    border_stats[label] = snap(border, bverts, pts); fixed_verts |= bverts
ring1 = {e.other_vert(v) for v in fixed_verts for e in v.link_edges} - fixed_verts
ring2 = {e.other_vert(v) for v in ring1 for e in v.link_edges} - fixed_verts - ring1
weight = {**{v: 0.5 for v in ring1}, **{v: 0.3 for v in ring2}}
def convex(f):
    vs = [v.co for v in f.verts]; k = len(vs)
    return all((vs[(i + 1) % k] - vs[i]).cross(vs[(i - 1) % k] - vs[i]).dot(f.normal) >= 0 for i in range(k))
convex0 = {f.index: convex(f) for f in bm.faces}
def sound(v):   # no face around the vertex turned over, collapsed or became an arrowhead (thin parts such as the ears fold easily)
    for f in v.link_faces:
        f.normal_update()
        if f.normal.dot(normal0[f.index]) < 0.5 or f.calc_area() < 0.35 * area0[f.index] or (convex0[f.index] and not convex(f)): return False
    return True
rejected = 0
for _ in range(25):
    for v, w in weight.items():
        old_co = v.co.copy()
        v.co = surface.find_nearest(v.co.lerp(sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges), w))[0]
        if not sound(v): v.co = old_co; rejected += 1
bm.normal_update()
border_stats["smoothingMovesRejected"] = rejected
# A quad with three vertices on a border becomes an arrowhead when the border bends toward its fourth vertex; one of
# its two triangles then lies flipped over its neighbour. Such a corner is moved just past the line between its two
# neighbours, so every quad beside a border stays convex.
near_faces = {f for v in fixed_verts | ring1 | ring2 for f in v.link_faces}
def corner_turn(f, i):   # about the sine of how far the corner is from a straight angle; negative when it points inward
    vs = [v.co for v in f.verts]; k = len(vs); e1 = vs[(i + 1) % k] - vs[i]; e0 = vs[(i - 1) % k] - vs[i]
    return e1.cross(e0).dot(f.normal) / max(e1.length * e0.length, 1e-12)
straightened = 0
for _ in range(60):
    changed = 0
    for f in near_faces:
        if len(f.verts) != 4: continue
        f.normal_update()
        for i, v in enumerate(f.verts):
            if v not in fixed_verts or f.verts[i - 1] not in fixed_verts or f.verts[(i + 1) % 4] not in fixed_verts or corner_turn(f, i) >= 0.15: continue
            a, c, d = f.verts[i - 1].co, f.verts[(i + 1) % 4].co, f.verts[(i + 2) % 4].co
            u = (c - a).normalized(); t = min(0.75, max(0.25, (v.co - a).dot(u) / (c - a).length)); foot = a.lerp(c, t)
            w = foot - d; w -= u * w.dot(u)
            if w.length < 1e-9: continue
            v.co = surface.find_nearest(foot + w.normalized() * 0.13 * (c - a).length)[0]; changed += 1
    straightened += changed
    if not changed: break
bm.normal_update()
border_stats["cornersMadeConvex"] = straightened
border_stats["arrowheadCornersLeft"] = sum(1 for f in near_faces if len(f.verts) == 4 and any(v in fixed_verts for v in f.verts) for i in range(4) if corner_turn(f, i) < 0.0)
border_stats["facesBesideBorders"] = len(near_faces)
border_stats["arrowheadFacesBesideBorders"] = {"before": sum(1 for f in near_faces if not convex0[f.index]), "after": sum(1 for f in near_faces if not convex(f))}
border_stats["facesTurnedOver"] = sum(1 for f in near_faces if f.normal.dot(normal0[f.index]) < 0.2)
border_stats["smallestFaceShareOfOriginalArea"] = round(min(f.calc_area() / area0[f.index] for f in near_faces), 2)
border_stats["poorFaces"] = [{"part": "hair" if f.index in hair else "head" if f.index in head else "body", "centre": [round(c, 4) for c in f.calc_center_median()], "areaMm2": round(f.calc_area() / mm ** 2, 1),
                              "turn": round(f.normal.dot(normal0[f.index]), 2), "borderVerts": sum(1 for v in f.verts if v in fixed_verts)}
                             for f in near_faces if f.normal.dot(normal0[f.index]) < 0.2 or f.calc_area() < 0.25 * area0[f.index]]
# the whole mesh with the moved vertices, for projecting the colour again: the old texture no longer fits the moved faces
bm.to_mesh(src.data); src.data.update()
bpy.ops.object.select_all(action="DESELECT"); src.select_set(True); bpy.context.view_layer.objects.active = src
bpy.ops.export_scene.fbx(filepath=os.path.join(out, "model-snapped.fbx"), use_selection=True, object_types={"MESH"}, use_triangles=False, mesh_smooth_type="FACE")
stats.update({"classified": {"hair": len(hair), "head": len(head), "body": len(body), "necklineComponent": len(neckline_faces), "hairComponents": [len(c) for c in hair_comps[:6]], "sideburnFacesAddedToHair": sideburns, "hairlineFacesAddedToHair": grown}, "borders": border_stats})
# build a part from faces of the split mesh (hair: the hair faces in their original shape)
def build(name, face_ids, moved=None):
    me = bpy.data.meshes.new(name); nb = bmesh.new(); vmap = {}
    uvl = nb.loops.layers.uv.new("UVMap")
    for i in sorted(face_ids):
        f = bm.faces[i]; vs = []
        for v in f.verts:
            if v.index not in vmap:
                co = moved[v.index] if moved and v.index in moved else v.co
                vmap[v.index] = nb.verts.new(co)
            vs.append(vmap[v.index])
        nf = nb.faces.new(vs)
        for l, ol in zip(nf.loops, f.loops): l[uvl].uv = ol[uv].uv
        nf.smooth = True
    nb.normal_update(); nb.to_mesh(me); nb.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob
if not hair:
    # no hair part: the head is the whole head component, with no scalp to build
    head_ob = build(HEAD, head); body_ob = build(BODY, body)
    src.hide_render = True; bpy.data.objects.remove(src)
    finish([head_ob, body_ob]); raise SystemExit(0)
# hairline: vertices shared by hair faces and head faces
hair_verts = {v.index for i in hair for v in bm.faces[i].verts}
head_verts = {v.index for i in head for v in bm.faces[i].verts}
hairline = hair_verts & head_verts
inner = hair_verts - hairline
P = np.array([bm.verts[i].co[:] for i in hairline])
# sphere through the hairline ring plus forehead/temple skin just below it
near = [v for i in head for v in bm.faces[i].verts if (v.co.z - zmin) / H > FIT_SHARE]
Q = np.array([v.co[:] for v in near]) if near else P
pts = np.vstack([P, Q])
A = np.hstack([2 * pts, np.ones((len(pts), 1))]); b = (pts ** 2).sum(axis=1)
sol, *_ = np.linalg.lstsq(A, b, rcond=None)
centre = sol[:3]; centre[0] = 0.5 * (pts[:, 0].min() + pts[:, 0].max())
radius = float(np.sqrt(sol[3] + (sol[:3] ** 2).sum()))
stats["cranium"] = {"centre": [float(x) for x in centre], "radius": radius, "hairlineVerts": len(hairline), "fitPoints": len(pts)}
C = Vector(centre)
# scalp: the same hair faces pulled down onto the fitted cranium, never above the original hair surface
moved = {}
for i in inner:
    co = bm.verts[i].co; d = co - C; r = d.length
    target = min(radius, r - 1.93 * mm)
    moved[i] = C + d.normalized() * target
hair_ob = build(HAIR, hair)
head_ob = build(HEAD, head | hair, moved)
body_ob = build(BODY, body)
# rebuild the scalp without folds: relax the patch to a soap film inside the fixed hairline, then push each
# vertex out from the cranium centre to a radius that blends from the hairline's own radius to the fitted sphere
hb = bmesh.new(); hb.from_mesh(head_ob.data); hb.verts.ensure_lookup_table()
moved_set = {tuple(round(c, 6) for c in co) for co in moved.values()}
scalp = [v for v in hb.verts if tuple(round(c, 6) for c in v.co) in moved_set]
sset = set(scalp)
nbrs = {v: [e.other_vert(v) for e in v.link_edges] for v in scalp}
depth = {}
frontier = [v for v in scalp if any(n not in sset for n in nbrs[v])]
for v in frontier: depth[v] = 1
while frontier:
    nxt = []
    for v in frontier:
        for n in nbrs[v]:
            if n in sset and n not in depth: depth[n] = depth[v] + 1; nxt.append(n)
    frontier = nxt
pos = {v: v.co.copy() for v in scalp}
home = {v: (v.co - C).normalized() for v in scalp}      # the direction of each vertex's own hair vertex
rad = {v: (v.co - C).length for v in hb.verts}
for _ in range(400):
    npos = {}; nrad = {}
    for v in scalp:
        npos[v] = sum((pos.get(n, n.co) for n in nbrs[v]), Vector()) / len(nbrs[v])
        nrad[v] = sum(rad[n] for n in nbrs[v]) / len(nbrs[v])
    pos = npos; rad.update(nrad)
def smoothstep(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def target(v, d):  # radius the scalp should have at this vertex
    w = smoothstep((depth.get(v, 1) - 0.5) / 8.0)
    return (1 - w) * rad[v] + w * radius
for v in scalp:
    d = pos[v] - C
    if d.length < 1e-6: d = Vector((0, 0, 1))
    v.co = C + d.normalized() * target(v, d)
def quads_sound(v):   # every quad around the vertex is convex and faces outward
    for f in v.link_faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - C) <= 0: return False
        vs = [x.co for x in f.verts]; k = len(vs)
        for i in range(k):
            e1 = vs[(i + 1) % k] - vs[i]; e0 = vs[(i - 1) % k] - vs[i]
            if e1.cross(e0).dot(f.normal) < 0.03 * e1.length * e0.length: return False
    return True
# where the relaxed layout left an arrowhead or a turned quad (beside a bend in the hairline), the vertex goes back
# under its own hair vertex, where the quad has the hair quad's sound shape
for _ in range(3):
    for v in scalp:
        if not quads_sound(v):
            keep = v.co.copy(); v.co = C + home[v] * target(v, None)
            if not quads_sound(v): v.co = keep
# slide vertices along the dome until the quads are evenly sized, keeping each on its target radius and its quads sound
for _ in range(250):
    for v in scalp:
        was_sound = quads_sound(v); old_co = v.co.copy()
        d = v.co.lerp(sum((n.co for n in nbrs[v]), Vector()) / len(nbrs[v]), 0.6) - C
        v.co = C + d.normalized() * target(v, d)
        if was_sound and not quads_sound(v): v.co = old_co
# keep the scalp under the hair: where the hair lies close to the skull (above the ears, at the temples and the nape)
# the fitted dome would come out through it. Each scalp vertex is limited to a few millimetres below the hair surface
# met by a ray from the cranium centre, checked also toward its neighbours, then checked again across every scalp face.
hair_bvh = BVHTree.FromPolygons([v.co[:] for v in hair_ob.data.vertices], [tuple(p.vertices) for p in hair_ob.data.polygons])
def hair_radius(p):
    d = (p - C).normalized(); hit = hair_bvh.ray_cast(C, d)
    return hit[3] if hit[0] is not None else None
limit = {}
for v in scalp:
    r = hair_radius(v.co)
    if r is not None: limit[v] = r - min(3.0, 1.0 * depth.get(v, 1)) * mm
def settle():
    """Lower the scalp from its designed dome by the smallest smooth amount that keeps it under every limit: the
    lowering spreads to the neighbours like a membrane, so lowered areas blend into the dome without creases."""
    need = {v: max(0.0, target(v, None) - limit[v]) if v in limit else 0.0 for v in scalp}
    drop = dict(need)
    for _ in range(300):
        drop = {v: max(need[v], sum(drop.get(n, 0.0) for n in nbrs[v]) / len(nbrs[v])) for v in scalp}
    for v in scalp: v.co = C + (v.co - C).normalized() * (target(v, None) - drop[v])
    return sum(1 for x in need.values() if x > 0)
clamped = settle()
scalp_faces = [f for f in hb.faces if any(v in sset for v in f.verts)]
_g = np.linspace(0.1, 0.9, 5)
def poking():
    bad = {}
    for f in scalp_faces:
        if len(f.verts) != 4 or min(depth.get(v, 0) for v in f.verts if v in sset) < 1: continue
        c = [v.co for v in f.verts]; worst = 0.0
        for a in _g:
            for b_ in _g:
                p = c[0] * (1 - a) * (1 - b_) + c[1] * a * (1 - b_) + c[2] * a * b_ + c[3] * (1 - a) * b_
                # the first ring of scalp faces touches the hair's edge, so only count points clear of the hairline
                if min((p - v.co).length for v in f.verts if v not in sset) < 2 * mm if any(v not in sset for v in f.verts) else False: continue
                r = hair_radius(p)
                if r is not None: worst = max(worst, (p - C).length + 0.5 * mm - r)
        if worst > 0: bad[f] = worst
    return bad
for _ in range(12):
    bad = poking()
    if not bad: break
    for f, over in bad.items():
        for v in f.verts:
            if v in sset: limit[v] = min(limit.get(v, (v.co - C).length), (v.co - C).length) - over - 0.5 * mm
    settle()
left = poking()
unsound = sum(1 for v in scalp if not quads_sound(v))
hb.normal_update(); hb.to_mesh(head_ob.data); hb.free()
stats["scalp"] = {"verts": len(scalp), "maxDepthRings": max(depth.values()) if depth else 0, "vertsLoweredUnderHair": clamped, "scalpVertsWithUnsoundQuads": unsound, "facesStillThroughHair": len(left), "worstThroughHairMm": round(max(left.values()) / mm, 2) if left else 0.0}
src.hide_render = True; bpy.data.objects.remove(src)
finish([head_ob, hair_ob, body_ob])
