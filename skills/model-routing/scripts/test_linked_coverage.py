import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import linked_coverage
import routing_log


SESSION = "01234567-89ab-cdef-0123-456789abcdef"
OTHER = "11111111-2222-3333-4444-555555555555"
TIME = "2026-09-24T10:00:00Z"
LATER = "2026-09-24T10:05:00Z"


def decision(request_id="a", model="claude-opus-5-5", status="selected", **extra):
    return {"msg": "routing decision", "request_id": request_id, "routing.status": status,
            "routing.agent": "claude", "routing.model": model, "routing.effort": "high",
            "ts": TIME, **extra}


def link(ref=SESSION, request_id="a"):
    return {"msg": "routing worker linked", "request_id": request_id, "session.worker": ref}


def inventory(path, model="claude-opus-5-5", **extra):
    return {"provider": "claude", "path": str(path),
            "models": [{"model": model, "effort": "high"}],
            "mixed": False, "user_messages": 1, "assistant_messages": 1,
            "last_event_at": LATER, **extra}


class LinkedCoverageTest(unittest.TestCase):
    def test_exact_link_requires_matching_record_and_terminal_ref_stays_unresolved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{SESSION}.jsonl"
            path.write_text("{}\n")
            events = [decision(), link(), decision("b"), link("term_" + SESSION, "b")]
            rows, counts = linked_coverage.analyze(events, [inventory(path)])
        self.assertEqual(counts, {"transcript_found": 1, "unresolved_reference": 1})
        self.assertEqual(rows[0]["source"], str(path))

    def test_mismatch_unlinked_and_context_variant_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{SESSION}.jsonl"
            path.write_text("{}\n")
            _, counts = linked_coverage.analyze([decision(), link(), decision("b")],
                                                [inventory(path, model="claude-fable-5-1")])
            self.assertEqual(counts, {"model_mismatch": 1, "unlinked": 1})
            _, counts = linked_coverage.analyze([decision(model="claude-fable-5-1[1m]"), link()],
                                                [inventory(path, model="claude-fable-5-1")])
            self.assertEqual(counts, {"context_variant_unverified": 1})

    def test_matching_session_link_supersedes_unmatched_uuid_and_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{SESSION}.jsonl"
            path.write_text("{}\n")
            events = [decision(), link("term_" + SESSION), link(OTHER), link(SESSION)]
            _, counts = linked_coverage.analyze(events, [inventory(path)])
        self.assertEqual(counts, {"transcript_found": 1})

    def test_exact_route_parent_and_damaged_source_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{SESSION}.jsonl"
            path.write_text("{}\n")
            _, counts = linked_coverage.analyze(
                [decision(status="exact", **{"session.parent": SESSION}), link()], [inventory(path)])
            self.assertEqual(counts, {"parent_session_link": 1})
            _, counts = linked_coverage.analyze(
                [decision(status="exact"), link()], [inventory(path, error="JSONDecodeError")])
            self.assertEqual(counts, {"damaged_source": 1})

    def test_temporal_and_agent_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{SESSION}.jsonl"
            path.write_text("{}\n")
            _, counts = linked_coverage.analyze([decision(), link()],
                                                [inventory(path, last_event_at="2026-09-24T09:00:00Z")])
            self.assertEqual(counts, {"session_ended_before_decision": 1})
            _, counts = linked_coverage.analyze([decision(), link()],
                                                [inventory(path, provider="codex")])
            self.assertEqual(counts, {"agent_mismatch": 1})

    def test_retained_journal_reader_passes_the_tail_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            journal = logs / "2026-09-24.jsonl"
            journal.write_text("".join(json.dumps({"request_id": str(i)}) + "\n" for i in range(201)))
            with patch.object(routing_log, "LOGS", logs):
                self.assertEqual(len(routing_log.retrospective_events()), 201)


if __name__ == "__main__":
    unittest.main()
