# AGENTS.md

This repo is a public collection of agent skills, installable via `npx skills add` and compliant with the [Agent Skills spec](https://agentskills.io/specification). Everything here exists to make skills predictable: the same process every run.

## Layout

One skill = one directory: `skills/<name>/SKILL.md`, with optional `references/`, `scripts/`, `assets/` beside it. Nothing deeper, no manifests at the root.

## Rules for skills in this repo

- Frontmatter `name` must equal the directory name: `a-z0-9-` only, ≤64 chars, no leading/trailing/double hyphens.
- `description` (≤1024 chars) states what the skill does **and** when to fire it, with concrete trigger phrasing — one trigger per distinct branch, no synonym padding.
- Keep `SKILL.md` well under 500 lines. Depth that only some runs need goes to `references/`, reached by an explicit pointer that says when to read it.
- Every step ends on a checkable completion criterion — the agent must be able to tell done from not-done.
- Single source of truth: each rule lives in exactly one place. When editing, delete superseded text rather than layering on top.
- Phrase instructions positively (state the target behavior); keep prohibitions only as hard guardrails.
- Skills are written for any capable coding agent, not just Claude Code: prefer plain shell and file operations over harness-specific tool names.

## When editing an existing skill

Prune before you add: hunt no-ops (lines the model already obeys by default) and stale layers, and cut them. A skill that only ever grows is decaying.
