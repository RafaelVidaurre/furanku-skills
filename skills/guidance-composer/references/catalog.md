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
- **Picker line:** No speculative complexity — fully meet what is required now, nothing more.
- **Tags:** simplicity, yagni, scope
- **Conflicts:** none
- **Inject text:**

  - Choose the simplest implementation that fully meets the current requirements. Do not add speculative complexity for needs that are not required yet.

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

- **Title:** Durable architectural decisions
- **Picker line:** When a real architectural choice is required, make one meant to last — no planned throwaways.
- **Tags:** architecture, durability
- **Conflicts:** none
- **Inject text:**

  - When a real architectural decision is required, choose a design meant to last. Do not accept a stopgap intended only to work for now and be replaced later.
