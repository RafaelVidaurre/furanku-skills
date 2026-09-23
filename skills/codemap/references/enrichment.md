# Enrichment: writing the draft

`draft.json` is the only place prose enters the map. Everything in it must trace to something you read; the map is a lens on the repository, not an essay about it.

## Read in this order of authority

1. Architecture inventories and decision records: `tools/architecture/*`, `docs/adr/*`, `ARCHITECTURE.md`.
2. The glossary or ubiquitous language: `CONTEXT.md`, `GLOSSARY.md`, `docs/vision.md`.
3. Repository and package READMEs, then manifest `description` fields.
4. Directory and file names, entry files (`index.ts`, `lib.rs`, `main.rs`, `__init__.py`), and the example imports on each edge.

Higher sources override lower ones when they disagree; record which one you used in `evidence`. Read the source-root listing and the entry file of every component before writing its card. For a component with a README, read the README's first section too.

## System block

- `name`: what the repository calls itself.
- `summary`: one sentence, at most about 25 words, that a newcomer could repeat at lunch: what it is and who it is for. It is the first thing the map says. "A Tibia-style MMORPG prototype: server-authoritative Worlds streamed to a 3D pixel-art client, plus the editors designers build them with."
- `purpose`: one paragraph a new hire could repeat: what it is for, who uses it, what shape it takes (monorepo of services and editors, a library, a CLI).
- `actors`: the kinds of people who use it (≤ 6), counting coding and QA agents as people whenever the repository gives them surfaces of their own (MCP or WebMCP tools, headless CLIs written for agents, agent docs such as `AGENTS.md` or `docs/agents/`), each with a `role` sentence and `uses`: up to two runnable component ids or area ids they touch first ("Players" use `web-client`; "Operators" use `world-server` and `observability`).
- `externals`: systems it depends on and does not own, each with a `kind` (`datastore`, `service`, `runtime`, `devtool`) and `used_by` component ids. Databases, collectors, browsers, embedded engines are what the running product touches; Blender, Playwright, and package managers are `devtool`.
- `flows`: runtime connections written from the docs, not from imports: `{from, to, label, detail, kind}` between runnables, people, and externals. `label` is the mechanism in at most 32 characters, drawn on the arrow in full ("WebSocket/TLS", "HTTPS", "writes content/worlds"); `detail` is what travels, in one clause ("intents up, filtered world deltas down"); kind is `network`, `file`, or `process`. Keep only evidenced runtime connections; an empty list is valid for libraries and repositories without scanned runnables. Concept-level control flow belongs in a behavior view.

## Areas

Propose areas with `id`, `name`, `definition`, and expected `components`: one purpose for one kind of user, using repository vocabulary. Supporting code needs no listing: Jev places it with the area it serves or in Build & verify. Area bounds, library-only areas and unparsed repositories follow [project types](project-types.md#propose-projects).

## Projects and behavior

For each new repository or changed project boundary, follow [project types](project-types.md) to read the inventory, propose independently meaningful projects, and author only useful, evidence-backed views. Put decisive facts in summary/detail as well as their paths; Jev cannot establish ordering from filenames.

## Component cards

- `responsibility`: one sentence starting with what it owns. "Owns the authoritative tick loop, movement, and combat resolution for one world." Ban vague nouns: logic, stuff, helpers, utilities, misc. When it wraps an outside API (a database driver, `document.modelContext`, the filesystem), name the API: that is what makes it an adapter rather than a shared helper.
- `runs`: one sentence on who or what starts it, when, and what uses its output. This is the fact Jev leans on most for runtime and nature, and names alone rarely carry it. "Players open it in a browser or the Electron shell." "Compiled into world-server and the wasm client; never started on its own." "Artists run these Python scripts from a terminal with Blender installed; the GLBs they write ship, the scripts do not." "Designers and coding agents run it on one content/ directory per batch." Say "nothing ships it" for code only developers, artists, or CI run.
- `why`: the consequence of its absence. "Without it no client could predict movement between server ticks."
- `loaded_by` (only when it applies): the ids of components that load this one through something other than an import: compiled to Wasm and loaded by a page, called through FFI, generated code, a plugin the host discovers. The import scan cannot see these links, so without them the map says the component ships in nothing. Cite the build script or doc that shows the link in `evidence`.
- `entry_points`: two to four paths where an engineer should start reading.
- `evidence`: the paths and documents you used, most authoritative first.

After a doubt evidence pass reveals two genuinely distinct jobs in one component, add `mixed_jobs` to that component's card: exactly two `{name, paths}` entries. Each name states a job in the repository's words; each nonempty `paths` list points to files implementing that job. For example, an asset generator and a runtime loader need separate paths for generation and loading. Jev checks this candidate on the next `decide` run. Leave `mixed_jobs` empty when the doubt comes from missing facts or unclear classification criteria; uncertainty alone does not establish mixed responsibility.

## Edge reasons

Each component edge gets one line naming what the dependency is for, written from the example imports: "reads the wire format for entity snapshots", "compiles enemy sources against the content schema". A reason that could apply to any edge ("uses types from") is not a reason; open one example import and say what it carries.

## Module names

Only when a directory name is opaque (`core`, `lib`, `misc`, an abbreviation) supply a human name in `module_names`; a clear directory name stands on its own.

## Quality bar before `decide`

- A reader who knows the field but not this repository could pick the right area for each component from its card alone.
- No two components share a responsibility sentence.
- Every product component has an expected area; all project and graph references pass `draft-template` validation.
- Every sentence names something concrete: a path, a term from the glossary, a type, a protocol, a user.
- Every `mixed_jobs` candidate names two independently changing jobs and the paths for each; the same path may appear in both only when the file itself performs both jobs.
