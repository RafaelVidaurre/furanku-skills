# Provider execution

Read this for paid work or selecting a generation/DCC route. [Research](asset-workflows.md) supplies dated evidence, not permanent IDs, price tables or limits. [Setup](setup.md) names supported integrations. Use their current skills and schemas; if a chosen skill/tool fails or is unavailable, report the failure and stop that route. Never implement a substitute client. A human may deliberately choose another supported route, with new scope/cost/input evidence.

## Shared operation boundary

1. Read the style and accepted inputs; geometry/surface operations also require the asset profile. Concept/turnaround work can use a style-bound run without a profile; exploratory style images use the [guided brief](style-exploration.md#establish-the-brief) without settled style/profile. Select capability, provider and transport from the request and available evidence. Record why the route fits; check account balances and route-specific benefits. For direct Meshy, consult [CLI billing](meshy-billing.md), including the web-only retry distinction.
2. Load the official provider skill and discover the live operation schema/help, including plan access, inputs, limits, ignored fields, topology and texture behavior. Recheck before submission if a model/schema changes or a retirement is announced. Never pass direct Meshy parameters to Scenario by renaming guesses.
3. Resolve scope/account and apply [task intent](task-intent.md). An active generation request plus approval of its required quote/budget can authorize submission; do not ask again merely because the answer used a budget option rather than “generate.” Clarify remaining ambiguity or spending outside the authorization before uploading or submitting.
4. Obtain a quote or dated estimate with source in native units. Reserve intent using `job-intent` before submitting. Store only credential-free settings, selected view names/hash mapping and durable asset IDs; omit signed URLs and image data URIs from committed request files.
5. Submit once. Save the provider ID immediately with `job-update`. Resume known jobs with the provider's wait tool. A transport error is not proof no task was created.
6. Download every needed output to an immutable candidate directory promptly. Keep originals, model/version, task/job ID, actual charge, settings, license/rights evidence and file hashes. Open and inspect the files before review.

Intent accounting is a local audit/control, not a network gateway. It cannot prevent unrecorded calls; every skill owns following this boundary. Estimate overruns are recorded honestly and stop further spending; never reduce recorded charges to fit the limit.

## Choose the mesh input mode

**Multiview is the default when a turnaround exists.** The turnaround's different sides should inform mesh generation, subject to the selected operation's supported input count. Discover current supported modes, plan access, price and topology controls before presenting the choice. `providers.mesh` selects a provider, not its single-view/multiview mode.

Reuse an established mode choice within its stated asset/project scope. If mode is unspecified, ask one concise choice through the harness question tool: recommend **Multiview**, explain that it uses several approved sides, and offer **Single-view** only when supported, explaining its real tradeoff. Explain meaningful differences in topology controls, later retopology and cost without implying that a budget target guarantees a usable mesh. Do not infer single-view from a low triangle target, a cheaper quote, provider selection or a tool's default. An explicit delegation such as “choose the mode for me” permits using the multiview default within the approved constraints; routine answers to unrelated questions do not delegate this choice.

If multiview is unavailable on the selected route, disclose that before submission and ask whether to use a supported single-view mode or investigate a supported multiview route. Do not label single-view as multiview, silently fall back, switch providers or upgrade a plan. With only multiview available, ask whether to use it or revisit the route rather than inventing a single-view option. A known incompatible budget/capability calls for a real tradeoff decision, not a hidden mode change.

Record the mode, its user decision or explicit delegation, selected view names and actual input mapping in the asset brief/request evidence. In multiview mode, send multiple individual views within the discovered limits; keep all five canonical views for review. A single-view selection submits its chosen image and records why; the archive remains available for qualification. Verify the outgoing payload matches the decision.

Selecting this missing mode completes a prerequisite of an already requested generation. Apply [task intent](task-intent.md) and proceed when the other prerequisites are ready, without a separate “generate now?” question. Surface similarly consequential, unresolved generation choices when they change the intended result or cost; reuse settled decisions and keep routine implementation details out of the conversation.

## Direct Meshy

Use the official `meshy-3d-generation` skill from [meshy-dev/meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent). Prefer the official CLI with device/browser login. Read its setup and pipeline references, then current CLI help; do not hard-code its changing flags here. The CLI covers API operations without a custom client. Its `make --dry-run` is an estimate; actual charge comes from the task. The optional official MCP has no dry-run equivalent: use a dated published price estimate and supported balance check, not a fabricated quote.

An accepted five-view turnaround is always the prerequisite for new 3D generation. Apply the input-mode choice above to these branches:

- **Multiview (default):** a current multiview geometry model, followed by explicitly qualified `jam-retopo` as needed. This can preserve hidden-side information but does not guarantee a good budget mesh. Direct multiview does not currently expose Smart Topology. First input is front where documented; the remaining ordering is not fixed.
- **Single-view alternative:** single-image Smart Topology at the chosen target. It generates triangles. Meshy's published advice favors this route for face budgets; explain that tradeoff and obtain the mode choice rather than silently preferring it. Keep all five approved views, record which one was submitted and why.

Discover the exact model/limits for the chosen route. Hosted Scenario's input count/UV caps may differ. A quad setting does not prove exported quads or edge flow; preserve native editable source separately. Provider-created UVs and textures can be retained only after their independent checks.

After an ambiguous create, preserve `unknown`; follow the official lifecycle procedure (currently wait about a minute, then list newest tasks by creation time and correlate exact operation/input/time). Absence from one partial page is not enough. If correlation remains ambiguous, stop for reconciliation rather than resubmit. A recovered task resumes under its ID. Read the actual HTTP/status semantics before treating a refusal as not submitted. In-progress jobs generally cannot be cancelled; pending cancellation/refund requires confirmed provider evidence. The official [task lifecycle](https://docs.meshy.ai/en/api/task-lifecycle) and [retention](https://docs.meshy.ai/en/api/asset-retention) govern current behavior.

## Scenario (including hosted Meshy)

Load official `scenario`, the selected image-model skill, and `scenario-meshy`/`scenario-3d` as relevant from [scenario-labs/skills](https://github.com/scenario-labs/skills). Use the native HTTP MCP endpoint with OAuth. Follow its tools, not a reimplemented client.

Resolve `team_id`/`project_id` with free discovery, retaining already confirmed scope. `recommend` discovers a capability; `search` finds named models. Read `model_schema_get` before running, including `runs_as`/`run_with` for LoRAs/compositions and plan restrictions. Upload local inputs with the documented upload/complete flow; file fields use asset IDs. Do not paste large base64 blobs into tool arguments.

For mesh work, apply the same [input-mode selection](#choose-the-mesh-input-mode) to the hosted model's actual schema. A provider/model recommendation is not the user's mode decision; direct Meshy capability descriptions do not establish hosted support.

**Cost nesting is critical:** direct `model_run` takes `dry_run: true` at the top level alongside `model_id` and `parameters`. Catalog-executor arguments go inside the executor's `parameters` object, including a tool's own dry-run field. Discover the invoked schema; misplaced keys can be ignored and a job billed. Quote the actual payload with real inputs. A quote for a placeholder missing asset proves nothing. Later stages may use a stated estimate until real inputs allow an exact quote.

Record the returned ID and use `jobs_wait`; after a timed-out wait, continue with `pending_job_ids`. Never submit a second `model_run` to poll. If the create response was lost, inspect `jobs_list` in the same scope and reconcile before any retry. Quota, concurrency, plan and moderation failures have different recovery; follow the provider skill and report the actual class. Do not switch scope, upgrade billing or silently choose a cheaper model.

Download using the supported asset download tool; use the live URL only for the download and retain its durable asset ID instead. Actual map sizes and defaults may differ across model members, so inspect downloaded geometry/maps.

## Browser and local Blender routes

A browser route is supported when intentionally selected before work, using the available browser skill/tool and current visible controls. Verify signed-in account/project, model/options, cost display and exact inputs before submission. Save the visible job/asset ID and result evidence, then download to the same artifact contract. If the UI exposes no reliable price or job identity, state that limitation and stop dependent spending until resolved. No DOM guesses, invented controls or silent API-to-browser fallback. Human sign-in/CAPTCHA stays human. The toolkit does not implement browser automation or a second provider API.

Blender is an independent, deliberately chosen local DCC route for cleanup, reduction, UVs, baking and inspection. Use its available MCP plus API discovery, or documented headless scripts supplied by an installed DCC skill. Scenario publishes `scenario-blender-retopology`, `scenario-blender-uv-baking` and `scenario-blender-texturing-shading`; install only the needed skill. Record the actual Blender version and transport. A failed remote remesh does not authorize switching to Blender; surface the failure and get the route decision if not already authorized. Local edits preserve originals and use the same review/measurement contracts.
