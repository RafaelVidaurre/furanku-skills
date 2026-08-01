# Guidance catalog

Each entry is one selectable unit. Inject only the **Inject text** block for selected entries (verbatim). **Picker line** is for the selection UI only — do not write it into the project.

When adding catalog entries: assign a stable `id` (`a-z0-9-`, unique), keep inject text one or two tight bullets/sentences, and note any tensions with other ids under **Conflicts**.

---

## no-backward-compat

- **Title:** No backward compatibility
- **Picker line:** Drop legacy contracts freely; current correctness beats old callers.
- **Tags:** simplicity, greenfield, breaking-change
- **Conflicts:** none
- **Inject text:**

  - Do not preserve backward compatibility.

---

## simplest-current

- **Title:** Simplest that meets current requirements
- **Picker line:** Ship the smallest design that fully satisfies what is required now.
- **Tags:** simplicity, yagni
- **Conflicts:** `long-term-architecture` (resolve with user if both selected: long-term structure for true architectural seams; simplest elsewhere)
- **Inject text:**

  - Choose the simplest implementation that fully meets the current requirements.

---

## prefer-libraries

- **Title:** Prefer maintained libraries
- **Picker line:** Use established, well-maintained libraries instead of hand-rolled equivalents.
- **Tags:** dependencies, reuse
- **Conflicts:** none
- **Inject text:**

  - Prefer established, well-maintained libraries over custom implementations.

---

## long-term-architecture

- **Title:** Long-term architectural decisions
- **Picker line:** Choose architecture that should last; reject replace-later stopgaps.
- **Tags:** architecture, durability
- **Conflicts:** `simplest-current` (see that entry)
- **Inject text:**

  - Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
