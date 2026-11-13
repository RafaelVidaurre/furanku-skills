# Asset workflow research: providers, budgets, topology, setup

Researched 2026-11-10 from first-party sources (links at the end of each section). Provider APIs changed four times between 2026-11-02 and 2026-11-06, so treat every model ID, limit and price here as a dated observation. Re-read the live source before building on one. Nothing here was verified by an authenticated call, a paid generation or a native run on Windows or Linux.

## 1. Meshy, direct

**Routes Meshy supports.** Meshy documents three agent routes, and all three call the same REST API and spend the same credits:

| Route | Auth and storage | Notes |
| --- | --- | --- |
| `meshy-cli` 0.8.x (npm `meshy-cli`, 0.8.5 published 2026-11-09), driven by the `meshy-3d-agent` skills (`npx skills add meshy-dev/meshy-3d-agent`) | `meshy auth login --device`: the human approves in a browser. Credentials are stored in `~/.config/meshy/credentials.v2.json`, encrypted with a key held by the OS keychain (Keychain, DPAPI or Secret Service). Precedence: `--api-key` > `MESHY_API_KEY` > `--api-key-file` > stored profile. | Needs Node 22.12+. Every command takes `--format json`. Submissions use `create --async`, then `wait`. Local inputs up to 50 MiB. `meshy make … --dry-run` returns `estimated_credits` for a composed plan. The skill tells agents never to read the credential store and never to probe with `curl`. |
| `@meshy-ai/meshy-mcp-server` (stdio, MIT, active) | `MESHY_API_KEY` env var only. The official install commands put the key in the command line (`claude mcp add -s user meshy --env MESHY_API_KEY=msy_… -- npx -y @meshy-ai/meshy-mcp-server`), which stores it in plaintext in user-level client config. On Windows, wrap the command in `cmd /c`. | The tools wrap REST: generation, remesh, retexture, uv_unwrap, rig, animate, convert, resize, get/list tasks, download, check_balance. There is no dry-run tool. Downloads go to `meshy_output/` in the server's working directory unless `save_to` is given. |
| REST `https://api.meshy.ai/openapi/` with a Bearer key | Key created in the Developer Platform | An OpenAPI spec and `llms.txt`/`llms-full.txt` are published, and they are regenerated on every docs build. The project should not hand-roll a client when the CLI or MCP covers the operation. |

**Async custody** (task-lifecycle and llms.txt):
- Credits are charged when the task is created. Only a `FAILED` task is refunded.
- A client timeout, a dropped stream or a 5xx does not cancel a task. Meshy has no idempotency key. After an ambiguous create, wait about a minute, list the newest tasks (`sort_by=-created_at`), and create again only if the task is missing. A 4xx means no task was created.
- A task can move from `IN_PROGRESS` back to `PENDING` under the same ID. Wait at least 60 minutes from `created_at` before giving up.
- `DELETE` cancels and refunds only a `PENDING` task. On an `IN_PROGRESS` task it returns 409.
- Non-Enterprise outputs are kept for **3 days**. Download URLs are signed and expire.
- Concurrency is per team: Pro allows 10 concurrent tasks, Studio 60.

**Models as of 2026-11-10** (deprecations page):
- Active: `meshy-7.1` (`latest`), `meshy-6`, `meshy-6-lite`, `meshy-n1` (texture), `meshy-t2.5`, `meshy-t2`.
- Deprecated, no retirement date yet: `meshy-7`.
- Retired: `meshy-5` (2026-10-10), `meshy-4`, `meshy-3`.
- **`model_type: "lowpoly"` and `meshy-t1` are deprecated.** Meshy's own pages disagree on the retirement date. The deprecations table (Markdown and HTML) says 2026-11-30; the site-wide HTML banner said "lowpoly retires Oct 30, 2026" (both read 2026-11-10). Treat the date as unresolved and never pin it. The replacement is `model_type: "smart-topology"` with `meshy-t2.5`.
- Meshy announces a retirement at least one month ahead. It recommends pinning `ai_model` because `latest` moves.

**Generation and topology:**
- **Multi-Image to 3D** takes 1–4 images (`image_urls` as public URLs or data URIs; JPG/PNG/WebP, ≤20 MB, ≥32 px per side). With `meshy-7.1`/`latest`, *the first image is the front view and the order of the others does not matter*. Geometry models: `meshy-7.1`, `meshy-6`, `meshy-6-lite`; texture: `meshy-7` or `meshy-n1`. `geometry_resolution: 4k` is unsupported here. Remeshing is optional: `topology` is `triangle` (default) or `quad` ("quad-dominant"), `target_polycount` 100–300,000. **Smart Topology is not offered on this endpoint.**
- **Smart Topology** (`model_type: smart-topology`) exists on Image to 3D (one image) and the Text to 3D preview. `meshy-t2.5` covers 100–30,000 faces (default 15,000) and `meshy-t2` covers 100–15,000. Output is **triangles only**, and `quad` returns 400.
- For game characters, low-poly assets or "any model with a face-count budget", Meshy says to use Smart Topology and *not* to remesh a `meshy-7.1` mesh down with `should_remesh`/`target_polycount`.
- **Remesh** takes GLB/glTF/OBJ/FBX/STL input, triangle or quad topology, 100–300,000 faces, and costs 5 credits. Remesh's convert and resize parameters are deprecated in favor of the Convert and Resize endpoints.
- **UV Unwrap** takes GLB input of at most **40,000 faces** and costs 5 credits. It *triangulates quad and n-gon meshes*. The output is an untextured "UV white model" with fresh, non-overlapping UVs.
- **Retexture** takes one style input. `enable_original_uv: true` keeps an existing UV layout, and the default `false` generates new UVs. `meshy-n1` gives a 2K base color only, with no PBR. Texture maps come back as `base_color` plus, optionally, `metallic`, `roughness`, `normal` and `emission`.
- **Rigging** is for humanoids only.
- **Multi-view images:** Text to Image accepts `generate_multi_view: true`, and the result can feed Multi-Image to 3D through `input_task_id`. That output is fixed at 3:4 on some models. It is not a substitute for a reviewed turnaround.

Sources: [llms.txt](https://docs.meshy.ai/llms.txt), [Multi-Image to 3D](https://docs.meshy.ai/api/multi-image-to-3d.md), [Image to 3D](https://docs.meshy.ai/api/image-to-3d.md), [Remesh](https://docs.meshy.ai/api/remesh.md), [UV Unwrap](https://docs.meshy.ai/api/uv-unwrap.md), [Retexture](https://docs.meshy.ai/api/retexture.md), [Deprecations](https://docs.meshy.ai/api/deprecations.md), [Changelog](https://docs.meshy.ai/api/changelog.md), [Pricing](https://docs.meshy.ai/api/pricing.md), [AI integration/MCP](https://docs.meshy.ai/api/ai.md), [OpenAPI](https://docs.meshy.ai/openapi.yaml), [meshy-mcp-server](https://github.com/meshy-dev/meshy-mcp-server), [meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent) (`skills/meshy-3d-generation/`, `references/setup.md`, `references/pipelines.md`, `references/delivery.md`).

## 2. Scenario, including Meshy hosted by Scenario

**Connection** (Scenario's skill `references/setup.md` and the public connection guide; the guide wins where they disagree):
- Endpoint: `https://mcp.scenario.com/mcp` (Streamable HTTP). OAuth is preferred, and no credential passes through the conversation.
- Claude Code: `claude mcp add --transport http --scope user scenario https://mcp.scenario.com/mcp`, then OAuth on first use or through `/mcp`.
- Codex: `codex mcp add scenario --url …`, then `codex mcp login scenario`.
- The `mcp-remote` stdio bridge is only for clients without native HTTP, and it is the usual cause of repeated sign-in prompts.
- **API keys** are for headless use only. They are sent as HTTP Basic (`KEY:SECRET`, base64). Wiring a key into a client is "an operator task done by hand": an agent points to the guide and stops. It never asks for, places or echoes a key.
- Verify the connection with a free `teams_list` call. `diagnostics_run` reports which layer fails: `auth`, `tenant-scope`, `api-unreachable` or `healthy`.

**Scope:**
- The server "won't assume a default context". Resolve `team_id` and `project_id` (`teams_list`, then `projects_list`), confirm the pair with the user, and pass both on every call.
- Write-class tools never fill in scope. Unattended runs take the pair from the task, or stop and list the choices.

**Discovery:**
- `recommend` searches by capability and `search` by name. Both are free, and IDs must be re-discovered per team.
- `model_schema_get` is the contract: exact field names, caps, and `cost_impact` flags. If the schema has `runs_as` (LoRA or composition), call `run_with.required_arguments` instead of the model ID.
- File fields take asset IDs, never URLs.
- `?toolsets=full` exposes every tool. Otherwise `scenario_tools_search` plus `scenario_tool_execute_read/write/delete` reach the catalog tools.

**Uploads:** call `upload_asset` with `file_size`, PUT each presigned part with no extra headers, then call `upload_asset_complete`. Inline base64 is accepted only under 100 KB. Re-upload rather than re-complete the same `upload_id`.

**Cost:**
- `model_run` with `dry_run: true` at the **top level** prices that exact payload without creating a job.
- Through the catalog executor, a misplaced top-level `dry_run` *runs the job and bills it*, and the executor drops misplaced keys silently.
- A dry run cannot price a later step whose input asset does not exist yet. Quote that step from `recommend`, then dry-run it once the real input exists.

**Jobs:**
- `jobs_wait` takes up to 32 IDs. On timeout, call it again with `pending_job_ids` and never re-run.
- A transport error on `model_run` may still have created a job, so check `jobs_list` before any re-run.
- `job_cancel` rejects most generation jobs. Failed jobs are reimbursed, with a moderation exception for xAI.
- 429 classes (concurrency, quota, Relax mode) each need a different response, and resending the same payload never helps.
- Download with `asset_download` (it can convert to `glb`/`fbx`/`obj`). Its signed URL is "never the deliverable".

**Meshy hosted by Scenario** (`scenario-meshy` skill, figures "at authoring time"):
- Scenario wraps Meshy 7 Image to 3D, Meshy 7 Multi Image to 3D (1–4 images, first = front), **T2 Smart Topology with `image` 1–4** (`targetPolycount` ≤15,000), Retexture (exactly one of prompt, style image or multiview), Remesh (100–300,000), UV Unwrap (rejects meshes above **44,000** faces), Rigging and Animation.
- Parameters are camelCase (`targetPolycount`, `enableOriginalUv`), unlike the direct API's snake_case. Defaults differ from the direct API (for example `enablePbr`).
- The direct and hosted limits disagree (40,000 vs 44,000 UV faces; Smart Topology from one image vs 1–4 images). Read the live schema for whichever route runs, and never transfer facts between routes.
- Plan gating: some members (Rigging, Animation) needed a higher plan. A 403 naming a plan cannot be cleared by retrying.

**Side convention:** on the Tripo multi-view members hosted by Scenario, `leftImage` was the *subject's* own left. A sheet labeled from the viewer's side swaps the pair, and a swapped pair can fuse front and back into one shell.

**Scenario's own 3D chain:**
- Geometry, then UV unwrap, then retexture with keep-existing-UVs, then rig last on the shipping topology.
- `hasUVs` proves UVs exist, not that the layout is clean.
- glTF stores triangles only, so quad output must stay in FBX.
- Fixing normals, origin or naming is DCC work.

**Scenario's published skills:** `scenario-labs/skills` (MIT, active) publishes provider skills and local DCC expert skills, including `scenario-blender-retopology`, `scenario-blender-uv-baking` and `scenario-blender-texturing-shading`. Install is `npx skills add scenario-labs/skills --skill …`, by role. The 3D Artist role set is 15 skills.

Sources: [Scenario MCP connection guide](https://mcp.scenario.com/docs), [scenario-labs/skills](https://github.com/scenario-labs/skills) (`skills/scenario/SKILL.md`, `skills/scenario/references/setup.md`, `skills/scenario-meshy/SKILL.md`, `skills/scenario-3d/SKILL.md`, `skills/scenario-orbit-views/SKILL.md`, `INSTALL.md`).

## 3. Triangle and texture budgets

No first-party source gives a universal per-asset triangle count for "mobile", "stylized" or "AAA". Every number a first party does publish is a whole-view figure, a whole-application figure or a tool limit:

| Source | Figure | What it bounds |
| --- | --- | --- |
| Epic, *Performance Guidelines for Mobile Devices* (UE 5.9 docs) | ≤500k triangles and ≤700 draw calls for the **whole scene per view**; square power-of-two textures; five texture samplers available, all of them expensive | A legacy figure measured for 30 fps on iPad 4/iPad Air. It is a scene ceiling, not a per-asset budget. |
| Epic, *Nanite* (UE 5.9 docs) | Enable Nanite "wherever possible on platforms that support it"; "practical limits still remain" | Console/desktop, DX12 SM6. It lists Forward Rendering as unsupported and does not mention mobile. Nanite skeletal meshes use animation LODs and do not support morph-target deformation. Nanite favors high-poly detail over baked normals. |
| Khronos 3D Commerce guidelines 1.0 | 150k tris / ≤2K textures (mobile AR, web), 250k (desktop web), 30k / 512 (banner), 40k / 1K (planner) | **Per published single-item commerce view.** Not game budgets. The 2.0 publishing-targets section is still a work-in-progress stub. |
| Unity 6.6 manual | No counts. "Depends on the visual quality you require and the platform you are targeting"; engine vertex counts exceed DCC counts; one skinned mesh and as few materials as possible per character; ≤4 skin influences for performance | Characters |
| Meshy limits | Smart Topology caps (15k/30k), UV Unwrap ≤40k faces, Remesh 100–300k | Provider limits. They constrain routes, not art budgets. |

A Web or mobile target budgets texture memory as well as triangles; record it in that profile.

**Proposed starting heuristics.** These are *not sourced limits*. They are a reviewer's proposals for a human to accept, change or reject per profile. Each assumes one material, one UV set, and an asset that is not the only thing on screen.

| Profile (camera, platform) | Small prop | Hero prop or character | Texture set per asset |
| --- | --- | --- | --- |
| Faceted low-poly, any platform | 50–800 tris | 300–3k tris | Palette/gradient 64–256 px, or vertex color |
| Web/mobile renderer, third-person | 200–3k | 3k–15k (≤1 skinned mesh) | 512–1K; 2K hero only |
| Stylized desktop, non-Nanite, third-person | 1k–10k | 10k–40k | 1K–2K |
| Desktop Nanite static mesh | Bounded by disk/memory and authoring time, not per-asset tris | Skeletal: as above, plus morph-target limits | 2K–4K, constrained by streaming pool |
| "AAA" hero character | No universal number; set it from frame budgets measured on target hardware | | |

Derive a budget from: the view or scene ceiling for the platform; expected simultaneous instances; screen coverage at the gameplay camera distance; and whether the asset deforms. Measure four numbers: triangles after export and modifiers, engine vertex count after import (UV seams and hard edges split vertices), material/draw count, and texture memory. Editable quad or polygon counts are recorded separately.

Sources: [Epic mobile performance guidelines](https://dev.epicgames.com/documentation/en-us/unreal-engine/performance-guidelines-for-mobile-devices-in-unreal-engine), [Epic Nanite](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine), [Khronos 3DC guidelines 1.0 Publishing Targets](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec99_PublishingTargets/PublishingTargets.md), [Khronos 2.0 announcement](https://www.khronos.org/blog/introducing-asset-creation-guidelines-2.0-siggraph-2025), [Unity: Creating models for optimal performance](https://docs.unity.com/en-us/engine/current/manual/assets-and-media/asset-types/models/creating-dccassets/modeling-optimized-characters).

## 4. Topology, UVs and baking

**Topology:**
- GPUs render triangles, and a quad counts as two (Khronos Geometry 1.0; Meshy counts faces as triangles).
- glTF primitives are `TRIANGLES`, `TRIANGLE_STRIP` or `TRIANGLE_FAN`. **glTF cannot store quads**, so editable quad topology must live in `.blend`/FBX beside any GLB.
- Meshy UV Unwrap and GLB-only steps triangulate their input.
- Khronos recommends an editable, quad-based "base asset". Derived real-time variants may be "highly adaptive, irregular triangle meshes".
- For deforming assets, none of the sources consulted guarantees edge loops from an automated route. Meshy and Scenario call Smart Topology "animation-ready", but the output is triangles only. Deformation evidence therefore has to be posed renders or engine playback, not a provider label.

**UVs:**
- Hide seams at natural breaks.
- Keep texel density consistent; pack tools help, but orientation is the artist's responsibility.
- Avoid overlaps except intentional mirrors or stacks. Before baking, move duplicates exactly one UV unit outside 0–1, because bakers sample only 0–1.
- For tiled materials, 1 UV unit = 1 m (glTF/USDZ).
- Blender bakes need a UV map. Margin pixels around islands prevent seam bleeding under filtering and mipmapping (*Extend* or *Adjacent Faces*).

**Baking:**
- Use Blender's *Selected to Active* with a cage, or extrusion/max ray distance. A cage must share the low-poly topology and face order.
- Avoid hard splits on the cage.
- Bake tangent-space normals (Blender's default, right for animated meshes).

**Channel and color-space conventions:**
- glTF: base color and emissive are sRGB. Normal, occlusion and metallic-roughness are linear. Metallic-roughness packs roughness in **G** and metallic in **B**. Normals are +X right, +Y up. Clients compute MikkTSpace tangents when none are provided.
- Unreal Interchange offers *Flip Normal Map Green Channel* and *Use MikkTSpace*. Record the green-channel convention per normal map rather than assuming it.

**Coordinates:** glTF is right-handed, +Y up, front faces +Z, in meters. Unreal uses different axes and units, so record axis conversion, scale and pivot explicitly at delivery.

Sources: [glTF 2.0 spec](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), [Khronos 3DC Geometry 1.0](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec03_Geometry/Geometry.md), [Khronos 3DC UV Coordinates 1.0](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec04_UVCoordinates/UVCoordinates.md), [Khronos 3DC Materials 1.0](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec05_MaterialsAndTextures/MaterialsAndTextures.md), [Blender 5.2 manual: Render Baking](https://docs.blender.org/manual/en/latest/render/cycles/baking.html), [Epic Interchange import reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/interchange-import-reference-in-unreal-engine).

## 5. Agent skill and MCP discovery

**Claude Code skills:**
- Loaded from `.claude/skills/` from the start directory up to the repository root.
- A skill entry may be a **symlink to a directory**, and the target is loaded once.
- Edits to `SKILL.md` are picked up live. A top-level skills directory created mid-session needs `/reload-skills`.
- The combined `description` + `when_to_use` is truncated at 1,536 characters. Keep `SKILL.md` under 500 lines.
- Claude Code does not document reading the `skills` folder under `.agents/`.

**Codex skills:**
- Scans the `skills` folder under `.agents/` from the working directory up to the repo root, plus the one under `$HOME/.agents/`.
- Follows symlinked skill folders and detects changes automatically ("if one doesn't appear, restart Codex").
- The initial skill list gets at most 2% of the context window, or 8,000 characters. Codex shortens descriptions, then omits skills, when there are many.

**Claude Code MCP:**
- Scopes: local and user are stored in `~/.claude.json`; project in the committed `.mcp.json`.
- `.mcp.json` expands `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url` and `headers`, so a key can stay in the user's environment.
- OAuth tokens are "stored securely". Project-scoped servers need interactive approval, but `claude -p` and SDK sessions load them without asking.
- No documentation says a server added mid-session connects without `/mcp` reconnect or a new session.
- A non-interactive session cannot complete OAuth.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Codex skills](https://learn.chatgpt.com/docs/build-skills).
