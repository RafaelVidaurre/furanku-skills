"""The inventory: the package reader against what the engine's own Asset Registry says, the scan with its reuse of
unchanged files, the engine fallback and the conformance check. No Unreal editor runs here.

fixtures/inventory/<engine version>/ holds packages an engine wrote from our own inputs (a texture, a plugin texture, a
static mesh, a material and its instance, a primary asset label with soft references, Blueprints, data assets of
Blueprint classes, actors composed of components, a level sequence with shot metadata; see make_fixtures.py) and
registry.json, what that engine's Asset Registry reported for them. To add an engine version, in an empty project
folder holding Fixture.uproject and Plugins/FixtureKit/FixtureKit.uplugin copied from an existing set
(EngineAssociation changed), with inputs/ copied to a folder outside your home folder:

    JAM_FIXTURE_INPUTS=<copy of inputs> UnrealEditor-Cmd <folder>/Fixture.uproject -run=pythonscript \
        -script=<this folder>/fixtures/inventory/make_fixtures.py -unattended -nosplash -nullrhi -NoSound -NoP4 -stdout
    JAM_FIXTURE_DUMP=<folder>/registry.json JAM_FIXTURE_TAGS='<every tag key the reader finds, as a JSON list>' \
        UnrealEditor-Cmd <folder>/Fixture.uproject -run=pythonscript -script=<...>/dump_registry.py <same flags>

then copy Fixture.uproject, Content/, the plugin and registry.json into fixtures/inventory/<version>/.
"""
import getpass
import json
import os
import shutil
import struct

import pytest

from jam_unreal import config, inventory
from jam_unreal.packages import Unreadable, read_package

from test_adapter import ADAPTER, bridge, run_command

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "inventory")
VERSIONS = sorted(v for v in os.listdir(FIXTURES) if os.path.isfile(os.path.join(FIXTURES, v, "registry.json")))


def fixture_project(tmp_path, version="5.8", facts=None):
    shutil.copytree(os.path.join(FIXTURES, version), tmp_path, dirs_exist_ok=True)
    os.remove(tmp_path / "registry.json")
    if facts is not None:
        (tmp_path / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": facts}}))
    return config.load(str(tmp_path), ADAPTER, environ={})


def registry(version):
    with open(os.path.join(FIXTURES, version, "registry.json")) as f:
        return json.load(f)


def file_of(root, package):
    if package.startswith("/Game/"):
        return os.path.join(root, "Content", package[len("/Game/"):] + ".uasset")
    return os.path.join(root, "Plugins", "FixtureKit", "Content", package[len("/FixtureKit/"):] + ".uasset")


# ---- the reader against the engine
@pytest.mark.parametrize("version", VERSIONS)
def test_the_reader_finds_what_the_engines_registry_holds(version):
    root = os.path.join(FIXTURES, version)
    expected = registry(version)
    assert expected["engine"].startswith(version)
    for package, engine in expected["packages"].items():
        entry = read_package(file_of(root, package), package)
        assert entry["saved"].startswith(version)
        assets = {a["id"]: a for a in entry["assets"]}
        for asset in engine["assets"]:
            assert assets[asset["id"]]["class"] == asset["class"]
            assert {k: assets[asset["id"]]["tags"].get(k) for k in asset["tags"]} == asset["tags"]
        hard = {r["to"] for r in entry["references"] if r["kind"] == "hard"}
        soft = {r["to"] for r in entry["references"] if r["kind"] == "soft"}
        assert hard == {to for to in engine["hard"] if not to.startswith("/Script/")}, package
        assert soft == set(engine["soft"]) - hard, package
        assert {to for to in engine["hard"] if to.startswith("/Script/")} <= {r["to"] for r in entry["references"] if r["kind"] == "native"}


def test_the_main_asset_stands_for_the_package_and_a_blueprints_generated_class_is_kept_beside_it():
    root = os.path.join(FIXTURES, "5.8")
    blueprint = read_package(file_of(root, "/Game/Fixture/Blueprints/BP_Crate"), "/Game/Fixture/Blueprints/BP_Crate")
    assert blueprint["main"] == "/Game/Fixture/Blueprints/BP_Crate.BP_Crate"
    assert [a["class"] for a in blueprint["assets"]] == ["/Script/Engine.Blueprint", "/Script/Engine.BlueprintGeneratedClass"]
    assert blueprint["assets"][0]["tags"]["ParentClass"].endswith("/Script/Engine.Actor'")
    label = read_package(file_of(root, "/Game/Fixture/PAL_Fixture"), "/Game/Fixture/PAL_Fixture")
    assert {"to": "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate", "kind": "soft", "editorOnly": True} in label["references"]
    assert label["references"][-1] == {"to": "/Script/Engine", "kind": "native"}
    material = read_package(file_of(root, "/Game/Fixture/Materials/M_Base"), "/Game/Fixture/Materials/M_Base")
    assert [r for r in material["references"] if r["to"] == "/Engine/EngineResources/DefaultTexture"] == [{"to": "/Engine/EngineResources/DefaultTexture", "kind": "hard"}]
    assert len(material["hash"]) == 40


def write_bytes(path, offset, data):
    with open(path, "r+b") as f:
        f.seek(offset)
        f.write(data)


def test_a_package_the_reader_does_not_know_is_unreadable_with_the_reason(tmp_path):
    source = file_of(os.path.join(FIXTURES, "5.8"), "/Game/Fixture/Textures/T_Crate")
    newer = tmp_path / "newer.uasset"
    shutil.copy(source, newer)
    write_bytes(newer, 16, struct.pack("<i", 1019))
    with pytest.raises(Unreadable, match="package version 522/1019 is not one this reader knows"):
        read_package(str(newer), "/Game/newer")
    other = tmp_path / "other.uasset"
    other.write_bytes(b"\x00" * 64)
    with pytest.raises(Unreadable, match="not an Unreal package"):
        read_package(str(other), "/Game/other")
    cut = tmp_path / "cut.uasset"
    cut.write_bytes(open(source, "rb").read()[:300])
    with pytest.raises(Unreadable):
        read_package(str(cut), "/Game/cut")


# ---- roots and the scan
def test_roots_are_game_where_the_asset_id_fact_puts_it_and_each_content_plugin(tmp_path):
    cfg = fixture_project(tmp_path)
    assert inventory.roots(cfg) == [{"id": "/Game", "path": "Content"}, {"id": "/FixtureKit", "path": "Plugins/FixtureKit/Content"}]
    nested = tmp_path / "nested"
    shutil.copytree(os.path.join(FIXTURES, "5.8"), nested / "apps" / "client")
    (nested / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": {"assetId": {"scheme": "/Game/{path}", "from": "apps/client/Content/{path}.uasset"}}}}))
    cfg = config.load(str(nested), ADAPTER, environ={})
    assert inventory.roots(cfg) == [{"id": "/Game", "path": "apps/client/Content"}, {"id": "/FixtureKit", "path": "apps/client/Plugins/FixtureKit/Content"}]
    result, _ = inventory.scan(cfg)
    assert "apps/client/Content/Fixture/PAL_Fixture.uasset" in result["files"]


def test_a_scan_reads_every_package_once_and_then_only_what_changed(tmp_path):
    cfg = fixture_project(tmp_path)
    first, counts = inventory.scan(cfg)
    assert counts == {"read": 16, "reused": 0, "removed": 0, "unread": 0}
    assert first["files"]["Plugins/FixtureKit/Content/Icons/T_Icon.uasset"]["id"] == "/FixtureKit/Icons/T_Icon"
    stat = os.stat(tmp_path / "Content/Fixture/PAL_Fixture.uasset")
    assert first["files"]["Content/Fixture/PAL_Fixture.uasset"]["mtimeMs"] == stat.st_mtime_ns // 1_000_000_000 * 1e3 + stat.st_mtime_ns % 1_000_000_000 / 1e6
    again, counts = inventory.scan(cfg, first)
    assert counts == {"read": 0, "reused": 16, "removed": 0, "unread": 0}
    assert again["files"] == first["files"]

    shutil.copy(tmp_path / "Content/Fixture/Textures/T_Crate.uasset", tmp_path / "Content/Fixture/Textures/T_Copy.uasset")
    os.remove(tmp_path / "Content/Fixture/PAL_Fixture.uasset")
    touched = tmp_path / "Content/Fixture/Materials/MI_Crate.uasset"
    os.utime(touched, ns=(os.stat(touched).st_atime_ns, os.stat(touched).st_mtime_ns + 5_000_000))
    third, counts = inventory.scan(cfg, again)
    assert counts == {"read": 2, "reused": 14, "removed": 1, "unread": 0}
    assert third["files"]["Content/Fixture/Textures/T_Copy.uasset"]["id"] == "/Game/Fixture/Textures/T_Copy"


def test_unreadable_packages_stay_listed_and_are_read_again_until_they_are_readable(tmp_path):
    cfg = fixture_project(tmp_path)
    write_bytes(tmp_path / "Content/Fixture/PAL_Fixture.uasset", 16, struct.pack("<i", 1019))
    result, counts = inventory.scan(cfg)
    entry = result["files"]["Content/Fixture/PAL_Fixture.uasset"]
    assert counts["unread"] == 1 and "assets" not in entry and "1019" in entry["unread"]
    _, counts = inventory.scan(cfg, result)
    assert counts["read"] == 1 and counts["unread"] == 1


def test_the_engine_fills_unread_packages_without_tags():
    result = {"files": {"Content/A.uasset": {"id": "/Game/A", "size": 1, "mtimeMs": 1, "unread": "newer"}}}
    reported = {"/Game/A": {"assets": [{"id": "/Game/A.A", "class": "/Script/Engine.Texture2D", "tags": {}}], "hard": ["/Game/B", "/Script/Engine"], "soft": ["/Game/B", "/Game/C"]}}
    unloaded = {"files": {"Content/D.uasset": {"id": "/Game/D", "size": 1, "mtimeMs": 1, "unread": "newer"}}}
    assert inventory.apply_engine(unloaded, {"/Game/D": {"assets": [{"id": "/Game/D.D", "class": "/Script/Game.Item", "classLoaded": False}], "hard": [], "soft": []}}) == 0
    assert unloaded["files"]["Content/D.uasset"]["unread"] == "newer; the editor could not load /Script/Game.Item either (build the project's editor modules)"
    assert inventory.apply_engine(result, reported) == 1
    assert result["files"]["Content/A.uasset"] == {
        "id": "/Game/A", "size": 1, "mtimeMs": 1, "main": "/Game/A.A",
        "assets": [{"id": "/Game/A.A", "class": "/Script/Engine.Texture2D", "tags": {}, "tagsFromEngine": False}],
        "references": [{"to": "/Game/B", "kind": "hard"}, {"to": "/Game/C", "kind": "soft"}, {"to": "/Script/Engine", "kind": "native"}],
    }


@pytest.mark.parametrize("version", VERSIONS)
def test_the_conformance_comparison_accepts_the_known_differences_and_names_real_ones(tmp_path, version):
    cfg = fixture_project(tmp_path, version)
    result, _ = inventory.scan(cfg)
    reported = registry(version)["packages"]
    assert inventory.compare(result, reported) == []
    texture = result["files"]["Content/Fixture/Textures/T_Crate.uasset"]
    texture["assets"][0]["tags"]["Dimensions"] = "8x8"
    texture["references"].append({"to": "/Game/Elsewhere", "kind": "hard"})
    mesh = result["files"]["Content/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.uasset"]
    mesh["assets"][0]["class"] = "/Script/Engine.SkeletalMesh"
    messages = [p["message"] for p in inventory.compare(result, reported)]
    assert any("T_Crate: tag Dimensions is '8x8', the engine says '4x4'" in m for m in messages)
    assert any("reader has a hard reference to /Game/Elsewhere" in m for m in messages)
    assert any("SM_Crate: class /Script/Engine.SkeletalMesh, the engine says /Script/Engine.StaticMesh" in m for m in messages)


# ---- the commands, run as the toolkit runs them
def test_inventory_writes_the_file_it_was_asked_for_and_reuses_the_previous_one(tmp_path):
    fixture_project(tmp_path)
    code, receipt, err = run_command(tmp_path, "engine_inventory.py", "--out", "Saved/inv.json")
    assert code == 0, err
    assert receipt == {"inventory": "Saved/inv.json", "files": 16, "assets": 23, "read": 16, "reused": 0, "removed": 0, "unread": 0}
    written = json.loads((tmp_path / "Saved/inv.json").read_text())
    assert written["format"] == 1 and written["adapter"] == "unreal" and len(written["files"]) == 16
    code, receipt, _ = run_command(tmp_path, "engine_inventory.py", "--out", "Saved/inv.json", "--previous", "Saved/inv.json")
    assert (receipt["read"], receipt["reused"]) == (0, 16)
    code, receipt, _ = run_command(tmp_path, "engine_inventory.py", "--out", "/elsewhere/inv.json")
    assert code == 1 and receipt["error"]["code"] == "invalid-path"


def test_with_the_engine_unread_packages_are_read_through_the_editor(tmp_path):
    fixture_project(tmp_path)
    write_bytes(tmp_path / "Content/Fixture/PAL_Fixture.uasset", 16, struct.pack("<i", 1019))
    results = '{"inventory": lambda a: {"engine": "5.8", "packages": {p: {"assets": [{"id": p + ".PAL_Fixture", "class": "/Script/Engine.PrimaryAssetLabel", "tags": {}}], "hard": [], "soft": ["/Game/X"]} for p in a["packages"]}}}'
    code, receipt, err = run_command(tmp_path, "engine_inventory.py", "--out", "inv.json", "--engine", local=bridge(tmp_path, results))
    assert code == 0, err
    assert receipt["unread"] == 0
    entry = json.loads((tmp_path / "inv.json").read_text())["files"]["Content/Fixture/PAL_Fixture.uasset"]
    assert entry["assets"][0]["tagsFromEngine"] is False and entry["references"] == [{"to": "/Game/X", "kind": "soft"}]


def test_the_inventory_check_compares_the_reader_with_the_editors_registry(tmp_path):
    fixture_project(tmp_path)
    packages = registry("5.8")["packages"]
    results = '{"inventory": lambda a: {"engine": "5.8", "packages": {p: v for p, v in %s.items() if p in a["packages"]}}}' % json.dumps(packages)
    code, receipt, err = run_command(tmp_path, "engine_check.py", "--kind", "inventory", local=bridge(tmp_path, results))
    assert code == 0, err
    assert receipt["problems"] == []
    packages["/Game/Fixture/Textures/T_Crate"]["assets"][0]["class"] = "/Script/Engine.TextureCube"
    results = '{"inventory": lambda a: {"engine": "5.8", "packages": {p: v for p, v in %s.items() if p in a["packages"]}}}' % json.dumps(packages)
    code, receipt, _ = run_command(tmp_path, "engine_check.py", "--kind", "inventory", "/Game/Fixture/Textures", local=bridge(tmp_path, results))
    assert [p["message"] for p in receipt["problems"]] == ["/Game/Fixture/Textures/T_Crate.T_Crate: class /Script/Engine.Texture2D, the engine says /Script/Engine.TextureCube"]


def test_a_class_the_editor_cannot_load_is_one_problem_and_its_packages_references_are_not_compared(tmp_path):
    cfg = fixture_project(tmp_path)
    result, _ = inventory.scan(cfg)
    reported = registry("5.8")["packages"]
    instance = reported["/Game/Fixture/Materials/MI_Crate"]
    instance["assets"][0]["classLoaded"] = False
    instance["hard"] = []
    assert [p["message"] for p in inventory.compare(result, reported)] == [
        "the editor could not load /Script/Engine.MaterialInstanceConstant, so its registry holds no references for the 1 packages of that class; they were not compared"]


# ---- the fixtures are public
MACHINE_PATHS = [b"/Users/", b"/home/", b"C:\\Users", b"C:/Users", b"/private/", b"/tmp/", b"/var/folders/", b"/Volumes/"]


def test_no_fixture_holds_a_path_or_user_name_of_the_machine_that_made_it():
    """Imported assets store their source path; make_fixtures.py imports from inside the project so it is relative.
    Every file under fixtures/ is checked as bytes, in UTF-8 and UTF-16 (packages store strings in either), for an
    absolute machine path and for the name of the user running the tests."""
    needles = MACHINE_PATHS + [getpass.getuser().encode()]
    found = []
    for folder, _, names in os.walk(os.path.dirname(FIXTURES)):
        for name in names:
            path = os.path.join(folder, name)
            with open(path, "rb") as f:
                data = f.read()
            for needle in needles:
                if needle in data or needle.decode().encode("utf-16-le") in data:
                    found.append((os.path.relpath(path, FIXTURES), needle))
    assert found == []
