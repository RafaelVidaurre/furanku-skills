#!/usr/bin/env python3
"""Retarget the animations of one humanoid skeleton onto another, each described by a landmark map.

    python retarget.py <source.glb> <source-map.json> <target.glb> <target-map.json> <out-dir>
                       --contacts auto|none|<contacts.json> [--contact-speed <source heights per second>]
                       [--contact-min-frames 1] [--contact-blend 3] [--animation <name>]... [--fps <n>]
                       [--translation none|scaled]
                       [--facing-degrees 10] [--agreement-degrees 1.0] [--side-flip-frames 0]
                       [--round-trip-tolerance 0.002] [--round-trip-degrees 1.0] [--keep-target-animations]
                       [--name retargeted]

The source is a .glb or .gltf holding a skeleton and one or more animations; the target is a rigged .glb or .gltf.
Both are in glTF's frame (metres, +Y up, the character faces +Z, within --facing-degrees), stand upright in their rest
pose, and may rest in different postures (an A-pose and a T-pose) and proportions. A map is {"landmarks": {"<bone
name>": "<landmark>"}}, a provider descriptor with `rig.landmarks`, or a skeleton profile.

Every animation of the source is retargeted (or those named with --animation), sampled on whole frames at the source's
frame rate, or at --fps. Contacts: `auto` finds windows where a source ankle or toes joint moves over the ground slower
than --contact-speed (required with auto) for at least --contact-min-frames frames and holds the target's joint in place
there with two-bone IK, blended in and out over --contact-blend frames; a contacts file names the windows instead (feet,
toes or hands); `none` turns the correction off. references/method.md, Contacts, gives the rules and the speed's unit.
Translations and scales of source bones other than the hips and root are not carried unless --translation scaled
(references/method.md, Translation).

Three checks decide `passed`, per animation: the transfer's arm and leg segments point where the source's do as the
transfer carries it, within --agreement-degrees (a correct map gives 0 to rounding); no hand or foot is on the other
side of the body than the source's on more than --side-flip-frames frames; and the round trip, the plain transfer
retargeted back onto the source as the transfer carries it, returns within --round-trip-tolerance source heights and
--round-trip-degrees (the transfer is invertible, so it fails only when the source moves bones the maps do not carry;
with --translation none the source's stretches are held at rest for both checks and reported under `stretch`). Writes <name>.glb (the target with the retargeted animations;
its scenes, meshes and skin copied unchanged, and buffers or images it keeps in other files embedded) and
retarget-report.json to <out-dir>. Exits 1, with both written, when a check fails; exits 2, writing nothing, when the
inputs cannot be read as two humanoids or an option is missing. Plain Python with numpy.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamretarget  # noqa: E402
from jamretarget import gltf, measure, report, transfer  # noqa: E402
from jamretarget.skeleton import FACING_DEGREES, Skeleton, SkeletonError, load_map  # noqa: E402

CONTACT_JOINTS = ("foot.l", "foot.r", "toes.l", "toes.r", "hand.l", "hand.r")
# Body parts whose segments a correct transfer matches exactly; the trunk and the feet keep their rests' own difference.
JUDGED = ("arms", "legs")
# What agreement and the round trip compare with, per --translation.
AGAINST = {"scaled": "the source",
           "none": "the source with its joints' translations and scales at rest, but the hips' and root's"}


def parse(argv):
    p = argparse.ArgumentParser(prog="retarget.py", description=__doc__.split("\n\n")[0])
    for name in ("source", "source_map", "target", "target_map", "out"):
        p.add_argument(name)
    p.add_argument("--animation", action="append", default=[])
    p.add_argument("--fps", type=float)
    p.add_argument("--translation", choices=transfer.TRANSLATION, default="none",
                   help="carry bone translations other than the hips' and root's, scaled by bone length (references/method.md, Translation)")
    p.add_argument("--contacts", required=True, help="auto, none, or a contacts file")
    p.add_argument("--contact-speed", type=float, help="speed over the ground in source heights per second; required with --contacts auto")
    p.add_argument("--contact-min-frames", type=int, default=1)
    p.add_argument("--contact-blend", type=int, default=3)
    p.add_argument("--facing-degrees", type=float, default=FACING_DEGREES,
                   help="how far a rest pose may be turned about +Y from facing +Z (references/method.md, Rest poses)")
    p.add_argument("--agreement-degrees", type=float, default=1.0)
    p.add_argument("--side-flip-frames", type=int, default=0)
    p.add_argument("--round-trip-tolerance", type=float, default=0.002)
    p.add_argument("--round-trip-degrees", type=float, default=1.0)
    p.add_argument("--keep-target-animations", action="store_true")
    p.add_argument("--name", default="retargeted")
    a = p.parse_args(argv)
    if a.fps is not None and a.fps <= 0:
        p.error("--fps must be positive")
    if a.contact_speed is not None and a.contact_speed <= 0:
        p.error("--contact-speed must be positive")
    if not 0 <= a.facing_degrees <= 90:
        p.error("--facing-degrees must be between 0 and 90")
    if a.contact_min_frames < 1:
        p.error("--contact-min-frames must be at least 1")
    return a


def speed_needed(src, tgt):
    """The refusal for `--contacts auto` without a speed, with this pair's conversion from metres per second."""
    k = tgt.leg_length / src.leg_length
    return ("--contacts auto needs --contact-speed: how slow a source ankle or toes joint must move over the ground to count "
            "as planted, in source heights per second; nothing here chooses it for you. The source is %.4g m tall and travel scales "
            "by k = %.4g onto the target, so a speed of v m/s on the source is v / %.4g, and v m/s on the target (such "
            "as a clip spec's contacts.detect.speed, when the target is the spec's rig) is v / %.4g. Or name the "
            "windows in a contacts file, or pass --contacts none" % (src.height, k, src.height, k * src.height))


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
    if plan.translation == "scaled":
        carried_pos |= plan.path_nodes()
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
    src_held = transfer.hold(src, src_world)
    F = len(times)
    rot, pos = transfer.desired(plan, src_world, src_held)
    local, world = transfer.solve(tgt, rot, pos, F)
    plain_world = world
    windows, contact_source = contact_windows(args, src, plan, src_world, times, fps, anim["name"], listed)
    details = []
    if windows:
        local, world, rot, details = transfer.plant(plan, src_world, rot, pos, windows, F, args.contact_blend)
    # What the transfer carries of the source: with --translation none, its stretches are held at rest (`stretch` reports
    # them), so agreement and the round trip measure only the maps.
    against = src_world if plan.translation == "scaled" else src_held
    # round trip: the plain transfer, back onto the source
    back_rot, back_pos = transfer.desired(back, plain_world, transfer.hold(tgt, plain_world))
    _, round_world = transfer.solve(src, back_rot, back_pos, F)
    rt = measure.pose_error(src, plan.shared, against, round_world)
    rt_passed = rt["maxHeights"] <= args.round_trip_tolerance and rt["maxDegrees"] <= args.round_trip_degrees
    missing = not_carried(src, plan, anim, local_trs)
    stretch = measure.stretch(plan, src_world, src_held)
    lost = {k: v for k, v in stretch.items() if not v["carried"]}
    named = {src.model.name(i) for i in plan.path_nodes(lost)}
    for kind, names in missing.items():
        names = [n for n in names if kind != "translation" or n not in named]       # those the stretch warning names
        if names:
            warnings.append("%s: the source animates the %s of %s; that motion is not carried (only rotations of landmarks both "
                            "maps place, and the hips' and root's translation, are)" % (anim["name"], kind, ", ".join(names)))
    if lost:
        worst = sorted(lost, key=lambda k: (-(lost[k]["maxDegrees"] if lost[k]["maxDegrees"] is not None else 180), -lost[k]["maxMeters"]))
        offsets = ", ".join("%s from %s %.0f mm and %s" % (
            k, lost[k]["from"], 1000 * lost[k]["maxMeters"], "no rest length to compare" if lost[k]["lengthRatio"] is None else
            "%.1f degrees (length x%.2f to %.2f)" % (lost[k]["maxDegrees"], *lost[k]["lengthRatio"])) for k in worst[:5])
        more = " and %d more" % (len(worst) - 5) if len(worst) > 5 else ""
        why = ("rotations alone keep the target's own bone lengths, so the target's segments differ from the source's by up to "
               "those angles; --translation scaled carries it" if plan.translation == "none" else
               "these landmarks' bones are not below the previous landmark's on both skeletons, so their offset cannot be carried")
        warnings.append("%s: the source's translations or scales move landmarks off where its rotations put them (a stretched or "
                        "sliding bone): %s%s; not carried: %s" % (anim["name"], offsets, more, why))
    agreement = {"transfer": measure.segment_agreement(plan, against, plain_world),
                 "final": measure.segment_agreement(plan, against, world), "judged": list(JUDGED),
                 "against": AGAINST[plan.translation], "toleranceDegrees": args.agreement_degrees}
    off = {g: v["maxDegrees"] for g, v in agreement["transfer"].items() if g in JUDGED and v["maxDegrees"] > args.agreement_degrees}
    agreement["passed"] = not off
    flips = measure.side_flips(plan, src_world, world)
    flips_passed = max(flips.values()) <= args.side_flip_frames
    entry = {"name": anim["name"], "sourceFps": source_fps, "fps": fps, "resampled": args.fps is not None and args.fps != source_fps,
             "frames": F, "sourceDurationSeconds": round(source_duration, 6), "durationSeconds": round(float(times[-1] - times[0]), 6),
             "startSeconds": round(float(times[0]), 6),
             "hipsTravel": {"source": measure.travel(src_world[:, src.at["hips"], :3, 3]),
                            "target": measure.travel(world[:, tgt.at["hips"], :3, 3])},
             "agreement": agreement,
             "sideFlips": flips, "sideFlipsAllowedFrames": args.side_flip_frames, "sideFlipsPassed": flips_passed,
             "contactSource": contact_source,
             "contacts": [dict(d, seconds=[round(float(times[d["frames"][0]]), 4), round(float(times[d["frames"][1]]), 4)]) for d in details],
             "roundTrip": {"against": AGAINST[plan.translation], "maxMeters": sig(rt["maxMeters"]), "meanMeters": sig(rt["meanMeters"]),
                           "maxHeights": sig(rt["maxHeights"]), "maxDegrees": sig(rt["maxDegrees"]), "worst": rt["worst"],
                           "toleranceHeights": args.round_trip_tolerance, "toleranceDegrees": args.round_trip_degrees, "passed": rt_passed},
             "stretch": stretch, "notCarried": missing, "passed": bool(agreement["passed"] and flips_passed and rt_passed)}
    if abs(entry["durationSeconds"] - source_duration) > 0.5 / fps:
        warnings.append("%s: %.4f s at %g fps is not a whole number of frames; the clip ends at %.4f s"
                        % (anim["name"], source_duration, fps, entry["durationSeconds"]))
    for g, deg in off.items():
        warnings.append("%s: the target's %s point up to %.1f degrees away from the source's (worst %s; tolerance %g): a map "
                        "places a landmark on a bone that does not stand at it, or bones between two landmarks turn"
                        % (anim["name"], g, deg, agreement["transfer"][g]["worst"], args.agreement_degrees))
    crossed = {k: n for k, n in flips.items() if n}
    if crossed:
        warnings.append("%s: on some frames a limb is on the other side of the body than on the source: %s"
                        % (anim["name"], ", ".join("%s %d frames" % kv for kv in crossed.items())))
    if not rt_passed:
        warnings.append("%s: the round trip lands %.3g source heights and %.3g degrees from the source (tolerance %g and %g)"
                        % (anim["name"], rt["maxHeights"], rt["maxDegrees"], args.round_trip_tolerance, args.round_trip_degrees))
    return entry, {"name": anim["name"], "times": times, "channels": transfer.channels(tgt, local, rot, pos)}, world


def main(argv=None):
    args = parse(sys.argv[1:] if argv is None else argv)
    try:
        src = Skeleton(args.source, load_map(args.source_map), "source", args.facing_degrees)
        tgt = Skeleton(args.target, load_map(args.target_map), "target", args.facing_degrees)
        gltf.check_embeddable(tgt.model)                    # what the written file embeds must be readable now
        anims = src.model.animations()
        if args.animation:
            unknown = [n for n in args.animation if n not in [a["name"] for a in anims]]
            if unknown:
                raise SkeletonError("the source has no animation named %s (it has: %s)" % (", ".join(unknown), ", ".join(a["name"] for a in anims) or "none"))
            anims = [a for a in anims if a["name"] in args.animation]
        if not anims:
            raise SkeletonError("%s holds no animation" % args.source)
        listed = None if args.contacts in ("auto", "none") else read_contacts(args.contacts)
        if args.contacts == "auto" and args.contact_speed is None:
            raise SkeletonError(speed_needed(src, tgt))
        plan, back = transfer.Plan(src, tgt, args.translation), transfer.Plan(tgt, src, args.translation)
    except (SkeletonError, gltf.GltfError, OSError) as e:
        print("error: %s" % e, file=sys.stderr)
        return 2
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
    written_file = gltf.add_animations(args.target, model_path, written, keep_existing=args.keep_target_animations)
    if written_file["removedBytes"] is None:
        warnings.append("the target's dropped animations stay in the written file as unreferenced data: it uses an extension "
                        "this writer does not renumber")
    # the written file, read back, must play what was computed
    check = Skeleton(model_path, {v: k for k, v in tgt.bone_of.items()}, "written", args.facing_degrees)
    by_name = {a["name"]: a for a in check.model.animations()}
    for entry, out, world in zip(entries, written, worlds):
        trs, _ = gltf.sample_locals(check.model, by_name[entry["name"]], out["times"], check.rest)
        played = transfer.world_of(check, trs)
        nodes = list(tgt.at.values())
        entry["fileCheckMeters"] = sig(np.linalg.norm(played[:, nodes][..., :3, 3] - world[:, nodes][..., :3, 3], axis=2).max())
    file_ok = all(e["fileCheckMeters"] <= 1e-4 * tgt.height for e in entries)
    if not file_ok:
        warnings.append("the written file does not play back what was computed (see fileCheckMeters)")
    passed = file_ok and all(e["passed"] for e in entries)
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
           "translation": {"mode": args.translation, "ratios": {k: {"from": o["from"], "ratio": round(o["ratio"], 6), "carriable": o["carriable"]}
                                                                for k, o in plan.offsets.items()}},
           "root": {"source": src.describe()["root"], "target": tgt.describe()["root"],
                    "travelOn": "root and hips" if plan.with_root else "hips"},
           "options": {"fps": args.fps, "translation": args.translation, "contacts": args.contacts, "contactSpeedHeightsPerSecond": args.contact_speed,
                       "contactMinFrames": args.contact_min_frames, "contactBlendFrames": args.contact_blend,
                       "facingDegrees": args.facing_degrees, "agreementDegrees": args.agreement_degrees, "sideFlipFrames": args.side_flip_frames,
                       "roundTripTolerance": args.round_trip_tolerance, "roundTripDegrees": args.round_trip_degrees,
                       "keepTargetAnimations": args.keep_target_animations},
           "animations": entries, "droppedTargetAnimations": written_file["dropped"],
           "droppedDataRemovedBytes": written_file["removedBytes"], "embedded": written_file["embedded"], "warnings": warnings}
    report_path = os.path.join(args.out, "retarget-report.json")
    report.write(report_path, doc)
    print(json.dumps({"model": model_path.replace(os.sep, "/"), "report": report_path.replace(os.sep, "/"), "passed": passed,
                      "animations": [{"name": e["name"], "passed": e["passed"], "frames": e["frames"], "fps": e["fps"],
                                      "contacts": len(e["contacts"])} for e in entries], "warnings": len(warnings)}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
