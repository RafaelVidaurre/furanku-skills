import json
from pathlib import Path
import tempfile
import unittest

import history_inventory


class HistoryInventoryTest(unittest.TestCase):
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
