# Historical model performance

Use this branch when studying how configured model and effort combinations performed, including disabled and explicit routes. A session does not need a Jev selection or routing-journal link. Exact links are for the separate [routing-policy audit](logging.md#audit-retrospective-coverage).

## Census the local corpus

Create a private inventory with `history_inventory.py` as documented in [Private routing journal](logging.md#audit-retrospective-coverage), then run:

```sh
python3 <skill-dir>/scripts/performance_census.py --repo <root> \
  --inventory <private-inventory.jsonl> \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/performance-census-$(date +%Y%m%d-%H%M%S).jsonl"
```

The census includes every configured state, records model/effort matches once per native session, and reports `projected`, `mixed_unattributed`, `no_exchange`, `unprojectable`, or `inventory_error`. It counts unanswered final user messages separately from answered work turns. The private output is new and user-only. Claude base-model logs do not prove a configured context variant such as `[1m]`; Grok's current-model summary may not prove every earlier turn used it.

**Complete when:** every matching inventory row has one disposition, and every `inventory_error`, `unprojectable`, or `mixed_unattributed` row is listed as missing evidence or queued for repair rather than counted as a quality observation.

## Estimate domain outcomes from sessions

Run the whole-session domain pass when the question is which work domains each model handled. It reads every projectable Codex, Claude Code, and Grok session from the census, regardless of Jev routing. Conversations with two to six work turns go first because they are more likely to show feedback on one task without concealing much work; routes are interleaved. `--selection-file` can move a private list of `source_key` values to the front without dropping the rest. The result can contain several domains per session; each domain gets a 0–4 or `unknown` Jev label. `--limit` permits a resumable pilot, and `--retry-errors` revisits recorded projection failures. Gateway 429 responses are retried using their retry hint when present; other Gateway failures stop the run. Redacted transcript excerpts and bounded check results are sent to Jev through Vercel AI Gateway. Zero data retention is requested by default; `--allow-no-zdr` explicitly selects no prompt training when the account lacks ZDR and the user has authorized Jev processing. Results remain in the private machine directory.

```sh
python3 <skill-dir>/scripts/retrospect.py --census <private-census.jsonl> \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/whole-sessions.jsonl"
report_tag=$(date +%Y%m%d-%H%M%S)
python3 <skill-dir>/scripts/session_domain_report.py \
  --assessments "$HOME/.furanku-skills/model-routing/retrospectives/whole-sessions.jsonl" \
  --census <private-census.jsonl> \
  --markdown "$HOME/.furanku-skills/model-routing/retrospectives/whole-domains-$report_tag.md" \
  --sessions-csv "$HOME/.furanku-skills/model-routing/retrospectives/whole-domain-sessions-$report_tag.csv"
```

The report shows all 21 domains, each route's census, assessed, error and pending counts, score exclusions, family-capped means, and a private per-session/domain CSV. Means use only Jev's central labels with selected-choice probability at least 0.75 and quality labels with probability at least 0.60; these are ambiguity filters, not calibrated confidence. Delegated work, summary-only model attribution, and truncated conversations stay in the audit rows but outside means. A long conversation can contain several unrelated tasks, and `unknown` is the correct label if one session-level score would hide mixed outcomes. Linked images and complete code diffs are not inspected. Do not feed these means into routing until task-level outcomes and evidence sources have been audited.

The report also excludes a positive label from a one-turn session with no linked check, and excludes low labels until a separate outcome audit establishes a model-domain cause. Jev can describe such output, but the transcript alone cannot verify success or distinguish a model error from an external blocker. Repeated prompts from one template form one task family even when they generate many session files.

Read `Pending` as unassessed work, not as proof that the route has no usable history. Report both the assessed denominator and numeric score count before describing coverage or comparing routes.

**Complete when:** every projectable census source key has one result or recorded error; every involved domain has a numeric or unknown row; the report shows the assessed denominator and unknown share beside each score.

## Estimate first outcomes with stronger evidence

For an exploratory historical estimate, run the resumable first-outcome assessor against the private census. It skips control turns and asks Jev for the primary domain, 0–4 quality or `unverified`/`unknown`, evidence type, and failure cause of the first substantive outcome in each session. Subsequent independent work in the same chat is outside this pass. `--followups` supplies previously classified first reactions when available. `--selection-file` prioritizes a private JSONL list of `source_key` values, then processes the remaining sessions; it does not tell Jev the domain. The output keeps raw choices, related test-command summaries, and explicit adjustments. `--retry-errors` reassesses prior error rows.

This pass uses the same redaction and Gateway privacy modes as the whole-session pass: ZDR by default, or explicit `--allow-no-zdr` with no prompt training when Jev processing is authorized and the account lacks ZDR.

```sh
python3 <skill-dir>/scripts/performance_assess.py \
  --census <private-census.jsonl> --followups <private-followups.jsonl> \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/first-outcomes.jsonl"
report_tag=$(date +%Y%m%d-%H%M%S)
python3 <skill-dir>/scripts/performance_report.py \
  --estimates "$HOME/.furanku-skills/model-routing/retrospectives/first-outcomes.jsonl" \
  --census <private-census.jsonl> \
  --markdown "$HOME/.furanku-skills/model-routing/retrospectives/domain-estimates-$report_tag.md" \
  --sessions-csv "$HOME/.furanku-skills/model-routing/retrospectives/domain-sessions-$report_tag.csv"
```

The report lists all 21 domain rows, route-level coverage, each cell's score and evidence-weighted count, and every assessed session's status and cause. It caps repeated task templates and marks sparse cells; it does not manufacture missing scores with a prior. Jev probabilities are audit information, not calibrated success odds. The first-outcome rubric separately checks whether a test covers the first requested deliverable and whether the response exposes a complete inline artifact; a nearby passing test or a reported metric cannot support a positive score by itself. Self-reports, unrelated tests, changed preferences, external outages, and unseen visual artifacts do not become domain scores. Absent domains and model/effort combinations stay empty.

**Complete when:** the private report contains one row per assessed session, every numeric observation records its evidence level, low scores have a checked cause, and cells with too little or correlated evidence remain marked sparse rather than used as routing capability claims.

## Decide what can be scored

For proved Orca dispatches, assemble a private task packet before judging the routed worker. This is a **routing-policy audit subset**; keep using the full Codex, Claude Code, and Grok census for model-performance history. The packet builder joins the dispatch proof, routing decision, exact worker transcript, task preamble, worker check summaries, and any located parent-session context. Parent user-channel messages may be orchestration notices or a coordinator's words; their presence does not establish human feedback or acceptance.

```sh
python3 <skill-dir>/scripts/task_outcome_packets.py \
  --inventory <private-deduplicated-inventory.jsonl> \
  --orca-proofs <private-proved-dispatches.json> \
  --output "$HOME/.furanku-skills/model-routing/retrospectives/task-packets-$(date +%Y%m%d-%H%M%S).json"
```

The builder leaves quality null. Review each packet's task contract, exact model and effort, checks, parent context provenance, and missing artifacts. Resolve parent messages to the same task before treating them as feedback. A completed dispatch or a worker's completion statement alone is not a quality result.

**Complete when:** every proved dispatch has a packet or an explicit attribution/projection gap, and no packet is counted as a numeric quality observation without task-specific outcome evidence.

Split projected conversations by requested work outcome; attribute model and effort at the work-turn level before scoring mixed sessions. Resolve a task packet, issue, or external work reference before classifying its domain. Keep injected skill instructions, notifications, and transport events out of the request. Tie tests and artifacts to the requested outcome; an assistant completion claim, a passing-test marker, or silence alone does not establish acceptance. Treat images and 3D outputs as requiring visual evidence; the text-only Jev projection cannot judge their craft directly.

Classify requested work domains separately from outcome cause. A scope or instruction violation is process reliability; a changed preference is rework without proof that the original request was violated; a transport or service failure is external. Score only the domain that the available evidence actually evaluates, and retain `unknown` for the rest. Multiple turns or workers on one original task are correlated observations, not independent trials. Include unscored counts beside numeric observations.

**Complete when:** every proposed numeric score names one work outcome, its verified model and effort, a domain-specific evidence source, and an outcome cause; every excluded or unknown observation has a recorded reason.
