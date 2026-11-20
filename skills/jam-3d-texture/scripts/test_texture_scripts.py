"""Unit tests for the texture report, channel packing and texture resizing. Run: python3 -m pytest skills/jam-3d-texture/scripts -q"""
import io
import json
import os
import struct
import sys
import zlib

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402
import pack_maps  # noqa: E402
import resize_textures  # noqa: E402
import texture_report  # noqa: E402

POSITIONS = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], dtype=float)
TRIANGLES = np.array([[0, 1, 2], [0, 2, 3]])
UV = POSITIONS[:, :2]


def png(width, height, colour=(200, 100, 50)):
    raw = b"".join(b"\0" + bytes(colour) * width for _ in range(height))
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def model(tmp_path, images, material, name="model.glb"):
    built = glb.build([dict(positions=POSITIONS, triangles=TRIANGLES, uvs=[UV], material=0)], materials=[material], images=images)
    path = tmp_path / name
    glb.write(path, built.doc, built.blob)
    return str(path)


FULL = {"name": "paint", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicRoughnessTexture": {"index": 1}},
        "normalTexture": {"index": 2}, "occlusionTexture": {"index": 1}}


def failed(checks):
    return {c["id"] for c in checks if not c["passed"] and "allowed" not in c}


def test_memory_estimate_is_rgba8_with_mips():
    assert texture_report.mip_bytes(1, 1) == 4
    assert texture_report.mip_bytes(4, 4) == (16 + 4 + 1) * 4
    assert texture_report.mip_bytes(1024, 1024) / 1048576 == pytest.approx(16 / 3, rel=1e-3)
    assert texture_report.mip_bytes(8, 2) == (16 + 4 + 2 + 1) * 4


def test_a_complete_material_within_budget_is_clean(tmp_path):
    path = model(tmp_path, [png(64, 64), png(64, 64, (255, 128, 0)), png(64, 64, (128, 128, 255))], FULL)
    images, materials, facts = texture_report.describe(glb.read(path))
    assert facts["images"] == 3 and facts["materialsDrawn"] == 1
    assert facts["textureMiB"] == pytest.approx(3 * texture_report.mip_bytes(64, 64) / 1048576, abs=1e-3)
    assert materials[0]["maps"] == {"basecolor": 0, "metallic-roughness": 1, "normal": 2, "occlusion": 1}
    assert materials[0]["occlusionPackedWithMetallicRoughness"]
    checks = texture_report.compare(images, materials, facts, max_texture_size=64, max_texture_mib=1, max_materials=1, expect=["basecolor", "normal", "metallic-roughness"])
    assert not failed(checks)


def test_oversized_unused_duplicate_and_missing_maps_fail_by_name(tmp_path):
    same = png(128, 64)
    path = model(tmp_path, [same, same, png(16, 16)], {"name": "m", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "normalTexture": {"index": 1, "texCoord": 1}})
    images, materials, facts = texture_report.describe(glb.read(path))
    checks = texture_report.compare(images, materials, facts, max_texture_size=64, max_texture_mib=0.01, expect=["basecolor", "metallic-roughness"])
    assert failed(checks) == {"texture-size", "texture-memory", "expected-maps", "unused-images", "duplicate-images", "first-uv-set"}
    allowed = texture_report.compare(images, materials, facts, max_texture_size=64, allow={"texture-size": "hero prop"})
    assert "texture-size" not in failed(allowed)


def test_report_command_line_extracts_images_and_uses_exit_codes(tmp_path, capsys):
    path = model(tmp_path, [png(32, 32), png(32, 32, (1, 2, 3)), png(32, 32, (4, 5, 6))], FULL)
    out = tmp_path / "r" / "texture.json"
    assert texture_report.main([path, "--out", str(out), "--max-texture-size", "32", "--expect", "basecolor,normal", "--extract", str(tmp_path / "maps")]) == 0
    report = json.loads(out.read_text())
    assert report["clean"] and len(report["extracted"]) == 3 and all(os.path.getsize(p) > 0 for p in report["extracted"])
    assert texture_report.main([path, "--out", str(out), "--max-texture-size", "16"]) == 1
    assert "texture-size" in capsys.readouterr().err
    assert texture_report.main([str(tmp_path / "none.glb"), "--out", str(out)]) == 2
    with pytest.raises(SystemExit):
        texture_report.main([path, "--out", str(out), "--expect", "specular"])


def test_packing_words():
    assert pack_maps.parse_packing("ORM") == ["occlusion", "roughness", "metallic"]
    assert pack_maps.parse_packing("arm") == ["occlusion", "roughness", "metallic"]
    assert pack_maps.parse_packing("M00S") == ["metallic", "black", "black", "smoothness"]
    for bad in ("OR", "ORMXX", "ORQ", ""):
        with pytest.raises(ValueError):
            pack_maps.parse_packing(bad)


def test_packing_plan_uses_defaults_inverts_smoothness_and_demands_roughness():
    steps, notes = pack_maps.plan("ORM", {"roughness": "r.png"})
    assert steps == [("value", 1.0), ("image", "roughness", False), ("value", 0.0)] and len(notes) == 2
    steps, _ = pack_maps.plan("M00S", {"roughness": 0.25, "metallic": "m.png"})
    assert steps == [("image", "metallic", False), ("value", 0.0), ("value", 0.0), ("value", 0.75)]
    with pytest.raises(ValueError, match="roughness"):
        pack_maps.plan("ORM", {"metallic": 1.0})


def test_pack_and_normal_commands_write_the_expected_pixels(tmp_path, capsys):
    Image = pytest.importorskip("PIL.Image", reason="packing needs Pillow")
    rough, metal = tmp_path / "rough.png", tmp_path / "metal.png"
    Image.new("L", (8, 8), 64).save(rough)
    Image.new("L", (4, 4), 255).save(metal)
    out = tmp_path / "packed" / "orm.png"
    assert pack_maps.main(["pack", str(out), "--roughness", str(rough), "--metallic", str(metal)]) == 0
    assert Image.open(out).size == (8, 8) and Image.open(out).getpixel((3, 3)) == (255, 64, 255)
    smooth = tmp_path / "ms.png"
    assert pack_maps.main(["pack", str(smooth), "--packing", "M00S", "--gltf", str(out)]) == 0
    assert Image.open(smooth).getpixel((0, 0)) == (255, 0, 0, 191)
    assert pack_maps.main(["pack", str(out), "--packing", "ORM", "--metallic", "0.5"]) == 2
    assert pack_maps.main(["pack", str(tmp_path / "c.png"), "--roughness", "0.5"]) == 2      # constants only need --size
    assert pack_maps.main(["pack", str(tmp_path / "c.png"), "--roughness", "0.5", "--size", "4"]) == 0
    normal = tmp_path / "n.png"
    Image.new("RGB", (2, 2), (128, 200, 255)).save(normal)
    flipped = tmp_path / "n-down.png"
    assert pack_maps.main(["normal", str(normal), str(flipped), "--from", "up", "--to", "down"]) == 0
    assert Image.open(flipped).getpixel((0, 0)) == (128, 55, 255)
    assert pack_maps.main(["normal", str(normal), str(flipped), "--from", "up", "--to", "up"]) == 0
    assert Image.open(flipped).getpixel((0, 0)) == (128, 200, 255)
    capsys.readouterr()


def test_resize_bounds_images_drops_unused_ones_and_leaves_geometry_alone(tmp_path):
    Image = pytest.importorskip("PIL.Image", reason="resizing needs Pillow")
    path = model(tmp_path, [png(128, 64), png(32, 32, (9, 9, 9)), png(256, 256, (7, 7, 7))],
                 {"name": "m", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "normalTexture": {"index": 1}})
    out = tmp_path / "o" / "small.glb"
    assert resize_textures.main([path, str(out), "--max-size", "32"]) == 0
    before, after = glb.read(path), glb.read(str(out))
    sizes = [image["size"] for image in after.images()]
    assert sizes == [[32, 16], [32, 32]]
    assert all(image["usedBy"] for image in after.images())
    assert Image.open(io.BytesIO(after.images()[0]["bytes"])).size == (32, 16)
    assert np.array_equal(after.primitives()[0]["positions"], before.primitives()[0]["positions"])
    assert np.array_equal(after.primitives()[0]["uvs"][0], before.primitives()[0]["uvs"][0])
    assert resize_textures.main([path, path, "--max-size", "32"]) == 2


def test_resize_stores_identical_images_once(tmp_path):
    pytest.importorskip("PIL.Image", reason="resizing needs Pillow")
    same = png(16, 16)
    path = model(tmp_path, [same, same], {"name": "m", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "emissiveTexture": {"index": 1}})
    out = tmp_path / "dedup.glb"
    assert resize_textures.main([path, str(out), "--max-size", "64"]) == 0
    after = glb.read(str(out))
    assert len(after.images()) == 1 and {u["slot"] for u in after.images()[0]["usedBy"]} == {"baseColor", "emissive"}
