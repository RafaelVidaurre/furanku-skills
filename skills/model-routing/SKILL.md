---
name: model-routing
description: Choose an agent, model, and effort using capability evidence, routing preferences, and live quota, then gate-check the launch decision. Use before delegating work; to list accounts and usage quotas, configure account priorities, list models, or set a model and effort enabled, disabled, or explicit; when reviewing or editing routing setup; when diagnosing a routing brief or launch gate; when setting up routing preferences; or when an assignment fails to start or stops because of a usage limit.
---

# Model routing

`<skill-dir>` is the directory containing this file. The spawning agent judges task fit; local code enforces launch gates. Shipped policy has no preferred model or role tuple.

## Accounts and usage

For `$model-routing accounts` or `$model-routing list`, run `python3 <skill-dir>/scripts/router.py accounts --repo <root>` and return its compact table unchanged. It reads configured profiles and reports every catalog billing provider with a reading or explicit gap. Account reporting needs no selector setup. For account discovery, priorities, reserves, or account-bound launch/recovery, read [Accounts](references/accounts.md).

**Complete when:** the requested report is shown with account identities, quota windows, reset times, and freshness, or the tool failure is reported.

## Set up or change preferences

For initial setup or a request to review or edit existing routing preferences, read [Setup](references/setup.md). Show the human-readable current setup first, offer to keep or change it, then preview scoped edits and apply the approved result idempotently. Incomplete setup does not block routing; continuing after an unanswered question requires a configured preference. Jev selection is retired; existing private routes and preferences remain authoritative.

**Complete when:** the user keeps the displayed setup, approved changes are saved and summarized, or a specific setup question is pending. Ordinary launches continue through the brief below without opening a setup review.

## Generate the brief

For Cursor candidates or a request to use Cursor as the harness, read [Cursor routing](references/cursor.md) before selection or launch.

Generate the brief before choosing; its Exact routes section is the normative source for when a configured route applies. An instruction naming only a mechanism or orchestration surface is a consumer launch constraint, not an exact-route request or routing override. For example, “use Orca” does not bind any `agent` or exclude catalog agents that surface can launch. A model-serving harness carries its own catalog `agent` token, including when it serves several vendors: naming `cursor` or `claudex` binds routing to that capability identity. Its candidates are unreachable to a consumer whose launchable-agent set omits it. A combined instruction that also names an agent, model, or effort binds launch and routing independently. Generate the brief with live quota and, when known, limit it to what the consumer can launch:

```sh
python3 <skill-dir>/scripts/router.py brief --repo <root> --codexbar \
  [--launchable-via <agent,...>] [--defaults <consumer-routes-file>]
```

Reuse the brief while its configuration and quota observations remain current. Accounts defines the configurable freshness and caching behavior; a confirmed usage-limit event invalidates the affected reading immediately. If CodexBar fails, the brief says so in its notes and quota stays unknown; the acceptance gate in `check` handles that—never estimate quota yourself.

The tested CodexBar CLI version is pinned in [runtime-dependencies.json](references/runtime-dependencies.json). Follow the [CodexBar skill](../codexbar/SKILL.md) for setup. The adapter checks the installed version; upgrades require contract verification before changing the pin.

**Complete when:** the current session holds a fresh brief and has read its exact-route activation rule.

## Judge the pick

Judge each delegated outcome against the brief's enabled candidates and applicable preferences. Use the task's reasoning, implementation, agentic, visual, and context requirements, together with the consequences of an incorrect result and how acceptance will catch it. Split broad work into independently verifiable outcomes without assuming each needs a separate agent. A role label or the importance of the surrounding project does not establish the capability needed for every subtask.

Cost means subscription-quota burden for subscription routes and cash for metered routes. Prefer less quota burden when supported by evidence and there is no material task disadvantage. A shared account's remaining balance is headroom, not a measurement of relative per-model consumption; missing consumption evidence remains unknown. Subscription and pooled routes still spend quota. Within one agent and model, lower effort is presumptively cheaper when exact effort-matched cost is unknown. Use the brief's task and effort preferences for cross-model choices; broad scope, many findings, or a prior failed attempt alone does not justify increasing effort.

Give one concise task-specific reason for the pick, Preferences bind in the brief's precedence order; preserve explicit and disabled states. When a persisted preference conflicts with the principal's current routing instruction, apply the current instruction to this task and identify the stale preference for a scoped configuration repair. Ask only when applicability remains genuinely ambiguous. Carry material evidence uncertainty and quota warnings in the rationale.

Identify the outcome's hard requirements—vision, long context, a minimum context size—and the catalog agent tokens the spawning mechanism can actually launch. Give these to the check directly, or use a consumer adapter that derives them from its structured manifest. Keep the rationale concise: record the task-specific judgment, not a retelling of the routing policy.

**Complete when:** the pick has a written rationale naming the task judgment, every hard requirement is listed for the check, and launchable-agent constraints are either listed or injected by the consumer adapter.

## Gate-check the decision

Run one check per decision—each delegated outcome carries its own judgment and rationale or its own principal route basis; one decision never determines another:

```sh
python3 <skill-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  [--explicit-basis "<verbatim principal request for this model and effort>"] \
  [--max-effort-basis "<why xhigh or the strongest lower effort is insufficient>"] \
  [--launchable-via <agent,...>] \
  [--require-feature <feature>] [--minimum-context <tokens>] \
  [--role worker|captain|commander] [--require-original] --codexbar
```

When the brief's activation rule applies, use `check --exact-route <route-id> --route-basis "<verbatim principal request>"` instead of `--candidate`/`--reason`. Preserve that basis on every quota-acceptance or fallback re-check. `--launchable-via` names the catalog `agent` tokens the consumer's spawning mechanism can launch (for example `claude` alone for harness-native subagents); a candidate outside that set is refused, never silently substituted. A consumer that already owns this list should inject it rather than asking the spawning agent to transcribe it. `--compact` changes JSON whitespace only and is never part of the routing proof.

`check` enforces hard gates—disabled candidates, explicit candidates without a principal request for their model and effort, missing required features or context, unlaunchable agents, authentication, exhausted quota—and maximum-effort proportionality. A malformed compiled candidate is excluded and named in the brief; other checks continue. [Configuration](references/configuration.md) states the isolation rule. A judged `max` candidate is refused when the same agent and model have an enabled lower-effort candidate unless `--max-effort-basis` explicitly names the strongest lower effort and records why it is materially insufficient. A principal-requested explicit `max` candidate uses its verbatim request as the basis instead. Principal-requested exact routes remain governed by their verbatim route basis. The check emits one JSON decision:

- `selected` (exit 0): the agent’s pick passed; carries `selected` launch tuple, `reason`, `warnings`, `quota`.
- `exact` (exit 0): principal-requested route passed; carries the task's `route_basis`, `exact_route`, and configuration-layer `provenance` instead of a candidate judgment.
- `refused` (exit 1): a hard gate or maximum-effort proportionality check failed; `reasons` names each gate. Rejudge the selection after resolving the refusal, within unchanged principal constraints. Preserve a refused exact route until the principal authorizes a routing change; satisfy it through a permitted launch surface or surface the conflict. Never launch a refused decision directly.
- `needs-acceptance` (exit 2): every gate passed but quota is unknown or stale. `pending` names the cheapest recovery first — when a remedy command is present, run that command with no prompt, wait until the session has loaded, exit it, then re-check the same candidate or exact route with `--codexbar`; otherwise accept unknown quota. An exact route that returns `needs-acceptance` stays the route: perform that remedy refresh when present; otherwise surface `pending` (and any `quota_fallback`) to the principal; do not substitute another candidate or harness. If they accept, rerun with `--accept-quota-unknown "<who accepted and why>"`. If `quota_fallback` is present, one ask covers every same-blocker exact-route check in the session; when the principal does not answer within `ask_seconds`, re-check that same exact route with `--use-quota-fallback "<who waited and how long>"` — that re-check tries the primary first and uses the fallback only while quota is still unknown or stale.

For a confirmed usage-limit interruption or failed start, read [Recovery](references/recovery.md). It uses the existing orchestrator's evidence and ownership; it adds no watcher or lifecycle state. A timeout, quiet terminal, rate limit, or sign-in error alone is not quota exhaustion. Keep an exact model requirement with `--require-original`; ordinary preferences permit only policy-authorized, task-equivalent substitutions. For a below-reserve launch, supply a judged `--alternative` and `--equivalence-reason` when available: `alternative-available` (exit 2) contains the checked replacement. Without a ready equivalent, positive allowance remains usable.

Every quota verdict names the measured account. When a decision carries `account_binding`, apply it at launch through the consumer; read [Accounts](references/accounts.md) for the binding and recovery contract. Report a quota refusal with that account: "exhausted for `<account>`" is answerable, while a bare "exhausted" strands the principal when they meant a different one. If a verdict reads `account unattributed`, quota could not be tied to an identity — say so rather than presenting it as settled. Account changes require a measurement and launch binding for the same account. When a decision involves multiple accounts or an account mismatch, read and apply [Configuration](references/configuration.md#schema) before treating it as a blocker.

A candidate whose launch tuple pins one account is not the same offer as the same model reached through a rotating proxy, which selects a credential per request and moves on when one is exhausted. When a route pinned to a single account is refused for quota, that refusal binds only that route: say which account is out and whether the same model is configured through a pooled surface, rather than reporting the model itself as unavailable. A `pooled` quota reading passes and carries a warning naming the pool — it is a settled state, not a reading to accept or recover.

**Complete when:** the consumer holds a `selected` decision with its task judgment or an `exact` decision with its principal route basis, and the gates match the outcome's stated requirements; a candidate refusal has been re-judged within unchanged constraints; an exact-route refusal has been satisfied through a permitted launch surface or surfaced to the principal; a `needs-acceptance` whose pending names a remedy has been re-checked after that session-refresh; or an exact-route `needs-acceptance` without a runnable remedy has been accepted, surfaced with no fallback configured, or re-checked with the same basis and `--use-quota-fallback` after the configured wait.

## View or modify configuration

For benchmark provenance, score interpretation, refresh limits, or the evidence behind new model support, read [Benchmark evidence](references/benchmark-evidence.md). Catalog additions expand the available candidates; replace a principal's defaults only in the configuration layer that owns them.

For requests to inspect, explain, add, change, or remove routing configuration—exact routes, preferences, candidate overrides—or supply consumer defaults, read [Configuration](references/configuration.md) before acting. `config.py` owns layer resolution and exact-route provenance; `router.py brief` shows what a spawning agent actually sees.

For `$model-routing models`, run `python3 <skill-dir>/scripts/config.py models --repo <root>`. For `/model-routing set <enabled|disabled|explicit> <model> <effort>`, use `config.py set` as documented in Configuration. An explicit candidate is available only when the principal requested that model and effort for the task; pass the verbatim request to `check --explicit-basis`. An exact route name alone does not supply this basis. Ordinary selection excludes explicit candidates.

**Complete when:** a view shows effective routes and the brief with provenance, or a change is validated in its intended scope and visible in the regenerated brief.
