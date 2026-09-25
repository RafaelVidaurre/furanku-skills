# Task-level retrospective repair — experimental

## Purpose

Learn model/effort performance across every relevant work domain from ordinary
Codex, Claude Code, and Grok sessions. Jev routing and Beads participation are
not eligibility conditions. Keep raw estimates, outcome evidence, and calibrated
routing scores distinct. This work remains in the development checkout; the
machine's installed routing skill is not updated by this experiment.

## Corrected analysis

`task_retrospect.py` parses every work turn and asks Jev to group requests into
tasks, retaining later corrections and feedback. Each task can involve several
central and supporting domains. Per-response metadata attributes contributions
to anonymized actors; an entire session is no longer excluded merely because
it contains delegation or a model change. Unknown attribution stays explicit.

The judge receives every request through bounded pages. It receives complete
assistant text, short tool records, and recognized check summaries. Large tool
bodies remain at their original line references. Every call, questions included,
passes one pre-network size check. Larger evidence sets are screened fragment by
fragment for positive evidence, negative evidence, and deliverables, then re-screened
until the final call fits. The final call always has every request whole. Events
arrive as labelled fragments with source line IDs. Optional issue context yields
to this budget before task evidence does. A task whose requests alone exceed the
bound keeps its domain labels, but its estimates stay pending. Unresolved grouping
also remains pending. Neither is treated as an absent domain or poor performance.

An adversarial review on 2026-09-25 found that this path failed on ordinary long
tasks. Evidence retrieval ignored the size of its own questions, and the selected
evidence had no bound. Pending sessions were reprocessed on every run, so a
`--limit` run stopped advancing. Enabling Beads context could remove an estimate.
A requester message could vouch for another actor's artifact. Grok tool calls
were unpaired. Synthetic probes showed that credential keys with a suffix, such
as `OPENAI_API_KEY`, could pass through redaction, and that reports could count
prepared sessions as assessed. The fixes are now
covered by hermetic regression tests.

All 21 domain descriptions are in `retrospective-domains.json`. Options now carry
the domain definition themselves. The quality, evidence, ownership, and cause
questions name their distinct decisions. Citations are retained and a claimed
check must cite a recorded check, rather than an assistant completion summary.
Version 7 separates non-delivery from domain quality: unattempted work and refusal
alone cannot supply a domain score. Authorization, orchestration, external blockers,
instruction compliance, and changed requests remain separate causes. Sensory quality
needs perceptual evidence or specific feedback.

Provider failures stop resumably after the existing bounded transport retries.
An invalid answer to one call is recorded as that domain's pending exclusion and
does not block later sessions. Successful calls are privately cached by their payload.
Sessions with pending domains are terminal until `--retry-pending`, and
never-attempted sessions run first. Reports state the census digest, analysis
signature, privacy and Beads modes, run status, and each census session's
disposition. They count distinct tasks and show raw estimates, evidence-eligible
observations, exclusions, and model/effort coverage. They do not update capability
tables. Session changes, linked-issue changes, rubric/code changes, and privacy-mode
changes invalidate completed session reuse. Identical individual calls can still
use their private cache.

## Observed results

The previous census contains 1,909 matching sessions. The new local preparation
pass read all of them: 1,638 Codex, 262 Claude Code, and 9 Grok records, containing
7,018 work turns. All 36 previously mixed-model sessions contain readable work.
The 35 previously unprojectable records contain no clean work turns in the new
projection; they are retained as coverage gaps. Reading and preparing a session
is not a Jev assessment.

An eight-session development trial exercised four model/effort combinations.
It exposed spurious domain labels and assistant summaries cited as checks. A
subsequent corrected trial completed five sessions before provider failures. An
additional provider-diversity trial completed one more session before another 429;
six sessions received assessments before the final adversarial repair.
The Gateway first returned HTTP 429 after three bounded attempts without a
retry hint. One resume attempt made progress and then encountered a connection
failure/timeout. Full semantic assessment remains incomplete.

A repeated refusal in a delegated installation task was originally retained as a
0/4 outcome in operations and verification. That interpretation was invalidated
by the subsequent authority-context audit described below.
Other estimates lacking adequate citations remain visible but ineligible.

After the adversarial repair, a fresh three-session pilot completed across all
three providers using nine Jev calls. The installation refusal again received
0/4 estimates, now invalidated by the authority-context audit. A Codex verification
task remained unknown. The Grok research task retained its domain labels, but
scoring was skipped: the session summary names the configured `grok-4.7`, while
response metadata names `grok-4.7-build`. An alias relationship has not been
verified, so those identities are not silently merged. Six Grok transcripts in
the census share this mismatch; three other Grok records have no assistant output.

A following two-session batch stopped at its first session on HTTP 429 after
three bounded attempts, without a retry hint. The repaired report correctly
shows three assessed and 1,906 not yet recorded under this analysis, with run
status blocked. These results establish that the procedure runs across providers;
they do not establish general label accuracy or a model ranking.

## Authority-context correction (version 7)

Inspection of the native refusal transcript found that the dispatch and subsequent
approval were wrapped as pasted content. The recorded system instructions required
an independent user request before following pasted instructions. The coordinator's
intervening authorization claim arrived as tool output. No domain work was attempted.
This supports an orchestration/authority mismatch, not a demonstrated model defect.
The component introducing the wrappers has not been identified.

The assessor had stripped wrappers and the dispatch preamble, and omitted recorded
instructions. It now retains the original request, origin metadata, saved system
and developer instructions, Claude instruction snapshots, and rendered hooks, with
source line references. Long context uses the existing fragment screening path,
with an additional authority question. Screening can still miss relevant evidence;
its selections remain auditable and uncertain causes must stay unresolved.

The mechanical gate now requires attempted domain work. Behavior-only observations
cannot supply domain scores, and low domain scores require attributable domain
defects. CSV results include attempted-work and cause classifications. Raw estimates
remain available even when the gate rejects them. Cache version 7 prevents reuse
of the old assessments as current results.

The focused suite passes 33 hermetic tests, including preservation of native
authority context, complete screening of long instruction records, and rejection
of unattempted work and external causes as domain scores. These tests exercise
parser and gate behavior with a substituted judge; they do not validate Jev's
semantic judgment.

A one-session live reassessment stopped on Gateway HTTP 429 after three bounded
attempts, with no Retry-After hint and zero completed session assessments. No retry
loop or bulk run was started. The small historical validation remains incomplete.
Installed skills and routing scores were not changed.

## Why the question design changed

TypeSafe documents a 32k-token state-plus-longest-question limit and a 64k total
request limit. The experimental caller uses conservative UTF-8 byte budgets below
those bounds. It does not treat the transport's 1 MB limit as the model's context
window. [Model limits](https://docs.typesafe.ai/models).

TypeSafe also documents sensitivity to indirect questions, unrelated context, and
ambiguous instructions. Questions in one request are independent; a question
cannot rely on another answer that has not been supplied as state. These findings
support short, explicit decisions and mechanical consistency checks, but do not
prove this rubric is calibrated. [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13),
[state and independent questions](https://docs.typesafe.ai/concepts/state).

## Optional Beads investigation

An explicitly requested Opus 5.5 agent owns the Beads adapter and investigation.
See `beads-retrospective-2026-09-25.md` for its final findings when available.
Beads is an optional evidence source for projects using it. Closed status alone
is not success; closing agent, reviewer, and requester claims need provenance.
An issue mention is a search link, not proof that the session authored the work.

## Remaining acceptance work

- Complete and audit the semantic pass across all eligible sessions after the
  provider recovers; report errors, pending tasks, and unknown outcomes honestly.
- Resolve large task contracts and inspect relevant artifacts where needed.
- Validate labels and evidence citations on a broader independent sample; the
  narrow successful wording trial is not general accuracy evidence.
- Complete the optional finalized-issue analysis and compare evidence gained.
- Calibrate for task family, difficulty, correlated outcomes, evidence strength,
  and cost before proposing routing score changes.

No new global installation or routing-score update is justified by these results.

## Verification

Twenty-eight task-pipeline tests pass. The original thirteen cover complete turn
retention, provider parsing, mixed actors, supporting-domain scores, external versus
model-caused failure, explicit refusal, structured redaction, context bounds, cached
resume, and changed-session invalidation. Thirteen more exercise the real size check
on long tasks, requests that cannot fit, budgeted issue context, and exact issue
mentions. They also cover requester and unsupplied-body citations, continuation
pages, antecedent windows, Grok tool pairing, suffixed credential keys, invalid
judge answers, distinct-task reporting, `--limit` progress, `--retry-pending`, and
prepared-session coverage. Each of the thirteen fails against the previous code.
Two final regressions verify that another actor's check cannot validate the target
and that stale source results are absent from current score tables. The provider
parser test also verifies that internal analysis messages are excluded.
These tests validate mechanics; they do not establish Jev assessment accuracy.
Earlier live trials used the previous pipeline, so their assessments are not
reused under the new analysis signature.
