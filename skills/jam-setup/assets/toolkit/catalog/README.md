# Content catalog

A local browser application and agent interface for browsing a game's content, inspecting its visual assets, organizing it, keeping notes, and recording review decisions. It reads the current checkout (branch and uncommitted files included) through a project adapter. Its own records are plain files under `.catalog/` that travel with Git. The package is project-independent; this repository uses it through the jam toolkit.

## Run

Requires Node.js 22.20+ and Git. Install once:

```sh
npm ci --prefix tools/jam/catalog --ignore-scripts
node tools/jam/jam.mjs catalog serve            # this repository (jam adapter), http://127.0.0.1:4600/
node tools/jam/catalog/bin/catalog.mjs serve --root <project> --port 4601
node tools/jam/jam.mjs catalog serve --detach   # background process that outlives this shell
```

`serve` runs in the foreground and stops with its terminal. `serve --detach` starts the same server as an independent background process, waits until it is listening, then prints the URL, process ID, log path and a stop command (`node -e "process.kill(<pid>)"`). Agents start the catalog for a person this way, so ending the agent session leaves it serving. If the server fails to start, the command exits non-zero with the server's error.

The server listens on 127.0.0.1 only. Viewer captures need a headless Chromium: Playwright's own (`npx --prefix tools/jam/catalog playwright install chromium`) or an installed Google Chrome. Everything else needs no browser.

Sample project for trying the tool or for acceptance testing (needs a browser; ffmpeg adds video clips):

```sh
node tools/jam/catalog/bin/catalog.mjs example /path/to/empty-dir
node tools/jam/catalog/bin/catalog.mjs serve --root /path/to/empty-dir
```

It creates "Hollowmere", a separate Git repository with procedural art, two art passes, review records created through the public actions, and some uncommitted work. A real project catalog never contains it.

## Configuration

`catalog.config.json` at the project root (versioned project policy):

```json
{ "version": 1, "adapter": "manifest", "options": { "manifest": "catalog.manifest.json" },
  "review": { "resolver": "latest", "verdicts": ["approved", "changes", "rejected"] } }
```

- `adapter`: `manifest`, `jam`, or a project-relative module path (`./tools/my-adapter.mjs`). Adapters are trusted project code; the content they read is data.
- `review.resolver`: `latest` (default) or `strictest`. `review.resolverModule` may name a project module exporting `(eventsAddressingPart, partId) => deciding event`. Resolvers change the displayed projection only, never event files.
- `previewModules`: `{ "<name>": "./path/module.mjs" }`, the project's own collection preview modules (see below).
- The running server follows the checkout. When the configuration or a project module changes (for example after a branch switch), the adapter, options, resolver and preview modules are reloaded, and changed modules are imported again.

## Adapters

An adapter module default-exports `({ root, options }) => ({ sources(), load() })`. `sources()` lists project-relative files or folders whose changes trigger a reload. `load()` returns:

```js
{ project, schema: { types, collectionKinds }, assetRoots: ['art'], assets: [{ id, path, kind?, label?, tags?, category? }],
  units: [{ id, type, name, attrs, links: [{ role, asset }], aliases?, search?, sources?, tags?, category?, explain? }],
  collections: [{ id, name, kind?, members: [{ unit, ...extra }], tags?, category? }], problems: [{ source, error, recovery? }] }
```

- A **type** has `label`, `fields` (`key`, `label`, `kind`: text|number|enum|refs, `unit?`, `help?`, `group?`, `derived?`), `roles` (`key`, `label`, `kinds` ⊂ image|video|model, `many?`, `expected?`) and `thumb` (the role used for thumbnails). Content identity is the unit `id`, never an asset format. Fields marked `derived: true` are live facts displayed alongside content; they are excluded from reviewable attribute evidence. A many-role link may supply a stable `key` (unique within that role) so a file move preserves the review part's identity; without it the asset id is the key. A unit can link any number of visuals in its type's roles.
- A **visual asset** is its own entity (`id`, repository `path`), shared by every unit that links it. Paths are confined to `assetRoots`, symlinks included; `.git` and `.catalog` paths are never assets. Supported bytes: PNG, JPEG, WebP, GIF, MP4, WebM and self-contained GLB, validated by content, not extension. A GLB that references external buffers or images, `.gltf` files and other formats are reported as unsupported.
- **Collection kinds** may declare `memberField`, `memberExtra` and a `preview`: `module`, `label`, `roles` (member visual roles used, default `model`), `base` (an asset id), `config` (any object) and `represents` (`complete` or `representative`). The built-in module `assembled-mesh` shows member models in one shared space over the grey base. A project adds its own module by naming it in `previewModules`. The module default-exports `(ctx) => markup` and receives `ctx.html`, `ctx.viewers` (`ModelViewer`, `ImageViewer`, `VideoViewer`), `ctx.members` (`[{ unit, part, role, asset: { url, kind, sha256, state } }]`), `ctx.base`, `ctx.config`, `ctx.label`, `ctx.viewerId` and `ctx.source`. Passing `viewerId` and `source` to the viewer gives people and agents the same controls and state. `ModelViewer` accepts URL strings or `{ url, position, rotation, scale }` placements. [examples/previews/lineup.mjs](examples/previews/lineup.mjs) is a complete example.
- Tags and categories supplied by the adapter are project-owned and read-only in the catalog. Organization made in the catalog is stored separately.

**Manifest adapter** (`catalog.manifest.json`): `{ version: 1, project, assetRoots, types, collectionKinds, assets, units, unitFiles, collections }`. `unitFiles` lists folders whose `*.json` files each hold one unit (or `{ "units": [...] }`). A malformed file becomes a scoped problem; the rest of the catalog stays.

**Jam adapter** (`adapters/jam.mjs`): one unit per game asset id (`run.id`), discovered from `Art/**/run.json`. A run is one recorded workflow attempt, not a content identity. The newest run by creation time supplies the current concept images, five turnaround views, stage models and visual evidence; ties prefer `Art/Assets`, then the run path. All run paths are listed in sources, current first. A newer scratch candidate remains visible over an older delivery. Notes and verdicts stay with the asset across run transitions; frozen bytes preserve exact review history. Multiple concept/evidence images use stable role slots, so copying files into a delivery does not discard their review parts (reordering or replacing bytes marks them changed).

Stage models link the recorded `runtimeModel` only when it is a GLB; another source GLB is never substituted. Stage status comes from `tools/jam/core.mjs` `stageStatus`; it and custody, profile, creation time, checkpoints and provider/job facts are derived fields, not reviewable content. Measurements remain reviewable. Malformed runs are reported individually. The catalog never writes jam records, and a catalog verdict is not a jam decision. Style hero shots remain in the art-direction library outside the catalog.

## Records (`.catalog/`)

| Path | Record | Mutability |
| --- | --- | --- |
| `notes/<id>.json` | Standalone note: target (unit, collection, asset, or submission item/part), text, author, disposition | Edited with expected revision |
| `labels/<kind>/<key>.json` | Category and tags of one unit, asset or project collection | Edited with expected revision |
| `collections/<key>.json` | Catalog-owned collection: name, kind, category, tags, ordered member references | Edited with expected revision |
| `categories.json` | Registered category paths | Edited with expected revision |
| `reviews/<sub>/submission.json` | Submission: items, frozen parts with evidence, views (captions, cameras, optional before side), context | Immutable |
| `reviews/<sub>/verdicts/<event>.json` | One verdict event: scope, verdicts, comment, optional notes per decided part, author, time | Immutable |
| `evidence/<aa>/<sha256>.<ext>` | Content-addressed frozen bytes (dirty or untracked files, definitions) | Immutable |
| `.local/` (Git-ignored) | Locks, request journal, captures | Machine-local |

- Identities are random and time-ordered (`nt_`, `sub_`, `it_`, `vw_`, `vd_`), so records from different branches merge without collisions. Short references (`R5DAZA`) are the last six characters.
- Every operation validates its whole input and every record it would produce before any file changes. Operations spanning several records (bulk tagging, category and tag renames, deletions) are validated as one unit and then committed together; a failure leaves no partial edit. Files are replaced atomically. Mutable records carry `revision`; a stale `expectedRevision` fails with `conflict`, and the current record is returned so the caller can merge. Writers take a short lock under `.local/locks`. A lock left by a crashed process is never removed automatically; `unlock` removes it only after verifying that its process has exited on this machine.
- A write may carry a `requestId`. The replay check and the mutation run under one lock, so simultaneous retries record once. A repeat returns the first result. Reusing the id with a different action, input or actor, or in another branch or worktree context, fails with `conflict`. Creation and verdict records retain this binding so recovery after a lost local journal cannot replay another checkout's work.
- Paths under `.catalog` (records, evidence, locks, journal, captures) are read and written without following symbolic links. Every record, including nested evidence references, is type-checked; anything else is excluded as a scoped problem.
- Browser writes carry the checkout context they were prepared in. After a branch switch they fail with `context_changed`, and drafts stay with the old context.
- Malformed or Git-conflicted records are listed as problems and excluded; every other record is used.

## Reviews

- A **submission** freezes its items when created. Each unit item has one part per linked visual (the role key for single roles, `role:key` for many roles, defaulting to the asset id) plus `attributes`. Each collection item has `member:<unit>` per member, and `preview` when its kind declares one. A submission may select parts. Only the selected parts' dependencies are frozen: a member part freezes that member; a preview part freezes its member inputs, base, module name, config and roles. Views are captioned and may carry a camera and viewer state (`mode`, `animation {clip, time, playing}`, `isolate`, `texture`); several views can show one part. The submission note is Markdown; the review page renders it sanitized to formatting only (paragraphs, headings, emphasis, lists, quotes, code, tables and links). In the browser, the submit dialog for a single target sets the title, note, parts, views (with "Use current view" to capture the live camera and state) and the submission it replaces. A bulk submission of several targets sets the title and note, and each item gets default parts and views; custom views per item use the API or CLI.
- **Before/after views.** When a change is best judged against what came before, a view may carry `before`: either `{ "path": "<project file under the asset roots>" }` or earlier frozen evidence `{ "submission", "item", "part", "leaf"? }`, plus an optional `label` (default "Before") and the view's `afterLabel` (default "After"). Both sides must be the same kind of media; a preview or attributes view has no single media to compare. The before side is frozen like part evidence but is not a reviewable part. The review page shows the pair as a comparison (images: divider, toggle or side by side; models: side by side with linked cameras or overlay, opened at the view's camera; videos: side by side). Set it through the API or CLI.
- A preview needs every declared input: member visuals in its roles and its base. If one is missing, the preview is an error and cannot be captured. A frozen preview runs only the project module revision it was submitted with (pinned by SHA-256). If the module has changed or is gone, the frozen preview reports that and is not rendered. The preview's evidence digest includes the module identity, so a module change marks verdicts as changed.
- Evidence records the SHA-256 of every byte stream. Files committed and unchanged at HEAD are referenced as Git blobs (Git LFS objects are read from the local LFS store). Anything dirty or untracked is copied into `.catalog/evidence`. Reads verify the digest. A missing Git object, missing LFS data or changed bytes are reported as such; current content is never substituted.
- A **verdict event** is `whole` (every frozen part; one verdict plus explicit exceptions, so "approve except the boots" is one atomic record) or `parts` (only the named parts). Verdicts are `approved`, `changes` and `rejected`. An event's `comment` covers the whole decision; `partNotes` (`{ "<part>": "text" }`) attach a note to individual parts the event decides, and a note on a part without a verdict in that event is refused. Review views show each part note with its part and verdict. Feedback without a verdict is a note on the submission, item or part.
- **Projection.** A unit's or collection's current status per part comes from the configured resolver over every event whose item targets it. Ordering is recorded UTC time, then event id. Verdicts never cascade between a collection and its members, or between units sharing an asset. Parts that appear later stay undecided. When current content differs from the evidence a verdict saw, the part is marked *changed* and links to a comparison; nothing is reset or created automatically.
- The catalog's **Review** button validates the decision first. It then records against a still-waiting item whose frozen evidence equals current content, or otherwise submits the current content as a new one-item submission. Revising a decision on an already decided item happens in that item's review view.
- Reopening a view restores its camera and viewer state. Anything the evidence cannot honor (a missing clip, mesh or texture) is shown and reported in the viewer state, never silently replaced.
- **Evidence retention.** Nothing is pruned automatically and there is no cleanup command. Deleting files under `.catalog/evidence` is an ordinary Git change; affected views then report missing evidence while verdict history stays readable.

## Humans and agents

Every operation is an action with an input schema. `catalog actions` and `GET /api/actions` list them.

```sh
node tools/jam/jam.mjs catalog run catalog.search --input '{"q":"helm","filters":{"type":["gear"]},"page":1}'
node tools/jam/jam.mjs catalog run note.create --actor-kind agent --actor-name my-agent --request-id n-1 \
  --input '{"target":{"kind":"unit","id":"gear/helm","part":"model"},"body":"Visor reads thin"}'
node tools/jam/jam.mjs catalog run review.decide --actor-kind agent --actor-name my-agent \
  --input '{"submission":"sub_…","item":"it_…","whole":"approved","exceptions":{"member:gear/boots":"changes"}}'
node tools/jam/jam.mjs catalog capture --target unit:gear/helm --part model --mode clay --camera '{"position":[1,2,3],"target":[0,1,0]}' --out helm.png
```

- Writes must declare their actor (`--actor-kind human|agent`, `--actor-name`). Attribution is a declaration, not proof of identity. The browser acts as the local Git user.
- HTTP: `POST /api/run/<action>` with `Content-Type: application/json`, `X-Catalog-Request: 1` and a body of `{ input, actor, requestId }`.
- Viewer actions (`viewer.open`, `viewer.state`, `viewer.control`, `viewer.capture`, `viewer.close`) drive the same UI viewers in headless Chromium. State reports readiness, the exact asset digest or submission view shown, camera, surface mode, animation clips, meshes and textures, and supported controls.
- A missing part, item, view, collection member or version named explicitly is an error for people and agents, never a substitute. An empty selection opens the first one.
- `viewer.capture` refuses unless the viewer is ready and shows exactly the requested selection and bytes. It returns the PNG (under `.catalog/.local/captures`) and identifies itself as a catalog render, not a native-game capture.

## Security

Loopback binding. Host and Origin validation (no DNS rebinding or cross-origin writes). Writes require the custom request header and JSON content type. Request bodies are limited to 1 MiB. Static, vendor and media serving is confined to fixed folders and declared asset roots after resolving symlinks. Evidence is read only through complete, digest-named references inside `.catalog/evidence`, without following links. Project preview modules are served only when declared in `catalog.config.json`. Media types are sniffed from bytes. Responses carry `nosniff` and sandboxing CSP headers, and the page has a strict CSP. Submission notes are rendered as Markdown with marked and then sanitized by DOMPurify to an allowlist of formatting tags and `href`/`title` attributes (no raw HTML, images, styles, handlers or `javascript:` links); external links open in a new tab without a referrer. Other note, comment and label text is rendered as text. Repository credentials, `.git`, configuration and machine-local state are never served.

## Tests

The catalog's test suite ships with the jam-setup skill's source (`skills/jam-setup/assets/toolkit/catalog/test/` in the furanku-skills repository), not with the copy installed in a project; run it there with `npm test`.
