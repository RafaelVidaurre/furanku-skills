---
name: commander
description: Coordinate Beads across Orca-managed work fronts and route spawned Captains and Workers to configured agent, model, and effort combinations. Use when the user asks to orchestrate, parallelize, fan out, or delegate work across subagents, Captains, or Workers, asks to deliver, supervise, resume, or report on multi-agent work, names Commander, or asks about Commander routing configuration.
---

# Commander

Commander adds two decisions to Beads and Orca:

- **Fronts:** which independently owned streams advance the selected Beads.
- **Routes:** which configured Captain or Worker combination owns each front.

Beads is the durable contract. Orca is the coordination system. Delivery runs require `bd` and the `orchestration` skill; load `orca-cli` when Orca routes the run through terminals or worktrees. Follow both current Orca guides as written. The user-launched session keeps its own model and effort.

Beads holds every requirement a spawned agent needs, so dispatch text stays a pointer to the Bead and never restates the work.

For a configuration-only request, read [Configuration](references/configuration.md) and follow that branch without requiring a selected Bead or active Orca task state.

## Run

1. **Select or create the contract.** Read the requested Beads and their dependencies. A Bead need not exist when the user asks: when the request names none and none is discoverable, create the top-level Bead yourself and seed it with the user's request in their own words. Capture new durable requirements and decisions there. One Bead may have several execution, review, or integration fronts; create a child Bead only when the child is a distinct durable requirement. Record whether the user asked for an autonomous run or said they will be unavailable. **Complete when:** every selected Bead exists and carries the request plus whatever outcomes, constraints, dependencies, and unresolved user decisions are known so far; its Captain completes the definition.

2. **Map the fronts.** Give each front one outcome and one owner:
   - A **Worker** owns one bounded outcome.
   - A **Captain** owns a front that needs decomposition or integration and coordinates Worker children. Captain-shaped work discovered below it returns to Commander as a new front.

   Generate one unique run key and give every front a globally unique key such as `<run-key>/<bead-id>/<front-name>`. Express management and dependencies with Orca tasks. Each Captain owns its own worktree; its Workers run in child worktrees of that checkout, and their work lands and is reconciled in the Captain's worktree before the Captain returns a result. Give a Worker front reporting straight to Commander a top-level worktree. Follow the current `orca-cli` guide for how those checkouts are created. **Complete when:** every ready outcome appears once in the Orca front map with its run key, Bead ID, front key, owner tier, and task dependencies.

3. **Route each owner.** Resolve only the rows needed for the front map:

   ```sh
   python3 <commander-skill-dir>/scripts/config.py resolve --repo <repository-root> --compact --route <route-id>
   ```

   Repeat `--route` as needed. Choose the base role from ownership shape. A specialist matches only when its `work` text explicitly names the front's stated outcome; use the base route when none match. Use the sole match when exactly one fits. When several fit, choose the lexicographically first route ID if every match resolves to the same `agent`, `model`, and `effort`; otherwise obtain a named user decision. Current-invocation changes are ephemeral unless the user requests a config edit.

   Give each Captain a self-contained child-routing contract containing the resolved Worker rows with invocation overrides, this selection rule, route-aware launch before dispatch, the permission posture to launch children at, and the provenance fields required by the next step. Point it at [Captain contract](references/captain.md) for how to establish its Bead, decompose, and escalate, and inline that file's content instead when the launched agent cannot read the skill directory. Pass the run's autonomy setting in the same spec. **Complete when:** every ready front has one exact route, and every Captain spec carries the complete child-routing contract.

4. **Launch, then dispatch.** Use the current `orca-cli` guide's route-aware terminal launch to apply the exact `agent`, `model`, and `effort`, then use the `orchestration` guide to dispatch the task to that returned terminal handle. Use `orchestration run` only when its current interface can bind the exact resolved row.

   Every spawned session inherits this session's permission posture, so a Captain or Worker never stops for an approval this session would not have stopped for, and never holds authority this session was not granted. Express that posture with whatever the launched agent's current guide uses for it; Commander stores no such syntax. Orca's built-in agent launcher may not accept those arguments, and a launch that silently falls back to a default posture is a failed launch: use the `orca-cli` guide's custom-command terminal path instead, and report the mismatch rather than dispatching when neither path can carry it.

   Put the run key, Bead ID, front key, route ID, resolved `agent`, `model`, and `effort`, and the permission posture in every Orca task spec. Keep the dispatch text to that provenance, the Bead to read, and the contract to follow; requirements live in the Bead and are never restated in the message. **Complete when:** every dispatch targets the terminal launched for its resolved row at this session's permission posture, and its Orca task ID and exact routing provenance are known.

5. **Coordinate through Orca.** Commander supervises its direct Workers and Captains; each Captain supervises its Worker children and returns one integrated result. Use Orca's native task state, retries, results, and recovery guidance without adding a Commander lifecycle. On resume, use supplied Orca task IDs or run key. With neither, list task specs matching the selected Beads and obtain a named user decision before adopting any match, including a single match.

   When a Captain needs a human decision, surface it as soon as it is raised and name the thread that raised it, because answering that Captain directly is the default and the shortest path. Relay a single question or confirmation yourself and forward the reply verbatim. Send the user to the thread for anything multi-part, complex, or likely to open a conversation, and tell them they can route through you instead by saying so. Never open a blocking interactive question flow, such as an `AskUserQuestion`-style prompt, for either case.

   In an autonomous run, Captains resolve such questions with a peer launched on the Captain's own resolved route row rather than waiting. **Complete when:** Orca has a result or explicit blocker for every selected front, and every raised human decision has reached the user or been resolved autonomously and recorded.

6. **Close against the contract, then hand over.** Apply the returned results to the selected Beads. Close a Bead when its acceptance criteria are satisfied; otherwise keep the remaining work or decision explicit. Then notify the user that the work is ready and ask whether to merge it or review it first; do not merge before they answer. The handover report carries:

   - what changed, in the user's terms: features, fixes, improvements
   - tests, gates, or tooling added or changed
   - problems hit during the run, each with the change to this repository's guidance or tooling that would prevent a repeat
   - where time went: one row per front and per mechanical check, with elapsed time taken from Orca's own task records and marked unknown where Orca did not record it
   - the run key, front outcomes, Orca task IDs, routes used, and decisions needed

   **Complete when:** Beads and the user report describe the same outcome, and the user has been asked to merge or review.
