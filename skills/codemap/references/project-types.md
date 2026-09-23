# Repository landscape and behavior views

Read this when enriching a new repository or refreshing project boundaries and
behavior views. The scanner supplies reading leads; the agent supplies grounded
cards; Jev supplies discrete judgments; the builder assembles accepted facts.

## Read before proposing

Use `skeleton.inventory`: sorted `tracked_paths`, `documents`, `manifests`, and
`deployments`. These filenames survive unsupported source languages. Read the
relevant contents, entry and registration code, and concrete examples before
writing the corresponding summary or detail. Filenames alone prove neither
project purpose nor control order. `import_coverage` separately lists parsed and
unparsed paths; unparsed includes documents and configuration as well as unsupported
code. A missing import edge is not evidence of independence.

When prose does not give Jev independent evidence for a graph claim, add optional
draft-only `evidence_excerpts: [{path, start_line, text}]` at the draft root. Copy
exact inspected source text: at most 16 snippets, 8,000 characters each, a positive
1-based line number, and a tracked repository-relative path. The decision state
includes excerpts only for paths that question cites; full text participates in
its fingerprint. Excerpts are not published in the map. Update preserves them;
recheck the text and line numbers when cited files change before deciding again.

**Complete when:** every proposed boundary and graph claim names its source and
states the deciding fact, and the report distinguishes import coverage from
repository evidence.

## Propose projects

A repository can hold one coherent product or several independently meaningful
projects. Package count does not establish a landscape. Shared components keep
one component record and may belong to several projects. Add these optional draft
fields; existing drafts without them keep their system picture:

```json
{
  "projects": [{"id": "catalog", "name": "Catalog", "summary": "Serves item data.",
    "purpose": "Let callers retrieve items.", "components": ["api", "schema"],
    "evidence": ["README.md"]}],
  "project_relations": [],
  "views": []
}
```

Project relations are `{from, to, label, detail, evidence}` between project IDs.
Jev judges their evidence with repository shape. They publish only with an
accepted landscape. Purpose and summaries must explain the proposal: membership
lists and dependency counts alone cannot establish boundaries.

Primary kinds are `web-service`, `game`, `library`, `cli`, `data-pipeline`,
`application`, `compiler`, `ml`, `embedded`, `infrastructure`, and `other`.
Jev chooses them from purpose; a kind never excludes an independently supported
view. An unresolved kind renders `other` with its decision still visible.

Use 1–7 genuine nonempty areas for a single system. Libraries can occupy an area
without a runnable. In an accepted landscape, each project's accepted components
may intersect at most seven explicit areas; actor/external and per-area component
bounds likewise apply to that project picture; the repository may have more. If no
source components were scanned, use zero explicit areas, empty project component
lists, and concept nodes in views. Report the missing import coverage rather
than inventing components or runnables. Empty `system.flows` is valid.

**Complete when:** cards explain independently useful project purposes and shared
memberships, every referenced component exists, and no area or runtime endpoint
was fabricated to fill a layout.

## Propose useful views

Each view has this shape:

```json
{
  "id": "read-items", "project": "catalog", "kind": "request",
  "title": "Read items", "question": "Where can this request stop?",
  "scope": "GET /items", "summary": "Authentication precedes the item handler.",
  "evidence": ["src/routes.ts"],
  "nodes": [
    {"id": "auth", "label": "Authentication", "kind": "middleware",
     "detail": "The route registration installs authentication before the handler.",
     "component": "api", "evidence": ["src/routes.ts"]},
    {"id": "handler", "label": "Items", "kind": "handler",
     "detail": "Authenticated requests read and return catalog items.",
     "component": "api", "evidence": ["src/routes.ts"]}
  ],
  "edges": [{"from": "auth", "to": "handler", "label": "authenticated",
    "detail": "Authentication calls the handler only after credentials pass.",
    "kind": "control", "evidence": ["src/routes.ts"]}]
}
```

Node `component` is optional and, when present, must have accepted membership in
that project. Node `kind` is practitioner vocabulary, such as middleware, system,
component data, gateway, datastore, or stage. Edge `kind` is `control`, `data`,
`network`, `file`, or `process`. Directed edges state order, branches, and repeat
cycles; node array order is only reading order. A graph has 1–32 nodes and at most
64 edges. Each card, node, edge and relationship needs 1–16 repository-relative
tracked evidence paths, without line suffixes. Text fields are at most 4,000
characters. Narrow larger views instead of silently cutting decisive facts.

| View kind | Minimum reading and useful question |
| --- | --- |
| `request` | Entry, registration order, execution semantics and a concrete request: where does it route, reject, do work and respond? |
| `game-loop` | Input/update/render or replication scheduling: what repeats, at what rate, and who owns state? |
| `ecs` | Entity identity, component data, systems and read/write or scheduling relations; use only with evidence of ECS. |
| `library-api` | Exports, examples, extension registration and external APIs: where do callers enter and customize? |
| `command` | Executable entry, parser/dispatch and one command: how do arguments become work and an exit result? |
| `data-pipeline` | Jobs and data contracts: sources, transforms, sinks, dependencies and retries/checkpoints. |
| `app-lifecycle` | Startup, navigation/state, subscriptions, backgrounding and teardown. |
| `compiler` | Pass registration and IR boundaries: parsing, transforms, execution/emission and diagnostics. |
| `ml-lifecycle` | Training/serving jobs and artifacts: distinguish training from inference. |
| `device-lifecycle` | Boot, interrupts, scheduler, shared state and hardware interfaces. |
| `infrastructure` | Declared environment, ingress, services/stores and traffic protocols from deployment definitions; never describe declarations as verified live state. |

All kinds use the same bounded graph renderer; specialized sequence, archetype,
and nested deployment layouts are not implemented. Hermetic fixture proposals
for request, game loop, ECS and infrastructure live in
[`scripts/fixtures/project-types/proposals.json`](../scripts/fixtures/project-types/proposals.json)
alongside their small documented evidence fixture; it is not an executable game/API application.
For an executable request example and its draft, see the
[web-service fixture](../scripts/fixtures/project-types/web-service/README.md).

**Complete when:** every view asks one concrete scoped question, every node and
edge carries a grounded fact and path, and each branch or loop is explicit.

## Decisions, diagnostics and refresh

`landscape` contains `{enabled, decision}`. Project records contain accepted
`components`, resolved `kind`, the primary-kind `decision`, and
`membership_decisions: [{component, decision}]`. Only accepted graphs enter
`views`, each with a `decision`; `view_decisions: [{id, project, kind, decision}]`
retains every proposal, including rejected and uncertain ones.

A decision is `{value, status, confidence, reason}`. Repository choices use
`accepted`, `uncertain`, or `unresolved`; membership and view booleans can also
be `rejected`. Only an accepted true boolean admits a member or view. If an
accepted view links a component whose membership was not accepted, the whole
view is withheld with an unresolved diagnostic. The graph is never silently
rewritten to conceal rejected ownership.

Run `decide` after changing any proposal. Build verifies each raw record's exact
question/state/criteria/version fingerprint; draft-only and stale selections stay
unresolved. `update` preserves authored projects, relationships and graphs, then
reports stale component/evidence references as gaps. Fix those references and
refresh grounded detail before deciding again.

**Complete when:** build validates, every withheld proposal has an explicit
diagnostic, and remaining uncertainty and import limitations are reported.
