# Historical model performance

This branch is experimental. Develop and validate in a checkout before publishing
or updating installed skills. Retrospective results never change routing scores
automatically.

**Current decision:** two reviewed development cases now meet their reference
checks, but the procedure has not passed held-out validation.
The current implementation repairs evidence retention, separates final quality
from repair burden, supports typed questions, and verifies citation support.
Semantic accuracy and coverage still need validation; keep bulk scoring stopped
until a frozen historical benchmark passes and its errors are independently reviewed. The commands below reproduce experimental results; they are not a
validated procedure for updating routing scores. Read the
[integration audit](https://github.com/RafaelVidaurre/furanku-skills/blob/model-routing-states/docs/research/jev-retrospective-integration-audit-2026-09-26.md)
and the [Astra review follow-up](https://github.com/RafaelVidaurre/furanku-skills/blob/model-routing-states/docs/research/jev-astra-review-2026-09-26.md),
the [typed-integration validation](https://github.com/RafaelVidaurre/furanku-skills/blob/model-routing-states/docs/research/jev-typed-validation-2026-09-26.md),
and the amended
[feasibility report](https://github.com/RafaelVidaurre/furanku-skills/blob/model-routing-states/docs/research/retrospective-evaluator-feasibility-2026-09-26.md).

## Inventory all configured models

Use `history_inventory.py` as documented in [Private routing journal](logging.md#audit-retrospective-coverage), then run `performance_census.py --repo <root>
--inventory <private-inventory.jsonl> --output <private-census.jsonl>`.

Include Codex, Claude Code, and Grok sessions for every configured model and effort,
including disabled and explicit combinations. Jev involvement, routing logs, and
Beads are not eligibility conditions. The inventory covers local files, not cloud
history. Preserve its discovery scope and timestamp.

**Complete when:** every matching native session appears once with its source and
recorded model/effort; missing or ambiguous metadata is reported separately.

## Classify every task and domain

Run the experimental task assessor against the census:

```sh
python3 <skill-dir>/scripts/task_retrospect.py --census <private-census.jsonl> \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/tasks.jsonl"
```

`--prepare-only` inventories readable work turns without Jev calls; prepared rows
are never reported as assessments. `--limit` bounds a pilot; zero (the default)
processes the entire census. `--selection-file` prioritizes a JSONL list of source
keys without excluding the remainder. A rerun skips sessions with a terminal result
for the same analysis, source file, and linked Beads records, and processes
never-attempted sessions first, so `--limit` always advances. Terminal results are
`assessed`, `assessed_with_pending` (some domains stay pending), and non-retryable
`error`; `--retry-pending` reprocesses the last two. Transport, rate-limit, and
authentication failures stop with the diagnostic and any retry hint; completed
calls remain cached. Use the same command to resume after recovery. Add
`--rate-limit-wait 120` to wait automatically through the shared Gateway cooldown,
with a total additional wait budget of 120 seconds for the run (maximum 300).
Each wait reports its duration and safe diagnostics; a delay beyond the remaining
budget stops resumably. The default, zero, returns the cooldown immediately. An invalid
Jev answer for one call is recorded as that domain's pending exclusion instead.
There is no substitute evaluator on failure.

Jev processing uses Gateway zero data retention by default. Use `--allow-no-zdr`
only under the user's existing authorization for processing without ZDR; it still
requests no prompt training. Outputs and caches remain private on this machine.

The sequence is:

1. Parse every work turn, preserving requests, responses, per-response model/effort,
   recorded tool events, and original line references. Keep message wrappers and
   origin metadata; preserve recorded system/developer instructions and Claude
   instruction snapshots and rendered hooks as historical context. Transport
   metadata does not establish user authorization. Internal reasoning is excluded.
   Retain tool bodies locally, including long outputs. Retrieval uses complete
   small records or decoded field spans with paths, character offsets, and source
   IDs; it preserves the final output instead of replacing large bodies with pointers.
2. Ask Jev to link each request to its task. Corrections, approvals, abandonment,
   and later feedback stay with that task. Housekeeping can carry task evidence.
   Grouping and domain classification use normalized task text; outcome judgments
   retain original messages and authority context. An opening request labeled
   housekeeping is retained as unresolved, never discarded.
   Up to 50 earlier requests are offered; each boundary records the first one
   offered and whether size forced a shorter window. A new task chosen under a
   shortened window, and every unresolved link, is boundary-uncertain.
3. Ask Jev about every domain in `retrospective-domains.json`: absent, supporting,
   central, or unresolved. Each question includes the domain's definition. Include work
   later canceled, superseded, or reverted when classifying domains. Long requests
   are paged; later pages repeat the task's opening request part, and every page
   is retained. Combine central/supporting probability when deciding involvement;
   uncertainty about importance does not erase involvement. Report `involved` when
   the role is uncertain and `unresolved` when involvement is uncertain. One weak
   positive page cannot override confident negatives. Tasks by models outside the
   census are classified but not scored.
4. Judge each recorded model/effort contribution using anonymized actor identifiers.
   Other actors' work supplies context rather than credit. Every request is always
   supplied whole. When events and recorded instructions do not fit, Jev screens
   every fragment for positive evidence, negative evidence, deliverables, and
   authority context, then re-screens the
   selection until the final call fits. The final call receives labelled fragments
   (part k of n) with source line IDs; retain every screening round.
5. Ask focused categorical questions about attempted work, ownership, outcome
   evidence, and cause. Batch independent domains when their complete shared
   evidence fits. Keep historical authority context in these judgments. Select
   final-result and repair citations separately. Unattempted or unowned work does
   not receive a numeric quality question.
   Then send requested work and observed source evidence to Boolean questions
   about assessability and observed repair, and separate Score scales: final
   requirement satisfaction (0–4) and model-caused repair burden (0–3).
   Keep all observed task events when the bounded packet fits, with source order;
   selected citations are locators, not an exclusive evidence restriction.
   Historical policy stays out of this quality packet, including retrieved policy
   fragments. Larger packets record the restricted evidence scope explicitly.
   A repaired mistake can coexist with a good final result. Missing evidence
   invalidates a rating; silence does not establish a clean attempt. Inspect
   source IDs, actor attribution and supplied bodies mechanically, then ask whether
   the cited evidence supports the particular domain-quality claim. A passing
   software test cannot establish documentation quality. Score distributions,
   acceptance exclusions and raw estimates remain visible independently. Repair
   eligibility has its own citations, attribution checks, and exclusions: unknown
   final quality does not erase observed model-caused repair.
   Eligible quality and repair values are the particular ordinal levels verified
   by the source-support question. Raw probability-weighted means remain estimates;
   supporting one level does not verify every level contributing to that mean.
6. Produce the adjacent Markdown report and per-session/task/domain CSV. The report
   states its census digest, analysis signature, privacy mode, Beads status, run
   status, and each census session's disposition. It counts distinct tasks and
   reports raw estimates, evidence-eligible observations, exclusions, unassessed
   work, and model/effort counts separately. These are exploratory observations,
   not a calibrated capability ranking.

Every judge call, questions included, is checked against the byte bounds before
network use. Unknown effort stays unknown. Grok's summary model alone does not
prove historical turn attribution; use per-turn metadata when present.
Boundary-uncertain tasks cannot supply numeric routing evidence. Sensory quality
needs actual perceptual evidence or specific feedback: a text-only judge cannot
inspect referenced images, audio, or 3D artifacts. A task whose requests alone
exceed the judge input keeps its domain labels, and its estimates remain pending
as `task_requests_exceed_judge_input`.

Review a diverse pilot's requests, boundaries, labels, and cited source evidence
before scaling. Compare labels to requested deliverables, rather than incidental
technical words. Test negative examples as well as successful outcomes. Jev's
choice probabilities are uncertainty signals, not calibrated worker-success odds.

**Complete when:** every census session has a recorded disposition, every substantive
request is assigned or marked unresolved, every involved domain has an estimate or
an explicit reason for missing one, and the report's coverage matches the census.
A limited pilot does not satisfy full-corpus completion.

## Validate a procedure before scaling

Use `retrospective_validate.py --cases <private-cases.json> --output <private-result.json>`
for a frozen source-audited task benchmark. Inputs and output live within the
machine-global retrospective directory. Each case contains `id`, `split`, parsed
`turns`, source `provenance`, optional `focus` and Beads `context`, and `expected`:
`required_domains`, optional `allowed_domains`, and `scores` mapping domains to
an acceptable numeric range or `null` for no supported score; optional `rework`
maps domains to repair-burden ranges (0–3) or `null`. Accepted quality or repair
outcomes outside these reference maps are unjudged failures. The document has
`status: "frozen"`, `cases`, and `minimum_supported_scores` (default 1).
The minimum must be a positive integer. Splits are `heldout` (`held_out` alias),
`development`, `development_after_first_observation`, or `development_after_review`.

Fix references before evaluating. Development cases may guide changes; once an
unseen case informs a change, label it development and reserve fresh cases.
Unknown is a failed positive-coverage check, not agreement. A negative-only run
cannot establish a useful scorer. The report retains source/input and code hashes,
raw domain distributions, every accepted and rejected score, errors, and cache use.
The same privacy and bounded rate-limit wait options apply. Successful calls are
cached with their request bodies, so a blocked run resumes without resending them.
Use repeatable `--case <id>` to investigate specific failures; a selected subset
never reports full benchmark completion. This harness tests prepared task
assessment, not native discovery or task segmentation end to end.
An accepted score outside the reference's score scope is reported as unjudged
and prevents a pass. Full `passed` status requires positive score coverage and
negative score checks on held-out cases. Passing development checks yields
`passed_checks_unvalidated` with a nonzero exit status. Domain abstentions are
reported separately; unknown non-required domains do not count as false positives.

Rebuild native inventory and census after changing attribution extraction.
Grok's actual assistant-turn metadata takes precedence over its mutable session
summary; summary fallback stays explicit and unverified. Claude `perTurnEffort`
is included alongside `effort`. Distinct model IDs remain distinct unless an
authoritative mapping establishes equivalence.

Thresholds in `retrospective_judgments.py` are provisional pilot policy, not
calibrated correctness probabilities. Assess domain errors, evidence-support
errors, accepted score coverage, and quality agreement separately. A passing
small benchmark does not establish calibrated model rankings or corpus coverage.

**Complete when:** held-out results meet the frozen criteria, useful positive
scores exist alongside correctly rejected negative cases, errors are independently
reviewed, and the supported scope and remaining gaps are recorded.

## Optional Beads evidence

When the project uses Beads and the user selects issue enrichment, read
[Beads retrospective](beads-retrospective.md). Finalized issues can supply missing
requirements, acceptance criteria, closure reasons, and review comments. Record
successful, rejected, abandoned, duplicate, and superseded outcomes separately.
A closed status or closing agent's claims alone do not establish success or model
identity. Exact issue mentions locate candidate evidence; they do not prove
who authored the result.

Pass `--beads-census <private-finalized-issues.jsonl>` to the task assessor to add
records linked to that session whose exact ID appears in the task's requests or
its own tool calls. Each task records where each ID matched; each session records
how many linked records were available and used. Issue requirements inform domain
classification; closure and review claims remain labelled tracker context. Issue
context yields to the judge budget: claims are dropped first, then the whole
context, and the domain records which context it received. Missing or malformed
optional artifacts are recorded as unavailable enrichment while session analysis
continues. Omitting the flag loads no Beads data and requires no Beads installation.

Keep this adapter optional in the published feature. Projects without Beads use
the session procedure above. Missing or failed Beads access is reported as an
enrichment gap, without dropping their sessions or emulating the failed tool.

**Complete when:** optional evidence is traced to its source and author/provenance,
issue closure is distinguished from verified outcomes, and the session census
remains identical with enrichment enabled or disabled.

## Calibration and legacy experiments

Audit outcome attribution and task-specific evidence before using observations
for routing. Repeated task templates and multiple workers on one original request
are correlated. Confidence and score updates require task-family controls,
difficulty comparisons, evidence weights, and an outlier-resistant estimator;
the experimental task report does not implement that calibration yet.

`retrospect.py` / `session_domain_report.py` reproduce the older bounded whole-session
experiment. `performance_assess.py` / `performance_report.py` reproduce the first-
outcome diagnostic. Neither covers every task in a long session. Preserve their
results as historical experiments, not as a substitute for the task census.
`task_outcome_packets.py` is the separate routing-policy audit for exactly linked
dispatches; it is not a requirement for learning from ordinary sessions.

**Complete when:** audited observations, uncalibrated estimates, and validated
routing score updates are reported as distinct stages, with the user reviewing
calibration before any score update.
