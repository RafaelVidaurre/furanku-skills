import unittest
import jev_deliverable_probe as probe


class ProbeContracts(unittest.TestCase):
    def test_reference_and_identity_do_not_enter_candidate_state(self):
        state = dict.fromkeys(probe.STATE_FIELDS, "source")
        case = {"state": state, "expected": {"class": "good"}, "audit": "secret oracle"}
        self.assertEqual(probe.candidate_state(case), state)
        case["state"]["expected"] = "good"
        with self.assertRaises(ValueError):
            probe.candidate_state(case)

    def test_ambiguous_and_missing_are_distinct_from_defective(self):
        ambiguous = {"choice": "quality_2", "probabilities": {"quality_2": .51, "quality_3": .49}}
        missing = {"choice": "unknown", "probabilities": {"unknown": .9, "quality_0": .1}}
        defective = {"choice": "quality_0", "probabilities": {"quality_0": .9, "unknown": .1}}
        self.assertEqual(probe.decision(ambiguous, .4), {"class": "uncertain", "score": None})
        self.assertEqual(probe.decision(missing, .6), {"class": "unknown", "score": None})
        self.assertEqual(probe.decision(defective, .6), {"class": "defective", "score": 0})

    def test_failed_calls_cannot_count_as_successful_unknown(self):
        row = {"id": "missing", "expected": {"class": "unknown", "quality_range": None}, "error": "invalid answer"}
        result = probe.summarize([row], .6)
        self.assertEqual(result["semantic_unknown_correct"], 0)
        self.assertEqual(result["unknown_withheld"], 0)
        self.assertEqual(result["execution_errors"], 1)
        self.assertFalse(result["passes_control_criteria"])

    def test_numeric_reference_is_checked_even_with_right_broad_class(self):
        row = {"id": "partial", "expected": {"class": "defective", "quality_range": [2, 2]},
               "answers": {"deliverable": {"choice": "quality_0", "probabilities": {"quality_0": .9, "quality_2": .1}}}}
        result = probe.summarize([row], .6)
        self.assertEqual(result["correct_scores"], 0)
        self.assertEqual(result["incorrect_accepted_scores"], 1)


if __name__ == "__main__":
    unittest.main()
