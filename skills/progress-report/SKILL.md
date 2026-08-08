---
name: progress-report
description: Create evidence-backed project progress reports with current status and non-overlapping time bands, recording the underlying dated facts for future runs. Use only from an unspawned root agent when the user requests a progress report, or automatically when a formal harness goal completion or meaningful project milestone has produced changes worth reporting.
---

# Progress Report

Make the user-facing report the primary outcome. Keep a machine-local ledger of dated facts as a secondary cache that saves future runs from reconstructing history. Render completed history from ledger facts and live evidence, and every present-state claim from live evidence alone; never store the rendered report as the cache.

## 1. Gate invocation

Proceed only when orchestration provenance establishes that this agent was not spawned by another agent through a workflow, orchestration mechanism, or subagent flow. When a spawned agent receives an explicit request, explain that the root agent owns progress reporting; for an accidental automatic invocation, return control without ceremony. When the runtime exposes no spawn provenance at all, treat a direct explicit user request as root eligibility and leave automatic invocation off.

An explicit user request always qualifies. Automatic invocation qualifies only after a formal harness goal (for example, `/goal`) completes or a meaningful project milestone is reached, and verified changes materially affect at least one of:

- project capability;
- phase or milestone state;
- direction, readiness, or risk the user should understand;
- substantial remaining or blocked work.

Invoke autonomously only when the report will provide value. If the automatic gate fails, continue the normal handoff without mentioning a report.

**Complete when:** root provenance and either explicit-request or report-worthy automatic eligibility are established.

## 2. Resolve scope and evidence

Use the project's established workspace root, then the nearest version-control root, then the working directory. The project boundary may include linked worktrees, its issue tracker, orchestration state, and other authoritative project systems.

Set `generated_at` to the current environment-local ISO 8601 timestamp. Treat it as the evidence cutoff and compare source timestamps as absolute instants.

Cached history lives in a machine-local, project-scoped ledger, outside the repository, so it never appears in working trees, commits, diffs, or merges. Resolve its path once per run:

```sh
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$ROOT" ]; then COMMON=$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
else COMMON=$(cd "$WORKSPACE_ROOT" && pwd -P); fi
case "$COMMON" in */.git) NAME=$(basename "$(dirname "$COMMON")") ;; *) NAME=$(basename "$COMMON") ;; esac
SLUG=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9][^a-z0-9]*/-/g; s/^-//; s/-$//')
[ -n "$SLUG" ] || SLUG=repo
DIGEST=$(printf '%s' "$COMMON" | { shasum -a 256 2>/dev/null || sha256sum; } | cut -c1-16)
LEDGER="$HOME/.furanku-skills/progress-report/projects/$SLUG-$DIGEST/ledger.jsonl"
```

Keying on the Git common directory makes every linked worktree of one project share a single ledger. Outside a version-controlled project, set `WORKSPACE_ROOT` to the workspace root resolved above so that every subdirectory keys to the same ledger — deriving the key from the working directory instead would give one project several ledgers. An empty `DIGEST` means no SHA-256 tool was available: report that rather than writing to a truncated path, which would merge unrelated projects into one ledger.

Read the ledger for the 30-day reporting window by `occurred_at`, and read the `archive/*.jsonl` files beside it when that window reaches past the ledger's oldest entry. Its entries are historical facts, not a finished report:

- Set aside every entry that a later entry supersedes, before anything else, so a corrected record never renders beside its own correction.
- Trust a surviving entry's completed outcome once its provenance verifies, and cite it instead of reopening its evidence chain.
- Read entries as positive evidence only. A gap between them records that nothing was written, never that nothing happened, so treat a quiet interval as unexamined until live evidence says otherwise.
- Verify provenance before trusting. An entry carrying commits is reachable when any of them is an ancestor of `HEAD` or of the default branch. An entry carrying no commits rests on its `evidence` instead: confirm that live, and never put it through a reachability test it can never pass. Resolve the default branch rather than assuming `main`: `origin/HEAD` is often unset even in cloned repositories, and projects choose their own default branch names.

  ```sh
  DEFAULT=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); DEFAULT=${DEFAULT#origin/}
  if [ -z "$DEFAULT" ] || ! git rev-parse --verify -q "$DEFAULT" >/dev/null 2>&1; then DEFAULT=$(git rev-parse --abbrev-ref HEAD); fi
  git merge-base --is-ancestor "$SHA" HEAD 2>/dev/null || git merge-base --is-ancestor "$SHA" "$DEFAULT" 2>/dev/null
  ```

  A commit Git no longer holds also counts as unreachable — that is the ordinary end state for abandoned work once Git has collected it, so the check reports it as absent rather than as a broken check. In a shallow clone, where old objects are simply absent, record a coverage note instead and leave the affected entries unresolved.

- Resolve every unreachable entry, because it means one of two opposite things and only live evidence separates them. Re-verify it against the project's current state:
  - A reachable commit establishes the same outcome, so the work arrived under new SHAs through a squash or rebase merge. Append a superseding entry carrying that commit and the instant it landed, and report the outcome normally. This re-anchoring promotes provisional branch work into confirmed project history and keeps later runs from re-verifying the same entry forever.
  - Nothing reachable establishes the outcome, so the work was abandoned, reverted, or never merged. Append a superseding entry recording that, and leave the outcome out of completed progress.

  Match on a reachable commit rather than on the current tree resembling the outcome: a branch the user abandoned and a later independent implementation look alike in the working tree, and re-anchoring to the wrong one would keep the abandoned entry's date and branch.
- Inspect live, authoritative evidence for work newer than the newest entry, uncovered intervals, direct contradictions, and every present-state claim. Current state is always derived live, never read from the ledger.
- Treat an entry from a branch other than the current one as parallel project work: report it as progress when its provenance verifies, and attribute it to its branch when that keeps the report honest.
- On a first run, prefer high-signal sources such as version-control history and state, task or issue state, milestone records, test results, and recorded decisions over reconstructing every action.
- Follow a legacy repo-local `.furanku-skills/progress-reports/` directory to the evidence it cites, and never write there again. Its band headings are ranges relative to that report's own generation time, so they can date an outcome only to within a range: take `occurred_at` from the underlying evidence, and where that evidence is gone, report a coverage note rather than inventing an instant.
- Add a terse coverage note when unavailable evidence materially limits a time range. Coverage never determines work status.

**Complete when:** the ledger path resolves to one non-empty project key, every superseded entry is set aside and every unreachable entry is re-anchored or superseded, and the current state and every material outcome in the 30-day window rest on live evidence, verified ledger evidence, or an explicit coverage boundary.

## 3. Build the report model

Write a two- or three-sentence `At a glance` summary that begins with the project's present position, the most important change, and why it matters. Assume the user knows the project's purpose and established product language; explain the project's basics only when needed to disambiguate the report's scope. Populate current status from live evidence:

- **In progress:** material work actively underway.
- **Pending:** material work supported by an explicit goal, plan, task, requirement, or user decision and connected to the active goal, recent milestones, or immediate direction.
- **Blocked:** material work stopped on a concrete dependency; name the dependency and the condition that unblocks it.

Build one chronological view across non-overlapping time bands: `Most recent work`, earlier in the last 8 hours, 8–24 hours ago, 24–48 hours ago, 48–72 hours ago, 3–7 days ago, and 7–30 days ago. Choose the recent-work boundary semantically within the last 8 hours: the newest coherent work a human would still hold as the fresh chunk, using the session, latest deliverable, and previous run's boundary as cues rather than a mechanical rule. Keeping that boundary inside 8 hours is what lets `Most recent work` and the band after it divide the same 8 hours without overlapping.

Assign each completed outcome to exactly one progress band by comparing an absolute instant against `generated_at`: a ledger entry's `occurred_at`, or the equivalent instant from live evidence. When work spans bands, place it in the band containing its latest material change and mention older setup only when needed to explain the outcome. Use `At a glance` for the overall synthesis; let each successive progress band add older context instead of repeating newer entries.

Coarsen by compression, not omission. Coarsening shapes the rendered report only — the ledger keeps every entry at full fidelity, so an older band reads as a theme today without losing the detail a later run may need:

- Most recent work and the remainder of the last 8 hours preserve distinct deliverables and decisions.
- The 8–24-hour and 24–48-hour bands combine closely related changes into outcomes.
- The 48–72-hour and 3–7-day bands combine outcomes into project themes.
- The 7–30-day band describes strategic capabilities, phases, and major direction changes.

Model entries around independently meaningful project outcomes, capabilities, decisions, or blockers before mapping tracker records to them. Group records that contribute to the same outcome. Write for a project-aware reader who may not know or remember the recent work: use established product and domain terms normally, explain newly introduced or ambiguous concepts in simple terms, and avoid internal tracker, implementation, or orchestration jargon in the explanation. Make each entry understandable without implying that a recent task, decision, or term was already discussed in this conversation. For enabling work with no standalone user-facing result, state what it makes possible, whether it is usable or visible yet, and the meaningful milestone it enables. Keep task IDs, worker assignments, execution order, and dependency edges in evidence unless a dependency is itself the blocker.

Retain every material capability, decision, milestone, blocker, and direction change. Order entries by importance to the user, using recency to break ties. Give each entry a self-explanatory outcome title, a short description of what it changes and why it matters, and compact evidence. Present current-state outcomes as tables and completed outcomes as bullets. Write `None.` under an empty heading.

**Complete when:** the model accounts for material completed work across every time band and material present work across all three statuses, with each claim traceable to evidence and each completed outcome appearing in exactly one progress band. With evidence references hidden, a project-aware reader who did not follow the recent implementation can still explain in simple terms what each entry changes, whether it is usable now, why it matters, and what comes next when relevant.

## 4. Append to the ledger

Build entries from the dated facts gathered in step 2, never from the grouped outcomes step 3 assembles for the reader. Step 3 compresses older work into themes deliberately; storing those themes would bake today's compression into tomorrow's history and destroy exactly the detail the ledger exists to keep. Hold each line to one instant and one provenance set.

Append every durable fact the 30-day scan established that the ledger does not already carry — including facts older than this run, so that a first run leaves a populated ledger behind — together with every superseding entry step 2 resolved. Treat a fact as already carried when it shares a commit with an existing entry (`grep -Fq "$SHA" "$LEDGER"`), or when it carries no commits and matches one by `title`.

```json
{"v":3,"id":"20260807T110200-7f3a","occurred_at":"2026-08-07T11:02:00+01:00","kind":"outcome","title":"Routing selector replaced by agent judgment","detail":"Crew now routes from the brief instead of a numeric score, so preferences read as plain language.","branch":"worktree-routing-agency-rethink","commits":["a88ce5edb180c276d20815658a756dbfe4a7bd9a"],"evidence":["skills/crew/SKILL.md","python3 scripts/test_router.py: 14 passed"]}
```

| Field | Meaning |
| --- | --- |
| `id` | Identifier unique within the ledger, so later entries can supersede this one unambiguously. Combine the entry's timestamp with a few random characters; two runs in different worktrees can otherwise mint the same id in the same second. |
| `v` | Schema version, currently `3`. |
| `occurred_at` | Absolute local ISO 8601 instant the outcome became true or last changed materially, taken from its authoritative source event: committer time for a commit, recorded event time for a tracker or decision record, execution time for a test result. Every band derives from this at render time, so it is never a band label or a relative expression. |
| `kind` | `outcome`, `decision`, or `blocker`. |
| `title` | Self-explanatory outcome title. |
| `detail` | What it changes and why it matters, in the plain terms step 3 requires. |
| `branch` | Branch the work was observed on. |
| `commits` | Full commit object IDs the claim rests on — the provenance the next run verifies. Store them unabbreviated, since a short prefix can turn ambiguous as the repository grows. Empty only for an outcome with no commit, which step 2 then verifies through `evidence`. |
| `evidence` | Compact source references: paths, task IDs, test results. |
| `supersedes` | IDs of entries this one reverses or replaces. Omit when empty. |

Create the directory when needed and append with `>>`, writing each entry as one line closed by a newline. A single-line append of this size is atomic, so runs in different worktrees interleave safely; an entry left without its closing newline instead fuses with the next append and destroys both.

Entries are immutable once written: correct the record by appending an entry that `supersedes` the earlier one, never by editing or deleting a line. Reversed, abandoned, and unmerged work stays in the ledger — step 2 decides at read time what still holds, and an honest history keeps its own corrections.

Entry contents and ids never change, and the active file only grows between archival passes. Archiving moves lines older than the 30-day window verbatim into `archive/<year>.jsonl` beside the ledger; summarizing or rewriting them during the move destroys the fidelity the ledger exists to preserve. Because archiving rewrites the active file while other runs may be appending to it, hold a lock for that pass alone — `mkdir "$LEDGER.lock"` succeeds for exactly one run — and skip archiving when the lock is already held. Ordinary appends need no lock.

Never write the ledger into the repository or commit it. If the append fails, present the report and report the write failure to the user.

**Complete when:** every durable fact the scan established, and every supersession step 2 resolved, exists as exactly one newline-terminated line carrying an absolute `occurred_at`, one provenance set, and no grouping borrowed from step 3 — or the write failure is explicit.

## 5. Report to the user

Present the report itself as the primary outcome. Use this user-facing template, replacing every placeholder and removing the optional `Coverage` section when evidence access was sufficient:

```markdown
# Progress report — <Project name>

_As of <generated_at>._

<Two or three sentences beginning with the project's present position, the most important change, and why it matters.>

## Current status

| Status | Outcome | What it means | Evidence |
| --- | --- | --- | --- |
| 🟡 In progress | **<Title>** | <What is actively underway and what completing it will mean.> | `[E1]` |
| ⏳ Pending | **<Title>** | <What is agreed but not started, and why it matters.> | `[E2]` |
| 🔴 Blocked | **<Title>** | <What is stopped, the dependency, and the unblock condition.> | `[E3]` |

## Progress over time

**Most recent work**

- **<Title>** — <Outcome and meaning.> `[E4]`

**Earlier in the last 8 hours**

- **<Title>** — <Outcome and meaning.> `[E5]`

**8–24 hours ago**

- **<Coarser title>** — <Combined outcome and meaning.> `[E6]`

**24–48 hours ago**

- **<Coarser title>** — <Combined outcome and meaning.> `[E7]`

**48–72 hours ago**

- **<Theme title>** — <Thematic outcome and meaning.> `[E8]`

**3–7 days ago**

- **<Theme title>** — <Thematic outcome and meaning.> `[E9]`

**7–30 days ago**

- **<Strategic title>** — <Strategic capability, phase, or direction change.> `[E10]`

## Coverage

<One sentence naming the unavailable source or unsupported interval.>

## Evidence

- `E1` — <Compact source references.>
- `E2` — <Compact source references.>
- <Continue only for evidence labels used above.>

_Ledger: `<ledger path>` (+<n> entries)._
```

Represent each modeled current-status outcome in one row. Represent an empty status with a row whose outcome is `None.` so absence remains visible. Use restrained emojis as semantic status markers, not decoration. Write `None.` for an empty time band. Reuse one evidence label for claims supported by the same sources. Keep the evidence list compact, and omit it only when the rendered surface provides equally traceable inline links. Adapt typography to the rendering surface while preserving this information order, every time band, and the report model's facts and statuses.

When the append fails, replace the ledger footer with `_Ledger not updated: <reason>._`.

**Complete when:** without relying on prior conversation or internal work-tracking context, a user familiar with the project can understand in simple terms what changed, why it matters, what is active, pending, or blocked, and how progress unfolded across the non-overlapping time bands.
