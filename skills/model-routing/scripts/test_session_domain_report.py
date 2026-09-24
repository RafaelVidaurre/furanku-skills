import unittest

import retrospect
import session_domain_report


class SessionDomainReportTest(unittest.TestCase):
    def test_multiple_domains_and_unknowns_are_counted_separately(self):
        rows = [
            {"source_key": "a", "provider": "codex", "model": "gpt-6-sol", "effort": "high",
             "quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
             "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
             "turns": 1, "tool_checks": [{"command": "pytest", "exit_code": 0}],
             "task_family": "one", "involvement": {
                 "implementation": {"choice": "central", "probabilities": {"central": 0.9}},
                 "ux_interaction": {"choice": "supporting"}},
             "quality": {"implementation": {"choice": "3", "probabilities": {"3": 0.8}}, "ux_interaction": {"choice": "unknown"}}},
            {"source_key": "b", "provider": "codex", "model": "gpt-6-sol", "effort": "high",
             "quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
             "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
             "failure_cause": {"implementation": "model_domain_defect"},
             "task_family": "two", "involvement": {"implementation": {"choice": "central", "probabilities": {"central": 0.8}}},
             "quality": {"implementation": {"choice": "1", "probabilities": {"1": 0.8}}}},
        ]
        _, cells, active, unknown, supporting, uncertain, _, _ = session_domain_report.aggregate(
            rows, ["implementation", "ux_interaction"])
        key = ("gpt-6-sol", "high", "implementation")
        self.assertEqual((cells[key]["mean"], active[key], unknown[key]), (2, 2, 0))
        ux = ("gpt-6-sol", "high", "ux_interaction")
        self.assertNotIn(ux, cells)
        self.assertEqual((active[ux], unknown[ux], supporting[ux], uncertain[ux]), (0, 0, 1, 0))

    def test_ambiguous_central_label_is_retained_but_not_scored(self):
        self.assertEqual(session_domain_report.involvement_status(
            {"choice": "central", "probabilities": {"central": 0.68}}), "central_uncertain")

    def test_unverified_context_variant_is_not_a_route_score(self):
        row = {"source_key": "base", "provider": "claude", "model": "claude-fable-5-1", "effort": "high",
               "quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
               "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
               "involvement": {"implementation": {"choice": "central", "probabilities": {"central": 0.9}}},
               "quality": {"implementation": {"choice": "3", "probabilities": {"3": 0.9}}}}
        _, cells, active, unknown, _, _, exclusions, _ = session_domain_report.aggregate(
            [row], ["implementation"], {"base"})
        key = ("claude-fable-5-1", "high", "implementation")
        self.assertEqual((cells, active[key], unknown[key]), ({}, 1, 1))
        self.assertEqual(exclusions[(key, "context_variant_unverified")], 1)

    def test_one_turn_positive_without_check_is_unverified(self):
        row = {"quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
               "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
               "turns": 1, "tool_checks": [],
               "involvement": {"writing": {"choice": "central", "probabilities": {"central": 0.9}}},
               "quality": {"writing": {"choice": "3", "probabilities": {"3": 0.9}}}}
        self.assertEqual(session_domain_report.score_status(row, "writing"), "unverified_positive")

    def test_low_label_without_verified_model_cause_is_unscored(self):
        row = {"quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
               "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
               "involvement": {"debugging": {"choice": "central", "probabilities": {"central": 0.9}}},
               "quality": {"debugging": {"choice": "0", "probabilities": {"0": 0.9}}}}
        self.assertEqual(session_domain_report.score_status(row, "debugging"), "cause_unverified")


if __name__ == "__main__":
    unittest.main()
