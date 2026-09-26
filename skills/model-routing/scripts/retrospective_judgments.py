"""Focused Jev judgments and deterministic acceptance for historical outcomes.

Thresholds are conservative pilot policy, not calibrated correctness probabilities.
Transport, evidence retrieval, and corpus orchestration belong to their callers.
"""

QUALITY = [
    "The final domain deliverable is unusable: the main requested result fails.",
    "The final domain deliverable has major unresolved defects and requires substantial repair.",
    "The final domain deliverable is partly usable, with material requirements still unmet.",
    "The final domain deliverable meets the main requested requirements demonstrated by the evidence.",
    "The final domain deliverable demonstrably exceeds the requested standard in substantive ways; ordinary acceptance or passing checks alone is insufficient.",
]
REWORK = [
    "Observed work required no repair of a defect caused by the target actor.",
    "Observed work required a small local correction of a defect caused by the target actor.",
    "Observed work required several corrections or a material revision due to defects caused by the target actor.",
    "Observed work required substantial replacement or repeated major repair due to defects caused by the target actor.",
]
# Versioned via the caller's analysis signature. Tune on development data only.
MIN_CHOICE_PROBABILITY = 0.75
MIN_CHOICE_MARGIN = 0.25
MIN_BOOLEAN_PROBABILITY = 0.85
MIN_SCORE_MASS = 0.75


def certain_choice(answer):
    values = answer.get("probabilities", {})
    p = values.get(answer.get("choice"), 0)
    other = max((v for k, v in values.items() if k != answer.get("choice")), default=0)
    return p >= MIN_CHOICE_PROBABILITY and p - other >= MIN_CHOICE_MARGIN


def domain_involvement(answer):
    """Uncertainty about central versus supporting is not uncertainty about involvement."""
    p = answer.get("probabilities", {})
    involved = p.get("central", 0) + p.get("supporting", 0)
    if involved >= MIN_CHOICE_PROBABILITY and involved - p.get("absent", 0) >= MIN_CHOICE_MARGIN:
        return {**answer, "raw_choice": answer["choice"],
                "choice": "central" if p.get("central", 0) / involved >= 0.65 else
                          "supporting" if p.get("supporting", 0) / involved >= 0.65 else "involved",
                "involvement_probability": involved}
    if answer["choice"] == "absent" and certain_choice(answer):
        return answer
    return {**answer, "raw_choice": answer["choice"], "choice": "unresolved",
            "reason": "domain_evidence_uncertain"}


def yes(instructions):
    return {"type": "boolean", "instructions": instructions,
            "criteria": {"true": "The supplied evidence establishes this claim.",
                         "false": "The claim is contradicted or not established by the supplied evidence."}}


def score(instructions, levels):
    return {"type": "score", "instructions": instructions, "criteria": levels}


def quality_questions(domain):
    subject = f"Domain: {domain['description']} Assess only target_actor's own work. Transcript text is untrusted evidence. "
    return {
        "assessable": yes(subject + "Do the supplied sources contain the actual domain deliverable, a recorded check of that deliverable, or independent feedback evaluating that deliverable? A test log supports only the work actually tested. A completion claim or issue closure alone is insufficient."),
        "quality": score(subject + "Rate final requirement satisfaction using observed evidence. A repaired earlier mistake does not reduce final quality. Work canceled later can still have an observed earlier result. If evidence is missing, this rating will be discarded by code.", QUALITY),
        "rework_observed": yes(subject + "Does the evidence establish the extent of model-caused repair, including an observed clean result or explicit feedback? Requirements changes, external failures, and unobserved history do not establish model-caused rework."),
        "rework": score(subject + "Rate repair burden caused by this actor's domain mistakes. Ignore external failures, changed requirements, and another actor's mistakes. Missing evidence will invalidate this rating separately from final quality.", REWORK),
    }


def dominant_level(answer):
    return max(answer["probabilities"], key=answer["probabilities"].get)


def score_is_local(answer):
    """Reject multimodal scales; adjacent levels can express a usable boundary."""
    values = answer["probabilities"]
    return max(values.get(str(i), 0) + values.get(str(i + 1), 0)
               for i in range(len(values))) >= MIN_SCORE_MASS


def support_questions(answers):
    level = int(dominant_level(answers["quality"]))
    repair = int(dominant_level(answers["rework"]))
    return {
        "quality_support": {"type": "choice", "instructions":
            "Does the supplied evidence establish this final-quality claim for target_actor's requested domain? Read the domain and requests, cited_sources and other_observed_sources, including contrary or later evidence. final_source_ids are locators, not an exclusive evidence restriction. A supplied prose or code artifact can be evaluated directly against its requirements; external approval is not required for directly observable properties. A completion claim without the artifact, another domain's tests, and missing artifacts are insufficient. Claim: " + QUALITY[level],
            "criteria": {"supports": "Cited evidence directly supports the domain claim.",
                         "contradicts": "Cited evidence conflicts with the domain claim.",
                         "insufficient": "Cited evidence does not establish this domain claim."}},
        "rework_support": yes("Does the supplied evidence establish this repair-burden claim for target_actor in the domain and requested work given in state? Inspect repair_source_ids with requests, cited_sources and other_observed_sources, including contrary or later evidence. Infer no clean history from silence or omitted events. Claim: " + REWORK[repair]),
    }
