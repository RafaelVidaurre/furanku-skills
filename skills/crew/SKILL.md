---
name: crew
description: Assign Commander, Captain, and Worker ownership, and route spawned agents to configured agent, model, and effort combinations. Use when the user asks an agent to act as or become one of these roles, asks Commander to take command of a Captain, or asks to configure Crew role routes.
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

For route setup, changes, or diagnosis, read [Configuration](references/configuration.md).

## Direct role

When the user gives the current session a role, adopt it immediately with `reports_to: user`. The current request is its initial contract. Do not create a Bead, resolve a route, or create an upstream Orca dispatch solely to establish the role.

Load `orchestration` when the role delegates or supervises durable work, and `orca-cli` when it needs terminals or worktrees. Follow their current guidance.

**Complete when:** the current session has acknowledged its role, principal, and immediate outcome.

## Spawn an owner

Select the base route from the ownership shape. A specialist matches only when its `work` text explicitly names the outcome. Use the sole match; when several matches resolve to the same `agent`, `model`, and `effort`, use the lexicographically first route ID; otherwise ask the user.

Resolve the effective table and pipe it into the assignment helper:

```sh
python3 <crew-skill-dir>/scripts/config.py resolve --repo <root> --compact |
python3 <crew-skill-dir>/scripts/assignment.py --routes-json - \
  --title "<outcome>" --front-key <run>/<front> \
  --role captain|worker --reports-to user|commander|captain \
  --route <id> --bead <id>
```

Use `--request "<verbatim user request>"` instead of `--bead` only when the spawned owner must establish the first Bead. The helper derives route provenance from the resolver output and includes Worker rows for Captains. Launch the exact route, then use Orca to dispatch the generated title and spec.

**Complete when:** the owner has the intended role, principal, work pointer, route provenance, live Orca dispatch when supervision is required, and tracked pointers for the Orca resources created by the assignment.

## Retire an owner

The session that creates an Orca assignment owns the lifecycle of the Orca resources it created for that owner.

After repository policy declares the result integrated—for example, after its merge—or explicitly abandoned, use the current `orchestration` guidance to finish the assignment state and the current `orca-cli` guidance to retire its dedicated terminals and worktree. Limit retirement to assignment-created resources; preserve pre-existing or shared resources and anything that still backs active, queued, or unintegrated work. Report a retained resource by exact pointer and reason instead of leaving silent residue.

**Complete when:** each finished assignment's dedicated Orca resources are retired, or every retained resource has explicit remaining work or a cleanup blocker reported to the principal.
