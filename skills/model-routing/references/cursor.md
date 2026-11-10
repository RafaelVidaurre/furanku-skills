# Cursor routing

`cursor` is a harness identity serving several vendors. Keep its candidates and
usage separate from `codex`, `claude`, `grok`, and rotating credential proxies.
The catalog adds availability; it does not change user routes or preferences.

## Launch contract

The local Cursor CLI help and account model inventory were checked on
2026-10-21; the Fable 5.2 aliases were checked on 2026-11-10. The [official CLI parameters](https://cursor.com/docs/cli/reference/parameters)
document `--model`, `--list-models`, and workspace selection. The installed CLI
also documents quoted parameter overrides such as
`--model 'claude-opus-5-5[effort=high]'`; effort is part of the model selection,
not a separate CLI flag. Use `cursor-agent` explicitly: the bare executable
name `agent` may belong to another harness.

| Catalog model | Catalog efforts | Inventory evidence |
| --- | --- | --- |
| `gpt-6.1-sol` | high | User-requested route; absent from the checked Cursor inventory |
| `claude-opus-5-5` | low, medium, high, xhigh, max | Effort-suffixed aliases listed |
| `claude-fable-5-2` | medium, high, xhigh, max | Effort-suffixed aliases listed |
| `grok-4.7` | low, medium, high, xhigh | Effort-suffixed aliases listed |

Catalog models use the base ID; the launch template adds `[effort=<effort>]`.
The checked inventory listed aliases such as `claude-opus-5-5-high`,
`claude-fable-5-2-high`, and `grok-4.7-high`. Fast and Thinking variants are
separate selections and are outside these additions.

Before launch, run `cursor-agent models` and inspect `cursor-agent --help`.
Verify the requested model and effort are available to the selected account,
then retain evidence that the CLI accepted the exact tuple. A missing model
is a launcher gap: report it and preserve the requested route. In particular,
GPT-6.1 Sol catalog support does not establish current Cursor availability;
GPT-5.6 Sol is a different model and cannot satisfy that request.

Use the selected orchestration surface's delivery protocol. Crew's
[Cursor profile](../../crew/references/seams.md#cursor) maps this tuple to
Orca's terminal attachment path and explains native subagent admission.

**Complete when:** the account inventory and live selection establish the exact
model and effort, or the availability gap is reported without substitution.

## Capability and usage evidence

These are launch-support additions. Exact Cursor-tuple benchmarks, vision,
context limits, output speed, and task cost have not been assessed here.
Unsupported dimensions remain unknown; vendor-harness scores and advertised
model context do not establish the Cursor route's behavior.

All these routes bill Cursor. Account reports read
`codexbar usage --provider cursor --source auto --format json --no-credits`
and show the returned web account identity, plan, Total, Cursor, and Third Party
windows. The window mapping follows the pinned
[CodexBar Cursor contract](https://github.com/steipete/CodexBar/blob/v0.77.0/docs/cursor.md).
The three pools remain distinct.

Web usage is marked **Unverified**: a web account ID and plan do not establish
the launch CLI's billing identity or model entitlement. Zero usage does not
establish permission to use paid models. Routing retains `unknown` quota and
the existing acceptance flow until launch-bound evidence is supplied through
`--runtime-file`. Harness authentication, health, and candidate availability
still gate launches. Claude or OpenAI account headroom cannot supply Cursor
headroom. This is not a rotating credential pool.

Cursor [documents account-dependent model access](https://prod.cursor.com/help/models-and-usage/available-models).
Successful inventory discovery establishes availability, not remaining usage,
runtime completion, or acceptance of an assignment.

**Complete when:** routing reports Cursor's own quota evidence or its unknown
state, and the launch decision satisfies the existing gates.
