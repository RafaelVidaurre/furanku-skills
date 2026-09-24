#!/usr/bin/env python3
"""Census local Codex, Claude Code, and Grok session metadata into a private JSONL file.

This discovers local files, not account/cloud history. It never calls Jev or scores work.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import stat

import linked_coverage
import retrospect


def session_key(path, provider):
    return (provider, linked_coverage.agent_session_id({"provider": provider, "path": str(path)}) or str(path))


def json_lines(path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def summarize(path, provider):
    models = set()
    users = 0
    assistants = 0
    error = None
    first_event_at = None
    last_event_at = None
    def note_time(value):
        nonlocal first_event_at, last_event_at
        if isinstance(value, str) and value:
            if first_event_at is None or value < first_event_at:
                first_event_at = value
            if last_event_at is None or value > last_event_at:
                last_event_at = value
    try:
        if provider == "codex":
            for item in json_lines(path):
                note_time(item.get("timestamp"))
                payload = item.get("payload") or {}
                if item.get("type") == "turn_context" and payload.get("model") and payload.get("effort"):
                    models.add((payload["model"], payload["effort"]))
                if item.get("type") == "response_item" and payload.get("type") == "message":
                    role = payload.get("role")
                    content = retrospect.text_content(payload.get("content"))
                    users += bool(content) if role == "user" else 0
                    assistants += bool(content) if role == "assistant" else 0
        elif provider == "claude":
            for item in json_lines(path):
                note_time(item.get("timestamp"))
                role = item.get("type")
                message = item.get("message") or {}
                content = retrospect.text_content(message.get("content"))
                users += bool(content) if role == "user" else 0
                assistants += bool(content) if role == "assistant" else 0
                model = message.get("model")
                effort = item.get("effort")
                if role == "assistant" and model and model != "<synthetic>" and effort:
                    models.add((model, effort))
        else:
            directory = path.parent
            summary = json.loads(path.read_text(encoding="utf-8"))
            note_time(summary.get("created_at"))
            note_time(summary.get("last_active_at"))
            model = summary.get("current_model_id")
            effort = summary.get("reasoning_effort")
            if model and effort:
                models.add((model, effort))
            for item in json_lines(directory / "chat_history.jsonl"):
                note_time(item.get("timestamp"))
                role = item.get("type")
                content = retrospect.text_content(item.get("content"))
                users += bool(content) if role == "user" else 0
                assistants += bool(content) if role == "assistant" else 0
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        error = type(exc).__name__
    return {"provider": provider, "path": str(path),
            "models": [{"model": model, "effort": effort} for model, effort in sorted(models)],
            "user_messages": users, "assistant_messages": assistants,
            "mixed": len(models) > 1, "error": error,
            "first_event_at": first_event_at, "last_event_at": last_event_at}


def inventory(home, extra_codex_homes=()):
    roots = [
        ("codex", home / ".codex/sessions", "*.jsonl"),
        ("codex", home / ".codex/archived_sessions", "*.jsonl"),
        ("claude", home / ".claude/projects", "*.jsonl"),
        ("grok", home / ".grok/sessions", "summary.json"),
    ]
    codex_homes = sorted((home / "Library/Application Support/orca/codex-accounts").glob("*/home"))
    codex_homes.extend(extra_codex_homes)
    for codex_home in codex_homes:
        roots.extend((
            ("codex", codex_home / "sessions", "*.jsonl"),
            ("codex", codex_home / "archived_sessions", "*.jsonl"),
        ))
    choices = {}
    for provider, root, pattern in roots:
        if root.is_dir():
            for path in sorted(root.rglob(pattern)):
                if path.is_file():
                    key = session_key(path, provider)
                    choices.setdefault(key, []).append((path.stat().st_size, provider, path))
    for options in choices.values():
        for _size, provider, path in sorted(options, reverse=True):
            row = summarize(path, provider)
            if not row["error"]:
                row["copies"] = [str(candidate) for _, _, candidate in options]
                yield row
                break
        else:
            row["copies"] = [str(candidate) for _, _, candidate in options]
            yield row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--codex-home", type=Path, action="append", default=[],
                        help="Additional Codex home, including Orca-managed homes outside macOS")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    private = retrospect.PRIVATE_ROOT
    if args.output.parent != private or args.output.is_symlink() or private.is_symlink():
        parser.error(f"Output must be a new regular file directly inside {private}")
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    private.chmod(0o700)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    counts = Counter()
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        for row in inventory(args.home.expanduser(), [path.expanduser() for path in args.codex_home]):
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            counts[row["provider"]] += 1
            counts["with_model"] += bool(row["models"])
            counts["with_exchange"] += row["user_messages"] > 0 and row["assistant_messages"] > 0
            counts["mixed"] += row["mixed"]
            counts["errors"] += bool(row["error"])
    if not stat.S_ISREG(args.output.stat().st_mode):
        raise RuntimeError("Inventory output is not a regular file")
    print(json.dumps({"output": str(args.output), "counts": counts}))


if __name__ == "__main__":
    main()
