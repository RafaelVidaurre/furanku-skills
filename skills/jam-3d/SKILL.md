---
name: jam-3d
description: Run or resume the jam 3D asset workflow (brief, concept, turnaround, mesh, topology, UVs, textures, reviewed delivery) by composing the jam stage skills. Use when the user asks to make a 3D game asset end to end, to resume or check an asset in progress, or to bring an existing model into the reviewed workflow at a later stage.
---

# 3D asset workflow

When `tools/jam/jam.mjs` is missing from the project, or `node tools/jam/jam.mjs doctor` reports a gap the current step needs, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`), then come back to the request. Use `jam-style` for unresolved art direction.

Read `tools/jam/docs/contracts.md` and `tools/jam/docs/task-intent.md`. Carry the user's request through prerequisite answers without asking again to generate. Resume by reading `node tools/jam/jam.mjs status --run <run.json>` and reconciling unresolved provider jobs first. For concept or turnaround work without a resolved profile, create a style-bound run with `init` and no `--profile`; triangle budgets are decided when the mesh is.

## Choose the branch

- **Rigged character, outfit or other wearable in an Unreal Engine 5 project on Epic's Mannequin skeleton**: use `jam-3d-character`, which adds the body, fitting, rig and engine steps to this workflow.
- **Rigged character for another engine or skeleton**: compose the stages below for the mesh, then name the rig, skinning and engine-import work as outstanding with the target skeleton; the jam skills have no rig integration for it.
- **Props for a setting or room, often several in parallel**: use `jam-3d-prop`, which runs this workflow as a production line from a reference scene.
- **Any other single asset**: compose the stages below.

## Compose the stages

Compose only the work the asset needs:

1. `jam-concept` defines the design; `jam-turnaround` produces the canonical five views.
2. Once the turnaround is accepted, `jam-model` resolves the missing asset-budget and route decisions, initializes a profiled run when needed, re-admits the existing images under the review rules, and generates the source mesh. Accepted images are reused, never regenerated to change run context.
3. `jam-retopo` qualifies final geometry, `jam-uv` its mapping, `jam-texture` its appearance. A provider may supply several in one job; each still needs its own evidence and acceptance. Keep satisfactory results instead of generating again.
4. The review procedure (`tools/jam/docs/review.md`) applies at each configured gate. Register each stage's actual dependencies so a change invalidates its consumers.

Existing assets may enter at topology, UV or texture with explicit input provenance and the missing earlier checks supplied; imported assets record `imported` provenance. New generation always requires the accepted turnaround. Each stage skill is independently usable: inspecting an existing UV layout needs no concept.

## Deliver

Delivery includes the editable source, immutable provider originals, exported model, texture maps and material description, units, axes and pivot, measured geometry and texture metrics, license and provenance, review evidence and remaining limitations. Register `delivery` against the accepted topology, UV and texture records, review it, then run `node tools/jam/jam.mjs check-delivery --run <run.json>`. A deforming asset needs rig and pose evidence; a static model does not fulfil a request for an animated one.

Engine import follows the project's own engine guidance. Engine acceptance is separate evidence from the DCC appearance: claim native rendering, performance or platform behaviour only after testing it there.

**Done:** the requested deliverable is accepted, `check-delivery` passes, every provider job and charge is reconciled, and the exact files and evidence are handed over. A pending review, provider failure or unmet deformation or engine requirement is unfinished work, reported with its precise next step.
