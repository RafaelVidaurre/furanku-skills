"""Skeleton maps: which bone of a rig stands at which landmark.

    {"label": "...", "notes": "...", "landmarks": {"<bone name>": "<landmark>", "Hips": "hips", ...}}

The same format the rigging skill and provider descriptors (`rig.landmarks`) use. Several bone names may map to one
landmark as alternative spellings, as long as a single rig has only one of them.
"""
import json

NEEDED = ("hips", "foot.l", "foot.r")
CONTACT_POINTS = {"foot.l": ("foot.l", "toes.l"), "foot.r": ("foot.r", "toes.r"), "hand.l": ("hand.l",), "hand.r": ("hand.r",)}


class MapError(ValueError):
    pass


def load(path):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    if not isinstance(doc, dict) or not isinstance(doc.get("landmarks"), dict) or not doc["landmarks"]:
        raise MapError('%s is not a skeleton map: {"label", "landmarks": {"<bone>": "<landmark>"}} expected' % path)
    bad = [b for b, lm in doc["landmarks"].items() if not isinstance(lm, str)]
    if bad:
        raise MapError("%s maps %s to something other than a landmark name" % (path, ", ".join(bad[:5])))
    return doc


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
