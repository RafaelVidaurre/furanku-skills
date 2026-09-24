import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stderr

import performance_census


def inventory_row(**changes):
    row = {
        "provider": "codex", "path": "/tmp/history/session.jsonl",
        "models": [{"model": "gpt-5.6-terra", "effort": "max"}],
        "user_messages": 1, "assistant_messages": 1,
        "mixed": False, "error": None,
    }
    return {**row, **changes}


class PerformanceCensusTest(unittest.TestCase):
    def setUp(self):
        self.routes = performance_census.route_index([{
            "candidate": "terra", "model": "gpt-5.6-terra", "effort": "max",
            "agent": "codex", "state": "disabled",
        }])

    def test_disabled_history_is_eligible_and_mixed_work_is_not_misattributed(self):
        calls = []

        def reader(path, provider):
            calls.append((path, provider))
            return {"model": "gpt-5.6-terra", "effort": "max", "turns": [1], "omitted_turns": 3,
                    "trailing_user_messages": ["The feature still fails."]}

        projected = performance_census.inspect(inventory_row(), self.routes, reader)
        self.assertEqual(projected["disposition"], "projected")
        self.assertEqual(projected["configured_routes"][0]["state"], "disabled")
        self.assertEqual(projected["answered_turns"], 4)
        self.assertEqual(projected["projected_turns"], 1)
        self.assertEqual(projected["unanswered_final_user_messages"], 1)

        mixed = performance_census.inspect(inventory_row(mixed=True), self.routes, reader)
        self.assertEqual(mixed["disposition"], "mixed_unattributed")
        self.assertEqual(calls, [(Path("/tmp/history/session.jsonl"), "codex")])

    def test_context_variant_matches_base_model_without_claiming_variant(self):
        routes = performance_census.route_index([{
            "candidate": "fable-1m", "model": "claude-fable-5-1[1m]",
            "effort": "high", "agent": "claude", "state": "explicit",
        }])
        row = inventory_row(provider="claude", models=[{"model": "claude-fable-5-1", "effort": "high"}])
        result = performance_census.inspect(row, routes, lambda *_: {
            "model": "claude-fable-5-1", "effort": "high", "turns": [1], "omitted_turns": 0})
        self.assertEqual(result["disposition"], "projected")
        self.assertTrue(result["configured_routes"][0]["context_variant_unverified"])

    def test_dispositions_preserve_missing_evidence_and_skip_unmatched_rows(self):
        self.assertIsNone(performance_census.inspect(
            inventory_row(models=[{"model": "other", "effort": "high"}]), self.routes))
        self.assertEqual(performance_census.inspect(
            inventory_row(error="JSONDecodeError"), self.routes)["disposition"], "inventory_error")
        self.assertEqual(performance_census.inspect(
            inventory_row(user_messages=0), self.routes)["disposition"], "no_exchange")

        def fail(*_):
            raise ValueError("no work turn")

        result = performance_census.inspect(inventory_row(), self.routes, fail)
        self.assertEqual(result["disposition"], "unprojectable")
        self.assertEqual(result["error_type"], "ValueError")

    def test_projection_model_must_match_inventory(self):
        result = performance_census.inspect(inventory_row(), self.routes, lambda *_: {
            "model": "gpt-6-astra", "effort": "high", "turns": [1], "omitted_turns": 0})
        self.assertEqual(result["disposition"], "unprojectable")
        self.assertEqual(result["error_type"], "model_attribution_mismatch")

    def test_missing_inventory_and_existing_output_leave_files_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / "private"
            output = private / "census.jsonl"
            inventory = Path(directory) / "inventory.jsonl"
            with patch.object(performance_census.retrospect, "PRIVATE_ROOT", private), \
                 patch.object(performance_census.config, "model_rows", return_value=[]), \
                 patch.object(sys, "argv", ["performance_census.py", "--inventory", str(inventory),
                                          "--output", str(output)]), \
                 redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    performance_census.main()
                self.assertFalse(output.exists())
                inventory.write_text("")
                output.write_text("keep")
                with self.assertRaises(SystemExit):
                    performance_census.main()
                self.assertEqual(output.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
