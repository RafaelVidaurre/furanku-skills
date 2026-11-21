"""Engine-free behaviour of the Unreal adapter: configuration, path mapping, receipts, transport, locks, hulls,
coverage, joints, machine-path scan and the commands' argument handling. No Unreal editor and no Blender is used."""
import ast
import glob
import json
import os
import subprocess
import sys

import pytest

from jam_unreal import config, coverage, hulls, joints, landmarks, locks, machine_paths, paths, receipts, transport
from jam_unreal.errors import AdapterError, Handoff

COMMANDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ADAPTER = os.path.join(COMMANDS, "..")


def project(tmp_path, local=None, facts=None):
    (tmp_path / "Game.uproject").write_text("{}")
    if facts is not None:
        (tmp_path / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": facts}}))
    if local is not None:
        (tmp_path / "jam.local.json").write_text(json.dumps({"engine": local}))
    return config.load(str(tmp_path), ADAPTER, environ={})


# ---- configuration
def test_project_facts_override_the_adapters_and_keep_the_rest(tmp_path):
    cfg = project(tmp_path, facts={"naming": {"skeletalMesh": "SKM_"}, "extra": {"destinations": {"static": "/Game/Props"}}})
    assert cfg.named("skeletalMesh", "Hero") == "SKM_Hero"
    assert cfg.named("staticMesh", "SM_Chair") == "SM_Chair"
    assert cfg.destination("static") == "/Game/Props"
    assert cfg.destination("audio", "/Game/Audio/") == "/Game/Audio"
    with pytest.raises(AdapterError, match="no content folder for audio"):
        cfg.destination("audio")


def test_skeleton_profile_merges_facts_and_details_and_names_unknown_ones(tmp_path):
    cfg = project(tmp_path, facts={"skeletons": {"mannequin": {"reference": "Art/.scratch/reference/SKM_Manny_Simple.fbx"}},
                                   "extra": {"skeletons": {"mannequin": {"skeleton": "/Game/Rigs/SK_Mannequin"}}}})
    profile = cfg.skeleton("mannequin")
    assert profile["skeleton"] == "/Game/Rigs/SK_Mannequin" and profile["reference"].endswith("SKM_Manny_Simple.fbx")
    assert profile["bones"]["upper-leg.l"] == "thigh_l" and profile["physicsAsset"].endswith("PA_Mannequin")
    assert cfg.default_skeleton() == "mannequin"
    with pytest.raises(AdapterError, match="known: mannequin"):
        cfg.skeleton("quadruped")


def test_machine_settings_come_from_the_local_file_or_the_toolkits_environment(tmp_path):
    assert project(tmp_path).transport == {"kind": "handoff"}
    cfg = project(tmp_path, local={"transport": {"kind": "command", "run": ["bridge"]}, "work": "Saved\\Jam"})
    assert cfg.transport["kind"] == "command" and cfg.work_dir == "Saved/Jam"
    from_env = config.load(str(tmp_path), ADAPTER, environ={"JAM_ENGINE_SETTINGS": json.dumps({"locks": "take"})})
    assert from_env.locks == "take"


def test_the_project_file_is_found_or_asked_for(tmp_path):
    cfg = project(tmp_path)
    assert cfg.uproject().endswith("Game.uproject")
    (tmp_path / "Other.uproject").write_text("{}")
    with pytest.raises(AdapterError, match="found 2"):
        cfg.uproject()


# ---- paths
FACTS = {"assetId": {"scheme": "/Game/{path}", "from": "Content/{path}.uasset"}}


def test_asset_ids_map_to_content_files_and_back():
    assert paths.asset_file("/Game/Props/Saloon/SM_Chair", FACTS) == "Content/Props/Saloon/SM_Chair.uasset"
    assert paths.asset_file("/Game/Props/SM_Chair.SM_Chair", FACTS) == "Content/Props/SM_Chair.uasset"
    assert paths.asset_from_file("Content/Maps/L_Main.umap", FACTS) == "/Game/Maps/L_Main"
    assert paths.asset_from_file("Content\\Props\\SM_Chair.uasset", FACTS) == "/Game/Props/SM_Chair"
    with pytest.raises(AdapterError):
        paths.asset_file("/Engine/BasicShapes/Cube", FACTS)
    with pytest.raises(AdapterError):
        paths.asset_file("/Game/../Secrets", FACTS)


@pytest.mark.parametrize("bad", ["C:/work/a.glb", "/abs/a.glb", "a\\b.glb", "../a.glb", "a/./b.glb", ""])
def test_stored_paths_must_be_project_relative(bad):
    with pytest.raises(AdapterError):
        paths.portable(bad)


def test_a_stored_source_is_made_relative_to_the_editors_project_or_refused():
    assert paths.project_relative("D:\\Game\\Art\\Assets\\chair\\v1\\model\\chair.glb", "D:/Game/") == "Art/Assets/chair/v1/model/chair.glb"
    assert paths.project_relative("Art/chair.glb", "/work/game") == "Art/chair.glb"
    with pytest.raises(AdapterError, match="outside the project"):
        paths.project_relative("C:/Users/someone/Desktop/chair.glb", "D:/Game/")
    with pytest.raises(AdapterError):
        paths.project_relative("../other/chair.glb", "/work/game")


def test_asset_names_and_ids_are_validated():
    assert paths.asset_id("/Game/Props/", "SM_Chair") == "/Game/Props/SM_Chair"
    for dest, name in (("/Game/Props", "SM Chair"), ("Game/Props", "SM_Chair"), ("/Game/Pro.ps", "SM_Chair")):
        with pytest.raises(AdapterError):
            paths.asset_id(dest, name)


# ---- receipts
def test_import_receipt_holds_the_contract_fields_only():
    receipt = receipts.import_receipt([receipts.asset("/Game/A/SM_A", "static-mesh", "Art/a.glb", "ab12"), receipts.asset("/Game/A/Materials/MI_A", "material-instance")])
    assert receipt == {"assets": [{"id": "/Game/A/SM_A", "kind": "static-mesh", "source": "Art/a.glb", "sha256": "ab12"},
                                  {"id": "/Game/A/Materials/MI_A", "kind": "material-instance"}]}
    with pytest.raises(AdapterError, match="twice"):
        receipts.import_receipt([receipts.asset("/Game/A/SM_A", "static-mesh")] * 2)


def test_inspect_receipt_converts_engine_units_to_metres_and_leaves_absent_facts_out():
    raw = {"id": "/Game/A/SM_A", "kind": "static-mesh", "boundsMin": [-50, -25, 0], "boundsMax": [50, 25, 90], "triangles": 1200, "vertices": 700,
           "materials": ["Wood"], "collision": {"box_elems": 0, "sphere_elems": 0, "sphyl_elems": 0, "convex_elems": 3}, "sections": 1, "unavailable": {}}
    assert receipts.inspect_receipt(raw, 100) == {
        "id": "/Game/A/SM_A", "kind": "static-mesh", "bounds": {"min": [-0.5, -0.25, 0.0], "max": [0.5, 0.25, 0.9]}, "pivot": [0.0, 0.0, 0.0],
        "triangles": 1200, "vertices": 700, "materials": ["Wood"], "collision": {"shapes": 3, "kinds": ["convex_elems"]}}
    skinned = receipts.inspect_receipt({"id": "/Game/C/SK_C", "kind": "skeletal-mesh", "skeleton": "/Game/M/SK_M", "bones": ["root", "pelvis"]}, 100)
    assert skinned == {"id": "/Game/C/SK_C", "kind": "skeletal-mesh", "skeleton": {"root": "root", "bones": ["root", "pelvis"]}}


# ---- transport
def editor_scripts():
    return sorted(glob.glob(os.path.join(COMMANDS, "editor", "*.py")))


@pytest.mark.parametrize("script", editor_scripts(), ids=os.path.basename)
def test_every_editor_script_composes_into_python_the_editor_can_run(script):
    with open(script, encoding="utf-8") as f:
        text = f.read()
    composed = transport.compose(text, {"asset": "/Game/A"})
    tree = compile(composed, script, "exec", flags=ast.PyCF_ONLY_AST | ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    assert isinstance(tree.body[-1], ast.Expr), "the last statement is the value a Python tool returns"
    if not transport.needs_await(text):
        compile(composed, script, "exec")   # a commandlet has no top-level await


def test_included_modules_are_pasted_and_stand_alone():
    with open(os.path.join(COMMANDS, "editor", "collision.py"), encoding="utf-8") as f:
        assert transport.includes(f.read()) == ["coverage"]
    for name in ("coverage", "editor_shared"):
        with open(os.path.join(COMMANDS, "jam_unreal", name + ".py"), encoding="utf-8") as f:
            assert "from ." not in f.read(), "an included module cannot import its package inside the editor"


SCRIPT = "def main(ARGS):\n    return {'echo': ARGS['value']}\n"


def step_file(tmp_path, text=SCRIPT):
    path = tmp_path / "echo.py"
    path.write_text(text)
    return transport.Step("echo", str(path), {"value": 7})


def test_handoff_prepares_the_script_then_collects_the_saved_result_once(tmp_path):
    cfg = project(tmp_path)
    step = step_file(tmp_path)
    with pytest.raises(Handoff) as raised:
        transport.run_steps(cfg, "import", [step])
    listed, = raised.value.receipt()["handoff"]["steps"]
    assert listed["done"] is False and os.path.isfile(tmp_path / listed["script"])
    namespace = {}
    exec(compile((tmp_path / listed["script"]).read_text().replace('ARGS.get("_resultFile")', "None"), "prepared", "exec"), namespace)
    assert json.loads(namespace["_jam_text"]) == {"echo": 7}
    (tmp_path / listed["result"]).write_text(json.dumps(namespace["_jam_text"]))   # the tool's returned text, saved as given
    assert transport.run_steps(cfg, "import", [step]) == [{"echo": 7}]
    with pytest.raises(Handoff):   # the result was consumed: the same call starts over
        transport.run_steps(cfg, "import", [step])


def test_command_transport_substitutes_the_script_and_reads_what_the_bridge_printed(tmp_path):
    cfg = project(tmp_path, local={"transport": {"kind": "command", "run": ["bridge", "--file", "{script}"]}})
    calls = []

    def runner(argv, cwd, timeout):
        calls.append(argv)
        return 0, "connecting...\n" + json.dumps({"echo": 7}) + "\n", ""
    assert transport.run_steps(cfg, "import", [step_file(tmp_path)], runner) == [{"echo": 7}]
    assert calls[0][:2] == ["bridge", "--file"] and calls[0][2].endswith(".py") and os.path.isabs(calls[0][2])


def test_an_editor_error_and_a_failed_bridge_are_reported_as_errors(tmp_path):
    cfg = project(tmp_path, local={"transport": {"kind": "command", "run": ["bridge"]}})
    with pytest.raises(AdapterError, match="failed in the editor: RuntimeError"):
        transport.run_steps(cfg, "import", [step_file(tmp_path)], lambda *a: (0, json.dumps({"error": "RuntimeError('texture missing')", "traceback": "..."}), ""))
    with pytest.raises(AdapterError, match="exited 2"):
        transport.run_steps(cfg, "import", [step_file(tmp_path)], lambda *a: (2, "", "connection refused"))


def test_scripts_that_wait_across_frames_are_refused_where_nothing_can_wait(tmp_path):
    waiting = step_file(tmp_path, "async def main(ARGS):\n    return {}\n")
    commandlet = project(tmp_path, local={"transport": {"kind": "commandlet", "editor": "UnrealEditor-Cmd"}})
    with pytest.raises(AdapterError, match="live editor"):
        transport.run_steps(commandlet, "collision", [waiting], lambda *a: (0, "", ""))
    plain = project(tmp_path, local={"transport": {"kind": "command", "run": ["bridge"]}})
    with pytest.raises(AdapterError, match="top-level await"):
        transport.run_steps(plain, "collision", [waiting], lambda *a: (0, "{}", ""))


def test_commandlet_runs_the_project_headless_and_reads_the_result_file(tmp_path):
    cfg = project(tmp_path, local={"transport": {"kind": "commandlet", "editor": "UnrealEditor-Cmd"}})
    seen = {}

    def runner(argv, cwd, timeout):
        seen["argv"] = argv
        script = argv[3][len("-script="):]
        with open(script.replace(".py", ".result.json"), "w") as f:
            json.dump({"echo": 7}, f)
        return 0, "", ""
    assert transport.run_steps(cfg, "check", [step_file(tmp_path)], runner) == [{"echo": 7}]
    assert seen["argv"][1].endswith("Game.uproject") and seen["argv"][2] == "-run=pythonscript" and "-nullrhi" in seen["argv"]


# ---- locks
def fake_git(ours=(), theirs=(), lock_ok=True, dirty=(), untracked=()):
    calls = []

    def git(project_dir, args):
        calls.append(args)
        if args[:2] == ["lfs", "locks"]:
            return 0, json.dumps({"ours": [{"path": p, "id": "1"} for p in ours], "theirs": [{"path": p, "owner": {"name": "ana"}} for p in theirs]}), ""
        if args[:2] == ["lfs", "lock"]:
            return (0, "", "") if lock_ok else (1, "", "lock refused")
        if args[0] == "ls-files":
            return (1, "", "") if args[-1] in untracked else (0, args[-1], "")
        if args[0] == "status":
            return 0, (" M " + args[-1]) if args[-1] in dirty else "", ""
        raise AssertionError(args)
    git.calls = calls
    return git


def content(tmp_path, *names):
    for name in names:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"asset")


def test_locks_are_taken_only_for_existing_files_this_user_does_not_hold(tmp_path):
    content(tmp_path, "Content/A.uasset", "Content/B.uasset")
    git = fake_git(ours=["Content/A.uasset"])
    assert locks.ensure(str(tmp_path), ["Content/A.uasset", "Content/B.uasset", "Content/New.uasset"], "take", git) == ["Content/B.uasset"]
    assert ["lfs", "lock", "Content/B.uasset"] in git.calls
    assert locks.ensure(str(tmp_path), ["Content/A.uasset"], "off", fake_git()) == []
    with pytest.raises(AdapterError, match="not locked by you"):
        locks.ensure(str(tmp_path), ["Content/B.uasset"], "check", fake_git())
    with pytest.raises(AdapterError, match="locked by ana"):
        locks.ensure(str(tmp_path), ["Content/B.uasset"], "take", fake_git(theirs=["Content/B.uasset"]))


def test_deleting_needs_an_owned_lock_on_a_committed_unchanged_file(tmp_path):
    content(tmp_path, "Content/A.uasset")
    locks.deletable(str(tmp_path), ["Content/A.uasset"], fake_git(ours=["Content/A.uasset"]))
    for git, message in ((fake_git(), "needs your own LFS lock"), (fake_git(ours=["Content/A.uasset"], dirty=["Content/A.uasset"]), "save and commit"),
                         (fake_git(ours=["Content/A.uasset"], untracked=["Content/A.uasset"]), "not tracked")):
        with pytest.raises(AdapterError, match=message):
            locks.deletable(str(tmp_path), ["Content/A.uasset"], git)


# ---- collision hulls and coverage
def test_hull_points_follow_the_spec_and_names_pair_with_the_mesh():
    spec = hulls.validate({"boxes": [[-1, -2, 0, 1, 2, 3]], "prisms": [[0, 0, 0.5, 0, 2, 16]], "hullBelow": 0.4})
    box, prism, low = hulls.shape_points(spec, [(0, 0, 0.1), (0, 0, 0.4), (0, 0, 0.5)])
    assert len(box) == 8 and hulls.bounds(box) == ([-1, -2, 0], [1, 2, 3])
    assert len(prism) == 32 and all(abs((x * x + y * y) ** 0.5 - 0.5) < 1e-9 for x, y, _ in prism) and {z for _, _, z in prism} == {0, 2}
    assert low == [(0, 0, 0.1), (0, 0, 0.4)]
    assert hulls.hull_names("SaloonBar", 1) == ["UCX_SaloonBar"]
    assert hulls.hull_names("SaloonBar", 3) == ["UCX_SaloonBar_01", "UCX_SaloonBar_02", "UCX_SaloonBar_03"]


@pytest.mark.parametrize("spec, message", [
    ({}, "no shape"), ({"boxes": [[0, 0, 0, 1, 1]]}, "boxes\\[0\\]"), ({"boxes": [[0, 0, 0, 1, 1, 0]]}, "not below"),
    ({"prisms": [[0, 0, 1, 0, 1, 2]]}, "at least 3 sides"), ({"boxes": [[0, 0, 0, 1, 1, 1]], "spheres": []}, "unknown"),
])
def test_a_wrong_collision_spec_names_its_fault(spec, message):
    with pytest.raises(hulls.SpecError, match=message):
        hulls.validate(spec)


def test_coverage_rule_from_the_jam():
    assert coverage.cover_cm(40) == 1.5 and coverage.cover_cm(100) == 2.0 and coverage.cover_cm(300) == 2.5
    assert coverage.covered({"covered": 0.98, "worst": 9.0})
    assert coverage.covered({"covered": 0.90, "worst": 4.5})          # fitted a little small all over: nothing is missing
    assert not coverage.covered({"covered": 0.90, "worst": 6.4})      # the pens in their cup stood 6.4 cm out
    assert not coverage.covered({"covered": 0.0, "worst": -1})        # no simple collision at all
    assert coverage.rule_with({"underfitCm": 2})["coveredShare"] == 0.98
    points = [(0, 0, 0), (10, 0, 0), (0, 20, 5), (3, 3, 3)]
    assert coverage.summarize([0.0, 3.0, 7.25, 1.0], points, 1.5) == {"covered": 0.5, "worst": 7.2, "gaps": [[0, 0, 0], [10, 20, 5]]}
    assert coverage.summarize([0.0, 1.0], points[:2], 1.5) == {"covered": 1.0, "worst": 0}


# ---- joints
def test_joint_comparison_is_relative_to_the_anchor_and_names_the_worst_bone():
    engine = {"Idle": {"character": {"0": {"pelvis": [0, 0, 100], "hand_l": [50, 0, 100], "head": [0, 0, 170]}}}}
    dcc = {"Idle": {"0": {"pelvis": [10, 0, 100], "hand_l": [60, 0, 104], "head": [10, 0, 170]}}}
    result = joints.compare(engine, dcc)
    assert result == {"Idle@0": {"maxDifference": 4.0, "worst": "hand_l", "all": {"pelvis": 0.0, "hand_l": 4.0, "head": 0.0}}}
    assert joints.problems(result, [1.0, 1.0, 1.0], 5) == []
    assert "hand_l" in joints.problems(result, [1.0, 1.0, 1.0], 3)[0]["message"]
    assert "scale" in joints.problems({}, [100.0, 100.0, 100.0], 5)[0]["message"]
    with pytest.raises(ValueError, match="no frame 0"):
        joints.compare(engine, {"Idle": {"7": {}}})


# ---- landmarks
def landmark_data(up="+Y"):
    marks = {name: [0.0, 1.0, 0.0] for name in landmarks.CENTRE}
    for name in landmarks.SIDED:
        marks[name + ".l"] = [0.2, 1.0, 0.1]
        marks[name + ".r"] = [-0.2, 1.0, 0.1]
    return {"units": "meters", "up": up, "landmarks": marks, "source": "test"}


def test_landmarks_are_translated_into_the_dcc_frame_and_validated():
    assert landmarks.to_dcc(landmark_data("+Y"))["hand.l"] == (0.2, -0.1, 1.0)     # glTF +Y up, +Z front -> Z up, front -Y
    assert landmarks.to_dcc(landmark_data("+Z"))["hand.l"] == (0.2, 1.0, 0.1)
    names = landmarks.anatomy_joints(landmarks.to_dcc(landmark_data()))
    assert names["thigh_l"] == (0.2, -0.1, 1.0) and names["spine_mid"] == (0.0, 0.0, 1.0) and "ball_r" in names
    broken = landmark_data()
    del broken["landmarks"]["toes.r"]
    with pytest.raises(landmarks.LandmarkError, match="toes.r"):
        landmarks.validate(broken)
    with pytest.raises(landmarks.LandmarkError, match="meters"):
        landmarks.validate(dict(landmark_data(), units="centimeters"))


def test_the_mannequin_profile_covers_every_canonical_landmark():
    with open(os.path.join(ADAPTER, "adapter.json"), encoding="utf-8") as f:
        bones = json.load(f)["facts"]["skeletons"]["mannequin"]["bones"]
    assert set(landmarks.REQUIRED) <= set(bones) <= set(landmarks.REQUIRED) | set(landmarks.FINGERS)
    assert bones["index-2.r"] == "index_02_r"


# ---- machine paths
def test_machine_paths_are_found_in_ascii_and_wide_text_and_engine_paths_are_not():
    data = b"\x00\x01/Game/Props/home/SM_Chair\x00/Script/Engine\x00" + "C:\\Users\\ana\\Art\\chair.fbx".encode("utf-16-le") + b"\x00\x00/Users/ana/proj/Art/chair.glb\x00http://example.com/a"
    assert machine_paths.find(data) == ["/Users/ana/proj/Art/chair.glb", "C:\\Users\\ana\\Art\\chair.fbx"]
    assert machine_paths.find(b"\x00../../Art/Assets/chair/v1/model/chair.glb\x00/Game/Props/SM_Chair\x00") == []
    # an Interchange node id stored in a skinned mesh imported by Unreal 5.9 is not a network share
    assert machine_paths.find(b"\x00Factory_\\\\SKMInstance\\\\LODContainer\\RootNode.Rig\\RootNode.BodyFactory_RootNode.Rig\x00") == []
    assert machine_paths.find(b"\x00\\\\server\\art\\chair.fbx\x00") == ["\\\\server\\art\\chair.fbx"]


# ---- commands, run as the toolkit runs them
def run_command(tmp_path, script, *args, local=None):
    env = dict(os.environ, JAM_PROJECT_ROOT=str(tmp_path), JAM_ENGINE_SETTINGS=json.dumps(local or {}))
    done = subprocess.run([sys.executable, os.path.join(COMMANDS, script), *args], cwd=str(tmp_path), capture_output=True, text=True, env=env)
    return done.returncode, json.loads(done.stdout), done.stderr


BRIDGE = """import json, sys
args = json.loads(open(sys.argv[1]).read().split("ARGS = json.loads(", 1)[1].split("\\n", 1)[0][:-1].strip("'\\"").encode().decode("unicode_escape"))
print(json.dumps(RESULTS[[k for k in RESULTS if k in sys.argv[1]][0]](args)))
"""


def bridge(tmp_path, results_source):
    path = tmp_path / "bridge.py"
    path.write_text("RESULTS = " + results_source + "\n" + BRIDGE)
    return {"transport": {"kind": "command", "run": [sys.executable, str(path), "{script}"]}}


def test_import_static_prints_the_receipt_with_source_and_digest(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    (tmp_path / "Art").mkdir()
    (tmp_path / "Art" / "saloon-chair.glb").write_bytes(b"glb")
    local = bridge(tmp_path, """{"import-static": lambda a: {"assets": [{"id": a["dest"] + "/" + a["name"], "kind": "static-mesh"},
        {"id": a["dest"] + "/Materials/MI_" + a["base"], "kind": "material-instance"}], "source": "Art/saloon-chair.glb", "projectDir": "/x", "unavailable": {}}}""")
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/saloon-chair.glb", "--dest", "/Game/Props/Saloon", "--name", "SaloonChair", local=local)
    assert code == 0
    assert receipt == {"assets": [
        {"id": "/Game/Props/Saloon/SM_SaloonChair", "kind": "static-mesh", "source": "Art/saloon-chair.glb", "sha256": paths.sha256(str(tmp_path / "Art" / "saloon-chair.glb"))},
        {"id": "/Game/Props/Saloon/Materials/MI_SaloonChair", "kind": "material-instance"}]}


def test_import_static_sends_no_scratch_folder_and_refuses_a_texture_that_remembers_a_file_outside_the_project(tmp_path):
    """The editor imports in place under the final names; a moved asset would resolve its source from its new folder."""
    (tmp_path / "Game.uproject").write_text("{}")
    (tmp_path / "Art").mkdir()
    (tmp_path / "Art" / "crate.glb").write_bytes(b"glb")
    local = bridge(tmp_path, """{"import-static": lambda a: {"assets": [{"id": a["dest"] + "/" + a["name"], "kind": "static-mesh"},
        {"id": a["dest"] + "/Textures/T_crate_Image", "kind": "texture"}], "source": "Art/crate.glb", "projectDir": "/p/Game/", "unavailable": {},
        "sources": {a["dest"] + "/" + a["name"]: "Art/crate.glb", a["dest"] + "/Textures/T_crate_Image": "/p/Art/crate.glb" if "scratch" in a else "/elsewhere/Art/crate.glb"}}}""")
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "static", "Art/crate.glb", "--dest", "/Game/Props", local=local)
    assert code == 1 and receipt["error"]["code"] == "machine-path" and "/elsewhere/Art/crate.glb" in receipt["error"]["message"]


def test_import_without_a_transport_hands_the_script_off_with_exit_3(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    (tmp_path / "take.wav").write_bytes(b"RIFF")
    code, receipt, err = run_command(tmp_path, "engine_import.py", "--kind", "audio", "--source", "take.wav", "--dest", "/Game/Audio/Sfx")
    assert code == 3 and receipt["error"]["code"] == "editor-handoff"
    step, = receipt["handoff"]["steps"]
    assert step["script"].startswith("Saved/JamEngine/import-audio-audio-") and "run" in err


def test_a_missing_source_and_a_machine_path_are_refused(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "audio", "--source", "nope.wav", "--dest", "/Game/Audio")
    assert code == 1 and receipt["error"]["code"] == "missing-source"
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "audio", "--source", "/tmp/take.wav", "--dest", "/Game/Audio")
    assert code == 1 and receipt["error"]["code"] == "invalid-path"


def test_skinned_import_orders_its_steps_and_checks_the_skeleton_it_landed_on(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    for name in ("hero.fbx", "c.png", "n.png", "m.png"):
        (tmp_path / name).write_bytes(name.encode())
    results = """{
      "import-skinned-textures": lambda a: {"textures": {t["name"]: {"id": a["dest"] + "/" + t["name"], "source": t["source"]} for t in a["textures"]}, "projectDir": "/x"},
      "import-skinned-materials": lambda a: {"parent": a["parent"], "instances": [i["id"] for i in a["instances"]]},
      "import-skinned-mesh": lambda a: {"id": a["dest"] + "/" + a["name"], "skeleton": %s, "source": a["source"], "projectDir": "/x"}}"""
    args = ("--kind", "skinned", "hero.fbx", "--name", "Hero", "--skeleton", "mannequin", "--dest", "/Game/Characters/Hero",
            "--slot", "M_Hero_Body=c.png,n.png,m.png", "--two-sided", "M_Hero_Body")
    code, receipt, _ = run_command(tmp_path, "engine_import.py", *args, local=bridge(tmp_path, results % 'a["skeleton"]'))
    assert code == 0
    assert [(a["id"], a["kind"]) for a in receipt["assets"]] == [
        ("/Game/Characters/Hero/Meshes/SK_Hero", "skeletal-mesh"), ("/Game/Characters/Hero/Textures/T_c", "texture"),
        ("/Game/Characters/Hero/Textures/T_n", "texture"), ("/Game/Characters/Hero/Textures/T_m", "texture"),
        ("/Game/Characters/Hero/Materials/M_Hero", "material"), ("/Game/Characters/Hero/Materials/MI_Hero_Body", "material-instance")]
    code, receipt, _ = run_command(tmp_path, "engine_import.py", *args, local=bridge(tmp_path, results % '"/Game/Other/SK_Other"'))
    assert code == 1 and receipt["error"]["code"] == "wrong-skeleton"


def test_the_toolkits_bare_call_takes_name_folder_and_skeleton_from_the_file_its_sidecar_and_the_project(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    (tmp_path / "jam.config.json").write_text(json.dumps({"engine": {"adapter": "unreal", "facts": {"extra": {"destinations": {"skinned": "/Game/Characters", "textures": "/Game/Tex"}}}}}))
    (tmp_path / "SK_Hero.fbx").write_bytes(b"fbx")
    (tmp_path / "SK_Hero.import.json").write_text(json.dumps({"skeleton": "mannequin"}))
    local = bridge(tmp_path, """{"import-skinned-mesh": lambda a: {"id": a["dest"] + "/" + a["name"], "skeleton": a["skeleton"], "source": a["source"], "projectDir": "/x", "slots": a["slots"]},
      "import-textures": lambda a: {"textures": {t["name"]: {"id": a["dest"] + "/" + t["name"], "role": t["role"]} for t in a["textures"]}, "projectDir": "/x"}}""")
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "skinned", "SK_Hero.fbx", local=local)
    assert code == 0 and [a["id"] for a in receipt["assets"]] == ["/Game/Characters/Hero/Meshes/SK_Hero"]
    for name in ("T_Hero_BaseColor.png", "T_Hero_Normal.png", "T_Hero_ORM.png"):
        (tmp_path / name).write_bytes(name.encode())
    details = tmp_path / "details.json"
    code, receipt, _ = run_command(tmp_path, "engine_import.py", "--kind", "textures", "T_Hero_BaseColor.png", "T_Hero_Normal.png", "T_Hero_ORM.png", "--details", "details.json", local=local)
    assert code == 0 and [a["id"] for a in receipt["assets"]] == ["/Game/Tex/T_Hero_BaseColor", "/Game/Tex/T_Hero_Normal", "/Game/Tex/T_Hero_ORM"]
    assert [t["role"] for t in json.loads(details.read_text())["textures"].values()] == ["color", "normal", "masks"]


def test_sources_check_reads_the_asset_files_of_this_checkout(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    content(tmp_path, "Content/Props/SM_Good.uasset")
    (tmp_path / "Content" / "Props" / "SM_Bad.uasset").write_bytes(b"\x00D:/work/jam/Art/chair.glb\x00")
    code, receipt, _ = run_command(tmp_path, "engine_check.py", "--kind", "sources", "/Game/Props/SM_Good", "/Game/Props/SM_Bad")
    assert code == 0 and len(receipt["problems"]) == 1 and "SM_Bad" in receipt["problems"][0]["message"]


def test_inspect_prints_metres(tmp_path):
    (tmp_path / "Game.uproject").write_text("{}")
    local = bridge(tmp_path, """{"inspect": lambda a: {"id": a["asset"], "kind": "static-mesh", "boundsMin": [-30, -30, 0], "boundsMax": [30, 30, 90], "triangles": 500, "unavailable": {}}}""")
    code, receipt, _ = run_command(tmp_path, "engine_inspect.py", "/Game/Props/SM_Barrel.SM_Barrel", local=local)
    assert code == 0 and receipt == {"id": "/Game/Props/SM_Barrel", "kind": "static-mesh", "bounds": {"min": [-0.3, -0.3, 0.0], "max": [0.3, 0.3, 0.9]}, "pivot": [0.0, 0.0, 0.0], "triangles": 500}


def test_a_program_returns_when_it_exits_even_while_a_helper_it_started_keeps_its_output_open(tmp_path):
    # The editor starts helpers (a trace server) that inherit its output and outlive it.
    helper = "import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)']); print('done')"
    started = __import__("time").monotonic()
    code, out, _ = transport._run([sys.executable, "-c", helper], str(tmp_path), 60)
    assert (code, out.strip()) == (0, "done")
    assert __import__("time").monotonic() - started < 10


def test_the_editor_writes_its_result_where_the_adapter_reads_it_when_the_uproject_is_not_at_the_root(tmp_path):
    (tmp_path / "apps" / "client").mkdir(parents=True)
    (tmp_path / "apps" / "client" / "Game.uproject").write_text("{}")
    (tmp_path / "jam.local.json").write_text(json.dumps({"engine": {"project": "apps/client/Game.uproject"}}))
    cfg = config.load(str(tmp_path), ADAPTER, environ={})
    script = tmp_path / "s.py"
    script.write_text("def main(ARGS):\n    return {}\n")
    prepared = transport.prepare(cfg, "verb", transport.Step("step", str(script), {}))
    written = os.path.normpath(os.path.join(tmp_path, "apps", "client", *json.loads(prepared["text"].split("ARGS = json.loads(", 1)[1].split("\n", 1)[0][:-1].strip("'\"").encode().decode("unicode_escape"))["_resultFile"].split("/")))
    assert written == os.path.normpath(os.path.join(tmp_path, *prepared["result"].split("/")))
