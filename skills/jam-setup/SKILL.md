---
name: jam-setup
description: Install, upgrade and configure the jam game-content toolkit in a project, and diagnose it. Use when starting jam work in a project that has no toolkit, when a jam command or skill reports a missing toolkit, tool or provider access, when choosing an engine adapter, when connecting a generation provider for the first time, when setting spending limits or lowering review gates, or when upgrading a project from an older toolkit.
---

# Jam setup

The jam skills share one toolkit that lives inside the project (by default `tools/jam/`): the `jam` command, the recipes, the content catalog and the reference docs the skills point to. This skill installs it and settles only what the next task needs. `jam` below is `node tools/jam/jam.mjs`.

The skills work as a set: `jam-recipe` is where work starts, and it names the others as steps need them. When a skill a step names is not installed, `npx skills add rafaelvidaurre/furanku-skills --skill <name>` and reload skills.

Already installed and only changing a setting? Go to [Spending and review](#5-spending-and-review).

## 1. Check the machine

`node --version` must report 22.20 or newer. When it is missing or older, tell the person what it is for and offer the install for their system (`winget install OpenJS.NodeJS.LTS`, `brew install node`, or nodejs.org); an install that needs administrator rights or a new terminal goes to them as the exact command and what to do after.

Done when `node --version` reports 22.20 or newer.

## 2. Install or upgrade

```
node <this skill's folder>/scripts/install.mjs
```

It copies the toolkit into the project, writes `.gitignore` and Git LFS rules for the content folders, creates `catalog.config.json` when it is missing, installs the toolkit's packages, finds Python and Blender, upgrades a version 1 configuration, and ends with `jam doctor`. It never signs in, spends or commits. The same command upgrades an installed toolkit.

| Flag | Use |
| --- | --- |
| `--project <dir>` | The project, when not the current Git checkout |
| `--dir <folder>` | Install somewhere other than `tools/jam` (project-relative). The project remembers it |
| `--check` | Report what is installed and change nothing |
| `--no-deps`, `--no-lfs` | Skip package installation; skip Git LFS rules |
| `--force` | Replace toolkit files that were edited locally. Only on the person's say |

It prints one JSON summary. Read `complete`, `fixes` and `next`; how to act on every field, and on the cases where it stops instead, is in `tools/jam/docs/setup.md#installer-summary`.

Done when `complete` is true and each entry in `fixes` is either fixed or told to the person with what it blocks.

## 3. First configuration

When `jam.config.json` is missing:

1. `jam setup` prints the defaults. Ask one thing now: **where content lives** (work folder `Art/.scratch`, delivered folder `Art/Assets`, unless the project already keeps art elsewhere). Style, budgets, routes and spending are decided when the work first needs them.
2. Defaults accepted: `jam setup --defaults`. Otherwise write the fields that differ to a JSON file, `jam setup --from <file>`, delete the file, and run the installer again so ignore and LFS rules follow the chosen folders.
3. `jam doctor`.

Done when `jam doctor` has no failing line, or each failing line is named to the person with its printed fix.

## 4. Engine and providers, when first needed

**Engine.** With no engine chosen, work ends at neutral files (GLB, PNG, WAV) and engine steps are skipped. To choose an adapter or a facts-only preset, or to write one, use the `jam-engine` skill.

**Providers.** Connect a provider when a task is about to use it, not before.

1. `jam provider list` shows what serves each kind of work and whether paid work is on. `jam provider probe <id>` reports **installed**, **signed in** (it prints `authenticated`) and **reachable** as three separate facts, and prints `unknown` for what it cannot see.
2. Read that provider's page, `tools/jam/docs/providers/<id>.md`: how it is installed and signed in, what it bills, and the free status call that settles each `unknown`. Run that call.
3. Tell the person all three facts; one does not imply the next. Only when sign-in is missing do they sign in, and they get the instruction packet before any question about whether it is done: `tools/jam/docs/setup.md#handing-a-sign-in-to-the-person`. Then run the status call again.

Routes that cost nothing extra (an image tool in a plan the person already has, the agent's own image tool) need no account here; offer them first.

Done when the route the next task uses answered a free call in this session, or the person has one named action left to take.

## 5. Spending and review

Paid work is off for every provider until the person sets a limit. Ask when a paid job is first needed, one provider at a time, with the unit in words: `tools/jam/docs/settings.md#spending`. The same page covers **standing authorization** (the person's own words that allow work inside the limits without asking each time) and how to record it.

Lowering review gates for a crunch, or changing who reviews a step: `tools/jam/docs/settings.md#review-mode`.

Done when `jam config show spend` (or `review`) shows the person's choice and your reply names the provider or steps affected.

## 6. Upgrading a project

Step 2 does the upgrade. A version 1 configuration is migrated with it, and what could not be carried over exactly is listed under `configuration.notes`: pass those notes on to the person. To see the configuration change before it is written, run the installer with `--no-deps` (it replaces the toolkit and leaves `jam.config.json` alone), then `jam config migrate --dry-run`, then `jam config migrate`. What moves where, and how version 1 commands map to version 2: `tools/jam/docs/setup.md#upgrading-from-version-1`.

When `jam doctor` warns on `skill names`, the project still has skills under names that changed: follow `tools/jam/docs/setup.md#renamed-skills`.

When the summary says `needs migration: run jam catalog migrate`, the catalog's files are in an older format: follow `tools/jam/docs/catalog-migration.md`.

Done when `jam doctor` and `jam recipe check` pass with `skill names` ok, `jam run status` lists the project's open runs, and `jam catalog run problems` lists nothing that names an older toolkit.

## 7. Return to the task

Tell the person which files setup added or changed, and commit them only when they ask. Then resume the request that led here with its authorization intact; a request made before setup does not need asking again.
