"""The Blender side of jam-3d-retarget, run for real: Blender's glTF importer plays a retargeted file as computed, the
evidence sheet renders, a source written by Blender's own glTF exporter retargets, and BVH and FBX sources convert and
retarget. Skipped when Blender is absent: set JAM_BLENDER to its executable (or have `blender` on PATH) to run them."""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_test_rigs  # noqa: E402
import retarget  # noqa: E402
from jamretarget import gltf  # noqa: E402


def find_blender():
    candidates = [os.environ.get("JAM_BLENDER"), shutil.which("blender")]
    if sys.platform == "darwin":                                          # the application bundle's own executable
        candidates.append("/Applications/Blender.app/Contents/MacOS/Blender")
    return next((c for c in candidates if c and os.path.isfile(c)), None)


BLENDER = find_blender()
pytestmark = pytest.mark.skipif(BLENDER is None, reason="Blender not found: set JAM_BLENDER to its executable to run these tests")

# Writes what other tools hand over: a source re-exported by Blender's glTF exporter, the same motion as BVH and as FBX
# (one take, and every action as a take), and an FBX file holding two skeletons.
EXPORT = '''
import bpy, sys
src, glb_out, bvh_out, fbx_out, fbx_all, fbx_two, anim, fps, fps_base = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = int(fps), float(fps_base)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for t in arm.animation_data.nla_tracks:
    t.mute = True
arm.animation_data.action = {t.name: t for t in arm.animation_data.nla_tracks}[anim].strips[0].action
bpy.ops.export_scene.gltf(filepath=glb_out, export_format="GLB", export_yup=True, export_animations=True)
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); bpy.context.view_layer.objects.active = arm
first, last = (int(round(v)) for v in arm.animation_data.action.frame_range)
bpy.ops.export_anim.bvh(filepath=bvh_out, frame_start=first, frame_end=last)
bpy.context.scene.frame_start, bpy.context.scene.frame_end = first, last
fbx = dict(use_selection=True, object_types={"ARMATURE"}, add_leaf_bones=False, bake_anim=True, bake_anim_use_nla_strips=False)
bpy.ops.export_scene.fbx(filepath=fbx_out, bake_anim_use_all_actions=False, **fbx)
bpy.ops.export_scene.fbx(filepath=fbx_all, bake_anim_use_all_actions=True, **fbx)
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.data.objects:
    o.select_set(o.type == "ARMATURE")
bpy.ops.export_scene.fbx(filepath=fbx_two, bake_anim_use_all_actions=False, **fbx)
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
    code, log = blender(str(script), rigs / "rig-a.glb", folder / "blender-a.glb", folder / "arms.bvh", folder / "arms.fbx",
                        folder / "all.fbx", folder / "two.fbx", "arms", 30, 1)
    assert code == 0, log[-2000:]
    return folder


@pytest.fixture(scope="module")
def ntsc(rigs, tmp_path_factory):
    """The arms clip's 76 keys written by Blender at 29.97 fps (30 / 1.001), as BVH and as FBX."""
    folder = tmp_path_factory.mktemp("ntsc")
    script = folder / "export.py"
    script.write_text(EXPORT)
    code, log = blender(str(script), rigs / "rig-a.glb", folder / "unused.glb", folder / "arms.bvh", folder / "arms.fbx",
                        folder / "all.fbx", folder / "two.fbx", "arms", 30, 1.001)
    assert code == 0, log[-2000:]
    return folder


# The test clips' planted feet stand exactly still, so any small speed finds them; these are the validated runs' values.
CONTACTS = ["--contacts", "auto", "--contact-speed", "0.1", "--contact-min-frames", "3"]


def retarget_to_b(rigs, source, out, *extra):
    code = retarget.main([str(source), str(rigs / "rig-a.map.json"), str(rigs / "rig-b.glb"), str(rigs / "rig-b.map.json"), str(out)] + CONTACTS + list(extra))
    path = out / "retarget-report.json"
    return code, (read(path) if path.exists() else None)


def convert(source, out, *flags):
    code, log = blender(os.path.join(HERE, "clip_to_glb.py"), source, out, *flags)
    printed = next((json.loads(line) for line in log.splitlines() if line.startswith("{")), None)
    return code, printed, log


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
    # Blender's BVH exporter writes its own frame: Z up, the character facing -Y, centimetres under this rig's armature
    code, printed, log = convert(exported / "arms.bvh", tmp_path / "wrong.glb", "--up", "Z", "--facing", "Y", "--scale", "0.01")
    assert code == 0, log[-2000:]
    code, rep = retarget_to_b(rigs, tmp_path / "wrong.glb", tmp_path / "x")
    assert code == 2 and rep is None                                      # facing backward is refused, not retargeted
    code, printed, log = convert(exported / "arms.bvh", tmp_path / "arms.glb", "--up", "Z", "--facing=-Y", "--scale", "0.01", "--name", "arms")
    assert code == 0, log[-2000:]
    assert printed["skeletonHeightMeters"] == pytest.approx(1.46, abs=0.01) and printed["animations"] == [{"name": "arms", "frames": 76}]
    code, rep = retarget_to_b(rigs, tmp_path / "arms.glb", tmp_path / "out")
    assert code == 0 and rep["passed"]
    arms = rep["animations"][0]
    assert arms["name"] == "arms" and arms["startSeconds"] == 0.0 and arms["fps"] == 30.0
    assert arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 0.01 and all(n == 0 for n in arms["sideFlips"].values())


def test_axes_and_scale_must_be_given(exported, tmp_path):
    code, _, log = convert(exported / "arms.bvh", tmp_path / "none.glb", "--up", "Z", "--facing=-Y")
    assert code != 0 and "--scale" in log and not (tmp_path / "none.glb").exists()


def test_an_fbx_source_converts_and_retargets(rigs, exported, tmp_path):
    # Blender's FBX exporter declares Y up, the scene's front +Z and centimetres; the character faces +Z
    code, printed, log = convert(exported / "arms.fbx", tmp_path / "arms.glb", "--up", "Y", "--facing", "Z", "--scale", "0.01", "--name", "arms")
    assert code == 0, log[-2000:]
    assert printed["declared"] == {"up": "Y", "front": "Z", "metresPerUnit": 0.01}
    assert printed["skeletonHeightMeters"] == pytest.approx(1.46, abs=0.01) and printed["animations"] == [{"name": "arms", "frames": 76}]
    code, rep = retarget_to_b(rigs, tmp_path / "arms.glb", tmp_path / "out")
    assert code == 0 and rep["passed"]
    arms = rep["animations"][0]
    assert (arms["name"], arms["frames"], arms["fps"], arms["startSeconds"]) == ("arms", 76, 30.0, 0.0)
    assert arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 0.01 and arms["roundTrip"]["maxHeights"] < 1e-4
    code, printed, log = convert(exported / "all.fbx", tmp_path / "all.glb", "--up", "Y", "--facing", "Z", "--scale", "0.01")
    assert code == 0, log[-2000:]
    assert sorted(a["frames"] for a in printed["animations"]) == [61, 76]
    code, rep = retarget_to_b(rigs, tmp_path / "all.glb", tmp_path / "all")
    assert code == 0 and rep["passed"] and len(rep["animations"]) == 2


def test_an_fbx_source_is_refused_when_its_declaration_or_content_is_ambiguous(rigs, exported, tmp_path):
    code, _, log = convert(exported / "arms.fbx", tmp_path / "metres.glb", "--up", "Y", "--facing", "Z", "--scale", "1")
    assert code == 2 and "unit is 0.01 m, not 1" in log and not (tmp_path / "metres.glb").exists()
    code, _, log = convert(exported / "arms.fbx", tmp_path / "z-up.glb", "--up", "Z", "--facing=-Y", "--scale", "0.01")
    assert code == 2 and "up axis is Y, not Z" in log
    code, printed, log = convert(exported / "arms.fbx", tmp_path / "big.glb", "--up", "Y", "--facing", "Z", "--scale", "1", "--ignore-declared")
    assert code == 0 and printed["skeletonHeightMeters"] == pytest.approx(146, abs=1)  # the flag wins, and the height shows it
    code, _, log = convert(exported / "arms.fbx", tmp_path / "back.glb", "--up", "Y", "--facing=-Z", "--scale", "0.01")
    assert code == 0
    assert retarget_to_b(rigs, tmp_path / "back.glb", tmp_path / "x")[0] == 2   # facing backward is refused by the retarget
    code, _, log = convert(exported / "two.fbx", tmp_path / "two.glb", "--up", "Y", "--facing", "Z", "--scale", "0.01")
    assert code == 2 and "one skeleton" in log
    names = log.split("skeletons in the file: ")[1].split(")")[0].split(", ")
    code, printed, log = convert(exported / "two.fbx", tmp_path / "one.glb", "--up", "Y", "--facing", "Z", "--scale", "0.01", "--armature", names[0])
    assert code == 0, log[-2000:]                                       # only that skeleton's take is written
    written = [a["name"] for a in gltf.Gltf(str(tmp_path / "one.glb")).animations()]
    assert written == [a["name"] for a in printed["animations"]] and len(written) == 1 and "|" not in written[0]
    code, _, log = convert(rigs / "rig-a.glb", tmp_path / "glb.glb", "--up", "Y", "--facing", "Z", "--scale", "1")
    assert code == 2 and "only .bvh and .fbx" in log


@pytest.mark.parametrize("kind, flags", [("bvh", ["--up", "Z", "--facing=-Y"]), ("fbx", ["--up", "Y", "--facing", "Z"])])
def test_a_clip_at_a_rate_that_is_not_whole_keeps_its_frames(rigs, ntsc, tmp_path, kind, flags):
    """29.97 fps stays 29.97 with every frame: Blender's glTF exporter converts frames by fps x fps_base, and its FBX
    importer places keys by the whole-number rate, so neither is left to its default."""
    code, printed, log = convert(ntsc / ("arms." + kind), tmp_path / "arms.glb", *flags, "--scale", "0.01", "--name", "arms")
    assert code == 0, log[-2000:]
    assert printed["fps"] == pytest.approx(30 / 1.001, rel=2e-5) and printed["animations"] == [{"name": "arms", "frames": 76}]
    times = gltf.key_times(gltf.Gltf(str(tmp_path / "arms.glb")).animations()[0])
    assert len(times) == 76 and np.allclose(np.diff(times), 1 / printed["fps"], rtol=1e-4)
    code, rep = retarget_to_b(rigs, tmp_path / "arms.glb", tmp_path / "out")
    assert code == 0 and rep["passed"]
    arms = rep["animations"][0]
    assert arms["frames"] == 76 and arms["fps"] == pytest.approx(printed["fps"], rel=1e-5) and rep["warnings"] == []
    assert arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 0.01
