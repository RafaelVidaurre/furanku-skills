import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import usage_drain as m  # noqa: E402
from test_claude_usage import assistant, usage, write_jsonl  # noqa: E402
from test_codex_usage import event, meta, turn, usage as codex_usage_event, write_auth, write_jsonl as write_codex  # noqa: E402
from test_grok_usage import turn as grok_turn, write_session  # noqa: E402

T0 = datetime(2020, 6, 1, tzinfo=timezone.utc)


def iso(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_all_harnesses_are_one_report(tmp_path):
    projects = tmp_path / "projects"
    write_jsonl(projects / "session.jsonl", [
        assistant(T0, "claude-haiku-4-5", usage(input_tokens=100)),
    ])
    write_session(tmp_path / "grok", "one", [grok_turn(T0, "grok-4.7", 20)])
    sessions = tmp_path / "sessions"
    auth = tmp_path / "auth.json"
    write_auth(auth)
    write_codex(sessions / "rollout.jsonl", [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna", "low")),
        event(T0 + timedelta(minutes=2), "token_usage_record", codex_usage_event("resp-1", 1000, 0, 10)),
    ])
    out = io.StringIO()
    code = m.main([
        "--since", iso(T0),
        "--until", iso(T0 + timedelta(hours=1)),
        "--sessions", str(sessions),
        "--auth", str(auth),
        "--projects", str(projects),
        "--grok-home", str(tmp_path / "grok"),
    ], out, io.StringIO())
    assert code == 0
    report = json.loads(out.getvalue())
    assert set(report["harnesses"]) == {"codex", "claude", "grok"}
    assert report["harnesses"]["claude"]["rows"][0]["model"] == "claude-haiku-4-5"
    assert report["harnesses"]["grok"]["rows"][0]["model"] == "grok-4.7"
    assert report["harnesses"]["codex"]["rows"][0]["model"] == "gpt-6-luna"


def test_one_harness_does_not_discover_the_others(tmp_path, monkeypatch):
    def boom():
        raise AssertionError("Path.home")

    monkeypatch.setattr(m.Path, "home", boom)
    monkeypatch.setattr(m.claude_usage.Path, "home", boom)
    projects = tmp_path / "projects"
    write_jsonl(projects / "session.jsonl", [])
    out = io.StringIO()
    code = m.main([
        "--harness", "claude",
        "--projects", str(projects),
        "--since", iso(T0),
        "--until", iso(T0),
    ], out, io.StringIO())
    assert code == 0
    report = json.loads(out.getvalue())
    assert set(report["harnesses"]) == {"claude"}


def test_a_bad_timestamp_on_one_harness_exits(tmp_path):
    err = io.StringIO()
    code = m.main(["--harness", "claude", "--projects", str(tmp_path), "--since", "Tuesday"], io.StringIO(), err)
    assert code == 1
    assert "--since" in err.getvalue()
