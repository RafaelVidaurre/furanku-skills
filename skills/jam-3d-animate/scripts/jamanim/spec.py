"""Read a clip spec (clip.json). Its shape is the jam toolkit's `schemas/animation-clip.schema.json`; this reader
accepts exactly the specs that schema and the toolkit's own cross-field rules accept, so the scripts run the same with
the toolkit and without it. references/clip-spec.md describes the fields.

Paths in a spec are project-relative (forward slashes, no `.` or `..` segments) and are opened from the project root:
the current folder, which is where `jam python` and `jam blender` run every script.
"""
import json
import math
import numbers
import os
import re

ACCEPT_KEYS = ("footSlide", "penetration", "boundaryJump", "loopSeam")
LIMBS = ("foot.l", "foot.r", "hand.l", "hand.r")
TOP_KEYS = ("$schema", "id", "purpose", "rig", "fps", "length", "loop", "root", "ground", "keyPoses", "contacts", "accept")
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# The schema's patterns are JavaScript regular expressions; these match the same strings (whole string, JavaScript's
# `.` and `\s`).
_DOT = "[^\n\r  ]"
PORTABLE = re.compile(r"(?![A-Za-z]:)(?!/)(?!.*\\)(?!%s*(?:^|/)\.{0,2}(?:/|$))%s+" % (_DOT, _DOT))
_NOT_SPACE = re.compile("[^\t\n\x0b\x0c\r    -     　﻿]")


class SpecError(ValueError):
    def __init__(self, problems):
        self.problems = problems
        super().__init__("; ".join(problems))


def _num(v):
    return isinstance(v, numbers.Real) and not isinstance(v, bool) and math.isfinite(v)


def _positive(v):
    return _num(v) and v > 0


def _id(v):
    return isinstance(v, str) and len(v) <= 64 and ID.fullmatch(v) is not None


def _text(v):
    return isinstance(v, str) and _NOT_SPACE.search(v) is not None


def _unknown(problems, where, obj, known):
    for k in obj:
        if k not in known:
            problems.append("%s: unknown field %r (known: %s)" % (where, k, ", ".join(known)))


def _path(problems, field, value, root, check_files):
    if not isinstance(value, str) or not PORTABLE.fullmatch(value):
        problems.append("%s: a project-relative path with forward slashes is required (got %r)" % (field, value))
        return None
    path = os.path.join(root, value) if root else value
    if check_files and not os.path.isfile(path):
        problems.append("%s: no file at %s" % (field, value))
    return path


def normalize(doc, root=None, check_files=True, thresholds=True):
    """The spec with its paths joined to `root` (the project root; None: the current folder) and absent optional
    fields filled as None or empty; raises SpecError naming every problem. thresholds=False leaves `accept` unread (the
    clip check's --measure-only), so a spec without thresholds yet can be measured."""
    problems = []
    if not isinstance(doc, dict):
        raise SpecError(["clip.json must hold one JSON object"])
    _unknown(problems, "clip.json", doc, TOP_KEYS)
    out = {}
    if "$schema" in doc and not isinstance(doc["$schema"], str):
        problems.append("$schema: a string")
    if not _id(doc.get("id")):
        problems.append("id: lowercase letters, digits and single hyphens, at most 64 characters, is required")
    out["id"] = doc.get("id")
    if not _text(doc.get("purpose")):
        problems.append("purpose: one sentence saying what the clip is for is required")
    out["purpose"] = doc.get("purpose")

    rig = doc.get("rig")
    out["rig"] = None
    if not isinstance(rig, dict):
        problems.append('rig: {"model": "<project rig .glb>", "map": "<its skeleton map .json>"} is required')
    else:
        _unknown(problems, "rig", rig, ("model", "map"))
        out["rig"] = {k: _path(problems, "rig." + k, rig.get(k), root, check_files) for k in ("model", "map")}

    fps = doc.get("fps")
    if not _positive(fps):
        problems.append("fps: a positive number of frames per second is required")
    out["fps"] = fps

    length = doc.get("length")
    out["length"] = None
    if not isinstance(length, dict) or not _positive(length.get("min")) or not _positive(length.get("max")) or length["min"] > length["max"]:
        problems.append('length: {"min": <seconds>, "max": <seconds>} with 0 < min <= max is required (a fixed length has min equal to max)')
    else:
        _unknown(problems, "length", length, ("min", "max"))
        out["length"] = {"min": float(length["min"]), "max": float(length["max"])}

    if not isinstance(doc.get("loop"), bool):
        problems.append("loop: true or false is required")
    out["loop"] = doc.get("loop")

    root_ = doc.get("root")
    out["root"] = None
    if not isinstance(root_, dict) or root_.get("mode") not in ("in-place", "root-motion"):
        problems.append('root: {"mode": "in-place"} or {"mode": "root-motion"} (with "bone" when a ground-level root bone carries travel) is required')
    else:
        _unknown(problems, "root", root_, ("mode", "bone"))
        bone = root_.get("bone")
        if "bone" in root_ and (root_["mode"] != "root-motion" or not _text(bone)):
            problems.append("root.bone: a bone name, and only with root-motion")
        out["root"] = {"mode": root_["mode"], "bone": bone}

    ground = doc.get("ground")
    out["ground"] = None
    if isinstance(ground, dict) and ground.get("kind") == "flat":
        _unknown(problems, "ground", ground, ("kind",))
        out["ground"] = {"kind": "flat", "description": None}
    elif isinstance(ground, dict) and ground.get("kind") == "change" and _text(ground.get("description")):
        _unknown(problems, "ground", ground, ("kind", "description"))
        out["ground"] = {"kind": "change", "description": ground["description"]}
    else:
        problems.append('ground: {"kind": "flat"} or {"kind": "change", "description": "<the height change the clip crosses>"} is required')

    out["keyPoses"] = None
    if "keyPoses" in doc:
        kp = doc["keyPoses"]
        poses = kp.get("poses") if isinstance(kp, dict) else None
        if not isinstance(poses, list) or not poses or "file" not in kp:
            problems.append('keyPoses: {"file": "<keyposes.glb>", "poses": [{"name", "time"}, ...]} with at least one pose')
        else:
            _unknown(problems, "keyPoses", kp, ("file", "poses"))
            path = _path(problems, "keyPoses.file", kp["file"], root, False)
            good = []
            for i, p in enumerate(poses):
                if not isinstance(p, dict) or not _id(p.get("name")) or not _num(p.get("time")) or p["time"] < 0:
                    problems.append('keyPoses.poses[%d]: {"name": <lowercase id>, "time": <seconds >= 0>}' % i)
                    continue
                _unknown(problems, "keyPoses.poses[%d]" % i, p, ("name", "time"))
                good.append({"name": p["name"], "time": float(p["time"])})
            names = [p["name"] for p in good]
            if len(set(names)) != len(names):
                problems.append("keyPoses.poses: names must be unique")
            times = [p["time"] for p in good]
            if times != sorted(times):
                problems.append("keyPoses.poses: list the poses in time order")
            if out["length"] and times and max(times) > out["length"]["max"]:
                problems.append("keyPoses.poses: a pose at %.3f s is past the clip's length (length.max %.3f s)" % (max(times), out["length"]["max"]))
            out["keyPoses"] = {"file": path, "poses": good}

    out["contacts"] = {"detect": None, "planted": []}
    if "contacts" in doc:
        contacts = doc["contacts"]
        if not isinstance(contacts, dict):
            problems.append('contacts: {"detect": {"height", "speed"}, "planted": [...]}')
        else:
            _unknown(problems, "contacts", contacts, ("detect", "planted"))
            if "detect" in contacts:
                det = contacts["detect"]
                if not isinstance(det, dict) or not _positive(det.get("height")) or not _positive(det.get("speed")):
                    problems.append('contacts.detect: {"height": <metres>, "speed": <metres per second>}, both above 0')
                else:
                    _unknown(problems, "contacts.detect", det, ("height", "speed"))
                    out["contacts"]["detect"] = {"height": float(det["height"]), "speed": float(det["speed"])}
            planted = contacts.get("planted", [])
            if not isinstance(planted, list):
                problems.append("contacts.planted: a list of windows")
                planted = []
            for i, w in enumerate(planted):
                if (not isinstance(w, dict) or w.get("limb") not in LIMBS or not _num(w.get("from")) or not _num(w.get("to"))
                        or w["from"] < 0 or w["from"] > w["to"]):
                    problems.append('contacts.planted[%d]: {"limb": one of %s, "from": s, "to": s} with 0 <= from <= to' % (i, ", ".join(LIMBS)))
                else:
                    _unknown(problems, "contacts.planted[%d]" % i, w, ("limb", "from", "to"))
                    out["contacts"]["planted"].append({"limb": w["limb"], "from": float(w["from"]), "to": float(w["to"])})

    accept = doc.get("accept")
    out["accept"] = None
    if not thresholds:
        pass
    elif not isinstance(accept, dict):
        problems.append("accept: the thresholds the check enforces are required (%s)" % ", ".join(ACCEPT_KEYS))
    else:
        out["accept"] = {}
        _unknown(problems, "accept", accept, ACCEPT_KEYS)
        wanted = [k for k in ACCEPT_KEYS if k != "loopSeam" or doc.get("loop") is True]
        for k in wanted:
            v = accept.get(k)
            if not _positive(v):
                problems.append("accept.%s: metres above 0, from the project or the person, is required" % k)
            else:
                out["accept"][k] = float(v)
        if doc.get("loop") is not True and "loopSeam" in accept:
            problems.append("accept.loopSeam: only for a clip with loop true")
    if problems:
        raise SpecError(problems)
    return out


def _no_constants(name):
    raise ValueError("%s is not a JSON number" % name)


def load(path, root=None, check_files=True, thresholds=True):
    """Read and check the spec at `path`; its own paths are joined to `root` (None: the current folder). Infinity and
    NaN are not JSON and are refused."""
    with open(path, encoding="utf-8") as f:
        try:
            doc = json.load(f, parse_constant=_no_constants)
        except ValueError as e:
            raise SpecError(["%s is not JSON: %s" % (path, e)])
    return normalize(doc, root, check_files, thresholds)


def frame_of(seconds, fps):
    return int(round(seconds * fps))
