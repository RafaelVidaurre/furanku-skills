"""Blender-free and GPU-free behaviour of the jam-3d-motionbricks scripts: the pose math pack and unpack share, the
request and result formats, chaining, the host check's parsing and judgement, and the landmark map. Run with
`python3 -m pytest`. The skeleton here is synthetic (SOMA's joint names on made-up proportions); no NVIDIA data is used."""
import copy
import json
import math
import os
import random
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate  # noqa: E402
import host_check  # noqa: E402
import make_test_poses  # noqa: E402
import pack  # noqa: E402
import unpack  # noqa: E402
from mbx import math3d as m, soma  # noqa: E402

SKILL = os.path.dirname(HERE)
MAP = os.path.join(SKILL, "assets", "landmark-maps", "soma.json")

# name, parent, position (glTF frame, metres)
BODY = [
    ("Hips", None, (0, 1.0, 0)), ("Spine1", "Hips", (0, 1.05, 0)), ("Spine2", "Spine1", (0, 1.13, 0)),
    ("Chest", "Spine2", (0, 1.2, 0)), ("Neck1", "Chest", (0, 1.45, 0)), ("Neck2", "Neck1", (0, 1.52, 0.01)),
    ("Head", "Neck2", (0, 1.6, 0.03)), ("Jaw", "Head", (0, 1.6, 0.06)), ("LeftEye", "Head", (0.03, 1.66, 0.1)),
    ("RightEye", "Head", (-0.03, 1.66, 0.1)),
]
for s, x in (("Left", 1), ("Right", -1)):
    BODY += [(f"{s}Shoulder", "Chest", (0.02 * x, 1.44, 0.04)), (f"{s}Arm", f"{s}Shoulder", (0.16 * x, 1.44, 0)),
             (f"{s}ForeArm", f"{s}Arm", (0.45 * x, 1.44, 0)), (f"{s}Hand", f"{s}ForeArm", (0.72 * x, 1.44, 0)),
             (f"{s}HandThumb1", f"{s}Hand", (0.74 * x, 1.43, 0.02)), (f"{s}HandThumbEnd", f"{s}HandThumb1", (0.84 * x, 1.41, 0.04)),
             (f"{s}HandMiddle1", f"{s}Hand", (0.75 * x, 1.44, 0)), (f"{s}HandMiddleEnd", f"{s}HandMiddle1", (0.91 * x, 1.44, 0))]
for s, x in (("Left", 1), ("Right", -1)):
    BODY += [(f"{s}Leg", "Hips", (0.1 * x, 0.93, 0.02)), (f"{s}Shin", f"{s}Leg", (0.1 * x, 0.5, 0.02)),
             (f"{s}Foot", f"{s}Shin", (0.1 * x, 0.07, 0.02)), (f"{s}ToeBase", f"{s}Foot", (0.1 * x, 0.02, 0.15))]
MODEL = [n for n, _, _ in BODY if "Thumb1" not in n and "Middle1" not in n]
FEET = ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"]


def skeleton():
    """Reference local transforms with deliberately non-identity joint frames, as SOMA's are."""
    rng = random.Random(7)
    names = [n for n, _, _ in BODY]
    parents = [names.index(p) if p else -1 for _, p, _ in BODY]
    world_q = [m.qnormalize(tuple(rng.uniform(-1, 1) for _ in range(4))) for _ in BODY]
    reference = []
    for i, (_, p, pos) in enumerate(BODY):
        if parents[i] < 0:
            reference.append(list(pos) + list(world_q[i]))
        else:
            pq, pp = world_q[parents[i]], BODY[parents[i]][2]
            local_p = m.qrot(m.qconj(pq), m.vsub(pos, pp))
            reference.append(list(local_p) + list(m.qmul(m.qconj(pq), world_q[i])))
    return soma.check_skeleton({"format": soma.FORMAT, "joints": names, "parents": parents, "reference": reference,
                                "modelJoints": MODEL, "footContactJoints": FEET, "fps": 30})


def random_pose(skel, rng, root=(0.3, 0.98, -0.2)):
    out = []
    for i, ref in enumerate(skel["reference"]):
        q = m.qnormalize(m.qmul(tuple(ref[3:]), m.qaxis_angle((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)), rng.uniform(-1.2, 1.2))))
        out.append(list(root if i == 0 else ref[:3]) + list(q))
    return out


def max_error(skel, a, b):
    wa, wb = m.forward_kinematics(skel["parents"], a), m.forward_kinematics(skel["parents"], b)
    return (max(m.vlen(m.vsub(x[0], y[0])) for x, y in zip(wa, wb)),
            max(m.qangle(x[1], y[1]) for x, y in zip(wa, wb)))


# ---------------------------------------------------------------- pose math

def test_quaternion_basics():
    q = m.qaxis_angle((0, 0, 1), math.pi / 2)
    assert all(abs(a - b) < 1e-9 for a, b in zip(m.qrot(q, (1, 0, 0)), (0, 1, 0)))
    assert m.qangle(m.qmul(q, m.qconj(q)), m.IDENTITY_Q) < 1e-9


def test_blender_frame_conversion_maps_up_and_front():
    assert all(abs(a - b) < 1e-9 for a, b in zip(m.vec_to_blender((0, 1, 0)), (0, 0, 1)))   # glTF up -> Blender up
    assert all(abs(a - b) < 1e-9 for a, b in zip(m.vec_to_blender((0, 0, 1)), (0, -1, 0)))  # glTF front -> Blender -Y
    q = m.qaxis_angle((0.3, -0.5, 0.8), 0.9)
    assert m.qangle(m.rot_to_gltf(m.rot_to_blender(q)), q) < 1e-9
    v = (0.2, -0.4, 0.7)
    assert m.vlen(m.vsub(m.vec_to_blender(m.qrot(q, v)), m.qrot(m.rot_to_blender(q), m.vec_to_blender(v)))) < 1e-9


def test_pack_on_soma_itself_returns_the_pose():
    skel, rng = skeleton(), random.Random(1)
    pose = random_pose(skel, rng)
    world = m.forward_kinematics(skel["parents"], pose)
    ref = soma.reference_world(skel)
    rest_q = {n: ref[i][1] for i, n in enumerate(skel["joints"])}
    pose_q = {n: world[i][1] for i, n in enumerate(skel["joints"])}
    packed = soma.pack_pose(skel, rest_q, pose_q, world[0][0])
    dp, da = max_error(skel, pose, packed)
    assert dp < 1e-9 and da < 1e-6


def test_pack_is_independent_of_the_rigs_bone_axes():
    """A DCC re-orients bones on import; the same physical pose must pack to the same SOMA pose."""
    skel, rng = skeleton(), random.Random(2)
    pose = random_pose(skel, rng)
    world = m.forward_kinematics(skel["parents"], pose)
    ref = soma.reference_world(skel)
    axes = {n: m.qnormalize(tuple(rng.uniform(-1, 1) for _ in range(4))) for n in skel["joints"]}  # per-bone frame change
    rest_q = {n: m.qmul(ref[i][1], axes[n]) for i, n in enumerate(skel["joints"])}
    pose_q = {n: m.qmul(world[i][1], axes[n]) for i, n in enumerate(skel["joints"])}
    packed = soma.pack_pose(skel, rest_q, pose_q, world[0][0])
    dp, da = max_error(skel, pose, packed)
    assert dp < 1e-9 and da < 1e-6


def test_unpack_then_pack_round_trips_through_a_foreign_rig():
    skel, rng = skeleton(), random.Random(3)
    ref = soma.reference_world(skel)
    axes = {n: m.qnormalize(tuple(rng.uniform(-1, 1) for _ in range(4))) for n in skel["joints"]}
    rig_rest = {n: m.qmul(ref[i][1], axes[n]) for i, n in enumerate(skel["joints"])}
    for _ in range(5):
        pose = random_pose(skel, rng)
        world = soma.unpack_pose(skel, pose)
        rig_pose = {n: m.qmul(world[i][1], rig_rest[n]) for i, n in enumerate(skel["joints"])}
        packed = soma.pack_pose(skel, rig_rest, rig_pose, world[0][0])
        dp, da = max_error(skel, pose, packed)
        assert dp < 1e-9 and da < 1e-6


def test_joints_the_rig_lacks_keep_their_reference_local_rotation():
    skel = skeleton()
    ref = soma.reference_world(skel)
    turn = m.qaxis_angle((0, 1, 0), 0.7)
    rest_q = {"Hips": ref[0][1]}
    packed = soma.pack_pose(skel, rest_q, {"Hips": m.qmul(turn, ref[0][1])}, (0, 1, 0))
    for i in range(1, len(packed)):
        assert m.qangle(tuple(packed[i][3:]), tuple(skel["reference"][i][3:])) < 1e-6
    assert m.qangle(tuple(packed[0][3:]), m.qmul(turn, ref[0][1])) < 1e-6


def test_rest_mismatch_names_the_worst_joint():
    skel = skeleton()
    ref = soma.reference_world(skel)
    rest = {n: ref[i][0] for i, n in enumerate(skel["joints"])}
    assert soma.rest_mismatch(skel, rest)[0] < 1e-9
    rest["LeftHand"] = m.vadd(rest["LeftHand"], (0, -0.2, 0))
    worst, joint = soma.rest_mismatch(skel, rest)
    assert joint == "LeftHand" and abs(worst - 0.2) < 1e-9


def test_lowest_foot_against_reference():
    skel = skeleton()
    pose = [list(t) for t in skel["reference"]]
    pose[0][1] -= 0.05
    low, ref = soma.lowest(skel, [pose], FEET)
    assert abs((low - ref) + 0.05) < 1e-9


def test_skeleton_file_is_checked():
    skel = skeleton()
    bad = copy.deepcopy(skel)
    bad["parents"][3] = 3
    with pytest.raises(soma.SkeletonError):
        soma.check_skeleton(bad)
    bad = copy.deepcopy(skel)
    bad["modelJoints"] = bad["modelJoints"] + ["Tail"]
    with pytest.raises(soma.SkeletonError):
        soma.check_skeleton(bad)
    with pytest.raises(soma.SkeletonError):
        soma.check_skeleton(dict(skel, format="other"))


def test_constructed_test_poses_place_and_turn_the_body():
    skel = skeleton()
    pose = make_test_poses.standing(skel, 1.0, 2.0, math.pi / 2)
    world = m.forward_kinematics(skel["parents"], pose)
    idx = soma.index(skel)
    assert abs(world[0][0][0] - 1.0) < 1e-9 and abs(world[0][0][2] - 2.0) < 1e-9
    # turned to its left: the left hip now lies behind the hips (-Z), the right one ahead
    assert world[idx["LeftLeg"]][0][2] < world[0][0][2] < world[idx["RightLeg"]][0][2]
    # arms lowered: hands below the shoulders
    assert world[idx["LeftHand"]][0][1] < world[idx["LeftArm"]][0][1] - 0.3


# ---------------------------------------------------------------- request and result formats

def request(skel, targets=1):
    rng = random.Random(5)
    return {"format": generate.REQUEST_FORMAT, "fps": 30, "model": {"name": "x", "motionbricksVersion": "0.2.0"},
            "inference": {"precision": "fp32", "backend": "tensorrt", "tf32": None},
            "settings": {"correctEndpoints": True, "tokens": {"min": 8, "max": 14}},
            "joints": list(skel["joints"]), "context": {"poses": [random_pose(skel, rng) for _ in range(4)]},
            "targets": [{"poses": [random_pose(skel, rng)], "transitionEarlyBy": 0, "tokens": None} for _ in range(targets)]}


def test_a_well_formed_request_is_valid():
    assert generate.validate_request(request(skeleton(), targets=3)) == []


@pytest.mark.parametrize("change, message", [
    (lambda r: r.update(fps=60), "fps"),
    (lambda r: r["context"]["poses"].pop(), "context.poses must hold 4"),
    (lambda r: r["targets"][0]["poses"].extend(r["targets"][0]["poses"] * 4), "1 to 4"),
    (lambda r: r["targets"][0].update(transitionEarlyBy=21), "transitionEarlyBy"),
    (lambda r: r["targets"][0].update(tokens={"min": 5, "max": 9}), "tokens"),
    (lambda r: r["settings"].update(tokens={"min": 10, "max": 9}), "settings.tokens"),
    (lambda r: r["inference"].update(precision="int8"), "precision"),
    (lambda r: r["inference"].update(backend="onnxruntime"), "backend"),
    (lambda r: r["model"].pop("motionbricksVersion"), "motionbricksVersion"),
    (lambda r: r["joints"].reverse(), "Hips"),
    (lambda r: r["context"]["poses"][0][2].__setitem__(6, 2.0), "unit quaternion"),
    (lambda r: r.update(targets=[]), "at least one target"),
])
def test_request_problems_are_named(change, message):
    req = request(skeleton())
    change(req)
    assert any(message in e for e in generate.validate_request(req)), generate.validate_request(req)


def result(skel, segments=(50, 30)):
    rng = random.Random(9)
    frames = sum(segments) - (len(segments) - 1)
    poses = [random_pose(skel, rng) for _ in range(frames)]
    return {"format": generate.RESULT_FORMAT, "fps": 30, "joints": list(skel["joints"]), "frames": poses,
            "root": [p[0] for p in poses], "contacts": {"joints": list(FEET), "values": [[0.5, 0.5, 1.0, 0.0] for _ in range(frames)]},
            "segments": [{"generatedFrames": n, "playedFrames": n, "tokens": (n + 6) // 4, "transitionEarlyBy": 0} for n in segments]}


def test_a_well_formed_result_is_valid_and_problems_are_named():
    skel = skeleton()
    assert generate.validate_result(result(skel)) == []
    bad = result(skel)
    bad["contacts"]["values"][3] = [1.2, 0, 0, 0]
    assert any("confidences" in e for e in generate.validate_result(bad))
    bad = result(skel)
    bad["frames"].pop()
    assert any("segments play" in e or "one row per frame" in e for e in generate.validate_result(bad))


@pytest.mark.parametrize("change, message", [
    (lambda r: r["segments"].__setitem__(0, "fifty"), "segments[0]"),
    (lambda r: r["segments"][1].pop("playedFrames"), "segments[1]"),
    (lambda r: r["segments"][0].update(playedFrames=True), "segments[0]"),
    (lambda r: r["contacts"]["values"].__setitem__(2, [True, False, 0.5, 0.5]), "confidences"),
    (lambda r: r["root"].__setitem__(4, "hips"), "root[4]"),
    (lambda r: r["root"].__setitem__(0, [0, 1, 0, 0, 0, 0, True]), "root[0]"),
    (lambda r: r["joints"].__setitem__(3, 7), "joints"),
    (lambda r: r["frames"][5].__setitem__(0, None), "frames.poses[5]"),
    (lambda r: r["contacts"]["joints"].__setitem__(0, None), "contacts.joints"),
    (lambda r: r.update(fps=True), "fps"),
])
def test_malformed_result_entries_are_named_not_raised(change, message):
    res = result(skeleton())
    change(res)
    errors = generate.validate_result(res)
    assert any(message in e for e in errors), errors


@pytest.mark.parametrize("path", [("frames", 0, 0, 3), ("root", 0, 6), ("contacts", "values", 0, 0)])
@pytest.mark.parametrize("value", [10 ** 400, float("nan"), float("inf")])
def test_numbers_a_float_cannot_hold_are_named_not_raised(path, value):
    res = result(skeleton(), segments=(18,))
    where = res
    for key in path[:-1]:
        where = where[key]
    where[path[-1]] = value
    assert generate.validate_result(res)


def test_booleans_are_not_numbers_in_a_request():
    req = request(skeleton())
    req["settings"]["tokens"] = {"min": True, "max": 9}
    req["context"]["poses"][0][0] = [0, 1, 0, 0, 0, 0, True]
    errors = generate.validate_request(req)
    assert any("settings.tokens" in e for e in errors) and any("context.poses[0]" in e for e in errors), errors


def test_check_command_reports_validity(tmp_path, capsys):
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request(skeleton())))
    assert generate.main(["check", str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["valid"] is True
    bad = request(skeleton())
    bad["fps"] = 24
    path.write_text(json.dumps(bad))
    assert generate.main(["check", str(path)]) == 1


def test_run_selects_the_device_before_anything_is_allocated(tmp_path, monkeypatch):
    """MotionBricks' skeleton, tokens and engine allocate on Warp's current device, so the device named by --device
    is selected before the skeleton loads (a skeleton on cuda:0 cannot meet an engine on cuda:1)."""
    calls = []

    class Stop(Exception):
        pass
    monkeypatch.setattr(generate, "_load_motionbricks", lambda: (None, "0.2.0"))
    monkeypatch.setattr(generate, "_soma_skeleton", lambda: calls.append("skeleton") or (_ for _ in ()).throw(Stop()))
    monkeypatch.setattr(generate, "_engine", lambda *a: calls.append("engine") or (_ for _ in ()).throw(Stop()))

    def init_device(device):
        calls.append(("device", device))
        return "the device"

    class Scope:
        def __init__(self, device):
            calls.append(("scope", device))

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            calls.append("scope closed")
    monkeypatch.setattr(generate, "_init_device", init_device)
    monkeypatch.setattr(generate, "_on_device", Scope)
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request(skeleton())))
    monkeypatch.setitem(sys.modules, "numpy", sys.modules.get("numpy") or type(sys)("numpy"))
    monkeypatch.setitem(sys.modules, "warp", type(sys)("warp"))
    fake = {n: type(sys)(n) for n in ("motionbricks", "motionbricks.inference", "motionbricks.inference.cache",
                                      "motionbricks.model", "motionbricks.model.config", "motionbricks.model.soma",
                                      "motionbricks.model.soma.contract")}
    fake["motionbricks.inference.cache"].sha256_file = lambda p: "x"
    fake["motionbricks.model.config"].MotionBricksInferenceConfig = object
    fake["motionbricks.model.soma.contract"].SOMA_N1_CONTRACT = type("C", (), {"joint_names": MODEL})
    fake["motionbricks.model.soma.contract"].SOMA_N1_FOOT_CONTACT_JOINTS = FEET
    for name, module in fake.items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(generate, "_onnx_path", lambda precision: "model.onnx")
    with pytest.raises(Stop):
        generate.cmd_run(type("A", (), {"request": str(path), "result": str(tmp_path / "r.json"), "device": "cuda:1",
                                        "cache_dir": None})())
    assert calls[:3] == [("device", "cuda:1"), ("scope", "the device"), "skeleton"], calls
    assert calls[-1] == "scope closed"


# ---------------------------------------------------------------- chaining

@pytest.mark.parametrize("frames, early, played", [(18, 0, 18), (58, 0, 58), (50, 10, 40), (18, 20, 4), (22, 20, 4)])
def test_played_frames_follow_transition_early_by(frames, early, played):
    assert generate.played_frame_count(frames, early) == played


def test_chained_segments_join_without_repeating_the_seam_frame():
    first, second = list(range(0, 50)), list(range(49, 79))
    clip = generate.join_segment([], first, True)
    generate.join_segment(clip, second, False)
    assert clip == list(range(0, 79))
    assert generate.next_context(first) == [46, 47, 48, 49]


def test_pack_target_summary_reports_distance_and_the_speeds_its_own_token_range_implies():
    pose_a = [[0, 1, 0, 0, 0, 0, 1]]
    pose_b = [[0, 1, 1.5, 0, 0, 0, 1]]
    s = pack.target_summary(pose_a, pose_b, 4, {"min": 6, "max": 16})
    assert s["groundDistance"] == 1.5
    assert s["impliedSpeed"]["atMaxFrames"] == round(1.5 * 30 / 57, 3)   # 16 tokens: 58 frames
    assert s["impliedSpeed"]["atMinFrames"] == round(1.5 * 30 / 17, 3)   # 6 tokens: 18 frames
    fixed = pack.target_summary(pose_a, pose_b, 0, {"min": 9, "max": 9})  # 9 tokens: 30 frames
    assert fixed["impliedSpeed"]["atMaxFrames"] == fixed["impliedSpeed"]["atMinFrames"] == round(1.5 * 30 / 29, 3)
    assert pack.frames_for_tokens(8) == 26 and pack.frames_for_tokens(14) == 50


BASE = ["context.glb", "request.json", "--skeleton", "s.json", "--floor-tolerance", "0.02"]


def test_pack_target_options_follow_their_target_and_paths_may_hold_commas():
    args = pack.parse_args(BASE + ["--target", "a,b.glb", "--poses", "4", "--start", "0.5", "--early", "10",
                                   "--target-tokens", "9-9", "--target", "c.glb", "--early", "2"])
    first, second = ({k: v for k, v in t.items() if k != "_set"} for t in args.target)
    assert first == {"file": "a,b.glb", "poses": 4, "start": 0.5, "early": 10, "tokens": {"min": 9, "max": 9}}
    assert second == {"file": "c.glb", "poses": None, "start": 0.0, "early": 2, "tokens": None}
    assert args.floor_tolerance == 0.02 and args.tokens == "8-14"


@pytest.mark.parametrize("argv", [
    ["--poses", "2", "--target", "t.glb"],                 # an option before any target
    ["--target", "t.glb", "--poses", "5"],                  # out of range
    ["--target", "t.glb", "--early", "1", "--early", "2"],  # twice for one target
    ["--target", "t.glb", "--target-tokens", "x"],
])
def test_pack_refuses_misplaced_or_bad_target_options(argv):
    with pytest.raises(pack.PackError):
        pack.parse_args(BASE + argv)


def test_pack_floor_tolerance_has_no_default():
    with pytest.raises(SystemExit):
        pack.parse_args(["context.glb", "request.json", "--skeleton", "s.json", "--target", "t.glb"])


@pytest.mark.parametrize("argv", [
    ["--floor-tolerance", "-0.1", "--target", "t.glb"],
    ["--floor-tolerance", "nan", "--target", "t.glb"],
    ["--floor-tolerance", "inf", "--target", "t.glb"],
    ["--floor-tolerance", "0.02", "--target", "t.glb", "--start", "nan"],
    ["--floor-tolerance", "0.02", "--target", "t.glb", "--context-end", "nan"],
    ["--floor-tolerance", "0.02", "--target", "t.glb", "--rest-tolerance", "nan"],
    ["--floor-tolerance", "1" + "0" * 400, "--target", "t.glb"],
])
def test_pack_refuses_numbers_that_are_not_finite(argv, capsys):
    with pytest.raises((SystemExit, pack.PackError)) as exc:
        pack.parse_args(["c.glb", "r.json", "--skeleton", "s.json"] + argv)
    assert isinstance(exc.value, pack.PackError) or exc.value.code == 2


@pytest.mark.parametrize("value", ["nan", "-inf", "-0.01", "x"])
def test_unpack_seam_tolerance_is_a_finite_distance(value, capsys):
    with pytest.raises(SystemExit) as exc:
        unpack.main(["result.json", "out", "--skeleton", "s.json", "--rig", "r.glb", "--seam-tolerance", value])
    assert exc.value.code == 2 and "--seam-tolerance" in capsys.readouterr().err


def test_unpack_reorders_result_joints_and_fills_missing_ones():
    skel = skeleton()
    res = result(skel, segments=(18,))
    order = list(reversed(range(len(skel["joints"]))))
    res["joints"] = [skel["joints"][i] for i in order]
    res["frames"] = [[f[i] for i in order] for f in res["frames"]]
    finger = res["joints"].index("LeftHandThumb1")
    res["joints"].pop(finger)
    res["frames"] = [f[:finger] + f[finger + 1:] for f in res["frames"]]
    frames = unpack.reorder(skel, res)
    assert frames[0][soma.index(skel)["LeftHandThumb1"]] == skel["reference"][soma.index(skel)["LeftHandThumb1"]]
    res["joints"][res["joints"].index("Head")] = "Skull"
    with pytest.raises(ValueError):
        unpack.reorder(skel, res)


# ---------------------------------------------------------------- host check

SMI_OLD = "| NVIDIA-SMI 550.54.14    Driver Version: 550.54.14    CUDA Version: 12.4     |"
SMI_NEW = "| NVIDIA-SMI 621.14                 KMD Version: 621.14        CUDA UMD Version: 13.5     |"
QUERY = ("0, NVIDIA GeForce RTX 3060, 8.6, 550.54.14, 12288, 11800, 00000000:01:00.0\n"
         "1, Tesla P100-PCIE-16GB, 6.0, 550.54.14, 16384, 16000, 00000000:02:00.0\n")


def test_nvidia_smi_parsing():
    gpus = host_check.parse_gpus(QUERY)
    assert gpus[0] == {"index": 0, "name": "NVIDIA GeForce RTX 3060", "computeCapability": "8.6", "driver": "550.54.14",
                       "memoryTotalMiB": 12288, "memoryFreeMiB": 11800, "pciBusId": "00000000:01:00.0"}
    assert host_check.parse_cuda_version(SMI_OLD) == (12, 4)
    assert host_check.parse_cuda_version(SMI_NEW) == (13, 5)
    assert host_check.parse_cuda_version("no header") is None
    assert host_check.parse_gpus("") == []


def facts(**over):
    base = {"os": "Linux", "machine": "x86_64", "glibc": "2.35", "nvidiaSmi": True,
            "gpus": host_check.parse_gpus(QUERY)[:1], "driverCuda": "12.4", "uv": "uv 0.9", "gitLfs": "git-lfs/3.5",
            "diskFreeBytes": 50e9, "diskPath": "/data", "precision": "fp32", "tf32": None, "device": "cuda:0",
            "cudaDeviceOrder": None, "motionbricks": None}
    base.update(over)
    return base


def status(reqs):
    return {r["id"]: r["status"] for r in reqs}


def test_a_qualifying_host_without_install_qualifies_but_is_not_ready():
    report = host_check.summarize(facts(), host_check.evaluate(facts()))
    s = status(report["requirements"])
    assert s["os"] == s["nvidia-gpu"] == s["compute-capability"] == s["device"] == s["driver"] == s["driver-cuda"] == s["glibc"] == "pass"
    assert report["qualifies"] is True and report["ready"] is False and s["motionbricks"] == "unknown"


@pytest.mark.parametrize("over, failing", [
    ({"os": "Darwin", "machine": "arm64", "nvidiaSmi": False, "gpus": []}, {"os", "nvidia-gpu"}),
    ({"gpus": [{"index": 0, "name": "Tesla P100", "computeCapability": "6.0", "driver": "550.1"}]}, {"compute-capability"}),
    ({"gpus": [{"index": 0, "name": "RTX", "computeCapability": "8.6", "driver": "470.82"}], "driverCuda": "11.4"}, {"driver", "driver-cuda"}),
    ({"glibc": "2.17"}, {"glibc"}),
    ({"nvidiaSmi": True, "gpus": []}, {"nvidia-gpu"}),
])
def test_unmet_requirements_fail_and_disqualify(over, failing):
    report = host_check.summarize(facts(**over), host_check.evaluate(facts(**over)))
    failed = {r["id"] for r in report["requirements"] if r["status"] == "fail"}
    assert failing <= failed and report["qualifies"] is False and report["missing"]


@pytest.mark.parametrize("device", ["cuda:1", "cpu"])  # one GPU: cuda:1 names none; cpu is no CUDA device
def test_a_device_that_names_no_gpu_fails_but_the_machine_still_qualifies(device):
    report = host_check.summarize(facts(device=device), host_check.evaluate(facts(device=device)))
    s = status(report["requirements"])
    assert s["device"] == "fail" and s["compute-capability"] == "pass"
    assert report["qualifies"] is True and report["ready"] is False


def test_the_gpu_the_device_names_is_judged_and_every_gpu_reported():
    two = host_check.parse_gpus(QUERY)  # cuda:? = RTX 3060 (passes) or P100 (fails)
    # CUDA orders devices fastest first and nvidia-smi by bus, so without more an ordinal is not a GPU: the machine
    # qualifies on its RTX 3060, and is not ready until it is known which GPU the device is.
    report = host_check.summarize(facts(gpus=two), host_check.evaluate(facts(gpus=two)))
    s = status(report["requirements"])
    assert s["compute-capability"] == "pass" and s["device"] == "unknown"
    assert report["qualifies"] is True and report["ready"] is False
    found = next(r["found"] for r in report["requirements"] if r["id"] == "device")
    assert "--import-check" in found and "CUDA_DEVICE_ORDER=PCI_BUS_ID" in found and "RTX 3060" in found and "P100" in found
    # With bus order set, the ordinal is nvidia-smi's index.
    assert status(host_check.evaluate(facts(gpus=two, cudaDeviceOrder="PCI_BUS_ID", device="cuda:1")))["device"] == "fail"
    assert status(host_check.evaluate(facts(gpus=two, cudaDeviceOrder="PCI_BUS_ID")))["device"] == "pass"
    # The import check says which GPU Warp's device is, by bus id.
    seen = {"path": "/mb", "exists": False, "imports": {"cuda": True, "device": "same name", "pciBusId": "00000000:02:00"}}
    gpu, how = host_check.select_gpu(facts(gpus=two, motionbricks=seen, device="cuda:0"))  # Warp's form of the bus id
    assert gpu["name"] == "Tesla P100-PCIE-16GB" and how == "as Warp reported it"
    # When every GPU is judged alike, which one it is does not matter.
    good = [dict(g, computeCapability="8.6") for g in two]
    assert status(host_check.evaluate(facts(gpus=good)))["device"] == "pass"
    # No GPU that meets it: the machine does not qualify.
    old = [dict(g, computeCapability="6.0") for g in two]
    report = host_check.summarize(facts(gpus=old), host_check.evaluate(facts(gpus=old)))
    assert status(report["requirements"])["compute-capability"] == "fail" and report["qualifies"] is False


def test_a_plan_for_one_of_several_gpus_is_not_called_fitting_while_the_device_is_unknown():
    two = [dict(g, computeCapability="8.6") for g in host_check.parse_gpus(QUERY)]  # both qualify; the plan is for the first
    mb = {"path": "/mb", "exists": True, "version": "0.2.0", "venvPython": "/py", "venvPythonVersion": "3.12.7",
          "onnx": {"file": "mmm_v6_soma_fp32.onnx", "present": True, "lfsPointer": False, "bytes": 1, "sha256": "aa"},
          "tensorrt": "10.8.0.43", "planEntries": [plan_meta()]}
    plan = next(r for r in host_check.evaluate(facts(gpus=two, motionbricks=copy.deepcopy(mb))) if r["id"] == "plan")
    assert plan["status"] == "warn" and "which GPU the device is" in plan["found"]
    known = facts(gpus=two, motionbricks=copy.deepcopy(mb), cudaDeviceOrder="PCI_BUS_ID")
    assert status(host_check.evaluate(known))["plan"] == "pass"
    alike = [dict(two[0], index=1, pciBusId="00000000:02:00.0"), two[0]]  # two of the same GPU: the plan fits either
    assert status(host_check.evaluate(facts(gpus=alike, motionbricks=copy.deepcopy(mb))))["plan"] == "pass"


def test_disk_space_is_a_warning_never_a_failure():
    report = host_check.summarize(facts(diskFreeBytes=1e9), host_check.evaluate(facts(diskFreeBytes=1e9)))
    assert status(report["requirements"])["disk"] == "warn" and report["qualifies"] is True
    assert status(host_check.evaluate(facts(diskFreeBytes=None)))["disk"] == "warn"


def test_installed_host_with_a_plan_is_ready():
    mb = {"path": "/mb", "exists": True, "version": "0.2.0",
          "onnx": {"file": "mmm_v6_soma_fp32.onnx", "present": True, "lfsPointer": False, "bytes": 757864273, "sha256": "aa"},
          "venvPython": "/mb/.venv/bin/python", "venvPythonVersion": "3.12.7", "tensorrt": "10.8.0.43",
          "planEntries": [plan_meta()], "imports": {"cuda": True, "tensorrt": "10.8.0.43", "warp": "1.17.0", "device": "RTX"}}
    report = host_check.summarize(facts(motionbricks=mb), host_check.evaluate(facts(motionbricks=mb)))
    assert report["ready"] is True and "install-tools" not in status(report["requirements"])
    lfs = copy.deepcopy(mb)
    lfs["onnx"]["lfsPointer"] = True
    s = status(host_check.evaluate(facts(motionbricks=lfs)))
    assert s["motionbricks"] == "fail"
    noplan = dict(mb, planEntries=[])
    report = host_check.summarize(facts(motionbricks=noplan), host_check.evaluate(facts(motionbricks=noplan)))
    assert status(report["requirements"])["plan"] == "warn" and report["ready"] is True


def plan_meta(**over):
    """Metadata as MotionBricks writes it beside a plan (motionbricks/inference/cache.py, builder.py at v0.2.0)."""
    meta = {"onnx_filename": "mmm_v6_soma_fp32.onnx", "onnx_sha256": "aa", "tensorrt_version": "10.8.0.43",
            "build_options": {"workspace_size_bytes": None, "builder_optimization_level": 3, "batch_size": 1},
            "device": {"name": "NVIDIA GeForce RTX 3060", "architecture": 86},
            "platform": {"system": "Linux", "machine": "x86_64"}, "plan_file": "mmm_v6_soma_fp32-abc.plan"}
    meta.update(over)
    return meta


def test_plan_metadata_is_read_beside_each_plan(tmp_path):
    (tmp_path / "mmm_v6_soma_fp32-abc.json").write_text(json.dumps(plan_meta()))
    (tmp_path / "mmm_v6_soma_fp32-abc.plan").write_bytes(b"plan")
    (tmp_path / "orphan.json").write_text(json.dumps(plan_meta()))  # no plan beside it
    assert host_check.plan_entries(str(tmp_path)) == [plan_meta()]


EXPECT = {"onnxFile": "mmm_v6_soma_fp32.onnx", "onnxSha256": "aa", "tensorrt": "10.8.0.43",
          "buildOptions": host_check.expected_build_options("fp32", None), "system": "Linux", "machine": "x86_64",
          "gpus": host_check.parse_gpus(QUERY)[:1]}


@pytest.mark.parametrize("meta, expect, wrong", [
    (plan_meta(), {}, None),
    (plan_meta(onnx_filename="mmm_v6_soma_fp16.onnx"), {}, "model file mmm_v6_soma_fp16"),
    (plan_meta(onnx_sha256="bb"), {}, "model file hash"),
    (plan_meta(tensorrt_version="10.9.0.1"), {}, "TensorRT version"),
    (plan_meta(platform={"system": "Windows", "machine": "AMD64"}), {}, "platform"),
    (plan_meta(device={"name": "Tesla P100-PCIE-16GB", "architecture": 60}), {}, "GPU"),
    # the build options MotionBricks keys on: FP16, TF32 off, batch size
    (plan_meta(), {"buildOptions": host_check.expected_build_options("fp16", None)}, "build options"),
    (plan_meta(), {"buildOptions": host_check.expected_build_options("fp32", False)}, "build options"),
    (plan_meta(build_options={"workspace_size_bytes": None, "builder_optimization_level": 3, "batch_size": 8}), {}, "build options"),
])
def test_a_plan_fits_only_when_every_cache_key_field_matches(meta, expect, wrong):
    mismatches, unchecked = host_check.plan_mismatches(meta, dict(EXPECT, **expect))
    assert unchecked == []
    if wrong is None:
        assert mismatches == []
    else:
        assert any(m.startswith(wrong) for m in mismatches), mismatches


def test_expected_build_options_follow_motionbricks_cache_payload():
    assert host_check.expected_build_options("fp32", None) == {"workspace_size_bytes": None, "builder_optimization_level": 3, "batch_size": 1}
    assert host_check.expected_build_options("fp16", True)["enable_fp16"] is True
    assert "enable_tf32" not in host_check.expected_build_options("fp16", True)
    assert host_check.expected_build_options("fp32", False)["enable_tf32"] is False


def test_unknown_tensorrt_version_leaves_the_plan_a_warning():
    mb = {"path": "/mb", "exists": True, "version": "0.2.0", "venvPython": "/py", "venvPythonVersion": "3.12.7",
          "onnx": {"file": "mmm_v6_soma_fp32.onnx", "present": True, "lfsPointer": False, "bytes": 1, "sha256": "aa"},
          "tensorrt": None, "planEntries": [plan_meta()]}
    reqs = host_check.evaluate(facts(motionbricks=mb))
    plan = next(r for r in reqs if r["id"] == "plan")
    assert plan["status"] == "warn" and "TensorRT version" in plan["found"]


def test_tensorrt_version_is_read_from_the_environment(tmp_path):
    site = tmp_path / ".venv" / "lib" / "python3.12" / "site-packages"
    (site / "tensorrt_cu12_bindings-10.8.0.43.dist-info").mkdir(parents=True)
    assert host_check.venv_package_version(str(tmp_path), "tensorrt_cu12_bindings") == "10.8.0.43"
    win = tmp_path / "w" / ".venv" / "Lib" / "site-packages" / "tensorrt_cu12_bindings-10.8.0.43.dist-info"
    win.mkdir(parents=True)
    assert host_check.venv_package_version(str(tmp_path / "w"), "tensorrt_cu12_bindings") == "10.8.0.43"
    assert host_check.venv_package_version(str(tmp_path / "none"), "tensorrt_cu12_bindings") is None


def test_lfs_pointer_detection(tmp_path):
    p = tmp_path / "model.onnx"
    p.write_bytes(b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\n")
    assert host_check.is_lfs_pointer(str(p))
    p.write_bytes(b"\x08\x07real onnx")
    assert not host_check.is_lfs_pointer(str(p))


# ---------------------------------------------------------------- landmark map

def test_landmark_map_covers_the_body_and_names_real_soma_joints():
    with open(MAP, encoding="utf-8") as f:
        table = json.load(f)
    assert set(table) == {"label", "notes", "landmarks"}
    body = {"hips", "spine", "chest", "neck", "head"} | {f"{p}.{s}" for p in ("shoulder", "upper-arm", "lower-arm", "hand",
                                                                              "upper-leg", "lower-leg", "foot", "toes") for s in "lr"}
    assert set(table["landmarks"].values()) == body
    assert len(set(table["landmarks"].values())) == len(table["landmarks"])
    model = set(MODEL)
    assert set(table["landmarks"]) <= model, "every mapped joint is one the model animates"


def test_landmark_map_sides_match_soma_positions():
    """Mapped left joints lie on +X (the character's left) in the synthetic SOMA layout, legs below arms."""
    skel = skeleton()
    world = soma.reference_world(skel)
    idx = soma.index(skel)
    with open(MAP, encoding="utf-8") as f:
        table = json.load(f)["landmarks"]
    for joint, lm in table.items():
        x = world[idx[joint]][0][0]
        if lm.endswith(".l"):
            assert x > 0
        elif lm.endswith(".r"):
            assert x < 0
    assert world[idx["LeftShin"]][0][1] < world[idx["LeftLeg"]][0][1] < world[idx["Hips"]][0][1]


def _moving(frames_count, speed_at):
    """Frames of the reference pose whose root travels along +X at speed_at(k) metres per frame."""
    skel = skeleton()
    frames, x = [], 0.0
    for k in range(frames_count):
        if k:
            x += speed_at(k)
        pose = [list(t) for t in skel["reference"]]
        pose[0][0] = x
        frames.append(pose)
    return skel, frames


def seam(speed_at, tolerance=0.03):
    """The seam of a two-generation clip (frame 19 ends the first, the seam is the step into frame 20) whose root
    travels along +X at speed_at(k) metres per frame."""
    res = result(skeleton(), segments=(20, 18))  # 37 frames
    skel, frames = _moving(37, speed_at)
    return unpack.steps(skel, frames, res, tolerance=tolerance)


@pytest.mark.parametrize("name, speed_at, jump", [
    ("forward jump, from stillness", lambda k: 0.05 if k == 20 else 0.0, 0.05),
    ("forward jump while moving", lambda k: 0.25 if k == 20 else 0.05, 0.20),
    ("backward jump while moving forward", lambda k: -0.05 if k == 20 else 0.15, 0.20),
    ("small backward jump while moving forward", lambda k: -0.03 if k == 20 else 0.05, 0.08),
])
def test_a_jump_at_a_seam_pops_whichever_way_it_goes(name, speed_at, jump):
    s = seam(speed_at)["seams"][0]
    assert s["frame"] == 20 and abs(s["metres"] - jump) < 1e-4 and s["around"] == 0.0 and s["ratio"] is None
    assert abs(s["excess"] - jump) < 1e-4 and s["pops"] is True, name


@pytest.mark.parametrize("name, speed_at", [
    ("steady", lambda k: 0.05),
    ("accelerating", lambda k: 0.01 + 0.0005 * k),
    ("a sharp, smooth speed peak on the seam", lambda k: 0.2 * max(0.0, math.cos(math.pi * (k - 20) / 6))),
])
def test_smooth_motion_through_a_seam_does_not_pop(name, speed_at):
    s = seam(speed_at, tolerance=0.0)["seams"][0]
    assert s["excess"] <= 1e-6 and s["pops"] is False, name


def test_a_seam_is_judged_against_its_own_neighbourhood_and_the_persons_tolerance():
    # a 4 cm jump at the seam, with a 20 cm step elsewhere in the clip that must not hide it
    report = seam(lambda k: 0.05 if k == 20 else 0.20 if k == 30 else 0.01, tolerance=0.02)
    s = report["seams"][0]
    assert report["largest"]["metres"] == 0.2 and s["excess"] == 0.04 and s["pops"] is True
    assert seam(lambda k: 0.05 if k == 20 else 0.01, tolerance=0.05)["seams"][0]["pops"] is False
    assert seam(lambda k: 0.05 if k == 20 else 0.01, tolerance=None)["seams"][0]["pops"] is None  # no tolerance, no judgement
