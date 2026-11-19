# Catalog migration: format 1 to format 2

For a project whose catalog files, plugins or scripts were made with a toolkit before catalog format 2. `jam` below is `node tools/jam/jam.mjs`; paths in the plugin tables are relative to a project plugin under `jam/catalog/`.

## What changed, and why

The catalog's API now uses one word for each thing on every surface: actions follow one naming rule, a type's views are **inspectors**, a reviewer's verdict record is a **decision**, the worktree the catalog reads is the **checkout**, a submission's message is its **brief**. Nothing old is accepted, so a caller never has to guess which of two names applies. Instead an old file is recognised and named, with the fix `run: jam catalog migrate`: old records (`.catalog/ was written by an older toolkit (format 1)`) or an old `catalog.config.json` fail every action `unsupported`, and an old manifest is listed under `problems`.

`jam catalog migrate` moves the files. Project code (plugins, browser modules, scripts that call actions) is moved by hand with the tables below.

## Running the migration

1. **Ask the person** who owns the project before migrating: it rewrites tracked files. An agent runs it only once they agree.
2. **Commit or stash** `.catalog/`, `catalog.config.json`, the manifest and its `unitFiles` folders. The migration refuses (`conflict`, exit 1) while `git status` lists a change, untracked included, to any file it would rewrite, move or delete, naming those files, and refuses outside a Git checkout. `--force` skips that check; use it only when the person has said so.
3. **Preview:** `jam catalog migrate --dry-run` writes nothing and prints one line per change (`rewrite`, `move`, `create` or `delete`, with the reason) and one per warning. `--json` prints `{ format: { from, to }, changes: [{ file, action, to?, why }], warnings, dryRun }`.
4. **Migrate:** `jam catalog migrate`. It plans every file and validates every result against the current schemas before the first write; a file it cannot read (a symbolic link included), or whose result would be invalid or would still hold an old key, refuses the whole migration (`malformed`, exit 1, nothing written), also with `--dry-run`, and the report in the error's `details` names it. Writing is all or nothing: files are written beside their targets and then moved into place, and if one step fails every earlier step is undone and the error names the file that failed.
5. **Act on each warning** with the tables below: a warning names something the migration does not rewrite.
6. **Check:** `jam catalog run problems` lists nothing that names an older toolkit, a retired field or `jam catalog migrate`, and a second `jam catalog migrate` says `Nothing to migrate`.

Done when both checks in step 6 hold and the person has the list of rewritten files to commit.

**What it touches:** every record under `.catalog/` (see [Record files](#record-files)), `catalog.config.json`, the manifest the configuration names (option `file` of the `manifest` plugin, default `catalog.manifest.json`) and every `*.json` file in the manifest's `unitFiles` folders. It adds `.catalog/format.json` and deletes the machine-local request journal `.catalog/.local/requests/`, so a request id recorded before the migration cannot be replayed after it (reusing one fails `conflict`). It touches nothing else.

**What it cannot do**, each by hand:

- project plugin modules and version 1 adapter modules (warned per module): [Plugin modules](#plugin-modules);
- browser modules: [Browser modules](#browser-modules);
- `previewModules` and `review.resolverModule` of a version 1 configuration, which it drops with a warning: declare the modules under a plugin's `browserModules` and register the resolver under a plugin's `resolvers`;
- option sets of a version 2 configuration that belong to no listed plugin, and keys version 3 does not have, which it drops with a warning;
- scripts, saved links and anything else that names an old action, field or route.

A branch merged after its migration may bring format-1 files back beside `.catalog/format.json`; they are listed as record problems with the same fix, and a new `jam catalog migrate` migrates them file by file. A record present at both paths is dropped from its old path when the two are identical, and the migration refuses, naming it, when they differ.

## CLI commands

| Before | Now |
| --- | --- |
| `jam catalog todo` | `jam catalog inbox` (same list; runs the `inbox` action) |
| `jam catalog unlock <lock>` | unchanged; it runs `lock.remove` |
| `jam catalog actions --json`: `kind: "read" | "write" | "viewer"` per action | `access: "read" | "write"`, `requires: ["actor"]` for writes and `["server"]` for viewer actions, and an `output` JSON Schema |

## Action names

Calling an old name fails `not_found` with a fix naming the new one (`context is now summary`).

| Before | Now | Result under the new name |
| --- | --- | --- |
| `context` | `summary` | `checkout` replaces `context` |
| `catalog.search` with `section: "units"` or no section | `unit.search` | `units` replaces `items`; no `section` input |
| `catalog.search` with `section: "collections"` | `collection.search` | `collections` replaces `items`; no `section` input |
| `catalog.search` with `section: "assets"` | `asset.search` | `assets` replaces `items`; no `section` or `scope` input |
| `notes.list` | `note.list` | adds `pageSize` |
| `reviews.list` | `review.list` | `submissions` replaces `items`; adds `pageSize` |
| `locks.list` | `lock.list` | unchanged |
| `unlock` | `lock.remove` | unchanged |
| `collections.membership` | `collection.membership` | unchanged |
| `organize.set` | `organization.set` | unchanged |
| `organize.bulk` | `organization.setMany` | unchanged |

Every other action keeps its name. A plugin's actions are now named `<plugin name>.<operation>`: see [Plugin modules](#plugin-modules).

## Action inputs and results

| Where | Before | Now |
| --- | --- | --- |
| `summary` and `checkout` results | `context` | `checkout` |
| A write's checkout precondition (`RunMeta`, the HTTP body) | `context` | `checkoutKey` (the `checkout.key` of `summary`) |
| `review.decide`, `review.decideCurrent` input | `partNotes` | `partComments` |
| `review.decide`, `review.decideCurrent` result | `event` | `decision` |
| `review.get` | `events` | `decisions` |
| Decision summaries in results (`review.get`, `review.decide`, `unit.get` history) | `scope` (`whole` or `parts`), `partNotes` | `covers`, `partComments` |
| Part review entries (`unit.get`, `collection.get`, `review.get`, `inbox`) | `event` | `decision` |
| `asset.get` `verdicts[]` rows | `event`, `note` | `decision`, `partComment` |
| `review.remove` result | `verdicts`, `records.verdicts` | `decisions`, `records.decisions` |
| `review.submit` input; the submission in results | `note`, `context` | `brief`, `checkout` |
| A work item's one text part (an item with text and no captures) | part `decision` | part `item` |
| Problem entries (`problems`, `inbox`) | `scope: "project" | "content" | "records"`, `source` | `origin: "project" | "sources" | "records"`, `subject` |
| Collections and organization rows | `owner: "adapter"` | `owner: "project"` |
| `unit.get` | `views` | `inspectors` |
| `unit.search` facet and filter | `visual` (`missing:<role>`, …) | `role` (same values) |
| `viewer.open` `target.compare`, `viewer.control` `select.compare` | `"<sub>~<item>~<part>[~<sub>~<item>~<part>]"` | `{ a: { submission, item, part }, b?: "current" | { submission, item, part } }`, as `evidence.compare` takes it (no `b`: current content) |
| `viewer.control` | `view: { … }` | `inspector: { … }` |
| Viewer state of an inspector | `kind: "view"`, `view: <key>` | `kind: "inspector"`, `inspector: <key>` |
| Part selection (`viewer.open` `target.part`, `viewer.control` `select.part`) | `view:<key>` | `inspector:<key>` |
| Default renderer of an inspector's capture | `catalog view <key>` | `catalog inspector <key>` |
| `viewer.open` and `viewer.state` answers, viewer state | `source` | `shows` |
| `schema` result | `views`, `previews` | `browserModules: { <name>: <url> | null }` |
| `GET /api/actions`, `jam catalog actions --json` | `kind` | `access`, `requires`, `output` |

Inputs that address more than one kind take a `target` object `{ kind, id, item?, part? }`, as before; `note.list` now also filters by `target.item` and `target.part`.

## Error codes

| Before | Now |
| --- | --- |
| `context_changed`, with `details.context` | `checkout_changed`, with `details.checkout` (HTTP 409, as before) |

## Configuration

`catalog.config.json` is now version 3. Versions 1 and 2 fail every action `unsupported`.

| Before | Now |
| --- | --- |
| `"version": 1` or `2` | `"version": 3` |
| Version 2 `plugins: ["manifest", "./catalog/storybook.ts"]` with `options: { "manifest": { … }, "storybook": { … } }` | `plugins: [{ "plugin": "manifest", "options": { … } }, { "plugin": "./catalog/storybook.ts", "options": { … } }]`; top-level `options` is gone. An entry without options stays a string |
| Version 1 `adapter: "manifest"`, `options: { "manifest": "<file>" }` | `plugins: [{ "plugin": "manifest", "options": { "file": "<file>" } }]` |
| Version 1 `adapter: "<module>"` | a `plugins` entry with the old options; the module must be rewritten as a plugin |
| Version 1 `previewModules` | dropped; declare the modules under a plugin's `browserModules` |
| Version 1 `review.resolverModule` | dropped; register the resolver under a plugin's `resolvers` |

`review` and `display` are unchanged.

## Manifest

The `manifest` plugin reads only manifest version 2. A version 1 manifest is listed as a problem of the `manifest` source with the fix `run: jam catalog migrate`.

| Before | Now |
| --- | --- |
| `"version": 1` | `"version": 2` |
| A type's `views` | `inspectors` |
| A role's `kinds` | `mediaKinds` |
| A unit's `views` (in the manifest and in `unitFiles` files) | `inspectors` |
| Default scopes `content` and `assets` (when no plugin registers scopes) | `main` and `material`. The migration rewrites a type's `scope` `"assets"` to `"material"` (`assets` is now a reserved section id, so no plugin scope can have it) and `"content"` to `"main"`. When the configuration lists project plugin modules, which may define a scope `content` of their own, it still rewrites `content` and warns, naming `types.<key>.scope`: set it back if your plugin defines that scope |
| Old keys in a version 2 manifest or unit file (a type's or unit's `views`, a role's `kinds`) | each is listed as a problem of the `manifest` source, such as `types.armor.views is now inspectors`, with the fix `run: jam catalog migrate`; the old key is not read |
| Role key `decision` reserved | role keys `attributes`, `item`, `capture` and `inspector` are reserved: a role with one of them is dropped and reported; `decision` is free |

## Record files

`.catalog/` is format 2, marked by the tracked file `.catalog/format.json`, `{ "format": 2 }`. The catalog writes it with its first record; the migration creates it.

| Before (format 1) | Now (format 2) |
| --- | --- |
| no marker | `.catalog/format.json` |
| `labels/<kind>/<key>.json` (label record) | `organization/<kind>/<key>.json` (organization record), same fields |
| `reviews/<sub>/verdicts/vd_<x>.json` (verdict event) | `reviews/<sub>/decisions/dc_<x>.json` (decision): `id` `vd_<x>` → `dc_<x>`, `scope` → `covers`, `partNotes` → `partComments`; `verdict`, `exceptions`, `verdicts`, `comment` and `relay` unchanged |
| Submission `context` | `checkout` |
| Submission `note` | `brief` |
| Work item part `decision` | part `item`, in the item's `parts[].id` and `views[].part`, a view's `before.from.part`, a decision's part keys and a note's `target.part` |
| `requestBinding.context`, `lastRequestBinding.context` | `.checkout` |
| `requestBinding.action` holding an old action name | the new name |

Notes, collections, `categories.json`, evidence, and every id other than a decision's are unchanged.

## Page routes and addresses

Old routes are not kept: saved links to them open nothing.

| Before | Now |
| --- | --- |
| `#/files/a/<asset>` | `#/assets/a/<asset>` |
| `#/organize` | `#/organization` |
| `#/content/u/<unit>`, `#/assets/u/<unit>` (default scopes) | `#/main/u/<unit>`, `#/material/u/<unit>` |
| `?part=view:<key>` | `?part=inspector:<key>` |
| `?cmp=<sub>~<item>~<part>[~…]` | `?cmp=` the JSON of the comparison object above |
| Reserved section ids `collections`, `files`, `reviews`, `notes`, `organize`, `inbox` | `collections`, `assets`, `reviews`, `notes`, `organization`, `inbox`: a scope with one of these ids is refused |
| `GET /project/preview/<name>`, `GET /project/view/<name>` | `GET /project/module/<name>` (`/project/kind/<kind>` unchanged) |

## Plugin modules

The migration warns about each project plugin module and leaves it as it is. Search each module for every name in the Before column and apply its row, then run `jam catalog run problems`. A plugin that still declares `views`, `previews` or an action's `kind` fails to load and is listed with the field it names. In a source's output or an enrich patch, a type's or unit's `views`, a role's `kinds` and a problem's `source` are each listed as a problem naming the field and its new key (`types.thing.views is now inspectors`, `types.thing.roles[0].kinds is now mediaKinds`, `units[0] (thing/a).views is now inspectors`, `problems[0].source is now subject`); the old key is not read.

| Before | Now |
| --- | --- |
| `import … from "../../tools/jam/src/catalog/plugin.ts"` | `import … from "../../tools/jam/catalog-plugin.ts"`, the stable path |
| `Plugin.views`, `Plugin.previews` | `Plugin.browserModules`: one map of inspector, panel and collection preview modules |
| `PluginAction.kind` | `access: "read" | "write"`; an optional `output` schema is published and types what `run` returns |
| One `ActionContext`, `actor` null for reads | a read gets a `ReadActionContext` (no `actor` or `requestId`); a write gets a `WriteActionContext`, whose `actor` is never null |
| A plugin action named freely (`outline`) | `<plugin name>.<operation>` (`storybook.outline`); another name still runs and is listed as a problem. A plugin named after a catalog namespace (`asset`, `catalog`, `category`, `checkout`, `collection`, `decision`, `doctor`, `evidence`, `inbox`, `lock`, `note`, `organization`, `problems`, `project`, `review`, `schema`, `summary`, `tag`, `unit`, `viewer`) has its actions refused |
| `RoleInput.kinds`, `Probe.kinds` | `mediaKinds` |
| `TypeInput.views`, `UnitInput.views` | `inspectors` |
| `ProblemInput.source` | `subject` |
| `SourceOutput.schema` (version 1 nesting of `types` and `collectionKinds`) | removed; return `types` and `collectionKinds` at the top level |
| `ScopeDef` | `ScopeInput` |
| `VerdictResolver` `(events, part) => event` | `Resolver` `(decisions, part) => decision` |
| `VerdictRecord` | `Decision` (fields `covers`, `partComments`) |
| `AdapterFactory`, version 1 adapter modules (`({ root, options }) => ({ sources(), load() })`) | removed: a plugin with one source, `{ name, inputs(context), load(context) }`, reading its options from `context.options` |
| a plugin's `run("<old action>")` and the fields it reads | the [Action names](#action-names) and [Action inputs and results](#action-inputs-and-results) tables |
| | new helpers `defineSource`, `defineType`, `defineMediaKind`, `defineProbe`, `defineCheck`: each returns its argument, so a type error points at the wrong property |

## Browser modules

Types for every browser module are in `tools/jam/catalog-plugin-web.d.ts`, used from JavaScript through JSDoc.

| Before | Now |
| --- | --- |
| Inspector, panel and preview modules declared under `views` and `previews` | declared under `browserModules`; a type's inspectors and panels name one with `module`, a collection kind with `preview.module` |
| A type view's `mount(host, ctx)` | an inspector's `mount(host, ctx)`, same context (`state`, `setState`, `markStage`) |
| Viewer props, viewer state and a preview's `ctx.source` | `shows` |
| `control(command)` returns `true` when handled, `false` when not its control, `{ error, code }` to refuse | returns any value other than `false` when handled (`undefined` included), `false` when not its control, and throws an `Error` to refuse (its `code` property, else `invalid`). A returned `{ error, code }` is a result like any other |
| An inspector answered `viewer.control { view: command }` | it answers `viewer.control { inspector: command }` |
| Control names free | `session`, `select` and `inspector` are the page's own. A media kind may declare `controls` (the names its state lists); `registerMediaKind` throws when one is reserved |

## Embedding the catalog in code

| Before | Now |
| --- | --- |
| `Catalog.context` | `Catalog.checkout` |
| `Catalog.previewModule(name)`, `Catalog.viewModule(name)` | `Catalog.browserModule(name)` |
| `Catalog.stats` | `CatalogDiagnostics.stats`; `Catalog.layer` provides `Catalog` and `CatalogDiagnostics` |
| `catalog.run(name, input, { context })` | `catalog.run(name, input, { checkoutKey })`; `run` is typed for every built-in and viewer action |
| `Catalog.layerWith({ plugins, overrides })` | also takes `defaults`: the plugins of a project without `catalog.config.json` |
