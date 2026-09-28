# Collect comparable upcoming work

Use after the scope-attribution validation has passed and historical sampling
cannot supply an independent comparison. Apply [routing evidence readiness](routing-evidence.md)
for measurement definitions and decision thresholds. This procedure does not
install a background collector or alter ordinary routing configuration.

## Freeze the first checkpoint

Create a private study manifest before assigning any study task. Initial target:
eight real routine implementation tasks, four assigned to Luna max and four to
Sol high, drawn from at least two projects and three task families. This is a
collection checkpoint; it is below the threshold for a routing preference.
Set an assessor admission budget of 500,000 input and 100,000 output tokens for
the checkpoint, counting extraction, failed calls and repairs. Track actual worker
resources separately; parent review usage may remain unmeasured.

Enroll only work already requested by the user with a bounded, reversible outcome,
an established implementation approach and observable acceptance criteria. Critical
work, visual-quality decisions, substantial architecture, encrypted assignments,
and exact user model requests remain outside this first comparison. A task whose
contract changes outside this scope stays in the manifest with its reason; it does
not silently disappear or become a success for routine implementation.

**Complete when:** the manifest fixes candidates, target, domains, eligibility,
budget, evaluation revision, seed and stopping conditions. Zero enrolled tasks is
`awaiting_eligible_work`, not a running comparison or a completion claim.

## Register before assignment

For each proposed task, store a record with these fields:

```json
{
  "original_task_id": "stable work identity",
  "project_id": "private stable identity",
  "family_id": "shared identity for related task templates",
  "contract": "verbatim requested outcome and acceptance criteria",
  "contract_sha256": "digest of the exact contract",
  "domain_ids": ["implementation"],
  "difficulty": "routine",
  "criticality": "routine",
  "eligibility_rationale": "why this contract fits the study",
  "tool_requirements": [],
  "assignment": null,
  "decision_id": null,
  "worker_session_ref": null,
  "parent_session_ref": null,
  "status": "registered"
}
```

Record classification before examining outcomes and worker identity where possible.
Count related continuations and recovery attempts under the original task, retaining
every worker contribution. They are costs and observations, not additional trials.

Freeze a seeded random order of four slots per candidate. Register consecutive
eligible tasks in arrival order before revealing their slot; record exclusions and
their reasons. Check overlap of project/difficulty/family at the checkpoint rather
than choosing tasks after seeing their outcomes to improve balance. Freeze each
assignment once; it cannot be redrawn because the assigned model is unavailable.
Gate-check the assigned candidate against actual tools, configuration and quota.
If it cannot launch, record the reason and defer study enrollment; ordinary work
may proceed outside the comparison under the user's existing routing rules. Never
override a disabled/explicit setting or exact request to balance study counts.

**Complete when:** each launched task has an immutable assignment, successful
routing decision and exact worker/parent session references. A deferred assignment
retains its record. No synthetic workload is invented to fill a study slot.

## Observe the whole outcome

Preserve the original contract and every authorized revision, command/result pairs,
authored artifacts, review feedback and final disposition. Capture the first usable
delivery as well as the final repaired result. Include attributable parent review
and recovery work where observable; otherwise report those costs unknown. Keep
external blockers separate from worker defects and preference changes.

At the owner review checkpoint, prepare the completed task through the existing
extraction/assessment ledger. Use the saved source revision and reuse completed
scopes. Later feedback becomes a separately recorded source review; a model
reassessment still requires an explicit reason under the ledger's existing rules.
Do not infer success from silence or calculate quota cost from concurrent account
window deltas. Audit all first-checkpoint results before accepting any observation.

**Complete when:** each enrolled task has a reviewed result or a named evidence
gap, observed worker and assessor usage, and coverage of follow-up or its absence.

## Decide whether to continue

After eight tasks or budget exhaustion, report results by assigned candidate,
including incomplete tasks, attribution changes and exclusions. Inspect whether
the groups actually overlap in difficulty, families, projects and tool access.
Stop on systematic grading errors or missing contracts/artifacts before expanding.
If the information remains useful, propose another bounded checkpoint toward ten
independent usable tasks per candidate; do not automatically spend for twenty.

**Complete when:** the report identifies the next evidence gain or stops the
comparison. Only the separate readiness procedure can justify a learned routing
preference; four successful tasks per candidate cannot.
