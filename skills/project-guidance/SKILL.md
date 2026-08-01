---
name: project-guidance
description: >
  Pick selectable engineering guidance from a catalog and inject it into a project
  as AGENTS.md text or a dedicated markdown file linked from AGENTS.md. Use when
  the user wants to inject guidance, compose AGENTS.md principles, pick project
  engineering rules, add agent principles to a repo, or runs /project-guidance.
license: MIT
metadata:
  author: rafaelvidaurre
---

# Project Guidance

Compose project agent instructions from a curated catalog. The user picks which
entries apply; nothing is injected without an explicit selection.

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
| **Inline** | Append or merge a `## Project guidance` section into the project's canonical `AGENTS.md` (create `AGENTS.md` only if missing and the user agrees). |
| **Linked file** | Write selected inject text to a dedicated markdown file; ensure `AGENTS.md` contains a short pointer that agents must follow that file. |

Linked-file defaults when the user does not name a path:

1. Reuse an existing project guidance file if one is already linked from `AGENTS.md`.
2. Otherwise prefer `docs/agent-guidance.md`.

If the project uses an equivalent agent-instruction filename (`Agents.md`,
`CLAUDE.md` with an AGENTS pointer, etc.), follow that project's canonical
convention. Merge carefully; never overwrite unrelated instructions.

**Complete when:** destination mode and exact target path(s) are fixed.

## 4. Merge without duplicating

1. Read the target file(s) and any existing `## Project guidance` (or equivalent) section.
2. Map present bullets to catalog ids when the wording matches inject text (or a prior inject from this skill).
3. **Add** only selected ids not already present.
4. **Leave** existing non-catalog bullets untouched.
5. **Do not remove** guidance the user did not ask to remove. For an explicit
   "replace with this selection" request, replace only the managed section or
   managed file body, and show the diff intent first.
6. For **linked file** creates, use:

   ```markdown
   # Project guidance

   Engineering principles selected for this repository. Agents must follow them.

   <!-- managed-by: project-guidance -->

   - …
   ```

   And in `AGENTS.md` (create or merge a short section):

   ```markdown
   ## Project guidance

   Follow [docs/agent-guidance.md](docs/agent-guidance.md) for repository engineering principles.
   ```

   Adjust the relative link to the chosen path. Keep a single pointer; do not
   also paste the full bullet list into `AGENTS.md` unless the user chose
   **Inline**.

7. For **inline**, use the same section heading and HTML comment marker when
   practical so later runs can find the managed block:

   ```markdown
   ## Project guidance

   <!-- managed-by: project-guidance -->

   - …
   ```

Preserve surrounding document structure, headings, and tone.

**Complete when:** every selected id's inject text appears exactly once at the destination, and for linked mode `AGENTS.md` points at that file.

## 5. Confirm

In the final response, state:

- Selected ids
- Destination path(s) and mode (inline vs linked)
- What was added vs already present
- Any conflict resolutions the user chose

**Complete when:** the user can see the resulting selection and file locations without re-opening the catalog.

## Catalog maintenance (skill repo only)

When the user is working in this skills repository and asks to add or edit catalog
entries, change only [references/catalog.md](references/catalog.md). Keep ids
stable once published; deprecate rather than reuse an id for different meaning.
Do not expand the catalog during a normal inject into an unrelated project.
