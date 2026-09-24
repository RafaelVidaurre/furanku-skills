import unittest

import performance_report


def result(domain="implementation", score="3", evidence="independent_check", cause=None):
    return {
        "model": "gpt-6-sol", "effort": "high", "source_key": "one",
        "rubric": performance_report.RUBRIC,
        "delegated_work": False,
        "domain": {"choice": domain}, "effective_domain": domain,
        "quality": {"choice": score}, "effective_quality": score,
        "evidence": {"choice": evidence},
        "tool_evidence": [{"command": "pytest -q", "summary": ["2 passed"], "test_invocation": True, "exit_code": 0}],
        "cause": {"choice": cause or ("model_domain_defect" if score in ("0", "1", "2")
                                      else "no_problem_visible")},
    }


class PerformanceReportTest(unittest.TestCase):
    def test_evidence_gate_is_symmetric_for_high_and_low_scores(self):
        for score in ("0", "3"):
            row = result(score=score, evidence="self_report")
            observed, reason = performance_report.observation(row)
            self.assertIsNone(observed)
            self.assertEqual(reason, "quality_evidence_missing")
        low, reason = performance_report.observation(result(score="0", evidence="visible_output"))
        self.assertIsNone(reason)
        self.assertEqual((low["score"], low["weight"]), (0, 0.5))

    def test_external_failure_and_unverified_quality_are_not_model_scores(self):
        row = result(score="0", cause="external_blocker")
        self.assertEqual(performance_report.observation(row)[1], "failure_cause_not_model_domain")
        row = result(score="unverified")
        self.assertEqual(performance_report.observation(row)[1], "unverified")

    def test_check_must_be_structured_and_sensory_artifact_needs_feedback(self):
        row = result()
        row["tool_evidence"] = []
        self.assertEqual(performance_report.observation(row)[1], "independent_check_unconfirmed")
        row = result(domain="visual_art", evidence="visible_output")
        self.assertEqual(performance_report.observation(row)[1], "sensory_artifact_unseen")
        row = result(domain="visual_art", score="1", evidence="direct_feedback")
        self.assertEqual(performance_report.observation(row)[0]["score"], 1)

    def test_delegated_parent_work_is_not_credited_to_its_model(self):
        row = result()
        row["delegated_work"] = True
        self.assertEqual(performance_report.observation(row)[1], "delegated_or_unchecked")

    def test_passing_summary_with_failed_or_unfinished_process_is_not_support(self):
        row = result()
        row["tool_evidence"][0]["exit_code"] = None
        self.assertEqual(performance_report.observation(row)[1], "independent_check_unconfirmed")
        row["tool_evidence"][0]["exit_code"] = 1
        self.assertEqual(performance_report.observation(row)[1], "independent_check_unconfirmed")
        row["tool_evidence"][0]["exit_code"] = 0
        row["tool_evidence"][0]["summary"] = ["11/12 passed"]
        self.assertEqual(performance_report.observation(row)[1], "independent_check_unconfirmed")

    def test_repeated_task_template_has_capped_evidence_weight(self):
        rows = []
        for index in range(20):
            row = result()
            row["source_key"] = str(index)
            row["task_family"] = "same-template"
            rows.append(row)
        cells, _ = performance_report.summaries(rows)
        cell = cells[("gpt-6-sol", "high", "implementation")]
        self.assertEqual(cell["sessions"], 20)
        self.assertEqual(cell["families"], 1)
        self.assertEqual(cell["evidence_weighted_n"], 5)
        self.assertIsNone(cell["family_interval_90"])

    def test_latest_result_wins_on_resume(self):
        earlier = result(score="0")
        corrected = result(score="3")
        cells, _ = performance_report.summaries([earlier, corrected])
        self.assertEqual(cells[("gpt-6-sol", "high", "implementation")]["mean_score"], 3)


if __name__ == "__main__":
    unittest.main()
