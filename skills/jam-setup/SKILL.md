---
name: jam-setup
description: Install, upgrade and configure the jam game-asset toolkit in a project, connect image and mesh providers, and diagnose setup. Use when starting jam asset work in a project without tools/jam/, when another jam skill reports a missing toolkit, dependency or provider access, when changing spending limits or human review checkpoints, or when upgrading the toolkit.
---

# Jam setup

The jam skills share one toolkit that lives inside the user's project at `tools/jam/`: the `jam.mjs` CLI (asset runs, reviews, paid-job ledger, measurement), the content catalog, and the reference docs under `tools/jam/docs/`. This skill installs it with one command and settles only the decisions the next task needs. Run everything from the project root.

The jam skills work as one set; when a jam skill names a sibling that is not installed, install it with `npx skills add rafaelvidaurre/furanku-skills --skill <name>` (the whole set: `--skill jam-setup jam-3d jam-style jam-concept jam-turnaround jam-model jam-retopo jam-uv jam-texture jam-catalog jam-3d-prop jam-3d-character`), then reload skills.

Spending and checkpoint changes on an installed project skip to [Change settings](#change-settings).

## 1. Check what the machine has

Run `node --version` and `git --version` (same commands in PowerShell, cmd, macOS and Linux shells). The installer needs Node.js 22.20 or newer; Git is needed for versioning and LFS but not for the toolkit itself.

When Node is missing or older, tell the user what it is for and offer the install for their OS: `winget install OpenJS.NodeJS.LTS` (Windows), `brew install node` (macOS), nodejs.org or their package manager (Linux). Run it yourself when the user agrees and the environment allows it; installers that need administrator rights or a new terminal go to the user as the exact command plus what to do after (open a new terminal so PATH updates, then tell you).

**Done:** `node --version` reports 22.20 or newer.

## 2. Install or upgrade the toolkit

```sh
node <this skill's directory>/scripts/install.mjs
```

It finds the Git root, copies the toolkit into `tools/jam/`, adds `.gitignore` and Git LFS entries for `Art/`, points `catalog.config.json` at the jam adapter (creating it, or moving a built-in adapter over with its settings kept) with a starter manifest, installs the npm packages, makes Pillow and numpy available (private venv when needed), records a found Blender in `jam.local.json`, and ends with `doctor`. It prints one JSON summary and exits 2 when a required npm install failed. Flags: `--project <dir>`, `--check` (report only), `--no-deps`, `--no-lfs`, `--force`.

Act on each gap in the summary:

- Files that `would be overwritten` or `already exist with other content`: show the user the listed files. Rerun with `--force` only when they choose to replace them.
- `tools/jam/ exists and was not installed by jam-setup`: stop and report; the folder belongs to something else.
- A `failed:` npm install or `missing:` imaging dependency: fix that item from the reported reason (`tools/jam/docs/setup.md#local-dependencies`), then rerun. Python matters only for turnaround cropping and character texture tools; Blender only for local DCC steps.
- `catalogConfig` starting `incomplete`: the project has its own catalog adapter; compose the jam part into it (`tools/jam/docs/external-content.md#catalog-adapter`) or tell the user jam assets stay out of the catalog until then.
- `fixes`: each entry names a missing tool, what it is needed for, and the install command for this OS. Explain them in one short list, recommend installing the ones the user's next task needs (Blender only matters for local Blender steps), run the commands the user approves, then rerun the installer.

**Done:** `complete` is true, `installed` is `installed`, `upgraded` or `reinstalled (unchanged)`, and every remaining gap is fixed or named to the user with its effect.

Browsing or adding external content in the catalog needs nothing more: go to step 5.

## 3. Project settings

When the next task records jam work (style rounds, concepts, any asset run) and `jam.config.json` is missing, ask two things in one message, each with its recommended default, and accept "defaults":

1. **Style**: an existing style guide and approved images to register, or *later* (default; `jam-style` explores it).
2. **Reviews**: human at concept, turnaround and delivery (default), human at every stage, or agent only.

Paid generation starts disabled for every provider. Ask about the mesh route and each provider's spending limit (`tools/jam/docs/settings.md#spending`) when a paid job is first needed, not before. Asset profiles (triangle and texture budgets) come later too: `jam-model` resolves them once a turnaround exists. Write the answers into a temporary choices file and apply it (this example is the defaults):

```json
{"version": 1, "style": {"document": null, "references": []}, "profiles": {},
 "providers": {"image": "scenario", "mesh": "meshy"},
 "review": {"default": "agent", "stages": {"concept": "human", "turnaround": "human", "delivery": "human"}},
 "spend": {"meshy": {"unit": "credits", "limit": 0}, "scenario": {"unit": "CU", "limit": 0}}}
```

```sh
node tools/jam/jam.mjs setup --from <choices.json>
```

Delete the choices file afterwards; `jam.config.json` is canonical. A terminal user can run `node tools/jam/jam.mjs setup` for the guided wizard instead.

**Done:** `node tools/jam/jam.mjs settings` shows the user's choices.

## 4. Connect only the route the next task uses

Image work through a plan-included route (Codex image generation, the agent's own image tool, supplied references) needs no provider account. Connect Meshy or Scenario when the current task is about to use it, following `tools/jam/docs/setup.md` for that provider and `tools/jam/docs/sign-in.md` for the human's sign-in. The human signs in; the agent never asks for a credential.

**Done:** the route the next task uses is ready: a plan-included image route is callable in this session (or the user supplies images), or a free authenticated check on a paid route succeeds (Meshy `auth status` and `balance`; Scenario `teams_list` and a model schema), or the user has a named pending sign-in step.

## 5. Return to the original task

Resume the jam skill or request that led here, carrying its authorization (`tools/jam/docs/task-intent.md`).

## Change settings

For "no cap for Scenario", "disable turnaround approval", "human review for textures" and similar, follow `tools/jam/docs/settings.md`. **Done:** the setting is persisted and the reply names the provider or stages, the project, pipeline or run scope, and any surviving run override.
