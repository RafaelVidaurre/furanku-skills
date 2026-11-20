#!/usr/bin/env python3
"""Retarget the animations of one humanoid skeleton onto another, each described by a landmark map.

    python retarget.py <source.glb> <source-map.json> <target.glb> <target-map.json> <out-dir>
                       [--animation <name>]... [--fps <n>] [--contacts auto|none|<contacts.json>]
                       [--contact-speed 0.1] [--contact-min-frames 3] [--contact-blend 3]
                       [--round-trip-tolerance 0.002] [--round-trip-degrees 1.0] [--keep-target-animations]
                       [--name retargeted]

The source is a .glb or .gltf holding a skeleton and one or more animations; the target is a rigged .glb. Both are in
glTF's frame (metres, +Y up, the character faces +Z), stand upright in their rest pose, and may rest in different
postures (an A-pose and a T-pose) and proportions. A map is {"landmarks": {"<bone name>": "<landmark>"}}, a provider
descriptor with `rig.landmarks`, or a skeleton profile.

Every animation of the source is retargeted (or those named with --animation), sampled on whole frames at the source's
frame rate, or at --fps. Contacts: `auto` finds windows where a source ankle or toes joint moves slower than
--contact-speed source heights per second for --contact-min-frames frames and holds the target's joint still there with
two-bone IK, blended in and out over --contact-blend frames; a contacts file names the windows instead (feet, toes or
hands; references/method.md, Contacts); `none` turns the correction off.

The round trip retargets the result back onto the source (without contact correction) and compares it with the source:
it passes when every joint both maps place returns within --round-trip-tolerance source heights and
--round-trip-degrees. Writes <name>.glb (the target file with the retargeted animations; its nodes, meshes and skin
copied unchanged) and retarget-report.json to <out-dir>. Exits 1, with the report written, when the round trip fails;
exits 2, writing nothing, when the inputs cannot be read as two humanoids. Plain Python with numpy.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamretarget  # noqa: E402
from jamretarget import gltf, measure, report, transfer  # noqa: E402
from jamretarget.skeleton import Skeleton, SkeletonError, load_map  # noqa: E402

CONTACT_JOINTS = ("foot.l", "foot.r", "toes.l", "toes.r", "hand.l", "hand.r")


def parse(argv):
    p = argparse.ArgumentParser(prog="retarget.py", description=__doc__.split("\n\n")[0])
    for name in ("source", "source_map", "target", "target_map", "out"):
        p.add_argument(name)
    p.add_argument("--animation", action="append", default=[])
    p.add_argument("--fps", type=float)
    p.add_argument("--contacts", default="auto")
    p.add_argument("--contact-speed", type=float, default=0.1)
    p.add_argument("--contact-min-frames", type=int, default=3)
    p.add_argument("--contact-blend", type=int, default=3)
    p.add_argument("--round-trip-tolerance", type=float, default=0.002)
    p.add_argument("--round-trip-degrees", type=float, default=1.0)
    p.add_argument("--keep-target-animations", action="store_true")
    p.add_argument("--name", default="retargeted")
    a = p.parse_args(argv)
    if a.fps is not None and a.fps <= 0:
        p.error("--fps must be positive")
    return a


def sig(x):
    """A number to three significant digits."""
    return float("%.3g" % float(x))


def read_contacts(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    items = data.get("contacts") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise SkeletonError("%s: a contacts file is {\"contacts\": [{\"joint\", \"start\", \"end\"}]}" % path)
    for c in items:
        if c.get("joint") not in CONTACT_JOINTS or not all(isinstance(c.get(k), (int, float)) for k in ("start", "end")) or c["end"] < c["start"]:
            raise SkeletonError("%s: each contact needs a joint (%s) and start <= end in seconds: %r" % (path, ", ".join(CONTACT_JOINTS), c))
    return items


def frame_times(anim, fps_wanted):
    keys = gltf.key_times(anim)
    source_fps = gltf.frame_rate(keys)
    fps = fps_wanted or source_fps
    if fps is None:
        raise SkeletonError("animation %r: its keys are not on one frame grid, so its frame rate is unknown; pass --fps" % anim["name"])
    count = int(np.floor((keys[-1] - keys[0]) * fps + 1e-3)) + 1
    return keys[0] + np.arange(count) / fps, fps, source_fps, float(keys[-1] - keys[0])


def not_carried(src, plan, anim, local_trs):
    """Joints whose motion the transfer leaves behind, by kind."""
    carried_rot = {src.at[k] for k in plan.shared} | ({src.root} if src.root is not None else set())
    carried_pos = {src.at["hips"]} | ({src.root} if src.root is not None else set())
    T, R, S = local_trs
    T0, R0, S0 = src.rest
    out = {"rotation": [], "translation": [], "scale": []}
    for node in sorted({c[0] for c in anim["channels"]}):
        if node not in src.joints and node not in src.at.values():
            continue                                         # a non-bone parent: its motion is in every joint's world transform
        name = src.model.name(node)
        if node not in carried_rot and not measure.unchanged(R[:, node], R0[node], "rotation", 0.5):
            out["rotation"].append(name)
        if node not in carried_pos and not measure.unchanged(T[:, node], T0[node], "translation", 1e-3 * src.height):
            out["translation"].append(name)
        if not measure.unchanged(S[:, node], S0[node], "scale", 1e-3):
            out["scale"].append(name)
    return {k: v for k, v in out.items() if v}


def contact_windows(args, src, plan, src_world, times, fps, anim_name, listed):
    if args.contacts == "none":
        return {}, "none"
    if listed is not None:
        wins = {}
        for c in listed:
            if c.get("animation") not in (None, anim_name):
                continue
            a = int(np.searchsorted(times, c["start"] - 1e-6)); b = int(np.searchsorted(times, c["end"] + 1e-6)) - 1
            if b >= a:
                wins.setdefault(c["joint"], []).append((a, min(b, len(times) - 1)))
        return wins, "file"
    wins = {}
    for k in ("foot.l", "foot.r", "toes.l", "toes.r"):
        if plan.src.has(k) and plan.tgt.has(k):
            found = transfer.detect(src_world[:, src.at[k], :3, 3], fps, args.contact_speed * src.height, args.contact_min_frames)
            if found:
                wins[k] = found
    return wins, "detected"


def retarget_one(args, src, tgt, plan, back, anim, listed, warnings):
    times, fps, source_fps, source_duration = frame_times(anim, args.fps)
    local_trs, _ = gltf.sample_locals(src.model, anim, times, src.rest)
    src_world = transfer.world_of(src, local_trs)
    F = len(times)
    rot, pos = transfer.desired(plan, src_world)
    local, world = transfer.solve(tgt, rot, pos, F)
    plain_world = world
    windows, contact_source = contact_windows(args, src, plan, src_world, times, fps, anim["name"], listed)
    details = []
    if windows:
        local, world, rot, details = transfer.plant(plan, src_world, rot, pos, windows, F, args.contact_blend)
    # round trip: the plain transfer, back onto the source
    back_rot, back_pos = transfer.desired(back, plain_world)
    _, round_world = transfer.solve(src, back_rot, back_pos, F)
    rt = measure.pose_error(src, plan.shared, src_world, round_world)
    rt_passed = rt["maxHeights"] <= args.round_trip_tolerance and rt["maxDegrees"] <= args.round_trip_degrees
    missing = not_carried(src, plan, anim, local_trs)
    for kind, names in missing.items():
        warnings.append("%s: the source animates the %s of %s; that motion is not carried (only rotations of landmarks both "
                        "maps place, and the hips' and root's translation, are)" % (anim["name"], kind, ", ".join(names)))
    entry = {"name": anim["name"], "sourceFps": source_fps, "fps": fps, "resampled": args.fps is not None and args.fps != source_fps,
             "frames": F, "sourceDurationSeconds": round(source_duration, 6), "durationSeconds": round(float(times[-1] - times[0]), 6),
             "startSeconds": round(float(times[0]), 6),
             "hipsTravel": {"source": measure.travel(src_world[:, src.at["hips"], :3, 3]),
                            "target": measure.travel(world[:, tgt.at["hips"], :3, 3])},
             "agreement": {"transfer": measure.segment_agreement(plan, src_world, plain_world),
                           "final": measure.segment_agreement(plan, src_world, world)},
             "sideFlips": measure.side_flips(plan, src_world, world),
             "contactSource": contact_source,
             "contacts": [dict(d, seconds=[round(float(times[d["frames"][0]]), 4), round(float(times[d["frames"][1]]), 4)]) for d in details],
             "roundTrip": {"maxMeters": sig(rt["maxMeters"]), "meanMeters": sig(rt["meanMeters"]),
                           "maxHeights": sig(rt["maxHeights"]), "maxDegrees": sig(rt["maxDegrees"]), "worst": rt["worst"],
                           "toleranceHeights": args.round_trip_tolerance, "toleranceDegrees": args.round_trip_degrees, "passed": rt_passed},
             "notCarried": missing}
    if abs(entry["durationSeconds"] - source_duration) > 0.5 / fps:
        warnings.append("%s: %.4f s at %g fps is not a whole number of frames; the clip ends at %.4f s"
                        % (anim["name"], source_duration, fps, entry["durationSeconds"]))
    flips = {k: n for k, n in entry["sideFlips"].items() if n}
    if flips:
        warnings.append("%s: on some frames a limb is on the other side of the body than on the source: %s"
                        % (anim["name"], ", ".join("%s %d frames" % kv for kv in flips.items())))
    return entry, {"name": anim["name"], "times": times, "channels": transfer.channels(tgt, local, rot, pos)}, world


def main(argv=None):
    args = parse(sys.argv[1:] if argv is None else argv)
    try:
        src = Skeleton(args.source, load_map(args.source_map), "source")
        tgt = Skeleton(args.target, load_map(args.target_map), "target")
        if not tgt.model.is_glb:
            raise SkeletonError("the target must be a .glb")
        anims = src.model.animations()
        if args.animation:
            unknown = [n for n in args.animation if n not in [a["name"] for a in anims]]
            if unknown:
                raise SkeletonError("the source has no animation named %s (it has: %s)" % (", ".join(unknown), ", ".join(a["name"] for a in anims) or "none"))
            anims = [a for a in anims if a["name"] in args.animation]
        if not anims:
            raise SkeletonError("%s holds no animation" % args.source)
        listed = None if args.contacts in ("auto", "none") else read_contacts(args.contacts)
    except (SkeletonError, gltf.GltfError, OSError) as e:
        print("error: %s" % e, file=sys.stderr)
        return 2
    plan, back = transfer.Plan(src, tgt), transfer.Plan(tgt, src)
    warnings = [f["message"] for f in src.findings + tgt.findings]
    entries, written, worlds = [], [], []
    for anim in anims:
        try:
            entry, out, world = retarget_one(args, src, tgt, plan, back, anim, listed, warnings)
        except SkeletonError as e:
            print("error: %s" % e, file=sys.stderr)
            return 2
        entries.append(entry); written.append(out); worlds.append(world)
    os.makedirs(args.out, exist_ok=True)
    model_path = os.path.join(args.out, args.name + ".glb")
    dropped = gltf.add_animations(args.target, model_path, written, keep_existing=args.keep_target_animations)
    # the written file, read back, must play what was computed
    check = Skeleton(model_path, {v: k for k, v in tgt.bone_of.items()}, "written")
    by_name = {a["name"]: a for a in check.model.animations()}
    for entry, out, world in zip(entries, written, worlds):
        trs, _ = gltf.sample_locals(check.model, by_name[entry["name"]], out["times"], check.rest)
        played = transfer.world_of(check, trs)
        nodes = list(tgt.at.values())
        entry["fileCheckMeters"] = sig(np.linalg.norm(played[:, nodes][..., :3, 3] - world[:, nodes][..., :3, 3], axis=2).max())
    file_ok = all(e["fileCheckMeters"] <= 1e-4 * tgt.height for e in entries)
    if not file_ok:
        warnings.append("the written file does not play back what was computed (see fileCheckMeters)")
    passed = file_ok and all(e["roundTrip"]["passed"] for e in entries)
    inputs = [report.stamp("source", args.source), report.stamp("source-map", args.source_map),
              report.stamp("target", args.target), report.stamp("target-map", args.target_map)]
    if listed is not None:
        inputs.append(report.stamp("contacts", args.contacts))
    doc = {"tool": "jam-3d-retarget retarget.py " + jamretarget.VERSION, "frame": "glTF: metres, +Y up, the character faces +Z",
           "passed": passed, "inputs": inputs, "outputs": [report.stamp("model", model_path)],
           "source": src.describe(), "target": tgt.describe(),
           "landmarks": {"transferred": plan.shared, "targetOnlyKeptAtRest": plan.target_only, "sourceOnlyNotCarried": plan.source_only},
           "restAlignment": plan.describe(),
           "hipsScale": {"factor": round(plan.k, 6), "rule": "target leg length / source leg length (hip to knee to ankle, both sides averaged)"},
           "root": {"source": src.describe()["root"], "target": tgt.describe()["root"],
                    "travelOn": "root and hips" if plan.with_root else "hips"},
           "options": {"fps": args.fps, "contacts": args.contacts, "contactSpeedHeightsPerSecond": args.contact_speed,
                       "contactMinFrames": args.contact_min_frames, "contactBlendFrames": args.contact_blend,
                       "keepTargetAnimations": args.keep_target_animations},
           "animations": entries, "droppedTargetAnimations": dropped, "warnings": warnings}
    report_path = os.path.join(args.out, "retarget-report.json")
    report.write(report_path, doc)
    print(json.dumps({"model": model_path.replace(os.sep, "/"), "report": report_path.replace(os.sep, "/"), "passed": passed,
                      "animations": [{"name": e["name"], "frames": e["frames"], "fps": e["fps"], "roundTripMaxHeights": e["roundTrip"]["maxHeights"],
                                      "contacts": len(e["contacts"])} for e in entries], "warnings": len(warnings)}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
