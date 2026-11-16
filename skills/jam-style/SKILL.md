---
name: jam-style
description: Find and fix a game's art style through rounds of comparison images, then save the approved pictures and rules that production work follows. Use when the user wants to find, explore, compare or change the look of their game, asks for a style study, or when a run reports that no style document is set.
---

# Art style

One operation: from "what should this game look like" to an approved library of pictures and a style document. Every gameplay image must be one the person would believe is a screenshot of their game. `jam` below is `node tools/jam/jam.mjs`; runs, gates and a missing toolkit are the `jam-recipe` skill's. Talking about references and looking for them needs no toolkit at all.

1. **Brief, once.** Establish the game, its presentation (2D, 3D or a mix), a confirmed camera rig in physical terms, a representative subject and what the person means by their references: `tools/jam/docs/style-exploration.md#the-brief`. Read the project's notes and earlier rounds (`jam run status`) before asking anything. Done when you can say what the next pictures will help decide, what stays fixed and what varies.
2. **Route.** Use the image route already chosen. Otherwise find the callable routes and offer them, including the ones that cost nothing extra, alongside image search and images the person supplies: `tools/jam/docs/providers.md#routes`. Done when the route is chosen and has answered in this session.
3. **Run a round** as `tools/jam/docs/style-exploration.md#a-round` lays out: state its question, start a run for it (`jam run start image <round id> --brief <file>`), generate the agreed number of options, inspect them, show the originals. Gameplay images are built and measured as `tools/jam/docs/style-images.md` says. Record the round:

   ```
   jam run record <round id> concept --file <a.png> --file <b.png> --file <c.png> --file <d.png> \
     --evidence prompts=<prompts.md> --note "<the round's question and what varies>" --tool "<image tool and version>"
   ```

   Done when the person has seen every image and the run holds them.
4. **Converge.** Say which differences matter, recommend one direction with a reason from the game, and ask what to keep or change (`tools/jam/docs/style-exploration.md#converge`). Record the answer in their words: `jam run review <round id> concept --accept --relay "<where they answered>: <their words>"`. Repeat steps 3 and 4 until they settle on a direction. Done when the chosen and rejected qualities are in the next round's brief or the library.
5. **Build and save the library**: at least three approved shots that cover the game's situations, saved to a tracked folder with their provenance, one style document, and the registration below (`tools/jam/docs/style-library.md`).

   ```
   jam config set style.document <guide.md>
   jam config set style.references '["<shot>", "<shot>", "<shot>"]'
   jam config set style.revision <name>
   ```

   Done when `jam config show style` lists the document, the shots and the revision, and every listed file opens. A set with gaps is saved and reported as in progress.
6. **Close** a completed exploration by cleaning its scratch as `tools/jam/docs/style-library.md#close-the-exploration` says.

Pictures set visual targets. Triangle and texture budgets are decided later, from the game's camera and platform (`tools/jam/docs/settings.md#budgets`). Changing an approved direction is a new revision: say which runs it makes stale before setting it.

**Report:** what the pictures decided, what is still open, and the next useful picture, keeping the person's approvals apart from your recommendations and saved files apart from committed ones.
