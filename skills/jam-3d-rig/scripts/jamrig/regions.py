"""Body regions from landmarks, and what they say about skin weights.

Every vertex gets a region from where it sits on the skeleton: head, neck, torso, pelvis, and per side upper-arm,
lower-arm, hand, upper-leg, lower-leg, foot (named like landmarks: `upper-arm.l`). With finger landmarks, the part of a
hand that belongs to one finger gets that finger's region (`index.l`). Regions decide which bones a vertex may follow
(its own region's and the neighbouring ones) and are what the deformation check measures.

Positions are in the working frame (Z up, front -Y, +X the character's left), for a character standing upright.
"""
import numpy as np

from . import landmarks as lm

SIDES = lm.SIDES
LIMBS = ("upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot")
BODY_REGIONS = ["head", "neck", "torso", "pelvis"] + ["%s.%s" % (r, s) for s in SIDES for r in LIMBS]
# Regions the deformation check holds to their own bones (the trunk blends across many bones by design).
CHECKED = ["head"] + ["%s.%s" % (r, s) for s in SIDES for r in LIMBS]
# Which body part's bones a landmark's bone belongs to.
_PART = {"hips": "pelvis", "spine": "torso", "chest": "torso", "shoulder": "torso", "neck": "neck", "head": "head",
         "upper-arm": "upper-arm", "lower-arm": "lower-arm", "hand": "hand", "upper-leg": "upper-leg",
         "lower-leg": "lower-leg", "foot": "foot", "toes": "foot"}


def _v(p):
    return np.asarray(p, dtype=np.float64)


def segments(points, top_z):
    """Bone segments per region: [(region, a, b)]."""
    P = {k: _v(p) for k, p in points.items()}
    head_top = P["head"].copy(); head_top[2] = max(top_z, P["head"][2] + 1e-3)
    seg = [("head", P["head"], head_top), ("neck", P["neck"], P["head"]),
           ("torso", P["spine"], P["chest"]), ("torso", P["chest"], P["neck"]), ("pelvis", P["hips"], P["spine"])]
    for s in SIDES:
        fore = P["hand." + s] - P["lower-arm." + s]
        toe = P["toes." + s] - P["foot." + s]; toe[2] = 0.0
        reach = max(float(np.linalg.norm(toe)), 1e-3)
        seg += [("torso", P["chest"], P["upper-arm." + s]),
                ("pelvis", P["hips"], P["upper-leg." + s]),
                ("upper-arm." + s, P["upper-arm." + s], P["lower-arm." + s]),
                ("lower-arm." + s, P["lower-arm." + s], P["hand." + s]),
                ("hand." + s, P["hand." + s], P["hand." + s] + fore * 0.7),
                ("upper-leg." + s, P["upper-leg." + s], P["lower-leg." + s]),
                ("lower-leg." + s, P["lower-leg." + s], P["foot." + s]),
                ("foot." + s, P["foot." + s], P["toes." + s]),
                ("foot." + s, P["toes." + s], P["toes." + s] + toe / reach * reach * 0.8)]
    return seg


def segment_distance(P, a, b):
    """Distance of each row of P to the segment a-b."""
    a = _v(a); d = _v(b) - a
    t = np.clip((P - a) @ d / max(float(d @ d), 1e-12), 0.0, 1.0)
    return np.linalg.norm(P - (a + t[:, None] * d), axis=1)


def label(coords, edges, points, height=None):
    """Region per vertex: (names list, info).

    coords: N x 3 positions; edges: (i, j) vertex index pairs; points: working-frame landmarks.
    A vertex is measured against every region's segments, the distance divided by that region's thickness (the median
    distance of the vertices nearest to it), so a vertex on the side of the chest belongs to the wide torso and not to the
    thin arm hanging beside it. Then hard limits: a hand lies beyond its wrist, a head above the neck joint, a limb on its
    own side of the body. Last, continuity: a small patch cut off from the rest of its region takes the region around it."""
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    N = len(P)
    if N == 0:
        return [], {"counts": {}}
    H = float(height or (P[:, 2].max() - P[:, 2].min()))
    J = {k: _v(p) for k, p in points.items()}
    regions = BODY_REGIONS
    ri = {r: i for i, r in enumerate(regions)}
    D = np.full((N, len(regions)), np.inf)
    for r, a, b in segments(points, float(P[:, 2].max())):
        D[:, ri[r]] = np.minimum(D[:, ri[r]], segment_distance(P, a, b))
    raw = D.argmin(axis=1)
    rad = np.array([max(float(np.median(D[raw == k, k])) if (raw == k).any() else 0.05 * H, 0.01 * H) for k in range(len(regions))])
    S = D / rad[None, :]
    mid_x = float(J["hips"][0])
    for s, sign in (("l", 1.0), ("r", -1.0)):
        other = (P[:, 0] - mid_x) * sign < -0.01 * H               # clearly on the other side of the body
        for r in LIMBS:
            S[other, ri[r + "." + s]] = np.inf
        n = J["hand." + s] - J["lower-arm." + s]
        S[(P - J["hand." + s]) @ n < 0.0, ri["hand." + s]] = np.inf
    S[P[:, 2] < J["neck"][2], ri["head"]] = np.inf
    # nothing above the head joint is trunk or neck, however far a face, beard or hat brim reaches from the head's axis
    # (a wide torso would otherwise claim it by its thickness)
    S[P[:, 2] > J["head"][2], ri["torso"]] = np.inf
    S[P[:, 2] > J["head"][2], ri["neck"]] = np.inf
    # the trunk splits at the lowest spine joint: torso above it, pelvis below it and above the hip joints
    S[P[:, 2] < J["spine"][2], ri["torso"]] = np.inf
    S[P[:, 2] > J["spine"][2], ri["pelvis"]] = np.inf
    S[P[:, 2] < min(J["upper-leg.l"][2], J["upper-leg.r"][2]), ri["pelvis"]] = np.inf
    lab = S.argmin(axis=1)
    # beyond the wrist the arm is hand (a thumb's root is nearer the forearm's line than the hand's); beyond the ankle
    # the leg is foot
    for s in SIDES:
        n = J["hand." + s] - J["lower-arm." + s]
        beyond = (P - J["hand." + s]) @ n > 0.0
        lab[beyond & np.isin(lab, [ri["lower-arm." + s], ri["upper-arm." + s]])] = ri["hand." + s]
        n = J["foot." + s] - J["lower-leg." + s]
        below = (P - J["foot." + s]) @ n > 0.0
        lab[below & (lab == ri["lower-leg." + s])] = ri["foot." + s]

    lab, reassigned = _continuity(lab, edges, N)
    names = [regions[k] for k in lab]
    counts = {}
    for r in names:
        counts[r] = counts.get(r, 0) + 1
    return names, {"counts": counts, "reassignedForContinuity": reassigned,
                   "thicknessM": {r: round(float(rad[ri[r]]), 4) for r in regions}}


def _continuity(lab, edges, N):
    adj = [[] for _ in range(N)]
    for i, j in edges:
        adj[i].append(j); adj[j].append(i)
    comp = np.full(N, -1); sizes = []
    for v in range(N):
        if comp[v] >= 0:
            continue
        c = len(sizes); comp[v] = c; stack = [v]; n_ = 0
        while stack:
            x = stack.pop(); n_ += 1
            for y in adj[x]:
                if comp[y] < 0 and lab[y] == lab[x]:
                    comp[y] = c; stack.append(y)
        sizes.append(n_)
    sizes = np.array(sizes)
    comp_lab = np.zeros(len(sizes), dtype=int); comp_lab[comp] = lab
    biggest = {}
    for sz, L in zip(sizes, comp_lab):
        biggest[L] = max(biggest.get(L, 0), sz)
    stray = np.array([sizes[comp[v]] < max(30, 0.15 * biggest[lab[v]]) for v in range(N)])
    reassigned = 0
    for _ in range(64):
        changed = False
        for v in np.nonzero(stray)[0]:
            around = [lab[y] for y in adj[v] if not stray[y]]
            if around:
                lab[v] = max(set(around), key=around.count); stray[v] = False; reassigned += 1; changed = True
        if not changed:
            break
    return lab, int(reassigned)


def _finger_arcs(Q, joints):
    """For points Q and a finger's joints [j1, j2, j3]: (distance to the finger's line, arc length from j1 along it,
    lengths of its three segments). The third segment runs on past j3 to the fingertip."""
    tip = joints[2] + (joints[2] - joints[1]) * 0.9
    chain = [joints[0], joints[1], joints[2], tip]
    lengths = [float(np.linalg.norm(chain[k + 1] - chain[k])) for k in range(3)]
    best = np.full(len(Q), np.inf); arc = np.zeros(len(Q)); start = 0.0
    for k in range(3):
        a, d = chain[k], chain[k + 1] - chain[k]
        t = np.clip((Q - a) @ d / max(float(d @ d), 1e-12), 0.0, 1.0)
        dist = np.linalg.norm(Q - (a + t[:, None] * d), axis=1)
        closer = dist < best
        best[closer] = dist[closer]; arc[closer] = start + t[closer] * lengths[k]
        start += lengths[k]
    return best, arc, lengths


def label_fingers(coords, names, points):
    """Give the part of each hand that belongs to one finger that finger's region (`index.l`): in place on `names`.

    A hand vertex belongs to a finger when it lies beyond that finger's first joint along the finger and that finger's
    line is the nearest one. The rest stays `hand.<side>` (the palm). Returns {finger region: vertex count}."""
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    counts = {}
    for side in SIDES:
        chains = [(f, s) for f, s in lm.finger_chains(points) if s == side]
        idx = np.array([i for i, r in enumerate(names) if r == "hand." + side], dtype=int)
        if not chains or len(idx) == 0:
            continue
        Q = P[idx]
        dist = np.full((len(idx), len(chains)), np.inf)
        for c, (finger, _) in enumerate(chains):
            j = [_v(points["%s-%d.%s" % (finger, k, side)]) for k in (1, 2, 3)]
            d, _, _ = _finger_arcs(Q, j)
            beyond = (Q - j[0]) @ (j[1] - j[0]) > 0.0
            dist[beyond, c] = d[beyond]
        best = dist.argmin(axis=1)
        owned = np.isfinite(dist.min(axis=1))
        for k in np.nonzero(owned)[0]:
            region = "%s.%s" % (chains[best[k]][0], side)
            names[idx[k]] = region
            counts[region] = counts.get(region, 0) + 1
    return counts


def finger_weights(coords, names, points, bones, height):
    """Weights of every finger-region vertex, by where it sits along its finger: {vertex index: {bone: weight}}.

    Each finger's vertices follow that finger's three bones only, blended across each joint over a short band, and
    blended into the hand bone at the first joint. Position decides, not the heat solver, so a finger never follows its
    neighbour's bones however close the two are. A finger without a bone at each of its three joints is left out."""
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    at = {b["landmark"]: b["name"] for b in bones if b["landmark"] and b["deform"]}
    band = 0.004 * height
    step = lambda t: np.clip(t, 0.0, 1.0) ** 2 * (3 - 2 * np.clip(t, 0.0, 1.0))
    out = {}
    for finger, side in lm.finger_chains(points):
        keys = ["%s-%d.%s" % (finger, k, side) for k in (1, 2, 3)]
        idx = np.array([i for i, r in enumerate(names) if r == "%s.%s" % (finger, side)], dtype=int)
        if len(idx) == 0 or not all(k in at for k in keys) or "hand." + side not in at:
            continue
        _, arc, (l1, l2, _) = _finger_arcs(P[idx], [_v(points[k]) for k in keys])
        s01 = step((arc + band) / (2 * band))                       # hand -> first bone, around the first joint
        s12 = step((arc - (l1 - band)) / (2 * band)); s23 = step((arc - (l1 + l2 - band)) / (2 * band))
        shares = np.stack([1 - s01, s01 - s12, s12 - s23, s23], axis=1)
        order = [at["hand." + side]] + [at[k] for k in keys]
        for row, v in enumerate(idx):
            w = {bone: float(x) for bone, x in zip(order, shares[row]) if x > 1e-4}
            total = sum(w.values())
            out[int(v)] = {bone: x / total for bone, x in w.items()}
    return out


def fused_fingers(coords, names, edges, points):
    """{hand side: edges that join two different fingers beyond their second joints}. A finger is free there on a hand
    with separate fingers; an edge across means the mesh joins the two fingers and they cannot bend apart."""
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    distal = {}
    for finger, side in lm.finger_chains(points):
        if finger == "thumb":
            continue
        idx = np.array([i for i, r in enumerate(names) if r == "%s.%s" % (finger, side)], dtype=int)
        if len(idx) == 0:
            continue
        _, arc, (l1, _, _) = _finger_arcs(P[idx], [_v(points["%s-%d.%s" % (finger, k, side)]) for k in (1, 2, 3)])
        for v in idx[arc > l1]:
            distal[int(v)] = (finger, side)
    out = {}
    for i, j in edges:
        a, b = distal.get(int(i)), distal.get(int(j))
        if a and b and a != b:
            out[a[1]] = out.get(a[1], 0) + 1
    return out


def nearby_regions(names, edges, coords, radius, extra_links=()):
    """Per vertex, the other regions within `radius` of it along the surface: [{region: distance}].

    This is the band in which weights blend across a region border. It is measured along edges, in metres, so the band is
    as wide on a dense mesh as on a coarse one, and a hand hanging beside a thigh is not near it. extra_links: vertex
    index groups that are one point (seams between objects)."""
    import heapq
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    n = len(names)
    adj = [[] for _ in range(n)]
    E = np.asarray(edges, dtype=np.int64).reshape(-1, 2)
    lengths = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1) if len(E) else []
    for (i, j), d in zip(E.tolist(), lengths.tolist() if len(E) else []):
        adj[i].append((j, d)); adj[j].append((i, d))
    for group in extra_links:
        for i in group[1:]:
            adj[group[0]].append((i, 0.0)); adj[i].append((group[0], 0.0))
    out = [{} for _ in range(n)]
    border = {}
    for i in range(n):
        if any(names[j] != names[i] for j, _ in adj[i]):
            border.setdefault(names[i], []).append(i)
    for region, sources in border.items():
        dist = {i: 0.0 for i in sources}
        heap = [(0.0, i) for i in sources]
        while heap:
            d, i = heapq.heappop(heap)
            if d > dist.get(i, np.inf):
                continue
            for j, step in adj[i]:
                nd = d + step
                if names[j] != region and nd <= radius and nd < dist.get(j, np.inf):
                    dist[j] = nd; heapq.heappush(heap, (nd, j))
        for i, d in dist.items():
            if names[i] != region:
                out[i][region] = d
    return out


# ---- bones per region ----------------------------------------------------------------------------------------------

def part_of(anchor):
    """The region whose own bones a bone anchored at this landmark is: 'upper-arm.l' for 'upper-arm.l', 'foot.r' for
    'toes.r', 'index.l' for 'index-2.l', 'torso' for 'chest'."""
    joint, side = lm.split(anchor)
    finger = lm.finger_of(anchor)
    if finger:
        return "%s.%s" % (finger[0], side)
    return lm.on_side(_PART[joint], side) if _PART[joint] in LIMBS else _PART[joint]


def bone_parts(bones):
    """{part: [bone names]} for the deforming bones of a skeleton plan."""
    parts = {}
    for b in bones:
        if b["deform"] and b["anchor"]:
            parts.setdefault(part_of(b["anchor"]), []).append(b["name"])
    return parts


def _anchored(bones, *anchors):
    return {b["name"] for b in bones if b["deform"] and b["anchor"] in anchors}


def allowed_bones(bones):
    """{region: set of bone names a vertex of that region may follow}: its own bones and those of the parts next to it.
    This is what stops a hand hanging beside a thigh from following the leg, and one leg from following the other."""
    A = lambda *anchors: _anchored(bones, *anchors)
    both = lambda joint: A(joint + ".l", joint + ".r")
    out = {"head": A("head", "neck"),
           "neck": A("neck", "head", "chest") | both("shoulder"),
           "torso": A("hips", "spine", "chest", "neck") | both("shoulder") | both("upper-arm"),
           "pelvis": A("hips", "spine") | both("upper-leg")}
    def finger_bones(side, finger=None, joint=None):
        return {b["name"] for b in bones if b["deform"] and b["anchor"] and lm.finger_of(b["anchor"]) and lm.split(b["anchor"])[1] == side
                and finger in (None, lm.finger_of(b["anchor"])[0]) and joint in (None, lm.finger_of(b["anchor"])[1])}
    for s in SIDES:
        out["upper-arm." + s] = A("chest", "shoulder." + s, "upper-arm." + s, "lower-arm." + s)
        out["lower-arm." + s] = A("upper-arm." + s, "lower-arm." + s, "hand." + s)
        out["hand." + s] = A("lower-arm." + s, "hand." + s) | finger_bones(s, joint=1)
        out["upper-leg." + s] = A("hips", "upper-leg." + s, "lower-leg." + s)
        out["lower-leg." + s] = A("upper-leg." + s, "lower-leg." + s, "foot." + s)
        out["foot." + s] = A("lower-leg." + s, "foot." + s, "toes." + s)
        for finger in lm.FINGER_NAMES:
            own = finger_bones(s, finger)
            if own:
                out["%s.%s" % (finger, s)] = own | A("hand." + s)
    return out


def own_bones(region, bones):
    """Bones a checked region must mainly follow. A hand owns its fingers' bones too; a foot owns the toes."""
    parts = bone_parts(bones)
    own = set(parts.get(region, []))
    joint, side = lm.split(region)
    if joint == "hand":
        for finger in lm.FINGER_NAMES:
            own |= set(parts.get("%s.%s" % (finger, side), []))
    return own


def clean_weights(weights, names, near, radius, bones, coords, max_influences, rigid_head_above=None, fixed=None):
    """Hold every vertex to the bones its region allows, keep its strongest `max_influences`, normalise.

    weights: per vertex {bone name: weight}; names: region per vertex; near: per vertex {other region: distance} within
    `radius` (nearby_regions). A bone only a nearby region allows is kept, faded out by the distance to that region, so
    weights blend across a border instead of stopping at it. A vertex left with no weight follows the nearest allowed
    bone. rigid_head_above: z above which head-region vertices follow the head bone alone. fixed: {vertex index:
    weights} that replace the solver's (finger_weights). Returns (weights, stats)."""
    allowed = allowed_bones(bones)
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    seg = {b["name"]: (b["head"], b["tail"]) for b in bones if b["deform"]}
    head_bones = sorted(_anchored(bones, "head"))
    out, removed, nearest, rigid, trimmed, placed = [], 0, 0, 0, 0, 0
    for v, w in enumerate(weights):
        if rigid_head_above is not None and head_bones and names[v] == "head" and P[v, 2] > rigid_head_above:
            out.append({head_bones[0]: 1.0}); rigid += 1
            continue
        if fixed and v in fixed:
            kept = dict(fixed[v]); placed += 1
        else:
            own = allowed.get(names[v], set())
            kept = {}
            for b, x in w.items():
                if x <= 1e-6:
                    continue
                if b not in own:
                    reach = [d for r, d in near[v].items() if b in allowed.get(r, ())]
                    t = min(reach) / radius if reach and radius > 0 else 1.0
                    x *= 1.0 - (t * t * (3 - 2 * t)) if t < 1.0 else 0.0
                if x > 1e-4:
                    kept[b] = x
                else:
                    removed += 1
        if not kept:
            pool = sorted(allowed.get(names[v], set()) & set(seg)) or sorted(seg)
            best = min(pool, key=lambda b: float(segment_distance(P[v:v + 1], seg[b][0], seg[b][1])[0]))
            kept = {best: 1.0}; nearest += 1
        if len(kept) > max_influences:
            kept = dict(sorted(kept.items(), key=lambda item: (-item[1], item[0]))[:max_influences]); trimmed += 1
        total = sum(kept.values())
        out.append({b: x / total for b, x in kept.items()})
    return out, {"removedByRegion": removed, "followNearestBone": nearest, "rigidHead": rigid, "trimmedToLimit": trimmed,
                 "fingerVerticesByPosition": placed}


def distance_weights(coords, names, bones, falloff=4.0):
    """Weights from distance alone, for a mesh the heat solver cannot weight: each vertex follows the bones its region
    allows, by inverse distance to the bone segments raised to `falloff`. Cruder than heat weights at joints."""
    allowed = allowed_bones(bones)
    P = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    order = [b["name"] for b in bones if b["deform"]]
    D = np.stack([segment_distance(P, b["head"], b["tail"]) for b in bones if b["deform"]], axis=1)
    out = []
    for v in range(len(P)):
        pool = [k for k, name in enumerate(order) if name in allowed.get(names[v], ())] or list(range(len(order)))
        d = np.maximum(D[v, pool], 1e-6)
        w = (d.min() / d) ** falloff
        out.append({order[k]: float(x) for k, x in zip(pool, w / w.sum()) if x > 1e-3})
    return out


def deformation_check(weights, names, bones, min_own_weight=0.5, max_stray_share=0.25, stray_below=0.25):
    """Does every limb and the head mainly follow its own bones?

    Per checked region: the mean share of weight on its own bones (must reach `min_own_weight`) and the share of its
    vertices with less than `stray_below` on them (at most `max_stray_share`). A checked region with no vertices fails:
    the landmarks do not fit the mesh. Finger regions count as part of their hand.
    Returns {"thresholds", "regions": {region: {...}}, "failures": [str], "passed": bool}."""
    by_region = {}
    for v, r in enumerate(names):
        joint, side = lm.split(r)
        by_region.setdefault("hand." + side if joint in lm.FINGER_NAMES else r, []).append(v)
    result, failures = {}, []
    for region in CHECKED:
        own = own_bones(region, bones)
        if not own:
            continue
        vs = by_region.get(region, [])
        if not vs:
            result[region] = {"vertices": 0}
            failures.append("%s: no vertices found for this region; the landmarks do not fit the mesh" % region)
            continue
        share = np.array([sum(x for b, x in weights[v].items() if b in own) / max(sum(weights[v].values()), 1e-9) for v in vs])
        mean, stray = float(share.mean()), float((share < stray_below).mean())
        result[region] = {"vertices": len(vs), "meanOwnWeight": round(mean, 3), "strayShare": round(stray, 3)}
        if mean < min_own_weight or stray > max_stray_share:
            failures.append("%s: mean weight on its own bones %.2f (needs %.2f), %d%% of its vertices mostly on other bones (allowed %d%%)"
                            % (region, mean, min_own_weight, round(stray * 100), round(max_stray_share * 100)))
    return {"thresholds": {"minOwnWeight": min_own_weight, "maxStrayShare": max_stray_share, "strayBelow": stray_below},
            "regions": result, "failures": failures, "passed": not failures}


def influence_histogram(weights):
    """{"1": vertices following one bone, "2": ...} and the largest count."""
    hist = {}
    for w in weights:
        n = len(w)
        hist[n] = hist.get(n, 0) + 1
    return {str(k): hist[k] for k in sorted(hist)}, (max(hist) if hist else 0)
