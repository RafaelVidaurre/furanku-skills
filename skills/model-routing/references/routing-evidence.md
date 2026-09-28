# When historical evidence can change routing

Read this before expanding an assessment sample or proposing a learned routing
preference. This is the experimental decision protocol; no automatic calibration
or routing-table writer is implemented. Individual outcome scores remain governed
by [domain assessment](domain-assessment.md).

## Define one decision before collecting more

Record the candidates, domain, difficulty, tool access, cost basis, acceptable
quality loss and intended use. Example: Luna max versus Sol high for routine,
reversible implementation with observable acceptance checks. Critical, visual,
architectural and unfamiliar work require separate comparisons; a small code edit
does not establish capability on those tasks.

Classify difficulty from the requested work before reading its outcome:

| Level | Requested scope |
| --- | --- |
| Routine | Established approach, bounded component, explicit acceptance, reversible change. |
| Substantial | Several interacting components or ambiguous requirements; integration reasoning needed. |
| Demanding | Novel approach, cross-system constraints, difficult diagnosis or specialized judgment. |
| Unknown | Contract cannot establish difficulty. |

Record criticality separately: routine, consequential, or critical, with the
consequence of a wrong result. A task's length, model name, failure or token usage
does not establish difficulty. Record visual-quality requirements explicitly.

**Complete when:** the comparison contract and a budget are frozen, and the local
inventory can supply new independent, comparable work. If history is scarce,
report the shortfall before spending on the plentiful candidate.

## Keep separate measurements

For each selected task retain native identity/revision, task request anchors,
family and project, selection method, model/effort from execution metadata,
domain and difficulty, tool context, and these evidence-backed observations:

| Measure | Meaning and unknown handling |
| --- | --- |
| Final domain quality | Existing 0–4 ordinal rubric; missing is null, never failure or success. |
| First delivery | Met criteria, needed correction, or unknown. Final success alone cannot establish first-pass success. |
| Worker repair episodes | Distinct causally related mistakes and their resolution; group repeated commands fixing one mistake. Count workflow/tool-use repairs separately from deliverable defects. |
| Intervention | User/coordinator correction, preference change, scope change, or external unblock; retain source and attribution. A correction is not automatically a worker error. |
| Defect severity | Minor, major or unusable against the requested deliverable, with responsibility and final resolution. Keep genuine severe failures visible. |
| Worker resource use | Native reported input/cached-input/output, observed task boundary and coverage, plus attributable tool charges when known. Unknown attribution remains null. |
| Assessment expense | Assessor calls and parent audit cost separately; never use this as worker cost. |

An empty repair list means no repair observed. Report the opportunity to observe
feedback and whether the whole task was supplied. Do not manufacture a composite
value score by averaging ordinal quality or assigning an invented token cost to
one correction. Value requires acceptable quality plus measured end-to-end cost,
including attributable recovery and interventions. Human time may remain unknown.

`history_usage.py --codex-session FILE --expected-sha256 HASH` reads native Codex
cumulative snapshots locally, without model calls. It does not sum repeated
snapshots, add cached input twice, or add reasoning to output again. Decreasing
counters require reconciliation. Its output is session-level recorded usage,
not task cost, currency or subscription quota. Validate task boundaries, inherited
history and end coverage before comparing costs. Claude/Grok cost normalization
is not implemented by this adapter; preserve their source measurements separately.

**Complete when:** every comparison row separates final quality, repairs, severity
and cost, with sources or explicit unknowns. Execution metadata wins over a stale
model name embedded in the dispatch request; disclose that mismatch.

## Count independent evidence and decide readiness

Group continuations, retries, parent/child contributions and duplicate native
histories under the same original task. Group related templates under a task
family. Several domains on one task are correlated observations. Report sessions,
original tasks, task families and projects separately; none substitutes for another.

These are collection checkpoints, not statistical confidence thresholds:

| Independent usable tasks per candidate/domain | Permitted interpretation |
| --- | --- |
| 1–4 | Examples and hypotheses. |
| 5–9 | Early signals; decide whether another small batch is worth its cost. |
| 10–20 | Evaluate a provisional preference for comparable routine work. |
| 30–50+ | Potentially stronger estimates; diversity and uncertainty still govern. |

A provisional preference requires all of the following:

1. Both candidates have at least 10 usable independent tasks, at least three
   task families and two projects, matched on requested difficulty and tool access.
   These are conservative experiment admission rules, not guarantees of power.
2. Preserve random baseline and purposeful supplement separately. Report every
   selected missing outcome and its reason. Test whether plausible outcomes for
   missing cases would reverse the preference; if so it remains unresolved.
3. Source-audit all first-wave ratings, then a frozen random audit portion plus
   every negative, surprising or uncertain judgment. Freeze a fresh reference set
   before measuring assessor accuracy; previously repaired cases are development
   evidence. Any unresolved systematic grading error blocks calibration.
4. Estimate uncertainty at the original-task/family level, with difficulty and
   project controls. Show sensitivity to conservative pooling and to leaving each
   family out. Sparse cells stay close to the prior with wide uncertainty; expose
   both raw evidence and prior sensitivity. Fitting this estimator is future work.
5. For the initial routine-work experiment, predeclare a maximum 10 percentage
   point loss in probability of meeting criteria and at least a 20% resource-cost
   saving. Require the 95% uncertainty bounds to support both conditions, with
   no unexplained major/unusable failures. These are proposed engineering margins,
   not user-approved tolerances for critical work or a claim about today's data.
6. Confirm the proposed preference on a fresh, frozen prospective or held-out
   batch before changing routing. Record disagreement and cost as well as success.

Ten clean outcomes alone do not satisfy these conditions. Even independent 10/10
successes have a Wilson 95% lower bound around 72%; 30/30 around 89%. See
[NIST's interval guidance](https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
Those binomial intervals do not correct selection bias or correlated tasks.

**Complete when:** the report says `insufficient`, `ready_for_validation`, or
`validated_for_review`, naming each unmet condition. Only the last supports asking
the user to approve a specific routing update. No fixed sample count enables it.

## Spend only where the next evidence can help

Recover omitted native artifacts and audit existing observations before new
assessment calls. Store supplemental source reviews separately from raw judgments;
do not rerun a completed task merely because this protocol changed. Reuse the
completion ledger. Preserve every attempt and measurement revision.

At each checkpoint, name the decision that another bounded batch could change.
Stop when the available archive lacks comparable independent tasks, required
artifacts or attributable cost. Propose a prospective comparison using actual
upcoming work; historical repetition cannot repair missing diversity.

**Complete when:** continuation has an explicit evidence gain and budget, or the
report identifies the precise new work needed. Unresolved calibration never
justifies installing an experimental skill or publishing learned score updates.
