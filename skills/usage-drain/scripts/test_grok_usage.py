import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import grok_usage as m  # noqa: E402

T0 = datetime(2020, 6, 1, tzinfo=timezone.utc)


def iso(moment):
    return m.codex_usage.format_time(moment)


def turn(moment, model, tokens, calls=1, ticks=10_000_000_000, number=1):
    part = {
        "inputTokens": tokens,
        "cachedReadTokens": 0,
        "cacheCreationTokens": 0,
        "outputTokens": 10,
        "reasoningTokens": 4,
        "modelCalls": calls,
        "costUsdTicks": ticks,
    }
    return {
        "turnNumber": number,
        "endedAt": iso(moment),
        "inputTokens": tokens,
        "outputTokens": 10,
        "modelCalls": calls,
        "primaryModelId": model,
        "modelUsage": {model: part},
    }


def write_session(home, name, turns, effort="high", created="2020-01-01T00:00:00Z", session_input=10**12):
    directory = home / "sessions" / name
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "summary.json").write_text(json.dumps({
        "created_at": created,
        "reasoning_effort": effort,
    }), encoding="utf-8")
    (directory / "usage.json").write_text(json.dumps({
        "session": {"inputTokens": session_input, "costUsdTicks": 10**15, "modelCalls": 999},
        "turns": turns,
    }), encoding="utf-8")
    return directory


def test_turn_cost_is_the_recorded_ticks_and_session_totals_are_not_added(tmp_path):
    write_session(tmp_path, "one", [turn(T0, "grok-4.7", 1_000_000)])
    report = m.build_report(tmp_path, since=T0, until=T0 + timedelta(hours=1))
    row = report["rows"][0]
    assert row["calls"] == 1
    assert row["input_tokens"] == 1_000_000
    assert row["output_tokens"] == 10
    assert row["reasoning_tokens"] == 4
    assert row["usd"] == pytest.approx(1)
    assert row["effort"] == "high"


def test_a_resumed_copy_of_a_turn_counts_once(tmp_path):
    copied = turn(T0, "grok-4.7", 100, number=1)
    write_session(tmp_path, "parent", [copied], created="2020-01-01T00:00:00Z")
    write_session(
        tmp_path, "child",
        [copied, turn(T0 + timedelta(minutes=5), "grok-4.7", 50, number=2)],
        created="2020-06-01T00:00:00Z",
    )
    report = m.build_report(tmp_path, since=T0 - timedelta(days=1), until=T0 + timedelta(hours=1))
    assert report["rows"][0]["calls"] == 2
    assert report["rows"][0]["input_tokens"] == 150
    assert report["files"]["duplicate_turns"] == 1


def test_model_usage_splits_one_turn_across_models(tmp_path):
    directory = write_session(tmp_path, "split", [], effort="xhigh")
    payload = json.loads((directory / "usage.json").read_text(encoding="utf-8"))
    payload["turns"] = [{
        "turnNumber": 1,
        "endedAt": iso(T0),
        "inputTokens": 30,
        "outputTokens": 5,
        "modelCalls": 3,
        "modelUsage": {
            "grok-4.7": {"inputTokens": 10, "outputTokens": 2, "reasoningTokens": 1, "modelCalls": 1, "costUsdTicks": 10_000_000_000},
            "grok-4.7-fast": {"inputTokens": 20, "outputTokens": 3, "reasoningTokens": 1, "modelCalls": 2, "costUsdTicks": 20_000_000_000},
        },
    }]
    (directory / "usage.json").write_text(json.dumps(payload), encoding="utf-8")
    report = m.build_report(tmp_path, since=T0, until=T0 + timedelta(hours=1))
    by_model = {row["model"]: row for row in report["rows"]}
    assert by_model["grok-4.7"]["usd"] == pytest.approx(1)
    assert by_model["grok-4.7"]["effort"] == "xhigh"
    assert by_model["grok-4.7-fast"]["calls"] == 2
    assert by_model["grok-4.7-fast"]["usd"] == pytest.approx(2)
    assert by_model["grok-4.7"]["input_tokens"] + by_model["grok-4.7-fast"]["input_tokens"] == 30


def test_a_turn_without_a_recorded_cost_stays_unpriced(tmp_path):
    write_session(tmp_path, "one", [turn(T0, "grok-4.7", 10, ticks=None)])
    report = m.build_report(tmp_path, since=T0, until=T0 + timedelta(hours=1))
    assert report["rows"][0]["usd"] is None
    assert report["rows"][0]["input_tokens"] == 10
    assert report["unpriced_models"] == ["grok-4.7"]


def test_default_window_is_the_trailing_seven_days(tmp_path):
    now = datetime(2024, 5, 20, tzinfo=timezone.utc)
    write_session(tmp_path, "recent", [turn(now - timedelta(days=1), "grok-4.7", 10)], created="2024-05-19T00:00:00Z")
    write_session(tmp_path, "old", [turn(now - timedelta(days=8), "grok-4", 10)], created="2024-05-01T00:00:00Z")
    report = m.build_report(tmp_path, now=now)
    assert report["range"]["since_is_latest_reset"] is False
    assert [row["model"] for row in report["rows"]] == ["grok-4.7"]
    assert report["quota"]["available"] is False


def test_default_scan_ignores_usage_files_last_modified_outside_the_window(tmp_path):
    now = datetime.now(timezone.utc)
    recent = write_session(tmp_path, "recent", [turn(now - timedelta(days=1), "grok-4.7", 10)])
    stale = write_session(tmp_path, "stale", [turn(now - timedelta(hours=1), "grok-4", 99)])
    old = (now - timedelta(days=30)).timestamp()
    os.utime(stale / "usage.json", (old, old))
    out = io.StringIO()
    code = m.main(["--grok-home", str(tmp_path), "--until", iso(now + timedelta(days=1))], out, io.StringIO())
    assert code == 0
    report = json.loads(out.getvalue())
    assert [row["model"] for row in report["rows"]] == ["grok-4.7"]
    assert recent.name == "recent"


def test_explicit_home_does_not_touch_the_machine_home(tmp_path, monkeypatch):
    def boom():
        raise AssertionError("Path.home")

    monkeypatch.setattr(m.Path, "home", boom)
    write_session(tmp_path, "one", [])
    code = m.main(
        ["--grok-home", str(tmp_path), "--since", iso(T0), "--until", iso(T0)],
        io.StringIO(), io.StringIO(),
    )
    assert code == 0
