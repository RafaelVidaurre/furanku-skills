"""Tests for skeleton derivation."""

import json
import random
from pathlib import Path

import skeleton

FIXTURE = Path(__file__).parent / "fixtures" / "build" / "scan.json"


def make_scan(units, files, edges=(), externals=()):
    return {
        "schema": "codemap.scan/1",
        "repo": {"root": "/r", "ref": "HEAD", "sha": "f" * 40, "branch": "main"},
        "scanned_at": "2026-09-22T00:00:00Z",
        "units": [{"id": u, "path": p, "kind": "package", "name": u} for u, p in units],
        "files": [{"path": path, "lang": "ts", "loc": loc, "unit": unit} for path, loc, unit in files],
        "edges": [{"from": a, "to": b, "specifier": b, "line": line} for a, b, line in edges],
        "externals": list(externals),
        "unresolved": [],
    }


def module_map(result):
    return {m["id"]: [f["path"] for f in m["files"]] for m in result["modules"]}


def test_src_root_detected_and_root_module_named_after_unit():
    scan = make_scan(
        [("pkg", "packages/pkg")],
        [
            ("packages/pkg/index.ts", 5, "pkg"),
            ("packages/pkg/src/index.ts", 10, "pkg"),
            ("packages/pkg/src/a/one.ts", 10, "pkg"),
            ("packages/pkg/src/a/two.ts", 10, "pkg"),
            ("packages/pkg/src/b/deep/nested/three.ts", 10, "pkg"),
            ("packages/pkg/src/b/four.ts", 10, "pkg"),
            ("packages/pkg/test/pkg.test.ts", 10, "pkg"),
            ("packages/pkg/test/helpers.ts", 10, "pkg"),
        ],
    )
    result = skeleton.skeleton(scan)
    assert result["schema"] == "codemap.skeleton/1"
    modules = module_map(result)
    assert modules == {
        "pkg/a": ["packages/pkg/src/a/one.ts", "packages/pkg/src/a/two.ts"],
        "pkg/b": ["packages/pkg/src/b/deep/nested/three.ts", "packages/pkg/src/b/four.ts"],
        "pkg/root": ["packages/pkg/index.ts", "packages/pkg/src/index.ts"],
        "pkg/test": ["packages/pkg/test/helpers.ts", "packages/pkg/test/pkg.test.ts"],
    }
    by_id = {m["id"]: m for m in result["modules"]}
    assert by_id["pkg/root"]["name"] == "pkg" and by_id["pkg/root"]["path"] == "packages/pkg/src"
    assert by_id["pkg/a"]["path"] == "packages/pkg/src/a"
    assert by_id["pkg/test"]["path"] == "packages/pkg/test"
    assert result["components"][0]["modules"] == ["pkg/a", "pkg/b", "pkg/root", "pkg/test"]
    assert by_id["pkg/a"]["files"][0]["exports"] == []


def test_without_src_directory_first_level_dirs_become_modules():
    scan = make_scan(
        [("app", "apps/app")],
        [
            ("apps/app/main.ts", 5, "app"),
            ("apps/app/views/a.ts", 5, "app"),
            ("apps/app/views/b.ts", 5, "app"),
            ("apps/app/util/only.ts", 5, "app"),
            ("apps/app/src/one.ts", 5, "app"),  # src exists but holds a minority
        ],
    )
    modules = module_map(skeleton.skeleton(scan))
    assert modules == {
        "app/root": ["apps/app/main.ts"],
        "app/src": ["apps/app/src/one.ts"],
        "app/util": ["apps/app/util/only.ts"],
        "app/views": ["apps/app/views/a.ts", "apps/app/views/b.ts"],
    }


def test_more_than_sixteen_modules_merge_by_imports_never_into_a_catch_all():
    files, edges = [], []
    for i in range(20):
        files.append((f"lib/d{i:02d}/a.ts", 100 + i, "lib"))
        files.append((f"lib/d{i:02d}/b.ts", 1, "lib"))
    files.append(("lib/index.ts", 5, "lib"))
    # five merges bring 21 groups to 16: each small directory joins the neighbour it imports; d03 is linked only from the entry file
    edges = [("lib/d00/a.ts", "lib/d10/a.ts", 1), ("lib/d01/a.ts", "lib/d11/a.ts", 1), ("lib/d02/a.ts", "lib/d10/a.ts", 1),
             ("lib/d04/a.ts", "lib/d12/a.ts", 1), ("lib/d05/a.ts", "lib/d12/a.ts", 2), ("lib/index.ts", "lib/d03/a.ts", 1)]
    result = skeleton.skeleton(make_scan([("lib", "lib")], files, edges))
    mods = {m["id"]: m for m in result["modules"]}
    assert len(mods) == 16 and not any(i.endswith("/other") for i in mods)
    assert mods["lib/d10"]["merged"] == ["d00", "d02"] and mods["lib/d10"]["name"] == "d10 + 2 more"
    assert mods["lib/d11"]["merged"] == ["d01"] and mods["lib/d12"]["merged"] == ["d04"]
    assert mods["lib/root"]["merged"] == ["d03"]  # linked only through the entry file, so it joins root
    assert {f["path"] for f in mods["lib/d10"]["files"]} >= {"lib/d00/a.ts", "lib/d02/b.ts"}


def test_metrics_edges_and_cycles():
    scan = make_scan(
        [("a", "a"), ("b", "b"), ("c", "c")],
        [
            ("a/x/1.ts", 10, "a"), ("a/x/2.ts", 20, "a"), ("a/y/3.ts", 5, "a"), ("a/y/4.ts", 5, "a"),
            ("b/m/1.ts", 7, "b"), ("b/m/2.ts", 7, "b"),
            ("c/n/1.ts", 3, "c"), ("c/n/2.ts", 3, "c"),
        ],
        edges=[
            ("a/x/1.ts", "a/y/3.ts", 1), ("a/y/3.ts", "a/x/2.ts", 2),  # module cycle inside a
            ("a/x/1.ts", "b/m/1.ts", 3), ("a/x/2.ts", "b/m/1.ts", 4), ("a/x/2.ts", "b/m/2.ts", 5), ("a/y/4.ts", "b/m/2.ts", 6),
            ("b/m/1.ts", "c/n/1.ts", 1),
            ("a/x/1.ts", "a/x/2.ts", 9),  # same module: ignored
            ("a/x/1.ts", "missing.ts", 1),  # unknown target: ignored
        ],
        externals=[{"name": "lodash", "count": 3, "files": ["a/x/1.ts", "a/y/3.ts", "b/m/1.ts"]}, {"name": "zod", "count": 1, "files": ["a/x/1.ts"]}],
    )
    result = skeleton.skeleton(scan)
    comp = {c["id"]: c for c in result["components"]}
    assert comp["a"]["metrics"] == {"files": 4, "loc": 40, "fan_in": 0, "fan_out": 1, "instability": 1.0, "in_cycle": False, "changes": 0}
    assert comp["b"]["metrics"] == {"files": 2, "loc": 14, "fan_in": 1, "fan_out": 1, "instability": 0.5, "in_cycle": False, "changes": 0}
    assert comp["c"]["metrics"]["instability"] == 0.0
    mods = {m["id"]: m for m in result["modules"]}
    assert mods["a/x"]["metrics"]["in_cycle"] and mods["a/y"]["metrics"]["in_cycle"]
    assert not mods["b/m"]["metrics"]["in_cycle"]
    assert mods["c/n"]["metrics"]["instability"] == 0.0
    assert result["cycles"] == {"components": [], "modules": [["a/x", "a/y"]]}
    ab = next(e for e in result["edges"]["components"] if e["from"] == "a" and e["to"] == "b")
    assert ab["count"] == 4
    assert ab["examples"] == ["a/x/1.ts:3 → b/m/1.ts", "a/x/2.ts:4 → b/m/1.ts", "a/x/2.ts:5 → b/m/2.ts"]
    assert [(e["from"], e["to"], e["count"]) for e in result["edges"]["modules"]] == [
        ("a/x", "a/y", 1), ("a/x", "b/m", 3), ("a/y", "a/x", 1), ("a/y", "b/m", 1), ("b/m", "c/n", 1)]
    assert result["externals"] == {"a": [{"name": "lodash", "count": 2}, {"name": "zod", "count": 1}], "b": [{"name": "lodash", "count": 1}]}


def test_isolated_component_has_null_instability_and_unknown_unit_is_synthesised():
    scan = make_scan([("a", "a")], [("a/one.ts", 1, "a"), ("a/two.ts", 1, "a"), ("stray/x.ts", 2, "")])
    scan["units"][0]["hints"] = {"executable": True, "server_libs": ["axum"]}
    result = skeleton.skeleton(scan)
    ids = [c["id"] for c in result["components"]]
    assert ids == ["a", "stray"]
    assert result["components"][0]["metrics"]["instability"] is None
    assert module_map(result)["stray/root"] == ["stray/x.ts"]
    # Hints pass through; a unit without a hints block (or a synthesised one) gets neutral defaults.
    assert result["components"][0]["hints"] == {**skeleton.EMPTY_HINTS, "executable": True, "server_libs": ["axum"]}
    assert result["components"][1]["hints"] == skeleton.EMPTY_HINTS


def test_output_is_deterministic_under_input_shuffling():
    scan = json.loads(FIXTURE.read_text())
    first = json.dumps(skeleton.skeleton(scan), sort_keys=True)
    rng = random.Random(7)
    for key in ("files", "edges", "units", "externals"):
        rng.shuffle(scan[key])
    assert json.dumps(skeleton.skeleton(scan), sort_keys=True) == first


def test_cli_writes_skeleton(tmp_path):
    out = tmp_path / "skeleton.json"
    assert skeleton.main(["--scan", str(FIXTURE), "--output", str(out)]) == 0
    assert json.loads(out.read_text())["schema"] == "codemap.skeleton/1"


def test_test_only_edges_are_kept_but_do_not_form_cycles():
    scan_doc = {
        "units": [{"id": "a", "path": "a", "kind": "package"}, {"id": "b", "path": "b", "kind": "package"}],
        "files": [
            {"path": "a/src/x.ts", "lang": "ts", "loc": 1, "role": "source", "unit": "a"},
            {"path": "a/test/x.test.ts", "lang": "ts", "loc": 1, "role": "test", "unit": "a"},
            {"path": "b/src/y.ts", "lang": "ts", "loc": 1, "role": "source", "unit": "b"},
        ],
        "edges": [
            {"from": "a/src/x.ts", "to": "b/src/y.ts", "specifier": "b", "line": 1},
            {"from": "a/test/x.test.ts", "to": "b/src/y.ts", "specifier": "b", "line": 2},
            {"from": "b/src/y.ts", "to": "a/test/x.test.ts", "specifier": "../a", "line": 3},
        ],
    }
    doc = skeleton.skeleton(scan_doc)
    file_roles = {f["path"]: f["test"] for module in doc["modules"] for f in module["files"]}
    assert file_roles == {"a/src/x.ts": False, "a/test/x.test.ts": True, "b/src/y.ts": False}
    edges = {(e["from"], e["to"]): e for e in doc["edges"]["components"]}
    assert edges[("a", "b")]["count"] == 1 and edges[("a", "b")]["test_count"] == 1
    assert edges[("a", "b")]["test_only"] is False
    assert edges[("a", "b")]["examples"] == ["a/src/x.ts:1 → b/src/y.ts"]
    assert edges[("b", "a")]["count"] == 1 and edges[("b", "a")]["test_only"] is False
    assert doc["cycles"]["components"] == [["a", "b"]]
    # Make the reverse edge test-only: the cycle disappears and fan-in ignores it.
    scan_doc["edges"][2]["from"] = "b/tests/y.test.ts"
    scan_doc["files"].append({"path": "b/tests/y.test.ts", "lang": "ts", "loc": 1, "role": "test", "unit": "b"})
    doc = skeleton.skeleton(scan_doc)
    edges = {(e["from"], e["to"]): e for e in doc["edges"]["components"]}
    assert edges[("b", "a")]["test_only"] is True and edges[("b", "a")]["count"] == 0
    assert doc["cycles"]["components"] == []
    assert doc["components"][0]["metrics"]["fan_in"] == 0


def test_display_name_drops_package_scope():
    assert skeleton.display_name({"id": "world-renderer", "name": "@ue-mmo/world-renderer"}) == "world-renderer"
    assert skeleton.display_name({"id": "sim-core", "name": "sim-core"}) == "sim-core"
    assert skeleton.display_name({"id": "tools", "name": ""}) == "tools"


def test_flat_root_splits_by_file_stem_and_test_modules_are_marked():
    files = [(f"crates/sim/src/{stem}.rs", 100, "sim") for stem in ("lib", "step", "world", "rules", "items", "death")]
    files += [("crates/sim/src/combat/mod.rs", 50, "sim"), ("crates/sim/src/combat/melee.rs", 50, "sim"), ("crates/sim/src/combat.rs", 20, "sim")]
    files += [("crates/sim/tests/a.rs", 40, "sim"), ("crates/sim/tests/b.rs", 40, "sim")]
    scan = make_scan([("sim", "crates/sim")], files)
    for f in scan["files"]:
        f["role"] = "test" if "/tests/" in f["path"] else "source"
        f["changes"] = 2 if f["path"].endswith("step.rs") else 0
    result = skeleton.skeleton(scan)
    mods = {m["id"]: m for m in result["modules"]}
    # entry files stay in root; each other root file is its own module; combat.rs joins combat/
    assert module_map(result)["sim/root"] == ["crates/sim/src/lib.rs"]
    assert {"sim/step", "sim/world", "sim/rules", "sim/items", "sim/death"} <= set(mods)
    assert sorted(module_map(result)["sim/combat"]) == ["crates/sim/src/combat.rs", "crates/sim/src/combat/melee.rs", "crates/sim/src/combat/mod.rs"]
    assert mods["sim/step"]["metrics"]["changes"] == 2
    assert [m["id"] for m in result["modules"] if m["test"]] == ["sim/tests"]
    assert mods["sim/step"]["root_file"] and mods["sim/root"]["root_file"] and not mods["sim/tests"]["root_file"]
    assert result["components"][0]["metrics"]["changes"] == 2


def test_small_or_minor_root_does_not_split():
    files = [("p/src/a.ts", 10, "p"), ("p/src/b.ts", 10, "p"), ("p/src/x/1.ts", 100, "p"), ("p/src/x/2.ts", 100, "p")]
    result = skeleton.skeleton(make_scan([("p", "p")], files))
    assert set(module_map(result)) == {"p/root", "p/x"}


def test_an_oversized_module_splits_along_its_folders_under_generic_ones():
    files = [("svc/src/app/auth/a%02d.ts" % i, 10, "svc") for i in range(40)]
    files += [("svc/src/app/users/u%02d.ts" % i, 10, "svc") for i in range(40)]
    files += [("svc/src/app/app.module.ts", 5, "svc"), ("svc/src/main.ts", 5, "svc")]
    result = skeleton.skeleton(make_scan([("svc", "svc")], files))
    mods = {m["id"]: m for m in result["modules"]}
    assert {"svc/app/auth", "svc/app/users"} <= set(mods)
    assert mods["svc/app/auth"]["name"] == "auth" and len(mods["svc/app/auth"]["files"]) == 40
    assert max(len(m["files"]) for m in result["modules"]) <= skeleton.LARGE_MODULE_FILES
