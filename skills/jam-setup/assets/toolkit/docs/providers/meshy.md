# Meshy

Serves the mesh route. Unit: Meshy credits. The neutral procedure is [providers.md](../providers.md); this page holds what is true of Meshy only. Model ids, limits and prices are dated observations: read the live help before building on one.

## Reach

- **CLI (preferred):** the official `meshy` command with the `meshy-3d-generation` skill from [meshy-dev/meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent). Follow its [installation guide](https://raw.githubusercontent.com/meshy-dev/meshy-3d-agent/main/INSTALL.md); install the skill at user scope for the harness in use, for example `npx skills add meshy-dev/meshy-3d-agent --skill meshy-3d-generation -g -a claude-code`. Read the skill's setup and pipeline references and the CLI's own help for flags. The current skill needs CLI 0.8.6 or later (it calls `meshy view`): check `meshy --version` and update with `npm i -g meshy-cli@latest`.
- **MCP (optional):** only the [official server](https://github.com/meshy-dev/meshy-mcp-server). It needs `MESHY_API_KEY` from the environment; the person supplies it through their own secret handling, never in a command, a JSON file or the conversation. It has no dry run, so a job through it is priced from the published table.

## Billing (checked 2026-11-11)

- The CLI calls Meshy's API and draws on the same credit balance as the web app at API rates; the sources show no CLI surcharge and no separate CLI balance ([API cost FAQ](https://help.meshy.ai/en/articles/16815622-how-many-credits-does-each-meshy-api-task-cost)).
- Creating tasks needs the Pro plan or above. A Free account can sign in but cannot generate, and buying credits on Free does not unlock the API.
- Free retries are a web-app benefit ([plans](https://www.meshy.ai/pricing)); do not assume them for CLI jobs.
- Prices per operation: [API price table](https://docs.meshy.ai/en/api/pricing). Sign-in, status and balance calls create no task.

Tell the person these points before they sign in.

## Sign-in

Check first: `meshy auth status --format json --no-update-check`. When sign-in is missing (CLI 0.8.7):

- Host that must end its turn to show instructions: `meshy auth login --device --no-wait --format json --no-update-check`, give the person the instructions, then `meshy auth login --device-flow <flow_id> --format json --no-update-check` on their answer.
- Host that shows progress while a command runs: `meshy auth login --device --format json --no-update-check` in one session; read its instruction on standard error before waiting.

The person may be shown the `user_code` on a local surface. The `device_code`, tokens, the flow id and the code-bearing link from `--no-wait` stay local and out of notifications, screenshots and files. When the host cannot show the instruction privately, the person runs `meshy auth login` in their own terminal and leaves it open until the browser confirms.

Verified when `meshy auth status` and `meshy balance --format json --no-update-check` both succeed. A balance is neither a quote nor proof of plan access.

## Pricing a job

`meshy make ... --dry-run` returns an estimate (`--price-source "make --dry-run"`, no `--quote`). The real charge comes from the finished task.

## Mesh generation

- Multi-image generation takes 1 to 4 images; the first is the front view and the order of the rest does not matter.
- Multi-image generation has no Smart Topology. Its remesh option is `triangle` (default) or `quad` with a target count.
- Smart Topology exists for one image (and text preview) and outputs triangles only: `meshy-t2.5`, the default, takes 100 to 30,000 faces (default 15,000), `meshy-t2` 100 to 15,000. Meshy recommends it for assets with a face budget instead of remeshing a dense mesh down. That advice favours single-view; put the trade-off to the person as the neutral mesh-input rule says.
- A quad setting does not prove exported quads or usable edge flow.
- Remesh: 100 to 300,000 faces. UV unwrap: GLB input of at most 40,000 faces; it triangulates quads and returns an untextured model with new UVs. Retexture keeps the existing UVs only with `enable_original_uv: true`.
- Image to 3D can texture in the same task with `--texture-model`: `meshy-n1` gives a 2k base colour from the input image alone (no texture prompt, no PBR maps), `meshy-7` PBR maps up to 8k. A texture prompt and texture images are exclusive.
- `latest` moves; pin the model. `meshy-7` geometry answers 400 from 2026-12-31: use `meshy-7.1` (same parameters and price). `meshy-7` stays valid as a texture model. `lowpoly` is deprecated in favour of Smart Topology ([deprecations](https://docs.meshy.ai/api/deprecations.md)).

## Rigging

- Input: a textured GLB of a humanoid (`animation_type` `biped`, the default) or a four-legged animal (`quadruped`), at most 380,000 triangles, face toward +Z. A quadruped comes back with walk and run clips; jam-rig itself binds humanoids only.
- A biped's default skeleton is Meshy's own 24 bones in centimetres (`meshyrig`). `skeleton_template` picks another (`mixamo`, `ue5_mannequin` and more), returned in metres with that skeleton's bone names; `include_fingers: true` adds finger bones. A quadruped refuses both with a 400. CLI 0.8.7's `rigging create` has no flags for these: pass them with `--data`.
- The changelog says a v2 rigging endpoint defaults to `mixamo`; CLI 0.8.7 calls v1, whose default is `meshyrig`. Read the bone names in the returned file before choosing a landmark table: `meshyrig` reads through jam-rig's `left-right-camelcase.json`, `mixamo` through `mixamo.json` (with `--strip-prefix` when every name carries a namespace), `ue5_mannequin` through the Unreal adapter's `mannequin` skeleton profile.

## Job custody

- Credits are charged when the task is created; only a failed task is refunded.
- A client timeout or a dropped connection does not cancel a task, and there is no idempotency key. After a lost create response, keep the job `lost`, wait about a minute, list the newest tasks by creation time and match operation, inputs and time. One partial page without it is not proof of absence. An HTTP 4xx means no task was created.
- A task can return from in-progress to pending under the same id.
- Only a pending task can be cancelled and refunded; an in-progress one cannot.
- Outputs are kept 3 days outside the Enterprise plan and download links expire: download at once.

Sources: [task lifecycle](https://docs.meshy.ai/en/api/task-lifecycle), [asset retention](https://docs.meshy.ai/en/api/asset-retention), [llms.txt](https://docs.meshy.ai/llms.txt). Researched 2026-11-10; models, texturing and rigging re-read 2026-11-20 from the [deprecations](https://docs.meshy.ai/api/deprecations.md), [rigging](https://docs.meshy.ai/api/rigging.md) and [changelog](https://docs.meshy.ai/api/changelog.md) pages and CLI 0.8.7 help. Nothing here was confirmed by a paid generation.
