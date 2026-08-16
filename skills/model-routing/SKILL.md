---
name: model-routing
description: Choose which agent, model, and effort should own a delegated task—backed by research evidence, user routing preferences, and live quota—and emit a gate-checked launch decision any spawning mechanism can consume. Use when an agent is about to spawn or delegate work and must pick the agent, model, or effort for it; when the user asks to view, explain, or modify routing configuration, routing preferences, or launchable candidates; or when the user asks to generate or diagnose the routing brief or a launch gate-check.
---

# Model routing

The agent about to spawn work—not a script—decides which agent, model, and effort the spawned owner gets. This skill supplies what that judgment needs (the brief) and enforces what must never be judgment (the gates). `<skill-dir>` below is the directory containing this file.

## Generate the brief

Generate the brief before choosing; its Exact routes section is the normative source for when a configured route applies. An instruction naming only a mechanism, harness, or executable is a consumer launch constraint, not an exact-route request or routing override. For example, “use claudex” does not imply `agent: claude` or exclude other catalog agents its selected surface can launch. A combined instruction that also names an agent, model, or effort binds launch and routing independently. Generate the brief with live quota and read it:

```sh
python3 <skill-dir>/scripts/router.py brief --repo <root> --quota-axi
```

One brief serves the whole spawning session—reuse it across decisions and regenerate only after a configuration change or when the brief's printed quota capture time is more than 30 minutes old. If quota-axi fails, the brief says so in its notes and quota stays unknown; the acceptance gate in `check` handles that—never estimate quota yourself.

**Complete when:** the current session holds a fresh brief and has read its exact-route activation rule.

## Judge the pick

The brief carries what the session does not otherwise know: the user's routing preferences by scope, configured exact routes, and every launchable candidate with research evidence, task cost, speed, features, context capacity, and current quota. Judge each outcome on the dimensions the evidence covers—reasoning depth, implementation demands, agentic repository work, UI or spatial character—plus risk: how expensive a wrong result is, and whether the owner holds write authority. Choose the cheaper, quota-lighter candidate—as the brief defines quota-lighter—whenever it has no material task-relevant disadvantage. Spend premium capability only when the capability difference matters to the cost of being wrong, and let the rationale for an expensive pick name why cheaper candidates were insufficient. Preferences bind: resolve conflicts by the precedence order the brief states, and when applicability stays genuinely ambiguous, ask the principal instead of inventing precedence. Low-confidence or dated evidence and quota warnings belong in the rationale, not silently absorbed.

Identify the outcome's hard requirements—vision, long context, a minimum context size—and the catalog agent tokens the spawning mechanism can actually launch; both become `check` flags, never mental notes.

**Complete when:** the pick has a written rationale naming the task judgment, and every hard requirement and launchable-agent constraint is listed for the check.

## Gate-check the decision

Run one check per decision—each delegated outcome carries its own judgment and rationale or its own principal route basis; one decision never determines another:

```sh
python3 <skill-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  [--launchable-via <agent,...>] \
  [--require-feature <feature>] [--minimum-context <tokens>] \
  --quota-axi --compact
```

When the brief's activation rule applies, use `check --exact-route <route-id> --route-basis "<verbatim principal request>"` instead of `--candidate`/`--reason`. Preserve that basis on every quota-acceptance or fallback re-check. `--launchable-via` names the catalog `agent` tokens the consumer's spawning mechanism can launch (for example `claude` alone for harness-native subagents); a candidate outside that set is refused, never silently substituted.

`check` enforces only hard gates—disabled candidates, missing required features or context, unlaunchable agents, authentication, exhausted quota—and emits one JSON decision:

- `selected` (exit 0): judged pick passed; carries `selected` launch tuple, `reason`, `warnings`, `quota`.
- `exact` (exit 0): principal-requested route passed; carries the task's `route_basis`, `exact_route`, and configuration-layer `provenance` instead of a candidate judgment.
- `refused` (exit 1): a hard gate failed; `reasons` names each gate. Re-judge a refused candidate within unchanged principal constraints. Preserve a refused exact route until the principal authorizes a routing change; satisfy it through a permitted launch surface or surface the conflict. Never launch a refused decision directly.
- `needs-acceptance` (exit 2): every gate passed but quota is unknown or stale. `pending` names the cheapest recovery first — refresh credentials when a remedy is present, otherwise accept unknown quota. An exact route that returns `needs-acceptance` stays the route: surface `pending` (and any `quota_fallback`) to the principal; do not substitute another candidate. If they accept, rerun with `--accept-quota-unknown "<who accepted and why>"`. If `quota_fallback` is present, one ask covers every same-blocker exact-route check in the session; when the principal does not answer within `ask_seconds`, re-check that same exact route with `--use-quota-fallback "<who waited and how long>"` — that re-check tries the primary first and uses the fallback only while quota is still unknown or stale.

When the decision's warnings or quota materially contradict the judgment—quota far below what the brief showed, an unexplained warning—re-judge before launching instead of proceeding anyway.

Every quota verdict names the account it measured, because one machine may hold several accounts per provider and quota tools read whichever the environment selects. Report a quota refusal with that account: "exhausted for `<account>`" is answerable, while a bare "exhausted" strands the principal when they meant a different account. If a verdict reads `account unattributed`, quota could not be tied to an identity — say so rather than presenting it as settled. Never switch accounts by changing the measuring environment alone: that moves which account is measured, not which one the launch bills. Record the billing account per provider under `accounts` in configuration so the mismatch is refused instead of trusted.

A candidate whose launch tuple pins one account is not the same offer as the same model reached through a rotating proxy, which selects a credential per request and moves on when one is exhausted. When a route pinned to a single account is refused for quota, that refusal binds only that route: say which account is out and whether the same model is configured through a pooled surface, rather than reporting the model itself as unavailable. A `pooled` quota reading passes and carries a warning naming the pool — it is a settled state, not a reading to accept or recover.

**Complete when:** the consumer holds a `selected` decision with its task judgment or an `exact` decision with its principal route basis, and the gates match the outcome's stated requirements; a candidate refusal has been re-judged within unchanged constraints; an exact-route refusal has been satisfied through a permitted launch surface or surfaced to the principal; or an exact-route `needs-acceptance` has been accepted, surfaced with no fallback configured, or re-checked with the same basis and `--use-quota-fallback` after the configured wait.

## View or modify configuration

For requests to inspect, explain, add, change, or remove routing configuration—exact routes, preferences, candidate overrides—read [Configuration](references/configuration.md) before acting. `config.py` owns persisted layers and exact-route provenance; `router.py brief` shows what a spawning agent actually sees.

**Complete when:** a view shows effective routes and the brief with provenance, or a change is validated in its intended scope and visible in the regenerated brief.
