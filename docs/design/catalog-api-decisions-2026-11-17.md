# Catalog API overhaul: decisions

Date: 2026-11-17 (revised the same day: backwards compatibility dropped in favour of a migration script). Beads: epic `furanku-skills-drr.18`, decision `drr.18.10`, phases `drr.18.11` (A) to `drr.18.15` (E). Inputs: [catalog-api-review-2026-11-17.md](catalog-api-review-2026-11-17.md) (37 findings) and the investigation issues `drr.18.1` to `drr.18.9`. Every claim below was checked against the code on branch `catalog-api-overhaul` at `2beba30`. Paths are relative to `skills/jam-setup/assets/toolkit/` unless they start with `skills/` or `docs/`.

An implementing agent follows this document and makes no naming choice of its own. A name not listed here does not change. Each phase is committed locally on `catalog-api-overhaul` when it finishes.

## Approach

The catalog's mechanics (one registry, strict inputs, one error model, write safety, plain mergeable records) are sound, so the overhaul keeps them and changes what makes callers guess.

1. **No backwards compatibility; one migration.** Old action names, old input forms, old result fields, old config, manifest and plugin keys, old routes and old record formats stop working. A project moves to the new formats once, with `jam catalog migrate`, which rewrites `.catalog/` records, `catalog.config.json` and the manifest. Project plugin code and browser modules are migrated by hand with `docs/catalog-migration.md`.
2. **Names are chosen on their merits.** Records are renamed where that is best (`organization/`, decision records, `brief`, `partComments`, `covers`, `checkout`). A rename is still adopted only when the old word means two things a caller can confuse or breaks an inferable rule.
3. **Fewer, coherent changes.** Rejections made for low value or churn stand: one browser contract for everything, a versioned HTTP API, merged bulk actions, generic result envelopes, `project.*` action names, nested viewer controls, type-scoped reference roles.

The result: 8 action renames plus a split search, one rule for action and plugin-action names, `access`/`requires` and output schemas on every action, type views renamed **inspectors**, verdict events renamed **decisions**, organization records under `organization/`, **checkout** instead of "context" everywhere, `mediaKinds` for lists of media kinds, a stable plugin import path, one declaration map for browser modules, plugin options inside their `plugins` entry, and a migration command with dry run.

## Cross-cutting rules

### Migration instead of compatibility

- **Nothing old is accepted.** No action aliases, no old input fields, no duplicated result fields, no old keys in `catalog.config.json`, `catalog.manifest.json`, source or enrich outputs, plugin objects or browser modules, no old page routes, no version 1 configuration or version 1 adapters. Decoders stay strict, so an old key fails with its field path.
- **Old formats are recognised and named.** So that nobody gets a pile of "malformed" problems:
  - `.catalog/format.json` is a tracked file `{ "format": 2 }` (the formats before this epic are format 1, which had no marker). The catalog writes it with its first record. When `.catalog/` holds record files and the marker is missing or older, every action fails `unsupported` with the message `.catalog/ was written by an older toolkit (format 1)` and the fix `run: jam catalog migrate`.
  - Files at format-1 paths (`labels/…`, `reviews/<sub>/verdicts/…`) found beside a format-2 marker (a branch merged after migration) are listed as record problems with the same fix.
  - `catalog.config.json` with `"version"` 1 or 2 and a manifest with `"version": 1` fail with the same fix.
- **Unknown action names point to the new name.** A `not_found` for one of the old names in the rename table carries `fix: "<old> is now <new>"` (a map in `src/catalog/Actions.ts` used only for that message; the old name does not run).
- **Record strictness** stays as Phase A sets it (records decoded with `strict: false`, published open); the format marker is what detects old records.
- **Request ids** recorded before migration cannot be replayed afterwards: migration clears the machine-local journal `.catalog/.local/requests/`; records keep their (migrated) bindings, so reusing such an id fails with `conflict` as today.

### The migration command

`jam catalog migrate [--dry-run] [--force] [--root <project>] [--json]`, implemented in `src/catalog/migrate/` (`plan.ts` computes the plan from the files as pure functions per file kind, `apply.ts` writes it, `command.ts` is the CLI entry registered in `src/catalog/cli.ts`). Written and tested in **Phase C**, the phase that changes the formats.

- **Scope:** every record under `.catalog/` (see "Record changes"), `catalog.config.json`, the manifest file the configuration names (option `file` of the `manifest` plugin, default `catalog.manifest.json`) and every file under its `unitFiles` folders, and `.catalog/format.json`. It deletes `.catalog/.local/requests/`. It touches nothing else.
- **Dirty check:** it refuses with `conflict` while `git status --porcelain -- .catalog catalog.config.json <manifest> <unitFiles folders>` lists anything, with the fix `commit or stash these files first, or pass --force`. `--force` skips the check. Outside a Git checkout it requires `--force`.
- **Dry run:** `--dry-run` writes nothing and lists every change.
- **Report** (also the dry run's output): `{ "format": { "from": 1, "to": 2 }, "changes": [{ "file", "action": "rewrite" | "move" | "create" | "delete", "to"?, "why" }], "warnings": [ … ], "dryRun": boolean }`; the text form prints one line per change and per warning. Warnings name what it cannot migrate: a version 1 adapter module, `previewModules`, `review.resolverModule`, and every project plugin module listed in `plugins` (each "check against docs/catalog-migration.md").
- **Atomic and idempotent:** the whole plan is computed and every resulting record is validated against the new schemas before any file changes; files are written beside their targets and then moved into place, as `Records.apply` does. A file already in the new form produces no change, so a second run reports `changes: []`. A tree mixing format-1 and format-2 files (a merge after migration) is migrated file by file.
- **Exit:** 0 when it migrated or had nothing to do, 1 when refused (dirty, or a file it cannot read: the report names it and nothing was written), 2 for invalid flags.

### Record changes (format 1 → format 2)

| Format 1 | Format 2 | Cross-references migrated |
|---|---|---|
| `labels/<kind>/<key>.json` (`LabelRecord`) | `organization/<kind>/<key>.json` (`OrganizationRecord`, record kind `organization`), same fields | none (keyed by target) |
| `reviews/<sub>/verdicts/vd_<x>.json` (`VerdictRecord`) | `reviews/<sub>/decisions/dc_<x>.json` (`DecisionRecord`): `id` `vd_<x>` → `dc_<x>`; `scope` → `covers`; `partNotes` → `partComments`; `verdict`, `exceptions`, `verdicts`, `comment`, `relay` unchanged | part ids inside `covers.parts`, `exceptions`, `verdicts`, `partComments` (work part rename below) |
| Submission `context` (`{ branch, head, dirty }`) | `checkout` | |
| Submission `note` | `brief` | |
| Work item part `decision` (a work item with text and no captures) | part `item` | the item's `parts[].id`, its `views[].part`, any `before.from.part` naming it, decision records' part keys, note `target.part` |
| `requestBinding.context`, `lastRequestBinding.context` (notes, collections, submissions, verdicts) | `.checkout` | |
| `requestBinding.action` holding an old action name | the new name from the rename table | |
| no marker | `.catalog/format.json` `{ "format": 2 }` | |

Unchanged: notes (other than the above), collections, `categories.json`, evidence blobs, submission and item ids, view ids `vw_…`, capture parts `capture:<n>`, every other part id.

### Configuration and manifest changes

- `catalog.config.json` becomes `"version": 3`. `plugins` entries are a built-in name or project path string, or `{ "plugin": "<name or path>", "options": { … } }`. Top-level `options` is removed: migration moves `options.<name>` into that plugin's entry (as an object entry), and an option set whose plugin is not listed is dropped with a warning. `review` and `display` are unchanged. Version 1 files migrate to version 3 directly: `adapter: "manifest"` with `options.manifest` → `plugins: [{ "plugin": "manifest", "options": { "file": <path> } }]`; any other `adapter` → a `plugins` entry with the old options and a warning that the module must be rewritten as a plugin; `previewModules` and `review.resolverModule` are dropped with a warning naming them.
- The manifest becomes `"version": 2`: in `types`, `views` → `inspectors` and each role's `kinds` → `mediaKinds`; in units (in the manifest and in `unitFiles`), `views` → `inspectors`.
- Engine: `CatalogConfig` decodes only version 3; the `manifest` plugin reads only version 2; `plugins/v1.ts`, `ConfigV1`, `ConfigV2`, `AdapterFactory`, `SourceOutput.schema` and `ResolvedConfig.previewModules`/`resolverModule` are deleted.
- `skills/jam-setup/scripts/install.mjs` writes version 3 for new projects and recognises object entries when checking for `jam`; for an existing version 1 or 2 configuration it changes nothing. Whether migration is needed is what the installed toolkit's `jam catalog migrate --dry-run` answers (see Review fixes).

### Naming rule for actions

1. A built-in action that operates on one entity is `<entity>.<operation>`: the entity is a singular glossary noun (`unit`, `asset`, `collection`, `note`, `review`, `evidence`, `organization`, `category`, `tag`, `lock`, `viewer`); the operation is a lower-camelCase verb (`get`, `list`, `search`, `create`, `update`, `edit`, `delete`, `remove`, `resolve`, `reopen`, `rename`, `submit`, `decide`, `decideCurrent`, `compare`, `set`, `setMany`, `open`, `state`, `control`, `capture`, `close`, `fix`) or, for a read, a noun naming what it returns (`collection.membership`).
2. A project-wide read about no single entity is one word: `summary`, `schema`, `checkout`, `problems`, `inbox`, `doctor`. Its write counterpart is `<read>.<verb>` (`doctor.fix`).
3. `get` returns one entity in full; `list` pages records by structured filters; `search` ranks by text with facets. `delete` removes a record the actor owns; `remove` takes away something that is not a plain record (a stale lock file, retired submissions with their evidence).
4. A plugin action is `<plugin name>.<operation>` (A2).

Old → new (every other built-in name is unchanged):

| Old | New | Result under the new name |
|---|---|---|
| `context` | `summary` | `checkout` replaces `context` (N7) |
| `catalog.search` with `section: "units"` (or none) | `unit.search` | `units` replaces `items`; no `section` |
| `catalog.search` with `section: "collections"` | `collection.search` | `collections` replaces `items`; no `section` |
| `catalog.search` with `section: "assets"` | `asset.search` | `assets` replaces `items`; no `section`, no `scope` input |
| `notes.list` | `note.list` | adds `pageSize` |
| `reviews.list` | `review.list` | `submissions` replaces `items`; adds `pageSize` |
| `locks.list` | `lock.list` | none |
| `unlock` | `lock.remove` | none |
| `collections.membership` | `collection.membership` | none |
| `organize.set` | `organization.set` | none |
| `organize.bulk` | `organization.setMany` | none |

Unchanged on purpose: `schema`, `checkout` (result field `checkout` replaces `context`), `problems`, `inbox`, `doctor`, `doctor.fix`, `organization.list`, `evidence.compare`, `review.decideCurrent`, `review.remove`, `note.edit`, all `viewer.*`.

Every paged list or search result is `{ <entities>, total, page, pages, pageSize, … }` with the plural entity name (`units`, `collections`, `assets`, `notes`, `submissions`); extra fields (`facets`, `ids`, `counts`, `authors`, `q`, `filters`, `scope`, `all`) stay.

### Result and input renames outside action names

| Where | Old | New | Phase |
|---|---|---|---|
| `summary`, `checkout` results | `context` | `checkout` | C |
| Write precondition: `RunMeta`, HTTP body | `context` | `checkoutKey` | C |
| Error code | `context_changed` (details `context`) | `checkout_changed` (details `checkout`) | C |
| Embedding | `Catalog.context` | `Catalog.checkout` | C |
| `review.decide`, `review.decideCurrent` input | `partNotes` | `partComments` | C |
| `review.decide`, `review.decideCurrent` result | `event` | `decision` | C |
| Part review entries (`unit.get`, `collection.get`, `review.get`, `inbox`) | `event` | `decision` | C |
| `review.get` | `events` | `decisions` | C |
| Decision summaries in results | `scope` (`whole`/`parts`), `partNotes` | `covers`, `partComments` | C |
| `review.submit` input, submission in results | `note`, `context` | `brief`, `checkout` | C |
| Problem entries (`problems`, `inbox`, `summary`) | `scope: "project" | "content" | "records"`, `source` | `origin: "project" | "sources" | "records"`, `subject` | C |
| Collections and organization rows | `owner: "adapter"` | `owner: "project"` | C |
| `unit.get` | `views` | `inspectors` | C |
| Unit search facet and filter | `visual` | `role` | C |
| `viewer.open target.compare`, `viewer.control select.compare` | `"<sub>~<item>~<part>[~…]"` | `{ a: FrozenRef, b?: "current" | FrozenRef }` | C |
| `viewer.control` | `view: { … }` | `inspector: { … }` | C |
| Viewer state of an inspector | `kind: "view"`, `view: <key>` | `kind: "inspector"`, `inspector: <key>` | C |
| Part selection (page `?part=`, `viewer.open`/`select` `part`) | `view:<key>` | `inspector:<key>` | C |
| `schema` result | `views`, `previews` | `browserModules` | D |
| Viewer state and viewer props, `viewer.open`/`viewer.state` answers | `source` | `shows` | D |
| `ActionInfo` | `kind: "read" | "write" | "viewer"` | `access`, `requires` | B |

### One reference shape

Adopted with changes (S1); parts stay strings.

- **Ref** is the object `{ kind, id, item?, part?, leaf? }`: `kind` is `unit`, `collection`, `asset` or `submission`; `item` is a submission item id (only with `submission`); `part` a part id; `leaf` one evidence leaf inside a member or preview part (`<unit>/<part>` or `base`). Defined once in `src/catalog/action.ts` as `refOf(kinds, { item?: boolean, part?: boolean, leaf?: boolean })`, a closed `Schema.Struct`; it replaces `targetOf` and `UnitOrCollection`.
- **Where a Ref is used:** an input that may address more than one kind takes a Ref under `target` (a list: `targets`), with the kinds and optional members the action accepts in its schema: `note.create` and `note.list` (`unit|collection|asset|submission`; item, part), `organization.set` and `organization.setMany` (`unit|asset|collection`), `review.list` (`unit|collection`), `review.decideCurrent` (`unit|collection`), `viewer.open` (all four; item, part, plus the viewer-only `member` and `view`).
- **Where ids are used directly:** an action that addresses one fixed kind takes that kind's id fields: `unit.get { id }`, `review.get { submission }`, `review.decide { submission, item, … }`, and `FrozenRef = { submission, item, part }` in `evidence.compare`.
- **Comparisons:** `viewer.open target.compare` and `viewer.control select.compare` take `evidence.compare`'s object `{ a: FrozenRef, b?: "current" | FrozenRef }` (absent `b` = current content). The `~` string is removed.
- **CLI string:** what `jam catalog capture --target` parses today (`unit:<id>`, `collection:<id>`, `asset:<id>`, `submission:<id>/<item>`, only in `targetOf` of `src/catalog/server/commands.ts`), with the part in `--part`.
- **Part ids** stay strings: `<role>`, `<role>:<key>`, `attributes`, `member:<unit>`, `preview`, `capture:<n>`, `item` (format 2; was `decision`); page selection `inspector:<key>`. Reserved role keys prevent collisions: Phase A reserves `attributes`, `decision`, `capture`, `view`, `inspector`; Phase C changes the list to `attributes`, `item`, `capture`, `inspector`.

### Plugin entry point and module layout

- **Stable import path:** `tools/jam/catalog-plugin.ts` (toolkit root `catalog-plugin.ts`), whose content is `export * from "./src/catalog/plugin.ts"`. Projects import `../tools/jam/catalog-plugin.ts`; the README and examples use only this path. `tsconfig.json` `include` adds it. `src/catalog/plugin.ts` remains the entry inside `src/`.
- **Layout behind it** (`src/catalog/contract/`):

| Module | Exports |
|---|---|
| `contract/context.ts` | `PluginResult`, `PluginFiles`, `PluginContext`; re-exports `ErrorCode`, `ToolError`, `toolError` |
| `contract/sources.ts` | `Source`, `SourceOutput`, `ProblemInput`, `TypeInput`, `FieldInput`, `RoleInput`, `MountInput`, `CollectionKindInput`, `AssetInput`, `LinkInput`, `UnitInput`, `CollectionInput`, `MergedSources`, `EnrichPatch`, `Relation`, `RelationUnit`, `defineSource`, `defineType` |
| `contract/media.ts` | `MediaKind`, `Probe`, `ProbeFile`, `defineMediaKind`, `defineProbe` |
| `contract/actions.ts` | `PluginAction`, `ReadActionContext`, `WriteActionContext`, `ActionContext` (their union), `RunAction`, `defineAction`, `Check`, `CheckContext`, `CheckProblem`, `defineCheck`, `optional`, `Text` |
| `contract/review.ts` | `Actor`, `Decision`, `Resolver` |
| `contract/page.ts` | `ScopeInput` |
| `plugin.ts` | `Plugin`, `definePlugin`, `Effect`, `Schema`, and `export *` of the modules above |

- **Suffix rule:** data a plugin supplies is `*Input` (function results named by role: `SourceOutput`, `EnrichPatch`); objects a plugin implements are bare nouns (`Source`, `Check`, `Probe`, `MediaKind`, `Relation`, `PluginAction`, `Resolver`); what it receives is `*Context`. `ScopeDef` becomes `ScopeInput`, `VerdictResolver` becomes `Resolver`, `VerdictRecord` (as a public type) becomes `Decision`; the old names are deleted. `define<Thing>` helpers return their argument unchanged.
- `Actor` and `Decision` are public interfaces declared in `contract/review.ts` (no `requestId`/`requestBinding`); the internal `DecisionRecord` must stay assignable to `Decision`.
- Plugin fields renamed: `Plugin.views` and `Plugin.previews` → `Plugin.browserModules`; `PluginAction.kind` → `access`; `RoleInput.kinds` → `mediaKinds`; `Probe.kinds` → `mediaKinds`; `TypeInput.views` and `UnitInput.views` → `inspectors`; `ProblemInput.source` → `subject`; `Plugin.resolvers` keeps its name.

### Browser module contract

Two contracts (B1 adopted in part):

1. **Mount modules** (inspectors and panels): a named export (`export` in the declaration, default `default`) `mount(host: HTMLElement, ctx) → Controller | Promise<Controller>`, framework-free. `Controller = { dispose(): void, state?(): object, control?(command: object): unknown }`. `ctx`: `unit` (`{ id, name, type, attrs }`), `key`, `call(action, input, requestId?)`, `assetUrl(id)`; an inspector's adds `state`, `setState(object)`, `markStage(element)`.
2. **Page-integrated modules**, which embed the page's Preact viewer components and capture machinery: a media kind module (default export `(catalog) => void` calling `catalog.registerMediaKind(id, definition)`) and a collection preview module (default export `(ctx) => markup`).

Rules for both:

- **Declaration:** `Plugin.browserModules: { <name>: <project-relative path or file: URL> }` declares inspector, panel and preview modules in one namespace; inspectors and panels name one with `module` (+ `export`), a collection kind with `preview.module`. A media kind declares its module with `MediaKind.web`.
- **State:** `{ kind, status: "loading" | "ready" | "error", error, shows, controls, … }`; `shows` is the identity of what is shown (unit, part, digest), as `viewer.capture` returns it. Viewer components receive the prop `shows`.
- **Control results:** `control(command)` returns any value other than `false` when it handled the command, `false` when the command is not one of its controls, and throws an `Error` when the command is wrong (its `code` property if set, else `invalid`). Returning `{ error, code }` is no longer a refusal.
- **Reserved control names:** `session`, `select`, `inspector` (`registerMediaKind` throws when a kind's state would list one in `controls`).
- **Types:** `tools/jam/catalog-plugin-web.d.ts` (toolkit root `catalog-plugin-web.d.ts`) declares `CatalogApi`, `MediaKindDefinition`, `ViewerState`, `MountFunction`, `MountContext`, `InspectorContext`, `Controller`, `PreviewContext`, `PreviewFunction`; JS modules use it through JSDoc.
- **Serving:** `/project/module/<name>?v=<digest>` for mount and preview modules, `/project/kind/<kind>` for media kinds; `/project/preview/` and `/project/view/` are removed.

### Page routes

`#/<scope>/u/<unit>`, `#/collections/c/<id>`, `#/assets/a/<asset>` (was `#/files/a/`), `#/reviews/s/<submission>[/<item>]`, `#/notes`, `#/organization` (was `#/organize`), `#/inbox`. Reserved section ids (a scope cannot use them): `collections`, `assets`, `reviews`, `notes`, `organization`, `inbox`. Default scopes when no plugin registers any: `main` ("Main", "Units that make up the project") and `material` ("Material", "Source material and media units"); they were `content` and `assets`. The page section listing assets is labelled "Assets". Old routes are not kept.

## Glossary

One word, one meaning, on every surface (actions, results, records, plugin contract, page, CLI, README, skills).

| Word | Meaning | Not |
|---|---|---|
| **unit** | One catalog entry: an id, a type, attributes and links | "entry", "content" as a name for a unit |
| **content** | Mass noun: what the checkout holds now for units and collections, as opposed to frozen evidence ("current content") | A unit; a scope id |
| **asset** | A media file with its own identity (`id`, project `path`), linked by units; route `#/assets/a/<id>`, page section "Assets" | "file" or "visual" as a name for it |
| **media kind** | A kind of media recognised by bytes (`image`, `model`, …). A list of media kind ids on something that is not media is `mediaKinds` (`RoleInput.mediaKinds`, `Probe.mediaKinds`); media describes itself with `kind` (`AssetInput.kind`, `ProbeFile.kind`, leaves) | |
| **type**, **field**, **role**, **link** | A unit's type; one of its attributes; a slot for linked assets; the attachment of an asset in a role | |
| **collection** | Ordered references to units: **project-owned** (from sources, read-only in the catalog; `owner: "project"`) or **catalog-owned** (made with `collection.create`; `owner: "catalog"`) | "adapter" |
| **collection kind** | What kind of collection it is (`CollectionInput.kind`, `collectionKinds`) | |
| **scope** | A top-level split of units on the page (`Plugin.scopes`, `TypeInput.scope`, search `scope`, route segment) | What a decision covers (`covers`); where a problem comes from (`origin`) |
| **organization** | The category and tags of a unit, asset or collection; records `organization/<kind>/<key>.json`; page section `#/organization` | "label record", "organize" |
| **submission**, **item**, **part** | A frozen request for review; one thing in it; one reviewable piece of an item. A work item with text and no captures has the one part `item` | |
| **brief** | A submission's Markdown message to the reviewer (`brief`) | "note" |
| **evidence**, **leaf** | Frozen bytes or attributes of a part, verified by digest; one piece inside a member or preview part | |
| **view** | A captioned framing of one part of a submission item (`items[].views`, ids `vw_…`, `viewer.open target.view`) | A browser module |
| **inspector** | A browser module shown in a unit's media strip (`TypeInput.inspectors`, selection `inspector:<key>`) | "type view" |
| **panel** | A browser module shown as a section of a unit's sidebar | |
| **preview** | A collection kind's combined picture of its members (part `preview`) | |
| **browser module** | A `.js`/`.mjs` file a plugin declares for the page (`browserModules`, `MediaKind.web`) | "view module", "page module" |
| **capture** | An image or clip file made to show something, labelled by its `renderer`. A submission item attaches captures as evidence (part `capture:<n>`): an engine screenshot, a clip, a file as it was at a commit, or a catalog capture. `viewer.capture` and `jam catalog capture` make a catalog capture | Content of a unit |
| **renderer** | What drew a capture | |
| **verdict** | The value `approved`, `changes` or `rejected` | The record |
| **decision** | The immutable record of one reviewer's verdicts on an item (`reviews/<sub>/decisions/dc_….json`), made by `review.decide` or `review.decideCurrent`, returned as `decision` | "verdict event", "event" |
| **covers** | Which parts a decision decides: `{ kind: "whole" | "parts", parts }` | "scope" |
| **comment**, **part comments** | A decision's text on the whole item; its text per decided part (`partComments`) | "part notes" |
| **note** | A standalone note record (`notes/nt_….json`) | A brief or a comment |
| **resolver** | Picks the decision that counts for a part (`review.resolver`, `Plugin.resolvers`, type `Resolver`) | |
| **checkout** | The worktree, branch and head the catalog reads (`checkout` in results and submissions) | "context" |
| **checkout key** | `checkout.key`; a write sent with `checkoutKey` fails `checkout_changed` when the checkout moved | |
| **summary** | The cheap project read a client polls (`summary` action) | "context" |
| **context** | Only the runtime arguments handed to plugin code: `PluginContext`, `CheckContext`, `ReadActionContext`, `WriteActionContext`, a mount `ctx` | The checkout; the polling read |
| **source** | A plugin's reader of project files (`Plugin.sources`); a unit's `sources` lists the files its source read it from | What a problem is about (`subject`); what a viewer shows (`shows`) |
| **subject** | What a problem is about: a path or a unit id | |
| **shows** | The identity of what a viewer, inspector or capture shows | "source" |
| **problem** | Something the catalog could not use (`problems`; `origin`: `project`, `sources`, `records`) or a check finding (`doctor`) | |
| **kind** | The discriminator of the object it sits in, with that object's value set (a Ref's kind, a collection's kind, a field's kind, an actor's kind, a decision's `covers.kind`) | The read/write nature of an action (`access`); a list of media kinds (`mediaKinds`) |
| **access**, **requires** | `read` or `write`; what an action needs besides input (`actor`, `server`) | |
| **actor** | Who acts: `{ name, kind: "human" | "agent" }`, declared on every write | |
| **action** | A named operation in the registry, the same for CLI, HTTP, page and plugins | |
| **format** | The version of the `.catalog/` layout (`.catalog/format.json`) | |
| **migration** | `jam catalog migrate`: moving a project's files to the current formats | |

## Decisions

Phases: **A** correctness (`drr.18.11`), **B** actions (`drr.18.12`), **C** vocabulary, records, file formats and migration (`drr.18.13`), **D** plugin, browser and embedding (`drr.18.14`), **E** CLI, HTTP, docs and migration guide (`drr.18.15`).

### Investigation issues

| Id | Decision | Final change | Phase | Reason |
|---|---|---|---|---|
| drr.18.1 | Adopt | `Catalog.layerWith(setup: Partial<Setup>)` provides `{ plugins: setup.plugins ?? {}, defaults: setup.defaults, overrides: setup.overrides ?? {} }`; README documents `defaults` | A | Confirmed: `defaults` is dropped, so `catalogWithJam` and the review desk load only `manifest` in a jam project without `catalog.config.json` |
| drr.18.2 | Adopt | Publish the seven catalog schemas through `jam schemas write` (`PUBLISHED` appends `publishedSchemas`; `published.ts` listed as a public entry in `src/README.md`); `PublishedSchema.strict`; `jsonSchemaOf` `strict` option; config closed, records open. Phase C renames `catalog-label` → `catalog-organization` and `catalog-verdict` → `catalog-decision` and publishes the version 3 config | A (C for renames) | Confirmed nothing imports `published.ts`; the published schemas must match what the engine accepts |
| drr.18.3 | Adopt | `Empty` refuses keys and non-objects, published closed; viewer inputs published with the registry's closed `inputSchema`; `viewer.control` keeps open keys for a kind's own controls (the viewer refuses one it lacks with `unsupported`) | A | Confirmed by running the decoder: `Schema.Struct({})` accepts `{"x":1}`, `[1]`, `"s"` |
| drr.18.4 | Adopt | An orphan or mismatched verdict event is a record problem (`verdict event belongs to submission <sub>, which does not exist` / `verdict event names item <it>, which submission <sub> does not have`; recovery `remove this file, or restore the submission it belongs to`) and decides nothing. Phase C rewords "verdict event" → "decision" | A | Confirmed in `Projection.ts`; arises from a merge after `review.remove` or a hand edit |
| drr.18.5 | Adopt | The project-owned collection wins; the hidden catalog record is a record problem with recovery to recreate it under another id or remove the project's definition | A | Confirmed in `buildProjection`; sources are authoritative, but hiding must be visible |
| drr.18.6 | Adopt (rule kept) | No code change; README states the rule; a test pins it | A | Confirmed in `queries/review.ts`; "changed" must compare with what the deciding decision saw |
| drr.18.7 | Adopt | `ViewerControl` declares `isolate`, `texture`, `view` (renamed `inspector` in C); `preview.key` and `memberExtra.label` removed from the sample | A | Confirmed the model viewer uses `isolate`/`texture`; nothing reads the two sample keys |
| drr.18.8 | Adopt | `CommandGroup` moves to `src/kernel/cli.ts`; `src/cli/main.ts` re-exports it | A | Confirmed the import from `../cli/main.ts` breaks the dependency rule |
| drr.18.9 | Adopt | README fixed on all seven points (`review.remove`, `relay`, `internal`/405/415, `run --url` and actor flags, extra hooks, `capture.renderer` function, note field `resolved`) | E | All confirmed; the code is right each time; E rewrites the README anyway |

### Review findings

"Re-decided" marks a finding whose earlier decision depended on keeping files or aliases.

| Id | Decision | Final change | Phase | Reason |
|---|---|---|---|---|
| N1 | Adopt with changes (re-decided: submission views kept on merit) | Type views → **inspectors** (`TypeInput.inspectors`, `UnitInput.inspectors`, selection `inspector:<key>`, `viewer.control { inspector }`, state `kind: "inspector"`, `unit.get` `inspectors`, default renderer `catalog inspector <key>`). Submission **views** keep their name and `vw_` ids. `Plugin.views` → `browserModules` (P2) | C (D for `browserModules`) | Once type views are inspectors, "view" has one meaning. "Shots" is wrong for audio and attribute views, which views also frame |
| N2 | Reject (re-decided on merit) | No rename; README rewords captures per the glossary | E | One definition fits both uses; "renders" is wrong for a clip or a file as it was at a commit |
| N3 | Adopt with changes | `owner: "project" | "catalog"`; descriptions say "catalog-owned"; "lists" rejected | C | Results carry `owner: "adapter"`, a version 1 word |
| N4 | Adopt in part (re-decided) | `RoleInput.kinds` → `mediaKinds`, `Probe.kinds` → `mediaKinds`; `ActionInfo` gets `access` (A3). `FieldInput.kind`, collection `kind`, `AssetInput.kind` stay (rule in the glossary) | C (roles, probes), B (A3) | A role's `kinds` beside a field's `kind` in one type definition is the real confusion; elsewhere `kind` describes its own object |
| N5 | Adopt with changes | `ProblemInput.subject`, problem entries `subject`; viewer `shows` (D). `UnitInput.sources` kept | C, D | `subject` and `shows` are the better words the API already uses. A unit's `files` would read as its linked media files |
| N6 | Adopt with changes (re-decided) | Decision `scope` → `covers`; problem `scope` → `origin` (values `project`, `sources`, `records`). Page scopes keep "scope"; "sections" rejected | C | Now that records can change, "scope" keeps one meaning; "sections" collides with the page's reserved sections |
| N7 | Adopt (re-decided) | Action `context` → `summary`; `checkout` in results and the submission record; `checkoutKey`; error code `checkout_changed`; `requestBinding.checkout`; `Catalog.checkout` | B (`summary`), C (the rest) | With records and error codes free to change, "context" keeps only its plugin-runtime meaning. `status` is taken by `jam catalog status` |
| N8 | Adopt (re-decided) | "unit"/"asset" in messages and descriptions; unit facet `role`; route `#/assets/a/`; default scopes `main` and `material`; section `#/organization`; page section label "Assets" | C | The default scope `assets` named a split of units after a different entity; without saved-link compatibility both can be fixed |
| N9 | Adopt with changes (re-decided) | Lists name their plural entity; submission `note` → `brief`; `partNotes` → `partComments`; `labels/` → `organization/` (C2). Rejected on merit: `version` → `schemaVersion`, `schema` → `project.types` | B (lists), C (records) | `note` and `partNotes` collide with note records; `comment`/`partComments` pair. The `version` and `schema` names are unambiguous in place |
| A1 | Adopt with changes | The rule and the table above, no aliases; `not_found` for an old name names the new one | B | Fixes the failing guesses without a `project.*` namespace |
| A2 | Adopt with changes | Plugin actions `<plugin>.<operation>`; a plugin named `asset`, `catalog`, `category`, `checkout`, `collection`, `decision`, `doctor`, `evidence`, `inbox`, `lock`, `note`, `organization`, `problems`, `project`, `review`, `schema`, `summary`, `tag`, `unit` or `viewer` has its actions refused with a problem; an unprefixed action is registered and listed as a problem `plugin <p>: action <n> should be named <p>.<n>` | B | The prefix becomes trustworthy; `:` rejected |
| A3 | Adopt with changes | `ActionInfo { name, access: "read" | "write", requires: Array<"actor" | "server">, description, input, output, plugin? }` (writes `["actor"]`, viewer actions `access: "read"`, `["server"]`); `kind` removed. `PluginAction.access` replaces `kind` | B (registry), D (plugin) | `kind: "viewer"` mixed effect and location; `requires` carries S3's listing need |
| A4 | Adopt with changes | `unit.search`, `collection.search`, `asset.search` with the list envelope | B | Filters, facets, `scope` and item shapes differ per section |
| A5 | Reject | `organization.set` and `organization.setMany` stay separate | B (renames) | Replace-with-revision and add/remove-without-revision do not share one schema |
| A6 | Adopt | `ActionDef.output` for every built-in and viewer action, published as `output`; `PluginAction.output` optional; `CatalogOutputCheck` (context reference in `Actions.ts`, default `false`) decodes results strictly and fails `internal`; test helpers turn it on | B | Agents depend on results, and this epic renames result fields |
| S1 | Adopt with changes | See "One reference shape" | C (Ref, compare), A (X1, X2) | The real defects are the `~` grammar and colliding parts; a string `#part` grammar breaks on ids containing `#` |
| S2 | Adopt with changes | `optional` and `Text` exported; storybook uses `optional`; TS interfaces keep `?: T | null` | A | Plugin inputs could not accept `null` as the README promises |
| S3 | Adopt | `defineAction` overloads on `access`: `ReadActionContext` (`PluginContext & { run }`), `WriteActionContext` (`PluginContext & { actor: Actor; requestId: string | null; run }`) | D | Type-only; no null checks for an actor a write always has |
| S4 | Reject (re-examined; still low value) | No envelope retrofit; `review.decide` returns `{ decision }` through C2 | none | Output schemas (A6) give each result its contract |
| S5 | Adopt with changes | One control-result rule; `{ error, code }` returns dropped (re-decided) | D | Two styles in one module; no reason to keep the old one |
| P1 | Adopt with changes | The `contract/` layout; `ScopeInput`, `Resolver`, `Decision`; old names deleted | D | Orients authors; a `*Spec` rename buys nothing |
| P2 | Adopt with changes (re-decided) | `Plugin.browserModules` only; `schema` result `browserModules: { <name>: <url> }`; route `/project/module/<name>`; typed handles rejected | D | One namespace; references also come from JSON, so they stay strings |
| P3 | Reject | No `apiVersion`, no Standard or JSON Schema inputs | none | The toolkit is vendored and upgraded deliberately; with no compatibility promise an `apiVersion` decides nothing |
| P4 | Adopt with changes | `catalog-plugin.ts` stable path; README notes `"type": "module"` for projects that typecheck plugins | D, E | Survives `src/` reorganisations |
| P5 | Adopt | `defineSource`, `defineType`, `defineMediaKind`, `defineProbe`, `defineCheck` | D | Type errors point at the wrong property |
| P6 | Adopt (re-decided) | Public `Actor` and `Decision`; version 1 adapters, `AdapterFactory` and `SourceOutput.schema` removed (configuration migrated in C) | C (removal), D (types) | No compatibility layer to keep |
| B1 | Adopt in part | Two contracts: mount modules; page-integrated media kinds and previews | D | Kind viewers and previews embed the page's Preact viewers; inspectors and panels are already framework-free |
| B2 | Adopt with changes | `catalog-plugin-web.d.ts`; `useViewer` keeps its name (re-examined: it is called during render, like a hook) | D | Types are the missing piece |
| B3 | Reject (reserve instead) | Flat `viewer.control`; reserved `session`, `select`, `inspector` | D | Nesting lengthens the most frequent agent call for a collision no plugin has |
| C1 | Adopt (re-decided) | `plugins` entries carry their options; top-level `options` removed; configuration version 3 | C | One place for a plugin's options; the version marks unmigrated files |
| C2 | Adopt (re-decided) | `labels/` → `organization/`; verdict events → **decisions** (`reviews/<sub>/decisions/dc_….json`, `DecisionRecord`, result `decision`); work part `decision` → `item` | C | A Git diff now maps files to the actions that wrote them; "verdict" keeps meaning the value. The work part is renamed so "decision" names only the record |
| C3 | Reject | `review.referenceRoles` stays role keys | none | No project needs it |
| H1 | Adopt in part (re-decided) | `jam catalog inbox`; `todo` removed. Server commands stay at `jam catalog open|status|stop|serve` | E | One name per thing; `open` is not "server management" to its users |
| H2 | Reject (routes in P2) | No `/api/v1`; `X-Catalog-Client: web` stays | D (routes) | Server and page ship together; the header means "the local Git user" |
| E1 | Adopt in part | `stats` moves to `CatalogDiagnostics` (`Catalog.layer: Layer<Catalog | CatalogDiagnostics, never, ProjectFiles | Git | Ids>`); `previewModule`/`viewModule` → `browserModule(name)`; no `CatalogMedia` split | D | Test counters leave the facade |
| E2 | Adopt in part | The `layerWith` fix is drr.18.1; `Catalog.layer` stays a value; `CatalogSetup` and `layerNoDeps` documented toolkit-internal | A, D | A layer is memoised by reference |
| E3 | Adopt with changes | Hand-written `ActionMap` in `src/catalog/actionMap.ts` from the exported schemas; typed overloads of `Catalog.run` and `RunAction` | B | Follows from A6 |

### Added by this decision

| Id | Decision | Final change | Phase | Reason |
|---|---|---|---|---|
| X1 | Adopt | `review.decideCurrent` target `refOf(["unit", "collection"])` | A | Its schema accepted any kind; the handler answered `not_found` for a wrong input |
| X2 | Adopt | Reserved role keys `attributes`, `decision`, `capture`, `view`, `inspector` (Phase C: `attributes`, `item`, `capture`, `inspector`); such a role is dropped and reported | A, C | They collide with item parts and selection prefixes |
| X3 | Withdrawn | The frozen compatibility fixtures are not needed without compatibility; Phase C's migration fixture replaces them | none | Backwards compatibility dropped |

## Phases

Each phase ends with `npm test` and `npm run test:jam-toolkit` passing (browser suites skip only when no browser can be launched) and is committed locally on `catalog-api-overhaul`.

### Phase A: correctness (`drr.18.11`)

No renames. Changes: drr.18.1 to drr.18.8 as decided above; X1; X2 (`attributes`, `decision`, `capture`, `view`, `inspector`); S2.

Files most affected: `src/catalog/Catalog.ts`, `action.ts`, `Actions.ts`, `viewerActions.ts`, `Projection.ts`, `queries/inbox.ts`, `model/normalize.ts`, `published.ts`, `plugin.ts`, `cli.ts`, `src/kernel/cli.ts`, `src/kernel/decode.ts`, `src/cli/main.ts`, `src/cli/compose.ts`, `src/jam/reference.ts`, `src/README.md`, `src/catalog/README.md`, `examples/hollowmere/data.ts`, `examples/plugins/storybook.ts`, `schemas/`.

Tests: `test/jam/catalog-bridge.test.ts` (jam source loads through `catalogWithJam` without `catalog.config.json`); `test/jam/schemas.test.ts` and `test/catalog/config.test.ts` (catalog schemas generated, config closed, records open, matching decoding); `test/catalog/cli.test.ts` (`context` refuses `{"x":1}` and `[1]`; closed published inputs; `viewer.control` lists `isolate`, `texture`, `view`); `test/catalog/reviews.test.ts` (orphan and mismatched verdict events reported, status unchanged; the drr.18.6 rule; `review.decideCurrent` with `kind: "asset"` fails `invalid`); a shadowed collection reported; a reserved role key dropped and reported; a plugin action with `optional(...)` accepts `null`; `test/catalog/dependencies.test.ts` (nothing under `src/catalog/` imports `src/cli/` or `src/jam/`).

Done when drr.18.1 to drr.18.8 are closed each with its test, `schemas/` holds the seven catalog schema files from `jam schemas write`, both test commands pass, and the phase is committed.

#### Phase A notes

- **X2 without `view`.** Phase A reserves `attributes`, `decision`, `capture` and `inspector`. The shipped `prop` recipe's turnaround step produces role `view` (parts `view:front` and so on), so reserving `view` dropped that role from every jam run and failed the `jam` plugin suites. Phase C's reserved list (`attributes`, `item`, `capture`, `inspector`) does not include `view` either. If `view` should still be reserved, the recipe role needs a new name first.
- **`Empty`** is `Schema.Record(String, Never)`, because Effect 4's `Schema.Struct({})` accepts anything except `null`, even when unknown fields are refused. It publishes as `{ "type": "object", "additionalProperties": false }`, with no empty `properties`, and accepts the same inputs. A stray field fails with `<field>: this action takes no fields`.
- **`inputSchema`** moved from `Actions.ts` to `action.ts`, so `viewerActions.ts` publishes with it without importing the registry.
- **X1** uses today's `UnitOrCollection`; `refOf` arrives in Phase C.
- **drr.18.2.** `src/jam/published.ts` `Published` gains an optional `strict`. The catalog's entries set it and render through `jsonSchemaOf(…, { strict })`. jam's own entries keep their earlier rendering (closed after rendering), because strict rendering adds `propertyNames` to their record-keyed maps and would change committed files. `src/jam/cli.ts` imports `reference.ts` lazily, inside `schemas write`/`check`; a static import would load the catalog in every ledger command, which `test/jam/catalog-plugin.test.ts` forbids.
- **drr.18.8.** `src/jam/cli.ts` also takes `CommandGroup` from `kernel/cli.ts` (same dependency rule).
- **drr.18.4/.5** problems are `Projection.recordProblems`, computed in `buildProjection` and reported by `problemsOf` with scope `records`.

### Phase B: actions (`drr.18.12`)

Changes:

1. The renames of the action table (including `context` → `summary` and the search split) with no aliases; the `not_found` fix naming the new name for each old name.
2. The list envelope for `note.list` and `review.list`.
3. A2 plugin-action naming rule and reserved namespaces.
4. A3 `ActionInfo` with `access` and `requires`; `kind` removed.
5. A6 output schemas for every built-in and viewer action; `CatalogOutputCheck`, on in the catalog test helpers (`test/catalog/helpers.ts`, `test/catalog/server.ts`).
6. E3 `ActionMap` and typed overloads.
7. Every caller uses the new names: `catalog/web/*.js`, `src/jam/catalog/desk.ts`, `src/catalog/commands/remove.ts`, `src/catalog/cli.ts` (`jam catalog unlock` runs `lock.remove`, `todo` runs `inbox`), `examples/`, `skills/jam-catalog/SKILL.md` action names (full rewrite in E).

Files most affected: `src/catalog/Actions.ts`, `action.ts`, `builtinActions.ts`, `commands/*.ts`, `queries/search.ts`, `queries/reviews.ts`, `queries/notes.ts`, `viewerActions.ts`, `Catalog.ts`, `cli.ts`, new `actionMap.ts`, `catalog/web/app.js`, `core.js`, `lists.js`, `detail.js`, `notes.js`, `review.js`.

Tests: `test/catalog/plugin-contract.test.ts` (each old name fails `not_found` with the new name in `fix`; a plugin named `note` has its actions refused; an unprefixed plugin action runs and lists one problem); `test/catalog/cli.test.ts` (`actions --json` lists `access`, `requires`, `output` for every built-in and viewer action and no `kind`); `test/catalog/search.test.ts` (the three searches, facets, envelopes); `test/catalog/reviews.test.ts` (`review.list` returns `submissions`); the whole catalog suite under `CatalogOutputCheck`; `npm run typecheck` with a typed `catalog.run("unit.get", { id })` used without a cast.

Done when `jam catalog actions --json` lists only the new names with `access`, `requires` and `output` for every built-in and viewer action; from the toolkit root `grep -rnE "(run|call|read|write)\(\s*['\"](context|catalog\.search|notes\.list|reviews\.list|locks\.list|collections\.membership|organize\.(set|bulk)|unlock)['\"]" src/catalog src/jam/catalog catalog/web examples test/catalog` finds nothing (the rename-hint map in `src/catalog/Actions.ts` holds the old names as plain keys); both test commands pass; the phase is committed.

#### Phase B notes

- **What an output describes.** The check decodes what the caller of `Catalog.run` receives, after links and replays are added, so outputs declare them: `url` beside every `route` (`results.ts` `Route`), a top-level `hint` on every result that can name a page (`Linked`), and `replayed: true` on every write (`Written`). The viewer actions are checked in `Renderer.run` the same way. Shared result shapes live in the new `src/catalog/results.ts`; each action's own input and output schemas are exported beside it for `actionMap.ts`.
- **Records inside results are open.** Records are read open (Phase A), and a record file can hold fields its schema does not name (a newer toolkit's, or a frozen part's `role`/`asset`, which `SubmissionRecord` leaves undeclared). A record a result carries (`note.*`'s `note`, `collection.*`'s `collection`, note views, `review.remove`'s `records`) is therefore declared with its schema's fields plus open keys (`OpenRecord`), and `review.remove`'s removed submissions as open objects. Everything else is closed at every level, except authored or plugin-defined data (attributes, `explain`, link `meta`, probe facts, preview `config`), frozen evidence leaves and views of `review.get`, the sides of `evidence.compare`, and the page-defined `selection`/`viewer` of a viewer state and `viewer.capture`'s `shows`. So Phase D's `source` → `shows` inside viewer state is not caught by the check; its browser tests must catch it.
- **Handlers are checked at run time, not by type.** `read`/`write` take the output schema, but a handler's result type stays `unknown`: results are assembled from projection types wider than the published shapes (`Target` for item targets, `Record<string, number>` counts), and narrowing every producer is a refactor of its own. `ActionMap` types callers from the schemas; the test suite's output check is what holds producers to them.
- **`ActionInfo.output`** is optional: a plugin action publishes none until `PluginAction.output` (Phase D). Registered plugin actions report `access` from `PluginAction.kind`, which keeps its name until Phase D.
- **`asset.search`** has no `scope` in its output either, as it takes none.
- **`ActionMap` reaches `src/jam/` through `Catalog.ts`**, which re-exports its types (`ActionMap`, `ActionName`, `ActionInput`, `ActionOutput`), so jam keeps importing only the catalog's public entries. `plugin.ts` types `RunAction` with it.
- **`ACTION_NAMES`** (`actionMap.ts`) lists the map's keys at run time, so `cli.test.ts` holds the typed map against the registry and the viewer actions.
- **`jam catalog actions`** prints columns name, access, requires, description.
- **Plugin action refusal message** for a reserved plugin name: `plugin <p>: action <n> is refused because "<p>" is a name the catalog reserves for its own actions`, recovery `give the plugin another name`.
- **"Done when" grep.** The grep also matches `run("unlock", …)` in `test/catalog/cli.test.ts`, which runs the CLI command `jam catalog unlock` (kept; it runs `lock.remove`) through a helper named `run`. Those two calls go through `cli(dir)(…)` instead.
- **`skills/jam-catalog/SKILL.md`** (change 7) is left to Phase E, as instructed for this phase: it still names the old actions.
- **For Phase C.** The output schemas are where the result renames land (`SummaryOutput`/`CheckoutOutput` `context`; `EventSummary` `scope`/`partNotes`; `PartReview`, item parts, `DecideOutput` and `review.get` `event`/`events`; `SubmissionView` `note`/`context`; `Problem` `scope`/`source`; `owner` literals; `UnitDetail` `views`; the `visual` facet is data, not schema). With the check on, a renamed field the schema still names fails every suite that reads it. `review.remove` returns `verdicts` (ids) and `records.verdicts`; this document does not rename them with the record kind, so Phase C must decide. `RENAMED` in `Actions.ts` holds the old action names.

### Phase C: vocabulary, records, file formats and migration (`drr.18.13`)

Changes, in this order:

1. **Fixture first.** Before changing any format, generate `test/catalog/fixtures/migrate-format-1/` with the Phase B toolkit: a project made through the public actions with every record kind (notes on every target kind including a submission part, organization of a unit, asset and project collection, a catalog collection, categories, submissions with views, a before side, captures, a text-only work item with a note on its `decision` part, verdict events whole and per part with part notes and a relay, request ids on each), a version 2 `catalog.config.json` with top-level `options`, a version 1 manifest with a type view and `unitFiles`. Add `test/catalog/fixtures/migrate-config-v1/catalog.config.json` (a version 1 file with `adapter: "manifest"`, `options.manifest`, `previewModules`). Commit the fixtures before anything else.
2. **Record format 2** per "Record changes": `records/layout.ts`, `records/schemas.ts` (`OrganizationRecord`, `DecisionRecord`), `model/types.ts`, `Records.ts` (format marker, format-1 detection), `commands/submit.ts`, `commands/decide.ts`, `commands/organization.ts`, `model/parts.ts` (`item` part), `model/verdicts.ts`, `Projection.ts`, `queries/*`, `published.ts` file names.
3. **Configuration version 3 and manifest version 2** per "Configuration and manifest changes"; removal of version 1 support; `install.mjs`.
4. **Vocabulary:** N1 inspectors, N3 owner, N4 `mediaKinds` (roles and probes), N5 `subject`, N6 `covers`/`origin`, N7 checkout names and `checkout_changed`, N8 wording, facet `role`, routes, default scopes, `#/organization`, N9 `brief`/`partComments`, the result and input renames table rows marked C, S1 Ref and comparison objects, X2's new reserved list.
5. **`jam catalog migrate`** per "The migration command".
6. Every caller and example on the new formats: `catalog/web/*.js`, `src/jam/catalog/*` (`RunCatalog.ts` problems use `subject`), `examples/plugins/*`, `examples/hollowmere/*` (writes manifest version 2 and configuration version 3), `src/catalog/README.md` references to file formats.

Files most affected: `src/catalog/records/*`, `model/*`, `Records.ts`, `Projection.ts`, `CatalogConfig.ts`, `Plugins.ts`, `plugins/manifest.ts`, deleted `plugins/v1.ts`, `queries/*`, `commands/*`, `action.ts`, `Catalog.ts`, `routes.ts`, `server/app.ts`, `server/Renderer.ts`, `viewerActions.ts`, `plugin.ts`, new `src/catalog/migrate/*`, `catalog/web/*`, `skills/jam-setup/scripts/install.mjs`, `examples/*`, `schemas/`.

Tests: new `test/catalog/migrate.test.ts` on copies of the fixtures: the dry run lists every change and writes nothing (file tree byte-identical); the migration produces exactly the format-2 tree, version 3 configuration and version 2 manifest expected (moved `organization/` and `decisions/` files, `dc_` ids, `covers`, `partComments`, `checkout`, `brief`, part `item` in every cross-reference, migrated binding action names, `format.json`); after it, `problems` is empty and `review.get`, `unit.get`, `note.list` and `inbox` answer with the same verdicts, notes and changed flags as the format-1 project did before migration (expected values recorded from the fixture with the Phase B toolkit); a second run reports `changes: []`; a dirty `.catalog/` is refused with exit 1 and accepted with `--force`; a format-1 file added beside a migrated tree is reported as a problem by the engine and migrated by a new run; the version 1 configuration migrates with warnings for `previewModules`. Engine tests: an unmigrated `.catalog/` fails every action `unsupported` with the migrate fix; version 2 configuration and version 1 manifest fail likewise. Updated suites: `plugins.test.ts` (inspectors, `mediaKinds`, `subject`), `browser-views.test.ts` (`inspector:<key>`, `viewer.control { inspector }`, state `kind: "inspector"`), `context.test.ts` (`checkoutKey`, `checkout_changed` with `details.checkout`), `http.test.ts`, `search.test.ts` (`filters.role`), `browser-captures.test.ts` (comparison objects), `reviews.test.ts` (`covers`, `partComments`, `brief`, `decision`), `notes-records.test.ts` (`owner: "project"`, `organization/`), `browser-scopes.test.ts` (`main`, `material`, `#/assets/a/`), `test/jam/installer.test.ts` (version 3 written; version 2 reported as needing migration; object entry `jam` recognised).

Done when `jam catalog migrate` turns the fixture into the expected format-2 project and a second run changes nothing; from the toolkit root `grep -rnE "\"adapter\"|kind: 'view'|'view:|\"view:|context_changed|context\.(key|branch|head)|partNotes|labels/|verdicts/|\bvd_|#/files|#/organize|section: \"assets\"|\"content\"" src/catalog catalog/web src/jam/catalog` finds only lines in `src/catalog/migrate/` and the format-1 detection in `Records.ts`; the browser suites pass; both test commands pass; the phase is committed.

#### Phase C notes

- **Fixtures.** `test/catalog/fixtures/migrate-format-1/` and `migrate-config-v1/` were made with the toolkit at `8c4197d` (a script outside the repository ran its public actions and committed nothing else) and committed before any format change. `migrate-format-1.answers.json` beside them holds what `8c4197d` answered for a fresh commit of that tree (`review.get` of every submission, `unit.get` of every unit, `collection.get`, `note.list`, `inbox`, `organization.list`, `problems`); `migrate.test.ts` compares the migrated project's answers with it through one normaliser that maps the old names. No request binding the old toolkit could write carries a renamed action (records with bindings are made only by actions the rename table does not touch), so the binding rename is tested on crafted records in the planner test.
- **`review.remove`** returns `decisions` (ids) and `records.decisions`, named after the record kind (decided with the user; this document left it open).
- **`asset.get` `verdicts[]` rows** were not in the rename table but held `event` (a decision id) and `note` (a part comment), which the glossary forbids on every surface. Smallest consistent fix: `event` → `decision` (as in part review entries) and `note` → `partComment` (one entry of `partComments`).
- **The work item's part** is renamed `decision` → `item`; its label stays "Decision" (labels are frozen text, and this document names no new one).
- **Comparisons in the page address.** The page's own `?cmp=` parameter carries the comparison object as JSON (`JSON.stringify({ a, b? })`), so the `~` grammar is gone from the page as well as from the API.
- **`refOf`** takes `{ item?, part?, leaf? }` flags and builds a closed struct; `review.submit`'s `items[].target` (unit or collection) uses it too. `note.list`'s target filter now also matches `item` and `part` when given. `FrozenRef` and the comparison object live in `viewerActions.ts`, and `evidence.compare` takes the same `Comparison` schema.
- **Format detection.** The regex of format-1 paths is in `Records.ts`; the marker is scanned like a record file so a change to it is noticed. A marker that is not `{ "format": <n> }` fails `malformed` ("restore it from Git"); a marker newer than 2 fails `unsupported` ("update the toolkit"). The marker is written by `Records.apply` with the first record (not by an evidence or machine-local write).
- **A version 1 manifest** is a problem of the `manifest` source (subject the file, recovery `run: jam catalog migrate`) rather than a failure of every action: a source's failure never stops the catalog. A version 1 or 2 configuration fails every action `unsupported` (fix `run: jam catalog migrate`).
- **Migration details this document left open.** The dry run does not run the dirty check (it writes nothing). The request journal is deleted only when something else changes, so a second run reports `changes: []` even after new requests. A version 2 option set is moved into the entry of the same name, or into the project module whose file name is that name (`options.storybook` → `./catalog/storybook.ts`): the plugin's own name is not known without loading project code; anything else is dropped with a warning. Unknown top-level keys of a version 1 file (which version 1 ignored) are dropped with a warning. A record present in both forms after a merge is dropped from its old path when both are identical and refused (the report names it) when they differ. A file that cannot be read, or whose migrated form would not decode, refuses with `malformed` and the full report in `details`.
- **Exit 2 for invalid flags** needed a change outside the command: `src/cli/main.ts` now exits 2 for every command-line usage error (it exited 1), matching the README's "exits 2 for invalid input" (an `invalid` ToolError already exited 2).
- **Default scopes** `main`/`material`: jam's recipe types defaulted to the scope id `assets`, so their default (and the recipe schema's description) is now `material`.
- **Plugin options** come from the entry: `PluginRef` is `{ ref, options }`; `Setup.overrides.options` keys by entry (name or path).

- **Installer and templates.** `install.mjs` no longer converts configurations: a new project gets version 3 (`[{ "plugin": "manifest", "options": { "file": … } }, "jam"]`), a version 3 file gets `jam` appended when no entry (string or object) names it, and a version 1 or 2 file is left as it is with `catalogConfig: "needs migration: run jam catalog migrate"` and a next step naming the command. The manifest template `skills/jam-setup/assets/project/catalog.json` is version 2; the `catalog` block of `defaults/migration-v1.json`, used only by the old conversion, is removed. Nothing else in the toolkit writes catalog configuration, manifests or records.
- **The page.** Besides the renames, `viewer.control { select: { compare } }` now opens the comparison (the page ignored `select.compare` before), and a loading comparison reports itself as a loading `compare` viewer so an agent does not take the page as settled. Page wording follows the glossary ("Comment on <part>", "Part comments", "Brief", "Assets", "Unit"); CSS class names (`view-stage`, `part-note`) are unchanged.
- **For Phase D.** Left on purpose: `Plugin.views`/`previews`, the `schema` result's `views`/`previews`, `/project/view/` and `/project/preview/`, `Catalog.viewModule`/`previewModule`, `PluginAction.kind`, viewer state and props `source`, `ScopeDef`, `VerdictResolver`, and the exported type `VerdictRecord` (now an alias of the internal `DecisionRecord`, whose fields are `covers` and `partComments`: a project resolver reading `scope` or `partNotes` breaks already). `views.js` exports `InspectorHost`; `storybook.views.js` still names its renderer "storybook beats view".

### Phase D: plugin, browser and embedding (`drr.18.14`)

Changes:

1. P4 `catalog-plugin.ts`; P1 `src/catalog/contract/*` with `ScopeInput`, `Resolver`, `Decision`; P5 `define*` helpers; P6 public types.
2. A3/S3 `PluginAction.access` (no `kind`), `defineAction` overloads, `ReadActionContext`/`WriteActionContext`, optional `output`.
3. P2 `Plugin.browserModules` only; `schema` result `browserModules`; route `/project/module/<name>`; `Catalog.browserModule(name)`.
4. Browser contract: `shows` only; the control-result rule without `{ error, code }`; reserved control names; `catalog-plugin-web.d.ts`.
5. E1 `CatalogDiagnostics`; E2 documentation.
6. `examples/plugins/*`, `examples/previews/lineup.mjs` and `src/jam/catalog/plugin.ts` on the new contract; examples import `../../catalog-plugin.ts`.

Files most affected: `src/catalog/plugin.ts`, new `src/catalog/contract/*.ts`, `catalog-plugin.ts`, `catalog-plugin-web.d.ts`, `tsconfig.json`, `src/catalog/Plugins.ts`, `Actions.ts`, `Catalog.ts`, `browserModules.ts`, `builtinActions.ts`, `server/app.ts`, `server/Renderer.ts`, `catalog/web/*.js`, `catalog/web/kinds/*.js`, `examples/*`.

Tests: `test/catalog/plugin-contract.test.ts` (a plugin importing `catalog-plugin.ts` loads; a read action's context has no `actor`; a plugin with `views`, `previews` or an action with `kind` fails to load with a problem naming the field); `browser-views.test.ts`, `browser-registry.test.ts`, `browser-preview-integrity.test.ts` (modules under `browserModules`; a throwing controller is refused `invalid`; a kind listing a control named `select` is refused; `viewer.state` reports `shows`); `test/catalog/performance.test.ts` reads `CatalogDiagnostics`; compile-only `test/catalog/plugin-web-types.ts` passes `npm run typecheck`.

Done when `examples/plugins/storybook.ts`, `text-kind.ts` and their web modules use only the new contract and pass their tests, `Catalog` has no `stats`, from the toolkit root `grep -rnE "VerdictRecord|ScopeDef|VerdictResolver|previews:|registerViewer\(|source:" src/catalog/contract src/catalog/plugin.ts catalog/web examples` finds no public use of a retired name, both test commands pass, and the phase is committed.

#### Phase D notes

- **`MediaKindDefinition.controls`.** `registerMediaKind` can refuse a reserved control name only if the definition says which controls its viewer's state lists, and it had no such field. Smallest consistent fix: an optional `controls` (the names its viewer's state lists); `registerMediaKind` throws when one is `session`, `select` or `inspector`, and the kind is listed as a kind problem on the page. The built-in kinds declare theirs. A kind that declares none is not checked: its state exists only at run time, and the page's own inspector host lists `inspector`, so `useViewer` cannot check it.
- **Refusals between the page and the server.** A returned `{ error, code }` is no longer a refusal, so `window.catalogViewer.control` (page-internal) answers `{ ok: true, result }` or `{ ok: false, code, error }`; `Renderer` fails with that code, and a code that is not an error code reads as `invalid`. Any value other than `false` is "handled", `undefined` included (it meant unsupported before). The page's own selection handlers throw as well; `refusal(code, message)` in `controller.js` makes such an Error. The page's internal `registerViewer` is now named `useViewer`, the name the page API already gave it (B2), which also keeps the "done when" grep clean.
- **`schema` `browserModules`** maps each name to its `/project/module/<name>?v=<digest>` address, or to `null` when the declared file is missing (this document says `{ <name>: <url> }`; the old `views` carried `{ url, error }`, the old `previews` names only). Inspectors and panels in `unit.get` keep `{ url, error }`.
- **Plugin action `output`** is published as declared and decoded under `CatalogOutputCheck`; for a write whose output is a `Schema.Struct`, `replayed` is added as for built-in writes (`Written`). Plugin results get no `Linked` treatment: a plugin result carrying a `route` gets `url`/`hint` added and must declare them itself. `defineAction` infers `output`, so `run`'s return type is the output's encoded type.
- **Retired plugin fields** (`views`, `previews`, an action's `kind`) make the plugin fail to load like any broken plugin: the catalog keeps its last good plugins and lists the problem, or, with none yet, every action fails `invalid`. Messages: `plugin <p>: views is no longer read; it was renamed browserModules` (fix: declare inspector, panel and preview modules under browserModules), likewise `previews`, and `plugin <p>: action <a>: kind is no longer read; it was renamed access`. An action without `access`, or whose `output` is not a schema, is refused as an action problem.
- **`Resolver` and `DecisionRecord`.** A plugin resolver is typed on the public `Decision` and returns one of the decisions it is handed; the engine keeps its internal resolver type over `DecisionRecord` and casts the plugin's at registration.
- **`define*` helpers** (`defineSource`, `defineType`, `defineMediaKind`, `defineProbe`, `defineCheck`) are not generic, so an excess or wrong property is reported where it is written; `definePlugin` stays generic, as it was.
- **E1.** `Catalog.layer` and `Catalog.layerWith` build `Catalog` and `CatalogDiagnostics` from one `Layer.effectContext`; `CatalogStats` keeps its name. `catalogWithJam` (`src/cli/compose.ts`) provides both. E2: the README says `CatalogSetup` and `Catalog.layerNoDeps` are toolkit-internal and that `Catalog.layer` must be kept as a value.
- **Names kept.** `catalog/web/views.js` (it hosts inspectors and panels) and `examples/plugins/storybook.views.js` keep their file names: this document names no new ones and neither is an interface. The storybook inspector's renderer is now `storybook beats inspector` (N1).
- **Migration warnings.** A project plugin module's warning now names what the plugin contract changed (import path `tools/jam/catalog-plugin.ts`, `browserModules`, `access`, `shows`); the `previewModules` warning says to declare them under a plugin's `browserModules`.
- **Shipping.** `catalog-plugin.ts` and `catalog-plugin-web.d.ts` are toolkit root files: `install.mjs` copies every bundle file to `tools/jam/` (its test now checks both) and the root `package.json` publishes them through `skills/*/assets/**`. `tsconfig.json` includes both.
- **For Phase E** (the migration guide's plugin and browser module tables): import `../tools/jam/catalog-plugin.ts` (was `../tools/jam/src/catalog/plugin.ts`); `Plugin.views` and `Plugin.previews` → `Plugin.browserModules`; `PluginAction.kind` → `access` (and optional `output`); action context `actor`/`requestId` only on writes (`ReadActionContext`, `WriteActionContext`); `ScopeDef` → `ScopeInput`; `VerdictResolver` → `Resolver`; `VerdictRecord` → `Decision`; new `defineSource`, `defineType`, `defineMediaKind`, `defineProbe`, `defineCheck`; routes `/project/preview/<name>` and `/project/view/<name>` → `/project/module/<name>`; `schema` `previews`/`views` → `browserModules`; `Catalog.previewModule`/`viewModule` → `browserModule`, `Catalog.stats` → `CatalogDiagnostics.stats`; viewer state, viewer props and preview `ctx.source` → `shows`; a refusal is a thrown Error (its `code`, else `invalid`), no longer a returned `{ error, code }`; a `control` returning `undefined` now counts as handled; a media kind may declare `controls`, and `session`, `select`, `inspector` are reserved; browser module types in `tools/jam/catalog-plugin-web.d.ts`. `skills/jam-catalog/SKILL.md` and `docs/` still describe the old contract.

### Phase E: CLI, HTTP, docs and migration guide (`drr.18.15`)

Changes:

1. H1 `jam catalog inbox`; `todo` removed.
2. `src/catalog/README.md` rewritten to the new names and the glossary: naming rule, `access`/`requires`/`output`, Ref, inspectors, decisions, browser contracts, `checkoutKey`, formats (`.catalog/format.json`, configuration version 3, manifest version 2), `jam catalog migrate`, the capture wording (N2), the changed-since rule, the `"type": "module"` note, every drr.18.9 point.
3. **Migration guide** `docs/catalog-migration.md` (shipped as `tools/jam/docs/catalog-migration.md`): when to run `jam catalog migrate` and what it changes; then, for plugin authors, old → new tables for the import path, plugin fields (`views`/`previews` → `browserModules`, `kinds` → `mediaKinds`, `kind` → `access`, type and unit `views` → `inspectors`, `ProblemInput.source` → `subject`, `scopes` default ids), exported types (`ScopeDef`, `VerdictResolver`, `VerdictRecord`, `AdapterFactory` removed), action names a plugin may `run` (the full rename table), result fields it may read (the result-rename table), browser modules (`source` → `shows`, control results, `view` → `inspector` commands, routes), and version 1 adapters rewritten as plugins. Every row of this document's rename tables appears in it.
4. `skills/jam-catalog/SKILL.md` and `docs/external-content.md` (and any other skill or doc naming catalog actions, fields, routes or files) use the new names; SKILL.md says `jam catalog inbox` and that an `unsupported` error naming the format is fixed with `jam catalog migrate` after asking the person (it rewrites tracked files).
5. Regenerate `schemas/` and `docs/cli.md` with `jam schemas write`.

Files most affected: `src/catalog/README.md`, `src/catalog/cli.ts`, new `docs/catalog-migration.md`, `skills/jam-catalog/SKILL.md`, `docs/external-content.md`, `schemas/`, `docs/cli.md`.

Tests: `test/catalog/cli.test.ts` (`inbox` works, `todo` is an unknown command); `test/jam/schemas.test.ts` (generated files up to date).

Done when from the repository root `grep -rnE "catalog\.search|notes\.list|reviews\.list|locks\.list|collections\.membership|organize\.(set|bulk)|jam catalog todo|type views?|partNotes|verdict event|context_changed" skills --include='*.md'` finds only lines in `docs/catalog-migration.md`; the guide covers every row of the rename tables; drr.18.9 is closed; both test commands pass; the phase is committed.

#### Phase E notes

- **H1.** `jam catalog inbox` prints what `todo` printed; `todo` is an unknown command (exit 2). H2 needed no change.
- **Single source for the migration.** The guide (`docs/catalog-migration.md`) holds how to run `jam catalog migrate`, what it does and cannot do, and every old → new name. The README keeps what the catalog reads and how an older file is reported, and points to the guide for the rest; its list of old action names moved there.
- **The installer** also reports a project whose configuration is already version 3 or missing but whose manifest or records need migrating (since the review fixes, through `catalogMigration`); `jam-setup`'s upgrade step points to the guide, which holds the rule to ask the person first.
- **`storybook.views.js` → `storybook.web.js`**, matching `text-kind.web.js` (a plugin's browser module); the glossary keeps "view" for submission views. The page-internal files `catalog/web/views.js` and `organize.js` keep their names: they are not interfaces.
- **drr.18.16.** `test:jam-toolkit` ran `npm ci`, which empties `node_modules/` and with it the launcher's install stamp `.jam-installed`; tests that run `jam.mjs` with `JAM_NO_INSTALL=1` (the installer suite) then found the toolkit "not installed". The script now installs through the launcher (`node jam.mjs --version`), which runs `npm ci` only when the stamp does not match the lockfile and writes the stamp. The launcher's `JAM_NO_INSTALL` fix line now says to run a jam command once instead of a bare `npm ci`, which had the same flaw.
- **Gaps left at Phase E, closed by the review fixes.** The migration now rewrites a manifest type's old default scope, and old keys in source outputs, enrich patches and version 2 manifests are each reported as a problem (see Review fixes).
- `jam schemas write` changed nothing: `docs/cli.md` covers the `jam` commands only, and no published schema changed in this phase.

### Review fixes (`drr.18.17`)

The code review of `2beba30..2e13280` found eighteen defects; each is fixed with a test. Choices the review left open:

- **Old default scopes.** `migrateManifest` rewrites a type's `scope` `assets` → `material` always (`assets` is a reserved section id, so no plugin scope can have it) and `content` → `main`; when the configuration lists project plugin modules, which may define a scope `content`, it still rewrites and warns naming `types.<key>.scope`. This applies to version 2 manifests too.
- **Old keys in plugin data** (`src/catalog/model/retired.ts`). One problem per key: `<field path> is now <new key>` (`types.thing.views`, `types.thing.roles[0].kinds`, `units[0] (thing/a).views`, `problems[0].source`; a patch's units by id, `units["thing/a"].views`). A source's are reported with the source's name as subject, an enrich patch's with `plugin <p>`, recovery `rename it; docs/catalog-migration.md lists every renamed key`. The `manifest` plugin reports its own (subject the file, recovery `run: jam catalog migrate`) and leaves the old key out, so it is not named a second time. An old key is never read.
- **A key in both forms** during migration (`renameKey`): the same value drops the old key; different values refuse the file naming both field paths, as Phase C does for a record present at both paths. `validatePlan` also refuses a manifest or unit file that would still hold an old key.
- **All-or-nothing writes** (`migrate/apply.ts`). Every file is staged beside its target; then each existing target and each removed file or folder is renamed aside (`<name>.<uuid>.bak`) and the new file moved in. A target that is not a regular file fails the step. On any failure every step is undone in reverse, staged files are discarded and folders made for new files are removed; the error (`unavailable`) names the file that failed, lists every planned file in `details.files`, and names any file that could not be put back. The set-aside copies are deleted only after every step succeeded.
- **Refusals in the report.** A file or folder `gather` cannot read (a symbolic link, permissions) is an entry of the plan's errors, so it ends in the `malformed` refusal with the report in `details`, dry run included.
- **Dirty check.** It asks Git only about the files the plan changes (each change's file and move target; the machine-local journal excepted), as literal pathspecs, and strips `git rev-parse --show-prefix` so paths read from the project folder.
- **Summary line.** It names what changed (`catalog.config.json to version 3`, manifest and unit files, `.catalog/ from format 1 to 2` or changes under `.catalog/`); a dropped version 1 `$schema` is a warning; `options.manifest` is read with or without `./`.
- **Plugin write outputs.** `replayed` is added to each member of a `Schema.Union` of structs; a write whose output is neither a struct nor a union of structs is refused as an action problem.
- **Installer.** It uses the installed toolkit's own detection: when the toolkit's packages are usable it runs `jam catalog migrate --dry-run --json` after installing and reports `catalogMigration` (`current`; `needs migration: run jam catalog migrate`; `dry run refused: <why>`; or `not checked` without packages). `catalogRecords` and the manifest version check are gone; a `catalog.config.json` that is not version 3, or does not parse, is `left as it is`. Its only format knowledge is the version 3 file it writes for a new project.
- **Shared helpers.** `hasConflictMarkers` lives in `src/catalog/records/files.ts`; `DEFAULT_MANIFEST` in `src/catalog/plugins/manifest.ts`; `infoOf`, `ActionInfo` and `Requirement` in `src/catalog/action.ts` (`Actions.ts` re-exports the types), so `viewerActions.ts` builds its listing without importing the registry.
- **`ActionMap` is derived** (supersedes E3's hand-written map). `read` and `write` return `TypedActionDef<Name, Input, Output>` with a literal name; `builtinActions` and `VIEWER_ACTIONS` (`as const satisfies`) are left unannotated; `ActionMap` is a key-remapped mapped type over both. `ACTION_NAMES` and its sync test are removed; a type-level check fails the typecheck if a name widens to `string`.
- **Viewer state contract.** `ViewerState.viewer` is `ShowingViewer`: required `kind` (string or null), `status`, `error` (string or null), `shows` (object or null) and `controls`, plus any other keys. The page's controller fills `error`, `shows` and `controls` when a kind's state leaves them out (the web types keep them optional for kinds), and an inspector's state defaults to `status: "ready"`.
- **Duplicate browser module names** go through `firstByName`: the first declaration wins and the second is a problem `plugin <p>: browser module <name> is already registered by <q>`.
- **The consent rule** ("ask the person before migrating") is written once, in step 1 of the migration guide; both SKILL.md files point to the guide.
