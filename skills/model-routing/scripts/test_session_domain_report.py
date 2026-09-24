import unittest

import retrospect
import session_domain_report


class SessionDomainReportTest(unittest.TestCase):
    def test_multiple_domains_and_unknowns_are_counted_separately(self):
        rows = [
            {"source_key": "a", "provider": "codex", "model": "gpt-6-sol", "effort": "high",
             "quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
             "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
             "task_family": "one", "involvement": {
                 "implementation": {"choice": "central", "probabilities": {"central": 0.9}},
                 "ux_interaction": {"choice": "supporting"}},
             "quality": {"implementation": {"choice": "3", "probabilities": {"3": 0.8}}, "ux_interaction": {"choice": "unknown"}}},
            {"source_key": "b", "provider": "codex", "model": "gpt-6-sol", "effort": "high",
             "quality_rubric_version": retrospect.QUALITY_RUBRIC_VERSION,
             "delegated_work": False, "attribution": "turn_verified", "omitted_turns": 0,
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


if __name__ == "__main__":
    unittest.main()
