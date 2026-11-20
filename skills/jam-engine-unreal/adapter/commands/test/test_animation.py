"""Animation import (`engine_import.py --kind animation`): what the adapter reads from a clip without the engine, the
arguments it sends the editor and the receipt it prints. The last test runs a real headless editor and is skipped
unless JAM_UNREAL_EDITOR names an UnrealEditor-Cmd (5.8 or later):

    JAM_UNREAL_EDITOR=<path to UnrealEditor-Cmd> python3 -m pytest <this file> -rs

The clips in fixtures/animation/ are made by fixtures/animation/make_clips.py in Blender.
"""
import json
import os
import shutil
import struct
import subprocess
import sys

import pytest

from jam_unreal import gltf, paths, receipts
from jam_unreal.errors import AdapterError

COMMANDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "animation")
EDITOR = os.environ.get("JAM_UNREAL_EDITOR")


def glb(path, doc):
    text = json.dumps(doc).encode("utf-8")
    text += b" " * (-len(text) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", gltf.GLB_MAGIC, 2, 20 + len(text)) + struct.pack("<II", len(text), gltf.JSON_CHUNK) + text)
    return path


def test_a_clip_names_its_skinned_joints_and_animations():
    assert gltf.clip_facts(os.path.join(FIXTURES, "two.glb")) == {"joints": ["root", "hips", "spine"], "animations": ["Bow", "Wave"]}
    assert gltf.clip_facts(os.path.join(FIXTURES, "wrong.glb"))["joints"] == ["root", "hips", "chest"]


@pytest.mark.parametrize("doc, message", [
    ({"nodes": [{"name": "a"}], "skins": [{"joints": [0]}]}, "holds no animation"),
    ({"nodes": [{"name": "a"}], "animations": [{"name": "Walk"}]}, "holds no skin"),
    ({"nodes": [{}], "skins": [{"joints": [0]}], "animations": [{}]}, "joint node 0 has no name"),
])
def test_a_file_that_cannot_be_a_clip_is_refused(tmp_path, doc, message):
    with pytest.raises(AdapterError, match=message):
        gltf.clip_facts(glb(str(tmp_path / "a.glb"), doc))
    (tmp_path / "b.glb").write_bytes(b"not a glb at all, just text")
    with pytest.raises(AdapterError, match="not a glTF binary"):
        gltf.clip_facts(str(tmp_path / "b.glb"))


def test_an_animation_receipt_names_the_skeleton_each_sequence_plays_on():
    assert receipts.asset("/Game/A/AS_Walk", "animation-sequence", "Art/walk.glb", "ab", "/Game/A/SKEL_Hero") == {
        "id": "/Game/A/AS_Walk", "kind": "animation-sequence", "source": "Art/walk.glb", "sha256": "ab", "skeleton": "/Game/A/SKEL_Hero"}


# ---- the command, with a fake editor bridge
def run_command(tmp_path, *args, local=None):
    env = dict(os.environ, JAM_PROJECT_ROOT=str(tmp_path), JAM_ENGINE_SETTINGS=json.dumps(local or {}))
    done = subprocess.run([sys.executable, os.path.join(COMMANDS, "engine_import.py"), *args], cwd=str(tmp_path), capture_output=True, text=True, env=env)
    return done.returncode, json.loads(done.stdout), done.stderr


BRIDGE = """import json, sys
args = json.loads(open(sys.argv[1]).read().split("ARGS = json.loads(", 1)[1].split("\\n", 1)[0][:-1].strip("'\\"").encode().decode("unicode_escape"))
open(sys.argv[2], "w").write(json.dumps(args))
print(json.dumps({"assets": [{"id": args["dest"] + "/" + args["name"] + n, "skeleton": "/Game/Hero/SKEL_Hero", "source": args["source"]} for n in NAMES],
                  "other": [], "projectDir": "/x", "saved": SAVED}))
"""


def project(tmp_path, names, saved=True):
    (tmp_path / "Game.uproject").write_text("{}")
    (tmp_path / "Art").mkdir()
    for name in ("clip.glb", "two.glb"):
        shutil.copy(os.path.join(FIXTURES, name), str(tmp_path / "Art" / name))
    bridge = tmp_path / "bridge.py"
    bridge.write_text("NAMES = %r\nSAVED = %r\n%s" % (names, saved, BRIDGE))
    return {"transport": {"kind": "command", "run": [sys.executable, str(bridge), "{script}", str(tmp_path / "sent.json")]}}


def test_animation_import_sends_the_clip_joints_target_and_name_and_lists_each_sequence(tmp_path):
    local = project(tmp_path, [""])
    code, receipt, _ = run_command(tmp_path, "--kind", "animation", "Art/clip.glb", "--target", "/Game/Hero/SK_Hero.SK_Hero", "--destination", "/Game/Hero/Animations", "--name", "HeroWave",
                                   "--run", "hero-wave", local=local)
    assert code == 0
    assert receipt == {"assets": [{"id": "/Game/Hero/Animations/AS_HeroWave", "kind": "animation-sequence", "source": "Art/clip.glb",
                                   "sha256": paths.sha256(str(tmp_path / "Art" / "clip.glb")), "skeleton": "/Game/Hero/SKEL_Hero"}]}
    sent = json.loads((tmp_path / "sent.json").read_text())
    assert {k: sent[k] for k in ("source", "target", "joints", "dest", "name", "planned", "run")} == {
        "source": "Art/clip.glb", "target": "/Game/Hero/SK_Hero", "joints": ["root", "hips", "spine"], "dest": "/Game/Hero/Animations", "name": "AS_HeroWave",
        "planned": ["/Game/Hero/Animations/AS_HeroWave"], "run": "hero-wave"}


def test_a_sequence_the_editor_did_not_save_fails_the_import(tmp_path):
    local = project(tmp_path, [""], saved=False)
    code, receipt, _ = run_command(tmp_path, "--kind", "animation", "Art/clip.glb", "--target", "/Game/Hero/SK_Hero", "--destination", "/Game/A", local=local)
    assert code == 1 and receipt["error"]["code"] == "save-failed" and "/Game/A/AS_clip" in receipt["error"]["message"]


class _ImportData:
    def __init__(self, names):
        self.names = names

    def extract_filenames(self):
        return self.names


class _Asset:
    def __init__(self, names, run=None):
        self.data = _ImportData(names)
        self.tags = {} if run is None else {"jam.run": run}

    def get_editor_property(self, name):
        assert name == "asset_import_data"
        return self.data


class _EditorAssetLibrary:
    """What the editor's library does with metadata tags: an absent tag reads as an empty string."""
    @staticmethod
    def get_metadata_tag(asset, tag):
        return asset.tags.get(tag, "")

    @staticmethod
    def set_metadata_tag(asset, tag, value):
        asset.tags[tag] = value

    @staticmethod
    def remove_metadata_tag(asset, tag):
        asset.tags.pop(tag, None)


@pytest.fixture
def editor_shared(monkeypatch):
    import types
    from jam_unreal import editor_shared
    monkeypatch.setitem(sys.modules, "unreal", types.SimpleNamespace(EditorAssetLibrary=_EditorAssetLibrary))
    return editor_shared


def test_a_sequence_is_replaced_only_by_a_clip_from_its_own_source_file_or_its_own_run(tmp_path, editor_shared):
    """The editor script refuses, before importing, to replace a sequence another file made (CO7), unless an earlier
    attempt of the same run made it: a run's second attempt imports from <run>/2/ what its first imported from <run>/1/."""
    project_dir = str(tmp_path)
    at = lambda *parts: os.path.join(project_dir, *parts)
    refuse = editor_shared.jam_refuse_other_source
    refuse("/Game/A/AS_walk", _Asset([at("work", "walk", "1", "walk.glb")]), "work/walk/1/walk.glb", None, project_dir)
    refuse("/Game/A/AS_walk", _Asset([at("work", "walk", "1", "walk.glb")], run="walk"), "work/walk/2/walk.glb", "walk", project_dir)
    first, second = "work/walk/1/walk.glb", "work/walk/2/walk.glb"
    for asset, source, run, message in (
        (_Asset([at("work", "run", "1", "walk.glb")]), first, None, "imported from work/run/1/walk.glb, not from work/walk/1/walk.glb:"),
        (_Asset([]), first, None, "imported from a file it does not remember, not from work/walk/1/walk.glb:"),
        # another run, or no run, never replaces what a run imported; nor does a run replace an import made outside one
        (_Asset([at(*first.split("/"))], run="walk"), second, "walk-fast", "imported from work/walk/1/walk.glb by run walk, not from work/walk/2/walk.glb by run walk-fast:"),
        (_Asset([at(*first.split("/"))], run="walk"), second, None, "imported from work/walk/1/walk.glb by run walk, not from work/walk/2/walk.glb:"),
        (_Asset([at("Art", "walk.glb")]), second, "walk", "imported from Art/walk.glb, not from work/walk/2/walk.glb by run walk:"),
    ):
        with pytest.raises(RuntimeError, match="AS_walk exists, " + message.replace(".", "[.]")):
            refuse("/Game/A/AS_walk", asset, source, run, project_dir)


def test_an_import_records_its_run_on_the_sequence_and_one_outside_a_run_clears_it(editor_shared):
    asset = _Asset([], run="walk")
    editor_shared.jam_mark_run(asset, "walk-fast")
    assert editor_shared.jam_asset_run(asset) == "walk-fast"
    editor_shared.jam_mark_run(asset, None)
    assert editor_shared.jam_asset_run(asset) is None


def test_joints_are_compared_under_the_names_unreal_gives_bones(tmp_path):
    """Unreal's importers write "_" for characters an object name cannot hold: the joint foot.l is the bone foot_l."""
    assert gltf.unreal_name("upper-arm.l") == "upper-arm_l" and gltf.unreal_name("Hips") == "Hips"
    local = project(tmp_path, [""])
    glb(str(tmp_path / "Art" / "dotted.glb"), {"nodes": [{"name": "hips"}, {"name": "foot.l"}], "skins": [{"joints": [0, 1]}], "animations": [{"name": "Step"}]})
    code, _, _ = run_command(tmp_path, "--kind", "animation", "Art/dotted.glb", "--target", "/Game/Hero/SK_Hero", "--destination", "/Game/A", local=local)
    assert code == 0 and json.loads((tmp_path / "sent.json").read_text())["joints"] == ["hips", "foot_l"]


def test_the_folder_comes_from_the_project_and_the_name_from_the_file(tmp_path):
    local = project(tmp_path, ["Bow", "Wave"])
    (tmp_path / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": {"extra": {"destinations": {"animation": "/Game/Anims"}}}}}))
    code, receipt, _ = run_command(tmp_path, "--kind", "animation", "Art/two.glb", "--target", "/Game/Hero/SKEL_Hero", local=local)
    assert code == 0 and [a["id"] for a in receipt["assets"]] == ["/Game/Anims/AS_twoBow", "/Game/Anims/AS_twoWave"]


@pytest.mark.parametrize("args, message", [
    (["Art/clip.glb"], "needs --target"),
    (["Art/clip.glb", "Art/two.glb", "--target", "/Game/H/SKEL_H"], "exactly one clip"),
    (["Art/walk.fbx", "--target", "/Game/H/SKEL_H"], "from a .glb file"),
    (["Art/clip.glb", "--target", "/Game/H/SKEL_H"], "no content folder for animation"),
])
def test_what_an_animation_import_refuses(tmp_path, args, message):
    local = project(tmp_path, [""])
    (tmp_path / "Art" / "walk.fbx").write_bytes(b"fbx")
    code, receipt, _ = run_command(tmp_path, "--kind", "animation", *args, local=local)
    assert code == 1 and message in receipt["error"]["message"]


# ---- a real editor
UPROJECT = {"FileVersion": 3, "Plugins": [{"Name": "PythonScriptPlugin", "Enabled": True}, {"Name": "Interchange", "Enabled": True}, {"Name": "InterchangeEditor", "Enabled": True}]}
IMPORT_MESH = """import os, unreal
proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
t = unreal.AssetImportTask(); t.filename = os.path.join(proj, "Art", "mesh.glb"); t.destination_path = "/Game/Hero"; t.automated = True; t.save = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([t])
"""


@pytest.mark.skipif(not EDITOR, reason="set JAM_UNREAL_EDITOR to an UnrealEditor-Cmd to import through a real editor")
def test_a_real_editor_imports_a_clip_onto_an_existing_skeleton_and_refuses_one_on_another(tmp_path):
    """Also: a run's later attempt replaces its own sequence, read back from the saved asset by a new editor process."""
    (tmp_path / "Game.uproject").write_text(json.dumps(UPROJECT))
    (tmp_path / "Art").mkdir()
    for name in ("mesh.glb", "clip.glb", "two.glb", "wrong.glb"):
        shutil.copy(os.path.join(FIXTURES, name), str(tmp_path / "Art" / name))
    (tmp_path / "import_mesh.py").write_text(IMPORT_MESH)
    with open(str(tmp_path / "editor.log"), "w") as log:
        subprocess.run([EDITOR, str(tmp_path / "Game.uproject"), "-run=pythonscript", "-script=" + str(tmp_path / "import_mesh.py"),
                        "-unattended", "-nosplash", "-nullrhi", "-stdout"], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, timeout=900)
    meshes = [os.path.join(d, f) for d, _, files in os.walk(str(tmp_path / "Content")) for f in files if f.endswith(".uasset")]
    skeleton = next("/Game/" + os.path.relpath(m, str(tmp_path / "Content"))[:-len(".uasset")] for m in meshes if m.endswith("_Skeleton.uasset"))
    local = {"transport": {"kind": "commandlet", "editor": EDITOR}}
    args = ("--target", skeleton, "--destination", "/Game/Hero/Animations")
    for _ in range(2):   # a second import of the same clip keeps its id
        code, receipt, err = run_command(tmp_path, "--kind", "animation", "Art/clip.glb", "--name", "Wave", "--details", "details.json", *args, local=local)
        assert code == 0, err
        assert [(a["id"], a["skeleton"], a["source"]) for a in receipt["assets"]] == [("/Game/Hero/Animations/AS_Wave", skeleton, "Art/clip.glb")]
    details = json.loads((tmp_path / "details.json").read_text())["assets"][0]
    assert (details["frames"], details["fps"], details["seconds"]) == (30, 30.0, 1.0)
    # another file never replaces it, even with the same bytes
    shutil.copy(str(tmp_path / "Art" / "clip.glb"), str(tmp_path / "Art" / "clip-again.glb"))
    code, receipt, _ = run_command(tmp_path, "--kind", "animation", "Art/clip-again.glb", "--name", "Wave", *args, local=local)
    assert code == 1 and "AS_Wave exists, imported from Art/clip.glb, not from Art/clip-again.glb" in receipt["error"]["message"]
    # a later attempt of the same run replaces what an earlier attempt imported; another run, or no run, does not
    for attempt in ("1", "2"):
        (tmp_path / "work" / "walk" / attempt).mkdir(parents=True)
        shutil.copy(str(tmp_path / "Art" / "clip.glb"), str(tmp_path / "work" / "walk" / attempt / "clip.glb"))
    for source, run in (("work/walk/1/clip.glb", "walk"), ("work/walk/2/clip.glb", "walk")):
        code, receipt, err = run_command(tmp_path, "--kind", "animation", source, "--name", "Walk", "--run", run, *args, local=local)
        assert code == 0, err
        assert [(a["id"], a["source"]) for a in receipt["assets"]] == [("/Game/Hero/Animations/AS_Walk", source)]
    for run in (("--run", "walk-fast"), ()):
        code, receipt, _ = run_command(tmp_path, "--kind", "animation", "work/walk/1/clip.glb", "--name", "Walk", *run, *args, local=local)
        assert code == 1 and "AS_Walk exists, imported from work/walk/2/clip.glb by run walk, not from work/walk/1/clip.glb" in receipt["error"]["message"]
    code, receipt, err = run_command(tmp_path, "--kind", "animation", "Art/two.glb", "--name", "Hero", *args, local=local)
    assert code == 0, err
    assert [a["id"] for a in receipt["assets"]] == ["/Game/Hero/Animations/AS_HeroBow", "/Game/Hero/Animations/AS_HeroWave"]
    assert (tmp_path / "Content" / "Hero" / "Animations" / "AS_HeroBow.uasset").is_file()
    code, receipt, _ = run_command(tmp_path, "--kind", "animation", "Art/wrong.glb", *args, local=local)
    assert code == 1 and "lacks the clip's bones chest" in receipt["error"]["message"]
