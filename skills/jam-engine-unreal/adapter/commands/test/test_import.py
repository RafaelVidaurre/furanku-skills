"""Stored sources of imported assets, through a real headless editor. Skipped unless JAM_UNREAL_EDITOR names an
UnrealEditor-Cmd (5.8 or later):

    JAM_UNREAL_EDITOR=<path to UnrealEditor-Cmd> python3 -m pytest <this file> -rs

An imported asset stores its source relative to its own package, so an asset moved after import resolves it from its
new folder, outside the project. Every import kind therefore creates its assets where they stay; this test reads each
asset's stored source back in a new editor process. The models and maps in fixtures/import/ are made by
fixtures/import/make_fixtures.py in Blender; the sound is written here.
"""
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import wave

import pytest

COMMANDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "import")
EDITOR = os.environ.get("JAM_UNREAL_EDITOR")
UPROJECT = {"FileVersion": 3, "Plugins": [{"Name": "PythonScriptPlugin", "Enabled": True}, {"Name": "Interchange", "Enabled": True}, {"Name": "InterchangeEditor", "Enabled": True}]}

SKELETON = """import os, unreal
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
t = unreal.AssetImportTask(); t.filename = os.path.join(proj, "Art", "Hero.fbx"); t.destination_path = "/Game/Base"; t.automated = True; t.save = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([t])
"""
STORED = """import json, os, unreal
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
out = {}
for path in unreal.EditorAssetLibrary.list_assets("/Game", recursive=True):
    asset = unreal.EditorAssetLibrary.load_asset(str(path).split(".")[0])
    try:
        names = [str(n) for n in asset.get_editor_property("asset_import_data").extract_filenames()]
    except Exception:
        names = []
    out[str(path).split(".")[0]] = [os.path.relpath(n, proj).replace(os.sep, "/") for n in names if n]
open(os.path.join(proj, "stored.json"), "w").write(json.dumps(out))
"""


def editor_script(root, text, name):
    (root / name).write_text(text)
    with open(str(root / (name + ".log")), "w") as log:
        subprocess.run([EDITOR, str(root / "Game.uproject"), "-run=pythonscript", "-script=" + str(root / name), "-unattended", "-nosplash", "-nullrhi", "-stdout"],
                       stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, timeout=900)


def run_command(root, script, *args):
    env = dict(os.environ, JAM_PROJECT_ROOT=str(root), JAM_ENGINE_SETTINGS=json.dumps({"transport": {"kind": "commandlet", "editor": EDITOR}}))
    with open(str(root / "out.json"), "w") as out, open(str(root / "err.txt"), "w") as err:
        code = subprocess.run([sys.executable, os.path.join(COMMANDS, script), *args], cwd=str(root), stdout=out, stderr=err, env=env).returncode
    return code, json.loads((root / "out.json").read_text()), (root / "err.txt").read_text()


def knock(path):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / 48000))) for i in range(4800)))


def scratch_project(root):
    """A project holding the fixtures and a skeleton imported from Hero.fbx, which the skinned imports land on."""
    (root / "Game.uproject").write_text(json.dumps(UPROJECT))
    shutil.copytree(FIXTURES, str(root / "Art"))
    editor_script(root, SKELETON, "skeleton.py")
    (root / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": {"skeletons": {"column": {"label": "column"}}, "extra": {
        "destinations": {"static": "/Game/Props", "skinned": "/Game/Characters", "textures": "/Game/Textures", "audio": "/Game/Audio"},
        "skeletons": {"column": {"skeleton": "/Game/Base/Hero_Skeleton", "root": "root"}}}}}}))


@pytest.mark.skipif(not EDITOR, reason="set JAM_UNREAL_EDITOR to an UnrealEditor-Cmd to import through a real editor")
def test_every_import_kind_leaves_its_assets_remembering_the_project_file(tmp_path):
    scratch_project(tmp_path)
    knock(str(tmp_path / "Art" / "Knock.wav"))

    # two props whose own material and image names collide land side by side under their own names
    for prop in ("Crate", "Stool"):
        code, receipt, err = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/%s.glb" % prop)
        assert code == 0, err
        assert receipt["assets"][0] == {"id": "/Game/Props/SM_" + prop, "kind": "static-mesh", "source": "Art/%s.glb" % prop, "sha256": receipt["assets"][0]["sha256"]}
        assert [(a["id"], a["kind"]) for a in receipt["assets"][1:]] == [
            ("/Game/Props/Textures/T_%s_Image" % prop, "texture"), ("/Game/Props/Materials/MI_" + prop, "material-instance")]
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/Crate.glb")
    assert code == 1 and "/Game/Props/SM_Crate, /Game/Props/Textures/T_Crate_Image, /Game/Props/Materials/MI_Crate exist" in receipt["error"]["message"]
    # images named "Wood <Normal>" and "wood.diffuse" land under the names the engine cleans them to, and those are the names checked
    plank = ["/Game/Props/SM_Plank", "/Game/Props/Textures/T_Plank_Wood__Normal_", "/Game/Props/Textures/T_Plank_wood_diffuse", "/Game/Props/Materials/MI_Plank"]
    code, receipt, err = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/Plank.glb")
    assert code == 0, err
    assert [a["id"] for a in receipt["assets"]] == plank
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/Plank.glb")
    assert code == 1 and ", ".join(plank) + " exist" in receipt["error"]["message"]
    # a file the importer cannot read is refused, and an existing mesh of the name asked for is left alone
    (tmp_path / "Art" / "Broken.glb").write_bytes(b"glTF\x02\x00\x00\x00" + bytes(range(256)) * 4)
    for name in ("Broken", "Crate"):
        code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/Broken.glb", "--name", name)
        assert code == 1 and "no static mesh could be read from Art/Broken.glb" in receipt["error"]["message"], receipt
    code, _, err = run_command(tmp_path, "engine_import.py", "--kind", "textures", "Art/T_Rock_Color.png", "Art/T_Rock_Normal.png", "Art/T_Rock_ORM.png")
    assert code == 0, err
    code, _, err = run_command(tmp_path, "engine_import.py", "--kind", "audio", "Art/Knock.wav")
    assert code == 0, err
    code, receipt, err = run_command(tmp_path, "engine_import.py", "--kind", "skinned", "Art/Hero.fbx", "--skeleton", "column", "--physics-asset", "none")
    assert code == 0, err
    assert receipt["assets"] == [{"id": "/Game/Characters/Hero/Meshes/SK_Hero", "kind": "skeletal-mesh", "source": "Art/Hero.fbx", "sha256": receipt["assets"][0]["sha256"]}]

    editor_script(tmp_path, STORED, "stored.py")
    stored = json.loads((tmp_path / "stored.json").read_text())
    expected = {"/Game/Props/SM_Crate": ["Art/Crate.glb"], "/Game/Props/Textures/T_Crate_Image": ["Art/Crate.glb"], "/Game/Props/Materials/MI_Crate": ["Art/Crate.glb"],
                "/Game/Props/SM_Stool": ["Art/Stool.glb"], "/Game/Props/Textures/T_Stool_Image": ["Art/Stool.glb"], "/Game/Props/Materials/MI_Stool": ["Art/Stool.glb"],
                **{asset: ["Art/Plank.glb"] for asset in plank},
                "/Game/Textures/T_Rock_Color": ["Art/T_Rock_Color.png"], "/Game/Textures/T_Rock_Normal": ["Art/T_Rock_Normal.png"], "/Game/Textures/T_Rock_ORM": ["Art/T_Rock_ORM.png"],
                "/Game/Audio/Knock": ["Art/Knock.wav"], "/Game/Characters/Hero/Meshes/SK_Hero": ["Art/Hero.fbx"]}
    assert {k: stored.get(k) for k in expected} == expected
    assert not [k for k in stored if k.startswith("/Game/Props/") and k not in expected]   # nothing left in a scratch folder
    code, receipt, err = run_command(tmp_path, "engine_check.py", "--kind", "sources", *sorted(expected))
    assert code == 0 and receipt == {"problems": []}, err


MATERIALS = """import json, os, unreal
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
eal = unreal.EditorAssetLibrary
out = {"slots": {}, "instances": {}}
mesh = eal.load_asset("/Game/Characters/Hero/Meshes/SK_Hero")
for m in mesh.get_editor_property("materials"):
    mi = m.get_editor_property("material_interface")
    out["slots"][str(m.get_editor_property("material_slot_name"))] = mi.get_path_name().split(".")[0] if mi else None
for name in ("MI_Skin", "MI_Cloth"):
    mi = eal.load_asset("/Game/Characters/Hero/Materials/" + name)
    if mi is None:
        continue
    params = {}
    for kind in ("BaseColor", "Normal", "ORM"):
        t = unreal.MaterialEditingLibrary.get_material_instance_texture_parameter_value(mi, kind)
        params[kind] = t.get_path_name().split(".")[0] if t else None
    parent = mi.get_editor_property("parent")
    out["instances"][name] = {"parent": parent.get_path_name().split(".")[0] if parent else None, "textures": params,
                              "twoSided": bool(mi.get_editor_property("base_property_overrides").get_editor_property("two_sided"))}
parent = eal.load_asset("/Game/Characters/Hero/Materials/M_Hero")
out["parentParameters"] = sorted(str(n) for n in unreal.MaterialEditingLibrary.get_texture_parameter_names(parent)) if parent else None
open(os.path.join(proj, "materials.json"), "w").write(json.dumps(out))
"""


@pytest.mark.skipif(not EDITOR, reason="set JAM_UNREAL_EDITOR to an UnrealEditor-Cmd to import through a real editor")
def test_a_skinned_import_with_slots_keeps_its_materials_after_the_editor_exits(tmp_path):
    scratch_project(tmp_path)
    for role in ("Color", "Normal", "ORM"):
        shutil.copy(str(tmp_path / "Art" / ("T_Rock_%s.png" % role)), str(tmp_path / "Art" / ("T_Cloth_%s.png" % role)))
    maps = lambda stem: ",".join("Art/T_%s_%s.png" % (stem, role) for role in ("Color", "Normal", "ORM"))
    code, receipt, err = run_command(tmp_path, "engine_import.py", "--kind", "skinned", "Art/Hero.fbx", "--skeleton", "column", "--physics-asset", "none",
                                     "--slot", "Skin=" + maps("Rock"), "--slot", "Cloth=" + maps("Cloth"), "--two-sided", "Cloth")
    assert code == 0, err
    textures = ["/Game/Characters/Hero/Textures/T_%s_%s" % (stem, role) for stem in ("Rock", "Cloth") for role in ("Color", "Normal", "ORM")]
    assert [(a["id"], a["kind"], a.get("source")) for a in receipt["assets"]] == (
        [("/Game/Characters/Hero/Meshes/SK_Hero", "skeletal-mesh", "Art/Hero.fbx")]
        + [(t, "texture", "Art/" + t.rsplit("/", 1)[1] + ".png") for t in textures]
        + [("/Game/Characters/Hero/Materials/M_Hero", "material", None), ("/Game/Characters/Hero/Materials/MI_Skin", "material-instance", None),
           ("/Game/Characters/Hero/Materials/MI_Cloth", "material-instance", None)])

    # a new editor process finds the materials saved, on the mesh's slots, with their textures; the textures remember their files
    editor_script(tmp_path, MATERIALS, "materials.py")
    found = json.loads((tmp_path / "materials.json").read_text())
    assert found["slots"] == {"Skin": "/Game/Characters/Hero/Materials/MI_Skin", "Cloth": "/Game/Characters/Hero/Materials/MI_Cloth"}
    assert found["parentParameters"] == ["BaseColor", "Normal", "ORM"]
    for name, stem, two_sided in (("MI_Skin", "Rock", False), ("MI_Cloth", "Cloth", True)):
        assert found["instances"][name] == {"parent": "/Game/Characters/Hero/Materials/M_Hero", "twoSided": two_sided,
                                            "textures": {k: "/Game/Characters/Hero/Textures/T_%s_%s" % (stem, r) for k, r in (("BaseColor", "Color"), ("Normal", "Normal"), ("ORM", "ORM"))}}
    editor_script(tmp_path, STORED, "stored.py")
    stored = json.loads((tmp_path / "stored.json").read_text())
    assert {t: stored.get(t) for t in textures} == {t: ["Art/" + t.rsplit("/", 1)[1] + ".png"] for t in textures}
    assert stored.get("/Game/Characters/Hero/Meshes/SK_Hero") == ["Art/Hero.fbx"]
    code, receipt, err = run_command(tmp_path, "engine_check.py", "--kind", "sources", "/Game/Characters/Hero/Meshes/SK_Hero", *textures)
    assert code == 0 and receipt == {"problems": []}, err
