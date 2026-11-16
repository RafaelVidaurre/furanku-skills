---
name: jam-engine
description: Choose, configure and use the engine adapter that gives the jam skills a game engine's conventions and commands, and write a new adapter. Use when a project picks or changes its engine for jam work, when a step needs engine facts (units, axes, formats, naming, skeletons), when a step imports, inspects, looks up references of, captures or checks an asset in the engine, when the adapter has no command for a step and it must be done by hand, or when writing an adapter for an engine or an in-house runtime.
---

# Engine adapters

An **engine adapter** is the one place a project's engine is named. It supplies **facts** (conventions), optional **commands** that reach the engine, and **guidance** for what is done by hand. Asset skills read facts and call commands through `jam engine`; they never name an engine.

When `tools/jam/jam.mjs` is missing, use the `jam-setup` skill first. Run everything from the project root; `jam` below is `node tools/jam/jam.mjs`.

## Choose and configure

1. **See what is in force:** `jam engine show`. It names the adapter, where it comes from (`project`, `preset` or no engine chosen), which commands it runs itself, its guides, and the other adapters available.
2. **Choose one.**
   - The project's engine has a full adapter (facts, commands, guidance), shipped as its own skill or written for the project: `jam engine install <adapter folder>` copies it to `jam/engines/<id>/` and selects it.
   - Otherwise a **preset** the toolkit ships (facts only): set `engine.adapter` in `jam.config.json` to its id. Every engine step is then done by hand.
   - No engine: leave `engine.adapter` null. Facts are glTF's (meters, +Y up, front +Z, right-handed) and work ends at the delivered files.
3. **State what differs in this project** under `engine.facts` in `jam.config.json` (tracked): these merge over the adapter's facts. Adapter-specific options go under `engine.facts.extra`; the adapter's guides say which.
4. **State how this machine reaches the engine** under `engine` in `jam.local.json` (Git-ignored): an editor path, a bridge program, a port. The adapter's own guide defines the fields; credentials never go here.

Done when `jam engine show` names the adapter you chose and `jam engine facts` prints the conventions you expect.

## Use

| Need | Command |
| --- | --- |
| A convention | `jam engine facts [<dotted path>]`, for example `jam engine facts mesh.static` |
| Put delivered files in the engine | `jam engine import --kind <kind> <files>`, or `--run <id>` to import a run's result and record the step |
| What the engine made of an asset | `jam engine inspect <engine asset id>` |
| What refers to an asset | `jam engine references <engine asset id>` |
| A still from the engine | `jam engine capture <engine asset id> <out.png>` |
| The adapter's own checks | `jam engine check <arguments>` |
| A rig on one of the engine's skeletons | `jam engine conform-skeleton <model> [--skeleton <id>]` |
| A guide | `jam engine docs <topic>` |

- **Read conventions, never assume them.** Units, axes, interchange formats, texture conventions, collision naming, skeleton names and name prefixes come from `jam engine facts`.
- **Each command prints one JSON receipt.** `import` returns the engine's asset ids; with `--run` the toolkit records them on the step. Importing the same source again keeps the id.
- **Arguments after the verb go to the adapter's command.** `jam engine docs import` (or the command's own header) lists them; put ones that start with a dash after `--`.
- **A failure is the adapter's or the machine's.** The message carries the adapter's last lines; the usual cause is the `engine` block in `jam.local.json`.

## When the adapter has no command

A preset has none, and a full adapter may leave any out. `jam engine <verb>` then prints what to do next and, when the adapter has one, the path of its guide for doing the step by hand.

1. Read the guide (`jam engine docs <verb>`) and do the step in the engine as it describes. With no guide, follow the engine's own documentation and the facts.
2. Keep evidence of the result: the engine's asset id, and a still or a readout that shows it ([references/acceptance.md](references/acceptance.md)).
3. Record the step with that evidence and a note of what was done by hand: `jam run record <id> <step> --evidence <file> --note "<what was done>"`.

Done when the step is recorded with evidence someone else can open.

## Accepting engine work

Read [references/acceptance.md](references/acceptance.md) before calling an imported asset done: it holds the engine-neutral rules (seen in the engine, checked on the working machine, a still before a clip, shipped means loaded in a packaged build, reimport keeps the id, sources stored project-relative). The adapter's `acceptance` guide says how each is met in its engine.

## Write an adapter

For an engine without one, an in-house runtime, or a project that drives its engine its own way: follow [references/writing-an-adapter.md](references/writing-an-adapter.md), starting from the working example in `assets/example-adapter/`. [references/contract.md](references/contract.md) is the full contract: the folder, `adapter.json`, how commands are run, the receipts, and where machine settings live.
