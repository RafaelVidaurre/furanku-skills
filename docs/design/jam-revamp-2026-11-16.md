# Jam skills revamp: design

Date: 2026-11-16. Tracking: `furanku-skills-drr`.

This is the design for the second version of the `jam-*` skills and the toolkit they share. It applies what a game jam taught (an Unreal Engine 5.9 project, 2026-11-05 to 11-16), where an earlier, project-specific copy of these skills was used by about 420 agent sessions.

## 1. What the jam showed

Counts come from all 421 session transcripts of that project and its Git history.

| Finding | Evidence | Consequence here |
|---|---|---|
| Every workflow was derived live, then written up | No reusable definition existed before the first run of prop, character, outfit, sound batch or dialogue work. Workers re-derived the CLI each session (`--help` first in 23 of 44 sessions). `jam-retopo`, `jam-uv`, `jam-texture` were never loaded | Recipes (§4): written, checkable, project-owned workflows |
| The run record was learned by trial and error | `register` failed 34% of calls, `review` 25%; 261 of 722 calls piped hand-written JSON through a heredoc | Typed flags, the recipe supplies the schema (§5) |
| Gates were rubber-stamped or skipped | 138 of 152 decisions were accept; 92 "human" reviews were typed by an agent relaying a chat answer; on deadline day the ledger was dropped | One review system; human approval is the person's own click or an honestly labelled relay; a crunch switch that keeps provenance (§5.3) |
| Narrow staleness matters | Adding one style image "instantly broke all four character deliveries" | Staleness binds to explicit revisions only (§5.2) |
| Stages, providers and the art folder were literals | `STAGES`, `Art/`, `meshy`/`scenario` in `core.mjs`; audio tools reimplemented spend, provider auth, atomic writes and loudness separately | Declarative recipes, a provider registry, configurable paths, one ledger (§5, §6) |
| Engine facts were duplicated and drifted | A profile said `forward: "+X"` while deliveries faced −Y; Unreal scripts lived inside the character skill | Engine adapters own conventions and engine commands (§7) |
| The catalog had one seam | One adapter per project. The project deep-imported engine internals, mutated units to fake reverse references, wrote measurements into source files, retyped units to get domains, and ran its own doctor script | Catalog plugins with eight extension points (§8) |
| Four review systems, two servers | Catalog verdicts, run gates, `"review"` marks in data, contract status; the scene tool ran a second server | The run gate reads catalog verdicts (§5.3) |
| Catalog server ergonomics | 72 `serve` calls on 12 ports; worktrees kept alive for it; "give me the review link" asked repeatedly | Detached singleton per checkout, automatic port, links in every result (§8.6) |
| Provider waits dominated wall time | A 429 with "wait 2298 seconds" was read as a queue; a "30 minute" wait was invented | Pacing facts in provider descriptors; skills poll the job and read the stated wait (§6) |

What stays out of scope: build-farm and release management (one integrator, warm release checkout, release timeline). Those learnings are real but belong to host-run and coordination skills, not asset skills. Two rules do transfer and are written into the skills: prefer a still or a state probe over a recording, and poll a provider job instead of sleeping for an invented time.

## 2. Principles

1. **The project owns its workflow.** Shipped recipes are starting points. A project extends or replaces them in its own files and never edits the installed toolkit.
2. **One source for each fact.** Conventions (units, axes, formats, skeletons) come from the engine adapter. Budgets come from config. Step order, required outputs and gates come from the recipe. Spending units come from the provider descriptor.
3. **No assumed machine.** No fixed folders, shells, operating systems, engines or providers. Commands take argv arrays and project-relative forward-slash paths.
4. **The tool carries the schema.** An agent states facts with flags; the tool measures, hashes and validates. No hand-written JSON records.
5. **Honest records.** Who decided, through which channel, is recorded as it happened. A person's approval comes from the catalog, or is marked as relayed with the quoted words.
6. **Cheap by default.** One still before a clip. Reuse another agent's evidence unless it is missing, stale or contradicted. A crunch mode lowers gates without losing provenance.
7. **Extend through seams.** Engine, provider, recipe, check and catalog plugin are named contracts with published JSON Schemas.

## 3. Layout

Installed by `jam-setup` (default `tools/jam/`, recorded in `jam.config.json` as `toolkit`):

```
tools/jam/
  jam.mjs            dependency-free launcher: installs missing npm packages once, then runs src/cli/main.ts
  package.json       one package, one lockfile
  src/kernel/        errors, project files, Git, ids, clock, process, JSON store
  src/catalog/       catalog engine (no dependency on src/jam)
  src/jam/           config, recipes, runs, ledger, providers, engine host, audio
  src/cli/           command tree
  catalog/web/       browser UI (plain ESM, no build)
  recipes/           shipped recipes
  providers/         shipped provider descriptors
  engines/           shipped engine fact presets
  schemas/           generated JSON Schemas for every authored file
  docs/              reference the skills point to
```

Project-owned (never overwritten by an upgrade):

```
jam.config.json        project policy (tracked)
jam.local.json         machine paths: python, blender, ffmpeg, engine (ignored)
catalog.config.json    catalog plugins and review policy (tracked)
jam/recipes/*.json     project recipes
jam/engines/<id>/      engine adapters installed into or written for the project
jam/providers/<id>.json  provider descriptors the project adds
jam/catalog/*.ts|mjs   project catalog plugins
.catalog/              catalog records (tracked) and .catalog/.local (ignored)
```

Sources are TypeScript run by Node's type stripping (Node ≥ 22.20, no build, no flags). Effect is pinned to 4.1.4 with deep imports (`effect/Effect`), which halves start-up. `@effect/platform-node` supplies the Node layers. Tests run with `node --test`.

## 4. Recipes

A **recipe** is a named, ordered set of steps that turns a brief into a delivered piece of content. The word avoids "pipeline", which Unity and Unreal both use for their own import machinery. A **run** is one attempt of a recipe for one subject id.

```json
{
  "$schema": "../../tools/jam/schemas/recipe.schema.json",
  "version": 1,
  "id": "prop",
  "title": "Static prop",
  "description": "From a brief to an engine-ready static prop.",
  "extends": "builtin:asset",
  "budget": "prop",
  "roots": { "scratch": "Art/.scratch", "delivered": "Art/Assets" },
  "steps": [
    { "id": "concept", "title": "Concept image", "skill": "jam-concept",
      "produces": [{ "role": "concept", "kind": "image", "min": 1 }],
      "review": "human" },
    { "id": "turnaround", "needs": ["concept"], "skill": "jam-turnaround",
      "produces": [{ "role": "view", "kind": "image", "keys": ["front", "left", "back", "right", "three-quarter"] }],
      "checks": ["turnaround-views"], "review": "human" },
    { "id": "mesh", "needs": ["turnaround"], "skill": "jam-model", "paid": true,
      "produces": [{ "role": "model", "kind": "model", "min": 1 }], "review": "agent" },
    { "id": "topology", "needs": ["mesh"], "skill": "jam-retopo",
      "produces": [{ "role": "model", "kind": "model", "max": 1 }],
      "checks": ["budget-geometry"], "review": "agent" },
    { "id": "uv", "needs": ["topology"], "skill": "jam-uv",
      "produces": [{ "role": "model", "kind": "model", "max": 1 }], "review": "agent" },
    { "id": "texture", "needs": ["uv"], "skill": "jam-texture",
      "produces": [{ "role": "model", "kind": "model", "max": 1 }],
      "checks": ["budget-texture"], "review": "agent" },
    { "id": "import", "needs": ["texture"], "skill": "jam-engine", "optional": true,
      "run": ["engine", "import", "--kind", "static"],
      "checks": ["engine-inspect"], "review": "none" },
    { "id": "delivery", "needs": ["texture"], "review": "human",
      "checks": ["budget-geometry", "budget-texture", "delivery-closure"] }
  ]
}
```

Step fields:

| Field | Meaning |
|---|---|
| `id`, `title` | Stable id (`a-z0-9-`) and display name |
| `skill` | The skill that knows how to do the step. Optional |
| `guide` | Document (with optional `#anchor`) holding instructions for this step in this recipe: a project-relative path, or `toolkit:<path>` for one shipped with the toolkit |
| `run` | A jam subcommand (argv) that performs the step unattended. `{run}`, `{id}`, `{dir}` are substituted |
| `needs` | Steps that must be accepted first |
| `produces` | Output roles: `role`, media `kind`, and `min`/`max` or fixed `keys` |
| `checks` | Named checks that must pass when the step is recorded and whenever status is read (§5.4) |
| `review` | `human`, `agent` or `none` |
| `paid` | The step may open provider jobs |
| `optional` | The step may be skipped with a recorded reason; later steps treat a skipped step as satisfied |
| `when` | A condition for the step to apply: `{ "engine": "<command>" }` (the adapter provides that command) or `{ "budget": { "kind": "deforming" } }`. A step whose condition is false is skipped automatically with the reason recorded |

Resolution: a project recipe with the same id shadows a shipped one. `extends` names a base (`builtin:<id>` or a project id); steps merge by id, a child step object replaces fields it names, `"remove": true` drops a step, and new steps are placed with `"after": "<step>"` (default: end). Cycles and unknown `needs` are errors at load.

Shipped recipes: `asset` (concept → turnaround → mesh → topology → uv → texture → delivery), `prop` (asset plus optional collision and import), `character` (asset plus rig and deformation evidence), `image` (concept only, for exploration), `sfx` (generate → process → import), `voice-line` (voice → process → import).

Commands:

```
jam recipe list
jam recipe show <id> [--json]          resolved steps, with where each field came from
jam recipe check [<id>]                validate every recipe: schema, needs, checks, skills, guides exist
jam recipe new <id> [--extends <base>] scaffold jam/recipes/<id>.json
jam recipe set <id> <step> --review human|agent|none | --guide <path> | --optional true|false
jam recipe capture <run-id> --as <id>  write a recipe from the steps a finished run actually recorded
```

`recipe capture` is how a workflow that was just improvised becomes repeatable: the jam's skills were all written that way, by hand.

## 5. Runs and the ledger

### 5.1 Commands

Runs are addressed by subject id. The run file is `<scratch root>/<id>/<n>/run.json`; `jam run where <id>` prints it. Ids resolve by scanning the configured roots, newest run first.

```
jam run start <recipe> <id> --brief <file> | --brief-text "..." [--budget <name>] [--human <steps>] [--dir <path>]
jam run next [<id>]            the next step that can be worked: skill, guide, needs, required outputs, gate, checks
jam run status [<id>] [--json] every step with state and reason; without an id, every open run
jam run record <id> <step> [<step> ...]   several steps when one operation produced them all
      --file [role[:key]=]<path> ...   outputs (role defaults when the step has one role)
      --evidence <path> ...            what a reviewer looks at
      --input <path> ...               what the step consumed beyond its needs
      --note "<what was done or why existing files suffice>"
      --tool "<tool and version>" | --job <job> | --source <url> --source-evidence <path>
      [--accept "<reason>"]            agent self-review, when the gate allows it
jam run skip <id> <step> --reason "..."
jam run review <id> <step> --accept | --revise | --reject --reason "..." [--relay "<channel>: <verbatim words>"]
jam run request-review <id> <step>     submit to the catalog; prints the review link
jam run deliver <id>                   copy the accepted closure into the delivered root and verify it
jam job open <id> <step> --provider <p> --operation "..." --estimate <n> --request <file> [--quote | --list-price] [--price-source "..."]
jam job submitted <id> <job> --provider-job <ref>
jam job done <id> <job> --actual <n> --evidence <path> | jam job failed|cancelled ... | jam job lost <id> <job>
jam job list [--open]
```

Every command prints one JSON object with `--json` and a short human table otherwise. Errors name the field, the expected form and the fix in one line.

### 5.2 Rules carried over from version 1

- Files are hashed at record time. A record is **stale** only when one of its own files, inputs or evidence changed, the brief changed, a dependency was replaced, or `style.revision` changed. Editing the style document, adding references or editing a budget never makes work stale; a tightened budget shows `over-budget`.
- Measured facts are measured by the tool. A supplied metric that disagrees with measurement is refused.
- A paid result binds to a succeeded job of the same provider whose request file is unchanged.
- A job is opened before it is submitted. A lost response becomes `lost`, never a silent resubmission; a request hash that is still open in any run blocks a second submission.
- Delivery is self-contained under the delivered root, with no Git-ignored files.
- One writer per run file (lock file); a stale lock is removed only after its process is verified gone.

### 5.3 Gates

The recipe is the policy. `jam.config.json` adds one switch:

```json
"review": { "mode": "recipe" }
```

`recipe` follows each step's `review`. `agent` caps every gate at agent review. `none` records work with no gate. `--human <steps>` on a run only tightens. This is the crunch switch the jam needed: lowering gates is one visible, reversible setting, and provenance is still recorded.

A `human` gate is satisfied in one of two ways:

1. **Catalog verdict.** `run request-review` submits the step's evidence to the catalog (request id `jam:<record id>`) and prints the link. The person decides in the browser. `run status` reads the verdict: every selected part approved by a human actor accepts the step; `changes` or `rejected` returns it with the reviewer's comment.
2. **Relay.** `run review --accept --relay "notifai: yes, ship the barrel"` records `actor: human, via: relay` with the channel and the person's words. This is what 92 jam reviews actually were; now it is labelled as such.

An `agent` gate is satisfied by `--accept "<reason>"` at record time or by `run review`. Agent review uses the evidence already produced; it reruns a check only when evidence is missing, stale or contradicted.

### 5.4 Checks

A check is a named function `(run, step, record, context) → problems`. Shipped: `turnaround-views` (five distinct equal-canvas views, left and right mirrored), `budget-geometry`, `budget-texture`, `deformation-evidence`, `loudness`, `transcript-match`, `engine-inspect`, `delivery-closure`. A project adds a check as a command in `jam.config.json`:

```json
"checks": { "collision-covers": { "run": ["node", "tools/checks/collision.mjs", "{file:model}"] } }
```

The command exits 0 with `{"problems": []}` on stdout, or lists problems as `{ "message", "fix"? }`.

### 5.5 Configuration (`jam.config.json`, version 2)

```json
{
  "$schema": "./tools/jam/schemas/jam.config.schema.json",
  "version": 2,
  "toolkit": "tools/jam",
  "roots": { "scratch": "Art/.scratch", "delivered": "Art/Assets", "scan": ["Art", "Audio"] },
  "style": { "document": "Art/style.md", "revision": "v001", "references": [] },
  "budgets": {
    "prop": { "kind": "static", "triangles": { "target": 3000, "max": 8000 }, "textureSize": 1024, "maxMaterials": 1, "maxTextureMiB": 24 }
  },
  "engine": { "adapter": "unreal", "facts": {} },
  "routes": { "image": "codex", "mesh": "meshy", "sound": "elevenlabs", "voice": "elevenlabs" },
  "spend": { "meshy": { "perRun": 300, "total": 3500, "standing": "<who approved what, when, in their words>" } },
  "review": { "mode": "recipe" },
  "checks": {}
}
```

- `budgets` replace `profiles`. Units, axes, pivot and skeletons moved to the engine adapter.
- `spend.<provider>`: `perRun` and `total` are numbers or `null` (no cap); a provider that is absent, or has `perRun: 0`, cannot be paid. The unit comes from the provider descriptor. `standing` holds the user's own words authorising work inside the caps without asking each time; when it is set, skills proceed inside the caps and report after.
- Version 1 files are read and upgraded by `jam config migrate` (also run by the installer). Version 1 `run.json` files stay readable: stage names map to the `asset` recipe's steps.

## 6. Providers

A provider descriptor is data. Shipped: `meshy`, `scenario`, `tripo`, `elevenlabs`, `codex` (plan-included images), `agent-image` (the agent's own image tool). A project adds one as `jam/providers/<id>.json`.

```json
{
  "id": "scenario", "label": "Scenario", "unit": { "id": "CU", "label": "Compute Units", "paid": true },
  "capabilities": {
    "image": {}, "mesh": { "inputs": { "min": 1, "max": 4 }, "modes": ["single", "multiview"] }, "retexture": {}
  },
  "transports": [{ "kind": "mcp", "server": "scenario" }, { "kind": "cli", "command": "scenario", "probe": ["--version"] }],
  "pacing": { "concurrent": 1, "cooldown": "per-model", "retryAfter": "stated in the 429 body" },
  "quote": { "kind": "exact", "how": "dry_run on model_run" },
  "docs": "docs/providers/scenario.md"
}
```

The toolkit does not call provider APIs for images and meshes; the agent drives the provider's own CLI, MCP server or skill and the ledger records intent and outcome. Audio is the exception because the processing chain is deterministic: `jam audio` drives the provider through an adapter (§9). `jam provider list` and `jam provider probe <id>` report installed, authenticated and reachable separately.

Skills name capabilities ("the mesh route"), never a vendor. Vendor specifics live in `docs/providers/<id>.md`.

## 7. Engine adapters

An engine adapter supplies facts, optional commands and guidance. Asset skills read facts and call commands through `jam engine`; they contain no engine names.

```
<adapter>/
  adapter.json     facts and command table
  commands/        scripts the commands run
  docs/            guidance the skills link to (import checklist, DCC export quirks, where to look cheaply)
```

`adapter.json`:

```json
{
  "id": "unreal", "label": "Unreal Engine", "versions": ">=5.4",
  "facts": {
    "unitsPerMeter": 100, "up": "+Z", "forward": "+X", "handedness": "left",
    "contentRoot": "Content", "assetId": { "scheme": "/Game/{path}", "from": "Content/{path}.uasset" },
    "mesh": { "static": "glb", "skinned": "fbx" },
    "textures": { "normalGreen": "down", "packed": "ORM" },
    "collision": { "convention": "named-hulls", "prefix": "UCX_" },
    "skeletons": { "mannequin": { "label": "…", "reference": "skeletons/mannequin.glb", "bones": { "hips": "pelvis", "upper-leg.l": "thigh_l" } } },
    "audio": { "container": "wav", "sampleRate": 48000 },
    "naming": { "staticMesh": "SM_", "skeletalMesh": "SKM_", "texture": "T_", "material": "M_", "materialInstance": "MI_" },
    "binaries": { "lfs": ["*.uasset", "*.umap"], "lockable": true }
  },
  "commands": {
    "import": { "run": ["python", "commands/import.py"], "kinds": ["static", "skinned", "textures", "audio", "audio-variants"] },
    "inspect": { "run": ["python", "commands/inspect.py"] },
    "references": { "run": ["python", "commands/references.py"] },
    "conform-skeleton": { "run": ["blender", "commands/conform_skeleton.py"] },
    "capture": null, "check": null
  },
  "docs": { "import": "docs/import.md", "acceptance": "docs/acceptance.md", "cheap-looks": "docs/cheap-looks.md" }
}
```

Command contract: argv in, one JSON receipt on stdout, project-relative paths, exit 0 on success. `import` returns `{ "assets": [{ "id", "kind", "source", "sha256" }] }` and is idempotent (reimport keeps the id). `inspect <id>` returns bounds in meters, pivot, material slots, skeleton and bones, collision shapes and counts; the `engine-inspect` check compares these to the budget and facts, so scale, axes, skeleton and slot checks need no verbs of their own. Every command is optional: when one is `null`, `jam engine <verb>` prints the adapter's guidance document for doing it by hand and the step is recorded with that evidence.

How a command reaches the engine (an editor MCP server, a commandlet, a remote host) is the adapter's business and is configured in `jam.local.json` under `engine`.

`engine.adapter` is an id. It resolves to `jam/engines/<id>/adapter.json` in the project first, then to a shipped preset `tools/jam/engines/<id>.json`. Shipped presets are facts only (`godot`, `unity`, `unreal`, `web`) and need no install. A full adapter (facts, commands, guidance) is a folder: `jam engine install <folder>` copies one into `jam/engines/<id>/` and selects it. The `jam-engine-unreal` skill ships the Unreal adapter this way (commands and guidance extracted from the jam and from `jam-3d-character`); a project writes its own in the same place, and the `jam-engine` skill covers how. With no adapter configured, facts default to glTF conventions (meters, +Y up, +Z forward, right-handed).

### 7.1 Neutral by construction

The requirement is that every skill and recipe works with any engine or with none. Three rules make that structural instead of a matter of care:

1. **Operation skills end at a neutral artifact.** Meshes and rigs are delivered as glTF (GLB) in glTF conventions, audio as WAV, images as PNG. A run with no adapter completes at delivery with those files. Engine formats, scales and naming appear only inside an adapter's `import`.
2. **Anything shaped by an engine is adapter data or an adapter command.** A recipe step that needs one declares it (`"when": { "engine": "<command>" }`) and is skipped, with the reason recorded, when the adapter does not provide it.
3. **It is checked.** A repository test fails when an engine or vendor name appears in a skill, recipe or toolkit source file outside `engines/`, `providers/`, an adapter skill or a provider document. The `prop` and `character` recipes each have an end-to-end test with no adapter, with a facts-only preset and with a fake adapter.

Rigging is where this matters most. Version 1's rig script was written against one engine's skeleton: its bone names, its rest orientations, its IK bones, plus one provider's joint names (224 engine references and 70 provider references in that skill; the other eleven skills had 13 and 172, nearly all provider text in setup). Renaming it would have shipped that coupling under a neutral name. Rigging therefore splits along the seam:

| Piece | Owner | Swappable how |
|---|---|---|
| Landmarks: the canonical joint set (hips, spine, chest, neck, head, and per side shoulder, upper arm, lower arm, hand, upper leg, lower leg, foot, toes; fingers optional) | Toolkit schema | Fixed vocabulary every other piece speaks |
| Joint source: where landmark positions for this mesh come from | Provider (an auto-rig's skeleton mapped to landmarks by the descriptor's `rig.landmarks` table), a DCC estimate, or a person | Any source that writes the landmark file |
| Rigging: bind the mesh to a skeleton placed on the landmarks, limit influences, write a skinned GLB and pose renders | `jam-rig` skill | Engine-neutral; the skeleton it builds is the landmark hierarchy unless a profile is given |
| Skeleton profile: a named target skeleton as data (landmark → bone name, hierarchy, reference file) | Engine adapter `facts.skeletons.<id>`, or a project file for engine-less targets (VRM, a studio's own rig) | Pick by name in the budget (`skeleton: "<id>"`) |
| Conform: rework a rig into one engine skeleton's exact rest pose so that engine's animations play without retargeting | Adapter command `conform-skeleton` | Optional; engines that retarget from any humanoid skeleton do not need it |

The Mannequin-specific rig fitting from version 1 is exactly a `conform-skeleton` command and moves into the Unreal adapter with the Mannequin as one profile. `jam-rig` keeps the neutral operation and its checks (influence limit, each limb weighted mainly to its own bones by landmark region, pose evidence).

Local tools are routes, not requirements: where a skill ships a Blender script, the step is defined by its inputs, outputs and evidence, and the script is one way to produce them.

The engine's asset id is written back to the run record as `engineAsset` and shown in the catalog, replacing the hand-maintained `unrealPackage` field.

## 8. Catalog

### 8.1 What changes

The catalog keeps its records, actions and review model. Three things change: the engine is rebuilt on Effect with injected services, the single adapter becomes a list of plugins, and closed lists (media kinds, the content/assets split) become registered data.

Starting point: the jam's engine, which is the public one plus audio, transcripts, scopes, reference roles, byte-fingerprinted sources and review layout fixes. Project copy and assumptions are removed.

### 8.2 Services

Each is a `Context.Service` with a `layer` and, where useful, a `layerTest`. Nothing reads the clock, random bytes, the process environment or the file system except through one of these.

| Service | Owns |
|---|---|
| `ProjectFiles` (kernel) | Confined reads and writes, walk, hash, atomic replace, no-follow access under `.catalog` |
| `Git` (kernel) | Checkout context, blob read, LFS objects, ignore checks. Asynchronous; never blocks the event loop |
| `Ids`, `Clock` (kernel) | Time-ordered ids; time |
| `CatalogConfig` | Decoded `catalog.config.json`, reloaded when it or a project module changes |
| `Plugins` | The loaded plugin list and its merged registries |
| `MediaKinds` | Sniffing, mime, validation and facts per kind |
| `Snapshot` | Merged source output with incremental invalidation |
| `Facts` | Probe results cached by `(probe, version, sha256)` under `.catalog/.local/facts` |
| `Records` | Notes, labels, collections, categories, submissions, verdicts; locks; request journal |
| `Evidence` | Freezing and verified reading of frozen bytes |
| `ReviewPolicy` | Reviewable parts, reference roles, resolvers, verdict set |
| `Projection` | One immutable view of snapshot plus records per action; passed down explicitly |
| `Actions` | The registry: name, kind, input schema, handler. The same registry serves the CLI, HTTP and the browser |
| `Catalog` | Facade: `run(action, input, meta)`, `discover()`, media access |
| `Renderer` | Headless captures |

Action inputs are Effect Schemas; `catalog actions` publishes them as JSON Schema.

### 8.3 Plugins

`catalog.config.json` version 2:

```json
{ "version": 2, "plugins": ["manifest", "jam", "./jam/catalog/game.ts"],
  "options": { "manifest": { "file": "catalog.manifest.json" } },
  "review": { "resolver": "latest", "referenceRoles": [] } }
```

A plugin is a module whose default export is a plain object. Its functions may return a value, a promise or an Effect. The public entry is `tools/jam/src/catalog/plugin.ts`; nothing else under `src/` is an interface.

| Extension point | Shape | Replaces in the jam |
|---|---|---|
| `sources` | `{ name, inputs(ctx), load(ctx) }` returning units, assets, collections, types, problems | The single adapter; composition was hand-written |
| `enrich` | `(snapshot, ctx) → patch`, run after sources merge | Retyping units by category, stripping tags, marking fields derived after the fact |
| `relations` | `{ name, label, inverseLabel, from(unit) → ids }`; the engine computes the reverse side | Mutating units to build `usedBy` |
| `mediaKinds` | `{ id, sniff, mime, extensions, web }` where `web` is a browser module registering viewer, thumbnail and comparer | Audio touched 25 files |
| `probes` | `{ name, version, kinds, measure(file) → facts }` | A script writing measurements into source files |
| `checks` | `(catalog) → problems` with optional fixes, run by `catalog doctor` | A separate project doctor script |
| `actions` | Named read or write actions with input schemas | Tools writing catalog data directly |
| `scopes` | `{ id, label, description }` for the top-level split | A closed `content`/`assets` enum with game-specific copy |

Also registrable: `resolvers` and `previews` (already seams in version 1). A version 1 config (`"adapter": …`) and a version 1 adapter module keep working: they load as a plugin with one source.

Units gain `links[].meta` (per-link data such as take number or word timings) so plugins stop hiding it in attributes.

Shipped plugins: `manifest` (hand-registered content), `jam` (runs become units; lives in `src/jam`, which depends on the catalog's public entry and not the reverse), `media-core` (image, video, model, audio).

### 8.4 Review bridge

The `jam` plugin maps each run step that has a human gate to a catalog submission, and `jam run status` reads the projection (§5.3). There is one place a person approves anything.

### 8.5 Performance rules

These are requirements, each from a measured failure: the `context` poll does no Git process and returns no schema; an action builds one projection; sources invalidate by declared inputs (authored data by bytes, media by metadata) and hashes are cached by path, size and mtime; record scans are incremental.

### 8.6 Server and commands

```
jam catalog open            ensure the detached server for this checkout is running; print its URL
jam catalog stop | status
jam catalog serve [--port]  foreground
jam catalog todo            waiting reviews, open notes, changed verdicts, problems — one fast list
jam catalog doctor [--fix]
jam catalog actions | run <action> | capture ...
```

`open` keeps state in `.catalog/.local/server.json`, picks a free port starting at 4600 and survives the agent session that started it. Every result that creates or names a review includes its `url`.

## 9. Audio

`jam audio` holds what the jam's sound and dialogue tools proved, with engine and game specifics removed:

```
jam audio sfx generate|add|split|variants|trim|tighten|reprocess
jam audio voice status|voices|assign|speak|process
```

Shared: originals kept beside processed takes with a generation record; one processing chain with loudness targets from the engine adapter's `audio` facts or config; spending through the run ledger; provider access through an audio provider adapter (ElevenLabs shipped); engine import through `jam engine import --kind audio`. A dialogue line is `{ id, speaker, text, direction?, performance?, review? }` in JSON files named by `audio.lines` in config; a text edit marks the voiced take stale by hash. The transcript and alignment check runs when its optional Python environment is installed.

## 10. Skills

| Skill | Scope | Change |
|---|---|---|
| `jam-setup` | Install, upgrade, configure; connect providers and an engine adapter; doctor | Updated |
| `jam-recipe` | Follow a recipe; create, adapt, check and capture recipes | New |
| `jam-style` | Art direction and the approved image library | Trimmed |
| `jam-concept`, `jam-turnaround`, `jam-model` | One step each | Provider-neutral |
| `jam-retopo`, `jam-uv`, `jam-texture` | One operation each, usable alone on any mesh (generated, bought or hand-made) | Rewritten with real procedure and a checkable result |
| `jam-3d` | Entry point for any 3D request: picks the recipe and runs it | Thin router |
| `jam-rig` | Bind a mesh to a skeleton placed on landmarks, limit influences, produce a skinned GLB and deformation evidence; engine-neutral (§7.1) | New; the engine-specific conform step moved to the adapter |
| (recipes `prop`, `character`) | The ordered procedures | Were skills `jam-3d-prop`, `jam-3d-character`; now recipes with per-step guides |
| `jam-sfx`, `jam-voice` | Sound effects; voiced dialogue | New, from the jam |
| `jam-engine` | Use, configure and write engine adapters | New |
| `jam-engine-unreal` | The Unreal adapter | New, extracted |
| `jam-catalog` | Browse, organise, review; write catalog plugins | Updated |

The test for what ships: a procedure is general only when it would apply unchanged to a second, unrelated game. How one game assembles its content (which parts a character is split into, how hands, heads and hair are cut and stitched, how outfits are fitted over a shared body, its naming and its data files) is that game's recipe, not a skill. So `jam-3d-character` keeps the general path (generate, clean topology, unwrap, texture, rig to a reference skeleton, deformation evidence) and drops the swappable-parts and outfit branches with their scripts. `jam-recipe` shows how a project adds such steps to its own recipe.

Not promoted: the scene manager (a parser for one game's C++), the story-director interview (its method overlaps existing decision skills; its schema is one game's), demo recording (engine launch flags), devlog (overlaps `progress-report`). Each has a follow-up issue where a general kernel exists.

**Skill or recipe.** A skill knows how to do one operation. A recipe says which operations, in what order, with which gates, for one kind of content, and carries the notes that only apply in that context (a character's concept is drawn in a bind pose; a prop set shares one reference scene) as per-step guides. Version 1's `jam-3d-prop` and `jam-3d-character` were recipes written as skills: mostly ordering, plus one or two real operations. They become the `prop` and `character` recipes; the operation that was unique to characters becomes `jam-rig`. A recipe also has a `when` line saying which requests it is for, which is how work is routed.

Skills stay small and composable: one operation, one trigger, usable outside any recipe. `jam-retopo`, `jam-uv` and `jam-texture` were thin in version 1 (15 lines, no checkable result) and went unused in the jam because the provider route there returned textured meshes and one script finished a prop. That is a reason to write them properly, not to merge them: retexturing a bought mesh, unwrapping a hand-made model and retopologising a scan are separate requests, and separate steps keep separate records and gates. A recipe composes them; `run record` takes several steps at once when one operation produced them all.

Skill text rules beyond the repository's: no vendor or engine names outside adapter and provider documents; every step ends on a checkable criterion; the setup pointer lives once, in `jam-recipe`, and other skills say "run `jam run next`" rather than restating the flow.

## 11. Migration

- `jam-setup` upgrade replaces `tools/jam/`, migrates `jam.config.json` (profiles → budgets, conventions → engine facts when an adapter is chosen, `providers` → `routes`, spend units dropped) and `catalog.config.json` (adapter → plugins), and leaves version 1 runs readable.
