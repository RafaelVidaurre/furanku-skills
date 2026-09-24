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

    def test_wrapped_dispatch_projects_task_before_length_bound(self):
        preamble = "You are working inside Orca, a multi-agent IDE.\n" + "CLI instructions. " * 200
        task = "Fix the sample transition and test the behavior."
        for opening, closing in (("<pasted_content id=\"a\">", "</pasted_content id=\"a\">"),
                                 ("<user_query>", "</user_query>")):
            request = opening + "\n" + preamble + "\n=== TASK ===\n" + task + "\n" + closing
            self.assertEqual(retrospect.clean_user(request), task)

    def test_grok_context_rules_are_not_a_user_request(self):
        request = "<user_info>OS details</user_info>\n<rules>Workspace instructions</rules>"
        self.assertEqual(retrospect.clean_user(request), "")

    def test_transport_notifications_and_incomplete_dispatch_are_not_work(self):
        self.assertEqual(retrospect.clean_user("<task-notification>Background command completed</task-notification>"), "")
        self.assertEqual(retrospect.clean_user("<fork-boilerplate>Injected fork context</fork-boilerplate>"), "")
        self.assertEqual(retrospect.clean_user("You are working inside Orca, a multi-agent IDE.\nCLI commands only"), "")
        self.assertEqual(retrospect.clean_user(
            "This session is being continued from a previous conversation that ran out of context.\nSummary: older work"), "")

    def test_claude_skill_invocation_projects_arguments_only(self):
        self.assertEqual(retrospect.clean_user(
            "Base directory for this skill: /tmp/skills/review\n"
            "# Review skill\nUse evidence.\nARGUMENTS: Review the patch for regressions."),
            "Review the patch for regressions.")
        self.assertEqual(retrospect.clean_user(
            "Base directory for this skill: /tmp/skills/review\n# Review skill\nUse evidence."), "")
        self.assertEqual(retrospect.clean_user(
            "[SYSTEM NOTIFICATION - NOT USER INPUT] Background agent completed."), "")
        self.assertEqual(retrospect.clean_user(
            "# Claude in Chrome browser automation\nTool-use instructions"), "")

    def test_stacked_and_trailing_context_keeps_the_request(self):
        self.assertEqual(retrospect.clean_user(
            "<system-reminder>A</system-reminder>\n<system-reminder>B</system-reminder>\nReview the patch."),
            "Review the patch.")
        self.assertEqual(retrospect.clean_user(
            "<rules>R</rules>\n<user_info>U</user_info>\n<user_query>Fix the bug.</user_query>"),
            "Fix the bug.")
        self.assertEqual(retrospect.clean_user(
            "Review the patch.\n<system-reminder>Injected</system-reminder>"),
            "Review the patch.")
        self.assertEqual(retrospect.clean_user(
            '<pasted_content id="x">log text</pasted_content id="x">\nExplain this log.'),
            "log text\nExplain this log.")

    def test_keeps_request_after_ambient_block(self):
        request = '<in-app-browser-context source="ambient-ui-state">Ignored</in-app-browser-context>\nFix the drawer.'
        self.assertEqual(retrospect.clean_user(request), "Fix the drawer.")

    def test_claude_session_attributes_model_and_excludes_reminder(self):
        events = [
            {"type": "user", "message": {"content": "<system-reminder>Injected</system-reminder>\nReview the patch."}},
            {"type": "assistant", "effort": "high", "message": {
                "model": "claude-opus-5-5", "content": [{"type": "text", "text": "Found two defects."}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(e) for e in events) + "\n")
            state = retrospect.session_state(path, "claude")
        self.assertEqual((state["model"], state["effort"]), ("claude-opus-5-5", "high"))
        self.assertEqual(state["turns"], [{"request": "Review the patch.",
                                          "response": "Found two defects."}])

    def test_claude_model_called_skill_is_not_a_new_user_turn(self):
        events = [
            {"type": "user", "message": {"content": "Review the patch."}},
            {"type": "assistant", "effort": "high", "message": {
                "model": "claude-opus-5-5", "content": [{"type": "text", "text": "Reading guidance."}]}},
            {"type": "user", "isMeta": True, "sourceToolUseID": "toolu_1", "message": {
                "content": "Base directory for this skill: /tmp/review\nARGUMENTS: Review the patch."}},
            {"type": "assistant", "effort": "high", "message": {
                "model": "claude-opus-5-5", "content": [{"type": "text", "text": "Found two defects."}]}},
            {"type": "user", "message": {"content": "Please fix the first defect."}},
            {"type": "assistant", "effort": "high", "message": {
                "model": "claude-opus-5-5", "content": [{"type": "text", "text": "Fixed."}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(event) for event in events) + "\n")
            state = retrospect.session_state(path, "claude")
        self.assertEqual(len(state["turns"]), 2)
        self.assertEqual(state["turns"][0]["request"], "Review the patch.")
        self.assertEqual(state["turns"][0]["response"], "Found two defects.")

    def test_claude_coordinator_meta_message_can_be_real_work(self):
        events = [
            {"type": "user", "isMeta": True, "message": {
                "content": "The coordinator sent a message while you were working: Repair the failing test."}},
            {"type": "assistant", "effort": "high", "message": {
                "model": "claude-opus-5-5", "content": [{"type": "text", "text": "Repaired and checked."}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(event) for event in events) + "\n")
            state = retrospect.session_state(path, "claude")
        self.assertEqual(state["turns"][0]["request"],
                         "The coordinator sent a message while you were working: Repair the failing test.")

    def test_unanswered_final_user_correction_is_retained(self):
        events = [
            {"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
            {"type": "response_item", "payload": {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "Build the feature."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant",
                 "content": [{"type": "output_text", "text": "Feature built."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "The feature fails on launch."}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(event) for event in events) + "\n")
            state = retrospect.session_state(path)
        self.assertEqual(len(state["turns"]), 1)
        self.assertEqual(state["trailing_user_messages"], ["The feature fails on launch."])

    def test_grok_session_reads_string_assistant_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "summary.json").write_text(json.dumps({
                "current_model_id": "grok-4.7", "reasoning_effort": "high"}))
            events = [
                {"type": "user", "content": [{"type": "text", "text": "<user_info>Injected</user_info>\nFix the bug."}]},
                {"type": "assistant", "content": "Fixed and tested."},
            ]
            (path / "chat_history.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
            state = retrospect.session_state(path, "grok")
        self.assertEqual((state["model"], state["effort"]), ("grok-4.7", "high"))
        self.assertEqual(state["turns"], [{"request": "Fix the bug.",
                                          "response": "Fixed and tested."}])

    def test_missing_model_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "summary.json").write_text("{}")
            (path / "chat_history.jsonl").write_text(
                json.dumps({"type": "user", "content": "Fix the bug."}) + "\n" +
                json.dumps({"type": "assistant", "content": "Done."}) + "\n")
            with self.assertRaisesRegex(ValueError, "model/effort"):
                retrospect.session_state(path, "grok")

    def test_resume_key_uses_provider_and_full_session_path(self):
        one = Path("/tmp/one/chat_history.jsonl")
        two = Path("/tmp/two/chat_history.jsonl")
        self.assertNotEqual(retrospect.source_key(one, "grok"), retrospect.source_key(two, "grok"))
        self.assertNotEqual(retrospect.source_key(one, "grok"), retrospect.source_key(one, "claude"))


if __name__ == "__main__":
    unittest.main()
