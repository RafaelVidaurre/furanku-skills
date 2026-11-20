"""The jam-3d-animate scripts run for real, in Blender, on generated test clips with known faults. Blender is found
through JAM_BLENDER (its executable), else `blender` on PATH, else, on macOS only, the application's usual place; the
tests are skipped without it."""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jamanim import gltf, poses  # noqa: E402


def find_blender():
    candidates = [os.environ.get("JAM_BLENDER"), shutil.which("blender")]
    if sys.platform == "darwin":
        candidates.append("/Applications/Blender.app/Contents/MacOS/Blender")
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


BLENDER = find_blender()
pytestmark = pytest.mark.skipif(BLENDER is None, reason="Blender not found: set JAM_BLENDER to its executable to run the animation tests")
ACCEPT = {"footSlide": 0.01, "penetration": 0.005, "boundaryJump": 0.01, "loopSeam": 0.01}   # this test project's own numbers
DETECT = {"height": 0.01, "speed": 0.5}


def blender(script, *args, cwd=None):
    """Run a script as a project would: from the project root (`cwd`), where the spec's paths start."""
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", os.path.join(HERE, script), "--"]
                          + [str(a) for a in args], capture_output=True, text=True, cwd=cwd)
    log = done.stdout + done.stderr
    last = [line for line in done.stdout.splitlines() if line.startswith("{")]
    return done.returncode, log, (json.loads(last[-1]) if last else None)


def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_spec(folder, name="clip.json", **over):
    doc = {"id": "walk", "purpose": "a test walk cycle", "rig": {"model": "rig.glb", "map": "map.json"}, "fps": 30, "length": {"min": 1.0, "max": 1.0},
           "loop": True, "root": {"mode": "root-motion"}, "ground": {"kind": "flat"}, "contacts": {"detect": DETECT}, "accept": dict(ACCEPT)}
    doc.update(over)
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return path


@pytest.fixture(scope="module")
def make(tmp_path_factory):
    made = {}

    def build(name, *args):
        if name not in made:
            folder = str(tmp_path_factory.mktemp(name))
            code, log, _ = blender("make_test_clip.py", folder, *args)
            assert code == 0, log[-2000:]
            write_spec(folder)
            made[name] = folder
        return made[name]
    return build


def check(folder, *extra, spec="clip.json", clip="clip.glb", out="check"):
    out = os.path.join(folder, out)
    code, log, _ = blender("clip_check.py", os.path.join(folder, clip), os.path.join(folder, spec), out, "--sheet-frames", "4", "--size", "160x200", *extra, cwd=folder)
    path = os.path.join(out, "clip-report.json")
    return code, log, (read(path) if os.path.isfile(path) else None)


def test_a_clean_loop_passes_with_its_evidence(make):
    folder = make("clean", "--poses")
    code, log, r = check(folder)
    assert code == 0, log[-2000:]
    assert r["passed"] and r["failures"] == [] and r["unmeasured"] == [] and r["unjudged"] == []
    assert r["checks"]["skeleton"]["passed"] and r["checks"]["wholeFrames"]["passed"] and r["checks"]["length"]["passed"]
    assert r["frames"] == 30 and r["seam"]["convention"] == "open-end" and r["seam"]["chosenBy"].startswith("the spec")
    assert r["ground"]["height"] == pytest.approx(0.0, abs=1e-4) and r["penetrationMeasuredOn"] == "foot mesh vertices"
    truth = read(os.path.join(folder, "truth.json"))
    for limb in ("foot.l", "foot.r"):          # every planted frame the walk was built with is found, give or take one frame
        found = {f for w in r["contacts"] if w["point"] == limb for f in range(w["from"], w["to"] + 1)}
        built = {f for a, b in truth["planted"][limb] for f in range(a, b + 1)}
        assert len(built - found) <= 2 and len(found - built) <= 2, (limb, sorted(built - found), sorted(found - built))
    assert all(w["slide"] < 1e-3 for w in r["contacts"])
    assert all(g["travel"] < 0.006 and not g["toJudge"] for g in r["grounded"])   # lift-off and touch-down inside the contact height
    sheet = r["evidence"]["sheet"]
    assert os.path.getsize(sheet["path"]) > 0 and sheet["frames"] == [0, 10, 19, 29]
    video = r["evidence"]["video"]
    assert ("path" in video and os.path.getsize(video["path"]) > 0) or video.get("skipped")


@pytest.mark.parametrize("metres", [0.02, 0.05])
def test_a_foot_sliding_while_planted_reads_its_slide(make, metres):
    folder = make("slide-%g" % metres, "--slide", metres)
    code, _, r = check(folder)
    truth = read(os.path.join(folder, "truth.json"))["faults"]["slide"]
    worst = max((w for w in r["contacts"] if w["limb"] == "foot.l"), key=lambda w: w["slide"])
    assert worst["slide"] == pytest.approx(truth["metres"], abs=1e-3)
    assert worst["from"] == 0 and abs(worst["to"] - truth["frames"][1]) <= 1
    assert code == 1 and r["failures"] == ["footSlide"] and r["accept"]["footSlide"]["measured"] == worst["slide"]


def test_a_sunken_foot_reads_its_penetration_on_the_mesh_and_on_joints(make):
    for name, extra in (("sink", ()), ("sink-bare", ("--no-mesh",))):
        folder = make(name, "--sink", 0.03, *extra)
        code, _, r = check(folder)
        assert r["feet"]["foot.r"]["penetration"] == pytest.approx(0.03, abs=1e-3) and r["feet"]["foot.l"]["penetration"] < 1e-3
        # a foot sunk below the ground is within the contact height for most of its swing: its travel there is for a
        # person to judge, beside the penetration that fails
        assert code == 1 and r["failures"] == ["penetration"] and r["unjudged"] == ["groundTravel"]
        assert max(g["travel"] for g in r["grounded"] if g["limb"] == "foot.r" and g["toJudge"]) > 0.05
        assert not any(g["toJudge"] for g in r["grounded"] if g["limb"] == "foot.l")
        assert r["penetrationMeasuredOn"] == ("foot joints at their rest height" if extra else "foot mesh vertices")
        assert all(w["penetration"] == pytest.approx(0.03, abs=1e-3) for w in r["contacts"] if w["limb"] == "foot.r")


@pytest.mark.parametrize("where", ["start", "end"])
def test_a_pop_at_either_end_reads_its_size(make, where):
    folder = make("pop-" + where, "--pop", "%s:0.08" % where)
    code, _, r = check(folder)
    other = "end" if where == "start" else "start"
    assert r["boundary"][where]["worst"]["jump"] == pytest.approx(0.08, abs=2e-3)
    assert r["boundary"][other]["worst"]["jump"] < 1e-3
    assert code == 1 and "boundaryJump" in r["failures"]


@pytest.mark.parametrize("metres", [0.01, 0.03])
def test_a_loop_that_does_not_close_reads_its_seam(make, metres):
    folder = make("seam-%g" % metres, "--seam", metres)
    code, _, r = check(folder)
    assert r["seam"]["worst"]["jump"] == pytest.approx(metres, abs=2e-3)
    assert r["boundary"]["start"]["worst"]["jump"] < 1e-3
    assert (code == 1 and "loopSeam" in r["failures"]) == (r["seam"]["worst"]["jump"] > ACCEPT["loopSeam"])


def test_a_loop_ending_on_its_first_pose(make):
    folder = make("duplicate", "--loop-end", "duplicate")
    code, log, r = check(folder)
    assert code == 0, log[-2000:]
    assert r["frames"] == 31 and r["seam"]["convention"] == "duplicate-end" and r["seam"]["worst"]["jump"] < 1e-3


def test_in_place_takes_off_travel_and_keeps_the_pelvis(make):
    folder = make("clean", "--poses")
    write_spec(folder, "in-place.json", root={"mode": "in-place"})
    code, log, out = blender("root_convention.py", os.path.join(folder, "clip.glb"), os.path.join(folder, "in-place.json"), os.path.join(folder, "rc"), cwd=folder)
    assert code == 0, log[-2000:]
    before, after = out["hips"]["before"], out["hips"]["after"]
    assert before["alongRange"] == pytest.approx(29 / 30, abs=2e-3) and after["alongRange"] < 2e-3     # travel gone
    assert after["acrossRange"] == pytest.approx(before["acrossRange"], abs=1e-3) and after["acrossRange"] > 0.03   # sway kept
    assert after["heightRange"] == pytest.approx(before["heightRange"], abs=1e-4) and after["heightRange"] > 0.025  # bob kept
    travel = read(out["travel"])
    assert travel["loopEnd"] == "open" and travel["travel"][-1][1] == pytest.approx(29 / 30, abs=1e-3)
    clip = out["clip"]
    code, log, r = check(folder, "--travel", out["travel"], spec="in-place.json", clip=os.path.relpath(clip, folder), out="ip")
    assert code == 0, log[-2000:]
    assert r["seam"]["relativeTo"] == "the world (in-place)" and r["seam"]["worst"]["jump"] < 1e-3
    assert max(w["slide"] for w in r["contacts"]) < 1e-3
    code, log, _ = check(folder, spec="in-place.json", clip=os.path.relpath(clip, folder), out="ip-bare")
    assert code == 1 and "pass --travel" in log


def test_root_motion_moves_travel_onto_the_root_bone(make):
    folder = make("rooted", "--root-bone", "--names", "camel")
    write_spec(folder, root={"mode": "root-motion", "bone": "root"})
    code, log, out = blender("root_convention.py", os.path.join(folder, "clip.glb"), os.path.join(folder, "clip.json"), os.path.join(folder, "rc"), cwd=folder)
    assert code == 0, log[-2000:]
    assert out["travelOn"] == "root" and out["hips"]["overRoot"]["alongRange"] < 2e-3
    a, b = gltf.Gltf(os.path.join(folder, "clip.glb")), gltf.Gltf(out["clip"])
    ca, cb = a.channels(), b.channels()
    joints = [n for n, _ in a.skeleton() if n != "root"]
    worst = 0.0
    for f in range(30):
        wa, wb = a.pose_world(f / 30, channels=ca), b.pose_world(f / 30, channels=cb)
        worst = max(worst, max(float(np.abs(wa[n][:3, 3] - wb[n][:3, 3]).max()) for n in joints))
    assert worst < 1e-4                                                      # every joint stays where it was
    assert b.pose_world(29 / 30, channels=cb)["root"][2, 3] == pytest.approx(29 / 30, abs=2e-3)
    assert a.pose_world(29 / 30, channels=ca)["root"][2, 3] == pytest.approx(0.0, abs=1e-6)
    code, log, r = check(folder, clip=os.path.relpath(out["clip"], folder))
    assert code == 0, log[-2000:]
    assert r["seam"]["relativeTo"] == "the ground position of root" and r["root"]["rootNetTravel"] == pytest.approx(29 / 30, abs=2e-3)


def test_a_clip_on_another_skeleton_fails_the_skeleton_check(make):
    clean, rooted = make("clean", "--poses"), make("rooted", "--root-bone", "--names", "camel")
    folder = make("clean-on-landmark-names")
    shutil.copy(os.path.join(rooted, "rig.glb"), os.path.join(folder, "other-rig.glb"))
    write_spec(folder, "other.json", rig={"model": "other-rig.glb", "map": "map.json"})
    code, _, r = check(folder, spec="other.json")
    assert code == 1 and "skeleton" in r["failures"]
    assert "Hips" in r["checks"]["skeleton"]["missing"] and "hips" in r["checks"]["skeleton"]["extra"]
    assert clean  # the clean figure was built with landmark names; the other rig uses camel-case names under a root


def test_ground_that_is_not_flat_leaves_penetration_to_a_person(make):
    folder = make("clean", "--poses")
    write_spec(folder, "stairs.json", ground={"kind": "change", "description": "steps up one stair of 0.18 m"})
    code, _, r = check(folder, spec="stairs.json", out="stairs")
    assert code == 0 and r["passed"] and r["unmeasured"] == ["penetration"]
    assert r["accept"]["penetration"]["passed"] is None and "not flat" in r["accept"]["penetration"]["unmeasured"]
    assert r["contacts"]                                                     # contacts still found, by speed alone


def test_contact_detection_numbers_come_from_the_spec_or_the_command(make):
    folder = make("clean", "--poses")
    write_spec(folder, "no-detect.json", contacts={})
    code, log, _ = check(folder, spec="no-detect.json", out="nd")
    assert code == 1 and "contact detection needs a height and a speed" in log
    code, log, r = check(folder, "--contact-height", "0.01", "--contact-speed", "0.5", spec="no-detect.json", out="nd2")
    assert code == 0 and r["detect"]["from"] == "--contact-height/--contact-speed"


def test_key_poses_are_written_on_the_rig_at_their_times(make):
    folder = make("clean", "--poses")
    write_spec(folder, "kp.json", keyPoses={"file": "kp/keyposes.glb", "poses": [{"name": "contact", "time": 0.0}, {"name": "passing", "time": 0.4}]})
    code, log, out = blender("keyposes.py", "kp.json", "--poses", "poses.glb", cwd=folder)
    assert code == 0, log[-2000:]
    assert [(p["name"], p["frame"]) for p in out["poses"]] == [("contact", 0), ("passing", 12)]
    assert out["keyposes"] == "kp/keyposes.glb" and os.path.isfile(os.path.join(folder, "kp", "keyposes.json"))   # where the spec says
    k, c = gltf.Gltf(os.path.join(folder, out["keyposes"])), gltf.Gltf(os.path.join(folder, "clip.glb"))
    assert k.animation_names() == ["walk-keyposes"] and k.key_times() == pytest.approx([0.0, 0.4], abs=1e-5)
    ck, cc = k.channels(), c.channels()
    for t_key, t_clip in ((0.0, 0.0), (0.4, 7 / 30)):              # make_test_clip.py takes "passing" from frame 7
        wk, wc = k.pose_world(t_key, channels=ck), c.pose_world(t_clip, channels=cc)
        assert max(float(np.abs(wk[n][:3, 3] - wc[n][:3, 3]).max()) for n, _ in c.skeleton()) < 1e-4
    write_spec(folder, "kp-missing.json", keyPoses={"file": "kp2/keyposes.glb", "poses": [{"name": "reach", "time": 0.0}]})
    code, log, _ = blender("keyposes.py", "kp-missing.json", "--poses", "poses.glb", cwd=folder)
    assert code == 1 and "no action or animation named reach" in log


def test_key_poses_from_a_blend_keep_only_the_rig(make):
    """A .blend of poses may hold anything else (bone shapes, props); the key-pose file holds the project rig only."""
    folder = make("clean", "--poses")
    make_blend = ("import bpy, os; bpy.ops.wm.read_factory_settings(use_empty=True); "
                  "bpy.ops.import_scene.gltf(filepath='poses.glb'); "
                  "[setattr(a, 'use_fake_user', True) for a in bpy.data.actions]; "
                  "bpy.ops.mesh.primitive_ico_sphere_add(radius=1.0); "
                  "bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('poses-extra.blend'))")
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python-expr", make_blend],
                          capture_output=True, text=True, cwd=folder)
    assert done.returncode == 0 and os.path.isfile(os.path.join(folder, "poses-extra.blend")), done.stdout[-2000:] + done.stderr[-2000:]
    write_spec(folder, "kp-blend.json", keyPoses={"file": "kp-blend/keyposes.glb", "poses": [{"name": "contact", "time": 0.0}, {"name": "passing", "time": 0.4}]})
    code, log, out = blender("keyposes.py", "kp-blend.json", "--poses", "poses-extra.blend", cwd=folder)
    assert code == 0, log[-2000:]
    meshes = gltf.Gltf(os.path.join(folder, out["keyposes"])).json.get("meshes", [])
    rig_meshes = gltf.Gltf(os.path.join(folder, "rig.glb")).json.get("meshes", [])
    assert len(meshes) == len(rig_meshes)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH")
def test_video_through_an_outside_ffmpeg(make):
    folder = make("clean", "--poses")
    code, log, r = check(folder, "--ffmpeg", shutil.which("ffmpeg"), out="ffmpeg")
    assert code == 0, log[-2000:]
    assert os.path.getsize(r["evidence"]["video"]["path"]) > 0


# ---- faults the measures once missed, and the clip format ----------------------------------------------------------

def test_a_slide_faster_than_detection_fails_when_declared_and_is_put_to_the_person_when_not(make):
    """A foot sliding 0.4 m over its planted window moves faster than detect.speed, so detection never plants it."""
    folder = make("slide-fast", "--slide", 0.4)
    truth = read(os.path.join(folder, "truth.json"))["faults"]["slide"]
    code, _, r = check(folder)                # nothing declared: height and speed cannot tell it from a low swing
    run = max((g for g in r["grounded"] if g["limb"] == "foot.l"), key=lambda g: g["travel"])
    # all of it but the last frames, where the foot slows enough for detection to plant it
    assert 0.9 * truth["metres"] <= run["travel"] <= truth["metres"] and run["from"] == 0 and run["toJudge"] is True
    assert "footSlide" not in r["failures"] and r["unjudged"] == ["groundTravel"]
    a, b = truth["frames"]
    write_spec(folder, "declared.json", contacts={"detect": DETECT, "planted": [{"limb": "foot.l", "from": a / 30, "to": b / 30}]})
    code, _, r = check(folder, spec="declared.json", out="declared")
    assert code == 1 and "footSlide" in r["failures"]
    assert r["expectedContacts"][0]["slide"] == pytest.approx(truth["metres"], abs=2e-3) and r["expectedContacts"][0]["passed"] is False
    assert not any(g["limb"] == "foot.l" and g["from"] <= b and g["toJudge"] for g in r["grounded"])   # the window is judged


def test_a_jump_inside_the_clip_hides_no_pop_and_fails_itself(make):
    folder = make("pop-and-step", "--pop", "start:0.08", "--step", "15:0.08")
    code, _, r = check(folder)
    assert r["boundary"]["start"]["worst"]["jump"] == pytest.approx(0.08, abs=3e-3)
    assert r["boundary"]["interior"]["frames"][1] == 15 and r["measures"]["interiorJump"] == pytest.approx(0.08, abs=5e-3)
    assert code == 1 and {"boundaryJump", "interiorJump"} <= set(r["failures"])
    clean = check(make("clean", "--poses"))[2]
    assert clean["accept"]["interiorJump"]["passed"] and clean["accept"]["interiorJump"]["threshold"] == ACCEPT["boundaryJump"]


def test_a_loop_that_does_not_close_fails_with_jumps_inside(make):
    folder = make("seam-and-steps", "--seam", 0.2, "--step", "8:0.05", "--step", "12:-0.05")
    code, _, r = check(folder)
    assert code == 1 and "loopSeam" in r["failures"] and r["seam"]["worst"]["jump"] > 0.15


def test_a_frame_rate_that_is_not_whole(make):
    folder = make("ntsc", "--fps", 29.97, "--period", 30 / 29.97)
    write_spec(folder, "ntsc.json", fps=29.97, length={"min": 30 / 29.97, "max": 30 / 29.97}, root={"mode": "in-place"})
    times = gltf.Gltf(os.path.join(folder, "clip.glb")).key_times()
    assert len(times) == 30 and times[-1] == pytest.approx(29 / 29.97, abs=1e-6)
    code, log, out = blender("root_convention.py", "clip.glb", "ntsc.json", "rc", cwd=folder)
    assert code == 0, log[-2000:]
    assert gltf.Gltf(os.path.join(folder, out["clip"])).key_times()[-1] == pytest.approx(29 / 29.97, abs=1e-6)
    code, log, r = check(folder, "--travel", os.path.join(folder, "rc", "travel.json"), spec="ntsc.json", clip="rc/clip-in-place.glb", out="ntsc")
    assert code == 0, log[-2000:]
    assert r["checks"]["wholeFrames"]["passed"] and r["checks"]["length"]["passed"] and r["frames"] == 30


def test_a_rig_whose_rest_differs_fails_the_skeleton_check(make):
    folder = make("clean", "--poses")
    g = gltf.Gltf(os.path.join(folder, "rig.glb"))
    k = next(i for i, n in enumerate(g.nodes) if n.get("name") == "lower-leg.l")
    g.json["nodes"][k]["translation"] = [x * 1.02 for x in g.json["nodes"][k]["translation"]]
    poses.write_with_animation(g, os.path.join(folder, "longer-rig.glb"), "rest", 30, {k: {"scale": np.ones((2, 3))}})
    write_spec(folder, "longer.json", rig={"model": "longer-rig.glb", "map": "map.json"})
    code, _, r = check(folder, spec="longer.json", out="longer")
    assert code == 1 and "skeleton" in r["failures"] and not r["checks"]["skeleton"]["missing"]
    assert r["checks"]["skeleton"]["rest"]["position"] > 0.005


def test_a_file_with_two_animations_is_measured_but_not_delivered(make):
    folder = make("clean", "--poses")
    two = ("import bpy, os; bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30; "
           "bpy.ops.import_scene.gltf(filepath='clip.glb'); a = bpy.data.actions[0]; c = a.copy(); c.name = 'walk-copy'; "
           "a.use_fake_user = True; c.use_fake_user = True; "
           "bpy.ops.export_scene.gltf(filepath=os.path.abspath('two.glb'), export_format='GLB', export_animation_mode='ACTIONS', export_force_sampling=True)")
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python-expr", two], capture_output=True, text=True, cwd=folder)
    assert done.returncode == 0, done.stdout[-2000:] + done.stderr[-2000:]
    names = gltf.Gltf(os.path.join(folder, "two.glb")).animation_names()
    assert len(names) == 2
    walk = next(n for n in names if "copy" not in n)
    code, _, r = check(folder, "--animation", walk, clip="two.glb", out="two")
    assert code == 1 and r["failures"] == ["animations"] and r["checks"]["animations"]["names"] == names
    code, log, out = blender("root_convention.py", "two.glb", "clip.json", "rc-two", "--animation", walk, cwd=folder)
    assert code == 0, log[-2000:]
    assert len(gltf.Gltf(os.path.join(folder, out["clip"])).animation_names()) == 1


def test_measure_only_needs_no_thresholds(make):
    folder = make("pop-end", "--pop", "end:0.08")
    with open(os.path.join(folder, "clip.json"), encoding="utf-8") as f:
        doc = json.load(f)
    del doc["accept"]; doc["contacts"] = {}
    with open(os.path.join(folder, "bare.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f)
    code, log, r = check(folder, "--measure-only", spec="bare.json", out="measure")
    assert code == 0, log[-2000:]
    assert r["passed"] is None and r["accept"] is None and r["measureOnly"]
    assert r["measures"]["boundaryJump"] == pytest.approx(0.08, abs=3e-3) and r["contacts"] is None and "footSlide" in r["unmeasured"]


def test_key_poses_from_a_rig_kept_in_centimetres(make):
    """The poses' armature is scaled 0.01 with its bones a hundred times longer: the same pose in the world."""
    folder = make("clean", "--poses")
    cm = ("import bpy, os; bpy.ops.wm.read_factory_settings(use_empty=True); "
          "bpy.ops.import_scene.gltf(filepath='poses.glb'); arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]; "
          "bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm; "
          "arm.scale = (100, 100, 100); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); arm.scale = (0.01, 0.01, 0.01); "
          "[setattr(k, 'co', (k.co[0], k.co[1] * 100)) for a in bpy.data.actions for l in a.layers for st in l.strips for b in st.channelbags "
          "for c in b.fcurves if c.data_path.endswith('location') for k in c.keyframe_points]; "
          "[setattr(a, 'use_fake_user', True) for a in bpy.data.actions]; "
          "bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('poses-cm.blend'))")
    done = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python-expr", cm], capture_output=True, text=True, cwd=folder)
    assert done.returncode == 0, done.stdout[-2000:] + done.stderr[-2000:]
    write_spec(folder, "kp-cm.json", keyPoses={"file": "kp-cm/keyposes.glb", "poses": [{"name": "contact", "time": 0.0}, {"name": "passing", "time": 0.4}]})
    code, log, out = blender("keyposes.py", "kp-cm.json", "--poses", "poses-cm.blend", cwd=folder)
    assert code == 0, log[-2000:]
    k, c = gltf.Gltf(os.path.join(folder, out["keyposes"])), gltf.Gltf(os.path.join(folder, "clip.glb"))
    ck, cc = k.channels(), c.channels()
    for t_key, t_clip in ((0.0, 0.0), (0.4, 7 / 30)):
        wk, wc = k.pose_world(t_key, channels=ck), c.pose_world(t_clip, channels=cc)
        assert max(float(np.abs(wk[n][:3, 3] - wc[n][:3, 3]).max()) for n, _ in c.skeleton()) < 1e-4


def test_a_blockout_from_the_key_poses_is_a_clip(make):
    """keyposes.py writes the poses and their sheet; blockout.py makes them a clip the check reads in full."""
    folder = make("clean", "--poses")
    write_spec(folder, "block.json", loop=False, length={"min": 0.5, "max": 0.5}, accept={k: v for k, v in ACCEPT.items() if k != "loopSeam"},
               keyPoses={"file": "block/keyposes.glb", "poses": [{"name": "contact", "time": 0.0}, {"name": "passing", "time": 0.4}]})
    code, log, out = blender("keyposes.py", "block.json", "--poses", "poses.glb", "--size", "160x200", cwd=folder)
    assert code == 0, log[-2000:]
    assert out["sheet"] == "block/keyposes-sheet.png" and os.path.getsize(os.path.join(folder, out["sheet"])) > 0
    done = subprocess.run([sys.executable, os.path.join(HERE, "blockout.py"), "block.json", "block/clip.glb"], capture_output=True, text=True, cwd=folder)
    assert done.returncode == 0, done.stdout + done.stderr
    code, log, r = check(folder, "--measure-only", spec="block.json", clip="block/clip.glb", out="block-check")
    assert code == 0, log[-2000:]
    assert all(r["checks"][k]["passed"] for k in ("animations", "skeleton", "wholeFrames", "length")), r["checks"]
    assert r["frames"] == 16
