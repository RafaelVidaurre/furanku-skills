"""Split a warped outfit (warp_to_body.py) into the pieces an outfit delivers: the outfit body and, if any, the hat with the
hair that shows below its brim. The generated head and hands are discarded: the body's own head and shared hands are worn.
blender --background --python-exit-code 1 --python split_outfit.py -- <warped.blend> <body-modelled.blend> <body-joints.json> <name> <out.blend> <report.json> --character <body character.json> [--no-hat] [--hat-hair]

- body-modelled.blend: the body's parts as modelled (straight arms), in the generation's normalised space; it is scaled
  to the joints' height with the feet at zero, the space warp_to_body.py writes. Its part objects are named by the body's
  character spec.
- name: suffix of the pieces, e.g. Ranger gives `Outfit_Ranger` and `Hat_Ranger`.

Each face is labelled by two things: which part of the body is nearest (head, hair, outfit, hands; faces beyond the
body's wrist planes, 1.5 cm up the forearm as split_hands.py cuts them, count as hands) and the colour of its texture,
tested against the body's `skin` and `hair` classes. Skin beside the head or the hands is discarded; hair-coloured faces
beside the head go with the hat (--hat-hair) or are discarded; anything else above the head joint is the hat; everything
else is the outfit body. Labels are then smoothed so no speck of one label sits inside another, and each piece keeps its largest
connected part."""
import bpy, bmesh, sys, os, json, colorsys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import charspec

args, spec = charspec.require()
warped, body_blend, joints_path, name, out_blend, report_path = args[:6]
want_hat = "--no-hat" not in args
# Without --hat-hair the hat is the hat alone and the body's own hair is worn under it; with it, the generated hair below the brim goes with the hat.
hat_hair = "--hat-hair" in args
J = json.load(open(joints_path))["bones"]; height = json.load(open(joints_path))["meshBounds"][1][2]

bpy.ops.wm.open_mainfile(filepath=warped)
outfit = bpy.data.objects["Outfit"]; me = outfit.data
wanted_parts = spec.present_parts()
with bpy.data.libraries.load(body_blend) as (src, dst):
    missing = [n for n in wanted_parts if n not in src.objects]
    if missing: raise SystemExit(f"{body_blend}: no object named {missing} (the body's character spec names its parts)")
    dst.objects = [n for n in src.objects if n in wanted_parts]  # file order: ties between parts resolve as before
parts = {}
for o in dst.objects:
    bpy.context.scene.collection.objects.link(o)
    parts[o.name] = o
lo = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in parts.values())
hi = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o in parts.values())
s = height / (hi - lo)
trees = {}
for n, o in parts.items():
    M = Matrix.Translation((0, 0, -lo * s)) @ Matrix.Scale(s, 4) @ o.matrix_world
    trees[n] = BVHTree.FromPolygons([M @ v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons])

# texture colour per face, at its UV centre
img = next(n.image for n in outfit.material_slots[0].material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
W_, H_ = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(H_, W_, 4)
uv = me.uv_layers.active.data
def colour(p):
    u = sum(uv[i].uv[0] for i in p.loop_indices) / p.loop_total; v = sum(uv[i].uv[1] for i in p.loop_indices) / p.loop_total
    x = min(W_ - 1, max(0, int((u % 1) * W_))); y = min(H_ - 1, max(0, int((v % 1) * H_)))
    r, g, b = px[y, x, :3]
    return colorsys.rgb_to_hsv(float(r), float(g), float(b))
def class_test(role):
    """The body's class for a role as an hsv test (h in 0-1); a role the body lacks matches nothing."""
    cname = spec.role_class(role)
    if cname is None: return lambda h, s_, v: False
    w = {"hue": [0.0, 360.0], "saturation": [0.0, 1.0], "value": [0.0, 1.0], **spec.window(cname)}   # a key the window leaves out is unconstrained
    def test(h, s_, v):
        a, b = w["hue"]; hd = h * 360.0
        return (a <= hd <= b if a <= b else (hd >= a or hd <= b)) and w["saturation"][0] <= s_ <= w["saturation"][1] and w["value"][0] <= v <= w["value"][1]
    return test
is_skin, is_hair = class_test("skin"), class_test("hair")
role_of = {n: spec.role_of_object(n) for n in parts}

planes = []
for side in ("Left", "Right"):
    w = Vector(J[side + "Hand"]["head"]); e = Vector(J[side + "ForeArm"]["head"]); a = (w - e).normalized()
    planes.append((w - a * 0.015, a, (w - e).length * 0.6))
def beyond_wrist(c):
    for p, a, r in planes:
        d = (c - p).dot(a)
        if d > 0 and ((c - p) - a * d).length < r * 1.5 and d < r * 2: return True
    return False

DISCARD, BODY, HAT = 0, 1, 2
head_z = Vector(J["Head"]["head"]).z + 0.02  # J holds Meshy's joints: its rig names the head bone Head
labels = []; zone_count = {"head": 0, "hair": 0, "hands": 0, "body": 0}
for p in me.polygons:
    c = outfit.matrix_world @ p.center
    h, s_, v = colour(p)
    if beyond_wrist(c):
        zone = "hands"
    else:
        dist = {n: trees[n].find_nearest(c)[3] for n in trees}
        zone = role_of[min(dist, key=dist.get)]
    zone_count[zone] += 1
    if zone == "hands": labels.append(DISCARD if is_skin(h, s_, v) else BODY)
    elif zone in ("head", "hair"):
        # beside the head: skin and hair go (unless the hat carries the hair); anything else above the head joint is the
        # hat, whatever its colour; below it (collar, tie) it is the outfit
        if is_skin(h, s_, v): labels.append(DISCARD)
        elif is_hair(h, s_, v): labels.append(HAT if want_hat and hat_hair else DISCARD)
        elif c.z > head_z: labels.append(HAT if want_hat else DISCARD)
        else: labels.append(BODY)
    else:
        labels.append(DISCARD if is_skin(h, s_, v) and c.z > height * 0.75 else BODY)

bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
nbr = [[f2.index for e in f.edges for f2 in e.link_faces if f2 is not f] for f in bm.faces]
for _ in range(4):  # majority smoothing: a face whose neighbours mostly disagree takes their label
    new = labels[:]
    for i, ns in enumerate(nbr):
        if not ns: continue
        counts = {}
        for j in ns: counts[labels[j]] = counts.get(labels[j], 0) + 1
        best = max(counts, key=counts.get)
        if best != labels[i] and counts[best] * 2 > len(ns): new[i] = best
    labels = new
# Faces of another label wholly surrounded by hat (a highlight on the crown, the band) belong to the hat.
if want_hat:
    seen = set()
    for i, l in enumerate(labels):
        if l == HAT or i in seen: continue
        comp, edge, stack = [], set(), [i]
        while stack:
            k = stack.pop()
            if k in seen: continue
            if labels[k] == HAT: edge.add(HAT); continue
            seen.add(k); comp.append(k)
            for j in nbr[k]:
                if labels[j] == HAT: edge.add(HAT)
                elif j not in seen: stack.append(j)
            if len(comp) > 400: break
        if len(comp) <= 400 and comp and all(labels[j] == HAT for k in comp for j in nbr[k] if j not in comp):
            for k in comp: labels[k] = HAT
def largest(label):
    idx = {i for i, l in enumerate(labels) if l == label}; best = set(); seen = set()
    for i in idx:
        if i in seen: continue
        comp = set(); stack = [i]
        while stack:
            k = stack.pop()
            if k in seen or k not in idx: continue
            seen.add(k); comp.add(k); stack.extend(nbr[k])
        if len(comp) > len(best): best = comp
    return best
keep = {BODY: largest(BODY)}
if want_hat: keep[HAT] = largest(HAT)
bm.free()

report = {"zones": zone_count, "faces": len(me.polygons), "labels": {k: labels.count(v) for k, v in (("discard", DISCARD), ("body", BODY), ("hat", HAT))}}
pieces = {}
for label, piece in ((BODY, "Outfit_" + name), (HAT, "Hat_" + name)):
    if label not in keep: continue
    obj = outfit.copy(); obj.data = outfit.data.copy(); obj.name = piece; obj.data.name = piece; bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep[label]], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]; bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # close small holes the generation left (a boot top, a seam); the piece's real openings are far larger
    filled = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=12)["faces"]
    border = [e for e in bm.edges if e.is_boundary]
    report[piece] = {"holesFilled": len(filled), "faces": len(bm.faces), "quads": sum(1 for f in bm.faces if len(f.verts) == 4), "openEdges": len(border)}
    bm.to_mesh(obj.data); bm.free(); pieces[piece] = obj
for o in list(bpy.data.objects):
    if o not in pieces.values(): bpy.data.objects.remove(o)
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
json.dump(report, open(report_path, "w"), indent=1); print(json.dumps(report))
