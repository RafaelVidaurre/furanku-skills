"""decide() against an injected fake evaluate: batching, thresholds, caching, atomic writes. No network."""

from copy import deepcopy
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import decide as dc
import jev_client as jc


SKELETON = {
    "schema": "codemap.skeleton/1",
    "components": [
        {"id": "ui", "name": "ui", "path": "apps/ui", "kind": "app", "metrics": {"files": 10, "loc": 900}, "modules": ["ui/root"],
         "hints": {"executable": True, "client_libs": ["react"]}},
        {"id": "core", "name": "core", "path": "packages/core", "kind": "package", "metrics": {"files": 20, "loc": 3000}, "modules": ["core/root"]},
        {"id": "store", "name": "store", "path": "packages/store", "kind": "package", "metrics": {"files": 5, "loc": 400}, "modules": ["store/root"]},
        {"id": "devtools", "name": "devtools", "path": "tools/devtools", "kind": "directory", "metrics": {"files": 3, "loc": 100}, "modules": []},
    ],
    "modules": [
        {"id": "ui/root", "component": "ui", "path": "apps/ui/src", "files": [{"path": "apps/ui/src/main.ts", "loc": 20}]},
        {"id": "core/root", "component": "core", "path": "packages/core/src", "files": [{"path": "packages/core/src/index.ts", "loc": 30}]},
        {"id": "store/root", "component": "store", "path": "packages/store/src", "files": [{"path": "packages/store/src/db.ts", "loc": 40}]},
    ],
    "edges": {"components": [
        {"from": "ui", "to": "core", "count": 12, "examples": ["apps/ui/src/main.ts -> packages/core/src/index.ts"]},
        {"from": "core", "to": "store", "count": 4, "examples": []},
        {"from": "store", "to": "ui", "count": 1, "examples": ["packages/store/src/db.ts -> apps/ui/src/main.ts"]},
        {"from": "devtools", "to": "ui", "count": 2, "examples": []},
    ]},
    "externals": [{"name": "react", "count": 30, "files": ["apps/ui/src/main.ts"]},
                  {"name": "sqlite", "count": 3, "files": ["packages/store/src/db.ts"]}],
}
DRAFT = {
    "system": {"name": "Demo", "purpose": "A demo app that shows things and stores them."},
    "areas": [
        {"id": "viewing", "name": "Viewing", "definition": "What viewers use to see things.", "components": ["ui"]},
        {"id": "records", "name": "Records", "definition": "What keeps things.", "components": ["core", "store"]},
    ],
    "components": {
        "ui": {"responsibility": "owns the screens", "why": "no UI", "entry_points": ["apps/ui/src/main.ts"], "evidence": ["apps/ui/README.md"]},
        "core": {"responsibility": "owns the rules", "why": "no logic", "entry_points": [], "evidence": [{"path": "docs/adr/1.md"}]},
        "store": {"responsibility": "owns persistence", "why": "no data", "entry_points": [], "evidence": []},
        "devtools": {"responsibility": "owns dev scripts", "why": "slower dev", "entry_points": [], "evidence": []},
    },
    "edge_reasons": {"ui->core": "screens call rules", "core->store": "rules persist", "store->ui": "store notifies UI"},
    "module_names": {},
}
RUNTIMES = {"ui": "client", "core": "shared", "store": "server", "devtools": "build"}
NATURES = {"ui": "product", "core": "product", "store": "product", "devtools": "tooling"}
ROLES = {"ui": "surface", "core": "core", "store": "adapter", "devtools": "kernel"}
AREAS = {"ui": "viewing", "core": "records", "store": "records", "devtools": "build_verify"}
ATTRIBUTES = {"area": AREAS, "runtime": RUNTIMES, "nature": NATURES, "role": ROLES}
ALL = ["area", "nature", "role", "runtime"]


def node_of(state):
    """The node a request is about: a component id, or "edge" for check pairs."""
    if "from" in state:
        return "edge"
    return state.get("id") or state.get("component", {}).get("id")


class FakeJev:
    """Scripted answers keyed by (node, question); records every request it sees."""

    def __init__(self, confidence=0.9, overrides=None, verdict=0.8, second=None):
        """`second` overrides apply to second-pass requests (state carries neighbor_facts); else `overrides` do."""
        self.confidence, self.overrides, self.verdict, self.second = confidence, overrides or {}, verdict, second or {}
        self.requests = []

    def __call__(self, payload):
        jc.validate_request(payload)
        self.requests.append(payload)
        node = node_of(payload["state"])
        answers, confidence = {}, {}
        for qid, question in payload["questions"].items():
            override = self.overrides.get((node, qid))
            if "neighbor_facts" in payload["state"] and (node, qid) in self.second:
                override = self.second[(node, qid)]
            if question["type"] == "boolean":
                p = override if override is not None else self.verdict
                answers[qid] = {"type": "boolean", "probability": p}
                confidence[qid] = 0.9
                continue
            if override is not None:
                choice, conf = override
            else:
                choice, conf = ATTRIBUTES[qid][node], self.confidence
            keys = list(question["criteria"])
            rest = (1 - 0.7) / (len(keys) - 1)
            answers[qid] = {"type": "choice", "choice": choice, "probabilities": {k: (0.7 if k == choice else rest) for k in keys}}
            confidence[qid] = conf
        return {"model": jc.MODEL, "answers": {k: dict(v, confidence=confidence[k]) for k, v in answers.items()},
                "usage": {"inputTokens": 100, "outputTokens": 10}, "cost_usd": 0.0002, "elapsed_seconds": 0.5}


class DecideTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        env = mock.patch.dict(os.environ, {"HOME": str(self.home), "AI_GATEWAY_API_KEY": "fake-test-key"}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        pacing = mock.patch.object(dc, "MIN_INTERVAL", 0)
        pacing.start()
        self.addCleanup(pacing.stop)

    def test_four_attributes_batched_per_component_and_checks_only_where_they_apply(self):
        fake = FakeJev()
        result = dc.decide(SKELETON, DRAFT, None, evaluate=fake)
        nodes = [(node_of(r["state"]), sorted(r["questions"])) for r in fake.requests]
        self.assertEqual(nodes[:4], [(c, ALL) for c in ("core", "devtools", "store", "ui")])
        # core (core) -> store (adapter) is core-uses-adapter; store (server) -> ui (client) crosses the wire;
        # store (adapter) -> ui (surface) also has an upward-role candidate.
        # ui (client) -> core (shared) and devtools (tooling) -> ui need no new question.
        self.assertEqual(nodes[4:], [("edge", ["core_uses_adapter"]), ("edge", ["crosses_the_wire"]),
                                      ("edge", ["upward_dependency"])])
        self.assertEqual([(r["state"]["from"]["id"], r["state"]["to"]["id"]) for r in fake.requests[4:]],
                         [("core", "store"), ("store", "ui"), ("store", "ui")])
        self.assertEqual(fake.requests[4]["state"]["from"]["role"], "core")
        self.assertEqual(fake.requests[5]["state"]["to"]["runtime"], "client")
        self.assertEqual(fake.requests[5]["state"]["reason"], "store notifies UI")
        self.assertEqual(list(result["edges"]), ["core->store", "store->ui"])
        self.assertEqual(result["edges"]["store->ui"], {"from": "store", "to": "ui", "check": "crosses-the-wire", "accepted": True, "flag": None, "probability": 0.8})
        self.assertEqual(result["edges"]["core->store"]["check"], "core-uses-adapter")
        self.assertNotIn("partition", result)
        for kind, expected in ATTRIBUTES.items():
            self.assertEqual({c: r[kind]["value"] for c, r in result["resolution"].items()}, expected)
        # build_verify is an accepted value like any area, not an unresolved answer.
        self.assertEqual(result["resolution"]["devtools"]["area"], {"value": "build_verify", "status": "accepted", "confidence": 0.9, "reason": None})
        self.assertEqual({c: r["role_applies"] for c, r in result["resolution"].items()}, {"ui": True, "core": True, "store": True, "devtools": False})
        self.assertEqual(result["summary"]["calls_made"], 7)
        self.assertEqual(result["summary"]["calls_cached"], 0)
        self.assertEqual(result["summary"]["unresolved_nodes"], [])
        self.assertEqual(result["summary"]["areas"], 2)
        self.assertEqual(result["summary"]["areas_assigned"], {"build_verify": 1, "records": 2, "viewing": 1})
        self.assertEqual(result["summary"]["runtimes"], {"build": 1, "client": 1, "server": 1, "shared": 1})
        self.assertEqual(result["summary"]["natures"], {"product": 3, "tooling": 1})
        self.assertEqual(result["summary"]["findings"], {"core-uses-adapter": 0, "crosses-the-wire": 0,
                                                           "hub-coupling": 0, "mixed-responsibility": 0,
                                                           "stability-inversion": 0, "upward-dependency": 0})
        self.assertAlmostEqual(result["summary"]["total_cost_usd"], 7 * 0.0002)
        self.assertEqual(len(result["records"]), 19)
        record = next(r for r in result["records"] if r["node"] == "ui" and r["question"] == "area")
        self.assertEqual(set(record), {"node", "question", "fingerprint", "answer", "probabilities", "confidence", "model",
                                       "elapsed_seconds", "cost_usd", "instructions_version", "decided_at"})
        self.assertEqual(record["cost_usd"], 0.00005)

    def test_component_state_is_compact_and_deterministic(self):
        fake = FakeJev()
        dc.decide(SKELETON, DRAFT, None, evaluate=fake)
        ui = next(r for r in fake.requests if r["state"].get("id") == "ui")["state"]
        self.assertEqual(ui["dependencies"], [{"id": "core", "imports": 12, "responsibility": "owns the rules"}])
        self.assertEqual([d["id"] for d in ui["dependents"]], ["devtools", "store"])
        self.assertEqual(ui["externals"], ["react"])
        self.assertEqual(ui["sample_files"], ["apps/ui/src/main.ts"])
        self.assertEqual(ui["loc"], 900)
        self.assertEqual(ui["hints"], {"client_libs": ["react"], "executable": True})
        self.assertEqual(ui["derived"], ["Imported by 2 components: devtools, store", "Imports 1 components: core",
                                         "Imports client libraries: react", "Has an executable entry", "0% of its files are tests"])
        devtools = next(r for r in fake.requests if r["state"].get("id") == "devtools")["state"]
        self.assertEqual(devtools["derived"][:3], ["Imported by no components", "Imports 1 components: ui", "Imports no runtime libraries"])
        core = next(r for r in fake.requests if r["state"].get("id") == "core")["state"]
        self.assertEqual(core["evidence"], ["docs/adr/1.md"])
        area_q = next(r for r in fake.requests if r["state"].get("id") == "ui")["questions"]["area"]
        self.assertEqual(list(area_q["criteria"]), ["viewing", "records", "build_verify", "new_area", "abstain"])
        self.assertEqual(area_q["criteria"]["records"], "Records: What keeps things. Expected members: core, store.")
        self.assertEqual(area_q["criteria"]["build_verify"], dc.BUILD_VERIFY_DEFINITION)
        self.assertEqual(area_q["instructions"], dc.AREA_INSTRUCTIONS)
        questions = next(r for r in fake.requests if r["state"].get("id") == "ui")["questions"]
        self.assertEqual(list(questions["runtime"]["criteria"]), list(dc.RUNTIMES) + ["abstain"])
        self.assertEqual(list(questions["nature"]["criteria"]), list(dc.NATURES) + ["abstain"])
        self.assertEqual(list(questions["role"]["criteria"]), list(dc.ROLES) + ["abstain"])
        self.assertEqual(questions["role"]["criteria"]["kernel"], dc.ROLE_DEFINITIONS["kernel"])
        big = deepcopy(SKELETON)
        big["edges"]["components"] += [{"from": f"dep{i}", "to": "ui", "count": i} for i in range(40)]
        big["components"] += [{"id": f"dep{i}", "name": f"dep{i}", "path": f"p/dep{i}", "kind": "package",
                               "metrics": {"files": 1, "loc": 1}, "modules": []} for i in range(40)]
        draft = deepcopy(DRAFT)
        draft["components"]["ui"]["why"] = "w" * 5000
        fake = FakeJev(overrides={(f"dep{i}", q): ({"area": "viewing", "runtime": "shared", "nature": "product", "role": "kernel"}[q], 0.9)
                                  for i in range(40) for q in ALL})
        dc.decide(big, draft, None, evaluate=fake)
        ui = next(r for r in fake.requests if r["state"].get("id") == "ui")["state"]
        self.assertLessEqual(len(dc.canonical(ui)), dc.MAX_STATE_CHARS)
        self.assertEqual(len(ui["dependents"]), 8)
        self.assertEqual(ui["dependents"][0]["id"], "dep39")

    def test_thresholds_produce_accepted_uncertain_and_unresolved(self):
        fake = FakeJev(overrides={
            ("core", "area"): ("records", 0.5),
            ("store", "area"): ("records", 0.2),
            ("store", "role"): ("abstain", 0.9),
            ("devtools", "area"): ("new_area", 0.8),
            ("devtools", "role"): ("abstain", 0.9),
            ("edge", "core_uses_adapter"): 0.5,
        })
        result = dc.decide(SKELETON, DRAFT, None, evaluate=fake)
        res = result["resolution"]
        self.assertEqual(res["ui"]["area"], {"value": "viewing", "status": "accepted", "confidence": 0.9, "reason": None})
        self.assertEqual(res["core"]["area"], {"value": "records", "status": "uncertain", "confidence": 0.5, "reason": None})
        self.assertEqual(res["store"]["area"]["status"], "unresolved")
        self.assertIn("low confidence", res["store"]["area"]["reason"])
        # store is product with an abstained role: the second pass re-asked it (still abstain) and its answer stands.
        self.assertEqual(res["store"]["role"], {"value": None, "status": "unresolved", "confidence": 0.9, "reason": "abstain", "pass": 2})
        self.assertEqual(res["devtools"]["area"]["reason"], "new_area")
        # devtools is tooling with an accepted nature: its abstained role is recorded, not re-asked, never unresolved.
        self.assertEqual(res["devtools"]["role"]["status"], "unresolved")
        self.assertNotIn("pass", res["devtools"]["role"])
        self.assertEqual(result["summary"]["second_pass"], ["store"])
        self.assertEqual(result["summary"]["unresolved"], 3)
        self.assertEqual([(u["node"], u["question"]) for u in result["summary"]["unresolved_nodes"]],
                         [("devtools", "area"), ("store", "area"), ("store", "role")])
        # the unsure answer is handed to the agent with the two options the evidence must separate
        self.assertEqual(result["summary"]["uncertain_nodes"], [{"node": "core", "question": "area", "torn_between": ["records", "viewing"], "value": "records", "confidence": 0.5}])
        # store has no role, so core->store is not a core-uses-adapter question; store->ui still crosses the wire.
        self.assertEqual(list(result["edges"]), ["store->ui"])
        uncertain = FakeJev(overrides={("edge", "core_uses_adapter"): 0.5})
        result = dc.decide(SKELETON, DRAFT, None, evaluate=uncertain)
        self.assertEqual(result["edges"]["core->store"], {"from": "core", "to": "store", "check": "core-uses-adapter", "accepted": False, "flag": "uncertain", "probability": 0.5})
        rejected = FakeJev(overrides={("edge", "core_uses_adapter"): 0.1, ("edge", "crosses_the_wire"): 0.1})
        result = dc.decide(SKELETON, DRAFT, None, evaluate=rejected)
        self.assertEqual(result["edges"]["store->ui"]["accepted"], False)
        self.assertIsNone(result["edges"]["store->ui"]["flag"])
        self.assertEqual(result["summary"]["findings"], {"core-uses-adapter": 1, "crosses-the-wire": 1,
                                                           "hub-coupling": 0, "mixed-responsibility": 0,
                                                           "stability-inversion": 0, "upward-dependency": 0})

    def test_second_pass_reasks_shaky_attributes_with_neighbor_facts_and_keeps_the_better_answer(self):
        fake = FakeJev(overrides={("store", "runtime"): ("client", 0.5), ("store", "nature"): ("abstain", 0.9), ("ui", "role"): ("adapter", 0.3)},
                       second={("store", "runtime"): ("server", 0.95), ("store", "nature"): ("product", 0.9), ("ui", "role"): ("abstain", 0.9)})
        result = dc.decide(SKELETON, DRAFT, None, evaluate=fake)
        second = [r for r in fake.requests if "neighbor_facts" in r["state"]]
        self.assertEqual([(r["state"]["id"], sorted(r["questions"])) for r in second], [("store", ["nature", "runtime"]), ("ui", ["role"])])
        store_state = second[0]["state"]
        self.assertEqual(store_state["neighbor_facts"]["dependents"], [{"id": "core", "runtime": "shared", "nature": "product"}])
        self.assertEqual(store_state["neighbor_facts"]["dependencies"], [{"id": "ui", "runtime": "client", "nature": "product"}])
        self.assertIn("Imported by 1 product components: core", store_state["derived"])
        self.assertNotIn("neighbor_facts", fake.requests[3]["state"])  # first-round card is unchanged
        res = result["resolution"]
        self.assertEqual(res["store"]["runtime"], {"value": "server", "status": "accepted", "confidence": 0.95, "reason": None, "pass": 2})
        self.assertEqual(res["store"]["nature"]["value"], "product")
        # ui's role: both passes are unresolved, so the better-informed second answer stands and both records stay.
        self.assertEqual(res["ui"]["role"], {"value": None, "status": "unresolved", "confidence": 0.9, "reason": "abstain", "pass": 2})
        ui_roles = [r for r in result["records"] if r["node"] == "ui" and r["question"] == "role"]
        self.assertEqual([r.get("pass", 1) for r in ui_roles], [1, 2])
        self.assertEqual(result["summary"]["second_pass"], ["store", "ui"])
        self.assertEqual(result["summary"]["calls_made"], 4 + 2 + 2)  # cards, second pass, two checks
        # The second-pass answers are cached like any other: a rerun makes no calls and keeps both passes.
        again = FakeJev()
        rerun = dc.decide(SKELETON, DRAFT, result, evaluate=again)
        self.assertEqual(again.requests, [])
        self.assertEqual(rerun["resolution"]["store"]["runtime"]["value"], "server")
        self.assertEqual(sum(1 for r in rerun["records"] if r.get("pass") == 2), 3)

    def test_checks_skip_test_only_edges_and_non_product_components(self):
        skeleton = deepcopy(SKELETON)
        skeleton["edges"]["components"][1]["test_only"] = True  # core -> store only from tests
        fake = FakeJev(overrides={("ui", "nature"): ("experiment", 0.9)})
        result = dc.decide(skeleton, DRAFT, None, evaluate=fake)
        self.assertEqual(result["edges"], {})
        self.assertEqual(result["summary"]["natures"], {"experiment": 1, "product": 2, "tooling": 1})

    def test_mixed_jobs_need_path_evidence_and_a_clear_jev_verdict(self):
        skeleton = deepcopy(SKELETON)
        skeleton["modules"][1]["files"].append({"path": "packages/core/src/notifications.ts", "loc": 20})
        draft = deepcopy(DRAFT)
        draft["components"]["core"]["mixed_jobs"] = [
            {"name": "rules", "paths": ["packages/core/src/index.ts"]},
            {"name": "notifications", "paths": ["packages/core/src/notifications.ts"]},
        ]
        weak = FakeJev(overrides={("core", "mixed_responsibility"): 0.5})
        first = dc.decide(skeleton, draft, None, evaluate=weak)
        self.assertNotIn("mixed-responsibility|core", first["quality"])
        mixed_record = next(r for r in first["records"] if r["node"] == "core" and r["question"] == "mixed_responsibility")
        self.assertEqual(mixed_record["instructions_version"], dc.INSTRUCTIONS_VERSION)
        cached = FakeJev(overrides={("core", "mixed_responsibility"): 0.9})
        second = dc.decide(skeleton, draft, first, evaluate=cached)
        self.assertEqual(cached.requests, [])
        self.assertNotIn("mixed-responsibility|core", second["quality"])
        draft["components"]["core"]["mixed_jobs"][1]["name"] = "delivery notifications"
        confirmed = FakeJev(overrides={("core", "mixed_responsibility"): 0.9})
        third = dc.decide(skeleton, draft, second, evaluate=confirmed)
        self.assertTrue(any("mixed_responsibility" in request["questions"] for request in confirmed.requests))
        self.assertEqual(third["quality"]["mixed-responsibility|core"],
                         {"check": "mixed-responsibility", "nodes": ["core"], "accepted": False,
                          "flag": None, "probability": 0.1})
        changed_record = next(r for r in third["records"] if r["node"] == "core" and r["question"] == "mixed_responsibility")
        self.assertNotEqual(changed_record["fingerprint"], mixed_record["fingerprint"])
        with mock.patch.object(dc, "INSTRUCTIONS_VERSION", dc.INSTRUCTIONS_VERSION + 1):
            versioned = FakeJev(overrides={("core", "mixed_responsibility"): 0.9})
            fourth = dc.decide(skeleton, draft, third, evaluate=versioned)
            self.assertTrue(any("mixed_responsibility" in request["questions"] for request in versioned.requests))
            self.assertEqual(next(r for r in fourth["records"] if r["question"] == "mixed_responsibility")["instructions_version"],
                             dc.INSTRUCTIONS_VERSION)
        invalid = deepcopy(draft)
        invalid["components"]["core"]["mixed_jobs"][1]["paths"] = ["outside/core.ts"]
        with self.assertRaisesRegex(jc.Error, "path is not in component core"):
            dc.decide(skeleton, invalid, None, evaluate=FakeJev())

    def test_topology_candidates_judgment_and_test_only_exclusion(self):
        skeleton = deepcopy(SKELETON)
        for component in skeleton["components"]:
            component["metrics"]["instability"] = {"core": 0.2, "store": 0.8, "ui": 0.2, "devtools": 0.5}[component["id"]]
        fake = FakeJev(overrides={("edge", "upward_dependency"): 0.2,
                                  ("edge", "stability_inversion"): 0.8})
        decided = dc.decide(skeleton, DRAFT, None, evaluate=fake)
        self.assertEqual(decided["quality"]["upward-dependency|store->ui"],
                         {"check": "upward-dependency", "nodes": ["store", "ui"], "accepted": False,
                          "flag": None, "probability": 0.2})
        self.assertEqual(decided["quality"]["stability-inversion|core->store"]["accepted"], True)
        state = next(r["state"] for r in fake.requests if "stability_inversion" in r["questions"])
        self.assertEqual((state["from"]["metrics"]["instability"], state["to"]["metrics"]["instability"]), (0.2, 0.8))
        self.assertNotIn("changes", state["from"]["metrics"])
        weak = FakeJev(overrides={("edge", "upward_dependency"): 0.5,
                                  ("edge", "stability_inversion"): 0.5})
        self.assertEqual(dc.decide(skeleton, DRAFT, None, evaluate=weak)["quality"], {})
        for edge in skeleton["edges"]["components"]:
            if (edge["from"], edge["to"]) in {("core", "store"), ("store", "ui")}:
                edge["test_only"] = True
        test_only = FakeJev()
        self.assertEqual(dc.decide(skeleton, DRAFT, None, evaluate=test_only)["quality"], {})
        self.assertFalse(any("upward_dependency" in r["questions"] or "stability_inversion" in r["questions"]
                             for r in test_only.requests))

    def test_hub_degree_is_a_candidate_and_coherent_hub_can_be_accepted(self):
        skeleton = deepcopy(SKELETON)
        core = next(c for c in skeleton["components"] if c["id"] == "core")
        core["metrics"].update(fan_in=3, fan_out=3, instability=0.5)
        skeleton["edges"]["components"].extend([
            {"from": "core", "to": "ui", "count": 1, "examples": ["core → ui"]},
            {"from": "core", "to": "devtools", "count": 1, "examples": ["core → devtools"]},
            {"from": "devtools", "to": "core", "count": 1, "examples": ["devtools → core"]},
            {"from": "store", "to": "core", "count": 1, "examples": ["store → core"]},
        ])
        bad = dc.decide(skeleton, DRAFT, None, evaluate=FakeJev(overrides={("core", "hub_coupling"): 0.2}))
        self.assertEqual(bad["quality"]["hub-coupling|core"],
                         {"check": "hub-coupling", "nodes": ["core"], "accepted": False,
                          "flag": None, "probability": 0.2})
        good = dc.decide(skeleton, DRAFT, None, evaluate=FakeJev(overrides={("core", "hub_coupling"): 0.8}))
        self.assertTrue(good["quality"]["hub-coupling|core"]["accepted"])
        core["metrics"]["fan_out"] = 2
        no_candidate = FakeJev()
        dc.decide(skeleton, DRAFT, None, evaluate=no_candidate)
        self.assertFalse(any("hub_coupling" in r["questions"] for r in no_candidate.requests))

    def test_second_run_reuses_cache_and_partial_change_reasks_only_the_changed_component(self):
        first = dc.decide(SKELETON, DRAFT, None, evaluate=FakeJev())
        again = FakeJev()
        second = dc.decide(SKELETON, DRAFT, first, evaluate=again)
        self.assertEqual(again.requests, [])
        self.assertEqual(second["summary"]["calls_made"], 0)
        self.assertEqual(second["summary"]["calls_cached"], 19)
        self.assertEqual(second["resolution"], first["resolution"])
        self.assertEqual(sorted(r["fingerprint"] for r in second["records"]), sorted(r["fingerprint"] for r in first["records"]))
        changed = deepcopy(DRAFT)
        changed["components"]["core"]["responsibility"] = "owns the domain rules and the tick loop"
        third_fake = FakeJev()
        third = dc.decide(SKELETON, changed, second, evaluate=third_fake)
        # core's card changed, and its neighbours' cards quote core's responsibility, so they are re-asked too;
        # devtools does not touch core and keeps its cached answers.
        self.assertEqual([(node_of(r["state"]), sorted(r["questions"])) for r in third_fake.requests],
                         [("core", ALL), ("store", ALL), ("ui", ALL), ("edge", ["core_uses_adapter"])])
        self.assertEqual(third_fake.requests[3]["state"]["from"]["id"], "core")
        self.assertEqual(third["summary"]["calls_cached"], 6)  # devtools x4, store->ui verdicts x2

    def test_area_edits_reask_only_area_and_dropped_nodes_are_forgotten(self):
        first = dc.decide(SKELETON, DRAFT, None, evaluate=FakeJev())
        skeleton = deepcopy(SKELETON)
        skeleton["components"] = [c for c in skeleton["components"] if c["id"] != "devtools"]
        skeleton["components"].append({"id": "api", "name": "api", "path": "apps/api", "kind": "app", "metrics": {"files": 2, "loc": 50}, "modules": []})
        draft = deepcopy(DRAFT)
        draft["components"]["api"] = {"responsibility": "owns the HTTP surface", "why": "", "entry_points": [], "evidence": []}
        api = {("api", "area"): ("viewing", 0.9), ("api", "runtime"): ("server", 0.9), ("api", "nature"): ("product", 0.9), ("api", "role"): ("surface", 0.9)}
        fake = FakeJev(overrides=api)
        second = dc.decide(skeleton, draft, first, evaluate=fake)
        # api is new; ui lost devtools as a dependent, so its card changed; core, store, and both checks are cached.
        self.assertEqual([(node_of(r["state"]), sorted(r["questions"])) for r in fake.requests], [("api", ALL), ("ui", ALL)])
        self.assertFalse(any(r["node"] == "devtools" for r in second["records"]))
        self.assertNotIn("devtools", second["resolution"])
        draft["areas"][0]["components"] = ["ui", "api"]
        fake = FakeJev(overrides=api)
        third = dc.decide(skeleton, draft, second, evaluate=fake)
        # Editing an area's expected members or definition changes the area criteria, so only area is re-asked per
        # component while every runtime, nature, and role answer stays cached.
        self.assertEqual([list(r["questions"]) for r in fake.requests], [["area"]] * 4)
        self.assertEqual(third["summary"]["calls_made"], 4)
        self.assertEqual(third["summary"]["calls_cached"], 12 + 3)

    def test_holds_question_carries_or_reasks_after_changes(self):
        first = dc.decide(SKELETON, DRAFT, None, evaluate=FakeJev())
        skeleton = deepcopy(SKELETON)
        skeleton["components"][1]["metrics"]["loc"] = 3500
        changes = {"core": {"files_changed": ["packages/core/src/index.ts"], "summary": "refactored the rules"}}
        fake = FakeJev(overrides={("core", "holds"): 0.9})
        second = dc.decide(skeleton, DRAFT, first, evaluate=fake, changes=changes)
        self.assertEqual([sorted(r["questions"]) for r in fake.requests], [["holds"]])
        self.assertEqual(fake.requests[0]["state"]["previous"], {"area": "records", "runtime": "shared", "nature": "product", "role": "core"})
        self.assertEqual(fake.requests[0]["state"]["changes"], changes["core"])
        self.assertEqual(second["resolution"]["core"]["area"]["value"], "records")
        carried = next(r for r in second["records"] if r["node"] == "core" and r["question"] == "role")
        self.assertIn("held_from", carried)
        self.assertEqual(second["summary"]["calls_made"], 1)
        fake = FakeJev(overrides={("core", "holds"): 0.2, ("core", "role"): ("kernel", 0.9)})
        third = dc.decide(skeleton, DRAFT, first, evaluate=fake, changes=changes)
        self.assertEqual([sorted(r["questions"]) for r in fake.requests], [["holds"], ALL, ["upward_dependency"]])
        self.assertEqual(third["resolution"]["core"]["role"]["value"], "kernel")
        unchanged = FakeJev()
        dc.decide(SKELETON, DRAFT, first, evaluate=unchanged, changes={"ui": "touched"})
        self.assertEqual(unchanged.requests, [])

    def test_dry_run_prints_requests_without_evaluating(self):
        fake = FakeJev()
        result = dc.decide(SKELETON, DRAFT, None, evaluate=fake, dry_run=True, require_zdr=True)
        self.assertEqual(fake.requests, [])
        self.assertEqual([r["node"] for r in result["requests"]], ["core", "devtools", "store", "ui"])
        self.assertTrue(all(r["request"]["providerOptions"]["gateway"]["zeroDataRetention"] for r in result["requests"]))

    def test_failure_saves_partial_cache_and_a_rerun_resumes_from_it(self):
        store = self.home / "map"
        store.mkdir()
        (store / "skeleton.json").write_text(json.dumps(SKELETON))
        (store / "draft.json").write_text(json.dumps(DRAFT))
        decisions = store / "decisions.json"
        calls = []

        def failing(payload):
            calls.append(payload)
            if len(calls) == 3:
                raise jc.Error("Gateway HTTP 401: check the saved Gateway key")
            return FakeJev()(payload)

        with mock.patch("urllib.request.OpenerDirector.open") as transport, mock.patch.object(dc.jev_client, "evaluate", failing), \
                mock.patch.object(dc, "_sleep"), mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            code = dc.main(["--skeleton", str(store / "skeleton.json"), "--draft", str(store / "draft.json"),
                            "--decisions", str(decisions)])
        transport.assert_not_called()
        self.assertEqual(code, 1)
        self.assertIn("Progress was saved", json.loads(err.getvalue())["error"])
        partial = json.loads(decisions.read_text())
        self.assertTrue(partial["partial"])
        self.assertEqual(len(partial["records"]), 8)  # two components' four attributes
        self.assertNotIn("resolution", partial)
        self.assertEqual(sorted(store.iterdir()), sorted([store / "skeleton.json", store / "draft.json", decisions]))
        fake = FakeJev()
        with mock.patch.object(dc.jev_client, "evaluate", fake), mock.patch.object(dc, "_sleep"), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            code = dc.main(["--skeleton", str(store / "skeleton.json"), "--draft", str(store / "draft.json"), "--decisions", str(decisions)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["status"], "decided")
        written = json.loads(decisions.read_text())
        self.assertEqual(written["schema"], dc.SCHEMA)
        self.assertNotIn("partial", written)
        self.assertEqual(written["summary"]["calls_made"], 5)
        self.assertEqual(written["summary"]["calls_cached"], 8)

    def test_a_stopped_run_keeps_its_answers_and_long_runs_checkpoint(self):
        calls, saved = [], []

        def stopped(payload):
            calls.append(payload)
            if len(calls) == 3:
                raise KeyboardInterrupt  # Ctrl-C, or the SIGTERM a harness timeout sends, mapped by the CLI
            return FakeJev()(payload)

        with mock.patch.object(dc, "_sleep"), mock.patch.object(dc, "CHECKPOINT_EVERY", 1):
            with self.assertRaises(dc.Interrupted) as caught:
                dc.decide(SKELETON, DRAFT, None, evaluate=stopped, checkpoint=saved.append)
        self.assertEqual(len(caught.exception.records), 8)  # the two answered components survive
        self.assertEqual([len(records) for records in saved], [4, 8])


    def test_rate_limits_are_retried_with_backoff_and_other_errors_are_not(self):
        attempts = []

        def flaky(payload):
            attempts.append(payload)
            if len(attempts) < 3:
                raise jc.Error("Gateway HTTP 429: rate limited" if len(attempts) == 1 else "Gateway HTTP 503: evaluation failed")
            return FakeJev()(payload)

        with mock.patch.object(dc, "_sleep") as sleep:
            result = dc.decide(SKELETON, DRAFT, None, evaluate=flaky)
        self.assertEqual(result["summary"]["calls_made"], 7)
        self.assertEqual([c.args[0] for c in sleep.call_args_list if c.args[0] >= 1], [2, 4])

        def broken(payload):
            raise jc.Error("Gateway HTTP 401: check the saved Gateway key")

        with mock.patch.object(dc, "_sleep") as sleep, self.assertRaises(dc.Interrupted):
            dc.decide(SKELETON, DRAFT, None, evaluate=broken)
        self.assertFalse(any(c.args[0] >= 1 for c in sleep.call_args_list))

    def test_cli_dry_run_writes_nothing_and_prints_one_request_per_line(self):
        store = self.home / "map"
        store.mkdir()
        (store / "skeleton.json").write_text(json.dumps(SKELETON))
        (store / "draft.json").write_text(json.dumps(DRAFT))
        with mock.patch("urllib.request.OpenerDirector.open") as transport, \
                mock.patch("sys.stdout", new_callable=io.StringIO) as out, \
                mock.patch("sys.stderr", new_callable=io.StringIO):
            code = dc.main(["--skeleton", str(store / "skeleton.json"), "--draft", str(store / "draft.json"),
                            "--decisions", str(store / "decisions.json"), "--dry-run"])
        self.assertEqual(code, 0)
        transport.assert_not_called()
        lines = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[0]["request"]["questions"]["area"]["instructions"], dc.AREA_INSTRUCTIONS)
        self.assertFalse((store / "decisions.json").exists())

    def test_fingerprint_covers_question_version_state_and_criteria(self):
        base = dc.fingerprint("area", {"id": "x"}, {"a": "A"})
        self.assertNotEqual(base, dc.fingerprint("runtime", {"id": "x"}, {"a": "A"}))
        self.assertNotEqual(base, dc.fingerprint("area", {"id": "y"}, {"a": "A"}))
        self.assertNotEqual(base, dc.fingerprint("area", {"id": "x"}, {"a": "B"}))
        with mock.patch.object(dc, "INSTRUCTIONS_VERSION", dc.INSTRUCTIONS_VERSION + 1):
            self.assertNotEqual(base, dc.fingerprint("area", {"id": "x"}, {"a": "A"}))
        self.assertEqual(base, dc.fingerprint("area", {"id": "x"}, {"a": "A"}))

    def test_invalid_inputs_are_rejected(self):
        with self.assertRaises(jc.Error):
            dc.decide({"components": []}, DRAFT, None, evaluate=FakeJev())
        for reserved in ("abstain", "new_area", "build_verify", "build-verify", "unsorted"):
            bad = deepcopy(DRAFT)
            bad["areas"][0]["id"] = reserved
            with self.assertRaisesRegex(jc.Error, "reserved"):
                dc.decide(SKELETON, bad, None, evaluate=FakeJev())
        bad = deepcopy(DRAFT)
        bad["areas"] = []
        with self.assertRaisesRegex(jc.Error, "no areas"):
            dc.decide(SKELETON, bad, None, evaluate=FakeJev())
        old = deepcopy(DRAFT)
        old["domain_partitions"] = old.pop("areas")
        with self.assertRaisesRegex(jc.Error, "domain_partitions"):
            dc.decide(SKELETON, old, None, evaluate=FakeJev())


if __name__ == "__main__":
    unittest.main()


class DerivedRuntimeTest(unittest.TestCase):
    def test_supporting_code_runs_at_build_time_without_asking_twice(self):
        draft = deepcopy(DRAFT)
        draft["components"]["devtools"]["runs"] = "Developers run it from a terminal; nothing ships it."
        fake = FakeJev(overrides={("devtools", "runtime"): ("cli", 0.5)})
        result = dc.decide(SKELETON, draft, None, evaluate=fake)
        runtime = result["resolution"]["devtools"]["runtime"]
        self.assertEqual((runtime["value"], runtime["status"]), ("build", "accepted"))
        self.assertIn("tooling", runtime["derived"])
        # no second pass for a runtime the nature settles, and nothing left for the agent to clarify
        self.assertEqual(result["summary"]["second_pass"], [])
        self.assertEqual(result["summary"]["uncertain_nodes"], [])
        card = next(r for r in fake.requests if r["state"].get("id") == "devtools")["state"]
        self.assertEqual(card["runs"], "Developers run it from a terminal; nothing ships it.")


class ProviderFailureTest(unittest.TestCase):
    def test_one_card_the_provider_cannot_evaluate_is_skipped_but_an_outage_stops_the_run(self):
        def picky(payload):
            if payload["state"].get("id") == "store":
                raise jc.Error("Gateway HTTP 503: evaluation failed; no fallback was used.")
            return FakeJev()(payload)

        with mock.patch.object(dc, "_sleep"):
            result = dc.decide(SKELETON, DRAFT, None, evaluate=picky)
        self.assertEqual([f["node"] for f in result["summary"]["provider_failures"]], ["store"])
        self.assertEqual({result["resolution"]["store"][k]["reason"] for k in dc.COMPONENT_QUESTIONS}, {"provider_error"})
        self.assertEqual(result["resolution"]["ui"]["area"]["status"], "accepted")
        self.assertFalse(any(r["node"] == "store" for r in result["records"]))  # nothing cached: the next run asks again

        def down(payload):
            raise jc.Error("Gateway HTTP 503: evaluation failed; no fallback was used.")

        with mock.patch.object(dc, "_sleep"), self.assertRaises(dc.Interrupted):
            dc.decide(SKELETON, DRAFT, None, evaluate=down)


class CompactFallbackTest(unittest.TestCase):
    def test_a_card_the_provider_fails_is_answered_from_its_compact_form_and_cached(self):
        def picky(payload):
            state = payload["state"]
            if state.get("id") == "ui" and any(isinstance(v, list) and len(v) > 2 for v in state.values()):
                raise jc.Error("Gateway HTTP 503: evaluation failed; no fallback was used.")
            return FakeJev()(payload)

        draft = deepcopy(DRAFT)
        draft["components"]["ui"]["entry_points"] = ["a.ts", "b.ts", "c.ts", "d.ts"]
        with mock.patch.object(dc, "_sleep"):
            result = dc.decide(SKELETON, draft, None, evaluate=picky)
        self.assertEqual(result["summary"]["compacted"], ["ui"])
        self.assertEqual(result["summary"]["provider_failures"], [])
        self.assertEqual(result["resolution"]["ui"]["area"]["status"], "accepted")
        ui = [r for r in result["records"] if r["node"] == "ui"]
        self.assertTrue(ui and all(r.get("compact") for r in ui))
        # the next run reuses the compact answers without calling the provider for ui again
        again = []
        with mock.patch.object(dc, "_sleep"):
            dc.decide(SKELETON, draft, result, evaluate=lambda p: again.append(p["state"].get("id")) or FakeJev()(p))
        self.assertNotIn("ui", again)


class ProgressTest(unittest.TestCase):
    def test_decide_reports_bounded_progress_without_provider_text(self):
        stream = io.StringIO()
        with mock.patch.object(dc, "_progress_stream", stream), mock.patch.object(dc, "_started", [None]):
            dc.decide(SKELETON, DRAFT, None, evaluate=FakeJev())
        lines = [json.loads(l) for l in stream.getvalue().splitlines()]
        phases = [l["progress"] for l in lines]
        self.assertEqual(phases[0], "components")
        self.assertIn("checks", phases)
        done = [l for l in lines if l["progress"] == "components" and l["done"] == l["total"]]
        self.assertTrue(done and all("elapsed_seconds" in l and "calls" in l for l in done))
