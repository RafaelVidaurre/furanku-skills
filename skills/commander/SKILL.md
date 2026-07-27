---
name: commander
description: Coordinate Beads across Orca-managed work fronts and route spawned Captains and Workers to configured agent, model, and effort combinations. Use only when the user explicitly invokes Commander for multi-agent delivery or Commander configuration.
disable-model-invocation: true
---

# Commander

Commander adds two decisions to Beads and Orca:

- **Fronts:** which independently owned streams advance the selected Beads.
- **Routes:** which configured Captain or Worker combination owns each front.

Beads is the durable contract. Orca is the coordination system. Delivery runs require `bd` and the `orchestration` skill; load `orca-cli` when Orca routes the run through terminals or worktrees. Follow both current Orca guides as written. The user-launched session keeps its own model and effort.

For a configuration-only request, read [Configuration](references/configuration.md) and follow that branch without requiring a selected Bead or active Orca task state.

## Run

1. **Select the contract.** Read the requested Beads and their dependencies. Capture new durable requirements and decisions there. One Bead may have several execution, review, or integration fronts; create a child Bead only when the child is a distinct durable requirement. **Complete when:** the selected Beads contain the outcomes, constraints, dependencies, and unresolved user decisions.

2. **Map the fronts.** Give each front one outcome and one owner:
   - A **Worker** owns one bounded outcome.
   - A **Captain** owns a front that needs decomposition or integration and coordinates Worker children. Captain-shaped work discovered below it returns to Commander as a new front.

   Generate one unique run key and give every front a globally unique key such as `<run-key>/<bead-id>/<front-name>`. Express management and dependencies with Orca tasks. Let the current Orca guide decide whether a separate checkout is warranted. When it is, use a child worktree for work stacked on or dependent on a parent checkout and a top-level worktree for independent work; sidebar lineage does not encode orchestration ownership. **Complete when:** every ready outcome appears once in the Orca front map with its run key, Bead ID, front key, owner tier, and task dependencies.

3. **Route each owner.** Resolve only the rows needed for the front map:

   ```sh
   python3 <commander-skill-dir>/scripts/config.py resolve --repo <repository-root> --compact --route <route-id>
   ```

   Repeat `--route` as needed. Choose the base role from ownership shape. A specialist matches only when its `work` text explicitly names the front's stated outcome; use the base route when none match. Use the sole match when exactly one fits. When several fit, choose the lexicographically first route ID if every match resolves to the same `agent`, `model`, and `effort`; otherwise obtain a named user decision. Current-invocation changes are ephemeral unless the user requests a config edit.

   Give each Captain a self-contained child-routing contract containing the resolved Worker rows with invocation overrides, this selection rule, route-aware launch before dispatch, and the provenance fields required by the next step. **Complete when:** every ready front has one exact route, and every Captain spec carries the complete child-routing contract.

4. **Launch, then dispatch.** Use the current `orca-cli` guide's route-aware terminal launch to apply the exact `agent`, `model`, and `effort`, then use the `orchestration` guide to dispatch the task to that returned terminal handle. Use `orchestration run` only when its current interface can bind the exact resolved row. Put the run key, Bead ID, front key, route ID, and resolved `agent`, `model`, and `effort` in every Orca task spec. **Complete when:** every dispatch targets the terminal launched for its resolved row, and its Orca task ID and exact routing provenance are known.

5. **Coordinate through Orca.** Commander supervises its direct Workers and Captains; each Captain supervises its Worker children and returns one integrated result. Use Orca's native task state, retries, results, and recovery guidance without adding a Commander lifecycle. On resume, use supplied Orca task IDs or run key. With neither, list task specs matching the selected Beads and obtain a named user decision before adopting any match, including a single match. **Complete when:** Orca has a result or explicit blocker for every selected front.

6. **Close against the contract.** Apply the returned results to the selected Beads. Close a Bead when its acceptance criteria are satisfied; otherwise keep the remaining work or decision explicit. Report the run key, front outcomes, Orca task IDs, routes used, and decisions needed. **Complete when:** Beads and the user report describe the same outcome.
