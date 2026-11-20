"""Measurements the retarget report carries: how closely the target's limbs follow the source's, whether a hand or foot
ends up on the other side of the body, hips travel, and the round trip."""
import numpy as np

from . import mathx
from .skeleton import main_child, group_of

LATERAL = np.array([1.0, 0.0, 0.0])


def segment_agreement(plan, src_world, tgt_world):
    """Per body part (trunk, arms, legs, feet, fingers): the largest and mean angle, over frames, between a source segment
    (a landmark to the next one on its chain) and the same segment on the target."""
    groups = {}
    for k in plan.shared:
        child = main_child(k)
        if child not in plan.shared:
            continue
        s = src_world[:, plan.src.at[child], :3, 3] - src_world[:, plan.src.at[k], :3, 3]
        t = tgt_world[:, plan.tgt.at[child], :3, 3] - tgt_world[:, plan.tgt.at[k], :3, 3]
        groups.setdefault(group_of(k), {})[k] = mathx.angle_between(s, t)
    out = {}
    for g, per in groups.items():
        worst = max(per, key=lambda k: float(per[k].max()))
        allv = np.concatenate(list(per.values()))
        out[g] = {"maxDegrees": round(float(allv.max()), 3), "meanDegrees": round(float(allv.mean()), 3), "worst": worst}
    return out


def lateral_offsets(skel, world, landmark):
    """Signed distance, in heights, of a joint from the body's midplane (through the hips, across the hips' left axis)."""
    hips = skel.at["hips"]
    axis = mathx.rot_of(world[:, hips]) @ (mathx.rot_of(skel.rest_world[hips]).T @ LATERAL)
    off = world[:, skel.at[landmark], :3, 3] - world[:, hips, :3, 3]
    return np.sum(off * axis, axis=1) / skel.height


def side_flips(plan, src_world, tgt_world, margin=0.03):
    """Frames where a hand or foot is on the other side of the body's midplane than on the source, both clear of it by
    more than `margin` of the height: the limb crossed through the body."""
    out = {}
    for k in ("hand.l", "hand.r", "foot.l", "foot.r"):
        s, t = lateral_offsets(plan.src, src_world, k), lateral_offsets(plan.tgt, tgt_world, k)
        out[k] = int(np.sum((np.sign(s) != np.sign(t)) & (np.abs(s) > margin) & (np.abs(t) > margin)))
    return out


def travel(positions):
    """Hips travel of a clip: ground displacement first to last frame, ground path length, height range."""
    ground = positions[:, [0, 2]]
    step = np.linalg.norm(np.diff(ground, axis=0), axis=1)
    return {"groundDisplacementMeters": round(float(np.linalg.norm(ground[-1] - ground[0])), 4),
            "groundPathMeters": round(float(step.sum()), 4),
            "start": [round(float(v), 4) for v in positions[0]], "end": [round(float(v), 4) for v in positions[-1]],
            "heightRangeMeters": [round(float(positions[:, 1].min()), 4), round(float(positions[:, 1].max()), 4)]}


def pose_error(skel, landmarks, world_a, world_b):
    """Largest and mean distance (metres and heights) and largest rotation difference (degrees) between two pose
    sequences of one skeleton, over the given landmarks."""
    nodes = [skel.at[k] for k in landmarks]
    d = np.linalg.norm(world_a[:, nodes][..., :3, 3] - world_b[:, nodes][..., :3, 3], axis=2)
    ra, rb = mathx.rot_of(world_a[:, nodes]), mathx.rot_of(world_b[:, nodes])
    ang = mathx.rotation_angle(np.swapaxes(ra, -1, -2) @ rb)
    worst = landmarks[int(np.unravel_index(np.argmax(d), d.shape)[1])]
    return {"maxMeters": float(d.max()), "meanMeters": float(d.mean()), "maxHeights": float(d.max() / skel.height),
            "maxDegrees": float(ang.max()), "worst": worst}


def unchanged(values, rest, path, tolerance):
    """True when a sampled channel never leaves its rest value by more than `tolerance` (degrees for rotations,
    metres for translations, ratio for scales)."""
    if path == "rotation":
        dots = np.abs(np.sum(mathx.unit(values) * mathx.unit(rest), axis=-1))
        return bool(np.degrees(2 * np.arccos(np.clip(dots, -1, 1))).max() <= tolerance)
    return bool(np.abs(values - rest).max() <= tolerance)
