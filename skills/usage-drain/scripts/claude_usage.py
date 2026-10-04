#!/usr/bin/env python3
"""Report which Claude model and effort levels drained usage.

Reads Claude Code session JSONL, including subagent files. Prints one JSON
report. One API response is one call: fragments that share a message id carry
the same usage, and only the first counts.

input_tokens, cache_creation_input_tokens, and cache_read_input_tokens are
separate billed buckets. A cache write with no 5-minute / 1-hour split uses
the 5-minute rate. Dollars are the published API card in claude_rates.json.
Local logs do not store the allowance reset, so an omitted --since is the
trailing 7 days.

  python3 claude_usage.py [--projects DIR ...] [--since ISO] [--until ISO]
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import codex_usage

TRAILING_WINDOW = timedelta(days=7)
MTIME_SLACK = timedelta(hours=1)
NO_RESET = "no local allowance reset; window is the trailing 7 days"
STANDARD_SPEEDS = ("", "standard")
PLAIN_GEOS = ("", "not_available", "global", "standard")


def rates_path():
    return Path(__file__).with_name("claude_rates.json")


def load_rates(path=None):
    path = Path(path) if path else rates_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    models = dict(data["usd_per_million_tokens"])
    for slug, alias in (data.get("aliases") or {}).items():
        target = alias["priced_as"]
        if target not in models:
            raise SystemExit(f"rates alias {slug} points at unknown model {target}")
        models[slug] = models[target]
    data["models"] = models
    return data


def model_slug(model):
    if not isinstance(model, str) or not model.strip():
        return "not recorded"
    text = model.strip()
    if text.endswith("]") and "[" in text:
        text = text[: text.rfind("[")]
    return text


def as_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(0, int(value))


def cache_writes(usage):
    creation = usage.get("cache_creation") if isinstance(usage.get("cache_creation"), dict) else {}
    five = as_int(creation.get("ephemeral_5m_input_tokens"))
    hour = as_int(creation.get("ephemeral_1h_input_tokens"))
    total = as_int(usage.get("cache_creation_input_tokens"))
    if five + hour == total:
        return five, hour, None
    if five + hour == 0:
        return total, 0, None
    return five, hour, "cache write split does not match cache_creation_input_tokens"


def call_usd(rate, speed, geo, input_tokens, write_5m, write_1h, cache_read, output):
    if rate is None:
        return None, None
    card = rate
    if speed == "fast":
        fast = rate.get("fast")
        if not isinstance(fast, dict):
            return None, "fast speed has no published rate"
        if write_5m + write_1h + cache_read and not all(
            key in fast for key in ("cache_write_5m", "cache_write_1h", "cache_read")
        ):
            return None, "fast speed has no published cache rate"
        card = {**rate, **fast}
    elif speed not in STANDARD_SPEEDS:
        return None, f"speed {speed} has no published rate"
    multiplier = 1.0
    if geo == "us":
        if "us_inference" not in rate:
            return None, "US inference has no published multiplier for this model"
        multiplier = rate["us_inference"]
    elif geo not in PLAIN_GEOS:
        return None, f"inference geo {geo} has no published multiplier"
    per_million = (
        input_tokens * card["input"]
        + write_5m * card["cache_write_5m"]
        + write_1h * card["cache_write_1h"]
        + cache_read * card["cache_read"]
        + output * card["output"]
    )
    return per_million / 1_000_000 * multiplier, None


def deduped_files(roots, not_before):
    seen_inodes = set()
    seen_name_size = set()
    unique = []
    duplicates = 0
    cutoff = None if not_before is None else not_before.timestamp()
    for root in roots:
        if not root.is_dir():
            continue
        for dirpath, _dirs, names in os.walk(root):
            for name in names:
                if not name.endswith(".jsonl"):
                    continue
                path = Path(dirpath) / name
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if cutoff is not None and stat.st_mtime < cutoff:
                    continue
                inode = (stat.st_dev, stat.st_ino)
                name_size = (name, stat.st_size)
                if inode in seen_inodes or name_size in seen_name_size:
                    duplicates += 1
                    continue
                seen_inodes.add(inode)
                seen_name_size.add(name_size)
                unique.append(path)
    return unique, duplicates


def scan_file(path, seen_ids):
    calls = []
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if '"usage"' not in line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(record, dict) or record.get("type") != "assistant":
                continue
            message = record.get("message") if isinstance(record.get("message"), dict) else {}
            usage = message.get("usage") if isinstance(message.get("usage"), dict) else None
            if usage is None:
                continue
            call_id = message.get("id") or record.get("requestId") or record.get("uuid")
            if not call_id or call_id in seen_ids:
                continue
            seen_ids.add(call_id)
            moment = codex_usage.parse_time(record.get("timestamp"))
            if moment is None:
                continue
            write_5m, write_1h, split_problem = cache_writes(usage)
            details = usage.get("output_tokens_details") if isinstance(usage.get("output_tokens_details"), dict) else {}
            effort = record.get("effort") or record.get("perTurnEffort") or "not recorded"
            speed = usage.get("speed") or "standard"
            billed = (
                as_int(usage.get("input_tokens"))
                + as_int(usage.get("cache_creation_input_tokens"))
                + write_5m + write_1h
                + as_int(usage.get("cache_read_input_tokens"))
                + as_int(usage.get("output_tokens"))
            )
            if billed == 0:
                continue
            calls.append({
                "ts": moment,
                "model": model_slug(message.get("model")),
                "effort": effort if isinstance(effort, str) and effort else "not recorded",
                "speed": speed if isinstance(speed, str) and speed else "standard",
                "geo": usage.get("inference_geo") if isinstance(usage.get("inference_geo"), str) else "",
                "input_tokens": as_int(usage.get("input_tokens")),
                "cache_write_5m": write_5m,
                "cache_write_1h": write_1h,
                "cache_write_input_tokens": as_int(usage.get("cache_creation_input_tokens")) or write_5m + write_1h,
                "cache_read_input_tokens": as_int(usage.get("cache_read_input_tokens")),
                "output_tokens": as_int(usage.get("output_tokens")),
                "reasoning_output_tokens": as_int(details.get("thinking_tokens")),
                "problem": split_problem,
            })
    return calls


def build_report(projects, rates, since=None, until=None, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    warnings = []
    since_is_reset = False
    if until is None:
        until = now
    if since is None:
        since = until - TRAILING_WINDOW
        warnings.append(NO_RESET)
    not_before = since - MTIME_SLACK
    files, duplicates = deduped_files(projects, not_before)
    seen_ids = set()
    calls = []
    for path in files:
        calls.extend(scan_file(path, seen_ids))
    in_range = [call for call in calls if since <= call["ts"] <= until]
    grouped = {}
    problems = set()
    for call in in_range:
        key = (call["model"], call["effort"], call["speed"])
        row = grouped.get(key)
        if row is None:
            row = {
                "model": call["model"],
                "effort": call["effort"],
                "speed": call["speed"],
                "calls": 0,
                "input_tokens": 0,
                "cache_write_input_tokens": 0,
                "cache_read_input_tokens": 0,
                "output_tokens": 0,
                "reasoning_output_tokens": 0,
                "usd": 0.0,
                "unpriced_calls": 0,
            }
            grouped[key] = row
        row["calls"] += 1
        row["input_tokens"] += call["input_tokens"]
        row["cache_write_input_tokens"] += call["cache_write_input_tokens"]
        row["cache_read_input_tokens"] += call["cache_read_input_tokens"]
        row["output_tokens"] += call["output_tokens"]
        row["reasoning_output_tokens"] += call["reasoning_output_tokens"]
        problem = call["problem"]
        usd = None
        if problem is None:
            usd, problem = call_usd(
                rates["models"].get(call["model"]),
                call["speed"],
                call["geo"],
                call["input_tokens"],
                call["cache_write_5m"],
                call["cache_write_1h"],
                call["cache_read_input_tokens"],
                call["output_tokens"],
            )
        if problem:
            problems.add(problem)
        if usd is None:
            row["unpriced_calls"] += 1
        else:
            row["usd"] += usd
    rows = []
    for row in grouped.values():
        if row["unpriced_calls"] == row["calls"]:
            row["usd"] = None
        else:
            row["usd"] = round(row["usd"], 6)
        rows.append(row)
    rows.sort(key=lambda row: (row["usd"] is None, -(row["usd"] or 0), -row["calls"], row["model"]))
    unpriced = sorted({call["model"] for call in in_range if call["model"] not in rates["models"]})
    return {
        "range": {
            "since": codex_usage.format_time(since),
            "until": codex_usage.format_time(until),
            "since_is_latest_reset": since_is_reset,
        },
        "rows": rows,
        "quota": {"available": False, "reason": "local session logs do not record a running allowance gauge"},
        "files": {"matched": len(files), "duplicate": duplicates},
        "unpriced_models": unpriced,
        "warnings": warnings + sorted(problems),
    }


def main(argv=None, stdout=None, stderr=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="claude_usage.py", description=__doc__)
    parser.add_argument("--projects", action="append", type=Path, default=[], help="Claude projects directory. Repeatable.")
    parser.add_argument("--since", help="Range start, ISO-8601. Default: trailing 7 days")
    parser.add_argument("--until", help="Range end, ISO-8601, inclusive. Default: the present")
    args = parser.parse_args(argv)
    since = codex_usage.parse_time(args.since) if args.since else None
    until = codex_usage.parse_time(args.until) if args.until else None
    if args.since and since is None:
        stderr.write("--since is not an ISO-8601 timestamp\n")
        return 1
    if args.until and until is None:
        stderr.write("--until is not an ISO-8601 timestamp\n")
        return 1
    if args.projects:
        projects = args.projects
    else:
        base = Path(os.environ["CLAUDE_CONFIG_DIR"]) if os.environ.get("CLAUDE_CONFIG_DIR") else Path.home() / ".claude"
        projects = [base / "projects"]
    try:
        rates = load_rates()
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        stderr.write(f"could not read claude_rates.json: {exc}\n")
        return 1
    json.dump(build_report(projects, rates, since, until), stdout, indent=2)
    stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
