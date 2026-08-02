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

---

## How to run it

From a **clone of furanku-skills**:

```bash
# interactive setup (recommended first time)
node skills/guidance-composer/bin/guidance-composer.js

# or from this skill folder
cd skills/guidance-composer
node bin/guidance-composer.js
```

If the package is installed globally or available via npm as `furanku-guidance-composer`:

```bash
npx furanku-guidance-composer
# same as: guidance-composer
```

Tip: `help` shows all commands:

```bash
node bin/guidance-composer.js help
```

---

## Quick start (interactive)

1. Open a terminal in **your project** (or pass `--root` later).
2. Run the tool with no arguments:

   ```bash
   node /path/to/furanku-skills/skills/guidance-composer/bin/guidance-composer.js
   ```

3. For each category, pick the rules you want (numbers or ids), or skip.
4. Choose **where** to write them (see below).
5. Confirm.

You can re-run later to add more rules. By default it **adds** without wiping what it already wrote. Use replace only when you mean to reset the tool-owned list.

---

## Where the text goes

| Choice | What happens |
| --- | --- |
| **Inline** | Rules go into `AGENTS.md` (or `Agents.md` if that’s what the project uses) under a “Project guidance” section. |
| **Linked file** | Rules go into a separate file (default `docs/agent-guidance.md`). `AGENTS.md` gets a short “follow this file” line. |
| **Custom path** | Rules go only where you say. Optionally also add the pointer in `AGENTS.md`. |

The tool only rewrites the block between these markers:

```markdown
<!-- managed-by: guidance-composer -->
- your chosen rules live here
<!-- /managed-by: guidance-composer -->
```

Anything you write **above or below** that block is left alone.

---

## Useful commands

Assume `gc` is whatever launches the CLI on your machine
(for example `node …/bin/guidance-composer.js`).

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
# into AGENTS.md
gc inject --ids simplest-current,no-backward-compat --mode inline --yes

# into a linked file + pointer in AGENTS.md
gc inject --ids long-term-architecture --mode linked --yes

# dry run (print only, no write)
gc inject --ids prefer-libraries --mode inline --dry-run --yes
```

| Flag | Meaning |
| --- | --- |
| `--ids a,b` | Which catalog entries (ids or full titles). |
| `--mode inline \| linked \| custom` | Where to write. |
| `--path …` | File path for linked/custom (linked default: `docs/agent-guidance.md`). |
| `--root …` | Project root (default: current directory). |
| `--yes` | Confirm write when you’re not in the interactive wizard. |
| `--replace` | Replace the tool-owned list instead of adding to it. |
| `--dry-run` | Show what would be written, don’t save. |

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
