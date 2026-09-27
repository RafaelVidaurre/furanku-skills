# Sol medium retrospective assessment pilot

## Decision

Use GPT-6 Sol at medium for the experimental prepared-task assessment path.
The comparison supports this change over further JEV-only tuning. It does not
establish full-history coverage or calibrated per-domain model rankings.

The assessor used the requested model/effort through the actual agent launcher,
with a fresh context that excluded gold answers and previous experiment results.
It received requirements, source bodies, and source IDs; the native test also
included all 21 domain definitions and explicit command/result links. Exact
checks could use local code. No historical commands were executed.

## Results

| Evaluation | Supported requirement matches | Notes |
| --- | ---: | --- |
| Previously constructed development controls | 18/18 | Correct verdicts and source bundles |
| Previously constructed held-out controls | 18/18 | Unseen by Sol; previously consumed by JEV |
| Previously examined historical diagnostics | 5/6 | One provenance ambiguity retained as a failure |
| Fresh native task packets | 9/9 | Five met, four unknown; no invalid support |

The 42-requirement comparison therefore scored **41/42** and failed its strict
zero-false-positive criterion. Sol accepted a success observation whose originating
checker was not linked in the offered packet. The reference had been corrected
to unknown before this run. Independent review considers the observation's scope
ambiguous, but the frozen mismatch remains. Four exact checks used calculations.

Fresh native domain recall was **5/5 (100%)** and precision **5/6 (83.3%)** against
frozen required/allowed labels. These meet the precommitted 80% thresholds.
The extra operations label came from explicit commit/sync/push instructions,
which the reference treated as incidental delivery work. This is a boundary
disagreement to resolve in the rubric, not evidence of fabricated work.

The fresh native test passed its frozen requirement and domain criteria. Astra
independently audited the explanations, source support and native provenance.
The prepared packets retained 53 source anchors; native file hashes and recorded
worker model/effort were checked. Preparation and references were frozen before
Sol saw the cases. Private inputs, raw results, references and digests remain
under the machine-global retrospective directory; no transcripts are published.

## Observations about the historical workers

These are three sampled tasks, not three fully assessed sessions. Requirements
within a task are correlated; they are not independent model samples.

| Sample | Historical worker | Required domains | Requirement observations |
| --- | --- | --- | --- |
| Disk artifact audit | GPT-5.6 Terra / max | Testing and code review | 3 met |
| Tooltip code review | Claude Opus 5.5 / high | Testing and code review | 2 met; 1 unknown without runtime evidence |
| Process lifecycle repair attempt | GPT-6 Sol / high | Implementation, debugging, testing and code review | 3 unknown; blocked before substantive edits |

The blocked task contributes domain labels and an evidence gap, not a low worker
score. The same task's requirements are not duplicated into independent scores
for each involved domain. These observations cannot support a broad numeric
quality table yet. No new Grok task or visual/art/3D quality was validated here;
eligibility for future analysis still includes every configured provider and effort.

## Resume behavior

The new `assessment_store.py` records source revision, canonical native identity,
task/session scope, procedure, attempt lineage, output and failure. Completed
unchanged work is skipped. Rubric/procedure changes require explicit reassessment;
source changes produce a new revision. Failed attempts remain retryable, and live
claims block duplicates. Structural completion remains explicitly unreviewed for
semantic correctness. A task sample cannot complete its parent session.

The three completed native task assessments were imported after this pilot, then
claimed again: **3 reused results, 0 new assessments**. This is a resume test of
actual stored outputs, not a second evaluator run. The agent procedure requires
claiming before future launches. Existing JEV results have not been migrated.

Nine hermetic ledger tests cover reuse across restart, explicit reassessment,
new revisions, failed retry lineage, live claims, scope isolation and partial
output rejection. All 71 router tests pass, including a fix for explicit
model-effort shorthand and guards against hyphenated adjective false matches.
Adversarial review found and prompted fixes for rubric-triggered reassessment,
failed reassessment fallback, completion semantics and Unicode dash boundaries.

## Scope and next work

The prepared-task pilot is useful enough to adopt experimentally. It has not
validated automatic native task extraction, whole-session coverage, historical
worker-defect discrimination, ordinal score calibration, or broad domain quality.
The fresh native set is small and contains no observed substantive worker defect.
Constructed controls cover incorrect deliverables; they cannot replace natural
negative cases. Agent cost and latency were not measured comparably to Gateway
charges, so this is not a cost-efficiency benchmark.

Next, integrate the agent assessor with source-preserving task preparation and
the ledger across a representative census batch, audit extraction and negative
cases, then calibrate domain observations using independent task counts. Keep
JEV's prospective routing value a separate evaluation question. Its use for
routing is not justified by this retrospective test.

The implementation remains on the development branch. Global skill installation,
the machine's routing selector, and production score tables were not updated.
