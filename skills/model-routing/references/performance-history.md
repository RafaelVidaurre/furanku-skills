# Historical model performance

This branch is experimental. Develop and validate in a checkout before publishing
or updating installed skills. Retrospective results never change routing scores
automatically.

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
   Long tool bodies remain at
   source; recognized checks retain their command/result summaries. Tool summaries
   and source pointers are identified as such, never presented as complete artifacts.
2. Ask Jev to link each request to its task. Corrections, approvals, abandonment,
   and later feedback stay with that task. Housekeeping can carry task evidence.
   Grouping and domain classification use normalized task text; outcome judgments
   retain original messages and authority context. An opening request labeled
   housekeeping is retained as unresolved, never discarded.
   Up to 50 earlier requests are offered; each boundary records the first one
   offered and whether size forced a shorter window. A new task chosen under a
   shortened window, and every unresolved link, is boundary-uncertain.
3. Ask Jev about every domain in `retrospective-domains.json`: absent, supporting,
   or central. Each answer option includes the domain's definition. Include work
   later canceled, superseded, or reverted when classifying domains. Long requests
   are paged; later pages repeat the task's opening request part, and every page
   is retained. A page's unresolved answer is used only when no page resolves the
   domain. Tasks by models outside the census are classified but not scored.
4. Judge each recorded model/effort contribution using anonymized actor identifiers.
   Other actors' work supplies context rather than credit. Every request is always
   supplied whole. When events and recorded instructions do not fit, Jev screens
   every fragment for positive evidence, negative evidence, deliverables, and
   authority context, then re-screens the
   selection until the final call fits. The final call receives labelled fragments
   (part k of n) with source line IDs; retain every screening round.
5. Ask separate questions about attempted work, domain quality, evidence, ownership,
   and cause. Establish attempted work and cause before accepting a domain score.
   Retain the raw 0–4/unknown estimates and citations independently of eligibility.
   Supporting domains receive scores too. Unattempted work remains unassessed;
   refusal alone establishes non-delivery, not domain quality or model fault.
   Distinguish domain mistakes, authorization conflicts, orchestration failures,
   external outages, instruction compliance, and changed requests. Low scores
   require an attributable domain mistake; delivery/compliance observations remain
   separate from domain scores. Artifact, behavior, and check evidence must cite the
   target actor's own event; a requester message supports only feedback, and a
   tool body left at source cannot be cited as an inspected artifact.
   Screening can omit relevant instructions: retain its selections and leave an
   uncertain cause unresolved rather than interpreting missing authority as refusal
   of an authorized task.
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

A five-session source-audited pilot retained all 12 requests but yielded zero
evidence-eligible scores from ten raw numeric estimates, two invalid answers, and
one unknown. It exposed omitted decisive tool results, unsupported domain labels,
and inconsistent quality/evidence/cause answers. The procedure is not validated.
Repair evidence preparation and coherent outcome assessment, then compare a
diverse pilot against source-based expectations fixed before judging. Include
unseen cases before expanding the corpus; rejected estimates are not model scores.

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
