#!/usr/bin/env python3
"""Prepare and report evidence-backed ordinal domain observations."""
import argparse
import json
from pathlib import Path

from session_extract import materialize, refs
from task_retrospect import write_private

RUBRIC = "domain-outcomes-v1"


def prepare(job, extraction):
    packet = materialize(job["packet"], extraction)
    taxonomy = json.loads((Path(__file__).parent.parent / "references/retrospective-domains.json").read_text())
    jobs, excluded = [], []
    for case in packet["cases"]:
        events = [s for s in case["state"]["sources"]
                  if s["kind"] not in {"request", "historical_instruction"}]
        identities = set()
        uncertain = not events
        for source in events:
            actor = job.get("attribution", {}).get(source.get("actor_id"), {})
            pair = (actor.get("model"), actor.get("effort"))
            if (not all(pair) or any(v == "unknown" for v in pair)
                or actor.get("provenance") not in {"turn_metadata", "linked_tool_call"}
                or source.get("ownership") != "current_session"):
                uncertain = True
            identities.add(pair)
        if uncertain or len(identities) != 1:
            excluded.append({"task_id": case["id"], "reason": "mixed_or_unknown_contribution"})
            continue
        model, effort = next(iter(identities))
        jobs.append({"stage": "assessment", "session_ref": job["session_ref"],
                     "source_sha256": job["source_sha256"], "procedure": RUBRIC,
                     "scope": "task", "scope_id": case["id"],
                     "request_ids": [r["id"] for r in case["state"]["request_links"]],
                     "attribution": {"model": model, "effort": effort},
                     "packet": {"rubric": RUBRIC, "domain_taxonomy": taxonomy, "cases": [case]}})
    return {"version": 1, "jobs": jobs, "excluded_tasks": excluded,
            "extraction_coverage": packet["coverage"]}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate_result(packet, result):
    """Additional semantic-shape constraints; source truth still needs review."""
    domain_ids = {d["id"] for d in packet["domain_taxonomy"]["domains"]}
    inputs = {c["id"]: c for c in packet["cases"]}
    for case in result["cases"]:
        state = inputs[case["id"]]["state"]
        sources = {s["id"]: s for s in state["sources"]}
        requirements = {r["id"]: r for r in case["requirements"]}
        artifacts = refs(case.get("artifact_source_ids"), set(sources), "artifacts")
        if any(sources[s]["kind"] in {"request", "historical_instruction"} for s in artifacts):
            raise ValueError("A request is not a delivered artifact")
        for req in requirements.values():
            if (req.get("kind") not in {"deliverable", "process"}
                or req.get("applicability") not in {"applicable", "inapplicable", "unknown"}
                or not nonempty(req.get("applicability_rationale"))
                or req.get("cause") not in {"none", "worker", "external", "unknown"}):
                raise ValueError("Requirement needs kind, applicability, rationale and cause")
            refs(req.get("domain_ids"), domain_ids, "requirement domains")
            if req["applicability"] != "applicable" and req["verdict"] != "unknown":
                raise ValueError("Unestablished applicability cannot earn a verdict")
        repairs = case.get("repairs")
        if not isinstance(repairs, list):
            raise ValueError("Case requires observed repairs list")
        for repair in repairs:
            refs(repair.get("source_ids"), set(sources), "repair sources", True)
            if (repair.get("cause") not in {"worker", "external", "unknown"}
                or not nonempty(repair.get("rationale")) or "resolved" not in repair
                or (repair["resolved"] is not None and type(repair["resolved"]) is not bool)):
                raise ValueError("Repair needs cause, rationale and resolution")
        defects = case.get("defects", [])
        if not isinstance(defects, list):
            raise ValueError("Defects must be a list")
        for defect in defects:
            refs(defect.get("source_ids"), set(sources), "defect sources", True)
            refs(defect.get("domain_ids"), domain_ids, "defect domains", True)
            if (defect.get("responsibility") not in {"introduced", "reasserted", "inherited", "unknown"}
                or defect.get("severity") not in {"minor", "major", "unusable"}
                or not nonempty(defect.get("rationale"))):
                raise ValueError("Defect needs responsibility, severity and rationale")
        for domain in case["domains"]:
            req_ids = refs(domain.get("requirement_ids"), set(requirements), "domain requirements")
            support = refs(domain.get("source_ids"), set(sources), "domain sources")
            if ("score" not in domain or domain.get("confidence") not in {"low", "medium", "high"}
                or not nonempty(domain.get("score_rationale"))):
                raise ValueError("Domain needs score, confidence and score rationale")
            eligible = {r["id"] for r in requirements.values() if r["kind"] == "deliverable"
                        and r["applicability"] == "applicable" and domain["id"] in r["domain_ids"]}
            if req_ids != eligible:
                raise ValueError("Domain must cover exactly its applicable deliverables")
            score = domain["score"]
            if score is None:
                continue
            if (type(score) is not int or score not in range(5)
                or domain["role"] not in {"central", "supporting"} or not eligible or not support):
                raise ValueError("Numeric score needs involved domain, deliverables and evidence")
            if any(requirements[r]["verdict"] == "unknown" for r in eligible):
                raise ValueError("Incomplete outcome evidence must remain unscored")
            if score >= 3 and any(requirements[r]["verdict"] != "met" for r in eligible):
                raise ValueError("Meets criteria rating requires met deliverables")
            attributable_defect = any(domain["id"] in d["domain_ids"]
                                      and d["responsibility"] in {"introduced", "reasserted"} for d in defects)
            if score >= 3 and attributable_defect:
                raise ValueError("An attributable final defect contradicts meets-criteria quality")
            if score < 3 and not attributable_defect and not any(requirements[r]["verdict"] == "unmet"
                                                                 and requirements[r]["cause"] == "worker" for r in eligible):
                raise ValueError("Defect rating requires an evidenced worker defect")


def report(jobs, results):
    from assessment_store import validate_result as validate_assessment
    if len(jobs) != len(results):
        raise ValueError("Need one result per job, in job order")
    rows, seen = [], set()
    for job, result in zip(jobs, results):
        if job["packet"].get("rubric") != RUBRIC:
            raise ValueError("Cached results from another rubric require separate review")
        key = (job["session_ref"], job["scope_id"])
        if key in seen:
            raise ValueError("Repeated task or revision would inflate evidence; select one revision")
        seen.add(key)
        validate_assessment(job, result)
        names = {d["id"]: d["name"] for d in job["packet"]["domain_taxonomy"]["domains"]}
        for case in result["cases"]:
            for d in case["domains"]:
                rows.append({"session_ref": job["session_ref"], "task_id": case["id"],
                             **job["attribution"], "domain": d["id"], "domain_name": names[d["id"]],
                             **{k: d[k] for k in ("role", "score", "confidence", "score_rationale",
                                                  "requirement_ids", "source_ids")}})
    return {"version": 1, "rubric": RUBRIC, "semantic_status": "unreviewed",
            "sessions": len({j["session_ref"] for j in jobs}), "tasks": len(jobs),
            "scored_domain_observations": sum(r["score"] is not None for r in rows), "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "report"])
    parser.add_argument("--extraction-job")
    parser.add_argument("--extraction-result")
    parser.add_argument("--jobs")
    parser.add_argument("--results")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    def read(path):
        return json.loads(Path(path).read_text())
    if args.command == "prepare":
        if not args.extraction_job or not args.extraction_result:
            parser.error("prepare requires extraction job and result")
        output = prepare(read(args.extraction_job), read(args.extraction_result))
    else:
        if not args.jobs or not args.results:
            parser.error("report requires jobs and results")
        output = report(read(args.jobs)["jobs"], read(args.results))
    write_private(Path(args.output), json.dumps(output, indent=2) + "\n")
    print(json.dumps({k: output[k] for k in ("version", "semantic_status", "sessions", "tasks",
                                            "scored_domain_observations") if k in output}))


if __name__ == "__main__":
    main()
