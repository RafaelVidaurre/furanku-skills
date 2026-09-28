import json
import unittest

from history_packets import bounded_packet, compact_binary, validate_previews
from assessment_run import admit, usage_from_events
from domain_assess import normalize_requirement_links


class BoundedHistoryTest(unittest.TestCase):
    def test_requirement_links_are_derived_without_changing_quality_judgments(self):
        raw = {"cases": [{"id": "t", "requirements": [
            {"id": "r1", "kind": "deliverable", "applicability": "applicable", "domain_ids": ["art"]},
            {"id": "r2", "kind": "process", "applicability": "applicable", "domain_ids": ["art"]}],
            "domains": [{"id": "art", "requirement_ids": ["r2"], "score": None}]}]}
        result, changes = normalize_requirement_links(raw)
        self.assertEqual(["r1"], result["cases"][0]["domains"][0]["requirement_ids"])
        self.assertIsNone(result["cases"][0]["domains"][0]["score"])
        self.assertEqual(["r2"], raw["cases"][0]["domains"][0]["requirement_ids"])
        self.assertEqual(1, len(changes))

    def test_binary_compaction_preserves_text_and_native_artifact_references(self):
        encoded = "AAAA" * 10000
        source = {"id": "L12.0", "body": json.dumps({"content": [
            {"type": "text", "text": "The check failed: retain this evidence"},
            {"type": "image", "data": encoded}], "schema": {"type": ["object", "null"]}})}
        compact = compact_binary(source)
        self.assertEqual("L12.0", compact["id"])
        self.assertIn("The check failed", compact["body"])
        self.assertNotIn(encoded, compact["body"])
        self.assertIn("sha256:", compact["body"])
        self.assertIn("artifact_reference", compact_binary("data:image/png;base64," + encoded))

    def test_excerpt_never_looks_like_complete_evidence_and_requests_survive(self):
        request = {"id": "L1", "kind": "request", "body": "Fix the failing check"}
        event = {"id": "L2", "kind": "tool_result", "body": "x" * 40000}
        result = bounded_packet({"sources": [request, event], "turns": []}, 5000)
        self.assertEqual(request, result["sources"][0])
        self.assertFalse(result["sources"][1]["body_complete"])
        self.assertEqual(["L2"], result["evidence_limits"]["truncated_source_ids"])
        self.assertLessEqual(len(json.dumps(result)), 5000)

    def test_budget_counts_cached_input_and_running_reservations_and_fails_closed(self):
        usage = usage_from_events([{"type": "turn.completed", "usage": {
            "input_tokens": 100, "cached_input_tokens": 90, "output_tokens": 20}}])
        prior = [{"status": "complete", "usage": usage},
                 {"status": "running", "input_reservation": 50, "output_reservation": 30}]
        admit(prior, 10, 10, 160, 60)
        with self.assertRaises(ValueError):
            admit(prior, 11, 10, 160, 60)
        with self.assertRaises(ValueError):
            admit([{"status": "usage_unknown"}], 1, 1, 1000, 1000)
        with self.assertRaises(ValueError):
            usage_from_events([{"type": "turn.failed"}])

    def test_compaction_preserves_authored_artifacts_before_long_observation_bodies(self):
        packet = {"sources": [
            {"id": "q", "kind": "request", "body": "Write a report"},
            {"id": "a", "kind": "tool_call", "body": "Authored report: " + "x" * 4000},
            {"id": "b", "kind": "tool_result", "body": "Repeated verbose output " * 5000}], "turns": []}
        result = bounded_packet(packet, 12000)
        self.assertEqual(packet["sources"][1], result["sources"][1])
        self.assertFalse(result["sources"][2]["body_complete"])

    def test_preview_citations_must_refer_to_requests_actually_supplied(self):
        cards = [{"id": "S1", "domains": [{"id": "art", "role": "central", "source_ids": ["L1"]}]}]
        previews = [{"id": "S1", "requests": [{"id": "L3"}]}]
        taxonomy = {"domains": [{"id": "art"}]}
        self.assertEqual(1, len(validate_previews(cards, previews, taxonomy)))
        cards[0]["domains"][0]["source_ids"] = ["L3"]
        self.assertEqual([], validate_previews(cards, previews, taxonomy))
        with self.assertRaises(ValueError):
            validate_previews(cards * 2, previews, taxonomy)


if __name__ == "__main__":
    unittest.main()
