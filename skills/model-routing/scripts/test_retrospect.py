import json
from pathlib import Path
import tempfile
import unittest

import retrospect


class SessionProjectionTest(unittest.TestCase):
    def test_excludes_injected_context_and_keeps_actual_request(self):
        events = [
            {"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "# AGENTS.md instructions for /tmp/project\n<INSTRUCTIONS>irrelevant</INSTRUCTIONS>\nBuild the feature."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [
                {"type": "output_text", "text": "Feature built."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "<in-app-browser-context source=\"ambient-ui-state\">Browser open</in-app-browser-context>"}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "The button is broken; fix it."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [
                {"type": "output_text", "text": "I will inspect it."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [
                {"type": "output_text", "text": "Fixed the button."}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(e) for e in events) + "\n")
            state = retrospect.session_state(path)
        self.assertEqual((state["model"], state["effort"]), ("gpt-6-sol", "high"))
        self.assertEqual(len(state["turns"]), 2)
        self.assertEqual(state["turns"][0]["request"], "Build the feature.")
        self.assertEqual(state["turns"][1]["response"], "Fixed the button.")

    def test_rejects_mixed_model_sessions(self):
        events = [
            {"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
            {"type": "turn_context", "payload": {"model": "gpt-6-astra", "effort": "high"}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Do work"}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done"}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(e) for e in events) + "\n")
            with self.assertRaisesRegex(ValueError, "changed model/effort"):
                retrospect.session_state(path)

    def test_orca_dispatch_projects_task_not_cli_preamble(self):
        request = ("You are working inside Orca, a multi-agent IDE.\n"
                   "secret transport details and reporting commands\n"
                   "=== TASK ===\nImplement the animation rig repair.")
        self.assertEqual(retrospect.clean_user(request), "Implement the animation rig repair.")

    def test_keeps_request_after_ambient_block(self):
        request = '<in-app-browser-context source="ambient-ui-state">Ignored</in-app-browser-context>\nFix the drawer.'
        self.assertEqual(retrospect.clean_user(request), "Fix the drawer.")


if __name__ == "__main__":
    unittest.main()
