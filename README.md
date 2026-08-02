# furanku-skills

A public collection of [agent skills](https://agentskills.io) — portable instruction packs for coding agents like Claude Code, Codex, Cursor, and friends. Skills live under `skills/` and follow the Agent Skills spec, so they install anywhere with:

```bash
npx skills add rafaelvidaurre/furanku-skills          # everything
npx skills add rafaelvidaurre/furanku-skills --skill crew # one skill
```

## Skills

### crew

Assigns explicit Commander, Captain, and Worker ownership while leaving durable work to Beads and coordination mechanics to Orca.

`crew` replaces the former `commander` skill. Existing version 2 route configuration keeps its established `commander` storage paths, so no configuration move is required.

```text
> Act as Commander. Coordinate my projects through Orca without modifying project files.
> You are now Captain for the editor front. Report directly to me.
> Take command of the existing editor Captain.
> Show the effective Crew routes for this repository.
```

Commander is the user's cross-project point of contact and may assign Captains or direct Workers. Captain owns one front's design, decomposition, decisions, and integration and assigns only Workers. Worker owns one bounded outcome. Direct Captains report to the user; a Commander takes command by dispatching an upstream Orca task to the existing Captain terminal without restarting its work or Workers.

Open the [skill entrypoint](skills/crew/SKILL.md), [Commander contract](skills/crew/references/commander.md), [Captain contract](skills/crew/references/captain.md), or [configuration reference](skills/crew/references/configuration.md).

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

### guidance-composer

Pick engineering principles from a categorized catalog and inject them into a project — into `AGENTS.md`, a linked markdown file, or a custom path. The **CLI is the primary surface** (interactive wizard for setup; flags for agents and scripts). Managed blocks use a closed marker pair so hand-written notes outside them are never clobbered.

```bash
# from a checkout of this repo
node skills/guidance-composer/bin/guidance-composer.js          # interactive
node skills/guidance-composer/bin/guidance-composer.js list
node skills/guidance-composer/bin/guidance-composer.js inject \
  --ids simplest-current,no-backward-compat --mode inline --yes

# when the package is on npm / via npx
npx furanku-guidance-composer list
npx furanku-guidance-composer inject --ids simplest-current --mode linked --yes
```

```
> Compose guidance: no backward compat, simplest that meets current needs.
> What guidance categories exist, and what does long-term-architecture mean?
> Diff this repo against the guidance catalog.
```

Open the [skill entrypoint](skills/guidance-composer/SKILL.md) or the [catalog](skills/guidance-composer/references/catalog.json).

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
