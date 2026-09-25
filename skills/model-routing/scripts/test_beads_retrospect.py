import json
import os
from pathlib import Path
import tempfile
import unittest
import unittest.mock
from unittest.mock import patch

import beads_retrospect as br
import jev


def issue(issue_id, status="closed", **fields):
    return {"_type": "issue", "id": issue_id, "title": f"Task {issue_id}", "status": status,
            "issue_type": "task", "priority": 2, "description": "Do the thing",
            "owner": "someone@example.com", "assignee": "Some Human",
            "updated_at": "2026-09-01T00:00:00Z", **fields}


class FakeBd:
    """Stands in for `bd --readonly`; keyed by (subcommand, cwd)."""

    def __init__(self, contexts, exports, failing=()):
        self.contexts, self.exports, self.failing, self.calls = contexts, exports, set(failing), []

    def __call__(self, args, cwd):
        cwd = str(cwd)
        self.calls.append((args[0], cwd))
        if (args[0], cwd) in self.failing:
            raise br.Unavailable(f"bd {args[0]} exited 1: boom")
        if args[0] == "context":
            return json.dumps(self.contexts[cwd])
        if args[0] == "statuses":
            return json.dumps({"built_in_statuses": [{"name": "closed", "category": "done"},
                                                     {"name": "open", "category": "active"}]})
        if args[0] == "export":
            return "\n".join(json.dumps(row) for row in self.exports[cwd])
        raise AssertionError(args)


def claude_line(kind, content, **extra):
    return json.dumps({"type": kind, "message": {"role": kind, "content": content, **extra.pop("message", {})},
                       "timestamp": "2026-09-01T00:00:00Z", **extra})


def write_claude_session(path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def assistant_tool(tool_id, command, model="claude-opus-5-5"):
    return claude_line("assistant", [{"type": "tool_use", "id": tool_id, "name": "Bash",
                                      "input": {"command": command}}],
                       message={"model": model}, effort="high")


def tool_result(tool_id, text):
    return claude_line("user", [{"type": "tool_result", "tool_use_id": tool_id, "content": text,
                                 "is_error": False}])


class DiscoveryAndCensusTest(unittest.TestCase):
    def test_worktrees_resolve_to_one_store_and_broken_worktree_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, worktree, broken = (Path(tmp) / name for name in ("main", "wt/feature", "wt/broken"))
            for repo in (main, worktree, broken):
                (repo / ".beads").mkdir(parents=True)
            (broken / ".beads/metadata.json").write_text('{"project_id": "p1-broken-clone"}')
            ctx = {"beads_dir": str(main / ".beads"), "repo_root": str(main), "project_id": "p1"}
            bd = FakeBd({str(main): ctx, str(worktree): ctx}, {}, failing={("context", str(broken))})
            found = br.discover([tmp], runner=bd)
        self.assertEqual(len(found["stores"]), 2)
        canonical = next(s for s in found["stores"] if s["project_id"] == "p1")
        self.assertEqual(len(canonical["aliases"]), 2)
        self.assertEqual(found["failures"][0]["stage"], "context")
        self.assertIn(str(broken), found["failures"][0]["path"])

    def test_only_done_statuses_are_finalized_and_newest_copy_wins(self):
        a = {"beads_dir": "/a/.beads", "repo_root": "/a", "project_id": "p1", "aliases": ["/a/.beads"]}
        b = {"beads_dir": "/b/.beads", "repo_root": "/b", "project_id": "p1", "aliases": ["/b/.beads"]}
        bd = FakeBd({}, {
            "/a": [issue("x-1", close_reason="old"), issue("x-2", status="open")],
            "/b": [issue("x-1", close_reason="new", updated_at="2026-09-02T00:00:00Z")]})
        records, failures, totals = br.census_stores([a, b], runner=bd)
        self.assertEqual([r["issue_id"] for r in records], ["x-1"])
        self.assertEqual(records[0]["claims"]["close_reason"], "new")
        self.assertEqual(totals["duplicate_copies"], 1)
        self.assertEqual(failures, [])

    def test_statuses_failure_is_reported_as_closed_only_fallback(self):
        store = {"beads_dir": "/a/.beads", "repo_root": "/a", "project_id": "p1", "aliases": []}
        bd = FakeBd({}, {"/a": [issue("x-1")]}, failing={("statuses", "/a")})
        records, failures, totals = br.census_stores([store], runner=bd)
        self.assertEqual(len(records), 1)
        self.assertEqual(failures[0]["stage"], "statuses")
        self.assertIn("closed-only fallback", failures[0]["error"])
        self.assertEqual(totals["status_fallback_stores"], 1)

    def test_failed_export_reads_jsonl_artifact_with_visible_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "issues.jsonl").write_text(json.dumps(issue("x-9", close_reason="done")) + "\n")
            store = {"beads_dir": tmp, "repo_root": tmp, "project_id": "p9", "aliases": [tmp]}
            bd = FakeBd({}, {}, failing={("export", tmp)})
            records, failures, _ = br.census_stores([store], runner=bd)
        self.assertEqual(len(records), 1)
        self.assertIn("jsonl artifact", records[0]["provenance"]["reader"])
        self.assertEqual(failures[0]["stage"], "export")

    def test_record_separates_claims_and_flags_missing_evidence_without_owner_identity(self):
        store = {"beads_dir": "/r/.beads", "repo_root": "/r", "project_id": "abcdef123456", "aliases": []}
        record = br.finalized_record(issue("x-3", close_reason="Closed", notes="tests pass",
                                           comments=[{"text": "Opus finished it", "created_at": "t",
                                                      "author": "Some Human"}]), store, "bd export")
        self.assertEqual(record["issue_ref"], "abcdef12:x-3")
        self.assertEqual(record["requirements"]["description"], "Do the thing")
        self.assertEqual(record["claims"]["notes"], "tests pass")
        self.assertIn("generic_close_reason", record["missing_evidence"])
        self.assertIn("no_acceptance_criteria", record["missing_evidence"])
        self.assertIn("no_transcript_link", record["missing_evidence"])
        serialized = json.dumps(record)
        self.assertNotIn("Some Human", serialized)
        self.assertNotIn("someone@example.com", serialized)


class TranscriptLinkTest(unittest.TestCase):
    def test_command_kind_is_exact_about_ids_and_bd_verbs(self):
        self.assertEqual(br.command_kind('bd close ug-abc --reason "done"', "ug-abc"), "close_command")
        self.assertEqual(br.command_kind("bd update ug-abc --claim", "ug-abc"), "claim_command")
        self.assertEqual(br.command_kind("bd show ug-abc", "ug-abc"), "bd_command")
        self.assertEqual(br.command_kind("bd close ug-abc.2", "ug-abc"), "tool_command")
        self.assertEqual(br.command_kind("git log --grep ug-abc && bd close ug-xyz", "ug-abc"), "tool_command")
        pattern = br.id_pattern({"ug-abc", "ug-abc.2"})
        self.assertEqual([m.group(1) for m in pattern.finditer("see ug-abc.2, ug-abc; bug-abc")],
                         ["ug-abc.2", "ug-abc"])

    def test_operator_session_links_model_from_metadata_and_closing_turn_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            operator = home / ".claude/projects/repo/op.jsonl"
            write_claude_session(operator, [
                claude_line("user", "Please fix ug-abc"),
                assistant_tool("t1", "bd update ug-abc --claim"),
                tool_result("t1", "claimed"),
                claude_line("user", "Now verify and close it"),
                assistant_tool("t2", "python3 -m pytest -q"),
                tool_result("t2", "5 passed in 0.2s"),
                assistant_tool("t3", 'bd close ug-abc --reason "fixed"'),
                tool_result("t3", "closed"),
            ])
            bystander = home / ".claude/projects/repo/other.jsonl"
            write_claude_session(bystander, [
                claude_line("user", "What happened with ug-abc?"),
                claude_line("assistant", [{"type": "text", "text": "ug-abc was closed."}],
                            message={"model": "claude-sonnet-5"}, effort="low"),
            ])
            store = {"beads_dir": "/r/.beads", "repo_root": "/r", "project_id": "p1", "aliases": []}
            record = br.finalized_record(issue("ug-abc", close_reason="fixed"), store, "bd export")
            stats = br.link_transcripts([record], home,
                                        files=[("claude", operator), ("claude", bystander)])
            self.assertEqual(stats["sessions_scanned"], 2)
        links = {Path(link["session_path"]).name: link for link in record["transcript_links"]}
        self.assertEqual(links["op.jsonl"]["attribution"], "single_model_operator")
        self.assertEqual(links["op.jsonl"]["models"], [{"model": "claude-opus-5-5", "effort": "high"}])
        self.assertEqual(links["op.jsonl"]["close_turns"], [1])
        self.assertEqual(links["other.jsonl"]["attribution"], "mention_only")
        self.assertEqual(br.primary_link(record)["session_path"], str(operator))
        self.assertEqual(record["observed_checks"][0]["exit_code"], 0)
        self.assertNotIn("no_observed_check", record["missing_evidence"])
        self.assertEqual(stats["links:single_model_operator"], 1)
        self.assertNotIn("claude-opus-5-5", json.dumps(br.jev_state(record)))


class LinkEfficiencyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.session = self.home / ".claude/projects/repo/op.jsonl"
        write_claude_session(self.session, [
            claude_line("user", "Close out the epic"),
            assistant_tool("t1", "bd close ug-aaa ug-bbb ug-ccc"),
            tool_result("t1", "closed 3"),
        ])
        store = {"beads_dir": "/r/.beads", "repo_root": "/r", "project_id": "p1", "aliases": []}
        self.records = [br.finalized_record(issue(i, close_reason="done here"), store, "bd export")
                        for i in ("ug-aaa", "ug-bbb", "ug-ccc")]

    def tearDown(self):
        self.tmp.cleanup()

    def test_follow_up_reads_are_shared_by_issues_closed_in_the_same_turn(self):
        with patch("retrospect.delegation_detected", return_value=False) as delegation, \
                patch("performance_assess.tool_check_evidence", return_value=[]) as checks:
            br.link_transcripts(self.records, self.home, files=[("claude", self.session)])
        self.assertEqual(delegation.call_count, 1)
        self.assertEqual(checks.call_count, 1)
        self.assertTrue(all(r["transcript_links"][0]["attribution"] == "single_model_operator"
                            for r in self.records))

    def test_checkpoint_resumes_without_rescanning_sessions(self):
        checkpoint = self.home / "checkpoint.jsonl"
        checkpoint.touch()
        calls = []

        def counting(*args):
            calls.append(args[0])
            return br.scan_session(*args)

        br.link_transcripts(self.records, self.home, files=[("claude", self.session)],
                            checkpoint=checkpoint, scanner=counting)
        stats = br.link_transcripts(self.records, self.home, files=[("claude", self.session)],
                                    checkpoint=checkpoint, scanner=counting)
        self.assertEqual(len(calls), 1)
        self.assertEqual(stats["sessions_from_checkpoint"], 1)
        self.assertEqual(len(self.records[0]["transcript_links"]), 1)

    def test_changed_transcript_is_rescanned_and_foreign_checkpoint_is_rejected(self):
        checkpoint = self.home / "checkpoint.jsonl"
        checkpoint.touch()
        br.link_transcripts(self.records, self.home, files=[("claude", self.session)], checkpoint=checkpoint)
        with self.session.open("a") as stream:
            stream.write(claude_line("user", "and ug-ddd too") + "\n")
        stats = br.link_transcripts(self.records, self.home, files=[("claude", self.session)],
                                    checkpoint=checkpoint)
        self.assertEqual(stats["sessions_rescanned_changed"], 1)
        with self.assertRaises(SystemExit):
            br.link_transcripts(self.records[:1], self.home, files=[("claude", self.session)],
                                checkpoint=checkpoint)

    def test_ripgrep_failure_is_a_reported_coverage_gap(self):
        (self.home / ".codex/sessions").mkdir(parents=True)
        failed = unittest.mock.Mock(returncode=2, stdout="", stderr="permission denied")
        with patch("shutil.which", return_value="/usr/bin/rg"), patch("subprocess.run", return_value=failed):
            candidates, gaps = br.candidate_files(self.home, {"ug-aaa"})
        self.assertEqual(candidates, [])
        self.assertEqual(len(gaps), 2)
        self.assertIn("rg exited 2", gaps[0]["error"])

    def test_unknown_delegation_is_not_a_single_model_operator(self):
        with patch("retrospect.delegation_detected", side_effect=ValueError("unparseable")):
            br.link_transcripts(self.records, self.home, files=[("claude", self.session)])
        self.assertEqual(self.records[0]["transcript_links"][0]["attribution"], "unknown_delegation")
        self.assertIn("no_single_model_operator", self.records[0]["missing_evidence"])

    def test_primary_link_prefers_the_most_recent_equal_operator(self):
        base = {"attribution": "single_model_operator", "close_turns": [0], "claim_turns": [], "models": []}
        record = {"transcript_links": [{**base, "session_path": "old", "last_event_at": "2026-01-01"},
                                       {**base, "session_path": "new", "last_event_at": "2026-09-01"}]}
        self.assertEqual(br.primary_link(record)["session_path"], "new")


class CodexEventTest(unittest.TestCase):
    def test_codex_analysis_channel_is_not_work_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            message = lambda role, text, **extra: json.dumps({"type": "response_item", "payload": {
                "type": "message", "role": role, "content": [{"type": "input_text", "text": text}], **extra}})
            path.write_text("\n".join([message("user", "fix ug-aaa"),
                                       message("assistant", "thinking about ug-aaa", channel="analysis"),
                                       message("assistant", "done with ug-aaa", channel="final")]) + "\n")
            found = br.scan_session(path, "codex", {"ug-aaa"}, br.id_pattern({"ug-aaa"}))
        self.assertEqual(found["ug-aaa"]["kinds"], {"user_prompt": 1, "assistant": 1})


class AdapterTest(unittest.TestCase):
    def test_unselected_adapter_needs_no_beads(self):
        with patch.dict(os.environ, {"PATH": ""}):
            self.assertEqual(br.enrich_session("/x.jsonl", selected=False),
                             {"status": "not_selected", "records": []})

    def test_selected_adapter_without_bd_reports_unavailable(self):
        with patch.dict(os.environ, {"PATH": ""}):
            result = br.enrich_session("/x.jsonl", "claude", selected=True, repo="/tmp")
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("bd", result["reason"])
        self.assertEqual(result["records"], [])

    def test_selected_adapter_reads_census_artifact_for_linked_session_only(self):
        store = {"beads_dir": "/r/.beads", "repo_root": "/r", "project_id": "p", "aliases": []}
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp) / "real"
            real.mkdir()
            (real / "s1.jsonl").write_text("")
            (Path(tmp) / "alias").symlink_to(real)
            link = {"session_path": str(real / "s1.jsonl"), "models": [], "close_turns": [],
                    "claim_turns": [], "attribution": "mention_only"}
            rows = [{**br.finalized_record(issue("a-1"), store, "bd export"), "transcript_links": [link]},
                    br.finalized_record(issue("a-2"), store, "bd export")]
            census = Path(tmp) / "census.jsonl"
            census.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            with patch.dict(os.environ, {"PATH": ""}):
                result = br.enrich_session(Path(tmp) / "alias/s1.jsonl", selected=True, census=census)
        self.assertEqual([r["issue_id"] for r in result["records"]], ["a-1"])
        self.assertEqual((result["census_records"], result["linked_records"]), (2, 1))


class EvaluationTest(unittest.TestCase):
    def setUp(self):
        store = {"beads_dir": "/r/.beads", "repo_root": "/r", "project_id": "p1", "aliases": []}
        self.records = [br.finalized_record(issue(f"x-{n}", close_reason="done it"), store, "bd export")
                        for n in range(3)]

    def fake_answers(self, payload):
        answers = {name: {"choice": next(iter(q["criteria"])), "probabilities": {}, "confidence": 0.9}
                   for name, q in payload["questions"].items()}
        return {"answers": answers, "usage": {}, "cost_usd": 0}

    def test_resumes_and_stops_with_partial_results_on_sustained_rate_limit(self):
        calls = []

        def flaky(payload):
            calls.append(payload)
            if len(calls) >= 2:
                raise jev.RateLimitError(3, None)
            return self.fake_answers(payload)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "eval.jsonl"
            first = br.run_evaluations(self.records, output, evaluate=flaky, sleep=lambda s: None, log=lambda m: None)
            self.assertEqual((first["status"], first["completed"]), ("rate_limited", 1))
            self.assertEqual(len(br.read_jsonl(output)), 1)
            second = br.run_evaluations(self.records, output, evaluate=self.fake_answers, log=lambda m: None)
            self.assertEqual(second["completed"], 2)
            refs = [row["issue_ref"] for row in br.read_jsonl(output)]
        self.assertEqual(sorted(refs), sorted(r["issue_ref"] for r in self.records))
        self.assertTrue(calls[0]["providerOptions"]["gateway"]["zeroDataRetention"])

    def test_only_issues_whose_judged_evidence_changed_are_reevaluated(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "eval.jsonl"
            br.run_evaluations(self.records, output, evaluate=self.fake_answers, log=lambda m: None)
            self.records[0]["observed_checks"] = [{"command": "pytest", "summary": ["1 passed"], "exit_code": 0}]
            again = br.run_evaluations(self.records, output, evaluate=self.fake_answers, log=lambda m: None)
        self.assertEqual(again["completed"], 1)

    def test_batch_that_fails_validation_is_split_down_to_the_failing_issue(self):
        def picky(payload):
            if "Task x-1" in json.dumps(payload["state"]):
                raise jev.Error("Jev returned an inconsistent option distribution.")
            return self.fake_answers(payload)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "eval.jsonl"
            outcome = br.run_evaluations(self.records, output, evaluate=picky, log=lambda m: None, batch_size=3)
            rows = {row["issue_ref"].split(":")[1]: row for row in br.read_jsonl(output)}
        self.assertEqual(outcome["completed"], 3)
        self.assertEqual(rows["x-1"]["error"], "jev_inconsistent_distribution")
        self.assertIn("labels", rows["x-0"])

    def test_oversized_requests_are_split_or_recorded_and_never_sent(self):
        sent = []

        def recording(payload):
            sent.append(len(json.dumps(payload).encode()))
            return self.fake_answers(payload)

        taxonomy = {"version": 5, "domains": [{"id": "implementation", "description": "d"}]}
        with patch.object(br, "MAX_STATE_BYTES", 2500):
            self.records[1]["requirements"]["description"] = "x" * 2500
            rows = br.evaluate_splitting(self.records, taxonomy, evaluate=recording)
        by_id = {row["issue_ref"].split(":")[1]: row for row in rows}
        self.assertEqual(by_id["x-1"]["error"], "request_oversize")
        self.assertIn("labels", by_id["x-0"])
        self.assertIn("labels", by_id["x-2"])
        self.assertEqual(len(sent), 2)

    def test_operator_linked_issues_are_evaluated_before_unlinked_ones(self):
        linked = self.records[2]
        linked["transcript_links"] = [{"attribution": "delegating_operator", "close_turns": [0],
                                       "claim_turns": [], "last_event_at": "t", "models": []}]
        order = [r["issue_id"] for r in br.diverse_order(self.records)]
        self.assertEqual(order[0], "x-2")
        self.assertEqual(sorted(order), ["x-0", "x-1", "x-2"])

    def test_unlinked_issue_is_reported_but_never_attributed_to_a_model(self):
        taxonomy = {"version": 5, "domains": [{"id": "implementation", "description": "d"}]}
        output = br.evaluate_batch(self.records[:1], taxonomy, evaluate=self.fake_answers)
        rows, summary = br.summarize(self.records[:1], output, br.evaluation_signature(taxonomy))
        self.assertEqual(rows[0]["evaluation_status"], "current")
        self.assertEqual(rows[0]["attribution"], "unlinked")
        self.assertEqual(rows[0]["operator_model"], "")
        self.assertEqual(summary["operator_association"], {})

    def test_stale_or_failed_latest_evaluation_is_never_reported_as_current(self):
        taxonomy = {"version": 5, "domains": [{"id": "implementation", "description": "d"}]}
        signature = br.evaluation_signature(taxonomy)
        first, second = br.evaluate_batch(self.records[:2], taxonomy, evaluate=self.fake_answers)
        failed = {**second, "error": "jev_inconsistent_distribution"}
        failed.pop("labels")
        self.records[0]["observed_checks"] = [{"command": "pytest", "summary": ["1 passed"], "exit_code": 0}]
        rows, summary = br.summarize(self.records[:2], [first, second, failed], signature)
        self.assertEqual([r["evaluation_status"] for r in rows], ["stale", "error"])
        self.assertEqual(rows[0]["disposition"], "stale")
        rows, _ = br.summarize(self.records[2:], br.evaluate_batch(self.records[2:], taxonomy,
                                                                  evaluate=self.fake_answers), "other-rubric")
        self.assertEqual(rows[0]["evaluation_status"], "stale")

    def test_domain_definitions_appear_in_every_domain_option(self):
        taxonomy = {"version": 5, "domains": [{"id": "audio", "description": "Create or edit sound."}]}
        options = br.questions(taxonomy)["domain_audio"]["criteria"]
        self.assertTrue(all("Create or edit sound." in text for text in options.values()))

    def test_private_output_must_live_directly_in_private_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "private"
            with self.assertRaises(SystemExit):
                br.private_path(Path(tmp) / "elsewhere.jsonl", root)
            path = br.private_path(root / "ok.jsonl", root)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
