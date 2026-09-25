# Beads retrospective enrichment (experimental)

Status: **experimental, optional**. Nothing here changes routing scores or configuration. A history without Beads stays eligible for every other retrospective; Beads only adds records to histories that have them. Publication of any aggregate from this path is conditional on the gates in [Publication conditions](#publication-conditions).

Read this when a retrospective run should use finalized Beads issues as outcome evidence, or when wiring `scripts/beads_retrospect.py` into a session/task retrospective.

## What Beads adds, and what it does not

A finalized issue carries the requester's requirements (title, description, acceptance criteria) and the closer's account (close reason, notes, comments). Tracker text is written by the agent or coordinator that did or supervised the work, so it is a **claim**. Closed status is not success: closures include duplicates, supersessions, cancellations, triage sweeps and bare `Closed`. Absent evidence is `unknown`.

Beads does not identify the model. Owner, assignee and comment author come from git identity and are never used as model identity; a model named inside tracker text is also a claim. Model and effort come only from transcript metadata of a session that names the exact issue ID, and even then they identify the session that operated the issue (claimed or closed it), not a verified author. Aggregates by model are therefore an **operator association**, not performance.

## Commands

All reads use documented read-only `bd` commands (`bd --readonly context --json`, `bd --readonly statuses --json`, `bd --readonly export`), run with the store as working directory. When `bd export` fails, the store's exported `issues.jsonl` is read as an artifact and the record's `provenance.reader` says so; when `bd statuses` fails, only `closed` counts as finalized. Both are reported as failures. Every output must be a file directly inside `~/.furanku-skills/model-routing/retrospectives/` (mode 600).

```bash
S=scripts/beads_retrospect.py; P=~/.furanku-skills/model-routing/retrospectives
python3 $S census   --output $P/beads-census-nolink-<date>.jsonl
python3 $S link     --census $P/beads-census-nolink-<date>.jsonl --checkpoint $P/beads-link-checkpoint-<date>.jsonl --output $P/beads-census-<date>.jsonl
python3 $S evaluate --census $P/beads-census-<date>.jsonl --output $P/beads-eval-<date>.jsonl --limit 12
python3 $S evaluate --census $P/beads-census-<date>.jsonl --output $P/beads-eval-<date>.jsonl --batch-size 2
python3 $S report   --census $P/beads-census-<date>.jsonl --evaluations $P/beads-eval-<date>.jsonl --csv $P/beads-issues-<date>.csv --summary $P/beads-summary-<date>.json
```

1. `census` searches `~/Code` and `~/orca/{workspaces,projects}` (depth 5; `--root` repeatable), resolves each `.beads` directory to its canonical store with `bd context`, reads every issue whose status has the `done` category, and deduplicates by project ID and issue ID (newest `updated_at` wins). Done when it prints store, failure and finalized counts.
2. `link` finds transcripts naming any exact issue ID (Codex, Claude Code, Grok and Orca-managed Codex homes; `--codex-home` adds more), scans each once, and appends one checkpoint row per session. Progress prints to stderr every 30 seconds. Rerun the same command to resume: candidate discovery reruns, unchanged sessions come from the checkpoint, and changed files are rescanned; a checkpoint built for another issue set, scanner version or root list is rejected. Unreadable roots are reported as coverage gaps. Done when it prints link counts.
3. `evaluate` with a small `--limit` first: read those labels before running the rest. Each request labels disposition, evidence, acceptance, rework and domain involvement for one issue, or two with `--batch-size 2`; model identity is withheld from the judge. Requests over the byte budget (state 24 KB, state plus largest question 30 KB, payload 60 KB) are split locally, and a single oversize issue is recorded as `request_oversize` without being sent. Results are reused only while the issue's judged state, the question signature and the privacy mode are unchanged. Single-model operators are evaluated first. A sustained Gateway 429 stops the run with partial results saved (exit 2); rerun later. Done when it reports `complete`.
4. `report` writes the per-issue CSV and an aggregate JSON. Only `current` evaluations contribute labels; `stale`, `error` and `not_evaluated` are counted as such. Done when both files exist.

## Transcript links

| Attribution | Meaning |
|---|---|
| `single_model_operator` | The session ran `bd close` or `bd update --claim` for this exact ID, used one model/effort, and did not delegate in those turns. Authorship is still unverified. |
| `delegating_operator` | As above, but the session delegated in the operating turns; the implementer may be another agent. |
| `unknown_delegation` | Delegation in the operating turns could not be determined. |
| `mixed_or_missing_model` | The operating session changed model/effort or lacks metadata. |
| `mention_only` | The ID appears only in prompts, replies or tool output. |

`observed_checks` are recognized test invocations with results from the session's closing turn — the only observed evidence in a record. Everything under `claims` stays a claim even when it cites checks.

## Adapter contract

`beads_retrospect.enrich_session(session_path, provider, selected=..., census=..., repo=...)` returns `{"status", "records", ...}`:

- `selected=False` → `not_selected`, no Beads access; importing the module never requires `bd`.
- `selected=True` with a linked census artifact → the records linked to that session (paths compared after resolving symlinks), with `census_records` and `linked_records` counts.
- `selected=True` with `repo` → live `bd export` for that store, linked against the one session. Missing `bd` or an unreadable store → `unavailable` with a reason, never an emulated result.

Each record (`schema: beads_enrichment_v1`) is bounded (clipped text, last 12 comments) and holds `source_path`, `issue_id`, `issue_ref`, `repository`, `terminal_status`, `requirements`, `claims`, `structural` relations, `provenance`, `transcript_links`, `observed_checks` and `missing_evidence` flags. Requirements are as of export; later edits are not distinguished.

## Publication conditions

Aggregates may be published only when all hold, and then only as counts without issue text, titles or paths:

- per-route cells use `single_model_operator` links only, are labelled operator association, and report their count beside every rate;
- dispositions derived from tracker text are labelled claims unless `observed_checks` or independent acceptance back them;
- the Jev labels were spot-checked against a hand-read sample, with disagreements reported;
- the share of finalized issues still `not_evaluated`, `stale` or `error` is stated.

## Known limits

- Transcript roots mirror `history_inventory.py`; keep the two lists in step.
- Sessions that worked an issue without naming its ID stay unlinked; a worker links only if it names the ID itself.
- A closing turn's test results may concern other work in the same turn; they are observed, not proven relevant.
- Domain involvement varies between runs more than the outcome labels do.
