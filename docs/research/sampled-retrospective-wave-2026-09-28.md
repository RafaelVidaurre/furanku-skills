# Bounded retrospective assessment: first wave

## What ran

The seeded plan reserved 57 assessment slots and 153 short-preview candidates.
Local preparation produced 152 readable previews; one source had no readable work
turns. GPT-6 Sol medium classified the previews against all 21 domain definitions.
Two unselected cards contained five invalid native citations; validation flagged
them for review. Citation validity is not a measurement of domain-label accuracy.

The first deep wave selected six random-baseline sessions, one per model/effort
group, and six cases for additional domain coverage. Twelve native task extractions
and twelve selected-task assessments completed. One session contained three eligible
tasks; its assessed task was chosen uniformly with a recorded seed. Other tasks
remain unassessed. Native identities, selection reasons, source hashes, inputs,
outputs, images, audits and token records stay in the private machine-global store.

## Results

All 21 domains were classified for each selected task: 252 domain rows. Eight
sessions yielded 21 numeric observations across 11 domains. Four had no numeric
score. Every numeric observation was 3: meets the observed requested criteria.
This does not mean every session was successful or every task was equally hard.
Observed corrections, blocked work and unscored outcomes remain separate evidence.

| Domain | Numeric observations | Distinct contributing sessions |
|---|---:|---:|
| Software implementation | 4 | 4 |
| Debugging | 1 | 1 |
| Testing and code review | 4 | 4 |
| Architecture and systems design | 1 | 1 |
| Deployment and operations | 2 | 2 |
| UX and interaction design | 2 | 2 |
| Game design | 1 | 1 |
| 3D and spatial work | 3 | 3 |
| Art and visual assets | 1 | 1 |
| Writing and editing | 1 | 1 |
| Technical documentation | 1 | 1 |

Security, research, quantitative reasoning, science, product planning, purchasing,
UI visual design, animation, audio and localization have no numeric observation
in this wave. Some were involved but unscored; others were absent. The private
report separates those states and includes the full taxonomy and per-session rows.

The art case used original native image bytes, not a prompt or completion claim.
The parent visually checked the before/after artifacts and confirmed the reported
geometry repairs. These observations concern an agent using an image-generation
tool, not the agent model's standalone ability to generate images.

## What the audit changed

- A Claude harness-generated `<synthetic>` message initially made one task look
  like mixed-model work. Preparation now excludes that control message from worker
  attribution while retaining it as context. Its completed extraction was reused.
- Uniform excerpting hid authored artifacts and caused conservative unknowns.
  Compaction now preserves responses and tool calls before lengthy observations
  when the budget permits. Earlier unknowns remain visible; they were not converted
  into success claims merely because an artifact exists in the original history.
- A style clarification was classified as a worker error even though the earlier
  request did not specify that style. The audit records iteration with unknown
  responsibility instead.
- A narrowed final task still carried an obsolete full-completion expectation.
  The audit assessed the current partial-handoff requirement instead.
- A failed clean capture did not establish sole worker responsibility. The audit
  preserves non-delivery and distinguishes it from an attributable model failure.
- Some citations pointed only to successful tool receipts. Reviewed results add
  the native command IDs carrying the authored content. New extraction packets
  expose this linkage mechanically.

Raw results remain immutable and structurally complete, with semantic status
unreviewed in the ledger. Separate reviewed results retain the parent corrections.
No numeric ratings were changed by these corrections. This was a source audit,
not a blinded accuracy study with frozen reference judgments.

## Measured usage and reuse

35 instrumented assessor calls consumed **2,167,432 input tokens**, including
279,552 cached input tokens, and **91,408 output tokens**. The count includes
previews, extraction, scoring, image input and five structural output repairs.
Two repairs first failed on redundant domain-to-requirement links. The runner now
derives those links mechanically without changing judgments. Replaying the five
initial outputs resolves one entirely; the other link correction exposes a score
contradicting unknown outcome evidence, which still needs model correction. Three
repairs concern missing requirement coverage. Measured usage includes every repair
call that actually ran.
Cached input remains part of the input total. Parent implementation and manual
audit tokens are additional and were not measured by this runner. These totals
cannot be converted reliably into subscription quota percentages.

All calls completed with usage records; this wave observed no rate-limit failure.
The runner reserves capacity before concurrent calls, reconciles actual usage and
stops further admissions when the budget cannot accommodate them. Missing usage
blocks continuation. The CLI exposes no hard in-flight generation cap, so the
reservation is not a guarantee about one call's maximum cost.

All 24 repeat extraction/scoring claims returned `skip_completed`. A completed
case directory also reopens without model calls. Assessment completion and
extraction completion remain distinct.

## Decision

Bounded sampling produced useful evidence across several kinds of work without
scoring the archive. It also exposed preparation and judgment errors that would
have polluted a bulk run. Continue with targeted artifact recovery and small
audited batches where evidence can affect a routing choice; do not launch the
remaining slots automatically.

The random baseline and diversity supplement remain separate. Several domain
ratings share one task, related projects are correlated, and domain/difficulty
coverage is sparse. These observations do not establish calibrated model rankings
or best-value routing. Routing scores and installed skill files are unchanged.
