# The codemap viewer

`index.html` is a single self-contained file: open it from disk, no server needed. Read this when a user asks what the map shows or how to move around it.

## Visual grammar: one meaning per channel

| Channel | Meaning |
| --- | --- |
| Hue | the component's area; the same hue at every level, legend at the bottom |
| Column (system picture) | people · areas ordered by the direction of their flows · external systems; Build & verify spans the bottom |
| Column (matrix) | where it runs, in the order client · shared · server · cli · build, each with an icon (window, two arrows, rack, `>_` prompt, wrench) |
| Corner icon | the same runtime icon inside every component and module node, so "where" survives at every level |
| Row (matrix) | role, top to bottom: surface → adapter → core → kernel; healthy dependencies point down |
| Node shape | kind of thing: person = pill with a person icon; runnable = strong-bordered rectangle with its runtime icon and a subtitle such as "Rust service", "Vite web app", "Node CLI"; library = flat thin rectangle (matrix only; the system picture folds them into a "+N libraries" chip); external = gray dashed cylinder (datastore) or cloud (service) in the right column; a runtime (browser, Electron, embedded VM) is a small device badge in the top-right corner of each runnable that runs inside it, and only joins the column when a flow names it; area = large tinted region with a title; Unsorted = a dashed chip under the areas; nature inside the matrix: product solid, tooling outlined, test dashed, content and docs a page with a folded corner, experiment dotted |
| Edge (system picture) | dark arrow = a flow: solid for network, dashed with a page glyph for file, dotted for process; the mechanism sits in a pill on the arrow (never over a node; shortened to its first clause when space is short, full text on hover) except for a person's flows, whose label lives in the card and tooltip; thin gray arrow = a person uses something; faint gray dashes = a runnable uses an external; faint dotted = imports into another area, shown only while hovering a runnable |
| Edge (matrix, modules) | solid arrow = production import, thicker for more imports; faint dotted = imports made only from tests; red dashed = an open health finding |
| Badge | amber dot = Jev decided with 40–60% confidence; `?` = unresolved, the component sits in Unsorted |
| Hover | blue = what the node depends on or uses, magenta = what depends on it; everything else fades. Hovering a person lights everything they use; hovering an area lights its flows |

A flow is not an import: flows come from the repository's own documentation and say two running things talk; imports say one piece of code compiles against another. The `?` button opens a plain-language explanation of this table plus the keys.

## Screens

| Level | URL | What it communicates |
| --- | --- | --- |
| L0 System picture | `#/` | Three columns. People on the left with an arrow to what they use (a runnable or a whole area). Areas in the middle as tinted regions, each holding its runnables and a "+N libraries" chip; columns follow the topological order of the flows between areas (ties stack top to bottom by id), so what people touch sits left and what stores state sits right. Externals on the right beside the runnables that use them (datastore, service, runtime kinds). Build & verify spans the bottom: supporting components as chips grouped by nature plus devtool externals. A reader should be able to say "players use the client, which talks to the gateway and the world server, which stores in Postgres". |
| Where it runs (lens) | `#/runtime` | The matrix of every product component: columns = runtimes that have product code, rows = roles, cells coloured by area, Supporting tray beneath grouped by nature. Only edges that cross a runtime boundary (and findings) are drawn; hover a node for all of its edges. |
| L1 Area | `#/area/<id>` | The same matrix restricted to one area, with ghosts for touched components of other areas in their own runtime column and a tray of the supporting code it touches. Every edge is drawn. The panel shows the area's definition, counts, runnables, flows, and imports to and from other areas. |
| L2 Component | `#/component/<id>` | The component's modules ordered by dependency depth, other components collapsed to ghosts on the sides. Files are never boxes: select a module to list them. |

`1` returns to the system picture, `2` opens the Where-it-runs lens; the segmented control in the top bar does the same. Old `#/domains` and `#/domain/<id>` links still resolve.

## Layout bounds

The system picture is laid out deterministically (no physics; ties by id) for ≤ 6 people, 3–7 areas, ≤ 10 runnables, ≤ 8 externals at 1440×900. Beyond that it degrades rather than breaks: areas with more than four runnables use two columns, chips wrap to new rows, labels truncate with the full text in a tooltip, and the view fits to the screen. Within an area, runnables are stacked so that flows join neighbours (a hub sits between its targets); arrows that would cross another area's region are routed through the gap between regions instead.

## Health

The Health button reads "Health · N findings" (a green check when there are none). The panel lists the four checks with counts, then every recorded result: the check, its one-sentence meaning, the nodes, evidence imports, and the verdict: "finding 68%" or "accepted by design 84%" when Jev decided, plain "finding" when the scanner did. Clicking a result navigates to the right level (the area when the nodes share one, the lens otherwise, L2 for module cycles) and highlights its nodes and edges in amber; `Esc` clears the highlight. Accepted results are drawn as ordinary edges; only open findings are red.

## Cards

Person: role and what they use. External: kind, role, and the components that use it. Area: definition, runnable / product / supporting / loc counts, runtime strip, runnables with what they run as, flows, imports from and to other areas, libraries, supporting code. Runnable or component: three labelled chips (runs on · kind · role), a "Runs as" line ("Rust service", with a runnable badge when it starts as its own process or page), path, responsibility, why it matters, metrics, flows, externals it uses, depends on / depended by with a reason per edge (a red `!` marks a finding; click the count to select the edge), modules, entry points, evidence. Flow edge: the mechanism label and what the kind means. Import edge: imports, the finding's meaning and verdict when there is one, the reason, and example imports.

## Keys

`/` search · `1` `2` system picture / lens · `Enter` open selected · `Esc` close, clear highlight, clear selection, then up · arrows move selection · `h` health · `t` theme · `0` `+` `−` fit and zoom · `l` legend · `?` help · `Backspace` up. The ← → buttons beside the breadcrumb are browser history (each level is a URL hash) and disable when there is nowhere to go.

If the page shows a red banner, the embedded map is missing a required field (`schema`, `areas`, `components`, `modules`, `edges`): rebuild with `codemap.py build`.
