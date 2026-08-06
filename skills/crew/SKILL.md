---
name: crew
description: Assign Commander, Captain, and Worker ownership, and judge research-informed agent, model, and effort picks for spawned owners. Use when the user asks an agent to act as or become Commander, Captain, or Worker; asks to spawn or delegate a Captain or Worker, or to choose which agent, model, or effort should own a task; asks Commander to take command of a Captain; asks to retire a finished owner or clean up its terminals and worktree; or asks to view, diagnose, or modify Crew routing configuration.
---

# Crew

Crew adds roles and routes. Beads hold durable work; Orca holds coordination state.

## Ownership

- Commander is optional. Without one, Captains and direct Workers report to the user.
- The user or Commander may assign Captains and direct Workers.
- Every assignment names one `reports_to`: `user`, `commander`, or `captain`.
- Role responsibilities and boundaries live in the role contracts below, nowhere else.
- Orca owns coordination, terminals, and worktrees.
- Name each Crew Orca tab `<Role> - <work summary>` so the role is visible at a glance (for example `Commander - multi-front status`, `Captain - payments integration`, `Worker - fix flaky auth tests`). Role is `Commander`, `Captain`, or `Worker`; the second part is a short human label for the work.

Read the role contract for the role being performed:

- [Commander](references/commander.md)
- [Captain](references/captain.md)
- [Worker](references/worker.md)

## View or modify configuration

For requests to inspect, explain, add, change, or remove routing configuration, read [Configuration](references/configuration.md) before acting. Use the bundled helpers: `config.py` owns persisted layers and exact-route provenance; `router.py` compiles the routing brief from research evidence, configured candidates, and user preferences.

For a view, report the exact-route report and the routing brief against the relevant repository. For a change, inspect the current layers, write only the user-selected `global`, `repo`, or `machine-repo` scope through `config.py`, then regenerate both and confirm the brief states the requested preference, candidate, or route. Preserve untouched routes, preferences, and candidate overrides. Use `delete` only for an explicit layer-removal request after confirmation.

**Complete when:** a view shows effective exact routes and the routing brief with provenance, or a change is validated in its intended scope and visible in the regenerated brief.

## Direct role

When the user gives the current session a role, adopt it immediately with `reports_to: user`. The current request is its initial contract. Do not create a Bead, resolve a route, or create an upstream Orca dispatch solely to establish the role. If this session is an Orca tab, set its name to `<Role> - <work summary>` per Ownership.

Load `orchestration` when the role delegates or supervises durable work, and `orca-cli` when it needs terminals or worktrees. Follow their current guidance.

**Complete when:** the current session has acknowledged its role, principal, and immediate outcome, and any Orca tab for the session uses the role-prefixed name.

## Spawn an owner

The spawning owner—not a script—decides which agent, model, and effort each spawned owner gets. Use a configured exact route when the user asked for one; otherwise judge the work and pick a candidate from the routing brief. Coordination role does not imply model strength.

Generate the brief with live quota and read it. One brief serves the whole spawning session—reuse it across owners and regenerate only after a configuration change or when the brief's printed quota capture time is more than 30 minutes old:

```sh
python3 <crew-skill-dir>/scripts/router.py brief --repo <root> --quota-axi
```

The brief carries what the session does not otherwise know: the user's routing preferences by scope, configured exact routes, and every launchable candidate with research evidence, task cost, speed, features, context capacity, and current quota. Judge each outcome on the dimensions the evidence covers—reasoning depth, implementation demands, agentic repository work, UI or spatial character—plus risk: how expensive a wrong result is, and whether the owner holds write authority. Choose the cheaper, quota-lighter candidate—as the brief defines quota-lighter—whenever it has no material task-relevant disadvantage. Spend premium capability only when the capability difference matters to the cost of being wrong, and let the rationale for an expensive pick name why cheaper candidates were insufficient. Preferences bind: resolve conflicts by the precedence order the brief states, and when applicability stays genuinely ambiguous, ask the principal instead of inventing precedence. Low-confidence or dated evidence and quota warnings belong in the rationale, not silently absorbed.

Identify the outcome's hard requirements—vision, long context, a minimum context size—and pass any that exist to `check` via `--require-feature` and `--minimum-context`. Validate the pick against hard gates and record the judgment, then feed the decision into the assignment helper. Run the check-and-assign pipeline once per spawned owner: each owner gets its own judgment, rationale, and decision—one owner's pick never determines another's. The generated spec records the check's warnings and quota; when they materially contradict the judgment—quota far below what the brief showed, an unexplained warning—re-judge before dispatching instead of launching anyway.

```sh
python3 <crew-skill-dir>/scripts/router.py check --repo <root> \
  --candidate <id> --reason "<the task judgment behind this pick>" \
  --quota-axi --compact |
python3 <crew-skill-dir>/scripts/assignment.py --decision-json - \
  --title "<outcome>" --front-key <run>/<front> \
  --role captain|worker --reports-to user|commander|captain \
  --bead <id>
```

Use `check --exact-route <route-id>` for a configured route. `check` enforces only hard gates—disabled candidates, missing required features or context, authentication, exhausted quota—and refuses with reasons instead of substituting its own pick; answer a refusal by re-judging or surfacing the gate to the principal, never by launching the refused candidate directly. If quota-axi fails, surface its failure; omit live quota only after the principal accepts unknown quota.

Use `--request "<verbatim user request>"` instead of `--bead` only when the spawned owner must establish the first Bead. Launch the selected candidate, then use Orca to dispatch the generated title and spec. Name the owner's Orca tab `<Role> - <work summary>` per Ownership.

**Complete when:** the owner has the intended role, principal, work pointer, a gate-checked launch decision recorded with the spawning owner's rationale for a judged pick or route provenance for an exact pick, live Orca dispatch when supervision is required, a role-prefixed Orca tab name, and tracked pointers for the Orca resources created by the assignment.

## Retire an owner

The session that creates an Orca assignment owns the lifecycle of the Orca resources it created for that owner.

After repository policy declares the result integrated—for example, after its merge—or explicitly abandoned, use the current `orchestration` guidance to finish the assignment state and the current `orca-cli` guidance to retire its dedicated terminals and worktree. Limit retirement to assignment-created resources; preserve pre-existing or shared resources and anything that still backs active, queued, or unintegrated work. Report a retained resource by exact pointer and reason instead of leaving silent residue.

**Complete when:** each finished assignment's dedicated Orca resources are retired, or every retained resource has explicit remaining work or a cleanup blocker reported to the principal.
