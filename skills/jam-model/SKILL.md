---
name: jam-model
description: Generate a 3D mesh from an accepted turnaround through Meshy or Scenario within the asset's budget profile, with quote, job ledger and inspection. Use when the user asks to generate, make or build the 3D model or mesh of an asset, or to resume, reconcile or inspect a mesh generation job.
---

# Generate a mesh

When `tools/jam/jam.mjs` is missing from the project, use the `jam-setup` skill first (when it is not installed: `npx skills add rafaelvidaurre/furanku-skills --skill jam-setup`). Read `tools/jam/docs/contracts.md`, `tools/jam/docs/task-intent.md` and `tools/jam/docs/providers.md`.

1. **Inputs.** Check the design and turnaround first; use `jam-concept` or `jam-turnaround` for missing images before asking about triangle or texture budgets. Done when an accepted turnaround exists.
2. **Profile and run.** Reuse or resolve the asset profile (with `jam-style` for budgets), and make sure the run carries that profile and an accepted turnaround. When adding the first profile, carry eligible image approvals into the new run (`tools/jam/docs/review.md#carry-an-image-approval-into-the-first-profiled-run`): the record transition needs no new human review or image generation. Done when `status` shows an accepted turnaround in a profiled run.
3. **Input mode.** Follow `tools/jam/docs/providers.md#choose-the-mesh-input-mode`: multiview is the default for an accepted turnaround. When the mode is neither established nor explicitly delegated, ask once with multiview recommended and the supported alternatives explained; a provider or triangle-budget choice does not select single-view. Done when the mode, its source and the actual input subset are recorded. Never send the contact sheet as one view; keep the five-view archive.
4. **Submit.** A generation request plus answers to its budget and route questions already authorizes submission. Set geometry and appearance controls explicitly where supported (some modes ignore target counts or accept triangles only). Prefer a raw source plus a deliberate topology step when that keeps more useful shape; accept in-generation remeshing when it meets the actual requirements. Follow the intent, submit, resume and download procedure in `tools/jam/docs/providers.md`. Done when the job is reconciled in the ledger and every output is downloaded, originals kept before any edit.
5. **Inspect.** Open the mesh in a viewer or DCC and compare every side with the turnaround; measure exported triangles and materials. Check for missing parts, fused gaps, interior debris, scale and asymmetry. A provider "success" or "game-ready" label is not acceptance. Done when every side has been compared.
6. **Record and review.** Register `mesh` with exact inputs and subset, operation, model and version, job ID and source files, and review through `tools/jam/docs/review.md`.

**Done:** a visually qualified source mesh is accepted, with any topology, UV, surface or deformation work named as outstanding.
