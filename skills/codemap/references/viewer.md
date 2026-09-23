# The codemap viewer

`index.html` is a single self-contained file: open it from disk, no server needed. Read this when a user asks what the map shows or how to move around it, and when you explain the map in your report.

## What a reader sees first

The map opens on the **Purpose** lens with a start-here panel: the system's one-sentence `summary`, a runtime strip ("14 client · 10 shared · 5 server"), **How it fits together** (every flow in reading order: people first, then along the direction the flows run, each with its mechanism and what travels), the other lenses with the question each answers, then people, areas, external systems, the full `purpose` under About, and the commit the map describes.

## Lenses

The top bar switches lens (`1`–`5`); the breadcrumb hint repeats the lens's question. Switching keeps the selected component selected.

| Key | Lens | URL | What it communicates |
| --- | --- | --- | --- |
| `1` | Purpose | `#/` | Three columns. People on the left with an arrow to what they use. Areas in the middle as tinted regions holding their runnables and a "+N libraries" chip; columns follow the topological order of the flows, so what people touch sits left and what stores state sits right. External systems on the right beside the runnables that use them. Build & verify spans the bottom. Each flow's short label sits on its arrow in full; its detail is on hover and in the card. A reader should be able to say "players use the client, which talks to the gateway and the world server, which stores in Postgres". |
| `2` | Layers | `#/layers` | Every product component in one matrix: columns are where it runs (client, shared, server, cli, build), rows are layers (surface, adapter, core, kernel), each row glossed on screen. Only edges that cross a runtime boundary, and health findings, are drawn; hover a node for all of its edges. Supporting code is left to the area views, and the panel says so. |
| `3` | Ships in | `#/ships` | Rows are product libraries grouped by area; columns are runnables grouped by where they run. A filled dot: the runnable imports the library itself. A ring: it arrives through another library. Each row ends with the runtimes it ships to and how many runnables hold it. Selecting a row lights the runnables it reaches; selecting a column lights what it holds. The panel lists libraries in both client and server, and product libraries that ship in nothing. |
| `4` | Size & activity | `#/size` | A treemap: every component a tile sized by lines of code, grouped into its area. Shade is how often its files changed in the 90 days before the scanned commit, ranked so the busiest stand out; without git history, tiles take their area colour. The panel lists the busiest and the largest components. |
| `5` | Contracts | `#/contracts` | The Ships in matrix restricted to contracts: kernel-layer product components (schemas, protocols, shared types) and any component holding interface files the scanner recognizes by name in any stack (protobuf, GraphQL, OpenAPI, AsyncAPI, JSON Schema, Avro, Thrift, Cap'n Proto, FlatBuffers, XML Schema, Smithy). The panel lists contracts in both client and server, those with interface files, and interface files outside every component; a component's card lists its contract files. |

## Drilling down

| Screen | URL | What it communicates |
| --- | --- | --- |
| Area | `#/area/<id>` | The Layers matrix for one area, with faded ghosts for the components of other areas it touches and a tray of its supporting code beneath. Edges to supporting code appear on hover. The panel shows the area's definition, counts, runnables, flows, and imports to and from other areas. |
| Component | `#/component/<id>` | The component's modules ordered so imports point down, test modules in their own dashed band beneath, other components faded at the sides. When a module graph is too dense to draw (more than 2.5 imports per module) only the structure is drawn and a module's imports appear on hover; the hint says so. Files are never boxes: select a module to list them. |

Clicking selects and opens the card; clicking again, double-clicking, or `Enter` opens what is inside. Every clickable thing shows a card about itself first: the "+N libraries" chip lists exactly those libraries and supporting parts, with a button to open the area that draws them.

## Visual grammar: one meaning per channel

| Channel | Meaning |
| --- | --- |
| Colour | the component's area, on every screen; in Size & activity the shade is recent changes and the area is the group outline |
| Corner icon | where it runs: window (client), two arrows (shared), rack (server), `>_` (cli), wrench (build) |
| Shape | the kind of thing: person pill; strong-bordered rectangle for a part that runs on its own; flat rectangle for a library; dashed cylinder, cloud, or device for datastore, service, or runtime; tinted region for an area; outlined tooling, dashed tests, folded page for content and docs, dotted experiments |
| Arrow on Purpose | a flow: running things talking, from the repository's docs. Solid over the network, dashed through files, dotted when one starts or hosts the other. Thin gray: a person uses something. Faint dotted, on hover only: imports into another area |
| Arrow elsewhere | code importing code: thicker for more imports; faint dotted when only tests import; red dashed when Health says it is worth a look |
| Badge | amber dot: the classifier was unsure (40–60%); `?`: it could not decide, the card says which fact |
| Hover | blue = what it uses, magenta = what uses it; everything else fades |

The legend at the bottom (`l`) lists only what the current screen draws. The `?` overlay repeats the lenses, the reading rules, and the keys.

## Words on screen

The viewer speaks to people, not to the pipeline: "layer" for role, "unsure" and "undecided" for the flag states, "lines" and "used by / uses" for the metrics, and plain headlines for the checks (Import each other · Rules tied to an engine · Client and server share code · Shipped code uses tooling), with the check id in the tooltip. A Health result reads "worth a look" or "fine by design"; the confidence behind a Jev verdict is in its tooltip. Jev is credited once, in the start-here panel's footer. Screen text describes the state of the code and the map; it never asks the reader to run a pipeline step, since that is the agent's job. When a person truly must act, the text says so plainly ("Ask your agent to rebuild the map").

## Health

The Health button reads "Health · N to look at" (a green check when there are none). The panel lists the four checks with counts, then every result: its headline, the nodes, the evidence imports, and the verdict. Clicking a result opens the right screen (the area when its nodes share one, Layers otherwise, the component for module-level results) and highlights its nodes and edges in amber; `Esc` clears the highlight. Accepted results are drawn as ordinary edges; only open ones are red.

## Keys

`1`–`5` lenses · `/` search · `Enter` open selected · `Esc` close, clear highlight, clear selection, then up · arrows move selection · `h` health · `t` theme · `0` `+` `−` fit and zoom · `l` legend · `?` help · `Backspace` up. The ← → buttons beside the breadcrumb are browser history (each screen is a URL hash). Old `#/runtime`, `#/domains`, and `#/domain/<id>` links still resolve.

If the page shows a red banner ("This map file is incomplete… Ask your agent to rebuild the map"), the embedded map is missing a required field (`schema`, `areas`, `components`, `modules`, `edges`): rebuild it with `codemap.py build` rather than asking the user to.
