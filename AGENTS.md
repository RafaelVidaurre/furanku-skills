# AGENTS.md

This repo is a public collection of agent skills, installable via `npx skills add` and compliant with the [Agent Skills spec](https://agentskills.io/specification). Everything here exists to make skills predictable: the same process every run.

## Layout

One skill = one directory: `skills/<name>/SKILL.md`, with optional `references/`, `scripts/`, `assets/`, and human docs (`README.md`, `LICENSE.txt`) beside it. A skill that ships its own CLI also carries `bin/`, `lib/`, `test/`, and `package.json` — `guidance-composer` is the only one today. Anything a skill ships must be listed in the root `package.json` `files` array, or it is missing from the published package.

Groups live in `.claude-plugin/marketplace.json`, not in the directory tree: a skill listed under a plugin entry there shows under that group in `npx skills`; unlisted skills form the main (General) group. The `experimental` group holds skills whose behavior or interface may still change — move a skill between groups by editing the manifest, never by moving its directory.

## Rules for skills in this repo

- Frontmatter `name` must equal the directory name: `a-z0-9-` only, ≤64 chars, no leading/trailing/double hyphens.
- `description` (≤1024 chars) states what the skill does **and** when to fire it, with concrete trigger phrasing — one trigger per distinct branch, no synonym padding.
- Keep `SKILL.md` well under 500 lines. Depth that only some runs need goes to `references/`, reached by an explicit pointer that says when to read it.
- Every step ends on a checkable completion criterion — the agent must be able to tell done from not-done.
- Single source of truth: each rule lives in exactly one place. When editing, delete superseded text rather than layering on top.
- Phrase instructions positively (state the target behavior); keep prohibitions only as hard guardrails.
- Skills are written for any capable coding agent, not just Claude Code: prefer plain shell and file operations over harness-specific tool names.

## Tests and issue tracking

`npm test` runs everything: the Node suites (`test/`, `skills/guidance-composer/test/`) and the Python suites (`skills/crew/scripts`, `skills/model-routing/scripts`). Tests must stay hermetic — a suite that reads real user config (`$CODEX_HOME`, `$HOME`) pins those variables to a temp dir so a run never writes to the machine's own files.

Work is tracked in [Beads](https://github.com/gastownhall/beads) (`bd`): `.beads/issues.jsonl` is the shared record, the Dolt database beside it is local-only. This repo is public — keep personal data out of anything tracked there.

## When editing an existing skill

Prune before you add: hunt no-ops (lines the model already obeys by default) and stale layers, and cut them. A skill that only ever grows is decaying.
