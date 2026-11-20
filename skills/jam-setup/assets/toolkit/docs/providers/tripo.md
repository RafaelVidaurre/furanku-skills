# Tripo

Serves the mesh and motion routes. Unit: Tripo credits. API credits and Studio (browser) credits are separate balances with separate prices. The neutral procedure is [providers.md](../providers.md).

## Reach

- **CLI:** `npm install -g tripo-cli` ([official guide](https://developers.tripo3d.ai/en/docs/cli)), then `tripo --version`. The CLI carries its own skill: read `tripo docs --topic skill`, then the `commands/make` and `commands/generate` topics and the topic of any processing step you use.
- **MCP:** the official server is `npx -y tripo-cli mcp` ([guide](https://developers.tripo3d.ai/en/mcp)); with `--toolset full` it serves `tripo_rig_check`, `tripo_rig`, `tripo_animate` and `tripo_download`. The CLI documents `tripo anim rig`.
- **Studio (browser):** only when the person chooses it. An API-key sign-in does not identify the Studio account. Check the visible account, its balance, the model and options and the displayed price before submitting; a CLI estimate does not price a Studio job. Open the job with `--transport browser` and the Studio account as `--scope`, keep the visible task id, and download through the page. Credits that redeem in Studio are not API credits.

## Sign-in

The CLI signs in through the browser and stores its own credential; the person supplies no key. Reuse a verified profile. Otherwise ask which account site they use (international `ov` or mainland China `cn`), start `tripo login --region <site> --no-wait`, pass on its link and code on a local surface, and resume the same command after they approve. `--profile <name>` keeps accounts apart. `tripo whoami` shows profile and region but may not show the owner; the person confirms the account in the browser.

An inherited `TRIPO_API_KEY` overrides a stored profile. Never ask for a key or put one in a command or file.

Verified with `tripo doctor --json` and `tripo balance --json`. Report installed, signed in with the API reachable, and usable balance separately. A zero balance blocks paid jobs, not setup. Topping up is the person's action: `tripo topup --no-watch --no-open --json` prints the billing link without buying.

## Pricing a job

`tripo make ... --dry-run --json` prints the normalized request, warnings, removed fields, the view mapping and `generation_credits_estimate`. That is an offline list-price estimate (`--list-price`): it leaves out chain steps it cannot estimate and does not check plan access. Name the model explicitly; CLI defaults and presets can pick a more expensive one.

## Mesh generation

- `make` takes 2 to 4 images for multiview. Send individual views and read the normalized mapping in the dry run.
- Text-to-model suits a connectivity test, not production work.
- `face_limit` and generated UVs and textures are still measured and reviewed like any other result.

## Motion (checked 2026-11-20)

From the API v3 docs ([rig check](https://developers.tripo3d.ai/en/docs/animations-rig-check), [rig](https://developers.tripo3d.ai/en/docs/animations-rig), [retarget](https://developers.tripo3d.ai/en/docs/animations-retarget), [pricing](https://developers.tripo3d.ai/en/pricing), [changelog](https://developers.tripo3d.ai/en/docs/changelog) to "Rigging v3.0 and retargeting upgrade (2026-10)").

- **Clips play only on a model Tripo rigged.** Retarget means "Apply a preset animation to a rigged 3D model": its input is a Tripo rig task (or a later task on that model). No call takes the person's own skeleton or clip. Auto-rigging says nothing about fitting the project's own skeleton.
- **Rig check** (free) takes GLB, FBX, OBJ or STL up to 150 MB and returns whether the model can be rigged and a recommended rig type (biped, quadruped, hexapod, octopod, avian, serpentine, aquatic).
- **Rig models.** `v1.0-20240301` (default): bipeds only, the 90+ `preset:biped:*` clips. `v3.0-20260909`: "recommended for humanoid characters", requested explicitly. `v2.5-20260210`: creatures. Output `glb` (default) or `fbx`.
- **Output skeleton.** For bipeds `spec` picks the bone naming: `tripo` (default) or `mixamo`, and on v3.0 also `actorcore`, `unity`, `unreal` or `vrm`. No joint list is published. Retargeting brings the clip onto the project rig unless its skeleton is the project's.
- **Presets.** Up to 5 per request. v3.0 bipeds: `idle, walk, run, dive, climb, jump, slash, shoot, hurt, fall, turn`; creatures one each. `animate_in_place` plays a clip "in place without displacement". Frame rate, clip length and presets for avian rigs are not stated.
- **Prices:** "1 credit = $0.01 USD". Rig check free, rig 25 credits, retarget 10 per animation; "Failed and cancelled tasks are not charged."
- **Limits:** 10 rig-check, rig or retarget tasks at a time per account (HTTP 429 beyond). From 2026-12-01 API outputs are kept "for a maximum of 7 days".
- **Output rights** ([terms](https://developers.tripo3d.ai/en/terms), updated 2025-07-11): paid users "generally have all rights" and Tripo "will not use Inputs and Outputs as training data"; for free users Tripo retains all rights. Outputs may not be used to build competing models or services.

## Job custody

- Record the task id at once; the real charge is the task's `credits_consumed`.
- After a timeout: `tripo task watch <id> --download`. After a failed download: `tripo task get <id> --download`. Never `redo` to recover.
- A lost create response stays `lost` until provider history and balance are reconciled.
- Exit code 4 means insufficient credits: stop paid commands and tell the person.
- The CLI's `task.json` can hold temporary links and machine paths. Keep it in ignored scratch; record ids, settings, the charge and file hashes instead.

Studio's export menu offered USD, FBX, OBJ, STL, GLB and 3MF on 2026-11-14; check the current menu. A format on the menu is not proof it imports or keeps topology.
