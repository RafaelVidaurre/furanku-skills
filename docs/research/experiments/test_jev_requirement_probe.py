import copy
import unittest
import jev_requirement_probe as probe


def case():
    return {"state": {"requested_deliverable": "Explain save behavior", "requirements": [{"id": "r1", "text": "Describe manual saving"}],
        "artifact_source_ids": ["a"], "sources": [
            {"id": "a", "kind": "artifact", "text": "Choose Save to write the document."},
            {"id": "b", "kind": "context", "text": "Saving is manual."}]},
        "expected": {"private_oracle": True}, "audit": "PRIVATE REFERENCE"}


class RequirementContracts(unittest.TestCase):
    def test_missing_artifact_is_mechanical_without_a_judge_call(self):
        c = case()
        c["state"]["artifact_source_ids"] = []
        c["state"]["sources"] = c["state"]["sources"][1:]
        rows = probe.assess(c, lambda *_: self.fail("Missing artifact must not make a call"))
        self.assertEqual(rows[0]["method"], "mechanical_missing_artifact")
        self.assertEqual(probe.decide(rows[0], .8), "unknown")

    def test_gold_excluded_and_support_depends_on_selected_body(self):
        c = case()
        calls = []
        def evaluate(state, questions):
            calls.append((copy.deepcopy(state), copy.deepcopy(questions)))
            if len(calls) == 1:
                return {"r1": {"choice": "met", "probabilities": {"met": .95, "unmet": .03, "unknown": .02}}}
            if len(calls) == 2:
                return {"r1": {"choice": "b1", "probabilities": {"b1": .4}}}
            return {"r1": {"probability": .2}}
        row = probe.assess(c, evaluate)[0]
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(set(s) == set(c["state"]) for s, q in calls))
        self.assertIn("Verdict: met", calls[1][1]["r1"]["instructions"])
        self.assertIn("Selected source IDs: a", calls[2][1]["r1"]["instructions"])
        self.assertEqual(row["anchors"][0]["text"], c["state"]["sources"][0]["text"])
        self.assertEqual(probe.decide(row, .6), "unsupported")
        row["support"]["probability"] = .9
        # Ambiguous source-selection probability is not semantic support.
        self.assertEqual(probe.decide(row, .6), "met")

    def test_mechanical_unknown_cannot_substitute_for_judge_unknown(self):
        rows = []
        for status in ["met", "unmet", "unknown"]:
            for i in range(6):
                rows.append({"case_id": str(i), "requirement_id": status,
                    "expected": {"verdict": status, "support_sets": [["a"]]},
                    "method": "mechanical_missing_artifact" if status == "unknown" else "jev",
                    "judgment": {"choice": status, "probabilities": {status: .9, "other": .1}},
                    "source_ids": ["a"], "support": {"probability": .9}})
        result = probe.summarize(rows, .6)
        self.assertEqual(result["correct"], 18)
        self.assertEqual(result["mechanical_unknown"], 6)
        self.assertEqual(result["judge_unknown_total"], 0)
        self.assertFalse(result["passes"])

    def test_wrong_citation_is_not_a_correct_requirement(self):
        row = {"case_id": "c", "requirement_id": "r", "expected": {"verdict": "met", "support_sets": [["a", "b"]]},
               "method": "jev", "judgment": {"choice": "met", "probabilities": {"met": .9, "unknown": .1}},
               "source_ids": ["b"], "support": {"probability": .9}}
        result = probe.summarize([row], .6)
        self.assertEqual(result["bad_support_accepted"], 1)
        self.assertEqual(result["correct"], 0)

    def test_execution_error_never_counts_as_unknown(self):
        row = {"case_id": "c", "requirement_id": "r", "method": "jev", "error": "invalid_answer",
               "expected": {"verdict": "unknown", "support_sets": []}}
        result = probe.summarize([row], .6)
        self.assertEqual(result["execution_errors"], 1)
        self.assertEqual(result["correct"], 0)

    def test_dangling_artifact_and_extra_evaluator_state_are_rejected(self):
        c = case()
        c["state"]["artifact_source_ids"] = ["missing"]
        with self.assertRaises(ValueError):
            probe.packet(c)
        c = case()
        c["state"]["artifact_source_ids"] = []
        with self.assertRaises(ValueError):
            probe.packet(c)
        c = case()
        c["state"]["oracle"] = "met"
        with self.assertRaises(ValueError):
            probe.packet(c)


if __name__ == "__main__":
    unittest.main()
