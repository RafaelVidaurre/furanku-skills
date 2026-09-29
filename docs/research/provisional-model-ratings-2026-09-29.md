# Provisional model/effort ratings — 2026-09-29

## Delivered

The retrospective feature now aggregates source-reviewed evidence mechanically,
keeping continuations together and original-task completion separate from final
deliverable quality. It makes no model calls and cannot write routing configuration.

Applied to existing evidence: **16 sessions → 14 original tasks → 23 rated
model/effort/domain cells**, supported by **26 original-scope domain observations**.
Three additional scores belong to narrowed tasks and remain in the final-scope
evidence. Multiple domains on one task are dependent observations.

The JSON covers **11 configured combinations × 21 domains (231 cells)**. Retired
Terra and Sol max are excluded. Five combinations have no reviewed observations.
The six combinations with evidence are below.

## Actual provisional ratings

Each entry is **observed grade (supporting original tasks)**. Grade is the lower
median of observed final quality on unchanged scope. **3 = meets applicable
criteria; 2 = usable with a minor defect**. A dash means unrated, never zero.
Every rated cell has only one or two tasks: **examples only; confidence uncalibrated**.

| Domain | Fable 5.1 high | Opus 5.5 high | Astra high | Astra xhigh | Luna max | Sol high |
| --- | --- | --- | --- | --- | --- | --- |
| Software implementation | — | — | 3 (1) | 3 (1) | 3 (1) | 3 (1) |
| Debugging | — | — | — | 3 (1) | — | — |
| Testing and code review | 3 (1) | — | 3 (1) | 3 (1) | 3 (1) | — |
| Architecture and systems design | — | — | 3 (1) | 3 (1) | — | — |
| Deployment and operations | — | — | 3 (1) | — | — | 3 (2) |
| Security and privacy | — | — | — | — | — | — |
| Research | — | — | — | — | — | — |
| Data analysis and statistics | — | — | — | — | — | — |
| Scientific and mathematical reasoning | — | — | — | — | — | — |
| Product planning | — | — | — | — | — | — |
| Purchasing decisions | — | — | — | — | — | — |
| Game design | — | 3 (1) | — | — | — | — |
| UI visual design | — | — | — | — | — | — |
| UX and interaction design | — | — | 3 (1) | — | 3 (1) | — |
| Art and visual assets | — | — | 3 (1) | — | — | — |
| 3D and spatial work | — | 3 (1) | 3 (2) | — | — | — |
| Animation and motion | — | — | — | — | — | — |
| Audio and music | — | — | — | — | — | — |
| Writing and editing | — | — | 3 (1) | — | — | — |
| Translation and localization | — | — | — | — | — | — |
| Technical documentation | — | — | 3 (2) | — | 2 (1) | 3 (1) |

These are different assignments. Equal grade 3 does not establish equal capability,
first-pass success, reliability or value. Luna documentation 2 versus Sol 3 is not
a controlled comparison. Astra art evidence includes a tool-generated artifact;
it does not establish standalone image generation capability.

## Completion and supervision

Original-task completion annotations: **3 met, 3 partial, 8 unknown**. Unknown
often means incomplete artifact or verification evidence, not demonstrated worker
failure. Twelve tasks have an observed worker correction; feedback opportunities
differ, so this is not an estimated mistake rate. First-delivery status remains
unknown for every task.

The collection handoff keeps its final quality 3, but narrowed scope excludes it
from the headline Luna grade. Original acceptance remains partial; coordination
mistakes and the release overrun remain visible. Reward continuations count as
one task, represented by the final reviewed report's 2. The earlier report's 3
remains in its original audit, not another independent trial.

The issue-analysis handoff is likewise excluded from the headline operations grade
because its original bulk task was narrowed. The scope rule applies to every model.

## Mechanical changes

- New `domain-outcomes-v2` jobs require original completion, final scope, cause,
  first-delivery evidence, feedback coverage and observed interventions. Unknowns
  are explicit. Original completion cannot contradict unresolved deliverables
  under unchanged scope.
- Completed v1 work stays readable and reused after the rubric upgrade. Separate
  source reviews supply missing fields without rerunning historical assessments.
- `evidence_ratings.py` validates referenced review-file hashes, complete domain
  coverage and source references. Duplicate original-task/model contributions or
  overlapping request anchors stop aggregation.
- Changed or unknown scope stays out of the headline median. All final-scope
  histograms, original-goal counts and correction evidence remain available.
- Support includes task families, projects, selection strata, missing-outcome bounds
  and leave-one-family-out sensitivity. Bounds describe this selected sample, not
  population confidence intervals. Histograms keep outliers visible.
- Identical repeats reuse outputs. Missing Markdown companions recover without
  rewriting existing evidence; changed results require a new output revision.

Lineage and semantic source review still require judgment. Aggregation and validation
are mechanical. The input is a curated contribution document, not automatic
whole-history ingestion. Matched comparisons, attributable cost and population
calibration remain absent: value ratings are null and routing eligibility is false.

## Verification and limits

**27 focused tests passed**, covering outcome constraints, v1 compatibility and
completion reuse, narrowed scope, unknowns, duplicate lineage, retired/unreviewed
exclusion, correction evidence, family sensitivity, file integrity and report reuse.
Pytest was unavailable in the active environment; these unittest suites ran directly
with the Python standard-library runner. No full release suite was run.

The production CLI built the private report and returned `reused_report: true`
on an identical repeat. Its 43 referenced prepared/review artifacts remained
unchanged. No new assessor calls were made; parent implementation/audit tokens
are additional and unmeasured.

The new output fields have structural tests and source-reviewed historical
annotations. Their accuracy on fresh autonomous assessor runs has not been
separately measured. This establishes descriptive ratings, not validated automatic
judging or best-value selection.

## Use now

Follow [Provisional evidence ratings](../../skills/model-routing/references/evidence-ratings.md)
to reproduce the table from private reviewed input. Read completion, support and
correction context beside each grade. Preserve current routing judgment while the
evidence is sparse. A useful next comparison targets a specific model/domain choice
with equivalent authority, tools and attributable resources on ordinary requested
work; another broad archive scan is unnecessary.

Development changes are on the experimental branch. Installed skills and routing
configuration remain unchanged.
