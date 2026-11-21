"""Blender-free behaviour of jam-3d-retarget: rotations, the glTF reader and writer, landmark maps and skeleton checks,
rest alignment, the transfer and its round trip, contact correction, and retarget.py end to end on the two generated
test rigs (an A-pose rig and a T-pose rig of other proportions, bone axes and hierarchy). Run with `python3 -m pytest`."""
import base64
import copy
import json
import os
import re
import sys
import types

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jamretarget import gltf, mathx, measure, transfer  # noqa: E402
from jamretarget.skeleton import Skeleton, SkeletonError, load_map, main_child  # noqa: E402
import make_test_rigs  # noqa: E402
import retarget  # noqa: E402


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return str(path)


@pytest.fixture(scope="module")
def rigs(tmp_path_factory):
    folder = tmp_path_factory.mktemp("rigs")
    make_test_rigs.main([str(folder)])
    return folder


def skel(rigs, name, role="rig", table=None):
    return Skeleton(str(rigs / ("rig-%s.glb" % name)), table or load_map(str(rigs / ("rig-%s.map.json" % name))), role)


# The test clips' planted feet stand exactly still, so any small speed finds them; these are the validated runs' values.
CONTACTS = ["--contacts", "auto", "--contact-speed", "0.1", "--contact-min-frames", "3"]


def run(rigs, out, src="a", tgt="b", *extra, src_map=None, tgt_map=None, src_file=None, tgt_file=None):
    contacts = [] if "--contacts" in extra else CONTACTS
    code = retarget.main([src_file or str(rigs / ("rig-%s.glb" % src)), src_map or str(rigs / ("rig-%s.map.json" % src)),
                          tgt_file or str(rigs / ("rig-%s.glb" % tgt)), tgt_map or str(rigs / ("rig-%s.map.json" % tgt)), str(out)]
                         + contacts + list(extra))
    path = out / "retarget-report.json"
    return code, (load(path) if path.exists() else None)


def sampled(skeleton, name, fps=None):
    anim = next(a for a in skeleton.model.animations() if a["name"] == name)
    times, fps, _, _ = retarget.frame_times(anim, fps)
    trs, _ = gltf.sample_locals(skeleton.model, anim, times, skeleton.rest)
    return times, trs, transfer.world_of(skeleton, trs)


# ---- rotations and glTF ----------------------------------------------------------------------------------------------

def test_rotation_helpers_agree_with_each_other():
    rng = np.random.default_rng(1)
    q = mathx.unit(rng.normal(size=(50, 4)))
    q[q[:, 3] < 0] *= -1
    assert np.allclose(mathx.mat_to_quat(mathx.quat_to_mat(q)), q, atol=1e-9)
    a, b = mathx.unit(rng.normal(size=(50, 3))), mathx.unit(rng.normal(size=(50, 3)))
    turned = (mathx.arc(a, b) @ a[:, :, None])[:, :, 0]
    assert np.allclose(turned, b, atol=1e-9)
    assert np.allclose(mathx.arc(b, a), np.swapaxes(mathx.arc(a, b), -1, -2), atol=1e-9)
    half = mathx.arc([1.0, 0, 0], [-1.0, 0, 0])                       # opposite directions still turn onto each other
    assert np.allclose(half @ [1.0, 0, 0], [-1, 0, 0], atol=1e-9)
    mid = mathx.slerp([0, 0, 0, 1.0], mathx.mat_to_quat(mathx.axis_angle([0, 1.0, 0], np.pi / 2)), 0.5)
    assert mathx.rotation_angle(mathx.quat_to_mat(mid)) == pytest.approx(45.0)


def test_channels_sample_in_every_interpolation():
    times = np.array([0.0, 1.0])
    lin = gltf.sample_channel(times, np.array([[0.0, 0, 0], [2.0, 0, 0]]), "LINEAR", "translation", [0.25, 2.0])
    assert np.allclose(lin, [[0.5, 0, 0], [2, 0, 0]])
    step = gltf.sample_channel(times, np.array([[0.0, 0, 0], [2.0, 0, 0]]), "STEP", "translation", [0.99])
    assert np.allclose(step, [[0, 0, 0]])
    cubic = np.array([[[0, 0, 0], [0.0, 0, 0], [0, 0, 0]], [[0, 0, 0], [2.0, 0, 0], [0, 0, 0]]])  # zero tangents: smoothstep
    assert np.allclose(gltf.sample_channel(times, cubic, "CUBICSPLINE", "translation", [0.5]), [[1, 0, 0]])
    q1 = mathx.mat_to_quat(mathx.axis_angle([0, 0, 1.0], np.pi / 2))
    rot = gltf.sample_channel(times, np.array([[0, 0, 0, 1.0], q1]), "LINEAR", "rotation", [0.5])
    assert mathx.rotation_angle(mathx.quat_to_mat(rot))[0] == pytest.approx(45.0)


def test_frame_rate_is_read_from_the_key_grid():
    assert gltf.frame_rate(np.arange(31) / 30.0) == 30.0
    assert gltf.frame_rate(np.arange(76) * 0.033333) == 30.0               # a BVH file's six-decimal frame time is 30
    for ntsc in (30 / 1.001, 24 / 1.001, 60 / 1.001):                   # 1000/1001 rates stay what they are
        assert gltf.frame_rate((np.arange(76) / ntsc).astype(np.float32)) == pytest.approx(ntsc, rel=1e-6)
    assert gltf.frame_rate(np.array([0, 2, 5]) / 24.0) is None           # sparse keys: the rate is not in the file
    assert gltf.frame_rate(np.arange(5, dtype=np.float32) / np.float32(24)) == 24.0


STILL = [{"name": "still", "times": [0.0, 1.0], "channels": [(1, "translation", [[0, 1, 0], [0, 2, 0]])]}]


def referenced(doc):
    """Every accessor and buffer view the file's JSON refers to."""
    acc = {v for _, _, v in gltf._accessor_refs(doc)}
    return acc, {v for _, _, v in gltf._view_refs(doc)}


def same_data(before, after):
    """The meshes' and skins' data read back equal, whatever their accessors are numbered."""
    for b, a in zip(gltf._accessor_refs(before.json), gltf._accessor_refs(after.json)):
        if b[1] not in ("input", "output"):
            assert np.array_equal(before.accessor(b[2]), after.accessor(a[2]))


def test_writing_animations_keeps_everything_else_and_drops_the_old_animations_data(rigs, tmp_path):
    out = str(tmp_path / "copy.glb")
    result = gltf.add_animations(str(rigs / "rig-b.glb"), out, STILL)
    before, after = gltf.Gltf(str(rigs / "rig-b.glb")), gltf.Gltf(out)
    assert result["dropped"] == ["walk", "arms"] and result["removedBytes"] > 0
    for key in ("nodes", "skins", "materials", "scenes"):
        assert after.json[key] == before.json[key]
    assert [a["name"] for a in after.animations()] == ["still"]
    same_data(before, after)
    acc, views = referenced(after.json)                                  # nothing is left unreferenced
    assert acc == set(range(len(after.json["accessors"]))) and views == set(range(len(after.json["bufferViews"])))
    assert len(after.bin) < len(before.bin) - result["removedBytes"] + 64
    kept = gltf.add_animations(str(rigs / "rig-b.glb"), str(tmp_path / "kept.glb"), STILL, keep_existing=True)
    model = gltf.Gltf(str(tmp_path / "kept.glb"))
    assert kept == {"dropped": [], "removedBytes": 0, "embedded": []} and model.bin[:len(before.bin)] == before.bin
    assert [a["name"] for a in model.animations()] == ["walk", "arms", "still"]


def test_a_file_using_an_unknown_extension_keeps_the_dropped_data(rigs, tmp_path):
    doc = gltf.Gltf(str(rigs / "rig-b.glb"))
    data = copy.deepcopy(doc.json)
    data["extensionsUsed"] = ["EXT_mesh_gpu_instancing"]
    gltf.write_glb(str(tmp_path / "ext.glb"), data, doc.bin)
    result = gltf.add_animations(str(tmp_path / "ext.glb"), str(tmp_path / "out.glb"), STILL)
    after = gltf.Gltf(str(tmp_path / "out.glb"))
    assert result == {"dropped": ["walk", "arms"], "removedBytes": None, "embedded": []} and after.bin[:len(doc.bin)] == doc.bin


def test_animated_nodes_are_written_without_a_matrix(rigs, tmp_path):
    """glTF forbids a matrix on an animated node: a target storing matrices gets the same transform as TRS on every node
    it animates, and the written file plays what was computed."""
    doc = gltf.Gltf(str(rigs / "rig-b.glb"))
    T, R, S = doc.rest_trs()
    data = copy.deepcopy(doc.json)
    data.pop("animations")
    for i, node in enumerate(data["nodes"]):
        for key in ("translation", "rotation", "scale"):
            node.pop(key, None)
        node["matrix"] = [float(v) for v in mathx.trs(T[i:i + 1], R[i:i + 1], S[i:i + 1])[0].T.reshape(-1)]
    gltf.write_glb(str(tmp_path / "matrix.glb"), data, doc.bin)
    code, rep = run(rigs, tmp_path / "out", tgt_file=str(tmp_path / "matrix.glb"))
    assert code == 0 and rep["passed"] and all(e["fileCheckMeters"] < 1e-5 for e in rep["animations"])
    model = gltf.Gltf(str(tmp_path / "out" / "retargeted.glb"))
    animated = {c[0] for a in model.animations() for c in a["channels"]}
    assert animated and not any("matrix" in model.nodes[i] for i in animated)
    assert all("matrix" in n for i, n in enumerate(model.nodes) if i not in animated)
    T2, R2, S2 = model.rest_trs()
    assert np.allclose(T2, T) and np.allclose(np.abs(np.sum(R2 * R, axis=1)), 1) and np.allclose(S2, S)


def test_a_gltf_with_a_percent_encoded_buffer_uri_is_read(rigs, tmp_path):
    doc = gltf.Gltf(str(rigs / "rig-a.glb"))
    data = copy.deepcopy(doc.json)
    data["buffers"][0]["uri"] = "rig%20a%23data.bin"
    (tmp_path / "rig a#data.bin").write_bytes(doc.bin)
    dump(tmp_path / "rig-a.gltf", data)
    model = gltf.Gltf(str(tmp_path / "rig-a.gltf"))
    assert [a["name"] for a in model.animations()] == ["walk", "arms"]
    data["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(doc.bin).decode("ascii")
    dump(tmp_path / "inline.gltf", data)
    inline = gltf.Gltf(str(tmp_path / "inline.gltf"))
    assert np.array_equal(inline.accessor(0), doc.accessor(0)) and inline.resources()[0][:2] == ("buffer", 0)


def test_a_target_keeping_data_in_other_files_is_written_self_contained(rigs, tmp_path):
    """Rig B with an image and a second buffer in files beside it, as a .glb and as a .gltf whose own buffer is a file:
    the written .glb embeds them and needs nothing beside it; a missing file is refused before anything is written."""
    doc = gltf.Gltf(str(rigs / "rig-b.glb"))
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000000200"
                        "0154a24f5d0000000049454e44ae426082")
    data = copy.deepcopy(doc.json)
    position = data["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
    view = data["bufferViews"][data["accessors"][position]["bufferView"]]      # the mesh's positions move to a second file
    extra = doc.bin[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
    data["buffers"].append({"uri": "extra%20data.bin", "byteLength": len(extra)})
    view.update(buffer=1, byteOffset=0)
    data["images"] = [{"uri": "skin%20colour.png"}]
    data["textures"] = [{"source": 0}]
    data["materials"][0]["pbrMetallicRoughness"] = {"baseColorTexture": {"index": 0}}
    (tmp_path / "extra data.bin").write_bytes(extra)
    (tmp_path / "skin colour.png").write_bytes(png)
    gltf.write_glb(str(tmp_path / "linked.glb"), data, doc.bin)
    as_gltf = copy.deepcopy(data)
    as_gltf["buffers"][0]["uri"] = "rig.bin"
    (tmp_path / "rig.bin").write_bytes(doc.bin)
    dump(tmp_path / "linked.gltf", as_gltf)
    for name in ("linked.glb", "linked.gltf"):
        out = tmp_path / ("out-" + name)
        code, rep = run(rigs, out, tgt_file=str(tmp_path / name))
        assert code == 0 and rep["passed"] and sorted(rep["embedded"]) == sorted(["extra%20data.bin", "skin%20colour.png"] + (["rig.bin"] if name.endswith("gltf") else []))
        model = gltf.Gltf(str(out / "retargeted.glb"))
        assert model.resources() == [] and len(model.json["buffers"]) == 1
        assert np.array_equal(model.accessor(model.json["meshes"][0]["primitives"][0]["attributes"]["POSITION"]), doc.accessor(position))
        view = model.json["bufferViews"][model.json["images"][0]["bufferView"]]
        assert model.json["images"][0]["mimeType"] == "image/png" and model.bin[view["byteOffset"]:view["byteOffset"] + view["byteLength"]] == png
        acc, views = referenced(model.json)
        assert views | {model.json["images"][0]["bufferView"]} == set(range(len(model.json["bufferViews"])))
    (tmp_path / "skin colour.png").unlink()
    code, rep = run(rigs, tmp_path / "missing", tgt_file=str(tmp_path / "linked.glb"))
    assert code == 2 and rep is None and not (tmp_path / "missing").exists()


# ---- maps and skeletons ------------------------------------------------------------------------------------------------

def test_map_shapes(tmp_path):
    plain = dump(tmp_path / "plain.json", {"landmarks": {"Pelvis": "hips"}})
    descriptor = dump(tmp_path / "descriptor.json", {"rig": {"landmarks": {"Pelvis": "hips"}}})
    profile = dump(tmp_path / "profile.json", {"bones": {"hips": "Pelvis"}, "hierarchy": {"Pelvis": None}})
    assert load_map(plain) == load_map(descriptor) == load_map(profile) == {"Pelvis": "hips"}
    with pytest.raises(SkeletonError, match="outside the vocabulary"):
        load_map(dump(tmp_path / "bad.json", {"landmarks": {"Pelvis": "pelvis"}}))


def test_skeleton_reads_both_rigs(rigs):
    a, b = skel(rigs, "a"), skel(rigs, "b")
    assert a.root is None and b.model.name(b.root) == "Root"           # A's armature node is not a joint
    assert a.unmapped == ["ForearmTwist_L", "ForearmTwist_R"] and b.unmapped == ["ArmTwist.l", "ArmTwist.r", "SpineMid"]
    assert a.pos("hips") == pytest.approx([0, 0.92, 0], abs=1e-6)        # metres, through the 0.01 armature scale
    assert a.leg_length == pytest.approx(0.39 + 0.3905, abs=2e-3) and b.leg_length > a.leg_length


@pytest.mark.parametrize("change, message", [
    (lambda t: {k: v.replace(".l", ".x").replace(".r", ".l").replace(".x", ".r") for k, v in t.items()}, "left joints are not on"),
    (lambda t: {k: v for k, v in t.items() if v != "hand.l"}, "maps to hand.l"),
    (lambda t: dict(t, Shin_L="upper-arm.l"), "more than one bone maps to"),
])
def test_maps_that_do_not_fit_are_refused(rigs, change, message):
    with pytest.raises(SkeletonError, match=message):
        skel(rigs, "a", table=change(load_map(str(rigs / "rig-a.map.json"))))


def test_a_rig_facing_backward_or_lying_down_is_refused(rigs, tmp_path):
    doc = gltf.Gltf(str(rigs / "rig-a.glb"))
    for name, turn, message in (("backward.glb", [0, 1, 0, 0], "left joints are not on"), ("lying.glb", [0.7071068, 0, 0, 0.7071068], "not above the feet"),
                                   ("leaning.glb", [0.3826834, 0, 0, 0.9238795], "lean")):
        data = copy.deepcopy(doc.json)
        arm = next(n for n in data["nodes"] if n["name"] == "RigA")
        arm["rotation"] = turn
        gltf.write_glb(str(tmp_path / name), data, doc.bin)
        with pytest.raises(SkeletonError, match=message):
            Skeleton(str(tmp_path / name), load_map(str(rigs / "rig-a.map.json")), "rig")


def turned_rig(rigs, tmp_path, degrees):
    """Rig A turned about +Y (toward +X) by the given angle: its armature node carries the turn."""
    doc = gltf.Gltf(str(rigs / "rig-a.glb"))
    data = copy.deepcopy(doc.json)
    half = np.radians(degrees) / 2
    next(n for n in data["nodes"] if n["name"] == "RigA")["rotation"] = [0, float(np.sin(half)), 0, float(np.cos(half))]
    path = str(tmp_path / ("turned-%g.glb" % degrees))
    gltf.write_glb(path, data, doc.bin)
    return path


@pytest.mark.parametrize("degrees", [90, -90, 45, -20])
def test_a_rig_turned_about_up_is_refused_on_either_side(rigs, tmp_path, degrees):
    """A turned rest is refused, source or target: the transfer gives the trunk no rest turn and copies travel in world
    axes, so the whole clip would turn by that angle against the target's body while arms and legs still agree."""
    turned = turned_rig(rigs, tmp_path, degrees)
    for side in ("source", "target"):
        files = {"src_file": turned} if side == "source" else {"tgt_file": turned}
        code, rep = run(rigs, tmp_path / side, "a", "a", **files)
        assert code == 2 and rep is None
    with pytest.raises(SkeletonError, match=r"turned about \+Y .*turned %.1f degrees from \+X.*point %.1f degrees from \+Z"
                       % (degrees, degrees)):
        Skeleton(turned, load_map(str(rigs / "rig-a.map.json")), "rig")


def test_the_facing_tolerance_is_a_flag_and_reported(rigs, tmp_path):
    turned = turned_rig(rigs, tmp_path, 5)
    code, rep = run(rigs, tmp_path / "five", src_file=turned)
    assert code == 0 and rep["source"]["facing"] == {"sideLineDegrees": pytest.approx(5.0), "feetDegrees": pytest.approx(5.0)}
    assert rep["target"]["facing"] == {"sideLineDegrees": 0.0, "feetDegrees": 0.0} and rep["options"]["facingDegrees"] == 10
    code, rep = run(rigs, tmp_path / "strict", "a", "b", "--facing-degrees", "4", src_file=turned)
    assert code == 2 and rep is None
    code, rep = run(rigs, tmp_path / "wide", "a", "b", "--facing-degrees", "50", src_file=turned_rig(rigs, tmp_path, 45))
    assert code == 0 and rep["passed"]
    with pytest.raises(SystemExit):
        retarget.parse(["s", "sm", "t", "tm", "out", "--contacts", "none", "--facing-degrees", "120"])


def test_a_rig_facing_backward_with_its_sides_swapped_is_refused_by_its_feet(rigs, tmp_path):
    """Facing -Z with a map that swaps sides puts the map's left joints on +X again; the feet still point backward."""
    doc = gltf.Gltf(str(rigs / "rig-a.glb"))
    data = copy.deepcopy(doc.json)
    next(n for n in data["nodes"] if n["name"] == "RigA")["rotation"] = [0, 1, 0, 0]
    gltf.write_glb(str(tmp_path / "backward.glb"), data, doc.bin)
    swapped = {k: v.replace(".l", ".x").replace(".r", ".l").replace(".x", ".r") for k, v in load_map(str(rigs / "rig-a.map.json")).items()}
    with pytest.raises(SkeletonError, match="toes are behind the ankles"):
        Skeleton(str(tmp_path / "backward.glb"), swapped, "rig")


def test_a_mirrored_bone_the_transfer_drives_is_refused(rigs, tmp_path):
    """A bone with a negative scale cannot be written as a rotation: refused by name when the transfer drives it, kept at
    rest when only the target maps it (a finger the source lacks)."""
    doc = gltf.Gltf(str(rigs / "rig-b.glb"))
    for bone, refused in (("Elbow.l", True), ("Index2.l", False)):
        data = copy.deepcopy(doc.json)
        node = next(n for n in data["nodes"] if n["name"] == bone)
        node["scale"] = [-1.0, 1.0, 1.0]
        path = str(tmp_path / ("mirror-%s.glb" % bone))
        gltf.write_glb(path, data, doc.bin)
        code, rep = run(rigs, tmp_path / bone, tgt_file=path)
        if refused:
            assert code == 2 and rep is None
            with pytest.raises(SkeletonError, match="bones at lower-arm.l, hand.l are mirrored"):
                transfer.Plan(skel(rigs, "a"), Skeleton(path, load_map(str(rigs / "rig-b.map.json")), "target"))
        else:
            assert code == 0 and rep["passed"]


# ---- rest alignment and transfer -----------------------------------------------------------------------------------------

def test_rest_alignment_turns_arms_by_the_a_to_t_difference(rigs):
    a, b = skel(rigs, "a"), skel(rigs, "b")
    plan, back = transfer.Plan(a, b), transfer.Plan(b, a)
    rest = plan.describe()
    assert rest["upper-arm.l"]["turnDegrees"] == pytest.approx(45.0, abs=0.01) and rest["lower-arm.l"]["rule"] == "segment"
    assert rest["hand.l"]["rule"] == "as lower-arm.l" and rest["hips"]["turnDegrees"] == 0.0
    for k in plan.shared:                                                # the way back undoes the way there
        assert np.allclose(back.align[k], plan.align[k].T, atol=1e-12)
    assert plan.k * back.k == pytest.approx(1.0)


def test_hand_frame_matches_palms_that_rest_turned_differently(rigs, tmp_path):
    """Rig B against a copy whose hands rest turned 90 degrees about the forearm (palms forward): the knuckle line
    aligns them, so fingers point where the source's do."""
    bones = make_test_rigs.rig_b()
    turned = []
    for name, parent, pos, landmark in bones:
        pos = np.asarray(pos, dtype=float)
        if landmark and landmark.split("-")[0] in ("thumb", "index", "middle", "ring", "pinky"):
            side = landmark[-1]
            wrist = np.asarray(next(p for n, _, p, k in bones if k == "hand." + side), dtype=float)
            pos = wrist + mathx.axis_angle([1.0 if side == "l" else -1.0, 0, 0], np.pi / 2) @ (pos - wrist)
        turned.append((name, parent, pos, landmark))
    rig = make_test_rigs.Rig(turned, "world")
    make_test_rigs.write_rig(str(tmp_path / "palms.glb"), rig, make_test_rigs.MOTIONS[1:], 24)
    src, tgt = skel(rigs, "b"), Skeleton(str(tmp_path / "palms.glb"), load_map(str(rigs / "rig-b.map.json")), "palms")
    plan = transfer.Plan(src, tgt)
    assert plan.how["hand.l"] == "hand frame" and plan.describe()["hand.l"]["turnDegrees"] == pytest.approx(90.0, abs=0.01)
    _, _, world = sampled(src, "arms")
    _, tw, _, _ = transfer.transfer(plan, world)
    assert measure.segment_agreement(plan, world, tw)["fingers"]["maxDegrees"] < 1e-6


def naive(plan, src_world, src_local, align):
    """Two common wrong transfers, for comparison: copying each bone's local rotation change ('local'), or applying the
    world rotation change to the target's own rest without aligning the rests ('world')."""
    src, tgt = plan.src, plan.tgt
    local = np.repeat(tgt.rest_local[None], len(src_world), 0)
    rot, pos = {}, {tgt.at["hips"]: transfer.map_position(plan, "hips", src_world[:, src.at["hips"], :3, 3])}
    for k in plan.shared:
        s, t = src.at[k], tgt.at[k]
        if align == "local":
            d = mathx.rot_of(src.rest_local[s]).T @ mathx.rot_of(src_local[:, s])
            local[:, t, :3, :3] = (mathx.rot_of(tgt.rest_local[t]) @ d) * tgt.rest[2][t]
        else:
            rot[t] = mathx.rot_of(src_world[:, s]) @ mathx.rot_of(src.rest_world[s]).T @ mathx.rot_of(tgt.rest_world[t])
    if align == "local":
        return gltf.forward(tgt.parent, tgt.order, local)
    return transfer.solve(tgt, rot, pos, len(src_world))[1]


@pytest.mark.parametrize("src_name, tgt_name", [("a", "b"), ("b", "a")])
def test_a_source_standing_at_rest_leaves_the_target_feet_at_their_rest(rigs, src_name, tgt_name):
    """The foot's pitch at rest is the rig's build, not a posture: copying the source's would sink or lift the toes."""
    src, tgt = skel(rigs, src_name), skel(rigs, tgt_name)
    plan = transfer.Plan(src, tgt)
    assert {plan.how["foot." + s] for s in "lr"} == {"foot"}
    _, tw, _, _ = transfer.transfer(plan, src.rest_world[None])
    for side in "lr":                                   # ankle to toes as at the target's own rest
        foot, toes = tgt.at["foot." + side], tgt.at["toes." + side]
        assert np.abs((tw[0, toes, :3, 3] - tw[0, foot, :3, 3]) - (tgt.pos("toes." + side) - tgt.pos("foot." + side))).max() < 1e-9


@pytest.mark.parametrize("src_name, tgt_name", [("a", "b"), ("b", "a")])
def test_arms_follow_the_source_across_a_and_t_rests_where_naive_transfers_cross_the_body(rigs, src_name, tgt_name):
    src, tgt = skel(rigs, src_name), skel(rigs, tgt_name)
    plan = transfer.Plan(src, tgt)
    times, trs, world = sampled(src, "arms")
    _, tw, _, _ = transfer.transfer(plan, world)
    agree = measure.segment_agreement(plan, world, tw)
    assert agree["arms"]["maxDegrees"] < 1e-6 and agree["legs"]["maxDegrees"] < 1e-6
    assert agree["feet"]["maxDegrees"] == pytest.approx(max(plan.describe()["foot.%s" % s]["restDifferenceDegrees"] for s in "lr"), abs=0.01)   # feet keep their own rest
    assert all(n == 0 for n in measure.side_flips(plan, world, tw).values())
    asked = load(str(rigs / "motions.json"))["rig-" + src_name]["arms"]["directions"]   # the world directions the motion asked for
    for k in ("upper-arm.l", "lower-arm.r"):
        seg = tw[:, tgt.at[main_child(k)], :3, 3] - tw[:, tgt.at[k], :3, 3]
        assert mathx.angle_between(seg, np.array(asked[k])).max() < 0.05
    for kind in ("local", "world"):
        bad = naive(plan, world, mathx.trs(*trs), kind)
        assert measure.segment_agreement(plan, world, bad)["arms"]["maxDegrees"] > 40
    crossing = naive(plan, world, mathx.trs(*trs), "world")
    if src_name == "b":                                                   # T-pose source onto an A-pose target: arms down go through the body
        assert measure.side_flips(plan, world, crossing)["hand.l"] > 0


def test_round_trip_is_exact_when_both_maps_carry_all_the_motion(rigs):
    a, b = skel(rigs, "a"), skel(rigs, "b")
    there, back = transfer.Plan(a, b), transfer.Plan(b, a)
    _, _, world = sampled(a, "walk")
    _, tw, _, _ = transfer.transfer(there, world)
    _, rw, _, _ = transfer.transfer(back, tw)
    err = measure.pose_error(a, there.shared, world, rw)
    assert err["maxHeights"] < 1e-9 and err["maxDegrees"] < 1e-4


def test_a_file_saved_away_from_its_bind_pose_is_named(rigs, tmp_path):
    doc = gltf.Gltf(str(rigs / "rig-b.glb"))
    data = copy.deepcopy(doc.json)
    next(n for n in data["nodes"] if n["name"] == "Arm.l")["rotation"] = [0, 0, -0.3826834, 0.9238795]
    gltf.write_glb(str(tmp_path / "posed.glb"), data, doc.bin)
    posed = Skeleton(str(tmp_path / "posed.glb"), load_map(str(rigs / "rig-b.map.json")), "rig")
    assert [f["code"] for f in posed.findings] == ["posed"] and skel(rigs, "b").findings == []


def test_root_motion_moves_root_to_root_when_both_rigs_have_one(rigs, tmp_path):
    bones = [(n, p, np.asarray(pos, dtype=float) * 1.2, k) for n, p, pos, k in make_test_rigs.rig_b()]
    make_test_rigs.write_rig(str(tmp_path / "tall.glb"), make_test_rigs.Rig(bones, "world"), make_test_rigs.MOTIONS[:1], 24)
    code = retarget.main([str(rigs / "rig-b.glb"), str(rigs / "rig-b.map.json"), str(tmp_path / "tall.glb"), str(rigs / "rig-b.map.json"),
                          str(tmp_path / "out"), "--animation", "walk"] + CONTACTS)
    rep = load(str(tmp_path / "out" / "retarget-report.json"))
    assert code == 0 and rep["root"] == {"source": "Root", "target": "Root", "travelOn": "root and hips"}
    assert rep["hipsScale"]["factor"] == pytest.approx(1.2)
    walk = rep["animations"][0]
    assert walk["roundTrip"]["maxHeights"] < 1e-9 and walk["hipsTravel"]["target"]["groundDisplacementMeters"] == pytest.approx(
        1.2 * walk["hipsTravel"]["source"]["groundDisplacementMeters"], rel=1e-4)
    model = gltf.Gltf(str(tmp_path / "out" / "retargeted.glb"))
    root = next(i for i, n in enumerate(model.nodes) if n["name"] == "Root")
    moved = next(c for c in model.animations()[0]["channels"] if c[0] == root and c[1] == "translation")[3]
    assert np.ptp(moved[:, 2]) == pytest.approx(1.2 * 0.9 * 0.8712 * 2.0, rel=0.01)   # 1.2 x the source root's 2 s of travel


def test_hips_travel_scales_by_leg_length_and_a_root_folds_into_the_hips(rigs):
    a, b = skel(rigs, "a"), skel(rigs, "b")
    plan = transfer.Plan(b, a)                                             # B carries travel on its root; A has none
    _, _, world = sampled(b, "walk")
    _, tw, _, _ = transfer.transfer(plan, world)
    s, t = world[:, b.at["hips"], :3, 3], tw[:, a.at["hips"], :3, 3]
    assert np.allclose(t - t[0], plan.k * (s - s[0]), atol=1e-9)
    assert not plan.with_root and transfer.Plan(b, b).with_root


# ---- contacts ------------------------------------------------------------------------------------------------------------

def test_contact_windows_and_weights():
    still = np.zeros((10, 3)); still[5:] += np.arange(5)[:, None] * [0.1, 0, 0]
    assert transfer.detect(still, 30, 0.5, 3) == [(0, 4)]
    lifting = np.zeros((10, 3)); lifting[:, 1] = np.arange(10) * 0.1      # straight up at 3 m/s: no speed over the ground
    assert transfer.detect(lifting, 30, 0.5, 3) == [(0, 9)]
    assert transfer.horizontal_speed(still, 30)[-1] == pytest.approx(3.0)
    w, which = transfer.window_weights([(2, 3)], 8, 2)
    assert list(np.round(w, 3)) == [0.333, 0.667, 1, 1, 0.667, 0.333, 0, 0] and list(which[:6]) == [0] * 6


def test_planted_feet_stay_still_on_a_rig_of_other_leg_proportions(rigs):
    a, b = skel(rigs, "a"), skel(rigs, "b")
    plan = transfer.Plan(a, b)
    _, _, world = sampled(a, "walk")
    rot, pos = transfer.desired(plan, world)
    windows = {k: transfer.detect(world[:, a.at[k], :3, 3], 30, 0.1 * a.height, 3) for k in ("foot.l", "foot.r")}
    assert len(windows["foot.l"]) == 2 and len(windows["foot.r"]) == 3      # the clip starts in the right foot's stance
    _, fw, _, details = transfer.plant(plan, world, rot, pos, windows, len(world), 3)
    for d in details:
        assert d["targetSlideMeters"] < 1e-6 < d["targetSlideWithoutCorrectionMeters"] and d["missMeters"] < 1e-6
    _, plain = transfer.solve(b, rot, pos, len(world))                    # arms and trunk are untouched by the leg correction
    others = [b.at[k] for k in b.at if not k.split(".")[0] in ("upper-leg", "lower-leg", "foot", "toes")]
    assert np.allclose(fw[:, others], plain[:, others], atol=1e-9)


def test_a_held_foot_keeps_its_ground_point_and_follows_the_source_height(rigs):
    """Inside a window the ankle is held at one place over the ground; its height is the source's, mapped (a heel that
    rises in place is not pressed back down)."""
    a, b = skel(rigs, "a"), skel(rigs, "b")
    plan = transfer.Plan(a, b)
    _, _, world = sampled(a, "walk")
    windows = {"foot.l": transfer.detect(world[:, a.at["foot.l"], :3, 3], 30, 0.1 * a.height, 3)[:1]}
    first, last = windows["foot.l"][0]
    world = world.copy()
    lift = np.zeros(len(world)); lift[first:last + 1] = 0.02 * np.sin(np.linspace(0, np.pi, last - first + 1))
    world[:, a.at["foot.l"], 1, 3] += lift                                # the source ankle rises 2 cm and comes down
    rot, pos = transfer.desired(plan, world)
    _, fw, _, details = transfer.plant(plan, world, rot, pos, windows, len(world), 3)
    ankle = fw[first:last + 1, b.at["foot.l"], :3, 3]
    assert np.abs(ankle[:, [0, 2]] - ankle[0, [0, 2]]).max() < 1e-6 and details[0]["targetSlideMeters"] < 1e-6
    mapped = transfer.map_position(plan, "foot.l", world[first:last + 1, a.at["foot.l"], :3, 3])
    assert np.abs(ankle[:, 1] - mapped[:, 1]).max() < 1e-6 and np.ptp(ankle[:, 1]) > 0.9 * 0.02 * plan.k
    assert details[0]["missMeters"] < 1e-6


def test_an_unreachable_goal_is_reported_as_a_miss(rigs):
    a, b = skel(rigs, "a"), skel(rigs, "b")
    plan = transfer.Plan(a, b)
    _, _, world = sampled(a, "arms")
    world = world.copy()
    world[:, a.at["hand.l"], :3, 3] += [0, 0, 1.0]                         # a hand goal a metre away from the source's reach
    rot, pos = transfer.desired(plan, world)
    _, _, _, details = transfer.plant(plan, world, rot, pos, {"hand.l": [(0, 5)]}, len(world), 2)
    assert details[0]["missMeters"] > 0.3 and details[0]["targetSlideMeters"] < 1e-6


# ---- retarget.py end to end ----------------------------------------------------------------------------------------------

def test_a_to_b_end_to_end(rigs, tmp_path):
    code, rep = run(rigs, tmp_path)
    assert code == 0 and rep["passed"] and rep["warnings"] == []
    assert [e["name"] for e in rep["animations"]] == ["walk", "arms"] and rep["root"] == {"source": None, "target": "Root", "travelOn": "hips"}
    walk = rep["animations"][0]
    assert (walk["fps"], walk["frames"], walk["resampled"]) == (30.0, 61, False)
    assert walk["roundTrip"]["passed"] and walk["roundTrip"]["maxHeights"] < 1e-9 and walk["fileCheckMeters"] < 1e-5
    assert walk["agreement"]["transfer"]["arms"]["maxDegrees"] < 1e-4 and all(v == 0 for v in walk["sideFlips"].values())
    feet = [c for c in walk["contacts"] if c["joint"].startswith("foot")]
    assert len(feet) == 5 and all(c["targetSlideMeters"] < 1e-5 for c in feet)
    assert walk["hipsTravel"]["target"]["groundDisplacementMeters"] == pytest.approx(rep["hipsScale"]["factor"] * walk["hipsTravel"]["source"]["groundDisplacementMeters"], rel=1e-3)
    model = gltf.Gltf(str(tmp_path / "retargeted.glb"))
    assert model.json["nodes"] == gltf.Gltf(str(rigs / "rig-b.glb")).json["nodes"] and [a["name"] for a in model.animations()] == ["walk", "arms"]
    driven = {model.name(c[0]) for c in model.animations()[0]["channels"]}
    assert "SpineMid" not in driven and "Index1.l" not in driven and {"Pelvis", "Arm.l"} <= driven


def test_b_to_a_with_resampling_and_without_contacts(rigs, tmp_path):
    code, rep = run(rigs, tmp_path, "b", "a", "--fps", "60", "--contacts", "none", "--animation", "arms")
    assert code == 0 and [e["name"] for e in rep["animations"]] == ["arms"]
    arms = rep["animations"][0]
    assert (arms["sourceFps"], arms["fps"], arms["frames"], arms["resampled"]) == (24.0, 60.0, 151, True)
    assert arms["contacts"] == [] and arms["contactSource"] == "none" and arms["agreement"]["final"] == arms["agreement"]["transfer"]
    assert rep["landmarks"]["sourceOnlyNotCarried"][:2] == ["thumb-1.l", "thumb-1.r"] and rep["root"]["travelOn"] == "hips"


def test_contacts_from_a_file_hold_a_hand(rigs, tmp_path):
    contacts = dump(tmp_path / "contacts.json", {"contacts": [{"joint": "hand.r", "start": 0.0, "end": 0.3, "animation": "arms"}]})
    code, rep = run(rigs, tmp_path / "out", "a", "b", "--contacts", contacts)
    assert code == 0
    walk, arms = rep["animations"]
    assert walk["contacts"] == [] and walk["contactSource"] == "file"
    assert [c["joint"] for c in arms["contacts"]] == ["hand.r"] and arms["contacts"][0]["frames"] == [0, 9]
    assert arms["contacts"][0]["targetSlideMeters"] < 1e-5 < arms["contacts"][0]["targetSlideWithoutCorrectionMeters"]
    assert any(i["role"] == "contacts" for i in rep["inputs"])


def test_a_landmark_only_the_target_maps_keeps_its_rest(rigs, tmp_path):
    table = {k: v for k, v in load_map(str(rigs / "rig-a.map.json")).items() if not v.startswith("shoulder")}
    code, rep = run(rigs, tmp_path, src_map=dump(tmp_path / "no-shoulders.json", {"landmarks": table}))
    assert code == 0 and rep["landmarks"]["targetOnlyKeptAtRest"][:3] == ["shoulder.l", "shoulder.r", "thumb-1.l"]
    assert rep["animations"][1]["agreement"]["transfer"]["arms"]["maxDegrees"] < 1e-4
    model = gltf.Gltf(str(tmp_path / "retargeted.glb"))
    assert "Collar.l" not in {model.name(c[0]) for c in model.animations()[1]["channels"]}


@pytest.mark.parametrize("stretched", [False, True])
def test_motion_on_a_bone_no_map_places_fails_the_round_trip_and_is_named(rigs, tmp_path, stretched):
    """An unmapped spine joint bends; with --translation none a stretched elbow beside it is held out of the round trip
    and reported apart, and the spine's lost motion still fails it."""
    b = skel(rigs, "b")
    anim = next(a for a in b.model.animations() if a["name"] == "arms")
    times = gltf.key_times(anim)
    (T, R, S), _ = gltf.sample_locals(b.model, anim, times, b.rest)
    mid = b.model.json["nodes"].index(next(n for n in b.model.json["nodes"] if n["name"] == "SpineMid"))
    bend = mathx.axis_angle([1.0, 0, 0], np.radians(25) * np.sin(np.pi * times / times[-1]))
    R[:, mid] = mathx.mat_to_quat(mathx.quat_to_mat(R[:, mid]) @ bend)
    elbow = b.at["lower-arm.l"]
    T[:, elbow] = T[:, elbow] * (1 + (0.3 if stretched else 0.0) * np.sin(np.pi * times / times[-1])[:, None])
    channels = [(i, "rotation", R[:, i]) for i in sorted(b.joints)] + [(i, "translation", T[:, i]) for i in (b.root, b.at["hips"], elbow)]
    bent = str(tmp_path / "bent.glb")
    gltf.add_animations(str(rigs / "rig-b.glb"), bent, [{"name": "arms", "times": times, "channels": channels}])
    code, rep = run(rigs, tmp_path / "out", "b", "a", "--translation", "none", src_file=bent)
    assert code == 1 and rep["passed"] is False
    rt = rep["animations"][0]["roundTrip"]
    assert not rt["passed"] and rt["maxHeights"] > 0.002 and rt["against"].startswith("the source with its joints' translations")
    assert any("SpineMid" in w and "not carried" in w for w in rep["warnings"])
    assert ("lower-arm.l" in rep["animations"][0]["stretch"]) == stretched
    assert os.path.isfile(str(tmp_path / "out" / "retargeted.glb"))


def test_a_map_placing_a_landmark_on_the_wrong_bone_fails(rigs, tmp_path):
    """The target's lower-arm.l mapped to its upper-arm twist bone: the transfer is still exactly invertible, so the round
    trip passes, but the forearm cannot follow the source's and the hand crosses the body. Both fail the run, unless the
    person raises the two tolerances."""
    table = {k: v for k, v in load_map(str(rigs / "rig-b.map.json")).items() if v != "lower-arm.l"}
    wrong = dump(tmp_path / "wrong.json", {"landmarks": dict(table, **{"ArmTwist.l": "lower-arm.l"})})
    code, rep = run(rigs, tmp_path / "out", "a", "b", "--animation", "arms", tgt_map=wrong)
    arms = rep["animations"][0]
    assert code == 1 and not rep["passed"] and not arms["passed"] and arms["roundTrip"]["passed"]
    assert not arms["agreement"]["passed"] and arms["agreement"]["transfer"]["arms"]["maxDegrees"] > 45
    assert arms["sideFlips"]["hand.l"] > 0 and not arms["sideFlipsPassed"]
    assert any("arms point up to" in w for w in rep["warnings"]) and os.path.isfile(str(tmp_path / "out" / "retargeted.glb"))
    code, rep = run(rigs, tmp_path / "loose", "a", "b", "--animation", "arms", "--agreement-degrees", "90",
                    "--side-flip-frames", str(arms["sideFlips"]["hand.l"]), tgt_map=wrong)
    assert code == 0 and rep["passed"] and rep["options"]["agreementDegrees"] == 90


def test_detected_contacts_need_a_speed_and_say_how_to_convert_one(rigs, tmp_path, capsys):
    code = retarget.main([str(rigs / "rig-a.glb"), str(rigs / "rig-a.map.json"), str(rigs / "rig-b.glb"), str(rigs / "rig-b.map.json"),
                          str(tmp_path / "x"), "--contacts", "auto"])
    message = capsys.readouterr().err
    assert code == 2 and "--contact-speed" in message and not (tmp_path / "x").exists()
    code, rep = run(rigs, tmp_path / "out", "a", "b", "--contacts", "none")
    divisor = float(re.search(r"on the target .* is v / ([0-9.]+)\. Or", message).group(1))
    assert divisor == pytest.approx(rep["hipsScale"]["factor"] * rep["source"]["heightMeters"], rel=1e-3)
    with pytest.raises(SystemExit):                                     # the contacts choice is never left to a default
        retarget.parse([str(rigs / "rig-a.glb"), "m", "t", "tm", "out"])


def test_inputs_that_cannot_be_read_write_nothing(rigs, tmp_path):
    code, rep = run(rigs, tmp_path / "x", "a", "b", "--animation", "dance")
    assert code == 2 and rep is None and not (tmp_path / "x").exists()
    empty = dump(tmp_path / "empty.json", {"landmarks": {}})
    code, rep = run(rigs, tmp_path / "y", src_map=empty)
    assert code == 2 and rep is None


def stretched_arms(rigs, path):
    """Rig A's arms clip with its left arm stretched by translation: the elbow slides out along the upper arm to 1.3 times
    its length and the upper arm's joint slides sideways off the collarbone's line, so the source's segments turn and
    lengthen where no rotation does."""
    a = skel(rigs, "a")
    anim = next(x for x in a.model.animations() if x["name"] == "arms")
    times = gltf.key_times(anim)
    (T, R, S), _ = gltf.sample_locals(a.model, anim, times, a.rest)
    grow = np.sin(np.pi * times / times[-1])[:, None]
    elbow, shoulder = a.at["lower-arm.l"], a.at["upper-arm.l"]
    T[:, elbow] = T[:, elbow] * (1 + 0.3 * grow)
    side = np.cross(T[0, shoulder], [0.0, 0.0, 1.0])
    T[:, shoulder] = T[:, shoulder] + 0.3 * grow * side
    channels = [(i, "rotation", R[:, i]) for i in sorted(a.joints)] + [(i, "translation", T[:, i]) for i in (a.at["hips"], elbow, shoulder)]
    gltf.add_animations(str(rigs / "rig-a.glb"), path, [{"name": "arms", "times": times, "channels": channels}])
    return path


def test_stretched_bones_are_named_as_lost_without_translation_and_carried_with_it(rigs, tmp_path):
    src = stretched_arms(rigs, str(tmp_path / "stretched.glb"))
    code, rep = run(rigs, tmp_path / "none", "a", "b", src_file=src)
    arms = rep["animations"][0]
    assert code == 0 and rep["passed"] and arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 1e-4               # the maps fit
    assert arms["roundTrip"]["passed"] and arms["roundTrip"]["maxHeights"] < 1e-9                                   # against what is carried
    assert set(arms["stretch"]) == {"upper-arm.l", "lower-arm.l"} and not any(v["carried"] for v in arms["stretch"].values())
    assert arms["stretch"]["lower-arm.l"]["lengthRatio"][1] == pytest.approx(1.3, abs=1e-3) and arms["stretch"]["upper-arm.l"]["maxDegrees"] > 10
    assert any("upper-arm.l from shoulder.l" in w and "--translation scaled" in w for w in rep["warnings"])           # the loss, named
    assert not any("arms point up to" in w or "round trip" in w for w in rep["warnings"])

    code, rep = run(rigs, tmp_path / "scaled", "a", "b", "--translation", "scaled", src_file=src)
    arms = rep["animations"][0]
    assert code == 0 and rep["passed"] and rep["warnings"] == [] and arms["agreement"]["against"] == "the source"
    assert arms["agreement"]["transfer"]["arms"]["maxDegrees"] < 1e-4 and arms["roundTrip"]["maxHeights"] < 1e-9
    assert all(v["carried"] for v in arms["stretch"].values())
    a, b = skel(rigs, "a"), skel(rigs, "b")
    _, _, sw = sampled(Skeleton(src, load_map(str(rigs / "rig-a.map.json")), "source"), "arms")
    _, _, tw = sampled(Skeleton(str(tmp_path / "scaled" / "retargeted.glb"), load_map(str(rigs / "rig-b.map.json")), "written"), "arms")
    length = lambda s, w, k: np.linalg.norm(w[:, s.at[main_child(k)], :3, 3] - w[:, s.at[k], :3, 3], axis=1)
    for k in ("shoulder.l", "upper-arm.l"):                          # each segment stretches by the source's own ratio
        assert np.allclose(length(b, tw, k) / length(b, b.rest_world[None], k), length(a, sw, k) / length(a, a.rest_world[None], k), atol=1e-5)
    assert np.allclose(length(b, tw, "upper-arm.r"), length(b, b.rest_world[None], "upper-arm.r"), atol=1e-6)   # the other arm keeps its length


def test_a_stretch_of_a_landmark_resting_on_the_one_before_it_has_no_ratio_or_angle():
    """A landmark coincident at rest with the previous one has no rest length or direction: the entry keeps how far it
    moved and leaves the ratio and angle out, so the report stays valid JSON."""
    def poses(child):
        w = np.tile(np.eye(4), (3, 2, 1, 1)); w[:, 1, :3, 3] = child
        return w
    plan = types.SimpleNamespace(src=types.SimpleNamespace(at={"hand.l": 0, "index-1.l": 1}, height=1.0), translation="none",
                                 offsets={"index-1.l": {"from": "hand.l", "carriable": True}})
    out = measure.stretch(plan, poses([[0, 0, 0], [0.05, 0, 0], [0.1, 0, 0]]), poses(np.zeros((3, 3))))
    assert out == {"index-1.l": {"from": "hand.l", "maxMeters": 0.1, "maxDegrees": None, "lengthRatio": None, "carried": False}}
    json.dumps(out, allow_nan=False)
