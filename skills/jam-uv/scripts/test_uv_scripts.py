"""Unit tests for the UV report, the UV-set stripper and the landmark seam hints. Run: python3 -m pytest skills/jam-uv/scripts -q"""
import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402
import seam_hints_from_landmarks  # noqa: E402
import strip_uv_sets  # noqa: E402
import uv_report  # noqa: E402

QUAD = np.array([[0, 1, 2], [0, 2, 3]])


def square(origin, uv_origin, uv_size, world=1.0, flip=False, name="s"):
    """A 1 m square in the XY plane with its own UV square."""
    ox, oy = origin
    positions = np.array([[ox, oy, 0], [ox + world, oy, 0], [ox + world, oy + world, 0], [ox, oy + world, 0]], dtype=float)
    u, v = uv_origin
    corners = np.array([[u, v], [u + uv_size, v], [u + uv_size, v + uv_size], [u, v + uv_size]], dtype=float)
    if flip:
        corners = corners[[1, 0, 3, 2]]
    uvs = np.stack([corners[:, 0], 1 - corners[:, 1]], axis=1)      # stored as glTF does, V down
    return dict(positions=positions, triangles=QUAD, uvs={0: uvs}, mesh=name, primitive=0, material=0)


def ids(checks, passed):
    return {c["id"] for c in checks if c["passed"] is passed and "declared" not in c}


def test_two_islands_with_a_known_gap():
    metrics = uv_report.measure([square((0, 0), (0.1, 0.1), 0.3), square((2, 0), (0.5, 0.1), 0.3)], texture_size=1024, min_gap_px=8)
    assert metrics["islands"] == 2 and metrics["overlapShare"] == 0 and metrics["flippedShare"] == 0
    assert metrics["coverage"] == pytest.approx(0.18, abs=0.005)
    assert metrics["padding"]["islandGapPx"] is None and metrics["padding"]["islandGapAtLeastPx"] >= 8      # the real gap is 102 px
    assert metrics["padding"]["borderGapPx"] == pytest.approx(102.4, abs=0.2)
    assert metrics["densitySpreadP95overP5"] == pytest.approx(1.0)
    assert metrics["texelDensityPxPerMeter"]["median"] == pytest.approx(0.3 * 1024, rel=0.01)
    assert not ids(uv_report.compare(metrics), False)


def test_a_gap_smaller_than_the_minimum_is_measured_and_fails():
    metrics = uv_report.measure([square((0, 0), (0.1, 0.1), 0.3), square((2, 0), (0.4 + 3 / 1024, 0.1), 0.3)], texture_size=1024, min_gap_px=8)
    assert 1 <= metrics["padding"]["islandGapPx"] <= 3
    assert "island-gap" in ids(uv_report.compare(metrics), False)


def test_gap_is_scaled_to_the_texture_size():
    islands = [square((0, 0), (0.1, 0.1), 0.3), square((2, 0), (0.4 + 4 / 1024, 0.1), 0.3)]
    assert uv_report.measure(islands, texture_size=4096, min_gap_px=32)["padding"]["islandGapPx"] == pytest.approx(16, abs=8)


def test_overlap_and_mirrored_islands_fail_unless_declared():
    stacked = [square((0, 0), (0.1, 0.1), 0.4), square((2, 0), (0.1, 0.1), 0.4, flip=True)]
    metrics = uv_report.measure(stacked, texture_size=512)
    assert metrics["overlapShare"] > 0.95 and metrics["flippedShare"] == 0.5
    assert {"overlap", "flipped"} <= ids(uv_report.compare(metrics), False)
    declared = uv_report.compare(metrics, declare_overlap="left and right halves share one island")
    assert not ids(declared, False)
    assert {c["id"] for c in declared if "declared" in c} >= {"overlap", "flipped"}


def test_uneven_texel_density_is_a_spread():
    metrics = uv_report.measure([square((0, 0), (0.05, 0.05), 0.4), square((2, 0), (0.55, 0.05), 0.2)], texture_size=1024)
    assert metrics["densitySpreadP95overP5"] == pytest.approx(2.0, rel=0.01)
    assert "density-spread" in ids(uv_report.compare(metrics, max_density_spread=1.5), False)
    assert "density-spread" in ids(uv_report.compare(metrics, max_density_spread=2.5), True)


def test_tiling_uvs_fail_unless_declared():
    metrics = uv_report.measure([square((0, 0), (0.0, 0.0), 3.0)], texture_size=256)
    assert metrics["outsideUnitSquare"]
    assert "inside-unit-square" in ids(uv_report.compare(metrics), False)
    assert not ids(uv_report.compare(metrics, declare_tiling="a tiling brick wall"), False)


def test_meshes_without_uvs_and_extra_uv_sets_are_reported():
    bare = dict(square((0, 0), (0, 0), 1), uvs={})
    metrics = uv_report.measure([bare], texture_size=256)
    assert metrics["primitivesWithoutUVs"] == ["s[0]"] and "has-uvs" in ids(uv_report.compare(metrics), False)
    two = square((0, 0), (0.1, 0.1), 0.5)
    two["uvs"][1] = two["uvs"][0]
    assert "single-uv-set" in ids(uv_report.compare(uv_report.measure([two], texture_size=256)), False)


def test_materials_with_their_own_texture_are_measured_apart_and_a_shared_square_as_one():
    own = [dict(square((0, 0), (0.05, 0.05), 0.9), material=0), dict(square((2, 0), (0.05, 0.05), 0.9), material=1)]
    layouts = uv_report.split_layouts(own, 512, names=["wood", "metal"])
    assert [l["materials"] for l in layouts] == [["wood"], ["metal"]] and all(l["metrics"]["overlapShare"] == 0 for l in layouts)
    shared = [dict(square((0, 0), (0.05, 0.05), 0.4), material=0), dict(square((2, 0), (0.55, 0.05), 0.4), material=1)]
    layouts = uv_report.split_layouts(shared, 512, names=["wood", "metal"])
    assert len(layouts) == 1 and layouts[0]["materials"] == ["wood", "metal"] and layouts[0]["metrics"]["islands"] == 2


def test_same_geometry_ignores_vertex_order_and_notices_a_moved_vertex():
    a = square((0, 0), (0.1, 0.1), 0.5)
    shuffled = dict(a, positions=a["positions"][[2, 3, 0, 1]], triangles=np.array([[2, 3, 0], [2, 0, 1]]))
    assert uv_report.same_geometry([a], [shuffled])["same"]
    moved = dict(a, positions=a["positions"] + np.array([[0, 0, 0], [0, 0, 0], [0.2, 0, 0], [0, 0, 0]]))
    assert not uv_report.same_geometry([a], [moved])["same"]


def build(tmp_path, uv_sets, name="model.glb"):
    positions = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], dtype=float)
    material = {"name": "m", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0, "texCoord": len(uv_sets) - 1}}}
    model = glb.build([dict(positions=positions, triangles=QUAD, uvs=uv_sets, material=0)], materials=[material])
    model.doc["textures"] = [{}]
    path = tmp_path / name
    glb.write(path, model.doc, model.blob)
    return str(path)


def test_strip_keeps_the_named_set_as_the_only_one_and_leaves_geometry_alone(tmp_path):
    first = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=float)
    second = first * 0.5 + 0.25
    source = build(tmp_path, [first, second])
    out = tmp_path / "out" / "stripped.glb"
    assert strip_uv_sets.main([source, str(out), "--keep", "1"]) == 0
    before, after = glb.read(source), glb.read(str(out))
    primitive = after.primitives()[0]
    assert sorted(primitive["uvs"]) == [0] and np.allclose(primitive["uvs"][0], second)
    assert np.array_equal(primitive["positions"], before.primitives()[0]["positions"])
    assert len(after.doc["accessors"]) == len(before.doc["accessors"]) - 1
    assert "texCoord" not in after.doc["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]
    assert len(after.blob) < len(before.blob)


def test_strip_refuses_a_missing_set_and_writing_over_the_source(tmp_path, capsys):
    source = build(tmp_path, [np.zeros((4, 2))])
    assert strip_uv_sets.main([source, str(tmp_path / "o.glb"), "--keep", "2"]) == 1
    assert "no UV set 2" in capsys.readouterr().err
    assert strip_uv_sets.main([source, source]) == 2


def test_report_command_line(tmp_path, capsys):
    uv = np.array([[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]], dtype=float)      # glTF's V runs down
    source = build(tmp_path, [uv])
    out = tmp_path / "uv"
    pytest.importorskip("PIL", reason="the layout drawing needs Pillow")
    assert uv_report.main([source, "--out", str(out), "--texture-size", "512", "--same-geometry-as", source]) == 0
    report = json.loads((out / "uv-report.json").read_text())
    assert report["passed"] and report["layouts"][0]["metrics"]["islands"] == 1 and (out / "uv-layout.png").stat().st_size > 0
    two = build(tmp_path, [uv, uv], "two.glb")
    assert uv_report.main([two, "--out", str(out), "--texture-size", "512", "--no-layout"]) == 1
    assert "single-uv-set" in capsys.readouterr().err
    assert uv_report.main([str(tmp_path / "missing.glb"), "--out", str(out), "--texture-size", "512"]) == 2


def landmarks(up="+Y"):
    points = {"hips": [0, 1.0, 0], "spine": [0, 1.15, 0], "chest": [0, 1.3, 0], "neck": [0, 1.5, 0], "head": [0, 1.6, 0]}
    for side, sign in (("l", 1), ("r", -1)):
        points.update({f"shoulder.{side}": [0.05 * sign, 1.45, 0], f"upper-arm.{side}": [0.2 * sign, 1.45, 0], f"lower-arm.{side}": [0.45 * sign, 1.45, 0],
                       f"hand.{side}": [0.7 * sign, 1.45, 0], f"upper-leg.{side}": [0.1 * sign, 0.95, 0], f"lower-leg.{side}": [0.1 * sign, 0.5, 0],
                       f"foot.{side}": [0.1 * sign, 0.08, 0], f"toes.{side}": [0.1 * sign, 0.0, 0.15]})
    if up == "+Z":
        points = {k: [x, -z, y] for k, (x, y, z) in points.items()}
    return {"units": "meters", "up": up, "landmarks": points}


def test_landmark_hints_cut_where_a_garment_has_seams():
    hints = seam_hints_from_landmarks.hints_from(landmarks())
    assert hints["space"] == "gltf"
    assert {loop["name"] for loop in hints["loops"]} == {"neck", "waist", "shoulder.l", "shoulder.r", "wrist.l", "wrist.r", "ankle.l", "ankle.r"}
    assert {"back-of-head", "seat", "arm-underside.l", "torso-side.r", "inseam.l"} <= {path["name"] for path in hints["paths"]}
    wrist = next(loop for loop in hints["loops"] if loop["name"] == "wrist.l")
    assert wrist["at"] == [0.7, 1.45, 0] and wrist["axis"][0] > 0          # the cut is across the forearm
    sole = next(split for split in hints["sides"] if split["name"] == "sole.r")
    assert sole["axis"] == [0, 1, 0] and sole["threshold"] == -0.5


def test_landmark_files_with_z_up_give_the_same_hints_and_a_missing_joint_is_named(tmp_path, capsys):
    assert seam_hints_from_landmarks.hints_from(landmarks("+Z")) == seam_hints_from_landmarks.hints_from(landmarks("+Y"))
    broken = landmarks()
    del broken["landmarks"]["hand.l"]
    source = tmp_path / "landmarks.json"
    source.write_text(json.dumps(broken))
    assert seam_hints_from_landmarks.main([str(source), str(tmp_path / "hints.json")]) == 2
    assert "hand.l" in capsys.readouterr().err
