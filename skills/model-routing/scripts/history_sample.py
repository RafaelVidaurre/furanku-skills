#!/usr/bin/env python3
"""Plan bounded retrospective sampling from a local inventory; never call models."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import random

import config
from history_inventory import session_key
from performance_census import route_index
from task_retrospect import write_private


def plan(rows, routes, seed, per_model=12, maximum=60, preview_factor=3):
    if min(per_model, maximum, preview_factor) < 1:
        raise ValueError("Sample limits must be positive")
    groups, excluded, seen = defaultdict(list), [], set()
    for row in rows:
        identity = row["session_ref"]
        if identity in seen:
            raise ValueError("Inventory must contain unique native session identities")
        seen.add(identity)
        matches = {(m["model"], m["effort"]) for m in row["models"]} & set(routes)
        reason = ("model_effort_not_configured" if not matches else
                  "inventory_error" if row.get("error") else
                  "no_exchange" if not row["user_messages"] or not row["assistant_messages"] else
                  "mixed_actor_requires_attribution" if row.get("mixed") or len(matches) != 1 else None)
        if reason:
            excluded.append({"session_ref": identity, "reason": reason})
            continue
        model, effort = next(iter(matches))
        groups[(model, effort)].append({
            "session_ref": identity, "path": row["path"], "provider": row["provider"],
            "model": model, "effort": effort, "first_event_at": row.get("first_event_at"),
            "last_event_at": row.get("last_event_at"), "user_messages": row["user_messages"],
            "assistant_messages": row["assistant_messages"],
            "context_variant_unverified": any(r["context_variant_unverified"] for r in routes[(model, effort)]),
        })
    # Allocate a small-model floor before giving common models extra slots.
    quotas = {key: 0 for key in groups}
    for _ in range(per_model):
        for key in sorted(groups):
            if sum(quotas.values()) >= maximum:
                break
            if quotas[key] < len(groups[key]):
                quotas[key] += 1
    strata, baseline, previews = [], [], []
    for key in sorted(groups):
        population = sorted(groups[key], key=lambda r: r["session_ref"])
        # Each stratum has its own seed: adding another model does not reshuffle it.
        derived = hashlib.sha256(json.dumps([seed, key]).encode()).hexdigest()
        random.Random(derived).shuffle(population)
        target = quotas[key]
        random_n = (target + 1) // 2
        preview_n = min(len(population), target * preview_factor)
        strata.append({"model": key[0], "effort": key[1], "population": len(population),
                       "assessment_slots": target, "baseline_slots": random_n,
                       "enrichment_slots": target - random_n, "preview_count": preview_n,
                       "baseline_inclusion_probability": random_n / len(population)})
        for rank, item in enumerate(population[:preview_n], 1):
            card = {**item, "rank": rank, "selection": "baseline" if rank <= random_n else "enrichment_candidate"}
            previews.append(card)
            if rank <= random_n:
                baseline.append(card)
    return {"version": 1, "seed": seed, "status": "preview_plan_only",
            "limits": {"per_model": per_model, "maximum_sessions": maximum, "preview_factor": preview_factor},
            "population": len(rows), "eligible_single_actor_sessions": sum(map(len, groups.values())),
            "assessment_slots": sum(quotas.values()), "baseline": baseline,
            "preview_candidates": previews, "strata": strata, "excluded": excluded,
            "excluded_counts": dict(Counter(e["reason"] for e in excluded)),
            "pending": ["readable_request_and_actor_ownership_check", "bounded_preview_domain_classification",
                        "enrichment_selection", "evidence_packet_budget_check"],
            "cost": "No model calls. Limits count sessions and previews, not actual billed tokens."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", required=True)
    parser.add_argument("--per-model", type=int, default=12)
    parser.add_argument("--maximum", type=int, default=60)
    parser.add_argument("--preview-factor", type=int, default=3)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.inventory.read_text().splitlines() if line.strip()]
    for row in rows:
        provider, native = session_key(Path(row["path"]), row["provider"])
        row["session_ref"] = provider + ":" + native
    result = plan(rows, route_index(config.model_rows(args.repo)), args.seed,
                  args.per_model, args.maximum, args.preview_factor)
    result["inventory_sha256"] = hashlib.sha256(args.inventory.read_bytes()).hexdigest()
    write_private(args.output, json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("status", "assessment_slots", "strata", "excluded_counts")}, indent=2))


if __name__ == "__main__":
    main()
