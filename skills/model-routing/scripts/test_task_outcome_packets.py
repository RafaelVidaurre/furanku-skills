import json
from pathlib import Path
import tempfile
import unittest

import task_outcome_packets


WORKER = "01234567-89ab-cdef-0123-456789abcdef"
PARENT = "11111111-2222-3333-4444-555555555555"


def message(role, content):
    return {"type": "response_item", "payload": {"type": "message", "role": role,
                                                  "content": [{"type": "input_text" if role == "user" else "output_text",
                                                               "text": content}]}}


def write_log(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


class TaskOutcomePacketsTest(unittest.TestCase):
    def test_proved_link_preserves_context_without_scoring_it(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory) / f"rollout-{WORKER}.jsonl"
            parent = Path(directory) / f"rollout-{PARENT}.jsonl"
            write_log(worker, [{"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                               message("user", "You are working inside Orca. ctx_123 === TASK ===\nFix the parser."),
                               message("assistant", "Parser changed.")])
            write_log(parent, [message("user", "Please fix the parser."),
                               {"type": "response_item", "payload": {"type": "function_call", "arguments": "ctx_123"}},
                               message("user", "You have one orchestration message.")])
            inventory = [{"provider": "codex", "path": str(worker),
                          "models": [{"model": "gpt-6-sol", "effort": "high"}], "mixed": False},
                         {"provider": "codex", "path": str(parent), "models": [], "mixed": False}]
            events = [{"msg": "routing decision", "request_id": "a", "routing.status": "selected",
                       "routing.agent": "codex", "routing.model": "gpt-6-sol", "routing.effort": "high",
                       "session.parent": PARENT}]
            proof = {"status": "proved", "decision_id": "a", "dispatch": "ctx_123", "session_id": WORKER,
                     "dispatch_status": "completed", "worker_state": "succeeded"}
            packets, counts = task_outcome_packets.build(events, inventory, [proof])
            self.assertEqual(counts, {"packet_ready_for_outcome_review": 1})
            self.assertIsNone(packets[0]["quality"])
            self.assertEqual(packets[0]["parent_context_status"], "context_only")
            self.assertIn("Fix the parser", packets[0]["task_contract"])
            self.assertEqual(len(packets[0]["task_family"]), 16)
            _, counts = task_outcome_packets.build(events, inventory, [proof, dict(proof, decision_id="b")])
            self.assertEqual(counts, {"shared_decision_or_worker": 2})
            inventory[0]["models"] = [{"model": "gpt-6-sol", "effort": "medium"}]
            _, counts = task_outcome_packets.build(events, inventory, [proof])
            self.assertEqual(counts, {"worker_attribution_unverified": 1})
            events[0]["routing.model"] = "gpt-6-sol[1m]"
            inventory[0]["models"] = [{"model": "gpt-6-sol", "effort": "high"}]
            _, counts = task_outcome_packets.build(events, inventory, [proof])
            self.assertEqual(counts, {"context_variant_unverified": 1})

    def test_failed_dispatch_is_not_a_quality_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory) / f"rollout-{WORKER}.jsonl"
            write_log(worker, [{"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                               message("user", "You are working inside Orca. ctx_123 === TASK ===\nFix the parser."),
                               message("assistant", "Could not reach the service.")])
            inventory = [{"provider": "codex", "path": str(worker),
                          "models": [{"model": "gpt-6-sol", "effort": "high"}], "mixed": False}]
            events = [{"msg": "routing decision", "request_id": "a", "routing.status": "selected",
                       "routing.agent": "codex", "routing.model": "gpt-6-sol", "routing.effort": "high"}]
            proof = {"status": "proved", "decision_id": "a", "dispatch": "ctx_123", "session_id": WORKER,
                     "dispatch_status": "failed", "worker_state": "failed"}
            packets, counts = task_outcome_packets.build(events, inventory, [proof])
            self.assertEqual(counts, {"worker_incomplete": 1})
            self.assertIsNone(packets[0]["quality"])


if __name__ == "__main__":
    unittest.main()
