# Asset tooling setup

The `jam-setup` skill installs and upgrades this toolkit (`tools/jam/`) with one command and walks the decisions below; install the jam skills with `npx skills add rafaelvidaurre/furanku-skills --skill <name>`. `node <jam-setup skill dir>/scripts/install.mjs --check` reports whether the installed toolkit matches the skill's bundled copy.

## Guided project decisions

`setup` is a portable Node terminal wizard. It previews the exact config before writing it, preserves existing config, and never authenticates or spends. For an agent-led setup, walk through these decisions in order, reusing known answers:

1. Style guide/reference ownership: use existing direction, including any approved hero-shot gallery already saved by `jam-style`, and register its durable paths in `style.document`/`style.references`. Preserve its partial/complete [coverage status](style-coverage.md); a single registered shot does not establish style completion. Otherwise leave it unresolved and use `jam-style` for [visual exploration](style-exploration.md). Setup does not require a camera/style/setting/palette questionnaire.
2. Review preference: human at every stage, human concept/turnaround/delivery checkpoints, or agent review. A human can request more involvement per run.
3. Mesh route and spending: paid generation starts disabled. When a paid job is first needed, ask the mesh route (direct Meshy or Scenario-hosted models; both remain available per operation) and each billing provider's limit independently, using the labels and three choices in [project settings](settings.md#spending). Explain Scenario's Compute Units before using “CU.”
4. Asset profiles are optional setup work: resolve them when selecting mesh generation after the turnaround, or when the user requests profile setup. Reuse known platform/camera facts; defer triangle/texture decisions that do not affect the current image stage. Profiles cover platform/renderer, camera distance/screen coverage/instance estimate, static/deforming, triangles/materials/texture size and memory, units/axes/pivot. Deforming profiles need skeleton, influences and pose evidence.

Leave profiles for later rather than inventing values. When answers were collected in conversation, write only those decisions to a temporary choices JSON and use `setup --from <relative-path>`. Delete that temporary input afterward; `jam.config.json` is canonical. For an existing config, use [project settings](settings.md) for spending/checkpoints; edit only decided creative fields and run doctor. [Contracts](contracts.md) defines fields; [research](asset-workflows.md) supplies budget proposals, not approved settings.

## Local dependencies

The installer handles Node packages, Pillow and Blender discovery. When it reports a gap, fix that one: cropping needs Python 3.10+ with Pillow (`<python> -m pip install -r tools/jam/requirements.txt` into a private environment), and `jam.local.json` may set `python`, `blender` or `meshy` when they are not on PATH. Use actual discovered paths; do not copy another machine's home directory. Doctor reports executable and Pillow availability without printing environment values. A missing dependency reports its error; no substitute image tool is generated.

Blender is optional until a local DCC operation is selected. Install an official build suitable for the chosen DCC skill and record its actual version. Use the installed executable (on macOS this may be inside the application bundle). Standard headless invocation is `"<blender-executable>" --background --factory-startup --python-exit-code 1 --python <supported-script> -- <arguments>`; PowerShell uses `&` before a quoted executable. MCP setup follows the installed Blender connector's own instructions. No universal host/port is assumed.

## Direct Meshy: official CLI

Before sign-in, explain [Meshy billing](meshy-billing.md): CLI calls use API credit rates, require Pro or above, and should not be assumed to receive web-only free retries. Installation and free access checks do not generate an asset.

Read the current [official installation guide](https://raw.githubusercontent.com/meshy-dev/meshy-3d-agent/main/INSTALL.md), then use its supported CLI version and `meshy-3d-generation` skill. The [official provider skills](https://github.com/meshy-dev/meshy-3d-agent) are external dependencies, not renamed `jam-` skills. Install at user scope for the active harness, for example `npx skills add meshy-dev/meshy-3d-agent --skill meshy-3d-generation -g -a codex` (use `-a claude-code` for Claude Code). Use the supported skills installer for the active harness; install only the generation skill needed here.

Run the documented CLI version/help and `meshy auth status --format json --no-update-check`. Reuse access only when authenticated and verified; a verification/network failure is a diagnosis, not an automatic new login. If sign-in is missing, follow the [sign-in handoff](sign-in.md) and the official skill's login procedure. Meshy CLI 0.8.5 supports `auth login --device --no-wait --format json --no-update-check`, then `auth login --device-flow <flow_id> --format json --no-update-check` for hosts that must end a turn to deliver instructions. For visible progress, `auth login --device --format json --no-update-check` can stay in one managed tool session. Read its user-facing stderr instruction before waiting; reuse the same flow/process, and replace it only on confirmed expiry/failure. Verify `auth status` and `meshy balance --format json --no-update-check`. Balance is not a quote or proof of plan eligibility; login is not generation evidence.

Optional direct Meshy MCP: use only the [official server](https://github.com/meshy-dev/meshy-mcp-server). The human provides `MESHY_API_KEY` through secure environment/secret injection. Never put a value in an MCP command, JSON file or chat, even if an upstream example does. Check the active client's environment inheritance/expansion support first; if it cannot provide the secret safely, use the explicitly chosen OAuth CLI route instead. No secret-entry wrapper is included here.

## Scenario: user-scope HTTP OAuth

Use the [official connection guide](https://mcp.scenario.com/docs), then install the required official skills (`scenario`, plus `scenario-image`, `scenario-meshy`, `scenario-3d` as used) at user scope with an explicit harness: `npx skills add scenario-labs/skills --skill scenario scenario-image scenario-meshy scenario-3d -g -a codex` (or `-a claude-code`). Do not use the installer's default project scope. Before modifying a connection, inspect the current client's MCP listing; keep a matching server and do not overwrite a conflicting one without a deliberate decision.

Claude Code:

```sh
claude mcp add --transport http --scope user scenario https://mcp.scenario.com/mcp
```

For Claude Code, give the human the concrete `/mcp` → `scenario` → authentication → browser approval steps in [sign-in handoff](sign-in.md), after registration succeeds. Use the current client labels. Codex:

```sh
codex mcp add scenario --url https://mcp.scenario.com/mcp
codex mcp login scenario
```

Run the Codex login command yourself and deliver its browser instructions before asking about completion. Installing Scenario skills alone does not create or authenticate the connection. Verify each registration command's result; an existing matching server needs reuse, while another failure needs diagnosis before asking the human to authenticate it.

Keep provider connections at user scope; leave project MCP files (`.mcp.json`, `.codex/config.toml`) to whatever owns them. Other clients use their documented native HTTP/OAuth configuration at user scope. Headless API-key setup is a human operator step using the provider's official guide, not a reason for an agent to collect secrets. OAuth may require a fresh interactive client session.

After reconnect/restart, discover Scenario tools, call free `teams_list`, resolve and confirm the intended team/project, and read a relevant model schema. Do not assume a sole team/project is the requested destination if the user has not established scope. Keep confirmed scope in each intent's `scope` and the run authorization; no personal scope is shipped as a project default.

## Browser route and readiness

If browser use is the chosen route, use the active environment's supported browser skill/tool. The human signs in. Verify visible account/project, needed controls and download support. Do not assume browser credits share the API balance. A failure on another route does not silently authorize switching to browser use.

Setup is complete for a selected route when the tool is discoverable in the active session, the human completed sign-in/trust, and a free authenticated capability/scope check succeeded. Paid generation, visual quality and native engine import remain separate evidence. Run the original asset task after readiness; do not end at a question whose answer was supplied.
