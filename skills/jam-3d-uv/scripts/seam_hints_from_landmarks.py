"""Write seam hints for a two-legged, two-armed figure from its landmark file (the joint positions jam-3d-rig uses).

python seam_hints_from_landmarks.py <landmarks.json> <hints.json>

The landmark file is the toolkit's (schemas/landmarks.schema.json): metres, `up` +Y or +Z, joints named hips, spine,
neck, head and per side upper-arm, lower-arm, hand, upper-leg, lower-leg, foot, toes. The hints put seams where a
garment has them: loops at the neck, waist, shoulders, wrists and ankles; the underside of each arm and down each side of the
torso; the seat and the inside of each leg; the back of the head; the outline between palm and back of each hand;
the sole of each foot. Pass the result to unwrap.py --seam-hints. Edit the file to drop or add cuts for a figure
these do not fit (a robe has no inseam). Exits 2 when a needed joint is missing.
"""
import json
import sys

NEEDED = ["hips", "spine", "neck", "head"] + [f"{joint}.{side}" for side in "lr" for joint in ("upper-arm", "lower-arm", "hand", "upper-leg", "lower-leg", "foot", "toes")]


def add(a, b): return [a[i] + b[i] for i in range(3)]
def sub(a, b): return [a[i] - b[i] for i in range(3)]
def mul(a, k): return [a[i] * k for i in range(3)]
def mid(a, b): return mul(add(a, b), 0.5)


def to_gltf(point, up):
    """Landmarks with +Z up face -Y (a DCC's axes); glTF is +Y up facing +Z."""
    x, y, z = point
    return [x, y, z] if up == "+Y" else [x, z, -y]


def hints_from(landmarks):
    up_axis = landmarks.get("up", "+Y")
    if up_axis not in ("+Y", "+Z"):
        raise ValueError(f"landmark files with up {up_axis} are not supported; use +Y or +Z")
    missing = [name for name in NEEDED if name not in landmarks.get("landmarks", {})]
    if missing:
        raise ValueError("the landmark file lacks: " + ", ".join(missing))
    j = {name: to_gltf(point, up_axis) for name, point in landmarks["landmarks"].items()}
    up, down, back = [0, 1, 0], [0, -1, 0], [0, 0, -1]
    waist = mid(j["hips"], j["spine"])
    crotch = add(mid(j["upper-leg.l"], j["upper-leg.r"]), mul(sub(j["hips"], j["spine"]), 0.5))
    crown = add(j["head"], mul(sub(j["head"], j["neck"]), 6.0))
    loops = [{"name": "neck", "at": j["neck"], "axis": sub(j["head"], j["neck"])},
             {"name": "waist", "at": waist, "axis": sub(j["spine"], j["hips"])}]
    paths = [{"name": "back-of-head", "from": crown, "to": {"at": j["neck"], "side": back}, "side": back},
             {"name": "seat", "from": {"at": crotch, "side": down}, "to": {"at": waist, "side": back}, "side": back}]
    sides = []
    for side, outward in (("l", [1, 0, 0]), ("r", [-1, 0, 0])):
        inward = mul(outward, -1)
        hand, forearm, arm = j[f"hand.{side}"], j[f"lower-arm.{side}"], j[f"upper-arm.{side}"]
        foot, shin, toes = j[f"foot.{side}"], j[f"lower-leg.{side}"], j[f"toes.{side}"]
        loops += [{"name": f"shoulder.{side}", "at": arm, "axis": sub(forearm, arm)},
                  {"name": f"wrist.{side}", "at": hand, "axis": sub(hand, forearm)},
                  {"name": f"ankle.{side}", "at": foot, "axis": sub(foot, shin)}]
        paths += [{"name": f"arm-underside.{side}", "from": {"at": hand, "side": down}, "via": [{"at": forearm, "side": down}], "to": {"at": arm, "side": down}, "side": down},
                  {"name": f"torso-side.{side}", "from": {"at": arm, "side": down}, "to": {"at": waist, "side": outward}, "side": outward},
                  {"name": f"inseam.{side}", "from": {"at": crotch, "side": down}, "via": [{"at": shin, "side": inward}], "to": {"at": foot, "side": inward}, "side": inward}]
        sides += [{"name": f"hand.{side}", "at": add(hand, mul(sub(hand, forearm), 0.4))},
                  {"name": f"sole.{side}", "at": mid(foot, toes), "axis": up, "threshold": -0.5}]
    rounded = lambda value: [round(v, 5) for v in value] if isinstance(value, list) else {k: rounded(v) if k in ("at", "side") else v for k, v in value.items()}
    for item in loops + paths + sides:
        for key in ("at", "axis", "side", "from", "to"):
            if key in item:
                item[key] = rounded(item[key])
        if "via" in item:
            item["via"] = [rounded(v) for v in item["via"]]
    return {"space": "gltf", "loops": loops, "paths": paths, "sides": sides}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: python seam_hints_from_landmarks.py <landmarks.json> <hints.json>", file=sys.stderr)
        return 2
    try:
        with open(argv[0]) as handle:
            hints = hints_from(json.load(handle))
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    with open(argv[1], "w") as handle:
        json.dump(hints, handle, indent=2)
    print(json.dumps({"written": argv[1], "loops": len(hints["loops"]), "paths": len(hints["paths"]), "sides": len(hints["sides"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
