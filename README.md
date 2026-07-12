# furanku-skills

A public collection of [agent skills](https://agentskills.io) — portable instruction packs for coding agents like Claude Code, Codex, Cursor, and friends. Skills live under `skills/` and follow the Agent Skills spec, so they install anywhere with:

```bash
npx skills add rafaelvidaurre/furanku-skills          # everything
npx skills add rafaelvidaurre/furanku-skills --skill commander # one skill
```

## Skills

### commander

Turns one agent into a non-implementing Commander that remains the user's sole interface while Captains design and coordinate complex work and Sergeants deliver it. It supports persistent background jobs, adaptive routing, model-and-effort rosters, evidence-based acceptance, and project-specific orchestration mechanisms without imposing a work tracker.

```
> Set up Commander for this project using the orchestration tools available here.
> Act as Commander and deliver this feature while I continue working with you on something else.
> Show me the state of every active Commander job.
```

Project setup qualifies the machine's real tools before use. Raw harness commands and Orca are bundled examples; projects may configure other mechanisms in short prose.

Open the [skill entrypoint](skills/commander/SKILL.md) to see the command loop and setup contract.

### testing-best-practices

Guides agents to design, write, review, and maintain high-quality automated tests without imposing a testing methodology. It treats each test as evidence, choosing scope and fidelity from the risk while emphasizing observable behavior, determinism, diagnostics, refactor resilience, and suite health across unit and integration tests.

```
> Add tests for this change using the project's conventions.
> Review this test suite for brittle, flaky, or low-value tests.
> What is the smallest credible test for this database integration?
```

Explore the full guidance in the [interactive testing guide](artifacts/testing-best-practices.html), or open the [skill entrypoint](skills/testing-best-practices/SKILL.md).

### council

Convenes a council of AI models that debate a decision and vote their way to consensus — or run a multi-model brainstorm. Your agent acts as moderator: it spawns the seats (other model CLIs installed on your machine), runs blind first positions, an adversarial challenge round, and a convergence round, then delivers a verdict with the vote, the rationale, and the dissent.

```
> Convene the council: should we migrate this service from REST to gRPC?
> Council of 5, all fable-5, mixed efforts: brainstorm names for this product.
```

First run walks you through picking a bench from the CLIs it detects (claude, codex, grok, gemini, ...). Defaults persist per machine (`~/.config/council/config.json`) and per project (`.council.json`); anything you say in the prompt — seat count, models, efforts — overrides them for that run.

## Layout

```
skills/
  <name>/
    SKILL.md        # the skill
    references/     # depth loaded on demand
```

Contributions and issues welcome.
