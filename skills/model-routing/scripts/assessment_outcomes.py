"""Source-linked task completion and correction evidence, independent of quality."""
from session_extract import refs


def validate(outcome, sources, domains):
    if not isinstance(outcome, dict):
        raise ValueError("Task outcome is required; preserve unknowns explicitly")
    for field in ("original_goal", "final_scope", "rationale"):
        if not isinstance(outcome.get(field), str) or not outcome[field].strip():
            raise ValueError(f"Task outcome requires {field}")
    if outcome.get("original_status") not in {"met", "partial", "not_met", "unknown"}:
        raise ValueError("Invalid original task completion status")
    if outcome.get("cause") not in {"none", "worker", "external", "mixed", "unknown"}:
        raise ValueError("Original outcome requires cause, including mixed or unknown")
    if outcome.get("scope_change") not in {"unchanged", "narrowed", "expanded", "replaced", "unknown"}:
        raise ValueError("Task outcome requires scope change classification")
    refs(outcome.get("original_source_ids"), sources, "original contract", True)
    refs(outcome.get("final_source_ids"), sources, "final contract", True)
    refs(outcome.get("source_ids"), sources, "original outcome evidence",
         outcome["original_status"] != "unknown")
    refs(outcome.get("scope_source_ids"), sources, "scope revision",
         outcome["scope_change"] in {"narrowed", "expanded", "replaced"})
    if outcome.get("feedback_coverage") not in {"full", "partial", "unknown"}:
        raise ValueError("Feedback coverage must be explicit")
    first = outcome.get("first_delivery")
    if not isinstance(first, dict) or first.get("status") not in {"met", "needed_correction", "unknown"}:
        raise ValueError("First delivery must be explicit; final quality is not first-pass success")
    refs(first.get("source_ids"), sources, "first delivery", first["status"] != "unknown")
    if not isinstance(outcome.get("interventions"), list):
        raise ValueError("Task outcome requires observed interventions list")
    seen = set()
    for event in outcome["interventions"]:
        if not isinstance(event, dict) or not isinstance(event.get("id"), str) or not event["id"]:
            raise ValueError("Intervention needs an evidence episode ID")
        if event["id"] in seen:
            raise ValueError("Repeated intervention episode")
        seen.add(event["id"])
        if event.get("kind") not in {"worker_correction", "scope_change", "external_unblock",
                                     "preference_change", "deadline_overrun", "unknown"}:
            raise ValueError("Intervention needs kind")
        if event.get("cause") not in {"worker", "external", "mixed", "unknown"}:
            raise ValueError("Intervention needs cause")
        if not isinstance(event.get("rationale"), str) or not event["rationale"].strip():
            raise ValueError("Intervention needs rationale")
        refs(event.get("source_ids"), sources, "intervention evidence", True)
        refs(event.get("domain_ids"), domains, "intervention domains")
        minutes = event.get("minutes")
        if minutes is not None and (type(minutes) not in {int, float} or not 0 <= minutes < float("inf")):
            raise ValueError("Observed duration must be finite and nonnegative, or null")
