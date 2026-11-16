"""Blender-free behaviour of the jam-rig helpers: landmark files, bone-name tables, skeleton profiles and the skeleton
built from them, body regions, weight clean-up, the deformation check and the glTF reader. Run with `python3 -m pytest`."""
import json
import os
import struct
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jamrig import figure, gltf, landmarks as lm, regions, skeleton  # noqa: E402
import landmarks_from_rig  # noqa: E402

SKILL = os.path.dirname(HERE)
TOOLKIT_SCHEMA = os.path.join(SKILL, "..", "jam-setup", "assets", "toolkit", "schemas", "landmarks.schema.json")
TABLE = os.path.join(SKILL, "assets", "landmark-maps", "left-right-camelcase.json")
PROFILE = os.path.join(SKILL, "assets", "profiles", "vrm-humanoid.json")
HEIGHT = 1.7


def points(mittens=False):
    return {name: tuple(v * HEIGHT for v in p) for name, p in figure.joints(mittens)[0].items()}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---- vocabulary and landmark files ---------------------------------------------------------------------------------

@pytest.mark.skipif(not os.path.isfile(TOOLKIT_SCHEMA), reason="the toolkit's landmark schema is not beside this skill")
def test_vocabulary_is_the_toolkit_schema():
    marks = load(TOOLKIT_SCHEMA)["$defs"]["LandmarkFile"]["properties"]["landmarks"]
    assert sorted(marks["required"]) == sorted(lm.CORE)
    assert sorted(marks["properties"]) == sorted(lm.ALL)
    assert sorted(load(TOOLKIT_SCHEMA)["$defs"]["LandmarkFile"]["properties"]) == sorted(lm.FILE_KEYS)


def test_hierarchy_hangs_every_landmark_from_hips():
    assert lm.parent_of("hips") is None
    for name in lm.ALL:
        seen, cur = [], name
        while cur is not None:
            assert cur in lm.ALL and cur not in seen
            seen.append(cur); cur = lm.parent_of(cur)
        assert seen[-1] == "hips"
    assert lm.parent_of("index-1.l") == "hand.l" and lm.parent_of("thumb-3.r") == "thumb-2.r"
    assert lm.parent_of("shoulder.r") == "chest" and lm.parent_of("upper-leg.l") == "hips"
    assert lm.main_child("hand.l") == "middle-1.l" and lm.main_child("head") is None and lm.main_child("pinky-3.r") is None


def test_file_round_trips_through_both_frames():
    pts = points()
    for up in ("+Y", "+Z"):
        data = lm.validate(lm.from_working(pts, "test", up))
        back = lm.to_working(data)
        assert all(np.allclose(back[k], pts[k], atol=1e-4) for k in pts)
    y_up = lm.from_working(pts, "test", "+Y")["landmarks"]
    assert y_up["head"][1] > y_up["hips"][1] and y_up["toes.l"][2] > y_up["foot.l"][2]      # up is +Y, front is +Z


@pytest.mark.parametrize("change, message", [
    (lambda d: d["landmarks"].pop("hand.l"), "landmarks missing: hand.l"),
    (lambda d: d.update(units="centimeters"), "units must be"),
    (lambda d: d.update(up="-X"), "up must be"),
    (lambda d: d.update(source=" "), "source must say"),
    (lambda d: d["landmarks"].update(elbow=[0, 0, 0]), "not landmarks: elbow"),
    (lambda d: d["landmarks"].update(hips=[0, "1", 2]), "landmark hips must be"),
    (lambda d: d["landmarks"].pop("index-2.l"), "finger chains need joints 1, 2 and 3: index.l"),
    (lambda d: d.update(height=1.7), "unknown keys: height"),
])
def test_file_faults_are_named(change, message):
    data = lm.from_working(points(), "test")
    change(data)
    with pytest.raises(lm.LandmarkError, match=message):
        lm.validate(data)


# ---- bone-name tables ----------------------------------------------------------------------------------------------

def test_shipped_table_places_every_core_landmark_and_no_other():
    table = lm.load_table(load(TABLE))
    assert sorted(table.values()) == sorted(lm.CORE)


def test_identity_table_reads_a_landmark_named_skeleton_with_or_without_a_skin(tmp_path, capsys):
    pts = points()
    y_up = lm.from_working(pts, "t")["landmarks"]
    order = [name for name in lm.ALL]
    joints = [(name, order.index(lm.parent_of(name)) if lm.parent_of(name) else None, tuple(y_up[name])) for name in order]
    table = os.path.join(SKILL, "assets", "landmark-maps", "landmark-names.json")
    assert lm.load_table(load(table)) == {name: name for name in lm.ALL}
    for skinned in (True, False):
        rig, out = str(tmp_path / "rig.glb"), str(tmp_path / ("out%d.json" % skinned))
        write_rig(rig, joints, skinned=skinned)
        assert landmarks_from_rig.main([rig, out, "--map", table]) == 0
        printed = json.loads(capsys.readouterr().out)
        assert printed["joints"] == ("skin" if skinned else "named nodes") and printed["unmapped"] == [] and len(printed["fingers"]) == 10
        assert all(np.allclose(lm.to_working(lm.read(out))[k], pts[k], atol=1e-4) for k in pts)


def test_table_shapes():
    plain = {"landmarks": {"Hips": "hips"}}
    assert lm.load_table(plain) == lm.load_table({"rig": plain}) == lm.load_table({"bones": {"hips": "Hips"}}) == {"Hips": "hips"}
    with pytest.raises(lm.LandmarkError, match="outside the vocabulary"):
        lm.load_table({"landmarks": {"Hips": "pelvis"}})
    with pytest.raises(lm.LandmarkError, match="no table found"):
        lm.load_table({"label": "x"})


def test_map_bones_reports_unmapped_and_missing():
    table = lm.load_table(load(TABLE))
    bones = {"ns:" + bone: (i, 0, 0) for i, bone in enumerate(table)}
    bones["ns:Spine01"] = (9, 9, 9); del bones["ns:LeftToeBase"]
    placed, unmapped, missing = lm.map_bones(bones, table, strip_prefix="ns:")
    assert unmapped == ["ns:Spine01"] and missing == ["toes.l"] and len(placed) == 20
    assert lm.map_bones(bones, table)[2] == list(lm.CORE)                       # without the prefix nothing matches
    with pytest.raises(lm.LandmarkError, match="more than one bone"):
        lm.map_bones({"Hips": (0, 0, 0), "pelvis": (0, 0, 0)}, {"Hips": "hips", "pelvis": "hips"})


def test_derive_fills_spine_chest_and_shoulders_only():
    pts = points(mittens=True)
    for name in ("spine", "chest", "shoulder.l", "shoulder.r", "toes.r"):
        del pts[name]
    filled, derived = lm.derive_missing(pts)
    assert derived == ["spine", "chest", "shoulder.l", "shoulder.r"] and "toes.r" not in filled
    assert filled["hips"][2] < filled["spine"][2] < filled["chest"][2] < filled["neck"][2]
    assert 0 < filled["shoulder.l"][0] < filled["upper-arm.l"][0] and filled["shoulder.r"][0] < 0
    only_chest = dict(points(mittens=True)); del only_chest["chest"]
    assert lm.derive_missing(only_chest)[1] == ["chest"]
    assert only_chest["spine"][2] < lm.derive_missing(only_chest)[0]["chest"][2] < only_chest["neck"][2]


# ---- sanity checks -------------------------------------------------------------------------------------------------

def codes(found, level=None):
    return sorted({f["code"] for f in found if level is None or f["level"] == level})


def test_check_accepts_the_figure():
    pts = points()
    bounds = ((-0.7, -0.2, 0.0), (0.7, 0.2, HEIGHT))
    assert lm.check(pts, bounds) == [] and lm.check(pts) == []


def test_check_names_what_is_wrong():
    pts = points()
    swapped = {k[:-1] + ("r" if k.endswith(".l") else "l") if "." in k else k: v for k, v in pts.items()}
    assert "sides" in codes(lm.check(swapped), "error")
    knee = dict(pts, **{"lower-leg.l": pts["foot.l"], "foot.l": pts["lower-leg.l"]})
    assert "leg-order" in codes(lm.check(knee), "error")
    spine = dict(pts, spine=pts["chest"], chest=pts["spine"])
    assert "spine-order" in codes(lm.check(spine), "error")
    elbow = dict(pts, **{"lower-arm.r": pts["hand.r"], "hand.r": pts["lower-arm.r"]})
    assert "arm-order" in codes(lm.check(elbow), "error")
    double = {k: tuple(x * 2 for x in v) for k, v in pts.items()}
    assert "outside-bounds" in codes(lm.check(double, ((-0.7, -0.2, 0.0), (0.7, 0.2, HEIGHT))), "error")
    lifted = dict(pts, **{"hand.l": (pts["hand.l"][0], pts["hand.l"][1], pts["hand.l"][2] + 0.3)})
    assert codes(lm.check(lifted)) == ["asymmetric"] and not lm.errors(lm.check(lifted))
    backward = {k: (-v[0], -v[1], v[2]) for k, v in swapped.items()}            # turned to face away: sides right again
    assert codes(lm.check(backward)) == ["facing"]


# ---- profiles and the skeleton plan --------------------------------------------------------------------------------

def by_name(bones):
    return {b["name"]: b for b in bones}


def test_landmark_skeleton_is_one_bone_per_landmark():
    bones = skeleton.plan(points(), None, "auto")
    assert [b["name"] for b in bones if b["landmark"] != b["name"]] == [] and len(bones) == len(lm.ALL)
    assert all(b["parent"] == lm.parent_of(b["name"]) and b["deform"] and b["placed"] == "landmark" for b in bones)
    order = [b["name"] for b in bones]
    assert all(b["parent"] is None or order.index(b["parent"]) < order.index(b["name"]) for b in bones)
    b = by_name(bones)
    assert b["upper-arm.l"]["tail"] == b["lower-arm.l"]["head"] and b["hand.l"]["tail"] == b["middle-1.l"]["head"]
    assert b["head"]["tail"][2] > b["head"]["head"][2] and b["toes.l"]["tail"][1] < b["toes.l"]["head"][1]     # up; forward
    assert len(skeleton.plan(points(), None, "none")) == len(lm.CORE) == len(skeleton.plan(points(mittens=True), None, "auto"))


def test_hand_without_fingers_reaches_to_the_mesh_end():
    bones = by_name(skeleton.plan(points(mittens=True), None, "auto", {"hand.l": 0.17, "hand.r": 0.17, "top": HEIGHT, "height": HEIGHT}))
    hand = bones["hand.l"]
    assert np.isclose(np.linalg.norm(np.subtract(hand["tail"], hand["head"])), 0.17)
    assert np.isclose(bones["head"]["tail"][2], HEIGHT - 0.01 * HEIGHT)


def test_shipped_profile_builds_its_own_names_and_a_longer_spine():
    profile = skeleton.load_profile(load(PROFILE))
    assert sorted(profile["bones"]) == sorted(lm.ALL)
    bones = skeleton.plan(points(), profile, "auto")
    b = by_name(bones)
    assert len(bones) == len(profile["hierarchy"]) == len(lm.ALL) + 1
    assert all(x["parent"] == profile["hierarchy"][x["name"]] for x in bones)
    assert b["chest"]["placed"] == "between" and b["chest"]["landmark"] is None and b["chest"]["anchor"] == "spine" and b["chest"]["deform"]
    assert np.allclose(b["chest"]["head"], np.add(b["spine"]["head"], b["upperChest"]["head"]) / 2)
    assert b["spine"]["tail"] == b["chest"]["head"] and b["chest"]["tail"] == b["upperChest"]["head"] and b["upperChest"]["tail"] == b["neck"]["head"]
    assert b["upperChest"]["landmark"] == "chest" and b["leftLittleDistal"]["landmark"] == "pinky-3.l"
    without = by_name(skeleton.plan(points(), profile, "none"))
    assert len(without) == 22 and "leftIndexProximal" not in without


def test_profile_extras_root_chain_and_helper_bones():
    profile = {"bones": {"hips": "pelvis", "spine": "spine_02", "chest": "spine_04", "neck": "neck_01", "head": "head",
                         "upper-arm.l": "arm_l", "lower-arm.l": "fore_l", "hand.l": "hand_l", "index-1.l": "index_01_l",
                         "index-2.l": "index_02_l", "index-3.l": "index_03_l"},
               "hierarchy": {"root": None, "pelvis": "root", "spine_01": "pelvis", "spine_02": "spine_01", "spine_03": "spine_02",
                             "spine_04": "spine_03", "spine_05": "spine_04", "neck_01": "spine_05", "neck_02": "neck_01", "head": "neck_02",
                             "arm_l": "spine_05", "fore_l": "arm_l", "twist_l": "arm_l", "hand_l": "fore_l", "index_meta_l": "hand_l",
                             "index_01_l": "index_meta_l", "index_02_l": "index_01_l", "index_03_l": "index_02_l",
                             "ik_root": "root", "ik_hand_l": "ik_root"}}
    skeleton.validate_profile(profile)
    pts = points()
    b = by_name(skeleton.plan(pts, profile, "auto"))
    assert b["root"]["placed"] == "origin" and b["root"]["head"] == (0.0, 0.0, 0.0) and not b["root"]["deform"]
    assert b["ik_hand_l"]["placed"] == "parent" and b["ik_hand_l"]["head"] == (0.0, 0.0, 0.0) and not b["ik_hand_l"]["deform"]
    assert b["twist_l"]["placed"] == "parent" and b["twist_l"]["head"] == pts["upper-arm.l"] and not b["twist_l"]["deform"]
    assert np.allclose(b["spine_01"]["head"], np.add(pts["hips"], pts["spine"]) / 2) and b["spine_01"]["anchor"] == "hips"
    assert np.allclose(b["spine_05"]["head"], np.add(pts["chest"], pts["neck"]) / 2)        # leads to the neck, not to the arm
    assert b["spine_05"]["tail"] == b["neck_01"]["head"] and b["spine_05"]["deform"]
    assert np.allclose(b["index_meta_l"]["head"], np.add(pts["hand.l"], pts["index-1.l"]) / 2) and b["index_meta_l"]["anchor"] == "hand.l"
    assert "arm_r" not in b and b["hand_l"]["tail"] != b["hand_l"]["head"]
    off = by_name(skeleton.plan(pts, profile, "none"))
    assert "index_meta_l" not in off and "index_01_l" not in off and "twist_l" in off     # the metacarpal goes with its finger


def test_profile_without_hierarchy_skips_missing_landmarks():
    profile = {"bones": {k: k.upper() for k in lm.CORE if not k.startswith(("shoulder", "toes", "chest"))}}
    b = by_name(skeleton.plan(points(mittens=True), profile, "auto"))
    assert b["UPPER-ARM.L"]["parent"] == "SPINE" and b["NECK"]["parent"] == "SPINE" and "TOES.L" not in b
    assert b["FOOT.L"]["tail"][1] < b["FOOT.L"]["head"][1]


def test_an_existing_rig_is_described_like_a_planned_one():
    profile = skeleton.load_profile(load(PROFILE))
    planned = skeleton.plan(points(), profile, "auto")
    extra = [("root", None), ("hips", "root")] + [(b["name"], b["parent"]) for b in planned if b["name"] != "hips"] + [("hair", "head")]
    described = by_name(skeleton.describe_rig(extra, lm.load_table(profile)))
    for b in planned:
        assert (described[b["name"]]["landmark"], described[b["name"]]["anchor"], described[b["name"]]["deform"]) == (b["landmark"], b["anchor"], True)
    assert described["chest"]["placed"] == "between" and described["root"]["anchor"] is None and not described["hair"]["deform"]


@pytest.mark.parametrize("profile, message", [
    ({"bones": {"pelvis": "hips"}}, "not landmarks: pelvis"),
    ({"bones": {"spine": "a"}}, "must name the bone at `hips`"),
    ({"bones": {"hips": "a", "spine": "a"}}, "one bone is named for several landmarks"),
    ({"bones": {"hips": "a"}, "hierarchy": {"b": None}}, "lacks bones that `bones` names: a"),
    ({"bones": {"hips": "a"}, "hierarchy": {"a": "b"}}, "parents that are not bones"),
    ({"bones": {"hips": "a"}, "hierarchy": {"a": "b", "b": "a"}}, "no root"),
])
def test_profile_faults_are_named(profile, message):
    with pytest.raises(skeleton.ProfileError, match=message):
        skeleton.validate_profile(profile)


def test_profile_is_found_inside_configuration_and_adapter_files():
    profile = load(PROFILE)
    assert skeleton.load_profile({"skeletons": {"vrm": profile}}) is profile
    assert skeleton.load_profile({"facts": {"skeletons": {"a": profile, "b": {"bones": {"hips": "x"}}}}}, "a") is profile
    assert skeleton.load_profile({"skeletons": {}, "engine": {"adapter": "x", "facts": {"skeletons": {"a": profile}}}}, "a") is profile
    with pytest.raises(skeleton.ProfileError, match="name one with --profile-id"):
        skeleton.load_profile({"skeletons": {"a": profile, "b": profile}})
    with pytest.raises(skeleton.ProfileError, match="no skeleton profile 'c'"):
        skeleton.load_profile({"skeletons": {"a": profile}}, "c")


# ---- regions -------------------------------------------------------------------------------------------------------

def tube_figure(pts, per_ring=10, radius_scale=1.0):
    """A humanoid made of tubes around each body segment: (coords, edges, {segment name: vertex indices})."""
    radii = {"head": 0.09, "neck": 0.05, "torso": 0.13, "pelvis": 0.13, "upper-arm": 0.045, "lower-arm": 0.04, "hand": 0.03,
             "upper-leg": 0.075, "lower-leg": 0.055, "foot": 0.04, "finger": 0.008}
    def tip(name):
        a, b = np.array(pts[lm.parent_of(name)]), np.array(pts[name])
        return tuple(b + (b - a) * 0.9)
    spans = [("head", pts["head"], (0, 0, HEIGHT), "head"), ("torso", pts["spine"], pts["neck"], "torso"), ("pelvis", (0, 0, pts["upper-leg.l"][2]), pts["spine"], "pelvis")]
    for s in lm.SIDES:
        fore = np.subtract(pts["hand." + s], pts["lower-arm." + s])
        spans += [("upper-arm." + s, pts["upper-arm." + s], pts["lower-arm." + s], "upper-arm"), ("lower-arm." + s, pts["lower-arm." + s], pts["hand." + s], "lower-arm"),
                  ("upper-leg." + s, pts["upper-leg." + s], pts["lower-leg." + s], "upper-leg"), ("lower-leg." + s, pts["lower-leg." + s], pts["foot." + s], "lower-leg"),
                  ("foot." + s, pts["foot." + s], pts["toes." + s], "foot")]
        if "index-1." + s in pts:
            spans.append(("hand." + s, pts["hand." + s], tuple(np.add(pts["hand." + s], fore / np.linalg.norm(fore) * 0.08)), "hand"))
            for f in lm.FINGER_NAMES:
                chain = [pts["%s-%d.%s" % (f, k, s)] for k in (1, 2, 3)] + [tip("%s-3.%s" % (f, s))]
                spans += [("%s.%s" % (f, s), a, b, "finger") for a, b in zip(chain, chain[1:])]
        else:
            spans.append(("hand." + s, pts["hand." + s], tuple(np.add(pts["hand." + s], fore / np.linalg.norm(fore) * 0.16)), "hand"))
    coords, edges, where = [], [], {}
    for name, a, b, kind in spans:
        a, b = np.array(a, dtype=float), np.array(b, dtype=float)
        axis = (b - a) / np.linalg.norm(b - a)
        side = np.cross(axis, (0, 1, 0) if abs(axis[1]) < 0.9 else (1, 0, 0)); side /= np.linalg.norm(side)
        other = np.cross(axis, side)
        rings = max(3, int(np.linalg.norm(b - a) / 0.02) + 1)
        start = len(coords)
        for r in range(rings):
            centre = a + (b - a) * (r + 0.5) / rings
            for k in range(per_ring):
                ang = 2 * np.pi * k / per_ring
                coords.append(centre + (side * np.cos(ang) + other * np.sin(ang)) * radii[kind] * radius_scale)
                i = start + r * per_ring + k
                edges.append((i, start + r * per_ring + (k + 1) % per_ring))
                if r:
                    edges.append((i, i - per_ring))
        where.setdefault(name, []).extend(range(start, len(coords)))
    return np.array(coords), edges, where


def test_every_tube_gets_its_own_region():
    pts = points(mittens=True)
    coords, edges, where = tube_figure(pts)
    names, info = regions.label(coords, edges, pts, HEIGHT)
    for region, vertices in where.items():
        got = [names[i] for i in vertices]
        # the trunk reaches out to the arm and hip joints, so it takes the near end of the upper arm and thigh
        trunk = {"upper-arm": "torso", "upper-leg": "pelvis"}.get(lm.split(region)[0])
        assert got.count(region) / len(got) > (0.5 if trunk else 0.75), (region, {n: got.count(n) for n in set(got)})
        assert set(got) <= {region, trunk} or not trunk, (region, set(got))
    assert sorted(info["counts"]) == sorted(set(names)) and set(regions.CHECKED) <= set(names)


def test_a_wide_torso_does_not_claim_the_face():
    pts = points(mittens=True)
    coords, edges, where = tube_figure(pts)
    belly = np.array([[0.0, -0.32, 0.65 * HEIGHT + 0.01 * k] for k in range(40)])          # a belly far in front of the spine
    nose = np.array([[0.0, -0.2, pts["head"][2] + 0.06]])                                # farther from the head's axis than the skull
    names, _ = regions.label(np.vstack([coords, belly, nose]), edges, pts, HEIGHT)
    assert names[-1] == "head"


def test_fingers_get_their_own_regions_and_position_weights():
    pts = points()
    coords, edges, where = tube_figure(pts)
    names, _ = regions.label(coords, edges, pts, HEIGHT)
    counts = regions.label_fingers(coords, names, pts)
    assert sorted(counts) == sorted("%s.%s" % (f, s) for f in lm.FINGER_NAMES for s in lm.SIDES)
    for f in lm.FINGER_NAMES:
        got = [names[i] for i in where[f + ".l"]]
        assert got.count(f + ".l") / len(got) > 0.9, (f, {n: got.count(n) for n in set(got)})
    bones = skeleton.plan(pts, None, "auto")
    placed = regions.finger_weights(coords, names, pts, bones, HEIGHT)
    assert set(placed) == {i for i, r in enumerate(names) if lm.split(r)[0] in lm.FINGER_NAMES}
    for v, w in placed.items():
        finger, side = lm.split(names[v])
        assert set(w) <= {"hand." + side} | {"%s-%d.%s" % (finger, k, side) for k in (1, 2, 3)} and abs(sum(w.values()) - 1) < 1e-9
    tip = max(where["index.l"], key=lambda i: np.linalg.norm(coords[i] - np.array(pts["index-1.l"])))
    assert placed[tip] == {"index-3.l": 1.0}
    assert regions.fused_fingers(coords, names, edges, pts) == {}
    bridge = [(where["index.l"][-1], where["middle.l"][-1])]
    assert regions.fused_fingers(coords, names, edges + bridge, pts) == {"l": 1}


def test_nearby_regions_measures_along_the_surface():
    coords = [(0, 0, k * 0.01) for k in range(10)] + [(0.001, 0, 0.05)]            # a strand, and a vertex beside it but unconnected
    names = ["a"] * 5 + ["b"] * 5 + ["a"]
    edges = [(k, k + 1) for k in range(9)]
    near = regions.nearby_regions(names, edges, coords, 0.025)
    assert near[4] == {"b": pytest.approx(0.01)} and near[3] == {"b": pytest.approx(0.02)} and near[2] == {} and near[10] == {}
    assert near[5] == {"a": pytest.approx(0.01)} and near[7] == {}
    assert regions.nearby_regions(names, edges, coords, 0.025, [[10, 5]])[10] == {"b": 0.0}


def test_clean_weights_holds_vertices_to_their_region_and_limit():
    pts = points(mittens=True)
    bones = skeleton.plan(pts, None, "auto")
    coords = [pts["lower-leg.l"], pts["lower-leg.l"], pts["hand.l"], (0, 0, HEIGHT), pts["lower-leg.l"]]
    names = ["upper-leg.l", "upper-leg.l", "hand.l", "head", "upper-leg.l"]
    raw = [{"upper-leg.l": 0.5, "upper-leg.r": 0.3, "hand.l": 0.2},                         # other leg and a hand hanging beside it
           {"upper-leg.r": 1.0},                                                           # nothing allowed left
           {"hand.l": 0.4, "lower-arm.l": 0.3, "upper-arm.l": 0.2, "upper-leg.l": 0.1},
           {"neck": 0.6, "head": 0.4},
           {"upper-leg.l": 0.4, "lower-leg.l": 0.3, "hips": 0.2, "foot.l": 0.1}]
    near = [{}, {}, {"lower-arm.l": 0.0}, {}, {"lower-leg.l": 0.015}]
    out, stats = regions.clean_weights(raw, names, near, 0.03, bones, coords, 2, rigid_head_above=HEIGHT - 0.1)
    assert out[0] == {"upper-leg.l": 1.0}
    assert out[1] in ({"upper-leg.l": 1.0}, {"lower-leg.l": 1.0}) and stats["followNearestBone"] == 1
    assert set(out[2]) == {"hand.l", "lower-arm.l"} and abs(sum(out[2].values()) - 1) < 1e-9     # upper arm borrowed, then trimmed to 2
    assert out[3] == {"head": 1.0} and stats["rigidHead"] == 1
    three, _ = regions.clean_weights(raw, names, near, 0.03, bones, coords, 4)
    assert 0 < three[4]["foot.l"] / three[4]["upper-leg.l"] < 0.1 / 0.4 - 1e-6                # borrowed across the border, faded by distance
    assert all(len(w) <= 2 and abs(sum(w.values()) - 1) < 1e-9 for w in out)
    fixed, stats = regions.clean_weights(raw, names, near, 0.03, bones, coords, 4, fixed={0: {"hand.l": 1.0}})
    assert fixed[0] == {"hand.l": 1.0} and stats["fingerVerticesByPosition"] == 1


def figure_weights(spoil=None):
    pts = points(mittens=True)
    coords, edges, where = tube_figure(pts)
    names, _ = regions.label(coords, edges, pts, HEIGHT)
    bones = skeleton.plan(pts, None, "auto")
    weights = regions.distance_weights(coords, names, bones)
    if spoil:
        for i in where[spoil[0]]:
            weights[i] = {spoil[1]: 1.0}
    return weights, names, bones


def test_deformation_check_passes_a_sound_rig_and_names_a_bad_limb():
    weights, names, bones = figure_weights()
    ok = regions.deformation_check(weights, names, bones)
    assert ok["passed"] and sorted(ok["regions"]) == sorted(regions.CHECKED)
    assert all(r["meanOwnWeight"] >= 0.5 for r in ok["regions"].values())
    weights, names, bones = figure_weights(("upper-leg.l", "upper-leg.r"))
    bad = regions.deformation_check(weights, names, bones)
    assert not bad["passed"] and len(bad["failures"]) == 1 and bad["failures"][0].startswith("upper-leg.l: mean weight on its own bones 0.")
    assert regions.deformation_check(weights, names, bones, min_own_weight=0.0, max_stray_share=1.0)["passed"]
    gone = regions.deformation_check(weights, ["torso" if n == "foot.r" else n for n in names], bones)
    assert any(f.startswith("foot.r: no vertices") for f in gone["failures"])


def test_check_follows_profile_names_and_counts_toes_and_fingers_with_their_part():
    profile = skeleton.load_profile(load(PROFILE))
    bones = skeleton.plan(points(), profile, "auto")
    assert regions.own_bones("foot.l", bones) == {"leftFoot", "leftToes"}
    assert regions.own_bones("hand.r", bones) == {"rightHand"} | {b for b in profile["hierarchy"] if b.startswith("right") and b[5:].startswith(("Thumb", "Index", "Middle", "Ring", "Little"))}
    assert regions.bone_parts(bones)["torso"] == ["spine", "chest", "upperChest", "leftShoulder", "rightShoulder"]
    allowed = regions.allowed_bones(bones)
    assert "rightUpperLeg" not in allowed["upper-leg.l"] and "leftHand" not in allowed["upper-leg.l"]
    assert allowed["index.l"] == {"leftHand", "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal"}
    assert regions.influence_histogram([{"a": 1.0}, {"a": 0.5, "b": 0.5}, {"a": 1.0}]) == ({"1": 2, "2": 1}, 2)


# ---- glTF ----------------------------------------------------------------------------------------------------------

def write_rig(path, names_parents_positions, root_scale=1.0, weights=None, joints=None, skinned=True):
    """A minimal skinned .glb: one triangle, joints as given (name, parent index or None, world position)."""
    nodes, count = [], len(names_parents_positions)
    for i, (name, parent, pos) in enumerate(names_parents_positions):
        base = names_parents_positions[parent][2] if parent is not None else (0, 0, 0)
        nodes.append({"name": name, "translation": [(pos[k] - base[k]) / root_scale for k in range(3)]})
    for i, (_, parent, _) in enumerate(names_parents_positions):
        if parent is not None:
            nodes[parent].setdefault("children", []).append(i)
    roots = [i for i, (_, parent, _) in enumerate(names_parents_positions) if parent is None]
    nodes.append({"name": "Armature", "scale": [root_scale] * 3, "children": roots + [count + 1]})
    nodes.append({"name": "Body", "mesh": 0, **({"skin": 0} if skinned else {})})
    position = np.array([[-1, 0, -0.5], [1, 0, 0.5], [0, HEIGHT, 0]], dtype=np.float32) / root_scale    # a triangle that spans the figure
    ibm = np.stack([np.eye(4, dtype=np.float32) for _ in range(count)])
    for i, (_, _, pos) in enumerate(names_parents_positions):
        ibm[i][3, :3] = [-p / root_scale for p in pos]                                    # column-major: translation in the last row
    W = np.array(weights or [[1, 0, 0, 0]] * 3, dtype=np.float32)
    Jn = np.array(joints or [[0, 0, 0, 0]] * 3, dtype=np.uint8)
    blobs = [position.tobytes(), ibm.tobytes(), W.tobytes(), Jn.tobytes()]
    views, offset = [], 0
    for blob in blobs:
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(blob)}); offset += len(blob) + (-len(blob) % 4)
    binary = b"".join(blob + b"\0" * (-len(blob) % 4) for blob in blobs)
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [count]}], "nodes": nodes,
           "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "WEIGHTS_0": 2, "JOINTS_0": 3}}]}],
           "skins": [{"joints": list(range(count)), "inverseBindMatrices": 1}] if skinned else [],
           "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": position.min(axis=0).tolist(), "max": position.max(axis=0).tolist()},
                         {"bufferView": 1, "componentType": 5126, "count": count, "type": "MAT4"},
                         {"bufferView": 2, "componentType": 5126, "count": 3, "type": "VEC4"},
                         {"bufferView": 3, "componentType": 5121, "count": 3, "type": "VEC4"}],
           "bufferViews": views, "buffers": [{"byteLength": len(binary)}]}
    text = json.dumps(doc).encode(); text += b" " * (-len(text) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 28 + len(text) + len(binary)))
        f.write(struct.pack("<I4s", len(text), b"JSON") + text + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def rig_from_table(pts_gltf):
    """Joints named as the shipped table expects, at glTF-frame positions, plus the bones the table leaves out."""
    table = lm.load_table(load(TABLE))
    order = ["Hips", "Spine02", "Spine01", "Spine", "neck", "Head", "head_end"]
    joints = [("Hips", None, pts_gltf["hips"]), ("Spine02", 0, pts_gltf["spine"]), ("Spine01", 1, tuple(np.add(pts_gltf["spine"], pts_gltf["chest"]) / 2)),
              ("Spine", 2, pts_gltf["chest"]), ("neck", 3, pts_gltf["neck"]), ("Head", 4, pts_gltf["head"]), ("head_end", 5, (0, 1.7, 0))]
    for bone, landmark in table.items():
        if bone not in order:
            parent = table_parent(table, landmark, [j[0] for j in joints])
            joints.append((bone, parent, pts_gltf[landmark]))
    return joints


def table_parent(table, landmark, names):
    bone_at = {v: k for k, v in table.items()}
    return names.index(bone_at[lm.parent_of(landmark)])


def test_reader_places_joints_in_metres_whatever_the_node_scale(tmp_path):
    pts = points(mittens=True)
    y_up = {k: tuple(v) for k, v in lm.from_working(pts, "t")["landmarks"].items()}
    path = str(tmp_path / "rig.glb")
    write_rig(path, rig_from_table(y_up), root_scale=0.01)
    model = gltf.Gltf(path)
    found = {name: pos for name, _, pos in model.skin_joints()}
    assert np.allclose(found["LeftHand"], y_up["hand.l"], atol=1e-4) and np.allclose(found["Hips"], y_up["hips"], atol=1e-4)
    assert dict((n, p) for n, p, _ in model.skin_joints())["LeftArm"] == "LeftShoulder"
    assert model.bind_spread() < 1e-3
    lo, hi = model.mesh_bounds()
    assert np.allclose(lo, (-1, 0, -0.5), atol=1e-4) and np.allclose(hi, (1, HEIGHT, 0.5), atol=1e-4)     # centimetres under a 0.01 scale


def test_landmarks_from_rig_end_to_end(tmp_path, capsys):
    pts = points(mittens=True)
    y_up = {k: tuple(v) for k, v in lm.from_working(pts, "t")["landmarks"].items()}
    rig, out = str(tmp_path / "rig.glb"), str(tmp_path / "landmarks.json")
    write_rig(rig, rig_from_table(y_up))
    assert landmarks_from_rig.main([rig, out, "--map", TABLE]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["unmapped"] == ["Spine01", "head_end"] and printed["missing"] == [] and printed["mapped"] == 21
    written = lm.read(out)
    assert written["up"] == "+Y" and all(np.allclose(lm.to_working(written)[k], pts[k], atol=1e-4) for k in pts)

    # a rig without a chest bone: refused, then filled with --derive
    short = [j for j in rig_from_table(y_up)]
    short[3] = ("Chest", 2, y_up["chest"])
    write_rig(rig, short)
    os.remove(out)
    assert landmarks_from_rig.main([rig, out, "--map", TABLE]) == 1 and not os.path.exists(out)
    assert "no bone mapped to: chest" in capsys.readouterr().err
    assert landmarks_from_rig.main([rig, out, "--map", TABLE, "--derive"]) == 0
    assert "derived: chest" in lm.read(out)["source"]

    # the same rig read through a profile whose bones are the landmark names of another convention
    profile = str(tmp_path / "profile.json")
    with open(profile, "w") as f:
        json.dump({"skeletons": {"mine": {"bones": {v: k for k, v in lm.load_table(load(TABLE)).items()}}}}, f)
    write_rig(rig, rig_from_table(y_up))
    assert landmarks_from_rig.main([rig, out, "--map", profile, "--profile-id", "mine"]) == 0

    # joints that cannot be this character's: nothing is written
    mirrored = [(n, p, (-pos[0], pos[1], pos[2])) for n, p, pos in rig_from_table(y_up)]
    write_rig(rig, mirrored); os.remove(out)
    assert landmarks_from_rig.main([rig, out, "--map", TABLE]) == 1 and not os.path.exists(out)
    assert "left joints are not on +X" in capsys.readouterr().err


def test_verify_skinned_reports_what_is_wrong(tmp_path):
    joints = [("a", None, (0, 0, 0)), ("b", 0, (0, 1, 0)), ("c", 1, (0, 2, 0)), ("d", 2, (0, 3, 0)), ("e", 3, (0, 4, 0))]
    path = str(tmp_path / "m.glb")
    write_rig(path, joints, weights=[[0.5, 0.5, 0, 0], [1, 0, 0, 0], [0.25, 0.25, 0.25, 0.25]], joints=[[0, 1, 0, 0], [2, 0, 0, 0], [0, 1, 2, 3]])
    info = gltf.verify_skinned(path, 4)
    assert info["problems"] == [] and info["maxInfluences"] == 4 and info["joints"] == ["a", "b", "c", "d", "e"] and info["roots"] == ["a"]
    assert gltf.verify_skinned(path, 2)["problems"] == ["a vertex follows 4 joints; the limit is 2"]
    write_rig(path, joints, weights=[[0.5, 0.2, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0]])
    problems = gltf.verify_skinned(path, 4)["problems"]
    assert any("follow no joint" in p for p in problems) and any("do not sum to 1" in p for p in problems)
    write_rig(path, joints, joints=[[9, 0, 0, 0]] * 3)
    assert any("outside the skin" in p for p in gltf.verify_skinned(path)["problems"])
    write_rig(path, joints, skinned=False)
    assert gltf.verify_skinned(path)["problems"] == ["no skin"]
