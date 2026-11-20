"""The Blender side of jam-3d-retarget, run for real: Blender's glTF importer plays a retargeted file as computed, the
evidence sheet renders, a source written by Blender's own glTF exporter retargets, and a BVH source converts and
retargets. Skipped when Blender is absent: set JAM_BLENDER to its executable (or have `blender` on PATH) to run them."""
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_test_rigs  # noqa: E402
import retarget  # noqa: E402


def find_blender():
    for candidate in (os.environ.get("JAM_BLENDER"), shutil.which("blender"), "/Applications/Blender.app/Contents/MacOS/Blender"):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


BLENDER = find_blender()
pytestmark = pytest.mark.skipif(BLENDER is None, reason="Blender not found: set JAM_BLENDER to its executable to run these tests")

# Writes what other tools hand over: a source re-exported by Blender's glTF exporter, and the same motion as BVH.
EXPORT = '''
import bpy, sys
src, glb_out, bvh_out, anim = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for t in arm.animation_data.nla_tracks:
    t.mute = True
arm.animation_data.action = {t.name: t for t in arm.animation_data.nla_tracks}[anim].strips[0].action
bpy.ops.export_scene.gltf(filepath=glb_out, export_format="GLB", export_yup=True, export_animations=True)
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); bpy.context.view_layer.objects.active = arm
first, last = (int(round(v)) for v in arm.animation_data.action.frame_range)
bpy.ops.export_anim.bvh(filepath=bvh_out, frame_start=first, frame_end=last)
'''


def blender(script, *args):
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--"] + [str(a) for a in args],
                          capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def rigs(tmp_path_factory):
    folder = tmp_path_factory.mktemp("rigs")
    make_test_rigs.main([str(folder)])
    return folder


@pytest.fixture(scope="module")
def exported(rigs, tmp_path_factory):
    folder = tmp_path_factory.mktemp("exported")
    script = folder / "export.py"
    script.write_text(EXPORT)
    code, log = blender(str(script), rigs / "rig-a.glb", folder / "blender-a.glb", folder / "arms.bvh", "arms")
    assert code == 0, log[-2000:]
    return folder


def retarget_to_b(rigs, source, out, *extra):
    code = retarget.main([str(source), str(rigs / "rig-a.map.json"), str(rigs / "rig-b.glb"), str(rigs / "rig-b.map.json"), str(out)] + list(extra))
    return code, read(out / "retarget-report.json")


def test_blender_plays_the_retargeted_file_as_computed_and_the_sheet_renders(rigs, tmp_path):
    code, rep = retarget_to_b(rigs, rigs / "rig-a.glb", tmp_path / "ab")
    assert code == 0
    code, log = blender(os.path.join(HERE, "retarget_evidence.py"), tmp_path / "ab" / "retarget-report.json", tmp_path / "evidence",
                        "--frames", "3", "--size", "120x160", "--samples", "2")
    assert code == 0, log[-2000:]
    manifest = read(tmp_path / "evidence" / "evidence-manifest.json")
    assert manifest["playbackCheckPassed"] and [a["name"] for a in manifest["animations"]] == ["walk", "arms"]
    for entry in manifest["animations"]:
        assert entry["playbackCheckMeters"] < 1e-5 and len(entry["framesShown"]) == 3
        assert os.path.getsize(entry["sheet"]["path"]) > 0
    assert sorted(os.listdir(tmp_path / "evidence")) == ["arms-sheet.png", "evidence-manifest.json", "walk-sheet.png"]


def test_a_source_written_by_blenders_exporter_retargets(rigs, exported, tmp_path):
    code, rep = retarget_to_b(rigs, exported / "blender-a.glb", tmp_path)
    assert code == 0 and rep["passed"]
    arms = next(e for e in rep["animations"] if e["name"] == "arms")
    assert arms["fps"] == 30.0 and arms["frames"] == 76
    assert arms["roundTrip"]["maxHeights"] < 1e-4 and arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 0.01
    assert all(n == 0 for n in arms["sideFlips"].values())


def test_a_bvh_source_converts_and_retargets(rigs, exported, tmp_path):
    convert = os.path.join(HERE, "bvh_to_glb.py")
    # Blender's BVH exporter writes its own frame: Z up, the character facing -Y, centimetres under this rig's armature
    code, log = blender(convert, exported / "arms.bvh", tmp_path / "wrong.glb", "--up", "Z", "--forward=-Y", "--scale", "0.01")
    assert code == 0, log[-2000:]
    code = retarget.main([str(tmp_path / "wrong.glb"), str(rigs / "rig-a.map.json"), str(rigs / "rig-b.glb"), str(rigs / "rig-b.map.json"), str(tmp_path / "x")])
    assert code == 2                                                      # facing backward is refused, not retargeted
    code, log = blender(convert, exported / "arms.bvh", tmp_path / "arms.glb", "--up", "Z", "--forward", "Y", "--scale", "0.01", "--name", "arms")
    assert code == 0, log[-2000:]
    printed = json.loads(next(line for line in log.splitlines() if line.startswith("{")))
    assert printed["skeletonHeightMeters"] == pytest.approx(1.46, abs=0.01) and printed["frames"] == 76
    code, rep = retarget_to_b(rigs, tmp_path / "arms.glb", tmp_path / "out")
    assert code == 0 and rep["passed"]
    arms = rep["animations"][0]
    assert arms["name"] == "arms" and arms["startSeconds"] == 0.0 and arms["fps"] == 30.0
    assert arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 0.01 and all(n == 0 for n in arms["sideFlips"].values())
