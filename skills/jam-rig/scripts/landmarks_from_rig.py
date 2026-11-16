#!/usr/bin/env python3
"""Write a landmark file from the skeleton of a rigged glTF model, mapping its bone names through a table.

    python landmarks_from_rig.py <rigged.glb | rigged.gltf> <out landmarks.json> --map <table.json>
                                 [--profile-id <id>] [--strip-prefix <text>] [--derive] [--source <text>]

--map is a bone-name table: {"landmarks": {"<bone name>": "<landmark>", ...}} (assets/landmark-maps/), a provider
descriptor with `rig.landmarks`, or a skeleton profile (its `bones` table is read backwards; --profile-id picks one from a
file that holds several under `skeletons`). --strip-prefix drops a namespace an exporter put in front of every bone name.
--derive fills spine, chest and shoulders a rig lacks, from the joints around them.

Joints are the file's first skin; a file without a skin (markers or a bare skeleton a person placed) gives the nodes the
table names. They are read where the nodes stand, in the file's own frame (glTF: metres, +Y up, front +Z), so the
landmark file is written with "up": "+Y". Prints one JSON object: mapped, unmapped bones, missing and derived landmarks, the mesh's
bounds and the sanity findings (references/landmarks.md). Exits 1, writing nothing, when a core landmark is missing or a
finding is an error. Plain Python with numpy; no DCC needed.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jamrig import gltf, landmarks as lm, report, skeleton  # noqa: E402


def build(args):
    with open(args.map, encoding="utf-8") as f:
        table_doc = json.load(f)
    if args.profile_id or ("bones" not in table_doc and "landmarks" not in table_doc and "rig" not in table_doc):
        table_doc = skeleton.load_profile(table_doc, args.profile_id)
    table = lm.load_table(table_doc)
    model = gltf.Gltf(args.model)
    skinned = bool(model.json.get("skins"))
    joints = model.skin_joints(0) if skinned else [j for j in model.named_nodes() if j[0] in table or (args.strip_prefix and j[0].startswith(args.strip_prefix))]
    bones = {name: position for name, _, position in joints}
    if len(bones) != len(joints):
        raise lm.LandmarkError("this file has several joints with one name; landmarks cannot be told apart")
    placed, unmapped, missing = lm.map_bones(bones, table, args.strip_prefix)
    points = {name: lm.gltf_to_working(p) for name, p in placed.items()}
    derived = []
    if args.derive:
        points, derived = lm.derive_missing(points)
        missing = [name for name in lm.CORE if name not in points]
    out = {"model": report.stamp("rig", args.model), "map": report.stamp("map", args.map), "joints": "skin" if skinned else "named nodes", "bones": len(joints),
           "mapped": len(placed), "unmapped": unmapped, "missing": missing, "derived": derived, "landmarks": None, "findings": []}
    spread = model.bind_spread(0)
    bounds = model.mesh_bounds()
    if bounds:
        lo, hi = lm.gltf_to_working(bounds[0]), lm.gltf_to_working(bounds[1])
        bounds = (tuple(min(a, b) for a, b in zip(lo, hi)), tuple(max(a, b) for a, b in zip(lo, hi)))
        out["meshBounds"] = {"min": report.rounded(bounds[0]), "max": report.rounded(bounds[1]), "frame": "Z up, front -Y"}
        out["heightMeters"] = round(bounds[1][2] - bounds[0][2], 4)
        if spread is not None and spread > 0.01 * (bounds[1][2] - bounds[0][2]):
            out["findings"].append({"level": "warning", "code": "posed", "message": "the file's nodes are posed away from its bind pose; "
                                    "the landmarks follow the nodes and may not sit in the mesh as stored"})
    if missing:
        hint = "" if args.derive else " (spine, chest and shoulders can be filled with --derive)"
        raise lm.LandmarkError("no bone mapped to: %s%s. Bones the table does not name: %s"
                               % (", ".join(missing), hint, ", ".join(unmapped) or "none"))
    whole = set(lm.finger_chains(points))
    partial = [name for name in lm.FINGERS if name in points and (lm.finger_of(name)[0], lm.split(name)[1]) not in whole]
    for name in partial:
        del points[name]
    if partial:
        out["findings"].append({"level": "warning", "code": "partial-finger", "message": "left out finger joints whose chain is incomplete: " + ", ".join(partial)})
    out["findings"] += lm.check(points, bounds)
    out["fingers"] = ["%s.%s" % chain for chain in lm.finger_chains(points)]
    source = args.source or "skeleton of %s through %s" % (os.path.basename(args.model), os.path.basename(args.map))
    if derived:
        source += "; derived: " + ", ".join(derived)
    data = lm.validate(lm.from_working(points, source, "+Y"))
    failed = lm.errors(out["findings"])
    if not failed:
        report.write(args.out, data)
        out["landmarks"] = args.out.replace(os.sep, "/")
    return out, failed


def main(argv=None):
    p = argparse.ArgumentParser(prog="landmarks_from_rig.py", description=__doc__.split("\n\n")[0])
    p.add_argument("model"); p.add_argument("out")
    p.add_argument("--map", required=True)
    p.add_argument("--profile-id"); p.add_argument("--strip-prefix"); p.add_argument("--source")
    p.add_argument("--derive", action="store_true")
    args = p.parse_args(argv)
    try:
        out, failed = build(args)
    except (lm.LandmarkError, skeleton.ProfileError, gltf.GltfError, OSError, ValueError) as e:
        print("error: %s" % e, file=sys.stderr)
        return 1
    print(json.dumps(out, indent=1))
    if failed:
        print("error: the landmarks failed their checks and were not written:\n  " + "\n  ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
