# Jev retrospective integration audit

## Conclusion

The earlier feasibility report overstated what the experiments established.
The tested procedure is unreliable, but Jev's suitability remains unresolved:
input loss, contradictory acceptance rules, and uncalibrated classification
confound the experiment. Keep bulk scoring stopped while correcting and testing
the procedure. A reasoning reviewer remains a comparison candidate, not a
proven necessary replacement. No runtime or installed skill changed in this audit.

## Actual request evidence

Two request bodies were reconstructed from saved experiment inputs and matched
to completed cache entries using the scorer's request digest. Client validation
then reproduces the provider restriction in the transmitted body. These are
verified reconstructions, not network captures. Full bodies stay in the private
machine-global retrospective store under `jev-docs-audit-2026-09-26/`.

- `example-actual-wire-payload.json`: one complete recorded passing test output,
  with two independent Choice questions asking whether it establishes documentation
  quality and whether it records passing tests. Jev correctly answered no and yes,
  respectively, with selected-option probability and returned confidence 1.
  This is a focused follow-up probe, not the original full-task assessment.
- `failed-documentation-score-wire-payload.json`: a roughly 17 KB request with a
  task packet, three source excerpts, and prior assessment. Six Choice questions
  rate final quality and rework for implementation, verification, and documentation.
  Jev rated documentation 3 with probability 0.87 and confidence 0.85 despite the
  selected support being software test output. The final-quality rubric explicitly
  allowed repaired errors, so this follow-up must be distinguished from the older
  combined quality rubric and its contradictory acceptance gate.

## Confirmed implementation findings

These findings describe the pre-repair implementation. The subsequent
[typed integration report](jev-typed-validation-2026-09-26.md) records the code
changes, failed live validation, and outstanding review.

| Finding | Code evidence | Consequence |
| --- | --- | --- |
| Choice is the only supported primitive | `scripts/jev.py`, `validate_request` and `validate_result` | Ordered quality levels and yes/no checks never exercise the documented Score and Boolean primitives. This is an untested alternative, not proof that switching fixes accuracy. |
| Large tool bodies are removed before retrieval | `scripts/task_retrospect.py`, `read_turns`, `TOOL_BODY_BYTES = 4000` | A source pointer cannot substitute for the decisive output; recognized checks retain summaries, but other large results lose their contents. |
| Retrieval splits serialized JSON every 1,200 characters | `fragments_of` | A fragment can start mid-value and lose its semantic context. Source IDs preserve provenance, not interpretability. |
| Domain page aggregation selects the strongest involvement label | `classify_requests` ranks central above supporting, absent, unresolved | One positive page dominates all negative pages, without confidence or evidence reconciliation. |
| Domain eligibility ignores uncertainty | `assess_task` activates every supporting/central answer | A near-tied classification is treated as involved. One follow-up architecture answer had probabilities 0.48 versus 0.47 and confidence 0.23; it should not support a confident error or domain conclusion. |
| Quality rubric and acceptance gate conflict | `QUALITY["3"]` allows minor corrections; `assess_task` excludes every 3/4 with cause `model_error` | A valid final success after a small repair can be discarded. This is a code/rubric defect independent of evaluator quality. |
| Citation checks do not establish semantic support | `assess_task` checks source kind, actor, body presence, and recognized check metadata | A real test-result citation can still fail to support a documentation-quality claim. |

Paths in the table are relative to `skills/model-routing/`. Additional design
problems include rubrics that mix final quality, repair burden, causal blame,
evidence strength, and explicit praise; overlapping domain boundaries; and
request-only classification when the actual requirements live in a referenced
work record. Passing earlier unverified assessments into later state may reinforce
errors, but this audit does not isolate or prove that causal effect.

## What the official guidance changes

The [companion source survey](jev-official-guidance-2026-09-26.md) records the
contracts and caveats in detail. The relevant implications are:

1. **Use the primitive appropriate to the judgment.** On our existing Gateway
   `/v1/evaluate` endpoint, yes/no is `boolean` returning `probability`, categories
   use `choice`, and ordered ratings use `score` with an array of descriptions.
   TypeSafe's own `noul` name belongs to its direct/compatible API. Do not paste
   that name into the wrong contract. [Gateway evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation).
2. **Keep each question focused; compose in code.** Independent questions sharing
   state can and should be batched. They do not read one another's answers. An
   additional call is useful when an answer changes what evidence or options must
   be fetched, not merely to simulate sequential reasoning. Question IDs are not
   visible to the underlying model; each instruction must contain the judgment.
   [Primitives](https://docs.typesafe.ai/primitives).
3. **Write standalone scale descriptions.** Score levels are evaluated without
   their numeric positions or neighboring levels. Separate final quality from
   model-caused repair burden; missing evidence is an eligibility condition, not
   an ordinal quality level. A Score is not automatically a calibrated success
   probability. [Score](https://docs.typesafe.ai/primitives/score).
4. **Verify the claim-source relationship.** Mechanically verify quoted spans,
   then judge supports/contradicts/says-nothing using the claim and surrounding
   source. A candidate ranking or existing source ID does not establish support.
   [Citation checks](https://docs.typesafe.ai/cookbooks/citation_check),
   [semantic search](https://docs.typesafe.ai/cookbooks/semantic_find).
5. **Calibrate uncertainty on our examples.** Confidence describes distribution
   concentration, not correctness. Use tested review bands and report coverage,
   false positives, and high-confidence mistakes. The client already reads
   TypeSafe confidence separately from selected-option probability; the task
   assessor does not use it. [Confidence](https://docs.typesafe.ai/confidence).

The client already provides explicit instructions, unknown/none alternatives,
provider restrictions, response validation, caching, and shared rate-limit
handling. Batching questions is not itself a mistake. Improving primitive choice
alone will not repair missing evidence or contradictory contracts.

## Bounded validation before another corpus run

1. Fix the input and gate defects; preserve meaningful evidence units and resolve
   task references. Keep actor attribution and external failure separate from
   quality. Missing visual/audio artifacts remain unassessable by a text judge.
2. Freeze a small source-audited development set and a separate unseen set with
   successes, repaired errors, unresolved defects, external failures, changed
   requests, overlapping domains, and absent evidence across providers.
3. Compare focused variants on identical evidence, changing one factor at a time:
   primitive, rubric, evidence selection, and semantic citation verification.
   Batch independent checks and make eligibility/aggregation mechanical.
4. Define acceptance criteria before running the unseen set. Report domain
   precision/recall, score agreement, source-support errors, accepted coverage,
   reviewer agreement, API cost and total processing cost. Do not count the eight
   already-inspected successful probes as unseen validation.
5. Decide whether Jev alone, a hybrid, or a reasoning reviewer meets the target.
   Only a validated procedure can justify corpus-wide scoring or routing updates.

This audit adds no new retrospective scoring trials and establishes no aggregate
model/effort/domain scores. It corrects the interpretation of existing results.
