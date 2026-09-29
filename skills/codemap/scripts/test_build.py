"""Tests for map assembly, validation, and rendering."""

import copy
import json
from pathlib import Path

import pytest

import build
import skeleton

FIXTURES = Path(__file__).parent / "fixtures" / "build"
TEMPLATE = "<html><script>const MAP = /*__CODEMAP_JSON__*/;</script></html>"


@pytest.fixture
def trio():
    load = lambda name: json.loads((FIXTURES / name).read_text())
    return skeleton.skeleton(load("scan.json")), load("draft.json"), load("decisions.json")


@pytest.fixture
def valid_map(trio):
    return build.build(*trio)


def test_fixture_trio_builds_a_valid_deterministic_map(trio, valid_map):
    assert build.validate(valid_map) == []
    assert build.dumps(build.build(*trio)) == build.dumps(valid_map)
    assert valid_map["schema"] == "codemap.map/1"
    assert valid_map["meta"]["built_at"] == "2026-09-22T10:00:00Z"
    assert "partition" not in valid_map["meta"] and "domains" not in valid_map
    assert [(a["id"], a["hue"]) for a in valid_map["areas"]] == [("operating", 210), ("reviewing", 330), ("processing", 90), ("build-verify", None)]
    comp = {c["id"]: c for c in valid_map["components"]}
    assert comp["store"]["decision"]["area"] == {"confidence": 0.55, "flag": "uncertain"}
    assert (comp["cli"]["area"], comp["cli"]["runtime"], comp["cli"]["nature"], comp["cli"]["role"]) == ("operating", "cli", "product", "surface")
    # Runnables: product surfaces that start as their own process or page (api, cli, web); the orchestrator library,
    # although a fastify server at heart, is core code and stays a library.
    assert {c["id"] for c in valid_map["components"] if c["runnable"]} == {"api", "cli", "web"}
    areas = {a["id"]: a for a in valid_map["areas"]}
    assert areas["processing"]["runnables"] == ["api"] and areas["processing"]["components"] == ["api", "content", "lab", "orchestrator", "rules", "schema", "store"]
    assert areas["build-verify"] == {"id": "build-verify", "name": "Build & verify", "definition": build.BUILD_VERIFY_DEFINITION, "hue": None,
                                     "components": ["devtools", "docs", "harness"], "runnables": [],
                                     "counts": {"product": 0, "supporting": 3, "runtimes": {r: 0 for r in build.RUNTIMES}}}
    assert comp["devtools"]["area"] == "build-verify" and comp["devtools"]["decision"]["area"] == {"confidence": 0.7, "flag": None}
    assert [(a["id"], a["uses"]) for a in valid_map["system"]["actors"]] == [("analyst", ["web"]), ("operator", ["cli"])]
    assert [(e["id"], e["kind"], e["used_by"]) for e in valid_map["system"]["externals"]] == [("browser", "runtime", ["web"]), ("playwright", "devtool", ["harness"]), ("sqlite", "datastore", ["store"])]
    assert valid_map["flows"][0] == {"from": "cli", "to": "api", "label": "HTTP", "detail": "starts ingest and publish flows", "kind": "network"}
    assert "detail" not in valid_map["flows"][2]
    assert valid_map["system"]["summary"].startswith("A rules engine")
    assert len(valid_map["flows"]) == 4
    assert (comp["web"]["runtime"], comp["orchestrator"]["runtime"], comp["rules"]["runtime"]) == ("client", "server", "shared")
    assert {c["id"]: c["nature"] for c in valid_map["components"] if c["nature"] != "product"} == {
        "devtools": "tooling", "harness": "test", "lab": "experiment", "content": "content", "docs": "docs"}
    assert all(c["role"] == "none" and c["decision"]["role"] == {"confidence": None, "flag": None}
               for c in valid_map["components"] if c["nature"] != "product")
    assert comp["store"]["externals"] == [{"name": "better-sqlite3", "count": 2}]
    assert comp["harness"]["hints"]["directory_kind"] == "tests" and comp["harness"]["hints"]["test_file_share"] == 1.0
    assert "layer" not in comp["cli"] and "smells" not in valid_map
    edges = {(e["from"], e["to"]): e for e in valid_map["edges"]["components"]}
    assert edges[("rules", "store")]["finding"] == "core-uses-adapter" and edges[("rules", "store")]["accepted"] is False
    assert edges[("orchestrator", "store")]["finding"] is None and edges[("orchestrator", "store")]["accepted"] is True
    assert edges[("web", "orchestrator")]["finding"] is None and edges[("web", "orchestrator")]["accepted"] is True
    assert edges[("orchestrator", "lab")]["finding"] == "product-uses-support" and edges[("orchestrator", "lab")]["accepted"] is False
    assert edges[("store", "rules")]["accepted"] is None  # adapter -> core points down
    assert edges[("cli", "orchestrator")]["accepted"] is None  # cli -> server is not a wire crossing
    assert edges[("devtools", "rules")]["accepted"] is None  # support code may import product code
    assert edges[("harness", "web")]["test_only"] and edges[("harness", "web")]["accepted"] is None
    assert edges[("cli", "orchestrator")]["reason_source"] == "draft"
    findings = [(h["check"], h["level"], tuple(h["nodes"]), h["accepted"], h["confidence"]) for h in valid_map["health"]]
    assert findings == [
        ("cycle", "components", ("orchestrator", "rules", "store"), False, None),
        ("core-uses-adapter", "components", ("orchestrator", "store"), True, 0.8),
        ("core-uses-adapter", "components", ("rules", "store"), False, 0.2),
        ("crosses-the-wire", "components", ("web", "orchestrator"), True, 0.75),
        ("product-uses-support", "components", ("orchestrator", "lab"), False, None),
        ("cycle", "modules", ("web/state", "web/views"), False, None),
    ]
    by_check = {h["check"]: h for h in valid_map["health"]}
    assert by_check["crosses-the-wire"]["meaning"] == build.MEANINGS["crosses-the-wire"]
    assert by_check["product-uses-support"]["evidence"] == ["packages/orchestrator/src/flows/ingest.ts:3 → prototypes/lab/quick-ingest.ts"]
    assert len(valid_map["health"][0]["evidence"]) == 3  # the component cycle quotes one import per inner edge
    assert build.health_summary(valid_map) == {"checks": 8, "findings": 4, "by_check": {"core-uses-adapter": 1, "cycle": 2, "product-uses-support": 1}}
    assert all(h["headline"] == build.HEADLINES[h["check"]] and h["evidence"] for h in valid_map["health"])
    assert all((h["suggestion"] is None) if h["accepted"] else isinstance(h["suggestion"], str)
               for h in valid_map["health"])
    assert areas["processing"]["counts"] == {"product": 5, "supporting": 2, "runtimes": {"client": 0, "fullstack": 0, "shared": 2, "server": 3, "cli": 0, "build": 0, "none": 0}}
    assert valid_map["system"]["runtime_counts"] == {"client": 1, "fullstack": 0, "shared": 2, "server": 3, "cli": 1, "build": 0, "none": 0}
    area_edges = {(e["from"], e["to"]): e for e in valid_map["edges"]["areas"]}
    assert "domains" not in valid_map["edges"]
    assert area_edges[("operating", "processing")]["count"] == 3
    assert area_edges[("operating", "processing")]["reason"] == "Commands start ingest and publish flows."
    assert area_edges[("build-verify", "processing")]["reason_source"] == "draft"
    assert valid_map["unresolved"] == []
    # lab is experiment code that orchestrator (product) imports: its nature answer contradicts the evidence.
    assert comp["lab"]["decision"]["nature"]["flag"] == "contradicts-evidence" and comp["lab"]["nature"] == "experiment"
    assert comp["devtools"]["decision"]["nature"]["flag"] is None  # tooling nobody in product imports
    assert build.contradictions(valid_map) == [{"component": "lab", "question": "nature", "value": "experiment",
                                                "evidence": "experiment code imported by product components: orchestrator"}]
    mods = {m["id"]: m for m in valid_map["modules"]}
    assert mods["rules/engine"]["name"] == "Rule engine" and mods["rules/engine"]["responsibility_source"] == "draft"
    assert mods["rules/model"]["responsibility_source"] == "draft"  # a module summary from module_summaries
    small = [m for m in valid_map["modules"] if m["responsibility_source"] == "generated"]
    assert small and all(m["responsibility"] for m in small)  # modules too small to need a summary get a generated line


def test_confirmed_quality_results_keep_paths_jobs_and_accepted_exceptions(trio):
    sk, draft, decisions = (copy.deepcopy(part) for part in trio)
    draft["components"]["rules"]["mixed_jobs"] = [
        {"name": "rule compilation", "paths": ["packages/rules/src/engine/compile.ts"]},
        {"name": "domain values", "paths": ["packages/rules/src/model/value.ts"]},
    ]
    sk["edges"]["components"].append({"from": "store", "to": "api", "count": 1, "test_count": 0,
                                       "test_only": False, "examples": ["packages/store/src/sqlite/connection.ts:9 → apps/api/src/server.ts"]})
    decisions["quality"] = {
        "mixed-responsibility|rules": {"check": "mixed-responsibility", "nodes": ["rules"], "accepted": False,
                                        "flag": None, "probability": 0.1},
        "hub-coupling|orchestrator": {"check": "hub-coupling", "nodes": ["orchestrator"], "accepted": True,
                                       "flag": None, "probability": 0.9},
        "upward-dependency|store->api": {"check": "upward-dependency", "nodes": ["store", "api"], "accepted": False,
                                          "flag": None, "probability": 0.2},
        "stability-inversion|rules->store": {"check": "stability-inversion", "nodes": ["rules", "store"],
                                             "accepted": True, "flag": None, "probability": 0.8},
        "upward-dependency|harness->web": {"check": "upward-dependency", "nodes": ["harness", "web"],
                                            "accepted": False, "flag": None, "probability": 0.1},
        "upward-dependency|api->schema": {"check": "upward-dependency", "nodes": ["api", "schema"],
                                           "accepted": False, "flag": None, "probability": 0.1},
        "stability-inversion|store->rules": {"check": "stability-inversion", "nodes": ["store", "rules"],
                                              "accepted": False, "flag": None, "probability": 0.1},
        "hub-coupling|rules": {"check": "hub-coupling", "nodes": ["rules"],
                                "accepted": False, "flag": None, "probability": 0.1},
    }
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    by_check = {(h["check"], tuple(h["nodes"])): h for h in result["health"]}
    mixed = by_check[("mixed-responsibility", ("rules",))]
    assert mixed["jobs"] == draft["components"]["rules"]["mixed_jobs"]
    assert mixed["evidence"] == ["packages/rules/src/engine/compile.ts", "packages/rules/src/model/value.ts"]
    assert "rule compilation" in mixed["suggestion"] and "domain values" in mixed["suggestion"]
    assert by_check[("hub-coupling", ("orchestrator",))]["accepted"] is True
    assert by_check[("hub-coupling", ("orchestrator",))]["suggestion"] is None
    assert by_check[("upward-dependency", ("store", "api"))]["accepted"] is False
    assert by_check[("stability-inversion", ("rules", "store"))]["accepted"] is True
    assert ("upward-dependency", ("harness", "web")) not in by_check
    assert ("upward-dependency", ("api", "schema")) not in by_check
    assert ("stability-inversion", ("store", "rules")) not in by_check
    assert ("hub-coupling", ("rules",)) not in by_check
    edges = {(e["from"], e["to"]): e for e in result["edges"]["components"]}
    assert edges[("store", "api")]["finding"] == "upward-dependency"
    assert edges[("harness", "web")]["finding"] is None and edges[("harness", "web")]["accepted"] is None
    file_roles = {f["path"]: f["test"] for module in result["modules"] for f in module["files"]}
    assert file_roles["tests/harness/src/flows.test.ts"] is True
    assert file_roles["packages/rules/src/engine/compile.ts"] is False
    uncertain = copy.deepcopy(decisions)
    uncertain["quality"]["mixed-responsibility|rules"].update(flag="uncertain", probability=0.5)
    assert not any(h["check"] == "mixed-responsibility" for h in build.build(sk, draft, uncertain)["health"])


def test_new_schema_fields_and_example_fixture_are_valid(valid_map):
    example = json.loads((Path(__file__).resolve().parent.parent / "assets" / "example.map.json").read_text())
    assert build.validate(example) == []
    assert any(h["accepted"] is True for h in example["health"])
    assert all(isinstance(f["test"], bool) for module in example["modules"] for f in module["files"])
    for key in ("headline", "suggestion"):
        broken = copy.deepcopy(valid_map)
        del broken["health"][0][key]
        assert any(f"missing required '{key}'" in error for error in build.validate(broken))
    broken = copy.deepcopy(valid_map)
    del broken["modules"][0]["files"][0]["test"]
    assert any("missing required 'test'" in error for error in build.validate(broken))


def test_unresolved_components_fall_back_flagged_without_crashing(trio):
    sk, draft, decisions = trio
    decisions = copy.deepcopy(decisions)
    resolution = decisions["resolution"]
    resolution["cli"]["area"] = {"value": None, "status": "unresolved", "confidence": 0.5, "reason": "abstain"}
    resolution["web"]["area"] = {"value": None, "status": "unresolved", "confidence": 0.2, "reason": "low confidence (0.20)"}
    resolution["rules"]["role"] = {"value": None, "status": "unresolved", "confidence": None, "reason": "abstain"}
    resolution["store"]["runtime"] = {"value": None, "status": "unresolved", "confidence": 0.3, "reason": "low confidence (0.30)"}
    del resolution["lab"]["nature"]
    result = build.build(sk, draft, decisions)
    # cli and web are unsorted, so operating and reviewing hold no components: that is a validation error, not a crash.
    assert build.validate(result) == ["area operating: holds no components", "area reviewing: holds no components"]
    unsorted = result["areas"][-1]
    assert unsorted["id"] == "unsorted" and unsorted["hue"] is None and unsorted["components"] == ["cli", "web"]
    assert unsorted["counts"]["product"] == 2 and unsorted["runnables"] == ["cli", "web"]
    comp = {c["id"]: c for c in result["components"]}
    assert comp["cli"]["area"] == "unsorted" and comp["cli"]["decision"]["area"]["flag"] == "unresolved"
    assert comp["rules"]["role"] == "core" and comp["rules"]["decision"]["role"]["flag"] == "unresolved"
    assert comp["store"]["runtime"] == "none" and comp["store"]["decision"]["runtime"]["flag"] == "unresolved"
    assert comp["lab"]["nature"] == "product" and comp["lab"]["decision"]["nature"] == {"confidence": None, "flag": "unresolved"}
    assert comp["lab"]["role"] == "core" and comp["lab"]["decision"]["role"]["confidence"] == 0.9  # Jev's recorded role now applies
    assert result["unresolved"] == [
        {"component": "cli", "question": "area", "reason": "abstain"},
        {"component": "lab", "question": "nature", "reason": "missing"},
        {"component": "rules", "question": "role", "reason": "abstain"},
        {"component": "store", "question": "runtime", "reason": "low confidence (0.30)"},
        {"component": "web", "question": "area", "reason": "low confidence (0.20)"},
    ]
    # Checks skip edges whose endpoints lack the attribute they compare; a fallback value never creates a finding.
    checks = {(h["check"], tuple(h["nodes"])) for h in result["health"]}
    assert ("core-uses-adapter", ("rules", "store")) not in checks
    assert ("core-uses-adapter", ("orchestrator", "store")) in checks
    assert ("product-uses-support", ("orchestrator", "lab")) not in checks  # lab's nature is unresolved
    edges = {(e["from"], e["to"]): e for e in result["edges"]["components"]}
    assert edges[("rules", "store")]["finding"] is None and edges[("rules", "store")]["accepted"] is None
    assert result["system"]["runtime_counts"]["none"] == 1


def test_missing_reasons_are_generated_and_marked(trio):
    sk, draft, decisions = trio
    draft = copy.deepcopy(draft)
    draft["edge_reasons"].pop("cli->store")
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    edge = next(e for e in result["edges"]["components"] if (e["from"], e["to"]) == ("cli", "store"))
    assert edge["reason_source"] == "generated" and "depends on" in edge["reason"]


def test_area_answers_map_to_areas_and_old_drafts_are_refused(trio):
    sk, draft, decisions = trio
    decisions = copy.deepcopy(decisions)
    decisions["resolution"]["docs"]["area"]["value"] = "build-verify"  # the map's spelling is accepted too
    decisions["resolution"]["schema"]["area"]["value"] = "nope"
    result = build.build(sk, draft, decisions)
    comp = {c["id"]: c for c in result["components"]}
    assert comp["docs"]["area"] == "build-verify" and comp["docs"]["decision"]["area"]["flag"] is None
    assert comp["schema"]["area"] == "unsorted"
    assert result["unresolved"] == [{"component": "schema", "question": "area", "reason": "unknown_area"}]
    assert build.validate(result) == []
    old = copy.deepcopy(draft)
    old["domain_partitions"] = [{"id": "x", "domains": []}]
    with pytest.raises(build.BuildError, match="domain_partitions"):
        build.build(sk, old, decisions)


def test_runnable_rule():
    base = {"nature": "product", "role": "surface", "runtime": "server", "hints": {"executable": True}}
    assert build.is_runnable(base)
    for runtime in ("client", "cli", "shared"):
        assert build.is_runnable(dict(base, runtime=runtime))
    # a runtime alone is not start evidence: a React component library rendered inside an app is not an app
    assert not build.is_runnable(dict(base, runtime="client", hints={"executable": False}))
    # its own build configuration saying "library" settles it
    assert not build.is_runnable(dict(base, runtime="client", hints={"executable": True, "declared_kind": "library"}))
    # a library with a helper binary (a storage crate with a migration bin) is not what the system runs
    assert not build.is_runnable(dict(base, role="adapter"))
    assert not build.is_runnable(dict(base, nature="tooling"))
    assert not build.is_runnable(dict(base, runtime="build"))


def test_bare_record_list_is_resolved_with_spec_thresholds(trio):
    sk, draft, decisions = trio
    records = copy.deepcopy(decisions["records"])
    for r in records:
        if r["question"] == "area" and r["node"] == "schema":
            r["confidence"] = 0.5  # uncertain
        if r["question"] == "runtime" and r["node"] == "devtools":
            r["confidence"] = 0.3  # unresolved
    result = build.build(sk, draft, records)
    assert build.validate(result) == []
    comp = {c["id"]: c for c in result["components"]}
    assert comp["schema"]["decision"]["area"] == {"confidence": 0.5, "flag": "uncertain"}
    assert comp["devtools"]["runtime"] == "none" and comp["devtools"]["decision"]["runtime"]["flag"] == "unresolved"
    edges = {(e["from"], e["to"]): e for e in result["edges"]["components"]}
    assert edges[("web", "orchestrator")]["accepted"] is True and edges[("rules", "store")]["finding"] == "core-uses-adapter"


def test_runtime_answers_against_the_library_evidence_are_flagged(trio):
    sk, draft, decisions = trio
    sk = copy.deepcopy(sk)
    comp = {c["id"]: c for c in sk["components"]}
    comp["web"]["hints"]["client_libs"], comp["web"]["hints"]["server_libs"] = [], ["express"]  # a "client" with only server libs
    comp["orchestrator"]["hints"]["client_libs"] = ["three"]  # a server with both families: no contradiction
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    by_id = {c["id"]: c for c in result["components"]}
    assert by_id["web"]["decision"]["runtime"] == {"confidence": 0.9, "flag": "contradicts-evidence"}
    assert by_id["orchestrator"]["decision"]["runtime"]["flag"] is None
    assert {(c["component"], c["question"]) for c in build.contradictions(result)} == {("web", "runtime"), ("lab", "nature")}
    assert next(c for c in build.contradictions(result) if c["component"] == "web")["evidence"] == "runtime client but the only runtime libraries are express"
    # An unresolved answer keeps its unresolved flag even when the evidence also argues against the fallback.
    decisions = copy.deepcopy(decisions)
    decisions["resolution"]["web"]["runtime"] = {"value": None, "status": "unresolved", "confidence": 0.2, "reason": "low confidence (0.20)"}
    result = build.build(sk, draft, decisions)
    assert {c["id"]: c for c in result["components"]}["web"]["decision"]["runtime"]["flag"] == "unresolved"


def test_product_component_bound_counts_only_product_code(trio):
    sk, draft, decisions = trio
    decisions = copy.deepcopy(decisions)
    for entry in decisions["resolution"].values():
        entry["area"]["value"] = "processing"
    result = build.build(sk, draft, decisions)
    assert not any("exceeds" in e for e in build.validate(result))  # 7 product + 5 supporting in one area is fine
    broken = copy.deepcopy(result)
    processing = next(a for a in broken["areas"] if a["id"] == "processing")
    for i in range(6):
        clone = copy.deepcopy(next(c for c in broken["components"] if c["id"] == "cli"))
        clone["id"] = f"cli{i}"
        clone["modules"] = []
        broken["components"].append(clone)
        processing["components"].append(clone["id"])
        processing["runnables"].append(clone["id"])
    processing["counts"]["product"] += 6
    assert any("13 product components exceeds 12" in e for e in build.validate(broken))


@pytest.mark.parametrize(
    "mutate, expected",
    [
        (lambda m: m["components"][0].__setitem__("responsibility", ""), "missing responsibility"),
        (lambda m: m["edges"]["components"].append({"from": "cli", "to": "ghost", "reason": "x", "count": 1, "examples": [], "finding": None, "accepted": None}), "dangling"),
        (lambda m: m["components"][0].__setitem__("role", "none"), "nature 'product' with role 'none'"),
        (lambda m: m["components"][0]["decision"]["runtime"].__setitem__("flag", "unresolved"), "flag disagrees"),
        (lambda m: m["health"][0].__setitem__("meaning", "Something else."), "meaning differs"),
        (lambda m: m["system"]["runtime_counts"].__setitem__("cli", 5), "runtime_counts disagree"),
        (lambda m: m["areas"][0]["counts"].__setitem__("supporting", 3), "counts disagree"),
        (lambda m: m["areas"][0].__setitem__("runnables", []), "runnables disagree"),
        (lambda m: m["areas"][3].__setitem__("hue", 10), "area build-verify: hue must be null"),
        (lambda m: m["areas"].pop(3), "missing the implicit build-verify area"),
        (lambda m: m["components"][0].__setitem__("runnable", False), "runnable flag disagrees"),
        (lambda m: m["edges"]["areas"][0].__setitem__("reason", ""), "missing reason"),
        (lambda m: m["edges"]["areas"].append({"from": "operating", "to": "ghost", "reason": "x", "count": 1}), "edge areas operating->ghost: dangling"),
        (lambda m: m["modules"][0]["files"][0].__setitem__("path", "elsewhere/x.ts"), "outside module"),
        (lambda m: m["modules"][0].__setitem__("component", "ghost"), "outside any component"),
        (lambda m: m["system"]["actors"].extend([{"id": f"a{i}", "name": "a", "role": "", "uses": []} for i in range(5)]), "7 actors exceeds 6"),
        (lambda m: m["system"]["actors"][0].__setitem__("uses", ["web", "cli", "orchestrator"]), "uses 3 targets, at most 2"),
        (lambda m: m["system"]["actors"][0].__setitem__("uses", ["rules"]), "uses 'rules', which is neither a runnable component nor an area"),
        (lambda m: m["system"]["externals"].extend([{"id": f"e{i}", "name": "e", "role": "", "kind": "service", "used_by": []} for i in range(7)]), "9 non-devtool externals exceeds 8"),
        (lambda m: m["system"]["externals"][0]["used_by"].append("ghost"), "used_by unknown component 'ghost'"),
        (lambda m: m["flows"].append({"from": "cli", "to": "rules", "label": "x", "kind": "process"}), "flow cli->rules: endpoint 'rules' is not a runnable component, an actor, or an external"),
        (lambda m: m["flows"][0].__setitem__("label", ""), "flow cli->api: missing label"),
        (lambda m: m["system"].__setitem__("purpose", ""), "missing purpose"),
    ],
)
def test_semantic_validation_failures(valid_map, mutate, expected):
    broken = copy.deepcopy(valid_map)
    mutate(broken)
    assert any(expected in error for error in build.validate(broken)), build.validate(broken)


def test_small_and_library_areas_preserve_runnable_flow_rules(trio):
    sk, draft, decisions = trio
    draft = copy.deepcopy(draft)
    draft["areas"] = draft["areas"][:2]
    decisions = copy.deepcopy(decisions)
    for entry in decisions["resolution"].values():
        if entry["area"]["value"] not in ("operating", "reviewing", "build_verify"):
            entry["area"]["value"] = "operating"
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    sk, draft, decisions = trio
    decisions = copy.deepcopy(decisions)
    decisions["resolution"]["api"]["area"]["value"] = "operating"
    result = build.build(sk, draft, decisions)
    assert build.validate(result) == []
    # A core library with an executable hint does not count as the area's runnable, and flows can no longer end at it.
    decisions = copy.deepcopy(trio[2])
    decisions["resolution"]["api"]["role"]["value"] = "core"
    errors = build.validate(build.build(sk, draft, decisions))
    assert not any(e.startswith("area processing") for e in errors)
    assert [e for e in errors if e.startswith("flow")] == [f"flow {f}: endpoint 'api' is not a runnable component, an actor, or an external"
                                                            for f in ("cli->api", "web->api", "api->sqlite")]
    # Actors may use an area, and flows may end at an actor or an external.
    draft = copy.deepcopy(draft)
    draft["system"]["actors"][0]["uses"] = ["operating", "reviewing"]
    draft["system"]["flows"].append({"from": "operator", "to": "browser", "label": "opens", "kind": "process"})
    assert build.validate(build.build(sk, draft, trio[2])) == []


def test_schema_check_reports_structure_errors(valid_map):
    broken = copy.deepcopy(valid_map)
    del broken["components"][0]["metrics"]["loc"]
    broken["areas"][0]["hue"] = "blue"
    broken["system"]["externals"][0]["kind"] = "cloud"
    broken["flows"][0]["kind"] = "radio"
    broken["components"][1]["runtime"] = "wasm"
    broken["components"][2]["role"] = "application"
    broken["health"][0]["check"] = "upward"
    broken["extra"] = 1
    errors = build.validate(broken)
    assert any("missing required 'loc'" in e for e in errors)
    assert any("hue: expected integer|null" in e for e in errors)
    assert any("'wasm' not in" in e for e in errors)
    assert any("'application' not in" in e for e in errors)
    assert any("'upward' not in" in e for e in errors)
    assert any("'cloud' not in" in e for e in errors)
    assert any("'radio' not in" in e for e in errors)
    assert any("unexpected property 'extra'" in e for e in errors)


def test_render_injects_and_escapes(valid_map):
    hostile = copy.deepcopy(valid_map)
    hostile["system"]["purpose"] = "x</script><script>alert(1)</script><!-- y"
    html = build.render(hostile, TEMPLATE)
    assert "/*__CODEMAP_JSON__*/" not in html
    assert "</script><script>alert" not in html
    assert "<\\/script>" in html and "<\\u0021--" in html
    embedded = html[len("<html><script>const MAP = "): html.index(";</script></html>")]
    assert json.loads(embedded) == hostile
    with pytest.raises(build.BuildError):
        build.render(valid_map, "<html></html>")


def test_cli_builds_map_and_html(tmp_path):
    sk = tmp_path / "skeleton.json"
    sk.write_text(json.dumps(skeleton.skeleton(json.loads((FIXTURES / "scan.json").read_text()))))
    template = tmp_path / "viewer.html"
    template.write_text(TEMPLATE)
    out_map, out_html = tmp_path / "map.json", tmp_path / "index.html"
    code = build.main([
        "--skeleton", str(sk), "--draft", str(FIXTURES / "draft.json"), "--decisions", str(FIXTURES / "decisions.json"),
        "--template", str(template), "--output-map", str(out_map), "--output-html", str(out_html)])
    assert code == 0
    assert json.loads(out_map.read_text())["schema"] == "codemap.map/1"
    assert "codemap.map/1" in out_html.read_text()


def test_module_cycles_through_the_root_module_are_not_findings_and_component_findings_sort_first(trio):
    sk, draft, decisions = trio
    sk = json.loads(json.dumps(sk))
    sk["cycles"]["modules"] = [["web/root", "web/state"], ["web/state", "web/views"]]
    result = build.build(sk, draft, decisions)
    module_cycles = [h["nodes"] for h in result["health"] if h["check"] == "cycle" and h["level"] == "modules"]
    assert module_cycles == [["web/state", "web/views"]]
    looped = {m["id"] for m in result["modules"] if m["metrics"].get("in_cycle")}
    assert looped == {"web/state", "web/views"}  # the skipped hub cycle leaves web/root out of any loop
    sk["cycles"]["modules"] = [["web/root", "web/state"]]
    assert not any(m["metrics"].get("in_cycle") for m in build.build(sk, draft, decisions)["modules"])
    assert build.generated_module_text({"id": "g/duels", "path": "game/duels", "merged": ["a", "b"]}) == "Code in game/duels and 2 nearby folders."
    levels = [h["level"] for h in result["health"]]
    assert levels == sorted(levels, key=lambda l: l != "components")


def test_actors_may_use_the_build_verify_area(trio):
    sk, draft, decisions = trio
    draft = json.loads(json.dumps(draft))
    draft["system"]["actors"][0]["uses"] = ["build-verify"]
    assert build.validate(build.build(sk, draft, decisions)) == []


def test_loaded_by_records_links_imports_cannot_see_and_rejects_unknown_ids(trio):
    skel, draft, decisions = copy.deepcopy(trio)
    draft["components"]["rules"]["loaded_by"] = ["web", "rules"]
    comp = {c["id"]: c for c in build.build(skel, draft, decisions)["components"]}
    assert comp["rules"]["loaded_by"] == ["web"]
    assert comp["api"]["loaded_by"] == []
    draft["components"]["rules"]["loaded_by"] = ["web", "ghost-component"]
    with pytest.raises(build.BuildError, match="loaded_by: 'ghost-component' is neither"):
        build.build(skel, draft, decisions)


def test_components_name_the_language_most_of_their_own_lines_use(trio, valid_map):
    comp = {c["id"]: c for c in valid_map["components"]}
    assert comp["api"]["language"] == "TypeScript"
    skel = copy.deepcopy(trio[0])
    mod = next(m for m in skel["modules"] if m["component"] == "api")
    mod["files"] += [{"path": "x/big.gd", "loc": 10_000, "exports": [], "test": False},
                     {"path": "x/gen.sol", "loc": 50_000, "exports": [], "test": False, "provenance": "generated"}]
    assert build.language_of(skel, "api") == "GDScript"  # generated lines do not count


def test_full_stack_apps_never_raise_client_and_server_share_code(trio):
    sk, draft, decisions = copy.deepcopy(trio)
    # web (client) imports api (server) in the fixture: make web a full-stack app and the check no longer applies
    decisions["resolution"]["web"]["runtime"] = {"value": "fullstack", "status": "accepted", "confidence": .9, "reason": None}
    result = build.build(sk, draft, decisions)
    assert not any(h["check"] == "crosses-the-wire" and "web" in h["nodes"] for h in result["health"])
    assert {c["id"]: c["runtime"] for c in result["components"]}["web"] == "fullstack"


def test_an_external_may_not_share_a_component_id(trio):
    skel, draft, decisions = copy.deepcopy(trio)
    draft["system"]["externals"].append({"id": "store", "name": "Store engine", "role": "x", "kind": "service", "used_by": ["api"]})
    errors = build.validate(build.build(skel, draft, decisions))
    assert any("externals[store]: shares its id with a component" in e for e in errors)
