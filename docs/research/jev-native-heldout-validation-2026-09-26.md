# Native retrospective validation: failed

## Decision

The native pipeline failed all four independently referenced historical cases.
It accepted zero of the three expected positive domain-quality observations
(across two positive tasks). Keep bulk scoring, routing-table calibration, and
global skill installation paused. The earlier two development successes did not
generalize through native task segmentation and evidence retrieval.

This is a failure of the current retrospective procedure. It does not establish
that the historical worker models performed poorly, nor isolate whether Jev can
judge a complete, correctly scoped outcome packet reliably.

## Protocol and scope

- Evaluated commit: `4438d54`, task pipeline v9, domain taxonomy v7.
- Astra independently inspected the original transcripts, fixed task boundaries,
  domain references, quality ranges and repair expectations before the run.
- Frozen reference SHA-256:
  `acfd6a3e8d43b1281562fc98036b27e453f34bd5861c66157c359e797c1a7f82`.
- Original source hashes and parsed-turn equality were checked before evaluation.
  The production `task_retrospect.py` CLI ran discovery-selected native records,
  including segmentation. No external Beads enrichment was added. Work records
  already present in historical tool outputs remained available to the parser.
- One selected request had previously appeared in request-only triage inventory;
  no prior domain/outcome judgment for these native session identities was found.
  Held-out here means outcomes had not guided procedure tuning, not that requests
  had never been inventoried.
- Provider calls used the previously authorized no-ZDR mode with prompt training
  disallowed. Selected redacted evaluation packets were sent through the configured
  Gateway to TypeSafe/Jev. Raw archives and persisted experiment artifacts remained
  machine-private and were not committed to the public repository.
- The CLI exhausted one 300-second additional-wait budget and resumed from cached
  calls. It honored server cooldowns, approximately one minute; observed Gateway
  request-limit headers reported five requests. Finishing the batch is not a
  validation pass.

These cases were selected for diagnostic coverage, not randomly sampled to
estimate corpus accuracy. Having inspected their outputs, treat them as
development cases for subsequent revisions. Preserve this original failure.

## Per-session results

Quality uses an ordinal 0–4 scale: 3 means the main requested requirements are
demonstrated; 4 requires substantive performance beyond the requested standard.
Unknown means no supported observation, not zero quality. Repair burden is
separate, 0–3; zero requires observed evidence of no model-caused repair.

| Historical session | Model / effort | Frozen expected domains and quality | Actual labels and quality | Verdict |
| --- | --- | --- | --- | --- |
| Canceled test-bootstrap assignment | GPT-5.6 Terra / max | Implementation, debugging, verification; all unknown because canceled before work. Documentation allowed, unscored. | Implementation/debugging absent; verification unresolved. Writing also unresolved. No quality stage reached. | Fail: three required domains missed. |
| Execute CLI path/version inspection | Claude Opus 5.5 / high | Operations: quality 3, repair 0. | Request mistaken for housekeeping; retained with uncertain task boundary. Operations unresolved; no quality stage reached. | Fail: task boundary, domain, quality and repair coverage. |
| Remote tests blocked before execution | Claude Opus 5.5 / high | Verification and operations, quality unknown. Implementation allowed, unscored. | Classification response rejected by client distribution validation. No labels or scores available. | Fail: evaluator error; not evidence about worker quality. |
| Compare HEAD/base test results | Claude Opus 5.5 / high | Verification 3 and operations 3; repair unknown. The requested comparison can succeed even when both test runs fail. | Verification found; operations absent; unexpected debugging. Raw quality estimates: verification 2.64, debugging 2.58. Neither accepted. | Fail: domain scope and positive score coverage. |

Only one of eight required case/domain labels was accepted; one unexpected domain
was accepted. All four cases failed the frozen comparator. No supported quality
or repair observation was produced. Negative examples staying unscored do not
prove their procedure worked: one missed domains and the other failed before
classification completed.

The machine-private artifacts include a per-case comparison and an 84-row CSV
(four sessions × every one of the 21 domains), including expected scope, actual
labels, raw estimates, accepted values, and exclusion reasons. Private records
are deliberately not included in this public repository.

## Where the failures occur

1. **Task requirements are omitted before classification.** Two requests refer
   to work records fetched in their tool history. Classification receives the
   short dispatch and later cancellation/feedback, but not those retained
   requirements. In the comparison case, retrieval later selects a policy tail
   while dropping the fragment containing the actual conditional acceptance
   criteria. This is an input-construction defect. Its exact contribution to
   Jev's answers needs a controlled development comparison.
2. **A complete command request is mislabeled as housekeeping.** The CLI case
   contains the whole requested action. Jev selects control with probability
   .89. This is a semantic segmentation error; no missing evidence explains it.
   Domain involvement for operations is only .29, independently missing the
   expected label. Lowering confidence thresholds would not justify either.
3. **Acceptance checks disagree with the supplied evidence bundle.** For the
   comparison, actual HEAD/base logs are in `other_observed_sources`, but the
   selected citation is the final assistant summary. The old mechanical gate
   checks selected citations alone and rejects the recorded check. Assessability
   is also .78, below the unchanged .85 threshold: fixing the mechanical gate
   alone cannot make the case pass. The semantic support stage was never reached.
4. **A rejected distribution lacks a precise failure record.** Sum validation and
   selected-option consistency share the same error string. The rejected raw
   response was not retained, so the live cause cannot be recovered. An independent
   offline reproduction found that a nominal sum of 1.02 fails the intended .02
   tolerance because of floating-point representation. That confirmed client bug
   is not proven to have caused this live rejection.
5. **An uncertain empty task is reported as assessed.** Pending status examines
   domain exclusions, overlooking an unresolved boundary when there are no active
   domains. This hides uncertainty in session-level coverage.

## Post-run mechanical hardening

The follow-up diff is pipeline v10; it does not alter or re-label the frozen run.

- Inclusive numeric tolerances tolerate floating-point edge error only. Invalid
  sums, non-maximal selected choices, and inconsistent scores still fail.
- Invalid distribution diagnostics preserve the zero-based question index,
  question type, fixed reason category and relevant finite numeric values through
  the bounded subprocess and task failure record. A canonical request digest
  correlates the failure. Arbitrary provider text and option contents are omitted;
  invalid answers never enter the successful-answer cache. Segmentation failures
  retain diagnostics and are resumable on a later invocation.
- Pending session status includes uncertain task boundaries and pending repair
  judgments, including tasks with no active domains.
- Recorded-check availability examines the actual supplied event bundle, with
  target-actor attribution and output-bearing bodies/fragments. Omitted bodies,
  body pointers, metadata-only fragments and other actors' checks cannot establish
  availability. Assessability and semantic claim support remain independent gates.

97 targeted hermetic tests verify these mechanics, including Astra's follow-up
findings about fragmented body pointers and segmentation diagnostics. They do not
establish semantic accuracy. No new live semantic run has been performed with
v10, no routing scores were changed, and the installed skill was not updated.

## Historical coverage

The refreshed local inventory contains 10,342 sessions, with no discovery errors:

| Native source | Inventoried sessions | Exact configured model/effort matches |
| --- | ---: | ---: |
| Codex | 8,454 | 1,738 |
| Claude Code | 1,010 | 496 |
| Grok | 878 | 0 |
| Total | 10,342 | 2,234 |

Disabled and explicit combinations remain eligible for retrospective learning.
These are inventory counts, not assessments or supported scores. The legacy
bounded single-model projection reports 2,121 projected, 25 without an exchange,
38 mixed/unattributed and 50 unprojectable; those diagnostics are not exclusions
from the newer task parser.

Grok's observed historical `grok-4.7-build/high` does not exactly match the routing
ID `grok-4.7/high`. No authoritative alias mapping was established by the native
catalog/metadata audit. Preserve distinct IDs. All Grok sessions were inventoried,
but this run supplies no Grok scoring validation and cannot claim provider-wide
coverage. Missing identity mapping is not poor model performance.

## Next validation

1. Build a source-linked requirements packet before classification and outcome
   retrieval. Preserve the contemporaneous assignment and conditional acceptance
   criteria separately from policy, outcome claims and unrelated tool text.
2. Compare original versus repaired inputs on these now-development cases. Include
   positive command execution and genuine housekeeping controls. Keep thresholds
   and original reference judgments fixed; record packet and output differences.
3. Once development checks succeed, freeze new positive and negative cases before
   evaluating. Include native segmentation, repair evidence, multi-domain work and
   provider identity checks. A fresh pass must produce useful supported positives
   as well as correctly unscored negatives.
4. Only then process eligible history and audit coverage. Calibration still needs
   correlated-task controls, difficulty comparisons, uncertainty and outlier
   resistance before any routing table is changed.

The calibration epic remains open. No full-history scoring or model ranking has
been established by this experiment.
