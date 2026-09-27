# Task-context repair: initial access failure and development follow-up

## Status

Subsequent update: purchased Gateway credit restored access. The
[development rerun](jev-restored-access-development-2026-09-27.md) passes one of
four full case checks and accepts one positive quality observation. The initial
blocked attempt below remains part of the record; semantic validation is still
incomplete.

The source-retention repair and prompt revision are implemented in task pipeline
v11, taxonomy v8. Astra reviewed the changes; 67 targeted hermetic tests pass.
The live development run stopped before its first assessment with Gateway HTTP
403, `no_providers_available`. There are **zero new scored sessions** and no new
semantic accuracy claim. The four frozen failures from the
[previous run](jev-native-heldout-validation-2026-09-26.md) remain failures.

No installed skill, routing configuration or capability score was changed.
Bulk assessment and installation remain gated on successful fresh validation.

## Repair

The two demonstrated missing-contract cases now retain their full original work
record bodies through classification and outcome assessment. Source selection is
mechanical and adds no evaluator request:

1. Identify explicit issue/work-record references and files or URLs named as task
   contracts, assignments, specifications or acceptance criteria.
2. Match literal operands of supported recorded reads, then use native tool call
   IDs to attach their results. Retain source ID, call source ID, turn, matched
   references and original body. Later requests do not retroactively relabel an
   earlier unrelated read.
3. Supply that context alongside task text to classification, and preserve it
   separately during evidence retrieval, quality assessment and claim support.
   A context packet that cannot fit remains pending; it is not silently dropped.
4. Label mixed bodies as historical task context. A read may include policy,
   previous examples and claims as well as the requested acceptance criteria.
   Those contents do not establish authority, task completion or worker quality.

The adapter recognizes a deliberately small reader set and structured read tools.
It neither executes commands nor queries files or issue trackers. Beads is not a
dependency: existing issue-read evidence is usable when present, and file-based
contracts use the same mechanism. A separate exported-Beads enrichment remains
optional.

Astra found and the implementation corrected false matches from quoted command
examples, search patterns, same-prefix issue IDs, concatenated shell words and
heredoc text. Incidental input/output files no longer become mandatory contracts;
the blocked-tests development case now pins no unrelated source bodies. Both
originally omitted work records remain linked in full.

**Limitations:** this is not a general shell parser or semantic reference resolver.
Bare-path assignments without recognized contract wording, dynamic expressions
and unsupported readers can be missed. Large genuinely referenced mixed bodies
can still exceed the judge budget. Passing these linkage checks does not prove
that Jev correctly interprets the restored requirements.

## Command-request revision

Task segmentation now explicitly includes command execution and environment
inspection as work, even when requested in one line. The operations domain
explicitly covers installed-tool/version and host-state inspection. Software
testing remains verification; separate host setup/restoration can involve
operations. Confidence and score acceptance thresholds are unchanged.

These revisions were motivated by already-inspected failures. They are development
changes, not held-out evidence. The next controlled check must include command and
natural-language environment inspections, software-test execution, genuine
housekeeping, and task continuation/cancellation. Only a subsequent fresh benchmark
can establish generalization.

## Provider failure investigation

The production native run attempted the first of two selected development cases
and stopped with `no_providers_available`. No classification or quality response
was returned. Two separate tiny public-data smoke requests through the same Jev
client also returned that error:

| Request | Request-level privacy option | Result |
| --- | --- | --- |
| Native historical development request | Disallow prompt training | HTTP 403 |
| Synthetic receipt Boolean | Disallow prompt training | HTTP 403 |
| Same synthetic receipt Boolean | No privacy filter | HTTP 403 |

The public-data probe changed no saved setting. Historical data was not sent with
relaxed privacy controls. All requests retained TypeSafe-only routing; no alternate
provider or substitute evaluator was used.

This rules out the historical payload and the request-level no-training filter as
the immediate explanation for these observed refusals. It does not isolate an
upstream outage, team access issue or another Gateway selection condition.
Read-only dashboard inspection confirms that this connection had successful Jev
requests earlier that day before the 403 sequence, and provides no more specific
routing failure detail. Account details stay private.

Vercel still documents `typesafe-ai/jev` and the evaluation interface. Catalog
listing does not establish availability for a particular request. See the
[Jev listing](https://vercel.com/ai-gateway/models/jev) and
[evaluation API](https://vercel.com/docs/ai-gateway/modalities/evaluation).

The failure is not HTTP 429 and includes no retry-after instruction. Repeated
backoff retries would not demonstrate recovery or produce assessment evidence.

## Subsequent access diagnosis

A later public smoke request exposed the specific Gateway rejection: free-tier
users cannot access this model and must purchase Gateway credits. The client had
discarded this explanation while protecting provider bodies from disclosure,
leaving only the generic access error. This establishes an access-tier restriction
for the failing request, rather than a rate limit or evaluator judgment failure.

The client now recognizes that specific 403 message and emits a fixed purchase
remedy without echoing the provider body. Unrelated `no_providers_available`
failures remain generic. Targeted tests cover the match, other codes/statuses,
missing messages, secret suppression and the absence of automatic retries.
[Vercel's pricing documentation](https://vercel.com/docs/ai-gateway/pricing)
distinguishes free-tier model eligibility from purchased-credit access. No billing
change or live scoring success is implied by this diagnosis.

## Verification and resume

The 67 tests cover source linkage, literal read operands, preserved conditional
contract text, propagation through classification/quality/support, oversized
context refusal, existing assessment gates and benchmark mechanics. They use
temporary HOME and CODEX_HOME. No test asserts Jev's semantic accuracy.

Private artifacts retain the unchanged development references, the attempted-run
code hashes, source-linkage audit, blocked run reports and public smoke outcomes.
The first live attempt preceded the subsequent offline review fixes; no version of
this revision produced a live judgment. Resumption must record the final code and
taxonomy hashes separately from that blocked attempt.

After Gateway availability is restored, run the bounded development comparisons.
Inspect domain, boundary, assessability and source-support results separately.
Only after those succeed should new independent references be frozen and evaluated.
Full-history scoring and calibration remain unfinished.
