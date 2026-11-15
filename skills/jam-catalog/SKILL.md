---
name: jam-catalog
description: Browse, add, organize and review a game project's content and visual assets through the local content catalog. Use when the user asks to add or file external content (sourced models, images, videos), find or inspect an asset, capture a rendered view, leave or resolve a note, submit work for review or record a verdict, or open the catalog in a browser.
---

# Content catalog

The catalog describes this checkout (branch and uncommitted files included) through `catalog.config.json`. The toolkit's default adapter, `tools/jam/catalog-adapter.mjs` (set in `catalog.config.json` by `jam-setup`), combines external content declared in `Art/catalog.json` and `Art/Catalog/*.json` with jam runs in `Art/**/run.json`. External assets need no pipeline run, style, profile or stage acceptance; to add sourced models, images or videos, read `tools/jam/docs/external-content.md`. Notes, organization, review submissions and verdicts are files under `.catalog/` that travel with Git; the tool never commits, pushes or contacts a tracker. `tools/jam/catalog/README.md` defines adapters, records and evidence.

When `tools/jam/jam.mjs` or `catalog.config.json` is missing, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Run everything from the repository root.

1. Discover operations with `node tools/jam/jam.mjs catalog actions`; each lists its input schema. Read data with `node tools/jam/jam.mjs catalog run <action> --input '<json>'` (no browser starts).
2. For every write, declare who acts: `--actor-kind agent --actor-name <your name>`, or `--actor-kind human --actor-name <decider>` when transcribing a person's own decision. Pass `--request-id <stable id>` and reuse it on retry; a repeat returns the first result instead of recording twice.
3. For visual inspection, run `node tools/jam/jam.mjs catalog capture --target unit:<id> --part <part> --out <file.png>` (add `--camera`, `--mode clay|wireframe|textured`, `--animation <clip>` as needed) and look at the image. A capture succeeds only when the viewer is ready; its `shows` field names the exact asset digest or submission view rendered. It is a catalog render, not a native-game screenshot.
4. For a person, start the UI with `node tools/jam/jam.mjs catalog serve --detach` and give them the printed loopback URL. `--detach` runs the server as its own process that keeps serving after your session ends; it prints the process ID, log and stop command. When the port is taken, a catalog may already be serving there: open it and check its project and branch, or pass `--port <n>`.

## Filing added content

Every unit you add gets a home in the existing organization, so a person browsing finds it beside its peers.

1. Read the organization first: `organization.list` (categories and tags with counts), `catalog.search` with `{"section":"collections"}`, and `collections.membership` with the new unit IDs.
2. **Category:** give each unit the most specific existing category that describes it. When none does, add a path in the same `Parent/Child` style as its neighbours. Set it where the unit is declared: `category` in its `Art/Catalog/*.json` file for external content, otherwise `organize.set`.
3. **Collection:** add the unit to the collection it belongs with (same kit, set, outfit or scene): a pack declared in `Art/catalog.json` gains the member there, a catalog-owned collection through `collection.update` with `add`. When none fits but the new content forms a real group with other units, create one with `collection.create`. A unit with no natural group stays out of collections; a one-member collection is noise.
4. **Tags:** reuse the existing spelling from `organization.list`.
5. Confirm with `unit.get` (category and memberships), and tell the person which categories or collections you created.

## Reviews

Write the submission `note` in Markdown for the person deciding; the review page renders it. It carries only what helps them judge:

- what they are deciding, numbered when there are several parts;
- what changed since the last review, and why;
- where to look, naming the view;
- known limits and what is not done yet.

Short headings and lists read faster than a paragraph wall. The page already shows the author, branch and commit; checks that passed, commit hashes, request IDs, tool runs and file paths the person will not open go in your report or pull request. View captions are plain text naming what the view shows.

When a change is easiest to judge against what came before, give that view a `before`: render before and after as separate files with the same camera and size, link the after as evidence, and point `before` at the earlier file or at earlier frozen evidence (`{"submission","item","part"}`) such as the previous delivery's model. Example view: `{"part":"evidence:hair-after","caption":"Hairline above the ear","before":{"path":"Art/.scratch/hero/hair-v001.png","label":"v001"},"afterLabel":"v002"}`. The review page then shows a divider, toggle or side-by-side view of the pair.

Submitting a review preserves its evidence in Git, scratch files included; use only project-owned or rights-cleared evidence. Style hero shots stay in the art-direction library.

A catalog verdict is a catalog record. Jam pipeline gates stay with `jam-3d` and `node tools/jam/jam.mjs review`; forward a catalog verdict into a jam decision only when the person asks for that step. Notes have no replies; mark one dealt with (`note.resolve`, optional explanation) only when the observation was actually handled.

**Done:** the requested records are written and confirmed by a follow-up read (`notes.list`, `review.get`, `unit.get`), added content sits in its category and any collection it belongs to, or the capture file is inspected; failures report the action's error code and message.
