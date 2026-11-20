"""The clip measurements, on positions already sampled on whole frames, in the glTF frame (metres, +Y up).

Contacts. A contact point (an ankle, a ball of the foot, a wrist) is planted on a frame when it is within
`detect.height` of the height it has when the rig stands at rest, and its horizontal speed is at most `detect.speed`.
On ground that is not flat only the speed decides. A contact window is a run of planted frames.

Slide. In a window, the largest horizontal distance between any two of the point's positions.

Penetration. How far the lowest point of a foot (its mesh, or failing that its joints at their rest height) goes below
the ground, over the whole clip and per window.

Boundary jump. The residual of a joint's first frame is how far it lies from where the next three frames extrapolate
it (quadratic); fast smooth motion leaves a residual too, so the jump is what the residual adds beyond the largest one
the same joint shows between frames inside the clip. The same for the last frame. A calm joint whose first frame pops
by d reads about d; a joint already moving fast hides part of a pop of its own.

Loop seam. The same measure across the wrap from the last frame to the first, positions taken relative to the root.
A clip may end on a copy of its first pose ("duplicate-end") or one frame before it ("open-end"); the seam is read
under both and the better fit is reported.
"""
import numpy as np

from . import report

H = (0, 2)          # horizontal axes of the glTF frame
UP = 1


def horizontal_speed(p, fps):
    """Horizontal speed (m/s) of one point per frame, from central differences. p: [F, 3]."""
    if len(p) < 2:
        return np.zeros(len(p))
    v = np.gradient(p[:, H], axis=0) * fps
    return np.linalg.norm(v, axis=1)


def runs(mask):
    """[(first, last)] inclusive frame ranges where mask is true."""
    out, start = [], None
    for f, m in enumerate(mask):
        if m and start is None:
            start = f
        elif not m and start is not None:
            out.append((start, f - 1)); start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def diameter(xy):
    """Largest distance between any two rows of xy [N, 2]."""
    if len(xy) < 2:
        return 0.0
    d = xy[:, None, :] - xy[None, :, :]
    return float(np.sqrt((d ** 2).sum(-1)).max())


def planted(p, fps, detect, ground=None, rest_height=0.0):
    """Planted frames of one point p [F, 3]: within detect["height"] of its rest height above the ground (when the
    ground is flat; ground None means not flat) and no faster than detect["speed"]."""
    slow = horizontal_speed(p, fps) <= detect["speed"] + 1e-12
    if ground is None:
        return slow
    clearance = p[:, UP] - ground - rest_height
    return slow & (clearance <= detect["height"] + 1e-12)


def contact_windows(points, fps, detect, ground=None, rest_heights=None, depth=None):
    """Windows of every contact point. points: {(limb, landmark, bone): [F, 3]}; rest_heights: {landmark: m};
    depth: {limb: [F] metres below ground of that limb's lowest point} or None."""
    out = []
    for (limb, landmark, bone), p in points.items():
        rest = (rest_heights or {}).get(landmark, 0.0)
        mask = planted(p, fps, detect, ground, rest)
        speed = horizontal_speed(p, fps)
        for a, b in runs(mask):
            xy = p[a:b + 1][:, H]
            steps = np.linalg.norm(np.diff(xy, axis=0), axis=1) if b > a else np.zeros(1)
            w = {"limb": limb, "point": landmark, "bone": bone, "from": a, "to": b, "frames": b - a + 1,
                 "fromTime": round(a / fps, 4), "toTime": round(b / fps, 4),
                 "slide": report.mm(diameter(xy)), "meanStep": report.mm(steps.mean()), "peakSpeed": round(float(speed[a:b + 1].max()), 3),
                 "atBoundary": "start" if a == 0 else "end" if b == len(p) - 1 else None}
            if depth is not None and limb in depth:
                w["penetration"] = report.mm(depth[limb][a:b + 1].max())
            out.append(w)
    out.sort(key=lambda w: (w["from"], w["limb"], w["point"]))
    return out


def extrapolation_residual(p0, p1, p2, p3):
    """|p0 - (3 p1 - 3 p2 + p3)|: how far p0 lies from the quadratic through the three frames after it."""
    return np.linalg.norm(p0 - (3 * p1 - 3 * p2 + p3), axis=-1)


def interior_residuals(pos):
    """[rows, K]: the same residual for every frame, extrapolated forward and backward, from frames that touch neither
    the first nor the last frame (so a pop at either end never hides in what it is compared with)."""
    F = len(pos)
    rows = [extrapolation_residual(pos[f], pos[f + 1], pos[f + 2], pos[f + 3]) for f in range(1, F - 4)]
    rows += [extrapolation_residual(pos[f], pos[f - 1], pos[f - 2], pos[f - 3]) for f in range(4, F - 1)]
    return np.array(rows) if rows else np.zeros((0, pos.shape[1]))


def excess(residual, interior):
    """How far a boundary residual [K] goes past the largest residual the same point shows inside the clip."""
    top = interior.max(axis=0) if len(interior) else np.zeros_like(residual)
    return np.maximum(0.0, residual - top), top


def boundary_jumps(pos):
    """pos [F, K, 3] -> {"start", "end": (jump [K], residual [K]), "interior": [rows, K]}. Needs F >= 4.

    The residual at the first frame is how far it lies from where the next three frames extrapolate it; the jump is
    what that residual adds beyond the roughest motion the same point makes between frames inside the clip."""
    if len(pos) < 4:
        raise ValueError("a boundary jump needs at least 4 frames; the clip has %d" % len(pos))
    interior = interior_residuals(pos)
    start = extrapolation_residual(pos[0], pos[1], pos[2], pos[3])
    end = extrapolation_residual(pos[-1], pos[-2], pos[-3], pos[-4])
    return {"start": (excess(start, interior)[0], start), "end": (excess(end, interior)[0], end), "interior": interior}


def seam_jumps(rel):
    """rel [F, K, 3] (positions relative to the root) -> {"open-end": (jump [K], residual [K]), "duplicate-end": ...}.

    open-end: the first frame continues the last three. duplicate-end: the last frame is the first frame again, and the
    second frame continues the last three. Jumps are residuals beyond the roughest interior motion, as for boundaries;
    a duplicate end that differs from the first frame counts in full."""
    if len(rel) < 4:
        raise ValueError("a loop seam needs at least 4 frames; the clip has %d" % len(rel))
    interior = interior_residuals(rel)
    ahead = 3 * rel[-1] - 3 * rel[-2] + rel[-3]
    open_res = np.linalg.norm(rel[0] - ahead, axis=-1)
    mismatch = np.linalg.norm(rel[-1] - rel[0], axis=-1)
    dup_res = np.linalg.norm(rel[1] - ahead, axis=-1)
    dup_jump = np.maximum(mismatch, excess(dup_res, interior)[0])
    return {"open-end": (excess(open_res, interior)[0], open_res), "duplicate-end": (dup_jump, np.maximum(mismatch, dup_res)),
            "interior": interior}


def loop_end(frames, fps, length, rel=None):
    """("open" | "duplicate", how it was decided) for a looping clip.

    From the spec when its length is fixed (min equal to max): a cycle of L seconds has L*fps frames when the last frame is one
    before the first pose comes round again, and one more when it repeats the first pose. For a length range, from
    the poses: the last frame repeats the first when most moving points end where they began, closer than half their
    usual step between frames."""
    if length["min"] == length["max"]:
        cycle = int(round(length["min"] * fps))
        if frames == cycle:
            return "open", "the spec: %d frames make %.4g s at %g fps" % (frames, length["min"], fps)
        if frames == cycle + 1:
            return "duplicate", "the spec: %d frames are %.4g s at %g fps plus the first pose again" % (frames, length["min"], fps)
    if rel is None or len(rel) < 3:
        return "open", "assumed: neither the spec's length nor the poses settle it"
    step = np.median(np.linalg.norm(np.diff(rel, axis=0), axis=-1), axis=0)
    moving = step > 1e-6
    if not moving.any():
        return "duplicate", "the poses: nothing moves"
    ratio = np.linalg.norm(rel[-1] - rel[0], axis=-1)[moving] / step[moving]
    share = float((ratio < 0.5).mean())
    return ("duplicate" if share > 0.5 else "open"), "the poses: %.0f%% of moving points end where they began" % (100 * share)


def per_bone(values, labels):
    """{bone: largest value over its labelled points} for values [K] with labels [(bone, end)]."""
    out = {}
    for v, (bone, _) in zip(values, labels):
        out[bone] = max(out.get(bone, 0.0), float(v))
    return {k: report.mm(v) for k, v in out.items()}


def worst(jumps, labels, residual=None, interior=None):
    k = int(np.argmax(jumps))
    out = {"bone": labels[k][0], "end": labels[k][1], "jump": report.mm(jumps[k])}
    if residual is not None:
        out["residual"] = report.mm(residual[k])
    if interior is not None and len(interior):
        out["interiorMax"] = report.mm(interior[:, k].max())
    return out


def roughest(interior, labels):
    """The largest interior residual: which point, and how large."""
    if not len(interior):
        return None
    r, k = np.unravel_index(int(np.argmax(interior)), interior.shape)
    return {"bone": labels[k][0], "end": labels[k][1], "residual": report.mm(interior[r, k]),
            "median": report.mm(np.median(interior))}


def judge(name, measured, threshold, why_unmeasured=None):
    if measured is None:
        return {"threshold": threshold, "measured": None, "passed": None, "unmeasured": why_unmeasured}
    return {"threshold": threshold, "measured": report.mm(measured), "passed": bool(measured <= threshold + 1e-12)}


def coverage(expected, windows, fps, frames):
    """For each window the spec declares planted: the share of its frames the check found planted on that limb."""
    out = []
    for e in expected:
        a, b = max(0, int(round(e["from"] * fps))), min(frames - 1, int(round(e["to"] * fps)))
        want = set(range(a, b + 1))
        got = set()
        for w in windows:
            if w["limb"] == e["limb"]:
                got.update(range(w["from"], w["to"] + 1))
        share = len(want & got) / len(want) if want else 0.0
        out.append(dict(e, frames=[a, b], detectedShare=round(share, 3)))
    return out
