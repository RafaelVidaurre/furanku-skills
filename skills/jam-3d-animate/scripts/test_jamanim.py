"""Blender-free behaviour of the jam-3d-animate helpers: the clip spec, skeleton maps, the glTF reader, the clip
measurements, travel and the blockout. Run with `python3 -m pytest`."""
import json
import math
import os
import struct
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jamanim import gltf, measure, poses, skelmap, spec, travel  # noqa: E402
import blockout  # noqa: E402
import clip_spec  # noqa: E402

FPS = 30.0


def good_spec(**over):
    doc = {"id": "walk", "purpose": "a walk cycle", "rig": {"model": "rig.glb", "map": "map.json"}, "fps": 30,
           "length": {"min": 1.0, "max": 1.0}, "loop": True, "root": {"mode": "in-place"}, "ground": {"kind": "flat"},
           "accept": {"footSlide": 0.01, "penetration": 0.005, "boundaryJump": 0.01, "loopSeam": 0.01}}
    doc.update(over)
    return doc


# ---- clip spec -----------------------------------------------------------------------------------------------------

def test_spec_reads_the_one_shape_of_each_field():
    s = spec.normalize(good_spec(keyPoses={"file": "anim/keyposes.glb", "poses": [{"name": "contact", "time": 0.0}, {"name": "passing", "time": 0.25}]}),
                       check_files=False)
    assert s["root"] == {"mode": "in-place", "bone": None}
    assert s["ground"] == {"kind": "flat", "description": None}
    assert s["length"] == {"min": 1.0, "max": 1.0}
    assert s["keyPoses"]["file"] == "anim/keyposes.glb" and [p["name"] for p in s["keyPoses"]["poses"]] == ["contact", "passing"]
    assert s["contacts"] == {"detect": None, "planted": []}
    s = spec.normalize(good_spec(root={"mode": "root-motion", "bone": "root"}, ground={"kind": "change", "description": "a stair of 0.18 m"},
                                 length={"min": 0.8, "max": 1.2}), check_files=False)
    assert s["root"] == {"mode": "root-motion", "bone": "root"} and s["ground"] == {"kind": "change", "description": "a stair of 0.18 m"}
    assert s["length"]["max"] == 1.2


@pytest.mark.parametrize("field,value", [
    ("length", 1.0), ("root", "in-place"), ("ground", "flat"), ("ground", {"description": "a stair"}), ("ground", {"kind": "change"}),
    ("keyPoses", [{"name": "contact", "time": 0.0}]), ("root", {"mode": "in-place", "bone": "root"}), ("id", "Walk Cycle"),
    ("keyPoses", {"poses": [{"name": "contact", "time": 0.0}]}),
])
def test_spec_refuses_any_other_shape(field, value):
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(**{field: value}), check_files=False)
    assert any(p.startswith(field) for p in e.value.problems), e.value.problems


def test_spec_requires_every_threshold_and_ships_none():
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(accept={"footSlide": 0.01}), check_files=False)
    text = str(e.value)
    assert "accept.penetration" in text and "accept.boundaryJump" in text and "accept.loopSeam" in text
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(loop=False), check_files=False)
    assert "loopSeam: only for a clip with loop true" in str(e.value)
    with pytest.raises(spec.SpecError, match="accept.footSlide"):
        spec.normalize(good_spec(accept={"footSlide": 0, "penetration": 0.005, "boundaryJump": 0.01, "loopSeam": 0.01}), check_files=False)
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
        spec.normalize(good_spec(keyPoses={"file": "keyposes.glb", "poses": [{"name": "a", "time": 0.5}, {"name": "a", "time": 0.2}, {"name": "b", "time": 3.0}]},
                                 contacts={"detect": {"height": 0, "speed": 1}, "planted": [{"limb": "tail", "from": 0, "to": 1}]}), check_files=False)
    text = str(e.value)
    assert "names must be unique" in text and "time order" in text and "past the clip's length" in text
    assert "contacts.detect" in text and "contacts.planted[0]" in text


def test_spec_paths_are_project_relative_and_open_from_the_project_root(tmp_path, monkeypatch):
    (tmp_path / "rig").mkdir(); (tmp_path / "anim").mkdir()
    (tmp_path / "rig" / "rig.glb").write_bytes(b"")
    (tmp_path / "rig" / "map.json").write_text("{}")
    doc = good_spec(rig={"model": "rig/rig.glb", "map": "rig/map.json"}, keyPoses={"file": "anim/keyposes.glb", "poses": [{"name": "a", "time": 0}]})
    s = spec.normalize(doc, str(tmp_path))                                  # the key-pose file is made later: not required here
    assert s["rig"]["model"] == os.path.join(str(tmp_path), "rig/rig.glb") and s["keyPoses"]["file"] == os.path.join(str(tmp_path), "anim/keyposes.glb")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "anim" / "clip.json").write_text(json.dumps(doc))
    assert spec.load("anim/clip.json")["rig"]["map"] == "rig/map.json"       # not beside clip.json: from the project root
    for bad in ("/abs/rig.glb", "../rig.glb", "rig/./rig.glb", "rig\\rig.glb", "C:/rig.glb"):
        with pytest.raises(spec.SpecError, match="rig.model: a project-relative path"):
            spec.normalize(good_spec(rig={"model": bad, "map": "rig/map.json"}), check_files=False)
    with pytest.raises(spec.SpecError) as e:
        spec.normalize(good_spec(rig={"model": "nowhere.glb", "map": "rig/map.json"}))
    assert "rig.model: no file at nowhere.glb" in str(e.value)


@pytest.mark.parametrize("over", [
    {"contacts": {"detect": None}}, {"contacts": None}, {"keyPoses": None}, {"contacts": {"planted": None}},
    {"root": {"mode": "root-motion", "bone": None}}, {"root": {"mode": "in-place", "bone": "root"}},
    {"fps": float("inf")}, {"fps": float("nan")}, {"length": {"min": 1.0, "max": float("inf")}},
    {"accept": {"footSlide": float("inf"), "penetration": 0.005, "boundaryJump": 0.01, "loopSeam": 0.01}},
    {"accept": {"footSlide": 0.01, "penetration": 0.005, "boundaryJump": 0.01}},
    {"loop": False}, {"id": "walk\n"}, {"purpose": " \t"}, {"rig": {"model": "rig.glb\n", "map": "map.json"}},
    {"$schema": 1}, {"colour": "red"},
    {"keyPoses": {"file": "kp.glb", "poses": [{"name": "a", "time": 0.5}, {"name": "a", "time": 0.6}]}},
    {"keyPoses": {"file": "kp.glb", "poses": [{"name": "a", "time": 0.5}, {"name": "b", "time": 0.2}]}},
    {"keyPoses": {"file": "kp.glb", "poses": [{"name": "a", "time": 1.01}]}},
    {"contacts": {"planted": [{"limb": "foot.l", "from": 0.5, "to": 0.2}]}},
])
def test_spec_refuses_what_the_toolkit_refuses(over):
    with pytest.raises(spec.SpecError):
        spec.normalize(good_spec(**over), check_files=False)


def test_spec_refuses_numbers_that_are_not_json(tmp_path):
    for text in ("Infinity", "-Infinity", "NaN", "1e400"):
        path = tmp_path / "clip.json"
        path.write_text(json.dumps(good_spec()).replace('"fps": 30', '"fps": %s' % text))
        with pytest.raises(spec.SpecError, match="fps|not JSON"):
            spec.load(str(path), check_files=False)


def test_spec_without_thresholds_for_measuring_only():
    doc = good_spec(); del doc["accept"]
    with pytest.raises(spec.SpecError, match="accept"):
        spec.normalize(doc, check_files=False)
    assert spec.normalize(doc, check_files=False, thresholds=False)["accept"] is None


def test_clip_spec_command(tmp_path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "rig.glb").write_bytes(b"")
    (tmp_path / "map.json").write_text(json.dumps({"label": "x", "landmarks": {"Hips": "hips"}}))
    (tmp_path / "clip.json").write_text(json.dumps(good_spec()))
    assert clip_spec.main(["clip.json"]) == 0
    assert json.loads(capsys.readouterr().out)["root"]["mode"] == "in-place"
    (tmp_path / "clip.json").write_text(json.dumps(good_spec(fps="thirty")))
    assert clip_spec.main(["clip.json"]) == 1
    assert "error: fps:" in capsys.readouterr().out
    (tmp_path / "clip.json").write_text(json.dumps(good_spec(contacts={"detect": None})))
    assert clip_spec.main(["clip.json", "--no-files"]) == 1
    assert "error: contacts.detect" in capsys.readouterr().out
    (tmp_path / "clip.json").write_text(json.dumps(good_spec(rig={"model": "elsewhere.glb", "map": "nowhere.json"}, fps=29.97)))
    assert clip_spec.main(["clip.json", "--no-files"]) == 0


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


def test_map_reads_the_three_shapes(tmp_path):
    shapes = {"map.json": {"label": "x", "landmarks": {"Hips": "hips", "LeftFoot": "foot.l", "RightFoot": "foot.r"}},
              "descriptor.json": {"id": "p", "rig": {"landmarks": {"Hips": "hips", "LeftFoot": "foot.l", "RightFoot": "foot.r"}}},
              "profile.json": {"label": "x", "bones": {"hips": "Hips", "foot.l": "LeftFoot", "foot.r": "RightFoot"}}}
    for name, doc in shapes.items():
        (tmp_path / name).write_text(json.dumps(doc))
        assert skelmap.load(str(tmp_path / name))["landmarks"] == {"Hips": "hips", "LeftFoot": "foot.l", "RightFoot": "foot.r"}, name
    for bad in ({"label": "x"}, {"landmarks": {}}, {"landmarks": {"Hips": "pelvis"}}, {"bones": {"hips": 3}}, []):
        (tmp_path / "bad.json").write_text(json.dumps(bad))
        with pytest.raises(skelmap.MapError):
            skelmap.load(str(tmp_path / "bad.json"))


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


def test_a_jump_inside_the_clip_neither_hides_an_end_pop_nor_goes_unread():
    pos = body(30)
    assert measure.step_jumps(pos).max() < 1e-3                             # smooth motion reads close to 0
    stepped = pos.copy(); stepped[0] += [0.08, 0, 0]; stepped[15:] += [0, 0, 0.08]
    b = measure.boundary_jumps(stepped)
    assert b["start"][0][1:].max() == pytest.approx(0.08, abs=2e-3)         # the pop at the start, at its size
    assert b["steps"][15].max() == pytest.approx(0.08, abs=2e-3) and b["steps"].argmax() // 3 == 15
    spiked = pos.copy(); spiked[12, 2] += [0, 0.03, 0]
    assert measure.step_jumps(spiked)[:, 2].max() == pytest.approx(0.05, abs=1e-6)   # one frame out of line by d reads 5/3 d
    assert measure.step_jumps(stepped)[:4].max() == 0 and measure.step_jumps(stepped)[-3:].max() == 0


def test_a_loop_that_does_not_close_fails_whatever_happens_inside_it():
    pos = body(30)
    gap = pos.copy(); gap[12:] += [0.05, 0, 0]; gap[22:] -= [0.05, 0, 0]; gap[25:] += [0, 0.2, 0]
    assert measure.seam_jumps(gap)["open-end"][0].max() == pytest.approx(0.2, abs=5e-3)


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


def test_a_declared_window_measures_a_slide_too_fast_to_detect():
    planted = [True] * 10 + [False] * 5 + [True] * 10
    p = walk_point(25, planted, slide=0.4)                                 # 0.4 m over 9 frames: about 1.3 m/s
    toe = p.copy(); toe[:, 1] -= 0.06
    pts = {("foot.l", "foot.l", "LeftFoot"): p, ("foot.l", "toes.l", "LeftToe"): toe}
    detect = {"height": 0.01, "speed": 0.5}
    windows = measure.contact_windows(pts, FPS, detect, ground=0.0, rest_heights={"foot.l": 0.08, "toes.l": 0.02})
    assert all(w["from"] >= 10 for w in windows)                            # detection never sees the slide
    d = measure.declared_slides(pts, [{"limb": "foot.l", "from": 0.0, "to": 9 / FPS}], FPS, 25)
    assert d[0]["frames"] == [0, 9] and d[0]["slide"] == pytest.approx(0.4, abs=1e-4)
    held = dict(pts); held[("foot.l", "toes.l", "LeftToe")] = np.tile(toe[:1], (25, 1))   # the ball stays put: a pivot
    assert measure.declared_slides(held, [{"limb": "foot.l", "from": 0.0, "to": 9 / FPS}], FPS, 25)[0]["slide"] == 0.0
    runs = measure.grounded_runs(pts, 0.01, 0.0, {"foot.l": 0.08, "toes.l": 0.02}, windows)
    skating = [r for r in runs if r["skating"]]
    assert skating and skating[0]["from"] == 0 and skating[0]["slide"] == pytest.approx(0.4, abs=1e-4)
    assert not any(r["skating"] for r in runs if r["from"] >= 10)


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

def write_glb(path, times, hips_y, rotation_b, rotation_times=None, b_offset=1.0):
    """Two joints: hips (animated translation) and its child b b_offset metres up (animated rotation about x, keyed at
    rotation_times, default the same times)."""
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
    rt = t if rotation_times is None else add(rotation_times, "SCALAR")
    tr = add([[0, y, 0] for y in hips_y], "VEC3")
    rot = add([[math.sin(a / 2), 0, 0, math.cos(a / 2)] for a in rotation_b], "VEC4")
    doc = {"asset": {"version": "2.0"}, "nodes": [{"name": "hips", "children": [1]}, {"name": "b", "translation": [0, b_offset, 0]}],
           "skins": [{"joints": [0, 1]}], "accessors": accessors, "bufferViews": views,
           "buffers": [{"byteLength": sum(len(b) for b in blobs)}],
           "animations": [{"name": "walk", "samplers": [{"input": t, "output": tr}, {"input": rt, "output": rot}],
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


def test_gltf_reader_decodes_buffer_uris(tmp_path):
    glb = str(tmp_path / "clip.glb")
    write_glb(glb, [0, 1 / 30, 2 / 30], [0.9, 1.0, 0.9], [0, math.pi / 2, 0])
    g = gltf.Gltf(glb)
    (tmp_path / "clip data.bin").write_bytes(g.bin)
    doc = dict(g.json, buffers=[{"byteLength": g.json["buffers"][0]["byteLength"], "uri": "clip%20data.bin"}])
    (tmp_path / "clip.gltf").write_text(json.dumps(doc))
    assert gltf.Gltf(str(tmp_path / "clip.gltf")).pose_world(1 / 30)["b"][1, 3] == pytest.approx(2.0, abs=1e-6)


def test_sampling_needs_a_key_on_every_frame(tmp_path):
    path = str(tmp_path / "clip.glb")
    write_glb(path, [0, 1 / 30, 2 / 30], [0.9, 1.0, 0.9], [0, 0.5, 0])
    assert gltf.sampling(gltf.Gltf(path), 30)["passed"]
    write_glb(path, [0, 1 / 15, 2 / 15], [0.9, 1.0, 0.9], [0, 0.5, 0])             # whole frames of 30, every other one
    check = gltf.sampling(gltf.Gltf(path), 30)
    assert not check["passed"] and check["framesWithoutKey"] == [1, 3]
    write_glb(path, [0, 1 / 30, 2 / 30], [0.9, 1.0, 0.9], [0.3, 0.3], rotation_times=[0, 2 / 30])   # held still: 2 keys
    assert gltf.sampling(gltf.Gltf(path), 30)["passed"]
    write_glb(path, [0, 1 / 30, 2 / 30], [0.9, 1.0, 0.9], [0.0, 0.3], rotation_times=[0, 2 / 30])   # moving on 2 keys
    check = gltf.sampling(gltf.Gltf(path), 30)
    assert not check["passed"] and check["sparse"][0].startswith("b.rotation")


def test_rest_difference(tmp_path):
    a, b = str(tmp_path / "a.glb"), str(tmp_path / "b.glb")
    write_glb(a, [0, 1 / 30], [0.9, 1.0], [0, 0])
    write_glb(b, [0, 1 / 30], [0.9, 1.0], [0, 0], b_offset=1.01)
    same = gltf.rest_difference(gltf.Gltf(a), gltf.Gltf(a), ["hips", "b"])
    assert same["position"] == 0 and same["linear"] == 0
    moved = gltf.rest_difference(gltf.Gltf(b), gltf.Gltf(a), ["hips", "b"])
    assert moved["position"] == pytest.approx(0.01, abs=1e-6) and moved["positionBone"] == "b"


# ---- blockout ------------------------------------------------------------------------------------------------------

def test_slerp_and_frames_between():
    q0, q1 = [0, 0, 0, 1], [math.sin(math.pi / 4), 0, 0, math.cos(math.pi / 4)]           # 0 and 90 degrees about x
    assert poses.slerp(q0, q1, 0.5) == pytest.approx([math.sin(math.pi / 8), 0, 0, math.cos(math.pi / 8)])
    assert poses.slerp(q0, [-x for x in q1], 0.5) == pytest.approx(poses.slerp(q0, q1, 0.5))  # the shorter way
    out = poses.frames_between([[0, 0, 0], [0, 0, 1.0]], [2, 6], 10)
    assert out[:, 2] == pytest.approx([0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 1])
    loop = poses.frames_between([[0, 0, 0], [0, 0, 1.0]], [0, 4], 8, cycle=8)                # back to the first pose at 8
    assert loop[:, 2] == pytest.approx([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25])


def test_blockout_writes_a_clip_on_every_frame(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    write_glb(str(tmp_path / "keyposes.glb"), [0, 0.4], [0.9, 1.3], [0, math.pi / 2])
    doc = good_spec(loop=False, length={"min": 0.5, "max": 0.5}, accept={"footSlide": 0.01, "penetration": 0.005, "boundaryJump": 0.01},
                    keyPoses={"file": "keyposes.glb", "poses": [{"name": "stand", "time": 0.0}, {"name": "reach", "time": 0.4}]})
    (tmp_path / "rig.glb").write_bytes(b""); (tmp_path / "map.json").write_text("{}")
    (tmp_path / "clip.json").write_text(json.dumps(doc))
    assert blockout.main(["clip.json", "out.glb"]) == 0
    done = json.loads(capsys.readouterr().out)
    assert done["frames"] == 16 and [p["frame"] for p in done["poses"]] == [0, 12]
    g = gltf.Gltf("out.glb")
    assert g.animation_names() == ["walk"] and gltf.sampling(g, 30)["passed"] and len(g.key_times()) == 16
    mid = g.pose_world(6 / 30)
    assert mid["hips"][1, 3] == pytest.approx(1.1, abs=1e-6)                                 # travel halfway
    assert (mid["b"][:3, :3] @ [0, 1, 0]) == pytest.approx([0, math.sin(math.pi / 4), math.sin(math.pi / 4)], abs=1e-6)   # 45 degrees
    assert g.pose_world(15 / 30)["hips"][1, 3] == pytest.approx(1.3, abs=1e-6)               # the last pose holds
    (tmp_path / "clip.json").write_text(json.dumps(dict(doc, loop=True, accept=dict(doc["accept"], loopSeam=0.01))))
    assert blockout.main(["clip.json", "out.glb"]) == 1 and "--loop-end" in capsys.readouterr().out
    assert blockout.main(["clip.json", "out.glb", "--loop-end", "open"]) == 0
    assert json.loads(capsys.readouterr().out)["frames"] == 15


def test_script_args_drop_a_passed_through_separator():
    import jamanim
    assert jamanim.script_args(["blender", "--python", "x.py", "--", "a", "--b"]) == ["a", "--b"]
    assert jamanim.script_args(["blender", "--python", "x.py", "--", "--", "a"]) == ["a"]
    assert jamanim.script_args(["blender"]) == []
