#!/usr/bin/env python3
"""Read recorded Codex usage without summing cumulative snapshots or estimating cost."""
import argparse
import hashlib
import json
from pathlib import Path


COUNTERS = ("input_tokens", "cached_input_tokens", "output_tokens")


def summarize(events):
    snapshots, issues = [], []
    previous = None
    for line, event in events:
        payload = event.get("payload", {})
        if event.get("type") != "event_msg" or payload.get("type") != "token_count":
            continue
        info = payload.get("info")
        if info is None:  # Quota-only updates contain no token measurement.
            continue
        total = info.get("total_token_usage", {})
        if any(type(total.get(k)) is not int or total[k] < 0 for k in COUNTERS):
            issues.append({"line": line, "reason": "invalid cumulative counters"})
            continue
        if total["cached_input_tokens"] > total["input_tokens"]:
            issues.append({"line": line, "reason": "cache exceeds total input"})
            continue
        if previous and any(total[k] < previous[k] for k in COUNTERS):
            issues.append({"line": line, "reason": "counter decreased; reset or inherited stream needs reconciliation"})
        snapshots.append({"source_id": f"L{line}", "counters": {k: total[k] for k in COUNTERS}})
        previous = total
    return {
        "status": "needs_reconciliation" if issues else "recorded_snapshot" if snapshots else "unavailable",
        "scope": "native session cumulative snapshot; not allocated to a task",
        "snapshot_count": len(snapshots),
        "last_snapshot": snapshots[-1] if snapshots else None,
        "issues": issues,
        "cost": None,
        "quota_percent": None,
        "limitations": [
            "Cached input is included in input, not additional usage.",
            "Output may include reasoning; do not add reasoning counters again.",
            "Missing final usage, inherited history, child work and tool charges may be outside these counters.",
            "Elapsed session time includes waits; it is not active worker time.",
            "No currency, quota or task-cost conversion follows from token counts alone.",
        ],
    }


def read(path, expected_sha256=None):
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 and digest != expected_sha256:
        raise ValueError("Native source changed since selection; freeze a new revision")
    events = [(i, json.loads(line)) for i, line in enumerate(raw.splitlines(), 1) if line.strip()]
    result = summarize(events)
    result["source_sha256"] = digest
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-session", type=Path, required=True)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    print(json.dumps(read(args.codex_session, args.expected_sha256), indent=2))
