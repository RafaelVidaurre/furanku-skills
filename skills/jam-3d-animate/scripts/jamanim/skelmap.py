"""Skeleton maps: which bone of a rig stands at which landmark. Three shapes are read as a map:

    a landmark map         {"label": "...", "notes": "...", "landmarks": {"<bone name>": "<landmark>", ...}}
    a provider descriptor  {..., "rig": {"landmarks": {"<bone name>": "<landmark>", ...}}}
    a skeleton profile     {..., "bones": {"<landmark>": "<bone name>", ...}}      (read the other way round)

Several bone names may map to one landmark as alternative spellings, as long as a single rig has only one of them.
Landmarks are the shared humanoid vocabulary (the trunk, arms, legs and three joints per finger, sided `.l`/`.r`).
"""
import json

NEEDED = ("hips", "foot.l", "foot.r")
CONTACT_POINTS = {"foot.l": ("foot.l", "toes.l"), "foot.r": ("foot.r", "toes.r"), "hand.l": ("hand.l",), "hand.r": ("hand.r",)}
TRUNK = ("hips", "spine", "chest", "neck", "head")
SIDED = ("shoulder", "upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot", "toes")
FINGERS = ("thumb", "index", "middle", "ring", "pinky")
VOCABULARY = frozenset(TRUNK + tuple("%s.%s" % (n, s) for n in SIDED for s in "lr")
                       + tuple("%s-%d.%s" % (f, j, s) for f in FINGERS for j in (1, 2, 3) for s in "lr"))


class MapError(ValueError):
    pass


def table(doc, where="the map"):
    """{bone name: landmark} from any of the three shapes; raises MapError for anything else."""
    if not isinstance(doc, dict):
        raise MapError("%s is not a skeleton map: a JSON object is expected" % where)
    if isinstance(doc.get("bones"), dict):
        out = {}
        for landmark, bone in doc["bones"].items():
            if not isinstance(bone, str):
                raise MapError("%s: the profile's bones map %s to something other than a bone name" % (where, landmark))
            out[bone] = landmark
    elif isinstance(doc.get("rig"), dict) and isinstance(doc["rig"].get("landmarks"), dict):
        out = dict(doc["rig"]["landmarks"])
    elif isinstance(doc.get("landmarks"), dict):
        out = dict(doc["landmarks"])
    else:
        raise MapError('%s is not a skeleton map: expected "landmarks" (bone name -> landmark), a provider descriptor\'s '
                       '"rig.landmarks" or a skeleton profile\'s "bones"' % where)
    if not out:
        raise MapError("%s maps no bone" % where)
    wrong = sorted("%s -> %r" % (b, lm) for b, lm in out.items() if not isinstance(lm, str) or lm not in VOCABULARY)
    if wrong:
        raise MapError("%s names landmarks outside the vocabulary: %s" % (where, ", ".join(wrong[:10])))
    return out


def load(path):
    """{"landmarks": {bone name: landmark}} read from a map file of any of the three shapes."""
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except ValueError as e:
        raise MapError("%s is not JSON: %s" % (path, e))
    return {"landmarks": table(doc, path)}


def on_rig(doc, bone_names):
    """{landmark: bone} for the bones of this rig that the map names; raises MapError when two of the rig's bones
    claim one landmark or a needed landmark has no bone."""
    present = set(bone_names)
    at = {}
    for bone, landmark in doc["landmarks"].items():
        if bone not in present:
            continue
        if landmark in at:
            raise MapError("bones %s and %s both stand at %s on this rig" % (at[landmark], bone, landmark))
        at[landmark] = bone
    lacking = [n for n in NEEDED if n not in at]
    if lacking:
        raise MapError("no bone of this rig maps to %s; the map does not fit the rig (its bones: %s)"
                       % (", ".join(lacking), ", ".join(sorted(present)[:40])))
    return at


def contact_points(at, limbs):
    """[(limb, landmark, bone)] for every contact point of the given limbs that this rig has."""
    out = []
    for limb in limbs:
        for landmark in CONTACT_POINTS[limb]:
            if landmark in at:
                out.append((limb, landmark, at[landmark]))
    return out
