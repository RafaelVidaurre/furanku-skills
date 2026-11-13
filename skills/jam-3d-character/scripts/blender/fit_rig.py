"""Rig the base character parts to Epic's Manny skeleton (same bone names and hierarchy) and put them in Manny's bind pose.

1. Scale the parts to the character's height (character spec) with the feet on the ground.
2. Joint targets: body joints from Meshy's auto-rig of the same mesh; finger joints found on the hand geometry.
3. Two copies of Manny's armature:
     fit  - Manny's bones moved and turned onto the character as modelled (straight A-pose arms);
     root - Manny's own rest orientations with this character's bone lengths (the delivered skeleton).
4. Automatic weights from a guide armature with ordinary head-to-tail bones, limited to the spec's maxInfluences.
5. Pose `fit` into `root`'s rest pose, bake that shape into the meshes and bind them to `root`.

Anatomy comes from the joints, never from colours (anatomy.py): every body vertex gets a region (head, torso, upper
arm, hand, thigh, ...) from where it sits on the skeleton, keeps only the bones of that region and its neighbours, and the
hands and fingers are found as geometry beyond each wrist. With `hands.fingers` 0 (mittens) each hand follows `hand_*`
alone. A deformation check ends the run with an error when a limb is not mainly weighted to its own bones.

blender --background --python-exit-code 1 --python fit_rig.py -- <textured.blend> <SKM_Manny_Simple.fbx> <meshy-joints.json> <out-dir> --character <character.json>
"""
import bpy, bmesh, sys, os, json, heapq
import numpy as np
from mathutils import Vector, Matrix, Quaternion

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import charspec
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anatomy
(blend, manny_fbx, joints_json, out), spec = charspec.require()
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
HEAD, HAIR, BODY = spec.part("head"), spec.part("hair"), spec.part("body")
PARTS = spec.present_parts(("head", "hair", "body"))
parts = {n: bpy.data.objects[n] for n in PARTS}
TARGET_HEIGHT = spec.height
FINGERS = spec.fingers == 5
# The rig works in metres at the character's real height; lengths below are real sizes, as tuned on the first body.
report = {"blender": bpy.app.version_string, "targetHeight": TARGET_HEIGHT}

# ---- 1. scale to the character's height, feet at z = 0 ------------------------------------------------------------
allco = [v.co for o in parts.values() for v in o.data.vertices]
zmin = min(c.z for c in allco); zmax = max(c.z for c in allco); S = TARGET_HEIGHT / (zmax - zmin)
for o in parts.values():
    for v in o.data.vertices: v.co = Vector((v.co.x * S, v.co.y * S, (v.co.z - zmin) * S))
    o.data.update()
report["scale"] = S

# ---- 2. joint targets ------------------------------------------------------------------------------
mj = {k: Vector(v["head"]) for k, v in json.load(open(joints_json))["bones"].items()}
def sym(l, r):
    a, b = mj[l], mj[r]; x = (abs(a.x) + abs(b.x)) / 2; y = (a.y + b.y) / 2; z = (a.z + b.z) / 2
    return Vector((x, y, z)), Vector((-x, y, z))
J = {}
for mb, (l, r) in {"thigh": ("LeftUpLeg", "RightUpLeg"), "calf": ("LeftLeg", "RightLeg"), "foot": ("LeftFoot", "RightFoot"), "ball": ("LeftToeBase", "RightToeBase"),
                   "clavicle": ("LeftShoulder", "RightShoulder"), "upperarm": ("LeftArm", "RightArm"), "lowerarm": ("LeftForeArm", "RightForeArm"), "hand": ("LeftHand", "RightHand")}.items():
    J[mb + "_l"], J[mb + "_r"] = sym(l, r)
# ball of the foot: under the widest part of the foot, about 70% of the way from heel to toe, near the ground
foot = [v.co for v in parts[BODY].data.vertices if v.co.z < J["foot_l"].z * 0.9 and v.co.x > 0]
ymin = min(c.y for c in foot); ymax = max(c.y for c in foot); zlow = min(c.z for c in foot)
ball = Vector((J["foot_l"].x, ymin + 0.3 * (ymax - ymin), zlow + 0.02)); J["ball_l"] = ball; J["ball_r"] = Vector((-ball.x, ball.y, ball.z))
report["foot"] = {"toeY": round(ymin, 4), "heelY": round(ymax, 4), "ball": [round(x, 4) for x in ball]}
J["pelvis"] = Vector((0, J["thigh_l"].y, J["thigh_l"].z + 0.024))
J["neck_01"] = Vector((0, mj["neck"].y, mj["neck"].z)); J["head"] = Vector((0, mj["Head"].y, mj["Head"].z))   # Meshy names its head joint "Head"


# anatomy of the body as modelled: a region per vertex, from the joints
AJ = anatomy.joints_from_meshy(json.load(open(joints_json))["bones"])
_bme = parts[BODY].data
REGION, _ainfo = anatomy.label(np.array([v.co[:] for v in _bme.vertices]), [tuple(e.vertices) for e in _bme.edges], AJ, TARGET_HEIGHT)
report["anatomy"] = _ainfo
json.dump(REGION, open(os.path.join(out, "vertex-regions.json"), "w"))
_missing = [r for r in anatomy.REGIONS if r not in _ainfo["counts"] and r != "neck" and not (HEAD and r == "head")]
if _missing:
    raise RuntimeError("the joints do not fit this mesh: no vertices found for %s. Check that the joints file belongs to this mesh's own generation and is scaled to heightMeters (%.3f m)" % (", ".join(_missing), TARGET_HEIGHT))


def find_fingers(sign):
    """Finger joints on one hand of the body mesh.

    Sweeping down the hand from the fingertips, each finger starts as its own island of vertices and lives until it
    merges with an older island at the web. That gives each finger's exact vertex set. A straight line fitted through
    the set gives its axis, and the joints sit on that line at ordinary phalanx proportions. The thumb is the lobe
    left over on the thumb side of the index finger.
    """
    me = parts[BODY].data
    W = J["hand_l" if sign > 0 else "hand_r"]; E = J["lowerarm_l" if sign > 0 else "lowerarm_r"]; a = (W - E).normalized()
    sfx_ = "_l" if sign > 0 else "_r"
    idx = [v.index for v in me.vertices if REGION[v.index] == "hand" + sfx_]
    if len(idx) < 50:
        raise RuntimeError(f"hands.fingers is 5 but no hand geometry was found beyond the {'left' if sign > 0 else 'right'} wrist ({len(idx)} vertices); check the joints file, or set hands.fingers 0")
    sel = set(idx); co = {i: me.vertices[i].co.copy() for i in idx}
    adj = {i: [] for i in idx}
    for e in me.edges:
        i, j = e.vertices
        if i in sel and j in sel: adj[i].append(j); adj[j].append(i)
    P = np.array([co[i][:] for i in idx]); n_h = Vector(np.linalg.svd(P - P.mean(axis=0), full_matrices=False)[2][2]); c = a.cross(n_h).normalized()
    al = {i: (co[i] - W).dot(a) for i in idx}; ac = {i: (co[i] - W).dot(c) for i in idx}; amax = max(al.values())
    lowv = [ac[i] for i in idx if al[i] < 0.55 * amax]; mid = float(np.median([ac[i] for i in idx if al[i] > 0.75 * amax]))
    tside = 1.0 if (max(lowv) - mid) > (mid - min(lowv)) else -1.0
    u = {i: tside * ac[i] for i in idx}
    order = sorted(idx, key=lambda i: -al[i]); root_of = {}; birth = {}; excl = {}; ended = {}; lobes = []
    def find(x):
        while root_of[x] != x: root_of[x] = root_of[root_of[x]]; x = root_of[x]
        return x
    def close(r_, level):
        # a lobe's own part ends the first time it meets another lobe: record it once
        if r_ not in ended:
            ended[r_] = level; lobes.append({"persistence": birth[r_][0] - level, "tip": birth[r_][1], "web": level, "verts": list(excl[r_])})
    for v_ in order:
        roots = {find(n_) for n_ in adj[v_] if n_ in root_of}
        root_of[v_] = v_
        if not roots: birth[v_] = (al[v_], v_); excl[v_] = [v_]; continue
        oldest = max(roots, key=lambda r_: birth[r_][0])
        real = False
        for r_ in roots:
            if r_ == oldest: continue
            if birth[r_][0] - al[v_] < 0.008 and r_ not in ended:
                # a bump on the same fingertip, not another digit: fold it into the older lobe
                if oldest not in ended: excl[oldest] += excl[r_]
            else:
                close(r_, al[v_]); real = True
            root_of[r_] = oldest
        if real: close(oldest, al[v_])
        elif oldest not in ended: excl[oldest].append(v_)
        root_of[v_] = oldest
    lobes.sort(key=lambda L_: -L_["persistence"])
    real_ = [L_ for L_ in lobes if L_["persistence"] >= 0.01 * TARGET_HEIGHT]
    if len(real_) < 4:
        raise RuntimeError(f"hands.fingers is 5 but the {'left' if sign > 0 else 'right'} hand shows {len(real_)} separate fingers "
                           f"(free lengths {[round(L_['persistence'], 3) for L_ in lobes[:5]]} m; a finger needs {0.01 * TARGET_HEIGHT:.3f} m). "
                           "Repair fused fingers (spread_fingers.py), or set hands.fingers 0 for mittens")
    four = lobes[:4]
    four.sort(key=lambda L_: u[L_["tip"]])                 # ascending toward the thumb: pinky, ring, middle, index
    res = {"peaks": len(four), "fingers": {}, "persistence": [round(L_["persistence"], 4) for L_ in lobes[:6]]}

    def line_fit(vs, toward):
        Q = np.array([co[i][:] for i in vs]); cen = Q.mean(axis=0); ax = Vector(np.linalg.svd(Q - cen, full_matrices=False)[2][0])
        if (toward - Vector(cen)).dot(ax) < 0: ax = -ax
        t = (Q - cen) @ np.array(ax[:]); return Vector(cen), ax, float(t.min()), float(t.max())

    for name, L_ in zip(["pinky", "ring", "middle", "index"], four):
        cen, ax, t0, t1 = line_fit(L_["verts"], co[L_["tip"]]); Lf = t1 - t0; Lt = 1.25 * Lf; P_ = lambda t: cen + ax * t
        mcp = P_(t1 - Lt)
        res["fingers"][name] = {"meta": W + (mcp - W) * 0.35, "j1": mcp, "j2": P_(t1 - 0.55 * Lt), "j3": P_(t1 - 0.27 * Lt), "tip": P_(t1), "freeLength": Lf,
                                "width": 2 * float(np.median([((co[i] - cen) - ax * (co[i] - cen).dot(ax)).length for i in L_["verts"]])), "verts": set(L_["verts"])}
    iv = four[-1]["verts"]; iweb = four[-1]["web"]
    index_edge = max(u[i] for i in iv if al[i] < iweb + 0.008)        # thumb-side edge of the index finger at its root
    taken = set().union(*[set(L_["verts"]) for L_ in four])
    cand = [i for i in idx if i not in taken and u[i] > index_edge + 0.002]
    res["thumbDebug"] = {"indexEdgeU": round(index_edge, 4), "indexWebAl": round(iweb, 4), "maxU": round(max(u.values()), 4), "candidates": len(cand), "fifthLobe": round(lobes[4]["persistence"], 4) if len(lobes) > 4 else None}
    if not cand and len(lobes) > 4:
        t5 = lobes[4]["tip"]; cand = [i for i in idx if i not in taken and (co[i] - co[t5]).length < 0.05]
    if not cand:
        raise RuntimeError(f"hands.fingers is 5 but no thumb was found on the {'left' if sign > 0 else 'right'} hand; set hands.fingers 0, or repair the hand")
    ttip = max(cand, key=lambda i: u[i]); region = {ttip}; st = [ttip]; cs = set(cand)
    while st:
        x = st.pop()
        for n_ in adj[x]:
            if n_ in cs and n_ not in region: region.add(n_); st.append(n_)
    cen, ax, t0, t1 = line_fit(list(region), co[ttip]); Lth = t1 - t0; P_ = lambda t: cen + ax * t
    mcp = P_(t1 - 0.72 * Lth); proj_t = {i: (co[i] - cen).dot(ax) for i in region}
    free = {i for i in region if proj_t[i] > t1 - 0.72 * Lth - 0.004}
    res["fingers"]["thumb"] = {"j1": W + (mcp - W) * 0.35, "j2": mcp, "j3": P_(t1 - 0.33 * Lth), "tip": P_(t1), "freeLength": Lth,
                               "width": 2 * float(np.median([((co[i] - cen) - ax * (co[i] - cen).dot(ax)).length for i in region])), "verts": free}
    return res


TIPS = {}
DIGITS = {}   # (finger, suffix) -> vertex indices of its free part and the joint chain used to weight them
finger_report = {}
for sign, sfx in (((1, "_l"), (-1, "_r")) if FINGERS else ()):
    f = find_fingers(sign); finger_report[sfx] = {"peaksFound": f["peaks"], "lobePersistence": f["persistence"], "thumbDebug": f.get("thumbDebug"), "freeLengths": {k: round(v["freeLength"], 4) for k, v in f["fingers"].items()}, "widths": {k: round(v["width"], 4) for k, v in f["fingers"].items()}}
    for name, q in f["fingers"].items():
        if name != "thumb": J[f"{name}_metacarpal{sfx}"] = q["meta"]
        for k in (1, 2, 3): J[f"{name}_0{k}{sfx}"] = q[f"j{k}"]
        TIPS[f"{name}_03{sfx}"] = q["tip"]
        DIGITS[(name, sfx)] = (q["verts"], [q["j1"], q["j2"], q["j3"], q["tip"]], q["freeLength"], q["width"])
report["fingers"] = finger_report

# ---- 3. Manny armature: `root` (rest) and `fit` -----------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=manny_fbx, automatic_bone_orientation=False, ignore_leaf_bones=False)
new = [o for o in bpy.data.objects if o not in before]
arm = next(o for o in new if o.type == "ARMATURE")
for o in new:
    if o.type == "MESH": bpy.data.objects.remove(o)
# the importer leaves the skeleton in centimetres under a scaled transform: bake that into the bones so armature space is metres
mw = arm.matrix_world.copy(); arm.parent = None; arm.matrix_world = mw
for o in [x for x in bpy.data.objects if x not in before and x is not arm]: bpy.data.objects.remove(o)
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
arm.name = "root"; arm.data.name = "root"
report["mannyImport"] = {"worldScaleBeforeApply": [round(x, 5) for x in mw.to_scale()], "pelvisLengthMetres": round(arm.data.bones["pelvis"].length, 4)}
MB = {b.name: b.matrix_local.copy() for b in arm.data.bones}                       # Manny rest matrices (armature space)
PARENT = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
ORDER = [b.name for b in arm.data.bones]                                           # parents before children
MP = {n: m.translation.copy() for n, m in MB.items()}
# spine and neck targets along the pelvis-to-neck line, at Manny's own proportions
chain = ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01"]
seg = [(MP[chain[i + 1]] - MP[chain[i]]).length for i in range(len(chain) - 1)]; total = sum(seg); acc = 0
for i in range(1, len(chain) - 1):
    acc += seg[i - 1]; J[chain[i]] = J["pelvis"].lerp(J["neck_01"], acc / total)
fr = (MP["neck_02"] - MP["neck_01"]).length / ((MP["neck_02"] - MP["neck_01"]).length + (MP["head"] - MP["neck_02"]).length)
J["neck_02"] = J["neck_01"].lerp(J["head"], fr)
# the main child each bone points at
AIM = {"spine_01": "spine_02", "spine_02": "spine_03", "spine_03": "spine_04", "spine_04": "spine_05", "spine_05": "neck_01", "neck_01": "neck_02", "neck_02": "head"}
for s in ("_l", "_r"):
    AIM.update({"clavicle" + s: "upperarm" + s, "upperarm" + s: "lowerarm" + s, "lowerarm" + s: "hand" + s, "hand" + s: "middle_01" + s,
                "thigh" + s: "calf" + s, "calf" + s: "foot" + s, "foot" + s: "ball" + s, "thumb_01" + s: "thumb_02" + s, "thumb_02" + s: "thumb_03" + s})
    for f in ("index", "middle", "ring", "pinky"):
        AIM.update({f"{f}_metacarpal{s}": f"{f}_01{s}", f"{f}_01{s}": f"{f}_02{s}", f"{f}_02{s}": f"{f}_03{s}"})

# In the engine Manny's skeleton places each bone along the animation's own bone direction, scaled to this mesh's bone
# length. So the delivered rest pose must have every joint on Manny's bone directions, with this character's lengths.
# Trunk and legs stand straight on both, so their joints are laid out that way directly and the mesh there is left as
# modelled. Arms and hands differ (Manny's elbows are bent, fingers curled), so they are fitted to the mesh as modelled
# and re-posed into Manny's directions afterwards.
UPRIGHT = {"pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01", "neck_02", "head"} | {b + s_ for b in ("thigh", "calf", "foot", "ball") for s_ in ("_l", "_r")}
def seg(n, p):   # this character's length for the segment p -> n
    return (J[n] - J[p]).length if (n in J and p in J) else None
chain0 = {}
for n in ORDER:
    p = PARENT[n]
    if n not in UPRIGHT: continue
    chain0[n] = Vector((0, 0, 0)) if p is None else chain0[p] + (MP[n] - MP[p]).normalized() * seg(n, p)
# Front-to-back, the chain is centred on the body itself: both this character and Manny are straight columns, and Manny's
# trunk and leg joints sit on average at the middle of his body's depth. (The auto-rig's knee and ankle estimates sit
# about 3.5 cm forward of the leg's middle, so they are not used for this.)
allv = [v.co for o in parts.values() for v in o.data.vertices]
bands = []
for frac in (0.07, 0.28, 0.5, 0.56, 0.65, 0.74, 0.80, 0.86, 0.93):
    b_ = [c.y for c in allv if abs(c.z / TARGET_HEIGHT - frac) < 0.012 and abs(c.x) < 0.2 * TARGET_HEIGHT]
    if b_: bands.append(sum(b_) / len(b_))
body_y = sum(bands) / len(bands)
core = ["pelvis", "spine_03", "neck_01", "head", "thigh_l", "calf_l", "foot_l"]
anchor = Vector((0.0, body_y - sum(chain0[n].y for n in core) / len(core), sum(J[n].z - chain0[n].z for n in ("foot_l", "foot_r")) / 2))
report["bodyCentreDepthM"] = round(body_y, 4)
report["uprightJointOffsetFromEstimateCm"] = {n: round((chain0[n] + anchor - J[n]).length * 100, 2) for n in chain0 if n in J}
REST, FIT, Q, FP = {}, {}, {}, {}      # final rest position; fitted matrix; accumulated world rotation of the fit; fitted position
for n in ORDER:
    p = PARENT[n]; qp = Q[p] if p else Quaternion()
    if n in UPRIGHT:
        REST[n] = chain0[n] + anchor; FP[n] = REST[n].copy(); q = Quaternion()
    elif p is None:
        REST[n] = MP[n].copy(); FP[n] = REST[n].copy(); q = Quaternion()
    else:
        k = 1.0
        if p in AIM and p in FP and AIM[p] in J: k = (J[AIM[p]] - FP[p]).length / max((MP[AIM[p]] - MP[p]).length, 1e-6)
        FP[n] = J[n].copy() if n in J else FP[p] + qp @ ((MP[n] - MP[p]) * k)
        REST[n] = REST[p] + ((MP[n] - MP[p]).normalized() * (FP[n] - FP[p]).length if n in J else (MP[n] - MP[p]) * k)
        q = qp.copy()
        if n in AIM and AIM[n] in J:
            q = (qp @ (MP[AIM[n]] - MP[n])).rotation_difference(J[AIM[n]] - FP[n]) @ qp
        elif n in TIPS:
            q = (qp @ (MP[n] - MP[p])).rotation_difference(TIPS[n] - FP[n]) @ qp
        if n.startswith("hand_") and FINGERS:
            s_ = n[-2:]; axis = (J["middle_01" + s_] - FP[n]).normalized()
            cur = q @ (MP["pinky_01" + s_] - MP["index_01" + s_]); want = J["pinky_01" + s_] - J["index_01" + s_]
            cur -= axis * cur.dot(axis); want -= axis * want.dot(axis)
            if cur.length > 1e-6 and want.length > 1e-6: q = cur.rotation_difference(want) @ q
    Q[n] = q
    M = (q.to_matrix() @ MB[n].to_3x3()).to_4x4(); M.translation = FP[n]; FIT[n] = M
# ik bones sit on the joints they mirror
for ik, src in {"ik_foot_l": "foot_l", "ik_foot_r": "foot_r", "ik_hand_gun": "hand_r", "ik_hand_r": "hand_r", "ik_hand_l": "hand_l"}.items():
    if ik in REST: REST[ik] = REST[src].copy()

def set_edit(armature, setter):
    bpy.ops.object.select_all(action="DESELECT"); armature.select_set(True); bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in armature.data.edit_bones: setter(eb)
    bpy.ops.object.mode_set(mode="OBJECT")

fit = arm.copy(); fit.data = arm.data.copy(); fit.name = "fit"; bpy.context.scene.collection.objects.link(fit)
def rest_setter(eb):
    M = MB[eb.name].copy(); M.translation = REST[eb.name]; eb.matrix = M
def fit_setter(eb): eb.matrix = FIT[eb.name]
set_edit(arm, rest_setter); set_edit(fit, fit_setter)

# ---- 4. weights from a guide armature --------------------------------------------------------------
head_top = Vector((0, J["head"].y, TARGET_HEIGHT - 0.02))
if not FINGERS:   # mittens: the hand bone's guide runs to the hand's far end instead of to the fingers
    for s_ in ("_l", "_r"):
        hv_ = [v.co for v in parts[BODY].data.vertices if (1 if s_ == "_l" else -1) * v.co.x > 0]
        a_ = (J["hand" + s_] - J["lowerarm" + s_]).normalized(); TIPS["hand" + s_] = J["hand" + s_] + a_ * max((c - J["hand" + s_]).dot(a_) for c in hv_)
tails = {n: FIT[AIM[n]].translation for n in AIM if n in FIT and AIM[n] in FIT}
tails.update({n: t for n, t in TIPS.items()}); tails["head"] = head_top; tails["pelvis"] = FIT["spine_01"].translation
if not FINGERS:
    for s_ in ("_l", "_r"): tails["hand" + s_] = TIPS["hand" + s_]
    tails = {n: t for n, t in tails.items() if not any(n.startswith(f) for f in ("index", "middle", "ring", "pinky", "thumb"))}
for s in ("_l", "_r"): tails["ball" + s] = FIT["ball" + s].translation + Vector((0, -0.07, 0))
gd = bpy.data.armatures.new("guide"); guide = bpy.data.objects.new("guide", gd); bpy.context.scene.collection.objects.link(guide)
bpy.ops.object.select_all(action="DESELECT"); guide.select_set(True); bpy.context.view_layer.objects.active = guide
bpy.ops.object.mode_set(mode="EDIT")
for n in ORDER:
    if n not in tails: continue
    eb = gd.edit_bones.new(n); eb.head = FIT[n].translation; eb.tail = tails[n]
    if (eb.tail - eb.head).length < 1e-4: eb.tail = eb.head + Vector((0, 0, 0.01))
for n in ORDER:
    if n in gd.edit_bones:
        p = PARENT[n]
        while p and p not in gd.edit_bones: p = PARENT[p]
        if p: gd.edit_bones[n].parent = gd.edit_bones[p]
bpy.ops.object.mode_set(mode="OBJECT")
weights = {}
for name in [n for n in (BODY, HEAD) if n]:
    ob = parts[name]; ob.vertex_groups.clear()
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); guide.select_set(True); bpy.context.view_layer.objects.active = guide
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for m in list(ob.modifiers):
        if m.type == "ARMATURE": ob.modifiers.remove(m)
    ob.parent = None
    if name == HEAD:
        bodyob = parts[BODY]; seam = {}
        ob_border = {v for e in ob.data.edges for v in e.vertices} if False else None
        import bmesh as _bm
        hb_ = _bm.new(); hb_.from_mesh(ob.data); border = {v.index for e in hb_.edges if e.is_boundary for v in e.verts}; hb_.free()
        okd = {tuple(round(c, 5) for c in v.co): v for v in bodyob.data.vertices}
        for vi in border:
            m_ = okd.get(tuple(round(c, 5) for c in ob.data.vertices[vi].co))
            if m_ is not None: seam[vi] = [(bodyob.vertex_groups[g.group].name, g.weight) for g in m_.groups]
        keep = {"head", "neck_01", "neck_02", "spine_05"} | {n_ for ws in seam.values() for n_, w_ in ws}
        for vg in list(ob.vertex_groups):
            if vg.name not in keep: ob.vertex_groups.remove(vg)
        g = ob.vertex_groups.get("head") or ob.vertex_groups.new(name="head")
        for v in ob.data.vertices:
            if v.index in seam: continue
            for gi in [gg.group for gg in v.groups]:
                if ob.vertex_groups[gi].name not in ("head", "neck_01", "neck_02", "spine_05"): ob.vertex_groups[gi].remove([v.index])
            if len(v.groups) == 0: g.add([v.index], 1.0, "REPLACE")
        for vi, ws in seam.items():
            for gi in [gg.group for gg in ob.data.vertices[vi].groups]: ob.vertex_groups[gi].remove([vi])
            for n_, w_ in ws: (ob.vertex_groups.get(n_) or ob.vertex_groups.new(name=n_)).add([vi], w_, "REPLACE")
        report["neckSeamVerticesMatched"] = len(seam)
        rigid = [v.index for v in ob.data.vertices if v.co.z > J["head"].z + 0.035]
        for vg in ob.vertex_groups:
            if vg.name != "head": vg.remove(rigid)
        g.add(rigid, 1.0, "REPLACE")
    if name == BODY:
        # every vertex keeps to the bones of its anatomical region and that region's neighbours (hands hang beside the
        # thighs in the modelled pose, so bone heat alone leaks between them)
        fingers = [f"{f}_{k}" for f in ("index", "middle", "ring", "pinky") for k in ("metacarpal", "01", "02", "03")] + [f"thumb_0{k}" for k in (1, 2, 3)]
        ALLOWED = {"head": {"head", "neck_01", "neck_02"},
                   "neck": {"neck_01", "neck_02", "head", "spine_05", "clavicle_l", "clavicle_r"},
                   "torso": {"pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05", "neck_01", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r"},
                   "pelvis": {"pelvis", "spine_01", "spine_02", "thigh_l", "thigh_r"}}
        for s_ in ("_l", "_r"):
            ALLOWED.update({"upperarm" + s_: {"spine_03", "spine_04", "spine_05", "clavicle" + s_, "upperarm" + s_, "lowerarm" + s_},
                            "lowerarm" + s_: {"upperarm" + s_, "lowerarm" + s_, "hand" + s_},
                            "hand" + s_: {"lowerarm" + s_, "hand" + s_} | ({f + s_ for f in fingers} if FINGERS else set()),
                            "thigh" + s_: {"pelvis", "spine_01", "thigh" + s_, "calf" + s_},
                            "calf" + s_: {"thigh" + s_, "calf" + s_, "foot" + s_},
                            "foot" + s_: {"calf" + s_, "foot" + s_, "ball" + s_}})
        gname = {g.index: g.name for g in ob.vertex_groups}; removed = 0
        # a vertex may also take the bones of regions within two edges of it, so weights blend across region borders
        near = anatomy.neighbourhood([tuple(e.vertices) for e in ob.data.edges], len(ob.data.vertices), 2)
        for v in ob.data.vertices:
            ok = set().union(*(ALLOWED[REGION[x]] for x in near[v.index]))
            bad = [g.group for g in v.groups if gname[g.group] not in ok]
            for gi in bad: ob.vertex_groups[gi].remove([v.index]); removed += 1
            if len(v.groups) == 0:
                best = min((b for b in ok if b in tails), key=lambda b: ((FIT[b].translation + tails[b]) / 2 - v.co).length)
                (ob.vertex_groups.get(best) or ob.vertex_groups.new(name=best)).add([v.index], 1.0, "REPLACE")
        report["weightsRemovedByAnatomy"] = removed
        # fingers: each digit's own vertices follow only that digit's bones, blended by position along its joints
        sstep = lambda t: 0.0 if t <= 0 else 1.0 if t >= 1 else t * t * (3 - 2 * t)
        owned_all = set(); bw = 0.007
        for (fname, sfx), (verts, chain, Lf, width) in list(DIGITS.items()):
            L1 = (chain[1] - chain[0]).length; L2 = (chain[2] - chain[1]).length; L3 = (chain[3] - chain[2]).length
            bones = [f"{fname}_0{k}{sfx}" for k in (1, 2, 3)]
            for vi in verts:
                p = ob.data.vertices[vi].co; best = None
                for k in range(3):
                    a_, b_ = chain[k], chain[k + 1]; d_ = b_ - a_; t = max(0.0, min(1.0, (p - a_).dot(d_) / d_.length_squared)); dist = (p - (a_ + d_ * t)).length
                    if best is None or dist < best[0]: best = (dist, [0, L1, L1 + L2][k] + t * d_.length)
                arc = best[1]; s12 = sstep((arc - (L1 - bw)) / (2 * bw)); s23 = sstep((arc - (L1 + L2 - bw)) / (2 * bw))
                w = [1 - s12, s12 - s23, s23]
                for gi in [g.group for g in ob.data.vertices[vi].groups]: ob.vertex_groups[gi].remove([vi])
                for bname, wt in zip(bones, w):
                    if wt > 1e-4: (ob.vertex_groups.get(bname) or ob.vertex_groups.new(name=bname)).add([vi], wt, "REPLACE")
            owned_all |= set(verts)
        distal = {f"{f}_0{k}{sfx}" for f in ("index", "middle", "ring", "pinky", "thumb") for k in (2, 3) for sfx in ("_l", "_r")}
        if not FINGERS: distal |= {f"{f}{sfx}" for f in fingers for sfx in ("_l", "_r")}
        for v in ob.data.vertices:   # palm and arm vertices never follow the outer finger joints
            if v.index in owned_all: continue
            for gi in [g.group for g in v.groups]:   # collect first: removing while iterating shifts the collection
                if ob.vertex_groups[gi].name in distal: ob.vertex_groups[gi].remove([v.index])
            if len(v.groups) == 0:
                sfx = "_l" if v.co.x > 0 else "_r"; ob.vertex_groups["hand" + sfx].add([v.index], 1.0, "REPLACE")
        report["digitVertexCounts"] = {f"{f}{sfx}": len(d_[0]) for (f, sfx), d_ in DIGITS.items()}
        if not HEAD:   # one mesh: the skull above the head joint is rigid on `head`, as a separate head part would be
            rigid = [v.index for v in ob.data.vertices if v.co.z > J["head"].z + 0.035 and abs(v.co.x) < abs(J["upperarm_l"].x)]
            for vg in ob.vertex_groups:
                if vg.name != "head": vg.remove(rigid)
            (ob.vertex_groups.get("head") or ob.vertex_groups.new(name="head")).add(rigid, 1.0, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=spec.max_influences)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    unw = [v.index for v in ob.data.vertices if not v.groups or sum(g.weight for g in v.groups) < 1e-4]
    for vi in unw:  # bone heat left this vertex out: give it to the nearest guide bone
        p = ob.data.vertices[vi].co; best = min(tails, key=lambda n: ((FIT[n].translation + tails[n]) / 2 - p).length)
        (ob.vertex_groups.get(best) or ob.vertex_groups.new(name=best)).add([vi], 1.0, "REPLACE")
    weights[name] = {"groups": len(ob.vertex_groups), "unweightedAfterBoneHeat": len(unw), "maxInfluences": max(len(v.groups) for v in ob.data.vertices)}
# ---- deformation check: each limb and the head mainly follow their own bones -----------------------------------
def own_bones(r):
    base = r[:-2] if r[-2:] in ("_l", "_r") else r; s_ = r[-2:] if base != r else ""
    own = {"upperarm": {"upperarm"}, "lowerarm": {"lowerarm"}, "hand": {"hand"}, "thigh": {"thigh"}, "calf": {"calf"}, "foot": {"foot", "ball"}, "head": {"head"}}.get(base)
    if own is None: return None
    own = {b + s_ for b in own}
    if base == "hand" and FINGERS: own |= {f"{f}_{k}{s_}" for f in ("index", "middle", "ring", "pinky") for k in ("metacarpal", "01", "02", "03")} | {f"thumb_0{k}{s_}" for k in (1, 2, 3)}
    return own
bob = parts[BODY]; gn = {g.index: g.name for g in bob.vertex_groups}; check = {}; failures = []
for r in sorted(set(REGION)):
    own = own_bones(r)
    if own is None: continue
    vs = [v for v in bob.data.vertices if REGION[v.index] == r]
    if r == "head" and HEAD: continue
    share = [sum(g.weight for g in v.groups if gn[g.group] in own) / max(1e-9, sum(g.weight for g in v.groups)) for v in vs]
    mean = float(np.mean(share)) if share else 0.0; low = float(np.mean([x < 0.25 for x in share])) if share else 1.0
    check[r] = {"vertices": len(vs), "meanOwnWeight": round(mean, 3), "shareMostlyElsewhere": round(low, 3)}
    if mean < 0.5 or low > 0.25: failures.append(f"{r}: mean weight on its own bones {mean:.2f} (needs 0.5), {low:.0%} of its vertices mostly on other bones (allowed 25%)")
report["deformationCheck"] = check
if failures:
    json.dump(report, open(os.path.join(out, "rig-report.json"), "w"), indent=1)
    raise RuntimeError("deformation check failed; the rig would not move these regions with their bones:\n  " + "\n  ".join(failures) + "\nrig-report.json has the anatomy and weights")

if HAIR:
    hair = parts[HAIR]; hair.vertex_groups.clear(); hair.vertex_groups.new(name="head").add([v.index for v in hair.data.vertices], 1.0, "REPLACE")
    weights[HAIR] = {"groups": 1, "unweightedAfterBoneHeat": 0, "maxInfluences": 1}
report["weights"] = weights
bpy.data.objects.remove(guide)

# ---- 5. pose `fit` into Manny's rest, bake, bind to `root` ------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "character-rig-fit-pose.blend"))   # as modelled, bound to `fit`
for ob in parts.values():
    m = ob.modifiers.new("Armature", "ARMATURE"); m.object = fit
bpy.context.view_layer.update()
for n in ORDER:
    fit.pose.bones[n].matrix = arm.data.bones[n].matrix_local.copy(); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for ob in parts.values():
    ev = ob.evaluated_get(dg); cos = [v.co.copy() for v in ev.data.vertices]
    for m in list(ob.modifiers): ob.modifiers.remove(m)
    for v, c in zip(ob.data.vertices, cos): v.co = c
    ob.data.update()
    m = ob.modifiers.new("Armature", "ARMATURE"); m.object = arm; ob.parent = arm
bpy.data.objects.remove(fit)
allco = [v.co for o in parts.values() for v in o.data.vertices]
report["bindPoseBounds"] = [[round(min(c[i] for c in allco), 4) for i in range(3)], [round(max(c[i] for c in allco), 4) for i in range(3)]]
report["bones"] = len(arm.data.bones)
report["jointTargets"] = {k: [round(x, 4) for x in v] for k, v in J.items()}
report["restJoints"] = {k: [round(x, 4) for x in v] for k, v in REST.items()}
json.dump(report, open(os.path.join(out, "rig-report.json"), "w"), indent=1)
print(json.dumps({k: v for k, v in report.items() if k not in ("jointTargets", "restJoints")}))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "character-rigged.blend"))
