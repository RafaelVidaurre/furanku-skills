import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import performance_assess


class PerformanceAssessTest(unittest.TestCase):
    def test_unrelated_check_cannot_support_positive_quality(self):
        row = {"source_key": "one", "provider": "codex", "model": "gpt-6-sol", "effort": "high",
               "first_request": "Reduce web boot size below 60 MB.",
               "first_response": "Boot size reduced.", "first_followup": "",
               "tool_evidence": [{"command": "pytest tests/test_audio.py", "summary": ["2 passed"]}],
               "requester_provenance": "unverified", "delegated_work": False,
               "task_family": "family", "first_followup_relation": None}

        def answer(check_relation):
            choices = {"domain": "implementation", "quality": "3", "evidence": "independent_check",
                       "check_relation": check_relation, "output_form": "summary_or_link",
                       "cause": "no_problem_visible"}
            return {"answers": {f"0_{key}": {"choice": value, "probabilities": {value: 1}, "confidence": 1}
                                for key, value in choices.items()}, "cost_usd": 0}

        with patch.object(performance_assess.jev, "evaluate_bounded", return_value=answer("unrelated")):
            results, _ = performance_assess.evaluate_batch([row], [{"id": "implementation", "description": "Code"}])
        self.assertEqual(results[0]["effective_quality"], "unverified")
        self.assertIn("check_not_tied_to_first_task", results[0]["evidence_rules"])
        with patch.object(performance_assess.jev, "evaluate_bounded", return_value=answer("direct")):
            results, _ = performance_assess.evaluate_batch([row], [{"id": "implementation", "description": "Code"}])
        self.assertEqual(results[0]["effective_quality"], "3")

        output_claim = answer("partial")
        output_claim["answers"]["0_evidence"]["choice"] = "visible_output"
        output_claim["answers"]["0_output_form"]["choice"] = "partial_or_metrics"
        with patch.object(performance_assess.jev, "evaluate_bounded", return_value=output_claim):
            results, _ = performance_assess.evaluate_batch([row], [{"id": "implementation", "description": "Code"}])
        self.assertEqual(results[0]["effective_quality"], "unverified")
        self.assertIn("deliverable_not_visible", results[0]["evidence_rules"])

    def test_repeated_template_is_one_task_family(self):
        a = "You are the loremaster. " * 35 + "Kanji: 木"
        b = "You are the loremaster. " * 35 + "Kanji: 山"
        self.assertEqual(performance_assess.retrospect.task_family_from_request(a),
                         performance_assess.retrospect.task_family_from_request(b))

    def test_control_requests_are_not_work_outcomes(self):
        for request in ("Reply with exactly: ok", "retry", "$(cat /tmp/task.txt)"):
            self.assertRegex(request, performance_assess.CONTROL_REQUEST)
        self.assertIsNone(performance_assess.CONTROL_REQUEST.search("Write a deployment plan"))

    def test_test_result_pattern_ignores_incidental_error_text(self):
        self.assertIsNone(performance_assess.RESULT_PATTERN.search("error: { code: 'unavailable' }"))
        self.assertIsNotNone(performance_assess.RESULT_PATTERN.search("14 passed in 6.54s"))
        self.assertIsNotNone(performance_assess.RESULT_PATTERN.search("test result: FAILED"))
        self.assertIsNone(performance_assess.TEST_COMMAND.search("rg pytest tests/"))
        self.assertIsNotNone(performance_assess.TEST_COMMAND.search("cd game && python3 -m pytest -q"))
        self.assertEqual(list(performance_assess.exit_codes(
            [{"type": "input_text", "text": '{"exit_code":0,"output":"2 passed\\n"}'}])), [0])

    def test_invalid_jev_distribution_is_recorded_for_one_case(self):
        row = {"source_key": "one", "provider": "codex", "model": "gpt-6-sol", "effort": "high"}
        with patch.object(performance_assess, "evaluate_batch",
                          side_effect=performance_assess.jev.Error(
                              "Jev returned an inconsistent option distribution.")):
            results, cost = performance_assess.evaluate_splitting([row], [])
        self.assertEqual(cost, 0)
        self.assertEqual(results[0]["error"], "jev_inconsistent_distribution")

    def test_rate_limit_never_splits_and_repeats_partial_batches(self):
        rows = [{"source_key": key} for key in ("one", "two")]
        with patch.object(performance_assess, "evaluate_batch",
                          side_effect=performance_assess.jev.RateLimitError(1, 30)) as evaluate:
            with self.assertRaises(performance_assess.jev.RateLimitError):
                performance_assess.evaluate_splitting(rows, [])
        self.assertEqual(evaluate.call_count, 1)

    def test_priority_keeps_unselected_sessions(self):
        rows = [{"source_key": key} for key in ("a", "b", "c")]
        self.assertEqual([row["source_key"] for row in performance_assess.prioritize_rows(rows, ["c", "c"])],
                         ["c", "a", "b"])

    def test_older_rubric_and_retryable_errors_are_reassessed(self):
        rows = [{"source_key": "old", "rubric": "old"},
                {"source_key": "error", "error": "packet_ValueError", "rubric": performance_assess.RUBRIC},
                {"source_key": "done", "rubric": performance_assess.RUBRIC}]
        self.assertEqual(performance_assess.completed_sources(rows), {"error", "done"})
        self.assertEqual(performance_assess.completed_sources(rows, retry_errors=True), {"done"})

    def test_codex_check_requires_test_command_and_stays_in_work_turn(self):
        events = [
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": "Fix it."}},
            {"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": "search", "input": 'tools.exec_command({"cmd":"rg tests fixture.txt"})'}},
            {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "search", "output": "All 42 tests passed."}},
            {"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": "test", "input": 'tools.exec_command({"cmd":"pytest -q"})'}},
            {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "test", "output": "3 passed in 0.1s"}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": "Next task."}},
            {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "test", "output": "4 passed in 0.1s"}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "codex.jsonl"
            path.write_text("\n".join(json.dumps(item) for item in events) + "\n")
            checks = performance_assess.tool_check_evidence(path, "codex")
        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0]["summary"], ["3 passed in 0.1s"])

    def test_codex_js_uses_unquoted_cmd_and_ignores_other_source_text(self):
        source = 'const result = await tools.exec_command({cmd:"npm test"}); text(result)'
        self.assertEqual(performance_assess.command_from_input(source), "npm test")
        self.assertEqual(performance_assess.command_from_input('text("pytest -q")'), "")
        self.assertEqual(performance_assess.command_from_input(
            'tools.exec_command({cmd:"npm test"}); tools.exec_command({cmd:"rg foo"})'), "")
        self.assertFalse(performance_assess.executable_test_command(
            "cat > tests/example.py <<'PY'\npytest -q\nPY"))
        self.assertFalse(performance_assess.executable_test_command(
            'orca orchestration send --message "run pytest -q"'))
        self.assertTrue(performance_assess.executable_test_command(
            "cd project && python3 -m pytest -q"))

    def test_claude_tool_result_is_attributed_to_its_test_command(self):
        events = [
            {"type": "user", "message": {"content": "Fix it."}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "tool1", "name": "Bash", "input": {"command": "pytest -q"}}]}},
            {"type": "user", "sourceToolUseID": "tool1", "message": {"content": [{"type": "tool_result", "tool_use_id": "tool1", "content": "2 passed in 0.1s", "is_error": False}]}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "claude.jsonl"
            path.write_text("\n".join(json.dumps(item) for item in events) + "\n")
            checks = performance_assess.tool_check_evidence(path, "claude")
        self.assertEqual(checks[0]["summary"], ["2 passed in 0.1s"])
        self.assertEqual(checks[0]["exit_code"], 0)


if __name__ == "__main__":
    unittest.main()
