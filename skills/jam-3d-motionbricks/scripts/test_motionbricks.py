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
LANDMARKS_SCHEMA = os.path.join(SKILL, "..", "jam-setup", "assets", "toolkit", "schemas", "landmarks.schema.json")

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
            "root": [p[0] for p in poses], "contacts": {"joints": FEET, "values": [[0.5, 0.5, 1.0, 0.0]] * frames},
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


def test_check_command_reports_validity(tmp_path, capsys):
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request(skeleton())))
    assert generate.main(["check", str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["valid"] is True
    bad = request(skeleton())
    bad["fps"] = 24
    path.write_text(json.dumps(bad))
    assert generate.main(["check", str(path)]) == 1


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


def test_pack_target_summary_reports_distance_and_implied_speeds():
    pose_a = [[0, 1, 0, 0, 0, 0, 1]]
    pose_b = [[0, 1, 1.5, 0, 0, 0, 1]]
    s = pack.target_summary(pose_a, pose_b, 4)
    assert s["groundDistance"] == 1.5
    assert s["impliedSpeed"]["atMaxFrames"] == round(1.5 * 30 / 57, 3)
    assert s["impliedSpeed"]["atMinFrames"] == round(1.5 * 30 / 17, 3)


def test_pack_target_options_parse():
    t = pack.parse_target("t.glb,poses=4,start=0.5,early=10,tokens=9-9")
    assert t == {"file": "t.glb", "poses": 4, "start": 0.5, "early": 10, "tokens": {"min": 9, "max": 9}}
    with pytest.raises(pack.PackError):
        pack.parse_target("t.glb,poses=5")
    with pytest.raises(pack.PackError):
        pack.parse_target("t.glb,speed=2")


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
QUERY = "NVIDIA GeForce RTX 3060, 8.6, 550.54.14, 12288, 11800\nTesla P100-PCIE-16GB, 6.0, 550.54.14, 16384, 16000\n"


def test_nvidia_smi_parsing():
    gpus = host_check.parse_gpus(QUERY)
    assert gpus[0] == {"name": "NVIDIA GeForce RTX 3060", "computeCapability": "8.6", "driver": "550.54.14",
                       "memoryTotalMiB": 12288, "memoryFreeMiB": 11800}
    assert host_check.parse_cuda_version(SMI_OLD) == (12, 4)
    assert host_check.parse_cuda_version(SMI_NEW) == (13, 5)
    assert host_check.parse_cuda_version("no header") is None
    assert host_check.parse_gpus("") == []


def facts(**over):
    base = {"os": "Linux", "machine": "x86_64", "glibc": "2.35", "nvidiaSmi": True,
            "gpus": host_check.parse_gpus(QUERY)[:1], "driverCuda": "12.4", "uv": "uv 0.9", "gitLfs": "git-lfs/3.5",
            "diskFreeBytes": 50e9, "diskPath": "/data", "precision": "fp32", "motionbricks": None}
    base.update(over)
    return base


def status(reqs):
    return {r["id"]: r["status"] for r in reqs}


def test_a_qualifying_host_without_install_qualifies_but_is_not_ready():
    report = host_check.summarize(facts(), host_check.evaluate(facts()))
    s = status(report["requirements"])
    assert s["os"] == s["nvidia-gpu"] == s["compute-capability"] == s["driver"] == s["driver-cuda"] == s["glibc"] == "pass"
    assert report["qualifies"] is True and report["ready"] is False and s["motionbricks"] == "unknown"


@pytest.mark.parametrize("over, failing", [
    ({"os": "Darwin", "machine": "arm64", "nvidiaSmi": False, "gpus": []}, {"os", "nvidia-gpu"}),
    ({"gpus": [{"name": "Tesla P100", "computeCapability": "6.0", "driver": "550.1", "memoryTotalMiB": 1, "memoryFreeMiB": 1}]}, {"compute-capability"}),
    ({"gpus": [{"name": "RTX", "computeCapability": "8.6", "driver": "470.82", "memoryTotalMiB": 1, "memoryFreeMiB": 1}], "driverCuda": "11.4"}, {"driver", "driver-cuda"}),
    ({"glibc": "2.17"}, {"glibc"}),
    ({"nvidiaSmi": True, "gpus": []}, {"nvidia-gpu"}),
])
def test_unmet_requirements_fail_and_disqualify(over, failing):
    report = host_check.summarize(facts(**over), host_check.evaluate(facts(**over)))
    failed = {r["id"] for r in report["requirements"] if r["status"] == "fail"}
    assert failing <= failed and report["qualifies"] is False and report["missing"]


def test_the_best_gpu_is_judged_when_there_are_several():
    s = status(host_check.evaluate(facts(gpus=host_check.parse_gpus(QUERY))))
    assert s["compute-capability"] == "pass"


def test_installed_host_with_a_plan_is_ready():
    mb = {"path": "/mb", "exists": True, "version": "0.2.0",
          "onnx": {"file": "mmm_v6_soma_fp32.onnx", "present": True, "lfsPointer": False, "bytes": 757864273},
          "venvPython": "/mb/.venv/bin/python", "venvPythonVersion": "3.12.7",
          "plans": [{"fitsThisHost": True}], "imports": {"cuda": True, "tensorrt": "10.8.0.43", "warp": "1.17.0", "device": "RTX"}}
    report = host_check.summarize(facts(motionbricks=mb), host_check.evaluate(facts(motionbricks=mb)))
    assert report["ready"] is True and "install-tools" not in status(report["requirements"])
    lfs = copy.deepcopy(mb)
    lfs["onnx"]["lfsPointer"] = True
    s = status(host_check.evaluate(facts(motionbricks=lfs)))
    assert s["motionbricks"] == "fail"
    noplan = dict(mb, plans=[])
    report = host_check.summarize(facts(motionbricks=noplan), host_check.evaluate(facts(motionbricks=noplan)))
    assert status(report["requirements"])["plan"] == "warn" and report["ready"] is True


def test_plan_metadata_matching(tmp_path):
    meta = {"onnx_filename": "mmm_v6_soma_fp32.onnx", "device": {"name": "NVIDIA GeForce RTX 3060", "architecture": 86},
            "platform": {"system": "Linux"}, "tensorrt_version": "10.8.0.43", "build_options": {"batch_size": 1}}
    (tmp_path / "mmm_v6_soma_fp32-abc.json").write_text(json.dumps(meta))
    (tmp_path / "mmm_v6_soma_fp32-abc.plan").write_bytes(b"plan")
    (tmp_path / "orphan.json").write_text(json.dumps(meta))  # no plan beside it
    entries = host_check.plan_entries(str(tmp_path))
    assert len(entries) == 1
    gpus = host_check.parse_gpus(QUERY)
    assert host_check.plan_matches(entries[0], "fp32", gpus, "Linux")
    assert not host_check.plan_matches(entries[0], "fp16", gpus, "Linux")
    assert not host_check.plan_matches(entries[0], "fp32", gpus, "Windows")
    assert not host_check.plan_matches(entries[0], "fp32", gpus[1:], "Linux")


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
    if os.path.isfile(LANDMARKS_SCHEMA):
        with open(LANDMARKS_SCHEMA, encoding="utf-8") as f:
            vocabulary = json.dumps(json.load(f))
        assert all(f'"{lm}"' in vocabulary for lm in body)


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


def test_unpack_steps_find_the_seam_between_generations():
    skel = skeleton()
    res = result(skel, segments=(20, 18))
    still = [list(t) for t in skel["reference"]]
    frames = [[list(t) for t in still] for _ in range(37)]
    for k in range(20, 37):
        frames[k][0][0] = 0.05  # the root shifts 5 cm right after the first generation's last frame (index 19)
    report = unpack.steps(skel, frames, res)
    assert [(s["metres"], s["frame"]) for s in report["seams"]] == [(0.05, 20)]  # every joint moves with the root
    assert report["largest"]["metres"] == 0.05
