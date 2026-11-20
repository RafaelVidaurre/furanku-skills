# Scenario

Serves the image, mesh and motion routes, including third-party 3D and motion models it hosts. Unit: Compute Units (CU), Scenario's own credits ([explained](https://learn.scenario.com/account/compute-units-explained)). A model hosted here is billed by Scenario, whoever made the model. The neutral procedure is [providers.md](../providers.md).

## Reach

Scenario is reached through its MCP server at `https://mcp.scenario.com/mcp` with OAuth ([connection guide](https://mcp.scenario.com/docs)), driven by its official skills from [scenario-labs/skills](https://github.com/scenario-labs/skills): `scenario`, plus `scenario-image`, `scenario-meshy` and `scenario-3d` as the work needs.

```
npx skills add scenario-labs/skills --skill scenario scenario-image scenario-meshy scenario-3d -g -a claude-code
claude mcp add --transport http --scope user scenario https://mcp.scenario.com/mcp
```

For Codex: `-a codex` on the first line, then `codex mcp add scenario --url https://mcp.scenario.com/mcp` and `codex mcp login scenario`.

Keep the connection at user scope. Look at the client's MCP listing first: keep a matching server, and do not overwrite a conflicting one without a decision. Installing the skills does not create or sign in the connection. An API key is for headless use and is wired by the person from the official guide; an agent never asks for, places or echoes one.

## Sign-in

- **Claude Code:** after the server is registered, the person runs `/mcp` in an interactive session, selects `scenario`, chooses its authentication action and approves in the browser. A non-interactive session cannot complete this.
- **Codex:** run `codex mcp login scenario` yourself and pass on its browser instruction before asking whether it is done.

Verified when a free `teams_list` call succeeds after a reconnect or restart. `diagnostics_run` names the failing layer (`auth`, `tenant-scope`, `api-unreachable`, `healthy`).

## Scope

The server assumes no default team or project. Resolve `team_id` and `project_id` (`teams_list`, `projects_list`), confirm the pair with the person even when there is only one, pass both on every call, and record it as `--scope` on `jam job open`.

## Finding and running a model

- `recommend` finds by capability, `search` by name; both are free. `model_schema_get` is the contract: exact fields, caps, plan restrictions. When a schema has `runs_as`, call what `run_with` names.
- File fields take asset ids. Upload with `upload_asset`, PUT each part, then `upload_asset_complete`; never paste large base64 into an argument.
- Hosted third-party models use this server's parameter names and limits, which differ from the same model on its maker's own API. Read the hosted schema; never carry a limit over.
- A 403 that names a plan is not cleared by retrying.
- On hosted multi-view 3D models, a "left" input has meant the subject's own left. A sheet labelled from the viewer's side swaps the pair and can fuse front and back.

## Pricing a job

`model_run` with `dry_run: true` at the top level, beside `model_id` and `parameters`, prices that exact request without creating a job: record it with `--quote`. Through the catalog executor the dry-run field belongs inside the executor's `parameters`; a misplaced key is dropped silently and the job runs and is billed. A dry run cannot price a step whose input does not exist yet: use a stated estimate until the real input exists.

## Motion (checked 2026-11-20)

Scenario hosts other vendors' rigging and motion models and runs them like any model (`model_run`, `jobs_wait`, `asset_download`); 3D results download as `glb`, `fbx` or `obj`. Model ids and fields from the per-vendor reference pages under [3D model generation](https://docs.scenario.com/get-started/generation/3d-model-generation), updated 2026-07-29 to 2026-11-18; read each model's live schema before use.

| Mode | Model | What its page states |
| --- | --- | --- |
| library | `model_meshy-rigging`, then `model_meshy-animation` | Rigging: GLB input, "Humanoid characters only", `skeletonTemplate` with the nine values of Meshy's API. Animation: one `actionId` from Meshy's library; `change_fps` (24/25/30/60) or `extract_armature` |
| library | `model_tripo-rigging-v1`, `model_tripo-rigging-v2-5` | GLB, OBJ, FBX or STL input; an optional biped preset (11 listed), or creature rig types with their 5 presets; no naming, output-format or in-place fields |
| library | `model_rodin-hyper3d-rigging` | `boneTemplate` (auto, human, quadruped, bird, dragon, kaiju, custom); up to 10 of its stock animations, or "Up to 10 custom FBX animations matching the rig"; glb, fbx, usdz |
| text | `model_meshy-text-to-motion` | `prompt`, `duration` 2 to 10 s; "Prime outputs FBX; Swift outputs BVH. Retarget the clip onto your own rigged character." |
| text, video | `model_uthana-text-to-motion-3.0`, `model_uthana-video-to-motion-3.0` | Text `length` 4 to 10 s; video "2 to 60 seconds long"; fps 24, 30 or 60; text takes an optional `characterFile` to "auto-rig and use as the retargeting character" |
| text, video | `model_cartwheel-text-to-motion`, `-video-to-motion` (and `-character-rigging`) | glb, fbx in per-tool flavours, or ma/mb; `frameRate` 2 to 240; `moveInPlace`; `loop`; video with up to 4 people |
| text, video | `model_viggle-text-to-motion`, `model_viggle-video-to-motion-3d` | GLB or FBX; `rig` `mixamo` ("generic 50-joint rig you can retarget onto any character"), `metahuman` or `metahuman_body`; video `targetFps` up to 120 |

- The output skeleton is the vendor's, with that vendor's limits; retargeting brings it onto the project rig. Hosted options are a subset of the vendor's own API.
- **Landmark map.** The descriptor has no `rig.landmarks`, because each hosted model's skeleton is its vendor's: before retargeting, write a map of the skeleton in the downloaded clip, as [providers.md](../providers.md#motion) says.
- No CU price per motion job is published: a dry run gives the exact one.
- API access needs a paid plan ("The Free plan cannot use the API"). Generated assets are assigned to the person, "including commercial use"; on Free they are "for personal and evaluation use only". Hosted third-party models are "subject to any applicable usage policies of those providers" ([terms](https://www.scenario.com/terms-and-conditions) v2.1.1).

## Jobs and pacing

- Wait with `jobs_wait`; after a timeout continue with its `pending_job_ids`. Never submit a second `model_run` to poll.
- After a lost create response, look in `jobs_list` in the same scope before anything else.
- `job_cancel` rejects most generation jobs. Failed jobs are reimbursed, with a moderation exception.
- After each 3D job the model has a cooldown. A second job on it answers HTTP 429 with the wait in the body (one read "wait 2298 seconds"). Cooldowns are per model: run the next job on another suitable 3D model and say which. `consumption_limit_get` reads the real limits and the Compute Units left.
- Concurrency, quota and plan refusals are different 429s with different remedies: after any 429, stop before the next `model_run`, read which one it was and report it.
- Download with `asset_download`. Keep the asset id; its link is for the download only.

Researched 2026-11-10 from the guide and skills above, rechecked against skills v0.62 on 2026-11-20; the pacing facts were observed during a game jam in November 2026.
