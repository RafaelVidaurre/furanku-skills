#!/usr/bin/env python3
"""Chart output tokens per second by model and effort.

Reads local Codex, Claude, and Grok session logs and writes one HTML page.
The page owns the time step, the range inside the scan, and which models are
drawn. This file owns the clock:

- Codex: output tokens divided by the duration of Reasoning and AgentMessage
  items on that response. Tool items are outside the clock, and so is the wait
  before the first of those items.
- Claude: output tokens divided by the time from the preceding request record
  to the last streamed fragment. That includes time to first token. Tool time
  sits outside the request.
- Grok: a turn's output tokens divided by the sum of its model loops. A loop
  ends when a tool starts or the turn ends. One point is a turn. A turn that
  recorded two models is left out.

A span under 50 ms, over 30 minutes for a Codex or Claude response, or over
6 hours for a Grok turn, is left untimed. An omitted range is the trailing
7 days. Pass --sessions, --auth, --projects, and --grok-home to avoid discovery.

  python3 token_speed.py [--harness all|codex|claude|grok] [--since ISO]
      [--until ISO] [--output FILE] [--no-open]
"""

import argparse
import base64
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import page

TRAILING = timedelta(days=7)
MTIME_SLACK = timedelta(hours=1)
MIN_SECONDS = 0.05
RESPONSE_LIMIT = 30 * 60
TURN_LIMIT = 6 * 3600
PENDING_META_BYTES = 2_000_000
JOIN_SECONDS = 2
GENERATION_ITEMS = {"Reasoning", "AgentMessage"}
CLOCKS = {
    "codex": "Codex divides output tokens by the time spent in reasoning and message items. Tool execution, and the wait before the first of those items, sit outside the clock.",
    "claude": "Claude divides output tokens by the time from the request record to the last streamed fragment. That includes time to first token. Tool time sits outside the request.",
    "grok": "Grok divides one turn's output tokens by the sum of its model loops, and each loop ends when a tool starts or the turn ends. A turn that used more than one model is left out.",
}


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


def epoch_ms(moment):
    return int(moment.timestamp() * 1000)


def as_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(0, int(value))


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = p * (len(ordered) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return ordered[lo] * (1 - frac) + ordered[hi] * frac


def summary_rows(calls):
    groups = {}
    for call in calls:
        groups.setdefault((call["h"], call["m"], call["e"]), []).append(call)
    rows = []
    for (harness, model, effort), group in groups.items():
        output = sum(call["out"] for call in group)
        seconds = sum(call["sec"] for call in group)
        rates = [call["out"] / call["sec"] for call in group]
        rows.append({
            "harness": harness,
            "model": model,
            "effort": effort,
            "calls": len(group),
            "output_tokens": output,
            "seconds": round(seconds, 3),
            "pooled": round(output / seconds, 2) if seconds else None,
            "median": round(percentile(rates, 0.5), 2),
            "p90": round(percentile(rates, 0.9), 2),
        })
    rows.sort(key=lambda row: (-(row["pooled"] or 0), -row["calls"], row["model"], row["effort"]))
    return rows


def accept(seconds, limit):
    return MIN_SECONDS <= seconds <= limit


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


def deduped_files(roots, not_before):
    seen_inodes = set()
    seen_name_size = set()
    unique = []
    cutoff = None if not_before is None else not_before.timestamp()
    for root in roots:
        for path in iter_jsonl(root):
            try:
                stat = path.stat()
            except OSError:
                continue
            if cutoff is not None and stat.st_mtime < cutoff:
                continue
            inode = (stat.st_dev, stat.st_ino)
            name_size = (path.name, stat.st_size)
            if inode in seen_inodes or name_size in seen_name_size:
                continue
            seen_inodes.add(inode)
            seen_name_size.add(name_size)
            unique.append(path)
    return unique


def effort_of(payload):
    effort = payload.get("effort")
    if isinstance(effort, str) and effort:
        return effort
    settings = (payload.get("collaboration_mode") or {}).get("settings") or {}
    fallback = settings.get("reasoning_effort") if isinstance(settings, dict) else None
    if isinstance(fallback, str) and fallback:
        return fallback
    return None


def resolve_identity(auth_path, account, codex_home, home):
    if auth_path:
        identity = read_auth(auth_path)
        if not account_matches(identity, account):
            raise ValueError("auth file does not match --account")
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
        raise ValueError("no Codex auth.json matched")
    return matches[0]


def scan_codex_file(path, account_id, since, until):
    calls = []
    untimed = 0
    model = None
    effort = None
    active_ms = 0.0
    seen_meta = False
    pending = []
    pending_bytes = 0
    markers = (b"session_meta", b"turn_context", b"token_usage_record", b"item_completed", b"thread_settings_applied")

    def absorb(ev):
        nonlocal model, effort, active_ms, untimed
        kind = ev.get("type")
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        if kind == "turn_context":
            if isinstance(payload.get("model"), str) and payload["model"]:
                model = payload["model"]
            found = effort_of(payload)
            if found:
                effort = found
            return
        if kind == "event_msg" and payload.get("type") == "thread_settings_applied":
            settings = payload.get("thread_settings") if isinstance(payload.get("thread_settings"), dict) else {}
            if isinstance(settings.get("model"), str) and settings["model"]:
                model = settings["model"]
            if isinstance(settings.get("reasoning_effort"), str) and settings["reasoning_effort"]:
                effort = settings["reasoning_effort"]
            return
        if kind == "event_msg" and payload.get("type") == "item_completed":
            item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
            if item.get("type") not in GENERATION_ITEMS:
                return
            start = payload.get("started_at_ms")
            end = payload.get("completed_at_ms")
            if isinstance(start, bool) or isinstance(end, bool):
                return
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                return
            active_ms += max(0, end - start)
            return
        if kind != "token_usage_record":
            return
        moment = parse_time(ev.get("timestamp"))
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        output = as_int(usage.get("output_tokens"))
        seconds = active_ms / 1000
        response_id = payload.get("response_id")
        active_ms = 0
        if moment is None or output <= 0 or not isinstance(response_id, str) or not response_id:
            return
        if not (since <= moment <= until):
            return
        if not accept(seconds, RESPONSE_LIMIT):
            untimed += 1
            return
        calls.append({
            "h": "codex",
            "m": model or "unknown",
            "e": effort or "not recorded",
            "t": epoch_ms(moment),
            "out": output,
            "sec": seconds,
            "id": response_id,
        })

    with open(path, "rb") as handle:
        for raw in handle:
            if not any(marker in raw for marker in markers):
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
                        return "unattributed", [], 0
                    continue
                seen_meta = True
                creator = (ev.get("payload") or {}).get("creator_account_id") if isinstance(ev.get("payload"), dict) else None
                if not isinstance(creator, str) or not creator:
                    return "unattributed", [], 0
                if creator != account_id:
                    return "other", [], 0
                for queued in pending:
                    absorb(queued)
                pending = []
                continue
            absorb(ev)
    if not seen_meta:
        return "unattributed", [], 0
    return "matched", calls, untimed


def codex_calls(session_dirs, identity, since, until):
    calls = []
    untimed = 0
    seen = set()
    for path in deduped_files(session_dirs, since - MTIME_SLACK):
        _status, found, skipped = scan_codex_file(path, identity["id"], since, until)
        untimed += skipped
        for call in found:
            if call["id"] in seen:
                continue
            seen.add(call["id"])
            call.pop("id", None)
            calls.append(call)
    return calls, untimed


def scan_claude_file(path, since, until):
    calls = []
    untimed = 0
    groups = {}
    order = []
    last_mark = None
    with open(path, "rb") as handle:
        for raw in handle:
            if b"assistant" not in raw and b'"user"' not in raw:
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(record, dict):
                continue
            moment = parse_time(record.get("timestamp"))
            kind = record.get("type")
            if kind == "user" and moment is not None:
                last_mark = moment
                continue
            if kind != "assistant" or moment is None:
                continue
            message = record.get("message") if isinstance(record.get("message"), dict) else {}
            message_id = message.get("id")
            if not isinstance(message_id, str) or not message_id:
                continue
            usage = message.get("usage") if isinstance(message.get("usage"), dict) else {}
            group = groups.get(message_id)
            if group is None:
                group = {
                    "start": last_mark,
                    "end": moment,
                    "out": as_int(usage.get("output_tokens")),
                    "model": message.get("model") if isinstance(message.get("model"), str) else "unknown",
                    "effort": record.get("effort") or record.get("perTurnEffort") or "not recorded",
                }
                groups[message_id] = group
                order.append(message_id)
            else:
                if moment > group["end"]:
                    group["end"] = moment
                group["out"] = max(group["out"], as_int(usage.get("output_tokens")))
            last_mark = moment
    for message_id in order:
        group = groups[message_id]
        if group["out"] <= 0:
            continue
        end = group["end"]
        if not (since <= end <= until):
            continue
        if group["start"] is None:
            untimed += 1
            continue
        seconds = (end - group["start"]).total_seconds()
        if not accept(seconds, RESPONSE_LIMIT):
            untimed += 1
            continue
        model = group["model"]
        if model.endswith("[1m]"):
            model = model[:-4]
        calls.append({
            "h": "claude",
            "m": model,
            "e": group["effort"] if isinstance(group["effort"], str) and group["effort"] else "not recorded",
            "t": epoch_ms(end),
            "out": group["out"],
            "sec": seconds,
            "id": message_id,
        })
    return calls, untimed


def claude_calls(project_roots, since, until):
    calls = []
    untimed = 0
    seen = set()
    for path in deduped_files(project_roots, since - MTIME_SLACK):
        found, skipped = scan_claude_file(path, since, until)
        untimed += skipped
        for call in found:
            if call["id"] in seen:
                continue
            seen.add(call["id"])
            call.pop("id", None)
            calls.append(call)
    return calls, untimed


def grok_event_turns(path):
    turns = []
    current = None
    with open(path, "rb") as handle:
        for raw in handle:
            if not any(marker in raw for marker in (b"turn_started", b"turn_ended", b"loop_started", b"tool_started")):
                continue
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            kind = event.get("type")
            moment = parse_time(event.get("ts"))
            if kind == "turn_started":
                current = {"end": None, "open": None, "loops": []}
                turns.append(current)
                continue
            if current is None or moment is None:
                continue
            if kind == "loop_started":
                if current["open"] is not None:
                    current["loops"].append((current["open"], moment))
                current["open"] = moment
            elif kind == "tool_started":
                if current["open"] is not None:
                    current["loops"].append((current["open"], moment))
                    current["open"] = None
            elif kind == "turn_ended":
                if current["open"] is not None:
                    current["loops"].append((current["open"], moment))
                    current["open"] = None
                current["end"] = moment
                current = None
    return [turn for turn in turns if turn["end"] is not None]


def sole_model(turn):
    usage = turn.get("modelUsage")
    producing = []
    if isinstance(usage, dict) and usage:
        for slug, part in usage.items():
            if isinstance(part, dict) and as_int(part.get("outputTokens")):
                producing.append((slug, as_int(part.get("outputTokens"))))
    elif as_int(turn.get("outputTokens")):
        slug = turn.get("primaryModelId") if isinstance(turn.get("primaryModelId"), str) else "not recorded"
        producing.append((slug or "not recorded", as_int(turn.get("outputTokens"))))
    if len(producing) == 1:
        return producing[0]
    if len(producing) > 1:
        return "mixed"
    return None


def pair_grok(event_turns, usage_turns):
    used = set()
    pairs = []
    for usage in usage_turns:
        end = parse_time(usage.get("endedAt"))
        if end is None:
            continue
        best = None
        for index, event in enumerate(event_turns):
            if index in used:
                continue
            delta = abs((event["end"] - end).total_seconds())
            if best is None or delta < best[0]:
                best = (delta, index)
        if best and best[0] <= JOIN_SECONDS:
            used.add(best[1])
            pairs.append((event_turns[best[1]], usage, end))
    return pairs


def session_effort(usage_path):
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
            if isinstance(summary.get("created_at"), str):
                created = summary["created_at"]
    return effort, created


def grok_calls(grok_home, since, until):
    sessions = Path(grok_home) / "sessions"
    files = []
    seen_inodes = set()
    cutoff = (since - MTIME_SLACK).timestamp()
    if sessions.is_dir():
        for dirpath, _dirs, names in os.walk(sessions):
            if "usage.json" not in names:
                continue
            path = Path(dirpath) / "usage.json"
            try:
                stat = path.stat()
            except OSError:
                continue
            if stat.st_mtime < cutoff:
                continue
            inode = (stat.st_dev, stat.st_ino)
            if inode in seen_inodes:
                continue
            seen_inodes.add(inode)
            files.append(path)
    ordered = []
    for path in files:
        effort, created = session_effort(path)
        ordered.append((created, str(path), path, effort))
    ordered.sort()
    seen_turns = set()
    calls = []
    untimed = 0
    mixed = 0
    for _created, _label, path, effort in ordered:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        usage_turns = payload.get("turns") if isinstance(payload, dict) else None
        if not isinstance(usage_turns, list):
            continue
        fresh = []
        for turn in usage_turns:
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
                continue
            seen_turns.add(signature)
            fresh.append(turn)
        events_path = path.with_name("events.jsonl")
        event_turns = grok_event_turns(events_path) if events_path.is_file() else []
        paired = set()
        for event, turn, end in pair_grok(event_turns, fresh):
            paired.add(id(turn))
            if not (since <= end <= until):
                continue
            chosen = sole_model(turn)
            if chosen is None:
                continue
            if chosen == "mixed":
                mixed += 1
                continue
            model, output = chosen
            seconds = 0.0
            for start, stop in event["loops"]:
                seconds += max(0, (stop - start).total_seconds())
            if not accept(seconds, TURN_LIMIT):
                untimed += 1
                continue
            calls.append({
                "h": "grok",
                "m": model,
                "e": effort,
                "t": epoch_ms(end),
                "out": output,
                "sec": seconds,
            })
        for turn in fresh:
            if id(turn) in paired:
                continue
            end = parse_time(turn.get("endedAt"))
            if end is not None and since <= end <= until and as_int(turn.get("outputTokens")):
                untimed += 1
    return calls, untimed, mixed


def default_output():
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Caches" / "token-speed" / "index.html"
    return home / ".cache" / "token-speed" / "index.html"


def launch(path):
    if sys.platform == "darwin":
        command = ["open", str(path)]
    elif sys.platform == "win32":
        os.startfile(str(path))  # noqa: on Windows this opens the file with its handler
        return True
    else:
        command = ["xdg-open", str(path)]
    try:
        subprocess.run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    return True


def main(argv=None, stdout=None, stderr=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="token_speed.py", description=__doc__)
    parser.add_argument("--harness", choices=("all", "codex", "claude", "grok"), default="all")
    parser.add_argument("--since", help="Range start, ISO-8601. Default: trailing 7 days")
    parser.add_argument("--until", help="Range end, ISO-8601, inclusive. Default: the present")
    parser.add_argument("--output", type=Path, help="HTML path. Default: a cache file under the home directory")
    parser.add_argument("--no-open", action="store_true", help="Write the page without opening it")
    parser.add_argument("--codex-home", type=Path)
    parser.add_argument("--sessions", action="append", type=Path, default=[])
    parser.add_argument("--auth", type=Path)
    parser.add_argument("--account")
    parser.add_argument("--projects", action="append", type=Path, default=[])
    parser.add_argument("--grok-home", type=Path)
    args = parser.parse_args(argv)

    since = parse_time(args.since) if args.since else None
    until = parse_time(args.until) if args.until else None
    if args.since and since is None:
        stderr.write("--since is not an ISO-8601 timestamp\n")
        return 1
    if args.until and until is None:
        stderr.write("--until is not an ISO-8601 timestamp\n")
        return 1
    now = datetime.now(timezone.utc)
    if until is None:
        until = now
    if since is None:
        since = until - TRAILING
    wanted = ["codex", "claude", "grok"] if args.harness == "all" else [args.harness]

    home = None

    def machine_home():
        nonlocal home
        if home is None:
            home = Path.home()
        return home

    calls = []
    untimed = {"codex": 0, "claude": 0, "grok": 0}
    mixed = 0
    warnings = []
    email = None

    if "codex" in wanted:
        try:
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
                identity = resolve_identity(args.auth, args.account, codex_home, None)
            else:
                identity = resolve_identity(None, args.account, codex_home, machine_home())
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            if args.harness == "codex":
                stderr.write(f"{exc}\n")
                return 2
            warnings.append(f"codex: {exc}")
            identity = None
        if identity is not None:
            email = identity.get("email")
            found, skipped = codex_calls(session_dirs, identity, since, until)
            calls.extend(found)
            untimed["codex"] = skipped

    if "claude" in wanted:
        if args.projects:
            roots = args.projects
        else:
            config = os.environ.get("CLAUDE_CONFIG_DIR")
            base = Path(config) if config else machine_home() / ".claude"
            roots = [base / "projects"]
        found, skipped = claude_calls(roots, since, until)
        calls.extend(found)
        untimed["claude"] = skipped

    if "grok" in wanted:
        if args.grok_home is not None:
            grok_home = args.grok_home
        elif os.environ.get("GROK_HOME"):
            grok_home = Path(os.environ["GROK_HOME"])
        else:
            grok_home = machine_home() / ".grok"
        found, skipped, mixed = grok_calls(grok_home, since, until)
        calls.extend(found)
        untimed["grok"] = skipped

    output = args.output if args.output is not None else default_output()
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "since": epoch_ms(since),
        "until": epoch_ms(until),
        "clocks": {name: CLOCKS[name] for name in wanted},
        "calls": [{key: call[key] for key in ("h", "m", "e", "t", "out", "sec")} for call in calls],
        "untimed": untimed,
        "mixed_turns": mixed,
    }
    output.write_text(page.render(payload), encoding="utf-8")
    opened = False if args.no_open else launch(output)
    summary = {
        "output": str(output),
        "opened": opened,
        "range": {"since": format_time(since), "until": format_time(until)},
        "account_email": email,
        "clocks": payload["clocks"],
        "rows": summary_rows(calls),
        "untimed": untimed,
        "mixed_turns": mixed,
        "warnings": warnings,
    }
    json.dump(summary, stdout, indent=2)
    stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
