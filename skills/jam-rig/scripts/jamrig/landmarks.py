"""The landmark vocabulary and the landmark file: joint positions of one humanoid mesh, in metres.

    {"units": "meters", "up": "+Y" | "+Z", "landmarks": {"hips": [x, y, z], "upper-arm.l": [...], ...}, "source": "..."}

With "up": "+Y" the file is in glTF's frame (front +Z); with "up": "+Z" the front is -Y. In both, +X is the
character's own left. Everything in this package works in the second one, called the working frame here:
Z up, front -Y, +X left.
"""
import json
import math

SIDES = ("l", "r")
CENTRE = ("hips", "spine", "chest", "neck", "head")
SIDED = ("shoulder", "upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot", "toes")
FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
CORE = CENTRE + tuple("%s.%s" % (name, side) for name in SIDED for side in SIDES)
FINGERS = tuple("%s-%d.%s" % (finger, joint, side) for finger in FINGER_NAMES for joint in (1, 2, 3) for side in SIDES)
ALL = CORE + FINGERS
FILE_KEYS = ("$schema", "units", "up", "landmarks", "source")

# Shares of the hips-to-neck line where two auto-rigs put their lowest and highest spine joints.
SPINE_SHARE, CHEST_SHARE = 0.28, 0.83
# A shoulder (inner end of the collarbone) sits about a fifth of the way from the midline to the arm joint.
SHOULDER_SHARE = 0.2


class LandmarkError(ValueError):
    pass


def split(name):
    """('upper-arm', 'l') for 'upper-arm.l'; ('hips', None) for 'hips'."""
    joint, _, side = name.partition(".")
    return joint, (side or None)


def on_side(joint, side):
    return joint if side is None else "%s.%s" % (joint, side)


def finger_of(name):
    """('index', 2) for 'index-2.l'; None for a body landmark."""
    joint = split(name)[0]
    finger, _, number = joint.rpartition("-")
    return (finger, int(number)) if finger in FINGER_NAMES and number in ("1", "2", "3") else None


def parent_of(name):
    """The landmark a landmark hangs from; None for hips."""
    joint, side = split(name)
    finger = finger_of(name)
    if finger:
        return on_side("hand" if finger[1] == 1 else "%s-%d" % (finger[0], finger[1] - 1), side)
    chain = {"hips": None, "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck",
             "shoulder": "chest", "upper-arm": on_side("shoulder", side), "lower-arm": on_side("upper-arm", side),
             "hand": on_side("lower-arm", side), "upper-leg": "hips", "lower-leg": on_side("upper-leg", side),
             "foot": on_side("lower-leg", side), "toes": on_side("foot", side)}
    return chain[joint]


def main_child(name):
    """The landmark a bone at this landmark points at; None where the chain ends (head, toes, a fingertip)."""
    joint, side = split(name)
    finger = finger_of(name)
    if finger:
        return on_side("%s-%d" % (finger[0], finger[1] + 1), side) if finger[1] < 3 else None
    chain = {"hips": "spine", "spine": "chest", "chest": "neck", "neck": "head", "shoulder": "upper-arm",
             "upper-arm": "lower-arm", "lower-arm": "hand", "hand": "middle-1", "upper-leg": "lower-leg",
             "lower-leg": "foot", "foot": "toes"}
    child = chain.get(joint)
    return None if child is None else on_side(child, side) if side else child


def finger_chains(names):
    """[(finger, side)] for every finger whose three joints are all among `names`."""
    names = set(names)
    return [(finger, side) for side in SIDES for finger in FINGER_NAMES
            if all("%s-%d.%s" % (finger, joint, side) in names for joint in (1, 2, 3))]


def validate(data):
    """Raise LandmarkError naming every fault of a landmark file; return the file."""
    if not isinstance(data, dict) or not isinstance(data.get("landmarks"), dict):
        raise LandmarkError("a landmark file is an object with a `landmarks` object")
    faults = []
    extra = sorted(k for k in data if k not in FILE_KEYS)
    if extra:
        faults.append("unknown keys: " + ", ".join(extra))
    if data.get("units") != "meters":
        faults.append("units must be \"meters\", not %r" % (data.get("units"),))
    if data.get("up") not in ("+Y", "+Z"):
        faults.append("up must be \"+Y\" (glTF frame, front +Z) or \"+Z\" (front -Y), not %r" % (data.get("up"),))
    if not (isinstance(data.get("source"), str) and data["source"].strip()):
        faults.append("source must say what placed the joints")
    marks = data["landmarks"]
    unknown = sorted(k for k in marks if k not in ALL)
    if unknown:
        faults.append("not landmarks: " + ", ".join(unknown))
    missing = [k for k in CORE if k not in marks]
    if missing:
        faults.append("landmarks missing: " + ", ".join(missing))
    for name, value in marks.items():
        ok = isinstance(value, (list, tuple)) and len(value) == 3 and all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in value)
        if not ok:
            faults.append("landmark %s must be [x, y, z]" % name)
    whole = set(finger_chains(marks))
    partial = sorted({"%s.%s" % (finger_of(k)[0], split(k)[1]) for k in marks if finger_of(k)
                      and (finger_of(k)[0], split(k)[1]) not in whole})
    if partial:
        faults.append("finger chains need joints 1, 2 and 3: " + ", ".join(partial))
    if faults:
        raise LandmarkError("; ".join(faults))
    return data


def read(path):
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except ValueError as e:
            raise LandmarkError("%s is not JSON: %s" % (path, e))
    return validate(data)


def to_working(data):
    """{landmark: (x, y, z)} of a validated file in the working frame."""
    if data["up"] == "+Z":
        return {name: (float(x), float(y), float(z)) for name, (x, y, z) in data["landmarks"].items()}
    return {name: (float(x), -float(z), float(y)) for name, (x, y, z) in data["landmarks"].items()}


def from_working(points, source, up="+Y", digits=5):
    """A landmark file from working-frame points."""
    if up not in ("+Y", "+Z"):
        raise LandmarkError("up must be \"+Y\" or \"+Z\"")
    def out(p):
        x, y, z = p
        vec = (x, y, z) if up == "+Z" else (x, z, -y)
        return [round(float(v), digits) + 0.0 for v in vec]
    ordered = [name for name in ALL if name in points]
    return {"units": "meters", "up": up, "landmarks": {name: out(points[name]) for name in ordered}, "source": source}


def gltf_to_working(p):
    """A glTF-frame position (Y up, front +Z) in the working frame."""
    return (float(p[0]), -float(p[2]), float(p[1]))


# ---- bone-name tables ----------------------------------------------------------------------------------------------

def load_table(data):
    """{bone name: landmark} from a table file, a provider descriptor (`rig.landmarks`) or a skeleton profile (`bones`,
    which runs the other way and is inverted)."""
    if not isinstance(data, dict):
        raise LandmarkError("a bone-name table is a JSON object")
    if isinstance(data.get("bones"), dict):
        table = {bone: landmark for landmark, bone in data["bones"].items()}
        if len(table) != len(data["bones"]):
            raise LandmarkError("the profile names one bone for several landmarks")
    elif isinstance(data.get("rig"), dict) and isinstance(data["rig"].get("landmarks"), dict):
        table = dict(data["rig"]["landmarks"])
    elif isinstance(data.get("landmarks"), dict):
        table = dict(data["landmarks"])
    else:
        raise LandmarkError("no table found: expected `landmarks` (bone name -> landmark), `rig.landmarks`, or a profile's `bones`")
    wrong = sorted("%s -> %r" % (bone, landmark) for bone, landmark in table.items() if landmark not in ALL)
    if wrong:
        raise LandmarkError("the table names landmarks outside the vocabulary: " + ", ".join(wrong))
    return table


def map_bones(bones, table, strip_prefix=None):
    """Place landmarks on a rig's joints.

    bones: {bone name: position}; table: {bone name: landmark}. Several bone names may stand for one landmark (spellings
    of different exporters); a rig that has two of them is ambiguous. Returns (points, unmapped bone names, missing
    core landmarks)."""
    points, used, clashes = {}, {}, []
    for name, position in bones.items():
        key = name[len(strip_prefix):] if strip_prefix and name.startswith(strip_prefix) else name
        landmark = table.get(key)
        if landmark is None:
            continue
        if landmark in used:
            clashes.append("%s (%s and %s)" % (landmark, used[landmark], name))
            continue
        used[landmark] = name
        points[landmark] = tuple(float(v) for v in position)
    if clashes:
        raise LandmarkError("more than one bone of this rig maps to: " + ", ".join(clashes))
    unmapped = [name for name in bones if name not in used.values()]
    return points, unmapped, [name for name in CORE if name not in points]


def derive_missing(points):
    """Fill spine, chest and shoulders that a source lacks, from the joints around them. Returns (points, derived names).

    A rig with one spine bone or no collarbones still has hips, neck and arms; these three sit at measured shares between
    them. Nothing else is derivable from joints alone."""
    points = dict(points)
    derived = []
    def lerp(a, b, t):
        return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
    if "hips" in points and "neck" in points:
        hips, neck = points["hips"], points["neck"]
        if "spine" not in points:
            top = points.get("chest")
            points["spine"] = lerp(hips, top, SPINE_SHARE / CHEST_SHARE) if top else lerp(hips, neck, SPINE_SHARE)
            derived.append("spine")
        if "chest" not in points:
            low = points["spine"]
            points["chest"] = lerp(low, neck, (CHEST_SHARE - SPINE_SHARE) / (1 - SPINE_SHARE)) if "spine" not in derived else lerp(hips, neck, CHEST_SHARE)
            derived.append("chest")
    for side in SIDES:
        name, arm = "shoulder." + side, points.get("upper-arm." + side)
        if name not in points and arm and "chest" in points:
            mid = points["chest"]
            points[name] = (mid[0] + (arm[0] - mid[0]) * SHOULDER_SHARE, mid[1] + (arm[1] - mid[1]) * SHOULDER_SHARE, arm[2])
            derived.append(name)
    return points, derived


# ---- sanity checks -------------------------------------------------------------------------------------------------

def _dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def check(points, bounds=None):
    """Findings about working-frame landmarks: [{"level": "error" | "warning", "code", "message"}].

    Errors mean the landmarks cannot be this character's joints (sides swapped, joints out of order, outside the mesh).
    Warnings are worth a look (asymmetry, facing). bounds: ((xmin, ymin, zmin), (xmax, ymax, zmax)) of the mesh."""
    found = []
    def add(level, code, message):
        found.append({"level": level, "code": code, "message": message})
    if bounds:
        height = bounds[1][2] - bounds[0][2]
    else:
        height = points["head"][2] - min(points["foot.l"][2], points["foot.r"][2])
    if height <= 0:
        add("error", "upside-down", "the head is not above the feet: check the file's `up` axis")
        return found
    tol = 0.05 * height
    mid = points["hips"][0]

    swapped = [j for j in SIDED if points[j + ".l"][0] <= points[j + ".r"][0]]
    if swapped:
        add("error", "sides", "left joints are not on +X of right joints for %s: the model faces backward, or the "
            "bone-name table swaps sides" % ", ".join(swapped))
    order = [name for a, name in zip(CENTRE, CENTRE[1:]) if points[name][2] <= points[a][2]]
    if order:
        add("error", "spine-order", "hips, spine, chest, neck, head must rise in that order; out of order at " + ", ".join(order))
    for side in SIDES:
        leg = [points[j + "." + side][2] for j in ("upper-leg", "lower-leg", "foot")]
        if not leg[0] > leg[1] > leg[2]:
            add("error", "leg-order", "hip, knee, ankle of the %s leg must descend" % side)
        if points["toes." + side][2] > points["foot." + side][2] + 0.5 * tol:
            add("error", "leg-order", "the %s toes are above the ankle" % side)
        chain = [points[j + "." + side] for j in ("shoulder", "upper-arm", "lower-arm", "hand")]
        reach = [_dist(chain[0], p) for p in chain[1:]]
        if not reach[0] < reach[1] < reach[2]:
            add("error", "arm-order", "arm joints of the %s arm must lead away from the shoulder: shoulder, upper arm, elbow, wrist" % side)
        for finger, s in finger_chains(points):
            if s != side:
                continue
            hand = points["hand." + side]
            joints = [points["%s-%d.%s" % (finger, k, side)] for k in (1, 2, 3)]
            away = [_dist(hand, p) for p in joints]
            if not away[0] < away[1] < away[2]:
                add("error", "finger-order", "joints of %s.%s must lead away from the wrist" % (finger, side))
    for name in ALL:
        child = main_child(name)
        if name in points and child in points and _dist(points[name], points[child]) < 0.004 * height:
            add("error", "zero-length", "%s and %s are at the same place" % (name, child))

    lopsided = []
    for joint in SIDED:
        left, right = points[joint + ".l"], points[joint + ".r"]
        if abs((left[0] - mid) + (right[0] - mid)) > tol or abs(left[2] - right[2]) > tol or abs(left[1] - right[1]) > tol:
            lopsided.append(joint)
    if lopsided:
        add("warning", "asymmetric", "left and right differ by more than 5%% of the height at %s: expected for an asymmetric "
            "pose, otherwise a misplaced joint" % ", ".join(lopsided))
    centred = [name for name in CENTRE if abs(points[name][0] - mid) > tol]
    if centred:
        add("warning", "off-centre", "%s are off the body's midline" % ", ".join(centred))
    for joint in ("upper-arm", "lower-arm", "upper-leg", "lower-leg"):
        lengths = [_dist(points[on_side(joint, s)], points[main_child(on_side(joint, s))]) for s in SIDES]
        if min(lengths) > 0 and max(lengths) / min(lengths) > 1.2:
            add("warning", "length", "the %s bones differ in length by %d%%" % (joint, round((max(lengths) / min(lengths) - 1) * 100)))
    backward = [s for s in SIDES if points["toes." + s][1] > points["foot." + s][1]]
    if len(backward) == 2:
        add("warning", "facing", "the toes are behind the ankles: the model may face backward (front is +Z with up +Y, -Y with up +Z)")

    if bounds:
        lo, hi = bounds
        pad = 0.02 * height
        outside = [name for name in ALL if name in points
                   and any(points[name][i] < lo[i] - pad or points[name][i] > hi[i] + pad for i in range(3))]
        if outside:
            add("error", "outside-bounds", "outside the mesh's bounding box: %s. The landmarks belong to another mesh, or to this "
                "one at another size or place" % ", ".join(outside))
        hips = (points["hips"][2] - lo[2]) / height
        if not 0.35 <= hips <= 0.7:
            add("warning", "proportion", "the hips sit at %d%% of the mesh's height (usual: 45 to 60%%)" % round(hips * 100))
        feet = max(points["foot.l"][2], points["foot.r"][2]) - lo[2]
        if feet > 0.15 * height:
            add("warning", "proportion", "the ankles are %d%% of the height above the mesh's lowest point" % round(feet / height * 100))
        if hi[2] - points["head"][2] > 0.3 * height:
            add("warning", "proportion", "the head joint is %d%% of the height below the top of the mesh" % round((hi[2] - points["head"][2]) / height * 100))
    return found


def errors(findings):
    return [f["message"] for f in findings if f["level"] == "error"]
