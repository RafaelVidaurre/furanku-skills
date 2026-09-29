#!/usr/bin/env python3
"""Aggregate reviewed task contributions without model calls or routing writes."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from statistics import median_low

from assessment_outcomes import validate as validate_outcome
from session_extract import refs
from task_retrospect import write_private


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate_record(record, domain_ids):
    for field in ("original_task_id", "family", "project", "model", "effort"):
        if not nonempty(record.get(field)):
            raise ValueError(f"Contribution requires {field}; resolve lineage before pooling")
    if record.get("selection") not in {"baseline", "supplement", "mixed", "unknown"}:
        raise ValueError("Selection stratum must remain explicit")
    sources = refs(record.get("source_ids"), set(record.get("source_ids", [])), "source catalog", True)
    validate_outcome(record.get("task_outcome"), sources, domain_ids)
    attempts = record.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        raise ValueError("Contribution requires native attempts")
    for attempt in attempts:
        digest = attempt.get("source_sha256", "")
        if (not nonempty(attempt.get("session_ref")) or not isinstance(digest, str)
                or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
            raise ValueError("Attempt requires native session and source digest")
        refs(attempt.get("request_ids"), sources, "attempt request anchors", True)
    domains = record.get("domains", [])
    if len(domains) != len(domain_ids) or {d.get("id") for d in domains} != domain_ids:
        raise ValueError("Contribution must classify every domain once")
    for domain in domains:
        if domain.get("role") not in {"central", "supporting", "absent", "unknown"}:
            raise ValueError("Invalid domain role")
        refs(domain.get("source_ids"), sources, "domain evidence", domain.get("score") is not None)
        if not nonempty(domain.get("rationale")):
            raise ValueError("Domain requires a review rationale")
        score = domain.get("score")
        if "score" not in domain or (score is not None and (
                type(score) is not int or score not in range(5)
                or domain["role"] not in {"central", "supporting"})):
            raise ValueError("Score must be null or an involved domain's ordinal 0–4 rating")
    if not isinstance(record.get("repairs"), list):
        raise ValueError("Observed repairs must remain explicit")
    for repair in record["repairs"]:
        refs(repair.get("source_ids"), sources, "repair evidence", True)
        if repair.get("cause") not in {"worker", "external", "mixed", "unknown"}:
            raise ValueError("Repair requires responsibility")
        if not nonempty(repair.get("rationale")):
            raise ValueError("Repair requires rationale")


def burden(record):
    outcome = record["task_outcome"]
    worker_repairs = sum(r["cause"] == "worker" for r in record["repairs"])
    worker_interventions = sum(e["cause"] == "worker" for e in outcome["interventions"])
    return {"worker_repairs_observed": worker_repairs,
            "worker_interventions_observed": worker_interventions,
            "has_worker_correction": bool(worker_repairs or worker_interventions),
            "feedback_coverage": outcome["feedback_coverage"],
            "first_delivery": outcome["first_delivery"]["status"]}


def summarize_cell(entries):
    scores = [d["score"] for r, d in entries if d["score"] is not None]
    original = [d["score"] for r, d in entries if d["score"] is not None
                and r["task_outcome"]["scope_change"] == "unchanged"]
    original_goals = Counter(r["task_outcome"]["original_status"] for r, d in entries)
    n = len(entries)
    passed = sum(s >= 3 for s in scores)
    missing = n - len(scores)
    families = {r["family"] for r, d in entries}
    leave_family_out = []
    for family in sorted(families):
        retained = [d["score"] for r, d in entries if r["family"] != family and d["score"] is not None
                    and r["task_outcome"]["scope_change"] == "unchanged"]
        leave_family_out.append(median_low(retained) if retained else None)
    return {
        "tasks": n, "families": len(families), "projects": len({r["project"] for r, d in entries}),
        "selection_counts": dict(Counter(r["selection"] for r, d in entries)),
        "observed_rating": median_low(original) if original else None,
        "rating_basis": "Lower median of audited final scores on unchanged task scope; ordinal, not an expected utility",
        "rating_tasks": len(original), "final_scope_histogram": dict(sorted(Counter(scores).items())),
        "original_scope_histogram": dict(sorted(Counter(original).items())),
        "narrowed_or_other_scope_scored_tasks": len(scores) - len(original),
        "unscored_tasks": missing,
        "original_goal_counts": dict(original_goals),
        "task_completion_unknown_bounds": ([original_goals["met"] / n,
                (original_goals["met"] + original_goals["unknown"]) / n] if n else None),
        "final_criteria_unknown_bounds": ([passed / n, (passed + missing) / n] if n else None),
        "bounds_meaning": "Best/worst completion of unknown observations IN THIS SELECTED SAMPLE; not a population confidence interval",
        "tasks_with_observed_worker_correction": sum(burden(r)["has_worker_correction"] for r, d in entries),
        "burden_scope": "Whole task; not attributed to this domain unless the cited event says so. Do not sum across domains.",
        "feedback_coverage": dict(Counter(r["task_outcome"]["feedback_coverage"] for r, d in entries)),
        "first_delivery_counts": dict(Counter(r["task_outcome"]["first_delivery"]["status"] for r, d in entries)),
        "leave_one_family_out_ratings": leave_family_out,
        "evidence_level": ("unrated" if not original else "examples_only" if len(original) < 5
                           else "early_signal" if len(original) < 10 else "requires_comparison_validation"),
        "confidence": "not_calibrated", "routing_eligible": False,
        "value_rating": None, "value_reason": "Matched difficulty, attributable total cost and fresh comparison validation are not established",
    }


def aggregate(document, candidates, taxonomy):
    if document.get("version") != 1 or not isinstance(document.get("contributions"), list):
        raise ValueError("Expected reviewed evidence version 1 with contributions")
    domain_ids = {d["id"] for d in taxonomy}
    records, exclusions, seen, anchors = [], [], set(), set()
    for record in document["contributions"]:
        pair = (record.get("model"), record.get("effort"))
        if pair not in candidates:
            exclusions.append({"task": record.get("original_task_id"), "reason": "model_effort_not_configured"})
            continue
        if record.get("review_status") != "source_reviewed":
            exclusions.append({"task": record.get("original_task_id"), "reason": "not_source_reviewed"})
            continue
        validate_record(record, domain_ids)
        key = (record["original_task_id"], *pair)
        if key in seen:
            raise ValueError("Duplicate original task/model contribution; select one reviewed revision")
        seen.add(key)
        for attempt in record["attempts"]:
            for request in attempt["request_ids"]:
                anchor = (attempt["session_ref"], request, *pair)
                if anchor in anchors:
                    raise ValueError("Overlapping native task anchors; reconcile continuations/revisions before pooling")
                anchors.add(anchor)
        records.append(record)
    cells = []
    for model, effort in sorted(candidates):
        for domain in taxonomy:
            matching = [(r, d) for r in records if (r["model"], r["effort"]) == (model, effort)
                        for d in r["domains"] if d["id"] == domain["id"]]
            entries = [(r, d) for r, d in matching if d["role"] in {"central", "supporting"}]
            cells.append({"model": model, "effort": effort, "domain": domain["id"],
                          "domain_name": domain["name"],
                          "role_counts": dict(Counter(d["role"] for r, d in matching)),
                          **summarize_cell(entries)})
    return {"version": 1, "status": "provisional_descriptive_ratings", "routing_eligible": False,
            "original_tasks": len({r["original_task_id"] for r in records}), "contributions": len(records),
            "sessions": len({a["session_ref"] for r in records for a in r["attempts"]}),
            "exclusions": exclusions, "cells": cells,
            "task_burden": [{"original_task_id": r["original_task_id"], "model": r["model"],
                             "effort": r["effort"], **burden(r)} for r in records],
            "limitations": ["Purposeful sampling and correlated projects prevent population-confidence claims.",
                            "A narrowed handoff can have good final quality while its original task remains incomplete.",
                            "No observed repair is not proof of no mistakes; feedback coverage is retained.",
                            "Ordinal medians are descriptive; scores and repairs are not converted into an invented cost."]}


def markdown(result):
    lines = ["# Provisional model/effort domain ratings", "",
             f"{result['original_tasks']} original tasks; {result['sessions']} sessions. No learned routing changes.", "",
             "Grade = lower median of observed final quality on unchanged task scope. 3 meets criteria; 2 has a minor defect.",
             "All ratings are uncalibrated examples. Narrowed handoffs are excluded from the headline grade.", "",
             "| Model / effort | Domain | Observed grade | Rated / involved tasks | Original task: met / partial / not met / unknown | Tasks with observed correction |",
             "| --- | --- | --- | --- | --- | --- |"]
    for cell in result["cells"]:
        if not cell["tasks"]:
            continue
        goal = cell["original_goal_counts"]
        counts = " / ".join(str(goal.get(k, 0)) for k in ("met", "partial", "not_met", "unknown"))
        grade = str(cell["observed_rating"]) if cell["observed_rating"] is not None else "Unrated"
        lines.append(f"| {cell['model']} / {cell['effort']} | {cell['domain_name']} | {grade} | "
                     f"{cell['rating_tasks']} / {cell['tasks']} | {counts} | {cell['tasks_with_observed_worker_correction']} |")
    lines.extend(["", "Correction counts refer to whole tasks and overlap between domain rows. Counts are not domain-specific error rates.",
                  "Unobserved combinations remain unrated in the JSON, which includes every configured combination and domain.",
                  "Unknown-outcome bounds in JSON describe this selected sample only, not a confidence interval or future success probability.",
                  "", *["- " + text for text in result["limitations"]], ""])
    return "\n".join(lines)


def load_reviewed(path):
    path = Path(path)
    raw = path.read_bytes()
    document = json.loads(raw)
    reviewed_files = document.get("reviewed_files")
    if not isinstance(reviewed_files, list) or not reviewed_files:
        raise ValueError("Input requires hashed reviewed_files provenance")
    for source in reviewed_files:
        source_path = Path(source["path"])
        if not source_path.is_absolute():
            source_path = path.parent / source_path
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError("A reviewed input changed; choose an explicit new review revision")
    return document, hashlib.sha256(raw).hexdigest()


def save_report(path, result):
    """Reuse identical output; recover a missing companion without overwriting evidence."""
    path = Path(path)
    outputs = {path: json.dumps(result, indent=2) + "\n", path.with_suffix(".md"): markdown(result)}
    if len(outputs) != 2:
        raise ValueError("JSON report path must differ from its Markdown companion")
    for target, content in outputs.items():
        if target.exists() and target.read_text() != content:
            raise ValueError("Existing report differs; use a new output revision")
    missing = [(target, content) for target, content in outputs.items() if not target.exists()]
    for target, content in missing:
        write_private(target, content)
    return not missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args()
    import config
    from performance_census import route_index
    if args.input.resolve() in {args.output.resolve(), args.output.with_suffix(".md").resolve()}:
        raise ValueError("Rating outputs must differ from reviewed input")
    document, digest = load_reviewed(args.input)
    taxonomy = json.loads((Path(__file__).parent.parent / "references/retrospective-domains.json").read_text())
    result = aggregate(document, set(route_index(config.model_rows(args.repo))), taxonomy["domains"])
    result["input_sha256"] = digest
    reused = save_report(args.output, result)
    print(json.dumps({**{k: result[k] for k in ("status", "original_tasks", "contributions", "sessions")},
                      "reused_report": reused}))


if __name__ == "__main__":
    main()
