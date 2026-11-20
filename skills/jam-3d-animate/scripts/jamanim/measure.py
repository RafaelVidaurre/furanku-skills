"""The clip measurements, on positions already sampled on whole frames, in the glTF frame (metres, +Y up).

Contacts. A contact point (an ankle, a ball of the foot, a wrist) is planted on a frame when it is within
`detect.height` of the height it has when the rig stands at rest, and its horizontal speed is at most `detect.speed`.
On ground that is not flat only the speed decides. A contact window is a run of planted frames.

Slide. In a window, the largest horizontal distance between any two of the point's positions. Also over each window
the spec declares planted, however fast the foot moves there, and over each run of frames a foot spends within
`detect.height` of the ground at any speed (in contact by the spec's own contact height); those two take the foot's
least-moving point.

Penetration. How far the lowest point of a foot (its mesh, or failing that its joints at their rest height) goes below
the ground, over the whole clip and per window.

Boundary jump. The residual of a joint's first frame is how far it lies from where the next three frames extrapolate
it (quadratic); fast smooth motion leaves a residual too, so the jump is what the residual adds beyond the largest one
the same joint's smooth motion shows inside the clip (jumps inside the clip are left out of that comparison). The same
for the last frame. A calm joint whose first frame pops by d reads about d; a joint already moving fast hides part of
a pop of its own.

Interior jump. Between any two frames inside the clip, how far a joint's step departs from the steps around it.

Loop seam. The boundary measure across the wrap from the last frame to the first, under the clip's loop-end
convention (references/clip-spec.md), positions taken relative to the root.
"""
import numpy as np

from . import report

H = (0, 2)          # horizontal axes of the glTF frame
STEP_FRAMES = 8     # the fewest frames with a step whose stencil touches neither end
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


def step_jumps(pos):
    """[F, K]: for each step from frame k-1 to frame k, how far it departs from the steps around it. With v_k the step
    p_k - p_(k-1), it is |v_(k-2) - 4 v_(k-1) + 6 v_k - 4 v_(k+1) + v_(k+2)| / 6 (a fifth difference): a joint that
    jumps by d between two frames reads d there, one frame out of line by d reads 1.7 d, and smooth motion reads close
    to 0. A joint that stops dead within one frame from a speed of s m/s reads s / (2 fps). Measured on steps whose
    frames touch neither the first nor the last frame (zero elsewhere): those two are the boundary measure's."""
    F = len(pos)
    out = np.zeros(pos.shape[:2])
    if F < STEP_FRAMES:
        return out
    v = np.diff(pos, axis=0)                     # v[i] = p[i+1] - p[i] is the step into frame i+1
    for k in range(4, F - 3):                    # steps k-2 .. k+2 use frames k-3 .. k+2, inside 1 .. F-2
        i = k - 1
        d = v[i - 2] - 4 * v[i - 1] + 6 * v[i] - 4 * v[i + 1] + v[i + 2]
        out[k] = np.linalg.norm(d, axis=-1) / 6.0
    return out


def smooth_baseline(pos, jumps):
    """[K]: the largest residual (see extrapolation_residual) a point shows inside the clip, from stencils that touch
    neither the first nor the last frame, leaving out every stencil a jump inside it accounts for. A jump of d raises a
    residual by at most 2 d (a frame out of line by d: at most 3 d, while it reads 1.7 d), and the motion around it adds
    its own, so a stencil whose residual is at most three times the largest step jump among its steps is the jump's.
    What is left is how rough the point's smooth motion is."""
    F, K = pos.shape[:2]
    best = np.zeros(K)
    for f in range(1, F - 4):                    # stencil f .. f+3, inside 1 .. F-2
        r = extrapolation_residual(pos[f], pos[f + 1], pos[f + 2], pos[f + 3])
        explained = r <= 3 * jumps[f + 1:f + 4].max(axis=0) + 1e-12
        best = np.where(explained, best, np.maximum(best, r))
    return best


def boundary_jumps(pos):
    """pos [F, K, 3] -> {"start", "end": (jump [K], residual [K]), "baseline": [K], "steps": [F, K]}. Needs F >= 4.

    The residual at the first frame is how far it lies from where the next three frames extrapolate it; the jump is
    what that residual adds beyond the roughest smooth motion the same point makes inside the clip (smooth_baseline).
    The same for the last frame. "steps" holds the interior step jumps (step_jumps)."""
    if len(pos) < 4:
        raise ValueError("a boundary jump needs at least 4 frames; the clip has %d" % len(pos))
    steps = step_jumps(pos)
    base = smooth_baseline(pos, steps)
    start = extrapolation_residual(pos[0], pos[1], pos[2], pos[3])
    end = extrapolation_residual(pos[-1], pos[-2], pos[-3], pos[-4])
    return {"start": (np.maximum(0.0, start - base), start), "end": (np.maximum(0.0, end - base), end), "baseline": base, "steps": steps}


def seam_jumps(rel):
    """rel [F, K, 3] (positions relative to the root) -> {"open-end": (jump [K], residual [K]), "duplicate-end": ...,
    "baseline": [K]}.

    open-end: the first frame continues the last three. duplicate-end: the last frame is the first frame again, and the
    second frame continues the last three. Jumps are residuals beyond the point's smooth baseline, as for boundaries;
    a duplicate end that differs from the first frame counts in full."""
    if len(rel) < 4:
        raise ValueError("a loop seam needs at least 4 frames; the clip has %d" % len(rel))
    base = smooth_baseline(rel, step_jumps(rel))
    ahead = 3 * rel[-1] - 3 * rel[-2] + rel[-3]
    open_res = np.linalg.norm(rel[0] - ahead, axis=-1)
    mismatch = np.linalg.norm(rel[-1] - rel[0], axis=-1)
    dup_res = np.linalg.norm(rel[1] - ahead, axis=-1)
    dup_jump = np.maximum(mismatch, np.maximum(0.0, dup_res - base))
    return {"open-end": (np.maximum(0.0, open_res - base), open_res), "duplicate-end": (dup_jump, np.maximum(mismatch, dup_res)),
            "baseline": base}


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


def worst(jumps, labels, residual=None, baseline=None):
    k = int(np.argmax(jumps))
    out = {"bone": labels[k][0], "end": labels[k][1], "jump": report.mm(jumps[k])}
    if residual is not None:
        out["residual"] = report.mm(residual[k])
    if baseline is not None:
        out["baseline"] = report.mm(baseline[k])
    return out


def worst_step(steps, labels):
    """The largest interior step jump: which point, between which frames, and how large."""
    f, k = np.unravel_index(int(np.argmax(steps)), steps.shape)
    return {"bone": labels[k][0], "end": labels[k][1], "frames": [int(f) - 1, int(f)], "jump": report.mm(steps[f, k])}


def roughest(baseline, labels):
    """The point whose smooth motion is roughest, and its baseline."""
    k = int(np.argmax(baseline))
    return {"bone": labels[k][0], "end": labels[k][1], "baseline": report.mm(baseline[k]), "median": report.mm(np.median(baseline))}


def judge(name, measured, threshold, why_unmeasured=None):
    if measured is None:
        return {"threshold": threshold, "measured": None, "passed": None, "unmeasured": why_unmeasured}
    return {"threshold": threshold, "measured": report.mm(measured), "passed": bool(measured <= threshold + 1e-12)}


def frames_of(window, fps, frames):
    """(first, last) frame of a declared window, inside the clip."""
    return max(0, int(round(window["from"] * fps))), min(frames - 1, int(round(window["to"] * fps)))


def declared_slides(points, expected, fps, frames):
    """Slide over each window the spec declares planted, whatever detection found: per contact point of that limb the
    largest horizontal distance between its positions over the window's frames, and for the limb the smallest of those
    (a foot held on its heel or its ball is planted while the other point turns about it).
    points: {(limb, landmark, bone): [F, 3]}."""
    out = []
    for e in expected:
        a, b = frames_of(e, fps, frames)
        per = {lm: report.mm(diameter(p[a:b + 1][:, H])) for (limb, lm, _), p in points.items() if limb == e["limb"] and b >= a}
        out.append(dict(e, frames=[a, b], points=per, slide=min(per.values()) if per else None))
    return out


def grounded_runs(points, detect_height, ground, rest_heights, windows):
    """Runs of frames where a foot touches flat ground: one of its contact points is within detect_height of its rest
    height, at any speed. By the spec's own contact height the foot is in contact on those frames, so the run's slide,
    the travel of the foot's least-moving point over the run, is judged like a window's. "planted" says whether
    detection also found a slow frame in it. points: {(limb, landmark, bone): [F, 3]}."""
    out = []
    for limb in sorted({k[0] for k in points if k[0].startswith("foot")}):
        own = {k: p for k, p in points.items() if k[0] == limb}
        near = np.zeros(len(next(iter(own.values()))), dtype=bool)
        for (_, landmark, _), p in own.items():
            near |= p[:, UP] - ground - (rest_heights or {}).get(landmark, 0.0) <= detect_height + 1e-12
        planted_frames = {f for w in windows if w["limb"] == limb for f in range(w["from"], w["to"] + 1)}
        for a, b in runs(near):
            per = {lm: report.mm(diameter(p[a:b + 1][:, H])) for (_, lm, _), p in own.items()}
            out.append({"limb": limb, "from": a, "to": b, "frames": b - a + 1, "points": per, "slide": min(per.values()),
                        "planted": any(a <= f <= b for f in planted_frames)})
    out.sort(key=lambda r: (r["from"], r["limb"]))
    return out


def coverage(expected, windows, fps, frames):
    """For each window the spec declares planted: the share of its frames the check found planted on that limb."""
    out = []
    for e in expected:
        a, b = frames_of(e, fps, frames)
        want = set(range(a, b + 1))
        got = set()
        for w in windows:
            if w["limb"] == e["limb"]:
                got.update(range(w["from"], w["to"] + 1))
        share = len(want & got) / len(want) if want else 0.0
        out.append(dict(e, frames=[a, b], detectedShare=round(share, 3)))
    return out
