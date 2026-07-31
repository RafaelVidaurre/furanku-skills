---
name: crew
description: Assign Commander, Captain, and Worker ownership, and select research-backed agent, model, and effort combinations for spawned owners. Use when the user asks an agent to act as or become Commander, Captain, or Worker; asks Commander to take command of a Captain; or asks to view, diagnose, or modify Crew routing configuration.
---

# Crew

Crew adds roles and routes. Beads hold durable work; Orca holds coordination state.

## Ownership

- Commander is optional. Without one, Captains and direct Workers report to the user.
- The user or Commander may assign Captains and direct Workers.
- A Captain owns one front that needs design, decomposition, or integration and assigns only Workers.
- A Worker owns one bounded outcome.
- Every assignment names one `reports_to`: `user`, `commander`, or `captain`.
- Orca owns coordination, terminals, and worktrees.

Read the role contract for the role being performed:

- [Commander](references/commander.md)
- [Captain](references/captain.md)
- [Worker](references/worker.md)

## View or modify configuration

For requests to inspect, explain, add, change, or remove routing configuration, read [Configuration](references/configuration.md) before acting. Use the bundled helpers: `config.py` owns persisted layers and exact-route provenance; `router.py` compiles task-fit policy and research evidence.

For a view, report both exact routes and compiled task-fit routing against the relevant repository. For a change, inspect the current layers, write only the user-selected `global`, `repo`, or `machine-repo` scope through `config.py`, then rerun both reports and a representative decision. Preserve untouched routes and routing patches. Use `delete` only for an explicit layer-removal request after confirmation.

**Complete when:** a view shows effective exact routes and task-fit policy with provenance, or a change is validated in its intended scope and produces the requested effective decision.

## Direct role

When the user gives the current session a role, adopt it immediately with `reports_to: user`. The current request is its initial contract. Do not create a Bead, resolve a route, or create an upstream Orca dispatch solely to establish the role.

Load `orchestration` when the role delegates or supervises durable work, and `orca-cli` when it needs terminals or worktrees. Follow their current guidance.

**Complete when:** the current session has acknowledged its role, principal, and immediate outcome.

## Spawn an owner

Choose by task fit unless the user explicitly requests an exact configured route or candidate. Coordination role does not imply model strength. Express the Captain's judgment as a semantic specialization plus only the capability, feature, selection-mode, priority, continuity, or allowlist overrides materially required by the work. Specializations describe work such as `architecture`, `implementation`, `review`, `ui-product`, or `spatial-3d`; they never name a model. Map “best possible regardless of cost” to `best-quality` and “cheapest good enough” to `cheapest-sufficient`; otherwise retain the specialization default.

Write that judgment as a routing request, then select with live quota and pipe the decision into the assignment helper:

```sh
python3 <crew-skill-dir>/scripts/router.py choose --repo <root> \
  --request-file <request.json> --quota-axi --compact |
python3 <crew-skill-dir>/scripts/assignment.py --decision-json - \
  --title "<outcome>" --front-key <run>/<front> \
  --role captain|worker --reports-to user|commander|captain \
  --bead <id>
```

The request must name `role` and either a configured `specialization` or explicit `needs`. Use `exact_route` for a configured v2/v3 route, or `pin` with a candidate ID and reason for an explicit user override; hard runtime gates still apply to pins. Treat `no-route` as a decision requiring different requirements, more research, or an explicit override—do not silently launch an insufficient candidate. If quota-axi fails, surface its failure; omit live quota only after the principal accepts unknown quota.

Use `--request "<verbatim user request>"` instead of `--bead` only when the spawned owner must establish the first Bead. Launch the selected candidate, then use Orca to dispatch the generated title and spec. Each Captain runs the same selector for each Worker outcome instead of inheriting a fixed Worker model table.

**Complete when:** the owner has the intended role, principal, work pointer, route provenance, live Orca dispatch when supervision is required, and tracked pointers for the Orca resources created by the assignment.

## Retire an owner

The session that creates an Orca assignment owns the lifecycle of the Orca resources it created for that owner.

After repository policy declares the result integrated—for example, after its merge—or explicitly abandoned, use the current `orchestration` guidance to finish the assignment state and the current `orca-cli` guidance to retire its dedicated terminals and worktree. Limit retirement to assignment-created resources; preserve pre-existing or shared resources and anything that still backs active, queued, or unintegrated work. Report a retained resource by exact pointer and reason instead of leaving silent residue.

**Complete when:** each finished assignment's dedicated Orca resources are retired, or every retained resource has explicit remaining work or a cleanup blocker reported to the principal.
