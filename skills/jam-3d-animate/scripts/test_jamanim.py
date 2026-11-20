"""Blender-free behaviour of the jam-3d-animate helpers: the clip spec, skeleton maps, the glTF reader, the clip
measurements and travel. Run with `python3 -m pytest`."""
import json
import math
import os
import struct
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jamanim import gltf, measure, skelmap, spec, travel  # noqa: E402
import clip_spec  # noqa: E402

FPS = 30.0


def good_spec(**over):
    doc = {"id": "walk", "purpose": "a walk cycle", "rig": {"model": "rig.glb", "map": "map.json"}, "fps": 30, "length": 1.0,
           "loop": True, "root": "in-place", "ground": "flat",
           "accept": {"footSlide": 0.01, "penetration": 0.005, "boundaryJump": 0.01, "loopSeam": 0.01}}
    doc.update(over)
    return doc


# ---- clip spec -----------------------------------------------------------------------------------------------------

def test_spec_short_forms_normalize_to_the_long_form(tmp_path):
    s = spec.normalize(good_spec(keyPoses=[{"name": "contact", "time": 0.0}, {"name": "passing", "time": 0.25}]), str(tmp_path), check_files=False)
    assert s["root"] == {"mode": "in-place", "bone": None}
    assert s["ground"] == {"flat": True, "description": "flat"}
    assert s["length"] == {"min": 1.0, "max": 1.0}
    assert s["keyPoses"]["file"] == os.path.join(str(tmp_path), "keyposes.glb") and [p["name"] for p in s["keyPoses"]["poses"]] == ["contact", "passing"]
    assert s["contacts"] == {"detect": None, "planted": []}
    s = spec.normalize(good_spec(root={"mode": "root-motion", "bone": "root"}, ground={"description": "a stair of 0.18 m"},
                                 length={"min": 0.8, "max": 1.2}), str(tmp_path), check_files=False)
    assert s["root"] == {"mode": "root-motion", "bone": "root"} and s["ground"]["flat"] is False and s["length"]["max"] == 1.2


def test_spec_requires_every_threshold_and_ships_none():
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(accept={"footSlide": 0.01}), check_files=False)
    text = str(e.value)
    assert "accept.penetration" in text and "accept.boundaryJump" in text and "accept.loopSeam" in text
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(loop=False), check_files=False)
    assert "loopSeam: only for a clip with loop true" in str(e.value)
    s = spec.normalize(good_spec(loop=False, accept={"footSlide": 0.01, "penetration": 0.005, "boundaryJump": 0.01}), check_files=False)
    assert "loopSeam" not in s["accept"]


def test_spec_names_every_problem_at_once():
    with pytest.raises(spec.SpecError) as e:
        spec.normalize({"id": "", "fps": 0, "length": -1, "loop": "yes", "root": "sideways", "ground": "", "colour": "red"}, check_files=False)
    problems = e.value.problems
    for field in ("id:", "purpose:", "rig:", "fps:", "length:", "loop:", "root:", "ground:", "accept:", "unknown field 'colour'"):
        assert any(p.startswith(field) or field in p for p in problems), field


def test_spec_checks_key_poses_and_contacts():
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(keyPoses=[{"name": "a", "time": 0.5}, {"name": "a", "time": 0.2}, {"name": "b", "time": 3.0}],
                                 contacts={"detect": {"height": -1, "speed": 1}, "planted": [{"limb": "tail", "from": 0, "to": 1}]}), check_files=False)
    text = str(e.value)
    assert "names must be unique" in text and "time order" in text and "past the clip's length" in text
    assert "contacts.detect" in text and "contacts.planted[0]" in text


def test_spec_paths_resolve_beside_the_spec_then_here(tmp_path, monkeypatch):
    (tmp_path / "spec").mkdir(); (tmp_path / "project" / "rig").mkdir(parents=True)
    (tmp_path / "spec" / "map.json").write_text("{}")
    (tmp_path / "project" / "rig" / "rig.glb").write_bytes(b"")
    monkeypatch.chdir(tmp_path / "project")
    s = spec.normalize(good_spec(rig={"model": "rig/rig.glb", "map": "map.json"}), str(tmp_path / "spec"))
    assert s["rig"]["model"] == str(tmp_path / "project" / "rig" / "rig.glb")
    assert s["rig"]["map"] == str(tmp_path / "spec" / "map.json")
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(rig={"model": "nowhere.glb", "map": "map.json"}), str(tmp_path / "spec"))
    assert "rig.model: no file at nowhere.glb" in str(e.value)


def test_clip_spec_command(tmp_path, capsys):
    (tmp_path / "rig.glb").write_bytes(b"")
    (tmp_path / "map.json").write_text(json.dumps({"label": "x", "landmarks": {"Hips": "hips"}}))
    (tmp_path / "clip.json").write_text(json.dumps(good_spec()))
    assert clip_spec.main([str(tmp_path / "clip.json")]) == 0
    assert json.loads(capsys.readouterr().out)["root"]["mode"] == "in-place"
    (tmp_path / "clip.json").write_text(json.dumps(good_spec(fps="thirty")))
    assert clip_spec.main([str(tmp_path / "clip.json")]) == 1
    assert "error: fps:" in capsys.readouterr().out


# ---- skeleton maps -------------------------------------------------------------------------------------------------

def test_map_on_a_rig():
    doc = {"label": "x", "landmarks": {"Hips": "hips", "LeftFoot": "foot.l", "RightFoot": "foot.r", "L_Foot": "foot.l", "LeftToeBase": "toes.l"}}
    at = skelmap.on_rig(doc, ["Hips", "LeftFoot", "RightFoot", "LeftToeBase", "Spine"])
    assert at == {"hips": "Hips", "foot.l": "LeftFoot", "foot.r": "RightFoot", "toes.l": "LeftToeBase"}
    assert skelmap.contact_points(at, ["foot.l", "foot.r"]) == [("foot.l", "foot.l", "LeftFoot"), ("foot.l", "toes.l", "LeftToeBase"),
                                                                ("foot.r", "foot.r", "RightFoot")]
    with pytest.raises(skelmap.MapError, match="both stand at foot.l"):
        skelmap.on_rig(doc, ["Hips", "LeftFoot", "L_Foot", "RightFoot"])
    with pytest.raises(skelmap.MapError, match="no bone of this rig maps to foot.r"):
        skelmap.on_rig(doc, ["Hips", "LeftFoot"])


# ---- measurements --------------------------------------------------------------------------------------------------

def walk_point(frames, planted, slide=0.0, sink=0.0, rest=0.08):
    """One ankle in the glTF frame: planted (still) on the given frames, swinging forward 0.1 m high otherwise; a slide
    drifts it forward over the first planted run."""
    p = np.zeros((frames, 3)); p[:, 1] = rest - sink
    z = 0.0
    first = measure.runs(planted)[0]
    for f in range(frames):
        if planted[f]:
            if first[0] <= f <= first[1] and slide:
                p[f, 2] = z + slide * (f - first[0]) / (first[1] - first[0])
            else:
                p[f, 2] = z
        else:
            z += 0.1
            p[f, 1] += 0.1; p[f, 2] = z
    return p


def test_runs_and_diameter():
    assert measure.runs([True, True, False, True, False, False, True]) == [(0, 1), (3, 3), (6, 6)]
    assert measure.runs([]) == []
    assert measure.diameter(np.array([[0, 0], [0.03, 0.04], [0.01, 0.0]])) == pytest.approx(0.05)


def test_contact_windows_measure_slide_and_penetration():
    planted = [True] * 10 + [False] * 5 + [True] * 10
    p = walk_point(25, planted, slide=0.03, sink=0.02)
    key = ("foot.l", "foot.l", "LeftFoot")
    depth = {"foot.l": np.full(25, 0.02)}
    w = measure.contact_windows({key: p}, FPS, {"height": 0.01, "speed": 0.5}, ground=0.0, rest_heights={"foot.l": 0.08}, depth=depth)
    # frame 9 is still, but the step to frame 10 makes its central-difference speed too high
    assert [(x["from"], x["to"]) for x in w] == [(0, 8), (15, 24)]
    assert w[0]["slide"] == pytest.approx(0.03 * 8 / 9, abs=1e-4) and w[1]["slide"] == 0.0
    assert w[0]["penetration"] == pytest.approx(0.02) and w[0]["atBoundary"] == "start" and w[1]["atBoundary"] == "end"
    # a slower speed limit than the slide's own speed hides it: detection must stay looser than acceptance
    w = measure.contact_windows({key: p}, FPS, {"height": 0.01, "speed": 0.05}, ground=0.0, rest_heights={"foot.l": 0.08})
    assert all(x["from"] >= 9 for x in w)
    # on ground that is not flat only the speed decides
    w = measure.contact_windows({key: p}, FPS, {"height": 0.0, "speed": 0.5}, ground=None, rest_heights={"foot.l": 0.08})
    assert [(x["from"], x["to"]) for x in w] == [(0, 8), (15, 24)]


def body(frames, fps=FPS):
    """[F, 3 points, 3]: smooth periodic motion of three points (one fast, one slow, one still), period 1 s."""
    t = np.arange(frames) / fps
    pos = np.zeros((frames, 3, 3))
    pos[:, 0, 2] = 0.3 * np.sin(2 * math.pi * t); pos[:, 0, 1] = 1.0
    pos[:, 1, 0] = 0.02 * np.sin(2 * math.pi * t); pos[:, 1, 1] = 0.9 + 0.015 * np.cos(4 * math.pi * t)
    pos[:, 2, 1] = 1.5
    return pos


def test_boundary_jump_reads_a_pop_and_not_smooth_motion():
    pos = body(30)
    b = measure.boundary_jumps(pos)
    assert b["start"][0].max() < 1e-3 and b["end"][0].max() < 1e-3
    popped = pos.copy(); popped[0] += [0.05, 0, 0]
    b = measure.boundary_jumps(popped)
    assert b["start"][0][1:].max() == pytest.approx(0.05, abs=2e-3)        # the calm points read the pop
    assert b["end"][0].max() < 1e-3
    popped = pos.copy(); popped[-1, 2] += [0, 0.04, 0]                    # one still point jumps at the end
    b = measure.boundary_jumps(popped)
    assert b["end"][0][2] == pytest.approx(0.04, abs=1e-6) and b["start"][0].max() < 1e-3


def test_seam_reads_both_loop_ends():
    open_end = body(30)                       # frames 0..29 of a 1 s cycle at 30 fps
    s = measure.seam_jumps(open_end)
    assert s["open-end"][0].max() < 1e-3 and s["duplicate-end"][0].max() > 0.03
    duplicate = body(31)                      # frames 0..30: the last repeats the first
    s = measure.seam_jumps(duplicate)
    assert s["duplicate-end"][0].max() < 1e-3
    drift = open_end.copy(); drift[15:, :, 1] += np.linspace(0, 0.02, 15)[:, None]
    assert measure.seam_jumps(drift)["open-end"][0].max() == pytest.approx(0.02, abs=2e-3)


def test_loop_end_from_the_spec_then_the_poses():
    one = {"min": 1.0, "max": 1.0}
    assert measure.loop_end(30, FPS, one)[0] == "open"
    assert measure.loop_end(31, FPS, one)[0] == "duplicate"
    span = {"min": 0.5, "max": 2.0}
    assert measure.loop_end(31, FPS, span, body(31))[0] == "duplicate"
    assert measure.loop_end(30, FPS, span, body(30))[0] == "open"


def test_coverage_of_declared_contacts():
    windows = [{"limb": "foot.l", "from": 0, "to": 9}, {"limb": "foot.r", "from": 12, "to": 20}]
    out = measure.coverage([{"limb": "foot.l", "from": 0.0, "to": 0.5}], windows, FPS, 30)
    assert out[0]["frames"] == [0, 15] and out[0]["detectedShare"] == pytest.approx(10 / 16, abs=1e-3)


def test_judge():
    assert measure.judge("x", 0.01, 0.01)["passed"] is True
    assert measure.judge("x", 0.0101, 0.01)["passed"] is False
    j = measure.judge("x", None, 0.01, "not flat")
    assert j["passed"] is None and j["unmeasured"] == "not flat"


# ---- travel --------------------------------------------------------------------------------------------------------

def test_travel_line_keeps_sway_and_spans_a_whole_open_cycle():
    t = np.arange(30) / FPS
    ground = np.stack([0.02 * np.sin(2 * math.pi * t), 1.0 * t], axis=1)      # sway in x, 1 m/s in z
    line = travel.curve(ground, "line", "open")
    assert line[-1] == pytest.approx([0.0, 29 / 30], abs=2e-3)
    left = ground - line
    assert np.ptp(left[:, 1]) < 2e-3 and np.ptp(left[:, 0]) == pytest.approx(0.04, abs=2e-3)
    naive = travel.curve(ground, "line")                                      # first to last frame: sway leaks in
    assert abs(naive[-1, 0] - ground[-1, 0]) < 1e-12 and abs(naive[-1, 0]) > 3e-3
    assert np.allclose(travel.curve(ground, "hips"), ground - ground[0])


def test_travel_file_round_trip_and_refusals(tmp_path):
    path = str(tmp_path / "travel.json")
    t = travel.constant([0.0, 1.0], 30, FPS)
    travel.write(path, FPS, "line", "in-place", t, "open")
    assert np.allclose(travel.load(path, 30, FPS), t, atol=1e-6)
    with pytest.raises(ValueError, match="30 frames; the clip has 31"):
        travel.load(path, 31, FPS)
    with pytest.raises(ValueError, match="written at 30.0 fps"):
        travel.load(path, 30, 24.0)


# ---- glTF reader ---------------------------------------------------------------------------------------------------

def write_glb(path, times, hips_y, rotation_b):
    """Two joints: hips (animated translation) and its child b one metre up (animated rotation about x)."""
    blobs, views, accessors = [], [], []

    def add(values, kind):
        data = np.asarray(values, dtype=np.float32).tobytes()
        offset = sum(len(b) for b in blobs)
        blobs.append(data + b"\0" * (-len(data) % 4))
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(values), "type": kind}
        if kind == "SCALAR":
            acc.update(min=[float(min(values))], max=[float(max(values))])
        accessors.append(acc)
        return len(accessors) - 1

    t = add(times, "SCALAR")
    tr = add([[0, y, 0] for y in hips_y], "VEC3")
    rot = add([[math.sin(a / 2), 0, 0, math.cos(a / 2)] for a in rotation_b], "VEC4")
    doc = {"asset": {"version": "2.0"}, "nodes": [{"name": "hips", "children": [1]}, {"name": "b", "translation": [0, 1, 0]}],
           "skins": [{"joints": [0, 1]}], "accessors": accessors, "bufferViews": views,
           "buffers": [{"byteLength": sum(len(b) for b in blobs)}],
           "animations": [{"name": "walk", "samplers": [{"input": t, "output": tr}, {"input": t, "output": rot}],
                           "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}},
                                        {"sampler": 1, "target": {"node": 1, "path": "rotation"}}]}]}
    js = json.dumps(doc).encode(); js += b" " * (-len(js) % 4)
    binary = b"".join(blobs)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack("<I4s", len(js), b"JSON")); f.write(js)
        f.write(struct.pack("<I4s", len(binary), b"BIN\0")); f.write(binary)


def test_gltf_reader_samples_poses(tmp_path):
    path = str(tmp_path / "clip.glb")
    write_glb(path, [0, 1 / 30, 2 / 30], [0.9, 1.0, 0.9], [0, math.pi / 2, 0])
    g = gltf.Gltf(path)
    assert g.skeleton() == [("hips", None), ("b", "hips")] and g.animation_names() == ["walk"]
    assert gltf.whole_frames(g.key_times(), 30)[0] and not gltf.whole_frames(g.key_times(), 24)[0]
    w = g.pose_world(1 / 30)
    assert w["hips"][:3, 3] == pytest.approx([0, 1.0, 0], abs=1e-6)
    assert w["b"][:3, 3] == pytest.approx([0, 2.0, 0], abs=1e-6)
    assert (w["b"][:3, :3] @ [0, 1, 0]) == pytest.approx([0, 0, 1], abs=1e-6)       # turned 90 degrees about x
    half = g.pose_world(0.5 / 30)
    assert half["hips"][1, 3] == pytest.approx(0.95, abs=1e-6)
    with pytest.raises(gltf.GltfError, match="no animation 'run'"):
        g.animation("run")


def test_script_args_drop_a_passed_through_separator():
    import jamanim
    assert jamanim.script_args(["blender", "--python", "x.py", "--", "a", "--b"]) == ["a", "--b"]
    assert jamanim.script_args(["blender", "--python", "x.py", "--", "--", "a"]) == ["a"]
    assert jamanim.script_args(["blender"]) == []
