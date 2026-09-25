# Beads issues as model-routing retrospective evidence — 2026-09-25

Status: **experimental; not validated for routing.** No routing score or configuration changed. Beads is an optional enrichment: sessions without Beads remain eligible for every retrospective. Private issue text, titles, repository names and paths are omitted; counts only.

## Question

Do finalized Beads issues give useful evidence about how models and efforts perform in different work domains?

## Answer

Partly. Finalized issues are good evidence of **what happened to a piece of work** (delivered, superseded, abandoned, and so on) and of the requirements it answered. They are weak evidence of **who did it well**:

- Every closure, acceptance statement and cited check in the tracker is a **claim** written by the closing agent or coordinator. Closed is not success.
- The tracker does not record the model. Owner, assignee and comment author are git identities. A model can only be tied to an issue through a transcript that names the exact issue ID, and even then it is the **operator** that claimed or closed it, not a verified author. Route aggregates are operator associations, not performance attributions.
- Observed evidence exists only where the closing turn's transcript contains test results.

## Method

1. Found 49 `.beads` directories under local code and worktree roots and resolved them to 19 canonical stores with `bd --readonly context`. Read every issue with `bd --readonly export`. Worktree and clone copies were deduplicated by project and issue ID.
2. Linked exact issue IDs to local Codex, Claude Code and Grok transcripts. Each link records how the ID appeared (prompt, `bd claim`/`bd close` command, or mention) and the session's model/effort metadata.
3. Labelled disposition, evidence strength, acceptance, rework and domain involvement with Jev (Vercel AI Gateway, training opt-out; the zero-data-retention request returned HTTP 403 permission_denied). Model identity was withheld from the judge.
4. Hand-checked labels against full record text.

Tooling: `skills/model-routing/scripts/beads_retrospect.py`; contract and limits in `skills/model-routing/references/beads-retrospective.md`.

## Results

### Inventory (all finalized issues, structural)

| Measure | Count |
|---|---:|
| Issues read | 7,632 |
| Finalized (`closed`) | 5,902 |
| Duplicate copies merged | 703 |
| Read from an exported JSONL artifact because `bd export` failed | 20 |
| Stores where `bd context` failed (broken worktrees) | 2 |
| With written acceptance criteria | 3,088 |
| With notes / with comments | 2,537 / 1,684 |
| Close reason empty / generic ("Closed") | 80 / 290 |
| Explicit `supersedes` / `duplicates` relation | 38 / 7 |

A hand sample of 48 closures across all repositories showed dispositions including specific completion accounts (the majority), supersessions, duplicates, "no longer needed", user cancellations, bulk triage sweeps and bare "Closed". Several closures record an independent review pass or owner sign-off; these are still tracker text.

### Transcript linkage

| Primary link | Issues |
|---|---:|
| Single-model operator (claimed or closed it, one model/effort, no delegation in those turns) | 1,053 |
| Delegating operator | 2,084 |
| Mixed or missing model metadata | 313 |
| Mention only | 2,220 |
| Unlinked | 232 |

2,534 issues have a linked session that ran `bd close` on them. 665 have observed test results in the closing turn (17 with a failing exit code).

Single-model operators are concentrated in a few routes: gpt-5.6-sol/high 361, gpt-5.5/high 230, gpt-6-astra/high 143, gpt-5.6-sol/xhigh 60, claude-opus-5/high 54, claude-opus-5-5 41, gpt-6-sol 44, gpt-5.6-sol/max 24, gpt-5.6-terra 35, claude-fable-5 19, claude-fable-5-1 15, grok-4.6 17; others fewer than 5.

### Jev labels (incomplete)

At the handoff snapshot, **84 of 5,902** finalized issues had labels under the current rubric; 8 had stale labels and 5,810 were unevaluated. The Gateway returned sustained HTTP 429 without Retry-After. Observed throughput was about 12 issues per minute; the exact limiting layer and cap were not established.

The final saved snapshot contains **110 current assessments, 8 stale, and 5,784
unevaluated**. The automatic retry supervisor and its remaining evaluation process
were stopped. Bulk evaluation remains stopped until the labeling and evidence
rubric is validated on an inspectable sample. The tables and audit below describe
the earlier 84-record snapshot, not all 110 saved assessments.

For the 84 (a diverse-first prefix of single-model operators, not a random sample):

| Label | Counts |
|---|---|
| Disposition | completed 58 · completed with deviation 16 · duplicate/superseded 4 · unknown 3 · container/non-work 2 · abandoned 1 |
| Evidence | completion claim only 41 · recorded specific check 28 · none 9 · observed check 6 |
| Acceptance | no criteria 44 · met 27 · partially met 11 · not met 1 · not assessable 1 |
| Rework | none visible 73 · major 8 · minor 3 |

No per-route or per-domain rate is reported: the largest route cell has 33 issues, and the domain labels are not calibrated (below).

### Label audit

- Hand check of 40: disposition agreed 38/40, acceptance 37/40, evidence 32/40.
- `evidence = none` is unreliable. It appeared with completed dispositions, with acceptance "met", and on records that have observed test output or cite specific checks.
- Acceptance "met" is sometimes given when only a generic shared close reason answers the criteria.
- Domains are over-inclusive. "writing" was central in 21 of 84 issues, 18 of them together with "documentation", mostly for technical specifications that the taxonomy assigns to documentation. "implementation" was central in 63 of 84. With two issues per request, outcome labels matched single-issue requests 12/12, but central-domain sets matched only 7/12.

## Limits

- Tracker text is a claim throughout; only closing-turn test output is observed, and it may concern other work in the same turn.
- Operator ≠ author. Delegated work links to the coordinator unless the worker named the ID itself.
- Requirements are as exported; later edits are not distinguished.
- The linked inventory comes from one local machine's transcripts; sessions that never named an issue ID stay unlinked.

## Conditions before any publication of route or domain aggregates

1. Fix and re-pilot the evidence and writing/documentation labelling defects.
2. Complete or re-sample evaluation, and state the unevaluated and stale shares.
3. Report only single-model-operator cells with their counts, labelled as operator association, with a hand spot-check of each reported cell.
