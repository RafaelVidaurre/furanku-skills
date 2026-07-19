---
name: decision-trail
description: Keep a reviewable, append-only TSV trail of consequential decisions, reasons, evidence, and results. Use when the user requests a decision trail, or when substantial multi-phase work will be reviewed after the run.
license: MIT. See LICENSE.txt
compatibility: Requires Bash and standard Unix command-line utilities to use the bundled logger.
metadata:
  author: rafaelvidaurre
  source: "https://github.com/cursor/plugins/tree/main/pstack/skills/show-me-your-work"
---

# Decision Trail

Keep one factual log that lets a reviewer reconstruct what changed, why it changed, and what evidence supports the result without replaying the whole run.

## 1. Choose the trail

Reuse the task's established decision log when one exists. Otherwise use `decisions.tsv` at the work root for one active effort, or `.audit/<task-slug>.tsv` when several efforts share a workspace.

Treat the trail as a local working artifact by default. Commit it only when the user requests it or the work is substantial enough that the trail is part of the review evidence. Keep existing ignore rules unchanged and state where the local trail lives.

**Complete when:** one canonical path and its local-or-committed status are clear.

## 2. Use the fixed schema

Start an empty trail by copying [the TSV template](assets/decision-trail-template.tsv), or let the logging helper create it with the first row. Keep exactly these columns:

- `ts`: UTC ISO 8601 timestamp.
- `phase`: phase or workstream.
- `decision`: concrete choice, action, pivot, or checkpoint.
- `why`: plain-language reason.
- `evidence`: concise pointer such as a commit, task, command result, `file:line`, artifact, trace, or screenshot.
- `result`: observed outcome or state such as `tests green`, `reverted`, `INCONCLUSIVE`, or `open`.

Every cell stays on one line. Evidence points to proof instead of restating it; prefer proof a reviewer can rerun or reopen.

**Complete when:** the trail has one header row in that exact order and no other schema.

## 3. Record consequential moments

Run the bundled helper from the installed skill directory:

```sh
scripts/log.sh <logfile> <phase> <decision> <why> <evidence> <result>
```

The helper creates parent directories, writes the header on first use, flattens tabs and line breaks, and neutralizes spreadsheet formulas. Resolve `scripts/log.sh` relative to this `SKILL.md`, not the user's working directory.

Add one row when a reviewer would care about the moment:

- a meaningful fork was chosen;
- a phase or loop iteration reached a verified checkpoint;
- evidence triggered a pivot, revert, or scope change;
- a blocker or inconclusive result changed what could happen next;
- a gate passed or failed.

Log only consequential moments with observed outcomes. Describe the action in plain language and keep the row to shareable rationale rather than private reasoning or transcript summary.

**Complete when:** each material decision so far has one concise row with real evidence and an observed result.

## 4. Preserve history

Treat rows as append-only. When a row becomes inaccurate or a decision is reversed, append a new row naming what it supersedes and why. Keep the earlier row as historical evidence.

Keep every cell safe for its intended reviewers: exclude secrets, credentials, personal data, hidden chain-of-thought, and unrelated transcript content. Use the narrowest evidence pointer that still lets a reviewer verify the claim.

**Complete when:** corrections are explicit, chronology remains intact, and every cell is safe to share with the intended reviewers.

## 5. Audit before handoff

Read the trail from top to bottom and compare it with the current run's available commands, outputs, artifacts, and transcript when the environment exposes that transcript. Stay within the active task and workspace.

Check that:

- every row maps to a real action or checkpoint;
- every evidence pointer resolves and supports the result;
- material forks, pivots, reversals, blockers, and failed gates are represented;
- unverified outcomes are labeled `INCONCLUSIVE` or `open` rather than presented as facts;
- the trail contains no routine padding or sensitive content.

Append a correction for any inaccurate historical row. Add missing material rows. In the final response, link or name the trail, state whether it is local or committed, and call out unresolved or weakly supported rows. Bound every claim to what the trail's evidence proves.

**Complete when:** the trail truthfully covers the material run, its evidence has been spot-checked, and the handoff identifies any remaining uncertainty.
