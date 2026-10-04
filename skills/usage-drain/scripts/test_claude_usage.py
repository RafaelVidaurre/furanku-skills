import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import claude_usage as m  # noqa: E402

T0 = datetime(2020, 6, 1, tzinfo=timezone.utc)


def iso(moment):
    return m.codex_usage.format_time(moment)


def assistant(moment, model, usage, message_id="msg-1", effort="high", speed="standard", geo="not_available"):
    return {
        "type": "assistant",
        "timestamp": iso(moment),
        "uuid": message_id + "-line",
        "requestId": "req-" + message_id,
        "effort": effort,
        "message": {
            "id": message_id,
            "model": model,
            "usage": {"speed": speed, "inference_geo": geo, **usage},
        },
    }


def usage(input_tokens=0, cache_read=0, cache_write=0, five=None, hour=None, output=0, thinking=0):
    payload = {
        "input_tokens": input_tokens,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": cache_write,
        "output_tokens": output,
        "output_tokens_details": {"thinking_tokens": thinking},
    }
    if five is not None or hour is not None:
        payload["cache_creation"] = {
            "ephemeral_5m_input_tokens": five or 0,
            "ephemeral_1h_input_tokens": hour or 0,
        }
    return payload


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")


def report_for(tmp_path, records, extra=(), now=None):
    projects = tmp_path / "projects"
    write_jsonl(projects / "session.jsonl", records)
    if extra:
        out = io.StringIO()
        err = io.StringIO()
        code = m.main(["--projects", str(projects), *extra], out, err)
        body = json.loads(out.getvalue()) if out.getvalue().strip() else None
        return code, body, err.getvalue()
    return 0, m.build_report([projects], m.load_rates(), now=now or T0 + timedelta(days=1)), ""


def test_cache_buckets_are_priced_apart_from_input(tmp_path):
    # Fable 5.1 is 10 / 12.50 / 20 / 0.25 / 50. Thinking stays inside output.
    records = [
        assistant(T0, "claude-fable-5-1", usage(
            input_tokens=1_000_000, cache_read=1_000_000, cache_write=1_500_000,
            five=1_000_000, hour=500_000, output=1_000_000, thinking=400_000,
        )),
    ]
    code, report, err = report_for(tmp_path, records, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    row = report["rows"][0]
    assert row["input_tokens"] == 1_000_000
    assert row["cache_read_input_tokens"] == 1_000_000
    assert row["cache_write_input_tokens"] == 1_500_000
    assert row["output_tokens"] == 1_000_000
    assert row["reasoning_output_tokens"] == 400_000
    assert row["usd"] == pytest.approx(10 + 12.5 + 10 + 0.25 + 50)


def test_each_message_is_counted_once(tmp_path):
    one = assistant(T0, "claude-haiku-4-5", usage(input_tokens=1_000, output=10))
    other = assistant(T0, "claude-haiku-4-5", usage(input_tokens=9_000, output=10), message_id="msg-2")
    projects = tmp_path / "projects"
    write_jsonl(projects / "session.jsonl", [one, one])
    write_jsonl(projects / "subagents" / "child.jsonl", [other])
    report = m.build_report([projects], m.load_rates(), since=T0, until=T0 + timedelta(hours=1))
    assert report["rows"][0]["calls"] == 2
    assert report["rows"][0]["input_tokens"] == 10_000


def test_a_zero_token_call_is_not_usage(tmp_path):
    records = [
        assistant(T0, "<synthetic>", usage(), message_id="empty"),
        assistant(T0, "claude-haiku-4-5", usage(input_tokens=10), message_id="real"),
    ]
    _code, report, _err = report_for(
        tmp_path, records, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))],
    )
    assert [row["model"] for row in report["rows"]] == ["claude-haiku-4-5"]
    assert report["unpriced_models"] == []


def test_unknown_model_keeps_tokens_and_stays_unpriced(tmp_path):
    _code, report, _err = report_for(
        tmp_path,
        [assistant(T0, "claude-opus-4-8", usage(input_tokens=50, output=5))],
        ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))],
    )
    row = report["rows"][0]
    assert row["usd"] is None
    assert row["input_tokens"] == 50
    assert report["unpriced_models"] == ["claude-opus-4-8"]


def test_context_suffix_uses_the_base_model_rate(tmp_path):
    _code, report, _err = report_for(
        tmp_path,
        [assistant(T0, "claude-opus-5-5[1m]", usage(input_tokens=1_000_000))],
        ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))],
    )
    assert report["rows"][0]["model"] == "claude-opus-5-5"
    assert report["rows"][0]["usd"] == pytest.approx(4)


def test_fast_output_is_priced_and_fast_cache_is_not(tmp_path):
    plain_root = tmp_path / "plain"
    write_jsonl(plain_root / "session.jsonl", [
        assistant(T0, "claude-opus-5-5", usage(output=1_000_000), message_id="fast-out", speed="fast"),
    ])
    plain = m.build_report([plain_root], m.load_rates(), since=T0, until=T0 + timedelta(hours=1))
    assert plain["rows"][0]["usd"] == pytest.approx(40)
    cached_root = tmp_path / "cached"
    write_jsonl(cached_root / "session.jsonl", [
        assistant(T0, "claude-opus-5-5", usage(output=10, cache_read=1_000), message_id="fast-cache", speed="fast"),
    ])
    cached = m.build_report([cached_root], m.load_rates(), since=T0, until=T0 + timedelta(hours=1))
    assert cached["rows"][0]["usd"] is None
    assert any("cache" in warning for warning in cached["warnings"])


def test_us_inference_multiplies_only_when_the_card_has_a_multiplier(tmp_path):
    projects = tmp_path / "projects"
    write_jsonl(projects / "geo.jsonl", [
        assistant(T0, "claude-opus-5-5", usage(input_tokens=1_000_000), message_id="us", geo="us"),
        assistant(T0, "claude-opus-5-5", usage(input_tokens=1_000_000), message_id="plain", geo="not_available"),
    ])
    report = m.build_report([projects], m.load_rates(), since=T0, until=T0 + timedelta(hours=1))
    assert report["rows"][0]["usd"] == pytest.approx(4 * 1.1 + 4)


def test_default_window_is_the_trailing_seven_days(tmp_path):
    now = datetime(2024, 5, 20, tzinfo=timezone.utc)
    projects = tmp_path / "projects"
    write_jsonl(projects / "recent.jsonl", [
        assistant(now - timedelta(days=1), "claude-haiku-4-5", usage(input_tokens=100), message_id="recent"),
    ])
    write_jsonl(projects / "old.jsonl", [
        assistant(now - timedelta(days=8), "claude-opus-5-5", usage(input_tokens=100), message_id="old"),
    ])
    report = m.build_report([projects], m.load_rates(), now=now)
    assert report["range"]["since_is_latest_reset"] is False
    assert report["rows"][0]["model"] == "claude-haiku-4-5"
    assert any("trailing 7 days" in warning for warning in report["warnings"])
    assert report["quota"]["available"] is False


def test_default_scan_ignores_files_last_modified_outside_the_window(tmp_path):
    now = datetime.now(timezone.utc)
    projects = tmp_path / "projects"
    recent = projects / "recent.jsonl"
    stale = projects / "stale.jsonl"
    write_jsonl(recent, [
        assistant(now - timedelta(days=1), "claude-haiku-4-5", usage(input_tokens=10), message_id="recent"),
    ])
    write_jsonl(stale, [
        assistant(now - timedelta(hours=1), "claude-opus-5-5", usage(input_tokens=10), message_id="stale"),
    ])
    old = (now - timedelta(days=30)).timestamp()
    os.utime(stale, (old, old))
    out = io.StringIO()
    code = m.main(["--projects", str(projects), "--until", iso(now + timedelta(days=1))], out, io.StringIO())
    assert code == 0
    report = json.loads(out.getvalue())
    assert [row["model"] for row in report["rows"]] == ["claude-haiku-4-5"]


def test_explicit_projects_do_not_touch_the_machine_home(tmp_path, monkeypatch):
    def boom():
        raise AssertionError("Path.home")

    monkeypatch.setattr(m.Path, "home", boom)
    projects = tmp_path / "projects"
    write_jsonl(projects / "session.jsonl", [])
    code = m.main(["--projects", str(projects), "--since", iso(T0), "--until", iso(T0)], io.StringIO(), io.StringIO())
    assert code == 0
