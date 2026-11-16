"""The neutral landmark file a rig is placed on, and its translation into the frame the conform script works in.

    {"units": "meters", "up": "+Y" | "+Z", "landmarks": {"hips": [x, y, z], "upper-arm.l": [...], ...}, "source": "..."}

Landmarks are joint positions of the character at its real height, standing on the ground plane, in metres. With
"up": "+Y" the file is in glTF's frame (front +Z); with "up": "+Z" it is in Blender's (front -Y). Either way +X is
the character's left. `to_dcc` returns them in Blender's frame, which is what the conform script uses throughout.
"""
CENTRE = ("hips", "spine", "chest", "neck", "head")
SIDED = ("shoulder", "upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot", "toes")
REQUIRED = CENTRE + tuple("%s.%s" % (name, side) for name in SIDED for side in ("l", "r"))
# Optional finger chains: three joints per finger, numbered from the palm outward.
FINGERS = tuple("%s-%d.%s" % (finger, joint, side) for finger in ("thumb", "index", "middle", "ring", "pinky") for joint in (1, 2, 3) for side in ("l", "r"))


class LandmarkError(ValueError):
    pass


def validate(data):
    if not isinstance(data, dict) or not isinstance(data.get("landmarks"), dict):
        raise LandmarkError("a landmark file is an object with a `landmarks` object")
    if data.get("units") != "meters":
        raise LandmarkError("landmark units must be \"meters\", not %r" % data.get("units"))
    if data.get("up") not in ("+Y", "+Z"):
        raise LandmarkError("landmark up must be \"+Y\" (glTF frame) or \"+Z\" (Blender frame), not %r" % data.get("up"))
    missing = [name for name in REQUIRED if name not in data["landmarks"]]
    if missing:
        raise LandmarkError("landmarks missing: " + ", ".join(missing))
    for name, value in data["landmarks"].items():
        if not (isinstance(value, list) and len(value) == 3 and all(isinstance(v, (int, float)) for v in value)):
            raise LandmarkError("landmark %s must be [x, y, z]" % name)
    return data


def to_dcc(data):
    """Landmark name -> (x, y, z) in Blender's frame: Z up, front -Y, +X the character's left."""
    validate(data)
    if data["up"] == "+Z":
        return {name: (float(x), float(y), float(z)) for name, (x, y, z) in data["landmarks"].items()}
    return {name: (float(x), -float(z), float(y)) for name, (x, y, z) in data["landmarks"].items()}


def midpoint(a, b):
    return tuple((a[i] + b[i]) / 2 for i in range(3))


def anatomy_joints(points):
    """The joint set the anatomy labelling reads, from landmarks (in the DCC frame).

    The labelling was written for a source with three spine joints; the canonical set has two (`spine`, `chest`), so
    the middle one is their midpoint.
    """
    joints = {"pelvis": points["hips"], "spine_lo": points["spine"], "spine_mid": midpoint(points["spine"], points["chest"]),
              "spine_hi": points["chest"], "neck": points["neck"], "head": points["head"]}
    for suffix, side in (("_l", "l"), ("_r", "r")):
        for joint, landmark in (("clavicle", "shoulder"), ("upperarm", "upper-arm"), ("lowerarm", "lower-arm"), ("hand", "hand"),
                                ("thigh", "upper-leg"), ("calf", "lower-leg"), ("foot", "foot"), ("ball", "toes")):
            joints[joint + suffix] = points["%s.%s" % (landmark, side)]
    return joints
