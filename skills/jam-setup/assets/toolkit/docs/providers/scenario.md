# Scenario

Serves the image and mesh routes, including third-party 3D models it hosts. Unit: Compute Units (CU), Scenario's own credits ([explained](https://learn.scenario.com/account/compute-units-explained)). A model hosted here is billed by Scenario, whoever made the model. The neutral procedure is [providers.md](../providers.md).

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

## Jobs and pacing

- Wait with `jobs_wait`; after a timeout continue with its `pending_job_ids`. Never submit a second `model_run` to poll.
- After a lost create response, look in `jobs_list` in the same scope before anything else.
- `job_cancel` rejects most generation jobs. Failed jobs are reimbursed, with a moderation exception.
- After each 3D job the model has a cooldown. A second job on it answers HTTP 429 with the wait in the body (one read "wait 2298 seconds"). Cooldowns are per model: run the next job on another suitable 3D model and say which. `consumption_limit_get` reads the real limits.
- Concurrency, quota and plan refusals are different 429s with different remedies; report which one it was.
- Download with `asset_download`. Keep the asset id; its link is for the download only.

Researched 2026-11-10 from the guide and skills above; the pacing facts were observed during a game jam in November 2026.
