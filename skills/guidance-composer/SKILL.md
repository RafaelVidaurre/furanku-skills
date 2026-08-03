---
name: guidance-composer
description: >
  Compose selectable engineering guidance from a curated catalog and inject it
  into a project via the furanku-skills guidance-composer CLI namespace
  (interactive or non-interactive) or by answering catalog questions from
  references/catalog.json. Use when the user wants to inject guidance, compose
  project principles, set up agent engineering rules, list or search the
  guidance catalog, run /guidance-composer, or run the furanku-skills
  guidance-composer CLI.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Guidance Composer

Compose project guidance from a curated, categorized catalog. The primary
surface is the **CLI** (interactive setup for humans; flags for agents and CI).
Nothing is injected without an explicit selection of entry ids.

## Surfaces

| Surface | When |
| --- | --- |
| **CLI (preferred for writes)** | User or agent is setting up, listing, diffing, or injecting guidance. |
| **Catalog read (agents)** | User asks what is available, what an entry means, or which ids fit an intent — read or search the catalog without writing. |

Do not use harness multi-select widgets to present the full catalog. The catalog
is expected to grow; selection always goes through the CLI wizard or explicit ids.

## CLI

Package: `furanku-skills` · namespace: `guidance-composer`  
Invocation: `furanku-skills guidance-composer …`

Resolve the collection CLI once per session (first match wins):

1. `furanku-skills` on `PATH`
2. `npx --yes furanku-skills` (when published / installable)
3. From the furanku-skills repo checkout: `node bin/furanku-skills.js`
4. Skill-local fallback (dev only): `node <skill>/bin/guidance-composer.js`

Prefer **`furanku-skills init`** when the user wants first-time project setup
(agent instruction files, skill install, and guidance together).

Below, `GC` means `<furanku-skills> guidance-composer` (or the skill-local
fallback with no namespace prefix).

```sh
GC                          # interactive inject wizard (TTY)
GC list                     # catalog grouped by category
GC list --category simplicity
GC list --json
GC categories
GC show <id>
GC search <query>
GC diff [--root DIR] [--json]
GC inject --ids a,b --mode inline|linked|custom [--path PATH] --yes
GC inject                   # same as interactive wizard
```

### Inject modes

| `--mode` | Behavior |
| --- | --- |
| `inline` | Managed region under `## Project guidance` in `AGENTS.md` (or project equivalent). |
| `linked` | Write `docs/agent-guidance.md` by default; add a short pointer in `AGENTS.md`. |
| `custom` | Write only `--path` (optional `--pointer` for `AGENTS.md`). |

Use `--replace` to replace the managed region interior; default is union-add.
Use `--dry-run` to print writes. Non-interactive writes on a TTY require `--yes`.

**Complete when (CLI write):** the chosen ids appear inside a closed managed region
at the destination, and any agreed pointer exists.

## Agent workflow

### Answer questions (no write)

1. Prefer `GC list`, `GC categories`, `GC show`, or `GC search`.
2. If the CLI is unavailable, read [references/catalog.json](references/catalog.json).
3. Explain entries by **id**, **title**, **category**, and **picker** text. Quote
   inject text when the user needs the exact rule wording.

**Complete when:** the user can choose ids or decide not to inject.

### Inject via agent

1. Resolve ids (user-named, or propose a set from intent and confirm).
2. Resolve destination (user-named, or ask once: inline / linked / custom).
3. Run non-interactive inject:

```sh
GC inject --ids <id,id> --mode <inline|linked|custom> [--path <path>] --root <project> --yes
```

4. Report selected ids, destination paths, and CLI output.

If inject flags are incomplete, run the interactive wizard only when a TTY is
available; otherwise ask for the missing ids/mode in chat and re-run with flags.

**Complete when:** the CLI write completion criterion above is met and reported.

### Diff

```sh
GC diff --root <project>
```

**Complete when:** present vs not-injected ids are reported for the project.

## Managed region

Managed content is a **closed** HTML-comment pair. Only the interior is owned by
this tool; text before the open marker or after the close marker is never
rewritten.

```markdown
## Project guidance

<!-- managed-by: guidance-composer -->
- …
<!-- /managed-by: guidance-composer -->

Hand-written notes stay outside the pair.
```

Legacy open-only `<!-- managed-by: project-guidance -->` is still detected
(through the next `##` heading or EOF); the next successful write upgrades to
the closed `guidance-composer` pair.

## Catalog source of truth

- **Only file:** [references/catalog.json](references/catalog.json).
- Each entry has exactly one primary **category**, optional **tags**, **conflicts**, and **inject** lines.
- Inject only `inject` strings (as bullets). Never write picker lines, tags, or conflict notes into the project.
- Browse with the CLI (`list` / `show` / `search`); do not maintain a parallel markdown catalog.

## Catalog maintenance (skill repo only)

When adding or changing entries in this repository:

1. Assign a stable `id` (`a-z0-9-`); deprecate rather than reuse an id for a new meaning.
2. Place the entry in the best existing **category**, or add a category when a new cluster of entries would not fit cleanly under current ones.
3. After every batch of additions, reassess organization: merge thin categories, split overloaded ones, and retitle descriptions so `GC list` stays scannable.
4. Keep inject text one or two tight sentences; note real tensions under `conflicts`.
5. Run the skill tests before shipping catalog changes.
6. Do not expand the catalog during a normal inject into an unrelated project.

**Complete when:** JSON loads under the CLI and categories still partition the catalog without a junk drawer.
