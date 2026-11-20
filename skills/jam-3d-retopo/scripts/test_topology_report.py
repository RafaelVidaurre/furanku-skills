"""Unit tests for the topology report and the shared GLB reader. Run: python3 -m pytest skills/jam-3d-retopo/scripts -q"""
import json
import os
import struct
import sys
import zlib

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import glb  # noqa: E402
import topology_report  # noqa: E402

CUBE = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=float)
CUBE_QUADS = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def triangles(quads):
    return np.array([t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))])


def cube(quads=CUBE_QUADS, **extra):
    return dict(positions=CUBE, triangles=triangles(quads), material=0, **extra)


def png(width, height, colour=(200, 100, 50)):
    raw = b"".join(b"\0" + bytes(colour) * width for _ in range(height))
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def saved(tmp_path, model, name="model.glb"):
    path = tmp_path / name
    glb.write(path, model.doc, model.blob)
    return str(path)


def test_a_closed_cube_is_clean_and_reads_as_quads():
    metrics = topology_report.measure([cube()])
    assert metrics["triangles"] == 12 and metrics["weldedVertices"] == 8
    assert metrics["openEdges"] == metrics["nonManifoldEdges"] == metrics["degenerateFaces"] == metrics["duplicateFaces"] == 0
    assert metrics["parts"] == 1 and metrics["smallParts"] == 0
    assert metrics["quadPairShare"] == 1.0
    checks, _ = topology_report.compare(metrics, max_triangles=12, max_materials=1, require_closed=True, min_quad_share=0.9)
    assert all(c["passed"] for c in checks)


def test_vertices_split_along_seams_are_welded_before_measuring():
    tris = triangles(CUBE_QUADS)
    split = dict(positions=CUBE[tris.reshape(-1)], triangles=np.arange(36).reshape(-1, 3), material=0)
    metrics = topology_report.measure([split])
    assert metrics["exportedVertices"] == 36 and metrics["weldedVertices"] == 8 and metrics["openEdges"] == 0


def test_an_open_box_fails_only_when_a_closed_surface_is_required_and_an_allowed_check_is_named():
    metrics = topology_report.measure([cube(CUBE_QUADS[:-1])])
    assert metrics["openEdges"] == 4
    assert all(c["passed"] for c in topology_report.compare(metrics)[0])
    checks, _ = topology_report.compare(metrics, require_closed=True, allow={"open-edges": "open at the back, against a wall"})
    row = next(c for c in checks if c["id"] == "open-edges")
    assert not row["passed"] and row["allowed"] == "open at the back, against a wall"


def test_non_manifold_degenerate_duplicate_and_loose_geometry_is_counted():
    fan = dict(positions=np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1.0]]), triangles=np.array([[0, 1, 2], [0, 1, 3], [0, 1, 4]]), material=0)
    assert topology_report.measure([fan])["nonManifoldEdges"] == 1
    bad = cube()
    bad["triangles"] = np.concatenate([bad["triangles"], [[0, 1, 1]], bad["triangles"][:1]])
    metrics = topology_report.measure([bad])
    assert metrics["degenerateFaces"] == 1 and metrics["duplicateFaces"] == 1
    speck = dict(positions=np.array([[5, 5, 5], [5.01, 5, 5], [5, 5.01, 5.0]]), triangles=np.array([[0, 1, 2]]), material=0)
    metrics = topology_report.measure([cube(), speck])
    assert metrics["parts"] == 2 and metrics["smallParts"] == 1
    assert not next(c for c in topology_report.compare(metrics)[0] if c["id"] == "small-parts")["passed"]


def test_a_triangle_soup_does_not_read_as_quads():
    rng = np.random.default_rng(7)
    points = rng.random((60, 3))
    soup = dict(positions=points, triangles=np.array([[i, (i + 7) % 60, (i + 23) % 60] for i in range(60)]), material=0)
    assert topology_report.measure([soup])["quadPairShare"] < 0.3


def test_budget_checks_and_target_note():
    metrics = topology_report.measure([cube(), dict(cube(), material=1)])
    checks, notes = topology_report.compare(metrics, max_triangles=20, target_triangles=10, max_materials=1)
    failed = {c["id"] for c in checks if not c["passed"]}
    assert {"triangles", "materials"} <= failed
    assert notes and "target" in notes[0]


def test_command_line_writes_a_report_and_uses_exit_codes(tmp_path, capsys):
    path = saved(tmp_path, glb.build([cube()]))
    out = tmp_path / "reports" / "topology.json"
    assert topology_report.main([path, "--out", str(out), "--max-triangles", "12", "--max-materials", "1"]) == 0
    report = json.loads(out.read_text())
    assert report["clean"] and report["metrics"]["triangles"] == 12
    assert topology_report.main([path, "--out", str(out), "--max-triangles", "8"]) == 1
    assert "triangles is 12" in capsys.readouterr().err
    assert topology_report.main([path, "--out", str(out), "--max-triangles", "8", "--allow", "triangles=hero prop, agreed"]) == 0
    assert json.loads(out.read_text())["exceptions"] == [{"check": "triangles", "reason": "hero prop, agreed"}]
    assert topology_report.main([str(tmp_path / "missing.glb"), "--out", str(out)]) == 2
    with pytest.raises(SystemExit):
        topology_report.main([path, "--out", str(out), "--allow", "triangles"])


def test_glb_round_trip_keeps_geometry_uvs_materials_and_images(tmp_path):
    uv = CUBE[:, :2]
    model = glb.build([cube(uvs=[uv, uv * 0.5])], materials=[{"name": "paint", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}], images=[png(8, 4)])
    again = glb.read(saved(tmp_path, model))
    primitive = again.primitives()[0]
    assert np.allclose(primitive["positions"], CUBE) and primitive["triangles"].shape == (12, 3)
    assert sorted(primitive["uvs"]) == [0, 1] and np.allclose(primitive["uvs"][1], uv * 0.5)
    image = again.images()[0]
    assert image["size"] == [8, 4] and image["usedBy"] == [{"material": "paint", "slot": "baseColor"}]


def test_node_transforms_are_applied_to_positions():
    model = glb.build([cube()])
    model.doc["nodes"][0].update(scale=[2, 2, 2], translation=[10, 0, 0])
    positions = model.primitives()[0]["positions"]
    assert positions.min(axis=0).tolist() == [10, 0, 0] and positions.max(axis=0).tolist() == [12, 2, 2]


def test_files_the_reader_cannot_use_say_what_to_do(tmp_path):
    path = tmp_path / "text.glb"
    path.write_text("not a glb")
    with pytest.raises(glb.GlbError, match="pack-glb"):
        glb.read(path)
    model = glb.build([cube()])
    model.doc["meshes"][0]["primitives"][0]["extensions"] = {"KHR_draco_mesh_compression": {}}
    with pytest.raises(glb.GlbError, match="Draco"):
        model.primitives()


def test_components_labels_connected_items():
    labels = glb.components(6, np.array([[0, 1], [1, 2], [4, 5]]))
    assert labels[0] == labels[1] == labels[2] and labels[4] == labels[5] and len(set(labels.tolist())) == 3


def test_every_skill_ships_the_same_shared_helpers():
    """jam-3d-retopo, jam-3d-uv and jam-3d-texture each carry glb.py and blender/jamscene.py; the copies must not drift."""
    skills = os.path.dirname(os.path.dirname(HERE))
    for relative in ("scripts/glb.py", "scripts/blender/jamscene.py"):
        copies = [os.path.join(skills, skill, relative) for skill in ("jam-3d-retopo", "jam-3d-uv", "jam-3d-texture")]
        present = [c for c in copies if os.path.exists(c)]
        if len(present) < 2:
            pytest.skip("the sibling skills are not installed beside this one")
        contents = {open(c, "rb").read() for c in present}
        assert len(contents) == 1, f"{relative} differs between skills: edit one and copy it to the others"
