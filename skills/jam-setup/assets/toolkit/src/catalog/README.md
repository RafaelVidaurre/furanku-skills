# Content catalog engine

The catalog describes what a project contains (its content, the media that shows it, how it is grouped), lets people and agents organise it, keep notes on it and review it, and records all of that as plain files under `.catalog/` that travel with Git. It reads the current checkout, uncommitted files included.

This document is the catalog's reference: commands, configuration, plugins, records, reviews, actions, the server and the page, viewer sessions for agents, and the security rules. The engine is `src/catalog/`. It depends only on `src/kernel/`; nothing in it knows about a game engine, a provider or the rest of the toolkit. The HTTP server (`src/catalog/server/`) and the page (`catalog/web/`) are built on its facade.

## Commands

```sh
jam catalog actions                 # every action; --json adds each input as JSON Schema
jam catalog run <action> [--input '<json>' | --input -]
                [--actor-kind human|agent] [--actor-name <name>] [--request-id <id>]
jam catalog todo                    # reviews waiting, open notes, changed verdicts, problems
jam catalog doctor [--fix]          # checks; exits 1 while something is left to fix
jam catalog unlock <lock>           # remove a lock whose owner has exited

jam catalog open [--allow-origin <origin>]...   # print the address of this checkout's catalog; starts its server when none runs
jam catalog status | stop           # whether that server is running, and where; stop it
jam catalog serve [--port <n>] [--allow-origin <origin>]...   # the same server in the foreground, until interrupted
jam catalog capture --target unit:<id>|collection:<id>|asset:<id>|submission:<id>/<item>
                [--part <id>] [--view <id>] [--camera '<json>'] [--mode textured|clay|wireframe]
                [--animation <clip>] [--size 1280x860] [--out file.png] [--url <server>]
jam catalog example <empty-dir> [--no-video]   # create the Hollowmere sample project
```

Every command takes `--root <project>` and `--json`. `run` always prints the action's result as JSON. A failure prints `error:` and `fix:` lines (one JSON object with `--json`) and exits 2 for invalid input, 1 otherwise. The first group reads and writes the project's files directly and starts in a fraction of a second; only `serve`, `capture` and `example` load the HTTP server or a browser. See [Server](#server) for `open`, `status`, `stop` and `serve`, and [Viewer sessions](#viewer-sessions) for `capture`.

```sh
jam catalog run catalog.search --input '{"q":"helm","filters":{"type":["gear"]}}'
jam catalog run note.create --actor-kind agent --actor-name checker --request-id n-1 \
  --input '{"target":{"kind":"unit","id":"gear/helm","part":"model"},"body":"Visor reads thin"}'
jam catalog run review.decide --actor-kind human \
  --input '{"submission":"sub_…","item":"it_…","whole":"approved","exceptions":{"model":"changes"}}'
```

## Configuration

`catalog.config.json` at the project root is project policy and is versioned with the project:

```json
{ "version": 2,
  "plugins": ["manifest", "./catalog/storybook.ts"],
  "options": { "manifest": { "file": "catalog.manifest.json" }, "storybook": { "folder": "story" } },
  "review": { "resolver": "latest", "referenceRoles": [], "verdicts": ["approved", "changes", "rejected"] },
  "display": { "pixelArt": false } }
```

- `plugins`: in load order. An entry is a built-in name (`manifest`, or one the toolkit registers, such as `jam`) or a project-relative module (`./catalog/storybook.ts`, `.ts`, `.mjs` or `.js`). The built-in `media-core` plugin is always loaded first. Without a configuration file the catalog uses `["manifest"]`.
- `options`: one object per plugin name; a plugin sees only its own.
- `review.resolver`: `latest` (default), `strictest`, or a resolver a plugin registers. Resolvers change how verdict events are read, never the events.
- `review.referenceRoles`: roles that are supporting material. They are left out of new submissions and decisions; older evidence stays viewable and does not count in review totals.
- `review.verdicts`: the verdicts reviewers may give, from `approved`, `changes`, `rejected`.
- `display.pixelArt`: images keep hard texels in thumbnails and image viewers, for every type that does not set its own `display`. Thumbnails always show whole images; captures always keep smooth scaling. Version 1 files take the same key.

A running catalog follows the checkout. The file is read for every action and decoded when its bytes changed; plugins and project modules are imported again when theirs did (a branch switch, an edit). When the file or a plugin is broken, the last good settings stay in use and the failure is listed under problems; a catalog that has no good settings yet fails with the error.

### Version 1

Version 1 files keep working and are never rewritten:

```json
{ "version": 1, "adapter": "manifest", "options": { "manifest": "catalog.manifest.json" },
  "previewModules": { "lineup": "./previews/lineup.mjs" },
  "review": { "resolver": "latest", "resolverModule": "./tools/resolver.mjs" } }
```

`adapter` becomes the one plugin. A version 1 adapter module (`export default ({ root, options }) => ({ name?, sources(), load() })`) is wrapped as a plugin with one source: it is created once per load of the configuration, `sources()` gives its inputs, and it receives the whole `options` object. `previewModules` and `review.resolverModule` register previews and a resolver as a plugin would; `previewModules` also declares the modules of type views and panels.

## Plugins

A plugin is a module whose default export is a plain object. Its functions may return a value, a promise or an Effect; a failure becomes a problem scoped to that plugin, not a crash. The public entry is [`plugin.ts`](plugin.ts): types, `definePlugin`, `defineAction`, and the `Schema` and `Effect` modules a project plugin cannot resolve on its own. Nothing else under `src/` is an interface.

| Point | What it adds |
| --- | --- |
| `sources` | Units, assets, collections and types, each from declared inputs |
| `enrich` | Changes to the merged sources before they are validated |
| `relations` | Named references between units; the catalog computes the reverse side |
| `mediaKinds` | Kinds of media, recognised by bytes |
| `probes` | Measured facts of media files, cached per file version |
| `checks` | Problems `doctor` reports, with optional fixes |
| `actions` | Project actions in the same registry as built-in ones |
| `scopes` | The top-level split of units |
| `resolvers` | Verdict resolvers selectable by `review.resolver` |
| `previews` | Collection preview modules for the browser |
| `views` | Modules of type views (inspectors in a unit's visual strip) and panels (sidebar sections) |

A complete plugin with one source, a relation and a check:

```ts
// catalog/recipes.ts, listed in catalog.config.json as "./catalog/recipes.ts"
import { definePlugin } from "../tools/jam/src/catalog/plugin.ts"

interface Recipe { id: string; title: string; photo?: string; uses?: string[] }

export default definePlugin({
  name: "recipes",
  sources: [{
    name: "recipes",
    inputs: () => ["recipes.json"],
    load: async ({ files }) => ({
      project: "Cookbook",
      assetRoots: ["photos"],
      types: { recipe: { label: "Recipe", fields: [{ key: "uses", label: "Uses", kind: "refs" }],
                         roles: [{ key: "photo", label: "Photo", kinds: ["image"], expected: true }] } },
      units: ((await files.readJson("recipes.json")) as Recipe[]).map((recipe) => ({
        id: `recipe/${recipe.id}`, type: "recipe", name: recipe.title,
        attrs: { uses: (recipe.uses ?? []).map((id) => `recipe/${id}`) },
        links: recipe.photo ? [{ role: "photo", asset: recipe.photo }] : [],
        sources: ["recipes.json"]
      }))
    })
  }],
  relations: [{ name: "uses", label: "Uses", inverseLabel: "Used in",
                from: (unit) => (unit.attrs["uses"] as string[] | undefined) ?? [] }],
  checks: [{
    name: "photos",
    run: async ({ run }) => {
      const found = (await run("catalog.search", { filters: { visual: ["missing:photo"] }, pageSize: 200 })) as { items: { id: string }[] }
      return found.items.map((item) => ({ subject: item.id, message: `${item.id} has no photo` }))
    }
  }]
})
```

[`examples/plugins/storybook.ts`](../../examples/plugins/storybook.ts) uses every point and is exercised by the tests.

Every plugin function receives a context: `root` (absolute project root), `options` (the plugin's own entry) and `files` (`exists`, `readText`, `readJson`, `readBytes`, `walk`; project-relative forward-slash paths that cannot leave the project).

### Sources

`{ name, inputs(context), load(context) }`. `inputs` lists the project-relative files and folders the source reads. The source is loaded again only when one of them changed: authored data (`.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.ini`, `.csv`, `.tsv`) is compared by bytes, so an edit that keeps size and timestamp is still seen; anything else by size and modification time. `inputs` is called before each load and again after it, so the list may depend on what was loaded. A source that fails keeps its last loaded output and is listed as a problem; that includes an `inputs` that throws or returns something other than a list of paths. A source is never silently empty.

`load` returns any of:

```ts
{ project, assetRoots: ["art"],
  types: { <key>: { label, scope?, fields, roles, thumb?, help?, reviewAttributes?, views?, panels?, display? } },
  collectionKinds: { <key>: { label, preview?, memberField?, memberExtra? } },
  assets: [{ id, path, kind?, label?, tags?, category? }],
  units: [{ id, type, name?, attrs?, links: [{ role, asset, key?, meta? }], aliases?, search?, sources?, tags?, category?, explain?, views? }],
  collections: [{ id, name, kind?, members: [{ unit, ...extra }], tags?, category? }],
  problems: [{ source?, error, recovery? }] }
```

Outputs of several sources are merged in plugin order. A type or collection kind defined twice with different content keeps its first definition and is reported; a second unit with a taken id is reported and dropped.

- A **type** has `label`, `scope` (a registered scope id; the first registered one when absent), `fields` (`key`, `label`, `kind`: text, number, enum, refs or code, `unit?`, `help?`, `group?`, `derived?`, `summary?`, `filter?`), `roles` (`key`, `label`, `kinds`: media kind ids, `many?`, `expected?`) and `thumb` (the role used for thumbnails). Fields marked `derived` are live facts shown beside content and are left out of review evidence. Fields with `summary: false` and derived fields are left out of card summaries. A scalar field with `filter: true` gets an `attr.<key>` facet. A type with `reviewAttributes: false` has no Attributes review part: its fields are provenance and reviewers judge its media. `views` and `panels` mount browser modules for each unit (see [Views and panels](#views-and-panels)); `display: { pixelArt }` overrides the project's `display`.
- A **unit** is one catalog entry. Its identity is its `id`, never a file. `views` narrows its type's views to the keys it lists. A link attaches an asset in one of the type's roles. A link in a `many` role may give a stable `key` (unique within the role) so that moving the file keeps the review part's identity; without it the asset id is the key. `meta` carries per-link data such as a take number or word timings; it is returned with the link and is never review evidence.
- An **asset** is a media file with its own identity (`id`, project `path`), shared by every unit that links it. A link that names a path with no asset entry creates one. Paths are confined to `assetRoots` after resolving symbolic links; `.git` and `.catalog` paths are never assets.
- **Collection kinds** may declare `memberField`, `memberExtra` (`{ key, format? }`: a member's own value, shown as `×N`, or as written with `format: "text"`) and a `preview`: `module`, `label`, `roles` (member roles shown, default `model`), `base` (an asset id), `config` (any object) and `represents` (`complete` or `representative`).
- Tags and categories a source supplies are project-owned and read-only in the catalog. Organization made in the catalog is stored separately and layered on top.

The built-in **manifest** plugin reads `catalog.manifest.json` (option `file`): `{ version: 1, project, assetRoots, types, collectionKinds, assets, units, unitFiles, collections }`. `unitFiles` lists folders whose `*.json` files each hold one unit or `{ "units": [...] }`. A malformed file becomes a problem naming it; the rest of the catalog stays.

### Enrich

`enrich(merged, context)` runs after the sources merge, in plugin order, and returns a patch: `types` and `collectionKinds` to add or replace, `units` by id (an object replaces the fields it names, `null` removes the unit), `assets` and `collections` to add, and `problems`. The patched result is validated like any source output. Use it to categorise, retype or annotate what other plugins loaded without editing them.

### Relations

`{ name, label, inverseLabel, from(unit) }` returns the ids a unit refers to. `unit.get` returns `relations`: one entry per direction that has units, `{ name, direction: "out" | "in", label, units: [{ id, name, exists, thumb }] }`, where the `in` side is computed from every other unit's `from`. No unit stores its referrers.

### Media kinds and probes

A media kind is `{ id, label, extensions, sniff(head), validate?(file), web? }`. `sniff` receives at most the first 64 bytes and returns the MIME type or null. Extensions only say which kind a file was meant to be; a file whose bytes are another kind is `invalid`. `validate` may refuse a file that sniffs correctly (it returns the reason). `web` declares the browser module that registers the kind's viewer, thumbnail and comparison in the page; [Adding a media kind](#adding-a-media-kind) shows both halves.

`media-core` registers `image` (PNG, JPEG, WebP, GIF), `video` (MP4, WebM), `model` (self-contained GLB; a GLB that refers to external buffers or images is `unsupported`) and `audio` (WAV, OGG, FLAC, MP3). WAV and WebP share the RIFF container and are told apart by its format tag.

A file's state is `ok`, `missing`, `invalid` (bytes are not the declared kind, or not media although the extension says so), `unsupported` (an unknown format, or refused by `validate`) or `forbidden` (outside the asset roots).

Opening a project reads the first 64 bytes of each media file and never a whole file. Lists identify a file by its `version`, a token made from its size and modification time: that is the `v` of its address (`/media/asset/<id>?v=<version>`), and what the page caches thumbnails by. The SHA-256 is computed when an answer depends on the exact bytes: a detail page (`unit.get`, `asset.get`, a collection's preview), freezing for a review, `evidence.compare`, and the files behind parts that have a verdict (to say whether they changed since). In list results `sha256` is therefore `null` unless it happens to be known. Sniffing results and digests are remembered while a file's size and modification time are unchanged, in memory and in `.catalog/.local/facts/media.json`, so a file is hashed once per version on a machine.

A probe is `{ name, version, kinds, fields?, measure(file, context) }` and returns an object of facts for one file. Results are stored under `.catalog/.local/facts/` by probe name, version and the file's SHA-256, so a file is measured once per version of the probe on a machine; raise `version` to measure again. `unit.get` returns them per link (`links[].facts.<probe>`) and `asset.get` per asset, as `{ facts }` or `{ error }`. Like derived fields, they are shown beside content and are never review evidence.

### Checks

`{ name, label?, run(context) }` returns problems: `{ message, subject?, severity?: "problem" | "info", fix?: { label, apply?() } }`. The context adds `run(action, input)` for read actions. `doctor` runs every check and reports; it changes nothing. `doctor.fix` is the write that calls each `apply`, then runs the checks again and reports what is still wrong.

### Actions

`defineAction({ name, kind: "read" | "write", description, input, run(input, context) })`. `input` is a `Schema.Struct`; it is published as JSON Schema by `actions` and decodes the input before `run`. The context adds `actor` and `requestId` (writes only) and `run(action, input)` to call catalog actions: from a write, nested writes keep its actor and get request ids derived from its own. A plugin action is listed, validated, attributed and repeatable by request id exactly like a built-in one. An action cannot take a built-in action's name; prefix it with the plugin's (`storybook.outline`).

### Scopes, resolvers, previews and views

- `scopes`: `[{ id, label, description }]`, the top-level split of units, in the order the page shows them. When no plugin registers any, the defaults are `content` and `assets`; with a single scope the page has no split. An id is a section of the page and a segment of its addresses (`#/<scope>/u/<unit>`): lower-case letters, digits and hyphens, and none of `collections`, `files`, `reviews`, `notes`, `organize`, `inbox`. `catalog.search` takes `scope` with `section: "units"` (and for collections, those with a member in the scope); `unit.get` reports `unit.scope`.
- `resolvers`: `{ <name>: (events, part) => event }`. It receives the time-ordered events that address one part and returns the deciding one.
- `previews`: `{ <name>: "<browser module>" }`. A collection kind names one as `preview.module`. The module default-exports `(ctx) => markup` for the page and receives `ctx.html`, `ctx.members` (`[{ unit, part, role, asset }]`), `ctx.base`, the kind's `ctx.config`, `ctx.label`, `ctx.MediaViewer` and `ctx.viewers` (the viewer components the registered kinds offer, such as `ModelViewer`), and `ctx.viewerId` and `ctx.source` to pass on to the viewer. [`examples/previews/lineup.mjs`](../../examples/previews/lineup.mjs) is one.

- `views`: `{ <name>: "<browser module>" }`. A type's view or panel names one with `module` and the function to call with `export` (default: the default export). See [Views and panels](#views-and-panels).

A **browser module** (a media kind's `web`, a preview, a view module) is a `.js` or `.mjs` file declared in one of two ways: a project-relative path (`"catalog/previews/lineup.mjs"`), or a `file:` URL for a module that ships beside the plugin itself, wherever the plugin is installed: `new URL("./viewer.js", import.meta.url).href`. The server hands out exactly the declared files, by name (`/project/preview/<name>`, `/project/kind/<kind id>`, `/project/view/<name>`), versioned by their bytes; a module is one file and cannot import its neighbours.

## Records (`.catalog/`)

| Path | Record | Mutability |
| --- | --- | --- |
| `notes/<id>.json` | Standalone note: target (unit, collection, asset, or submission item/part), text, author, disposition | Edited with expected revision |
| `labels/<kind>/<key>.json` | Category and tags of one unit, asset or source collection | Edited with expected revision |
| `collections/<key>.json` | Catalog-owned collection: name, kind, category, tags, ordered member references | Edited with expected revision |
| `categories.json` | Registered category paths | Edited with expected revision |
| `reviews/<sub>/submission.json` | Submission: items, frozen parts with evidence, views (captions, cameras, optional before side), context | Immutable |
| `reviews/<sub>/verdicts/<event>.json` | One verdict event: scope, verdicts, comment, optional notes per decided part, author, time | Immutable |
| `evidence/<aa>/<sha256>.<ext>` | Content-addressed frozen bytes (dirty or untracked files, definitions) | Immutable |
| `.local/` (Git-ignored) | Locks, request journal, measured facts, captures, the server's record and log | Machine-local |

- Identities are random and time-ordered (`nt_`, `sub_`, `it_`, `vw_`, `vd_`), so records made on different branches merge without collisions. A short reference (`R5DAZA`) is the last six characters.
- Every record kind has a schema ([`records/schemas.ts`](records/schemas.ts)). A file that is not valid, is in a Git merge conflict, or whose identity does not match its path is listed as a problem and excluded; every other record is used.
- Every operation validates its whole input and every record it would produce before any file changes. Operations over several records (bulk tagging, category and tag renames) are validated as one unit, every new file is written beside its target, and only then are the targets replaced; a failure leaves no partial edit. Mutable records carry `revision`; a stale `expectedRevision` fails with `conflict` and the current record is returned in `details.current` so the caller can merge.
- Writers take a short lock under `.local/locks`: one writer per lock in a process and, through the lock file, on the machine. A write reads the records after it holds its lock. A lock left by a crashed process is never removed automatically; `unlock` removes it only after verifying that its process has exited on this machine.
- A write may carry a `requestId`. The replay check and the write run under one lock, so simultaneous retries record once and a repeat returns the first result with `replayed: true`. Reusing the id with another action, input or actor, or in another branch or worktree, fails with `conflict`. Created records and verdicts keep this binding, so a lost local journal cannot replay another checkout's work.
- Paths under `.catalog` (records, evidence, locks, journal, caches) are read and written without following symbolic links.
- A write may carry the checkout `context` key it was prepared in (from the `context` action). After a branch switch it fails with `context_changed`.

Record scans are incremental: each action lists the record folders once and reads only the files whose size or modification time changed.

## Reviews

- A **submission** freezes its items when created. A unit item has one part per linked visual (the role key for a single role, `role:key` for a `many` role, the key defaulting to the asset id) plus `attributes`. A collection item has `member:<unit>` per member, and `preview` when its kind declares one. A submission may select parts; only the selected parts' dependencies are frozen: a member part freezes that member; a preview part freezes its member inputs, base, module name, config and roles. Views are captioned and may carry a camera and viewer state (`mode`, `animation { clip, time, playing }`, `isolate`, `texture`); several views can show one part. The submission `note` is Markdown.
- **Captures** are evidence rendered outside the catalog (a game engine's screenshot, a clip, a model as it was at a commit). An item's `captures` are each `{ label, caption?, renderer?, file }` or `{ label, caption?, renderer?, before, after, labels? }`, where a file is a checkout path (anything but `.git`, `.catalog/.local/captures` included) or `{ revision, path }` (frozen as that commit's Git blob). The bytes must be a registered media kind. Each capture is its own part `capture:<n>` with a default view; `renderer` is shown as a badge. Captures belong to their item, never to content: a unit's parts, "changed since its verdict" and "compare with current" ignore them. A unit or collection item may submit captures only (`parts: []`).
- **Work** is an item without `target`: work that is not catalog content (lighting, tooling, a proposal). It needs a `title` and `captures`, `text`, or both; with text and no captures it has one part, `decision`. Any item's `text` (at most 4000 characters) is shown above its evidence.
- **Before/after views.** A view may carry `before`: `{ "path": "<project file under the asset roots>" }` or earlier frozen evidence `{ "submission", "item", "part", "leaf"? }`, with an optional `label` (default "Before") and the view's `afterLabel` (default "After"). Both sides must be the same kind of media; a preview or attributes view has no single media to compare. The before side is frozen like part evidence and is not a reviewable part.
- A preview needs every declared input: member visuals in its roles and its base. A frozen preview records the SHA-256 of the project module it was submitted with; its evidence digest includes the module's identity, so a module change marks the verdict changed, and the frozen preview is offered for rendering only at the submitted revision.
- **Evidence** records the SHA-256 of every byte stream. A file committed and unchanged at HEAD is referenced as its Git blob (Git LFS objects are read from the local LFS store). Anything dirty or untracked is copied into `.catalog/evidence`. Every read verifies the digest; a missing Git object, missing LFS data or changed bytes are reported as `missing` or `corrupt`, and current content is never substituted.
- A **verdict event** is `whole` (every reviewable frozen part: one verdict plus explicit exceptions, so "approve except the boots" is one record) or `parts` (only the named parts). `comment` covers the whole decision; `partNotes` (`{ "<part>": "text" }`) attach a note to parts the event decides, and a note on a part without a verdict in that event is refused. Feedback without a verdict is a note on the submission, item or part.
- **Projection.** A unit's or collection's current status per part comes from the configured resolver over every event whose item targets it. Order is recorded UTC time, then event id. Verdicts never cascade between a collection and its members, or between units sharing an asset. Parts that appear later stay undecided. When current content differs from the evidence a verdict saw, the part is marked `changed`; nothing is reset or created automatically.
- `review.decideCurrent` validates the decision first, then records it on a waiting item whose frozen evidence equals current content, or submits current content and records it there. Revising a decided item uses `review.decide`.
- **Evidence retention.** Nothing is pruned and there is no cleanup command. Deleting files under `.catalog/evidence` is an ordinary Git change; affected views then report missing evidence while verdict history stays readable.

## Actions

Every operation is an action: a name, `read` or `write`, a description and an input schema. The CLI, HTTP and the browser use the same registry, so a person and an agent get the same validation and the same result. An input is checked against its schema at every level; an unknown field is refused. Optional fields accept `null` as "not given".

| Action | Kind | Purpose |
| --- | --- | --- |
| `context` | read | Project, checkout, counts, problem count, `version`. For polling: runs no `git status`, returns no schema |
| `schema` | read | Types, collection kinds, scopes, media kinds, relations, probes, previews, unit scopes; changes only when `version` does |
| `checkout` | read | The checkout with its count of uncommitted changes outside `.catalog` |
| `problems` | read | Configuration and plugin failures, source problems, malformed or conflicted records |
| `inbox` | read | Reviews with undecided parts, open notes, parts changed since their verdict, problems |
| `doctor` | read | Checks and what each one found; changes nothing |
| `doctor.fix` | write | Apply the repairs that checks declare, then check again |
| `catalog.search` | read | Ranked search with facet counts and bounded pages over units, collections or assets |
| `unit.get`, `collection.get`, `asset.get` | read | One entry in full |
| `organization.list` | read | Categories and tags with usage counts |
| `notes.list`, `reviews.list`, `review.get` | read | Notes; submissions; one submission with evidence status |
| `evidence.compare` | read | Frozen evidence against current content or another frozen part; each side resolves on its own |
| `collections.membership`, `locks.list` | read | Catalog collections containing given units; record locks |
| `note.create`, `note.edit`, `note.resolve`, `note.reopen`, `note.delete` | write | Notes |
| `organize.set`, `organize.bulk`, `category.create`, `category.rename`, `category.delete`, `tag.rename`, `tag.delete` | write | Organization |
| `collection.create`, `collection.update`, `collection.delete` | write | Catalog-owned collections |
| `review.submit`, `review.decide`, `review.decideCurrent` | write | Reviews |
| `unlock` | write | Remove a stale lock |
| `viewer.open`, `viewer.state`, `viewer.control`, `viewer.capture`, `viewer.close` | viewer | Drive the page's viewers in a server's headless browser ([Viewer sessions](#viewer-sessions)) |

- Writes must declare their actor: `{ name, kind: "human" | "agent" }`. Attribution is a declaration, not proof of identity; an agent declares `agent`.
- Errors carry a code: `invalid`, `not_found`, `conflict`, `context_changed`, `locked`, `unsupported`, `malformed`, `forbidden`, `unavailable`.
- A named part, item, view, member or version that does not exist is an error, never a substitute.
- **Links.** A result that creates or names a review or a page carries its `route` (`#/reviews/s/<submission>`, `#/<scope>/u/<unit>`, `#/collections/c/<id>`, `#/files/a/<asset>`): `review.submit`, `review.get`, `review.decide`, `review.decideCurrent`, every entry of `reviews.list` and `inbox`, each note's target, and the three detail reads. While a server is running for the checkout (`jam catalog open`), each `route` has a `url` beside it that a person can click; otherwise the result has one `hint` saying how to get one.
- `doctor` built-in checks: catalog problems; media files that are Git LFS pointers (fix: `git lfs checkout`, then `git lfs pull`); linked media that cannot be shown; media files under the asset roots that no unit links (information; hidden folders and Git-ignored files are left out); reviews waiting for a verdict (information).

### Using the engine from code

[`Catalog.ts`](Catalog.ts) is the facade. `Catalog.layer` needs the kernel's `ProjectFiles`, `Git` and `Ids` for one project; `Catalog.layerWith({ plugins, overrides })` also registers plugins by name (how the toolkit adds `jam`) and applies command-line overrides.

```ts
const program = Effect.gen(function*() {
  const catalog = yield* Catalog
  const found = yield* catalog.run("catalog.search", { q: "helm" })
  yield* catalog.run("note.create", { target: { kind: "unit", id: "gear/helm" }, body: "Check the visor" }, { actor: { name: "checker", kind: "agent" }, requestId: "n-1" })
})
```

The service also gives `discover` (actions with JSON Schema), `context`, `defaultActor` (the local Git user, as a human), `config`, media access for serving (`assetFile`, `evidenceMedia`, `beforeMedia`, `previewModule`, `kindModule`), `server` (the running server of this checkout, when there is one), `writeLocal` for machine-local files, and `stats` (counters of work done, used by the performance tests).

An action reads the project through one projection: the snapshot of the sources, the records and the review policy at one moment, built once per action and passed to every query, so all rows and facets of an answer agree. A write takes its lock first and builds the projection under it. Requests that arrive together (a page fetching its thumbnails) share one check of the sources that began after they arrived, so a burst costs at most two checks.

## Server

```sh
jam catalog open      # http://127.0.0.1:4600/
```

`open` prints the address of this checkout's catalog and nothing else on standard output. When no server is running for the checkout it starts one as a process of its own, which keeps running after the command, the terminal or the agent session that started it has ended; when one is running it is reused. An agent hands a person the catalog this way, and gets the same address back every time it asks.

- The server's record is `.catalog/.local/server.json`: `pid`, `host`, `port`, `url`, `checkout` (the worktree it serves; it follows branch switches), `toolkit` (the version that started it), `allowOrigins` and `startedAt`. Its output goes to `.catalog/.local/server.log`. Both are machine-local and ignored by Git.
- A server is reused only after it has answered at the recorded address as that process, serving this folder. A record whose process has exited, or whose process id now belongs to something else, is discarded and a new server is started; the process it named is never touched. A server started by another toolkit version, or admitting other origins than `open` asked for, is stopped and replaced.
- `--allow-origin <origin>` (repeatable) admits one more exact origin (`https://box.example.ts.net:8443`) and its host: a private HTTPS proxy in front of the loopback server, so a person can review from a phone. Scheme, host and port must match; nothing else is admitted.
- Ports are taken from 4600 up: a second checkout's server gets the next free one.
- `status` says whether it is running and where; `stop` ends it and removes the record. `serve` runs the same server in the foreground (`--port <n>` for a fixed port, `0` for any free one) and closes it in order on Ctrl+C or a stop signal: viewer sessions and the browser first, then the listener, then the record. On Windows a detached server is ended without that sequence, and the next `open` cleans up after it.

| Route | Answer |
| --- | --- |
| `GET /` | The page (plain ES modules, no build step) |
| `GET /api/actions` | Every action, viewer actions included, with input schemas |
| `POST /api/run/<action>` | Run an action: body `{ input, actor?, requestId?, context? }`, headers `Content-Type: application/json` and `X-Catalog-Request: 1` |
| `GET /api/health` | `{ ok, pid, toolkit, root }`: which server this is |
| `GET /media/asset/<id>?v=<version>` | An asset's current bytes |
| `GET /media/evidence/<submission>/<item>/<part>?leaf=` | Frozen evidence, verified against its digest |
| `GET /media/before/<submission>/<item>/<view>` | A view's frozen before side |
| `GET /project/preview/<name>`, `GET /project/kind/<kind>`, `GET /project/view/<name>` | A declared browser module; `?v=` pins a revision (409 when it is not the current one) |
| `GET /vendor/…` | The page's browser packages |

A failed action answers with its error as JSON (`{ error: { code, message, fix?, details } }`) and the status of its code: 400 `invalid`, 403 `forbidden`, 404 `not_found`, 409 `conflict` and `context_changed`, 422 `malformed` and `unsupported`, 423 `locked`, 503 `unavailable`. Media answers honour `Range` requests. The page acts as the local Git user (a person); every other client declares its actor in the body.

The server is `src/catalog/server/`: `http.ts` is the only module that touches `effect/http` and the Node platform (a small request and response model, and a listener that lives as long as its scope); `app.ts` holds the routes, `security.ts` the rules below, `Server.ts` the `CatalogServer` layer, `Renderer.ts` the viewer sessions, `control.ts` what `open`, `status` and `stop` do.

## The page

The page (`catalog/web/`) lists units by scope, collections and files; shows one entry with its media, attributes, relations, notes and memberships; runs reviews (items, parts, views, before/after, verdicts with notes per part); and has a "Needs attention" view (the `inbox` action) reachable from the top bar. It polls the small `context` action and fetches `schema` again only when `version` changed. It knows nothing about a particular project: scopes, types, labels and media kinds all come from the schema.

### Adding a media kind

A media kind has two halves, both declared by one plugin. [`examples/plugins/text-kind.ts`](../../examples/plugins/text-kind.ts) with [`text-kind.web.js`](../../examples/plugins/text-kind.web.js) adds plain text as a fifth kind and is exercised by the tests.

The engine half says how a file of the kind is recognised and where its browser module is:

```ts
import { definePlugin } from "../../src/catalog/plugin.ts"

export default definePlugin({
  name: "text-kind",
  mediaKinds: [{
    id: "text", label: "Text", extensions: ["txt", "md"],
    sniff: (head) => (head.length > 0 && head.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32) ? "text/plain; charset=utf-8" : null),
    web: new URL("./text-kind.web.js", import.meta.url).href
  }]
})
```

The browser half registers how it is shown. The module default-exports a function that receives the page's API:

```js
export default function (catalog) {
  const { html, hooks: { useEffect, useState }, registerMediaKind, useViewer, Msg } = catalog
  function TextViewer({ media, viewerId, source, onStatus }) {
    const [text, setText] = useState(null)
    useEffect(() => { fetch(media.url).then((r) => r.text()).then(setText) }, [media.url])
    const status = text == null ? "loading" : "ready"
    useEffect(() => { onStatus?.(status) }, [status])
    useViewer(viewerId, () => ({ kind: "text", status, error: null, source, controls: [] }), () => false)
    return html`<div class="viewer"><${Msg} status=${status} /><pre>${text}</pre></div>`
  }
  registerMediaKind("text", { viewer: TextViewer, thumbnail: () => html`<span>Aa</span>`, capture: { renderer: "catalog text viewer" } })
}
```

`registerMediaKind(id, definition)` is the one call that makes a kind known to the page. The four built-in kinds make it too (`catalog/web/kinds/*.js`); nothing else in the page names a kind.

| Field | What it is |
| --- | --- |
| `viewer` | Required. A component receiving `media` (`{ kind, url, id?, path?, sha256?, version? }`), `viewerId`, `source`, `label`, `onStatus`, `context` (`{ unit, type, link }` on a unit's page) and, for kinds that use them, `initialCamera`, `initialState`, `keepCamera` |
| `thumbnail` | A component receiving `asset` and `size`, drawn inside the square thumbnail. Without one the kind's icon is shown |
| `compare` | A component receiving both sides `a` and `b` (`{ status, url, kind, sha256, path, error }`), `labels`, `mark(side)(status)`, `control`, `camera`, `state`, `apiRef`. Without one the viewer is shown twice, side by side |
| `compareTogether` | True when both sides are one viewer (two takes on one transport): both must be available, and the component answers for the comparison's state and controls through `apiRef.current = { getState, control }` |
| `capture` | `{ renderer, blocked? }`: how a capture of this kind describes itself, and an optional `(state) => reason` that refuses one |
| `icon` | SVG path data for a 20×20 glyph |
| `reuse`, `framing` | `reuse`: keep one viewer instance when the media changes (a model keeps its camera). `framing`: the viewer has a camera a submitter can save with a view; its state then reports `camera` and `view` |
| `components` | Named viewer components offered to preview modules as `ctx.viewers` |

A viewer reports itself with `useViewer(viewerId, getState, control)`. The state carries `kind`, `status` (`loading`, `ready` or `error`), `error`, `source` and `controls` (the names of the controls it accepts), plus whatever the kind wants an agent to see. `control(command)` returns `true` when it handled the command, `false` when it does not have that control, or `{ error, code }`. The same state is what a person's page and an agent's viewer session read, and a capture is taken only while `status` is `ready`.

The API object also gives `registerPreview(name, render)`, `MediaViewer` (shows any registered kind), `UnavailableViewer`, `Msg` (the loading and error overlay) and `Icon`.

### Views and panels

A type's `views` are inspectors in each unit's visual strip, selected like a part as `view:<key>`; the one with `default: true` opens before the unit's media. Its `panels` are sections of the unit's sidebar. Each is `{ key, label, module, export?, help? }` and names a module its plugin declares under `views`; [`examples/plugins/storybook.views.js`](../../examples/plugins/storybook.views.js) has one of each. `unit.get` returns them with `url` (or `error`, when the module is not declared or its file is missing).

An export is framework-free: `mount(host, ctx)` fills `host` and returns `{ dispose(), state?(), control?(command) }`. `ctx` has `unit` (`{ id, name, type, attrs }`), `key`, `call(action, input, requestId?)` (with a request id it is a write by the page's person), `assetUrl(id)`, and for a view `state` and `setState(object)` (kept in the page address as `vs`, so a link reopens the view as it was) and `markStage(element)` (what a capture photographs; default the whole view). A view's `state()` reports `status` (`loading`, `ready` or `error`), `error`, `renderer` and anything else an agent should see; `control(command)` answers `viewer.control { view: command }` with a result, or `false` when the view has no such control.

### Audio

Audio roles declare `kinds: ["audio"]`; `many: true` gives each take its own stable review part. Supported bytes are WAV (`RIFF` and `WAVE`), OGG (`OggS`), FLAC (`fLaC`) and MP3 (ID3 or an MPEG frame header), served as `audio/wav`, `audio/ogg`, `audio/flac` and `audio/mpeg`.

- The viewer decodes the exact bytes with Web Audio (checked against the SHA-256 where it is known), draws each channel's waveform, and provides play and pause, scrubbing, looping and a playhead. It starts paused. Its state has `source.sha256`, `duration`, `channels`, `sampleRate` (the decoded playback rate), `playing`, `currentTime` and `loop`. A file the browser cannot decode is an explicit error; another take is never substituted.
- A transcript is shown and highlighted word by word during playback when the project says where the words are: the link's `meta.transcript` (`{ text, words: [{ word, start, end }] }`), or a type's `audioTranscript: { asset, text, words }` naming the attributes that hold the take's asset id, its text and its word timings. The state then adds `transcript`, `currentWord` and `alignment`.
- `viewer.control` accepts `audio: { playing, time, loop }`. A take is selected with `select: { part: "audio:<link key or asset id>" }`.
- A before/after audio view is one transport and one sounding source: `compare: { side: "a" | "b" }` switches sides at the same time on a shared clock. Its state has `kind: "compare"`, `mediaKind: "audio"`, `side` and both digests in `sides`. The timeline is the longer side's; a shorter side is silent after its end. Both sides must be ready.
- Thumbnails and captures draw the waveform without listening. Tests use generated tones and a real browser; they establish that playback and review work, not how anything sounds.

A field with `kind: "code"` renders as a code block (for example a sound's generation prompt).

## Viewer sessions

Agents look at content through the same viewers a person uses. A viewer action runs in a catalog server, which drives the real page in a headless browser; `jam catalog run viewer.*` sends it to this checkout's running server (`jam catalog open`), or to `--url <server>`.

```sh
jam catalog run viewer.open --input '{"target":{"kind":"unit","id":"gear/helm","part":"model"}}'
jam catalog run viewer.control --input '{"mode":"clay","camera":{"position":[1,2,3],"target":[0,1,0]}}'
jam catalog run viewer.capture
jam catalog capture --target unit:gear/helm --part model --mode clay --out helm.png   # all three, with a temporary server
```

- `viewer.open` takes a `target` (`{ kind: "unit" | "collection" | "asset" | "submission", id, item?, member?, part?, view?, compare? }`), an optional page `size` and a `session` name (several sessions can be open). It answers with the page's state: the selection, and the viewer's `kind`, `status`, `source` (the exact asset digest or submission view shown) and `controls`.
- `viewer.control` applies controls to the showing viewer (`camera`, `mode`, `animation`, `isolate`, `texture`, `zoom`, `audio`, `video`, `compare`, `view` for a type's view, or a plugin kind's own) or selects another part or view of the open page (`select`). A control the viewer does not have fails with `unsupported`.
- `viewer.capture` saves the viewer as a PNG under `.catalog/.local/captures` and returns its path, digest, size, what it shows (`shows`; for a capture pair, both digests) and `renderer`, which says it is a catalog render (or names a view's own renderer), not a screenshot of the running project. It refuses unless the viewer is ready and shows exactly the requested selection and bytes. `jam catalog capture --url <server> --out <file>` copies the file from that server's checkout.
- A part, item, view, member or version named explicitly and not found is an error, never a substitute. Naming none opens the first.
- The browser is Playwright's Chromium, or an installed Google Chrome (`CATALOG_BROWSER_CHANNEL` picks a channel). It starts with the first `viewer.open`; when none can start, the error says to run `npx playwright install chromium` in the toolkit folder. Nothing else needs a browser.

## Security

Plugins and version 1 adapters are trusted project code; what they load is data and is validated. Media is read only from the declared asset roots, judged after symbolic links are resolved, and `.git` and `.catalog` are never assets. Media types come from bytes, not extensions. Evidence is read only through complete references (a store path named by its digest, or a Git commit, blob and path) and every read verifies the SHA-256. Nothing under `.catalog` is reached through a symbolic link, for reading or writing: records, evidence, locks, the request journal and caches. Records are type-checked at every level before use. Note, comment and label text is data; the engine never interprets it.

The server adds:

- **Loopback only.** It listens on 127.0.0.1.
- **Host and Origin.** A request whose `Host` is not the server's own address (`127.0.0.1`, `localhost` or `[::1]` with its port) is refused, and so is one whose `Origin` is anything else: a hostile DNS name pointing at 127.0.0.1 and a page on another site get nothing. An origin given with `--allow-origin` is admitted exactly, with its host.
- **Running an action** needs `X-Catalog-Request: 1` and `Content-Type: application/json`, which a cross-site form cannot send. The body is at most 1 MiB and is checked field by field.
- **Files.** The page's own files come from one folder, its browser packages from seven named package folders (scripts only), media from the asset roots; each path is judged as written and again after symbolic links are resolved. Evidence is addressed by submission, item and part, never by path. Browser modules of the project are addressed by declared name only. The configuration, `.git`, `.catalog` and machine-local state are not served. Every file route is read-only.
- **Responses.** Media carries its sniffed type, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, so a file opened on its own can run nothing. Scripts carry `default-src 'none'`. The page allows scripts and styles from the server only (its import map by hash) and the compiling of WebAssembly (`'wasm-unsafe-eval'`, for a view's mesh decoder; JavaScript is never evaluated), no framing and no form posts.
- **Text.** A submission's note is Markdown, rendered and then sanitised by DOMPurify to formatting tags and `href`/`title` (no raw HTML, images, styles, handlers or `javascript:` links); links leaving the catalog open in a new tab without a referrer. Every other note, comment and label is shown as text.

## Tests

```sh
node --test --test-concurrency=1 "test/catalog/*.test.ts"
node test/catalog/screens.ts <sample-project> [out-dir]     # desktop and narrow screenshots of every view
```

The tests are black-box through the facade, the CLI, HTTP and the page, against real temporary Git repositories, worktrees and Git LFS. They cover checkout context, notes and records, reviews and evidence, search, configuration in both versions, every plugin point (through `examples/plugins/storybook.ts` and `text-kind.ts`), `inbox`, `doctor`, the server's routes and security rules, the `open`/`status`/`stop` lifecycle with real detached processes, and the performance rules, which are asserted as counts of work (programs run, sources loaded, record files read, files hashed), not timings.

The `browser-*.test.ts` files drive the real page in Chromium (`npx playwright install chromium` once); they skip, saying why, only when no browser can be launched. They write screenshots to `test-output/browser/` (ignored by Git).

`jam catalog example <empty-dir>` creates "Hollowmere", a sample project for trying the catalog or for acceptance testing: a Git repository of its own with procedural art, two art passes, reviews and notes made through the public actions, and some uncommitted work. It needs a browser to render its art; ffmpeg adds video clips.
