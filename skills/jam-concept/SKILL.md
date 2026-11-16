---
name: jam-concept
description: Create concept images of one named game asset for a person to choose from, in the project's art style, and record the chosen design. Use when the user asks for a concept, a design or design options for an asset, or when a run's next step names this skill.
---

# Concept design

One operation: from a brief to a chosen design image. `jam` below is `node tools/jam/jam.mjs`.

Inside a run, start from `jam run next <id>`: it names this step's guide (the recipe's own notes for it), its outputs and its gate. With no run, start one so the result is on record: `jam run start image <id> --brief-text "..."` for exploration, or the recipe `jam recipe list` gives for the thing being made. Runs, gates and a missing toolkit are the `jam-recipe` skill's.

1. **Brief.** Read the run's brief, the guide section, the style document and its references (`jam config show style`), and the conversation. You need the asset's purpose in the game, silhouette, materials, distinguishing features and size, and you need to know the game itself (`tools/jam/docs/interaction.md#how-much-to-ask`). Ask only for a missing detail that changes the design. Done when you can say what the subject is, what stays fixed across the options and what varies.
2. **Route.** Use the image route already chosen for this project or conversation. Otherwise find the callable routes and offer them, including the ones that cost nothing extra: `tools/jam/docs/providers.md#routes`. Done when the route is chosen and has answered in this session.
3. **Generate the round** as `tools/jam/docs/images.md#a-round` says: the agreed number of options, one subject per image, camera stated. For a concept that is the whole asset alone, in a neutral three-quarter view, on a plain background, with no text. Attach the style references with their role stated. A paid route follows `tools/jam/docs/providers.md#one-paid-job-start-to-finish`; whether to start without asking is `tools/jam/docs/task-intent.md`. Done when every option exists as a file in the run folder.
4. **Inspect** each image before anyone sees it (`tools/jam/docs/images.md#inspect-before-showing`), and for a design also check: the whole asset is in frame; the silhouette reads at the size it has in play; materials are told apart; it is one buildable object whose hidden sides a turnaround can continue. Done when each option has passed or been replaced, or the round is declared short.
5. **Show the originals and get the choice** (`tools/jam/docs/images.md#show-the-originals`). Ask it as the decision it is: which of these is to be built. Done when the person has named one design, or named what to change.
6. **Record** the chosen design, with the other options and the prompts as evidence:

   ```
   jam run record <id> concept --file <chosen.png> --evidence prompt=<prompts.md> --evidence option-b=<b.png> \
     --note "<what was asked, how many options, which was chosen>" --tool "<image tool and version>"
   ```

   `--job <job>` replaces `--tool` for a paid result. Then the gate, with the command `jam run next <id>` prints: their choice relayed in their words, or a review link for them.

Done when `jam run status <id>` shows `concept` accepted, or the person holds one specific question or link. A requested change is a new round and a new record.
