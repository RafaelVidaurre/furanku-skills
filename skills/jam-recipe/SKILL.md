---
name: jam-recipe
description: Make game content with the jam toolkit by following a recipe (a written, checkable workflow) from a brief to delivered files, and write or change recipes. Use when the user asks to make a 3D asset, prop, character or model, a sound effect or a voiced line, or to make any content through a recipe run; when a brief names a recipe or a run id; when checking or resuming work in progress; when existing or bought files should enter the workflow part-way; when a project needs its own steps, gates or checks; or when a workflow that was just improvised should become repeatable.
---

# Recipes and runs

A **recipe** is a named, ordered list of steps that turns a brief into delivered content. A **run** is one attempt of a recipe for one subject, such as `oak-barrel`. Each step has a **gate**: who must accept it (a person, an agent, or nobody). The toolkit tells you the next step, checks what you record, and keeps the record.

`jam` below is `node tools/jam/jam.mjs`, run from anywhere in the project (`tools/jam` is the `toolkit` field of `jam.config.json`). When that file is missing, or `jam doctor` shows a failing line the next step needs, use the `jam-setup` skill, then come back. Every command and flag is in `tools/jam/docs/cli.md` and in `jam <command> --help`.

Two branches: [follow a recipe](#follow-a-recipe), or [author one](#author-a-recipe) when the project's workflow differs from what exists.

## Follow a recipe

1. **Find the run, or choose the recipe.** `jam run status` lists every open run with its next action; a run that exists is resumed, never restarted. Otherwise `jam recipe list` and pick the recipe whose `for:` line matches the request. A project recipe replaces a shipped one with the same id. Done when you can name the recipe and a subject id (`a-z0-9-`, what is being made).
2. **Start.** `jam run start <recipe> <id> --brief-text "<what is wanted>"`, or `--brief <file>`. Put everything known into the brief now: what it is, its size, its use in the game, references. Editing the brief later makes the run's records stale. Act on the notes it prints. An undefined budget is settled later, at the point `tools/jam/docs/settings.md#budgets` names. A missing style document means the game's look is not settled: tell the person and ask once whether to settle it first (`jam-style`) or go ahead, since work made before an art direction is named turns stale when one is. Done when `jam run next <id>` prints a step.
3. **Loop on `jam run next <id>`.** It prints one of five things:

   | It says | Do |
   | --- | --- |
   | A step to work, with its skill, guide, outputs, checks and gate | Read the skill it names and the guide section it points to, do the step, then run the record command it printed with the placeholders filled in |
   | A step waits for review | Decide the [gate](#gates) |
   | Provider jobs are not settled | Settle each one (`tools/jam/docs/providers.md#one-paid-job-start-to-finish`) |
   | The run can be delivered | `jam run deliver <id>` |
   | The run is delivered, or its recipe delivers nothing | Stop and report |

   Keep each step's files in a subfolder of the run folder named for the step (`jam run where <id>` prints the run file; delivery copies this layout). A step that names no skill is done from its guide, and with an empty guide its printed outputs and checks are the whole definition. Record each step when it is finished, before starting the next; the tool hashes and measures the files at that moment. A refused record prints `error:` and `fix:` and writes nothing: apply the fix and record again. Any state you do not recognise is in [references/states.md](references/states.md).
4. **Report**: where the delivered files are, who accepted each gated step, what was spent with which provider, and anything left open with its next command. Commit only when the person asks.

Done when `jam run next <id>` says the run is delivered, or the report names the exact step and decision it is waiting on.

## Gates

`jam run next` prints the commands for the gate in force.

- **Agent gate:** review the step against its evidence and accept with what you checked and saw, or send it back with what must change.
- **Human gate:** `jam catalog open` (it starts the review site for this checkout and keeps it running), then `jam run request-review <id> <step>`, which prints a link to that review. Give the person the link with one sentence saying what they are deciding, and say that it opens on the computer where the project is. Continue with work that does not depend on the answer; `jam run status <id>` reads their decision. When they answered you directly instead, record their words with the `--relay` command that `jam run next` printed. Runs of recipes that deliver nothing (exploration, tests) are not catalog content; `request-review` puts their images, clips and models in front of the person as work.

How to review, what counts as a person's answer, and how to word the request: `tools/jam/docs/review.md`.

## Paid steps

A step marked paid may use a provider. Before anything is submitted, open the job with the `jam job open` command that `jam run next` printed. The whole sequence, quoting and waiting are in `tools/jam/docs/providers.md`; whether the person has already authorized the spending is in `tools/jam/docs/task-intent.md`.

## Starting from existing files

For a bought mesh, a scan or earlier hand-made work, start part-way: `jam run start <recipe> <id> --brief-text "..." --from <step>`. Earlier steps are marked not needed, and recording `<step>` takes `--source "<origin>" --source-evidence <document>`, plus `--tool` when you processed the file. Origin evidence and licences: `tools/jam/docs/external-content.md`.

## One operation, several steps

When one operation produced what several steps ask for (a generated mesh that arrives unwrapped and textured), record them in one call: `jam run record <id> topology uv texture --file model=<file> --note "..." --job <job>`. Each step still runs its own checks and gate, and nothing is written unless all pass.

## Skipping a step

`jam run skip <id> <step> --reason "<why this run does not need it>"` works on steps the recipe marks optional. Steps whose condition does not hold (an engine import with no engine adapter) are skipped by the tool with the reason on record.

## Crunch mode

When the person says speed matters more than their sign-off, lower the gates with one setting and say which human gates that removes: `tools/jam/docs/settings.md#review-mode`. Steps are still recorded as they are done; a run recorded afterwards from memory is not a record.

## Briefing a worker agent

Name the recipe and the run id, and tell the worker to start from `jam run next <id>` with this skill. Add what only you know: the person's own words that authorize spending or delegate decisions, the steps the worker owns, and where to stop (at a human gate it sends back the review link). One agent writes a run at a time.

## Author a recipe

Shipped recipes are starting points. A project's own way of working belongs in project recipes under `jam/recipes/`, where a toolkit upgrade leaves it alone.

| Situation | Do |
| --- | --- |
| One step needs a different gate, its own guide, or to be optional | `jam recipe set <recipe> <step> --review human\|agent\|none`, `--guide <path>` or `--optional true\|false` |
| The project adds, removes or reorders steps, or adds its own checks | `jam recipe new <id> --extends builtin:<base>`, then edit the file |
| Work was just done that no recipe describes | `jam recipe capture <run id> --as <new id>`, then review its gates and checks |
| The way a step is done here changed | Change the recipe or its guide in the same piece of work, so the next run follows it |

Read [references/authoring.md](references/authoring.md) before editing a recipe file: it has the fields, a complete worked extension and how a project check is written. A step that only one game needs (how it splits and reassembles its characters, its naming, its data files) is a step in that game's recipe, not a change to a skill.

Done when `jam recipe check` passes and `jam recipe show <id>` lists the steps you intend.
