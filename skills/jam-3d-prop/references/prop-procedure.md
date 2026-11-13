# Prop procedure

You build ONE prop end to end. Follow the steps in order; each ends on its done condition. The coordinator owns user contact: report blockers to the coordinator instead of notifying or asking the user. Work from the repository root and commit nothing.

Scripts are in the `scripts/` directory of the `jam-3d-prop` skill (the coordinator gives you its absolute path) and run from the project root with `node tools/jam/jam.mjs blender --factory-startup <scripts dir>/<script> -- <args>`, which takes Blender from `jam.local.json` or PATH and passes the arguments without a shell, so the same line works in PowerShell, cmd and POSIX shells (quote paths with spaces). Each script's first lines give its usage.

Working files go in `Art/.scratch/<asset>/`; the delivery goes in `Art/Assets/<asset>/v<n>/` with the layout in [step 8](#8-deliver). When the coordinator names an accepted earlier prop of the set, it is your colour reference and an example of that layout; the first prop of a set has neither and establishes both.

**Profile.** Read the `prop` profile from `jam.config.json` once (`node tools/jam/jam.mjs settings` lists profiles): `targetTriangles`, `maxTriangles`, `textureSize`, `maxMaterials`, `forward`, `pivot`. Steps 4 and 6 use these values; the numbers quoted there are observed examples, not targets.

**Reviews.** After every `register`, run `node tools/jam/jam.mjs status --run <run.json>`: a stage awaiting review names its `reviewer`. For `agent`, review it yourself under `tools/jam/docs/review.md` and record an honest reason. For `human`, stop and send the coordinator the review packet (what changed, the renders, known limits); record the person's actual words when the coordinator passes them back.

## Image calls

Use the image route the coordinator names, one fresh session per image, each with its own `brief.md` (an Assignment section with the authorization quote, and an exact `## Final image prompt` text block). On the Codex CLI route (`tools/jam/docs/codex-cli.md`):

```sh
codex exec --cd . --sandbox workspace-write --json --output-last-message <dir>/result.txt -i <ref1> -i <ref2> -- '<instruction: read brief.md, use $imagegen, copy the original to <dir>/<name>.png, save prompt-sent.txt>' < /dev/null > <dir>/events.jsonl 2> <dir>/stderr.txt
```

The `< /dev/null` is required: without it codex waits on stdin forever. Verify each result: `prompt-sent.txt` matches the brief's prompt, and `events.jsonl` shows the image copied from Codex's `generated_images` (the first line's `thread_id` is the session id for provenance).

## 1. Concept

Isolate the prop from the reference scene on a plain light grey background, three-quarter view slightly from above, whole and centred. Attach the scene as the design source and, when the set has an accepted prop, its concept as COLOUR REFERENCE ONLY (the first prop takes its colours from the scene and the approved style). Apply the [design rules](inspection-and-repair.md#design-rules) in the prompt. Inspect the image against those rules; fix any violation with one edit (the image as sole edit target, "Change ONLY ..., keep EVERYTHING else identical").

**Done:** a concept with no design-rule violation.

## 2. Turnaround

Generate only the views that are not duplicates, by symmetry class:

| Symmetry | Generate | Fill the other jam views by | Mesh input |
| --- | --- | --- | --- |
| Rotational (barrel, round stool) | front, three-quarter | reusing front | front, three-quarter |
| Four-way (round pedestal table) | front, three-quarter | reusing front | front, three-quarter |
| Mirror left/right (chair, counter) | front, one side, back, three-quarter (2x2) | mirroring the side | front, side, three-quarter (+ back if it differs from front) |
| None | front, left, back, right, three-quarter | — | front + three best |

Ask for orthographic views at the prop's mid height, equal cells, flat background, same scale. Inspect: every view agrees with the others, nothing crosses a cell, and no detail appears in one view that another contradicts (board ends on a side view that the top lacks become a ring in 3D). Fix with an edit if needed. If views do not sit on equal cells, cut each out unscaled into its own cell. Assemble a five-cell sheet locally, write `layout.json`, crop with `node tools/jam/jam.mjs python tools/jam/crop_turnaround.py <sheet> <layout.json> <new-dir>`, and document reused or mirrored views in `origin.md`.

**Done:** five cropped views that agree, plus `origin.md`.

## 3. Run and records

Write `Art/.scratch/<asset>/brief.md` (asset, source, real size, use, profile, mesh input mode and views, review authorization). `node tools/jam/jam.mjs init --run Art/.scratch/<asset>/v1/run.json --id <asset> --profile prop --brief <brief>` (add `--human <stages>` only when the coordinator's authorization asks for more human gates than the policy). Register concept and turnaround with `imported` provenance (`model` and `transport` naming the actual image tool and route, `sourceEvidence` = the origin.md) and review each as **Reviews** above describes.

**Done:** concept and turnaround accepted in the run.

## 4. Mesh

Use the mesh route the coordinator names, following `tools/jam/docs/providers.md` and the provider's official skill. The proven route is Scenario's `model_meshy-7-1-multi-image-to-3d` (skill `scenario-meshy`): upload the mesh-input views (front first) with `upload_asset`, curl PUT, `upload_asset_complete`. Parameters: `geometryResolution standard, shouldTexture true, enablePbr true, topology triangle, savePreRemeshedModel true, removeLighting true, originAt bottom`; `targetPolycount` = the profile's `targetTriangles`, raised toward `maxTriangles` for thin parts (example: a 3000/5000 profile used 3000 for simple shapes and 5000 for thin ones); `textureResolution` = the smallest offered size at or above `textureSize` (finalize reduces it). Quote with `dry_run`, write `mesh-request.json` and `quote.md`, `job-intent`, submit once, `job-update submitted` with the job id immediately, `jobs_wait`, `job-update succeeded` with the actual charge, and download every output promptly. If a jam command reports a lock error, another agent holds the ledger briefly: wait 10 seconds and retry once; leave lock files in place.

**Done:** the job reconciled in the ledger and all outputs downloaded.

## 5. Inspect and repair

Render textured, clay and behind-and-below views of the remeshed GLB (`render.py`, `clay.py`, `back.py`, each `-- <model.glb> <out-prefix>`) and inspect them against [inspection](inspection-and-repair.md#inspection). Repair every flaw a player would see with the cheapest fix that works ([repair](inspection-and-repair.md#repair)), re-inspecting after each fix. Register the provider output as `mesh` in the working run and review it as **Reviews** above describes.

**Done:** clean from every side, textured and clay.

## 6. Finalize

`finalize.py -- <src.glb> <out.glb> <report.json> <height_m> <profile textureSize> --front-from <axis the model faces> --front-to <profile forward> --pivot <profile pivot>` scales to the real height, turns the front, places the pivot and bounds every map to `textureSize` on both axes, keeping its aspect. Find `--front-from` on the front render (`render.py`); generated meshes usually face -Y. Then `node tools/jam/jam.mjs measure --file <out.glb>`.

**Done:** the report shows `texturesWithinMax: true`, and `measure` shows triangles ≤ `maxTriangles`, materials ≤ `maxMaterials` and every texture ≤ `textureSize`.

## 7. Scene test

Write a spec placing your prop with the set's delivered props as the reference scene arranges them (the first prop stands alone) and run `scene.py -- <out-prefix> <spec.json>`. Set `figureHeight` to the game's reference character height and, when the profile or coordinator gives the game camera, `camera`; the script's header lists the fields. It renders a front and an overview framed to the content, plus `gameplay` when a camera is given. Check real-world size and proportion against the figure and the other props, and that the prop reads as part of the set. Correct the finalize height or proportions if they are off.

**Done:** every render shows the prop at a believable size in the set; renders and spec saved under `Art/.scratch/scene-test/<asset>-*`.

## 8. Deliver

Assemble `Art/Assets/<asset>/v<n>/`: `model/<asset>.glb` (the finalized model), `source/provider/` (every provider original, request, quote), `source/concept/`, `source/turnaround/`, `source/edit/` (any repair scripts and intermediates), `review/` (inspection and scene-test renders), `brief.md`, `provenance.md` (lineage, job ids, charges, ledger intent ids, authorization). Init its run (`node tools/jam/jam.mjs init --run Art/Assets/<asset>/v<n>/run.json --id <asset> --profile prop --brief Art/Assets/<asset>/v<n>/brief.md`), register `topology`, `uv`, `texture`, `delivery` with `imported` provenance and measured metrics (`textureMiB` from `measure`), review each as **Reviews** above describes, then run `node tools/jam/jam.mjs check-delivery --run Art/Assets/<asset>/v<n>/run.json`. A revision replacing a delivered one gets a new `v<n>` and leaves the old one untouched.

**Done:** `check-delivery` returns `accepted: true`. Report the final GLB path, triangles, size in metres, credits spent with job ids, every fix and why, the scene-test render paths, and anything unresolved.
