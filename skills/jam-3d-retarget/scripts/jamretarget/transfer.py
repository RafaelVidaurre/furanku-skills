"""Moving a pose sequence from one skeleton to another.

1. Rest alignment. For every landmark both maps place, a world rotation Q takes the target's rest bone to where the
   source's rest bone points: the shortest turn from the target's rest segment (this landmark to the next one on its
   chain) to the source's; for a hand with knuckles on both, the turn that also matches the knuckle line. A landmark
   whose next one is not on both maps takes its parent's Q (it keeps its rest angle to its parent). Trunk landmarks
   (hips, spine, chest, neck, head) get no turn: both rest poses stand upright facing +Z, so their trunks already
   correspond.
2. Transfer. Each shared landmark's world rotation on the target is the source's world rotation change since its rest,
   applied to the aligned target rest: R_t = R_s * R_s,rest^-1 * Q * R_t,rest. A source in an A-pose and a target in a
   T-pose therefore point their limbs the same way at every frame; the rest difference is never applied as motion.
3. Hips (and a root bone, when both skeletons have one above the hips) move by the source's displacement from its rest
   position times k, the target's leg length over the source's.
4. Every other target node keeps its rest transform as stored: bones at no landmark, and landmarks only the target maps.
"""
import numpy as np

from . import gltf, mathx
from .skeleton import ALL, SIDES, TRUNK, SkeletonError, main_child, parent_of, split


class Plan:
    """What goes where between two skeletons, and the rest alignment."""

    def __init__(self, src, tgt):
        self.src, self.tgt = src, tgt
        self.shared = [k for k in ALL if src.has(k) and tgt.has(k)]
        self.target_only = [k for k in ALL if tgt.has(k) and not src.has(k)]
        self.source_only = [k for k in ALL if src.has(k) and not tgt.has(k)]
        self.k = tgt.leg_length / src.leg_length
        self.with_root = src.root is not None and tgt.root is not None
        for skel in (src, tgt):
            driven = [(k, skel.at[k]) for k in self.shared] + ([("the root", skel.root)] if self.with_root else [])
            mirrored = [k for k, node in driven if skel.mirrors(node)]
            if mirrored:
                raise SkeletonError("%s: the bones at %s are mirrored (a negative scale, of their own or a parent's): their turn "
                                    "cannot be read or written as a rotation, so the transfer cannot carry them. Export the rig "
                                    "with positive scales (apply the mirror in the tool that made it)" % (skel.role, ", ".join(mirrored)))
        self.align, self.how = {}, {}
        for k in self.shared:
            self.align[k], self.how[k] = self._align(k)

    def _align(self, k):
        src, tgt = self.src, self.tgt
        joint, side = split(k)
        if joint in TRUNK:
            return np.eye(3), "trunk"
        if joint == "foot":
            # Both skeletons rest standing on their soles: the foot's pitch at rest is its build (ankle height against
            # foot length), not a posture, so each foot keeps its own rest and stands flat when the source's does.
            return np.eye(3), "foot"
        if joint == "hand" and all(f % side in self.shared for f in ("index-1.%s", "pinky-1.%s")):
            def hand_frame(s):
                knuckles = (s.pos("index-1." + side) + s.pos("pinky-1." + side)) / 2
                tip = s.pos("middle-1." + side) if ("middle-1." + side) in self.shared else knuckles
                return mathx.frame(tip - s.pos(k), s.pos("index-1." + side) - s.pos("pinky-1." + side))
            return hand_frame(src) @ hand_frame(tgt).T, "hand frame"
        child = main_child(k)
        if child in self.shared:
            return mathx.arc(tgt.pos(child) - tgt.pos(k), src.pos(child) - src.pos(k)), "segment"
        up = parent_of(k)
        while up is not None and up not in self.align:
            up = parent_of(up)
        return (self.align[up].copy(), "as " + up) if up is not None else (np.eye(3), "none")

    def describe(self):
        """Per shared landmark: how its rest was aligned and by how many degrees the two rest poses differ there."""
        out = {}
        for k in self.shared:
            entry = {"rule": self.how[k], "turnDegrees": round(float(mathx.rotation_angle(self.align[k])), 2)}
            child = main_child(k)
            if (split(k)[0] in TRUNK or split(k)[0] == "foot") and child in self.shared:
                d = mathx.angle_between(self.src.pos(child) - self.src.pos(k), self.tgt.pos(child) - self.tgt.pos(k))
                entry["restDifferenceDegrees"] = round(float(d), 2)
            out[k] = entry
        return out


def map_position(plan, landmark, source_positions):
    """Where a source joint's positions land on the target: its rest position plus k times the source's displacement."""
    return plan.tgt.pos(landmark) + plan.k * (source_positions - plan.src.pos(landmark))


def desired(plan, src_world):
    """World rotations {target node: [F,3,3]} and positions {target node: [F,3]} the transfer asks for."""
    src, tgt = plan.src, plan.tgt
    rot, pos = {}, {}
    for k in plan.shared:
        s, t = src.at[k], tgt.at[k]
        rs_rest, rt_rest = mathx.rot_of(src.rest_world[s]), mathx.rot_of(tgt.rest_world[t])
        rot[t] = mathx.rot_of(src_world[:, s]) @ (rs_rest.T @ plan.align[k] @ rt_rest)
    pos[tgt.at["hips"]] = map_position(plan, "hips", src_world[:, src.at["hips"], :3, 3])
    if plan.with_root:
        s, t = src.root, tgt.root
        rot[t] = mathx.rot_of(src_world[:, s]) @ (mathx.rot_of(src.rest_world[s]).T @ mathx.rot_of(tgt.rest_world[t]))
        pos[t] = tgt.rest_world[t, :3, 3] + plan.k * (src_world[:, s, :3, 3] - src.rest_world[s, :3, 3])
    return rot, pos


def solve(skel, rot, pos, frames):
    """Local and world transforms [F,N,4,4] of a skeleton whose listed nodes take the given world rotations and
    positions; every other node keeps its rest local transform."""
    local = np.repeat(skel.rest_local[None], frames, 0)
    world = np.empty_like(local)
    scale = skel.rest[2]
    eye = np.eye(4)
    for i in skel.order:
        p = skel.parent[i]
        parent_world = world[:, p] if p >= 0 else np.broadcast_to(eye, (frames, 4, 4))
        if i in rot:
            local[:, i, :3, :3] = (np.swapaxes(mathx.rot_of(parent_world), -1, -2) @ rot[i]) * scale[i][None, None, :]
        if i in pos:
            h = np.concatenate([pos[i], np.ones((frames, 1))], axis=1)
            local[:, i, :3, 3] = (np.linalg.inv(parent_world) @ h[:, :, None])[:, :3, 0]
        world[:, i] = parent_world @ local[:, i]
    return local, world


def transfer(plan, src_world):
    """(local, world, rot, pos) of the target for a source pose sequence of world transforms [F,N,4,4]."""
    rot, pos = desired(plan, src_world)
    local, world = solve(plan.tgt, rot, pos, len(src_world))
    return local, world, rot, pos


def channels(skel, local, rot, pos):
    """[(node, path, values)] of the nodes the transfer drives, rotations made continuous."""
    out = []
    for i in sorted(set(rot) | set(pos), key=skel.order.index):
        if i in rot:
            out.append((i, "rotation", mathx.continuous(mathx.mat_to_quat(mathx.rot_of(local[:, i])))))
        if i in pos:
            out.append((i, "translation", local[:, i, :3, 3].copy()))
    return out


def world_of(skel, model_locals_trs):
    """World transforms [F,N,4,4] of sampled local (T, R, S)."""
    return gltf.forward(skel.parent, skel.order, mathx.trs(*model_locals_trs))


# ---- contacts ---------------------------------------------------------------------------------------------------------

LIMBS = {"foot": ("upper-leg", "lower-leg", "foot", (0.0, 0.0, 1.0)), "hand": ("upper-arm", "lower-arm", "hand", (0.0, 0.0, -1.0))}


GROUND = [0, 2]                                             # the horizontal axes of the glTF frame (+Y is up)


def horizontal_speed(positions, fps):
    """Speed over the ground (m/s) of a joint's positions [F,3] at each frame, from central differences."""
    if len(positions) < 2:
        return np.zeros(len(positions))
    return np.linalg.norm(np.gradient(positions[:, GROUND], axis=0), axis=1) * fps


def detect(positions, fps, max_speed, min_frames):
    """[(first, last)] frame windows where a joint moves over the ground slower than max_speed (m/s) for at least
    min_frames frames. Height and vertical speed are not used: a foot planted on a step counts, and a heel lifting
    in place stays planted while its toes roll."""
    if len(positions) < 2:
        return []
    speed = horizontal_speed(positions, fps)
    still = speed < max_speed
    out, start = [], None
    for f, s in enumerate(list(still) + [False]):
        if s and start is None:
            start = f
        elif not s and start is not None:
            if f - start >= min_frames:
                out.append((start, f - 1))
            start = None
    return out


def on_ground(landmark):
    """Ankles and toes stand on the ground; hands rest on any surface."""
    return split(landmark)[0] in ("foot", "toes")


def window_weights(windows, frames, blend):
    """(weight [F], window index [F] or -1): 1 inside a window, falling linearly to 0 over `blend` frames outside it."""
    w, which = np.zeros(frames), np.full(frames, -1)
    f = np.arange(frames)
    for n, (a, b) in enumerate(windows):
        dist = np.where(f < a, a - f, np.where(f > b, f - b, 0))
        wn = np.clip(1.0 - dist / (blend + 1.0), 0.0, 1.0)
        better = wn > w
        w[better], which[better] = wn[better], n
    return w, which


def two_bone(rot, world, nodes, rest_bend, rest_upper, goals, active):
    """Turn the upper and middle bones of a limb so its end joint reaches goals [F,3] on the active frames; the end bone
    keeps its world rotation. The limb bends in the plane it already bends in, or toward its rest bend direction
    (`rest_bend` turned with the upper bone) when straight. Returns the frames' shortfall [F] (0 where reached)."""
    upper, middle, end = nodes
    A, B, C = world[:, upper, :3, 3], world[:, middle, :3, 3], world[:, end, :3, 3]
    l1, l2 = np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1)
    to_goal = goals - A
    want = np.linalg.norm(to_goal, axis=1)
    d = np.clip(want, np.abs(l1 - l2) + 1e-6, (l1 + l2) * (1 - 1e-4))
    u = mathx.unit(to_goal)
    v = (B - A) - u * np.sum((B - A) * u, axis=1, keepdims=True)
    straight = np.linalg.norm(v, axis=1) < 1e-4 * l1
    if np.any(straight):
        bend = (rot[upper] @ rest_upper.T @ np.asarray(rest_bend))
        v = np.where(straight[:, None], bend - u * np.sum(bend * u, axis=1, keepdims=True), v)
    v = mathx.unit(v)
    cos_a = np.clip((l1 ** 2 + d ** 2 - l2 ** 2) / (2 * l1 * d), -1.0, 1.0)
    B2 = A + l1[:, None] * (cos_a[:, None] * u + np.sqrt(1 - cos_a ** 2)[:, None] * v)
    C2 = A + d[:, None] * u
    turn1 = mathx.arc(B - A, B2 - A)
    C1 = A + (turn1 @ (C - A)[:, :, None])[:, :, 0]
    turn2 = mathx.arc(C1 - B2, C2 - B2)
    m = active[:, None, None]
    rot[upper] = np.where(m, turn1 @ rot[upper], rot[upper])
    rot[middle] = np.where(m, turn2 @ turn1 @ rot[middle], rot[middle])
    return np.where(active, np.maximum(want - d, 0.0), 0.0)


def plant(plan, src_world, rot, pos, windows, frames, blend):
    """Hold the target's planted joints still: two-bone IK on each limb with a contact window.

    windows: {landmark: [(first, last)]} for foot.*, toes.*, hand.*. Goals come from the source joint's position mapped
    onto the target (map_position). An ankle or toes joint stands on the ground, so its goal holds the window's mean
    position over the ground and follows the mapped height frame by frame; a hand may rest on any surface, so its goal is
    the window's mean position on all three axes. A foot with its ankle planted puts the ankle on the goal; with only its
    toes planted (heel lifting), it moves the ankle so the toes land on theirs, keeping the foot's turn. Returns (local,
    world, rot, details) after the correction; details per window for the report, slides measured over the ground for
    feet and in space for hands."""
    src, tgt = plan.src, plan.tgt
    _, before = solve(tgt, rot, pos, frames)
    rot = {k: v.copy() for k, v in rot.items()}
    details = []
    goals_of = {}
    for landmark, wins in windows.items():
        if not wins or not plan.tgt.has(landmark) or not plan.src.has(landmark):
            continue
        mapped = map_position(plan, landmark, src_world[:, src.at[landmark], :3, 3])
        held = np.array([mapped[a:b + 1].mean(axis=0) for a, b in wins])
        w, which = window_weights(wins, frames, blend)
        goal = np.where(which[:, None] >= 0, held[np.maximum(which, 0)], 0.0)
        if on_ground(landmark):
            goal[:, 1] = np.where(which >= 0, mapped[:, 1], 0.0)
        goals_of[landmark] = (w, goal)
    for limb, (u_name, m_name, e_name, bend) in LIMBS.items():
        for side in SIDES:
            end, toes = "%s.%s" % (e_name, side), "toes." + side
            if end not in goals_of and (limb != "foot" or toes not in goals_of):
                continue
            nodes = tuple(tgt.at["%s.%s" % (n, side)] for n in (u_name, m_name, e_name))
            C = before[:, nodes[2], :3, 3]
            wa, ga = goals_of.get(end, (np.zeros(frames), np.zeros((frames, 3))))
            goal = C + wa[:, None] * (ga - C)
            if limb == "foot" and toes in goals_of and tgt.has(toes):
                wt, gt = goals_of[toes]
                ankle_for_toes = gt - (before[:, tgt.at[toes], :3, 3] - C)
                goal = goal + ((1 - wa) * wt)[:, None] * (ankle_for_toes - C)
                active = (wa > 0) | (wt > 0)
            else:
                active = wa > 0
            rest_upper = mathx.rot_of(tgt.rest_world[nodes[0]])
            two_bone(rot, before, nodes, bend, rest_upper, goal, active)
    local, world = solve(tgt, rot, pos, frames)
    for landmark, wins in windows.items():
        if landmark not in goals_of:
            continue
        _, goal = goals_of[landmark]
        s_pos = src_world[:, src.at[landmark], :3, 3]
        b_pos, a_pos = before[:, tgt.at[landmark], :3, 3], world[:, tgt.at[landmark], :3, 3]
        axes = GROUND if on_ground(landmark) else [0, 1, 2]
        for a, b in wins:
            span = slice(a, b + 1)
            slide = lambda p: float(np.max(np.linalg.norm(p[span][:, axes] - p[a][axes], axis=1)))
            details.append({"joint": landmark, "frames": [int(a), int(b)],
                            "sourceSlideMeters": round(slide(s_pos), 5),
                            "targetSlideWithoutCorrectionMeters": round(slide(b_pos), 5),
                            "targetSlideMeters": round(slide(a_pos), 5),
                            "correctionMeters": round(float(np.max(np.linalg.norm(a_pos[span] - b_pos[span], axis=1))), 5),
                            "missMeters": round(float(np.max(np.linalg.norm(a_pos[span] - goal[span], axis=1))), 5)})
    return local, world, rot, details
