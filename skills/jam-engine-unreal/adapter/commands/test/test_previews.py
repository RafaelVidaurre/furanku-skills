"""Previews: what each package gets, what is made again, how a stopped editor is survived, the thumbnails stored in
packages, and the rendering launch. The editor is a stand-in that writes files; what the real editor makes was
checked live (docs/validation.md)."""
import json
import os
import struct

import pytest

from jam_unreal import inventory, previews, thumbnails, transport
from jam_unreal.errors import AdapterError, Handoff

from test_adapter import run_command
from test_inventory import fixture_project

GLB_WITH_MESH = b"glTF"
JPEG = b"\xff\xd8\xff\xe0jpeg"


def glb(meshes):
    body = json.dumps({"asset": {"version": "2.0"}, "meshes": [{}] * meshes}).encode()
    body += b" " * (-len(body) % 4)
    return b"glTF" + struct.pack("<II", 2, 20 + len(body)) + struct.pack("<II", len(body), 0x4E4F534A) + body


class Editor:
    """Writes what the real editor would for each job; `stop_at` makes the process stop before that package."""

    def __init__(self, fail=(), stop_at=None):
        self.calls, self.fail, self.stop_at = [], set(fail), stop_at

    def __call__(self, cfg, verb, steps, render=False):
        (_, script, args), = steps
        assert (verb, script, render) == ("previews", "previews", True)
        self.calls.append([job["path"] for job in args["jobs"]])
        results = []
        for job in args["jobs"]:
            if job["path"] == self.stop_at:
                self.stop_at = None
                raise AdapterError("transport-failed", "UnrealEditor-Cmd exited 139")
            if job["path"] in self.fail:
                result = {"path": job["path"], "error": "glTF export failed", "seconds": 0.1}
            else:
                data = {"texture": b"\x89PNG\r\n\x1a\npng", "wav": b"RIFF", "actor": glb(0)}.get(job["method"], glb(1))
                with open(job["file"], "wb") as f:
                    f.write(data)
                result = {"path": job["path"], "seconds": 0.2}
            results.append(result)
            with open(args["progress"], "a") as f:
                f.write(json.dumps(result) + "\n")
        return [{"results": results}]


def scanned(tmp_path):
    cfg = fixture_project(tmp_path)
    found, _ = inventory.scan(cfg)
    return cfg, found


def engine_jobs(found):
    """Project paths of the packages the editor makes previews of, in the order it is sent them."""
    return sorted(path for path, entry in found["files"].items() if previews.METHODS.get(previews.main_class(entry)))


def blueprints(found):
    return sum(1 for entry in found["files"].values() if previews.main_class(entry) == "/Script/Engine.Blueprint")


def make(cfg, found, editor, **options):
    run = previews.Previews(cfg, found, "Saved/previews", editor=editor, **options)
    jobs = run.plan()
    run.save()
    if jobs:
        run.run(jobs)
        run.write_details()
    return run.receipt(), previews.read_index(os.path.join(cfg.project, "Saved", "previews", "index.json"))


def test_each_class_gets_its_preview_named_by_the_packages_version(tmp_path):
    cfg, found = scanned(tmp_path)
    editor = Editor()
    receipt, index = make(cfg, found, editor)
    texture = index["Content/Fixture/Textures/T_Crate.uasset"]
    assert texture == {"version": found["files"]["Content/Fixture/Textures/T_Crate.uasset"]["hash"], "file": texture["version"] + ".png",
                       "kind": "image", "how": "the texture's source image"}
    mesh = index["Content/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.uasset"]
    assert (mesh["kind"], mesh["how"], mesh["file"].endswith(".glb")) == ("model", "glTF export, materials baked", True)
    assert index["Content/Fixture/Materials/MI_Crate.uasset"]["kind"] == "model"
    assert index["Plugins/FixtureKit/Content/Icons/T_Icon.uasset"]["kind"] == "image"
    # An actor Blueprint with no component to show: the export is refused, not shown empty.
    assert index["Content/Fixture/Blueprints/BP_Crate.uasset"]["failed"] == "the export holds no mesh: nothing to show"
    assert "Content/Fixture/PAL_Fixture.uasset" not in index     # no preview for its class, and none stored
    # The fixtures' Blueprints place no mesh; the label and the data assets get no preview for their class.
    assert (receipt["made"], receipt["failed"], receipt["waiting"]) == (5, blueprints(found), 0)
    assert receipt["none"] == len(found["files"]) - len(engine_jobs(found))
    assert receipt["previews"] == 5 and receipt["editorSeconds"]["gltf"]["packages"] == 3
    assert sorted(os.listdir(tmp_path / "Saved" / "previews")) == sorted(["index.json"] + [e["file"] for e in index.values() if "file" in e])
    assert len(editor.calls) == 1
    with open(tmp_path / "Saved" / "JamEngine" / "previews-last-run.json") as f:
        assert len(json.load(f)) == len(engine_jobs(found))


def test_only_packages_whose_version_changed_are_made_again_and_old_files_go(tmp_path):
    cfg, found = scanned(tmp_path)
    make(cfg, found, Editor())
    old = previews.read_index(str(tmp_path / "Saved" / "previews" / "index.json"))["Content/Fixture/Textures/T_Crate.uasset"]["file"]
    editor = Editor()
    receipt, _ = make(cfg, found, editor)
    assert editor.calls == [] and (receipt["reused"], receipt["failed"], receipt["made"]) == (5, blueprints(found), 0)
    found["files"]["Content/Fixture/Textures/T_Crate.uasset"]["hash"] = "ab" * 20
    receipt, index = make(cfg, found, editor)
    assert editor.calls == [["Content/Fixture/Textures/T_Crate.uasset"]] and receipt["made"] == 1
    assert index["Content/Fixture/Textures/T_Crate.uasset"]["file"] == "ab" * 20 + ".png"
    assert not os.path.exists(tmp_path / "Saved" / "previews" / old)
    editor = Editor()
    receipt, _ = make(cfg, found, editor, full=True, only=["Content/Fixture/Materials/**"])
    assert editor.calls == [["Content/Fixture/Materials/MI_Crate.uasset", "Content/Fixture/Materials/M_Base.uasset"]]
    assert receipt["previews"] == 5, "packages outside --only keep their previews"


def test_a_version_without_a_hash_is_size_and_time_as_javascript_prints_them():
    assert previews.version({"size": 10, "mtimeMs": 1794917000000.0}) == "10:1794917000000"
    assert previews.version({"size": 10, "mtimeMs": 1794917000000.25}) == "10:1794917000000.25"
    assert previews.file_stem("10:1794917000000.25") == "10-1794917000000.25"
    assert previews.glob("Content/**/T_*").match("Content/A/B/T_X.uasset") and not previews.glob("Content/*/T_*").match("Content/A/B/T_X.uasset")


def test_stored_thumbnails_stand_in_without_the_engine_and_give_way_to_it(tmp_path, monkeypatch):
    cfg, found = scanned(tmp_path)
    stored = "Content/Fixture/Materials/MI_Crate.uasset"
    monkeypatch.setattr(previews, "main_thumbnail", lambda path, main: ("jpg", JPEG) if path.endswith(os.path.join("Materials", "MI_Crate.uasset")) else None)
    editor = Editor()
    receipt, index = make(cfg, found, editor, engine=False)
    assert editor.calls == [] and (receipt["waiting"], receipt["made"], receipt["previews"]) == (len(engine_jobs(found)), 1, 1)
    assert index[stored]["how"] == "the thumbnail stored in the package" and index[stored]["kind"] == "image"
    receipt, _ = make(cfg, found, editor, engine=False)
    assert receipt["reused"] == 1, "without the engine a stored thumbnail is as good as it gets"
    receipt, index = make(cfg, found, editor, limit=2)
    assert len(editor.calls[0]) == 2 and receipt["waiting"] == len(engine_jobs(found)) - 2
    receipt, index = make(cfg, found, Editor(fail=[stored]))
    assert index[stored]["how"] == "glTF export, materials baked" or index[stored]["failed"] == "glTF export failed"


def test_a_failed_export_keeps_the_stored_thumbnail_and_is_not_tried_again_for_that_version(tmp_path, monkeypatch):
    cfg, found = scanned(tmp_path)
    stored = "Content/Fixture/Materials/MI_Crate.uasset"
    monkeypatch.setattr(previews, "main_thumbnail", lambda path, main: ("jpg", JPEG) if path.endswith(os.path.join("Materials", "MI_Crate.uasset")) else None)
    _, index = make(cfg, found, Editor(fail=[stored]))
    assert (index[stored]["how"], index[stored]["failed"]) == ("the thumbnail stored in the package", "glTF export failed")
    editor = Editor()
    make(cfg, found, editor)
    assert editor.calls == []


def test_an_editor_that_stops_costs_only_the_package_it_was_on(tmp_path, monkeypatch):
    cfg, found = scanned(tmp_path)
    monkeypatch.setattr(previews, "BATCH", 4)
    jobs = engine_jobs(found)
    editor = Editor(stop_at=jobs[2])
    receipt, index = make(cfg, found, editor)
    assert index[jobs[2]]["failed"].startswith("the editor stopped while making it: UnrealEditor-Cmd exited 139")
    assert all(path in index for path in jobs[:2]), "what it finished before stopping is kept"
    assert (receipt["made"] + receipt["failed"], receipt["waiting"]) == (len(jobs), 0)
    assert editor.calls[0] == jobs[:4] and editor.calls[1][0] == jobs[3], "the next process carries on after the package it was on"
    assert sum(len(call) for call in editor.calls) == len(jobs) + 1


def test_without_a_transport_the_scripts_are_handed_off_and_the_index_keeps_what_is_done(tmp_path):
    cfg, found = scanned(tmp_path)
    inventory.write(cfg, "Saved/inventory.json", found)
    code, printed, _ = run_command(tmp_path, "engine_previews.py", "--inventory", "Saved/inventory.json", "--out", "Saved/previews")
    assert code == 3 and printed["handoff"]["steps"][0]["name"] == "previews"
    with open(tmp_path / "Saved" / "previews" / "index.json") as f:
        assert json.load(f)["adapter"] == "unreal"
    code, printed, _ = run_command(tmp_path, "engine_previews.py", "--inventory", "Saved/inventory.json", "--out", "Saved/previews", "--no-engine")
    assert code == 0 and printed["waiting"] == len(engine_jobs(found)) and printed["index"] == "Saved/previews/index.json"


# ---- stored thumbnails
def test_packages_saved_by_a_commandlet_store_no_thumbnail(tmp_path):
    cfg, found = scanned(tmp_path)
    for path, entry in found["files"].items():
        assert thumbnails.stored_thumbnails(os.path.join(cfg.project, path)) == {}, path


def test_the_thumbnail_table_gives_each_objects_image_and_skips_empty_ones(tmp_path, monkeypatch):
    def fstring(text):
        data = text.encode("latin-1") + b"\0"
        return struct.pack("<i", len(data)) + data
    image = JPEG + b"rest"
    body = struct.pack("<ii", 64, -64) + struct.pack("<i", len(image)) + image    # JPEG: negative height
    empty = struct.pack("<ii", 0, 0)
    head = b"\0" * 16
    table_at = len(head) + len(body) + len(empty)
    table = struct.pack("<i", 2) + fstring("StaticMesh") + fstring("SM_A") + struct.pack("<i", len(head)) \
        + fstring("Texture2D") + fstring("T_B") + struct.pack("<i", len(head) + len(body))
    path = tmp_path / "SM_A.uasset"
    path.write_bytes(head + body + empty + table)
    monkeypatch.setattr(thumbnails, "_summary", lambda r: {"thumbnail_offset": table_at})
    assert thumbnails.stored_thumbnails(str(path)) == {"SM_A": ("jpg", image)}
    assert thumbnails.main_thumbnail(str(path), "/Game/SM_A.SM_A") == ("jpg", image)


# ---- the rendering launch
def test_a_script_that_renders_starts_the_commandlet_with_a_renderer_off_screen():
    args = ["-unattended", "-nullrhi", "-stdout", "-DisablePlugins=X"]
    assert transport.commandlet_args({"args": args}, False) == args
    assert transport.commandlet_args({"args": args}, True) == ["-unattended", "-stdout", "-DisablePlugins=X", "-AllowCommandletRendering", "-RenderOffscreen"]
    assert transport.commandlet_args({"args": args, "renderArgs": ["-x"]}, True) == ["-x"]
    assert "-nullrhi" not in transport.commandlet_args({}, True)


def test_the_commandlet_route_passes_the_rendering_launch(tmp_path):
    cfg, _ = scanned(tmp_path)
    cfg.local = {"transport": {"kind": "commandlet", "editor": "UnrealEditor-Cmd"}, "project": "Fixture.uproject"}
    seen = {}

    def runner(argv, cwd, timeout):
        seen["argv"] = argv
        script = argv[3][len("-script="):]
        with open(script.replace(".py", ".result.json"), "w") as f:
            json.dump({"results": []}, f)
        return 0, "", ""
    step = transport.Step("previews", os.path.join(os.path.dirname(previews.__file__), "..", "editor", "previews.py"), {"jobs": []}, render=True)
    assert transport.run_steps(cfg, "previews", [step], runner) == [{"results": []}]
    assert "-nullrhi" not in seen["argv"] and "-AllowCommandletRendering" in seen["argv"]


def test_a_handoff_is_raised_after_the_index_is_saved(tmp_path):
    cfg, found = scanned(tmp_path)

    def editor(*_args, **_kw):
        raise Handoff([{"name": "previews", "script": "x.py", "result": "x.result.json", "await": False, "done": False}])
    with pytest.raises(Handoff):
        make(cfg, found, editor)
    assert os.path.isfile(tmp_path / "Saved" / "previews" / "index.json")
