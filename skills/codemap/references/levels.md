# Levels, facts, and lenses

The map answers one question per screen. An engineer zooms from the whole system to a file without ever seeing more than about a dozen boxes, and the same visual channel means the same thing on every screen.

## Levels

| Level | Name | What is drawn | Question it answers | Bounds |
| --- | --- | --- | --- | --- |
| L0 | System picture | people on the left, areas with their runnable parts in the middle, the external systems the product touches on the right, runtime flows between them, Build & verify along the bottom | What is this, who uses it, what runs, what talks to what? | ≤ 6 people, 3–7 areas, ≤ 10 runnables, ≤ 8 externals |
| L1 | Area | one area's components in the runtime × role matrix, ghosts for touched components of other areas, supporting tray beneath | Inside this area, what are the parts, where do they run, which feed which? | ≤ 12 product components per area |
| L2 | Component | modules of one component, files listed on the card | Inside this component, where does each responsibility live? | ≤ 16 modules |
| lens | Where it runs | every product component in one runtime × role matrix | What is client, what is server, what is neither? | whole system |

The map stops at files. A leaf links to a path; reading code is the editor's job.

## Areas, runnables, flows

An **area** is a group of parts one kind of person uses for one purpose: *Playing*, *Authoring worlds*, *Serving a World*, *Operating*. You propose 3–7 areas with definitions in the repository's vocabulary; Jev places every component. Every area must hold at least one **runnable**: a `surface` product component that starts as its own process or page (an executable, or a `client`, `server`, or `cli` runtime). Supporting code (tooling, tests, docs, experiments) lands with the area it serves or in the implicit **Build & verify** area; it never forms an area of its own.

**Flows** are the arrows of the system picture. Imports cannot say that the client talks to the gateway over HTTPS or that the server loads content files, so you write flows from the repository's documentation: `{from, to, label, kind}` with endpoints among runnables, people, and externals, a label naming the mechanism, and kind `network`, `file`, or `process`.

**People** (`actors`) carry `uses`: up to two runnables or areas they touch. **Externals** carry a `kind`: `datastore`, `service`, `runtime` (browser, desktop wrapper, embedded engine) appear on the system picture; `devtool` externals (Blender, Playwright, package managers) are chips in Build & verify.

## Three facts about every component

One grouping cannot answer "what is it for", "where does it run", and "is this product code" at once, so every component carries three independent facts. Jev decides each one from the card you wrote plus the manifest hints the scanner found.

- **Area** is who uses it and for what, as defined above; Jev places each component in one of your areas, in Build & verify, or answers `new_area` when none fits.
- **Runtime** is where the code runs: `server` (a long-lived service process), `client` (a page or desktop app a person uses), `shared` (a library compiled into more than one runtime), `cli` (a command run by a person or a script), `build` (runs only while building or developing), `none` (not executable: content, docs).
- **Nature** is what kind of code it is: `product` (runs as part of what users use, including the authoring tools designers operate), `tooling` (build, dev stack, quality gates, asset pipelines), `test` (harnesses, acceptance lanes, test support), `content` (data and scripts the product loads), `docs` (documentation and review evidence), `experiment` (prototypes and spikes).

Product components also carry a **role**, their hexagonal position: `surface` (what a person or another system touches: UI, API handlers, CLI entry points, editor hosts), `adapter` (I/O and engines: persistence, transport, rendering, filesystem, OS and browser APIs), `core` (the system's own rules, models, sessions, workflows), `kernel` (types, schemas, utilities every role shares). Drawn top to bottom in that order, healthy dependencies point down; core reaching into an adapter is the one upward arrow that matters.

Components and modules themselves are mechanical: units come from workspace manifests, modules from first-level directories under a unit's source root. A wrong unit boundary is a scanner gap to report, never something to fix in prose.

## Lenses

Hue is the area, the same everywhere a component appears. The system picture is the primary view; **Where it runs** is the alternate whole-system view: the runtime × role matrix over every product component with the supporting tray beneath. An area (L1) uses that matrix for its own components.

## Edges

An edge exists only where an import exists. The scanner finds file-level imports; the builder aggregates them to modules, components, and areas with counts and example imports. Between areas and between components every edge carries a one-line reason you wrote from its examples; between modules the examples speak for themselves. Imports from test files (`tests/`, `*.test.ts`, `test_*.py`, `tests/*.rs`) are counted separately: an edge only tests create is drawn faint, never forms a cycle, and never raises a finding.

## Health checks

Findings are named, explained, and evidenced; they are shown, never hidden and never silently fixed.

| Check | What the reader is told | Decided by |
| --- | --- | --- |
| `cycle` | These components import each other, directly or through others, so neither can change alone. | scanner |
| `core-uses-adapter` | A core component imports an adapter, so its rules are tied to one storage, transport, or engine. | Jev: acceptable by design? |
| `crosses-the-wire` | Client code imports server code (or the reverse) directly instead of a shared contract. | Jev: acceptable by design? |
| `product-uses-support` | Product code imports tooling, test, or experiment code, which can ship or break the build. | scanner |

## The card

Every node carries the same card: `name` and `path`; the three facts and role as chips; `responsibility` (one sentence, "owns …"); `why` (what breaks without it); `depends_on` with a reason per edge and `depended_by`; `entry_points`; `evidence`; `metrics` (files, lines, fan-in, fan-out, instability, in a cycle); and `decision` provenance with confidence. `uncertain` and `unresolved` badges are part of the map, not an error to hide.

## Stability

The same code must produce the same map. Scripts are deterministic and Jev decisions are cached by the exact state they were asked about, so an update only re-asks about what changed. Areas survive updates; components move only when their evidence changes. A later phase reads two snapshots at two commits and shows the difference, which only works if nothing moves without a reason in the code.
