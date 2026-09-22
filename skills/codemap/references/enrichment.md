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
- `purpose`: one paragraph a new hire could repeat: what it is for, who uses it, what shape it takes (monorepo of services and editors, a library, a CLI).
- `actors`: the kinds of people who use it (≤ 6), each with a `role` sentence and `uses`: up to two runnable component ids or area ids they touch first ("Players" use `web-client`; "Operators" use `world-server` and `observability`).
- `externals`: systems it depends on and does not own, each with a `kind` (`datastore`, `service`, `runtime`, `devtool`) and `used_by` component ids. Databases, collectors, browsers, embedded engines are what the running product touches; Blender, Playwright, and package managers are `devtool`.
- `flows`: runtime connections written from the docs, not from imports: `{from, to, label, kind}` between runnables, people, and externals. The label names the mechanism ("WebSocket/TLS: binary protocol", "writes content/worlds the server loads"); kind is `network`, `file`, or `process`. Eight to twelve flows tell the story; more is clutter.

## Areas

Write 3–7 areas, each a group of parts one kind of person uses for one purpose, following the people you listed: what players run, what designers use, what operators rely on, what serves the world. Each area has an `id`, a `name` in the repository's vocabulary, a `definition` sentence that distinguishes it from its neighbors ("What runs a World: the authoritative server, the gateway, checkpoints, and the pure crates they are built on"), and the product `components` you expect in it. Every area needs at least one runnable (an app, service, or CLI). Supporting code needs no listing: Jev places tooling, tests, docs, and experiments with the area they serve or in Build & verify.

## Component cards

- `responsibility`: one sentence starting with what it owns. "Owns the authoritative tick loop, movement, and combat resolution for one world." Ban vague nouns: logic, stuff, helpers, utilities, misc.
- `why`: the consequence of its absence. "Without it no client could predict movement between server ticks."
- `entry_points`: two to four paths where an engineer should start reading.
- `evidence`: the paths and documents you used, most authoritative first.

## Edge reasons

Each component edge gets one line naming what the dependency is for, written from the example imports: "reads the wire format for entity snapshots", "compiles enemy sources against the content schema". A reason that could apply to any edge ("uses types from") is not a reason; open one example import and say what it carries.

## Module names

Only when a directory name is opaque (`core`, `lib`, `misc`, an abbreviation) supply a human name in `module_names`; a clear directory name stands on its own.

## Quality bar before `decide`

- A reader who knows the field but not this repository could pick the right area for each component from its card alone.
- No two components share a responsibility sentence.
- Every product component appears in exactly one area, every area has a runnable, and there are 3–7 areas.
- Every sentence names something concrete: a path, a term from the glossary, a type, a protocol, a user.
