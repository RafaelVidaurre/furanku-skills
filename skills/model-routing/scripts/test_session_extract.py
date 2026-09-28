import copy
import json
from pathlib import Path
import tempfile
import unittest

from assessment_store import Store
from session_extract import prepare, validate_result, materialize


class SessionExtractionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "native.jsonl"
        self.records = [
            {"type": "session_meta", "payload": {"id": "child", "source": {"subagent": {
                "thread_spawn": {"agent_path": "/root/child"}}}}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "Earlier parent assignment"}]}},
            {"type": "event_msg", "payload": {"type": "patch_apply_end", "success": True,
                "changes": {"file.txt": {"unified_diff": "+old work"}}}},
            {"type": "response_item", "payload": {"type": "agent_message", "content": [
                {"type": "input_text", "text": "Message Type: NEW_TASK\nTask name: /root/child\nPayload:\n"},
                {"type": "encrypted_content", "encrypted_content": "opaque-body"}]}},
            {"type": "turn_context", "payload": {"model": "test-model", "effort": "medium"}},
            {"type": "event_msg", "payload": {"type": "agent_message", "message": "Done"}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant",
                "channel": "final", "content": [{"type": "output_text", "text": "Done"}]}},
            {"type": "response_item", "payload": {"type": "reasoning", "summary": "private reasoning"}},
        ]

    def packet(self):
        self.path.write_text("\n".join(json.dumps(r) for r in self.records))
        return prepare(self.path, "codex")[0]

    def test_tool_receipt_links_to_the_authored_command_source(self):
        self.records += [
            {"type": "response_item", "payload": {"type": "function_call", "name": "exec",
                "call_id": "c1", "arguments": "write authored report"}},
            {"type": "response_item", "payload": {"type": "function_call_output",
                "call_id": "c1", "output": "exit code 0"}}]
        packet = self.packet()
        result = next(s for s in packet["sources"] if s["kind"] == "tool_result")
        call = next(s for s in packet["sources"] if s["kind"] == "tool_call")
        self.assertEqual(call["id"], result["linked_call_source_id"])

    def test_retains_native_evidence_and_dispatch_without_crediting_inherited_work(self):
        packet = self.packet()
        sources = {s["id"]: s for s in packet["sources"]}
        self.assertEqual(2, len(packet["turns"]))
        self.assertEqual("inherited_context", sources["L3.native"]["ownership"])
        self.assertEqual("+old work", sources["L3.native"]["body"]["payload"]["changes"]["file.txt"]["unified_diff"])
        self.assertTrue(sources["L4"]["body"]["origin"]["contains_unreadable_encrypted_content"])
        self.assertEqual("current_session", sources["L7.0"]["ownership"])
        self.assertNotIn("L6.native", sources)  # Duplicate final-message mirror.
        self.assertNotIn("opaque-body", json.dumps(packet))
        self.assertNotIn("private reasoning", json.dumps(packet))

    def test_child_without_dispatch_keeps_ownership_unknown(self):
        self.records[3]["payload"]["content"][0]["text"] = "Message Type: MESSAGE\nTask name: /root/child\n"
        packet = self.packet()
        self.assertEqual("unresolved_child", packet["reader"]["ownership"])
        self.assertEqual({"unknown"}, {s["ownership"] for s in packet["sources"]})

    def test_missing_contract_is_storable_as_unresolved_not_a_completed_assessment(self):
        packet = self.packet()
        result = {"version": 1, "tasks": [], "request_links": [
            {"id": "L2", "task_ids": [], "role": "context", "rationale": "Parent history"},
            {"id": "L4", "task_ids": [], "role": "unresolved", "rationale": "Encrypted assignment"},
        ], "unassigned_events": [{"id": e, "reason": "No visible current contract"}
                                  for t in packet["turns"] for e in t["event_ids"]]}
        validate_result(packet, result)
        store = Store(Path(self.tmp.name) / "ledger.sqlite3")
        self.addCleanup(store.close)
        job = {"stage": "extraction", "session_ref": "codex:child", "source_sha256": "a" * 64,
               "procedure": "test", "scope": "session", "scope_id": "", "packet": packet}
        claim = store.claim(job)
        store.finish(claim["claim"], result=result)
        self.assertEqual("skip_completed", store.claim(job)["action"])
        job.pop("stage")
        job["packet"] = {"cases": [{"id": "task", "state": {
            "requirements": [{"id": "r1"}], "sources": [{"id": "s1"}]}}]}
        self.assertEqual("assess", store.claim(job)["action"])

    def test_rejects_missing_requests_events_and_invented_source_ids(self):
        packet = self.packet()
        result = {"version": 1, "tasks": [], "request_links": [
            {"id": "L2", "task_ids": [], "role": "context", "rationale": "Parent"},
            {"id": "L4", "task_ids": [], "role": "unresolved", "rationale": "Unavailable"}],
            "unassigned_events": [{"id": "L3.native", "reason": "Parent"}, {"id": "L7.0", "reason": "Unknown task"}]}
        for field in ("request_links", "unassigned_events"):
            changed = copy.deepcopy(result)
            changed[field].pop()
            with self.assertRaises(ValueError):
                validate_result(packet, changed)
        result["unassigned_events"][0]["id"] = "invented"
        with self.assertRaises(ValueError):
            validate_result(packet, result)

    def test_materialization_copies_original_evidence_and_retains_feedback(self):
        packet = {"sources": [
            {"id": "L1", "kind": "request", "body": "Write a report"},
            {"id": "L2", "kind": "response", "body": "Actual report body"},
            {"id": "L3", "kind": "request", "body": "It needs sources"},
        ], "turns": [{"request_id": "L1", "event_ids": ["L2"], "context_ids": []},
                     {"request_id": "L3", "event_ids": [], "context_ids": []}]}
        result = {"version": 1, "tasks": [{"id": "task-L1", "title": "Sourced report",
            "request_ids": ["L1", "L3"], "event_ids": ["L2"], "context_ids": [],
            "requirements": [{"id": "r1", "text": "Report with sources", "source_ids": ["L1", "L3"]}]}],
            "request_links": [{"id": "L1", "task_ids": ["task-L1"], "role": "request", "rationale": "Opening"},
                              {"id": "L3", "task_ids": ["task-L1"], "role": "correction", "rationale": "Missing sources"}],
            "unassigned_events": []}
        output = materialize(packet, result)
        self.assertEqual(packet["sources"], output["cases"][0]["state"]["sources"])
        self.assertEqual("correction", output["cases"][0]["state"]["request_links"][1]["role"])
        self.assertEqual("unreviewed", output["coverage"]["semantic_status"])


if __name__ == "__main__":
    unittest.main()
