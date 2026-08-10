---
name: model-routing
description: Choose which agent, model, and effort should own a delegated task—backed by research evidence, user routing preferences, and live quota—and emit a gate-checked launch decision any spawning mechanism can consume. Use when an agent is about to spawn or delegate work and must pick the agent, model, or effort for it; when the user asks to view, explain, or modify routing configuration, routing preferences, or launchable candidates; or when the user asks to generate or diagnose the routing brief or a launch gate-check.
---

# Model routing

The agent about to spawn work—not a script—decides which agent, model, and effort the spawned owner gets. This skill supplies what that judgment needs (the brief) and enforces what must never be judgment (the gates). `<skill-dir>` below is the directory containing this file.

## Generate the brief

Use a configured exact route when the user asked for one; otherwise judge the work against the brief. Generate it with live quota and read it:

```sh
python3 <skill-dir>/scripts/router.py brief --repo <root> --quota-axi
```

One brief serves the whole spawning session—reuse it across decisions and regenerate only after a configuration change or when the brief's printed quota capture time is more than 30 minutes old. If quota-axi fails, the brief says so in its notes and quota stays unknown; the acceptance gate in `check` handles that—never estimate quota yourself.

**Complete when:** the current session holds a brief fresh by the rule above.

## Judge the pick

The brief carries what the session does not otherwise know: the user's routing preferences by scope, configured exact routes, and every launchable candidate with research evidence, task cost, speed, features, context capacity, and current quota. Judge each outcome on the dimensions the evidence covers—reasoning depth, implementation demands, agentic repository work, UI or spatial character—plus risk: how expensive a wrong result is, and whether the owner holds write authority. Choose the cheaper, quota-lighter candidate—as the brief defines quota-lighter—whenever it has no material task-relevant disadvantage. Spend premium capability only when the capability difference matters to the cost of being wrong, and let the rationale for an expensive pick name why cheaper candidates were insufficient. Preferences bind: resolve conflicts by the precedence order the brief states, and when applicability stays genuinely ambiguous, ask the principal instead of inventing precedence. Low-confidence or dated evidence and quota warnings belong in the rationale, not silently absorbed.

Identify the outcome's hard requirements—vision, long context, a minimum context size—and the launchers the spawning mechanism can actually start; both become `check` flags, never mental notes.

**Complete when:** the pick has a written rationale naming the task judgment, and every hard requirement and launcher constraint is listed for the check.

## Gate-check the decision

Run one check per decision—each delegated outcome gets its own judgment and rationale; one decision never determines another:

```sh
python3 <skill-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  [--launchable-via <launcher,...>] \
  [--require-feature <feature>] [--minimum-context <tokens>] \
  --quota-axi --compact
```

Use `check --exact-route <route-id>` instead of `--candidate`/`--reason` for a configured route. `--launchable-via` names the launchers the consumer's spawning mechanism can drive (for example `claude` alone for harness-native subagents); a candidate outside that set is refused, never silently substituted.

`check` enforces only hard gates—disabled candidates, missing required features or context, unreachable launchers, authentication, exhausted quota—and emits one JSON decision:

- `selected` (exit 0): judged pick passed; carries `selected` launch tuple, `reason`, `warnings`, `quota`.
- `exact` (exit 0): configured route passed; carries `exact_route` and layer `provenance` instead of `reason`.
- `refused` (exit 1): a hard gate failed; `reasons` names each gate. Answer by re-judging or surfacing the gate to the principal—never by launching the refused candidate directly.
- `needs-acceptance` (exit 2): every gate passed but quota is unknown or stale. Obtain the principal's acceptance, then rerun with `--accept-quota-unknown "<who accepted and why>"`; the decision then records that basis as `quota_acceptance`.

When the decision's warnings or quota materially contradict the judgment—quota far below what the brief showed, an unexplained warning—re-judge before launching instead of proceeding anyway.

**Complete when:** the consumer holds a `selected` or `exact` decision JSON whose gates match the outcome's stated requirements, or a refusal has been answered by re-judging or escalating.

## View or modify configuration

For requests to inspect, explain, add, change, or remove routing configuration—exact routes, preferences, candidate overrides—read [Configuration](references/configuration.md) before acting. `config.py` owns persisted layers and exact-route provenance; `router.py brief` shows what a spawning agent actually sees.

**Complete when:** a view shows effective routes and the brief with provenance, or a change is validated in its intended scope and visible in the regenerated brief.
