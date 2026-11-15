# Asset contracts

Use `jam-3d` to compose work, or invoke a capability directly. Run commands from the repository root; `--root <folder>` supports isolated workspaces. Tools require Node 22.20+; cropping additionally needs Python 3.10+ and Pillow. Read [setup](setup.md) for dependencies/provider access, [providers](providers.md) for execution, and [review](review.md) before a review decision.

## Configuration and style

Use [task intent](task-intent.md) to carry authorization through the workflow and ask only for unresolved decisions. Approving a necessary budget for an already requested generation can authorize its next step; changing a cap in standalone setup does not.

`jam.config.json` is versioned project policy. `node tools/jam/jam.mjs setup` guides its initial creation without network calls. A missing style/profile is a draft, never an invented production default. `setup --from choices.json` applies previously decided initial settings; it refuses to overwrite existing settings. Use [project settings](settings.md) for subsequent spending/checkpoint changes; edit only decided fields for other changes. `jam.local.json` is ignored and may hold `python`, `blender` or `meshy` executable paths. No credentials or provider tokens belong in either file.

Configuration shape (numbers below are **illustrative, not an approved budget**):

```json
{
  "version": 1,
  "style": {"document": "Art/style.md", "references": ["Art/Style/v001/hero-shots/gameplay.png"]},
  "profiles": {
    "prop": {
      "platforms": ["Windows", "macOS"], "renderer": "desktop deferred",
      "camera": "third-person, 10 percent screen coverage at closest normal play distance",
      "cameraDistanceMeters": 3, "screenCoveragePercent": 10, "expectedInstances": 20,
      "assetKind": "static", "targetTriangles": 3000, "maxTriangles": 5000,
      "textureSize": 1024, "maxMaterials": 1, "maxTextureMiB": 8,
      "units": "meters", "up": "+Z", "forward": "-Y", "pivot": "bottom-center",
      "materialWorkflow": "pbr"
    }
  },
  "providers": {"image": "scenario", "mesh": "meshy"},
  "review": {"default": "human", "stages": {}},
  "spend": {"meshy": {"unit": "credits", "limit": 0}, "scenario": {"unit": "CU", "limit": 0}}
}
```

A profile requires only what the tool enforces: `assetKind`, `units`, `up`, `forward`, `pivot`, `targetTriangles`, `maxTriangles`, `textureSize`, `maxMaterials` and `maxTextureMiB`. `platforms`, `renderer`, `camera`, `cameraDistanceMeters`, `screenCoveragePercent`, `expectedInstances` and `materialWorkflow` are optional context for choosing budgets, validated when present. A deforming profile also requires `skeleton`, `maxInfluences`, and `poseRequirements`. Record target engine vertex/draw/texture-memory evidence after import; source budgets cannot establish those results. Texture memory is measured/estimated in MiB with format, compression, mip assumptions and method in evidence; file size is not GPU residency. `textureSize` is a maximum per dimension; non-square source maps are allowed within it. Provider minimums may exceed this maximum, requiring an explicitly selected resize/bake step before acceptance.

`review.default` and per-stage overrides are `human` or `agent`. `review.profiles.<profile>` (optional `default` and `stages`) sets the policy for one pipeline and overrides the project policy for runs of that profile. A run's `--human` list can only add human requirements. Provider `spend.limit` is a nonnegative number or explicit `null` for no cap; zero disables paid generation. Limits are independent **per provider, per run**, not team/global quotas. Existing session authorization governs spending; a limit or no-cap setting alone is not task authorization. Concurrent runs require the human/owner to allocate budgets explicitly (which may be explicitly uncapped); `authorization` must reference that actual allocation. Starting another run does not widen a human budget. All uncertain/in-flight charges reserve their full estimate; actual charges replace estimates when reconciled. Refunds are recorded from provider evidence, not assumed from failure.

## Files and custody

Use `Art/.scratch/<asset>/<candidate>/` for ignored work. Use `Art/Assets/<asset>/<revision>/` for accepted versioned delivery. All stored paths are relative to the repository, with forward slashes. Do not store absolute machine paths, credential values or signed download URLs. Model inputs/settings may reference durable provider asset IDs, but payload files must omit secrets and temporary URL signatures.

Approved style hero shots use `Art/Style/<revision>/hero-shots/` (for example `v001`), with `provenance.md` and any required rights-cleared `sources/` in the same revision. The configured style document (default `Art/style.md`) contains the current gallery and style rules; `style.references` lists the durable approved visual targets. This style library is distinct from production asset delivery under `Art/Assets/`; it does not require a mesh profile or delivery run. Follow [style preservation](style-exploration.md#carry-the-decision-forward) when promoting selected images from scratch.

A complete current style library has [representative coverage](style-coverage.md): at least three distinct human-approved hero shots, with more where the game's visual range needs them. Partial approved sets can be saved but remain in progress. Close completed style explorations with the [scratch cleanup procedure](style-cleanup.md). Cleanup preserves ledger records, unresolved-job directories and referenced files; staleness alone never makes an artifact disposable.

For model stages, record `runtimeModel` when the output is ambiguous; topology, texture and delivery persist the exact model selected for measurement. Catalog previews use that selection. Keep each candidate's outputs immutable once registered. New versions use new paths. A run records file SHA-256 hashes and, for the audit trail, the profile and style it started with. What makes a record **stale** is narrow: its own files, inputs or evidence changed, the run's brief changed, its profile was removed, a dependency was replaced, or the art-direction revision changed (`style.revision`, set when the user approves a new direction; runs without one belong to the unnamed first revision). Editing the style guide's text, adding hero shots or references, and editing a profile do not make work stale. Instead, every measured topology, texture and delivery record is re-checked against the run's **current** profile: work over a tightened budget shows `over-budget` until it is redone or the budget is relaxed. Re-admit unchanged useful work from a stale run into a new run and reconfirm it explicitly. Historical records remain intact. A human may reconfirm an exact named batch; record that response against each named record rather than infer blanket approval.

For the first profile added after a style-bound image run, [carry matching concept/turnaround decisions](review.md#carry-an-image-approval-into-the-first-profiled-run) instead of re-asking for unchanged approvals. This requires verified image/input/evidence, style and brief hashes, applicable approval scope and compatible reviewer policy; other changed-context re-admissions still need review.

Accepted delivery must be self-contained: copy all required source inputs, references, provider originals, maps, measurements and review evidence out of scratch into the revision, register a new run with those final paths, and obtain/reconfirm acceptance of that exact candidate. Never hand-edit paths inside old records to transfer approval. Keep editable `.blend`/FBX if quads matter; GLB does not preserve quad faces.

Accepted binaries use Git LFS; text manifests/briefs use ordinary Git. Download finished provider outputs promptly (Meshy's non-Enterprise retention is short). No signed URL is a durable deliverable. Check `git lfs ls-files`, LFS upload/pull results, and hashes when publishing/consuming an asset.

Engine import and any transfer to an engine host follow the project's own engine guidance; jam acceptance is separate from engine acceptance.

## Runs and independent capabilities

```sh
node tools/jam/jam.mjs init --run Art/.scratch/table/v1/run.json --id table --profile prop --brief Art/.scratch/table/brief.md
node tools/jam/jam.mjs status --run Art/.scratch/table/v1/run.json
```

`init` binds the current style and brief, plus the profile when supplied. Omit `--profile` for concept/turnaround work before geometry budgets are decided: this style-bound run permits those two stages and their paid intents, retains normal human reviews, crop validation and brief/style-revision staleness, and refuses geometry/surface stages and jobs. Resolve the profile after the turnaround; create a new profiled run and explicitly re-admit reusable artifacts under the review rules, without generating them again or rewriting old records. Adding a profile to project config does not retroactively change an image-only run. `--human concept,delivery` strengthens reviews.

Before style exists, `--exploration` (without `--profile`) still accepts only concept images and their paid accounting; it cannot register turnarounds, geometry or delivery. Record a bounded brief and authorization. Reference discussion/search and native previews may precede configuration; [image routes](images.md) defines custody and later admission. Exploratory approval is not automatically production acceptance.

Capabilities register ordinary artifacts and evidence using a stage-record JSON. Example:

```json
{
  "stage": "topology",
  "files": ["Art/.scratch/table/v1/final.glb", "Art/.scratch/table/v1/source.blend"],
  "inputs": ["Art/.scratch/table/v1/original.glb"],
  "evidence": ["Art/.scratch/table/v1/geometry-report.json", "Art/.scratch/table/v1/comparison.png"],
  "dependsOn": ["mesh"],
  "note": "Reduced the candidate; verified silhouette and openings at the gameplay camera.",
  "metrics": {"triangles": 2840, "materials": 1},
  "provenance": {"provider": "local", "model": "Blender <observed-version>", "transport": "blender-mcp"}
}
```

```sh
node tools/jam/jam.mjs register --run Art/.scratch/table/v1/run.json --record Art/.scratch/table/v1/topology-record.json
```

The command returns the record ID. Registering does not accept it. `dependsOn` names accepted stage records actually consumed, and stores their exact IDs. Replacing/rejecting a consumed record blocks its consumers; modifying any input/output/evidence bytes makes the record stale. Unrelated records do not invalidate it. Existing external inputs can use `inputs` with no stage dependency, but the capability must qualify those inputs itself. Any non-concept stage with no dependencies requires `imported` provenance, including its source and origin evidence; a local edit does not erase the source's origin. Do not hide a real dependency to avoid review.

Stages are `concept`, `turnaround`, `mesh`, `topology`, `uv`, `texture`, `delivery`. They are capability labels, not a scheduler. The composer chooses order and records dependencies. `turnaround` adds `views` mapping exactly `front`, `left`, `back`, `right`, `three-quarter` to distinct paths in `files`; include the crop report in evidence. New generated `mesh` records require accepted `turnaround` in `dependsOn`; imported meshes use provider `imported` and source provenance instead.

`topology` and `delivery` require measured exported `triangles` and `materials`. `texture` and `delivery` require `textureDimensions` (array of `[width,height]` pairs) and `textureMiB`. An untextured material uses an empty array/zero with evidence explaining it. For GLB outputs the tool recomputes geometry and image metrics with maintained glTF Transform decoding, rejecting mismatched supplied values. `textureMiB` is its conservative RGBA8 full-mip estimate, not actual engine VRAM. Include the DCC/engine command, source/export hash and report that established each measurement.

Deforming `delivery` also names `deformationEvidence`, a path included in `evidence`, showing the target skeleton, influences and specified extreme/representative poses. The review examines it; a path existing does not prove good deformation. A composer delivery depends on accepted topology/UV/texture and contains its actual artifact bundle. `check-delivery` requires accepted topology/UV/texture dependencies, accepted delivery, reconciled jobs and a self-contained non-ignored record closure under the same `Art/Assets/<asset>/<revision>/` as its `run.json`. It does not prove aesthetic quality, license terms, engine import or performance.

## Reviews

Follow [the review procedure](review.md). A decision record is:

```json
{
  "record": "<current record id returned by register>",
  "actor": "human",
  "by": "<person who actually decided>",
  "decision": "accept",
  "reason": "<their actual decision and any scope>",
  "source": "<conversation message or review entry reference>"
}
```

```sh
node tools/jam/jam.mjs review --run Art/.scratch/table/v1/run.json --stage topology --record Art/.scratch/table/v1/decision.json
```

Decisions are `accept`, `reject`, `revise`. An agent cannot satisfy a human gate with `actor: agent`. A local JSON record cannot authenticate a person: agents must transcribe real responses and never fabricate authority. File and dependency freshness is checked again before reuse. Policy changes apply on status; only the human can lower a human requirement. Stricter run preferences persist.

## Paid operation ledger

Before submitting, use the selected provider's supported quote/estimate flow and record intent:

```json
{
  "stage": "mesh", "provider": "scenario", "transport": "mcp", "scope": "<confirmed team/project>",
  "operation": "<discovered model id and operation>", "request": "Art/.scratch/table/v1/request.json",
  "estimate": 20, "unit": "CU", "priceKind": "quote",
  "priceSource": "model_run dry_run result <reference>", "priceDate": "<ISO date>",
  "authorization": "<actual standing budget or human approval reference>"
}
```

```sh
node tools/jam/jam.mjs job-intent --run Art/.scratch/table/v1/run.json --record Art/.scratch/table/v1/intent.json
node tools/jam/jam.mjs job-update --run Art/.scratch/table/v1/run.json --job <intent-id> --record Art/.scratch/table/v1/update.json
```

Updates contain `state` and `evidence` (provider result/reconciliation reference). `submitted` additionally needs `jobId`; `succeeded`, `failed`, `cancelled` need actual charge `actual`. Lost response: update to `unknown`, reconcile through the provider, then `submitted` with recovered ID or `not-submitted` only with positive evidence. `not-submitted` releases the reservation. Never resolve uncertainty by guessing a zero charge. Matching unresolved request-file hashes across the project block a second intent. Different payloads can still duplicate intent semantically; the provider procedure and agent must detect that. The tool does not submit jobs and cannot police out-of-band provider calls.

Every mutation locks one run and atomically replaces its JSON. `job-intent` additionally locks the project Art ledger while scanning every `run.json` under `Art/` for matching unresolved request hashes, so a fresh run cannot bypass duplicate detection. The same request must be reconciled before another run reuses it. All runs must be named `run.json`. A lock error stops the writer; no automatic deletion based on elapsed time. Verify the previous writer exited before recovering its lock. Keep one owner per run; use separate runs for independent assets.

## Deterministic measurement and provenance

Install the pinned decoder with `npm ci --prefix tools/jam --ignore-scripts`. Run `node tools/jam/jam.mjs measure --file <relative-file.glb>` for a report. At topology, texture and delivery registration, `runtimeModel` names the output model in `files`; it is inferred only when there is exactly one GLB. Standard GLB metrics are always recomputed, including scene instances, triangle lists/strips/fans, material count and embedded image sizes. Network/external-resource GLBs, unsupported codecs/extensions and non-triangle primitives fail explicitly; a missing decoder is a dependency gap, not permission to type substitute numbers.

For a deliberately chosen non-GLB delivery/DCC route, `measurementReport` must be an evidence JSON with `model: {path, sha256}`, `tool`, `command` and `metrics`. Produce it with the supported DCC measurement tool for the actual file and inspect its output. The record checks binding and budgets, not the truth of externally reported values; this evidence has a different strength from the GLB decoder. Quad native sources can accompany the audited runtime GLB.

`turnaround` additionally names `cropReport` in evidence. Registration decodes all five images and compares their actual dimensions and SHA-256 values to that report, then enforces equal canvas sizes. A valid crop report does not establish visual coherence.

Paid `meshy`/`scenario` provenance needs `job` naming a succeeded local intent for that provider; its original request hash must still match. Imported work needs both `source` (its actual origin) and `sourceEvidence` naming an origin document in inputs/evidence. When promoting already generated work to a self-contained final revision, import the preserved originals with origin evidence containing the original job/ledger/authorization references; do not pretend a second provider submission occurred. These are auditable assertions, not cryptographic proof of ownership or human identity.

Commands accepting `--record` also accept `--record -` for JSON on stdin, avoiding throwaway record files. A record itself still binds ordinary artifact/evidence files.
