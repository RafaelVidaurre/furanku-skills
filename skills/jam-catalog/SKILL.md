---
name: jam-catalog
description: Browse, organise and review a game project's content through its local catalog, and extend the catalog with plugins. Use when the user asks for the catalog or review link, asks what is waiting on them, wants to find, inspect or tag units and assets, leave or resolve a note, submit work for review or record a verdict, when the catalog should show the project's own content (its engine assets, archetypes, server data), or when a project needs its own unit types, checks or actions in the catalog.
---

# Content catalog

The catalog shows what this checkout contains (uncommitted files included): units declared in the project's manifest, jam runs, the game engine's assets when the `engine` plugin is listed, and whatever project plugins add. Notes, categories, tags, collections, review submissions and decisions are files under `.catalog/` that travel with Git. The catalog never commits or pushes.

`jam` below is `node tools/jam/jam.mjs`; a missing toolkit is the `jam-recipe` skill's to route.

## The link, and what is waiting

| Need | Command |
| --- | --- |
| The catalog in a browser | `jam catalog open` prints the address and starts the server when none is running. One server per checkout; it keeps running after your session ends |
| Is it running, and where | `jam catalog status` |
| Stop it | `jam catalog stop` |
| The person reviews from another device through a private HTTPS proxy they run | `jam catalog open --allow-origin https://<proxy host>:<port>`: admits exactly that origin; give them the proxy's address |
| Everything nobody has dealt with | `jam catalog inbox`: reviews waiting, open notes, parts changed since their verdict, problems |
| Broken or missing media, unlinked files, plugin checks | `jam catalog doctor`, and `--fix` to apply the repairs it offers |

Give the person the link every time you ask them to look at or decide something, including when they have had it before, and say it opens on the computer where the project is. With the server running, results that create or name a review carry its `url`: pass that one on, since it opens the review itself. Without a running server they carry only a `route`; run `jam catalog open` and read the review again with `review.get` to get the link.

Done when the person has the link in the same message as the request, or `inbox` has been read out as a short list. `inbox` names who made each item, not who it waits on: say which ones need the person and which are yours.

## Read and write

Every operation is an action. `jam catalog actions` lists them; `--json` adds each input's schema.

```
jam catalog run <action> --input '<json>'
jam catalog run <write action> --actor-kind agent --actor-name <your name> --request-id <stable id> --input '<json>'
```

- A write names who acts. You are `--actor-kind agent` with a name that identifies you in the project's history (the agent and its role, such as `claude-props`). `--request-id` is any id you make up for this one write, such as `crate-tag-1`; reuse it on a retry so the same write records once.
- Read an action's input schema before its first use (`jam catalog actions --json`). A unit's parts (`model`, `attributes`, ...) are listed by `unit.get` under its review parts.
- A refusal prints `error:` and `fix:`; an input field that does not exist is refused, never ignored.
- A refusal `unsupported` saying a file `was written by an older toolkit` means the project's catalog files predate this toolkit: follow `tools/jam/docs/catalog-migration.md`.
- To look at something yourself: `jam catalog capture --target unit:<id> --part <part> --out <scratch folder>/<name>.png` (also `--mode clay|wireframe|textured`, `--camera`, `--animation`, and `--frame <n>` for a sprite animation), then open the image. It needs no running server. Its `shows` field names exactly what was drawn. It is a catalog render, not a picture from an engine.

Done when a follow-up read (`unit.get`, `note.list`, `review.get`) shows what you wrote.

## Filing content

Every unit you add gets a home in the existing organisation, so a person browsing finds it beside its peers. Declaring bought or placeholder content is in `tools/jam/docs/external-content.md`.

1. Read what exists: `organization.list` (categories and tags with counts), `collection.search`, and `collection.membership` with the new unit ids.
2. **Category:** the most specific existing one that fits. When none does, add a path in the same `Parent/Child` style as its neighbours; in a project with no categories yet, start from what the thing is in the game (`Props/Containers`), not where it came from (`category.create`, then `organization.set`).
3. **Collection:** add the unit to the set it belongs with (`collection.update` with `add`). Create one (`collection.create`) only for a real group of several units.
4. **Tags:** reuse the existing spelling.

Done when `unit.get` shows the category and memberships, and you have told the person which categories or collections you created.

## Reviews

A step of a run is put in front of a person with `jam run request-review` (the `jam-recipe` skill); its verdict flows back into the run. Content outside a run is submitted here with `review.submit`. It is one review system either way: the person decides in the browser, on the link.

Look before you submit: capture each part the person will judge and open the images. Something visibly wrong (missing geometry, a blank texture, the wrong file) is fixed or reported, not sent for approval.

An item separates what is decided from how it is shown:

- **Parts** are what the person gives a verdict on: a unit's content parts (`parts`), or for anything else the entries of `decide` (`[{ "id": "design", "label": "Design" }]`). An item with none of either is decided as one part, `item`.
- **Views** are ways of showing: camera angles, an old/new comparison, a concept sheet, an engine screenshot. Each has a caption naming what it shows, and is never decided. A person can leave a note on one view when the point is visible there.

Several angles of one thing are views of one part, never several parts.

Alternatives to pick from (concepts, variants) are one item with `"choose": "one"`, one option per `decide` entry (or content part), each shown by its own views. The person picks one, takes it as it is or with changes, or answers that none of them works and says what would. Never submit alternatives as separate items to approve and reject.

Show media in the catalog's own viewer whenever it can be. A model is shown as its GLB, where the person can orbit, zoom, play its clips and switch to clay or wireframe: a unit's model part, or a capture of the file. Old against new is a capture pair of the two GLBs (`{ "revision", "path" }` for the old one when it is only in Git), shown side by side with linked cameras or as an overlay. An angle worth pointing out is a view of that same capture with a `camera` (`{ "position": [x, y, z], "target": [x, y, z] }`; check the framing with `jam catalog capture`), not a rendered still. A sprite animation is its sheet image with the link's `sheet`, and plays in the viewer; old against new is a view whose `before` is earlier evidence or `{ "path", "sheet" }`, played in step with it. Renders and screenshots are views only for what the viewer cannot show (in-engine lighting, the game camera with its post-processing), placed after the model.

Each thing the person reads goes in its own field, written for them:

| Field | Holds |
| --- | --- |
| `title` | What the submission holds, as a name: "Creature remakes, 14 designs" |
| `ask` | The one question they answer, in a sentence: "Approve, change or reject each creature's design." |
| `brief` | Markdown for every item: how the work was made, how to read the views, naming each by its caption |
| `changes` | Markdown: what changed since they last looked, and why |
| `limits` | Markdown: known defects and what is not done |
| item `text` | Markdown: only what differs for this item |
| view `caption` | What that view shows |

`brief`, `changes` and `limits` appear once, on the review's overview; leave a field out when it has nothing to say. Every item is something the person decides: a note to read first goes in `brief`, never in an item. A line that would repeat in every item's `text` belongs in `brief` too. Leave out what the page already shows (author, branch, commit) and what they will not open (hashes, request ids, tool logs). When a change is easiest to judge against what came before, give a view a `before` (an earlier file, or earlier frozen evidence) so the page offers a side-by-side.

What the catalog cannot render itself (an engine screenshot or clip, a file as it was at a commit) goes in an item's `captures`, each `{ "label", "file" }` or a pair `{ "label", "before", "after", "labels": [..] }`, with `"renderer"` naming what drew it and `"shows"` naming the part it shows (default: the item's only part, else the whole item); a file is a checkout path or `{ "revision", "path" }`. Each capture becomes a view. Work that is not catalog content (lighting, tooling, a proposal) is an item without `target`: a `title` with captures, `text`, or both. An item with only `text` is a proposal the person approves or rejects.

Correct your own submission instead of submitting it again. `review.update` changes its title, ask, brief, changes, limits, and per item the title, text and each view's caption, camera and state, until someone decides on what the edit changes. Send `""` to clear a field. `review.withdraw` with a `reason` takes a submission out of every queue and keeps it readable. Only different files need a new submission, with `supersedes` naming the one it replaces; the replaced one leaves the queue.

A verdict is the person's. They give it in the browser. When they told you their decision instead, relay it with `review.decide` as yourself (`--actor-kind agent`) and add `"relay": {"by": "<the name they go by in the project>", "channel": "<where they said it>", "words": "<what they said, verbatim>"}`, with `whole` (or `verdicts` per part) set to one of `review.verdicts` in `catalog.config.json` (by default `approved`, `changes`, `rejected`). The record then shows it came through you, and a run's human gate accepts it as a relay. Their words set what the decision covers: "the crate is fine" decides the model, not attributes they did not look at; ask when it is unclear. Never record your own judgement as a person's. When they correct a verdict you relayed, change that decision with `review.decision.edit` (or remove it with `review.decision.delete`); a decision recorded by a person, or by another agent, is refused.

Read open notes on a review with `review.get` (`observations`); a note's `viewLabel` names the view it is about. Notes have no replies. Mark one dealt with (`note.resolve`) only when what it says was actually handled.

Done when `review.get` shows the submission or decision, and the person has its `url`.

## Extending the catalog

When the person wants the catalog to show the project's own content (the game engine's assets, archetypes such as weapons or creatures, data from the server, animations cut from sprite sheets), follow `tools/jam/docs/catalog-integration.md`.

A project adds its own sources, relations, media kinds, checks, actions, scopes, inspectors and panels (its own browser modules on a unit's page) with a plugin: a module listed under `plugins` in `catalog.config.json`, kept under `jam/catalog/`, that imports `tools/jam/catalog-plugin.ts`. The contract, with a complete small plugin, is `tools/jam/src/catalog/README.md` (section "Plugins"); `tools/jam/examples/plugins/storybook.ts` uses every extension point. `jam catalog example <new folder>` creates a sample project to try things in.

Done when `jam catalog run problems` is empty and `jam catalog doctor` reports the plugin's checks.
