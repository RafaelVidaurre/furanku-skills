#!/usr/bin/env python3
"""Report which Codex model and effort levels drained the weekly allowance.

Reads local Codex rollout JSONL and auth.json. Prints one JSON report.

  python3 codex_usage.py [--codex-home DIR] [--sessions DIR ...] [--auth FILE]
      [--account EMAIL|ID] [--since ISO] [--until ISO]

With --since omitted, the report starts at the latest primary quota window
(resets_at minus window_minutes) and ends at --until, or at the present.
Pass --sessions and --auth to read only those paths.

Billable usage is token_usage_record.payload.usage, once per response_id.
cached_input_tokens is a subset of input_tokens. Credits price the fresh
remainder and the cached subset at the rates in rates.json. The weekly column
is the primary used_percent rise in the selected range, split across calls by
those credits. A downward flicker of the gauge is ignored.
"""

import argparse
import base64
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

RESET_CLUSTER_SECONDS = 30
# Files last modified before this horizon cannot hold the open weekly window.
RESET_LOOKBACK = timedelta(days=21)
MTIME_SLACK = timedelta(hours=1)
PENDING_META_BYTES = 2_000_000
MARKERS = (
    b"session_meta",
    b"turn_context",
    b"token_usage_record",
    b"used_percent",
    b"service_tier",
)
STANDARD_TIERS = ("", "default", "standard")


def rates_path():
    return Path(__file__).with_name("rates.json")


def load_rates(path=None):
    path = Path(path) if path else rates_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    models = dict(data["credits_per_million_tokens"])
    for slug, alias in (data.get("aliases") or {}).items():
        target = alias["priced_as"]
        if target not in models:
            raise SystemExit(f"rates alias {slug} points at unknown model {target}")
        models[slug] = models[target]
    data["models"] = models
    return data


def parse_time(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return datetime.fromtimestamp(value, timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_time(moment):
    moment = moment.astimezone(timezone.utc)
    base = moment.strftime("%Y-%m-%dT%H:%M:%S")
    if moment.microsecond:
        frac = f"{moment.microsecond:06d}".rstrip("0")
        return f"{base}.{frac}Z"
    return base + "Z"


def jwt_email(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (AttributeError, IndexError, ValueError, json.JSONDecodeError):
        return None
    email = claims.get("email") if isinstance(claims, dict) else None
    return email if isinstance(email, str) and email else None


def read_auth(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    tokens = data.get("tokens") if isinstance(data, dict) else None
    if not isinstance(tokens, dict):
        raise ValueError("auth file has no tokens object")
    account_id = tokens.get("account_id")
    if not isinstance(account_id, str) or not account_id:
        raise ValueError("auth file has no account id")
    return {"id": account_id, "email": jwt_email(tokens.get("id_token") or "")}


def account_matches(identity, wanted):
    if not wanted:
        return True
    if wanted == identity["id"]:
        return True
    email = identity.get("email") or ""
    return email.lower() == wanted.lower()


def orca_homes(home):
    root = home / "Library" / "Application Support" / "orca" / "codex-accounts"
    if not root.is_dir():
        return []
    homes = []
    for child in sorted(root.iterdir()):
        candidate = child / "home"
        if candidate.is_dir():
            homes.append(candidate)
    return homes


def discover_session_dirs(codex_home, home):
    dirs = []
    for base in [codex_home, *orca_homes(home)]:
        for name in ("sessions", "archived_sessions"):
            candidate = base / name
            if candidate.is_dir():
                dirs.append(candidate)
    return dirs


def discover_auth_files(codex_home, home):
    files = []
    for base in [codex_home, *orca_homes(home)]:
        candidate = base / "auth.json"
        if candidate.is_file():
            files.append(candidate)
    return files


def iter_jsonl(root):
    root = Path(root)
    if not root.exists():
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            if name.endswith(".jsonl"):
                yield Path(dirpath) / name


def deduped_files(roots, not_before=None):
    seen_inodes = set()
    seen_name_size = set()
    unique = []
    duplicates = 0
    cutoff = None if not_before is None else not_before.timestamp()
    for root in roots:
        for path in iter_jsonl(root):
            try:
                stat = path.stat()
            except OSError:
                continue
            # mtime only skips files that cannot contain in-range events.
            # Event timestamps still decide which calls count.
            if cutoff is not None and stat.st_mtime < cutoff:
                continue
            inode = (stat.st_dev, stat.st_ino)
            name_size = (path.name, stat.st_size)
            if inode in seen_inodes or name_size in seen_name_size:
                duplicates += 1
                continue
            seen_inodes.add(inode)
            seen_name_size.add(name_size)
            unique.append(path)
    return unique, duplicates


def effort_of(payload):
    effort = payload.get("effort")
    if isinstance(effort, str) and effort:
        return effort
    settings = (payload.get("collaboration_mode") or {}).get("settings") or {}
    fallback = settings.get("reasoning_effort") if isinstance(settings, dict) else None
    if isinstance(fallback, str) and fallback:
        return fallback
    return None


def tier_of(payload):
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get("service_tier"), str):
        return payload["service_tier"]
    settings = payload.get("thread_settings")
    if isinstance(settings, dict) and isinstance(settings.get("service_tier"), str):
        return settings["service_tier"]
    return None


def usage_numbers(payload):
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        return None
    def num(key):
        value = usage.get(key) or 0
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return value
    input_tokens = num("input_tokens")
    cached = num("cached_input_tokens")
    output = num("output_tokens")
    reasoning = num("reasoning_output_tokens")
    if None in (input_tokens, cached, output, reasoning):
        return None
    return input_tokens, cached, output, reasoning


def call_credits(fresh, cached, output, rate, multiplier):
    # Fresh and cached are mutually exclusive. cached_input_tokens already sits inside input_tokens.
    per_million = fresh * rate["input"] + cached * rate["cached_input"] + output * rate["output"]
    return per_million / 1_000_000 * multiplier


def speed_multiplier(model, tier, rates):
    """Included-allowance multiplier. Purchased-credit multipliers are a separate wallet."""
    label = tier or "standard"
    if label in STANDARD_TIERS:
        return 1.0, "standard", None
    table = rates["included_allowance_speed"]
    if label not in table:
        return None, label, f"unknown service_tier {label}"
    if label == "ultrafast" and model not in rates.get("ultrafast_models", []):
        return None, label, f"ultrafast is priced for {', '.join(rates.get('ultrafast_models') or [])} only, not {model}"
    return float(table[label]), label, None


def scan_file(path, account_id, rates):
    calls = []
    gauges = []
    model = None
    effort = None
    tier = None
    seen_meta = False
    pending = []
    pending_bytes = 0
    warnings = []

    def absorb(ev):
        nonlocal model, effort, tier
        kind = ev.get("type")
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        moment = parse_time(ev.get("timestamp"))
        if kind == "turn_context":
            if isinstance(payload.get("model"), str) and payload["model"]:
                model = payload["model"]
            effort = effort_of(payload)
            found = tier_of(payload)
            if found:
                tier = found
            return
        if kind == "event_msg" and payload.get("type") == "thread_settings_applied":
            found = tier_of(payload)
            if found:
                tier = found
            settings = payload.get("thread_settings") if isinstance(payload.get("thread_settings"), dict) else {}
            if isinstance(settings.get("model"), str) and settings["model"]:
                model = settings["model"]
            if isinstance(settings.get("reasoning_effort"), str) and settings["reasoning_effort"]:
                effort = settings["reasoning_effort"]
            return
        if kind == "token_usage_record":
            if moment is None:
                warnings.append("token_usage_record without a timestamp")
                return
            response_id = payload.get("response_id")
            if not isinstance(response_id, str) or not response_id:
                warnings.append("token_usage_record without a response_id")
                return
            numbers = usage_numbers(payload)
            if numbers is None:
                warnings.append(f"token_usage_record {response_id} has no usage object")
                return
            input_tokens, cached, output, reasoning = numbers
            fresh = max(0, input_tokens - cached)
            slug = model or "unknown"
            rate = rates["models"].get(slug)
            multiplier, speed, problem = speed_multiplier(slug, tier, rates)
            credits = None
            if rate is not None and multiplier is not None:
                credits = call_credits(fresh, cached, output, rate, multiplier)
            calls.append({
                "ts": moment,
                "response_id": response_id,
                "model": slug,
                "effort": effort or "not recorded",
                "speed": speed,
                "fresh": fresh,
                "cached": cached,
                "output": output,
                "reasoning": reasoning,
                "credits": credits,
                "long_context": input_tokens > rates["long_context_input_tokens"],
                "unpriced": credits is None,
                "problem": problem,
            })
            return
        if kind == "event_msg" and payload.get("type") == "token_count":
            if moment is None:
                return
            limits = payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else {}
            primary = limits.get("primary") if isinstance(limits.get("primary"), dict) else None
            if not primary or "used_percent" not in primary or "resets_at" not in primary:
                return
            try:
                percent = float(primary["used_percent"])
                resets_at = int(primary["resets_at"])
                window_minutes = int(primary.get("window_minutes") or 10080)
            except (TypeError, ValueError):
                return
            credits = limits.get("credits") if isinstance(limits.get("credits"), dict) else {}
            balance = credits.get("balance")
            gauges.append({
                "ts": moment,
                "used_percent": percent,
                "resets_at": resets_at,
                "window_minutes": window_minutes,
                "balance": balance if isinstance(balance, str) else None,
                "plan_type": limits.get("plan_type") if isinstance(limits.get("plan_type"), str) else None,
            })

    with open(path, "rb") as handle:
        for raw in handle:
            if not any(marker in raw for marker in MARKERS):
                continue
            try:
                ev = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(ev, dict):
                continue
            if not seen_meta:
                pending.append(ev)
                pending_bytes += len(raw)
                if ev.get("type") != "session_meta":
                    if pending_bytes > PENDING_META_BYTES:
                        return "unattributed", [], [], []
                    continue
                seen_meta = True
                creator = (ev.get("payload") or {}).get("creator_account_id") if isinstance(ev.get("payload"), dict) else None
                if not isinstance(creator, str) or not creator:
                    return "unattributed", [], [], []
                if creator != account_id:
                    return "other_account", [], [], []
                for queued in pending:
                    absorb(queued)
                pending = []
                continue
            absorb(ev)
    if not seen_meta:
        return "unattributed", [], [], []
    return "matched", calls, gauges, warnings


def cluster_gauges(gauges):
    ordered = sorted(gauges, key=lambda gauge: (gauge["resets_at"], gauge["ts"]))
    groups = []
    for gauge in ordered:
        if not groups or gauge["resets_at"] - groups[-1]["first"] > RESET_CLUSTER_SECONDS:
            groups.append({"first": gauge["resets_at"], "gauges": [gauge]})
        else:
            groups[-1]["gauges"].append(gauge)
    clusters = []
    for group in groups:
        counts = defaultdict(int)
        for gauge in group["gauges"]:
            counts[gauge["resets_at"]] += 1
        latest = max(group["gauges"], key=lambda gauge: gauge["ts"])
        anchor = max(counts, key=lambda resets_at: (counts[resets_at], resets_at == latest["resets_at"]))
        window_minutes = latest["window_minutes"]
        start = datetime.fromtimestamp(anchor - window_minutes * 60, timezone.utc)
        clusters.append({
            "anchor": anchor,
            "window_start": start,
            "window_minutes": window_minutes,
            "resets_at": datetime.fromtimestamp(anchor, timezone.utc),
            "gauges": sorted(group["gauges"], key=lambda gauge: gauge["ts"]),
            "plan_type": latest["plan_type"],
        })
    return clusters


def attribute(calls, clusters, since, until):
    rows = {}
    points_outside = 0.0
    points_unattributed = 0.0
    windows = []
    last_tick = None
    after_credits = 0.0
    after_calls = 0
    in_range_calls = []

    for call in calls:
        if since <= call["ts"] <= until:
            in_range_calls.append(call)
            key = (call["model"], call["effort"], call["speed"])
            row = rows.get(key)
            if row is None:
                row = {
                    "model": call["model"],
                    "effort": call["effort"],
                    "speed": call["speed"],
                    "calls": 0,
                    "fresh_input_tokens": 0,
                    "cached_input_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_output_tokens": 0,
                    "credits": 0.0,
                    "unpriced_calls": 0,
                    "quota_points": 0.0,
                    "long_context_calls": 0,
                }
                rows[key] = row
            row["calls"] += 1
            row["fresh_input_tokens"] += call["fresh"]
            row["cached_input_tokens"] += call["cached"]
            row["output_tokens"] += call["output"]
            row["reasoning_output_tokens"] += call["reasoning"]
            row["long_context_calls"] += 1 if call["long_context"] else 0
            if call["credits"] is None:
                row["unpriced_calls"] += 1
            else:
                row["credits"] += call["credits"]

    ordered = sorted(clusters, key=lambda cluster: cluster["anchor"])
    for index, cluster in enumerate(ordered):
        # A later window supersedes an older one that still overlaps it, which
        # happens when the weekly anchor moves at a plan change.
        superseded_at = ordered[index + 1]["window_start"] if index + 1 < len(ordered) else None
        effective_end = cluster["resets_at"]
        if superseded_at is not None and superseded_at < effective_end:
            effective_end = superseded_at
        if effective_end <= since or cluster["window_start"] > until:
            continue
        baseline = 0.0
        prev_ts = cluster["window_start"]
        gauges = [
            gauge for gauge in cluster["gauges"]
            if cluster["window_start"] <= gauge["ts"] <= until and gauge["ts"] < effective_end
        ]
        for gauge in gauges:
            if gauge["ts"] < since and gauge["used_percent"] > baseline:
                baseline = gauge["used_percent"]
                prev_ts = gauge["ts"]
        start_reading = baseline
        risen = 0.0
        for gauge in gauges:
            if gauge["ts"] < since:
                continue
            if gauge["used_percent"] > baseline:
                delta = gauge["used_percent"] - baseline
                risen += delta
                eligible = [call for call in calls if prev_ts < call["ts"] <= gauge["ts"]]
                priced = [call for call in eligible if call["credits"] is not None]
                weight = sum(call["credits"] for call in priced)
                if weight <= 0:
                    points_unattributed += delta
                else:
                    for call in priced:
                        share = delta * call["credits"] / weight
                        if since <= call["ts"] <= until:
                            key = (call["model"], call["effort"], call["speed"])
                            if key not in rows:
                                continue
                            rows[key]["quota_points"] += share
                        else:
                            points_outside += share
                baseline = gauge["used_percent"]
                prev_ts = gauge["ts"]
                last_tick = gauge["ts"] if last_tick is None else max(last_tick, gauge["ts"])
        windows.append({
            "window_start": format_time(cluster["window_start"]),
            "resets_at": format_time(cluster["resets_at"]),
            "window_minutes": cluster["window_minutes"],
            "plan_type": cluster["plan_type"],
            "gauge_at_range_start": start_reading,
            "gauge_high": baseline,
            "points_risen": risen,
        })

    tick_at = last_tick
    for call in in_range_calls:
        if tick_at is None or call["ts"] > tick_at:
            after_calls += 1
            if call["credits"] is not None:
                after_credits += call["credits"]

    rendered = []
    for row in rows.values():
        if row["unpriced_calls"] == row["calls"]:
            row["credits"] = None
        else:
            row["credits"] = round(row["credits"], 6)
        row["quota_points"] = round(row["quota_points"], 6)
        rendered.append(row)
    rendered.sort(key=lambda row: (
        -row["quota_points"],
        row["credits"] is None,
        -(row["credits"] or 0),
        -row["calls"],
        row["model"],
        row["effort"],
        row["speed"],
    ))
    points_in_table = round(sum(row["quota_points"] for row in rendered), 6)
    return rendered, windows, {
        "points_risen": round(sum(window["points_risen"] for window in windows), 6),
        "points_in_table": points_in_table,
        "points_outside_range": round(points_outside, 6),
        "points_unattributed": round(points_unattributed, 6),
        "credits_after_last_tick": round(after_credits, 6),
        "calls_after_last_tick": after_calls,
        "last_tick_at": format_time(tick_at) if tick_at else None,
        "windows": windows,
    }


def balance_number(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def purchased_summary(gauges, since, until):
    chosen = [gauge for gauge in gauges if since <= gauge["ts"] <= until and gauge["balance"] is not None]
    if not chosen:
        return {"balance_start": None, "balance_end": None, "drawn": False}
    chosen.sort(key=lambda gauge: gauge["ts"])
    start = chosen[0]["balance"]
    end = chosen[-1]["balance"]
    start_n = balance_number(start)
    end_n = balance_number(end)
    drawn = start_n is not None and end_n is not None and end_n < start_n
    return {"balance_start": start, "balance_end": end, "drawn": drawn}


def resolve_identity(auth_path, account, codex_home, home, stderr):
    if auth_path:
        try:
            identity = read_auth(auth_path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            stderr.write(f"could not read auth file: {exc}\n")
            return None
        if not account_matches(identity, account):
            stderr.write("auth file does not match --account\n")
            return None
        return identity
    matches = []
    for path in discover_auth_files(codex_home, home):
        try:
            identity = read_auth(path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if account_matches(identity, account):
            matches.append(identity)
    if not matches:
        if account:
            stderr.write("no auth file matched --account\n")
        else:
            stderr.write("no Codex auth.json found\n")
        return None
    return matches[0]


def build_report(session_dirs, identity, rates, since, until):
    # Unknown reset: look back far enough to cover the weekly window.
    not_before = (since if since is not None else datetime.now(timezone.utc) - RESET_LOOKBACK) - MTIME_SLACK
    files, duplicates = deduped_files(session_dirs, not_before)
    calls = []
    gauges = []
    warnings = []
    counts = {"matched": 0, "other_account": 0, "unattributed": 0, "duplicate": duplicates}
    seen_responses = set()
    duplicate_responses = 0
    for path in files:
        status, file_calls, file_gauges, file_warnings = scan_file(path, identity["id"], rates)
        counts[status] += 1
        warnings.extend(file_warnings)
        if status != "matched":
            continue
        for call in file_calls:
            if call["response_id"] in seen_responses:
                duplicate_responses += 1
                continue
            seen_responses.add(call["response_id"])
            calls.append(call)
        gauges.extend(file_gauges)
    counts["duplicate_responses"] = duplicate_responses
    calls.sort(key=lambda call: call["ts"])
    gauges.sort(key=lambda gauge: gauge["ts"])
    clusters = cluster_gauges(gauges)
    since_is_reset = since is None
    if since is None:
        if not clusters:
            return None, "no primary quota gauge found; pass --since to choose a start"
        latest = max(clusters, key=lambda cluster: cluster["anchor"])
        since = latest["window_start"]
    if until is None:
        until = datetime.now(timezone.utc)
    rows, _windows, quota = attribute(calls, clusters, since, until)
    in_range = [call for call in calls if since <= call["ts"] <= until]
    unpriced = sorted({call["model"] for call in in_range if call["model"] not in rates["models"]})
    speed_problems = sorted({call["problem"] for call in in_range if call["problem"]})
    report = {
        "account": {"id": identity["id"], "email": identity.get("email")},
        "range": {
            "since": format_time(since),
            "until": format_time(until),
            "since_is_latest_reset": since_is_reset,
        },
        "rows": rows,
        "quota": quota,
        "purchased_credits": purchased_summary(gauges, since, until),
        "files": counts,
        "unpriced_models": unpriced,
        "warnings": warnings + speed_problems,
    }
    return report, None


def main(argv=None, stdout=None, stderr=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="codex_usage.py", description=__doc__)
    parser.add_argument("--codex-home", type=Path, help="Codex home. Default: $CODEX_HOME or ~/.codex")
    parser.add_argument("--sessions", action="append", type=Path, default=[], help="Session directory. Repeatable. Skips discovery.")
    parser.add_argument("--auth", type=Path, help="auth.json for the account to report")
    parser.add_argument("--account", help="Email or account id. Default: the Codex home auth file")
    parser.add_argument("--since", help="Range start, ISO-8601. Default: start of the latest primary quota window")
    parser.add_argument("--until", help="Range end, ISO-8601, inclusive. Default: the present")
    args = parser.parse_args(argv)

    # Path.home() is the machine home. Touch it only when a path was left to discover.
    home = None

    def machine_home():
        nonlocal home
        if home is None:
            home = Path.home()
        return home

    if args.codex_home is not None:
        codex_home = args.codex_home
    elif os.environ.get("CODEX_HOME"):
        codex_home = Path(os.environ["CODEX_HOME"])
    elif args.sessions and args.auth is not None:
        codex_home = None
    else:
        codex_home = machine_home() / ".codex"
    if args.sessions:
        session_dirs = args.sessions
    else:
        session_dirs = discover_session_dirs(codex_home, machine_home())
    if args.auth is not None:
        identity = resolve_identity(args.auth, args.account, codex_home, None, stderr)
    else:
        identity = resolve_identity(None, args.account, codex_home, machine_home(), stderr)
    if identity is None:
        return 2
    since = parse_time(args.since) if args.since else None
    until = parse_time(args.until) if args.until else None
    if args.since and since is None:
        stderr.write("--since is not an ISO-8601 timestamp\n")
        return 1
    if args.until and until is None:
        stderr.write("--until is not an ISO-8601 timestamp\n")
        return 1
    try:
        rates = load_rates()
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        stderr.write(f"could not read rates.json: {exc}\n")
        return 1
    report, problem = build_report(session_dirs, identity, rates, since, until)
    if problem:
        stderr.write(problem + "\n")
        return 3
    json.dump(report, stdout, indent=2)
    stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
