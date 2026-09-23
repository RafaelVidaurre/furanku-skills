# Levels, facts, and lenses

The map answers one question per screen. Five **lenses** show the same components from different angles; from there an engineer drills from an area to a component to a file without seeing more than about a dozen boxes at a time. The top-bar Code quality panel lists findings across those screens. Hue, selection, and the card stay the same everywhere.

## Lenses

| Lens | Question it answers | What is drawn | Built from |
| --- | --- | --- | --- |
| Purpose | Who uses what, and how do the running parts talk? | people · areas with their runnables · external systems, joined by flows; Build & verify beneath | the draft's people, areas, externals, flows, and Jev's area placements |
| Layers | Where does each part run, and which way do its dependencies point? | every product component in the runtime × role matrix; supporting code is left to the area views | Jev's runtime and role answers, production imports |
| Ships in | Which libraries end up inside each app, service, and command? | a matrix: product libraries (rows, grouped by area) × runnables (columns, grouped by runtime); a dot where the runnable imports the library, a ring where it arrives through another library | production imports, followed transitively |
| Size & activity | Where is the code, and where is work happening? | every component as a tile sized by lines, grouped by area, shaded by recent changes | line counts and the scan's git window |
| Contracts | Which shared schemas and contracts exist, and what uses each? | the Ships in matrix restricted to contracts: kernel-layer product components and any component holding interface files | Jev's role answers, contract files the scanner finds by name in any stack |

An accepted landscape opens above the project system pictures; otherwise Purpose opens. Read [project types](project-types.md) when proposing project boundaries or behavior views, including per-project area bounds and unsupported-language repositories. On Purpose, its panel is a start-here summary (the `summary` sentence, the flows in reading order, the lenses). Switching lens keeps the selected component selected. Ships in makes two things visible that no other screen does: libraries compiled into both client and server, and product libraries no runnable imports.

## Levels

| Level | Name | What is drawn | Question it answers | Bounds |
| --- | --- | --- | --- | --- |
| L0 | System picture (the Purpose lens) | people on the left, areas with their runnable parts in the middle, the external systems the product touches on the right, runtime flows between them, Build & verify along the bottom | What is this, who uses it, what runs, what talks to what? | ≤ 6 people, 1–7 areas, ≤ 10 runnables, ≤ 8 externals |
| L1 | Area | one area's components in the runtime × role matrix, ghosts for touched components of other areas, supporting tray beneath | Inside this area, what are the parts, where do they run, which feed which? | ≤ 12 product components per area |
| L2 | Component | modules of one component, optional test modules in their own band beneath, files listed on the card | Inside this component, where does each responsibility live? | ≤ 16 modules |

The map stops at files. A leaf links to a path; reading code is the editor's job.

## Areas, runnables, flows

An **area** is a group of parts one kind of person uses for one purpose: *Playing*, *Authoring worlds*, *Serving a World*, *Operating*. You propose 1–7 areas with definitions in the repository's vocabulary; Jev places every component. An area holds components and may consist entirely of libraries. A **runnable** is a `surface` product component that starts as its own process or page (an executable, or a `client`, `server`, or `cli` runtime). Supporting code (tooling, tests, docs, experiments) lands with the area it serves or in the implicit **Build & verify** area; it never forms an area of its own.

**Flows** are the arrows of the system picture. Imports cannot say that the client talks to the gateway over HTTPS or that the server loads content files, so you write flows from the repository's documentation: `{from, to, label, detail, kind}` with endpoints among runnables, people, and externals, a short `label` naming the mechanism (drawn on the arrow in full), a `detail` saying what travels (shown on hover and in the card), and kind `network`, `file`, or `process`.

**People** (`actors`) carry `uses`: up to two runnables or areas they touch. **Externals** carry a `kind`: `datastore`, `service`, `runtime` (browser, desktop wrapper, embedded engine) appear on the system picture; `devtool` externals (Blender, Playwright, package managers) are chips in Build & verify.

## Three facts about every component

One grouping cannot answer "what is it for", "where does it run", and "is this product code" at once, so every component carries three independent facts. Jev decides each one from the card you wrote plus the manifest hints the scanner found.

- **Area** is who uses it and for what, as defined above; Jev places each component in one of your areas, in Build & verify, or answers `new_area` when none fits.
- **Runtime** is where the code runs: `server` (a long-lived service process), `client` (a page or desktop app a person uses), `fullstack` (an app whose code runs on a server and in the browser, like server-side rendering; the client/server check never applies to it), `shared` (a library compiled into more than one runtime), `cli` (a command run by a person or a script), `build` (runs only while building or developing), `none` (not executable: content, docs).
- **Nature** is what kind of code it is: `product` (runs as part of what users use, including the authoring tools designers operate), `tooling` (build, dev stack, quality gates, asset pipelines), `test` (harnesses, acceptance lanes, test support), `content` (data and scripts the product loads), `docs` (documentation and review evidence), `experiment` (prototypes and spikes).

Product components also carry a **role**, their hexagonal position: `surface` (what a person or another system touches: UI, API handlers, CLI entry points, editor hosts), `adapter` (I/O and engines: persistence, transport, rendering, filesystem, OS and browser APIs), `core` (the system's own rules, models, sessions, workflows), `kernel` (types, schemas, utilities every role shares). Drawn top to bottom in that order, dependencies normally point down. Upward imports are candidates for review; the core-to-adapter case has its own check.

The viewer calls the role a **layer** and glosses each one on screen (surface: what people touch; adapter: I/O and engines; core: the rules; kernel: shared types).

Components and modules themselves are mechanical: units come from workspace manifests, modules from first-level directories under a unit's source root, or from its root files when the root is flat (a Rust crate of sibling `.rs` files). A wrong unit boundary is a scanner gap to report, never something to fix in prose.

## Edges

An edge exists only where an import exists. The scanner finds file-level imports; the builder aggregates them to modules, components, and areas with counts and example imports. Between areas and between components every edge carries a one-line reason you wrote from its examples; between modules the examples speak for themselves. Imports from test files (`tests/`, `*.test.ts`, `test_*.py`, `tests/*.rs`) and from build configuration (`vite.config.ts`, `tailwind.config.js`, `build.rs`, `setup.py`, ...) are counted separately, so build-time wiring never reads as product code depending on support code. Generated files and literal data tables encoded as source are tagged by the scanner and left out of the lines Size & activity uses (`authored_loc`). Test components, modules, files, and test-only edges are drawn when the reader turns on Tests; tests are hidden initially. A test-only edge never forms a cycle or raises a finding.

## Code quality

Each finding has a plain-language headline, one sentence explaining its meaning, repository paths or imports as evidence, and a suggested separation when the evidence supports one. The panel groups open findings by criterion and links each to its place on the map. The reader can hide quality marks without removing findings from the map data or the panel. The [research note](code-quality-research.md) gives the primary sources, detection limits, and reasons for these criteria.

| Check | What the reader is told | Decided by |
| --- | --- | --- |
| `cycle` | These components import each other, directly or through others, so neither can change alone. | scanner |
| `core-uses-adapter` | A core component imports an adapter, so its rules are tied to one storage, transport, or engine. | Jev: acceptable by design? |
| `crosses-the-wire` | Client code imports server code (or the reverse) directly instead of a shared contract. | Jev: acceptable by design? |
| `product-uses-support` | Product code imports tooling, test, or experiment code, which can ship or break the build. | scanner |
| `mixed-responsibility` | One component owns two distinct jobs, with the files for each job named. | Jev: genuinely separate jobs? |
| `upward-dependency` | A lower layer imports a higher one, pulling a shared or inner part toward an outer detail. | Jev: acceptable by design? |
| `stability-inversion` | A component many others depend on imports a less structurally stable component. | Jev: concerning for these boundaries? |
| `hub-coupling` | Many parts use this component, which also imports many peers; its boundary may spread changes. | Jev: incoherent or risky boundary? |

The scanner proposes topology candidates from resolved production imports and distinct-neighbor counts; a high count alone is not a defect. Size and recent changes prioritize confirmed findings in Size & activity; neither alone proves bad design. Change coupling needs per-commit path sets that the current scan does not store.

## The card

Every node carries the same card: `name` and `path`; the three facts and role as chips; `responsibility` (one sentence, "owns …"); `runs` (who starts it, when, and what uses its output); `why` (what breaks without it); `depends_on` with a reason per edge and `depended_by`; `entry_points`; `evidence`; `metrics` (files, lines, used by, uses, recent changes, in a loop); and `decision` provenance with confidence. `uncertain` and `unresolved` badges (shown as *unsure* and *undecided*) are part of the map, not an error to hide.

## Stability

The same code must produce the same map. Scripts are deterministic and Jev decisions are cached by the exact state they were asked about, so an update only re-asks about what changed. Areas survive updates; components move only when their evidence changes. A later phase reads two snapshots at two commits and shows the difference, which only works if nothing moves without a reason in the code.
