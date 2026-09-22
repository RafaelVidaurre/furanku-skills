---
name: codemap
description: Build and maintain a multi-level architecture map of a codebase (system picture with people, areas, runnables, and flows; area matrices; component modules) as a standalone HTML explorer, with Jev deciding every grouping so the map stays consistent across runs. Use when the user asks for a code map or architecture map, asks how a codebase is structured or what depends on what, asks to update the map after changes, or asks to open the map.
---

# Codemap

`<skill-dir>` is the directory containing this file; `<root>` is the target repository's root. The map lives outside the repository under `~/.furanku-skills/codemap/<repo-key>/`; `python3 <skill-dir>/scripts/codemap.py path --repo <root>` prints the directory.

Scripts do everything mechanical. You write the prose from repository evidence. Jev decides every grouping. Read [levels](references/levels.md) once per session before the first map so the vocabulary below (system picture, area, runnable, flow, component, module, the three facts, health checks) means the same thing to you as to the scripts.

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

The scan records every tracked TypeScript, JavaScript, Rust, and Python file, its imports, and the units (packages, crates, apps, directories) that own them. The skeleton turns that into components, modules, metrics, and aggregated edges. Read the scan summary: units by kind, files by language, unresolved imports. Unresolved imports above a few percent of edges mean a resolution gap; report it as a scanner limitation in the final summary rather than working around it in prose.

**Complete when:** both commands succeed and the component count matches what you would expect from the repository's workspace manifests.

## 3. Enrich the draft

```sh
python3 <skill-dir>/scripts/codemap.py draft-template --repo <root>
```

This writes `draft.json` with every field you must fill, in a fixed shape, and on later runs lists the fields still empty. Fill it by following [enrichment](references/enrichment.md): system purpose, people with what they use, externals with their kind, runtime flows, 3–7 areas, one responsibility and one reason-to-exist per component, and one reason per component edge. Every sentence traces to something you read in the repository, in the evidence order that reference sets.

**Complete when:** `draft-template` reports zero empty required fields and every area lists at least one runnable.

## 4. Decide with Jev

```sh
python3 <skill-dir>/scripts/codemap.py decide --repo <root>
```

Jev decides the area, runtime, nature, and role of each component, and rules on each core-uses-adapter and crosses-the-wire dependency; [jev-decisions](references/jev-decisions.md) lists the questions, thresholds, and the error-to-action table. Decisions are cached by the exact state they were asked about, so re-running only asks about what changed. Components with a shaky runtime, nature, or role get a second pass with their neighbors' answers before anything is called unresolved. For each node the summary lists as unresolved, and for each contradiction `build` reports (a decision the import evidence argues against), add the facts that were missing to its draft card (what it reads and writes, who runs it, what imports it) and run `decide` once more. A node still unresolved keeps its `?` badge; leave it and name it in the final summary.

**Complete when:** the decide summary reports zero Gateway errors and every unresolved node and contradiction has had one evidence pass.

## 5. Build

```sh
python3 <skill-dir>/scripts/codemap.py build --repo <root> --open
```

Build validates the map (every file in a module, every module in a component, every component in an area, Build & verify, or `Unsorted`, with a runtime and nature; 3–7 areas each with a runnable; every flow endpoint known; every edge with a reason), writes `map.json` and `index.html`, and stores an immutable snapshot for the scanned commit. A validation failure names the rule and the node; fix the draft or report the scanner gap, then rebuild.

**Complete when:** build reports zero validation errors and the HTML path.

## 6. Review and report

Open five component cards at random in `map.json` and compare each responsibility and its strongest edge reason against the code they point at; correct the draft and rebuild when one is wrong. Then report to the user: the map path, counts per level and per runtime, the areas with their one-line definitions, unresolved nodes, health findings (each with its check name and whether Jev accepted it by design), and any scanner limitation. Explain the viewer in the terms of [viewer](references/viewer.md) when the user has not seen it before.

**Complete when:** the user has the path, the counts, and every caveat in one message.

## 7. Update an existing map

```sh
python3 <skill-dir>/scripts/codemap.py update --repo <root>
```

Update re-scans, rebuilds the skeleton, records what changed per component since the previous scan (files added, removed, or changed; dependencies gained or lost), and merges the draft: new components and edges get empty fields, vanished ones are dropped, everything you wrote stays. When the draft has no gaps it runs `decide` at once; otherwise it lists the gaps and stops. Fill only the listed fields following [enrichment](references/enrichment.md), then run `decide` and `build`. Jev reuses every cached answer whose card is unchanged, asks whether the previous assignment still holds for components with recorded changes, and asks the full question set for new components. Areas stay as they are unless a component comes back `new_area`; then revise the areas in the draft and run `decide` again.

**Complete when:** build succeeds and your summary names the components that changed, appeared, or vanished since the previous snapshot.
