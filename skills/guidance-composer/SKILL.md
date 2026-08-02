---
name: guidance-composer
description: >
  Compose selectable engineering guidance from a catalog and inject it into a
  project — into AGENTS.md, a dedicated markdown file linked from agent
  instructions, or another path the user chooses. Use when the user wants to
  inject guidance, compose project principles, pick engineering rules for agents,
  assemble a guidance pack, or runs /guidance-composer.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Guidance Composer

Compose project guidance from a curated catalog. The user picks which entries
apply; nothing is injected without an explicit selection. Destination is chosen
per run — not fixed to `AGENTS.md`.

## Operating modes

- **Inject:** Select catalog entries and write them into the target project.
- **List:** Show the catalog (id, title, picker line) without writing files.
- **Diff:** Compare catalog selections already present in the project vs available entries.

Default to **Inject** when the user wants rules in the project.

## 1. Load the catalog

Read [references/catalog.md](references/catalog.md) from this skill directory.
Treat each `## <id>` section as one selectable entry. Inject only each entry's
**Inject text** lines, never picker lines, tags, or conflict notes.

**Complete when:** every catalog id, title, and inject text is available for the turn.

## 2. Select entries

Present a compact multi-select list: `id` — **title** — picker line.

- Accept multi-select by id, title, or clear paraphrase.
- If the user names a pack intent without ids (e.g. "greenfield simplicity"),
  propose a concrete id set and confirm before writing.
- If the selection includes ids that list each other under **Conflicts**, state
  the tension in one sentence and ask how to resolve (keep both, drop one, or
  rephrase). Do not invent a silent compromise.

**Complete when:** the user has confirmed an explicit set of catalog ids (possibly empty — then stop without writing).

## 3. Choose the destination

Ask unless the user already specified one of:

| Destination | Behavior |
| --- | --- |
| **Inline** | Append or merge a `## Project guidance` section into the project's canonical agent-instruction file (usually `AGENTS.md`; create only if missing and the user agrees). |
| **Linked file** | Write selected inject text to a dedicated markdown file; ensure the canonical agent-instruction file contains a short pointer that agents must follow that file. |
| **Custom path** | Write only to a path the user names (with or without an `AGENTS.md` pointer, as they specify). |

Linked-file defaults when the user does not name a path:

1. Reuse an existing guidance file if one is already linked from the project's agent instructions.
2. Otherwise prefer `docs/agent-guidance.md`.

If the project uses an equivalent agent-instruction filename (`Agents.md`,
`CLAUDE.md` with an AGENTS pointer, etc.), follow that project's canonical
convention. Merge carefully; never overwrite unrelated instructions.

**Complete when:** destination mode and exact target path(s) are fixed.

## 4. Merge without duplicating

1. Read the target file(s) and any existing `## Project guidance` (or equivalent) section.
2. Locate managed blocks via `<!-- managed-by: guidance-composer -->` or the legacy marker `<!-- managed-by: project-guidance -->`. Prefer the new marker on write.
3. Map present bullets to catalog ids when the wording matches inject text (or a prior inject from this skill).
4. **Add** only selected ids not already present.
5. **Leave** existing non-catalog bullets untouched.
6. **Do not remove** guidance the user did not ask to remove. For an explicit
   "replace with this selection" request, replace only the managed section or
   managed file body, and show the diff intent first.
7. For **linked file** creates, use:

   ```markdown
   # Project guidance

   Engineering principles selected for this repository. Agents must follow them.

   <!-- managed-by: guidance-composer -->

   - …
   ```

   And in the canonical agent-instruction file when a pointer is wanted (create or merge a short section):

   ```markdown
   ## Project guidance

   Follow [docs/agent-guidance.md](docs/agent-guidance.md) for repository engineering principles.
   ```

   Adjust the relative link to the chosen path. Keep a single pointer; do not
   also paste the full bullet list into the instruction file unless the user
   chose **Inline**.

8. For **inline**, use the same section heading and HTML comment marker when
   practical so later runs can find the managed block:

   ```markdown
   ## Project guidance

   <!-- managed-by: guidance-composer -->

   - …
   ```

Preserve surrounding document structure, headings, and tone.

**Complete when:** every selected id's inject text appears exactly once at the destination, and for linked mode the agreed pointer file (if any) points at that file.

## 5. Confirm

In the final response, state:

- Selected ids
- Destination path(s) and mode (inline, linked, or custom)
- What was added vs already present
- Any conflict resolutions the user chose

**Complete when:** the user can see the resulting selection and file locations without re-opening the catalog.

## Catalog maintenance (skill repo only)

When the user is working in this skills repository and asks to add or edit catalog
entries, change only [references/catalog.md](references/catalog.md). Keep ids
stable once published; deprecate rather than reuse an id for different meaning.
Do not expand the catalog during a normal inject into an unrelated project.
