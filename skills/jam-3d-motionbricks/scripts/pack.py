"""Pack a MotionBricks request from poses on the SOMA rig. Runs in Blender, on the authoring side.

    blender --background --python-exit-code 1 --python pack.py -- <context.glb> <request.json>
            --skeleton <soma-skeleton.json> --floor-tolerance <metres>
            --target <target.glb> [--poses N] [--start S] [--early K] [--target-tokens A-B]  [--target ... ]
            [--context-end S] [--context-hold] [--tokens 8-14] [--precision fp32|fp16] [--tf32 auto|on|off]
            [--no-endpoint-correction] [--motionbricks-version 0.2.0] [--onnx-sha256 <hex>]
            [--model-name MotionBricks-SOMA-RP-v1] [--rest-tolerance 0.01]

Every .glb holds an armature with SOMA's joint names whose rest pose is SOMA's reference pose (the rig soma_skeleton.py
builds, or a file retargeted onto it), and one animation; all files share one world, glTF frame, metres.

context  the motion leading into the generation: the last four poses at 30 Hz ending at --context-end (seconds from
         the animation's start; default its end), so it needs four frames of animation up to that time. With
         --context-hold the context is instead the single pose at --context-end held still for four frames: a
         character at rest in that pose, read from any file (a key-pose file, a clip's first frame).
target   one generation each, in order; each later generation starts from the poses the previous one played. The
         options after a --target apply to that target only, each at most once:
         --poses N   how many poses from `start` inform the model, 1 to 4 (default: as many 30 Hz frames as the
                     animation has from start, at most 4). One pose stops the character there; more carry velocity.
         --start S   seconds from the animation's start where the target begins (default 0).
         --early K   Transition Early By, 0 to 20 frames (default 0, an exact target).
         --target-tokens A-B  allowed generation length for this target, 6 to 16 tokens (default: --tokens). A-A
                     fixes it.
--floor-tolerance  how far (metres) the lowest foot joint of a pose set may sit from SOMA's standing height before the
         summary calls it off the ground. It has no default: it is the person's, for instance the penetration their
         clip spec accepts.

Writes request.json and prints a JSON summary: the rest-pose fit, each pose set's lowest foot height against SOMA's
reference, and per target the ground distance from the previous pose and the average speeds the shortest and longest
generation that target's token range allows would imply.
Exits 1 when a file does not fit (wrong rest pose, too few frames, missing model joints) or the request is invalid.
"""
import argparse
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate  # noqa: E402  (request format and validation; generate.py imports MotionBricks only when it runs)
from mbx import soma  # noqa: E402

DEFAULT_VERSION = "0.2.0"
DEFAULT_MODEL = "MotionBricks-SOMA-RP-v1"
BOUNDARY_FRAMES = 3  # trimmed at each end of a generation (SKILL.md rule 7)
TARGET_OPTIONS = ("poses", "start", "early", "target_tokens")


class PackError(ValueError):
    pass


def new_target(path):
    return {"file": path, "poses": None, "start": 0.0, "early": 0, "tokens": None}


def target_option(target, key, value):
    """Set one option of a target from its command-line text. Raises PackError on a bad or repeated value."""
    field = "tokens" if key == "target_tokens" else key
    flag = "--" + key.replace("_", "-")
    if target.get("_set", set()) & {field}:
        raise PackError(f"{flag} given twice for target {target['file']}")
    try:
        if field == "poses":
            target["poses"] = int(value)
            if not 1 <= target["poses"] <= generate.POSES_PER_TOKEN:
                raise PackError(f"{flag} must be 1 to 4 for target {target['file']}")
        elif field == "start":
            target["start"] = float(value)
        elif field == "early":
            target["early"] = int(value)
        else:
            target["tokens"] = parse_tokens(value)
    except ValueError as exc:
        raise PackError(f"bad {flag} {value!r} for target {target['file']}: {exc}")
    target.setdefault("_set", set()).add(field)


class _Target(argparse.Action):
    def __call__(self, parser, namespace, value, option_string=None):
        namespace.target = (namespace.target or []) + [new_target(value)]


class _TargetOption(argparse.Action):
    def __call__(self, parser, namespace, value, option_string=None):
        if not namespace.target:
            raise PackError(f"{option_string} must follow the --target it applies to")
        target_option(namespace.target[-1], self.dest, value)


def parse_tokens(text):
    lo, _, hi = text.partition("-")
    lo, hi = int(lo), int(hi or lo)
    return {"min": lo, "max": hi}


def frames_for_tokens(tokens):
    """Valid frames of one generation of that many tokens: four poses per token, less the boundary frames."""
    return tokens * generate.POSES_PER_TOKEN - 2 * BOUNDARY_FRAMES


def ground_distance(a, b):
    return math.hypot(b[0] - a[0], b[2] - a[2])


def target_summary(previous_pose, target_first, early, tokens):
    """Distance on the ground from the previous pose to the target, and the average speeds that the shortest and longest
    generation this target's token range allows would imply (NVIDIA: fit the token count to the distance)."""
    d = ground_distance(previous_pose[0][:3], target_first[0][:3])
    longest, shortest = frames_for_tokens(tokens["max"]), frames_for_tokens(tokens["min"])
    return {"groundDistance": round(d, 3), "tokens": tokens,
            "impliedSpeed": {"atMaxFrames": round(d * generate.FPS / (longest - 1), 3),
                             "atMinFrames": round(d * generate.FPS / (shortest - 1), 3)},
            "transitionEarlyBy": early}


def build_request(skel, context_poses, targets, args, sources):
    req = {
        "format": generate.REQUEST_FORMAT,
        "fps": generate.FPS,
        "space": "SOMA model space: metres, +Y up, XZ ground (the glTF frame); local joint transforms "
                 "[px, py, pz, qx, qy, qz, qw] in the order of `joints`",
        "model": {"name": args.model_name, "motionbricksVersion": args.motionbricks_version},
        "inference": {"precision": args.precision, "backend": "tensorrt",
                      "tf32": {"auto": None, "on": True, "off": False}[args.tf32]},
        "settings": {"correctEndpoints": not args.no_endpoint_correction, "tokens": args.tokens},
        "joints": list(skel["joints"]),
        "context": {"poses": context_poses},
        "targets": [{"poses": t["poses_data"], "transitionEarlyBy": t["early"], "tokens": t["tokens"]} for t in targets],
        "sources": sources,
    }
    if args.onnx_sha256:
        req["model"]["onnxSha256"] = args.onnx_sha256
    problems = generate.validate_request(req)
    if problems:
        raise PackError("request is invalid:\n  " + "\n  ".join(problems))
    return req


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 23), b""):
            h.update(chunk)
    return h.hexdigest()


def read_poses(path, skel, times, rest_tolerance, blend, label):
    """Import a file into an empty scene and sample SOMA local poses at times(duration), seconds from the start of its
    animation."""
    blend.reset()
    arm = blend.import_armature(path, skel["joints"])
    missing = [j for j in skel["modelJoints"] if j not in arm.data.bones]
    if missing:
        raise PackError(f"{label} {path}: the armature lacks model joints {', '.join(missing)}")
    rest = blend.rest_world(arm)
    worst, joint = soma.rest_mismatch(skel, {n: p for n, (p, _) in rest.items()})
    if worst > rest_tolerance:
        raise PackError(f"{label} {path}: its rest pose is not SOMA's reference pose ({joint} is {worst:.3f} m off; "
                        f"tolerance {rest_tolerance} m). Retarget onto the rig soma_skeleton.py builds.")
    action, start, end = blend.animation(arm)
    duration = (end - start) / generate.FPS
    seconds = times(duration)
    if seconds[0] < -1e-6 or seconds[-1] > duration + 1e-6:
        raise PackError(f"{label} {path}: needs poses from {seconds[0]:.3f} s to {seconds[-1]:.3f} s, its animation "
                        f"{action!r} lasts {duration:.3f} s")
    rest_q = {n: q for n, (_, q) in rest.items()}
    poses = []
    for t in seconds:
        posed = blend.sample(arm, start + t * generate.FPS)
        poses.append(soma.pack_pose(skel, rest_q, {n: q for n, (_, q) in posed.items()}, posed[skel["joints"][0]][0]))
    return poses, {"file": os.path.basename(path), "sha256": _sha256(path), "animation": action,
                   "restFit": round(worst, 4), "seconds": [round(t, 4) for t in seconds]}


def floor_report(skel, poses, tolerance):
    """The lowest foot joint against SOMA's standing pose; nearGround judges it against the person's tolerance."""
    low, ref = soma.lowest(skel, poses, skel.get("footContactJoints") or [])
    if low is None:
        return None
    offset = low - ref
    return {"lowestFoot": round(low, 4), "referenceLowestFoot": round(ref, 4), "floorOffset": round(offset, 4),
            "nearGround": abs(offset) <= tolerance}


def parse_args(argv):
    """The command line, with each target's options attached to it. Raises PackError on misplaced target options and
    SystemExit (argparse) on missing or malformed flags."""
    parser = argparse.ArgumentParser(prog="pack.py", description=__doc__.splitlines()[0], allow_abbrev=False)
    parser.add_argument("context")
    parser.add_argument("request")
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--floor-tolerance", type=float, required=True)
    parser.add_argument("--target", action=_Target, required=True)
    for name in TARGET_OPTIONS:
        parser.add_argument("--" + name.replace("_", "-"), dest=name, action=_TargetOption)
    parser.add_argument("--context-end", type=float)
    parser.add_argument("--context-hold", action="store_true")
    parser.add_argument("--tokens", default="8-14")
    parser.add_argument("--precision", choices=generate.PRECISIONS, default="fp32")
    parser.add_argument("--tf32", choices=("auto", "on", "off"), default="auto")
    parser.add_argument("--no-endpoint-correction", action="store_true")
    parser.add_argument("--motionbricks-version", default=DEFAULT_VERSION)
    parser.add_argument("--onnx-sha256")
    parser.add_argument("--model-name", default=DEFAULT_MODEL)
    parser.add_argument("--rest-tolerance", type=float, default=0.01)
    args = parser.parse_args(argv)
    if args.floor_tolerance < 0:
        raise PackError("--floor-tolerance is a distance in metres, 0 or more")
    return args


def main(argv):
    try:
        args = parse_args(argv)
    except PackError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)
    from mbx import blend

    try:
        args.tokens = parse_tokens(args.tokens)
        skel = soma.load_skeleton(args.skeleton)
        targets = args.target
        step = 1.0 / generate.FPS

        def context_times(duration):
            last = duration if args.context_end is None else args.context_end
            return [last] * 4 if args.context_hold else [last - (3 - k) * step for k in range(4)]
        context, ctx_src = read_poses(args.context, skel, context_times, args.rest_tolerance, blend, "context")
        sources = [dict(ctx_src, role="context")]
        for n, t in enumerate(targets):
            def target_times(duration, t=t):
                available = int(math.floor((duration - t["start"]) * generate.FPS + 1e-6)) + 1
                count = t["poses"] or max(1, min(generate.POSES_PER_TOKEN, available))
                return [t["start"] + k * step for k in range(count)]
            t["poses_data"], src = read_poses(t["file"], skel, target_times, args.rest_tolerance, blend, f"target {n}")
            sources.append(dict(src, role=f"target {n}"))
        req = build_request(skel, context, targets, args, sources)
    except (PackError, soma.SkeletonError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(args.request)), exist_ok=True)
    with open(args.request, "w", encoding="utf-8") as f:
        json.dump(req, f, separators=(",", ":"))
        f.write("\n")
    previous = context[-1]
    summary_targets = []
    for n, t in enumerate(targets):
        s = target_summary(previous, t["poses_data"][0], t["early"], t["tokens"] or args.tokens)
        s.update(target=n, poses=len(t["poses_data"]), meaning="stop at the target" if len(t["poses_data"]) == 1 else "carry the target's velocity through",
                 floor=floor_report(skel, t["poses_data"], args.floor_tolerance))
        summary_targets.append(s)
        previous = t["poses_data"][0]
    print(json.dumps({"request": args.request, "joints": len(skel["joints"]), "precision": args.precision,
                      "restFit": max(s["restFit"] for s in sources), "floorTolerance": args.floor_tolerance,
                      "context": {"held": args.context_hold, "floor": floor_report(skel, context, args.floor_tolerance)},
                      "targets": summary_targets}, indent=2))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
