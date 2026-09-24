import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import resolve_orca_links


SESSION = "01234567-89ab-cdef-0123-456789abcdef"
DISPATCH = "ctx_123456789abc"
TASK = "task_123456789abc"
TERMINAL = "term_12345678-1234-1234-1234-123456789abc"
WORKTREE = "/tmp/worktree"


def message(role, text):
    return {"type": "response_item", "payload": {"type": "message", "role": role,
            "content": [{"type": "input_text", "text": text}]}}


class ResolveOrcaLinksTest(unittest.TestCase):
    def test_initial_worker_preamble_proves_dispatch_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"rollout-{SESSION}.jsonl"
            path.write_text("\n".join(json.dumps(row) for row in (
                {"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                message("user", f"Dispatch {DISPATCH}; Task {TASK}; Terminal {TERMINAL}"),
                message("assistant", "Working"),
            )) + "\n")
            row = {"provider": "codex", "path": str(path), "models": [{"model": "gpt-6-sol", "effort": "high"}]}
            hit = {"sessionId": SESSION, "agent": "codex", "cwd": WORKTREE,
                   "source": {"filePath": str(path)}}
            decision = {"routing.agent": "codex", "routing.model": "gpt-6-sol", "routing.effort": "high",
                        "session.parent": "other"}
            self.assertTrue(resolve_orca_links.prove_candidate(hit, row, decision, DISPATCH, TASK, TERMINAL, WORKTREE))
            self.assertFalse(resolve_orca_links.prove_candidate(hit, row, decision, DISPATCH, "other-task", TERMINAL, WORKTREE))
            self.assertFalse(resolve_orca_links.prove_candidate(hit, row, {**decision, "session.parent": SESSION},
                                                                DISPATCH, TASK, TERMINAL, WORKTREE))

    def test_incidental_later_mention_does_not_prove_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"rollout-{SESSION}.jsonl"
            path.write_text("\n".join(json.dumps(row) for row in (
                {"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                message("user", "A separate task"),
                message("assistant", "Task done"),
                message("user", f"Saw {DISPATCH} {TASK} {TERMINAL} in unrelated logs"),
            )) + "\n")
            row = {"provider": "codex", "path": str(path), "models": [{"model": "gpt-6-sol", "effort": "high"}]}
            hit = {"sessionId": SESSION, "agent": "codex", "cwd": WORKTREE,
                   "source": {"filePath": str(path)}}
            decision = {"routing.agent": "codex", "routing.model": "gpt-6-sol", "routing.effort": "high"}
            self.assertFalse(resolve_orca_links.prove_candidate(hit, row, decision, DISPATCH, TASK, TERMINAL, WORKTREE))

    def test_partial_index_requires_unique_local_opening(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / f"rollout-{session}.jsonl" for session in (
                SESSION, "11111111-2222-3333-4444-555555555555")]
            for path in paths:
                path.write_text("\n".join(json.dumps(row) for row in (
                    {"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "high"}},
                    message("user", f"Dispatch {DISPATCH}; Task {TASK}; Terminal {TERMINAL}"),
                    message("assistant", "Working"),
                )) + "\n")
            rows = [{"provider": "codex", "path": str(path),
                     "models": [{"model": "gpt-6-sol", "effort": "high"}]} for path in paths]
            decision = {"msg": "routing decision", "request_id": "a", "routing.status": "selected",
                        "routing.agent": "codex", "routing.model": "gpt-6-sol", "routing.effort": "high"}
            events = [decision, {"msg": "routing worker linked", "request_id": "a", "session.worker": DISPATCH}]

            def fake_orca(_command, *args):
                if args[:2] == ("search", "--index-status"):
                    return {"enabled": True, "phase": "indexing"}
                if args[:2] == ("orchestration", "worker-show"):
                    return {"dispatch": {"taskId": TASK, "status": "completed"},
                            "worker": {"agentTerminalHandle": TERMINAL, "worktreeId": "repo::" + WORKTREE,
                                       "state": "succeeded", "startOptions": {"launch": {"effective": {
                                           "agent": "codex", "model": "gpt-6-sol", "effort": "high"}}}}}
                if args[0] == "search":
                    return {"hits": [{"sessionId": SESSION, "agent": "codex", "cwd": WORKTREE,
                                      "source": {"filePath": str(paths[0])}}],
                            "page": {"hasMore": False}}
                raise AssertionError(args)

            with patch.object(resolve_orca_links, "orca", side_effect=fake_orca):
                result, phase = resolve_orca_links.resolve(events, rows, "orca")
                self.assertEqual(phase, "indexing")
                self.assertEqual(result[0]["status"], "ambiguous_opening_preamble")
                result, _ = resolve_orca_links.resolve(events, rows[:1], "orca")
                self.assertEqual(result[0]["status"], "proved")

    def test_opening_check_uses_mirrored_session_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            selected = Path(directory) / f"selected-{SESSION}.jsonl"
            mirror = Path(directory) / f"mirror-{SESSION}.jsonl"
            selected.write_text(json.dumps(message("user", "Unrelated opening")) + "\n")
            mirror.write_text(json.dumps(message("user", f"Dispatch {DISPATCH}; Task {TASK}; Terminal {TERMINAL}")) + "\n")
            row = {"provider": "codex", "path": str(selected), "copies": [str(selected), str(mirror)]}
            openings = resolve_orca_links.opening_dispatches([row], {DISPATCH})
        self.assertEqual({session for session, _ in openings[DISPATCH]}, {SESSION})


if __name__ == "__main__":
    unittest.main()
