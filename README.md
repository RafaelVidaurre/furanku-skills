# furanku-skills

A public collection of [agent skills](https://agentskills.io) — portable instruction packs for coding agents like Claude Code, Codex, Cursor, and friends. Skills live under `skills/` and follow the Agent Skills spec, so they install anywhere with:

```bash
npx skills add rafaelvidaurre/furanku-skills          # everything
npx skills add rafaelvidaurre/furanku-skills --skill commander # one skill
```

## Skills

### commander

Coordinates Beads across independently owned work fronts. Commander decides the front map and selects a configured Captain or Worker route for each front; Beads remains the durable identity and contract, while Orca remains the coordination system. Spawned-agent routes use a strict layered v2 table, while the user-launched session keeps its own model and effort.

```
> Use Commander to deliver this Bead through Orca.
> Route these ready Beads to the right models and keep concurrency at three.
> Resume this Commander run from its Bead and Orca task IDs.
> Migrate my Commander routing config to version 2.
```

Each run and front has a unique key. Every Orca task carries those keys, its Bead and route IDs, and exact agent/model/effort provenance; dispatch targets the terminal launched for that route. Spawned sessions inherit the Commander session's permission posture rather than a launcher default, so authority is granted once, in the session you launched. Beads hold every requirement, so dispatch text stays a pointer and never restates the work; Commander creates the top-level Bead when the request names none, and each Captain defines its front's scope, non-scope, and acceptance criteria there before decomposing. One Bead may have several Orca execution, review, or integration tasks without duplicating their topology in Beads. Captains own a worktree that parents their Workers' checkouts, and Worker results are reconciled there. Human decisions raised by a Captain reach the user directly or through Commander; an autonomous run resolves them against a peer on the Captain's own route. Runs end with a handover that asks whether to merge or review, and reports changes, problems, guidance fixes, and where time went. Version 1 configs migrate explicitly with a one-time backup.

Open the [skill entrypoint](skills/commander/SKILL.md), [Captain contract](skills/commander/references/captain.md), or [configuration reference](skills/commander/references/configuration.md).

### testing-best-practices

Guides agents to design, write, review, and maintain high-quality automated tests without imposing a testing methodology. It treats each test as evidence, choosing scope and fidelity from the risk while emphasizing observable behavior, determinism, diagnostics, refactor resilience, and suite health across unit and integration tests.

```
> Add tests for this change using the project's conventions.
> Review this test suite for brittle, flaky, or low-value tests.
> What is the smallest credible test for this database integration?
```

Explore the full guidance in the [interactive testing guide](artifacts/testing-best-practices.html), or open the [skill entrypoint](skills/testing-best-practices/SKILL.md).

### council

Convenes a council of AI models that debate a decision and vote their way to consensus — or run a multi-model brainstorm. Your agent acts as moderator: it invokes approved model CLIs inside a private airlock, gives every seat the same curated evidence instead of project access, runs blind first positions, an adversarial challenge round, and a convergence round, then delivers a verdict with the vote, the rationale, and the dissent.

```
> Convene the council: should we migrate this service from REST to gRPC?
> Council of 5, all fable-5, mixed efforts: brainstorm names for this product.
```

First run walks you through approving a bench from the safe one-shot modes it detects (claude, codex, grok, gemini, ...). Executable trust persists per machine (`~/.config/council/config.json`); a project config (`.council.json`) can tune only the approved bench, and prompt overrides apply for that run.

### product-memory

Discovers and preserves product requirements so multi-session and multi-agent work keeps two linked truths: what the user actually said, and the current product interpretation. Verbatim evidence, traceable specs, explicit decisions, open questions, hypotheses, risks, and validation experiments live under `docs/product-memory/` with stable IDs and integrity checks.

```
> Initialize product memory for this project.
> Capture this conversation into product memory and distill requirements.
> Reconcile the product memory after this scope change.
```

Open the [skill entrypoint](skills/product-memory/SKILL.md).

### progress-report

Creates evidence-backed project progress reports that explain what changed, what it means, and what is currently in progress, pending, or blocked. Reports cover the freshest work through the last 30 days with increasing coarseness, while stored reports act as a cache for future runs. Explicit requests always qualify; automatic reports are reserved for formal goal completions and meaningful milestones, and only unspawned root agents may produce them.

```
> Give me a progress report for this project.
> Summarize our current status and progress across the supported timeframes.
```

Open the [skill entrypoint](skills/progress-report/SKILL.md).

### decision-trail

Keeps an append-only TSV trail of consequential decisions, reasons, evidence, and results during substantial work. The trail stays local by default, uses a bundled helper to keep rows safe and well-formed, and gives reviewers a compact way to reconstruct autonomous, unattended, or multi-phase runs.

```
> Keep a decision trail while you work through this migration.
> Run this unattended and leave me a reviewable record of the important calls.
```

Open the [skill entrypoint](skills/decision-trail/SKILL.md).

## Layout

```
skills/
  <name>/
    SKILL.md        # the skill
    references/     # depth loaded on demand
    scripts/        # helpers (optional)
    assets/         # templates copied into projects (optional)
```

Contributions and issues welcome.
