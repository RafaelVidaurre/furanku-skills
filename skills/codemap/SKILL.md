---
name: codemap
description: Build and maintain an architecture map of a codebase as a standalone HTML explorer with five lenses (Purpose shows people, areas, runnables, and flows; Layers shows where each part runs and which way dependencies point; Ships in shows which libraries each app, service, and CLI contains; Size & activity shows lines and recent changes; Contracts shows shared schemas and interface files), views that fit the kind of project, and a Code quality panel. Use when the user asks for a code map or architecture map, asks how a codebase is structured, what depends on what, what a change to a library would reach, where work is happening, or which code-quality findings deserve attention, asks to update the map after changes, or asks to open the map.
---

# Codemap

`<skill-dir>` is the directory containing this file; `<root>` is the target repository's root. The map lives outside the repository under `~/.furanku-skills/codemap/<repo-key>/`; `python3 <skill-dir>/scripts/codemap.py path --repo <root>` prints the directory.

Scripts do everything mechanical. You write the prose from repository evidence. Jev decides grouping and context-dependent architectural judgments; the scanner reports structural facts such as cycles. Read [levels](references/levels.md) once per session before the first map so the vocabulary below (system picture, area, runnable, flow, component, module, the three facts, code-quality findings) means the same thing to you as to the scripts.

## 1. Preflight

```sh
python3 <skill-dir>/scripts/codemap.py status --repo <root>
```

The status reports which artifacts exist, whether the map is stale against the current commit, and whether a Gateway key is available. Jev is required: without a key, stop and hand the user the model-routing skill's `jev.py setup` command (a hidden terminal prompt for their Vercel AI Gateway key), then resume here. A map that already exists for this repository sends you to step 7.

**Complete when:** status shows the key configured and you know whether this is a first build or an update.

## 2. Scan and skeleton

```sh
python3 <skill-dir>/scripts/codemap.py scan --repo <root>
python3 <skill-dir>/scripts/codemap.py skeleton --repo <root>
```

The scan inventories all tracked paths and document/manifest/deployment reading leads, and extracts supported TypeScript, JavaScript, Rust, and Python imports and owning units. The skeleton turns that into components, modules, metrics, and aggregated edges. Read the scan summary: units by kind, files by language, unresolved imports. Unresolved imports above a few percent of edges mean a resolution gap; report it as a scanner limitation in the final summary rather than working around it in prose.

**Complete when:** both commands succeed and the inventory is present and any gap between scanned components and repository contents is explained by import coverage.

## 3. Enrich the draft

```sh
python3 <skill-dir>/scripts/codemap.py draft-template --repo <root>
```

This writes `draft.json` with every field you must fill, in a fixed shape, and on later runs lists the fields still empty. Fill it by following [enrichment](references/enrichment.md): a one-sentence summary and the system purpose, people with what they use, externals with their kind, evidenced runtime flows with a short label and detail, genuine areas, one responsibility, one line on how it runs, and one reason-to-exist per component, and one reason per component edge. For a new repository or changed project/view scope, read [project types](references/project-types.md) to propose project boundaries, shared memberships and useful behavior graphs from tracked evidence.

**Complete when:** `draft-template` reports zero gaps, including project/view references and evidence.

## 4. Decide with Jev

```sh
python3 <skill-dir>/scripts/codemap.py decide --repo <root>
```

Jev decides the area, runtime, nature, and role of each component, then judges candidate quality concerns that need architectural context; [jev-decisions](references/jev-decisions.md) lists the questions, thresholds, and the error-to-action table. Decisions are cached by the exact state they were asked about, so re-running only asks about what changed. Components with a shaky runtime, nature, or role get a second pass with their neighbors' answers. The summary then lists what Jev still doubts: `unresolved_nodes` (no answer) and `uncertain_nodes` (an answer under 60%), each with `torn_between`, the two options it could not separate. Treat both lists, and each contradiction `build` reports, as work. A doubt has one of three causes; find which before changing anything:

- **Missing information:** the card lacks the fact that separates the two `torn_between` options (who runs it and when for `cli` or `build`; whether the product loads it for `product` or `tooling`; which outside API it calls for `adapter` or `kernel`; which people use it for two areas). Write that fact into its `runs` or `responsibility` and run `decide` once more.
- **Weak criteria:** the card already states the deciding fact, but the options or rubric do not say which way it points. Do not reword the card to steer Jev; name the gap in your final summary as a skill limitation, with the component and both options.
- **Genuine ambiguity:** the component really does both things (a generator that is also a runtime library, a package serving two groups of people). In its draft card, write `mixed_jobs` with exactly two `{name, paths}` entries, each naming one job and the files that implement it. Run `decide` again so Jev can confirm whether the jobs warrant a code-quality finding; report a confirmed finding with its suggested separation.

A node still in doubt after its evidence pass keeps its badge. Missing facts, weak criteria, and provider errors stay visible as doubts, without becoming mixed-responsibility findings. Name the cause in the final summary.

**Complete when:** the decide summary reports zero Gateway errors; every unresolved node, uncertain node, and contradiction has had one evidence pass; and every genuine two-job candidate has paths in `mixed_jobs` and a Jev verdict.

## 5. Build

```sh
python3 <skill-dir>/scripts/codemap.py build --repo <root> --open
```

Build validates the map (every file in a module, every module in a component, every component in an area, Build & verify, or the `unsorted` group (shown as *Not placed yet*), with a runtime and nature; nonempty areas with the bounds in project types; accepted project memberships and bounded behavior graphs; every flow endpoint known; every edge with a reason), writes `map.json` and `index.html`, and stores an immutable snapshot for the scanned commit. Open quality findings carry a headline, meaning, evidence paths or imports, and a suggested separation when one applies; they appear together in the top-bar Code quality panel. A validation failure names the rule and the node; fix the draft or report the scanner gap, then rebuild.

**Complete when:** build reports zero validation errors and the HTML path.

## 6. Review and report

Open up to five component cards at random in `map.json` and compare each responsibility and its strongest edge reason against the code they point at; correct the draft and rebuild when one is wrong.

Then answer the user in this order, in plain words, the way the map's start-here panel reads:

1. **What it is:** the `summary` sentence and, in three to five lines, how it fits together: the flows from people to data, each with its mechanism.
2. **Where to look for their question:** the lens that answers what they asked, as a path with its URL hash (`index.html#/` Purpose, `#/layers` Layers, `#/ships` Ships in, `#/size` Size & activity, `#/area/<id>`, `#/component/<id>`), plus one thing that lens shows. "What depends on what" is Layers or an area; "what would a change reach" is Ships in; "where is work happening" is Size & activity.
3. **Worth a look:** open Code quality findings by their on-screen headline with the nodes involved, libraries that ship in nothing, and undecided components. Say "none" when there are none.
4. **Caveats:** scanner limitations (a high unresolved-import share, a wrong unit boundary).

Counts per level and per runtime are one line at most. Explain the viewer in the terms of [viewer](references/viewer.md) when the user has not seen it before; mention that Tests starts hidden and the top bar can reveal it.

**Complete when:** the user has the map path, the lens for their question, and every caveat in one message.

## 7. Update an existing map

```sh
python3 <skill-dir>/scripts/codemap.py update --repo <root>
```

Update re-scans, rebuilds the skeleton, records what changed per component since the previous scan (files added, removed, or changed; dependencies gained or lost), and merges the draft: new components and edges get empty fields, vanished ones are dropped, authored projects and views stay, with vanished component or evidence references reported as gaps. When the draft has no gaps it runs `decide` at once; otherwise it lists the gaps and stops. Fill only the listed fields following [enrichment](references/enrichment.md), then run `decide` and `build`. Jev reuses every cached answer whose card is unchanged, asks whether the previous assignment still holds for components with recorded changes, and asks the full question set for new components. Areas stay as they are unless a component comes back `new_area`; then revise the areas in the draft and run `decide` again.

**Complete when:** build succeeds and your summary names the components that changed, appeared, or vanished since the previous snapshot.
