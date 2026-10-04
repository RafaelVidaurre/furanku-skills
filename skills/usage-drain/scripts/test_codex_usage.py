import base64
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import codex_usage as m  # noqa: E402

ACCOUNT = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
EMAIL = "ada@example.com"
T0 = datetime(2020, 6, 1, tzinfo=timezone.utc)


def iso(moment):
    return m.format_time(moment)


def b64(obj):
    raw = base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return raw


def write_auth(path, account_id=ACCOUNT, email=EMAIL):
    token = f"{b64({'alg': 'none'})}.{b64({'email': email})}.sig"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "auth_mode": "chatgpt",
        "tokens": {"id_token": token, "access_token": "not-a-real-token", "account_id": account_id},
    }), encoding="utf-8")


def event(moment, kind, payload):
    return {"timestamp": iso(moment), "type": kind, "payload": payload}


def meta(account=ACCOUNT):
    return {"creator_account_id": account, "id": "session"}


def turn(model, effort="high", reasoning=None):
    payload = {"turn_id": "turn-1", "model": model, "effort": effort}
    if reasoning is not None:
        payload["collaboration_mode"] = {"mode": "default", "settings": {"reasoning_effort": reasoning}}
    return payload


def usage(response_id, input_tokens, cached, output, reasoning=0):
    return {
        "response_id": response_id,
        "turn_id": "turn-1",
        "usage": {
            "input_tokens": input_tokens,
            "cached_input_tokens": cached,
            "cache_write_input_tokens": 0,
            "output_tokens": output,
            "reasoning_output_tokens": reasoning,
            "total_tokens": input_tokens + output,
        },
        "turn_token_usage": {"input_tokens": 10**12, "output_tokens": 10**12, "total_tokens": 2 * 10**12},
        "thread_token_usage": {"input_tokens": 10**12, "output_tokens": 10**12, "total_tokens": 2 * 10**12},
    }


def gauge(moment_percent, resets_at, minutes=60, balance="100.0000", plan="promax"):
    percent = moment_percent
    return {
        "type": "token_count",
        "info": {
            "total_token_usage": {"input_tokens": 10**12, "output_tokens": 10**12, "total_tokens": 2 * 10**12},
            "last_token_usage": {"input_tokens": 10**12, "output_tokens": 9, "total_tokens": 10**12},
        },
        "rate_limits": {
            "limit_id": "codex",
            "primary": {
                "used_percent": percent,
                "window_minutes": minutes,
                "resets_at": int(resets_at.timestamp()),
            },
            "secondary": None,
            "credits": {"has_credits": True, "balance": balance},
            "plan_type": plan,
        },
    }


def write_jsonl(path, events):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(item) + "\n" for item in events), encoding="utf-8")


def run(tmp_path, events, extra=(), account=ACCOUNT, email=EMAIL):
    sessions = tmp_path / "sessions"
    auth = tmp_path / "auth.json"
    write_auth(auth, account, email)
    write_jsonl(sessions / "rollout-one.jsonl", events)
    return invoke(sessions, auth, extra)


def invoke(sessions, auth, extra=()):
    out = io.StringIO()
    err = io.StringIO()
    code = m.main(["--sessions", str(sessions), "--auth", str(auth), *extra], out, err)
    report = json.loads(out.getvalue()) if out.getvalue().strip() else None
    return code, report, err.getvalue()


def row(report, model, effort="high", speed="standard"):
    matches = [
        item for item in report["rows"]
        if item["model"] == model and item["effort"] == effort and item["speed"] == speed
    ]
    assert len(matches) == 1, report["rows"]
    return matches[0]


def test_cached_input_is_priced_apart_from_fresh_input(tmp_path):
    # Luna is 2.5 / 0.25 / 12.5 per million. Reasoning is already inside output.
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=2), "token_usage_record", usage("resp-split", 1_000_000, 800_000, 1_000_000, reasoning=500_000)),
        event(T0 + timedelta(minutes=3), "token_usage_record", usage("resp-over", 1_000_000, 1_500_000, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    split = (200_000 * 2.5 + 800_000 * 0.25 + 1_000_000 * 12.5) / 1_000_000
    over = (1_500_000 * 0.25) / 1_000_000
    assert report["rows"][0]["calls"] == 2
    assert report["rows"][0]["fresh_input_tokens"] == 200_000
    assert report["rows"][0]["cached_input_tokens"] == 2_300_000
    assert report["rows"][0]["output_tokens"] == 1_000_000
    assert report["rows"][0]["reasoning_output_tokens"] == 500_000
    assert report["rows"][0]["credits"] == pytest.approx(split + over)


def test_each_response_is_counted_once_and_snapshots_are_not(tmp_path):
    record = event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-1", 1_000, 0, 10))
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(seconds=30), "turn_context", turn("gpt-6-luna", "low")),
        record,
        record,
        event(T0 + timedelta(minutes=2), "event_msg", {
            "type": "item_completed",
            "latest_token_usage_record": {"usage": usage("resp-embedded", 10**9, 0, 10**9)},
        }),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    assert report["rows"][0]["calls"] == 1
    assert report["rows"][0]["fresh_input_tokens"] == 1_000
    assert report["rows"][0]["output_tokens"] == 10
    assert report["files"]["duplicate_responses"] == 1


def test_meter_rise_ignores_a_downward_flicker_and_splits_by_credits(tmp_path):
    resets = T0 + timedelta(hours=2)
    # 120 minutes so the window opens at T0. Astra fresh 1e6 = 250 credits.
    # Astra output 1e6 = 1250 credits. Luna cached 1e6 = 0.25 credits.
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=5), "turn_context", turn("gpt-6-astra")),
        event(T0 + timedelta(minutes=5), "token_usage_record", usage("resp-a", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=10), "event_msg", gauge(10, resets, minutes=120)),
        event(T0 + timedelta(minutes=12), "event_msg", gauge(9, resets, minutes=120)),
        event(T0 + timedelta(minutes=15), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=15), "token_usage_record", usage("resp-b", 1_000_000, 1_000_000, 0)),
        event(T0 + timedelta(minutes=16), "turn_context", turn("gpt-6-astra")),
        event(T0 + timedelta(minutes=16), "token_usage_record", usage("resp-c", 0, 0, 1_000_000)),
        event(T0 + timedelta(minutes=20), "event_msg", gauge(14, resets, minutes=120)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(resets)])
    assert code == 0, err
    assert report["quota"]["points_risen"] == pytest.approx(14)
    astra_first = row(report, "gpt-6-astra")
    # Two astra-high rows share a key, so resp-a and resp-c merge.
    # Their points: 10 from the first rise, plus C's share of the second.
    weight = 0.25 + 1250
    c_share = 4 * 1250 / weight
    b_share = 4 * 0.25 / weight
    assert row(report, "gpt-6-luna")["quota_points"] == round(b_share, 6)
    assert astra_first["quota_points"] == round(10 + c_share, 6)
    assert astra_first["calls"] == 2
    assert report["quota"]["points_in_table"] == pytest.approx(14)


def test_default_range_starts_at_the_latest_reset_and_drops_the_superseded_window(tmp_path):
    old_start = datetime(2020, 6, 1, tzinfo=timezone.utc)
    new_start = datetime(2020, 6, 2, tzinfo=timezone.utc)
    week = 7 * 24 * 60
    old_resets = old_start + timedelta(minutes=week)
    new_resets = new_start + timedelta(minutes=week)
    events = [
        event(old_start, "session_meta", meta()),
        event(old_start + timedelta(hours=12), "turn_context", turn("gpt-6-astra")),
        event(old_start + timedelta(hours=12), "token_usage_record", usage("resp-old", 5_000_000, 0, 0)),
        event(old_start + timedelta(hours=18), "event_msg", gauge(90, old_resets, minutes=week, plan="pro")),
        event(new_start + timedelta(hours=1), "turn_context", turn("gpt-6.1-sol")),
        event(new_start + timedelta(hours=1), "token_usage_record", usage("resp-new", 1_000_000, 0, 0)),
        event(new_start + timedelta(hours=2), "event_msg", gauge(5, new_resets, minutes=week, plan="promax")),
    ]
    code, report, err = run(tmp_path, events, ["--until", iso(new_start + timedelta(days=3))])
    assert code == 0, err
    assert report["range"]["since_is_latest_reset"] is True
    assert report["range"]["since"] == iso(new_start)
    assert report["quota"]["points_risen"] == pytest.approx(5)
    assert [item["model"] for item in report["rows"]] == ["gpt-6.1-sol"]
    assert report["quota"]["windows"][0]["plan_type"] == "promax"
    assert report["quota"]["windows"][0]["window_minutes"] == week


def test_custom_range_keeps_only_the_rise_inside_it(tmp_path):
    resets = T0 + timedelta(hours=3)
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=30), "event_msg", gauge(10, resets, minutes=180)),
        event(T0 + timedelta(minutes=45), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=45), "token_usage_record", usage("resp-out", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=75), "token_usage_record", usage("resp-in", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=90), "event_msg", gauge(16, resets, minutes=180)),
    ]
    code, report, err = run(
        tmp_path,
        events,
        ["--since", iso(T0 + timedelta(minutes=60)), "--until", iso(T0 + timedelta(hours=3))],
    )
    assert code == 0, err
    assert report["range"]["since_is_latest_reset"] is False
    assert report["rows"][0]["calls"] == 1
    assert report["quota"]["points_risen"] == pytest.approx(6)
    assert report["quota"]["points_in_table"] == pytest.approx(3)
    assert report["quota"]["points_outside_range"] == pytest.approx(3)


def test_a_reset_inside_the_range_starts_the_new_window_at_zero(tmp_path):
    first_end = T0 + timedelta(hours=1)
    second_end = T0 + timedelta(hours=2)
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=30), "event_msg", gauge(10, first_end)),
        event(T0 + timedelta(minutes=45), "turn_context", turn("gpt-6-luna", "medium")),
        event(T0 + timedelta(minutes=45), "token_usage_record", usage("resp-old", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=50), "event_msg", gauge(12, first_end)),
        event(T0 + timedelta(minutes=65), "turn_context", turn("gpt-6-sol", "medium")),
        event(T0 + timedelta(minutes=65), "token_usage_record", usage("resp-new", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=70), "event_msg", gauge(3, second_end)),
    ]
    code, report, err = run(
        tmp_path,
        events,
        ["--since", iso(T0 + timedelta(minutes=40)), "--until", iso(T0 + timedelta(minutes=90))],
    )
    assert code == 0, err
    assert report["quota"]["points_risen"] == pytest.approx(5)
    assert row(report, "gpt-6-luna", "medium")["quota_points"] == pytest.approx(2)
    assert row(report, "gpt-6-sol", "medium")["quota_points"] == pytest.approx(3)
    assert [window["gauge_high"] for window in report["quota"]["windows"]] == [12, 3]


def test_calls_after_the_last_high_keep_credits_and_add_no_points(tmp_path):
    resets = T0 + timedelta(hours=2)
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=5), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=5), "token_usage_record", usage("resp-before", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=10), "event_msg", gauge(4, resets, minutes=120)),
        event(T0 + timedelta(minutes=20), "token_usage_record", usage("resp-after", 2_000_000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(resets)])
    assert code == 0, err
    assert report["rows"][0]["calls"] == 2
    assert report["rows"][0]["quota_points"] == pytest.approx(4)
    assert report["quota"]["calls_after_last_tick"] == 1
    assert report["quota"]["credits_after_last_tick"] == pytest.approx(2_000_000 * 2.5 / 1_000_000)


def test_other_accounts_and_unattributed_sessions_are_excluded(tmp_path):
    sessions = tmp_path / "sessions"
    auth = tmp_path / "auth.json"
    write_auth(auth)
    write_jsonl(sessions / "mine.jsonl", [
        event(T0, "session_meta", meta(ACCOUNT)),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna", "low")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-mine", 1000, 0, 0)),
    ])
    write_jsonl(sessions / "theirs.jsonl", [
        event(T0, "session_meta", meta(OTHER)),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-astra")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-theirs", 10**7, 0, 0)),
    ])
    write_jsonl(sessions / "blank.jsonl", [
        event(T0, "session_meta", {"id": "no-owner"}),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-blank", 10**7, 0, 0)),
    ])
    code, report, err = invoke(
        sessions,
        auth,
        ["--account", "Ada@Example.com", "--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))],
    )
    assert code == 0, err
    assert report["account"]["email"] == EMAIL
    assert report["files"]["matched"] == 1
    assert report["files"]["other_account"] == 1
    assert report["files"]["unattributed"] == 1
    assert report["rows"][0]["fresh_input_tokens"] == 1000


def test_hardlinks_and_same_name_copies_are_counted_once(tmp_path):
    sessions = tmp_path / "sessions"
    auth = tmp_path / "auth.json"
    write_auth(auth)
    original = sessions / "a" / "rollout-same.jsonl"
    write_jsonl(original, [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-1", 1000, 0, 0)),
    ])
    linked = sessions / "b" / "rollout-linked.jsonl"
    linked.parent.mkdir(parents=True)
    os.link(original, linked)
    copied = sessions / "c" / "rollout-same.jsonl"
    copied.parent.mkdir(parents=True)
    copied.write_bytes(original.read_bytes())
    code, report, err = invoke(sessions, auth, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    assert report["files"]["matched"] == 1
    assert report["files"]["duplicate"] == 2
    assert report["rows"][0]["calls"] == 1


def test_auto_review_uses_the_luna_credit_rates(tmp_path):
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("codex-auto-review", "low")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-review", 2_000_000, 1_000_000, 1_000_000)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    # gpt-5.6-luna is 5 / 0.5 / 30. Fresh is input minus cached.
    assert row(report, "codex-auto-review", "low")["credits"] == pytest.approx((1_000_000 * 5 + 1_000_000 * 0.5 + 1_000_000 * 30) / 1_000_000)


def test_missing_effort_is_labeled_and_collaboration_effort_fills_it(tmp_path):
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", {"turn_id": "t", "model": "gpt-6-luna", "effort": None}),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-none", 1000, 0, 0)),
        event(T0 + timedelta(minutes=2), "turn_context", turn("gpt-6-luna", effort=None, reasoning="high")),
        event(T0 + timedelta(minutes=2), "token_usage_record", usage("resp-high", 1000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    efforts = sorted(item["effort"] for item in report["rows"])
    assert efforts == ["high", "not recorded"]


def test_speed_multiplier_follows_service_tier_only(tmp_path):
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "event_msg", {"type": "note", "text": "service_tier fast please"}),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-std", 1_000_000, 0, 0)),
        event(T0 + timedelta(minutes=2), "event_msg", {
            "type": "thread_settings_applied",
            "thread_settings": {"model": "gpt-6-luna", "service_tier": "fast", "reasoning_effort": "high"},
        }),
        event(T0 + timedelta(minutes=3), "token_usage_record", usage("resp-fast", 1_000_000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    base = 1_000_000 * 2.5 / 1_000_000
    assert row(report, "gpt-6-luna")["credits"] == pytest.approx(base)
    assert row(report, "gpt-6-luna", speed="fast")["credits"] == pytest.approx(base * 2.5)


def test_ultrafast_applies_to_astra_and_not_to_other_models(tmp_path):
    def session(model, response_id):
        return [
            event(T0, "session_meta", meta()),
            event(T0 + timedelta(minutes=1), "event_msg", {
                "type": "thread_settings_applied",
                "thread_settings": {"service_tier": "ultrafast"},
            }),
            event(T0 + timedelta(minutes=1), "turn_context", turn(model)),
            event(T0 + timedelta(minutes=1), "token_usage_record", usage(response_id, 1_000_000, 0, 0)),
        ]
    sessions = tmp_path / "sessions"
    auth = tmp_path / "auth.json"
    write_auth(auth)
    write_jsonl(sessions / "astra.jsonl", session("gpt-6-astra", "resp-astra"))
    write_jsonl(sessions / "luna.jsonl", session("gpt-6-luna", "resp-luna"))
    code, report, err = invoke(sessions, auth, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    assert row(report, "gpt-6-astra", speed="ultrafast")["credits"] == pytest.approx(250 * 8)
    luna = row(report, "gpt-6-luna", speed="ultrafast")
    assert luna["credits"] is None
    assert luna["fresh_input_tokens"] == 1_000_000
    assert any("ultrafast" in warning for warning in report["warnings"])


def test_an_unknown_model_stays_unpriced(tmp_path):
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-not-on-the-card")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-x", 1_000_000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    assert report["unpriced_models"] == ["gpt-not-on-the-card"]
    assert report["rows"][0]["credits"] is None
    assert report["rows"][0]["fresh_input_tokens"] == 1_000_000


def test_long_context_is_counted_at_the_standard_rate(tmp_path):
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-long", 300_000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    found = report["rows"][0]
    assert found["long_context_calls"] == 1
    assert found["credits"] == pytest.approx(300_000 * 2.5 / 1_000_000)


def test_a_purchased_balance_that_rises_is_not_drawn(tmp_path):
    resets = T0 + timedelta(hours=1)
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "event_msg", gauge(1, resets, balance="10.00")),
        event(T0 + timedelta(minutes=2), "event_msg", gauge(2, resets, balance="50.00")),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(resets)])
    assert code == 0, err
    assert report["purchased_credits"]["drawn"] is False
    assert report["purchased_credits"]["balance_end"] == "50.00"


def test_a_purchased_balance_that_falls_is_drawn(tmp_path):
    resets = T0 + timedelta(hours=1)
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "event_msg", gauge(1, resets, balance="50.00")),
        event(T0 + timedelta(minutes=2), "event_msg", gauge(2, resets, balance="40.00")),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(resets)])
    assert code == 0, err
    assert report["purchased_credits"]["drawn"] is True


def test_default_scan_ignores_sessions_last_modified_outside_the_lookback(tmp_path):
    now = datetime.now(timezone.utc)
    old_start = now - timedelta(days=30)
    new_start = now - timedelta(days=1)
    sessions = tmp_path / "sessions"
    auth = tmp_path / "auth.json"
    write_auth(auth)
    old = sessions / "old.jsonl"
    write_jsonl(old, [
        event(old_start, "session_meta", meta()),
        event(old_start + timedelta(hours=1), "turn_context", turn("gpt-6-astra")),
        event(old_start + timedelta(hours=1), "token_usage_record", usage("resp-old", 9_000_000, 0, 0)),
        event(old_start + timedelta(hours=2), "event_msg", gauge(80, old_start + timedelta(days=40), minutes=40 * 24 * 60)),
    ])
    os.utime(old, (old_start.timestamp(), old_start.timestamp()))
    write_jsonl(sessions / "new.jsonl", [
        event(new_start, "session_meta", meta()),
        event(new_start + timedelta(hours=1), "turn_context", turn("gpt-6-luna", "low")),
        event(new_start + timedelta(hours=1), "token_usage_record", usage("resp-new", 1000, 0, 0)),
        event(new_start + timedelta(hours=2), "event_msg", gauge(4, new_start + timedelta(days=7), minutes=7 * 24 * 60)),
    ])
    code, report, err = invoke(sessions, auth, ["--until", iso(now + timedelta(days=1))])
    assert code == 0, err
    assert report["quota"]["points_risen"] == pytest.approx(4)
    assert [item["model"] for item in report["rows"]] == ["gpt-6-luna"]


def test_no_gauge_and_no_since_exits_without_inventing_a_window(tmp_path):
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-1", 1000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events)
    assert code == 3
    assert report is None
    assert "--since" in err


def test_explicit_paths_do_not_read_the_machine_home(tmp_path, monkeypatch):
    def boom():
        raise AssertionError("machine home was read")
    monkeypatch.setattr(m.Path, "home", boom)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    events = [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-1", 1000, 0, 0)),
    ]
    code, report, err = run(tmp_path, events, ["--since", iso(T0), "--until", iso(T0 + timedelta(hours=1))])
    assert code == 0, err
    assert report["rows"][0]["calls"] == 1


def test_discovery_reads_the_codex_home_and_orca_homes(tmp_path, monkeypatch):
    monkeypatch.setattr(m.Path, "home", lambda: tmp_path)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    codex_home = tmp_path / "codex"
    write_auth(codex_home / "auth.json")
    write_jsonl(codex_home / "sessions" / "rollout-home.jsonl", [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=1), "turn_context", turn("gpt-6-luna", "low")),
        event(T0 + timedelta(minutes=1), "token_usage_record", usage("resp-home", 1000, 0, 0)),
    ])
    orca = tmp_path / "Library" / "Application Support" / "orca" / "codex-accounts"
    write_jsonl(orca / "tree-a" / "home" / "sessions" / "rollout-orca.jsonl", [
        event(T0, "session_meta", meta()),
        event(T0 + timedelta(minutes=2), "turn_context", turn("gpt-6-luna", "low")),
        event(T0 + timedelta(minutes=2), "token_usage_record", usage("resp-orca", 2000, 0, 0)),
    ])
    write_jsonl(orca / "tree-b" / "home" / "sessions" / "rollout-other.jsonl", [
        event(T0, "session_meta", meta(OTHER)),
        event(T0 + timedelta(minutes=2), "token_usage_record", usage("resp-other", 10**7, 0, 0)),
    ])
    out = io.StringIO()
    err = io.StringIO()
    code = m.main([
        "--codex-home", str(codex_home),
        "--since", iso(T0),
        "--until", iso(T0 + timedelta(hours=1)),
    ], out, err)
    assert code == 0, err.getvalue()
    report = json.loads(out.getvalue())
    assert report["files"]["matched"] == 2
    assert report["files"]["other_account"] == 1
    assert report["rows"][0]["fresh_input_tokens"] == 3000
