#!/usr/bin/env python3
"""Optional Beads enrichment for model-routing retrospectives (experimental).

Reads finalized Beads issues only through documented read-only `bd` commands,
links exact issue IDs to local agent transcripts, and labels disposition,
evidence, and work domains with Jev. Tracker text is a claim; only transcript
tool results count as observed checks. Issue owner, assignee, and comment
author are never model identity; a linked session is an operator association,
not proof of authorship. Outputs contain private task text.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

import jev
import retrospect

SCHEMA = "beads_enrichment_v1"
RUBRIC = "beads_outcome_v5"
DEFAULT_ROOTS = ("~/Code", "~/orca/workspaces", "~/orca/projects")
MAX_DEPTH = 5
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "dist", "build", "target",
             "DerivedData", "Library", ".cache", "Intermediate", "Saved", ".godot"}
MAX_COMMENTS = 12
LIMITS = {"title": 300, "description": 2500, "acceptance_criteria": 1500,
          "notes": 2000, "close_reason": 1000, "comment": 700}
RATE_LIMIT_WAIT_CAP = 90
RATE_LIMIT_STREAK = 4
PROGRESS_SECONDS = 30
SCANNER_VERSION = 2
# Jev request budget (UTF-8 bytes), checked before any request is sent.
MAX_STATE_BYTES = 24_000
MAX_STATE_PLUS_QUESTION_BYTES = 30_000
MAX_PAYLOAD_BYTES = 60_000

DISPOSITION = {
    "completed": "The record says the requested work was delivered as specified. This is a tracker claim unless supplied checks confirm it.",
    "completed_with_deviation": "Delivered with explicitly reduced scope, a workaround, known remaining defects, or part of the requirement moved to follow-up work.",
    "not_completed_rejected": "Work was attempted, but the result was rejected, reverted, or failed its acceptance check.",
    "abandoned_or_obsolete": "Closed without delivering the work because it was no longer needed, deprioritized, blocked indefinitely, or cancelled.",
    "duplicate_or_superseded": "Closed because another issue covers it: duplicate, superseded, merged, or split into other issues.",
    "container_or_non_work": "An epic, tracking container, decision record, question, or test record rather than a unit of delivered work.",
    "unknown": "The record does not establish why it was closed or what happened. A bare 'Closed' or 'Done' is unknown.",
}
EVIDENCE = {
    "requester_acceptance": "The record shows the requester or an independent reviewer explicitly accepted or rejected the delivered result.",
    "observed_check": "Supplied transcript tool results directly test the requested outcome.",
    "recorded_specific_check": "The close reason, notes, or comments cite specific checks with results: commands, test counts, measurements, HTTP statuses, run IDs, or reviewed screenshots. A recorded claim, not an observation.",
    "completion_claim_only": "The record only asserts completion or gives a summary without specific checks.",
    "none": "Neither the tracker text nor the supplied checks say anything about the delivered outcome.",
}
ACCEPTANCE = {
    "met": "Written acceptance criteria exist and the record addresses all of them with specific outcomes.",
    "partially_met": "Written acceptance criteria exist and the record addresses only some, or states that some were not met.",
    "not_met": "Written acceptance criteria exist and the record states they were not met.",
    "not_assessable": "Written acceptance criteria exist, but the record does not say whether they were met.",
    "no_criteria": "No acceptance criteria are written in the requirements.",
}
REWORK = {
    "none_visible": "No defect, reopen, rejection, or corrective follow-up after a completion claim is visible.",
    "minor": "Small corrections or review fixes are visible after a completion claim.",
    "major": "Substantial rework, a reopened issue, a reverted change, or a failed delivery is visible.",
}


class Unavailable(Exception):
    """Beads was selected but cannot be read; reported, never emulated."""


# --- bd access -------------------------------------------------------------

def run_bd(args, cwd, timeout=120):
    """Run a documented read-only bd command in `cwd`; `bd -C` misreports context."""
    if not shutil.which("bd"):
        raise Unavailable("bd is not installed or not on PATH")
    try:
        completed = subprocess.run(["bd", "--readonly", *args], cwd=cwd, capture_output=True,
                                   text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise Unavailable(f"bd {args[0]} timed out after {timeout}s") from None
    if completed.returncode:
        lines = [line.strip() for line in (completed.stderr + completed.stdout).splitlines()
                 if line.strip() and not line.startswith("Warning:")]
        detail = next((line for line in lines if "rror" in line), lines[0] if lines else "")
        raise Unavailable(f"bd {args[0]} exited {completed.returncode}: {detail[:200]}")
    return completed.stdout


def find_beads_dirs(roots, max_depth=MAX_DEPTH):
    found = []
    for root in roots:
        root = Path(root).expanduser()
        if not root.is_dir():
            continue
        base = len(root.parts)
        for current, dirs, _files in os.walk(root):
            depth = len(Path(current).parts) - base
            if ".beads" in dirs and (Path(current) / ".beads").is_dir():
                found.append(Path(current) / ".beads")
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")
                             and depth < max_depth)
    return sorted(set(found))


def discover(roots=DEFAULT_ROOTS, max_depth=MAX_DEPTH, runner=run_bd):
    """Group discovered .beads dirs by the canonical store bd resolves them to."""
    stores, failures = {}, []
    for beads_dir in find_beads_dirs(roots, max_depth):
        try:
            context = json.loads(runner(["context", "--json"], beads_dir.parent))
            if "beads_dir" not in context:
                raise Unavailable(f"bd context: {str(context.get('error'))[:200]}")
        except (Unavailable, ValueError, TypeError) as exc:
            # Broken worktrees still get their own store: bd export or its JSONL
            # artifact may work there, and project IDs deduplicate the issues.
            failures.append({"path": str(beads_dir), "stage": "context", "error": str(exc)})
            try:
                metadata = json.loads((beads_dir / "metadata.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                metadata = {}
            context = {"beads_dir": str(beads_dir), "repo_root": str(beads_dir.parent),
                       "project_id": metadata.get("project_id"), "database": metadata.get("dolt_database")}
        canonical = str(Path(context["beads_dir"]).resolve())
        store = stores.setdefault(canonical, {
            "beads_dir": canonical, "repo_root": context.get("repo_root"),
            "project_id": context.get("project_id"), "database": context.get("database"),
            "bd_version": context.get("bd_version"), "aliases": []})
        store["aliases"].append(str(beads_dir))
    return {"stores": sorted(stores.values(), key=lambda s: s["beads_dir"]), "failures": failures}


def done_statuses(store, runner=run_bd):
    """Statuses in the `done` category, plus an error when only `closed` could be assumed."""
    try:
        data = json.loads(runner(["statuses", "--json"], store["repo_root"]))
    except (Unavailable, ValueError) as exc:
        return {"closed"}, f"bd statuses failed ({exc}); closed-only fallback, custom done statuses not covered"
    names = {item.get("name") for group in ("built_in_statuses", "custom_statuses")
             for item in data.get(group) or [] if item.get("category") == "done"}
    if not names:
        return {"closed"}, "bd statuses listed no done category; closed-only fallback"
    return names, None


def export_store(store, runner=run_bd):
    """Issues from `bd export`; on failure, the store's exported JSONL is read as a labelled artifact."""
    try:
        raw = runner(["export"], store["repo_root"])
        reader = "bd export"
    except Unavailable as exc:
        artifact = Path(store["beads_dir"]) / "issues.jsonl"
        if not artifact.is_file():
            raise
        raw = artifact.read_text(encoding="utf-8")
        reader = f"jsonl artifact (bd export failed: {exc})"
    rows = []
    for line in raw.splitlines():
        if line.strip():
            item = json.loads(line)
            if item.get("_type", "issue") == "issue":
                rows.append(item)
    return rows, reader


# --- records ---------------------------------------------------------------

def clip(value, limit):
    value = retrospect.redact_sensitive(str(value or "").strip())
    return value if len(value) <= limit else value[:limit // 2] + "\n[omitted middle]\n" + value[-limit // 2:]


def issue_ref(project_id, issue_id):
    return f"{(project_id or 'unknown')[:8]}:{issue_id}"


def finalized_record(issue, store, reader):
    comments = sorted(issue.get("comments") or [], key=lambda c: c.get("created_at") or "")
    relations = [{"type": dep.get("type"), "target": dep.get("depends_on_id")}
                 for dep in issue.get("dependencies") or []
                 if dep.get("issue_id") == issue["id"] and dep.get("type") != "parent-child"]
    parent = next((dep.get("depends_on_id") for dep in issue.get("dependencies") or []
                   if dep.get("type") == "parent-child" and dep.get("issue_id") == issue["id"]), None)
    record = {
        "schema": SCHEMA, "issue_ref": issue_ref(store["project_id"], issue["id"]),
        "issue_id": issue["id"], "repository": Path(store["repo_root"] or store["beads_dir"]).name,
        "source_path": store["beads_dir"], "terminal_status": issue.get("status"),
        "issue_type": issue.get("issue_type"), "priority": issue.get("priority"),
        "created_at": issue.get("created_at"), "closed_at": issue.get("closed_at"),
        "updated_at": issue.get("updated_at"), "parent": parent,
        "requirements": {key: clip(issue.get(key), LIMITS[key])
                         for key in ("title", "description", "acceptance_criteria")},
        "claims": {"close_reason": clip(issue.get("close_reason"), LIMITS["close_reason"]),
                   "notes": clip(issue.get("notes"), LIMITS["notes"]),
                   "comments": [{"created_at": c.get("created_at"),
                                 "text": clip(c.get("text"), LIMITS["comment"])}
                                for c in comments[-MAX_COMMENTS:]],
                   "comments_omitted": max(0, len(comments) - MAX_COMMENTS)},
        "structural": {"labels": sorted(issue.get("labels") or []), "relations": relations,
                       "dependent_count": issue.get("dependent_count") or 0},
        "provenance": {"reader": reader, "bd_version": store.get("bd_version"),
                       "store_aliases": len(store.get("aliases") or []),
                       "requirements_as_of": "export (later edits not distinguished)"},
        "transcript_links": [], "observed_checks": [],
    }
    record["missing_evidence"] = missing_evidence(record)
    return record


def missing_evidence(record):
    flags = []
    reason = record["claims"]["close_reason"].strip().lower().rstrip(".")
    if not reason:
        flags.append("no_close_reason")
    elif reason in {"closed", "done", "completed", "complete", "fixed", "resolved"}:
        flags.append("generic_close_reason")
    if not record["requirements"]["acceptance_criteria"]:
        flags.append("no_acceptance_criteria")
    if not record["requirements"]["description"]:
        flags.append("no_description")
    if not record["claims"]["comments"] and not record["claims"]["notes"]:
        flags.append("no_comments_or_notes")
    if not record["transcript_links"]:
        flags.append("no_transcript_link")
    elif not any(link["attribution"] == "single_model_operator" for link in record["transcript_links"]):
        flags.append("no_single_model_operator")
    if not record["observed_checks"]:
        flags.append("no_observed_check")
    return flags


def census_stores(stores, runner=run_bd):
    """Finalized records deduplicated by (project, issue); newest update wins across divergent clones."""
    records, failures, totals = {}, [], Counter()
    for store in stores:
        try:
            issues, reader = export_store(store, runner)
        except (Unavailable, OSError, ValueError) as exc:
            failures.append({"path": store["beads_dir"], "stage": "export", "error": str(exc)})
            continue
        if reader != "bd export":
            failures.append({"path": store["beads_dir"], "stage": "export", "error": reader})
        final, status_error = done_statuses(store, runner)
        if status_error:
            failures.append({"path": store["beads_dir"], "stage": "statuses", "error": status_error})
            totals["status_fallback_stores"] += 1
        for issue in issues:
            totals["issues_read"] += 1
            totals[f"status:{issue.get('status')}"] += 1
            if issue.get("status") not in final:
                continue
            record = finalized_record(issue, store, reader)
            previous = records.get(record["issue_ref"])
            if previous:
                totals["duplicate_copies"] += 1
                rank = lambda r: (r["updated_at"] or "", r["provenance"]["reader"] == "bd export")
                if rank(previous) >= rank(record):
                    continue
            records[record["issue_ref"]] = record
    return list(records.values()), failures, totals


# --- transcript linking ----------------------------------------------------

def session_roots(home, extra_codex_homes=()):
    """Mirror history_inventory's local transcript roots."""
    roots = [("codex", home / ".codex/sessions"), ("codex", home / ".codex/archived_sessions"),
             ("claude", home / ".claude/projects"), ("grok", home / ".grok/sessions")]
    codex_homes = sorted((home / "Library/Application Support/orca/codex-accounts").glob("*/home"))
    for codex_home in [*codex_homes, *map(Path, extra_codex_homes)]:
        roots += [("codex", codex_home / "sessions"), ("codex", codex_home / "archived_sessions")]
    return [(provider, root) for provider, root in roots if root.is_dir()]


def id_prefixes(ids):
    return sorted({i.split(".", 1)[0].rsplit("-", 1)[0] for i in ids}, key=len, reverse=True)


def id_pattern(ids):
    return re.compile(r"(?<![A-Za-z0-9_./-])((?:" + "|".join(map(re.escape, id_prefixes(ids))) +
                      r")-[a-z0-9]{2,}(?:\.\d+)*)(?![A-Za-z0-9_-])")


def candidate_files(home, ids, extra_codex_homes=()):
    """(candidates, coverage gaps): files naming any exact issue ID, ripgrep-prefiltered when present.

    A root that ripgrep could not fully read is a reported gap, never silently dropped.
    """
    candidates, gaps = [], []
    roots = session_roots(home, extra_codex_homes)
    if not roots:
        gaps.append({"root": str(home), "error": "no transcript roots found"})
    if shutil.which("rg"):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".txt") as stream:
            stream.write("\n".join(sorted(ids)))
            stream.flush()
            for provider, root in roots:
                glob = "chat_history.jsonl" if provider == "grok" else "*.jsonl"
                completed = subprocess.run(["rg", "-l", "-F", "-w", "-f", stream.name, "--glob", glob, str(root)],
                                           capture_output=True, text=True, check=False)
                if completed.returncode not in (0, 1):
                    gaps.append({"root": str(root), "error": f"rg exited {completed.returncode}: "
                                                            f"{completed.stderr.strip()[:200]}"})
                candidates += [(provider, Path(line)) for line in sorted(completed.stdout.splitlines())]
        return candidates, gaps
    pattern = id_pattern(ids)
    for provider, root in roots:
        for path in sorted(root.rglob("chat_history.jsonl" if provider == "grok" else "*.jsonl")):
            try:
                with path.open(encoding="utf-8", errors="replace") as stream:
                    if any(match.group(1) in ids for line in stream for match in pattern.finditer(line)):
                        candidates.append((provider, path))
            except OSError as exc:
                gaps.append({"root": str(path), "error": type(exc).__name__})
    return candidates, gaps


BD_VERB = re.compile(r"\bbd\s+(?:--?[\w-]+(?:[= ]\S+)?\s+)*(close|update|show|comments?|note|create|reopen|dep|list)\b")


def command_kind(command, issue_id):
    """Structural kind of a shell command that names `issue_id`."""
    for segment in re.split(r"&&|\|\||;|\n", command):
        if not re.search(r"(?<![\w.-])" + re.escape(issue_id) + r"(?![\w-]|\.\d)", segment):
            continue
        verb = BD_VERB.search(segment)
        if not verb:
            continue
        if verb.group(1) == "close":
            return "close_command"
        if verb.group(1) == "update" and re.search(r"--claim\b|--status[= ]in_progress\b", segment):
            return "claim_command"
        return "bd_command"
    return "tool_command"


def session_events(path, provider, needles=()):
    """Yield (work_turn, kind, text, model) in transcript order, counting turns like tool_check_evidence.

    With `needles`, lines that contain none of them and no user message are skipped
    unparsed; turn counts are unaffected because only user messages advance them.
    """
    from performance_assess import command_from_input, strings
    log = path.parent / "chat_history.jsonl" if provider == "grok" and path.name == "summary.json" else path
    turn = -1
    with log.open(encoding="utf-8", errors="replace") as stream:
        for line in stream:
            if needles and '"user"' not in line and not any(needle in line for needle in needles):
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            events = []
            if provider == "codex":
                payload = item.get("payload") or {}
                kind = payload.get("type") if item.get("type") == "response_item" else None
                if kind == "message" and payload.get("channel") != "analysis":  # internal reasoning
                    text = retrospect.text_content(payload.get("content"))
                    events.append(("user" if payload.get("role") == "user" else "assistant", text, None))
                elif kind in ("function_call", "custom_tool_call"):
                    raw = payload.get("arguments") or payload.get("input") or ""
                    events.append(("command", command_from_input(raw) or str(raw), None))
                elif kind in ("function_call_output", "custom_tool_call_output"):
                    events.append(("tool_output", "\n".join(strings(payload.get("output"))), None))
            elif provider == "claude":
                message = item.get("message") or {}
                content = message.get("content")
                if item.get("type") == "user":
                    if not item.get("sourceToolUseID"):
                        events.append(("user", retrospect.text_content(content), None))
                    for block in content if isinstance(content, list) else []:
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            events.append(("tool_output", "\n".join(strings(block.get("content"))), None))
                elif item.get("type") == "assistant":
                    model = message.get("model")
                    for block in content if isinstance(content, list) else []:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "text":
                            events.append(("assistant", block.get("text") or "", model))
                        elif block.get("type") == "tool_use":
                            tool_input = block.get("input")
                            command = command_from_input(tool_input) or json.dumps(tool_input)
                            events.append(("command", command, model))
            else:
                kind = item.get("type")
                if kind == "user" and not item.get("synthetic_reason"):
                    events.append(("user", retrospect.text_content(item.get("content")), None))
                elif kind == "assistant":
                    events.append(("assistant", retrospect.text_content(item.get("content")), item.get("model_id")))
                    for call in item.get("tool_calls") or []:
                        events.append(("command", json.dumps(call), item.get("model_id")))
                elif kind == "tool_result":
                    events.append(("tool_output", "\n".join(strings(item.get("content"))), None))
            for kind, text, model in events:
                if kind == "user" and text and retrospect.clean_user(text):
                    turn += 1
                yield turn, kind, text, model


def scan_session(path, provider, ids, pattern):
    """Exact-ID mentions in one transcript, keyed by issue ID."""
    found = defaultdict(lambda: {"kinds": Counter(), "close_turns": [], "claim_turns": []})
    needles = tuple(prefix + "-" for prefix in id_prefixes(ids))
    for turn, kind, text, _model in session_events(path, provider, needles):
        if not text:
            continue
        for issue_id in {m.group(1) for m in pattern.finditer(text)} & ids:
            entry = found[issue_id]
            if kind == "command":
                kind_here = command_kind(text, issue_id)
                if kind_here == "close_command":
                    entry["close_turns"].append(turn)
                elif kind_here == "claim_command":
                    entry["claim_turns"].append(turn)
                entry["kinds"][kind_here] += 1
            elif kind == "user":
                entry["kinds"]["user_prompt" if retrospect.clean_user(text) else "injected_context"] += 1
            else:
                entry["kinds"][kind] += 1
    return found


def session_entry(session_path, provider, ids, pattern, scanner=scan_session):
    """Everything linking needs from one transcript. Follow-up reads happen once per
    operating turn (delegation) or closing turn (checks), shared by every issue in it."""
    import history_inventory
    from performance_assess import tool_check_evidence
    found = scanner(session_path, provider, ids, pattern)
    if not found:
        return {"found": {}, "source": source_stamp(session_path, provider)}
    summary = history_inventory.summarize(session_path, provider)
    entry = {"models": summary["models"], "first_event_at": summary.get("first_event_at"),
             "last_event_at": summary.get("last_event_at"), "found": {}, "delegation": {}, "checks": {},
             "source": source_stamp(session_path, provider)}
    for issue_id, item in found.items():
        entry["found"][issue_id] = {"kinds": dict(item["kinds"]), "close_turns": sorted(set(item["close_turns"])),
                                    "claim_turns": sorted(set(item["claim_turns"]))}
    for value in entry["found"].values():
        for turn in value["close_turns"] + value["claim_turns"]:
            if str(turn) not in entry["delegation"]:
                try:
                    entry["delegation"][str(turn)] = retrospect.delegation_detected(session_path, provider, turn)
                except (OSError, UnicodeError, ValueError):
                    entry["delegation"][str(turn)] = None
        for turn in value["close_turns"][-1:]:
            if str(turn) not in entry["checks"]:
                try:
                    entry["checks"][str(turn)] = tool_check_evidence(session_path, provider, turn_index=turn)
                except (OSError, UnicodeError, ValueError):
                    entry["checks"][str(turn)] = None
    return entry


def source_stamp(session_path, provider):
    log = session_path.parent / "chat_history.jsonl" if provider == "grok" else session_path
    info = log.stat()
    return {"size": info.st_size, "mtime_ns": info.st_mtime_ns}


def link_attribution(models, operated, delegated):
    if not operated:
        return "mention_only"
    if len(models) != 1:
        return "mixed_or_missing_model"
    if delegated is None:
        return "unknown_delegation"
    return "delegating_operator" if delegated else "single_model_operator"


def operating_delegation(link):
    """True if any operating turn delegated, None if any is unknown, else False."""
    values = link.get("delegation_by_turn")
    if values is None:  # links written before per-turn caching
        return link.get("delegated_in_operating_turns")
    if any(value is True for value in values.values()):
        return True
    return None if any(value is None for value in values.values()) else False


def normalize_record(record):
    """Recompute derived link fields from stored facts, so older censuses follow current rules."""
    for link in record["transcript_links"]:
        operated = bool(link["close_turns"] or link["claim_turns"])
        link["attribution"] = link_attribution(link["models"], operated, operating_delegation(link))
    record["missing_evidence"] = missing_evidence(record)
    return record


def link_records(records, entries):
    """Attach links from per-session entries; model identity comes from session metadata only."""
    by_id = defaultdict(list)
    for record in records:
        record["transcript_links"], record["observed_checks"] = [], []
        by_id[record["issue_id"]].append(record)
    stats = Counter()
    for entry in entries:
        for issue_id, found in entry["found"].items():
            targets = by_id.get(issue_id, [])
            if len(targets) != 1:
                stats["ambiguous_or_unknown_id_links"] += 1
                continue
            turns = found["close_turns"] + found["claim_turns"]
            link = {"session_path": entry["session_path"], "provider": entry["provider"],
                    "session_key": entry["session_key"], "models": entry["models"],
                    "first_event_at": entry["first_event_at"], "last_event_at": entry["last_event_at"],
                    "mention_kinds": found["kinds"], "close_turns": found["close_turns"],
                    "claim_turns": found["claim_turns"],
                    "delegation_by_turn": {str(t): entry["delegation"].get(str(t)) for t in turns},
                    "attribution_note": "operator association; work authorship not verified"}
            targets[0]["transcript_links"].append(link)
            for turn in found["close_turns"][-1:]:
                checks = entry["checks"].get(str(turn))
                for check in checks or []:
                    targets[0]["observed_checks"].append({**check, "session_path": entry["session_path"],
                                                          "turn": turn,
                                                          "source": "transcript tool result in closing turn"})
    for record in records:
        record["observed_checks"] = record["observed_checks"][-6:]
        normalize_record(record)
        for link in record["transcript_links"]:
            stats[f"links:{link['attribution']}"] += 1
    return stats


def link_transcripts(records, home, files=None, checkpoint=None, extra_codex_homes=(),
                     scanner=scan_session, log=None):
    """Scan candidate transcripts once each, checkpointing per session, then attach links.

    A checkpoint is bound to the issue set, scanner version, and transcript roots;
    a session is reused only while its file size and mtime are unchanged. Candidate
    discovery always reruns, so new transcripts are never missed on resume.
    """
    import history_inventory
    ids = {record["issue_id"] for record in records}
    if not ids:
        return Counter()
    pattern = id_pattern(ids)
    roots = [f"{p}:{r}" for p, r in session_roots(home, extra_codex_homes)] if files is None else ["explicit files"]
    header = {"ids_digest": hashlib.sha256("\n".join(sorted(ids)).encode()).hexdigest()[:16],
              "scanner_version": SCANNER_VERSION, "roots": roots}
    previous = {}
    if checkpoint is not None and checkpoint.stat().st_size:
        rows = read_jsonl(checkpoint)
        if rows[0] != header:
            raise SystemExit("Checkpoint was built for a different issue set, scanner, or roots; "
                             "use a new checkpoint file")
        previous = {row["session_key"]: row for row in rows[1:]}  # later rows supersede
    stats = Counter()
    if files is not None:
        candidates = list(files)
    else:
        candidates, gaps = candidate_files(home, ids, extra_codex_homes)
        for gap in gaps:
            stats["coverage_gap"] += 1
            if log:
                log(json.dumps({"coverage_gap": gap}))
    stream = checkpoint.open("a", encoding="utf-8") if checkpoint is not None else None
    if stream and not previous and checkpoint.stat().st_size == 0:
        stream.write(json.dumps(header) + "\n")
    entries, seen, started, last = [], set(), time.monotonic(), time.monotonic()
    try:
        for provider, path in candidates:
            session_path = path.parent / "summary.json" if provider == "grok" and path.name != "summary.json" else path
            key = "\0".join(history_inventory.session_key(session_path, provider))
            if key in seen:
                stats["duplicate_session_copies"] += 1
                continue
            seen.add(key)
            prior = previous.get(key)
            try:
                if prior and prior.get("source") == source_stamp(session_path, provider):
                    stats["sessions_from_checkpoint"] += 1
                    entry = prior
                else:
                    stats["sessions_rescanned_changed" if prior else "sessions_scanned"] += 1
                    entry = session_entry(session_path, provider, ids, pattern, scanner)
                    entry.update(session_key=key, session_path=str(session_path), provider=provider)
                    if stream:
                        stream.write(json.dumps(entry) + "\n")
                        stream.flush()
            except (OSError, UnicodeError) as exc:
                stats[f"scan_error:{type(exc).__name__}"] += 1
                continue
            if entry["found"]:
                entries.append(entry)
            if log and time.monotonic() - last >= PROGRESS_SECONDS:
                last = time.monotonic()
                log(json.dumps({"progress": {"candidates": len(candidates), "unique_seen": len(seen),
                                             "scanned": stats["sessions_scanned"],
                                             "from_checkpoint": stats["sessions_from_checkpoint"],
                                             "linked_sessions": len(entries),
                                             "elapsed_s": round(last - started)}}))
    finally:
        if stream:
            stream.close()
    stats["candidate_files"] = len(candidates)
    stats["linked_sessions"] = len(entries)
    stats.update(link_records(records, entries))
    return stats


def primary_link(record):
    """Strongest operator link; among equals, the most recent session."""
    rank = {"single_model_operator": 0, "delegating_operator": 1, "unknown_delegation": 2,
            "mixed_or_missing_model": 3, "mention_only": 4}
    links = sorted(record["transcript_links"], key=lambda link: link.get("last_event_at") or "", reverse=True)
    links.sort(key=lambda link: (rank[link["attribution"]], not link["close_turns"], -len(link["claim_turns"])))
    return links[0] if links else None


# --- optional adapter ------------------------------------------------------

def enrich_session(session_path, provider="codex", *, selected=False, census=None, repo=None, runner=run_bd):
    """Bounded Beads records for one session. Unselected: no-op. Selected without bd: explicit unavailable.

    `census` is a private linked census JSONL (artifact; bd not required). Otherwise
    `repo` is the session's working tree, read live through `bd export`.
    """
    if not selected:
        return {"status": "not_selected", "records": []}
    wanted = os.path.realpath(session_path)
    if census is not None:
        rows = read_jsonl(Path(census))
        records = [normalize_record(row) for row in rows
                   if any(os.path.realpath(link["session_path"]) == wanted
                          for link in row.get("transcript_links") or [])]
        return {"status": "ok", "source": "census artifact", "census_records": len(rows),
                "linked_records": len(records), "records": records}
    try:
        if repo is None:
            raise Unavailable("no census artifact or repository was given")
        context = json.loads(runner(["context", "--json"], repo))
        store = {"beads_dir": context["beads_dir"], "repo_root": context.get("repo_root") or str(repo),
                 "project_id": context.get("project_id"), "bd_version": context.get("bd_version"),
                 "aliases": [context["beads_dir"]]}
        records, failures, _totals = census_stores([store], runner)
    except Unavailable as exc:
        return {"status": "unavailable", "reason": str(exc), "records": []}
    except (ValueError, KeyError, TypeError):
        return {"status": "unavailable", "reason": "unparseable bd output", "records": []}
    blocking = [f for f in failures if f["stage"] == "export"]
    if blocking:
        return {"status": "unavailable", "reason": blocking[0]["error"], "records": []}
    if records:
        link_transcripts(records, Path.home(), files=[(provider, Path(wanted))])
    linked = [record for record in records if record["transcript_links"]]
    return {"status": "ok", "source": "bd export", "census_records": len(records),
            "linked_records": len(linked), "warnings": failures, "records": linked}


# --- Jev evaluation --------------------------------------------------------

def jev_state(record):
    """Tracker text and observed checks only; model identity is withheld from the judge."""
    link = primary_link(record)
    return {"issue": {"type": record["issue_type"], "priority": record["priority"],
                      "requirements": record["requirements"], "tracker_claims": record["claims"],
                      "labels": record["structural"]["labels"],
                      "relations": record["structural"]["relations"],
                      "has_parent": bool(record["parent"])},
            "transcript": {"linked": bool(link),
                           "closed_by_linked_session": bool(link and link["close_turns"]),
                           "observed_checks_from_closing_turn": [
                               {k: c[k] for k in ("command", "summary", "exit_code")}
                               for c in record["observed_checks"]]}}


def domain_scale(domain):
    named = f"{domain['id']} ({domain['description']})"
    return {"absent": f"No distinct deliverable in {named} is requested. Incidental terminology, routine dependencies, and routine checks of one's own work do not count.",
            "supporting": f"A concrete requested contribution in {named} is subordinate to the main deliverable.",
            "central": f"The requested deliverable is primarily judged on work in {named}. Identify that deliverable before selecting this; several domains can be central."}


def questions(taxonomy):
    base = {
        "disposition": ("What does this finalized issue record establish happened? Closed status alone is not success, but a close reason or note that describes what was delivered is enough for a completed option; it stays a claim.", DISPOSITION),
        "evidence": ("Choose the strongest evidence the supplied material gives about the delivered outcome. Text in tracker_claims was written by the implementer or coordinator and is a claim; only observed_checks_from_closing_turn are observed.", EVIDENCE),
        "acceptance": ("Compare requirements.acceptance_criteria with what the record reports.", ACCEPTANCE),
        "rework": ("Does the record show defects, rejection, reopening, or corrective follow-up after a completion claim?", REWORK),
    }
    result = {name: {"type": "choice", "instructions": text, "criteria": criteria}
              for name, (text, criteria) in base.items()}
    for domain in taxonomy["domains"]:
        result["domain_" + domain["id"]] = {
            "type": "choice", "criteria": domain_scale(domain),
            "instructions": (f"How involved is {domain['id']} in the deliverable this issue requested? "
                             "Judge the requested deliverable, not how the closer reports doing it.")}
    return result


def state_digest(record):
    return hashlib.sha256(json.dumps(jev_state(record), sort_keys=True).encode()).hexdigest()[:16]


def evaluation_signature(taxonomy):
    """Changes whenever the rubric, taxonomy, or any question or option text changes."""
    return hashlib.sha256(json.dumps({"rubric": RUBRIC, "questions": questions(taxonomy)},
                                     sort_keys=True).encode()).hexdigest()[:16]


class Oversize(ValueError):
    """A request would exceed the Jev budget; it is split or recorded, never sent."""


def batch_payload(batch, taxonomy, require_zdr=True):
    base = questions(taxonomy)
    state = [{"case": index, **jev_state(record)} for index, record in enumerate(batch)]
    asked = {f"{index}_{name}": {**question, "instructions": f"Case {index}: {question['instructions']}"}
             for index in range(len(batch)) for name, question in base.items()}
    payload = retrospect.private_jev_payload(state, asked, require_zdr)
    size = lambda value: len(json.dumps(value, ensure_ascii=False).encode())
    state_bytes = size(state)
    if (state_bytes > MAX_STATE_BYTES or state_bytes + max(map(size, asked.values())) > MAX_STATE_PLUS_QUESTION_BYTES
            or size(payload) > MAX_PAYLOAD_BYTES):
        raise Oversize(f"state {state_bytes} B, payload {size(payload)} B")
    return base, payload


def evaluate_batch(batch, taxonomy, require_zdr=True, evaluate=None):
    """One Jev request for several issues (cases); every question names its case."""
    evaluate = evaluate or jev.evaluate_bounded
    signature = evaluation_signature(taxonomy)
    base, payload = batch_payload(batch, taxonomy, require_zdr)
    response = evaluate(payload)
    results = []
    for index, record in enumerate(batch):
        answers = {name: response["answers"][f"{index}_{name}"] for name in base}
        results.append({
            "issue_ref": record["issue_ref"], "rubric": RUBRIC, "signature": signature,
            "state_digest": state_digest(record), "taxonomy_version": taxonomy["version"],
            "batch_size": len(batch), "privacy_mode": "zdr" if require_zdr else "no_training",
            "labels": {name: answers[name]["choice"] for name in ("disposition", "evidence", "acceptance", "rework")},
            "confidence": {name: answers[name].get("confidence") for name in answers},
            "domains": {name[7:]: answers[name]["choice"] for name in answers
                        if name.startswith("domain_") and answers[name]["choice"] != "absent"},
            "usage": response.get("usage") if index == 0 else None,
            "cost_usd": (response.get("cost_usd") or 0) if index == 0 else 0})
    return results


def evaluate_splitting(batch, taxonomy, require_zdr=True, evaluate=None):
    """Split a batch whose answers fail validation; a single failing issue gets an error row."""
    try:
        return evaluate_batch(batch, taxonomy, require_zdr, evaluate)
    except jev.RateLimitError:
        raise
    except (jev.Error, Oversize) as exc:
        code = "request_oversize" if isinstance(exc, Oversize) else retrospect.SESSION_EVAL_ERRORS.get(str(exc))
        if not code:
            raise
        if len(batch) == 1:
            return [{"issue_ref": batch[0]["issue_ref"], "rubric": RUBRIC,
                     "signature": evaluation_signature(taxonomy), "state_digest": state_digest(batch[0]),
                     "privacy_mode": "zdr" if require_zdr else "no_training", "error": code}]
        middle = len(batch) // 2
        return (evaluate_splitting(batch[:middle], taxonomy, require_zdr, evaluate) +
                evaluate_splitting(batch[middle:], taxonomy, require_zdr, evaluate))


def diverse_order(records):
    """Single-model operators, then other operators, then the rest; each phase round-robin across
    (repository, attribution, close-reason presence) buckets, so any prefix is a diverse sample."""
    phases = ([], [], [])
    for record in records:
        link = primary_link(record)
        attribution = link["attribution"] if link else "unlinked"
        phases[0 if attribution == "single_model_operator" else
               2 if attribution in ("mention_only", "unlinked") else 1].append(record)
    ordered = []
    for phase in phases:
        buckets = defaultdict(list)
        for record in phase:
            link = primary_link(record)
            buckets[(record["repository"], link["attribution"] if link else "unlinked",
                     "no_close_reason" in record["missing_evidence"])].append(record)
        for rows in buckets.values():
            rows.sort(key=lambda r: hashlib.sha256(r["issue_ref"].encode()).hexdigest())
        while any(buckets.values()):
            for key in sorted(buckets):
                if buckets[key]:
                    ordered.append(buckets[key].pop(0))
    return ordered


def run_evaluations(records, output, limit=None, require_zdr=True, evaluate=None, sleep=time.sleep,
                    log=print, workers=1, batch_size=1):
    """Append one result per issue; resumable; stops with partial results on sustained 429.

    A result is reused only while the judged state, question signature, and privacy
    mode are unchanged. Any worker's sustained rate limit or provider error stops
    every worker.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading
    taxonomy = json.loads(retrospect.DOMAINS.read_text(encoding="utf-8"))
    signature = evaluation_signature(taxonomy)
    privacy = "zdr" if require_zdr else "no_training"
    done = ({(row["issue_ref"], row.get("state_digest")) for row in read_jsonl(output)
             if row.get("signature") == signature and row.get("privacy_mode") == privacy}
            if output.exists() else set())
    records = [normalize_record(record) for record in records]
    pending = [r for r in diverse_order(records) if (r["issue_ref"], state_digest(r)) not in done][:limit]
    stop, stopped = threading.Event(), {}

    def work(batch):
        streak = 0
        while not stop.is_set():
            try:
                return evaluate_splitting(batch, taxonomy, require_zdr, evaluate)
            except jev.RateLimitError as exc:
                streak += 1
                delay = exc.retry_after_seconds or 5 * streak
                if streak >= RATE_LIMIT_STREAK or delay > RATE_LIMIT_WAIT_CAP:
                    stopped.setdefault("status", "rate_limited")
                    stopped.setdefault("retry_after_seconds", exc.retry_after_seconds)
                    stop.set()
                    return None
                sleep(delay)
            except jev.Error as exc:
                stopped.setdefault("status", "error")
                stopped.setdefault("error", str(exc))
                stop.set()
                return None
        return None

    processed = 0
    with output.open("a", encoding="utf-8") as stream, ThreadPoolExecutor(max(1, workers)) as pool:
        size = max(1, batch_size)
        batches = [pending[i:i + size] for i in range(0, len(pending), size)]
        for future in as_completed([pool.submit(work, batch) for batch in batches]):
            for result in future.result() or []:
                stream.write(json.dumps(result) + "\n")
                processed += 1
            stream.flush()
    if stopped:
        log(json.dumps({"stopped": stopped["status"], "completed_this_run": processed,
                        **{k: v for k, v in stopped.items() if k != "status"}}))
        return {**stopped, "completed": processed, "pending": len(pending) - processed}
    return {"status": "complete" if limit is None or processed < limit else "limit_reached",
            "completed": processed, "pending": len(pending) - processed}


# --- reporting -------------------------------------------------------------

def evaluation_status(record, row, signature):
    if row is None:
        return "not_evaluated"
    if row.get("signature") != signature or row.get("state_digest") != state_digest(record):
        return "stale"
    return "error" if "error" in row else "current"


def per_issue_rows(records, evaluations, signature):
    latest = {row["issue_ref"]: row for row in evaluations}  # the latest row wins, errors included
    for record in records:
        record = normalize_record(record)
        link = primary_link(record)
        row = latest.get(record["issue_ref"])
        status = evaluation_status(record, row, signature)
        current = row if status == "current" else {}
        labels = current.get("labels", {})
        models = link["models"] if link else []
        yield {"issue_ref": record["issue_ref"], "repository": record["repository"],
               "issue_type": record["issue_type"], "closed_at": record["closed_at"],
               "title": record["requirements"]["title"], "evaluation_status": status,
               "privacy_mode": current.get("privacy_mode", ""),
               "disposition": labels.get("disposition", status),
               "evidence": labels.get("evidence", status),
               "acceptance": labels.get("acceptance", status),
               "rework": labels.get("rework", status),
               "disposition_confidence": (current.get("confidence") or {}).get("disposition"),
               "central_domains": ";".join(sorted(d for d, v in current.get("domains", {}).items() if v == "central")),
               "supporting_domains": ";".join(sorted(d for d, v in current.get("domains", {}).items() if v == "supporting")),
               "attribution": link["attribution"] if link else "unlinked",
               "operator_model": models[0]["model"] if len(models) == 1 else "",
               "operator_effort": models[0]["effort"] if len(models) == 1 else "",
               "linked_sessions": len(record["transcript_links"]),
               "observed_checks": len(record["observed_checks"]),
               "observed_check_failed": any(c.get("exit_code") not in (0, None) for c in record["observed_checks"]),
               "missing_evidence": ";".join(record["missing_evidence"]),
               "session_path": link["session_path"] if link else ""}


def summarize(records, evaluations, signature):
    rows = list(per_issue_rows(records, evaluations, signature))
    summary = {"finalized": len(rows),
               "by_repository": Counter(r["repository"] for r in rows),
               "by_type": Counter(r["issue_type"] for r in rows),
               "missing_evidence": Counter(flag for r in rows for flag in r["missing_evidence"].split(";") if flag),
               "attribution": Counter(r["attribution"] for r in rows),
               "evaluation_status": Counter(r["evaluation_status"] for r in rows)}
    current = [r for r in rows if r["evaluation_status"] == "current"]
    for field in ("disposition", "evidence", "acceptance", "rework"):
        summary[field] = Counter(r[field] for r in current)
    summary["central_domains"] = Counter(d for r in current for d in r["central_domains"].split(";") if d)
    by_domain = defaultdict(Counter)
    for row in current:
        for domain in row["central_domains"].split(";") if row["central_domains"] else ["(none central)"]:
            by_domain[domain]["issues"] += 1
            by_domain[domain][row["disposition"]] += 1
            by_domain[domain]["evidence:" + row["evidence"]] += 1
    summary["domain_outcomes"] = {key: dict(value) for key, value in sorted(by_domain.items())}
    # Operator association, not performance: the operator closed or claimed the
    # issue, but the tracker text that yields each label is still a claim.
    association = defaultdict(Counter)
    for row in current:
        if row["attribution"] != "single_model_operator":
            continue
        for domain in row["central_domains"].split(";") if row["central_domains"] else ["(none central)"]:
            key = f"{row['operator_model']}|{row['operator_effort']}|{domain}"
            association[key]["issues"] += 1
            association[key][row["disposition"]] += 1
            association[key]["evidence:" + row["evidence"]] += 1
            association[key]["rework:" + row["rework"]] += 1
    summary["operator_association"] = {key: dict(value) for key, value in sorted(association.items())}
    return rows, summary


# --- private IO ------------------------------------------------------------

def read_jsonl(path):
    with Path(path).open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def private_path(path, root=None):
    """Require a regular mode-600 file directly inside the private retrospective root."""
    root = root or retrospect.PRIVATE_ROOT
    path = Path(path)
    if path.parent != root or path.is_symlink() or root.is_symlink():
        raise SystemExit(f"Private output must be directly inside {root}")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    path.touch(mode=0o600, exist_ok=True)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise SystemExit("Private output must be a regular file owned by this user")
    path.chmod(0o600)
    return path


def write_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    census = commands.add_parser("census", help="discover stores and read finalized issues")
    census.add_argument("--root", action="append", help="search root (repeatable); defaults to ~/Code and ~/orca")
    census.add_argument("--max-depth", type=int, default=MAX_DEPTH)
    census.add_argument("--output", required=True, type=Path)
    link = commands.add_parser("link", help="link a census to local transcripts (resumable)")
    link.add_argument("--census", required=True, type=Path)
    link.add_argument("--checkpoint", required=True, type=Path)
    link.add_argument("--codex-home", action="append", default=[], help="additional Codex home (repeatable)")
    link.add_argument("--output", required=True, type=Path)
    evaluate = commands.add_parser("evaluate", help="label finalized issues with Jev (resumable)")
    evaluate.add_argument("--census", required=True, type=Path)
    evaluate.add_argument("--output", required=True, type=Path)
    evaluate.add_argument("--limit", type=int)
    evaluate.add_argument("--workers", type=int, default=1, help="concurrent Jev requests (default 1)")
    evaluate.add_argument("--batch-size", type=int, default=1, help="issues per Jev request (default 1)")
    evaluate.add_argument("--allow-no-zdr", action="store_true",
                          help="send redacted excerpts with training opt-out when ZDR is unavailable")
    report = commands.add_parser("report", help="write per-issue CSV and aggregate JSON")
    report.add_argument("--census", required=True, type=Path)
    report.add_argument("--evaluations", required=True, type=Path)
    report.add_argument("--csv", required=True, type=Path)
    report.add_argument("--summary", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "census":
        output = private_path(args.output)
        try:
            found = discover(args.root or DEFAULT_ROOTS, args.max_depth)
        except Unavailable as exc:
            print(json.dumps({"status": "unavailable", "reason": str(exc)}))
            return 3
        records, failures, totals = census_stores(found["stores"])
        write_jsonl(output, sorted(records, key=lambda r: r["issue_ref"]))
        print(json.dumps({"stores": len(found["stores"]),
                          "store_dirs": sum(len(s["aliases"]) for s in found["stores"]),
                          "failures": found["failures"] + failures, "totals": totals,
                          "finalized": len(records)}, indent=2))
        return 0
    if args.command == "link":
        output, checkpoint = private_path(args.output), private_path(args.checkpoint)
        records = read_jsonl(args.census)
        stats = link_transcripts(records, Path.home(), checkpoint=checkpoint,
                                 extra_codex_homes=[Path(p).expanduser() for p in args.codex_home],
                                 log=lambda line: print(line, file=sys.stderr, flush=True))
        write_jsonl(output, sorted(records, key=lambda r: r["issue_ref"]))
        print(json.dumps({"finalized": len(records), "link_stats": stats}, indent=2))
        return 0
    if args.command == "evaluate":
        output = private_path(args.output)
        outcome = run_evaluations(read_jsonl(args.census), output, args.limit, not args.allow_no_zdr,
                                  workers=args.workers, batch_size=args.batch_size)
        print(json.dumps(outcome))
        return 0 if outcome["status"] in ("complete", "limit_reached") else 2
    taxonomy = json.loads(retrospect.DOMAINS.read_text(encoding="utf-8"))
    rows, summary = summarize(read_jsonl(args.census), read_jsonl(args.evaluations),
                              evaluation_signature(taxonomy))
    csv_path, summary_path = private_path(args.csv), private_path(args.summary)
    with csv_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else ["issue_ref"])
        writer.writeheader()
        writer.writerows(rows)
    summary_path.write_text(json.dumps(summary, indent=2, default=dict) + "\n", encoding="utf-8")
    print(json.dumps({"finalized": summary["finalized"], "evaluation_status": summary["evaluation_status"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
