"""soma_skeleton.py, make_test_poses.py, pack.py and unpack.py run for real, in Blender, on a synthetic skeleton with
SOMA's joint names (no NVIDIA data). The generation itself is stood in for by a result built from the request's own
poses, so no GPU or MotionBricks is needed. Skipped when Blender is absent: set JAM_BLENDER to its executable (or have
`blender` on PATH) to run them."""
import json
import math
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate  # noqa: E402
import make_test_poses  # noqa: E402
from mbx import math3d as m, soma  # noqa: E402
from test_motionbricks import FEET, skeleton  # noqa: E402


def find_blender():
    for candidate in (os.environ.get("JAM_BLENDER"), shutil.which("blender"), "/Applications/Blender.app/Contents/MacOS/Blender"):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


BLENDER = find_blender()
pytestmark = pytest.mark.skipif(BLENDER is None, reason="Blender not found: set JAM_BLENDER to its executable to run these tests")


def blender(script, *args):
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python",
                           os.path.join(HERE, script), "--"] + [str(a) for a in args], capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


def summary(log):
    return json.JSONDecoder().raw_decode(log[log.index('{\n  "request"'):])[0]


def max_error(skel, a, b):
    wa, wb = m.forward_kinematics(skel["parents"], a), m.forward_kinematics(skel["parents"], b)
    return (max(m.vlen(m.vsub(x[0], y[0])) for x, y in zip(wa, wb)),
            max(m.qangle(x[1], y[1]) for x, y in zip(wa, wb)))


@pytest.fixture(scope="module")
def rig(tmp_path_factory):
    folder = tmp_path_factory.mktemp("soma")
    skel = skeleton()
    (folder / "soma-skeleton.json").write_text(json.dumps(skel))
    code, log = blender("soma_skeleton.py", folder / "soma-skeleton.json", folder / "soma-skeleton.glb")
    assert code == 0, log[-3000:]
    code, log = blender("make_test_poses.py", folder / "soma-skeleton.json", folder / "soma-skeleton.glb", folder / "poses")
    assert code == 0, log[-3000:]
    return folder, skel


def pack(folder, out, *extra):
    return blender("pack.py", folder / "poses" / "context.glb", out, "--skeleton", folder / "soma-skeleton.json",
                   "--target", folder / "poses" / "target-ahead.glb", "--target", str(folder / "poses" / "target-turn.glb") + ",early=4,tokens=10-12",
                   *extra)


def test_pack_reads_back_the_constructed_poses(rig, tmp_path):
    folder, skel = rig
    code, log = pack(folder, tmp_path / "request.json", "--precision", "fp16")
    assert code == 0, log[-3000:]
    req = json.loads((tmp_path / "request.json").read_text())
    assert generate.validate_request(req) == []
    assert req["inference"] == {"precision": "fp16", "backend": "tensorrt", "tf32": None}
    assert [len(t["poses"]) for t in req["targets"]] == [1, 1]
    assert req["targets"][1]["transitionEarlyBy"] == 4 and req["targets"][1]["tokens"] == {"min": 10, "max": 12}
    expected = [make_test_poses.standing(skel, 0.0, 0.0, 0.0), make_test_poses.standing(skel, 0.0, 1.5, 0.0),
                make_test_poses.standing(skel, 1.0, 1.5, math.pi / 2)]
    got = [req["context"]["poses"][3], req["targets"][0]["poses"][0], req["targets"][1]["poses"][0]]
    for e, g in zip(expected, got):
        dp, da = max_error(skel, e, g)
        assert dp < 1e-5 and da < 1e-4
    printed = summary(log)
    assert printed["targets"][0]["groundDistance"] == 1.5 and printed["context"]["floor"]["nearGround"] is True
    assert [s["role"] for s in req["sources"]] == ["context", "target 0", "target 1"]


def test_pack_refuses_a_rig_whose_rest_is_not_soma(rig, tmp_path):
    folder, skel = rig
    stretched = json.loads(json.dumps(skel))
    forearm = stretched["reference"][soma.index(skel)["LeftForeArm"]]
    forearm[:3] = [v * 1.2 for v in forearm[:3]]  # a longer upper arm
    (tmp_path / "other.json").write_text(json.dumps(stretched))
    code, log = blender("soma_skeleton.py", tmp_path / "other.json", tmp_path / "other.glb")
    assert code == 0, log[-3000:]
    code, log = blender("make_test_poses.py", tmp_path / "other.json", tmp_path / "other.glb", tmp_path / "poses")
    assert code == 0, log[-3000:]
    code, log = blender("pack.py", tmp_path / "poses" / "context.glb", tmp_path / "request.json", "--skeleton",
                        folder / "soma-skeleton.json", "--target", tmp_path / "poses" / "target-ahead.glb")
    assert code == 1 and "rest pose is not SOMA's" in log


def stand_in_result(skel, req, frames_per_segment=20):
    """A result shaped like generate.py's: each segment eases the root from the last pose to the target pose."""
    clip, start = [], req["context"]["poses"][-1]
    segments = []
    for n, t in enumerate(req["targets"]):
        end = t["poses"][0]
        seg = []
        for k in range(frames_per_segment):
            a = k / (frames_per_segment - 1)
            pose = [list(j) for j in (start if a < 0.5 else end)]
            pose[0][:3] = [s + (e - s) * a for s, e in zip(start[0][:3], end[0][:3])]
            seg.append(pose)
        generate.join_segment(clip, seg, n == 0)
        segments.append({"target": n, "generatedFrames": frames_per_segment, "playedFrames": frames_per_segment,
                         "tokens": (frames_per_segment + 6) // 4, "transitionEarlyBy": 0})
        start = end
    return {"format": generate.RESULT_FORMAT, "fps": 30, "joints": req["joints"], "frames": clip,
            "root": [p[0] for p in clip], "contacts": {"joints": FEET, "values": [[1.0, 1.0, 0.0, 0.25]] * len(clip)},
            "segments": segments, "inference": {"precision": "fp32"}, "model": {"motionbricksVersion": "test"}}


def test_unpack_writes_a_clip_that_reads_back_as_the_result(rig, tmp_path):
    folder, skel = rig
    code, log = pack(folder, tmp_path / "request.json")
    assert code == 0, log[-3000:]
    req = json.loads((tmp_path / "request.json").read_text())
    res = stand_in_result(skel, req)
    assert generate.validate_result(res) == []
    (tmp_path / "result.json").write_text(json.dumps(res))
    out = tmp_path / "out"
    code, log = blender("unpack.py", tmp_path / "result.json", out, "--skeleton", folder / "soma-skeleton.json",
                        "--rig", folder / "soma-skeleton.glb")
    assert code == 0, log[-3000:]
    report = json.loads((out / "unpack-report.json").read_text())
    assert report["frames"] == len(res["frames"]) == 39
    assert report["root"]["end"] == [round(v, 4) for v in res["frames"][-1][0][:3]]
    contacts = json.loads((out / "contacts.json").read_text())
    assert contacts["joints"] == FEET and len(contacts["values"]) == 39

    # The written clip, packed again frame by frame as a context, gives back the result's poses.
    last = len(res["frames"]) - 1
    code, log = blender("pack.py", out / "generated.glb", tmp_path / "again.json", "--skeleton", folder / "soma-skeleton.json",
                        "--target", str(out / "generated.glb") + ",poses=4", "--context-end", str(last / 30))
    assert code == 0, log[-3000:]
    again = json.loads((tmp_path / "again.json").read_text())
    for packed, expected in zip(again["context"]["poses"], res["frames"][last - 3:]):
        dp, da = max_error(skel, packed, expected)
        assert dp < 1e-5 and da < 1e-4
    for packed, expected in zip(again["targets"][0]["poses"], res["frames"][:4]):
        dp, da = max_error(skel, packed, expected)
        assert dp < 1e-5 and da < 1e-4


def test_clip_strip_renders_the_clip(rig, tmp_path):
    folder, _ = rig
    code, log = blender("clip_strip.py", folder / "poses" / "context.glb", tmp_path / "strip.png", "--every", "3")
    assert code == 0, log[-3000:]
    assert (tmp_path / "strip.png").stat().st_size > 1000
    assert '"frames": [0, 3, 6, 7]' in log
