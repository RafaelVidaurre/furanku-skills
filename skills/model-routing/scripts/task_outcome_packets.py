#!/usr/bin/env python3
"""Build private task evidence packets for proved Orca worker links.

These links are a routing-policy audit subset, not the historical performance
census. A packet preserves source provenance; it never assigns quality.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import stat

import linked_coverage
import performance_assess
import resolve_orca_links
import retrospect
import routing_log


def _by_session(inventory):
    found = defaultdict(list)
    for row in inventory:
        session_id = linked_coverage.agent_session_id(row)
        if session_id:
            found[session_id].append(row)
    return found


def _parent_context(path, provider, dispatch):
    """Return nearby channel messages, without asserting that they are feedback."""
    if provider not in ("codex", "claude"):
        return [], "unsupported_parent_provider"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return [], "parent_unreadable"
    anchors = [i for i, line in enumerate(lines) if dispatch in line]
    if not anchors:
        return [], "dispatch_absent_from_parent"
    messages = []
    for line in lines[anchors[0] + 1:]:
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if provider == "codex":
            payload = item.get("payload") or {}
            if item.get("type") != "response_item" or payload.get("type") != "message" or payload.get("role") != "user":
                continue
            content = payload.get("content")
        else:
            if item.get("type") != "user" or item.get("sourceToolUseID"):
                continue
            content = (item.get("message") or {}).get("content")
        message = retrospect.clean_user(retrospect.text_content(content))
        if message:
            messages.append(retrospect.redact_sensitive(message[:1200]))
        if len(messages) == 6:
            break
    return messages, "context_only" if messages else "no_later_channel_message"


def build(events, inventory, proofs):
    decisions = {row["request_id"]: row for row in events
                 if row.get("msg") == "routing decision" and row.get("routing.status") in ("selected", "exact")}
    by_session = _by_session(inventory)
    shared_decisions = Counter(proof.get("decision_id") for proof in proofs if proof.get("status") == "proved")
    shared_workers = Counter(proof.get("session_id") for proof in proofs if proof.get("status") == "proved")
    packets = []
    for proof in proofs:
        if proof.get("status") != "proved":
            continue
        decision = decisions.get(proof.get("decision_id"))
        worker_matches = by_session.get(proof.get("session_id"), [])
        packet = {"decision_id": proof.get("decision_id"), "dispatch": proof.get("dispatch"),
                  "dispatch_status": proof.get("dispatch_status"), "worker_state": proof.get("worker_state"),
                  "quality": None, "evidence_status": "unresolved"}
        if shared_decisions[proof.get("decision_id")] != 1 or shared_workers[proof.get("session_id")] != 1:
            packet["evidence_status"] = "shared_decision_or_worker"
            packets.append(packet)
            continue
        if not decision or len(worker_matches) != 1:
            packet["evidence_status"] = "decision_or_worker_unresolved"
            packets.append(packet)
            continue
        worker = worker_matches[0]
        source = Path(worker["path"])
        expected = (decision.get("routing.model"), decision.get("routing.effort"))
        actual = {(entry.get("model"), entry.get("effort")) for entry in worker.get("models", [])}
        context_variant = (isinstance(expected[0], str) and expected[0].endswith("[1m]")
                           and (expected[0][:-4], expected[1]) in actual)
        if (worker.get("error") or worker.get("mixed") or worker.get("provider") != decision.get("routing.agent")
                or expected not in actual or not source.is_file() or source.is_symlink()
                or proof.get("session_id") == decision.get("session.parent")):
            packet["evidence_status"] = ("context_variant_unverified" if context_variant
                                         and not worker.get("error") and not worker.get("mixed")
                                         and worker.get("provider") == decision.get("routing.agent")
                                         and source.is_file() and not source.is_symlink()
                                         else "worker_attribution_unverified")
            packets.append(packet)
            continue
        packet["route"] = {"agent": worker["provider"], "model": expected[0], "effort": expected[1]}
        packet["worker_source"] = str(source)
        packet["worker_source_key"] = retrospect.source_key(source, worker["provider"])
        try:
            state = retrospect.session_state(source, worker["provider"])
            packet["worker_turns"] = state["turns"]
            packet["worker_omitted_turns"] = state["omitted_turns"]
            packet["worker_checks"] = performance_assess.tool_check_evidence(source, worker["provider"], None)
            opening = resolve_orca_links.initial_user_messages(source, worker["provider"])
            packet["task_contract"] = next((retrospect.redact_sensitive(retrospect.clean_user(message))
                                            for message in opening if proof["dispatch"] in message), None)
        except (OSError, UnicodeError, ValueError, TypeError, KeyError):
            packet["evidence_status"] = "worker_projection_error"
            packets.append(packet)
            continue
        if packet["task_contract"] is None:
            packet["evidence_status"] = "task_contract_missing"
            packets.append(packet)
            continue
        packet["task_family"] = retrospect.task_family_from_request(packet["task_contract"])
        parent_matches = by_session.get(decision.get("session.parent"), [])
        if len(parent_matches) == 1 and not parent_matches[0].get("error"):
            parent = parent_matches[0]
            parent_path = Path(parent["path"])
            packet["parent_source"] = str(parent_path)
            packet["parent_source_key"] = retrospect.source_key(parent_path, parent["provider"])
            packet["parent_post_dispatch_messages_unverified"], packet["parent_context_status"] = (
                _parent_context(parent_path, parent["provider"], proof["dispatch"]))
        else:
            packet["parent_context_status"] = "parent_session_unresolved"
        packet["evidence_status"] = ("worker_incomplete" if proof.get("dispatch_status") != "completed"
                                     or proof.get("worker_state") != "succeeded" else "packet_ready_for_outcome_review")
        packets.append(packet)
    return packets, dict(Counter(packet["evidence_status"] for packet in packets))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--orca-proofs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    private = retrospect.PRIVATE_ROOT
    if private.is_symlink():
        parser.error("Private retrospective directory must not be a symlink")
    for path in (args.inventory, args.orca_proofs, args.output):
        if path.parent != private or path.is_symlink():
            parser.error(f"Inputs and output must be regular files directly inside {private}")
    for path in (args.inventory, args.orca_proofs):
        if not path.is_file() or not stat.S_ISREG(path.stat().st_mode):
            parser.error(f"Missing regular input: {path.name}")
    try:
        inventory = [json.loads(line) for line in args.inventory.open(encoding="utf-8")]
        proofs = json.loads(args.orca_proofs.read_text(encoding="utf-8"))["results"]
        events = routing_log.retrospective_events()
        packets, counts = build(events, inventory, proofs)
    except (OSError, UnicodeError, ValueError, KeyError, routing_log.Error) as exc:
        parser.error(f"Cannot build task evidence packets: {exc}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(args.output, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump({"status": "unscored_evidence_packets", "counts": counts, "packets": packets}, stream)
        stream.write("\n")
    print(json.dumps({"packets": len(packets), "counts": counts}))


if __name__ == "__main__":
    main()
