---
name: jam-3d-retopo
description: Bring a mesh's topology within a triangle and material budget while keeping its silhouette and, where it bends, edge flow at the joints, proven by a topology report and wireframe stills. Use when asked to reduce the polycount, decimate, remesh or retopologize a generated, scanned, bought or hand-made mesh, to make a quad mesh for something that deforms, to check whether an existing mesh fits its budget, or when a run's next step is topology.
---

# Topology to budget

The operation turns one mesh into a **candidate**: a GLB within the triangle and material budget that still has the source's shape. It is defined by what goes in (a mesh, a budget), what comes out (the candidate) and the evidence (a measurement, a report, stills); the scripts here are one way to produce them, and any tool that produces the same three is as good.

`jam` below is `node tools/jam/jam.mjs`, the toolkit `jam-setup` installs. `<S>` is this skill's `scripts/` folder. Blender scripts run as `jam blender --factory-startup <S>/blender/<script> -- <arguments>`, Python ones as `jam python <S>/<script> <arguments>`; each script's header also gives the plain `blender` and `python3` line. Models are `.glb`, `.gltf`, `.fbx`, `.obj` or `.blend`; the reports read `.glb`.

## Steps

1. **Read the budget and the source.** The budget is `triangles.target`, `triangles.max`, `maxMaterials` and `kind` (`static` or `deforming`) of `jam config show budgets.<name>`; with no project, the numbers the request gives. Measure the source: `jam measure <source.glb>` and `jam python <S>/topology_report.py <source.glb> --out <work>/source-topology.json --max-triangles <max> --max-materials <n>`. In a run, `jam run next <id>` names the step's guide: read it, it holds what applies only in that recipe. Done when you know which limits the source breaks and which defects it has.
2. **Choose the route** from the table below, by what the mesh is and whether it deforms. Done when one route is chosen and its reason written down.
3. **Make the candidate** by that route, as a new file beside the untouched source. Done when the candidate exists as a GLB (and, for quads, the file that keeps them).
4. **Prove it.** Each of these must hold, or be an exception you name with its reason (`--allow <check>=<reason>`):
   - `jam measure <candidate.glb>`: triangles at most `triangles.max`, materials at most `maxMaterials`.
   - `jam python <S>/topology_report.py <candidate.glb> --out <work>/topology-report.json --max-triangles <max> --target-triangles <target> --max-materials <n>` exits 0. Add `--min-quad-share 0.8` for a deforming mesh and `--require-closed` for one that must be watertight.
   - The candidate lies on the source: the route's own report, or `fit_to_source.py --measure-only`, shows a largest deviation of at most 2% of the bounding diagonal.
   - `jam blender --factory-startup <S>/blender/render_wire.py -- <candidate> <work>/stills` wrote the fixed views and one sheet. For a deforming mesh add a close-up per joint (`--focus elbow=<x>,<y>,<z>,<size>`).
5. **Look at the sheet** (one image) beside the source's. Done when the silhouette, thin parts and openings match the source, and, for a deforming mesh, edge loops run around each joint instead of across it.
6. **Record** (below), or hand over the candidate, the report and the sheet when there is no run.

## Routes

| Route | Choose when | Make the candidate | Its checkable result |
| --- | --- | --- | --- |
| **Keep** | The source is already within budget and its report is clean: most bought and hand-made low-poly models | Nothing changes | The report on the existing file; the record's note says why its topology suffices |
| **Provider remesh** | A generated mesh, when the configured mesh route can return a stated polycount or quads (at generation time, or by remeshing an uploaded mesh). The route for anything that deforms | Through `jam-3d-model` and the provider's document; then lay the result on the source with `fit_to_source.py`, and recover quads with `quads_from_tris.py` | Deviation at most 2%; for quads, a quad share of at least 0.9 |
| **Decimate** | A dense mesh that does not deform: props, scans, set dressing | `decimate.py -- <source> <work> --target-triangles <target> --max-triangles <max>` | Its report: triangles within the limit, deviation at most 2% |
| **Local quad remesh** | A simple closed shape that must bend or subdivide, with no provider remesh to hand | `quad_remesh.py -- <source> <work> --target-faces <half the triangle target>` | Its report: all quads, no open edges, deviation at most 2% |
| **Procedural** | A boxy or turned shape (crate, shelf, table, door, bottle, barrel, lamp): modelled from primitives it has fewer triangles and cleaner edges than any reduction, and costs no generation | A short DCC script that builds it from the reference's measured proportions | The report clean, and the stills matching the reference's silhouette |

Read [references/routes.md](references/routes.md) before the first use of a route other than Keep: it holds each route's inputs, limits and known failures. [references/scripts.md](references/scripts.md) lists every script's arguments and outputs.

A mesh over `maxMaterials` is brought within it by merging its materials into one texture set: unwrap it with `jam-3d-uv`, then bake it onto itself with `jam-3d-texture`. Record topology together with those two steps from the baked file.

A new candidate changes the surface the UVs and textures were made for: the `uv` and `texture` steps follow it.

## Evidence already made

Reuse evidence that exists for this exact file: a report or still made by you, a sub-agent or an earlier step counts when the file's hash is unchanged (`jam measure` prints it). Measure or render again only when the evidence is missing, older than the file, or contradicted by something you see. One still answers a question about shape; record a turntable only when a person asks for one.

## Record

In a run, state what happened and let the tool measure:

```
jam run record <id> topology --file <candidate.glb> --evidence report=<work>/topology-report.json --evidence wire=<work>/stills/<label>-sheet.png --note "<route, and why>" --tool "<tool and version>" --accept "<what you checked>"
```

- Kept topology: the note says why the existing file suffices, and `--file` is that file.
- A paid remesh: `--job <job>` instead of `--tool` (`jam job open` before submitting; the provider's document has the request).
- One operation that produced several steps (a provider result already unwrapped and textured, or the material merge above): `jam run record <id> topology uv texture --file <model.glb> ...`, with each step's evidence in the same call.
- Work that starts from an existing file: `jam run start <recipe> <id> --from topology`, and the record takes `--source "<origin>" --source-evidence <file>` alongside `--tool`.

The record is refused when `jam measure` finds the file over budget; fix the mesh, or have the budget changed by whoever owns it.

## Without a run

Every step above works on a lone file with numbers you are given: pass them to the scripts as arguments, write into a folder you choose, and hand back the candidate, `topology-report.json` and the sheet with the route and its reason.

## When a script surprises you

[references/validation.md](references/validation.md) says what each script was run on, with the numbers seen and what has not been tried. Read it before trusting a script on a kind of mesh it does not list.
