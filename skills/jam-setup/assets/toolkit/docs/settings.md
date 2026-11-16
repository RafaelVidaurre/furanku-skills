# Project settings

`jam.config.json` is the project's policy and is tracked in Git. `schemas/jam.config.schema.json` describes every field; this page covers what the fields mean for a person and how to change them.

```
jam config show [<field>]          the configuration, or one field
jam config set <field> <value>     one field; the whole file is validated first
jam config set <field> --remove
jam config check                   every problem, with its field
```

A value is text, a number, `true`/`false`, `none` (stored as `null`) or JSON for an object. Apply a clear request directly and say what changed; ask only when the provider, the step or the scope (project, recipe or one run) is unclear.

## Spending

Each provider has its own balance in its own unit. There is no conversion between them, so each provider is asked about and capped separately. `jam provider list` shows every provider and whether paid work is on for it; `jam provider probe <id>` adds how it prices a job. A provider billed through another service is capped as that service.

| Field | Meaning |
| --- | --- |
| `spend.<provider>.perRun` | The most one run (one asset) may spend with this provider |
| `spend.<provider>.total` | The most all runs together may spend. Starts with no cap |
| `spend.<provider>.standing` | The person's own words that allow work inside the caps without asking each time, with who said it and when |

A cap is a number, `none` (no cap from the toolkit; the account's own limits still apply) or `0` (paid work off). A provider with no entry cannot be paid. Setting `perRun` is enough to turn paid work on; `total` is an extra ceiling the person may add.

Ask in the person's terms. Name the provider and say what its unit is in words the first time, never by abbreviation alone ("this service charges in its own credits, called Compute Units"), and give the three choices for what one asset may cost: off, a limit they name, or no limit. Give an amount only when you have a quote or a price to base it on; when you do, say what it buys ("about 20 credits per model, so 300 covers a prop with retries"). When the provider's own balance call shows less than the limit, say that too. One provider per question.

```
jam config set spend.<provider>.perRun 300
jam config set spend.<provider>.standing "<their name> <YYYY-MM-DD>: <their words>"
```

Only the person raises a cap. When a job is refused for passing one, stop and report what was spent and what the next job would cost.

**Standing authorization.** Without it, each paid job needs `--authorized "<who, when, their words>"` on `jam job open`. With it, work inside the caps proceeds on the agent's judgement and is reported afterwards: what was spent, on what, and why. Record it only from the person's own words, kept as written; where the words do not name the provider or the amount ("that service"), add it after them in square brackets. It covers spending inside the caps for work already asked for; it does not start new work, buy credits or change a plan.

A cap is not a request. Setting or raising one during setup configures the project; it does not ask for anything to be generated. See [task-intent.md](task-intent.md).

## Review mode

```
jam config set review.mode recipe     each step's own gate (default)
jam config set review.mode agent      no gate is stricter than agent review
jam config set review.mode none       work is recorded with no gate
```

`agent` and `none` are the crunch switch: one visible, reversible setting. Use `agent` when the person wants to stop being asked; use `none` only when they say reviews are to be dropped altogether. Records, origins and the ledger are kept in every mode, and spending caps are untouched. Set it only on the person's instruction, tell them which of their approvals it removes (`jam recipe show <recipe>` lists each step's gate; in a run, `jam run status <id>` shows a lowered one as `agent (recipe: human)`), and set it back when they say the crunch is over.

To change one step for good, change the recipe: `jam recipe set <recipe> <step> --review human|agent|none`. To require a person on some steps of one run: `jam run set <id> --human <steps>`.

## Budgets

A budget is what a delivered asset may cost at run time: `kind` (`static` or `deforming`), `triangles.target` and `triangles.max`, `textureSize` (largest side, a power of two), `maxMaterials`, `maxTextureMiB`. A deforming budget adds `maxInfluences`, `poses` and optionally `skeleton`. `context` is an object of notes on why the numbers are what they are (`{"camera": "...", "platform": "..."}`); it is not enforced.

```
jam config set budgets.prop '{"kind":"static","triangles":{"target":3000,"max":8000},"textureSize":1024,"maxMaterials":1,"maxTextureMiB":24}'
```

Those numbers are an illustration. A recipe names its default budget; `--budget` on `jam run start` picks another. Decide a budget with the person when the mesh is about to be made, since its targets shape that request and the topology step is the first to check it; before that, images need none. Base it on the game's camera, platform and how many of the asset are on screen ([asset-workflows.md](asset-workflows.md#budgets)), and ask in plain words ([interaction.md](interaction.md#asset-budget)). Never fill one in to get past a refusal.

## Style

`style.document` is the style guide, `style.references` the approved images, `style.revision` the name of the approved art direction. Changing `style.revision` makes earlier style-bound work stale; editing the document or adding references does not. [style-library.md](style-library.md) says when each changes.

## Routes, engine, roots, checks

- `routes.<capability>` names the provider normally used for `image`, `mesh`, `sound` or `voice`. It is a preference, not a restriction: see [providers.md](providers.md#routes).
- `engine.adapter` and `engine.facts`: the `jam-engine` skill.
- `roots.scratch`, `roots.delivered`, `roots.scan`: where runs work, where they deliver, and further folders searched for run files. After changing them, run the installer again so `.gitignore` and Git LFS rules follow.
- `checks.<name>`: a project check as a command. The `jam-recipe` skill's authoring reference shows one.

## This machine

`jam.local.json` is ignored by Git and holds paths only: `python`, `blender`, `ffmpeg`, `providers.<id>` for a provider's program that is not on PATH, and `engine` for how this machine reaches the engine. No credential belongs in either file.
