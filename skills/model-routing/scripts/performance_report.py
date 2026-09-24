#!/usr/bin/env python3
"""Report private Jev first-outcome estimates with coverage and uncertainty."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import json
import os
from pathlib import Path
import random
import re

import retrospect
from performance_assess import RUBRIC


EVIDENCE_WEIGHT = {"direct_feedback": 1.0, "independent_check": 1.0,
                   "visible_output": 0.5}
SENSORY_DOMAINS = {"ui_visual", "visual_art", "spatial_3d", "animation", "audio"}


def check_supports_quality(check, quality):
    if check.get("test_invocation") is not True or not check.get("summary"):
        return False
    code = check.get("exit_code")
    if type(code) is not int:
        return False
    if quality in ("0", "1", "2"):
        return code != 0
    if code != 0:
        return False
    summary = "\n".join(check["summary"]).lower()
    if "failed" in summary or "failure" in summary:
        return False
    for match in re.finditer(r"\b(\d+)\s*/\s*(\d+)\s+passed\b", summary):
        if int(match.group(1)) < int(match.group(2)):
            return False
    return "passed" in summary or "test result: ok" in summary or "build succeeded" in summary


def latest_results(rows):
    by_key = {}
    for row in rows:
        by_key[row["source_key"]] = row
    return list(by_key.values())


def observation(result):
    if result.get("error"):
        return None, result["error"]
    if result.get("rubric") != RUBRIC:
        return None, "older_rubric"
    if result.get("delegated_work") is not False:
        return None, "delegated_or_unchecked"
    domain = result["effective_domain"]
    quality = result["effective_quality"]
    evidence = result["evidence"]["choice"]
    cause = result["cause"]["choice"]
    if domain == "unresolved":
        return None, "unresolved_domain"
    if quality in ("unknown", "unverified"):
        return None, quality
    if evidence not in EVIDENCE_WEIGHT:
        return None, "quality_evidence_missing"
    if quality in ("0", "1", "2") and cause != "model_domain_defect":
        return None, "failure_cause_not_model_domain"
    if quality in ("3", "4") and cause != "no_problem_visible":
        return None, "quality_cause_conflict"
    if evidence == "independent_check" and not any(
            check_supports_quality(check, quality)
            for check in result.get("tool_evidence", [])):
        return None, "independent_check_unconfirmed"
    if domain in SENSORY_DOMAINS and evidence != "direct_feedback":
        return None, "sensory_artifact_unseen"
    return {
        "source_key": result["source_key"], "model": result["model"],
        "effort": result["effort"], "domain": domain,
        "score": int(quality), "evidence": evidence,
        "weight": EVIDENCE_WEIGHT[evidence],
        "task_family": result.get("task_family") or result["source_key"],
    }, None


def family_capped(values):
    families = defaultdict(list)
    for row in values:
        families[row["task_family"]].append(dict(row))
    capped = []
    for family in families.values():
        mass = sum(row["weight"] for row in family)
        factor = min(1.0, 5.0 / mass)
        for row in family:
            row["weight"] *= factor
            capped.append(row)
    return capped, len(families)


def family_interval(values):
    families = defaultdict(list)
    for row in values:
        families[row["task_family"]].append(row)
    if len(families) < 3:
        return None
    clusters = list(families.values())
    rng = random.Random(240924)
    estimates = []
    for _ in range(300):
        sampled = [row for _ in clusters for row in rng.choice(clusters)]
        mass = sum(row["weight"] for row in sampled)
        estimates.append(sum(row["score"] * row["weight"] for row in sampled) / mass)
    estimates.sort()
    return round(estimates[15], 2), round(estimates[284], 2)


def summaries(results):
    groups = defaultdict(list)
    exclusions = Counter()
    for result in latest_results(results):
        obs, reason = observation(result)
        if reason:
            exclusions[reason] += 1
        else:
            groups[(obs["model"], obs["effort"], obs["domain"])].append(obs)
    output = {}
    for key, original in groups.items():
        values, families = family_capped(original)
        mass = sum(row["weight"] for row in values)
        mean = sum(row["score"] * row["weight"] for row in values) / mass
        good = sum(row["weight"] for row in values if row["score"] >= 3) / mass
        checked = sum(row["evidence"] in ("direct_feedback", "independent_check")
                      for row in original)
        output[key] = {
            "sessions": len(original), "families": families,
            "evidence_weighted_n": round(mass, 2),
            "mean_score": round(mean, 2), "share_at_least_3": round(good, 2),
            "family_interval_90": family_interval(values),
            "feedback_or_check": checked,
            "evidence_status": ("developing" if mass >= 20 and families >= 10 and checked >= 5
                                else "limited" if mass >= 5 and families >= 3 and checked >= 2
                                else "sparse"),
        }
    return output, exclusions


def write_new(path, content):
    if path.parent != retrospect.PRIVATE_ROOT or path.is_symlink():
        raise ValueError("Report output must be a new file in the private retrospective directory")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--estimates", required=True, type=Path)
    parser.add_argument("--census", required=True, type=Path)
    parser.add_argument("--markdown", required=True, type=Path)
    parser.add_argument("--sessions-csv", required=True, type=Path)
    args = parser.parse_args()
    for path in (args.markdown, args.sessions_csv):
        if path.parent != retrospect.PRIVATE_ROOT or path.is_symlink() or path.exists():
            parser.error("Report outputs must be new files in the private retrospective directory")
    census = [json.loads(line) for line in args.census.open() if line.strip()]
    projected_keys = {row["source_key"] for row in census if row["disposition"] == "projected"}
    results = latest_results(row for line in args.estimates.open() if line.strip()
                             if (row := json.loads(line)).get("source_key") in projected_keys)
    taxonomy = json.loads(retrospect.DOMAINS.read_text())
    domains = [entry["id"] for entry in taxonomy["domains"]]
    summary, exclusions = summaries(results)
    routes = sorted({(match["model"], match["effort"]) for row in census
                     for match in row["matching_models"]})
    coverage = defaultdict(Counter)
    for row in census:
        for match in row["matching_models"]:
            route = (match["model"], match["effort"])
            coverage[route]["matched"] += 1
            coverage[route][row["disposition"]] += 1
    for result in results:
        route = (result["model"], result["effort"])
        coverage[route]["processed"] += 1
        bucket = ("errors" if result.get("error") else
                  "older" if result.get("rubric") != RUBRIC else "assessed")
        coverage[route][bucket] += 1
        coverage[route]["scored"] += observation(result)[0] is not None
    domain_coverage = defaultdict(Counter)
    for result in results:
        domain = result.get("effective_domain")
        if domain not in domains:
            continue
        domain_coverage[domain]["assessed"] += 1
        if observation(result)[0] is not None:
            domain_coverage[domain]["scored"] += 1
    score_count = sum(row["sessions"] for row in summary.values())
    projected = sum(row["disposition"] == "projected" for row in census)
    lines = ["# Historical first-outcome domain estimates", "",
             f"{sum(c['assessed'] for c in coverage.values())} of {projected} projectable sessions assessed; {sum(c['errors'] for c in coverage.values())} assessment errors; {score_count} first outcomes have an evidence-backed numeric estimate. Historical tasks were not assigned randomly, and no cell is a calibrated model capability or routing recommendation.",
             "", "## Coverage", "",
             "| Model / effort | Matching | Projectable | Assessed | Errors | Older rubric | Pending | Scored |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for route in routes:
        c = coverage[route]
        lines.append(f"| {route[0]}/{route[1]} | {c['matched']} | {c['projected']} | {c['assessed']} | {c['errors']} | {c['older']} | {c['projected'] - c['assessed'] - c['errors']} | {c['scored']} |")
    lines += ["", "## Primary-domain coverage", "",
              "This pass evaluates only the first substantive outcome and its primary domain. Other work within the same session is not counted here.",
              "", "| Domain | Assessed | Scored |", "| --- | ---: | ---: |"]
    for domain in domains:
        c = domain_coverage[domain]
        lines.append(f"| {domain} | {c['assessed']} | {c['scored']} |")
    causes = defaultdict(Counter)
    for result in results:
        if result.get("cause"):
            causes[(result["model"], result["effort"])][result["cause"]["choice"]] += 1
    lines += ["", "## Cause labels in assessed sessions", "",
              "These counts describe the assessed sample, not failure rates across all history.",
              "", "| Model / effort | Model-domain defect | Instruction violation | External blocker | Changed requirement | Unclear | No problem visible |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for route in routes:
        c = causes[route]
        lines.append(f"| {route[0]}/{route[1]} | {c['model_domain_defect']} | {c['instruction_violation']} | {c['external_blocker']} | {c['changed_requirement']} | {c['unclear']} | {c['no_problem_visible']} |")
    lines += ["", "## Domain scores", "",
              "Each cell is the evidence-weighted mean score /4, followed by evidence mass. Evidence mass sums weights of 1 for direct feedback/checks and 0.5 for visible output; it is not a count of independent sessions. Repeated request templates contribute at most five units of weight per route/domain cell. A dash means no evidence-backed score. Most populated cells remain sparse; inspect the detail table before comparing them.",
              "", "| Domain | " + " | ".join(f"{model}/{effort}" for model, effort in routes) + " |",
              "| --- | " + " | ".join("---:" for _ in routes) + " |"]
    for domain in domains:
        cells = []
        for route in routes:
            cell = summary.get((*route, domain))
            cells.append(f"{cell['mean_score']:.2f} ({cell['evidence_weighted_n']:.1f})" if cell else "—")
        lines.append("| " + domain + " | " + " | ".join(cells) + " |")
    lines += ["", "## Cell evidence", "",
              "Intervals resample task families and capture sampling variation only, not Jev labeling error or model-assignment bias. Sparse cells are examples, not rankings.",
              "", "| Model / effort | Domain | Sessions | Families | Evidence mass | Mean /4 | Share ≥3 | 90% interval | Feedback/check | Status |",
              "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |"]
    for (model, effort, domain), cell in sorted(summary.items()):
        interval = cell["family_interval_90"]
        interval_text = f"{interval[0]:.2f}–{interval[1]:.2f}" if interval else "—"
        lines.append(f"| {model}/{effort} | {domain} | {cell['sessions']} | {cell['families']} | {cell['evidence_weighted_n']:.2f} | {cell['mean_score']:.2f} | {cell['share_at_least_3']:.0%} | {interval_text} | {cell['feedback_or_check']} | {cell['evidence_status']} |")
    lines += ["", "## Unscored outcomes", "", "| Reason | Sessions |", "| --- | ---: |"]
    for reason, count in sorted(exclusions.items()):
        lines.append(f"| {reason} | {count} |")
    lines += ["", "Cause, process errors, and requester provenance are retained per session. A quality `2` requires a visible defect; unverified work stays unscored. Visual art, UI appearance, 3D form, animation, and audio require direct feedback because linked sensory artifacts were not inspected. Only the first substantive outcome per session is assessed in this pass.", ""]
    lines += ["## Domains passed to Jev", "", "| Domain | Description |", "| --- | --- |"]
    for entry in taxonomy["domains"]:
        lines.append(f"| {entry['id']} | {entry['description']} |")
    lines.append("")
    write_new(args.markdown, "\n".join(lines))
    fields = ["source_key", "provider", "model", "effort", "status", "exclusion_reason",
              "adjustments", "task_family", "domain", "effective_domain", "quality",
              "effective_quality", "cause", "evidence", "evidence_weight", "followup_relation",
              "requester_provenance", "delegated_work", "privacy_mode", "rubric"]
    fd = os.open(args.sessions_csv, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for result in results:
            obs, reason = observation(result)
            writer.writerow({
                "source_key": result["source_key"], "provider": result["provider"],
                "model": result["model"], "effort": result["effort"],
                "status": "scored" if obs else "unscored", "exclusion_reason": reason or "",
                "adjustments": ";".join(result.get("evidence_rules", [])),
                "task_family": result.get("task_family", ""),
                "domain": result.get("domain", {}).get("choice", ""),
                "effective_domain": result.get("effective_domain", ""),
                "quality": result.get("quality", {}).get("choice", ""),
                "effective_quality": result.get("effective_quality", ""),
                "cause": result.get("cause", {}).get("choice", ""),
                "evidence": result.get("evidence", {}).get("choice", ""),
                "evidence_weight": obs["weight"] if obs else "",
                "followup_relation": result.get("first_followup_relation") or "",
                "requester_provenance": result.get("requester_provenance", ""),
                "delegated_work": result.get("delegated_work", ""),
                "privacy_mode": result.get("privacy_mode", ""),
                "rubric": result.get("rubric", ""),
            })
    print(json.dumps({"assessed": len(results), "scored": score_count,
                      "domains_with_scores": len({key[2] for key in summary}),
                      "route_domain_cells": len(summary), "unscored": exclusions}, sort_keys=True))


if __name__ == "__main__":
    main()
