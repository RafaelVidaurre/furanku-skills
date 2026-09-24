#!/usr/bin/env python3
"""Report Jev's exploratory whole-session scores for every involved work domain."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path

import retrospect
from performance_report import family_capped, family_interval, write_new


def involvement_status(answer):
    choice = answer.get("choice", "absent")
    if choice in ("absent", "supporting"):
        return choice
    return "central" if answer.get("probabilities", {}).get("central", 0) >= 0.75 else "central_uncertain"


def score_status(row, domain):
    if row.get("error"):
        return "error"
    if row.get("quality_rubric_version") != retrospect.QUALITY_RUBRIC_VERSION:
        return "older_rubric"
    status = involvement_status(row.get("involvement", {}).get(domain, {}))
    if status != "central":
        return status
    if row.get("delegated_work") is not False:
        return "delegated_or_unchecked"
    if row.get("attribution") != "turn_verified":
        return "summary_attribution"
    if row.get("omitted_turns", 0):
        return "truncated_session"
    quality = row.get("quality", {}).get(domain, {})
    choice = quality.get("choice", "unknown")
    if choice not in ("0", "1", "2", "3", "4"):
        return "unknown_quality"
    if quality.get("probabilities", {}).get(choice, 0) < 0.6:
        return "quality_ambiguous"
    return "numeric"


def aggregate(results, domains):
    latest = {(row.get("source_key") or f"{row.get('provider', 'codex')}:{row['session']}"): row
              for row in results}
    groups = defaultdict(list)
    active = Counter()
    unknown = Counter()
    supporting = Counter()
    uncertain = Counter()
    exclusions = Counter()
    agent_requested = Counter()
    for row in latest.values():
        if row.get("error") or row.get("quality_rubric_version") != retrospect.QUALITY_RUBRIC_VERSION:
            continue
        route = (row["model"], row["effort"])
        for domain in domains:
            status = involvement_status(row.get("involvement", {}).get(domain, {}))
            if status == "absent":
                continue
            key = (*route, domain)
            if status == "supporting":
                supporting[key] += 1
                continue
            if status == "central_uncertain":
                uncertain[key] += 1
                continue
            active[key] += 1
            if row.get("requester_provenance") == "agent_or_coordinator":
                agent_requested[key] += 1
            status = score_status(row, domain)
            if status != "numeric":
                exclusions[(key, status)] += 1
                unknown[key] += 1
                continue
            quality = row["quality"][domain]["choice"]
            groups[key].append({"score": int(quality), "weight": 1.0,
                                "task_family": row.get("task_family") or row.get("source_key") or row["session"]})
    cells = {}
    for key, rows in groups.items():
        capped, families = family_capped(rows)
        mass = sum(row["weight"] for row in capped)
        cells[key] = {"mean": round(sum(row["score"] * row["weight"] for row in capped) / mass, 2),
                      "scored": len(rows), "families": families, "effective_n": round(mass, 2),
                      "active": active[key], "unknown": unknown[key],
                      "interval_90": family_interval(capped)}
    return latest, cells, active, unknown, supporting, uncertain, exclusions, agent_requested


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assessments", required=True, type=Path)
    parser.add_argument("--census", required=True, type=Path)
    parser.add_argument("--markdown", required=True, type=Path)
    parser.add_argument("--sessions-csv", required=True, type=Path)
    args = parser.parse_args()
    for path in (args.markdown, args.sessions_csv):
        if path.parent != retrospect.PRIVATE_ROOT or path.is_symlink() or path.exists():
            parser.error("Report outputs must be new files in the private retrospective directory")
    taxonomy = json.loads(retrospect.DOMAINS.read_text(encoding="utf-8"))
    domains = [item["id"] for item in taxonomy["domains"]]
    census = [json.loads(line) for line in args.census.open() if line.strip()]
    projected_keys = {row["source_key"] for row in census if row["disposition"] == "projected"}
    results = [row for line in args.assessments.open() if line.strip()
               if (row := json.loads(line)).get("source_key") in projected_keys]
    latest, cells, active, unknown, supporting, uncertain, exclusions, agent_requested = aggregate(results, domains)
    routes = sorted({(match["model"], match["effort"]) for row in census
                     for match in row["matching_models"]})
    projected = Counter((row["matching_models"][0]["model"], row["matching_models"][0]["effort"])
                        for row in census if row["disposition"] == "projected")
    assessed = Counter((row["model"], row["effort"]) for row in latest.values()
                       if not row.get("error") and row.get("model") and
                       row.get("quality_rubric_version") == retrospect.QUALITY_RUBRIC_VERSION)
    census_route = {row["source_key"]: (row["matching_models"][0]["model"],
                                       row["matching_models"][0]["effort"])
                    for row in census if row["disposition"] == "projected"}
    errors = Counter(census_route[key] for key, row in latest.items()
                     if key in census_route and row.get("error"))
    older = Counter(census_route[key] for key, row in latest.items()
                    if key in census_route and not row.get("error") and
                    row.get("quality_rubric_version") != retrospect.QUALITY_RUBRIC_VERSION)
    lines = ["# Whole-session domain estimates", "",
             "Exploratory Jev labels for the full conversation in each assessed Codex, Claude Code, or Grok session. A session can contribute to several domains. Means use central labels with selected-choice probability at least 0.75 and quality-choice probability at least 0.60. These are ambiguity filters, not calibrated confidence. Delegated work, summary-only model attribution, and truncated conversations are excluded from means; their labels remain in the audit CSV. The pilot prioritizes feedback-rich sessions and is not a random sample. Scores are visible-outcome estimates on a 0–4 scale, not calibrated model capability or routing scores.",
             "", "## Coverage", "",
             "| Model / effort | Projectable | Assessed | Errors | Older rubric | Pending |", "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for route in routes:
        lines.append(f"| {route[0]}/{route[1]} | {projected[route]} | {assessed[route]} | {errors[route]} | {older[route]} | {projected[route] - assessed[route] - errors[route]} |")
    lines += ["", "## Domain scores", "",
              "Each cell is mean /4 (numeric / strong-central sessions). A dash means no numeric score; an asterisk marks fewer than five numeric sessions or three task families. One task family contributes at most five effective observations. Numeric labels remain provisional because transcript visibility and task selection vary by model.",
              "", "| Domain | " + " | ".join(f"{m}/{e}" for m, e in routes) + " |",
              "| --- | " + " | ".join("---:" for _ in routes) + " |"]
    for domain in domains:
        values = []
        for route in routes:
            key = (*route, domain)
            cell = cells.get(key)
            values.append(f"{cell['mean']:.2f}{'*' if cell['scored'] < 5 or cell['families'] < 3 else ''} ({cell['scored']}/{active[key]})" if cell else
                          f"— (0/{active[key]})" if active[key] else "—")
        lines.append("| " + domain + " | " + " | ".join(values) + " |")
    lines += ["", "## Cell evidence", "",
              "Intervals resample task families and cover sampling variation only; they do not correct Jev labeling error, missing artifacts, or assignment bias.",
              "", "| Model / effort | Domain | Strong central | Weak central | Supporting | Numeric | Unscored | Agent-requested | Families | Effective n | Mean /4 | 90% interval |",
              "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"]
    for key in sorted(set(active) | set(uncertain) | set(supporting)):
        model, effort, domain = key
        cell = cells.get(key)
        interval = cell["interval_90"] if cell else None
        interval_text = f"{interval[0]:.2f}–{interval[1]:.2f}" if interval else "—"
        lines.append(f"| {model}/{effort} | {domain} | {active[key]} | {uncertain[key]} | {supporting[key]} | {cell['scored'] if cell else 0} | {unknown[key]} | {agent_requested[key]} | {cell['families'] if cell else 0} | {cell['effective_n']:.2f} | {cell['mean']:.2f} | {interval_text} |" if cell else
                     f"| {model}/{effort} | {domain} | {active[key]} | {uncertain[key]} | {supporting[key]} | 0 | {unknown[key]} | {agent_requested[key]} | 0 | 0 | — | — |")
    lines += ["", "## Why central labels were unscored", "",
              "| Reason | Labels |", "| --- | ---: |"]
    by_reason = Counter()
    for (_key, reason), count in exclusions.items():
        by_reason[reason] += count
    for reason, count in sorted(by_reason.items()):
        lines.append(f"| {reason} | {count} |")
    lines += ["", "## Domain definitions", "", "| Domain | Description |", "| --- | --- |"]
    for item in taxonomy["domains"]:
        lines.append(f"| {item['id']} | {item['description']} |")
    write_new(args.markdown, "\n".join(lines) + "\n")
    fields = ["source_key", "provider", "model", "effort", "turns", "omitted_turns", "task_family", "domain",
              "involvement", "involvement_status", "quality", "quality_confidence", "status",
              "delegated_work", "requester_provenance", "attribution", "privacy_mode"]
    import os
    fd = os.open(args.sessions_csv, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in latest.values():
            if row.get("error"):
                writer.writerow({"source_key": row.get("source_key") or row.get("session", ""),
                                 "provider": row.get("provider", ""), "status": row["error"]})
                continue
            for domain in domains:
                answer = row.get("involvement", {}).get(domain, {})
                involvement = answer.get("choice", "absent")
                if involvement == "absent":
                    continue
                status = involvement_status(answer)
                quality = row.get("quality", {}).get(domain, {})
                writer.writerow({"source_key": row.get("source_key") or row["session"], "provider": row.get("provider", "codex"),
                                 "model": row.get("model", ""), "effort": row.get("effort", ""),
                                 "turns": row.get("turns", ""), "omitted_turns": row.get("omitted_turns", ""),
                                 "task_family": row.get("task_family", ""), "domain": domain,
                                 "involvement": involvement, "involvement_status": status,
                                 "quality": quality.get("choice", "unknown"),
                                 "quality_confidence": quality.get("confidence"),
                                 "status": score_status(row, domain),
                                 "delegated_work": row.get("delegated_work", ""),
                                 "requester_provenance": row.get("requester_provenance", ""),
                                 "attribution": row.get("attribution", ""),
                                 "privacy_mode": row.get("privacy_mode", "")})
    print(json.dumps({"assessed": sum(assessed.values()), "numeric_cells": len(cells),
                      "domains_with_numeric": len({key[2] for key in cells})}))


if __name__ == "__main__":
    main()
