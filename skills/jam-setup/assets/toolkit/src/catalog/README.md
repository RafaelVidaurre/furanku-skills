# Content catalog engine

The catalog describes what a project contains (its units, the assets that show them, how they are grouped), lets people and agents organise it, keep notes on it and review it, and records all of that as plain files under `.catalog/` that travel with Git. It reads the current checkout, uncommitted files included.

This document is the catalog's reference: commands, configuration, plugins, records, reviews, actions, the server and the page, viewer sessions for agents, and the security rules. The engine is `src/catalog/`. It depends only on `src/kernel/`; nothing in it knows about a game engine, a provider or the rest of the toolkit. The HTTP server (`src/catalog/server/`) and the page (`catalog/web/`) are built on its facade.

## The model

| Concept | What it is | Who defines it |
| --- | --- | --- |
| **Unit** | One thing a person looks up or reviews: a character, an item, a level | The project's sources |
| **Type** | What kind of unit it is (Character, Effect), with its fields and roles; the page lists a section's units by type | The project's sources |
| **Asset** | A media file, linked to units in a role ("In game", "Still") | The project's sources |
| **Collection** | A named group of units | The project's sources, or people in the catalog |
| **Scope** | A separate library of units: by default **Content** (what the project is made of) and **Source material** (the files it is made from) | The project's plugins |
| **Organization** | Categories and tags: how people file units, assets and collections | People in the catalog (records), over any the project gives |

The structure (units, types, assets, links, scopes) comes from the project's files and is read-only in the catalog. Organization, notes and reviews are what people add; they are records under `.catalog/`.

## Commands

```sh
jam catalog actions                 # every action; --json adds each input and output as JSON Schema
jam catalog run <action> [--input '<json>' | --input -] [--url <server>] [<actor flags>]
jam catalog inbox                   # reviews waiting, open notes, parts changed since their verdict, problems
jam catalog doctor [--fix] [<actor flags>]   # checks; exits 1 while something is left to fix
jam catalog unlock <lock> [<actor flags>]    # remove a lock whose owner has exited (runs lock.remove)
jam catalog migrate [--dry-run] [--force]    # move .catalog/, catalog.config.json and the manifest to the current formats

jam catalog open [--allow-origin <origin>]...   # print the address of this checkout's catalog; starts its server when none runs
jam catalog status | stop           # whether that server is running, and where; stop it
jam catalog serve [--port <n>] [--allow-origin <origin>]...   # the same server in the foreground, until interrupted
jam catalog capture --target unit:<id>|collection:<id>|asset:<id>|submission:<id>/<item>
                [--part <id>] [--view <id>] [--camera '<json>'] [--mode textured|clay|wireframe]
                [--animation <clip>] [--frame <n>] [--size 1280x860] [--out file.png] [--url <server>]
jam catalog example <empty-dir> [--no-video]   # create the Hollowmere sample project
```

Every command takes `--root <project>` and `--json`. The actor flags declare who writes: `--actor-kind human|agent` (default `$CATALOG_ACTOR_KIND`), `--actor-name <name>` (default `$CATALOG_ACTOR_NAME`, or the Git user for a human) and `--request-id <id>` (see [Records](#records-catalog)); `doctor --fix` and `unlock` act as the local Git user when no actor is given. `run` always prints the action's result as JSON; with `--url` it runs the action on that catalog server instead of in this process (viewer actions go to this checkout's running server by default). A failure prints `error:` and `fix:` lines (one JSON object with `--json`) and exits 2 for invalid input, 1 otherwise. The first group reads and writes the project's files directly and starts in a fraction of a second; only `serve`, `capture` and `example` load the HTTP server or a browser. See [Server](#server) for `open`, `status`, `stop` and `serve`, and [Viewer sessions](#viewer-sessions) for `capture`.

```sh
jam catalog run unit.search --input '{"q":"helm","filters":{"type":["gear"]}}'
jam catalog run note.create --actor-kind agent --actor-name checker --request-id n-1 \
  --input '{"target":{"kind":"unit","id":"gear/helm","part":"model"},"body":"Visor reads thin"}'
jam catalog run review.decide --actor-kind human \
  --input '{"submission":"sub_…","item":"it_…","whole":"approved","exceptions":{"model":"changes"}}'
```

## Configuration

`catalog.config.json` at the project root is project policy and is versioned with the project:

```json
{ "version": 3,
  "plugins": [{ "plugin": "manifest", "options": { "file": "catalog.manifest.json" } },
              { "plugin": "./catalog/storybook.ts", "options": { "folder": "story" } }, "jam"],
  "review": { "resolver": "latest", "referenceRoles": [], "verdicts": ["approved", "changes", "rejected"] },
  "display": { "pixelArt": false } }
```

- `plugins`: in load order. An entry is a built-in name (`manifest`, or one the toolkit registers: `jam` for runs, `engine` for the game engine's content, described in `docs/catalog-integration.md`) or a project-relative module (`./catalog/storybook.ts`, `.ts`, `.mjs` or `.js`), or `{ "plugin": <name or path>, "options": { … } }` to give that plugin its options (it sees only its own). The built-in `media-core` plugin is always loaded first. Without a configuration file the catalog uses `["manifest"]`.
- `review.resolver`: `latest` (default), `strictest`, or a resolver a plugin registers. A resolver picks the decision that counts for a part; it never changes a decision.
- `review.referenceRoles`: roles that are supporting material. They are left out of new submissions and decisions; older evidence stays viewable and does not count in review totals.
- `review.verdicts`: the verdicts reviewers may give, from `approved`, `changes`, `rejected`.
- `display.pixelArt`: images keep hard texels in thumbnails and image viewers even when shown smaller, for every type that does not set its own `display`. Whatever the setting, a magnified image or animation shows its own pixels, in whole zoom steps when fitted: smoothing would blur detail it does not have. Thumbnails show the whole drawn picture: a transparent border around it is left out, so a sprite in a large empty cell fills its tile, and an animation's thumbnail is its first frame. Captures always keep smooth scaling.

A running catalog follows the checkout. The file is decoded when its bytes changed; plugins and project modules are imported again when theirs did (a branch switch, an edit). A one-off command reads them for every action. The server instead watches the checkout's file changes: each request first settles the watch (it writes a marker under `.catalog/.local/changes/` and waits for its event, which follows every earlier change), then re-reads only the configuration, modules, source inputs, media files and records that changed. An answer therefore reflects the files as they were when it was asked for, and an idle checkout costs a request nothing. When the system's watcher fails or stops delivering, the server checks everything for every action, as a command does. When the file or a plugin is broken, the last good settings stay in use and the failure is listed under problems; a catalog that has no good settings yet fails with the error.

### Older files: `jam catalog migrate`

The catalog reads only the current formats: configuration version 3, manifest version 2 and `.catalog/` format 2 (named by the tracked `.catalog/format.json`, `{ "format": 2 }`, which the catalog writes with its first record). An older file is named rather than half-read: a configuration of version 1 or 2, or `.catalog/` records without the marker, fail every action with `unsupported` and the fix `run: jam catalog migrate`; a version 1 manifest is listed as a problem with that recovery; a format-1 record file beside a format-2 marker (a branch merged after its migration) is listed as a record problem. [`docs/catalog-migration.md`](../../docs/catalog-migration.md) says how to run the migration, what it does and does not change, and how every older name maps to the current one.

## Plugins

A plugin is a module whose default export is a plain object. Its functions may return a value, a promise or an Effect; a failure becomes a problem scoped to that plugin, not a crash.

A project imports the contract from one stable path, `tools/jam/catalog-plugin.ts` (the toolkit root's [`catalog-plugin.ts`](../../catalog-plugin.ts)), which re-exports [`plugin.ts`](plugin.ts), the entry inside `src/`. Nothing else under `src/` is an interface. Behind it, [`contract/`](contract/) groups the exports: `context.ts` (`PluginContext`, `PluginFiles`, `PluginResult`, `ToolError`, `toolError`), `sources.ts` (`Source`, `SourceOutput`, the `*Input` types, `MergedSources`, `EnrichPatch`, `Relation`), `media.ts` (`MediaKind`, `Probe`, `ProbeFile`), `actions.ts` (`PluginAction`, `ReadActionContext`, `WriteActionContext`, `RunAction`, `Check`, `CheckContext`, `CheckProblem`, `optional`, `Text`), `review.ts` (`Actor`, `Decision`, `Resolver`) and `page.ts` (`ScopeInput`); `plugin.ts` adds `Plugin`, `definePlugin`, and the `Schema` and `Effect` modules a project plugin cannot resolve on its own. Data a plugin supplies is `*Input`; objects it implements are bare nouns; what it receives is `*Context`. `definePlugin`, `defineSource`, `defineType`, `defineMediaKind`, `defineProbe`, `defineCheck` and `defineAction` return their argument unchanged, so a type error points at the property that is wrong. A project that typechecks its plugins with TypeScript needs `"type": "module"` in its `package.json`. Browser modules have their own types, [`catalog-plugin-web.d.ts`](../../catalog-plugin-web.d.ts) beside it (see [Browser modules](#browser-modules)).

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
| `resolvers` | Resolvers selectable by `review.resolver` |
| `browserModules` | Browser modules of inspectors (in a unit's media strip), panels (sidebar sections) and collection previews |

A complete plugin with one source, a relation and a check:

```ts
// catalog/recipes.ts, listed in catalog.config.json as "./catalog/recipes.ts"
import { definePlugin } from "../tools/jam/catalog-plugin.ts"

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
                         roles: [{ key: "photo", label: "Photo", mediaKinds: ["image"], expected: true }] } },
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
      const found = await run("unit.search", { filters: { role: ["missing:photo"] }, pageSize: 200 })
      return found.units.map((unit) => ({ subject: unit.id, message: `${unit.id} has no photo` }))
    }
  }]
})
```

[`examples/plugins/storybook.ts`](../../examples/plugins/storybook.ts) uses every point and is exercised by the tests.

Every plugin function receives a context: `root` (absolute project root), `options` (the plugin's own entry) and `files` (`exists`, `readText`, `readJson`, `readBytes`, `walk`; project-relative forward-slash paths that cannot leave the project).

### Sources

`{ name, inputs(context), load(context) }`. `inputs` lists the project-relative files and folders the source reads. The source is loaded again only when one of them changed: authored data (`.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.ini`, `.csv`, `.tsv`) is compared by bytes, so an edit that keeps size and timestamp is still seen; anything else by size and modification time. `inputs` is called before each load and again after it, so the list may depend on what was loaded; the fingerprint taken after the load is the one kept, so a load that rewrites a file it reads does not look like a change. A running server asks `inputs` again only after some project file changed; a source whose `inputs` walks folders to find its files declares them as `scans(context)` (`[]` when its inputs follow from what it loaded), and is then asked only after a change under one of them or to an input. A source that fails keeps its last loaded output and is listed as a problem; that includes an `inputs` that throws or returns something other than a list of paths. A source is never silently empty.

`load` returns any of:

```ts
{ project, assetRoots: ["art"],
  types: { <key>: { label, scope?, fields, roles, thumb?, help?, reviewAttributes?, inspectors?, panels?, display? } },
  collectionKinds: { <key>: { label, preview?, memberField?, memberExtra? } },
  assets: [{ id, path, kind?, label?, tags?, category? }],
  units: [{ id, type, name?, attrs?, links: [{ role, asset, key?, label?, meta?, sheet? }], aliases?, search?, sources?, tags?, category?, explain?, inspectors? }],
  collections: [{ id, name, kind?, members: [{ unit, ...extra }], tags?, category? }],
  problems: [{ subject?, error, recovery? }] }
```

Outputs of several sources are merged in plugin order. A type or collection kind defined twice with different content keeps its first definition and is reported; a second unit with a taken id is reported and dropped.

- A **type** has `label`, `scope` (a registered scope id; the first registered one when absent), `fields` (`key`, `label`, `kind`: text, number, enum, refs or code, `unit?`, `help?`, `group?`, `derived?`, `summary?`, `filter?`), `roles` (`key`, `label`, `mediaKinds`: media kind ids, `many?`, `expected?`; a key may not be `attributes`, `item`, `capture` or `inspector`, which name other parts: such a role is dropped and reported) and `thumb` (the role used for thumbnails). Fields marked `derived` are live facts shown beside content and are left out of review evidence. Fields with `summary: false` and derived fields are left out of card summaries. A field with `filter: true` gets an `attr.<key>` facet. A list of scalar values offers one choice per distinct value. A type with `reviewAttributes: false` has no Attributes review part: its fields are provenance and reviewers judge its media. `inspectors` and `panels` mount browser modules for each unit (see [Inspectors and panels](#inspectors-and-panels)); `display: { pixelArt }` overrides the project's `display`.
- A **unit** is one catalog entry. Its identity is its `id`, never a file. `inspectors` narrows its type's inspectors to the keys it lists. A link attaches an asset in one of the type's roles. A link in a `many` role may give a stable `key` (unique within the role) so that moving the file keeps the review part's identity; without it the asset id is the key. One asset may be linked twice in a role under two keys (two animations cut from one sheet). `label` is what the unit calls the file (an animation's name in the game, "Walk"): the page and review parts show it instead of the file's name, and changing it keeps the part, which `key` identifies. `meta` carries per-link data such as a take number or word timings; it is returned with the link and is never review evidence. `sheet` makes a linked image an animation (see [Sprite sheets](#sprite-sheets)).
- An **asset** is a media file with its own identity (`id`, project `path`), shared by every unit that links it. A link that names a path with no asset entry creates one. Paths are confined to `assetRoots` after resolving symbolic links; `.git` and `.catalog` paths are never assets.
- **Collection kinds** may declare `memberField`, `memberExtra` (`{ key, format? }`: a member's own value, shown as `×N`, or as written with `format: "text"`) and a `preview`: `module`, `label`, `roles` (member roles shown, default `model`), `base` (an asset id), `config` (any object) and `represents` (`complete` or `representative`).
- Tags and categories a source supplies are project-owned and read-only in the catalog. Organization made in the catalog is stored separately and layered on top.

The built-in **manifest** plugin reads `catalog.manifest.json` (option `file`): `{ version: 2, project, assetRoots, types, collectionKinds, assets, units, unitFiles, collections }`. `unitFiles` lists folders whose `*.json` files each hold one unit or `{ "units": [...] }`. A malformed file becomes a problem naming it; the rest of the catalog stays.

### Sprite sheets

A link's `sheet` says how its image is cut into the frames of one animation; the page then plays the image instead of showing it still. Pixel values are the image's own, from its top-left corner. Two forms:

```json
{ "fps": 12, "loop": true, "grid": { "columns": 8, "rows": 2, "start": 0, "count": 16, "cell": [320, 320], "origin": [0, 0], "gap": [0, 0] }, "durations": [1, 1, 2, …] }
{ "fps": 20, "frames": [{ "region": [90, 159, 135, 132], "offset": [90, 159], "size": [320, 320], "duration": 1 }, …] }
```

- **grid**: equal cells counted along rows from the top-left one. `rows` defaults to 1, `start` to 0, `count` to the rest of the grid, `origin` and `gap` to `[0, 0]`, and `cell` to the image divided evenly into `columns` and `rows`. Several animations on one sheet are the same image linked under several keys, each with its own `start` and `count`. `durations` lists each frame's duration when not all are 1.
- **frames**: one rectangle per frame, for packed or trimmed sheets. `size` is the frame's full size and `offset` where `region` sits in it, so a frame whose empty border was cut away keeps its place; frames of different sizes are centred.
- A frame shows for `duration / fps` seconds (`duration` defaults to 1); `loop` (default true) plays again from the first frame.

A sheet that cannot be played (a missing `fps`, a grid that overflows, an unknown field) is a problem naming the unit and asset, and the image stays linked as a still. A sheet on media other than an image is refused the same way. The catalog stores the sheet with its defaults written out, so two ways of writing one layout are one sheet. `unit.get` returns it on the link with the link's review `part`, a review part carries it, and a list thumbnail of the unit carries it so the page draws the first frame.

A sheet is reviewed with its image: a frozen part keeps the sheet beside the bytes and its `digest` covers both, so new timing or frames on the same image marks the part changed since its verdict, and `evidence.compare` reports the two sides as different with each side's `sheet`. A view's before side can play too: earlier evidence keeps the sheet it was reviewed with, and a file before side takes one (`before: { path, sheet }`).


`enrich(merged, context)` runs after the sources merge, in plugin order, and returns a patch: `types` and `collectionKinds` to add or replace, `units` by id (an object replaces the fields it names, `null` removes the unit), `assets` and `collections` to add, and `problems`. The patched result is validated like any source output. Use it to categorise, retype or annotate what other plugins loaded without editing them.

### Relations

`{ name, label, inverseLabel, from(unit) }` returns the ids a unit refers to. `unit.get` returns `relations`: one entry per direction that has units, `{ name, direction: "out" | "in", label, units: [{ id, name, exists, thumb }] }`, where the `in` side is computed from every other unit's `from`. No unit stores its referrers. The page shows both directions in a unit's Related block; a relation whose units a `refs` attribute shown with the unit's details (not a derived one) already lists is not shown twice. A derived `refs` attribute whose units a relation shows there is left out of Technical details.

### Media kinds and probes

A media kind is `{ id, label, extensions, sniff(head), validate?(file), web? }`. `sniff` receives at most the first 64 bytes and returns the MIME type or null. Extensions only say which kind a file was meant to be; a file whose bytes are another kind is `invalid`. `validate` may refuse a file that sniffs correctly (it returns the reason). `web` declares the browser module that registers the kind's viewer, thumbnail and comparison in the page; [Adding a media kind](#adding-a-media-kind) shows both halves.

`media-core` registers `image` (PNG, JPEG, WebP, GIF), `video` (MP4, WebM), `model` (self-contained GLB; a GLB that refers to external buffers or images is `unsupported`) and `audio` (WAV, OGG, FLAC, MP3). WAV and WebP share the RIFF container and are told apart by its format tag.

A file's state is `ok`, `missing`, `invalid` (bytes are not the declared kind, or not media although the extension says so), `unsupported` (an unknown format, or refused by `validate`) or `forbidden` (outside the asset roots).

Opening a project reads the first 64 bytes of each media file and never a whole file. Lists identify a file by its `version`, a token made from its size and modification time: that is the `v` of its address (`/media/asset/<id>?v=<version>`), and what the page caches thumbnails by. The SHA-256 is computed when an answer depends on the exact bytes: a detail page (`unit.get`, `asset.get`, a collection's preview), freezing for a review, `evidence.compare`, and the files behind parts that have a verdict (to say whether they changed since). In list results `sha256` is therefore `null` unless it happens to be known. Sniffing results and digests are remembered while a file's size and modification time are unchanged, in memory and in `.catalog/.local/facts/media.json`, so a file is hashed once per version on a machine.

A probe is `{ name, version, mediaKinds, fields?, measure(file, context) }` and returns an object of facts for one file. Results are stored under `.catalog/.local/facts/` by probe name, version and the file's SHA-256, so a file is measured once per version of the probe on a machine; raise `version` to measure again. `unit.get` returns them per link (`links[].facts.<probe>`) and `asset.get` per asset, as `{ facts }` or `{ error }`. Like derived fields, they are shown beside content and are never review evidence.

### Checks

`{ name, label?, run(context) }` returns problems: `{ message, subject?, severity?: "problem" | "info", fix?: { label, apply?() } }`. The context adds `run(action, input)` for read actions. `doctor` runs every check and reports; it changes nothing. `doctor.fix` is the write that calls each `apply`, then runs the checks again and reports what is still wrong.

### Actions

`defineAction({ name, access: "read" | "write", description, input, output?, run(input, context) })`. `input` is a `Schema.Struct`; it is published as JSON Schema by `actions` and decodes the input before `run`. `output`, when given, is published as the action's `output` (a write's output is a `Schema.Struct` or a `Schema.Union` of them, each of which also allows `replayed: true`; a write with any other output is refused and listed as a problem) and types what `run` returns. Build optional fields with `optional(schema)` from the entry, as built-in actions do, so a client's `null` reads as "not given" (`Schema.Struct({ character: optional(Text) })`; `Text` is a non-empty string). A read's context is a `ReadActionContext`: the plugin context and `run(action, input)`, which runs reads only. A write's is a `WriteActionContext`: also its `actor` and `requestId`; nested writes keep its actor and get request ids derived from its own. A plugin action is listed, validated, attributed and repeatable by request id exactly like a built-in one. `run` is typed for built-in actions: `await run("unit.search", { q })` returns the search result without a cast.

A plugin action is named `<plugin>.<operation>` (`storybook.outline`). An action with another name still runs and is listed as a problem (`plugin storybook: action outline should be named storybook.outline`); one with a built-in action's name is refused. The catalog's own namespaces are reserved: a plugin named `asset`, `catalog`, `category`, `checkout`, `collection`, `decision`, `doctor`, `evidence`, `inbox`, `lock`, `note`, `organization`, `problems`, `project`, `review`, `schema`, `summary`, `tag`, `unit` or `viewer` has its actions refused, each with a problem.

### Scopes, resolvers and browser modules

- `scopes`: `[{ id, label, description }]`, the top-level split of units, in the order the page shows them. When no plugin registers any, the defaults are `main` ("Content") and `material` ("Source material"). A scope is a separate library, not a kind of thing: kinds of content are types (see [The model](#the-model)). The page shows only scopes that hold units (the first one when none does) and opens on the first of those; with a single scope shown the page has no split. An id is a section of the page and a segment of its addresses (`#/<scope>/u/<unit>`): lower-case letters, digits and hyphens, and none of `collections`, `assets`, `reviews`, `notes`, `organization`, `inbox`. `unit.search` takes `scope` (and `collection.search` too: collections with a member in the scope); `unit.get` reports `unit.scope`.
- `resolvers`: `{ <name>: (decisions, part) => decision }` (type `Resolver`). It receives the time-ordered `Decision`s that address one part and returns the deciding one.
- `browserModules`: `{ <name>: "<browser module>" }`, one namespace for inspector, panel and collection preview modules. A type's inspector or panel names one with `module` and the function to call with `export` (default: the default export); a collection kind names one as `preview.module`. The `schema` action lists each as `browserModules: { <name>: <url> }` (null when the declared file is missing).

#### Browser modules

A **browser module** (a media kind's `web`, or one under `browserModules`) is a `.js` or `.mjs` file declared in one of two ways: a project-relative path (`"catalog/previews/lineup.mjs"`), or a `file:` URL for a module that ships beside the plugin itself, wherever the plugin is installed: `new URL("./viewer.js", import.meta.url).href`. The server hands out exactly the declared files, by name (`/project/module/<name>`, `/project/kind/<kind id>`), versioned by their bytes; a module is one file and cannot import its neighbours. Their types are in `tools/jam/catalog-plugin-web.d.ts` (`CatalogApi`, `MediaKindDefinition`, `ViewerState`, `MountFunction`, `MountContext`, `InspectorContext`, `Controller`, `PreviewContext`, `PreviewFunction`), used from JavaScript through JSDoc (`/** @type {import('../tools/jam/catalog-plugin-web.d.ts').MountFunction} */`).

There are two contracts. **Mount modules** (inspectors and panels) are framework-free: see [Inspectors and panels](#inspectors-and-panels). **Page-integrated modules** embed the page's viewer components: a media kind's module (see [Adding a media kind](#adding-a-media-kind)) and a collection preview module, which default-exports `(ctx) => markup` and receives `ctx.html`, `ctx.members` (`[{ unit, part, role, asset }]`), `ctx.base`, the kind's `ctx.config`, `ctx.label`, `ctx.MediaViewer` and `ctx.viewers` (the viewer components the registered kinds offer, such as `ModelViewer`), and `ctx.viewerId` and `ctx.shows` to pass on to the viewer. [`examples/previews/lineup.mjs`](../../examples/previews/lineup.mjs) is one.

Both report the same viewer state, `{ kind, status: "loading" | "ready" | "error", error, shows, controls, … }`, where `shows` is the identity of what is shown (unit, part, digest), as `viewer.capture` returns it. A `control(command)` returns any value other than `false` when it handled the command, `false` when the command is not one of its controls, and throws an `Error` when the command is wrong: the agent receives the error's `code` if it has one, else `invalid`. A returned `{ error, code }` is a result like any other. The control names `session`, `select` and `inspector` are the page's own.

## Records (`.catalog/`)

| Path | Record | Mutability |
| --- | --- | --- |
| `notes/<id>.json` | Standalone note: target (unit, collection, asset, or submission item/part), text, author, `resolved` (who dealt with it, when, and why) | Edited with expected revision |
| `format.json` | The layout of `.catalog/`: `{ "format": 2 }` | Written with the first record |
| `organization/<kind>/<key>.json` | Category and tags of one unit, asset or project-owned collection | Edited with expected revision |
| `collections/<key>.json` | Catalog-owned collection: name, kind, category, tags, ordered member references | Edited with expected revision |
| `categories.json` | Registered category paths | Edited with expected revision |
| `reviews/<sub>/submission.json` | Submission: items, frozen parts with evidence, views (captions, cameras, optional before side), `ask`, `brief`, `changes`, `limits`, `checkout` | Immutable |
| `reviews/<sub>/decisions/<id>.json` | One decision: `covers`, verdicts, comment, optional `partComments` per decided part, optional `relay`, author, time; once edited also `revision`, `editedAt`, `editedBy` | Edited in place or deleted (`review.decision.edit`, `review.decision.delete`) |
| `evidence/<aa>/<sha256>.<ext>` | Content-addressed frozen bytes (dirty or untracked files, definitions) | Immutable |
| `.local/` (Git-ignored) | Locks, request journal, measured facts, captures, the server's record and log | Machine-local |

- Identities are random and time-ordered (`nt_`, `sub_`, `it_`, `vw_`, `dc_`), so records made on different branches merge without collisions. A short reference (`R5DAZA`) is the last six characters.
- Every record kind has a schema ([`records/schemas.ts`](records/schemas.ts)). A file that is not valid, is in a Git merge conflict, or whose identity does not match its path is listed as a problem and excluded; every other record is used. Records that are valid alone but cannot be used beside the others are listed too: a decision whose submission does not exist or does not have its item (after a merge with a `review.remove`, or a hand edit) decides nothing, and a catalog-owned collection whose id the project's sources also define is hidden by the project-owned one.
- Every operation validates its whole input and every record it would produce before any file changes. Operations over several records (bulk tagging, category and tag renames) are validated as one unit, every new file is written beside its target, and only then are the targets replaced; a failure leaves no partial edit. Mutable records carry `revision`; a stale `expectedRevision` fails with `conflict` and the current record is returned in `details.current` so the caller can merge.
- Writers take a short lock under `.local/locks`: one writer per lock in a process and, through the lock file, on the machine. A write reads the records after it holds its lock. A lock left by a crashed process is never removed automatically; `unlock` removes it only after verifying that its process has exited on this machine.
- A write may carry a `requestId`. The replay check and the write run under one lock, so simultaneous retries record once and a repeat returns the first result with `replayed: true`. Reusing the id with another action, input or actor, or in another branch or worktree, fails with `conflict`. Created records and decisions keep this binding (`requestBinding: { action, digest, checkout }`), so a lost local journal cannot replay another checkout's work.
- Paths under `.catalog` (records, evidence, locks, journal, caches) are read and written without following symbolic links.
- A write may carry the `checkoutKey` it was prepared in (`checkout.key` from the `summary` action). After a branch switch it fails with `checkout_changed` (`details.checkout`).

Record scans are incremental: each action lists the record folders once (a server, only after something under `.catalog/` changed) and reads only the files whose size or modification time changed.

## Reviews

- A **submission** freezes its items when created. A unit item has one part per linked asset (the role key for a single role, `role:key` for a `many` role, the key defaulting to the asset id) plus `attributes`. A collection item has `member:<unit>` per member, and `preview` when its kind declares one. A submission may select parts; only the selected parts' dependencies are frozen: a member part freezes that member; a preview part freezes its member inputs, base, module name, config and roles. Views are captioned and may carry a camera and viewer state (`mode`, `animation { clip | frame, time, playing }`, `isolate`, `texture`); several views can show one part. A submission's `ask` is one line of text; its `brief`, `changes` and `limits` are Markdown that apply to every item and open the review as its overview when it has several items. An item's `text` is Markdown about that item alone.
- A **capture** is an image or clip file made to show something, labelled by its `renderer`. A submission item attaches captures as evidence: an engine screenshot, a clip, a file as it was at a commit, or a catalog capture (`viewer.capture`, `jam catalog capture`). An item's `captures` are each `{ label, caption?, renderer?, file }` or `{ label, caption?, renderer?, before, after, labels? }`, where a file is a checkout path (anything but `.git`, `.catalog/.local/captures` included) or `{ revision, path }` (frozen as that commit's Git blob). The bytes must be a registered media kind. Each capture is its own part `capture:<n>` with a default view; `renderer` is shown as a badge. Captures belong to their item, never to content: a unit's parts, "changed since its verdict" and "compare with current" ignore them. A unit or collection item may submit captures only (`parts: []`).
- **Parts and views.** A part is decided; a view shows. An item's parts are the content parts it selects plus `decide` entries (`item:<id>`); with neither, it is decided as one part, `item`, named after the item. A capture (`capture:<n>`) is evidence for views and names the part it `shows` (null: the whole item); it is never decided. Captures recorded before `shows` existed have no such key and stay decided parts, so their decisions still read. `review.get` gives each view its `shows`, and a note may name a `view` of a submission item.
- **Work** is an item without `target`: work that is not catalog content (lighting, tooling, a proposal). It needs a `title` and `captures`, `text`, or both. Any item's `text` (at most 4000 characters) is shown above its evidence.
- **Before/after views.** A view may carry `before`: `{ "path": "<project file under the asset roots>", "sheet"? }` (`sheet` when the file is an animation; [Sprite sheets](#sprite-sheets)) or earlier frozen evidence `{ "submission", "item", "part", "leaf"? }`, with an optional `label` (default "Before") and the view's `afterLabel` (default "After"). Both sides must be the same kind of media; a preview or attributes view has no single media to compare. The before side is frozen like part evidence and is not a reviewable part.
- A preview needs every declared input: member assets in its roles and its base. A frozen preview records the SHA-256 of the project module it was submitted with; its evidence digest includes the module's identity, so a module change marks the verdict changed, and the frozen preview is offered for rendering only at the submitted revision.
- **Evidence** records the SHA-256 of every byte stream. A file committed and unchanged at HEAD is referenced as its Git blob (Git LFS objects are read from the local LFS store). Anything dirty or untracked is copied into `.catalog/evidence`. Every read verifies the digest; a missing Git object, missing LFS data or changed bytes are reported as `missing` or `corrupt`, and current content is never substituted.
- A **decision** covers (`covers.kind`) the `whole` item (every reviewable frozen part: one verdict plus explicit exceptions, so "approve except the boots" is one record) or the named `parts`. `comment` covers the whole decision; `partComments` (`{ "<part>": "text" }`) attach a comment to parts it decides, and a comment on a part without a verdict in that decision is refused. An agent recording a verdict a person gave outside the catalog adds `relay` (`{ by, channel, words }`: who decided, where, and their words verbatim) on `review.decide` or `review.decideCurrent`; only an agent may relay. Feedback without a verdict is a note on the submission, item or part.
- **Projection.** A unit's or collection's current status per part comes from the configured resolver over every decision whose item targets it. Order is recorded UTC time, then decision id. Verdicts never cascade between a collection and its members, or between units sharing an asset. Parts that appear later stay undecided. A part is `changed` when current content differs from the frozen evidence of the item whose decision decides it (per the resolver), across every submission targeting the unit or collection. A newer submission does not reset it until it is decided; meanwhile it is listed under waiting reviews. Nothing is reset or created automatically.
- `review.decideCurrent` validates the decision first, then records it on a waiting item whose frozen evidence equals current content, or submits current content and records it there. Revising a decided item uses `review.decide`.
- `review.decision.edit` replaces what a recorded decision says (verdicts, comment, part comments) and keeps its id, author and place in the order, so a later decision still wins the parts it covers; `review.decision.delete` removes it and its parts fall back to the decisions that remain. Both take the decision's `revision` as `expectedRevision`. A person may change any decision; an agent only one it recorded itself. A run that already took a verdict into its record keeps what it took.
- **Retention.** Nothing is removed automatically. `review.remove` (`submissions`, `reason`, `dryRun`) retires whole submissions under the reviews lock: each goes with its decisions and the notes on it, and frozen evidence in `.catalog/evidence` is deleted only when no remaining record uses it. It refuses while a submission that stays depends on one being removed (`supersedes`, or a view's `before` side). A dry run lists exactly what would go with a `plan` fingerprint of it; passing that as `expectedPlan` makes removal refuse, under the same lock, when anything it covers changed since (a new decision, a note, an edit), so what was archived is what goes. A removal returns the full records it deleted. Archiving is the project's policy, written as a plugin action: dry run, `review.get`, write the archive, then `review.remove` with `expectedPlan`.

## Actions

Every operation is an action: a name, its `access` (`read` or `write`), what it `requires` besides its input (`actor` for a write; `server` for a viewer action, which runs in a catalog server), a description, an input schema and an output schema. The CLI, HTTP and the browser use the same registry, so a person and an agent get the same validation and the same result. An input is checked against its schema at every level; an unknown field is refused, and an action that takes no input accepts only `{}`. The one input with open keys is `viewer.control`: a key it does not declare is handed to the showing viewer as a control (a plugin kind's own), and a viewer without that control refuses it with `unsupported`. Optional fields accept `null` as "not given".

`jam catalog actions --json` (and `GET /api/actions`) lists each action as `{ name, access, requires, description, input, output, plugin? }`, with `input` and `output` as JSON Schema (draft 2020-12). The output is what a caller receives: a write's result may add `replayed: true` (a repeated request id), and a result that names a page adds a `url` beside each `route` or one `hint` (see Links below). Records inside a result (a note, a collection, removed records) keep any fields a newer toolkit added, as records are read. A plugin action publishes the `output` it declares, if any. With `CatalogOutputCheck` on (the tests turn it on), every result is decoded against its output with unknown fields refused, and a mismatch fails `internal`.

Names follow one rule. An action on one entity is `<entity>.<operation>` with a singular entity (`unit`, `asset`, `collection`, `note`, `review`, `evidence`, `organization`, `category`, `tag`, `lock`, `viewer`) and a lower-camelCase verb, or a noun for a read that returns it (`collection.membership`). A project-wide read about no single entity is one word (`summary`, `schema`, `checkout`, `problems`, `inbox`, `doctor`) and its write is `<read>.<verb>` (`doctor.fix`). `get` returns one entity in full; `list` pages records by structured filters; `search` ranks by text with facets. `delete` removes a record the actor owns; `remove` takes away something that is not a plain record (a stale lock, retired submissions). Every paged list or search answers `{ <entities>, total, page, pages, pageSize, … }` with the plural entity name: `units`, `collections`, `assets`, `notes`, `submissions`.

Calling a name from before this rule fails `not_found` with a fix naming its replacement; [`docs/catalog-migration.md`](../../docs/catalog-migration.md) lists them all.

| Action | Access | Purpose |
| --- | --- | --- |
| `summary` | read | Project, checkout, counts, problem count, `version`. For polling: runs no `git status`, returns no schema |
| `schema` | read | Types, collection kinds, scopes, media kinds, relations, probes, browser modules, unit scopes; changes only when `version` does |
| `checkout` | read | The checkout with its count of uncommitted changes outside `.catalog` |
| `problems` | read | Configuration and plugin failures, source problems, malformed or conflicted records |
| `inbox` | read | Reviews with undecided parts, open notes, parts changed since their verdict, problems |
| `doctor` | read | Checks and what each one found; changes nothing |
| `doctor.fix` | write | Apply the repairs that checks declare, then check again |
| `unit.search`, `collection.search`, `asset.search` | read | Ranked search with facet counts and bounded pages: `{ units | collections | assets, total, page, pages, pageSize, all, q, filters, facets, ids }`, plus `scope` for units and collections. `ids` lists every match; input `ids: false` leaves it empty |
| `unit.get`, `collection.get`, `asset.get` | read | One unit, collection or asset in full |
| `organization.list` | read | Categories and tags with usage counts |
| `note.list`, `review.list`, `review.get` | read | Notes (`notes`); submissions (`submissions`); one submission with evidence status |
| `evidence.compare` | read | Frozen evidence against current content or another frozen part; each side resolves on its own |
| `collection.membership`, `lock.list` | read | Catalog collections containing given units; record locks |
| `note.create`, `note.edit`, `note.resolve`, `note.reopen`, `note.delete` | write | Notes |
| `organization.set`, `organization.setMany`, `category.create`, `category.rename`, `category.delete`, `tag.rename`, `tag.delete` | write | Organization |
| `collection.create`, `collection.update`, `collection.delete` | write | Catalog-owned collections |
| `review.submit`, `review.decide`, `review.decideCurrent`, `review.decision.edit`, `review.decision.delete`, `review.remove` | write | Reviews |
| `lock.remove` | write | Remove a stale lock |
| `viewer.open`, `viewer.state`, `viewer.control`, `viewer.capture`, `viewer.close` | read, requires `server` | Drive the page's viewers in a server's headless browser ([Viewer sessions](#viewer-sessions)) |

- Writes must declare their actor: `{ name, kind: "human" | "agent" }`. Attribution is a declaration, not proof of identity; an agent declares `agent`.
- Errors carry a code: `invalid`, `not_found`, `conflict`, `checkout_changed`, `locked`, `unsupported`, `malformed`, `forbidden`, `unavailable`, `internal` (a fault in the catalog or a plugin, not in the input).
- A named part, item, view, member or version that does not exist is an error, never a substitute.
- **Links.** A result that creates or names a review or a page carries its `route` (`#/reviews/s/<submission>`, `#/<scope>/u/<unit>`, `#/collections/c/<id>`, `#/assets/a/<asset>`): `review.submit`, `review.get`, `review.decide`, `review.decideCurrent`, every entry of `review.list` and `inbox`, each note's target, and the three detail reads. While a server is running for the checkout (`jam catalog open`), each `route` has a `url` beside it that a person can click; otherwise the result has one `hint` saying how to get one.
- `doctor` built-in checks: catalog problems; media files that are Git LFS pointers (fix: `git lfs checkout`, then `git lfs pull`); linked media that cannot be shown; media files under the asset roots that no unit links (information; hidden folders and Git-ignored files are left out); reviews waiting for a verdict (information).

### Using the engine from code

[`Catalog.ts`](Catalog.ts) is the facade. `Catalog.layer` provides `Catalog` and `CatalogDiagnostics` for one project and needs the kernel's `ProjectFiles`, `Git` and `Ids`; it is a value, so keep it: a layer is one catalog, and building it twice builds two. `Catalog.layerWith({ plugins, defaults, overrides })` also registers plugins by name (how the toolkit adds `jam` and `engine`), sets `defaults` (the plugins of a project without `catalog.config.json`, in place of `["manifest"]`) and applies command-line overrides. `CatalogSetup` (what `layerWith` provides) and `Catalog.layerNoDeps` are toolkit-internal.

```ts
const program = Effect.gen(function*() {
  const catalog = yield* Catalog
  const found = yield* catalog.run("unit.search", { q: "helm" })   // typed: found.units[0].name
  yield* catalog.run("note.create", { target: { kind: "unit", id: "gear/helm" }, body: "Check the visor" }, { actor: { name: "checker", kind: "agent" }, requestId: "n-1" })
})
```

`run` is typed for every built-in and viewer action by [`actionMap.ts`](actionMap.ts) (its input as sent and its result); any other name (a plugin's action) runs untyped. The service also gives `discover` (actions with their input and output JSON Schema), `checkout`, `defaultActor` (the local Git user, as a human), `config`, media access for serving (`assetFile`, `evidenceMedia`, `beforeMedia`, `browserModule(name)`, `kindModule`), `server` (the running server of this checkout, when there is one), `writeLocal` for machine-local files and `follow` (watch the checkout for as long as a scope is open; the server does). `CatalogDiagnostics.stats` counts work done (projections, record scans, source loads, input checks, files hashed, probes measured); the performance tests read it.

An action reads the project through one projection: the snapshot of the sources, the records and the review policy at one moment, built once per action and passed to every query, so all rows and facets of an answer agree. A write takes its lock first and builds the projection under it. Requests that arrive together (a page fetching its thumbnails) share one check of the sources that began after they arrived, so a burst costs at most two checks.

## Server

```sh
jam catalog open      # http://127.0.0.1:4600/
```

`open` prints the address of this checkout's catalog and nothing else on standard output. When no server is running for the checkout it starts one as a process of its own, which keeps running after the command, the terminal or the agent session that started it has ended; when one is running it is reused. An agent hands a person the catalog this way, and gets the same address back every time it asks.

- The server's record is `.catalog/.local/server.json`: `pid`, `host`, `port`, `url`, `checkout` (the worktree it serves; it follows branch switches), `toolkit` (the version that started it), `allowOrigins`, `startedBy` and `startedAt`. Its output goes to `.catalog/.local/server.log`. Both are machine-local and ignored by Git.
- A server is reused only after it has answered at the recorded address as that process, serving this folder. A record whose process has exited, or whose process id now belongs to something else, is discarded and a new server is started; the process it named is never touched. A server `open` started is stopped and replaced when it was started by another toolkit version or admits other origins than `open` asked for. A server started with `jam catalog serve` (by a person, or by a service manager that keeps it running) belongs to whoever started it: `open` reuses it whatever other origins it admits, says which, and never stops it; when it runs another toolkit version or lacks an origin `open` asks for, `open` fails and names it, to be restarted where it was started. The record's `startedBy` says which (`open` or `serve`).
- `--allow-origin <origin>` (repeatable) admits one more exact origin (`https://box.example.ts.net:8443`) and its host: a private HTTPS proxy in front of the loopback server, so a person can review from a phone. Scheme, host and port must match; nothing else is admitted.
- Ports are taken from 4600 up: a second checkout's server gets the next free one.
- `status` says whether it is running and where; `stop` ends it and removes the record. `serve` runs the same server in the foreground (`--port <n>` for a fixed port, `0` for any free one) and closes it in order on Ctrl+C or a stop signal: viewer sessions and the browser first, then the listener, then the record. On Windows a detached server is ended without that sequence, and the next `open` cleans up after it.

| Route | Answer |
| --- | --- |
| `GET /` | The page (plain ES modules, no build step) |
| `GET /api/actions` | Every action, viewer actions included, with input and output schemas |
| `POST /api/run/<action>` | Run an action: body `{ input, actor?, requestId?, checkoutKey? }`, headers `Content-Type: application/json` and `X-Catalog-Request: 1` |
| `GET /api/health` | `{ ok, pid, toolkit, root }`: which server this is |
| `GET /media/asset/<id>?v=<version>` | An asset's current bytes |
| `GET /media/evidence/<submission>/<item>/<part>?leaf=` | Frozen evidence, verified against its digest |
| `GET /media/before/<submission>/<item>/<view>` | A view's frozen before side |
| `GET /project/module/<name>`, `GET /project/kind/<kind>` | A declared browser module, by its name under `browserModules` or by media kind; `?v=` pins a revision (409 when it is not the current one) |
| `GET /vendor/…` | The page's browser packages |

A failed action answers with its error as JSON (`{ error: { code, message, fix?, details } }`) and the status of its code: 400 `invalid`, 403 `forbidden`, 404 `not_found`, 409 `conflict` and `checkout_changed`, 422 `malformed` and `unsupported`, 423 `locked`, 500 `internal`, 503 `unavailable`. A request refused before any action runs gets the same error body with code `invalid`: 405 for a method its route does not take (`/api/run/…` takes POST, every other route GET), 415 for a run whose `Content-Type` is not `application/json`. Media answers honour `Range` requests. A run that sends `X-Catalog-Client: web` and no actor acts as the local Git user, as the page does for its person; every other client declares its actor in the body.

The server is `src/catalog/server/`: `http.ts` is the only module that touches `effect/http` and the Node platform (a small request and response model, and a listener that lives as long as its scope); `app.ts` holds the routes, `security.ts` the rules below, `Server.ts` the `CatalogServer` layer, `Renderer.ts` the viewer sessions, `control.ts` what `open`, `status` and `stop` do.

## The page

The page (`catalog/web/`) lists units by scope, collections and assets; shows one unit with its media (the strip grouped by role; the sidebar lists animations apart from other files, each with a still thumbnail), attributes, relations, notes and memberships; runs reviews (items, parts, views, before/after, decisions with part comments); and has a "Needs attention" view (the `inbox` action) reachable from the top bar. It polls the small `summary` action and fetches `schema` again only when `version` changed. It knows nothing about a particular project: scopes, types, labels and media kinds all come from the schema.

### Adding a media kind

A media kind has two halves, both declared by one plugin. [`examples/plugins/text-kind.ts`](../../examples/plugins/text-kind.ts) with [`text-kind.web.js`](../../examples/plugins/text-kind.web.js) adds plain text as a fifth kind and is exercised by the tests.

The engine half says how a file of the kind is recognised and where its browser module is:

```ts
import { defineMediaKind, definePlugin } from "../tools/jam/catalog-plugin.ts"

export default definePlugin({
  name: "text-kind",
  mediaKinds: [defineMediaKind({
    id: "text", label: "Text", extensions: ["txt", "md"],
    sniff: (head) => (head.length > 0 && head.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32) ? "text/plain; charset=utf-8" : null),
    web: new URL("./text-kind.web.js", import.meta.url).href
  })]
})
```

The browser half registers how it is shown. The module default-exports a function that receives the page's API:

```js
/** @param {import('../tools/jam/catalog-plugin-web.d.ts').CatalogApi} catalog */
export default function (catalog) {
  const { html, hooks: { useEffect, useState }, registerMediaKind, useViewer, Msg } = catalog
  function TextViewer({ media, viewerId, shows, onStatus }) {
    const [text, setText] = useState(null)
    useEffect(() => { fetch(media.url).then((r) => r.text()).then(setText) }, [media.url])
    const status = text == null ? "loading" : "ready"
    useEffect(() => { onStatus?.(status) }, [status])
    useViewer(viewerId, () => ({ kind: "text", status, error: null, shows, controls: [] }), () => false)
    return html`<div class="viewer"><${Msg} status=${status} /><pre>${text}</pre></div>`
  }
  registerMediaKind("text", { viewer: TextViewer, thumbnail: () => html`<span>Aa</span>`, capture: { renderer: "catalog text viewer" } })
}
```

`registerMediaKind(id, definition)` is the one call that makes a kind known to the page. The four built-in kinds make it too (`catalog/web/kinds/*.js`); nothing else in the page names a kind.

| Field | What it is |
| --- | --- |
| `viewer` | Required. A component receiving `media` (`{ kind, url, id?, path?, sha256?, version? }`), `viewerId`, `shows`, `label`, `onStatus`, `context` (`{ unit, type, link }` on a unit's page) and, for kinds that use them, `initialCamera`, `initialState`, `keepCamera` |
| `controls` | The control names its viewer's state lists. `registerMediaKind` throws when one is `session`, `select` or `inspector` |
| `thumbnail` | A component receiving `asset` and `size`, drawn inside the square thumbnail. Without one the kind's icon is shown |
| `compare` | A component receiving both sides `a` and `b` (`{ status, url, kind, sha256, path, error }`), `labels`, `mark(side)(status)`, `control`, `camera`, `state`, `apiRef`. Without one the viewer is shown twice, side by side |
| `compareTogether` | True when both sides are one viewer (two takes on one transport): both must be available, and the component answers for the comparison's state and controls through `apiRef.current = { getState, control }` |
| `capture` | `{ renderer, blocked? }`: how a capture of this kind describes itself (a string, or `(state) => string`), and an optional `(state) => reason` that refuses one |
| `icon` | SVG path data for a 20×20 glyph |
| `reuse`, `framing` | `reuse`: keep one viewer instance when the media changes (a model keeps its camera). `framing`: the viewer has a camera a submitter can save with a view; its state then reports `camera` and `view` |
| `components` | Named viewer components offered to preview modules as `ctx.viewers` |

A viewer reports itself with `useViewer(viewerId, getState, control)`. The state carries `kind`, `status` (`loading`, `ready` or `error`), `error`, `shows` and `controls` (the names of the controls it accepts), plus whatever the kind wants an agent to see. `control(command)` follows the rule in [Browser modules](#browser-modules): a result, `false`, or a thrown `Error`. The same state is what a person's page and an agent's viewer session read, and a capture is taken only while `status` is `ready`.

The API object also gives `html` (htm bound to Preact), `hooks` (`useState`, `useEffect`, `useLayoutEffect`, `useRef`, `useCallback`), `registerPreview(name, render)`, `MediaViewer` (shows any registered kind), `UnavailableViewer`, `Msg` (the loading and error overlay) and `Icon`.

### Inspectors and panels

A type's `inspectors` are shown in each unit's media strip, selected like a part as `inspector:<key>`; the one with `default: true` opens before the unit's media. Its `panels` are sections of the unit's sidebar. Each is `{ key, label, module, export?, help? }` and names a module its plugin declares under `browserModules`; [`examples/plugins/storybook.web.js`](../../examples/plugins/storybook.web.js) has one of each. `unit.get` returns them (`inspectors`, `panels`) with `url` (or `error`, when the module is not declared or its file is missing).

An export is framework-free (`MountFunction` in `catalog-plugin-web.d.ts`): `mount(host, ctx)` fills `host` and returns a `Controller`, `{ dispose(), state?(), control?(command) }`, or a promise of one. `ctx` has `unit` (`{ id, name, type, attrs }`), `key`, `call(action, input, requestId?)` (with a request id it is a write by the page's person), `assetUrl(id)`, and for an inspector `state` and `setState(object)` (kept in the page address as `vs`, so a link reopens the inspector as it was) and `markStage(element)` (what a capture photographs; default the whole inspector). An inspector's `state()` reports `status` (`loading`, `ready` or `error`), `error`, `renderer` and anything else an agent should see (the viewer state has `kind: "inspector"` and `inspector: <key>`; a capture's default renderer is `catalog inspector <key>`); `control(command)` answers `viewer.control { inspector: command }` by the rule in [Browser modules](#browser-modules): a result, `false` when the inspector has no such control, or a thrown `Error` for a wrong command.

### Audio

Audio roles declare `mediaKinds: ["audio"]`; `many: true` gives each take its own stable review part. Supported bytes are WAV (`RIFF` and `WAVE`), OGG (`OggS`), FLAC (`fLaC`) and MP3 (ID3 or an MPEG frame header), served as `audio/wav`, `audio/ogg`, `audio/flac` and `audio/mpeg`.

- The viewer decodes the exact bytes with Web Audio (checked against the SHA-256 where it is known), draws each channel's waveform, and provides play and pause, scrubbing, looping and a playhead. It starts paused. Its state has `shows.sha256`, `duration`, `channels`, `sampleRate` (the decoded playback rate), `playing`, `currentTime` and `loop`. A file the browser cannot decode is an explicit error; another take is never substituted.
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

- `viewer.open` takes a `target` (`{ kind: "unit" | "collection" | "asset" | "submission", id, item?, member?, part?, view?, compare? }`, where `part` may be `inspector:<key>`, `view` is a submission view and `compare` is `{ a: { submission, item, part }, b?: "current" | { submission, item, part } }` as `evidence.compare` takes it), an optional page `size` and a `session` name (several sessions can be open). It answers with the page's state: the selection, and the viewer's `kind`, `status`, `shows` (the exact asset digest or submission view shown) and `controls`.
- `viewer.control` applies controls to the showing viewer (`camera`, `mode`, `animation`, `isolate`, `texture`, `zoom`, `audio`, `video`, `sprite`, `compare`, `inspector` for the inspector showing, or a plugin kind's own) or selects another part, view or comparison of the open page (`select: { part?, view?, compare? }`). A control the viewer does not have fails with `unsupported`; a command the viewer refuses fails with the code it threw (`invalid` by default).
- An image shown as an animation reports `sheet` (`frames`, `frameSize`, `fps`, `duration`), `animation` (`frame`, `time`, `playing`, `speed`, `loop`) and `sprite` (`show`, `onion`, `crop`: the box around what any frame draws, which the view is framed to). It takes `animation: { frame | time, playing?, speed? }` (`speed` one of 0.25, 0.5, 1, 2), `sprite: { show: "animation" | "sheet", onion, whole }` (`sheet` shows the whole image with each frame's rectangle; `onion` draws the previous frame faintly; `whole` frames the full cell instead of what is drawn in it) and `zoom`. It plays on opening unless the person prefers reduced motion; `jam catalog capture --frame <n>` shows frame `n` paused. A review view's state may start it on a frame (`state: { animation: { frame } }`). A comparison where either side has a sheet plays both on one clock, side by side, one over the other, or toggled.
- `viewer.capture` saves the viewer as a PNG under `.catalog/.local/captures` and returns its path, digest, size, what it shows (`shows`; for a capture pair, both digests) and `renderer`, which says it is a catalog render (or names an inspector's own renderer), not a screenshot of the running project. It refuses unless the viewer is ready and shows exactly the requested selection and bytes. `jam catalog capture --url <server> --out <file>` copies the file from that server's checkout.
- A part, item, view, member or version named explicitly and not found is an error, never a substitute. Naming none opens the first.
- The browser is Playwright's Chromium, or an installed Google Chrome (`CATALOG_BROWSER_CHANNEL` picks a channel). It starts with the first `viewer.open`; when none can start, the error says to run `npx playwright install chromium` in the toolkit folder. Nothing else needs a browser.

## Security

Plugins are trusted project code; what they load is data and is validated. Media is read only from the declared asset roots, judged after symbolic links are resolved, and `.git` and `.catalog` are never assets. Media types come from bytes, not extensions. Evidence is read only through complete references (a store path named by its digest, or a Git commit, blob and path) and every read verifies the SHA-256. Nothing under `.catalog` is reached through a symbolic link, for reading or writing: records, evidence, locks, the request journal and caches. Records are type-checked at every level before use. Note, brief, comment and organization text is data; the engine never interprets it.

The server adds:

- **Loopback only.** It listens on 127.0.0.1.
- **Host and Origin.** A request whose `Host` is not the server's own address (`127.0.0.1`, `localhost` or `[::1]` with its port) is refused, and so is one whose `Origin` is anything else: a hostile DNS name pointing at 127.0.0.1 and a page on another site get nothing. An origin given with `--allow-origin` is admitted exactly, with its host.
- **Running an action** needs `X-Catalog-Request: 1` and `Content-Type: application/json`, which a cross-site form cannot send. The body is at most 1 MiB and is checked field by field.
- **Files.** The page's own files come from one folder, its browser packages from seven named package folders (scripts only), media from the asset roots; each path is judged as written and again after symbolic links are resolved. Evidence is addressed by submission, item and part, never by path. Browser modules of the project are addressed by declared name only. The configuration, `.git`, `.catalog` and machine-local state are not served. Every file route is read-only.
- **Responses.** Media carries its sniffed type, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, so a file opened on its own can run nothing. Scripts carry `default-src 'none'`. The page allows scripts and styles from the server only (its import map by hash) and the compiling of WebAssembly (`'wasm-unsafe-eval'`, for the model viewer's mesh decoder; JavaScript is never evaluated), no framing and no form posts.
- **Text.** A submission's brief, changes and limits, and an item's text, are Markdown, rendered and then sanitised by DOMPurify to formatting tags and `href`/`title` (no raw HTML, images, styles, handlers or `javascript:` links); links leaving the catalog open in a new tab without a referrer. Every note, comment, tag and category is shown as text.

## Tests

```sh
node --test --test-concurrency=1 "test/catalog/*.test.ts"
node test/catalog/screens.ts <sample-project> [out-dir]     # desktop and narrow screenshots of every view
```

The tests are black-box through the facade, the CLI, HTTP and the page, against real temporary Git repositories, worktrees and Git LFS. They cover the checkout, notes and records, reviews and evidence, search, configuration, the formats and `jam catalog migrate`, every plugin point (through `examples/plugins/storybook.ts` and `text-kind.ts`), `inbox`, `doctor`, the server's routes and security rules, the `open`/`status`/`stop` lifecycle with real detached processes, and the performance rules, which are asserted as counts of work (programs run, sources loaded, record files read, files hashed), not timings.

The `browser-*.test.ts` files drive the real page in Chromium (`npx playwright install chromium` once); they skip, saying why, only when no browser can be launched. They write screenshots to `test-output/browser/` (ignored by Git).

`jam catalog example <empty-dir>` creates "Hollowmere", a sample project for trying the catalog or for acceptance testing: a Git repository of its own with procedural art, two art passes, reviews and notes made through the public actions, and some uncommitted work. It needs a browser to render its art; ffmpeg adds video clips.
