# Guidance Composer

Pick a few clear engineering principles and put them in your project so **you and your AI coding agents** keep following the same rules.

No long policy docs. Short, opinionated bullets from a catalog you choose from.

---

## Is this for me?

**Yes, if** you:

- Use an agent that reads project instructions (for example `AGENTS.md`)
- Want rules like “prefer the simple solution” or “don’t keep old APIs forever” to stick across chats
- Prefer choosing from a menu over inventing wording every time

**Maybe not, if** you already have strong project rules and don’t want another source of them.

---

## What you get

1. A **catalog** of short principles, grouped by topic (simplicity, architecture, dependencies, …).
2. A **CLI** that:
   - lists and searches the catalog
   - walks you through picking rules (interactive)
   - or applies exact choices in one command (scripts / agents)
3. Text written only in a **marked section** the tool owns — so your own notes outside that section stay put when you update later.

---

## Requirements

- Node.js 18 or newer
- A project folder where you want the rules written
- An agent instruction file (`AGENTS.md` or `CLAUDE.md`). If neither exists, the CLI offers to run **`furanku-skills agents-md`** (creates empty `AGENTS.md` and `CLAUDE.md` → `AGENTS.md`). Non-interactive inject with `--yes` or `--create-agents-md` does that automatically.

---

## How to run it

`guidance-composer` is a **namespace** of the collection CLI `furanku-skills`.

From a **clone of furanku-skills**:

```bash
# interactive setup (recommended first time)
node bin/furanku-skills.js guidance-composer

# help for this namespace
node bin/furanku-skills.js guidance-composer help
```

Via npx (when the package is available):

```bash
npx furanku-skills guidance-composer
npx furanku-skills guidance-composer list
npx furanku-skills guidance-composer help
```

For local skill development you can still run the skill entry directly
(`node skills/guidance-composer/bin/guidance-composer.js`); prefer the collection CLI for normal use.

---

## Quick start (interactive)

1. Open a terminal in **your project** (or pass `--root` later).
2. Run the namespace with no extra arguments:

   ```bash
   node /path/to/furanku-skills/bin/furanku-skills.js guidance-composer
   # or: npx furanku-skills guidance-composer
   ```

3. Choose **scope** (asked first; default is this project):
   - **This project** — current directory (or `--root`)
   - **Global (this machine)** — each tool’s own user file (not a shared `~/.agents` store)
4. Choose **harnesses** (which instruction files get the rules):

   | Id | Project | Global |
   | --- | --- | --- |
   | `agents` | `AGENTS.md` (portable; agents.md / Codex / Cursor / …) | Codex only: `$CODEX_HOME/AGENTS.md` (default `~/.codex`) |
   | `claude` | Real `CLAUDE.md` only (not symlink → AGENTS) | `~/.claude/CLAUDE.md` |
   | `gemini` | Real `GEMINI.md` only | `~/.gemini/GEMINI.md` |

   Cursor **global** User Rules are app settings (Customize → Rules) — this CLI cannot write them.
   Project Cursor still reads repo `AGENTS.md`. If `CLAUDE.md`/`GEMINI.md` already symlink to
   `AGENTS.md`, picking AGENTS covers those tools.
5. Browse the catalog with arrow keys: open a category, mark snippets with
   Enter/Space, or choose **All** to select every snippet under that level
   (top-level All marks the whole catalog).
6. Choose **where** to write them (see below).
7. Confirm.

You can re-run later to add more rules. By default it **adds** without wiping what it already wrote. Use replace only when you mean to reset the tool-owned list.

---

## Where the text goes

| Choice | What happens |
| --- | --- |
| **Inline** | Rules go into each selected harness file under “Project guidance” or “User guidance”. |
| **Linked file** | Rules go into a separate file (project default `docs/agent-guidance.md`; global default `agent-guidance.md` under Codex home). Instruction files get a short “follow this file” line. |
| **Custom path** | Rules go only where you say. Optionally also add the pointer in the instruction file. |

The tool only rewrites the block between these markers:

```markdown
<!-- managed-by: guidance-composer -->
- your chosen rules live here
<!-- /managed-by: guidance-composer -->
```

Anything you write **above or below** that block is left alone.

---

## Useful commands

Assume `gc` is whatever launches this namespace on your machine
(for example `npx furanku-skills guidance-composer` or
`node …/bin/furanku-skills.js guidance-composer`).

### Browse the catalog

```bash
gc list                 # all rules, by category
gc categories           # category names only
gc show simplest-current
gc search simple
gc list --category simplicity
gc list --json          # for scripts
```

### See what’s already in a project

```bash
gc diff                 # current folder
gc diff --root ~/Code/my-app
```

### Apply rules without the menu

```bash
# into project AGENTS.md
gc inject --ids simplest-current,no-backward-compat --mode inline --harness agents --yes

# into a linked file + pointer in AGENTS.md
gc inject --ids long-term-architecture --mode linked --harness agents --yes

# machine-wide Codex guidance (~/.codex/AGENTS.md)
gc inject --ids asd-ste100 --mode inline --scope global --harness agents --yes

# Claude + Gemini user files too (explicit list — no implicit defaults)
gc inject --ids asd-ste100 --mode inline --scope global --harness agents,claude,gemini --yes

# dry run (print only, no write)
gc inject --ids prefer-libraries --mode inline --harness agents --dry-run --yes
```

| Flag | Meaning |
| --- | --- |
| `--ids a,b` | Which catalog entries (ids or full titles). |
| `--scope project \| global` | Project (default) or per-tool global user files. Wizard always asks first. |
| `--harness agents,claude,gemini` | **Required** non-interactively. Which instruction files to update. |
| `--mode inline \| linked \| custom` | Where to write. |
| `--path …` | File path for linked/custom (linked default: `docs/agent-guidance.md` project, `agent-guidance.md` under Codex home for global). |
| `--root …` | Override root (project: cwd; global: Codex home for AGENTS.md / linked files). |
| `--yes` | Confirm write when you’re not in the interactive wizard. |
| `--replace` | Replace the tool-owned list instead of adding to it. |
| `--force` | Allow known conflicting ids. |
| `--dry-run` | Show what would be written, don’t save. |
| `--no-pointer` | Linked mode: leave the instruction-file pointer alone. |
| `--pointer` | Custom mode: also write the instruction-file pointer. |
| `--create-agents-md` | Create missing selected instruction files. |
| `--verbose` | Print path notes (Cursor settings limitation, no shared store, …). |

---

## Using it with an AI agent

Two comfortable paths:

1. **You run the CLI**, then agents simply obey the rules in `AGENTS.md` (or the linked file).
2. **You ask the agent** to help choose and run the CLI for you, for example:
   - “List guidance-composer options for a greenfield app.”
   - “Inject simplest-current and prefer-libraries inline.”

If the agent skill is installed (`npx skills add … --skill guidance-composer`), the agent is steered to prefer this CLI for writes and to answer “what’s in the catalog?” from the same data.

---

## What’s in the catalog (today)

Topics grow over time. Check live with `gc list`. Currently:

| Category | Idea |
| --- | --- |
| **Simplicity & scope** | Prefer the smallest solution that fully meets *current* needs; optional hard line against keeping old contracts. |
| **Architecture** | Durable design choices when they matter; keep components modular and concerns separated. |
| **Dependencies** | Prefer what the project already uses (check docs/types first), then solid maintained libraries, before writing your own. |
| **Workflow** | Prefer programmatic tool surfaces over ad-hoc ones. |
| **Writing & communication** | Controlled technical English (ASD-STE100), UI description style, and cold-reader clarity. |

Each entry has a short id (for example `simplest-current`). That id is what you pass to `--ids`.

The full machine-readable list lives in [`references/catalog.json`](references/catalog.json).

---

## Good habits

- Start with **one or two** rules you actually care about. More is not always better.
- Prefer **linked file** if `AGENTS.md` is already long.
- Keep personal project notes **outside** the managed markers.
- Re-run `gc diff` after a while to see which catalog ideas you never adopted.

---

## For skill authors / this repo

Agent-facing instructions live in [`SKILL.md`](SKILL.md). Catalog edits go only in `references/catalog.json`. Tests: `node test/cli.test.js`.

---

## License

MIT (same as the furanku-skills collection).
