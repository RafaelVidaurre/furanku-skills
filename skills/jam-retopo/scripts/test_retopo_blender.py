"""The Blender scripts of jam-retopo, run on generated fixtures. Skipped when Blender is not installed.

Run: python3 -m pytest skills/jam-retopo/scripts/test_retopo_blender.py -q   (set BLENDER to a Blender binary to choose one)
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import topology_report  # noqa: E402

BLENDER = os.environ.get("BLENDER") or shutil.which("blender") or next(
    (p for p in ("/Applications/Blender.app/Contents/MacOS/Blender",) if os.path.exists(p)), None)
pytestmark = pytest.mark.skipif(not BLENDER, reason="Blender is not installed (set BLENDER to its binary, or put `blender` on PATH); the Blender scripts were not exercised")


def blender(script, *arguments):
    return subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", os.path.join(HERE, "blender", script), "--", *map(str, arguments)],
                          capture_output=True, text=True, timeout=600)


@pytest.fixture(scope="module")
def models(tmp_path_factory):
    folder = tmp_path_factory.mktemp("retopo-fixtures")
    result = blender("make_fixtures.py", folder)
    assert result.returncode == 0, result.stderr[-2000:]
    return folder


def test_decimate_reaches_the_budget_and_stays_on_the_source(models, tmp_path):
    result = blender("decimate.py", models / "dense.glb", tmp_path, "--target-triangles", 1000, "--name", "low")
    assert result.returncode == 0, result.stderr[-2000:]
    report = json.loads((tmp_path / "decimate-report.json").read_text())
    assert report["before"]["exportTriangles"] == 5120 and report["after"]["exportTriangles"] <= 1000
    assert report["deviationShareOfDiagonal"]["max"] < 0.02
    assert topology_report.main([str(tmp_path / "low.glb"), "--out", str(tmp_path / "topology.json"), "--max-triangles", "1000", "--max-materials", "1", "--require-closed"]) == 0


def test_decimate_fails_when_the_shape_cannot_survive_the_budget(models, tmp_path):
    result = blender("decimate.py", models / "dense.glb", tmp_path, "--target-triangles", 12, "--max-deviation", 0.001)
    assert result.returncode == 1 and "bounding diagonal" in result.stderr
    assert (tmp_path / "decimate-report.json").exists()


def test_quad_remesh_gives_a_closed_all_quad_mesh(models, tmp_path):
    result = blender("quad_remesh.py", models / "dense.glb", tmp_path, "--target-faces", 800, "--name", "quads")
    assert result.returncode == 0, result.stderr[-2000:]
    report = json.loads((tmp_path / "quad-remesh-report.json").read_text())
    assert report["after"]["quadShare"] == 1.0 and report["after"]["openEdges"] == 0
    assert (tmp_path / "quads.blend").exists() and (tmp_path / "quads.glb").exists()
    assert topology_report.main([str(tmp_path / "quads.glb"), "--out", str(tmp_path / "topology.json"), "--min-quad-share", "0.9"]) == 0


def test_quads_are_recovered_from_a_triangulated_quad_mesh_and_refused_for_a_triangle_mesh(models, tmp_path):
    result = blender("quads_from_tris.py", models / "quad-tris.glb", tmp_path / "a")
    assert result.returncode == 0, result.stderr[-2000:]
    assert json.loads((tmp_path / "a" / "quads-report.json").read_text())["after"]["quadShare"] == 1.0
    result = blender("quads_from_tris.py", models / "dense.glb", tmp_path / "b", "--min-quad-share", 0.99)
    assert result.returncode == 1 and "quads" in result.stderr


def test_edge_stretch_finds_the_tear_at_a_sharp_bend(models, tmp_path):
    same = blender("edge_stretch.py", models / "rest.glb", models / "rest.glb", tmp_path, "--label", "same")
    assert same.returncode == 0, same.stderr[-2000:]
    assert json.loads((tmp_path / "same-edge-stretch.json").read_text())["worst"] == pytest.approx(1.0, abs=1e-3)
    bent = blender("edge_stretch.py", models / "rest.glb", models / "bent.glb", tmp_path, "--label", "bent", "--max-stretch", 1.2)
    assert bent.returncode == 1 and "stretch more than" in bent.stderr
    assert json.loads((tmp_path / "bent-edge-stretch.json").read_text())["edgesOverMax"] > 0
    other = blender("edge_stretch.py", models / "rest.glb", models / "dense.glb", tmp_path)
    assert other.returncode == 2 and "same mesh" in other.stderr


def test_fit_lays_a_rescaled_copy_back_onto_its_source(models, tmp_path):
    low = blender("decimate.py", models / "dense.glb", tmp_path / "low", "--target-triangles", 1500, "--name", "low")
    assert low.returncode == 0, low.stderr[-2000:]
    fitted = blender("fit_to_source.py", tmp_path / "low" / "low.glb", models / "dense.glb", tmp_path / "fit")
    assert fitted.returncode == 0, fitted.stderr[-2000:]
    report = json.loads((tmp_path / "fit" / "fit-report.json").read_text())
    assert report["applied"]["scale"] == pytest.approx(1.0, abs=0.01) and report["deviationShareOfDiagonal"]["max"] < 0.02
    wrong = blender("fit_to_source.py", models / "rest.glb", models / "dense.glb", tmp_path / "wrong", "--measure-only")
    assert wrong.returncode == 1 and "bounding diagonal" in wrong.stderr


def test_wire_stills_and_a_sheet_are_written_inside_the_output_folder(models, tmp_path):
    result = blender("render_wire.py", models / "quad-tris.glb", tmp_path / "stills", "--views", "front,three-quarter", "--resolution", 240, "--focus", "middle=0.5,0.5,0.5,0.3")
    assert result.returncode == 0, result.stderr[-2000:]
    names = sorted(os.listdir(tmp_path / "stills"))
    assert names == ["quad-tris-wire-front.png", "quad-tris-wire-middle.png", "quad-tris-wire-sheet.png", "quad-tris-wire-stats.json", "quad-tris-wire-three-quarter.png"]
    assert all((tmp_path / "stills" / n).stat().st_size > 500 for n in names if n.endswith(".png"))
    bad = blender("render_wire.py", models / "quad-tris.glb", tmp_path / "stills", "--views", "sideways")
    assert bad.returncode == 2 and "unknown view" in bad.stderr
    missing = blender("render_wire.py", tmp_path / "none.glb", tmp_path / "stills")
    assert missing.returncode == 2 and "no such model" in missing.stderr
