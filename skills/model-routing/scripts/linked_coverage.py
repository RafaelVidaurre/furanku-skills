#!/usr/bin/env python3
"""Audit which routed worker links resolve to locally recorded agent sessions.

This is a metadata check, not an outcome score. Detailed results remain private.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import json
import os
from pathlib import Path
import re
import stat

import retrospect
import routing_log


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def agent_session_id(row):
    path = Path(row["path"])
    provider = row["provider"]
    if provider == "codex":
        match = UUID.search(path.stem)
        return match.group() if match else None
    if provider == "claude":
        return path.stem if UUID.fullmatch(path.stem) else None
    if provider == "grok":
        value = path.parent.name if path.name == "summary.json" else path.name
        return value if UUID.fullmatch(value) else None
    return None


def utc_time(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def analyze(events, inventory, orca_proofs=()):
    decisions = {row["request_id"]: row for row in events
                 if row.get("msg") == "routing decision" and row.get("routing.status") in ("selected", "exact")}
    links = defaultdict(list)
    for row in events:
        if row.get("msg") == "routing worker linked":
            links[row["request_id"]].append(row["session.worker"])
    by_session = defaultdict(list)
    for row in inventory:
        session = agent_session_id(row)
        if session:
            by_session[session].append(row)
    proof_by_decision = defaultdict(list)
    for proof in orca_proofs:
        proof_by_decision[proof["decision_id"]].append(proof)
    results = []
    for decision_id, decision in decisions.items():
        refs = links.get(decision_id, [])
        unique_refs = list(dict.fromkeys(refs))
        matched_refs = [ref for ref in unique_refs if ref in by_session]
        chosen_ref = matched_refs[0] if len(matched_refs) == 1 else unique_refs[0] if len(unique_refs) == 1 else None
        status = "unlinked"
        source = None
        if refs and chosen_ref is None:
            status = "ambiguous_links"
        elif chosen_ref:
            ref = chosen_ref
            matches = by_session.get(ref, [])
            if len(matches) != 1:
                status = "unresolved_reference" if not matches else "ambiguous_sessions"
            else:
                row = matches[0]
                source = row["path"]
                actual = {(m["model"], m["effort"]) for m in row["models"]}
                expected = (decision.get("routing.model"), decision.get("routing.effort"))
                decision_time = utc_time(decision.get("ts"))
                last_event_time = utc_time(row.get("last_event_at"))
                if not Path(source).is_file():
                    status = "source_missing"
                elif row.get("error"):
                    status = "damaged_source"
                elif row["provider"] != decision.get("routing.agent"):
                    status = "agent_mismatch"
                elif ref == decision.get("session.parent"):
                    status = "parent_session_link"
                elif row["mixed"]:
                    status = "mixed_model"
                elif not row["user_messages"] or not row["assistant_messages"]:
                    status = "no_exchange"
                elif expected not in actual and expected[0] and expected[0].endswith("[1m]") and \
                        (expected[0][:-4], expected[1]) in actual:
                    status = "context_variant_unverified"
                elif expected not in actual:
                    status = "model_mismatch"
                elif decision_time is None or last_event_time is None:
                    status = "time_unverified"
                elif last_event_time < decision_time:
                    status = "session_ended_before_decision"
                else:
                    status = "transcript_found"
        proofs = proof_by_decision.get(decision_id, [])
        proof = proofs[0] if len(proofs) == 1 else None
        dispatch_status = proof.get("dispatch_status") if proof else None
        worker_state = proof.get("worker_state") if proof else None
        has_orca_dispatch = any(ref.startswith("ctx_") or ref.startswith("orca:dispatch:ctx_") for ref in refs)
        if status in ("transcript_found", "context_variant_unverified") and (proofs or has_orca_dispatch):
            if (proof is None or proof.get("status") != "proved" or proof.get("session_id") != chosen_ref):
                status = "dispatch_unverified"
            elif dispatch_status != "completed" or worker_state != "succeeded":
                status = "dispatch_incomplete"
        results.append({"decision_id": decision_id, "status": status,
                        "agent": decision.get("routing.agent"),
                        "model": decision.get("routing.model"),
                        "effort": decision.get("routing.effort"),
                        "route_status": decision.get("routing.status"),
                        "worker_ref": chosen_ref,
                        "dispatch_status": dispatch_status, "worker_state": worker_state,
                        "source": source})
    by_worker = defaultdict(list)
    for row in results:
        if row["worker_ref"] and row["source"]:
            by_worker[row["worker_ref"]].append(row)
    for shared in by_worker.values():
        if len(shared) > 1:
            for row in shared:
                row["shared_session"] = True
                if row["status"] in ("transcript_found", "context_variant_unverified"):
                    row["status"] = "shared_session"
    counts = Counter(row["status"] for row in results)
    orphan_links = sum(len(refs) for decision_id, refs in links.items() if decision_id not in decisions)
    if orphan_links:
        counts["links_without_routable_decision"] = orphan_links
    return results, dict(counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--orca-proofs", type=Path,
                        help="Private resolver output; dispatch state gates outcome assessment")
    args = parser.parse_args()
    private = retrospect.PRIVATE_ROOT
    if args.inventory.parent != private or args.output.parent != private or (args.orca_proofs and args.orca_proofs.parent != private):
        parser.error(f"Inventory and output must be directly inside {private}")
    if args.inventory.is_symlink() or args.output.is_symlink() or private.is_symlink() or (args.orca_proofs and args.orca_proofs.is_symlink()):
        parser.error("Private retrospective files must not be symlinks")
    if not args.inventory.is_file() or not stat.S_ISREG(args.inventory.stat().st_mode):
        parser.error("Inventory must be a regular file")
    try:
        inventory = [json.loads(line) for line in args.inventory.open(encoding="utf-8")]
        events = routing_log.retrospective_events()
        proofs = json.loads(args.orca_proofs.read_text(encoding="utf-8"))["results"] if args.orca_proofs else []
    except (routing_log.Error, OSError, UnicodeError, ValueError) as exc:
        parser.error(f"Cannot read retrospective inputs: {exc}")
    results, counts = analyze(events, inventory, proofs)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(args.output, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump({"status": "complete_retained_window",
                   "events_read": len(events), "counts": counts, "decisions": results}, stream)
        stream.write("\n")
    print(json.dumps({"status": "complete_retained_window",
                      "events_read": len(events), "routable_decisions": len(results), "counts": counts}))


if __name__ == "__main__":
    main()
