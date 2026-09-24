#!/usr/bin/env python3
"""Private machine-wide routing decision journal and bounded reader."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import uuid


BASE = Path.home() / ".furanku-skills" / "model-routing"
SETTINGS = BASE / "logging.json"
LOGS = BASE / "logs"
RETENTION_DAYS = 180
MAX_TAIL = 200
SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$")


class Error(Exception):
    pass


def _safe_directory(path):
    if path.is_symlink():
        raise Error(f"Routing log directory is a symlink: {path}")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not stat.S_ISDIR(path.stat().st_mode):
        raise Error(f"Routing log destination is not a directory: {path}")
    path.chmod(0o700)


def enabled():
    if SETTINGS.is_symlink():
        raise Error("Routing logging settings must be a regular file.")
    if not SETTINGS.exists():
        return True
    try:
        data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise Error("Cannot read routing logging settings; repair logging.json.") from None
    if not isinstance(data, dict) or set(data) != {"enabled"} or type(data["enabled"]) is not bool:
        raise Error("Invalid routing logging settings; expected {\"enabled\": true|false}.")
    return data["enabled"]


def set_enabled(value):
    _safe_directory(BASE)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=BASE, encoding="utf-8", delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            json.dump({"enabled": value}, stream)
            stream.write("\n")
        os.replace(temporary, SETTINGS)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _now():
    return datetime.now(timezone.utc)


def _session(value=None):
    value = value or next((os.environ.get(key) for key in (
        "CODEX_SESSION_ID", "CODEX_THREAD_ID", "CLAUDE_SESSION_ID") if os.environ.get(key)), None)
    if value is None:
        return None
    if not SESSION_RE.fullmatch(value):
        raise Error("Session reference must be a short opaque ID (letters, numbers, . _ : -).")
    return value


def _digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def _refusal_categories(reasons):
    categories = set()
    for reason in reasons or []:
        value = reason.lower()
        if "disabled by configuration" in value:
            categories.add("disabled")
        elif "explicit" in value:
            categories.add("explicit")
        elif "launchable" in value:
            categories.add("launcher")
        elif "feature" in value:
            categories.add("feature")
        elif "context" in value:
            categories.add("context")
        elif "quota" in value or "account" in value:
            categories.add("quota")
        elif "max" in value or "effort" in value:
            categories.add("effort")
        else:
            categories.add("other")
    return ",".join(sorted(categories))


def _record(fields):
    if not enabled():
        return False
    _safe_directory(BASE)
    _safe_directory(LOGS)
    now = _now()
    event = {"ts": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
             "level": "INFO", "logger": "model-routing", **fields}
    path = LOGS / f"{now:%Y-%m-%d}.jsonl"
    if path.is_symlink():
        raise Error("Routing log file must not be a symlink.")
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Error("Routing log destination must be a regular file.")
        os.fchmod(fd, 0o600)
        line = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if os.write(fd, line) != len(line):
            raise Error("Incomplete routing log write; inspect the journal before retrying.")
    finally:
        os.close(fd)
    _prune(now)
    return True


def _prune(now):
    cutoff = (now - timedelta(days=RETENTION_DAYS)).date().isoformat()
    for path in LOGS.glob("????-??-??.jsonl"):
        if path.name[:10] < cutoff and path.is_file() and not path.is_symlink():
            path.unlink()


def decision(decision, *, command, repo, elapsed_ms, session_ref=None,
             config_hash=None, allow_abstain=False, constraints=None):
    decision_id = uuid.uuid4().hex
    selection = decision.get("selected") or {}
    selector = decision.get("selector")
    selector = selector if isinstance(selector, dict) else {}
    probabilities = selector.get("probabilities") or {}
    eligible_count = (1 if selector.get("name") == "single-eligible" else
                      len(probabilities) - int("abstain" in probabilities) if probabilities else None)
    quota = decision.get("quota") or {}
    fields = {"msg": "routing decision", "request_id": decision_id,
              "routing.command": command, "routing.status": decision.get("status", "unknown"),
              "routing.repo_hash": _digest(str(Path(repo).resolve())),
              "routing.configuration_hash": config_hash,
              "routing.candidate": selection.get("id") or decision.get("candidate"),
              "routing.agent": selection.get("agent"), "routing.model": selection.get("model"),
              "routing.effort": selection.get("effort"),
              "routing.selector": selector.get("name", "gate-check" if command == "check" else "agent"),
              "routing.exact_route": decision.get("exact_route"),
              "routing.quota_status": quota.get("status"),
              "routing.warning_count": len(decision.get("warnings") or []),
              "routing.refusal_count": len(decision.get("reasons") or []),
              "routing.refusal_categories": _refusal_categories(decision.get("reasons")),
              "routing.choice_probability": selector.get("choice_probability"),
              "routing.choice_confidence": selector.get("confidence"),
              "routing.gateway_attempts": selector.get("gateway_attempts"),
              "routing.eligible_count": eligible_count,
              "routing.abstain_allowed": allow_abstain,
              "routing.elapsed_ms": elapsed_ms,
              "session.parent": _session(session_ref)}
    fields.update(constraints or {})
    _record(fields)
    return decision_id


def failure(*, command, repo, error, elapsed_ms, session_ref=None):
    fields = {"msg": "routing command failed", "level": "ERROR",
              "request_id": uuid.uuid4().hex, "routing.command": command,
              "routing.repo_hash": _digest(str(Path(repo).resolve())),
              "routing.elapsed_ms": elapsed_ms,
              "session.parent": _session(session_ref),
              "exception.type": type(error).__name__}
    _record(fields)


def link(decision_id, session_ref):
    if not re.fullmatch(r"[0-9a-f]{32}", decision_id):
        raise Error("Decision ID must be the 32-character ID returned by router.py.")
    session_ref = _session(session_ref)
    return _record({"msg": "routing worker linked", "request_id": decision_id,
                    "session.worker": session_ref})


def _reverse_lines(path):
    with path.open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        remaining = stream.tell()
        carry = b""
        while remaining:
            size = min(8192, remaining)
            remaining -= size
            stream.seek(remaining)
            pieces = (stream.read(size) + carry).split(b"\n")
            carry = pieces[0]
            for piece in reversed(pieces[1:]):
                if piece:
                    yield piece
        if carry:
            yield carry


def tail(limit=50, decision_id=None, session_ref=None):
    if not 1 <= limit <= MAX_TAIL:
        raise Error(f"Tail limit must be between 1 and {MAX_TAIL}.")
    if not LOGS.exists():
        return []
    rows = []
    scanned = 0
    for path in sorted(LOGS.glob("????-??-??.jsonl"), reverse=True):
        if path.is_symlink():
            raise Error("Routing log file must not be a symlink.")
        for line in _reverse_lines(path):
            scanned += 1
            if scanned > 10000:
                return list(reversed(rows))
            row = json.loads(line)
            if decision_id and row.get("request_id") != decision_id:
                continue
            if session_ref and session_ref not in (row.get("session.parent"), row.get("session.worker")):
                continue
            rows.append(row)
            if len(rows) >= limit:
                return list(reversed(rows))
    return list(reversed(rows))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "on", "off", "tail", "link"))
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--decision-id")
    parser.add_argument("--session-ref")
    args = parser.parse_args(argv)
    try:
        if args.command == "status":
            result = {"enabled": enabled(), "path": str(LOGS), "retention_days": RETENTION_DAYS}
        elif args.command in ("on", "off"):
            set_enabled(args.command == "on")
            result = {"enabled": enabled(), "path": str(LOGS)}
        elif args.command == "link":
            if not args.decision_id or not args.session_ref:
                parser.error("link requires --decision-id and --session-ref")
            result = {"linked": link(args.decision_id, args.session_ref)}
        else:
            result = tail(args.limit, args.decision_id, args.session_ref)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (Error, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"model-routing log: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
