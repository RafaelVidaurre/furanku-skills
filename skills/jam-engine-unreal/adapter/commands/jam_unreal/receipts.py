"""Receipts in the engine adapter contract's JSON form, and the single line a command prints.

Receipts hold only the fields the toolkit's schema names; everything else an editor script reported goes to the
details file a command writes when asked with --details.
"""
import json
import sys

from .errors import AdapterError

ASSET_KINDS = ("static-mesh", "skeletal-mesh", "texture", "material", "material-instance", "sound-wave", "sound-source")


def asset(asset_id, kind, source=None, sha256=None):
    if kind not in ASSET_KINDS:
        raise AdapterError("invalid", "unknown asset kind %r" % kind)
    out = {"id": asset_id, "kind": kind}
    if source:
        out["source"] = source
    if sha256:
        out["sha256"] = sha256
    return out


def import_receipt(assets):
    seen = set()
    for a in assets:
        if a["id"] in seen:
            raise AdapterError("invalid", "import returned the asset %s twice" % a["id"])
        seen.add(a["id"])
    return {"assets": list(assets)}


def meters(vector, units_per_meter):
    return [round(float(v) / units_per_meter, 6) for v in vector]


def inspect_receipt(raw, units_per_meter):
    """An editor inspection (engine units) as the contract's receipt (meters). Absent facts stay absent."""
    out = {"id": raw["id"]}
    if raw.get("kind"):
        out["kind"] = raw["kind"]
    if raw.get("boundsMin") is not None and raw.get("boundsMax") is not None:
        out["bounds"] = {"min": meters(raw["boundsMin"], units_per_meter), "max": meters(raw["boundsMax"], units_per_meter)}
        out["pivot"] = [0.0, 0.0, 0.0]   # bounds are measured in the asset's own space, whose origin is its pivot
    for key in ("triangles", "vertices"):
        if isinstance(raw.get(key), int):
            out[key] = raw[key]
    if raw.get("materials") is not None:
        out["materials"] = [str(m) for m in raw["materials"]]
    if raw.get("bones"):
        out["skeleton"] = {"root": raw.get("rootBone") or raw["bones"][0], "bones": list(raw["bones"])}
    if raw.get("collision") is not None:
        kinds = sorted(k for k, n in raw["collision"].items() if n)
        out["collision"] = {"shapes": sum(raw["collision"].values()), "kinds": kinds}
    return out


def emit(receipt, stream=None):
    """Print the one JSON object a command returns."""
    (stream or sys.stdout).write(json.dumps(receipt, ensure_ascii=False) + "\n")


def note(text):
    """Words for a person; never on standard output, which carries the receipt alone."""
    sys.stderr.write(text.rstrip() + "\n")
