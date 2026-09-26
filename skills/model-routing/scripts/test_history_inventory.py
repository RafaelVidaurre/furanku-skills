import json
from pathlib import Path
import tempfile
import unittest

import history_inventory
import performance_census
import task_retrospect


class HistoryInventoryTest(unittest.TestCase):
    def native_assessment(self, path, provider, model, effort):
        """Real inventory/census/parser; semantic grouping alone is controlled."""
        row = history_inventory.summarize(path, provider)
        routes = performance_census.route_index([{
            "candidate": "configured", "model": model, "effort": effort,
            "agent": provider, "state": "enabled"}])
        census = performance_census.inspect(row, routes)
        self.assertIsNotNone(census, "An actual configured actor disappeared from the census")

        def evaluate(state, questions):
            return {key: {"choice": "new" if key.startswith("t") else "absent",
                          "probabilities": {option: int(option == ("new" if key.startswith("t") else "absent"))
                                            for option in question["criteria"]}, "confidence": 1}
                    for key, question in questions.items()}

        result = task_retrospect.analyze(census, evaluate, [{"id": "writing", "description": "Write prose"}])
        self.assertEqual(result["tasks"][0]["actors"], [(model, effort)])
        self.assertNotIn("scoring_skipped", result["tasks"][0])
        return row, census, result["tasks"][0]

    def test_grok_turn_actor_survives_stale_summary_and_fallback_stays_unverified(self):
        for metadata, expected_model, expected_attribution, fallback in (
            ({"model_id": "actual", "reasoning_effort": "high"}, "actual", "verified_target", False),
            ({"model": "alias", "reasoning_effort": "high"}, "alias", "mixed_or_unverified", False),
            ({"model_id": "actual"}, "actual", "mixed_or_unverified", True),
            ({}, "summary", "mixed_or_unverified", True),
        ):
            with self.subTest(metadata=metadata), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "summary.json"
                path.write_text(json.dumps({"current_model_id": "summary", "reasoning_effort": "high"}))
                (path.parent / "chat_history.jsonl").write_text("\n".join(json.dumps(row) for row in (
                    {"type": "user", "content": "Write prose"},
                    {"type": "assistant", "content": "A short draft", **metadata})))
                row, census, task = self.native_assessment(path, "grok", expected_model, "high")
                self.assertEqual(row["models"], [{"model": expected_model, "effort": "high"}])
                self.assertEqual(census["summary_model"], {"model": "summary", "effort": "high"})
                self.assertEqual(census["summary_fallback_used"], fallback)
                self.assertEqual(task["attribution"], expected_attribution)

    def test_grok_turn_model_changes_remain_distinct_from_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "summary.json"
            path.write_text(json.dumps({"current_model_id": "summary", "reasoning_effort": "high"}))
            (path.parent / "chat_history.jsonl").write_text("\n".join(json.dumps(row) for row in (
                {"type": "user", "content": "Write prose"},
                {"type": "assistant", "content": "Draft", "model_id": "first", "reasoning_effort": "low"},
                {"type": "assistant", "content": "Revision", "model_id": "second", "reasoning_effort": "high"})))
            row = history_inventory.summarize(path, "grok")
        self.assertEqual(row["models"], [{"model": "first", "effort": "low"}, {"model": "second", "effort": "high"}])
        self.assertTrue(row["mixed"])

    def test_claude_per_turn_effort_survives_inventory_and_census(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "claude.jsonl"
            path.write_text("\n".join(json.dumps(row) for row in (
                {"type": "user", "message": {"content": "Write prose"}},
                {"type": "assistant", "perTurnEffort": "high",
                 "message": {"model": "actual", "content": [{"type": "text", "text": "A draft"}]}})))
            _row, _census, task = self.native_assessment(path, "claude", "actual", "high")
        self.assertEqual(task["attribution"], "verified_target")

    def test_discovers_three_providers_and_preserves_mixed_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            codex = home / ".codex/sessions/year/month/session.jsonl"
            codex.parent.mkdir(parents=True)
            codex.write_text("\n".join(json.dumps(row) for row in (
                {"timestamp": "2026-09-24T10:00:00Z", "type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                {"type": "turn_context", "payload": {"model": "gpt-6-astra", "effort": "high"}},
                {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Build"}]}},
                {"timestamp": "2026-09-24T10:05:00Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done"}]}},
            )) + "\n")
            claude = home / ".claude/projects/project/session.jsonl"
            claude.parent.mkdir(parents=True)
            claude.write_text("\n".join(json.dumps(row) for row in (
                {"type": "user", "message": {"content": "Review"}},
                {"type": "assistant", "effort": "high", "message": {"model": "claude-opus-5-5", "content": [{"type": "text", "text": "Found bug"}]}},
            )) + "\n")
            grok = home / ".grok/sessions/project/session"
            grok.mkdir(parents=True)
            (grok / "summary.json").write_text(json.dumps({"current_model_id": "grok-4.7", "reasoning_effort": "high"}))
            (grok / "chat_history.jsonl").write_text("\n".join(json.dumps(row) for row in (
                {"type": "user", "content": "Fix"},
                {"type": "assistant", "content": "Fixed"},
            )) + "\n")
            rows = list(history_inventory.inventory(home))
        self.assertEqual(len(rows), 3)
        by_provider = {row["provider"]: row for row in rows}
        self.assertTrue(by_provider["codex"]["mixed"])
        self.assertEqual(len(by_provider["codex"]["models"]), 2)
        self.assertEqual(by_provider["codex"]["last_event_at"], "2026-09-24T10:05:00Z")
        self.assertEqual(by_provider["claude"]["models"], [{"model": "claude-opus-5-5", "effort": "high"}])
        self.assertEqual(by_provider["grok"]["assistant_messages"], 1)
        self.assertTrue(all(row["user_messages"] and row["assistant_messages"] for row in rows))

    def test_discovers_orca_codex_account_home(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            session = home / "Library/Application Support/orca/codex-accounts/account/home/sessions/2026/09/24/rollout-id.jsonl"
            session.parent.mkdir(parents=True)
            session.write_text("\n".join(json.dumps(row) for row in (
                {"timestamp": "2026-09-24T10:00:00Z", "type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Build"}]}},
                {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done"}]}},
            )) + "\n")
            rows = list(history_inventory.inventory(home))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["path"], str(session))
        self.assertEqual(rows[0]["models"], [{"model": "gpt-6-sol", "effort": "high"}])

    def test_mirrored_codex_session_is_counted_once_using_fuller_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            name = "rollout-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            standard = home / ".codex/sessions" / name
            mirrored = home / "Library/Application Support/orca/codex-accounts/account/home/sessions" / name
            standard.parent.mkdir(parents=True)
            mirrored.parent.mkdir(parents=True)
            standard.write_text(json.dumps({"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}}) + "\n")
            mirrored.write_text(standard.read_text() + json.dumps({"type": "response_item", "payload": {
                "type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done"}]}}) + "\n")
            rows = list(history_inventory.inventory(home))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["path"], str(mirrored))
        self.assertEqual(rows[0]["assistant_messages"], 1)
        self.assertEqual(set(rows[0]["copies"]), {str(standard), str(mirrored)})

    def test_corrupt_larger_mirror_falls_back_to_valid_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            name = "rollout-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            standard = home / ".codex/sessions" / name
            mirrored = home / "Library/Application Support/orca/codex-accounts/account/home/sessions" / name
            standard.parent.mkdir(parents=True)
            mirrored.parent.mkdir(parents=True)
            standard.write_text(json.dumps({"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}}) + "\n")
            mirrored.write_text("{" + "x" * 100)
            rows = list(history_inventory.inventory(home))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["path"], str(standard))
        self.assertIsNone(rows[0]["error"])


if __name__ == "__main__":
    unittest.main()
