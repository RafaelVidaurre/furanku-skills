"""The Blender scripts of jam-3d-texture, run on generated fixtures. Skipped when Blender is not installed.

Run: python3 -m pytest skills/jam-3d-texture/scripts/test_texture_blender.py -q   (set BLENDER to a Blender binary to choose one)
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import glb  # noqa: E402
import texture_report  # noqa: E402

BLENDER = os.environ.get("BLENDER") or shutil.which("blender") or next(
    (p for p in ("/Applications/Blender.app/Contents/MacOS/Blender",) if os.path.exists(p)), None)
pytestmark = pytest.mark.skipif(not BLENDER, reason="Blender is not installed (set BLENDER to its binary, or put `blender` on PATH); the Blender scripts were not exercised")


def blender(script, *arguments):
    return subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", os.path.join(HERE, "blender", script), "--", *map(str, arguments)],
                          capture_output=True, text=True, timeout=600)


@pytest.fixture(scope="module")
def models(tmp_path_factory):
    folder = tmp_path_factory.mktemp("texture-fixtures")
    result = blender("make_fixtures.py", folder)
    assert result.returncode == 0, result.stderr[-2000:]
    return folder


def test_bake_carries_the_source_colour_onto_the_targets_uvs(models, tmp_path):
    result = blender("bake_textures.py", models / "target.glb", tmp_path, "--source", models / "source.glb", "--size", 128, "--samples", 1)
    assert result.returncode == 0, result.stderr[-2000:]
    report = json.loads((tmp_path / "bake-report.json").read_text())
    assert report["hitShare"] >= 0.98 and report["textures"]["basecolor"] == "target_basecolor.png"
    assert report["materialValues"] == {"roughness": pytest.approx(0.4, abs=0.01), "metallic": 0.0}      # constant maps become values
    assert "orm" not in report["textures"]
    baked = tmp_path / "target.glb"
    assert texture_report.main([str(baked), "--out", str(tmp_path / "texture.json"), "--max-texture-size", "128", "--max-materials", "1", "--expect", "basecolor"]) == 0
    colour = next(i for i in glb.read(str(baked)).images() if any(u["slot"] == "baseColor" for u in i["usedBy"]))
    Image = pytest.importorskip("PIL.Image", reason="reading the baked colours needs Pillow")
    import io
    extrema = Image.open(io.BytesIO(colour["bytes"])).convert("RGB").getextrema()
    assert max(high - low for low, high in extrema) > 60, "the grid's colours did not arrive"


def test_bake_refuses_a_target_without_uvs_and_models_that_do_not_coincide(models, tmp_path):
    bare = blender("bake_textures.py", models / "bare.glb", tmp_path / "a", "--source", models / "source.glb", "--size", 64)
    assert bare.returncode == 1 and "no UVs" in bare.stderr
    apart = blender("bake_textures.py", models / "target.glb", tmp_path / "b", "--source", models / "moved.glb", "--size", 64)
    assert apart.returncode == 1 and "do not lie on each other" in apart.stderr


def test_transfer_aligns_a_rescaled_mesh_and_gives_it_a_layout_to_carry_the_colour(models, tmp_path):
    result = blender("transfer_color.py", models / "moved.glb", models / "source.glb", tmp_path, "--size", 128)
    assert result.returncode == 0, result.stderr[-2000:]
    report = json.loads((tmp_path / "transfer-report.json").read_text())
    assert report["aligned"]["scale"] == pytest.approx(1 / 1.3, abs=0.02)
    assert report["temporaryUVsOn"] and report["hitShare"] >= 0.98 and report["deviationShareOfDiagonal"]["max"] < 0.03
    assert (tmp_path / "moved.glb").exists() and (tmp_path / "moved_basecolor.png").stat().st_size > 500
    unaligned = blender("transfer_color.py", models / "moved.glb", models / "source.glb", tmp_path / "raw", "--size", 64, "--no-align")
    assert unaligned.returncode == 1 and "found the source" in unaligned.stderr


def test_textured_stills_and_a_sheet_per_mode(models, tmp_path):
    result = blender("render_textured.py", models / "source.glb", tmp_path, "--modes", "unlit", "--views", "front,under", "--resolution", 160)
    assert result.returncode == 0, result.stderr[-2000:]
    assert sorted(os.listdir(tmp_path)) == ["source-unlit-front.png", "source-unlit-sheet.png", "source-unlit-under.png"]
    assert blender("render_textured.py", models / "source.glb", tmp_path, "--modes", "moody").returncode == 2
