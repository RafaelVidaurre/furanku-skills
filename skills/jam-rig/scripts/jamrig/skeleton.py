"""Skeleton profiles and the skeleton built on a set of landmarks.

A profile names a target skeleton as data:

    {"label": "...", "bones": {"<landmark>": "<bone name>", ...}, "hierarchy": {"<bone>": "<parent bone>" | null, ...}}

`bones` says which bone stands at each landmark; a landmark the skeleton lacks is left out. `hierarchy` is optional:
without it the bones hang as the landmarks do. With it, it may list bones that stand at no landmark:
  - a bone between two landmark bones (extra spine or neck joints, a metacarpal) is spaced evenly on the line between them
    and deforms the mesh like any other;
  - a bone above the hips (a root) stands at the origin, on the ground;
  - any other (a twist, IK or attachment bone) stands at its parent and gets no weights.
`plan` turns landmarks plus an optional profile into bones with positions, in parent-before-child order.
"""
import math

from . import landmarks as lm


class ProfileError(ValueError):
    pass


def load_profile(data, profile_id=None):
    """The profile in a JSON document: the document itself, or the one named `profile_id` under `skeletons` (a project
    configuration), `engine.facts.skeletons` (a project's engine overrides) or `facts.skeletons` (an engine adapter)."""
    if not isinstance(data, dict):
        raise ProfileError("a skeleton profile is a JSON object")
    def under(*keys):
        cur = data
        for key in keys:
            cur = cur.get(key) if isinstance(cur, dict) else None
        return cur
    # a project's own profiles, its overrides of the engine's, then an adapter's
    tables = [t for t in (under("skeletons"), under("engine", "facts", "skeletons"), under("facts", "skeletons")) if isinstance(t, dict)]
    if profile_id is not None:
        for table in tables:
            if profile_id in table:
                return validate_profile(table[profile_id])
        raise ProfileError("no skeleton profile %r in this file (it has: %s)" % (profile_id, ", ".join(sorted(k for t in tables for k in t)) or "none"))
    if "bones" in data:
        return validate_profile(data)
    names = sorted(k for t in tables for k in t)
    if len(names) == 1:
        return validate_profile(next(t for t in tables if names[0] in t)[names[0]])
    raise ProfileError("this file holds %s: name one with --profile-id" % ("profiles " + ", ".join(names) if names else "no skeleton profile"))


def validate_profile(profile):
    if not isinstance(profile, dict) or not isinstance(profile.get("bones"), dict):
        raise ProfileError("a skeleton profile needs `bones`: landmark -> bone name")
    bones, faults = profile["bones"], []
    unknown = sorted(k for k in bones if k not in lm.ALL)
    if unknown:
        faults.append("`bones` keys that are not landmarks: " + ", ".join(unknown))
    if not all(isinstance(v, str) and v.strip() for v in bones.values()):
        faults.append("every bone name must be a non-empty string")
    elif len(set(bones.values())) != len(bones):
        faults.append("one bone is named for several landmarks")
    if "hips" not in bones:
        faults.append("`bones` must name the bone at `hips`")
    hierarchy = profile.get("hierarchy")
    if hierarchy is not None:
        if not isinstance(hierarchy, dict):
            faults.append("`hierarchy` must be an object: bone -> parent bone or null")
        else:
            absent = sorted(v for v in bones.values() if isinstance(v, str) and v not in hierarchy)
            if absent:
                faults.append("`hierarchy` lacks bones that `bones` names: " + ", ".join(absent))
            orphans = sorted(k for k, p in hierarchy.items() if p is not None and p not in hierarchy)
            if orphans:
                faults.append("`hierarchy` parents that are not bones in it, for: " + ", ".join(orphans))
            if not orphans and not [k for k, p in hierarchy.items() if p is None]:
                faults.append("`hierarchy` has no root (a bone whose parent is null)")
            if not orphans:
                for name in hierarchy:
                    seen, cur = set(), name
                    while cur is not None and cur not in seen:
                        seen.add(cur); cur = hierarchy[cur]
                    if cur is not None:
                        faults.append("`hierarchy` loops at " + name); break
    if faults:
        raise ProfileError("; ".join(faults))
    return profile


def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def _len(a): return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
def _lerp(a, b, t): return _add(a, _mul(_sub(b, a), t))
def _unit(a, fallback=(0.0, 0.0, 1.0)):
    n = _len(a)
    return _mul(a, 1.0 / n) if n > 1e-9 else fallback


def plan(points, profile=None, fingers="auto", extents=None):
    """Bones of the skeleton to build, parents before children.

    points: working-frame landmarks. fingers: "auto" builds every finger whose three joints are present; "none" builds no
    finger bones (the hand bone then carries the whole hand). extents (optional, from the mesh): {"top": z of the top of
    the head, "hand.l"/"hand.r": how far the hand reaches beyond the wrist, "height": mesh height}.
    Each bone: {"name", "parent", "landmark" (or None), "anchor" (the landmark whose body part it belongs to, or None),
    "head", "tail", "deform", "placed": "landmark" | "between" | "origin" | "parent"}."""
    if fingers not in ("auto", "none"):
        raise ProfileError("fingers must be auto or none")
    extents = extents or {}
    chains = lm.finger_chains(points) if fingers == "auto" else []
    active = [name for name in lm.CORE if name in points]
    active += ["%s-%d.%s" % (finger, joint, side) for finger, side in chains for joint in (1, 2, 3)]
    height = extents.get("height") or max(p[2] for p in points.values()) - min(p[2] for p in points.values())

    if profile is None:
        bone_at = {name: name for name in active}
    else:
        bone_at = {name: profile["bones"][name] for name in active if name in profile["bones"]}
    landmark_of = {bone: name for name, bone in bone_at.items()}

    if profile is not None and profile.get("hierarchy") is not None:
        full = dict(profile["hierarchy"])
        all_mapped = set(profile["bones"].values())
        kids = {}
        for bone, parent in full.items():
            kids.setdefault(parent, []).append(bone)
        def mapped_below(bone):
            out, stack = [], list(kids.get(bone, []))
            while stack:
                b = stack.pop()
                (out.append(b) if b in all_mapped else stack.extend(kids.get(b, [])))
            return out
        # a bone is left out when it stands at a landmark this build has not got (fingers off, or missing from the file),
        # and so is an in-between bone all of whose landmark bones below are left out
        dropped = {b for b in all_mapped if b not in landmark_of}
        for bone in full:
            below = mapped_below(bone)
            if bone not in all_mapped and below and all(b in dropped for b in below):
                dropped.add(bone)
        def kept_parent(bone):
            p = full[bone]
            while p is not None and p in dropped:
                p = full[p]
            return p
        parent = {bone: kept_parent(bone) for bone in full if bone not in dropped}
    else:
        def bone_above(name):
            p = lm.parent_of(name)
            while p is not None and p not in bone_at:
                p = lm.parent_of(p)
            return bone_at.get(p)
        parent = {bone_at[name]: bone_above(name) for name in active if name in bone_at}

    children = {}
    for bone, p in parent.items():
        children.setdefault(p, []).append(bone)
    order, stack = [], list(reversed(children.get(None, [])))
    while stack:
        b = stack.pop(); order.append(b); stack.extend(reversed(children.get(b, [])))

    def nearest_mapped_below(bone):
        """Landmark bones reached from `bone` through bones without a landmark: [(landmark bone, path of in-between bones)]."""
        out, stack = [], [(c, [bone]) for c in children.get(bone, [])]
        while stack:
            b, path = stack.pop()
            if b in landmark_of: out.append((b, path))
            else: stack.extend((c, path + [b]) for c in children.get(b, []))
        return out

    head, placed, anchor, chain_next = {}, {}, {}, {}
    for bone in order:                                   # landmark bones first: the others are placed from them
        if bone in landmark_of:
            head[bone] = points[landmark_of[bone]]; placed[bone] = "landmark"; anchor[bone] = landmark_of[bone]
    for bone in order:
        if bone in head:
            continue
        above = parent[bone]
        while above is not None and above not in landmark_of:
            above = parent[above]
        below = nearest_mapped_below(bone)
        if above is not None and below:
            # in-between bone: on the line from the landmark bone above to the one this chain leads to
            want = lm.main_child(landmark_of[above])
            below.sort(key=lambda item: (landmark_of[item[0]] != want, lm.ALL.index(landmark_of[item[0]])))
            target, path = below[0]
            up, cur = [], bone
            while cur != above:
                up.append(cur); cur = parent[cur]
            between = list(reversed(up)) + path[1:]      # every in-between bone from `above` down to `target`
            at = between.index(bone)
            head[bone] = _lerp(head[above], head[target], (at + 1) / (len(between) + 1))
            placed[bone] = "between"; anchor[bone] = landmark_of[above]
            chain_next[bone] = between[at + 1] if at + 1 < len(between) else target
        elif above is None and below:
            head[bone] = (0.0, 0.0, 0.0); placed[bone] = "origin"; anchor[bone] = None
        else:
            head[bone] = head[parent[bone]] if parent[bone] is not None else (0.0, 0.0, 0.0)
            placed[bone] = "parent"; anchor[bone] = None

    def aim_child(bone):
        """The child this bone points at: the one leading to its landmark's main child; for an in-between bone, the next
        bone of its chain."""
        own = anchor[bone]
        kids_ = [c for c in children.get(bone, []) if placed[c] in ("landmark", "between")]
        if not kids_ or own is None:
            return None
        want = lm.main_child(landmark_of[bone]) if bone in landmark_of else None
        def leads_to(c):
            reach = [c] if c in landmark_of else [b for b, _ in nearest_mapped_below(c)]
            return [landmark_of[b] for b in reach]
        if bone in landmark_of:
            for c in kids_:
                if want in leads_to(c):
                    return c
            # the main child has no bone (no finger bones under a hand, no toes): the bone ends on its own rule below
            return None
        return chain_next[bone]

    front = (0.0, -1.0, 0.0)
    tail = {}
    for bone in order:
        h, child = head[bone], aim_child(bone)
        if child is not None and _len(_sub(head[child], h)) > 1e-5:
            tail[bone] = head[child]; continue
        name = landmark_of.get(bone)
        joint, side = lm.split(name) if name else (None, None)
        up_bone = parent[bone]
        along = _unit(_sub(h, head[up_bone])) if up_bone is not None and _len(_sub(h, head[up_bone])) > 1e-5 else (0.0, 0.0, 1.0)
        if joint == "head":
            top = extents.get("top", h[2] + 0.12 * height)
            tail[bone] = (h[0], h[1], max(top - 0.01 * height, h[2] + 0.03 * height))
        elif joint == "hand":
            fore = _unit(_sub(h, points["lower-arm." + side]))
            tail[bone] = _add(h, _mul(fore, max(extents.get("hand." + side, 0.0), 0.03 * height)))
        elif joint in ("toes", "foot"):
            src = points["foot." + side]
            flat = _sub(h, src) if joint == "toes" else front
            flat = _unit((flat[0], flat[1], 0.0), front)
            tail[bone] = _add(h, _mul(flat, 0.04 * height if joint == "toes" else 0.08 * height))
        elif name and lm.finger_of(name):
            tail[bone] = _add(h, _mul(along, 0.8 * _len(_sub(h, head[up_bone]))))
        elif placed[bone] in ("landmark", "between"):
            tail[bone] = _add(h, _mul(along, 0.05 * height))
        else:
            tail[bone] = (h[0], h[1], h[2] + 0.03 * height)

    return [{"name": bone, "parent": parent[bone], "landmark": landmark_of.get(bone), "anchor": anchor[bone],
             "head": tuple(head[bone]), "tail": tuple(tail[bone]), "deform": placed[bone] in ("landmark", "between"),
             "placed": placed[bone]} for bone in order]


def describe_rig(bones, table):
    """Which landmark each bone of an existing rig stands at or belongs to, in the shape `plan` returns (without
    positions), so a rig this skill did not build can be posed by landmark.

    bones: [(name, parent name or None)]; table: {bone name: landmark}. A bone without a landmark that lies between two
    landmark bones belongs to the upper one's body part (`anchor`); any other such bone belongs to none."""
    parent = dict(bones)
    children = {}
    for name, p in bones:
        children.setdefault(p, []).append(name)
    def leads_to_landmark(name):
        stack = list(children.get(name, []))
        while stack:
            b = stack.pop()
            if b in table: return True
            stack.extend(children.get(b, []))
        return False
    out = []
    for name, p in bones:
        landmark, anchor = table.get(name), table.get(name)
        if landmark is None and leads_to_landmark(name):
            above = p
            while above is not None and above not in table:
                above = parent.get(above)
            anchor = table.get(above)
        out.append({"name": name, "parent": p, "landmark": landmark, "anchor": anchor, "deform": anchor is not None,
                    "placed": "landmark" if landmark else "between" if anchor else "parent"})
    return out


def roll_reference(head, tail):
    """The direction a bone's local Z axis is turned toward: the character's front, or up for a bone that itself points
    front or back (a foot)."""
    d = _unit(_sub(tail, head))
    return (0.0, 0.0, 1.0) if abs(d[1]) > 0.866 else (0.0, -1.0, 0.0)
