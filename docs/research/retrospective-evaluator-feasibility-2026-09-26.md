# Historical scoring: evaluator feasibility

## Decision

Stop scaling the Jev-only retrospective scorer. The current approach is not
suitable as an unattended source of routing scores. This is a method-selection
result, not a claim that learning from history is impossible. A reasoning reviewer
with source access is the proposed replacement; that replacement is unvalidated.
Installed skills, model configuration, and routing scores were unchanged.

## What was tested

The previous five-session experiment retained 12 requests but produced no
evidence-eligible scores. It mixed evidence-retrieval failures with evaluator
errors. This follow-up separated those problems:

| Experiment | Input | Result |
|---|---|---|
| Staged outcome assessment | Five previously audited sessions; manually selected source excerpts, including decisive tool results; worker identities withheld | 14 successful calls; 12 numeric final-quality estimates. Some useful quality/rework distinctions, but unsupported cross-domain scores remain. |
| Focused probes | One selected test result and two request sets; eight literal questions | All eight matched the source-based expectations. This diagnoses question sensitivity; these are development examples, not independent accuracy evidence. |
| New-session classification | Five other historical sessions spanning Codex, Claude Code, and Grok; all 21 domains, simplified involvement questions | Two clear taxonomy violations, one missing-requirements input defect, and ambiguous overlapping labels. The new format did not establish general reliability. |

The staged packets and probe expectations were recorded before inspecting their
results. New-session references were fixed before evaluation. These are
purpose-selected samples, not a random or representative benchmark. The staged
rubric separates final quality from rework; its numeric results are not directly
comparable with the previous combined quality rubric. New sessions were tested
for classification only, not outcome scoring.

There were 22 successful API calls in total. Their returned cost metadata sums to
$0.004844238. This excludes the reviewing agent's work, failed requests without
cost metadata, and earlier experiments. API price is not the rejection reason.
Rate-limit responses reported request allowance 5, remaining requests 0, and
tokens still available. The client honored server delays; one bounded waiting
budget expired and the run resumed from cached calls. The precise request window
and enforcing layer were not established.

## Findings

- **Attempt and cause can be separated successfully.** Unattempted work remained
  unscored. An accepted implementation received final quality 3 with minor rework;
  a corrected review received 2 with substantial rework. An environmental failure
  produced no model-rework penalty. Canceled implementation remained assessable.
  These are promising observations, not calibrated model scores.
- **Evidence still leaks across domains.** Passing software tests were selected
  as the support for documentation quality 3, with returned confidence 0.85. The
  same test output, presented alone with a literal documentation-evidence question,
  was correctly rejected. Selecting a real source ID is insufficient: the source
  must support the particular domain and claim.
- **Broad labels remain unreliable.** The staged run called a security review
  science and an environment-recovery review writing. Narrow questions recovered
  the expected labels on those examples, but the new-session classifier still
  assigned ordinary writing to technical guide work despite the taxonomy's
  exclusion, and architecture to a local function refactor despite an explicit
  boundary in the revised criterion. The latter answer had low confidence; the
  former returned confidence 0.80.
- **Not every disagreement is an evaluator error.** A refactoring request deferred
  its requirements to a work record. Request-only classification lacked that
  record and missed testing. This is an input defect. Writing labels on translation
  and research reports are ambiguous under the current overlapping taxonomy;
  they are not counted as clear mistakes. Do not report a misleading overall
  accuracy percentage from these references.
- **Preparing an adequate packet itself requires reasoning.** Task references,
  authority, author identity, repaired errors, final acceptance, and domain-specific
  evidence must be reconciled. A sequence of independent Choices does not perform
  that reconciliation reliably enough in these experiments.

TypeSafe documents independent questions and recommends narrow, atomic judgments
in its [introduction](https://docs.typesafe.ai/introduction). Its
[Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) discuss
indirection, irrelevant context, literal interpretation, and inconsistent
structural relationships between answers. These limitations are consistent with
our observations; the Gateway alias does not prove which exact upstream version
served this run. The result establishes unsuitability of the tested procedure,
not impossibility for every future Jev version or prompt.

## Proposed replacement

This is a design for the next experiment, not an implemented or validated scorer.

1. **Keep mechanical evidence handling.** Inventory all configured model/effort
   combinations across native histories, including disabled and explicit routes.
   Deduplicate aliases, preserve tool output and chronology, and identify each
   actor from recorded metadata. A Jev routing link is unnecessary. Resolve task
   references from historical records; Beads remains optional. Record missing
   references instead of silently treating the title as the full specification.
2. **Use a reasoning reviewer to reconstruct and assess work.** Give it bounded
   access to complete source records and artifacts. For each task/domain, require
   the requested outcome, the target actor's contribution, final quality,
   model-caused rework, cause of non-delivery, and citations plus an explanation
   tying each score to evidence. Separate confidence in evidence from quality.
   Visual/audio judgments require the actual artifact through a capable reviewer
   or specific user feedback. User silence is not acceptance.
3. **Validate before aggregation.** Code verifies source IDs, quoted spans, actor
   attribution, and required fields. A focused Jev claim/source check may help,
   but neither a plausible citation nor evaluator confidence establishes truth.
   Audit all pilot rows independently against sources. Include successes, actual
   mistakes, changed requirements, external failures, mixed actors, missing
   artifacts, and non-code work across providers. Fix references before judging;
   reserve unseen cases and set acceptance thresholds before running them.
4. **Aggregate interpretable outcomes.** Report demonstrated requirement satisfaction
   and substantial model-caused rework separately for each model/effort/domain.
   Keep unknowns, coverage, and exclusions visible. Use partial pooling and
   intervals, with project/task-family clustering so many repeated templates do
   not pretend to be many independent experiments. Validate the estimator before
   choosing prior strength or allowing routing updates. Raw ordinal grades are
   not interchangeable with calibrated success probabilities.
5. **Compare value only where the evidence permits it.** Stratify by task difficulty
   and criticality; harder assignments are not evidence of a worse model. Keep
   observed tokens, latency, monetary cost, and subscription-quota burden distinct.
   Use repair burden and probability of an acceptable result alongside cost.
   Historical associations alone do not prove which model would have performed
   better on the same task. Sparse or incomparable cells remain uncertain.

The domain schema also needs a deliberate distinction between work types
(implementation, review, documentation), subject areas (security, games), and
criticality. Overlapping labels can be useful, but they must not multiply the same
evidence or invent separate performance scores for incidental activity.

## Reproducibility and status

Private artifacts are stored under the machine-global retrospective directory in
`complete-evidence-trial-2026-09-26/`: source packets and provenance hashes,
expectations, exact question dictionaries, validated cached responses, per-case
results, the resumed fifth result, focused probes, and new-session classifications.
The original failed run and references remain intact. No private transcripts or
identifying session data are published here.

There is no validated aggregate model/effort/domain table from this experiment.
The full historical corpus was not scored by the new procedure. Preserve these
negative and mixed results; resume implementation only with a revised evaluator
design rather than scaling the failed scoring procedure.
