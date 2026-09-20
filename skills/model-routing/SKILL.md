---
name: model-routing
description: Choose an agent, model, and effort using capability evidence, routing preferences, and live quota, then gate-check the launch decision. Use before delegating work; when inspecting or changing routing configuration; when diagnosing a routing brief or launch gate; or when setting up or toggling Jev selection through Vercel AI Gateway.
---

# Model routing

`<skill-dir>` is the directory containing this file. The machine-wide selector chooses who judges ordinary launches; local code enforces launch gates in either mode.

## Set up once

Run `python3 <skill-dir>/scripts/router.py status` on first use in a session. If it returns `setup-required`, ask once: **Use Jev through Vercel AI Gateway to choose models, or have the spawning agent choose?** Explain that Jev receives task facts, routing preferences and candidate evidence and requires the user's Gateway key. Record their choice with `router.py setup --selector jev` or `router.py setup --selector agent`. An explicit choice already given in the conversation satisfies this question; never default silently.

For Jev setup, `key-required`, toggling, or provider errors, read [Jev setup and routing](references/jev.md) and guide the user through the key prompt and verification. Agent mode requires no key or Gateway call. The setting applies across repositories and worktrees for this OS user. Re-run setup only to change it or repair readiness.

**Complete when:** status reports `ready` for the user's chosen selector. Missing or invalid setup blocks ordinary selection; exact launch gates remain independent tools.

## Generate the brief

Generate the brief before choosing; its Exact routes section is the normative source for when a configured route applies. An instruction naming only a mechanism or orchestration surface is a consumer launch constraint, not an exact-route request or routing override. For example, “use Orca” does not bind any `agent` or exclude catalog agents that surface can launch. A launcher that serves models no other launcher can reach is a distinct capability identity and carries its own catalog `agent` token, so naming it does bind routing: `claudex` is such a token, and its candidates are unreachable to a consumer whose launchable-agent set omits it. A combined instruction that also names an agent, model, or effort binds launch and routing independently. Generate the brief with live quota and, when known, limit it to what the consumer can launch:

```sh
python3 <skill-dir>/scripts/router.py brief --repo <root> --quota-axi \
  [--launchable-via <agent,...>]
```

One brief serves the whole spawning session—reuse it across decisions and regenerate only after a configuration change or when the brief's printed quota capture time is more than 30 minutes old. If quota-axi fails, the brief says so in its notes and quota stays unknown; the acceptance gate in `check` handles that—never estimate quota yourself.

The quota-axi package version and normalized schema contract are pinned together in [runtime-dependencies.json](references/runtime-dependencies.json). When upgrading quota-axi, update that declaration after verifying the adapter against the new schema; the router invokes the declared package version exactly.

**Complete when:** the current session holds a fresh brief and has read its exact-route activation rule.

## Select with Jev when enabled

Read [Jev setup and routing](references/jev.md), prepare task facts, and call `router.py route --task-file <file> --launchable-via <agents> --quota-axi` with the outcome's hard requirements. This returns a gate-checked decision; consume it directly. The agent supplies facts and principal constraints, while Jev chooses the model and effort. Do not replace its choice merely because it differs from an agent's prediction. If the brief's exact-route activation rule applies, use the principal-requested exact-route check below instead.

**Complete when:** Jev's decision passes the gates below, or its abstention/provider failure is surfaced. There is no implicit fallback to agent selection. Skip the agent judgment step while Jev is enabled.

## Judge the pick when Jev is off

The brief carries what the session does not otherwise know: the user's routing preferences by scope, configured exact routes, and every launchable candidate with research evidence, task cost, speed, features, context capacity, and current quota. Judge each outcome on the dimensions the evidence covers—reasoning depth, implementation demands, agentic repository work, UI or spatial character—plus risk: how expensive a wrong result is, and whether the owner holds write authority. Cost means subscription-quota burden for subscription routes and cash only for metered routes: choose the candidate that spends less of its own provider's subscription quota—as the brief defines quota-lighter—whenever it has no material task-relevant disadvantage, and never argue a subscription route is free because the subscription is already paid or its quota is pooled. For candidates sharing an agent and model, lower effort is presumptively cheaper when exact effort-matched benchmark cost is unknown. Broad scope, many findings, a prior failed run, and generic cost-of-error arguments do not alone establish that max is necessary; split broad implementation or remediation into independently verifiable outcomes. Spend premium capability only when the capability difference matters to the cost of being wrong, and let the rationale for an expensive pick name why cheaper candidates were insufficient. Preferences bind: resolve conflicts by the precedence order the brief states, and when applicability stays genuinely ambiguous, ask the principal instead of inventing precedence. Low-confidence or dated evidence and quota warnings belong in the rationale, not silently absorbed.

Identify the outcome's hard requirements—vision, long context, a minimum context size—and the catalog agent tokens the spawning mechanism can actually launch. Give these to the check directly, or use a consumer adapter that derives them from its structured manifest. Keep the rationale concise: record the task-specific judgment, not a retelling of the routing policy.

**Complete when:** the pick has a written rationale naming the task judgment, every hard requirement is listed for the check, and launchable-agent constraints are either listed or injected by the consumer adapter.

## Gate-check the decision

Run one check per decision—each delegated outcome carries its own judgment and rationale or its own principal route basis; one decision never determines another:

```sh
python3 <skill-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  [--max-effort-basis "<why xhigh or the strongest lower effort is insufficient>"] \
  [--launchable-via <agent,...>] \
  [--require-feature <feature>] [--minimum-context <tokens>] \
  --quota-axi
```

When the brief's activation rule applies, use `check --exact-route <route-id> --route-basis "<verbatim principal request>"` instead of `--candidate`/`--reason`. Preserve that basis on every quota-acceptance or fallback re-check. `--launchable-via` names the catalog `agent` tokens the consumer's spawning mechanism can launch (for example `claude` alone for harness-native subagents); a candidate outside that set is refused, never silently substituted. A consumer that already owns this list should inject it rather than asking the spawning agent to transcribe it. `--compact` changes JSON whitespace only and is never part of the routing proof.

`check` enforces hard gates—disabled candidates, missing required features or context, unlaunchable agents, authentication, exhausted quota—and maximum-effort proportionality. A malformed compiled candidate is excluded and named in the brief; other checks continue. [Configuration](references/configuration.md) states the isolation rule. A judged `max` candidate is refused when the same agent and model have an enabled lower-effort candidate unless `--max-effort-basis` explicitly names the strongest lower effort and records why it is materially insufficient. Principal-requested exact routes remain governed by their verbatim route basis. The check emits one JSON decision:

- `selected` (exit 0): the configured selector’s pick passed; carries `selected` launch tuple, `reason`, `warnings`, `quota`.
- `exact` (exit 0): principal-requested route passed; carries the task's `route_basis`, `exact_route`, and configuration-layer `provenance` instead of a candidate judgment.
- `refused` (exit 1): a hard gate or maximum-effort proportionality check failed; `reasons` names each gate. Repeat selection with the configured selector after resolving the refusal, within unchanged principal constraints. Preserve a refused exact route until the principal authorizes a routing change; satisfy it through a permitted launch surface or surface the conflict. Never launch a refused decision directly.
- `needs-acceptance` (exit 2): every gate passed but quota is unknown or stale. `pending` names the cheapest recovery first — when a remedy command is present, run that command with no prompt, wait until the session has loaded, exit it, then re-check the same candidate or exact route with `--quota-axi`; otherwise accept unknown quota. An exact route that returns `needs-acceptance` stays the route: perform that remedy refresh when present; otherwise surface `pending` (and any `quota_fallback`) to the principal; do not substitute another candidate or harness. If they accept, rerun with `--accept-quota-unknown "<who accepted and why>"`. If `quota_fallback` is present, one ask covers every same-blocker exact-route check in the session; when the principal does not answer within `ask_seconds`, re-check that same exact route with `--use-quota-fallback "<who waited and how long>"` — that re-check tries the primary first and uses the fallback only while quota is still unknown or stale.

When the decision's warnings or quota materially contradict the judgment—quota far below what the brief showed, an unexplained warning—repeat selection with the configured selector before launching.

Every quota verdict names the account it measured, because one machine may hold several accounts per provider and quota tools read whichever account-scoped environment is active. Report a quota refusal with that account: "exhausted for `<account>`" is answerable, while a bare "exhausted" strands the principal when they meant a different one. If a verdict reads `account unattributed`, quota could not be tied to an identity — say so rather than presenting it as settled. Never switch accounts only to obtain a more favorable reading: that proves nothing about the account the launch will bill. When a decision involves multiple accounts or an account mismatch, read and apply [Configuration](references/configuration.md#schema) before treating it as a blocker.

A candidate whose launch tuple pins one account is not the same offer as the same model reached through a rotating proxy, which selects a credential per request and moves on when one is exhausted. When a route pinned to a single account is refused for quota, that refusal binds only that route: say which account is out and whether the same model is configured through a pooled surface, rather than reporting the model itself as unavailable. A `pooled` quota reading passes and carries a warning naming the pool — it is a settled state, not a reading to accept or recover.

**Complete when:** the consumer holds a `selected` decision with its task judgment or an `exact` decision with its principal route basis, and the gates match the outcome's stated requirements; a candidate refusal has been re-judged within unchanged constraints; an exact-route refusal has been satisfied through a permitted launch surface or surfaced to the principal; a `needs-acceptance` whose pending names a remedy has been re-checked after that session-refresh; or an exact-route `needs-acceptance` without a runnable remedy has been accepted, surfaced with no fallback configured, or re-checked with the same basis and `--use-quota-fallback` after the configured wait.

## View or modify configuration

For requests to inspect, explain, add, change, or remove routing configuration—exact routes, preferences, candidate overrides—read [Configuration](references/configuration.md) before acting. `config.py` owns persisted layers and exact-route provenance; `router.py brief` shows what a spawning agent actually sees.

**Complete when:** a view shows effective routes and the brief with provenance, or a change is validated in its intended scope and visible in the regenerated brief.
