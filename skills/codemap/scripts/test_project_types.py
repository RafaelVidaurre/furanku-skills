"""Repository proposals through real scan/draft/decision/build boundaries; Jev alone is stubbed."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess

import pytest

import build
import codemap
import decide
import jev_client
import project_types
import scan
import skeleton
import store
from test_build import trio

FIXTURE = Path(__file__).parent / "fixtures" / "project-types"


class RepositoryJev:
    """Typed service boundary stub: tests control uncertainty without network/model variability."""
    def __init__(self, overrides=None):
        self.overrides = overrides or {}
        self.requests = []

    def __call__(self, payload):
        jev_client.validate_request(payload)
        self.requests.append(payload)
        answers = {}
        for kind, question in payload["questions"].items():
            if question["type"] == "boolean":
                answers[kind] = {"type": "boolean", "probability": self.overrides.get(kind, .9)}
            else:
                value = self.overrides.get(kind, "landscape" if kind == "repository_shape" else "game")
                answers[kind] = {"type": "choice", "choice": value, "confidence": .9, "probabilities": {value: .9}}
        return {"answers": answers, "model": "typesafe-ai/jev"}


@pytest.fixture
def proposals():
    return json.loads((FIXTURE / "proposals.json").read_text())


@pytest.fixture
def repository(tmp_path):
    root = tmp_path / "arena"
    shutil.copytree(FIXTURE / "repo", root)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    return root


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    monkeypatch.setattr(decide, "_sleep", lambda _seconds: None)


def proposal_draft(sk, proposals):
    draft = codemap.draft_template(sk)
    draft["system"].update(name="Arena and catalog", summary="Independent simulation and API.", purpose="Run a game and browse items.")
    draft.update(proposals)
    return draft


def test_unsupported_language_scan_through_cli_build_and_update(repository, proposals, monkeypatch, capsys):
    fake = RepositoryJev()
    monkeypatch.setattr(decide.jev_client, "evaluate", fake)
    for command in ("scan", "skeleton", "draft-template"):
        assert codemap.main([command, "--repo", str(repository)]) == 0
        capsys.readouterr()
    paths = store.paths(repository)
    sk = store.read_json(paths["skeleton"])
    assert sk["components"] == []
    inv = sk["inventory"]
    assert inv["tracked_paths"] == ["README.md", "game.go", "go.mod", "infra/dev.tf"]
    assert inv["manifests"] == ["go.mod"] and inv["deployments"] == ["infra/dev.tf"]
    assert inv["import_coverage"]["parsed_paths"] == []
    draft = proposal_draft(sk, proposals)
    assert codemap.draft_gaps(draft, sk) == []
    store.write_json(paths["draft"], draft)
    for command in ("decide", "build", "update", "build"):
        assert codemap.main([command, "--repo", str(repository)]) == 0, capsys.readouterr()
        capsys.readouterr()
    result = store.read_json(paths["map"])
    assert build.validate(result) == []
    assert result["landscape"]["enabled"]
    assert {v["kind"] for v in result["views"]} == {"request", "game-loop", "ecs", "infrastructure"}
    assert result["components"] == [] and result["flows"] == []
    assert result["meta"]["import_coverage"]["unparsed_files"] == 4
    assert store.read_json(paths["draft"])["views"] == draft["views"]
    assert store.read_json(paths["decisions"])["summary"]["calls_made"] == 0


def test_shared_membership_and_rejected_or_stale_graphs_cannot_leak(trio, proposals):
    sk, draft, legacy = trio
    draft.update(proposals)
    for project in draft["projects"]:
        project["components"] = ["rules"]
    draft["views"][0]["nodes"][0]["component"] = "rules"
    session = decide.Session(None, RepositoryJev())
    for node, kind, state, criteria in project_types.questions(sk, draft):
        session.ask(node, state, {kind: criteria})
    decisions = dict(legacy, records=session.records)
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    assert [p["components"] for p in result["projects"]] == [["rules"], ["rules"]]
    assert len([c for c in result["components"] if c["id"] == "rules"]) == 1
    # Draft-only membership never enters output, even when a resolved cache summary claims approval.
    unjudged = build.build(sk, draft, dict(legacy, repository={"repository": {"value": "landscape"}}))
    assert all(not p["components"] for p in unjudged["projects"])
    assert not unjudged["views"] and not unjudged["landscape"]["enabled"]
    changed = deepcopy(draft)
    changed["views"][0]["edges"][0]["detail"] = "Changed execution order requires review."
    stale = build.build(sk, changed, decisions)
    assert "tick" not in {v["id"] for v in stale["views"]}
    assert stale["view_decisions"][0]["decision"]["status"] == "unresolved"
    # Reject membership while keeping the separately accepted graph: graph must be withheld intact.
    for record in decisions["records"]:
        if record["question"] == "project_membership":
            record["answer"] = .1
    rejected = build.build(sk, draft, decisions)
    assert not rejected["projects"][0]["components"]
    assert rejected["view_decisions"][0]["decision"]["status"] == "unresolved"
    assert build.validate(rejected) == []


@pytest.mark.parametrize("question,value,status", [("repository_shape", "abstain", "unresolved"),
    ("view_support", .5, "uncertain"), ("view_support", .1, "rejected"), ("project_kind", "abstain", "unresolved")])
def test_uncertainty_is_explicit_and_only_accepted_views_publish(repository, proposals, question, value, status):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    decisions = decide.decide(sk, draft, None, evaluate=RepositoryJev({question: value}))
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    if question == "repository_shape":
        assert result["landscape"]["decision"]["status"] == status and not result["landscape"]["enabled"]
    elif question == "project_kind":
        assert result["projects"][0]["decision"]["status"] == status and result["projects"][0]["kind"] == "other"
    else:
        assert result["views"] == [] and all(v["decision"]["status"] == status for v in result["view_decisions"])


def test_cache_covers_full_graph_relations_revision_and_instruction_version(repository, proposals, monkeypatch):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    first = decide.decide(sk, draft, None, evaluate=RepositoryJev())
    fake = RepositoryJev()
    decide.decide(sk, draft, first, evaluate=fake)
    assert fake.requests == []
    changed = deepcopy(draft)
    changed["views"][0]["nodes"][1]["detail"] += " Also applies velocity."
    fake = RepositoryJev()
    second = decide.decide(sk, changed, first, evaluate=fake)
    assert [list(p["questions"]) for p in fake.requests] == [["view_support"]]
    changed["project_relations"] = [{"from": "arena", "to": "catalog", "label": "reads items", "detail": "Simulation reads catalog item definitions.", "evidence": ["README.md"]}]
    fake = RepositoryJev()
    decide.decide(sk, changed, second, evaluate=fake)
    assert any("repository_shape" in p["questions"] for p in fake.requests)
    monkeypatch.setattr(decide, "INSTRUCTIONS_VERSION", decide.INSTRUCTIONS_VERSION + 1)
    fake = RepositoryJev()
    decide.decide(sk, draft, first, evaluate=fake)
    assert len(fake.requests) == len(first["records"])


@pytest.mark.parametrize("mutate,fragment", [
    (lambda d: d["projects"][0]["components"].append("missing"), "unknown component"),
    (lambda d: d["projects"].append(deepcopy(d["projects"][0])), "duplicate id"),
    (lambda d: d["views"][0].update(project="missing"), "unknown project"),
    (lambda d: d["views"][0]["nodes"][0].update(evidence=["../outside"]), "repository-relative"),
    (lambda d: d["views"][0]["edges"][0].update(to="missing"), "dangling node"),
    (lambda d: d["views"][0]["edges"][0].update(evidence=[]), "needs evidence"),
    (lambda d: d["views"][0]["nodes"].extend(deepcopy(d["views"][0]["nodes"]) * 11), "graph needs"),
    (lambda d: d["projects"][0].update(evidence=["not-tracked.go"]), "absent from tracked"),
])
def test_malformed_proposals_fail_before_jev(repository, proposals, mutate, fragment):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    mutate(draft)
    fake = RepositoryJev()
    with pytest.raises(jev_client.Error, match=fragment):
        decide.decide(sk, draft, None, evaluate=fake)
    assert fake.requests == []
    with pytest.raises(build.BuildError, match=fragment):
        build.build(sk, draft, {})


def test_merge_preserves_authored_views_and_reports_vanished_members(trio, proposals):
    sk, draft, _ = trio
    draft.update(proposals)
    draft["projects"][0]["components"] = ["gone"]
    before = deepcopy(draft["views"])
    codemap.merge_draft(draft, sk)
    assert draft["views"] == before
    assert any("unknown component 'gone'" in gap for gap in codemap.draft_gaps(draft, sk))


def test_every_kind_is_independent_of_supported_view_kind(repository, proposals):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    for index, kind in enumerate(project_types.VIEW_KINDS):
        view = deepcopy(proposals["views"][0])
        view.update(id=f"view-{index}", kind=kind)
        draft["views"] = [view]
        decisions = decide.decide(sk, draft, None, evaluate=RepositoryJev({"project_kind": "library"}))
        result = build.build(sk, draft, decisions)
        assert result["views"][0]["kind"] == kind
        assert result["projects"][0]["kind"] == "library"
        assert build.validate(result) == []
    for kind in project_types.PROJECT_KINDS:
        decisions = decide.decide(sk, draft, None, evaluate=RepositoryJev({"project_kind": kind}))
        assert build.build(sk, draft, decisions)["projects"][0]["kind"] == kind


def test_landscape_area_bounds_apply_per_project_and_single_library_area_is_valid(trio, proposals):
    sk, draft, legacy = trio
    # Spread fixture product and content components over eight areas.
    products = [cid for cid, entry in legacy["resolution"].items() if entry["nature"]["value"] == "product"] + ["content"]
    draft["areas"] = [{"id": f"area-{i}", "name": f"Area {i}", "definition": f"Purpose {i}", "components": []} for i in range(8)]
    for i, cid in enumerate(products):
        aid = f"area-{i % 8}"
        legacy["resolution"][cid]["area"]["value"] = aid
    for cid, entry in legacy["resolution"].items():
        if cid not in products:
            entry["area"]["value"] = "build_verify"
    draft.update(proposals)
    draft["projects"][0]["components"] = products[:4]
    draft["projects"][1]["components"] = products[4:]
    session = decide.Session(None, RepositoryJev())
    for node, kind, state, criteria in project_types.questions(sk, draft):
        session.ask(node, state, {kind: criteria})
    result = build.build(sk, draft, dict(legacy, records=session.records))
    assert build.validate(result) == []
    # Overlapping membership is legal, but one project cannot acquire eight visible areas.
    project = result["projects"][0]
    project["components"] = products
    project["membership_decisions"] = [{"component": cid, "decision": {"value": True, "status": "accepted", "confidence": .9, "reason": None}} for cid in products]
    assert any("8 areas" in e for e in build.validate(result))
    # A single product library requires neither executable nor fabricated traffic.
    one = deepcopy(sk)
    one["components"] = [c for c in one["components"] if c["id"] == "rules"]
    one["modules"] = [m for m in one["modules"] if m["component"] == "rules"]
    one["edges"] = {"components": [], "modules": []}
    one["cycles"] = {}
    library = deepcopy(draft)
    library.update(projects=[], views=[], project_relations=[])
    library["system"].update(actors=[], externals=[], flows=[])
    library["areas"] = [{"id": "rules", "name": "Rules", "definition": "The rules library", "components": ["rules"]}]
    legacy["resolution"]["rules"]["area"]["value"] = "rules"
    result = build.build(one, library, legacy)
    assert build.validate(result) == [] and not result["areas"][0]["runnables"]


def test_repository_decisions_recheck_after_component_holds(trio, proposals):
    from test_decide import DRAFT, SKELETON, FakeJev
    sk, draft = deepcopy(SKELETON), deepcopy(DRAFT)
    draft.update(proposals)
    draft["projects"][0]["components"] = ["core"]
    repo_jev, components = RepositoryJev(), FakeJev()
    def evaluate(payload):
        return repo_jev(payload) if any(k in project_types.INSTRUCTIONS for k in payload["questions"]) else components(payload)
    first = decide.decide(sk, draft, None, evaluate=evaluate)
    draft["components"]["core"]["responsibility"] += "; also advances animation state"
    components.overrides[("core", "holds")] = .9
    repo_jev.requests.clear()
    decide.decide(sk, draft, first, evaluate=evaluate, changes={"core": "animation updated"})
    assert any("project_membership" in p["questions"] for p in repo_jev.requests)
    assert any("repository_shape" in p["questions"] for p in repo_jev.requests)


def test_provider_failure_keeps_partial_cache_without_draft_fallback(repository, proposals):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    fake = RepositoryJev()
    def fails(payload):
        if "view_support" in payload["questions"]:
            raise jev_client.Error("Gateway HTTP 401: rejected")
        return fake(payload)
    with pytest.raises(decide.Interrupted) as caught:
        decide.decide(sk, draft, None, evaluate=fails)
    partial = decide.partial_cache(caught.value)
    assert partial["partial"] and partial["records"]
    with pytest.raises(build.BuildError, match="partial"):
        build.build(sk, draft, partial)
    result = decide.decide(sk, draft, partial, evaluate=RepositoryJev())
    assert result["summary"]["calls_cached"] > 0
    assert len(build.build(sk, draft, result)["views"]) == 4


def test_landscape_actor_and_external_bounds_are_scoped(trio, proposals):
    sk, draft, legacy = trio
    draft.update(proposals)
    draft["projects"][0]["components"] = ["api"]
    draft["projects"][1]["components"] = ["cli"]
    session = decide.Session(None, RepositoryJev())
    for node, kind, state, criteria in project_types.questions(sk, draft):
        session.ask(node, state, {kind: criteria})
    result = build.build(sk, draft, dict(legacy, records=session.records))
    # Preserve existing referenced actors/externals; add enough independent users/resources to exceed global bounds.
    result["system"]["actors"] += [{"id": f"user-{i}", "name": f"User {i}", "role": "Uses the product", "uses": ["api" if i < 3 else "cli"]} for i in range(6)]
    result["system"]["externals"] += [{"id": f"store-{i}", "name": f"Store {i}", "role": "Stores data", "kind": "datastore", "used_by": ["api" if i < 4 else "cli"]} for i in range(8)]
    assert len(result["system"]["actors"]) > 6 and len(result["system"]["externals"]) > 8
    assert build.validate(result) == []
    for actor in result["system"]["actors"]:
        actor["uses"] = ["api"]
    assert any("project arena" in e and "actors exceeds" in e for e in build.validate(result))


def test_actual_repository_question_size_is_checked_before_any_provider_call(trio, proposals):
    sk, draft, _ = trio
    draft.update(proposals)
    draft["projects"][0]["components"] = ["rules"]
    draft["components"]["rules"]["why"] = "x" * 250_001
    fake = RepositoryJev()
    with pytest.raises(jev_client.Error, match="exceeds 250 KB"):
        decide.decide(sk, draft, None, evaluate=fake)
    assert fake.requests == []


def test_independent_source_excerpts_only_invalidate_citing_questions(repository, proposals):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    draft["views"][0]["evidence"] = ["game.go"]
    draft["evidence_excerpts"] = [{"path": "game.go", "start_line": 1, "text": "package arena\n"}]
    fake = RepositoryJev()
    first = decide.decide(sk, draft, None, evaluate=fake)
    citing = [p for p in fake.requests if p["state"].get("evidence_excerpts")]
    assert len(citing) == 1 and citing[0]["state"]["view"]["id"] == "tick"
    draft["evidence_excerpts"][0]["text"] += "\ntype Position struct{ X, Y int }\n"
    fake = RepositoryJev()
    changed = decide.decide(sk, draft, first, evaluate=fake)
    assert len(fake.requests) == 1 and fake.requests[0]["state"]["view"]["id"] == "tick"
    assert build.validate(build.build(sk, draft, changed)) == []
    codemap.merge_draft(draft, sk)
    assert draft["evidence_excerpts"][0]["text"].endswith("int }\n")


@pytest.mark.parametrize("excerpt", [
    {"path": "missing.go", "start_line": 1, "text": "source"},
    {"path": "game.go", "start_line": 0, "text": "source"},
    {"path": "game.go", "start_line": True, "text": "source"},
    {"path": "game.go", "start_line": 1, "text": ""},
    {"path": "game.go", "start_line": 1, "text": "x" * 8001},
])
def test_source_excerpt_validation_precedes_provider_calls(repository, proposals, excerpt):
    sk = skeleton.skeleton(scan.scan(repository))
    draft = proposal_draft(sk, proposals)
    draft["evidence_excerpts"] = [excerpt]
    fake = RepositoryJev()
    with pytest.raises(jev_client.Error, match="evidence_excerpts"):
        decide.decide(sk, draft, None, evaluate=fake)
    assert fake.requests == []
