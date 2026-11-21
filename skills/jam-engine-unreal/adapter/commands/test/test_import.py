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


@pytest.mark.skipif(not EDITOR, reason="set JAM_UNREAL_EDITOR to an UnrealEditor-Cmd to import through a real editor")
def test_every_import_kind_leaves_its_assets_remembering_the_project_file(tmp_path):
    (tmp_path / "Game.uproject").write_text(json.dumps(UPROJECT))
    shutil.copytree(FIXTURES, str(tmp_path / "Art"))
    knock(str(tmp_path / "Art" / "Knock.wav"))
    editor_script(tmp_path, SKELETON, "skeleton.py")
    (tmp_path / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": {"skeletons": {"column": {"label": "column"}}, "extra": {
        "destinations": {"static": "/Game/Props", "skinned": "/Game/Characters", "textures": "/Game/Textures", "audio": "/Game/Audio"},
        "skeletons": {"column": {"skeleton": "/Game/Base/Hero_Skeleton", "root": "root"}}}}}}))

    # two props whose own material and image names collide land side by side under their own names
    for prop in ("Crate", "Stool"):
        code, receipt, err = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/%s.glb" % prop)
        assert code == 0, err
        assert receipt["assets"][0] == {"id": "/Game/Props/SM_" + prop, "kind": "static-mesh", "source": "Art/%s.glb" % prop, "sha256": receipt["assets"][0]["sha256"]}
        assert [(a["id"], a["kind"]) for a in receipt["assets"][1:]] == [
            ("/Game/Props/Textures/T_%s_Image" % prop, "texture"), ("/Game/Props/Materials/MI_" + prop, "material-instance")]
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/Crate.glb")
    assert code == 1 and "/Game/Props/SM_Crate, /Game/Props/Textures/T_Crate_Image, /Game/Props/Materials/MI_Crate exist" in receipt["error"]["message"]
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
                "/Game/Textures/T_Rock_Color": ["Art/T_Rock_Color.png"], "/Game/Textures/T_Rock_Normal": ["Art/T_Rock_Normal.png"], "/Game/Textures/T_Rock_ORM": ["Art/T_Rock_ORM.png"],
                "/Game/Audio/Knock": ["Art/Knock.wav"], "/Game/Characters/Hero/Meshes/SK_Hero": ["Art/Hero.fbx"]}
    assert {k: stored.get(k) for k in expected} == expected
    assert not [k for k in stored if k.startswith("/Game/Props/") and k not in expected]   # nothing left in a scratch folder
    code, receipt, err = run_command(tmp_path, "engine_check.py", "--kind", "sources", *sorted(expected))
    assert code == 0 and receipt == {"problems": []}, err
