# Generative 3D character animation: providers and open models

Research note, 2026-11-20. Scope: which services and open models can produce humanoid 3D character animation for a game project through an agent, and how. The note serves a provider capability `motion` with four modes:

- `inbetween`: motion between given key poses.
- `text`: text to motion.
- `video`: motion capture from video.
- `library`: preset clips applied to a rig.

It also serves a skill that retargets any humanoid clip onto the project's own rig. NVIDIA MotionBricks has its own note ([motionbricks-best-practices-2026-11-20.md](motionbricks-best-practices-2026-11-20.md)) and is not repeated here. Nothing below assumes the user's OS, GPU, engine, plan or accounts.

**What was read.** Official docs, API references, OpenAPI specs, changelogs, pricing pages, terms pages, official SDK, CLI and MCP packages, official repositories at pinned commits, Hugging Face model cards at pinned revisions, papers, and body-model and dataset licence pages. Everything was read on 2026-11-20. Docs pages that carry no date of their own are pinned to the newest changelog entry or package version seen that day. No account was created, no key was used and no credits were spent, so every claim about paid behaviour comes from documentation, not from a run. Press articles, reviews and third-party agent skills were used only as leads and are never cited.

**How to read this note.** **Part A** holds facts, each linked to the page that owns it, with short verbatim quotes where wording matters. **Part B** lists open questions. **Inference** marks a conclusion drawn from facts; it is never used as a rule on its own. A comparison table and the "Candidates for jam provider descriptors" section close the note. "Own rig" means a skeleton the provider builds; "user rig" means a skeleton the user already has.

---

## Part A — What each provider states

### A1. Meshy

Sources: the API docs at `docs.meshy.ai/api/*.md`. Each docs page has a Markdown twin, and the index is [llms.txt](https://docs.meshy.ai/llms.txt). The newest [API changelog](https://docs.meshy.ai/api/changelog.md) entry is 2026-11-18. Also read: [openapi.yaml](https://docs.meshy.ai/openapi.yaml) v1.0.0, npm `meshy-cli` 0.8.7 and `@meshy-ai/meshy-mcp-server` 0.6.12.

**Rigging.** `POST /openapi/v1/rigging` ([rigging](https://docs.meshy.ai/api/rigging.md)).
- **Input.** `input_task_id` or `model_url`. A model URL must point to a GLB: at most 400 MB by URL or 100 MB as a data URI, at most 380,000 triangles, and "The character's face must point toward the +Z axis".
- **Not suitable:** "Untextured meshes" and "Assets that are neither humanoid nor four-legged animals".
- **Rig type.** `animation_type` is `biped` (default) or `quadruped`. Quadruped was added 2026-11-18 per the changelog.
- **`skeleton_template`.** Added 2026-11-10; biped only. Values: `meshyrig` (default), `mixamo`, `ue5_mannequin`, `unity_humanoid`, `max_biped`, `maya_human_ik`, `blender_rigify_basic_human`, `cc5_hd_neutral_base`, `daz_genesis9`.
  - The page: "With a value other than `meshyrig` … the files are in meters and use that skeleton's bones, instead of the default 24-bone `meshyrig` files in centimeters."
  - "A model that Meshy can't rig on that skeleton fails the task".
  - When only `meshyrig` is possible, Meshy doesn't charge for the request.
- **`include_fingers`.** Biped only. With `meshyrig` the finger bones "use Mixamo names, such as `LeftHandThumb1`".
- **Outputs.**
  - `rigged_character_fbx_url` and `rigged_character_glb_url`.
  - `basic_animations`: walking and running clips as GLB and FBX, plus an armature-only GLB.
- **Pose.** The API page sets no hard rule. The web-app guide recommends a T-pose or A-pose ([webapp rigging guide](https://docs.meshy.ai/webapp/guides/3d-model/rigging)).
- **Web-only.** The web app also has "Smart Rig (Beta)" for creatures, robots and props. Such models "can't use the animation library and download as GLB only". The API docs do not mention it (inference: it is web-only).

**Preset library.** `POST /openapi/v1/animations` ([animation](https://docs.meshy.ai/api/animation.md)).
- **Input.** `rig_task_id` of a SUCCEEDED Meshy rigging task. Send exactly one of:
  - `action_id`;
  - `action_ids`: 1–10 IDs, returned as "one file with one animation clip per action";
  - `motion_task_id`: see Text to Motion below.
- **Outputs.** `animation_glb_url` and `animation_fbx_url`. `post_process.operation_type` is one of `change_fps`, `fbx2usdz` or `extract_armature`. `fps` is one of 24, 25, 30 or 60, default 30.
- **Catalog.** Served by `GET /openapi/v1/animations/library`, which needs auth but "costs no credits" ([animation library](https://docs.meshy.ai/api/animation-library.md)).
  - The rendered table, counted for this note, lists 656 biped clips (IDs 0–696) and 127 quadruped clips (IDs 1055–1264, eleven animals).
  - IDs are not contiguous, and retired IDs disappear.
  - The web pricing page says "over 500" clips on paid plans and 20 on Free.
- **Docs conflict.** The web-app animate guide still says the library and Text to Motion are for humanoids only. The API page, updated 2026-11-18, accepts quadruped clips on quadruped rigs.
- **Not documented:** the native frame rate of library clips, and any in-place versus root-motion switch.

**Text to Motion.** `POST /openapi/v1/text-to-motion`, added 2026-08-21 ([text-to-motion](https://docs.meshy.ai/api/text-to-motion.md)). It is not in the OpenAPI spec.
- **Inputs.** `prompt` of up to 400 characters, and a required `duration` of 2–10 s in 0.5 s steps.
- **`mode`.** `prime` "returns an FBX clip" for 10 credits; `swift` "returns a BVH clip" for 3 credits.
- The output is a standalone clip that "doesn't need a character model".
- **Applying it.** Pass `motion_task_id` to the animation endpoint; biped rigs only. On every rig the clip is named `retarget_clip` ([rigging](https://docs.meshy.ai/api/rigging.md)).
- **Not documented:** the skeleton and joint names of the raw FBX or BVH.

**Not offered.** No official page describes motion from images or video.

**User rigs.** The animation endpoint accepts only a Meshy `rig_task_id`. A user's own mesh can be rigged via `model_url`, but Meshy builds the skeleton. For other rigs, the web FAQ sends users to "retarget Mixamo clips in Blender or Maya". Inference: no API applies clips to a user-supplied skeleton. `skeleton_template` instead lets Meshy rig onto a named standard skeleton.

**Async model and limits.**
- **Task updates.** Polling (honouring `Retry-After`), SSE at `/:id/stream`, or webhooks.
- **Billing.** Credits are "charged when a task is created" and refunded on FAILED, and "there is no idempotency key".
- **Rate limits.** 20 requests/s on every self-serve plan, with 10 to 100 concurrent tasks depending on the plan ([rate limits](https://docs.meshy.ai/api/rate-limits.md)).
- **Retention.** API assets are kept "at most 3 days" except on Enterprise ([asset retention](https://docs.meshy.ai/api/asset-retention.md)).

**Pricing.** Per [API pricing](https://docs.meshy.ai/api/pricing.md):
- Rigging 5 credits, for biped or quadruped.
- Animation 3 credits per action.
- Text to Motion 10 credits (prime) or 3 (swift).
- The library lookup is free.

"You need a paid plan to create and manage API keys" ([quick start](https://docs.meshy.ai/api/quick-start.md)), and on Free a create request returns 402. The [pricing page](https://www.meshy.ai/pricing) lists Free (100 credits), Pro, Premium, Ultra, Studio and Enterprise; the currency shown depends on location. No per-credit price is published publicly.

**Terms.** [Terms of use](https://www.meshy.ai/terms-of-use), last updated 2026-09-19.
- **Free plan (§3.2).** "Meshy owns all right, title, and interest … in and to the Customer Output" and licenses it "under the Creative Commons Attribution 4.0 International License".
- **Paid plans.** "such customers on a paid Meshy plan own their Customer Output".
- **§2.6(xi).** Bars using outputs "to train, develop, or improve AI models that are competitive with Meshy".
- **§2.9.** Non-Enterprise inputs and outputs may be used "to train, validate, test, or improve Services". Opt-out is by contacting support.
- **Acceptable use.** The [acceptable use policy](https://www.meshy.ai/acceptable-use-policy) bans "unauthorized automated or scripting processes". Inference: the official API, CLI and MCP are authorised routes.

**Agent routes.**
- **CLI.** `meshy-cli` 0.8.7 (MIT; [meshy-dev/meshy-cli](https://github.com/meshy-dev/meshy-cli); Node ≥ 22.12) provides `rigging`, `animate`, `text-to-motion` and `animation-catalog` ([cli](https://docs.meshy.ai/api/cli.md)).
  - Sign-in is by browser or device code.
  - The dedicated `rigging` flags cover only input, height and texture. Inference: `animation_type`, `skeleton_template` and `include_fingers` need the CLI's generic JSON body.
- **MCP.** `@meshy-ai/meshy-mcp-server` 0.6.12 ([meshy-dev/meshy-mcp-server @ ad5f648](https://github.com/meshy-dev/meshy-mcp-server/tree/ad5f64836a3cecadfb1a4bb6cb68d3b09299bb5c), 2026-11-17) needs an API key. It exposes `meshy_rig`, `meshy_animate`, `meshy_text_to_motion` and `meshy_list_animations`.
  - Its rig input schema is `.strict()` and allows only `input_task_id`, `model_url`, `height_meters` and `texture_image_url`. **Quadruped rigs, `skeleton_template` and fingers are therefore not reachable through this MCP version.**

### A2. Tripo

Sources: API v3 docs under `developers.tripo3d.ai/en/docs/` (`platform.tripo3d.ai/docs` redirects there). Also read: the [changelog](https://developers.tripo3d.ai/en/docs/changelog), whose newest relevant entry is "Rigging v3.0 and retargeting upgrade (2026-10)"; npm `tripo-cli` 0.11.2 (published 2026-11-04); PyPI `tripo3d` 1.0.0.

**Rig check.** `POST /v3/animations/rig-check` ([rig-check](https://developers.tripo3d.ai/en/docs/animations-rig-check)).
- Accepts GLB, FBX, OBJ or STL up to 150 MB.
- Returns `riggable` and a recommended `rig_type`: biped, quadruped, hexapod, octopod, avian, serpentine or aquatic.
- Free.

**Auto-rig.** `POST /v3/animations/rig` ([rig](https://developers.tripo3d.ai/en/docs/animations-rig)).
- **`input`.** A generation task ID, an uploaded file token or a public URL, so a user's mesh can be rigged.
- **Rig models.**
  - `v1.0-20240301` is the default: "biped (humanoid) only. Supports 90+ animation presets".
  - `v2.5-20260210` is for non-humanoid creatures.
  - `v3.0-20260909` is "recommended for humanoid characters" and must be requested explicitly.
- **`spec`.** "Only takes effect when `rig_type` is `biped`".
  - `tripo` (default): "Tripo native bone naming".
  - `mixamo`: "Mixamo-compatible bone naming".
  - With v3.0: also `actorcore`, `unity`, `unreal` and `vrm`.
- **Output.** `out_format` is `glb` (default) or `fbx`.
- No joint list is published.

**Animation.** `POST /v3/animations/retarget` ([retarget](https://developers.tripo3d.ai/en/docs/animations-retarget)).
- Described as "Apply a preset animation to a rigged 3D model".
- **`input`.** "The task_id of a rigged model", either the rig task or a later task on that model.
- **Presets.** Up to 5 per request.
  - v3.0 bipeds have 11: `idle, walk, run, dive, climb, jump, slash, shoot, hurt, fall, turn`.
  - Creatures have one each: `quadruped:walk`, `hexapod:walk`, `octopod:walk`, `serpentine:march`, `aquatic:march`.
  - v1.0 bipeds use the `preset:biped:*` set, documented as "90+".
- **Options.** `animate_in_place` ("Play animation in place without displacement") and `export_with_geometry`. `bake_animation` is "Deprecated and ignored".
- **Not documented:** frame rate, clip length, presets for avian or `others` rigs, and any way to supply one's own clip. "Retarget" here means a Tripo preset onto a Tripo rig.

**Not offered.** No text-to-motion or video-to-motion appears in the [docs index](https://developers.tripo3d.ai/llms.txt).

**Async model and limits.**
- **Tasks.** Every task returns a `task_id`, polled at `GET /v3/tasks/{id}` or reported by webhook ([task lifecycle](https://developers.tripo3d.ai/en/docs/task-lifecycle)).
- **Concurrency.** The animation pool (rig check, rig, retarget) is 10 tasks per account, with HTTP 429 beyond ([rate limits](https://developers.tripo3d.ai/en/docs/rate-limits)).
- **Retention.** From 2026-12-01 API assets are kept "for a maximum of 7 days" ([asset retention blog](https://developers.tripo3d.ai/en/blog/asset-retention-policy)).

**Pricing.** Per [pricing](https://developers.tripo3d.ai/en/pricing) and [billing](https://developers.tripo3d.ai/en/docs/billing): "1 credit = $0.01 USD".
- Rig check: free.
- Auto-rig: 25 credits. The changelog says v3.0 prices are "unchanged".
- Retarget: "10 / animation".
- "Failed and cancelled tasks are not charged."
- No plan is required for API credits.

**Terms.** [Terms](https://developers.tripo3d.ai/en/terms), last updated 2025-07-11.
- **Free users (§5.2.1).** "Tripo retains all rights" to outputs.
- **Paid users (§5.2.2).** They "generally have all rights", and "Company will not use Inputs and Outputs as training data".
- **§3.2.** Allows "lawful commercial or non-commercial purposes". It bars using outputs to build competing models or services, and bars "automated tools, except as expressly permitted". Inference: the documented API is expressly permitted.

**Agent routes.**
- **CLI.** `tripo-cli` provides `tripo anim rig` ([cli](https://developers.tripo3d.ai/en/docs/cli)).
- **MCP.** The official MCP server is `npx -y tripo-cli mcp` ([mcp](https://developers.tripo3d.ai/en/mcp)). With `--toolset full` it serves `tripo_rig_check`, `tripo_rig`, `tripo_animate` and `tripo_download`.
  - The `tripo_rig` tool text says the 90+ `preset:biped:*` clips "exist only on v1.0 rigs".
- **Python SDK.** [Tripo-Developer/tripo-python-sdk @ aa94035](https://github.com/Tripo-Developer/tripo-python-sdk/tree/aa94035f) has `rig_check`, `rig` and `retarget`.
- **Not current.** The older GitHub `tripo-mcp` repository is a Blender bridge with no rig tools. Its last commit was 2025-04-14.

### A3. Scenario

Sources:
- the 3D generation docs at `docs.scenario.com`, whose per-vendor pages are "auto-generated from model configurations" and were updated 2026-07-29 to 2026-11-18;
- the MCP docs at [mcp.scenario.com/docs](https://mcp.scenario.com/docs);
- npm `@scenario-labs/sdk` 3.5.0 (2026-10-30);
- the [terms and conditions](https://www.scenario.com/terms-and-conditions), v2.1.1 of 2026-07-16.

**Model.** Scenario does not build its own motion models. It resells other vendors' rigging and motion models as hosted models, all run the same way.
- **REST.** `POST https://api.cloud.scenario.com/v1/generate/custom/{modelId}` returns a `jobId`. Poll `GET /v1/jobs/{jobId}`; results arrive as asset IDs, and `POST /assets/{assetId}/download` can convert 3D to `glb`, `fbx` or `obj` ([3D generation](https://docs.scenario.com/get-started/generation/3d-model-generation)).
- **MCP.** `https://mcp.scenario.com/mcp`, using OAuth or an API key. Tools include `model_run` (which takes `dry_run`), `jobs_wait` and `asset_download`.

**Motion-related hosted models** (per-vendor reference pages under [3D model generation](https://docs.scenario.com/get-started/generation/3d-model-generation)):

| Model ID | Vendor | What the page states |
|---|---|---|
| `model_meshy-rigging` | Meshy | GLB input, `heightMeters`, `includeFingers`, the same nine `skeletonTemplate` values as Meshy's API; "Humanoid characters only" |
| `model_meshy-animation` | Meshy | One `actionId` from Meshy's library; `change_fps` (24/25/30/60) or `extract_armature` |
| `model_meshy-text-to-motion` | Meshy | `prompt`, `duration` 2–10 s; "Prime outputs FBX; Swift outputs BVH. Retarget the clip onto your own rigged character." |
| `model_tripo-rigging-v1` | Tripo | GLB/OBJ/FBX/STL input; optional biped preset (the enum lists 11); no `spec`, `out_format` or in-place fields |
| `model_tripo-rigging-v2-5` | Tripo | Creature rig types and the 5 creature presets |
| `model_uthana-character-rigging` | Uthana | Character file "30mb max size" |
| `model_uthana-text-to-motion-3.0` | Uthana | `length` 4–10 s; fps 24/30/60; optional `characterFile` to "auto-rig and use as the retargeting character" |
| `model_uthana-video-to-motion-3.0` | Uthana | Video "2 to 60 seconds long"; fps 24/30/60 |
| `model_cartwheel-character-rigging`, `-text-to-motion`, `-video-to-motion` | Cartwheel | Output glb, or fbx in Blender/Maya/Unreal/Roblox flavours, or ma/mb; `frameRate` 2–240; `moveInPlace`; `loop`; video up to 4 people |
| `model_viggle-text-to-motion`, `model_viggle-video-to-motion-3d` | Viggle | GLB/FBX; `rig` `mixamo` ("generic 50-joint rig you can retarget onto any character"), `metahuman` or `metahuman_body`; video `targetFps` up to 120 |
| `model_rodin-hyper3d-rigging` | Deemos (Rodin) | `boneTemplate` options auto, human, quadruped, bird, dragon, kaiju, custom; up to 10 of its stock animations; `animationFiles`: "Up to 10 custom FBX animations matching the rig"; glb/fbx/usdz |

**Pricing.**
- **API access.** "API access is available on every paid plan, from Starter up. The Free plan cannot use the API" (Scenario help centre, API access article, updated about one month before reading).
- **Plans.** Starter $15/month for 1,500 CU, Pro $45 for 5,000 CU, Max $75 for 10,000 CU ([pricing](https://www.scenario.com/pricing)).
- **Cost per job.** No CU price per motion job is published. A dry run returns "the exact CU cost" for a given payload.
- **Concurrency.** 2 to 10 jobs per seat by plan, with HTTP 429 beyond.

**Terms.**
- **Ownership.** "Scenario assigns to you all right, title, and interest in and to the Generated Assets … including commercial use".
- **Free plan.** Outputs are "for personal and evaluation use only".
- **§4.6.** Self-serve content may be used to improve Scenario's models.
- **§9.2.** Third-party models are "subject to any applicable usage policies of those providers".
- **§5.2.** Forbids automated access "outside of the documented API".

### A4. Commercial motion services with a public API

**Uthana** (text, video, locomotion, stitching; animates a user-supplied character). Sources: [API docs](https://uthana.com/docs/api/), [pricing](https://uthana.com/pricing), [terms](https://uthana.com/terms) v2.0.0, effective 2026-11-09.
- **Access.** GraphQL at `https://uthana.com/graphql` with an API key from self-serve sign-up. Official clients: Python `uthana` and npm `@uthana/client`. No CLI or MCP server is documented.
- **User characters.** Upload an FBX or GLB/glTF character. A mesh without a skeleton is auto-rigged, which "typically takes an additional 30-60 seconds".
  - Motions are retargeted onto any uploaded character. The [retargeting page](https://uthana.com/docs/api/capabilities/retargeting) was seen only as a search snippet and should be re-read.
  - Auto-rigging is bipedal humanoid only.
- **Text → motion** ([text-to-motion](https://uthana.com/docs/api/capabilities/text-to-motion)). Model 3.0 is an async job of 4–10 s; Lite and Mini take 5–10 s; 2.0 is synchronous at 0.25–10 s.
- **Video → motion** ([video-to-motion](https://uthana.com/docs/api/capabilities/video-to-motion)). Input "2-60 seconds, 24-120 fps, 300px to 4096px".
- **Output.** FBX or GLB, with the mesh or motion only. "Download at specific FPS (24, 30, or 60)".
- **Pricing.** Pay-as-you-go credits that never expire; new subscriptions stopped in August 2026.
  - Text 3.0: $0.10/s.
  - Video 3.0: $0.06/s.
  - Locomotion: $0.02/s.
  - Stitch/loop: $0.01/s.
  - Auto-rig: $0.15.
- **Terms.**
  - "automated API requests, integrations, and agent workflows are permitted".
  - "a Paying Customer owns Customer Outputs".
  - "You may reproduce, modify, display, distribute, and commercially use your outputs in games".
  - Unpaid use requires the credit "Animation generated with Uthana (uthana.com)".
  - Outputs may not be used to "develop, train, fine-tune, or distill" animation-generation models.

**Viggle** (text, video). Sources: [developer docs](https://docs.viggle.ai/llms-full.txt), [text-to-motion quickstart](https://docs.viggle.ai/v1/guides/quickstart-text-to-motion), [terms](https://viggle.ai/terms-of-use) last updated 2026-08-26.
- **Access.** REST at `https://apis.viggle.ai/v1` with a Bearer key. 1 credit = $0.01, and new accounts get 100 free credits ([developers](https://viggle.ai/developers)). The docs mention OAuth for "Remote MCP clients", but no MCP setup page was found.
- **Text → motion.** `POST /v1/motions`, text of 1–400 characters. `duration_seconds` is snapped to 30 fps frames; "values outside `[3, 60]` return `400`". "Flat $0.10 (10 credits) per request".
- **Video → motion.** $0.05 per second of source video; `target_fps` defaults to 25.
- **Output.**
  - GLB or FBX, delivered on three rigs: `mixamo_url` ("generic 50-joint skeleton you'll retarget onto your own character"), plus 441-joint and 86-joint MetaHuman-style rigs.
  - Viggle does not retarget onto a user's rig.
  - Links are "valid for 1 hour".
- **Terms (§25).** "you will own all User Inputs and AI generated outputs of the Viggle API". API outputs may be used "for lawful commercial purposes", and Viggle will not use them "to train any of its models".

**Cartwheel** (text "Swing", video "Comic", rigging and retargeting). Sources: [API announcement](https://getcartwheel.com/blog/api-announcement) (March 2026), [pricing](https://getcartwheel.com/pricing), [terms](https://getcartwheel.com/terms-of-use) last revised 2026-08-20, official MCP server [Cartwhl/cartwheel-mcp](https://github.com/Cartwhl/cartwheel-mcp) (MIT).
- **Access.** The API is included on Individual Basic and higher paid plans. The MCP server "auto-rigs unrigged meshes and detects existing rigs" and retargets onto a scene character.
- **Output.** "Every completed motion comes with a downloadable BVH or FBX file". The Scenario-hosted variant exposes `frameRate` 2–240 and FBX flavours per DCC tool or engine.
- **Pricing.** In credits: Swing Sketch 1 credit/s, Choreo 3–4 credits/s, video 1 credit per person-second, rigged character 50 credits. Retargeting and export are free. Plan prices were not shown on the page.
- **Terms.** Use is allowed "solely for your internal business purposes and lawful commercial use". The terms do not state who owns outputs.
- **Not documented:** the skeleton, duration limits and the API reference. The [API reference](https://api-docs.getcartwheel.com/) rendered only its title.

**Move AI** (video, single or multi-camera). Sources: [developer docs](https://developers.move.ai/docs/intro/), [limits](https://developers.move.ai/docs/limits), [rigs](https://developers.move.ai/docs/usage/rigs), [API pricing](https://developers.move.ai/docs/pricing/), [Move API EULA](https://move.ai/move-one-api-eula) (undated).
- **Access.** GraphQL at `https://api.move.ai/ugc/graphql` and Python SDK `move_ugc`. The docs do not say whether sign-up is self-serve; the EULA refers to usage limits "set out in the quote".
- **Input.** 2–60 s, 24–120 fps, at most 500 MB, MP4 or MOV; 2–4 cameras for multi-camera jobs.
- **Output.**
  - Formats: "FBX, BVH, USDC, USDZ, GLB, Blend, C3D, JSON, and CSV".
  - Rigs: `mixamo_f`, `mixamo_m`, `ue5_manne`, `ue5_quinn`, `move_mo`, `move_ve`, `decentraland`. No custom-rig upload is documented.
- **Pricing.** Single camera $0.012–0.024/s. Multi-camera $0.024–0.043/s per camera, with multipliers for frame rate and resolution, and a minimum of $0.10 per job.
- **EULA.**
  - Move AI "owns … the Motion Data, Output" and grants a worldwide, royalty-free licence.
  - The permitted purpose is importing Output into "your or a third party's visualisation or ingestion engine".
  - Prohibited Use (iii): use "as an input for any AI System … other than solely for purposes of creation of an original video work".

**Plask** (video). Sources: [Pose API docs](https://plask.ai/en-US/docs/8) (updated 2026-10-11, runtime 0.4.3), [OpenAPI](https://pose-api.plask.ai/openapi.json) v1.0.0, [pricing](https://plask.ai/pricing), [terms](https://plask.ai/en-US/docs/100002) (last updated 2023-04-05).
- **Access.** REST at `https://pose-api.plask.ai` with self-created scoped keys. The flow is upload, then `POST /v1/jobs`, then SSE progress, then fetch the result. "Each committed pose costs one credit".
- **Limits.** Upload up to 512 MiB; `end_frame` up to 18,000.
- **Output.**
  - The result schema is untyped, so the API's file format is undocumented.
  - The realtime skeleton is `smpl24-neutral-v1`.
  - The web app exports FBX, GLB and BVH.
- **Terms.** Commercial rights go to "Paid Users who subscribe to the Commercial subscription". These terms predate the API.

**DeepMotion** (Animate 3D: video; SayMotion: text). Sources: [Animate 3D API](https://www.deepmotion.com/animate-3d-api), [SayMotion API](https://www.deepmotion.com/saymotion-api), [DeepMotion/Animate-3D-REST-API](https://github.com/DeepMotion/Animate-3D-REST-API), [DeepMotion/SayMotion-REST-API](https://github.com/DeepMotion/SayMotion-REST-API), [terms](https://www.deepmotion.com/terms-of-use) last updated 2025-03-30.
- **Access.**
  - Animate 3D API access requires a request form. "API access is currently limited to verified partners" for SayMotion.
  - Credentials and base URL are issued by DeepMotion.
- **Capabilities.** Both APIs accept custom characters (FBX, GLB, glTF or VRM for SayMotion). Output is BVH, FBX or MP4. Video jobs track up to 16 people.
- **Pricing.** On the web plans, "1 credit = 1 second of animation".
- **Terms.**
  - Paid plans get a "perpetual … royalty-free, worldwide Commercial license"; Freemium use is non-commercial.
  - "You cannot distribute the digital assets … as stand-alone".
  - "you will not access the Site through automated or non-human means".

**QuickMagic** (video). Sources: [pricing](https://www.quickmagic.ai/Pricing), [API docs](https://docs.quickmagic.ai/docs/video-upload.html).
- **Access.** Studio, the top self-serve plan, "does not include API access"; the API needs "an API plan or a custom enterprise solution".
- **API.** A `companyKey`. `bonetype` selects the output skeleton: Mixamo, Unreal 4, BVH, Roblox R15 and others. `frameRate` is 24, 30, 60 or 120. Cost is 1–4 coins per second depending on the frame rate.
- **Free tier.** Not licensed for commercial use.

**Anything World**, now "Everything Universe" (auto-rig plus a preset library chosen by category, for humanoids and animals). Sources: [quickstart](https://anything-world.gitbook.io/anything-world/quickstart/animate-anything-quickstart.md), PyPI `anything-world` 0.2.0 (2024-11-27), [pricing](https://everythinguniver.se/pricing).
- The quickstart calls the API "early access".
- **Limits.** Files up to 30 MB each and 100 MB in total. Meshes are decimated to 20k vertices. A job takes 8–30 minutes.
- **Output licence.** Not found.

### A5. Tools without a usable automation route

| Tool | Modes | Why it does not fit an agent pipeline | Source |
|---|---|---|---|
| Adobe Mixamo | auto-rig + preset library | No official API. The Additional Terms bar using output "to … create, train, test, or otherwise improve any machine learning algorithms" | [Mixamo Additional Terms](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf) (effective 2021-06-23) |
| Autodesk Flow Studio (formerly Wonder Studio; radicalmotion.com now redirects here) | video → mocap onto a validated character; FBX/USD export | Web app only, and no API is mentioned. The free tier is watermarked | [pricing guide](https://blogs.autodesk.com/media-and-entertainment/2026/09/28/autodesk-flow-studio-pricing-and-subscription-guide/), [AI mocap export](https://help.wonderdynamics.com/export-elements/ai-mocap/) (updated 2026-10-19) |
| Rokoko Vision | video → motion; Mixamo, HIK, UE5 export skeletons | Video upload inside the Rokoko Create app; no API | [product page](https://www.rokoko.com/products/vision) |
| Cascadeur | AutoPosing, AI inbetweening | Local desktop app with a Python API and, since 2026.2, "a simple MCP server" inside the app. No headless mode is documented. Free tier: non-commercial, `.casc` export only. Indie: revenue under $100k/year | [release notes](https://cascadeur.com/help/category/319), [Python API](https://cascadeur.com/python-api/), [plans](https://cascadeur.com/plans) |
| Maya MotionMaker | path/keyframe-driven locomotion on HumanIK rigs | Runs only inside Maya; no text prompts | [Autodesk FAQ post](https://blogs.autodesk.com/media-and-entertainment/2025/10/15/ai-powered-motionmaker-for-animation-your-top-questions-answered/) |
| Unity AI Animation Generator | text and video → `.anim` | Runs only inside the Unity Editor. Unity Muse is retired | [Unity AI Assistant 2.4 docs](https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.4/manual/Animation/animation-overview.html) |

### A6. Open models with released weights

**Licences that decide most rows.** Most academic motion models are trained on AMASS or its derivative HumanML3D, and/or emit SMPL-family bodies.
- **SMPL.** Licensed "for the sole purpose of performing non-commercial scientific research". It "prohibits the use of the Software to train methods/algorithms/neural networks/etc. for commercial use". Commercial licences go through Meshcapade ([SMPL licence](https://smpl.is.tue.mpg.de/modellicense.html)).
- **SMPL-X.** Same terms, plus a ban on making it available "to any third party" ([SMPL-X licence](https://smpl-x.is.tue.mpg.de/modellicense.html)).
- **AMASS.** Also prohibits training networks "for commercial use" ([AMASS licence](https://amass.is.tue.mpg.de/license.html)).
- **HumanML3D.** Built from AMASS: "Motions are downsampled into 20 fps, with each clip lasting from 2 to 10 seconds" ([HumanML3D @ 9176e8f](https://github.com/EricGuo5513/HumanML3D/tree/9176e8f)).
- **LaFAN1.** Ubisoft's in-betweening dataset is "Creative Commons Attribution-NonCommercial-NoDerivatives 4.0" ([ubisoft-laforge-animation-dataset @ 9408460](https://github.com/ubisoft/ubisoft-laforge-animation-dataset/tree/9408460)). No official Ubisoft in-betweening weights were found.
- **Inference.** A permissive code licence does not make such weights usable in a shipped game.

**NVIDIA Kimodo** (text, plus constraint-driven in-betweening). Sources: [nv-tlabs/kimodo @ e1c219c](https://github.com/nv-tlabs/kimodo/tree/e1c219c99b4b94ba48be1fb6a1cbc64ecee4c954) (2026-10-15); the [Kimodo-SOMA-RP-v1.2](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.2) card, rev `0e3c890`; the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/), last modified 2025-10-24.
- **Modes.** Text prompts plus "full-body pose keyframes, end-effector positions/rotations, 2D paths, and 2D waypoints". There is also multi-prompt sequencing and a timeline editor for keyframes.
- **Output.**
  - Model card: "Root Translation and Joint Rotations" on the 30-joint SOMA skeleton.
  - The CLI exports NPZ or BVH; BVH output is on the 77-joint SOMA export skeleton, with a standard T-pose option.
  - "Motions are at 30 frames per second". "Maximum duration is 10 sec (300 frames at 30 frames per second)".
- **Hardware.**
  - "~17GB of VRAM to generate locally entirely on GPU". With `TEXT_ENCODER_DEVICE=cpu`, usage drops "to <3 GB".
  - Tested mostly on RTX 3090, RTX 4090 and A100.
  - "developed on Linux, though Windows should work especially if using Docker". The card lists Linux and Windows.
- **Text encoder.** Built on a Llama-3-8B-Instruct derivative.
- **Licences.**
  - Code: Apache-2.0.
  - SOMA and G1 weights: NVIDIA Open Model License. The card says "ready for commercial use", gives the use case "Animations for game and media development", and was trained on the "Proprietary Bones Rigplay Dataset" (700 h of mocap).
  - The licence says "Models are commercially usable" and "NVIDIA does not claim ownership to any outputs". Redistribution needs the licence text and NVIDIA's notice.
  - Exception: **Kimodo-SMPLX-RP-v1** is under the NVIDIA R&D Model License (research, non-production, no distribution).
- **Related.** NVIDIA's real-time sibling **ARDY** ([nv-tlabs/ardy @ e706e27](https://github.com/nv-tlabs/ardy/tree/e706e27)) has the same licence pair. It outputs SOMA at 30 fps.

**NVIDIA GEM-X** (video). Sources: [NVlabs/GEM-X @ 4aef145](https://github.com/NVlabs/GEM-X/tree/4aef1452e5df171deff4f293c08e643eb450981e) (2026-11-02); the [nvidia/GEM-X](https://huggingface.co/nvidia/GEM-X) card, rev `b111f2d`.
- **What it does.** Monocular video → "world-space global motion trajectories in SOMA … format", "77-joint poses", body and hands.
- **Output.** A tensor file. **No BVH, FBX or glTF exporter is documented.**
- **Commercial status.** "All training data and the SOMA parametric body model are owned by NVIDIA or released under permissive licenses, making GEM ready for commercial use."
- **Licences.** Code Apache-2.0 with per-file exceptions (OpenMDW-1.1 for adapted hand code); weights NVIDIA Open Model License. The hand weights come separately from `nvidia/EgoHand-v1` and are not redistributed.
- **Hardware.** The card lists NVIDIA Ampere and Linux, Windows and macOS; the documented test hardware is an A100 80GB. The repo's install guide needs Python ≥ 3.10 and PyTorch ≥ 2.10.
- **Superseded.** The earlier GENMO/GEM-SMPL release is under the "NVIDIA OneWay Noncommercial License" ([NVlabs/GENMO @ 16bebf4](https://github.com/NVlabs/GENMO/tree/16bebf4)).

**Tencent HY-Motion 1.0** (text). Sources: [Tencent-Hunyuan/HY-Motion-1.0 @ c71ea6c](https://github.com/Tencent-Hunyuan/HY-Motion-1.0/tree/c71ea6c); [tencent/HY-Motion-1.0](https://huggingface.co/tencent/HY-Motion-1.0), rev `620dd55`; [arXiv:2512.23464v1](https://arxiv.org/abs/2512.23464v1).
- **Model.** A 1.0B DiT, with a 0.46B Lite variant.
- **Output.**
  - The SMPL-H skeleton definition, 22 body joints, at 30 fps. Training clips are capped at 360 frames (12 s).
  - With the Autodesk FBX SDK installed, it writes FBX retargeted onto a bundled template character. Otherwise it writes NPZ.
- **Not supported:** "Seamless loop or in-place animations", multi-person scenes and non-humanoids.
- **Hardware.** 24–26 GB of VRAM, not counting the optional prompt LLM. "Supports macOS, Windows, and Linux."
- **Licence.** The Tencent HY-Motion 1.0 Community License:
  - It "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA".
  - Users "must not use … Output … outside the Territory".
  - Above "1 million monthly active users" a separate licence from Tencent is required.
  - Outputs may not be used to improve other AI models.
  - Tencent "claims no rights in Outputs".

**Non-commercial models** (checked and excluded). Each pin and reason comes from its repository:

| Model | Modes | Output | Why it is excluded |
|---|---|---|---|
| MDM ([@ ef8edce](https://github.com/GuyTevet/motion-diffusion-model/tree/ef8edce)) | text, editing/in-betweening | HumanML3D 22 joints, 20 fps, ≤ 9.8 s | trained on HumanML3D; SMPL needed for meshes |
| MoMask ([@ 94a6636](https://github.com/EricGuo5513/momask-codes/tree/94a6636)) | text, temporal inpainting | BVH / joints, 20 fps, 196 frames | trained on HumanML3D |
| T2M-GPT ([@ b1446f1](https://github.com/Mael-zys/T2M-GPT/tree/b1446f1)) | text | HumanML3D | trained on HumanML3D |
| MotionGPT ([@ 001aaca](https://github.com/OpenMotionLab/MotionGPT/tree/001aaca)) | text, prediction, in-betweening | HumanML3D | HumanML3D/SMPL; card licence "cc" with no variant |
| MotionLCM ([@ 81c0636](https://github.com/Dai-Wenxun/MotionLCM/tree/81c0636)) | text + trajectory control | HumanML3D | code licence "prohibited for commercial … use" |
| MotionStreamer ([@ 8aace3f](https://github.com/zju3dv/MotionStreamer/tree/8aace3f)) | streaming text | 30 fps | data "solely for academic purposes" (AMASS) |
| CondMDI ([@ 0c58473](https://github.com/setarehc/diffusion-motion-inbetweening/tree/0c58473)) | keyframe in-betweening (+ text) | HumanML3D, SMPL via SMPLify | trained on HumanML3D |
| WHAM, TRAM, 4D-Humans | video | SMPL | AMASS-trained and/or need SMPL |
| GVHMR, PromptHMR, SMPLer-X | video | SMPL-X | code licences are non-commercial |
| FlowHMR | video | SMPL-H NPZ + FBX | weights "non-commercial … purposes only" |

---

## Part B — Open questions

1. **Meshy skeletons.** The joint names of the default 24-bone `meshyrig` and of raw Text to Motion FBX/BVH clips are unpublished. The native frame rate of library clips is unpublished too.
2. **Meshy rigging versions.** The 2026-11-10 changelog says "v2 Rigging defaults to `mixamo`", but no v2 rigging endpoint is documented.
3. **Meshy quadrupeds.** The API accepts quadruped clips, while the web guide says the library is humanoid-only. It is unknown whether Scenario's Meshy Animation accepts quadruped IDs.
4. **Meshy MCP.** The current MCP server (0.6.12) cannot set `skeleton_template`, `include_fingers` or `animation_type`. Whether a later version adds them is open.
5. **Tripo clips.** Frame rate and clip length are not stated. It is not documented whether a user's already-rigged FBX imported via `POST /v3/models/import` can take presets. Avian and `others` rigs have no presets.
6. **Scenario prices.** CU prices per motion model are unpublished; only dry runs reveal them. Whether OAuth MCP on the Free plan can run motion models is not stated.
7. **Uthana.** The retargeting and auto-rigging pages were seen only as search snippets. The GraphQL reference was reported as calling 3.0 "limited release", which conflicts with the capability pages.
8. **Cartwheel.** Output skeleton, duration limits, plan prices and output ownership are unstated. The API reference did not render.
9. **Move AI EULA.** Read literally, clause (iii) ("as an input for any AI System") could forbid passing Move output through AI-assisted cleanup or retargeting. Legal reading is needed before a descriptor relies on it. Whether API sign-up is self-serve is unstated.
10. **Plask.** The API's result format is undocumented, and the 2023 terms predate the API.
11. **Kimodo text encoder.** The encoder derives from Llama 3. The Llama 3 community licence's terms for this use (attribution, MAU thresholds) were not read.
12. **GEM-X.** The card lists macOS and Windows, but the repo's rendering extras target Linux x86-64. No exporter to BVH/FBX/glTF ships. Real VRAM needs beyond the A100 test setup are unstated.
13. **HY-Motion.** Its training pipeline used GVHMR (non-commercial) and the SMPL-H skeleton definition. Whether that affects downstream output rights is not addressed by the licence.
14. **Mixamo.** The royalty-free game use statement lives in an Adobe FAQ that could not be fetched (403). The Additional Terms PDF dated 2021-06-23 appears to be current but carries no "latest" marker.

---

## Comparison

| Provider | `motion` modes | Access (agent route) | Output formats | Output skeleton | Frame rate | Length | Price (list) | Commercial game use of output | Blocks automation? |
|---|---|---|---|---|---|---|---|---|---|
| Meshy | `library`, `text` (+ rigging) | REST, CLI `meshy`, MCP `@meshy-ai/meshy-mcp-server` | FBX, GLB, BVH (text swift), USDZ | Meshy builds the rig: 24-bone `meshyrig` or one of 8 standard templates (biped); quadruped rig; text clips standalone | 24/25/30/60 via post-process | text 2–10 s | rig 5, clip 3, text 3/10 credits | paid: owned; free: CC BY 4.0 | API needs paid plan; MCP lacks templates; 3-day retention |
| Tripo | `library` (+ rigging) | REST v3, CLI `tripo`, MCP via `tripo-cli mcp`, Python SDK | GLB, FBX | Tripo builds the rig: `tripo`, `mixamo`, `actorcore`, `unity`, `unreal`, `vrm` (biped, v3.0); 7 creature types | not stated | not stated | rig $0.25, clip $0.10 | paid: owned; free: Tripo retains rights | 7-day retention; no clip input |
| Scenario | `library`, `text`, `video` (resold Meshy, Tripo, Uthana, Cartwheel, Viggle, Rodin) | MCP `mcp.scenario.com`, REST, SDKs | GLB, FBX, OBJ (+ vendor formats) | the vendor's | the vendor's | the vendor's | CU per job, via dry run | paid: assigned to user; free: personal/eval only | API needs paid plan; vendor options are a subset |
| Uthana | `text`, `video` (+ stitch, locomotion, rigging) | GraphQL, Python/npm clients | FBX, GLB | **the user's uploaded character** (auto-rigged if bare), or the default | 24/30/60 | text 4–10 s; video 2–60 s | text $0.10/s, video $0.06/s | paid: owned, games named; unpaid: attribution | none stated; agents explicitly permitted |
| Viggle | `text`, `video` | REST | GLB, FBX | 50-joint Mixamo-style generic rig, 441- and 86-joint MetaHuman-style rigs | 30 (text); `target_fps` (video) | text 3–60 s | text $0.10/request; video $0.05/s | owned; commercial allowed | 1-hour links |
| Cartwheel | `text`, `video` (+ rigging, retarget) | REST (paid plans), MCP `cartwheel-mcp` | BVH, FBX (GLB, MA/MB via Scenario) | user character via MCP; native skeleton unstated | 24 in example; 2–240 via Scenario | unstated | credits/s; plan prices unstated | "lawful commercial use"; ownership unstated | API reference unreadable |
| Move AI | `video` | GraphQL, Python SDK | FBX, BVH, USD, GLB, … | Mixamo, UE5 Manny/Quinn, Move rigs | input 24–120 | 2–60 s | $0.012–0.043/s | licence, not ownership; AI-input clause | EULA clause (B9); quote-based limits |
| Plask | `video` | REST + SSE | undocumented (web: FBX, GLB, BVH) | SMPL-24 (realtime) | – | ≤ 18,000 frames | 1 credit/pose | Commercial subscription | terms predate API |
| DeepMotion | `video`, `text` | REST by approval / partners only | FBX, BVH, GLB, MP4 | own or uploaded custom character | – | unclear | 1 credit/s | paid: commercial licence | approval gate; site bans automation |
| QuickMagic | `video` | REST, API/enterprise plan only | per `bonetype` | Mixamo, UE4, R15, … | 24/30/60/120 | – | 1–4 coins/s | free tier non-commercial | enterprise gate |
| Kimodo (NVIDIA) | `text`, `inbetween` | local weights (Python CLI) | NPZ, BVH | SOMA (30 → 77-joint export) | 30 | ≤ 10 s | free | yes (NVIDIA Open Model License) | NVIDIA GPU (~17 GB, or < 3 GB with CPU text encoder); Linux, Windows |
| GEM-X (NVIDIA) | `video` | local weights | tensors only | SOMA 77-joint, world space | per video | – | free | yes (card) | NVIDIA GPU; no file exporter |
| HY-Motion 1.0 | `text` | local weights, HF Space | FBX (needs FBX SDK), NPZ | SMPL-H 22 joints / template character | 30 | ≤ 12 s | free | not in EU/UK/KR; > 1M MAU needs licence | 24–26 GB VRAM |
| HumanML3D/SMPL models | `text`, `inbetween`, `video` | local weights | joints, BVH, SMPL | HumanML3D / SMPL(-X) | 20 (HumanML3D) | ≤ 9.8 s | free | **no** | licence |
| Mixamo, Flow Studio, Rokoko Vision, Cascadeur, MotionMaker, Unity AI | various | app / web only | – | – | – | – | – | varies | no API or no headless mode |

---

## Candidates for jam provider descriptors

Each candidate below is reachable without a human in the loop, once credentials exist. Each one's terms allow the output in a commercial game, at least on a paid plan.

**Fit by mode.**
- **`library`.**
  - **Meshy.** `meshy` CLI or MCP; the existing descriptor gains `motion`.
    - It rigs the user's mesh and applies up to 10 clips per request, from a library of about 650 biped and about 130 quadruped clips.
    - Output skeleton: Meshy's own rig. For bipeds, the CLI or REST can instead build it as `mixamo`, `ue5_mannequin`, `unity_humanoid` or another standard template, which removes a retarget step when the project uses that skeleton. The MCP route cannot.
    - Clips go only onto Meshy-built rigs.
  - **Tripo.** `tripo` CLI or its MCP; the existing descriptor gains `motion`.
    - It rigs the user's mesh and applies up to 5 presets: 11 on v3.0 rigs, 90+ on v1.0 rigs, and one per creature type.
    - Output skeleton: Tripo's own rig, or Mixamo-style naming; on v3.0 also `actorcore`, `unity`, `unreal` and `vrm`.
    - Clips go only onto Tripo-built rigs.
  - **Scenario.** MCP. A `library` mode through `model_meshy-animation` or Tripo/Rodin rigging, with fewer options than the vendors' own APIs.
- **`text`.**
  - **Meshy.** Standalone FBX or BVH clip, 2–10 s; it can be applied to a Meshy rig.
  - **Uthana.** API; a new descriptor; 4–10 s.
    - It is the only service found that generates directly on **the user's uploaded character**, auto-rigging it if needed.
    - Its terms explicitly permit agent workflows and game use.
  - **Viggle.** API; a new descriptor; 3–60 s at 30 fps, flat $0.10 per request. The output is a generic 50-joint rig that needs retargeting.
  - **Scenario.** MCP. Hosted Meshy, Uthana, Cartwheel and Viggle text-to-motion models.
  - **Kimodo.** Local; a new descriptor. A setup-dependent route: it needs an NVIDIA GPU. SOMA BVH output, 30 fps, ≤ 10 s.
- **`video`.**
  - **Uthana.** 2–60 s clips onto the user's character.
  - **Viggle.** Per-second pricing; generic or MetaHuman-style rigs.
  - **Scenario.** Uthana, Cartwheel and Viggle video models.
  - **GEM-X.** Only if a SOMA tensor-to-BVH or tensor-to-FBX export step is written. It is commercially licensed but ships no file exporter.
- **`inbetween`.**
  - **Kimodo** (full-body keyframe constraints, text optional) and **MotionBricks** (its own note). These are the only commercially licensed in-betweening models found.
  - No hosted API offers in-betweening between user key poses. Uthana's stitch joins clips; it does not fill gaps between poses.

**The retarget skill is required for nearly every route.** Only two routes deliver motion straight onto the project rig without it:
- Uthana with an uploaded character;
- Meshy or Tripo when one of their standard templates matches the project skeleton exactly.

Everything else needs retargeting: Kimodo/GEM-X/MotionBricks on SOMA, Viggle's 50-joint rig, Meshy text clips, Move AI rigs, and Meshy or Tripo clips on their native rigs.

**Possible later, after checks.**
- **Cartwheel.** API and MCP exist, but its skeleton, limits and output ownership are unstated (B8).
- **Plask.** Its API output format is undocumented and its terms predate the API (B10).
- **Move AI.** Technically strong video capture onto Mixamo/UE5 rigs, but EULA clause (iii) needs legal reading first (B9).

**Unsuitable as descriptors.**
- **DeepMotion and QuickMagic.** API access needs partner approval or an enterprise plan, and DeepMotion's site terms ban automated access.
- **Anything World.** The API is "early access", the output licence was not found, and jobs take 8–30 minutes.
- **Mixamo.** No official API, and its terms bar using output to improve ML algorithms.
- **Flow Studio, Rokoko Vision, Unity AI Animation Generator, Maya MotionMaker.** Web, app or editor only.
- **Cascadeur.** A human-run desktop app with no headless mode. The in-app MCP is a possible future route, not a provider.
- **HY-Motion 1.0.** Its licence excludes the EU, UK and South Korea and caps MAU. A setup-agnostic descriptor cannot know where a game ships, so it is not offered by default.
- **Kimodo-SMPLX-RP-v1, GENMO/GEM-SMPL** and every HumanML3D-, AMASS- or SMPL-dependent model in A6. Their licences are non-commercial.
- **Free plans in general.** Meshy Free output is CC BY 4.0, Tripo Free leaves rights with Tripo, and Scenario Free is personal/evaluation only. Meshy and Scenario API access already requires a paid plan.
