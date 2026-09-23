"""Tests for the codemap CLI on a fake repository."""

import json
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest

import build
import codemap
import store

FIXTURES = Path(__file__).parent / "fixtures" / "build"
SCRIPT = Path(__file__).with_name("codemap.py")
TEMPLATE = "<html><script>const MAP = /*__CODEMAP_JSON__*/;</script></html>"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "demo"
    root.mkdir()
    (root / "apps" / "cli" / "src").mkdir(parents=True)
    (root / "apps" / "cli" / "src" / "index.ts").write_text("export const run = () => 1;\n")
    (root / "README.md").write_text("# demo\n")
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "init"], check=True, env=env)
    return root


def fixture_scan(repo):
    scan = json.loads((FIXTURES / "scan.json").read_text())
    scan["repo"]["root"] = str(repo)
    scan["repo"]["sha"] = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    return scan


def run(capsys, *argv):
    code = codemap.main(list(argv))
    captured = capsys.readouterr()
    payload = json.loads(captured.out if code == 0 else captured.err)
    return code, payload


def test_path_and_empty_status(repo, capsys, hermetic_home):
    code, payload = run(capsys, "path", "--repo", str(repo))
    assert code == 0 and payload["store"] == str(store.store_dir(repo))
    assert Path(payload["store"]).is_relative_to(hermetic_home)
    code, status = run(capsys, "status", "--repo", str(repo))
    assert code == 0
    assert all(not a["exists"] for a in status["artifacts"].values())
    assert status["stale"] is False and status["map_sha"] is None
    assert status["jev"]["ready"] is False and "error" in status["jev"]
    assert len(status["head"]) == 40


def test_scan_uses_scan_module_and_logs(repo, capsys, monkeypatch):
    calls = []

    def fake_scan(root, ref):
        calls.append((root, ref))
        return fixture_scan(repo)

    monkeypatch.setitem(sys.modules, "scan", types.SimpleNamespace(scan=fake_scan))
    code, payload = run(capsys, "scan", "--repo", str(repo), "--ref", "main")
    assert code == 0 and calls == [(str(repo), "main")]
    assert payload["units"] == 12 and payload["files"] == 42
    assert store.paths(repo)["scan"].exists()
    log = [json.loads(l) for l in store.paths(repo)["log"].read_text().splitlines()]
    assert log[-1]["command"] == "scan" and log[-1]["outcome"] == "ok" and log[-1]["ref"] == "main"


def test_skeleton_requires_scan(repo, capsys):
    code, payload = run(capsys, "skeleton", "--repo", str(repo))
    assert code == 1 and "scan.json is missing" in payload["error"]


def test_draft_template_writes_fixed_shape_once_then_reports_gaps(repo, capsys):
    store.write_json(store.paths(repo)["scan"], fixture_scan(repo))
    assert run(capsys, "skeleton", "--repo", str(repo))[0] == 0
    code, payload = run(capsys, "draft-template", "--repo", str(repo))
    assert code == 0 and payload["created"] is True
    draft = store.read_json(store.paths(repo)["draft"])
    assert draft["system"] == {"name": "", "summary": "", "purpose": "", "actors": [], "externals": [], "flows": []}
    assert draft["areas"] == [] and draft["module_names"] == {}
    assert "domain_partitions" not in draft
    assert payload["shapes"] == codemap.SHAPES and set(payload["shapes"]) == {"actor", "external", "flow", "area"}
    assert payload["gaps"][:3] == ["system.name", "system.summary", "system.purpose"] and {"areas"} <= set(payload["gaps"])
    assert set(draft["components"]) == {"api", "cli", "web", "orchestrator", "rules", "store", "schema", "devtools", "harness", "lab", "content", "docs"}
    assert draft["components"]["cli"] == {"summary": "", "responsibility": "", "runs": "", "why": "", "entry_points": [], "evidence": [], "loaded_by": [], "mixed_jobs": []}
    assert draft["edge_reasons"]["cli->orchestrator"] == ""
    assert len(draft["edge_reasons"]) == 19
    assert "components.cli.responsibility" in payload["gaps"] and "edge_reasons.cli->store" in payload["gaps"]
    # Second call keeps the agent's edits and reports what is still empty, including the new per-entry fields.
    draft["system"]["name"] = "Demo"
    draft["system"]["actors"] = [{"id": "operator", "name": "Operator", "role": "Runs flows.", "uses": []}]
    draft["system"]["externals"] = [{"id": "sqlite", "name": "SQLite", "role": "Records.", "used_by": ["store"]}]
    draft["system"]["flows"] = [{"from": "cli", "to": "api", "kind": "network", "label": "HTTP: starts ingest and publish flows"}]
    draft["areas"] = [{"id": "operating", "name": "Operating", "definition": "x", "components": ["cli"]}]
    store.write_json(store.paths(repo)["draft"], draft)
    code, payload = run(capsys, "draft-template", "--repo", str(repo))
    assert code == 0 and payload["created"] is False and payload["complete"] is False
    assert "system.name" not in payload["gaps"] and "system.purpose" in payload["gaps"] and "areas" not in payload["gaps"]
    assert "system.actors[operator].uses" in payload["gaps"] and "system.externals[sqlite].kind" in payload["gaps"]
    assert any(g.startswith("system.flows[cli->api].label longer than 32") for g in payload["gaps"])
    assert store.read_json(store.paths(repo)["draft"])["system"]["name"] == "Demo"
    draft["components"]["rules"]["mixed_jobs"] = [
        {"name": "engine", "paths": ["packages/rules/src/engine/compile.ts"]},
        {"name": "values", "paths": ["outside/component.ts"]},
    ]
    store.write_json(store.paths(repo)["draft"], draft)
    code, payload = run(capsys, "draft-template", "--repo", str(repo))
    assert code == 0 and any(g.startswith("components.rules.mixed_jobs") for g in payload["gaps"])
    assert store.read_json(store.paths(repo)["draft"])["components"]["rules"]["mixed_jobs"] == draft["components"]["rules"]["mixed_jobs"]


def test_draft_template_refuses_a_domain_partitions_draft_and_leaves_it_untouched(repo, capsys):
    store.write_json(store.paths(repo)["scan"], fixture_scan(repo))
    assert run(capsys, "skeleton", "--repo", str(repo))[0] == 0
    old = {"schema": "codemap.draft/1", "system": {"name": "Demo"}, "domain_partitions": [{"id": "x", "domains": []}], "components": {}}
    path = store.paths(repo)["draft"]
    store.write_json(path, old)
    before = path.read_text()
    code, payload = run(capsys, "draft-template", "--repo", str(repo))
    assert code == 1 and "domain_partitions" in payload["error"] and "areas" in payload["error"]
    assert path.read_text() == before


def test_build_writes_map_html_snapshot_and_status_sees_fresh_map(repo, capsys, tmp_path):
    paths = store.paths(repo)
    store.write_json(paths["scan"], fixture_scan(repo))
    assert run(capsys, "skeleton", "--repo", str(repo))[0] == 0
    store.write_json(paths["draft"], json.loads((FIXTURES / "draft.json").read_text()))
    store.write_json(paths["decisions"], json.loads((FIXTURES / "decisions.json").read_text()))
    template = tmp_path / "viewer.html"
    template.write_text(TEMPLATE)
    code, payload = run(capsys, "build", "--repo", str(repo), "--template", str(template))
    assert code == 0, payload
    assert payload["areas"] == 3 and payload["components"] == 12 and payload["unresolved"] == []
    assert payload["runnables"] == ["api", "cli", "web"] and payload["flows"] == 4
    assert payload["runtimes"] == {"cli": 1, "client": 1, "server": 3, "shared": 2}
    assert payload["natures"] == {"content": 1, "docs": 1, "experiment": 1, "product": 7, "test": 1, "tooling": 1}
    assert payload["health"] == {"checks": 8, "findings": 4, "by_check": {"core-uses-adapter": 1, "cycle": 2, "product-uses-support": 1}}
    assert [(c["component"], c["question"]) for c in payload["contradictions"]] == [("lab", "nature")]
    assert payload["snapshot"]["status"] == "created"
    map_obj = store.read_json(paths["map"])
    assert build.validate(map_obj) == []
    assert "codemap.map/1" in paths["html"].read_text()
    sha = map_obj["meta"]["repo"]["sha"]
    assert (paths["snapshots"] / sha / "map.json").exists()
    code, status = run(capsys, "status", "--repo", str(repo))
    assert status["artifacts"]["map"]["exists"] and status["stale"] is False and status["snapshots"] == [sha]
    # Rebuilding identical inputs leaves the snapshot untouched.
    code, payload = run(capsys, "build", "--repo", str(repo), "--template", str(template))
    assert payload["snapshot"]["status"] == "unchanged"


def test_build_reports_validation_errors_and_keeps_no_map(repo, capsys, tmp_path):
    paths = store.paths(repo)
    store.write_json(paths["scan"], fixture_scan(repo))
    assert run(capsys, "skeleton", "--repo", str(repo))[0] == 0
    draft = json.loads((FIXTURES / "draft.json").read_text())
    draft["components"]["cli"]["responsibility"] = ""
    store.write_json(paths["draft"], draft)
    store.write_json(paths["decisions"], json.loads((FIXTURES / "decisions.json").read_text()))
    template = tmp_path / "viewer.html"
    template.write_text(TEMPLATE)
    code, payload = run(capsys, "build", "--repo", str(repo), "--template", str(template))
    assert code == 1 and payload["error"] == "map validation failed"
    assert payload["errors"] == ["component cli: missing responsibility"]
    assert not paths["map"].exists()


def test_all_stops_on_missing_or_incomplete_draft_then_runs_pipeline(repo, capsys, monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "scan", types.SimpleNamespace(scan=lambda root, ref: fixture_scan(repo)))
    seen = {}

    def fake_decide(skeleton, draft, cache, **kwargs):
        seen["cache"] = cache
        seen["kwargs"] = kwargs
        return json.loads((FIXTURES / "decisions.json").read_text())

    monkeypatch.setitem(sys.modules, "decide", types.SimpleNamespace(decide=fake_decide))
    template = tmp_path / "viewer.html"
    template.write_text(TEMPLATE)
    code, payload = run(capsys, "all", "--repo", str(repo), "--template", str(template))
    assert code == 1 and "draft.json is missing" in payload["error"]
    paths = store.paths(repo)
    store.write_json(paths["draft"], {"system": {"name": "Demo"}, "components": {}})
    code, payload = run(capsys, "all", "--repo", str(repo), "--template", str(template))
    assert code == 1 and "empty required fields" in payload["error"]
    assert "system.purpose" in payload["gaps"] and "components.cli.why" in payload["gaps"]
    store.write_json(paths["draft"], json.loads((FIXTURES / "draft.json").read_text()))
    code, payload = run(capsys, "all", "--repo", str(repo), "--template", str(template))
    assert code == 0, payload
    assert seen["cache"] == {} and seen["kwargs"] == {}
    assert [step["command"] for step in payload["steps"]] == ["scan", "skeleton", "decide", "build"]
    assert paths["map"].exists() and paths["html"].exists()
    # decide reuses the previous decisions as cache; --require-zdr is refused by a decide() that cannot honour it.
    code, payload = run(capsys, "decide", "--repo", str(repo))
    assert code == 0 and seen["cache"]["schema"] == "codemap.decisions/1"
    assert payload["areas"] == {"build_verify": 3, "operating": 1, "processing": 7, "reviewing": 1}
    assert payload["runtimes"] == {"build": 2, "cli": 1, "client": 2, "none": 2, "server": 3, "shared": 2}
    assert payload["natures"]["product"] == 7 and payload["findings"] == {"core-uses-adapter": 1} and payload["unresolved"] == []
    # decide's own doubt lists reach the agent through the CLI summary
    assert "unresolved_nodes" in payload and "calls_made" in payload
    code, payload = run(capsys, "decide", "--repo", str(repo), "--require-zdr")
    assert code == 1 and "require-zdr" in payload["error"]


def test_decide_summary_counts_new_quality_findings(repo, capsys, monkeypatch):
    paths = store.paths(repo)
    store.write_json(paths["skeleton"], {"schema": "codemap.skeleton/1"})
    store.write_json(paths["draft"], json.loads((FIXTURES / "draft.json").read_text()))

    def fake_decide(skeleton, draft, cache, **kwargs):
        decisions = json.loads((FIXTURES / "decisions.json").read_text())
        decisions["quality"] = {
            "mixed-responsibility|rules": {"check": "mixed-responsibility", "nodes": ["rules"],
                                           "accepted": False, "flag": None, "probability": 0.2},
            "hub-coupling|rules": {"check": "hub-coupling", "nodes": ["rules"],
                                   "accepted": True, "flag": None, "probability": 0.9},
        }
        return decisions

    monkeypatch.setitem(sys.modules, "decide", types.SimpleNamespace(decide=fake_decide))
    code, payload = run(capsys, "decide", "--repo", str(repo))
    assert code == 0, payload
    assert payload["findings"] == {"core-uses-adapter": 1, "mixed-responsibility": 1}


def test_entry_point_runs_as_a_subprocess(repo, hermetic_home):
    env = {**os.environ, "FURANKU_SKILLS_HOME": str(hermetic_home), "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run([sys.executable, str(SCRIPT), "path", "--repo", str(repo)], capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["store"].startswith(str(hermetic_home))
    result = subprocess.run([sys.executable, str(SCRIPT), "build", "--repo", str(repo)], capture_output=True, text=True, env=env)
    assert result.returncode == 1
    assert json.loads(result.stderr)["status"] == "error"


def test_update_records_changes_merges_draft_and_defers_decide_until_gaps_are_filled(repo, capsys, monkeypatch, tmp_path):
    scans = [fixture_scan(repo)]
    monkeypatch.setitem(sys.modules, "scan", types.SimpleNamespace(scan=lambda root, ref: json.loads(json.dumps(scans[-1]))))
    seen = []

    def fake_decide(skeleton, draft, cache, **kwargs):
        seen.append(kwargs)
        return json.loads((FIXTURES / "decisions.json").read_text())

    monkeypatch.setitem(sys.modules, "decide", types.SimpleNamespace(decide=fake_decide))
    template = tmp_path / "viewer.html"
    template.write_text(TEMPLATE)
    paths = store.paths(repo)
    code, payload = run(capsys, "update", "--repo", str(repo))
    assert code == 1 and "missing" in payload["error"]
    store.write_json(paths["draft"], json.loads((FIXTURES / "draft.json").read_text()))
    assert run(capsys, "all", "--repo", str(repo), "--template", str(template))[0] == 0

    # Second scan: cli grows a file and starts importing schema; a new package appears; rules shrinks.
    changed = json.loads(json.dumps(scans[0]))
    changed["repo"]["sha"] = "b" * 40
    changed["files"].append({"path": "apps/cli/src/extra.ts", "lang": "ts", "loc": 5, "role": "source", "unit": "cli"})
    changed["edges"].append({"from": "apps/cli/src/extra.ts", "to": "packages/schema/src/index.ts", "specifier": "@fixture/schema", "line": 1})
    changed["units"].append({"id": "metrics", "path": "packages/metrics", "kind": "package", "name": "@fixture/metrics"})
    changed["files"].append({"path": "packages/metrics/src/index.ts", "lang": "ts", "loc": 7, "role": "source", "unit": "metrics"})
    changed["edges"].append({"from": "packages/metrics/src/index.ts", "to": "packages/schema/src/index.ts", "specifier": "@fixture/schema", "line": 1})
    rules_file = next(f for f in changed["files"] if f["unit"] == "rules")
    rules_file["loc"] += 3
    scans.append(changed)

    code, payload = run(capsys, "update", "--repo", str(repo))
    assert code == 0, payload
    assert payload["new_components"] == ["metrics"] and payload["removed_components"] == []
    assert payload["changed_components"] == ["cli", "rules"]
    changes = store.read_json(paths["changes"])
    assert changes["components"]["cli"] == {"files_added": ["apps/cli/src/extra.ts"], "files_removed": [], "files_changed": [],
                                             "dependencies_added": ["schema"], "dependencies_removed": []}
    assert changes["components"]["rules"]["files_changed"] == [rules_file["path"]]
    assert changes["previous_sha"] != changes["current_sha"] == "b" * 40
    draft = store.read_json(paths["draft"])
    assert draft["components"]["metrics"] == {"summary": "", "responsibility": "", "runs": "", "why": "", "entry_points": [], "evidence": [], "loaded_by": [], "mixed_jobs": []}
    assert draft["edge_reasons"]["metrics->schema"] == "" and draft["edge_reasons"]["cli->schema"] == ""
    assert draft["components"]["cli"]["responsibility"]  # existing prose untouched
    assert payload["draft"]["components_added"] == ["metrics"] and payload["draft"]["edges_added"] == ["cli->schema", "metrics->schema"]
    assert "components.metrics.responsibility" in payload["gaps"] and "edge_reasons.metrics->schema" in payload["gaps"]
    assert [step["command"] for step in payload["steps"]] == ["scan", "skeleton"]  # decide deferred until the draft is filled
    assert len(seen) == 1

    # Filling the gaps and running decide hands the change summary to decide() once, then consumes it.
    draft["components"]["metrics"].update({"responsibility": "Owns metrics.", "why": "Nothing counts without it."})
    draft["edge_reasons"]["metrics->schema"] = "validates metric shapes"
    draft["edge_reasons"]["cli->schema"] = "reads schema"
    store.write_json(paths["draft"], draft)
    code, payload = run(capsys, "decide", "--repo", str(repo))
    assert code == 0
    assert seen[-1]["changes"] == changes["components"]
    assert not paths["changes"].exists()
    code, payload = run(capsys, "decide", "--repo", str(repo))
    assert code == 0 and "changes" not in seen[-1]
