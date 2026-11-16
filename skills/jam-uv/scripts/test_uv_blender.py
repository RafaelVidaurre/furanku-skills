"""The Blender scripts of jam-uv, run on generated fixtures. Skipped when Blender is not installed.

Run: python3 -m pytest skills/jam-uv/scripts/test_uv_blender.py -q   (set BLENDER to a Blender binary to choose one)
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import uv_report  # noqa: E402

BLENDER = os.environ.get("BLENDER") or shutil.which("blender") or next(
    (p for p in ("/Applications/Blender.app/Contents/MacOS/Blender",) if os.path.exists(p)), None)
pytestmark = pytest.mark.skipif(not BLENDER, reason="Blender is not installed (set BLENDER to its binary, or put `blender` on PATH); the Blender scripts were not exercised")


def blender(script, *arguments):
    return subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", os.path.join(HERE, "blender", script), "--", *map(str, arguments)],
                          capture_output=True, text=True, timeout=600)


@pytest.fixture(scope="module")
def models(tmp_path_factory):
    folder = tmp_path_factory.mktemp("uv-fixtures")
    result = blender("make_fixtures.py", folder)
    assert result.returncode == 0, result.stderr[-2000:]
    return folder


def unwrap_report(folder):
    return json.loads((folder / "unwrap-report.json").read_text())


def test_an_open_tube_is_cut_once_and_lies_flat_as_one_island(models, tmp_path):
    result = blender("unwrap.py", models / "tube.glb", tmp_path, "--texture-size", 512, "--method", "seams")
    assert result.returncode == 0, result.stderr[-2000:]
    report = unwrap_report(tmp_path)
    assert report["used"] == "seams" and report["passed"]
    assert report["attempts"][-1]["seams"]["Cylinder"]["cuts"]["tube"] == 1
    metrics = report["attempts"][-1]["layouts"][0]["metrics"]
    assert metrics["islands"] == 1 and metrics["overlapShare"] == 0 and metrics["uvSetsPerPrimitive"]["max"] == 1
    assert uv_report.main([str(tmp_path / "tube.glb"), "--out", str(tmp_path / "report"), "--texture-size", "512", "--same-geometry-as", str(models / "tube.glb"), "--no-layout"]) == 0


def test_a_loop_hint_adds_a_seam_around_the_tube(models, tmp_path):
    result = blender("unwrap.py", models / "tube.glb", tmp_path, "--texture-size", 512, "--seam-hints", models / "tube-hints.json")
    assert result.returncode == 0, result.stderr[-2000:]
    report = unwrap_report(tmp_path)
    assert report["attempts"][-1]["seams"]["Cylinder"]["loops"] == {"middle": 16}
    assert report["attempts"][-1]["layouts"][0]["metrics"]["islands"] == 2


def test_a_box_with_two_materials_gets_one_padded_layout(models, tmp_path):
    result = blender("unwrap.py", models / "box.glb", tmp_path, "--texture-size", 256, "--name", "crate")
    assert result.returncode == 0, result.stderr[-2000:]
    metrics = unwrap_report(tmp_path)["attempts"][-1]["layouts"][0]["metrics"]
    assert metrics["islands"] == 6 and metrics["densitySpreadP95overP5"] < 1.1
    assert uv_report.main([str(tmp_path / "crate.glb"), "--out", str(tmp_path / "report"), "--texture-size", "256", "--no-layout"]) == 0


def test_a_closed_smooth_shape_passes_the_thresholds_by_one_method_or_the_other(models, tmp_path):
    result = blender("unwrap.py", models / "capsule.glb", tmp_path, "--texture-size", 512)
    assert result.returncode == 0, result.stderr[-2000:]
    report = unwrap_report(tmp_path)
    assert report["passed"] and report["used"] in ("seams", "smart")


def test_thresholds_that_cannot_be_met_fail_with_the_files_left_for_inspection(models, tmp_path):
    result = blender("unwrap.py", models / "capsule.glb", tmp_path, "--texture-size", 512, "--method", "seams", "--max-density-spread", 1.0001)
    assert result.returncode == 1 and "density-spread" in result.stderr
    assert (tmp_path / "capsule.glb").exists() and not unwrap_report(tmp_path)["passed"]


def test_checker_stills_need_uvs(models, tmp_path):
    bare = blender("render_checker.py", models / "box.glb", tmp_path / "bare")
    assert bare.returncode == 1 and "no UVs" in bare.stderr
    assert blender("unwrap.py", models / "box.glb", tmp_path / "uv", "--texture-size", 256).returncode == 0
    result = blender("render_checker.py", tmp_path / "uv" / "box.glb", tmp_path / "stills", "--views", "three-quarter", "--resolution", 200)
    assert result.returncode == 0, result.stderr[-2000:]
    assert sorted(os.listdir(tmp_path / "stills")) == ["box-checker-sheet.png", "box-checker-three-quarter.png"]


def test_wrong_input_exits_2(models, tmp_path):
    assert blender("unwrap.py", models / "box.glb", tmp_path, "--texture-size", 256, "--seam-hints", tmp_path / "none.json").returncode == 2
    assert blender("unwrap.py", models / "box.glb", tmp_path).returncode == 2
