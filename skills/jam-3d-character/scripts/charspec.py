"""Character spec: everything the character scripts know about one body, read from its character.json.

Every script that needs a fact about the character (part names, height, colours, hands, texture sizes) takes
`--character <character.json>` among its arguments after `--` and reads it through this module; nothing about a
particular character is written into a script. The schema is documented in references/character-spec.md.

Works in Blender's Python and in plain Python 3.10+ (no Blender imports).
"""
import colorsys
import json
import os
import sys

PART_ROLES = ("head", "hair", "body", "hands")
CLASS_ROLES = ("skin", "hair", "neckline", "footwear")
REPAIRS = ("hairline", "skinDarkSpots")


class SpecError(ValueError):
    pass


VALUE_WEIGHT = 0.25   # brightness counts a quarter as much as hue and saturation: shading changes it most


def _chroma(rgb01):
    """(a, b, value): saturation and hue as a point on the colour wheel, plus brightness."""
    import math
    h, s, v = colorsys.rgb_to_hsv(*map(float, rgb01))
    return s * math.cos(h * 2 * math.pi), s * math.sin(h * 2 * math.pi), v


def colour_distance(rgb01, ref01):
    """Squared distance between two sRGB colours (0-1) that tolerates shading: the same colour in shadow or light stays
    close, while a dark shade of one colour stays far from a different dark colour."""
    a1, b1, v1 = _chroma(rgb01); a2, b2, v2 = _chroma(ref01)
    return (a1 - a2) ** 2 + (b1 - b2) ** 2 + VALUE_WEIGHT * (v1 - v2) ** 2


def _hsv_arrays(px):
    """Hue (degrees), saturation and value arrays of an ... x 3 sRGB 0-1 array, matching colorsys."""
    import numpy as np
    mx = px.max(axis=-1); mn = px.min(axis=-1); d = np.maximum(mx - mn, 1e-12)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-12), 0.0)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    h = np.where(mx - mn <= 0, 0.0, h)
    return h, s, mx


def _window_test(h, s, v, win):
    import numpy as np
    m = np.ones(np.shape(h), dtype=bool)
    if "hue" in win:
        a, b = win["hue"]
        m &= ((h >= a) & (h <= b)) if a <= b else ((h >= a) | (h <= b))
    if "saturation" in win:
        m &= (s >= win["saturation"][0]) & (s <= win["saturation"][1])
    if "value" in win:
        m &= (v >= win["value"][0]) & (v <= win["value"][1])
    return m


def _need(cond, msg):
    if not cond:
        raise SpecError(f"character.json: {msg}")


def _num(v, lo=None, hi=None):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and (lo is None or v >= lo) and (hi is None or v <= hi)


def _range(r, lo, hi):
    return isinstance(r, list) and len(r) == 2 and all(_num(x, lo, hi) for x in r)


class Character:
    def __init__(self, data, path=None):
        self.data, self.path = data, path
        _need(data.get("version") == 1, "version must be 1")
        name = data.get("name")
        _need(isinstance(name, str) and name[:1].isupper() and name.isidentifier(), "name must be PascalCase letters/digits, e.g. Ranger")
        self.name = name
        _need(_num(data.get("heightMeters"), 0.2, 4.0), "heightMeters must be a number between 0.2 and 4")
        self.height = float(data["heightMeters"])

        parts = data.get("parts")
        _need(isinstance(parts, dict) and set(parts) <= set(PART_ROLES), f"parts keys must be among {PART_ROLES}")
        _need(isinstance(parts.get("body"), str), "parts.body (the character mesh: body and clothing) is required")
        for role, obj in parts.items():
            _need(obj is None or (isinstance(obj, str) and obj), f"parts.{role} must be an object name or null")
        names = [o for o in parts.values() if o]
        _need(len(names) == len(set(names)), "parts must name distinct objects")
        self.parts = {role: parts.get(role) for role in PART_ROLES}

        classes = data.get("classes")
        _need(isinstance(classes, dict) and classes, "classes must name at least one surface class")
        for cname, c in classes.items():
            _need(isinstance(c, dict), f"classes.{cname} must be an object")
            _need(isinstance(c.get("rgb"), list) and len(c["rgb"]) == 3 and all(_num(x, 0, 255) for x in c["rgb"]), f"classes.{cname}.rgb must be [r, g, b] 0-255")
            _need(_num(c.get("roughness"), 0, 1), f"classes.{cname}.roughness must be 0-1")
            _need(c.get("part") in PART_ROLES and self.parts.get(c["part"]), f"classes.{cname}.part must be a present part role")
            _need("region" not in c, f"classes.{cname}.region was removed: anatomy (head, arms, legs, hands, feet) comes from the joints now, so classes describe materials only; delete the field")
            _need(_num(c.get("metallic", 0), 0, 1), f"classes.{cname}.metallic must be 0-1")
            hsv = c.get("hsv")
            if hsv is not None:
                _need(isinstance(hsv, dict) and set(hsv) <= {"hue", "saturation", "value"}, f"classes.{cname}.hsv keys are hue, saturation, value")
                _need("hue" not in hsv or _range(hsv["hue"], 0, 360), f"classes.{cname}.hsv.hue is [from, to] degrees (from > to wraps through 0)")
                for k in ("saturation", "value"):
                    _need(k not in hsv or _range(hsv[k], 0, 1), f"classes.{cname}.hsv.{k} is [min, max] in 0-1")
        self.classes = classes

        roles = data.get("roles", {})
        _need(isinstance(roles, dict) and set(roles) <= set(CLASS_ROLES), f"roles keys must be among {CLASS_ROLES}")
        for role, cname in roles.items():
            _need(cname is None or cname in classes, f"roles.{role} names unknown class {cname}")
        self.roles = {role: roles.get(role) for role in CLASS_ROLES}
        _need(self.parts["hair"] is None or self.roles["hair"], "parts.hair needs roles.hair (the class that finds it)")
        self.neck_height_share = data.get("neckHeightShare")
        _need(self.neck_height_share is None or _num(self.neck_height_share, 0.5, 0.99), "neckHeightShare must be between 0.5 and 0.99")
        _need(self.parts["head"] is None or self.roles["neckline"] or self.neck_height_share,
              "a separate head needs roles.neckline (the garment whose top border is the neck cut) or neckHeightShare")

        self.hair_min_height_share = float(data.get("hairMinHeightShare", 0.8))
        _need(0 < self.hair_min_height_share < 1, "hairMinHeightShare must be between 0 and 1")

        sizes = data.get("textureSizes", {})
        _need(isinstance(sizes, dict) and set(sizes) <= set(PART_ROLES), "textureSizes keys are part roles")
        for role, size in sizes.items():
            _need(isinstance(size, int) and size >= 64 and size & (size - 1) == 0, f"textureSizes.{role} must be a power of two >= 64")
        self.texture_sizes = {"head": 1024, "hair": 1024, "body": 2048, "hands": 1024, **sizes}

        self.max_influences = data.get("maxInfluences", 4)
        _need(isinstance(self.max_influences, int) and not isinstance(self.max_influences, bool) and 1 <= self.max_influences <= 8,
              "maxInfluences must be a whole number 1-8 (take it from the project profile's maxInfluences)")

        repair = data.get("repair", {})
        _need(isinstance(repair, dict) and set(repair) <= set(REPAIRS), f"repair keys are {REPAIRS}")
        for k, v in repair.items():
            _need(isinstance(v, bool), f"repair.{k} must be true or false")
        self.repair = {k: bool(repair.get(k, False)) for k in REPAIRS}
        _need(not self.repair["hairline"] or self.roles["hair"], "repair.hairline needs roles.hair (the class whose border is repaired)")
        _need(not self.repair["skinDarkSpots"] or self.roles["skin"], "repair.skinDarkSpots needs roles.skin")

        hands = data.get("hands", {})
        _need(isinstance(hands, dict), "hands must be an object")
        self.fingers = hands.get("fingers", 5)
        _need(self.fingers in (0, 5), "hands.fingers is 5 (separate fingers) or 0 (mittens, hand-only weights)")
        self.clean_side = hands.get("cleanSide", "none")
        _need(self.clean_side in ("left", "right", "none"), "hands.cleanSide is left, right or none")
        self.fan_degrees = {"pinky": -10.0, "ring": -4.0, "middle": 3.0, "index": 9.0, **hands.get("fanDegrees", {})}
        _need(all(_num(v, -45, 45) for v in self.fan_degrees.values()), "hands.fanDegrees values are degrees in -45..45")

    # ---- parts
    def part(self, role):
        """Object name for a part role, or None when the character has no such part."""
        return self.parts[role]

    def present_parts(self, roles=PART_ROLES):
        return [self.parts[r] for r in roles if self.parts[r]]

    def role_of_object(self, obj_name):
        return next((r for r, n in self.parts.items() if n == obj_name), None)

    # ---- scale
    def mm(self, model_height):
        """Model units per millimetre, for a model whose total height is model_height units."""
        return model_height / (self.height * 1000.0)

    # ---- classes
    def role_class(self, role):
        return self.roles[role]

    def classes_of_part(self, part_role):
        return [n for n, c in self.classes.items() if c["part"] == part_role]

    def rgb(self, cname):
        return tuple(self.classes[cname]["rgb"])

    def roughness(self, cname):
        return float(self.classes[cname]["roughness"])

    def metallic(self, cname):
        return float(self.classes[cname].get("metallic", 0.0))

    def candidates(self, part_role):
        """Classes that can appear on a part: its own classes, plus skin on the body and hands parts."""
        names = self.classes_of_part(part_role)
        skin = self.roles["skin"]
        if skin and skin not in names and part_role in ("body", "hands"):
            names.append(skin)
        return names

    # ---- colour classification: one rule, used by every script
    # A colour belongs to the first candidate class (in spec order) whose explicit `hsv` window holds it; a colour that
    # no window holds belongs to the candidate whose reference `rgb` is nearest (colour_distance). Every helper below
    # derives from that one rule, so masks, per-colour tests and per-face labels can never disagree.
    def classify(self, rgb01, candidates=None):
        """The class of one sRGB colour (0-1 floats) among candidates (default: every class)."""
        import numpy as np
        labels, names = self.label_map(np.array([[rgb01]], dtype=np.float64), candidates)
        return names[int(labels[0, 0])]

    def belongs(self, cname, rgb01, candidates=None):
        """True when the colour's class (see classify) is cname."""
        return self.classify(rgb01, candidates) == cname

    def label_map(self, px, candidates=None, dtype=None):
        """Class index per pixel of an H x W x 3 float array of sRGB 0-1 values, into the returned list of names.
        Same rule as classify(), vectorised (numpy)."""
        import numpy as np
        names = list(candidates or self.classes)
        px = np.asarray(px, dtype=dtype or (np.float64 if np.asarray(px).dtype == np.float64 else np.float32))[..., :3]
        hue, sat, val = _hsv_arrays(px)
        pa, pb = sat * np.cos(np.radians(hue)), sat * np.sin(np.radians(hue))
        ref = np.array([self.classes[n]["rgb"] for n in names], dtype=px.dtype) / 255.0
        rh, rs, rv = _hsv_arrays(ref)
        ra, rb = rs * np.cos(np.radians(rh)), rs * np.sin(np.radians(rh))
        d = (pa[..., None] - ra) ** 2 + (pb[..., None] - rb) ** 2 + VALUE_WEIGHT * (val[..., None] - rv) ** 2
        labels = d.argmin(axis=-1)
        decided = np.zeros(px.shape[:-1], dtype=bool)
        for i, n in enumerate(names):
            win = self.classes[n].get("hsv")
            if not win:
                continue
            m = _window_test(hue, sat, val, win) & ~decided
            labels[m] = i; decided |= m
        return labels, names

    def class_mask(self, px, cname, candidates=None):
        """Pixels whose class (see label_map) is cname."""
        labels, names = self.label_map(px, candidates)
        return labels == names.index(cname) if cname in names else labels < 0

    def window(self, cname):
        """The class's hsv window: its explicit `hsv` as written, or else a window around its reference colour
        (hue within 20 degrees, saturation and value within 0.25)."""
        c = self.classes[cname]
        if c.get("hsv"):
            return dict(c["hsv"])
        h, s, v = colorsys.rgb_to_hsv(*(x / 255.0 for x in c["rgb"]))
        return {"hue": [(h * 360 - 20) % 360, (h * 360 + 20) % 360],
                "saturation": [max(0.0, s - 0.25), min(1.0, s + 0.25)], "value": [max(0.0, v - 0.25), min(1.0, v + 0.25)]}

    def matches(self, cname, rgb01, derived=True):
        """True when an sRGB colour (0-1 floats) falls inside the class's window (see window()); with derived=False
        only an explicit `hsv` window counts."""
        win = self.window(cname) if derived else self.classes[cname].get("hsv")
        if not win:
            return False
        h, s, v = colorsys.rgb_to_hsv(*map(float, rgb01))
        h *= 360.0
        if "hue" in win:
            a, b = win["hue"]
            if not (a <= h <= b if a <= b else (h >= a or h <= b)):
                return False
        if "saturation" in win and not (win["saturation"][0] <= s <= win["saturation"][1]):
            return False
        if "value" in win and not (win["value"][0] <= v <= win["value"][1]):
            return False
        return True


def load(path):
    if not path or not os.path.isfile(path):
        raise SpecError(f"character spec not found: {path!r}; write one as references/character-spec.md describes")
    with open(path, encoding="utf-8") as f:
        return Character(json.load(f), path)


def split_args(argv=None):
    """Arguments after `--`, with `--character <path>` removed. Returns (positional args, Character or None)."""
    argv = list(sys.argv if argv is None else argv)
    args = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    spec = None
    if "--character" in args:
        i = args.index("--character")
        _need(i + 1 < len(args), "--character needs a path")
        spec = load(args[i + 1])
        del args[i:i + 2]
    return args, spec


def require(argv=None):
    """Like split_args, but the spec is mandatory."""
    args, spec = split_args(argv)
    if spec is None:
        raise SpecError("this script needs --character <character.json> after --")
    return args, spec


if __name__ == "__main__":  # validate: python3 charspec.py <character.json>
    c = load(sys.argv[1])
    print(json.dumps({"valid": True, "name": c.name, "heightMeters": c.height, "parts": c.parts, "roles": c.roles,
                      "maxInfluences": c.max_influences, "repair": c.repair}, indent=2))
