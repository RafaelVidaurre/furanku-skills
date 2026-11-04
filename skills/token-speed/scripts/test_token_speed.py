import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import token_speed as m  # noqa: E402

ACCOUNT = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
T0 = datetime(2020, 6, 1, tzinfo=timezone.utc)


def iso(moment):
    return m.format_time(moment)


def b64(obj):
    raw = __import__("base64").urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return raw


def write_auth(path):
    token = f"{b64({'alg': 'none'})}.{b64({'email': 'ada@example.com'})}.sig"
    path.write_text(json.dumps({"tokens": {"id_token": token, "account_id": ACCOUNT}}), encoding="utf-8")


def event(moment, kind, payload):
    return {"timestamp": iso(moment), "type": kind, "payload": payload}


def item(kind, start_ms, end_ms):
    return {
        "type": "item_completed",
        "item": {"type": kind, "id": "item"},
        "started_at_ms": start_ms,
        "completed_at_ms": end_ms,
    }


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def run(tmp_path, harness, **files):
    sessions = tmp_path / "sessions"
    projects = tmp_path / "projects"
    grok = tmp_path / "grok"
    auth = tmp_path / "auth.json"
    write_auth(auth)
    for name, rows in files.get("codex", {}).items():
        write_jsonl(sessions / name, rows)
    for name, rows in files.get("claude", {}).items():
        write_jsonl(projects / name, rows)
    for name, payload in files.get("grok", {}).items():
        root = grok / "sessions" / name
        root.mkdir(parents=True, exist_ok=True)
        for filename, body in payload.items():
            target = root / filename
            if filename.endswith(".jsonl"):
                write_jsonl(target, body)
            else:
                target.write_text(json.dumps(body), encoding="utf-8")
    out = io.StringIO()
    err = io.StringIO()
    output = tmp_path / "chart.html"
    code = m.main([
        "--harness", harness,
        "--since", iso(T0 - timedelta(hours=1)),
        "--until", iso(T0 + timedelta(hours=1)),
        "--sessions", str(sessions),
        "--auth", str(auth),
        "--projects", str(projects),
        "--grok-home", str(grok),
        "--output", str(output),
        "--no-open",
    ], out, err)
    report = json.loads(out.getvalue()) if out.getvalue().strip() else None
    page = output.read_text(encoding="utf-8") if output.exists() else ""
    return code, report, err.getvalue(), page


def codex_response(output, response_id="resp-1", account=ACCOUNT):
    base = int(T0.timestamp() * 1000)
    return [
        event(T0, "session_meta", {"creator_account_id": account, "id": "s"}),
        event(T0, "turn_context", {"model": "gpt-6.1-sol", "effort": "high"}),
        event(T0, "event_msg", item("Reasoning", base, base + 2000)),
        event(T0, "event_msg", item("CommandExecution", base + 2000, base + 12000)),
        event(T0, "event_msg", item("AgentMessage", base + 12000, base + 13000)),
        event(T0 + timedelta(seconds=14), "token_usage_record", {
            "response_id": response_id,
            "usage": {"output_tokens": output, "input_tokens": 10, "cached_input_tokens": 0, "reasoning_output_tokens": 1},
        }),
    ]


def test_codex_clock_excludes_tool_time_and_other_accounts(tmp_path):
    code, report, _err, page = run(tmp_path, "codex", codex={
        "mine.jsonl": codex_response(300),
        "other.jsonl": codex_response(9000, "resp-other", OTHER),
        "again.jsonl": codex_response(300, "resp-1"),
    })
    assert code == 0
    assert report["rows"] == [{
        "harness": "codex",
        "model": "gpt-6.1-sol",
        "effort": "high",
        "calls": 1,
        "output_tokens": 300,
        "seconds": 3.0,
        "pooled": 100.0,
        "median": 100.0,
        "p90": 100.0,
    }]
    assert report["account_email"] == "ada@example.com"
    assert "gpt-6.1-sol" in page and 'id="chart"' in page
    assert m.CLOCKS["codex"] in page


def test_a_span_under_50ms_is_untimed(tmp_path):
    base = int(T0.timestamp() * 1000)
    rows = [
        event(T0, "session_meta", {"creator_account_id": ACCOUNT}),
        event(T0, "turn_context", {"model": "gpt-6-luna", "effort": ""}),
        event(T0, "event_msg", item("AgentMessage", base, base + 10)),
        event(T0, "token_usage_record", {"response_id": "resp-short", "usage": {"output_tokens": 80}}),
    ]
    _code, report, _err, _page = run(tmp_path, "codex", codex={"short.jsonl": rows})
    assert report["rows"] == []
    assert report["untimed"]["codex"] == 1


def test_claude_uses_the_request_boundary_once_per_message(tmp_path):
    rows = [
        {"type": "user", "timestamp": iso(T0), "message": {"role": "user"}},
        {"type": "assistant", "timestamp": iso(T0 + timedelta(seconds=1)), "effort": "high",
         "message": {"id": "msg-1", "model": "claude-opus-5-5[1m]", "usage": {"output_tokens": 400}}},
        {"type": "assistant", "timestamp": iso(T0 + timedelta(seconds=5)), "effort": "high",
         "message": {"id": "msg-1", "model": "claude-opus-5-5[1m]", "usage": {"output_tokens": 400}}},
        {"type": "assistant", "timestamp": iso(T0 + timedelta(seconds=6)), "effort": "low",
         "message": {"id": "msg-2", "model": "claude-haiku-4-5", "usage": {"output_tokens": 100}}},
    ]
    _code, report, _err, _page = run(tmp_path, "claude", claude={"session.jsonl": rows})
    by_model = {row["model"]: row for row in report["rows"]}
    assert by_model["claude-opus-5-5"]["calls"] == 1
    assert by_model["claude-opus-5-5"]["output_tokens"] == 400
    assert by_model["claude-opus-5-5"]["seconds"] == 5.0
    assert by_model["claude-opus-5-5"]["pooled"] == 80.0
    assert by_model["claude-haiku-4-5"]["seconds"] == 1.0
    assert by_model["claude-haiku-4-5"]["pooled"] == 100.0


def test_claude_without_a_request_record_is_untimed(tmp_path):
    rows = [{
        "type": "assistant", "timestamp": iso(T0), "effort": "high",
        "message": {"id": "msg-1", "model": "claude-opus-5-5", "usage": {"output_tokens": 50}},
    }]
    _code, report, _err, _page = run(tmp_path, "claude", claude={"solo.jsonl": rows})
    assert report["rows"] == []
    assert report["untimed"]["claude"] == 1


def grok_session(model_usage, events, created="2020-06-01T00:00:00Z"):
    end = T0 + timedelta(seconds=70)
    return {
        "summary.json": {"reasoning_effort": "high", "created_at": created},
        "usage.json": {"turns": [{
            "endedAt": iso(end),
            "turnNumber": 1,
            "inputTokens": 10,
            "outputTokens": sum(part["outputTokens"] for part in model_usage.values()),
            "modelCalls": 2,
            "modelUsage": model_usage,
        }]},
        "events.jsonl": events,
    }


def grok_events():
    return [
        {"ts": iso(T0), "type": "turn_started"},
        {"ts": iso(T0), "type": "loop_started"},
        {"ts": iso(T0 + timedelta(seconds=10)), "type": "tool_started"},
        {"ts": iso(T0 + timedelta(seconds=60)), "type": "loop_started"},
        {"ts": iso(T0 + timedelta(seconds=70)), "type": "tool_started"},
        {"ts": iso(T0 + timedelta(seconds=70)), "type": "turn_ended"},
    ]


def test_grok_sums_loops_and_leaves_a_mixed_turn_out(tmp_path):
    code, report, _err, page = run(tmp_path, "grok", grok={
        "one": grok_session({"grok-4.7-build": {"outputTokens": 2000, "modelCalls": 2}}, grok_events()),
        "mixed": grok_session({
            "grok-4.7-build": {"outputTokens": 100, "modelCalls": 1},
            "grok-4.7-build-fast": {"outputTokens": 50, "modelCalls": 1},
        }, grok_events(), created="2020-06-01T00:00:01Z"),
    })
    assert code == 0
    assert len(report["rows"]) == 1
    assert report["rows"][0]["model"] == "grok-4.7-build"
    assert report["rows"][0]["seconds"] == 20.0
    assert report["rows"][0]["pooled"] == 100.0
    assert report["mixed_turns"] == 1
    assert m.CLOCKS["grok"] in page


def test_a_copied_grok_turn_is_measured_once(tmp_path):
    original = grok_session({"grok-4.7-build": {"outputTokens": 2000, "modelCalls": 2}}, grok_events())
    copy = grok_session(
        {"grok-4.7-build": {"outputTokens": 2000, "modelCalls": 2}},
        [{"ts": iso(T0), "type": "turn_started"}, {"ts": iso(T0 + timedelta(seconds=70)), "type": "turn_ended"}],
        created="2020-06-02T00:00:00Z",
    )
    _code, report, _err, _page = run(tmp_path, "grok", grok={"original": original, "copy": copy})
    assert report["rows"][0]["calls"] == 1
    assert report["rows"][0]["pooled"] == 100.0


def test_explicit_paths_do_not_touch_the_home_directory(tmp_path, monkeypatch):
    def boom():
        raise AssertionError("home")

    monkeypatch.setattr(m.Path, "home", boom)
    code, report, err, _page = run(tmp_path, "all")
    assert code == 0, err
    assert report["rows"] == []


def test_a_bad_timestamp_exits_before_a_page(tmp_path):
    err = io.StringIO()
    code = m.main(["--since", "yesterday", "--no-open", "--output", str(tmp_path / "x.html"),
                   "--sessions", str(tmp_path), "--auth", str(tmp_path / "missing")], None, err)
    assert code == 1
    assert "--since" in err.getvalue()
    assert not (tmp_path / "x.html").exists()
