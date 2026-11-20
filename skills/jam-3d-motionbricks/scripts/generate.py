"""Generate SOMA motion with NVIDIA MotionBricks from a request file. Runs on the generating host, inside MotionBricks'
own environment (the one `uv sync` made in its clone); needs no Blender and no jam toolkit. This one file is all that has
to be copied to that host.

    python generate.py skeleton <soma-skeleton.json>
    python generate.py plan --precision fp32|fp16 [--tf32 auto|on|off] [--cache-dir <dir>] [--device cuda:0]
    python generate.py run <request.json> <result.json> [--cache-dir <dir>] [--device cuda:0]
    python generate.py check <request.json | result.json>

Run it with MotionBricks' interpreter, for example `uv run --project <motionbricks clone> python generate.py ...`.

skeleton  writes the SOMA skeleton the engine uses (joint names, parents, reference pose, the model's joints and its
          foot-contact joints) from the bundled USD file. pack.py, unpack.py and soma_skeleton.py read it.
plan      builds the TensorRT plan for a precision on this machine, or loads the cached one, and reports which.
run       generates toward each target in turn, chaining as MotionBricks' own Inbetweener does: each generation plays to
          its transition point, and the next context is the last four poses played. Writes every played pose, the root
          of each frame and the predicted foot contacts.
check     validates a request or result file without MotionBricks (stdlib only).

The TensorRT plan cache defaults to `.trt-cache` in the MotionBricks clone, where NVIDIA's own apps keep it.
Exit status: 0 done, 1 bad input or failed generation, 2 bad arguments.
"""
import argparse
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
import time

REQUEST_FORMAT = "jam-3d-motionbricks/request@1"
RESULT_FORMAT = "jam-3d-motionbricks/result@1"
SKELETON_FORMAT = "jam-3d-motionbricks/skeleton@1"
FPS = 30
POSES_PER_TOKEN = 4          # MODEL_POSES_PER_TOKEN: context poses, and the most target poses
TOKEN_RANGE = (6, 16)        # MotionBricksInferenceConfig accepts 6 to 16 tokens
DEFAULT_TOKENS = (8, 14)     # MotionBricksInferenceConfig default
MAX_TRANSITION_EARLY_BY = 20  # motionbricks.runtime.target_pose.MAX_TRANSITION_EARLY_BY_FRAMES
PRECISIONS = ("fp32", "fp16")
BACKENDS = ("tensorrt",)
SOMA_SKELETON_USD = ("human", "soma_base_skel_minimal_no_root.usd")


class InputError(ValueError):
    pass


# ---------------------------------------------------------------- validation (stdlib only)

def _number(v):
    """A finite JSON number; true and false are not numbers here."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _whole(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _transform_ok(t):
    if not isinstance(t, list) or len(t) != 7 or not all(_number(v) for v in t):
        return False
    return abs(math.sqrt(sum(v * v for v in t[3:])) - 1.0) < 1e-3


def _check_poses(where, poses, joint_count, lo, hi, errors):
    if not isinstance(poses, list) or not lo <= len(poses) <= hi:
        errors.append(f"{where}.poses must hold {lo} to {hi} poses" if lo != hi else f"{where}.poses must hold {lo} poses")
        return
    for k, pose in enumerate(poses):
        if not isinstance(pose, list) or len(pose) != joint_count:
            errors.append(f"{where}.poses[{k}] must hold one transform per joint ({joint_count})")
        elif not all(_transform_ok(t) for t in pose):
            errors.append(f"{where}.poses[{k}] has a transform that is not 7 finite numbers with a unit quaternion (x, y, z, w)")


def _check_tokens(where, tokens, errors, allow_null):
    if tokens is None and allow_null:
        return
    lo, hi = TOKEN_RANGE
    if not isinstance(tokens, dict) or not all(_whole(tokens.get(k)) for k in ("min", "max")) \
            or not lo <= tokens["min"] <= tokens["max"] <= hi:
        errors.append(f"{where} must be {{\"min\": a, \"max\": b}} with {lo} <= a <= b <= {hi}" + (", or null" if allow_null else ""))


def validate_request(req):
    """Return the list of problems with a request (empty when valid)."""
    errors = []
    if not isinstance(req, dict):
        return ["request must be a JSON object"]
    if req.get("format") != REQUEST_FORMAT:
        errors.append(f"format must be {REQUEST_FORMAT!r}")
    if req.get("fps") != FPS:
        errors.append(f"fps must be {FPS}: MotionBricks reads and writes poses at 30 Hz")
    model = req.get("model")
    if not isinstance(model, dict) or not isinstance(model.get("motionbricksVersion"), str):
        errors.append("model.motionbricksVersion is required (the MotionBricks release the request was packed for)")
    elif model.get("onnxSha256") is not None and not isinstance(model.get("onnxSha256"), str):
        errors.append("model.onnxSha256 must be a string or absent")
    inf = req.get("inference")
    if not isinstance(inf, dict):
        errors.append("inference is required")
    else:
        if inf.get("precision") not in PRECISIONS:
            errors.append(f"inference.precision must be one of {PRECISIONS}")
        if inf.get("backend") not in BACKENDS:
            errors.append(f"inference.backend must be one of {BACKENDS}")
        if inf.get("tf32") not in (None, True, False):
            errors.append("inference.tf32 must be null (the model's default), true or false")
    settings = req.get("settings")
    if not isinstance(settings, dict):
        errors.append("settings is required")
    else:
        if not isinstance(settings.get("correctEndpoints"), bool):
            errors.append("settings.correctEndpoints must be true or false")
        _check_tokens("settings.tokens", settings.get("tokens"), errors, allow_null=False)
    joints = req.get("joints")
    if not isinstance(joints, list) or not joints or not all(isinstance(j, str) for j in joints) or len(set(joints)) != len(joints):
        errors.append("joints must be a list of unique joint names")
        return errors
    if joints[0] != "Hips":
        errors.append("joints[0] must be Hips, the SOMA root")
    ctx = req.get("context")
    if not isinstance(ctx, dict):
        errors.append("context is required")
    else:
        _check_poses("context", ctx.get("poses"), len(joints), POSES_PER_TOKEN, POSES_PER_TOKEN, errors)
    targets = req.get("targets")
    if not isinstance(targets, list) or not targets:
        errors.append("targets must hold at least one target")
        return errors
    for n, t in enumerate(targets):
        where = f"targets[{n}]"
        if not isinstance(t, dict):
            errors.append(f"{where} must be an object")
            continue
        _check_poses(where, t.get("poses"), len(joints), 1, POSES_PER_TOKEN, errors)
        teb = t.get("transitionEarlyBy")
        if not _whole(teb) or not 0 <= teb <= MAX_TRANSITION_EARLY_BY:
            errors.append(f"{where}.transitionEarlyBy must be a whole number of frames from 0 to {MAX_TRANSITION_EARLY_BY}")
        _check_tokens(f"{where}.tokens", t.get("tokens"), errors, allow_null=True)
    return errors


SEGMENT_FIELDS = ("generatedFrames", "playedFrames", "tokens", "transitionEarlyBy")


def validate_result(res):
    """Return the list of problems with a result (empty when valid). Every entry is type-checked, so a malformed file
    gives named problems, never an exception."""
    errors = []
    if not isinstance(res, dict):
        return ["result must be a JSON object"]
    if res.get("format") != RESULT_FORMAT:
        errors.append(f"format must be {RESULT_FORMAT!r}")
    if res.get("fps") != FPS or isinstance(res.get("fps"), bool):
        errors.append(f"fps must be {FPS}")
    joints = res.get("joints")
    if not isinstance(joints, list) or not joints or not all(isinstance(j, str) for j in joints) \
            or len(set(joints)) != len(joints) or joints[0] != "Hips":
        errors.append("joints must list the skeleton's unique joint names, Hips first")
        return errors
    frames = res.get("frames")
    if not isinstance(frames, list) or not frames:
        errors.append("frames must hold at least one pose")
        return errors
    _check_poses("frames", frames, len(joints), 1, len(frames), errors)
    root = res.get("root")
    if not isinstance(root, list) or len(root) != len(frames):
        errors.append("root must hold one transform per frame")
    else:
        bad = [k for k, t in enumerate(root) if not _transform_ok(t)]
        if bad:
            errors.append(f"root[{bad[0]}] is not 7 finite numbers with a unit quaternion (x, y, z, w)")
    contacts = res.get("contacts")
    if not isinstance(contacts, dict) or not isinstance(contacts.get("joints"), list) or len(contacts["joints"]) != 4 \
            or not all(isinstance(j, str) for j in contacts["joints"]):
        errors.append("contacts.joints must name the four foot-contact joints")
    else:
        values = contacts.get("values")
        if not isinstance(values, list) or len(values) != len(frames):
            errors.append("contacts.values must hold one row per frame")
        elif not all(isinstance(r, list) and len(r) == 4 and all(_number(v) and 0.0 <= v <= 1.0 for v in r) for r in values):
            errors.append("each contacts.values row must be four confidences from 0 to 1")
    segments = res.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append("segments must describe each generation")
        return errors
    for n, seg in enumerate(segments):
        if not isinstance(seg, dict) or not all(_whole(seg.get(k)) and seg[k] >= 0 for k in SEGMENT_FIELDS):
            errors.append(f"segments[{n}] must be an object with whole numbers {', '.join(SEGMENT_FIELDS)}")
        elif seg["playedFrames"] < 1:
            errors.append(f"segments[{n}].playedFrames must be at least 1")
    if not any(e.startswith("segments[") for e in errors):
        covered = sum(s["playedFrames"] for s in segments) - (len(segments) - 1)
        if covered != len(frames):
            errors.append(f"segments play {covered} frames, frames holds {len(frames)}")
    return errors


# ---------------------------------------------------------------- chaining (as MotionBricks' Inbetweener does it)

def played_frame_count(num_frames, transition_early_by):
    """Frames of one generation that play before its transition point. Transition Early By ends playback that many
    frames before the end; at least four frames play, because the next context is the last four played frames."""
    return max(POSES_PER_TOKEN, num_frames - transition_early_by)


def join_segment(clip, played, first):
    """Append one generation's played frames to the clip. A generation starts at the last context pose, which the clip
    already ends on after the first generation, so later generations drop their first frame."""
    clip.extend(played if first else played[1:])
    return clip


def next_context(played):
    return played[-POSES_PER_TOKEN:]


# ---------------------------------------------------------------- helpers

def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise InputError(f"cannot read {path}: {exc}")


def _write_json(path, data):
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 23), b""):
            h.update(chunk)
    return h.hexdigest()


def _round(values, digits=6):
    return [round(float(v), digits) for v in values]


def _clone_root(mb):
    """The MotionBricks clone: the folder above the installed package."""
    return os.path.dirname(os.path.dirname(os.path.abspath(mb.__file__)))


def _git_commit(folder):
    try:
        out = subprocess.run(["git", "-C", folder, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=20)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _load_motionbricks():
    try:
        import warp as wp  # noqa: F401
        import motionbricks as mb
        from motionbricks import _version
    except ImportError as exc:
        raise InputError(f"MotionBricks is not importable here ({exc}); run this script with MotionBricks' own interpreter, "
                         "for example `uv run --project <motionbricks clone> python generate.py ...`")
    return mb, _version.__version__


def _soma_skeleton():
    from motionbricks.io.usd import load_skeleton_from_usd
    from motionbricks.io.utils import SOMA_SKELETON_PRIM_PATH, get_asset_file
    path = get_asset_file(*SOMA_SKELETON_USD)
    return load_skeleton_from_usd(path, SOMA_SKELETON_PRIM_PATH), str(path)


def _onnx_path(precision):
    from motionbricks.model.soma.contract import SOMA_N1_FP16_ONNX_PATH, SOMA_N1_FP32_ONNX_PATH
    return str(SOMA_N1_FP16_ONNX_PATH if precision == "fp16" else SOMA_N1_FP32_ONNX_PATH)


def _init_device(device):
    """Select the CUDA device before anything allocates: MotionBricks' skeleton, tokens and engine all put their arrays
    on Warp's current device, and arrays on two devices cannot meet in one kernel."""
    import warp as wp
    wp.init()
    try:
        found = wp.get_device(device)
    except (ValueError, RuntimeError) as exc:
        raise InputError(f"no device {device} here ({exc}); `host_check.py` lists this machine's GPUs")
    if not found.is_cuda:
        raise InputError(f"{device} is not a CUDA device: MotionBricks' TensorRT engine needs an NVIDIA GPU")
    wp.set_device(found)
    return found


def _on_device(device):
    import warp as wp
    return wp.ScopedDevice(device)


def _engine(precision, tf32, cache_dir):
    from motionbricks.inference.builder import TensorRTBuildOptions
    from motionbricks.model.soma.engine import MotionBricksSOMAEngine
    options = TensorRTBuildOptions(enable_fp16=precision == "fp16", enable_tf32=tf32)
    # Identity model_to_runtime: poses stay in SOMA model space (metres, +Y up), which is also the glTF frame.
    return MotionBricksSOMAEngine(_onnx_path(precision), build_options=options, cache_dir=cache_dir)


def _plans(cache_dir):
    try:
        return {n for n in os.listdir(cache_dir) if n.endswith(".plan")}
    except OSError:
        return set()


def _environment(device, precision, tf32):
    import tensorrt
    import warp as wp
    return {
        "backend": "tensorrt", "precision": precision, "tf32": tf32,
        "tensorrtVersion": str(tensorrt.__version__), "warpVersion": str(wp.config.version),
        "device": device.alias, "gpu": device.name, "architecture": f"sm_{device.arch}",
        "os": platform.system(), "machine": platform.machine(), "python": platform.python_version(),
    }


# ---------------------------------------------------------------- commands

def cmd_skeleton(args):
    mb, version = _load_motionbricks()
    from motionbricks.model.soma.contract import SOMA_N1_CONTRACT, SOMA_N1_FOOT_CONTACT_JOINTS
    skeleton, usd = _soma_skeleton()
    ref = skeleton.reference_local_transforms.numpy()
    data = {
        "format": SKELETON_FORMAT,
        "source": {"motionbricksVersion": version, "commit": _git_commit(_clone_root(mb)),
                   "file": "/".join(("motionbricks", "assets") + SOMA_SKELETON_USD), "sha256": _sha256(usd)},
        "space": "SOMA model space: metres, +Y up, XZ ground; the character faces +Z and +X is its left (the glTF frame)",
        "fps": FPS,
        "joints": list(skeleton.joint_names),
        "parents": [int(skeleton.joint_parent(i)) for i in range(skeleton.num_joints)],
        "reference": [_round(t) for t in ref],
        "modelJoints": list(SOMA_N1_CONTRACT.joint_names),
        "footContactJoints": list(SOMA_N1_FOOT_CONTACT_JOINTS),
    }
    _write_json(args.out, data)
    print(json.dumps({"skeleton": args.out, "joints": len(data["joints"]), "modelJoints": len(data["modelJoints"]),
                      "motionbricksVersion": version}))


def cmd_plan(args):
    mb, version = _load_motionbricks()
    cache_dir = args.cache_dir or os.path.join(_clone_root(mb), ".trt-cache")
    device = _init_device(args.device)
    before = _plans(cache_dir)
    start = time.perf_counter()
    with _on_device(device), _engine(args.precision, args.tf32, cache_dir):
        pass
    seconds = time.perf_counter() - start
    built = sorted(_plans(cache_dir) - before)
    print(json.dumps({"precision": args.precision, "tf32": args.tf32, "cacheDir": cache_dir, "built": bool(built),
                      "planFiles": built, "seconds": round(seconds, 1), "gpu": device.name,
                      "motionbricksVersion": version}))


def cmd_check(args):
    data = _read_json(args.file)
    fmt = data.get("format") if isinstance(data, dict) else None
    errors = validate_result(data) if fmt == RESULT_FORMAT else validate_request(data)
    print(json.dumps({"file": args.file, "format": fmt, "valid": not errors, "errors": errors}))
    return 0 if not errors else 1


def cmd_run(args):
    req = _read_json(args.request)
    errors = validate_request(req)
    if errors:
        raise InputError("request is invalid:\n  " + "\n  ".join(errors))
    mb, version = _load_motionbricks()
    if req["model"]["motionbricksVersion"] != version:
        raise InputError(f"the request was packed for MotionBricks {req['model']['motionbricksVersion']}, this host has "
                         f"{version}; install that release or pack again for this one")
    device = _init_device(args.device)
    with _on_device(device):
        return _generate(args, req, mb, version, device)


def _generate(args, req, mb, version, device):
    """Everything that allocates runs here, on the device _init_device selected."""
    import numpy as np
    import warp as wp
    from motionbricks.inference.cache import sha256_file
    from motionbricks.model.config import MotionBricksInferenceConfig
    from motionbricks.model.soma.contract import SOMA_N1_CONTRACT, SOMA_N1_FOOT_CONTACT_JOINTS

    inf, settings = req["inference"], req["settings"]
    onnx = _onnx_path(inf["precision"])
    onnx_sha = sha256_file(onnx)
    if req["model"].get("onnxSha256") and req["model"]["onnxSha256"] != onnx_sha:
        raise InputError(f"the request names model file {req['model']['onnxSha256']}, this host's {os.path.basename(onnx)} is {onnx_sha}")
    missing = [j for j in SOMA_N1_CONTRACT.joint_names if j not in req["joints"]]
    if missing:
        raise InputError(f"the request's poses lack model joints: {', '.join(missing)}")

    skeleton, _ = _soma_skeleton()
    reference = skeleton.reference_local_transforms.numpy()
    columns = []
    for name in skeleton.joint_names:
        columns.append(req["joints"].index(name) if name in req["joints"] else None)

    def to_array(poses):
        out = np.empty((len(poses), skeleton.num_joints, 7), dtype=np.float32)
        for k, pose in enumerate(poses):
            for j, col in enumerate(columns):
                out[k, j] = pose[col] if col is not None else reference[j]
        return wp.array(out, dtype=wp.transform, device=device)

    cache_dir = args.cache_dir or os.path.join(_clone_root(mb), ".trt-cache")
    before = _plans(cache_dir)
    clip, contacts, segments = [], [], []
    started = time.perf_counter()
    with _engine(inf["precision"], inf["tf32"], cache_dir) as engine, wp.ScopedStream(engine.stream):
        plan_built = bool(_plans(cache_dir) - before)
        context = engine.create_input(skeleton)
        target = engine.create_input(skeleton)
        output = engine.create_output(skeleton)
        context_poses = to_array(req["context"]["poses"])
        for n, t in enumerate(req["targets"]):
            tokens = t["tokens"] or settings["tokens"]
            config = MotionBricksInferenceConfig(allowed_token_counts=tuple(range(tokens["min"], tokens["max"] + 1)),
                                                 correct_generated_diff=settings["correctEndpoints"])
            context.update_from_poses(context_poses, stream=engine.stream)
            target.update_from_poses(to_array(t["poses"]), stream=engine.stream)
            engine.generate_animation(context, target, output, config=config)
            engine.synchronize()
            frames = output.num_frames
            played = played_frame_count(frames, t["transitionEarlyBy"])
            poses = output.poses[:played].numpy()
            feet = np.clip(output.foot_contacts[:played].numpy(), 0.0, 1.0)
            join_segment(clip, [[_round(tr) for tr in pose] for pose in poses], n == 0)
            join_segment(contacts, [_round(r, 4) for r in feet], n == 0)
            segments.append({"target": n, "generatedFrames": int(frames), "tokens": int((frames + 6) // POSES_PER_TOKEN),
                             "playedFrames": int(played), "transitionEarlyBy": t["transitionEarlyBy"],
                             "allowedTokens": tokens, "milliseconds": {k: round(float(v), 3) for k, v in dict(engine.timer.milliseconds).items()}})
            context_poses = wp.clone(output.poses[played - POSES_PER_TOKEN:played])
    result = {
        "format": RESULT_FORMAT,
        "request": {"file": os.path.basename(args.request), "sha256": _sha256(args.request)},
        "model": {"name": req["model"].get("name"), "motionbricksVersion": version, "commit": _git_commit(_clone_root(mb)),
                  "onnxFile": os.path.basename(onnx), "onnxSha256": onnx_sha},
        "inference": dict(_environment(device, inf["precision"], inf["tf32"]), planBuilt=plan_built,
                          correctEndpoints=settings["correctEndpoints"]),
        "fps": FPS,
        "space": "SOMA model space: metres, +Y up, XZ ground (the glTF frame); frame 0 is the last context pose",
        "joints": list(skeleton.joint_names),
        "frames": clip,
        "root": [pose[0] for pose in clip],
        "contacts": {"joints": list(SOMA_N1_FOOT_CONTACT_JOINTS),
                     "meaning": "model-predicted confidence from 0 to 1 that the heel (Foot) or toe (ToeBase) is planted",
                     "values": contacts},
        "segments": segments,
        "seconds": round(time.perf_counter() - started, 2),
    }
    problems = validate_result(result)
    if problems:
        raise InputError("internal: the result does not validate:\n  " + "\n  ".join(problems))
    _write_json(args.result, result)
    print(json.dumps({"result": args.result, "frames": len(clip), "seconds": round(len(clip) / FPS, 3),
                      "segments": [{k: s[k] for k in ("generatedFrames", "playedFrames")} for s in segments],
                      "planBuilt": plan_built, "precision": inf["precision"], "gpu": device.name}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("skeleton")
    p.add_argument("out")
    for name in ("plan", "run"):
        p = sub.add_parser(name)
        if name == "run":
            p.add_argument("request")
            p.add_argument("result")
        else:
            p.add_argument("--precision", choices=PRECISIONS, required=True)
            p.add_argument("--tf32", choices=("auto", "on", "off"), default="auto")
        p.add_argument("--cache-dir")
        p.add_argument("--device", default="cuda:0")
    p = sub.add_parser("check")
    p.add_argument("file")
    args = parser.parse_args(argv)
    if getattr(args, "tf32", None) is not None:
        args.tf32 = {"auto": None, "on": True, "off": False}[args.tf32]
    try:
        return {"skeleton": cmd_skeleton, "plan": cmd_plan, "run": cmd_run, "check": cmd_check}[args.command](args) or 0
    except InputError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
