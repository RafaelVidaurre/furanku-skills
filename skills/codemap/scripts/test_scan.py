"""Tests for scan.py. Hermetic: git runs with HOME and config pinned to a temp dir."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scan  # noqa: E402

FIXTURES = HERE / "fixtures" / "scan"
NOW = "2026-01-01T00:00:00Z"


@pytest.fixture(autouse=True)
def hermetic_git(tmp_path_factory, monkeypatch):
    home = tmp_path_factory.mktemp("home")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(home / "gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_AUTHOR_NAME", "t")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "t@example.invalid")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "t")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "t@example.invalid")


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True).stdout


def make_repo(tmp_path: Path, fixture: str | None = None, extra: dict[str, str] | None = None) -> Path:
    root = tmp_path / "repo"
    if fixture:
        shutil.copytree(FIXTURES / fixture, root)
    else:
        root.mkdir()
    for rel, content in (extra or {}).items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    return root


def edges_from(doc: dict, src: str) -> list[tuple[str, str, int]]:
    return [(e["to"], e["specifier"], e["line"]) for e in doc["edges"] if e["from"] == src]


def unit_index(doc: dict) -> dict[str, dict]:
    return {u["id"]: u for u in doc["units"]}


# ---------------------------------------------------------------------------
# pnpm monorepo
# ---------------------------------------------------------------------------

def test_pnpm_monorepo_units_and_resolution(tmp_path):
    root = make_repo(tmp_path, "pnpm-monorepo", {
        "packages/core/node_modules/left-pad/index.js": "module.exports = 1;\n",
        "apps/web/dist/bundle.js": "console.log(1);\n",
    })
    doc = scan.scan(root, now=NOW)

    assert doc["schema"] == "codemap.scan/1"
    assert doc["repo"]["branch"] == "main"
    assert doc["repo"]["ref"] == "HEAD"
    assert len(doc["repo"]["sha"]) == 40
    assert doc["repo"]["remote"] is None
    assert doc["scanned_at"] == NOW

    units = unit_index(doc)
    assert {u: units[u]["kind"] for u in units} == {
        "core": "package", "ui": "package", "web": "app", "tools": "directory", "root": "directory",
    }
    assert units["core"]["name"] == "@acme/core"
    assert units["core"]["description"] == "Core domain logic"
    assert units["core"]["readme"] == "packages/core/README.md"
    assert units["core"]["manifest"] == "packages/core/package.json"
    assert units["root"]["path"] == ""
    assert units["web"]["hints"] == {
        "executable": True, "wasm": False, "server_libs": [], "client_libs": ["electron", "three", "vite"],
        "desktop": True, "test_libs": ["vitest"], "directory_kind": None, "test_file_share": 0.0,
    }
    assert units["ui"]["hints"]["client_libs"] == ["react"]  # observed external, no manifest dependency
    assert units["tools"]["hints"]["directory_kind"] == "tools" and units["tools"]["hints"]["executable"] is False
    assert units["core"]["hints"] == dict(scan.EMPTY_HINTS)

    paths = [f["path"] for f in doc["files"]]
    assert paths == sorted(paths)
    assert not any("node_modules" in p or "/dist/" in p for p in paths)
    by_path = {f["path"]: f for f in doc["files"]}
    assert by_path["index.js"]["unit"] == "root"
    assert by_path["tools/check.mjs"] == {"path": "tools/check.mjs", "lang": "js", "loc": 4, "role": "source", "unit": "tools", "changes": 1}
    assert by_path["apps/web/src/main.ts"]["lang"] == "ts"

    assert edges_from(doc, "apps/web/src/main.ts") == [
        ("packages/core/src/index.ts", "@acme/core", 2),          # workspace bare name -> exports "."
        ("packages/core/src/util.ts", "@acme/core/util", 3),      # workspace subpath -> exports "./util"
        ("apps/web/src/view.ts", "./view.js", 4),                 # .js -> .ts swap
        ("apps/web/src/lib/index.ts", "./lib", 5),                # index probing
        ("packages/ui/src/button.ts", "@shared/button", 6),       # tsconfig paths via extends
        ("apps/web/src/types.ts", "./types", 11),                 # import type
        ("apps/web/src/multi.ts", "./multi", 12),                 # multi-line import, start line
        ("packages/core/src/index.ts", "@acme/core", 17),         # export ... from
        ("apps/web/src/view.ts", "./view.js", 18),                # export * from
        ("apps/web/src/lazy.ts", "./lazy", 20),                   # import()
        ("apps/web/src/legacy.cjs", "./legacy.cjs", 21),          # require()
    ]
    assert edges_from(doc, "tools/check.mjs") == [("packages/core/src/index.ts", "../packages/core/src/index.ts", 3)]
    assert edges_from(doc, "packages/ui/src/button.ts") == [("packages/core/src/index.ts", "@acme/core", 1)]

    assert doc["unresolved"] == [{"from": "apps/web/src/main.ts", "specifier": "./missing", "line": 10}]
    assert doc["externals"] == [
        {"name": "chalk", "count": 1, "files": ["tools/check.mjs"]},
        {"name": "react", "count": 1, "files": ["packages/ui/src/button.ts"]},
        {"name": "three", "count": 1, "files": ["apps/web/src/main.ts"]},
    ]
    assert doc["skipped"] == {"json": 7, "md": 1, "yaml": 1}


# ---------------------------------------------------------------------------
# cargo workspace
# ---------------------------------------------------------------------------

def test_cargo_workspace(tmp_path):
    root = make_repo(tmp_path, "cargo-workspace", {"target/debug/server.rs": "fn main() {}\n"})
    doc = scan.scan(root, now=NOW)

    units = unit_index(doc)
    assert {u: units[u]["kind"] for u in units} == {"server": "crate", "sim-core": "crate"}
    assert units["sim-core"]["description"] == "Simulation core"
    assert units["sim-core"]["manifest"] == "crates/sim-core/Cargo.toml"
    assert all(f["path"].startswith("crates/") for f in doc["files"])
    assert units["server"]["hints"] == {
        "executable": True, "wasm": False, "server_libs": ["tokio"], "client_libs": [], "desktop": False,
        "test_libs": [], "directory_kind": None, "test_file_share": 0.5,
    }
    assert units["sim-core"]["hints"]["wasm"] is True and units["sim-core"]["hints"]["executable"] is False

    assert edges_from(doc, "crates/sim-core/src/lib.rs") == [
        ("crates/sim-core/src/tick.rs", "mod tick", 2),
        ("crates/sim-core/src/world/mod.rs", "mod world", 3),
        ("crates/sim-core/src/tick.rs", "tick::Tick", 5),
        ("crates/sim-core/src/world/mod.rs", "world::World", 6),
    ]
    assert edges_from(doc, "crates/sim-core/src/world/mod.rs") == [
        ("crates/sim-core/src/world/grid.rs", "mod grid", 1),
        ("crates/sim-core/src/world/grid.rs", "grid::Grid", 3),
    ]
    assert edges_from(doc, "crates/sim-core/src/world/grid.rs") == [
        ("crates/sim-core/src/world/mod.rs", "super::WorldError", 1),
        ("crates/sim-core/src/tick.rs", "crate::tick::Tick", 2),
        ("crates/sim-core/src/lib.rs", "crate::{Tick as T2, world::World}", 3),
        ("crates/sim-core/src/world/mod.rs", "crate::{Tick as T2, world::World}", 3),
        # `use super::*` inside `mod tests {}` is the file itself and is dropped;
        # `super::super::` from there reaches the parent module.
        ("crates/sim-core/src/world/mod.rs", "super::super::World as W", 19),
    ]
    assert edges_from(doc, "crates/server/src/main.rs") == [
        ("crates/sim-core/src/lib.rs", "sim_core::{Tick, World}", 1),
        ("crates/server/src/handlers.rs", "mod handlers", 4),
    ]
    assert edges_from(doc, "crates/server/src/handlers.rs") == [
        ("crates/sim-core/src/lib.rs", "sim_core::world::World", 1),
        ("crates/server/src/main.rs", "crate::main", 2),
    ]
    assert edges_from(doc, "crates/server/tests/integration.rs") == [
        ("crates/server/tests/common/mod.rs", "mod common", 1),
        ("crates/server/tests/common/mod.rs", "common::setup", 3),
        ("crates/sim-core/src/lib.rs", "sim_core::Tick", 5),
    ]
    assert [e["name"] for e in doc["externals"]] == ["serde", "serde_json", "tokio"]
    assert doc["unresolved"] == []


# ---------------------------------------------------------------------------
# python package
# ---------------------------------------------------------------------------

def test_python_package(tmp_path):
    root = make_repo(tmp_path, "python-package")
    doc = scan.scan(root, now=NOW)

    units = unit_index(doc)
    assert {u: units[u]["kind"] for u in units} == {"geo": "python", "scripts": "directory", "tools": "directory"}
    assert units["geo"]["name"] == "geo"
    assert units["geo"]["description"] == "Geometry helpers"
    assert units["geo"]["readme"] == "libs/geo/README.md"
    assert units["geo"]["hints"]["test_libs"] == ["hypothesis", "pytest"]  # optional-dependencies count only as harness
    assert units["geo"]["hints"]["server_libs"] == []
    assert units["scripts"]["hints"]["directory_kind"] == "tools"

    geo = "libs/geo/src/geo/"
    assert edges_from(doc, geo + "__init__.py") == [
        (geo + "base.py", ".base import Point", 1),
        (geo + "util.py", ". import util", 2),
    ]
    assert edges_from(doc, geo + "util.py") == [
        (geo + "base.py", ".base import Point", 2),
        (geo + "shapes/__init__.py", ".shapes import Circle", 3),
        (geo + "shapes/polygon.py", ".shapes.polygon import Polygon", 4),
        (geo + "base.py", "geo.base import Point", 5),
    ]
    assert edges_from(doc, geo + "shapes/__init__.py") == [
        (geo + "base.py", "..base import Point", 1),
        (geo + "shapes/polygon.py", ".polygon", 2),
    ]
    assert edges_from(doc, geo + "shapes/polygon.py") == []
    assert edges_from(doc, "scripts/run.py") == [
        (geo + "shapes/__init__.py", "geo.shapes", 2),
        (geo + "util.py", "geo import util", 3),
        ("tools/gltf/__init__.py", "tools.gltf import read_glb", 4),
    ]
    assert edges_from(doc, "tools/helper.py") == [
        ("tools/gltf/__init__.py", "gltf", 1),
        ("tools/gltf/__init__.py", "gltf import read_glb", 2),
    ]
    assert doc["externals"] == [
        {"name": "numpy", "count": 1, "files": [geo + "util.py"]},
        {"name": "requests", "count": 1, "files": ["scripts/run.py"]},
    ]
    assert doc["unresolved"] == []


# ---------------------------------------------------------------------------
# cross-cutting rules
# ---------------------------------------------------------------------------

def test_unit_id_collision_prefixes_parent_and_oversize_files_skip(tmp_path):
    root = make_repo(tmp_path, extra={
        "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
        "apps/core/package.json": '{"name": "core-app"}',
        "apps/core/src/a.ts": "export const a = 1;\n",
        "packages/core/package.json": '{"name": "@x/core"}',
        "packages/core/src/b.ts": "export const b = 1;\n",
        "packages/core/src/huge.ts": "// " + "x" * (2 * 1024 * 1024) + "\n",
    })
    doc = scan.scan(root, now=NOW)
    assert [(u["id"], u["path"]) for u in doc["units"]] == [
        ("apps-core", "apps/core"), ("packages-core", "packages/core"),
    ]
    assert [f["path"] for f in doc["files"]] == ["apps/core/src/a.ts", "packages/core/src/b.ts"]
    assert doc["skipped"]["(oversize)"] == 1


def test_deepest_manifest_wins_and_self_imports_drop(tmp_path):
    root = make_repo(tmp_path, extra={
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n  - packages/outer/nested\n",
        "packages/outer/package.json": '{"name": "outer"}',
        "packages/outer/src/index.ts": 'import "./index";\nimport { n } from "nested";\n',
        "packages/outer/nested/package.json": '{"name": "nested", "main": "index.ts"}',
        "packages/outer/nested/index.ts": "export const n = 1;\n",
    })
    doc = scan.scan(root, now=NOW)
    by_path = {f["path"]: f["unit"] for f in doc["files"]}
    assert by_path == {"packages/outer/nested/index.ts": "nested", "packages/outer/src/index.ts": "outer"}
    assert doc["edges"] == [
        {"from": "packages/outer/src/index.ts", "to": "packages/outer/nested/index.ts", "specifier": "nested", "line": 2},
    ]


def test_scan_is_deterministic(tmp_path):
    root = make_repo(tmp_path, "pnpm-monorepo")
    first = scan.dumps(scan.scan(root, now=NOW))
    second = scan.dumps(scan.scan(root, now=NOW))
    assert first == second
    assert first.endswith("\n")
    assert json.loads(first)["scanned_at"] == NOW


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HERE / "scan.py"), *args], capture_output=True, text=True, env=os.environ.copy(),
    )


def test_cli_writes_output_file_and_summary(tmp_path):
    root = make_repo(tmp_path, "cargo-workspace")
    out = tmp_path / "scan.json"
    proc = run_cli("--repo", str(root), "--output", str(out), "--now", NOW)
    assert proc.returncode == 0, proc.stderr
    summary = json.loads(proc.stdout)
    assert summary["status"] == "ok"
    assert summary["files"] == 8
    written = json.loads(out.read_text())
    assert written == scan.scan(root, now=NOW)
    piped = run_cli("--repo", str(root), "--now", NOW)
    assert piped.stdout == out.read_text()


def test_cli_error_paths(tmp_path):
    not_a_repo = tmp_path / "plain"
    not_a_repo.mkdir()
    proc = run_cli("--repo", str(not_a_repo))
    assert proc.returncode == 1
    assert proc.stdout == ""
    err = json.loads(proc.stderr)
    assert err["status"] == "error"
    assert "not a git repository" in err["error"]

    root = make_repo(tmp_path, "python-package")
    proc = run_cli("--repo", str(root), "--ref", "no-such-ref")
    assert proc.returncode == 1
    assert json.loads(proc.stderr) == {"status": "error", "error": "unknown ref: no-such-ref"}


def test_hints_cover_bin_targets_dev_dependencies_and_directory_kinds(tmp_path):
    root = make_repo(tmp_path, extra={
        "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n',
        "crates/api/Cargo.toml": '[package]\nname = "api"\n\n[[bin]]\nname = "api"\npath = "src/bin/api.rs"\n\n'
                                 '[dependencies]\naxum = "0.8"\n\n[dev-dependencies]\ntokio = "1"\ninsta = "1"\n\n'
                                 '[target.\'cfg(unix)\'.dependencies]\nlibc = "0.2"\n',
        "crates/api/src/lib.rs": "pub fn run() {}\n",
        "crates/api/src/bin/api.rs": "fn main() {}\n",
        "crates/api/tests/smoke.rs": "#[test] fn t() {}\n",
        "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
        "apps/cli/package.json": '{"name": "cli", "bin": {"cli": "./src/main.ts"}, "devDependencies": {"@playwright/test": "1", "tsx": "4"}}',
        "apps/cli/src/main.ts": "export {};\n",
        "prototypes/spike/index.py": "import flask\n",
        "docs/examples/demo.py": "import pytest\n",
    })
    hints = {u["id"]: u["hints"] for u in scan.scan(root, now=NOW)["units"]}
    # Cargo dev-dependencies are harness-only: tokio does not make the crate a server, insta is a test framework.
    assert hints["api"] == {
        "executable": True, "wasm": False, "server_libs": ["axum"], "client_libs": [], "desktop": False,
        "test_libs": ["insta"], "directory_kind": None, "test_file_share": round(1 / 3, 3),
    }
    assert hints["cli"]["executable"] is True and hints["cli"]["test_libs"] == ["@playwright/test"]
    assert hints["prototypes"]["directory_kind"] == "prototypes" and hints["prototypes"]["server_libs"] == ["flask"]
    assert hints["docs"]["directory_kind"] == "docs" and hints["docs"]["test_libs"] == ["pytest"]


def test_large_manifest_less_directories_split_into_subdirectory_units(tmp_path):
    extra = {"tools/README.md": "# Tools\n", "tools/dev/README.md": "\n\n## Dev stack runner\nRuns things.\n", "tools/run.py": "import os\n"}
    for i in range(20):
        extra[f"tools/dev/d{i}.py"] = "x = 1\n"
    for i in range(12):
        extra[f"tools/gltf/g{i}.py"] = "x = 1\n"
    for i in range(7):
        extra[f"tools/small/s{i}.py"] = "x = 1\n"  # below the subdirectory threshold: stays with tools
    for i in range(45):
        extra[f"art/character/adoption/a{i}.py"] = "x = 1\n"  # a lone hub: the rule descends into art/character
    for i in range(9):
        extra[f"art/character/equipment/e{i}.py"] = "x = 1\n"
    extra["art/character/notes.py"] = "x = 1\n"
    for i in range(30):
        extra[f"docs/examples/x{i}.py"] = "x = 1\n"  # 38 files in all: below the directory threshold
    for i in range(8):
        extra[f"docs/other/y{i}.py"] = "x = 1\n"
    root = make_repo(tmp_path, extra=extra)
    doc = scan.scan(root, now=NOW)
    units = unit_index(doc)
    assert sorted(units) == ["art", "art-character-adoption", "art-character-equipment", "docs", "tools", "tools-dev", "tools-gltf"]
    assert units["tools-dev"] == {"id": "tools-dev", "path": "tools/dev", "kind": "directory", "name": "tools/dev", "manifest": None,
                                  "description": "Dev stack runner", "readme": "tools/dev/README.md", "hints": units["tools-dev"]["hints"]}
    assert units["tools-gltf"]["description"] is None and units["tools"]["readme"] == "tools/README.md"
    owner = {}
    for f in doc["files"]:
        owner.setdefault(f["unit"], []).append(f["path"])
    assert len(owner["tools-dev"]) == 20 and len(owner["tools-gltf"]) == 12
    assert sorted(owner["tools"]) == sorted([f"tools/small/s{i}.py" for i in range(7)] + ["tools/run.py"])
    assert len(owner["art-character-adoption"]) == 45 and owner["art"] == ["art/character/notes.py"]
    assert len(owner["docs"]) == 38
    assert units["tools-dev"]["hints"]["directory_kind"] == "tools" and units["art-character-equipment"]["hints"]["directory_kind"] == "art"
    assert scan.dumps(doc) == scan.dumps(scan.scan(root, now=NOW))


def test_file_role_marks_tests_by_directory_and_basename():
    assert scan.file_role("packages/core/src/index.ts") == "source"
    assert scan.file_role("packages/core/test/index.test.ts") == "test"
    assert scan.file_role("packages/core/src/index.spec.tsx") == "test"
    assert scan.file_role("crates/sim/tests/integration.rs") == "test"
    assert scan.file_role("crates/sim/src/lib.rs") == "source"
    assert scan.file_role("tools/gate/test_gate.py") == "test"
    assert scan.file_role("tools/gate/gate_test.py") == "test"
    assert scan.file_role("tools/gate/gate_tests.py") == "test"
    assert scan.file_role("crates/sim/src/progression_tests.rs") == "test"
    assert scan.file_role("crates/sim/src/contests.rs") == "source"
    assert scan.file_role("tools/gate/conftest.py") == "test"
    assert scan.file_role("apps/web/src/testing-utils.ts") == "source"


def test_changes_count_commits_in_the_window_before_the_scanned_commit(tmp_path, monkeypatch):
    def commit(root, when, files):
        for rel, content in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(content, encoding="utf-8")
        monkeypatch.setenv("GIT_AUTHOR_DATE", when)
        monkeypatch.setenv("GIT_COMMITTER_DATE", when)
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", when)

    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    commit(root, "2020-01-01T00:00:00+00:00", {"a.py": "x = 1\n", "b.py": "y = 1\n"})
    commit(root, "2020-06-01T00:00:00+00:00", {"a.py": "x = 2\n"})
    commit(root, "2020-06-20T00:00:00+00:00", {"a.py": "x = 3\n", "b.py": "y = 2\n"})
    doc = scan.scan(root, now=NOW)
    changes = {f["path"]: f["changes"] for f in doc["files"]}
    # the January commit is outside the 90 days before the June 20 commit
    assert changes == {"a.py": 2, "b.py": 1}
    assert doc["activity"]["window_days"] == 90 and doc["activity"]["commits"] == 2
    assert doc["activity"]["until"].startswith("2020-06-20")


def test_contract_files_are_found_by_name_in_any_stack(tmp_path):
    root = make_repo(tmp_path, "pnpm-monorepo", extra={
        "packages/core/api/user.proto": "syntax = \"proto3\";\n",
        "packages/core/openapi.yaml": "openapi: 3.1.0\n",
        "schemas/event.schema.json": "{}\n",
        "packages/core/src/notes.json": "{}\n",
    })
    doc = scan.scan(root, now=NOW)
    found = {(c["path"], c["kind"]) for c in doc["contracts"]}
    assert ("packages/core/api/user.proto", "protobuf") in found and ("packages/core/openapi.yaml", "openapi") in found
    assert ("schemas/event.schema.json", "json-schema") in found
    assert not any(c["path"] == "packages/core/src/notes.json" for c in doc["contracts"])
    owners = {c["path"]: c["unit"] for c in doc["contracts"]}
    assert owners["packages/core/api/user.proto"] == "core"
