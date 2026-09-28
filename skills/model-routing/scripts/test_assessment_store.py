import copy
from pathlib import Path
import tempfile
import unittest

from assessment_store import Store


class AssessmentStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "private" / "assessments.sqlite3"
        self.store = Store(self.path)
        self.addCleanup(self.store.close)
        self.job = {
            "session_ref": "codex:native-example", "source_sha256": "a" * 64,
            "procedure": "sol-medium-v1", "scope": "task", "scope_id": "task1",
            "packet": {"cases": [{"id": "task1", "state": {
                "requirements": [{"id": "r1", "text": "Return the count"}],
                "sources": [{"id": "s1", "text": "2"}],
            }}], "domain_taxonomy": {"domains": [{"id": "verification", "description": "Review"}]}},
        }
        self.result = {"version": 1, "cases": [{"id": "task1", "requirements": [
            {"id": "r1", "verdict": "met", "source_ids": ["s1"], "rationale": "Count is correct"}
        ], "domains": [{"id": "verification", "role": "central", "rationale": "Requested review"}]}]}

    def completed(self):
        claim = self.store.claim(self.job)["claim"]
        self.store.finish(claim, result=self.result)
        return claim

    def test_completed_result_survives_reopen_and_is_reused(self):
        token = self.completed()
        other = Store(self.path)
        self.addCleanup(other.close)
        cached = other.claim(self.job)
        self.assertEqual(("skip_completed", token, self.result, "unreviewed"),
                         (cached["action"], cached["claim"], cached["result"], cached["semantic_status"]))
        self.assertEqual(0o600, self.path.stat().st_mode & 0o777)

    def test_procedure_taxonomy_and_preparation_changes_require_explicit_reassessment(self):
        token = self.completed()
        self.job["procedure"] = "sol-medium-v2"
        self.job["packet"]["domain_taxonomy"]["domains"][0]["description"] = "Revised rubric"
        self.job["attribution"] = {"model": "corrected-model"}
        cached = self.store.claim(self.job)
        self.assertEqual("skip_completed", cached["action"])
        self.assertTrue(cached["procedure_changed"])
        self.assertTrue(cached["preparation_changed"])
        new = self.store.claim(self.job, reassess=True)
        self.assertEqual("assess", new["action"])
        self.assertNotEqual(token, new["claim"])

    def test_new_source_revision_is_new_work(self):
        self.completed()
        self.job["source_sha256"] = "b" * 64
        self.assertEqual("assess", self.store.claim(self.job)["action"])

    def test_failed_work_retries_and_old_token_cannot_complete(self):
        first = self.store.claim(self.job)["claim"]
        self.store.finish(first, error="Assessor transport unavailable")
        second = self.store.claim(self.job)
        self.assertEqual("assess", second["action"])
        self.assertNotEqual(first, second["claim"])
        with self.assertRaises(ValueError):
            self.store.finish(first, result=self.result)
        self.assertEqual(first, self.store.status()[0]["parent_claim"])

    def test_failed_explicit_reassessment_retries_instead_of_old_cache(self):
        self.completed()
        failed = self.store.claim(self.job, reassess=True)["claim"]
        self.store.finish(failed, error="Interrupted")
        new = self.store.claim(self.job)
        self.assertEqual("assess", new["action"])
        self.assertEqual(failed, self.store.status()[0]["parent_claim"])

    def test_retry_does_not_silently_change_failed_job(self):
        token = self.store.claim(self.job)["claim"]
        self.store.finish(token, error="Interrupted")
        self.job["procedure"] = "different-assessor"
        with self.assertRaises(ValueError):
            self.store.claim(self.job)
        self.assertEqual("assess", self.store.claim(self.job, reassess=True)["action"])

    def test_live_claim_blocks_second_connection_even_with_reassess(self):
        first = self.store.claim(self.job)["claim"]
        other = Store(self.path)
        self.addCleanup(other.close)
        self.assertEqual({"action": "in_progress", "claim": first}, other.claim(self.job, reassess=True))

    def test_task_sample_does_not_complete_entire_session(self):
        self.completed()
        self.job.update(scope="session", scope_id="")
        self.assertEqual("needs_scope_review", self.store.claim(self.job)["action"])
        self.assertEqual("task", self.store.status()[0]["scope"])

    def test_renamed_task_cannot_silently_reassess_but_disjoint_task_can(self):
        self.job["request_ids"] = ["L10"]
        self.completed()
        self.job["scope_id"] = "new-extractor-name"
        self.assertEqual("needs_scope_review", self.store.claim(self.job)["action"])
        self.job["request_ids"] = ["L20"]
        self.assertEqual("assess", self.store.claim(self.job)["action"])

    def test_invalid_results_leave_claim_running_for_recovery(self):
        token = self.store.claim(self.job)["claim"]
        variants = []
        for field in ("requirements", "domains"):
            result = copy.deepcopy(self.result)
            result["cases"][0][field] = []
            variants.append(result)
        for sources in ([], ["nonexistent"], ["s1", "s1"]):
            result = copy.deepcopy(self.result)
            result["cases"][0]["requirements"][0]["source_ids"] = sources
            variants.append(result)
        for result in variants:
            with self.subTest(result=result), self.assertRaises(ValueError):
                self.store.finish(token, result=result)
        self.assertEqual("in_progress", self.store.claim(self.job)["action"])
        self.store.finish(token, result=self.result)
        with self.assertRaises(ValueError):
            self.store.finish(token, error="Stale worker")


if __name__ == "__main__":
    unittest.main()
