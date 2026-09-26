# Astra adversarial review and corrections

## Outcome

At the user's request, GPT-6 Astra high completed the review that the earlier
Fable worker could not finish. It reviewed commit `ba25983` against `00ab187`,
inspected saved private trials, and reproduced acceptance and inventory defects.
The full report remains in the private retrospective store. This document contains
the non-identifying findings and observed follow-up results.

Two existing development cases now meet their reference checks. This establishes
a working positive example and a correct unattempted-work example; it does not
validate the entire procedure or historical model rankings. Installed skills and
routing scores remain unchanged.

## Findings and disposition

| Finding | Correction or remaining limit |
| --- | --- |
| Support verified one ordinal level but acceptance published an unchecked weighted mean | Eligible scores now publish only the verified ordinal. Raw means and distributions remain estimates; cause checks use that ordinal. |
| Selecting one citation discarded the artifact and other observed evidence | Quality packets retain all parsed task events when bounded input permits, including source order and contrary observations. Citation IDs locate evidence. Retrieved instruction fragments remain excluded from quality. Large evidence retrieval still has incomplete-coverage limits. |
| Grok inventory trusted mutable session summaries while scoring used actual turn metadata; Claude inventory missed `perTurnEffort` | Inventory now follows actual assistant metadata and carries summary fallback explicitly into the census. Hermetic tests cover inventory through task assessment. Existing inventory artifacts must be rebuilt; distinct model IDs are not guessed equivalent. |
| Benchmark could ignore accepted unreferenced outcomes or pass with no positive evidence | Required/allowed/score scope and intervals are validated. Unreferenced accepted quality or repair fails. Positive coverage is mandatory; full validation additionally requires positive and negative held-out checks. Development and subset results have separate statuses. |
| Artifact assessability and final support used inconsistent wording | Support explicitly permits evaluating supplied prose/code against directly observable requirements, while still rejecting unsupported completion claims and unrelated tests. Paired live evidence below supports this correction for one writing case. |
| Domain definitions and reference expectations overlapped | Taxonomy v7 distinguishes game-system design from authoring content within a specified design, includes local machine maintenance in operations, and provides the classifier's single canonical involvement scale. Remaining uncertainty is reported. |
| Saved prepared requests omitted the enforced provider restriction | Cache hashing and storage now use the canonical validated request sent to the client. Backend revision is still unavailable from the response fields this client supports; the generic model alias must not be treated as a pinned revision. Arbitrary raw provider metadata is not retained. |

## Controlled wording probe

One real Gateway request contained two independent Choice questions on identical
source state and the same quality claim. Only support wording differed:

| Wording | Selected answer | Support probability |
| --- | --- | ---: |
| Original result/check/feedback wording | Insufficient | 0.42 |
| Explicit direct-artifact evaluation wording | Supports | 0.97 |

The earlier cached original response was 0.41. This paired observation supports
the wording hypothesis for this artifact. It is not a general accuracy estimate,
and its probabilities are not measured correctness rates. Thresholds were unchanged.

## Production task-assessor development run

Both cases were already inspected, so both were explicitly labeled development.
The writing score reference and operations no-score reference stayed unchanged.
The taxonomy revision and benchmark hash were recorded before the run.

| Historical case | Required domain | Accepted quality | Reference result | Remaining uncertainty |
| --- | --- | ---: | --- | --- |
| Complete short writing deliverable | Writing | 3 of 4, supported ordinal | Pass | Game design, localization, and documentation remained unresolved; no extra domain was confidently accepted. |
| Local maintenance request with an intent announcement only | Operations | Unknown | Pass | Work was not attempted; no model performance score was inferred. |

Writing's raw estimate was 2.98, with source support 0.97. The full run used six
fresh requests and honored one approximately 28-second server cooldown. It
reported `passed_checks_unvalidated`, with a nonzero exit status, because these
are development cases rather than held-out validation.

The live result retains exact source, code and taxonomy hashes. Subsequent offline
review added explicit source-order metadata, policy-fragment exclusion, split-name
normalization and repair-reference checks; those follow-ups have regression tests,
not a separate live accuracy claim. The one-question probe is not substituted for
the end-to-end task assessment.

## Verification and remaining work

120 relevant hermetic tests passed: 108 retrospective tests, seven inventory tests,
and five census tests. They cover supported ordinal versus unchecked mean, retention
of an artifact plus check plus later contradiction, authority-fragment exclusion,
benchmark reference scope, split semantics, canonical request caching, and native
model/effort attribution. Tests establish mechanics, not semantic accuracy.

Before bulk scoring or installation: independently freeze fresh positive and
negative examples across native history providers; validate repair observations
and larger evidence bundles; assess domain abstention and boundary accuracy;
exercise native segmentation; rebuild inventory/census; and audit accepted evidence.
Backend revision uncertainty and evidence omitted by bounded retrieval remain
limitations. No all-history scoring or capability-table calibration was completed
by this review.
