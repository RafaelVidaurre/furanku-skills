# Sample historical work within a budget

Use this before new retrospective assessments. Inventory all local sessions
mechanically; deeply assess a bounded sample. The user replaced exhaustive scoring
with representative, diverse, high-signal sampling on 2026-09-28. Retired models
remain excluded. Routing decisions and Beads use do not determine eligibility.
The [first measured wave](https://github.com/RafaelVidaurre/furanku-skills/blob/model-routing-states/docs/research/sampled-retrospective-wave-2026-09-28.md)
records the observed yield, usage, audit corrections and remaining limits.

## 1. Freeze a small selection plan

Run:

```sh
python3 <skill-dir>/scripts/history_sample.py --repo ROOT \
  --inventory PRIVATE_INVENTORY --seed RECORDED_SEED --output PRIVATE_PLAN
```

The planner makes no model calls. It uses verified native identity, the current
configured model/effort list, and exchange metadata. It records explicit exclusions
for missing exchanges and mixed attribution. Those are coverage gaps, not failures
by the historical model. Child ownership, readable contracts and context variants
still need verification before assessment.
Freeze the selected source revision before preparing evidence. Work still changing
stays pending; an unfinished session alone is not evidence of abandonment.

Default maximum is 60 sessions, at most 12 per model/effort. Allocate slots across
models before increasing common-model counts. Small populations can be exhausted;
report their small sample size rather than inventing history. Select half the slots
(rounded up) uniformly within each stratum using a recorded seed. These form the
**random baseline**. Freeze its selection before inspecting outcomes. The planner
also picks a random preview pool up to three times each stratum's allocation.
The remaining assessment slots form the **diversity supplement**, selected after
preview classification. A preview candidate is not a scheduled assessment.

Already assessed sessions remain in the sampling frame: if selected, reuse their
unchanged completed work. Removing them from the frame would change the population.
The completion ledger prevents another model call. New evidence revisions and
intentional reassessments retain the existing explicit rules.

**Complete when:** the private manifest records inventory hash, native identities,
seed, stratum sizes, selection probabilities, baseline selections, preview pool,
slot limits and exclusions. This step does not establish domain coverage.

## 2. Classify bounded previews

Prepare small evidence cards only for the preview pool. A card includes current
requested outcomes and their native anchors, project/task-family identity, time,
attributed actors, artifact availability, linked-check availability, follow-up
presence and approximate evidence size. Keep inherited parent work separate.
Encoded image bytes become artifact references; visual judgment requires viewing
the artifact later. Shell failure strings and user corrections are evidence leads,
not automatic worker-failure labels. Absence of feedback is not acceptance.

Aim for 500–1,000 input tokens per card. Preserve completeness indicators; an
incomplete contract gets an unknown label or a bounded request for more context.
An assessor classifies the requested domains against all 21 definitions, task
complexity and evidence availability. Keyword or tool-name hints may retrieve
candidates; they do not supply final domain labels. Keep labels provisional until
the deep assessment verifies the full selected task. Withhold worker model names
where feasible and disclose any identity leakage in original evidence.

**Complete when:** every preview has supported domain candidates or an explicit
unknown, evidence-availability signals and a size estimate. No quality scores are
produced by this stage. Expanding the preview pool spends a separately recorded
budget; it never grows silently to the full history.

`history_packets.py --plan PRIVATE_PLAN --output PRIVATE_DIRECTORY` prepares
native packets and bounded previews locally. Encoded media becomes a native-source
reference with a digest. Authored responses and tool calls are preserved before
long observations when the packet budget permits. Every shortened body is marked;
an excerpt cannot establish full-artifact correctness. Verify preview IDs and
citations before using classifications; invalid citations need review.

## 3. Choose the diversity supplement

Within each model's remaining slots, prefer coverage gains in this order:

1. Work domains poorly represented in the random baseline, with usable evidence.
   Explicitly inspect coverage for art/3D, UI/UX, writing and architecture as well
   as implementation, debugging and verification.
2. Different task families and projects. Normally take at most two supplement
   cases from one family; retain a scarcity exception in the manifest.
3. A range of outcome evidence: accepted results, requested corrections, repaired
   attempts, unresolved defects, external blockers and abandoned work. These are
   leads to inspect, not labels of quality or responsibility.
4. Different complexity, time periods and evidence sizes. Cheap short tasks cannot
   stand in for complex work. Use token cost as a tie-breaker among comparably
   informative cases, with seeded order as the final tie-breaker.

Avoid choosing only passing-test sessions, only unhappy users, only newest work,
or only easily read transcripts. Exact source copies count once. Related attempts
and parent/worker outcomes share a family identifier for correlation reporting.
Keep baseline cases even when unscoreable: record missingness and budget deferral.
Any additional informative replacement belongs to the supplement, never silently
replaces a baseline failure to observe an outcome.

**Complete when:** each supplement choice names its coverage gain, signal and
estimated cost; a model/domain coverage table exposes empty cells before spending
on deep assessment. Baseline and supplement membership remain separate.

## 4. Spend on bounded outcomes

Use the [native extraction](session-extraction.md) and
[domain assessment](domain-assessment.md) contracts. For a long session, identify
its substantive tasks from request/feedback anchors first, then collect complete
evidence for the selected outcome. Include the originating contract, relevant
artifact, command/result pairs, corrections and final disposition. Do not grade
a convenient excerpt as the whole session. Record the task-selection method and
eligible task count; without these, session randomization does not establish
representative task-level estimates.

Start with a wave of 12 outcomes spread across model/effort groups. Measure actual
usage, scoreable yield and audit disagreements before continuing toward the slot
ceiling. A proposed first-round envelope is **3 million cumulative input tokens**
and **500,000 generated tokens including reasoning** for instrumented assessor
calls. These are admission limits, not a forecast that all 57–60 cases fit or a
subscription-quota conversion. Parent implementation and manual audit usage must
be reported separately when its harness cannot expose comparable counters.

`assessment_run.py --prompt FILE --decision GATE_JSON --output PRIVATE_CALLS`
runs a tool-free, ephemeral Codex assessor with the gate's model/effort. It retains
prompts, raw events, reported input/cached-input/output usage and the final result.
Concurrent calls reserve capacity under a local lock. Completed calls reuse their
prompt/model/image identity. Usage includes cached input; it is never subtracted
from total context processed. Missing or failed-turn usage blocks further calls
until reconciled. Failed attempts never receive a zero-cost assumption.

The CLI has no exposed hard generation cap: a call may exceed its reservation.
Budgets stop subsequent admissions, and reservations cover concurrent calls;
do not describe this as a hard in-flight token ceiling. Authentication stays with
the active Codex account. The runner ignores user configuration to keep tools and
project instructions out; use it only with the standard Codex launch surface
whose account and model were gate-checked.

`sample_assess.py --packet SAVED_NATIVE_PACKET --output PRIVATE_CASE --calls
PRIVATE_CALLS --decision GATE_JSON --repo ROOT --seed RECORDED_SEED` claims
extraction, restores original evidence for preparation, and selects one eligible
task uniformly by seed. It then claims, assesses and structurally validates the
task, allowing one output repair. Completed tasks reuse the global ledger. A
completed case directory reopens without calls; after an interrupted partial run,
use a new attempt directory so the ledger can reuse completed stages while keeping
earlier artifacts. A running claim remains owned until its worker is confirmed
stopped. The ledger records raw judgments as unreviewed; save semantic corrections
separately. Source revisions need new directories.

For visual assessment, attach verified original images through the saved packet's
`visual_artifacts` entries (`source_id`, `path`, `sha256`). Recover them from native
records and retain provenance before adding entries. The runner includes image
digests in cache identity and checks file digests before launch. The routing gate
must require vision. Record tool-generated artwork as an agent-plus-tool outcome,
not direct evidence of the routing model's standalone image-generation ability.

Audit the first wave fully. Once its source-support and rubric errors are resolved,
audit a random fraction of subsequent results plus every surprising, negative or
low-confidence judgment. Keep assessor output repairs separate from worker mistakes.
Stop for a systematic provenance error, repeated unsupported scores, exhausted
budget, or poor scoreable yield; fix the cause before expanding.

**Complete when:** the wave has source-backed results or explicit exclusions,
measured usage, a semantic audit and cache-reuse evidence, with no unpaid/untracked
follow-on work or claim that unexamined tasks were assessed.

## 5. Learn selectively

Publish baseline and supplement results separately. Preserve selection probabilities
for any population-weighted baseline estimate, and report missingness and task-family
correlation. The supplement supports domain discovery and failure analysis; its raw
success rate is not a model's normal success rate. Mixed-actor exclusions restrict
the population of any initial estimate and must stay visible.

Prefer within-domain, similar-difficulty comparisons. Report distinct sessions,
distinct task families, observable criteria and uncertainty for every model/domain
cell. Many cells will remain low-confidence after the first round. Use additional
small batches only where evidence could change a real routing choice, including
uncertain cheaper alternatives; preserve a random portion of each new batch.
Do not fill empty cells with invented scores or declare enough evidence solely
because a fixed number of sessions was reached.

This split follows the distinction between probability sampling and purposeful
selection: [Statistics Canada explains the selection bias of judgment and quota
samples](https://www150.statcan.gc.ca/n1/edu/power-pouvoir/ch13/nonprob/5214898-eng.htm).
The particular allocation and spending envelope here are engineering choices for
this experiment, not statistical guarantees from that source.

**Complete when:** the report identifies what the sample can support, which routing
comparisons remain uncertain, and the specific information a further batch would
add. Exhaustively grading the archive is not a completion requirement.
