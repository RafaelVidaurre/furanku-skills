import copy
import tempfile
import unittest
from pathlib import Path

from assessment_store import Store, validate_result
from domain_assess import RUBRIC, prepare, report


class DomainAssessmentTest(unittest.TestCase):
    def setUp(self):
        self.job = {"session_ref": "codex:synthetic", "source_sha256": "a" * 64,
                    "procedure": RUBRIC, "scope": "task", "scope_id": "task",
                    "attribution": {"model": "example", "effort": "high"},
                    "packet": {"rubric": RUBRIC, "domain_taxonomy": {"domains": [
                        {"id": "documentation", "name": "Technical documentation"}]},
                        "cases": [{"id": "task", "state": {"requirements": [{"id": "r1"}],
                            "sources": [{"id": "s1", "kind": "response", "body": "Guide contents"}]}}]}}
        self.result = {"version": 1, "cases": [{"id": "task", "artifact_source_ids": ["s1"],
            "repairs": [], "requirements": [{"id": "r1", "verdict": "met", "source_ids": ["s1"],
                "rationale": "Guide satisfies requested criteria", "kind": "deliverable",
                "applicability": "applicable", "applicability_rationale": "Requested guide",
                "cause": "none", "domain_ids": ["documentation"]}], "domains": [
                    {"id": "documentation", "role": "central", "rationale": "Requested guide",
                     "score": 3, "confidence": "high", "score_rationale": "Visible guide meets criteria",
                     "requirement_ids": ["r1"], "source_ids": ["s1"]}]}]}

    def test_blockers_and_process_compliance_cannot_inflate_outcome_score(self):
        for change in ({"verdict": "unknown", "cause": "external"},
                       {"kind": "process"}, {"applicability": "inapplicable"}):
            result = copy.deepcopy(self.result)
            result["cases"][0]["requirements"][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_result(self.job, result)
        result = copy.deepcopy(self.result)
        result["cases"][0]["requirements"][0].update(verdict="unknown", cause="external")
        result["cases"][0]["domains"][0]["score"] = None
        validate_result(self.job, result)
        rows = report([self.job], [result])
        self.assertEqual(0, rows["scored_domain_observations"])
        self.assertIsNone(rows["rows"][0]["score"])

    def test_missing_deliverable_and_invented_support_cannot_complete(self):
        for field, value in (("requirement_ids", []), ("source_ids", ["invented"]),
                             ("score", False), ("score", 0), ("role", "absent")):
            result = copy.deepcopy(self.result)
            result["cases"][0]["domains"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_result(self.job, result)

    def test_preparation_requires_one_known_current_actor_and_copies_sources(self):
        source = {"id": "s1", "kind": "response", "body": "Actual contents",
                  "actor_id": "actor1", "ownership": "current_session"}
        native = {"session_ref": "codex:synthetic", "source_sha256": "a" * 64,
                  "attribution": {"actor1": {"model": "example", "effort": "high", "provenance": "turn_metadata"}},
                  "packet": {"sources": [{"id": "q1", "kind": "request", "body": "Write guide"}, source],
                             "turns": [{"request_id": "q1", "event_ids": ["s1"], "context_ids": []}]}}
        extracted = {"version": 1, "tasks": [{"id": "task", "title": "Guide", "request_ids": ["q1"],
                     "event_ids": ["s1"], "context_ids": [], "requirements": [
                         {"id": "r1", "text": "Write guide", "source_ids": ["q1"]}]}],
                     "request_links": [{"id": "q1", "task_ids": ["task"], "role": "request", "rationale": "Opening"}],
                     "unassigned_events": []}
        output = prepare(native, extracted)
        self.assertEqual(source, output["jobs"][0]["packet"]["cases"][0]["state"]["sources"][1])
        self.assertEqual(21, len(output["jobs"][0]["packet"]["domain_taxonomy"]["domains"]))
        retired = prepare(native, extracted, eligible_pairs=set())
        self.assertEqual([], retired["jobs"])
        self.assertEqual("model_effort_no_longer_configured", retired["excluded_tasks"][0]["reason"])
        self.assertEqual(1, len(prepare(native, extracted, eligible_pairs={("example", "high")})["jobs"]))
        control = copy.deepcopy(native)
        control["attribution"]["harness"] = {"model": "<synthetic>", "effort": None, "provenance": "turn_metadata"}
        control["packet"]["sources"].append({"id": "s2", "kind": "response", "body": "No response requested.",
                                              "actor_id": "harness", "ownership": "current_session"})
        control["packet"]["turns"][0]["event_ids"].append("s2")
        control_result = copy.deepcopy(extracted)
        control_result["tasks"][0]["event_ids"].append("s2")
        prepared = prepare(control, control_result)
        self.assertEqual(1, len(prepared["jobs"]))
        self.assertEqual(["s2"], prepared["jobs"][0]["packet"]["cases"][0]["state"]["harness_control_source_ids"])
        for ownership in ("inherited_context", "unknown", None):
            changed = copy.deepcopy(native)
            changed["packet"]["sources"][1]["ownership"] = ownership
            self.assertEqual([], prepare(changed, extracted)["jobs"])
        native["attribution"]["actor1"]["provenance"] = "session_summary_only"
        self.assertEqual([], prepare(native, extracted)["jobs"])

    def test_extra_defect_is_separate_from_requirement_completion_and_inherited_fault(self):
        result = copy.deepcopy(self.result)
        case = result["cases"][0]
        case["domains"][0]["score"] = 2
        case["defects"] = [{"source_ids": ["s1"], "domain_ids": ["documentation"],
                            "severity": "minor", "responsibility": "reasserted", "rationale": "Incorrect added claim"}]
        validate_result(self.job, result)
        case["defects"][0]["responsibility"] = "inherited"
        with self.assertRaises(ValueError):
            validate_result(self.job, result)
        case["defects"][0]["responsibility"] = "introduced"
        case["domains"][0]["score"] = 3
        with self.assertRaises(ValueError):
            validate_result(self.job, result)

    def test_report_rejects_duplicate_samples_and_ledger_reuses_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "ledger.sqlite3")
            try:
                token = store.claim(self.job)["claim"]
                store.finish(token, result=self.result)
                cached = store.claim(self.job)
                self.assertEqual("skip_completed", cached["action"])
                output = report([self.job], [cached["result"]])
                self.assertEqual((1, 1, 1, "unreviewed"), (output["sessions"], output["tasks"],
                    output["scored_domain_observations"], output["semantic_status"]))
                with self.assertRaises(ValueError):
                    report([self.job, self.job], [self.result, self.result])
                revised = copy.deepcopy(self.job)
                revised["source_sha256"] = "b" * 64
                with self.assertRaises(ValueError):
                    report([self.job, revised], [self.result, self.result])
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
