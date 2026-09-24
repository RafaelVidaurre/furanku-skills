#!/usr/bin/env python3
"""Resolve Orca dispatch links to agent sessions using the public Orca CLI.

Only a worker's own initial dispatch preamble proves a session link. Search hits
and terminal metadata are discovery evidence, not a substitute for that proof.
"""

from __future__ import annotations

import argparse
from collections import defaultdict, Counter
import json
import os
from pathlib import Path
import re
import stat
import subprocess

import linked_coverage
import history_inventory
import retrospect
import routing_log


class OrcaError(Exception):
    pass


def orca(command, *args):
    try:
        run = subprocess.run([command, *args, "--json"], capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired as exc:
        raise OrcaError(f"Orca {args[0]} timed out after 30 seconds") from exc
    if run.returncode:
        raise OrcaError(f"Orca {args[0]} failed (exit {run.returncode}): {run.stderr.strip()[:300]}")
    try:
        answer = json.loads(run.stdout)
    except json.JSONDecodeError as exc:
        raise OrcaError(f"Orca {args[0]} returned invalid JSON") from exc
    if not isinstance(answer, dict) or not answer.get("ok"):
        error = answer.get("error") if isinstance(answer, dict) else answer
        raise OrcaError(f"Orca {args[0]} returned an error: {str(error)[:300]}")
    result = answer.get("result")
    if not isinstance(result, dict):
        raise OrcaError(f"Orca {args[0]} returned no result object")
    return result


def initial_user_messages(path, provider):
    messages = []
    with path.open(encoding="utf-8") as stream:
        for position, line in enumerate(stream):
            if position >= 500:
                break
            if not line.strip():
                continue
            item = json.loads(line)
            if provider == "codex":
                payload = item.get("payload") or {}
                if item.get("type") == "response_item" and payload.get("type") == "message":
                    if payload.get("role") == "user":
                        messages.append(retrospect.text_content(payload.get("content")))
                    elif payload.get("role") == "assistant":
                        break
            elif provider == "claude":
                if item.get("type") == "user":
                    messages.append(retrospect.text_content((item.get("message") or {}).get("content")))
                elif item.get("type") == "assistant":
                    break
    return messages


def opening_dispatches(inventory, dispatches):
    """Index only initial task preambles, so incomplete Orca search cannot imply uniqueness."""
    openings = defaultdict(list)
    for row in inventory:
        if not isinstance(row, dict):
            raise OrcaError("Inventory contains a malformed row; regenerate it")
        if row.get("provider") not in ("codex", "claude"):
            continue
        if not isinstance(row.get("path"), str):
            raise OrcaError("Inventory session has no source path; regenerate it")
        if row.get("error"):
            raise OrcaError("Inventory contains an unreadable agent session; repair or regenerate it")
        session_id = linked_coverage.agent_session_id(row)
        if not session_id:
            continue
        seen_files = set()
        for source in row.get("copies") or [row["path"]]:
            path = Path(source)
            try:
                identity = path.stat()
            except OSError as exc:
                raise OrcaError("Inventory refers to a missing or moved session; regenerate it") from exc
            key = (identity.st_dev, identity.st_ino)
            if key in seen_files:
                continue
            seen_files.add(key)
            try:
                messages = initial_user_messages(path, row["provider"])
            except (OSError, UnicodeError, ValueError, TypeError) as exc:
                raise OrcaError("Inventory session changed or is unreadable; regenerate it") from exc
            for message in messages:
                if "ctx_" in message:
                    for dispatch in dispatches:
                        if re.search(rf"(?<![A-Za-z0-9_]){re.escape(dispatch)}(?![A-Za-z0-9_])", message):
                            openings[dispatch].append((session_id, message))
    return openings


def prove_candidate(hit, row, decision, dispatch, task, terminal, worktree):
    if not row or hit.get("sessionId") != linked_coverage.agent_session_id(row):
        return False
    if hit.get("agent") != decision.get("routing.agent") or row.get("provider") != hit.get("agent"):
        return False
    if hit.get("sessionId") == decision.get("session.parent") or hit.get("cwd") != worktree:
        return False
    source = (hit.get("source") or {}).get("filePath")
    if not isinstance(source, str):
        return False
    path = Path(source)
    if not path.is_file() or linked_coverage.agent_session_id({"provider": row["provider"], "path": source}) != hit.get("sessionId"):
        return False
    source_row = history_inventory.summarize(path, row["provider"])
    if source_row.get("error"):
        return False
    expected = (decision.get("routing.model"), decision.get("routing.effort"))
    actual = {(m["model"], m["effort"]) for m in source_row.get("models", [])}
    base_variant = expected[0][:-4] if expected[0] and expected[0].endswith("[1m]") else None
    if expected not in actual and (base_variant, expected[1]) not in actual:
        return False
    return any(all(token in message for token in (dispatch, task, terminal))
               for message in initial_user_messages(path, row["provider"]))


def resolve(events, inventory, command):
    by_id = defaultdict(list)
    for row in inventory:
        session_id = linked_coverage.agent_session_id(row)
        if session_id:
            by_id[session_id].append(row)
    decisions = {row["request_id"]: row for row in events
                 if row.get("msg") == "routing decision" and row.get("routing.status") in ("selected", "exact")}
    links = defaultdict(list)
    for row in events:
        if row.get("msg") == "routing worker linked":
            links[row["request_id"]].append(row["session.worker"])
    index = orca(command, "search", "--index-status")
    if not index.get("enabled"):
        raise OrcaError("Orca Agent Session History is disabled")
    dispatch_ids = {ref.removeprefix("orca:dispatch:") for refs in links.values() for ref in refs
                    if isinstance(ref, str) and (ref.startswith("ctx_") or ref.startswith("orca:dispatch:ctx_"))}
    openings = opening_dispatches(inventory, dispatch_ids)
    results = []
    for decision_id, decision in decisions.items():
        refs = links.get(decision_id, [])
        dispatches = list(dict.fromkeys(
            ref.removeprefix("orca:dispatch:") for ref in refs
            if isinstance(ref, str) and (ref.startswith("ctx_") or ref.startswith("orca:dispatch:ctx_"))))
        for dispatch in dispatches:
            result = {"decision_id": decision_id, "dispatch": dispatch, "status": "unresolved"}
            try:
                shown = orca(command, "orchestration", "worker-show", "--dispatch", dispatch)
                worker = shown.get("worker") or {}
                assigned = shown.get("dispatch") or {}
                result["dispatch_status"] = assigned.get("status")
                result["worker_state"] = worker.get("state")
                terminal = worker.get("agentTerminalHandle") or assigned.get("assigneeHandle")
                worktree_id = worker.get("worktreeId")
                task = assigned.get("taskId")
                worktree = worktree_id.split("::", 1)[-1] if isinstance(worktree_id, str) else None
                effective = (((worker.get("startOptions") or {}).get("launch") or {}).get("effective") or {})
                model = decision.get("routing.model")
                equivalent = model[:-4] if model and model.endswith("[1m]") else model
                if not isinstance(effective, dict):
                    effective = {}
                launch_complete = all(effective.get(key) is not None for key in ("agent", "model", "effort"))
                result["launch_verification"] = "known" if launch_complete else "unknown"
                if launch_complete and (
                                  effective.get("agent") != decision.get("routing.agent") or
                                  effective.get("model") not in (model, equivalent) or
                                  effective.get("effort") != decision.get("routing.effort")):
                    result["status"] = "launch_mismatch"
                elif not all((terminal, worktree, task)):
                    result["status"] = "missing_dispatch_identity"
                else:
                    opening_ids = {session_id for session_id, message in openings.get(dispatch, [])
                                   if task in message and terminal in message}
                    if len(opening_ids) > 1:
                        result["status"] = "ambiguous_opening_preamble"
                        results.append(result)
                        continue
                    if not opening_ids:
                        result["status"] = "opening_preamble_missing"
                        results.append(result)
                        continue
                    search = orca(command, "search", terminal, "--limit", "100")
                    if (search.get("page") or {}).get("hasMore") or (search.get("truncated") or {}).get("candidates"):
                        result["status"] = "search_truncated"
                    else:
                        candidates = []
                        missing_inventory = False
                        duplicate_inventory = False
                        for hit in search.get("hits", []):
                            matches = by_id.get(hit.get("sessionId"), [])
                            if hit.get("sessionId") not in opening_ids:
                                continue
                            if not matches:
                                missing_inventory = True
                            elif len(matches) > 1:
                                duplicate_inventory = True
                            elif prove_candidate(hit, matches[0], decision, dispatch, task, terminal, worktree):
                                candidates.append(hit["sessionId"])
                        candidates = list(dict.fromkeys(candidates))
                        if len(candidates) == 1:
                            result.update(status="proved", session_id=candidates[0])
                        elif len(candidates) > 1:
                            result["status"] = "ambiguous_sessions"
                        elif duplicate_inventory:
                            result["status"] = "duplicate_inventory"
                        elif missing_inventory:
                            result["status"] = "hit_not_in_inventory"
            except (OrcaError, OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError,
                    json.JSONDecodeError) as exc:
                result.update(status="error", error=str(exc)[:300])
            results.append(result)
    return results, index.get("phase")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--orca-command", required=True, help="Executable selected by the orca-cli skill")
    parser.add_argument("--link", action="store_true", help="Append proved agent session IDs to the routing journal")
    args = parser.parse_args()
    private = retrospect.PRIVATE_ROOT
    if (args.inventory.parent != private or args.output.parent != private or args.inventory.is_symlink() or
            args.output.is_symlink() or private.is_symlink()):
        parser.error(f"Inventory and output must be new regular files directly inside {private}")
    if not args.inventory.is_file() or not stat.S_ISREG(args.inventory.stat().st_mode):
        parser.error("Inventory must be a regular file")
    if not args.orca_command:
        parser.error("Orca command is empty")
    if args.link:
        try:
            log_enabled = routing_log.enabled()
        except (routing_log.Error, OSError, ValueError) as exc:
            parser.error(f"Cannot read routing-journal setting: {exc}")
        if not log_enabled:
            parser.error("Routing journal is disabled; rerun without --link for a read-only report")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(args.output, flags, 0o600)
    except OSError as exc:
        parser.error(f"Cannot reserve output: {exc}")
    try:
        inventory = [json.loads(line) for line in args.inventory.open(encoding="utf-8")]
        events = routing_log.retrospective_events()
        already_linked = defaultdict(set)
        for event in events:
            if event.get("msg") == "routing worker linked":
                already_linked[event["request_id"]].add(event["session.worker"])
        results, phase = resolve(events, inventory, args.orca_command)
        if args.link:
            for row in results:
                if row["status"] == "proved":
                    if row["session_id"] in already_linked[row["decision_id"]]:
                        row["already_linked"] = True
                    else:
                        try:
                            row["linked"] = routing_log.link(row["decision_id"], row["session_id"])
                        except (routing_log.Error, OSError) as exc:
                            row["link_error"] = str(exc)[:300]
    except (routing_log.Error, OrcaError, OSError, UnicodeError, ValueError, TypeError, KeyError,
            AttributeError, json.JSONDecodeError) as exc:
        os.close(fd)
        args.output.unlink(missing_ok=True)
        parser.error(str(exc))
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump({"index_phase": phase, "results": results}, stream)
        stream.write("\n")
    print(json.dumps({"index_phase": phase, "counts": dict(Counter(row["status"] for row in results)),
                      "links_written": sum(row.get("linked", False) for row in results),
                      "link_errors": sum(bool(row.get("link_error")) for row in results)}))
    return 1 if any(row.get("link_error") for row in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
