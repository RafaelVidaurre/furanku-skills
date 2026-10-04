#!/usr/bin/env python3
"""Report which Grok model and effort levels drained usage.

Reads usage.json under a Grok home's sessions directory. A turn is the unit.
Session totals also include history inherited by resume or fork, so they are
not added. A turn copied into a later session counts once. Dollars are
costUsdTicks divided by 1e10, the unit the Grok session usage command documents.
Effort is the session's recorded reasoning_effort. Local logs do not store the
allowance reset, so an omitted --since is the trailing 7 days.

  python3 grok_usage.py [--grok-home DIR] [--since ISO] [--until ISO]
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import codex_usage
from claude_usage import TRAILING_WINDOW, NO_RESET

MTIME_SLACK = codex_usage.MTIME_SLACK
TICKS_PER_USD = 10_000_000_000
TOKEN_FIELDS = (
    "inputTokens",
    "cachedReadTokens",
    "cacheCreationTokens",
    "outputTokens",
    "reasoningTokens",
)


def as_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(0, int(value))


def deduped_usage_files(sessions_root, not_before):
    seen_inodes = set()
    unique = []
    duplicates = 0
    cutoff = None if not_before is None else not_before.timestamp()
    if not sessions_root.is_dir():
        return unique, duplicates
    for dirpath, _dirs, names in os.walk(sessions_root):
        if "usage.json" not in names:
            continue
        path = Path(dirpath) / "usage.json"
        try:
            stat = path.stat()
        except OSError:
            continue
        if cutoff is not None and stat.st_mtime < cutoff:
            continue
        inode = (stat.st_dev, stat.st_ino)
        if inode in seen_inodes:
            duplicates += 1
            continue
        seen_inodes.add(inode)
        unique.append(path)
    return unique, duplicates


def session_meta(usage_path):
    summary_path = usage_path.with_name("summary.json")
    effort = "not recorded"
    created = ""
    if summary_path.is_file():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            summary = {}
        if isinstance(summary, dict):
            recorded = summary.get("reasoning_effort")
            if isinstance(recorded, str) and recorded:
                effort = recorded
            created_at = summary.get("created_at")
            if isinstance(created_at, str):
                created = created_at
    return effort, created


def model_parts(turn):
    usage = turn.get("modelUsage")
    if isinstance(usage, dict) and usage:
        return usage
    model = turn.get("primaryModelId") if isinstance(turn.get("primaryModelId"), str) else ""
    blob = {field: turn.get(field) for field in TOKEN_FIELDS}
    blob["modelCalls"] = turn.get("modelCalls")
    blob["costUsdTicks"] = turn.get("costUsdTicks")
    return {model or "not recorded": blob}


def build_report(grok_home, since=None, until=None, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    warnings = []
    if until is None:
        until = now
    if since is None:
        since = until - TRAILING_WINDOW
        warnings.append(NO_RESET)
    files, duplicate_files = deduped_usage_files(Path(grok_home) / "sessions", since - MTIME_SLACK)
    ordered = []
    for path in files:
        effort, created = session_meta(path)
        ordered.append((created, str(path), path, effort))
    ordered.sort()
    seen_turns = set()
    duplicate_turns = 0
    missing_end = False
    grouped = {}
    unpriced = set()
    for _created, _label, path, effort in ordered:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            warnings.append(f"could not read {path.name}")
            continue
        turns = payload.get("turns") if isinstance(payload, dict) else None
        if not isinstance(turns, list):
            continue
        for turn in turns:
            if not isinstance(turn, dict):
                continue
            signature = (
                turn.get("endedAt"),
                turn.get("turnNumber"),
                turn.get("inputTokens"),
                turn.get("outputTokens"),
                turn.get("modelCalls"),
            )
            if signature in seen_turns:
                duplicate_turns += 1
                continue
            seen_turns.add(signature)
            moment = codex_usage.parse_time(turn.get("endedAt"))
            if moment is None:
                missing_end = True
                continue
            if not (since <= moment <= until):
                continue
            for model, part in model_parts(turn).items():
                if not isinstance(part, dict):
                    continue
                key = (model, effort)
                row = grouped.get(key)
                if row is None:
                    row = {
                        "model": model,
                        "effort": effort,
                        "calls": 0,
                        "input_tokens": 0,
                        "cached_read_tokens": 0,
                        "cache_write_tokens": 0,
                        "output_tokens": 0,
                        "reasoning_tokens": 0,
                        "usd": 0.0,
                        "unpriced_calls": 0,
                    }
                    grouped[key] = row
                calls = as_int(part.get("modelCalls"))
                row["calls"] += calls
                row["input_tokens"] += as_int(part.get("inputTokens"))
                row["cached_read_tokens"] += as_int(part.get("cachedReadTokens"))
                row["cache_write_tokens"] += as_int(part.get("cacheCreationTokens"))
                row["output_tokens"] += as_int(part.get("outputTokens"))
                row["reasoning_tokens"] += as_int(part.get("reasoningTokens"))
                ticks = part.get("costUsdTicks")
                if isinstance(ticks, bool) or not isinstance(ticks, (int, float)):
                    row["unpriced_calls"] += calls or 1
                    unpriced.add(model)
                else:
                    row["usd"] += ticks / TICKS_PER_USD
    if missing_end:
        warnings.append("a turn had no endedAt")
    rows = []
    for row in grouped.values():
        if row["unpriced_calls"] and row["usd"] == 0:
            row["usd"] = None
        else:
            row["usd"] = round(row["usd"], 6)
        rows.append(row)
    rows.sort(key=lambda row: (row["usd"] is None, -(row["usd"] or 0), -row["calls"], row["model"]))
    return {
        "range": {
            "since": codex_usage.format_time(since),
            "until": codex_usage.format_time(until),
            "since_is_latest_reset": False,
        },
        "rows": rows,
        "quota": {"available": False, "reason": "local session logs do not record a running allowance gauge"},
        "files": {"matched": len(files), "duplicate": duplicate_files, "duplicate_turns": duplicate_turns},
        "unpriced_models": sorted(unpriced),
        "warnings": warnings,
    }


def main(argv=None, stdout=None, stderr=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="grok_usage.py", description=__doc__)
    parser.add_argument("--grok-home", type=Path, help="Grok home. Default: $GROK_HOME or ~/.grok")
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
    if args.grok_home is not None:
        grok_home = args.grok_home
    elif os.environ.get("GROK_HOME"):
        grok_home = Path(os.environ["GROK_HOME"])
    else:
        grok_home = Path.home() / ".grok"
    json.dump(build_report(grok_home, since, until), stdout, indent=2)
    stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
