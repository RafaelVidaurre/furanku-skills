"""The clip spec (clip.json): what one animation clip must be, written with the person before any motion is made.

    {
      "id": "<clip id>", "purpose": "<what the clip is for>",
      "rig": {"model": "<project rig .glb>", "map": "<its skeleton map .json>"},
      "fps": <frames per second>, "length": <seconds> or {"min": <s>, "max": <s>}, "loop": true | false,
      "root": {"mode": "in-place"} or {"mode": "root-motion", "bone": "<root bone>"} (no bone: the hips carry travel),
      "ground": "flat" or {"description": "<the height change the clip crosses>"},
      "keyPoses": {"file": "keyposes.glb", "poses": [{"name": "<pose>", "time": <s>}, ...]},          (optional)
      "contacts": {"detect": {"height": <m>, "speed": <m/s>},                                        (optional)
                   "planted": [{"limb": "foot.l", "from": <s>, "to": <s>}, ...]},
      "accept": {"footSlide": <m>, "penetration": <m>, "boundaryJump": <m>, "loopSeam": <m, loops only>}
    }

Distances are metres and speeds metres per second, in the clip's glTF frame. `root` and `ground` may also be written
as the bare strings "in-place" / "root-motion" and "flat" / "<description>"; `keyPoses` as the bare list of poses (the
file then defaults to keyposes.glb beside clip.json). Every number under `accept` and `contacts.detect` comes from the
project or the person: nothing here supplies one.

Relative paths are looked up beside clip.json first, then from the current folder.
"""
import json
import numbers
import os

ACCEPT_KEYS = ("footSlide", "penetration", "boundaryJump", "loopSeam")
LIMBS = ("foot.l", "foot.r", "hand.l", "hand.r")
TOP_KEYS = ("$schema", "id", "purpose", "rig", "fps", "length", "loop", "root", "ground", "keyPoses", "contacts", "accept")


class SpecError(ValueError):
    def __init__(self, problems):
        self.problems = problems
        super().__init__("; ".join(problems))


def _num(v):
    return isinstance(v, numbers.Real) and not isinstance(v, bool)


def resolve_path(base_dir, path):
    """The first of <base_dir>/<path> and <cwd>/<path> that exists; the first when neither does."""
    if os.path.isabs(path):
        return path
    beside = os.path.normpath(os.path.join(base_dir, path))
    if os.path.exists(beside):
        return beside
    here = os.path.normpath(os.path.abspath(path))
    return here if os.path.exists(here) else beside


def normalize(doc, base_dir=".", check_files=True):
    """The spec in its one long form, with paths resolved; raises SpecError naming every problem."""
    problems = []
    if not isinstance(doc, dict):
        raise SpecError(["clip.json must hold one JSON object"])
    for k in doc:
        if k not in TOP_KEYS:
            problems.append("unknown field %r (known: %s)" % (k, ", ".join(TOP_KEYS[1:])))
    out = {}
    for k in ("id", "purpose"):
        if not isinstance(doc.get(k), str) or not doc[k].strip():
            problems.append("%s: a non-empty string is required" % k)
        out[k] = doc.get(k)

    rig = doc.get("rig")
    if not isinstance(rig, dict) or not isinstance(rig.get("model"), str) or not isinstance(rig.get("map"), str):
        problems.append('rig: {"model": "<project rig .glb>", "map": "<its skeleton map .json>"} is required')
        out["rig"] = None
    else:
        out["rig"] = {"model": resolve_path(base_dir, rig["model"]), "map": resolve_path(base_dir, rig["map"])}
        if check_files:
            for role in ("model", "map"):
                if not os.path.isfile(out["rig"][role]):
                    problems.append("rig.%s: no file at %s" % (role, rig[role]))

    fps = doc.get("fps")
    if not _num(fps) or fps <= 0:
        problems.append("fps: a positive number of frames per second is required")
    out["fps"] = fps

    length = doc.get("length")
    if _num(length) and length > 0:
        out["length"] = {"min": float(length), "max": float(length)}
    elif isinstance(length, dict) and _num(length.get("min")) and _num(length.get("max")) and 0 < length["min"] <= length["max"]:
        out["length"] = {"min": float(length["min"]), "max": float(length["max"])}
    else:
        problems.append('length: seconds (a positive number) or {"min": s, "max": s} with 0 < min <= max is required')
        out["length"] = None

    if not isinstance(doc.get("loop"), bool):
        problems.append("loop: true or false is required")
    out["loop"] = doc.get("loop")

    root = doc.get("root")
    if isinstance(root, str):
        root = {"mode": root}
    if not isinstance(root, dict) or root.get("mode") not in ("in-place", "root-motion"):
        problems.append('root: "in-place", "root-motion", or {"mode": "root-motion", "bone": "<root bone>"} is required')
        out["root"] = None
    else:
        bone = root.get("bone")
        if bone is not None and (root["mode"] != "root-motion" or not isinstance(bone, str) or not bone):
            problems.append("root.bone: a bone name, and only with root-motion")
        out["root"] = {"mode": root["mode"], "bone": bone}

    ground = doc.get("ground")
    if ground == "flat" or (isinstance(ground, dict) and ground.get("kind") == "flat"):
        out["ground"] = {"flat": True, "description": "flat"}
    elif isinstance(ground, str) and ground.strip():
        out["ground"] = {"flat": False, "description": ground}
    elif isinstance(ground, dict) and isinstance(ground.get("description"), str) and ground["description"].strip():
        out["ground"] = {"flat": False, "description": ground["description"]}
    else:
        problems.append('ground: "flat" or a description of the height change the clip crosses is required')
        out["ground"] = None

    kp = doc.get("keyPoses")
    out["keyPoses"] = None
    if kp is not None:
        if isinstance(kp, list):
            kp = {"file": "keyposes.glb", "poses": kp}
        poses = kp.get("poses") if isinstance(kp, dict) else None
        if not isinstance(poses, list) or not poses or not isinstance(kp.get("file"), str):
            problems.append('keyPoses: {"file": "keyposes.glb", "poses": [{"name", "time"}, ...]} with at least one pose')
        else:
            names = []
            for i, p in enumerate(poses):
                if not isinstance(p, dict) or not isinstance(p.get("name"), str) or not p["name"] or not _num(p.get("time")) or p["time"] < 0:
                    problems.append("keyPoses.poses[%d]: {\"name\": <non-empty>, \"time\": <seconds >= 0>}" % i)
                    continue
                names.append(p["name"])
            if len(set(names)) != len(names):
                problems.append("keyPoses.poses: names must be unique")
            times = [p["time"] for p in poses if isinstance(p, dict) and _num(p.get("time"))]
            if times != sorted(times):
                problems.append("keyPoses.poses: list the poses in time order")
            if out["length"] and times and max(times) > out["length"]["max"] + 1e-9:
                problems.append("keyPoses.poses: a pose at %.3f s is past the clip's length" % max(times))
            out["keyPoses"] = {"file": resolve_path(base_dir, kp["file"]), "poses": [dict(name=p["name"], time=float(p["time"])) for p in poses if isinstance(p, dict) and _num(p.get("time"))]}

    contacts = doc.get("contacts")
    out["contacts"] = {"detect": None, "planted": []}
    if contacts is not None:
        if not isinstance(contacts, dict):
            problems.append('contacts: {"detect": {"height", "speed"}, "planted": [...]}')
        else:
            det = contacts.get("detect")
            if det is not None:
                if not isinstance(det, dict) or not _num(det.get("height")) or not _num(det.get("speed")) or det["height"] < 0 or det["speed"] < 0:
                    problems.append("contacts.detect: {\"height\": metres above the planted height, \"speed\": metres per second}, both >= 0")
                else:
                    out["contacts"]["detect"] = {"height": float(det["height"]), "speed": float(det["speed"])}
            for i, w in enumerate(contacts.get("planted") or []):
                if not isinstance(w, dict) or w.get("limb") not in LIMBS or not _num(w.get("from")) or not _num(w.get("to")) or w["from"] > w["to"]:
                    problems.append("contacts.planted[%d]: {\"limb\": one of %s, \"from\": s, \"to\": s} with from <= to" % (i, ", ".join(LIMBS)))
                else:
                    out["contacts"]["planted"].append({"limb": w["limb"], "from": float(w["from"]), "to": float(w["to"])})

    accept = doc.get("accept")
    out["accept"] = {}
    if not isinstance(accept, dict):
        problems.append("accept: the thresholds the check enforces are required (%s)" % ", ".join(ACCEPT_KEYS))
    else:
        for k in accept:
            if k not in ACCEPT_KEYS:
                problems.append("accept: unknown threshold %r (known: %s)" % (k, ", ".join(ACCEPT_KEYS)))
        wanted = [k for k in ACCEPT_KEYS if k != "loopSeam" or doc.get("loop") is True]
        for k in wanted:
            v = accept.get(k)
            if not _num(v) or v < 0:
                problems.append("accept.%s: metres (a number >= 0) from the project or the person is required" % k)
            else:
                out["accept"][k] = float(v)
        if doc.get("loop") is False and "loopSeam" in accept:
            problems.append("accept.loopSeam: only for a clip with loop true")
    if problems:
        raise SpecError(problems)
    return out


def load(path, check_files=True):
    with open(path, encoding="utf-8") as f:
        try:
            doc = json.load(f)
        except ValueError as e:
            raise SpecError(["%s is not JSON: %s" % (path, e)])
    return normalize(doc, os.path.dirname(os.path.abspath(path)), check_files)


def frame_of(seconds, fps):
    return int(round(seconds * fps))
