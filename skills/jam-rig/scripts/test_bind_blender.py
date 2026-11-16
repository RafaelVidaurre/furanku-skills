"""bind.py and pose_evidence.py run for real, in Blender, on the generated test figure. Skipped when Blender is absent:
set JAM_BLENDER to its executable (or have `blender` on PATH) to run them."""
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jamrig import gltf, landmarks as lm  # noqa: E402

PROFILE = os.path.join(os.path.dirname(HERE), "assets", "profiles", "vrm-humanoid.json")


def find_blender():
    for candidate in (os.environ.get("JAM_BLENDER"), shutil.which("blender"), "/Applications/Blender.app/Contents/MacOS/Blender"):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


BLENDER = find_blender()
pytestmark = pytest.mark.skipif(BLENDER is None, reason="Blender not found: set JAM_BLENDER to its executable to run the bind tests")


def blender(script, *args):
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", os.path.join(HERE, script), "--"] + list(args),
                          capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def figure(tmp_path_factory):
    folder = str(tmp_path_factory.mktemp("figure"))
    code, log = blender("make_test_humanoid.py", folder)
    assert code == 0, log[-2000:]
    return folder


def bind(figure, out, *extra):
    code, log = blender("bind.py", os.path.join(figure, "humanoid.glb"), os.path.join(figure, "landmarks.json"), out, *extra)
    return code, log, read(os.path.join(out, "rig-report.json"))


def test_landmark_skeleton_passes_and_loads_as_a_skinned_mesh(figure, tmp_path):
    out = str(tmp_path / "plain")
    code, log, report = bind(figure, out)
    assert code == 0, log[-2000:]
    assert report["passed"] and report["deformationCheck"]["failures"] == [] and report["warnings"] == []
    assert [b["name"] for b in report["skeleton"]["bones"]] and {b["name"] for b in report["skeleton"]["bones"]} == set(lm.ALL)
    assert report["weights"]["maxInfluences"] <= 4 and report["weights"]["fingerVerticesByPosition"] > 0
    assert all(r["meanOwnWeight"] >= 0.5 for r in report["deformationCheck"]["regions"].values())
    seen = gltf.verify_skinned(os.path.join(out, "rigged.glb"), 4)
    assert seen["problems"] == [] and set(seen["joints"]) == set(lm.ALL) and seen["roots"] == ["hips"]
    assert {i["role"] for i in report["inputs"]} == {"mesh", "landmarks"} and all(len(i["sha256"]) == 64 for i in report["inputs"] + report["outputs"])
    assert os.path.isfile(os.path.join(out, "rigged.blend"))

    poses = str(tmp_path / "poses")
    code, log = blender("pose_evidence.py", os.path.join(out, "rigged.glb"), poses, "--poses", "rest,knee-bend,fingers-curled", "--size", "120x160", "--samples", "2")
    assert code == 0, log[-2000:]
    manifest = read(os.path.join(poses, "pose-manifest.json"))
    assert [p["id"] for p in manifest["poses"]] == ["rest", "knee-bend", "fingers-curled"] and manifest["skipped"] == []
    assert manifest["poses"][0]["maxEdgeStretch"] == 1.0 and manifest["poses"][1]["maxEdgeStretch"] > 1.0
    assert all(os.path.getsize(os.path.join(poses, name)) > 0 for name in ("rest.png", "knee-bend.png", "fingers-curled.png", "pose-sheet.png"))


def test_profile_skeleton_passes_with_its_own_names_and_spine(figure, tmp_path):
    out = str(tmp_path / "profile")
    code, log, report = bind(figure, out, "--profile", PROFILE)
    assert code == 0, log[-2000:]
    profile = read(PROFILE)
    assert report["passed"] and {b["name"]: b["parent"] for b in report["skeleton"]["bones"]} == profile["hierarchy"]
    seen = gltf.verify_skinned(os.path.join(out, "rigged.glb"), 4)
    assert seen["problems"] == [] and set(seen["joints"]) == set(profile["hierarchy"]) and seen["roots"] == ["hips"]
    model = gltf.Gltf(os.path.join(out, "rigged.glb"))
    parents = {name: parent for name, parent, _ in model.skin_joints()}
    assert parents["upperChest"] == "chest" and parents["chest"] == "spine" and parents["leftShoulder"] == "upperChest"


def test_mittens_world_axes_proxy_weights_and_a_lower_limit(figure, tmp_path):
    out = str(tmp_path / "options")
    code, log, report = bind(figure, out, "--fingers", "none", "--bone-axes", "world", "--weights", "proxy", "--max-influences", "2", "--name", "hero")
    assert code == 0, log[-2000:]
    assert report["passed"] and report["weights"]["method"] == "heat-on-proxy" and len(report["skeleton"]["bones"]) == len(lm.CORE)
    seen = gltf.verify_skinned(os.path.join(out, "hero.glb"), 2)
    assert seen["problems"] == [] and seen["maxInfluences"] <= 2
    model = gltf.Gltf(os.path.join(out, "hero.glb"))
    joints = [n for n in model.nodes if n.get("name") in lm.CORE]
    assert len(joints) == len(lm.CORE)
    for node in joints:                                             # every joint keeps the world's axes at rest
        x, y, z, w = node.get("rotation", [0, 0, 0, 1])
        assert abs(x) < 1e-4 and abs(y) < 1e-4 and abs(z) < 1e-4 and abs(abs(w) - 1) < 1e-4, node["name"]


def test_landmarks_of_another_size_are_refused_with_the_report(figure, tmp_path):
    marks = read(os.path.join(figure, "landmarks.json"))
    marks["landmarks"] = {k: [x * 2 for x in v] for k, v in marks["landmarks"].items()}
    other = str(tmp_path / "double.json")
    with open(other, "w", encoding="utf-8") as f:
        json.dump(marks, f)
    out = str(tmp_path / "bad")
    code, log = blender("bind.py", os.path.join(figure, "humanoid.glb"), other, out)
    assert code == 1 and "the landmarks do not fit this mesh" in log
    report = read(os.path.join(out, "rig-report.json"))
    assert report["passed"] is False and "outside the mesh's bounding box" in report["error"]
    assert not os.path.exists(os.path.join(out, "rigged.glb"))
    # the same landmarks fit once the mesh is brought to their size
    code, log, report = bind(figure, str(tmp_path / "scaled"), "--height-meters", "3.4")
    assert code == 1 and "the landmarks do not fit this mesh" in report["error"]  # the 1.7 m landmarks against a 3.4 m mesh
    code, log = blender("bind.py", os.path.join(figure, "humanoid.glb"), other, str(tmp_path / "scaled"), "--height-meters", "3.4")
    assert code == 0, log[-2000:]
