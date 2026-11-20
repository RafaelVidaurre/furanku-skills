---
name: jam-3d-model
description: Generate a 3D mesh of one asset from its accepted turnaround through the project's mesh route, with a priced and recorded job, a download of the originals, and an inspection against every view. Use when the user asks to generate, make or build the 3D model or mesh of an asset, when a mesh generation job must be resumed or settled, or when a run's next step names this skill.
---

# Generate a mesh

One operation: from five accepted views to an inspected source mesh. `jam` below is `node tools/jam/jam.mjs`.

Inside a run, start from `jam run next <id>`: it names this step's guide, its outputs and its gate. With views but no run, start one at the turnaround and record the views with their origin first (`jam run start <recipe> <id> --brief-text "..." --from turnaround`). Runs, gates and a missing toolkit are the `jam-recipe` skill's.

1. **Inputs.** `jam run status <id>` must show `turnaround` accepted. When the design or the views are missing, that is the `jam-concept` or `jam-turnaround` step; do it before raising triangle or texture numbers with anyone. Done when the five view files are in hand.
2. **Budget.** Read the run's budget (`jam config show budgets.<name>`; the name is on the first line of `jam run status <id>`). When it is undefined, decide it with the person now: `tools/jam/docs/settings.md#budgets`. Done when the triangle target and limit are known.
3. **Route and input mode.** Find the callable mesh routes and offer them unless one is already chosen (`tools/jam/docs/providers.md#routes`), then read the chosen provider's page under `tools/jam/docs/providers/`. Multiview is the default and the contact sheet is never sent as one view; when a question about the mode is due is in `tools/jam/docs/providers.md#mesh-input`. Done when the route, the model, the mode and the views to send are written in a request file in the run folder (JSON, as it will be sent).
4. **Submit and wait** by `tools/jam/docs/providers.md#one-paid-job-start-to-finish` and its pacing rules. A request for the model plus the answers to its budget and route questions is the authorization (`tools/jam/docs/task-intent.md`); do not ask again. Set geometry controls explicitly where the operation has them; some modes ignore a target count. Tell the person which model is running and the provider's own stated wait. A route with no paid job (a local tool, a tool included in a plan) has nothing to open or settle. Done when every output is in the run folder, originals untouched, and a paid job shows `succeeded` in `jam job list`.
5. **Inspect.** A finished job proves a file exists. Convert to a self-contained GLB if needed (`jam pack-glb`), measure it (`jam measure <file>`), open it in a viewer or DCC and compare each side with its view: missing or fused parts, closed gaps that should be open, loose interior geometry, scale, mirrored or lost asymmetry. Save a still from each compared side, from the viewer or DCC you opened it in, as evidence. Done when every view has been compared and each defect is either absent or written down.
6. **Record:**

   ```
   jam run record <id> mesh --file <model.glb> --evidence <front-compare.png> --evidence <back-compare.png> \
     --note "<mode, which views were sent, model and settings, defects found>" --job <job> --accept "<what you compared and saw>"
   ```

   `--tool "<tool and version>"` replaces `--job` when no job was opened. Leave `--accept` off when the gate is a person's, and follow `jam run next <id>`. A mesh that fails inspection is not recorded as the result: settle the job, say what failed, and generate again only inside the existing authorization and caps.

When the same job also delivered usable topology, UVs or textures, those steps can be recorded in the same call (`jam-recipe`, "One operation, several steps"), each after its own skill's checks.

Done when `jam run status <id>` shows `mesh` accepted and your report names what the later steps still have to fix.
