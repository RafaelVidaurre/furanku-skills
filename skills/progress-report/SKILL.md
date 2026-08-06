---
name: progress-report
description: Create evidence-backed project progress reports with current status and non-overlapping time bands, caching them for future runs. Use only from an unspawned root agent when the user requests a progress report, or automatically when a formal harness goal completion or meaningful project milestone has produced changes worth reporting.
---

# Progress Report

Make the user-facing report the primary outcome. Store the structured report as a secondary cache that saves future agents from reconstructing history.

## 1. Gate invocation

Proceed only when orchestration provenance establishes that this agent was not spawned by another agent through a workflow, orchestration mechanism, or subagent flow. When a spawned agent receives an explicit request, explain that the root agent owns progress reporting; for an accidental automatic invocation, return control without ceremony.

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

Read `.furanku-skills/progress-reports/` newest-first. Use the smallest set of prior reports needed to cover the requested time range:

- Trust a cached report as evidence for its completed historical outcomes and cite it instead of reopening its evidence chain.
- Inspect live, authoritative evidence for work newer than the cache, uncovered intervals, direct contradictions, and all present-state claims.
- On a first run, prefer high-signal sources such as version-control history and state, task or issue state, milestone records, test results, and recorded decisions over reconstructing every action.
- Add a terse coverage note when unavailable evidence materially limits a time range. Coverage never determines work status.

**Complete when:** the current state and every material outcome in the 30-day window are supported by live evidence, cached evidence, or an explicit coverage boundary.

## 3. Build the report model

Write a two- or three-sentence `At a glance` summary that begins with the project's present position, the most important change, and why it matters. Assume the user knows the project's purpose and established product language; explain the project's basics only when needed to disambiguate the report's scope. Populate current status from live evidence:

- **In progress:** material work actively underway.
- **Pending:** material work supported by an explicit goal, plan, task, requirement, or user decision and connected to the active goal, recent milestones, or immediate direction.
- **Blocked:** material work stopped on a concrete dependency; name the dependency and the condition that unblocks it.

Build one chronological view across non-overlapping time bands: `Most recent work`, earlier in the last 8 hours, 8–24 hours ago, 24–48 hours ago, 48–72 hours ago, 3–7 days ago, and 7–30 days ago. Choose the recent-work boundary semantically: the newest coherent work a human would still hold as the fresh chunk, using the session, latest deliverable, and previous-report boundary as cues rather than a mechanical rule.

Assign each completed outcome to exactly one progress band, based on when it became true or last changed materially. When work spans bands, place it in the band containing its latest material change and mention older setup only when needed to explain the outcome. Use `At a glance` for the overall synthesis; let each successive progress band add older context instead of repeating newer entries.

Coarsen by compression, not omission:

- Most recent work and the remainder of the last 8 hours preserve distinct deliverables and decisions.
- The 8–24-hour and 24–48-hour bands combine closely related changes into outcomes.
- The 48–72-hour and 3–7-day bands combine outcomes into project themes.
- The 7–30-day band describes strategic capabilities, phases, and major direction changes.

Model entries around independently meaningful project outcomes, capabilities, decisions, or blockers before mapping tracker records to them. Group records that contribute to the same outcome. Write for a project-aware reader who may not know or remember the recent work: use established product and domain terms normally, explain newly introduced or ambiguous concepts in simple terms, and avoid internal tracker, implementation, or orchestration jargon in the explanation. Make each entry understandable without implying that a recent task, decision, or term was already discussed in this conversation. For enabling work with no standalone user-facing result, state what it makes possible, whether it is usable or visible yet, and the meaningful milestone it enables. Keep task IDs, worker assignments, execution order, and dependency edges in evidence unless a dependency is itself the blocker.

Retain every material capability, decision, milestone, blocker, and direction change. Order entries by importance to the user, using recency to break ties. Give each entry a self-explanatory outcome title, a short description of what it changes and why it matters, and compact evidence. Present current-state outcomes as tables and completed outcomes as bullets. Write `None.` under an empty heading.

**Complete when:** the model accounts for material completed work across every time band and material present work across all three statuses, with each claim traceable to evidence and each completed outcome appearing in exactly one progress band. With evidence references hidden, a project-aware reader who did not follow the recent implementation can still explain in simple terms what each entry changes, whether it is usable now, why it matters, and what comes next when relevant.

## 4. Write the cache artifact

Create `.furanku-skills/progress-reports/` when needed and write one immutable file named with a filesystem-safe local timestamp, such as `2026-07-17T14-30-00+01-00.md`. Add a numeric suffix on collision. Use only this frontmatter:

```yaml
---
schema: progress-report/v2
generated_at: 2026-07-17T14:30:00+01:00
---
```

Use this fixed body hierarchy:

```text
# Progress Report
## At a glance
## Current state
### In progress
### Pending
### Blocked
## Progress
### Most recent work
### Earlier in the last 8 hours
### 8–24 hours ago
### 24–48 hours ago
### 48–72 hours ago
### 3–7 days ago
### 7–30 days ago
## Coverage                 # only when materially limited
```

Format outcomes under each non-empty current-state heading as a table:

```markdown
| Outcome | What it means | Evidence |
| --- | --- | --- |
| **Title** | Short description of the work and its status implications. | `relative/path`, task ID, or test result |
```

Format completed progress entries as:

```markdown
- **Title** — Short description focused on the outcome and what it means.
  Evidence: `relative/path`, commit or task ID, test result, or prior report path.
```

Keep prior reports immutable. Create no index, symlink, consolidation, pruning, or commit. If persistence fails, retain the report for presentation and record the write failure for the user.

**Complete when:** one new artifact exists at the required path with valid frontmatter, every required heading, and evidence for every non-empty entry, or the write failure is explicit.

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

_Cached at `.furanku-skills/progress-reports/<timestamp>.md`._
```

Represent each modeled current-status outcome in one row. Represent an empty status with a row whose outcome is `None.` so absence remains visible. Use restrained emojis as semantic status markers, not decoration. Write `None.` for an empty time band. Reuse one evidence label for claims supported by the same sources. Keep the evidence list compact, and omit it only when the rendered surface provides equally traceable inline links. Adapt typography to the rendering surface while preserving this information order, every time band, and the artifact's facts and statuses.

When persistence fails, replace the cache footer with `_Artifact not saved: <reason>._`.

**Complete when:** without relying on prior conversation or internal work-tracking context, a user familiar with the project can understand in simple terms what changed, why it matters, what is active, pending, or blocked, and how progress unfolded across the non-overlapping time bands.
