# Tripo

Serves the mesh route. Unit: Tripo credits. API credits and Studio (browser) credits are separate balances with separate prices. The neutral procedure is [providers.md](../providers.md).

## Reach

- **CLI:** `npm install -g tripo-cli` ([official guide](https://developers.tripo3d.ai/en/docs/cli)), then `tripo --version`. The CLI carries its own skill: read `tripo docs --topic skill`, then the `commands/make` and `commands/generate` topics and the topic of any processing step you use.
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
- Auto-rigging says nothing about fitting the project's own skeleton.

## Job custody

- Record the task id at once; the real charge is the task's `credits_consumed`.
- After a timeout: `tripo task watch <id> --download`. After a failed download: `tripo task get <id> --download`. Never `redo` to recover.
- A lost create response stays `lost` until provider history and balance are reconciled.
- Exit code 4 means insufficient credits: stop paid commands and tell the person.
- The CLI's `task.json` can hold temporary links and machine paths. Keep it in ignored scratch; record ids, settings, the charge and file hashes instead.

Studio's export menu offered USD, FBX, OBJ, STL, GLB and 3MF on 2026-11-14; check the current menu. A format on the menu is not proof it imports or keeps topology.
