# furanku-skills

A public collection of [agent skills](https://agentskills.io) — portable instruction packs for coding agents like Claude Code, Codex, Cursor, and friends. Skills live under `skills/` and follow the Agent Skills spec, so they install anywhere with:

```bash
npx skills add rafaelvidaurre/furanku-skills          # everything
npx skills add rafaelvidaurre/furanku-skills --skill commander # one skill
```

## Skills

### commander

Makes a session the standing manager of one project's multi-agent delivery, adding exactly two policies on top of Beads and Orca: model-effort routing through a user-approved table (machine-global, Git-tracked repository, machine-local repository, and current-run precedence) and Bead-first context discipline — requirements are distilled into the Bead with the user present, downstream agents hydrate from the Bead and repository, and clarifications pass verbatim. Beads owns durable work, the Orca skills own coordination process, and usage, reset, login, account, credit, plan, and billing controls remain exclusively human-operated.

```
> Use Commander to deliver this Bead through Orca.
> Route these ready Beads to the right models and keep concurrency at three.
> Resume this Commander run from its Bead and Orca task IDs.
```

Open the [skill entrypoint](skills/commander/SKILL.md).

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
