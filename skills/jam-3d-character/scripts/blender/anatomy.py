"""Anatomy from the joints: which body region every vertex belongs to, found from where it sits relative to the
skeleton, never from its colour. Colour classes describe materials; this module describes the body.

Regions: head, neck, torso, pelvis, and per side (suffix _l for the character's left, +x; _r for its right)
upperarm, lowerarm, hand, thigh, calf, foot.

Every region is a set of bone segments between joints of Meshy's auto-rig (its 24 named joints). A vertex is measured
against each segment, the distance divided by that region's thickness (the median distance of the vertices nearest to it,
so a vertex at the side of the chest belongs to the wide torso rather than the thin arm hanging beside it), and a few
hard limits apply: a hand lies beyond its wrist, a head above the neck joint, a limb on its own side of the body.
Last, continuity: a small patch cut off from the rest of its region (a fingertip read as thigh where the hand hangs
beside the leg) takes the region around it.

Plain Python with numpy and mathutils (Blender's Python); no bpy, so it runs on mesh data handed to it.
"""
import numpy as np
from mathutils import Vector

SIDES = (("_l", "Left", 1.0), ("_r", "Right", -1.0))
REGIONS = ["head", "neck", "torso", "pelvis"] + [f"{r}{s}" for s, _, _ in SIDES for r in ("upperarm", "lowerarm", "hand", "thigh", "calf", "foot")]
LIMBS = ("upperarm", "lowerarm", "hand", "thigh", "calf", "foot")


def joints_from_meshy(bones, scale=1.0, offset=(0.0, 0.0, 0.0)):
    """Joint positions by canonical name from Meshy's joints JSON `bones` (name -> {"head": [x, y, z]}), mapped into
    the mesh's space as p * scale + offset."""
    o = Vector(offset)
    g = lambda n: Vector(bones[n]["head"]) * scale + o
    J = {"pelvis": g("Hips"), "spine_lo": g("Spine02"), "spine_mid": g("Spine01"), "spine_hi": g("Spine"), "neck": g("neck"), "head": g("Head")}
    for s, side, _ in SIDES:
        J.update({"clavicle" + s: g(side + "Shoulder"), "upperarm" + s: g(side + "Arm"), "lowerarm" + s: g(side + "ForeArm"), "hand" + s: g(side + "Hand"),
                  "thigh" + s: g(side + "UpLeg"), "calf" + s: g(side + "Leg"), "foot" + s: g(side + "Foot"), "ball" + s: g(side + "ToeBase")})
    return J


def wrist_plane(J, s):
    """(point, normal) of the plane across the wrist: points beyond it (positive side) are the hand."""
    return J["hand" + s], (J["hand" + s] - J["lowerarm" + s]).normalized()


def ankle_plane(J, s):
    """(point, normal) of the plane across the ankle: points beyond it (positive side) are the foot."""
    return J["foot" + s], (J["foot" + s] - J["calf" + s]).normalized()


def segments(J, top_z):
    """Bone segments per region: [(region, a, b), ...]."""
    seg = [("head", J["head"], Vector((J["head"].x, J["head"].y, max(top_z, J["head"].z + 1e-3)))),
           ("neck", J["neck"], J["head"]),
           ("torso", J["spine_lo"], J["spine_mid"]), ("torso", J["spine_mid"], J["spine_hi"]), ("torso", J["spine_hi"], J["neck"]),
           ("pelvis", J["pelvis"], J["spine_lo"])]
    for s, _, _ in SIDES:
        fore = J["hand" + s] - J["lowerarm" + s]
        toe = J["ball" + s] - J["foot" + s]; toe.z = 0.0
        seg += [("torso", J["spine_hi"], J["upperarm" + s]),
                ("pelvis", J["pelvis"], J["thigh" + s]),
                ("upperarm" + s, J["upperarm" + s], J["lowerarm" + s]),
                ("lowerarm" + s, J["lowerarm" + s], J["hand" + s]),
                ("hand" + s, J["hand" + s], J["hand" + s] + fore * 0.7),
                ("thigh" + s, J["thigh" + s], J["calf" + s]),
                ("calf" + s, J["calf" + s], J["foot" + s]),
                ("foot" + s, J["foot" + s], J["ball" + s]),
                ("foot" + s, J["ball" + s], J["ball" + s] + (toe.normalized() * max(toe.length, 1e-3) * 0.8))]
    return seg


def _seg_dist(P, a, b):
    a = np.array(a[:]); d = np.array(b[:]) - a; L2 = max(float(d @ d), 1e-12)
    t = np.clip((P - a) @ d / L2, 0.0, 1.0)
    return np.linalg.norm(P - (a + t[:, None] * d), axis=1)


def label(coords, edges, J, height=None):
    """Region name per vertex.

    coords: N x 3 array of vertex positions in the joints' space; edges: iterable of (i, j) vertex index pairs.
    Returns (labels list[str], info dict)."""
    P = np.asarray(coords, dtype=np.float64)
    N = len(P)
    if N == 0:
        return [], {"counts": {}}
    H = float(height or (P[:, 2].max() - P[:, 2].min()))
    seg = segments(J, float(P[:, 2].max()))
    regions = REGIONS
    ri = {r: i for i, r in enumerate(regions)}
    D = np.full((N, len(regions)), np.inf)
    for r, a, b in seg:
        D[:, ri[r]] = np.minimum(D[:, ri[r]], _seg_dist(P, a, b))
    # thickness of each region: median distance of the vertices nearest to it (at least 1% of the height)
    raw = D.argmin(axis=1)
    rad = np.array([max(float(np.median(D[raw == k, k])) if (raw == k).any() else 0.05 * H, 0.01 * H) for k in range(len(regions))])
    S = D / rad[None, :]
    # hard limits
    mid_x = float(J["pelvis"].x)
    for s, _, sign in SIDES:
        other = (P[:, 0] - mid_x) * sign < -0.01 * H          # clearly on the other side of the body
        for r in LIMBS:
            S[other, ri[r + s]] = np.inf
        w, n = wrist_plane(J, s)
        S[(P - np.array(w[:])) @ np.array(n[:]) < 0.0, ri["hand" + s]] = np.inf
    S[P[:, 2] < J["neck"].z, ri["head"]] = np.inf
    # the trunk splits at the lowest spine joint: torso above it, pelvis below it and above the hip joints
    S[P[:, 2] < J["spine_lo"].z, ri["torso"]] = np.inf
    S[P[:, 2] > J["spine_lo"].z, ri["pelvis"]] = np.inf
    S[P[:, 2] < min(J["thigh_l"].z, J["thigh_r"].z), ri["pelvis"]] = np.inf
    lab = S.argmin(axis=1)
    # beyond the wrist the arm is hand (the thumb's root sits closer to the forearm's line than to the hand's);
    # beyond the ankle the leg is foot
    for s, _, _ in SIDES:
        w, n = wrist_plane(J, s); beyond = (P - np.array(w[:])) @ np.array(n[:]) > 0.0
        lab[beyond & np.isin(lab, [ri["lowerarm" + s], ri["upperarm" + s]])] = ri["hand" + s]
        a, n = ankle_plane(J, s); below = (P - np.array(a[:])) @ np.array(n[:]) > 0.0
        lab[below & (lab == ri["calf" + s])] = ri["foot" + s]

    # continuity: a patch cut off from the main body of its region takes the region around it
    adj = [[] for _ in range(N)]
    for i, j in edges:
        adj[i].append(j); adj[j].append(i)
    comp = np.full(N, -1); sizes = []
    for v in range(N):
        if comp[v] >= 0: continue
        c = len(sizes); comp[v] = c; st = [v]; n_ = 0
        while st:
            x = st.pop(); n_ += 1
            for y in adj[x]:
                if comp[y] < 0 and lab[y] == lab[x]: comp[y] = c; st.append(y)
        sizes.append(n_)
    sizes = np.array(sizes)
    comp_lab = np.zeros(len(sizes), dtype=int); comp_lab[comp] = lab
    biggest = {}
    for c, (sz, L) in enumerate(zip(sizes, comp_lab)):
        biggest[L] = max(biggest.get(L, 0), sz)
    stray = np.array([sizes[comp[v]] < max(30, 0.15 * biggest[lab[v]]) for v in range(N)])
    reassigned = 0
    for _ in range(64):
        changed = False
        for v in np.nonzero(stray)[0]:
            around = [lab[y] for y in adj[v] if not stray[y]]
            if around:
                lab[v] = max(set(around), key=around.count); stray[v] = False; reassigned += 1; changed = True
        if not changed: break
    names = [regions[k] for k in lab]
    counts = {}
    for r in names: counts[r] = counts.get(r, 0) + 1
    return names, {"counts": counts, "reassignedForContinuity": int(reassigned), "thicknessM": {r: round(float(rad[ri[r]]), 4) for r in regions}}


def neighbourhood(edges, n, rings=2):
    """Per vertex, the vertices within `rings` edges of it (itself included)."""
    adj = [set() for _ in range(n)]
    for i, j in edges:
        adj[i].add(j); adj[j].add(i)
    out = []
    for v in range(n):
        seen = {v}; front = {v}
        for _ in range(rings):
            front = {y for x in front for y in adj[x]} - seen; seen |= front
        out.append(seen)
    return out


def side_of(region):
    return region[-2:] if region[-2:] in ("_l", "_r") else None
