"""A skeleton described by a landmark map: which node of a glTF file stands at which landmark, its rest pose, and the
facts the transfer needs (chains, root, height, leg length). Everything is in glTF's frame: metres, +Y up, the
character faces +Z, +X is its left.

A landmark map is {"label", "notes", "landmarks": {bone name: landmark}}. A provider descriptor's `rig.landmarks` and a
skeleton profile's `bones` (landmark: bone name, read the other way) are accepted too.
"""
import json

import numpy as np

from . import gltf, mathx

SIDES = ("l", "r")
TRUNK = ("hips", "spine", "chest", "neck", "head")
SIDED = ("shoulder", "upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot", "toes")
FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
BODY = TRUNK + tuple("%s.%s" % (n, s) for n in SIDED for s in SIDES)
FINGERS = tuple("%s-%d.%s" % (f, j, s) for f in FINGER_NAMES for j in (1, 2, 3) for s in SIDES)
ALL = BODY + FINGERS
# What every map must place: the hips carry travel; arms and legs fix the sides, the facing and the leg length.
REQUIRED = ("hips", "head") + tuple("%s.%s" % (n, s) for n in ("upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot") for s in SIDES)


class SkeletonError(ValueError):
    pass


def split(name):
    joint, _, side = name.partition(".")
    return joint, (side or None)


def on_side(joint, side):
    return joint if side is None else "%s.%s" % (joint, side)


def finger_of(name):
    joint = split(name)[0]
    finger, _, number = joint.rpartition("-")
    return (finger, int(number)) if finger in FINGER_NAMES and number in ("1", "2", "3") else None


def parent_of(name):
    joint, side = split(name)
    finger = finger_of(name)
    if finger:
        return on_side("hand" if finger[1] == 1 else "%s-%d" % (finger[0], finger[1] - 1), side)
    chain = {"hips": None, "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck", "shoulder": "chest",
             "upper-arm": on_side("shoulder", side), "lower-arm": on_side("upper-arm", side), "hand": on_side("lower-arm", side),
             "upper-leg": "hips", "lower-leg": on_side("upper-leg", side), "foot": on_side("lower-leg", side), "toes": on_side("foot", side)}
    return chain[joint]


def main_child(name):
    """The landmark the bone at this one points at; None where a chain ends (head, toes, a fingertip)."""
    joint, side = split(name)
    finger = finger_of(name)
    if finger:
        return on_side("%s-%d" % (finger[0], finger[1] + 1), side) if finger[1] < 3 else None
    chain = {"hips": "spine", "spine": "chest", "chest": "neck", "neck": "head", "shoulder": "upper-arm", "upper-arm": "lower-arm",
             "lower-arm": "hand", "hand": "middle-1", "upper-leg": "lower-leg", "lower-leg": "foot", "foot": "toes"}
    child = chain.get(joint)
    return None if child is None else on_side(child, side)


def group_of(name):
    joint, _ = split(name)
    if finger_of(name):
        return "fingers"
    if joint in TRUNK:
        return "trunk"
    if joint in ("foot", "toes"):
        return "feet"
    return "arms" if joint in ("shoulder", "upper-arm", "lower-arm", "hand") else "legs"


def load_map(path):
    """{bone name: landmark} from a landmark map, a provider descriptor (`rig.landmarks`) or a skeleton profile (`bones`)."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except ValueError as e:
        raise SkeletonError("%s is not JSON: %s" % (path, e))
    if not isinstance(data, dict):
        raise SkeletonError("%s: a landmark map is a JSON object" % path)
    if isinstance(data.get("bones"), dict):
        table = {bone: landmark for landmark, bone in data["bones"].items()}
    elif isinstance(data.get("rig"), dict) and isinstance(data["rig"].get("landmarks"), dict):
        table = dict(data["rig"]["landmarks"])
    elif isinstance(data.get("landmarks"), dict):
        table = dict(data["landmarks"])
    else:
        raise SkeletonError("%s: no map found; expected `landmarks` (bone name -> landmark), `rig.landmarks` or a profile's `bones`" % path)
    wrong = sorted("%s -> %r" % (b, l) for b, l in table.items() if l not in ALL)
    if wrong:
        raise SkeletonError("%s names landmarks outside the vocabulary: %s" % (path, ", ".join(wrong)))
    return table


class Skeleton:
    """One glTF file read through a landmark map.

    nodes: every node of the file (the transfer runs over the whole node tree, so parents that are not bones, such as an
    armature node with a scale, count). at: {landmark: node}. root: the hips' parent when that parent is a joint of the
    file's skin, else None. Rest pose: the nodes' own transforms as stored."""

    def __init__(self, path, table, role):
        self.path, self.role = path, role
        self.model = gltf.Gltf(path)
        m = self.model
        names = {}
        for i in range(len(m.nodes)):
            names.setdefault(m.name(i), []).append(i)
        self.at, used, self.findings = {}, {}, []
        clashes = []
        for bone, landmark in table.items():
            nodes = names.get(bone)
            if not nodes:
                continue
            if len(nodes) > 1:
                raise SkeletonError("%s: several nodes are named %r; the map cannot tell them apart" % (role, bone))
            if landmark in self.at:
                clashes.append("%s (%s and %s)" % (landmark, used[landmark], bone))
                continue
            self.at[landmark], used[landmark] = nodes[0], bone
        if clashes:
            raise SkeletonError("%s: more than one bone maps to %s" % (role, ", ".join(clashes)))
        missing = [k for k in REQUIRED if k not in self.at]
        if missing:
            raise SkeletonError("%s: no bone of %s maps to %s. Bones the map does not name: %s" % (
                role, path, ", ".join(missing), ", ".join(sorted(n for n in names if n not in table)) or "none"))
        self.bone_of = {k: m.name(i) for k, i in self.at.items()}
        self.parent = m.parent
        self.order = m.order
        self.rest = m.rest_trs()
        self.rest_local = mathx.trs(*self.rest)
        self.rest_world = gltf.forward(self.parent, self.order, self.rest_local[None])[0]
        joints = set(m.skin_joints())
        if not joints:                                       # a bare skeleton: the hips and everything below them
            joints, stack = set(), [self.at["hips"]]
            while stack:
                i = stack.pop(); joints.add(i); stack.extend(m.nodes[i].get("children", []))
        hip_parent = self.parent[self.at["hips"]]
        self.root = hip_parent if hip_parent >= 0 and hip_parent in joints else None
        self.joints = joints
        self.unmapped = sorted(m.name(i) for i in joints if i not in self.at.values() and i != self.root)
        self._check()

    def pos(self, landmark):
        return self.rest_world[self.at[landmark], :3, 3].copy()

    def has(self, *landmarks):
        return all(k in self.at for k in landmarks)

    def _check(self):
        """Refuse a rest pose this skill cannot read: not upright in the glTF frame, sides swapped, facing backward."""
        P = self.pos
        foot = min(P("foot.l")[1], P("foot.r")[1])
        self.height = float(P("head")[1] - foot)
        if self.height <= 0:
            raise SkeletonError("%s: the head is not above the feet; the file is not +Y up" % self.role)
        lean = mathx.angle_between(P("head") - P("hips"), np.array([0.0, 1.0, 0.0]))
        if lean > 30:
            raise SkeletonError("%s: hips to head lean %.0f degrees from +Y; the rest pose must stand upright" % (self.role, lean))
        swapped = [j for j in ("upper-arm", "hand", "upper-leg", "foot") if P(j + ".l")[0] <= P(j + ".r")[0]]
        if swapped:
            raise SkeletonError("%s: left joints are not on +X of right ones (%s): the character faces -Z or the map swaps sides"
                                % (self.role, ", ".join(swapped)))
        if self.has("toes.l", "toes.r"):
            if all(P("toes." + s)[2] <= P("foot." + s)[2] for s in SIDES):
                raise SkeletonError("%s: the toes are behind the ankles; the character faces -Z, glTF's front is +Z" % self.role)
        else:
            self.findings.append({"level": "warning", "code": "no-toes", "message": "%s has no toes landmarks; its facing was "
                                  "checked from its sides only" % self.role})
        spread = self.bind_spread()
        if spread is not None and spread > 0.01 * self.height:
            self.findings.append({"level": "warning", "code": "posed", "message": "%s: the nodes stand %.3f m away from the skin's bind "
                                  "pose; the nodes' pose is taken as the rest pose" % (self.role, spread)})
        legs = [np.linalg.norm(P("lower-leg." + s) - P("upper-leg." + s)) + np.linalg.norm(P("foot." + s) - P("lower-leg." + s)) for s in SIDES]
        self.leg_length = float(np.mean(legs))
        scale = np.linalg.norm(self.rest_world[self.at["hips"], :3, :3], axis=0)
        if np.max(scale) - np.min(scale) > 1e-4 * np.max(scale):
            raise SkeletonError("%s: the hips carry a non-uniform scale; only uniform scales are read" % self.role)

    def bind_spread(self):
        """How far the stored node pose is from the skin's bind pose: the largest distance between where two joints put
        the mesh's origin. Near zero for a file saved in its bind pose; None without a skin."""
        skins = self.model.json.get("skins", [])
        if not skins or "inverseBindMatrices" not in skins[0]:
            return None
        ibm = self.model.accessor(skins[0]["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        origins = np.array([(self.rest_world[j] @ ibm[k])[:3, 3] for k, j in enumerate(skins[0]["joints"])])
        return float(np.linalg.norm(origins.max(axis=0) - origins.min(axis=0)))

    def describe(self):
        return {"file": self.path.replace("\\", "/"), "nodes": len(self.model.nodes), "joints": len(self.joints),
                "landmarks": {k: self.bone_of[k] for k in ALL if k in self.at},
                "root": self.model.name(self.root) if self.root is not None else None,
                "unmappedJoints": self.unmapped,
                "heightMeters": round(self.height, 4), "legLengthMeters": round(self.leg_length, 4)}
