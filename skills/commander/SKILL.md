---
name: commander
description: Coordinate Beads across Orca-managed work fronts and route spawned Captains and Workers to configured agent, model, and effort combinations. Use when the user asks to orchestrate, parallelize, fan out, or delegate work across subagents, Captains, or Workers, asks to deliver, supervise, resume, or report on multi-agent work, names Commander, or asks about Commander routing configuration.
---

# Commander

- **Fronts** — which independently owned streams advance the selected Beads
- **Routes** — which configured Captain or Worker row owns each front

Beads hold the work. Orca coordinates. Dispatches are pointers. Needs `bd` + `orchestration`; load `orca-cli` for terminals/worktrees. Follow those guides as written. The user session keeps its own model and effort.

**Stay lean.** No Commander lifecycle on top of Orca. No product work, no QA process (repo + Bead own quality/done-criteria), no visual/domain taste, no restating work in dispatches, no mid-flight micro-management. Gaps → Beads; dispatches stay pointers.

Configuration-only: [Configuration](references/configuration.md). For effective-routing or provenance questions, run `python3 <commander-skill-dir>/scripts/config.py report --repo <root>` and show stdout as-is.

## Run

1. **Contract.** Read or create Bead(s); seed new ones with the user's words. Requirements and decisions live only in Beads. Child Beads only for distinct durable requirements. Note autonomy. **Done when:** selected Beads exist with the request and known constraints.

2. **Fronts → routes → launch.** One outcome, one owner per front (Worker = bounded; Captain = needs decompose/integrate; Captain-shaped work below returns here). One run key; front keys `<run-key>/<bead-id>/<front-name>`. Orca tasks for deps. Worktrees only for concurrent writers; else fresh terminals in the existing checkout. Captain worktree only if that front is isolated or its Workers write in parallel (then Workers use child worktrees and reconcile in the Captain checkout).

   ```sh
   python3 <commander-skill-dir>/scripts/config.py resolve --repo <root> --compact --route <id>
   python3 <commander-skill-dir>/scripts/dispatch.py \
     --title "<outcome>" --front-key <run>/<bead>/<name> \
     --route <id> --agent <a> --model <m> --effort <e> \
     --checkout "<mode or path>" --autonomy supervised|autonomous \
     [--captain-contract <abs-captain.md>] [--routes-json -]
   ```

   Specialist only when `work` text explicitly names the outcome; sole match wins; same agent/model/effort multi-match → lexicographically first route ID; else ask the user. Pipe compact resolve into `--routes-json -` for Captains. Use the helper's JSON `title` + `spec` only — no free-text requirements. Route-aware launch, then dispatch to that handle. `orchestration run` only if it binds the exact row. Captains get captain.md by absolute path (inline only if unreadable). Direct Workers: seed the Bead with the Captain contract's Worker return rules (result, time, process notes when useful). **Done when:** every ready front is on its exact route with known task ID.

3. **Supervise.** One Orca wait for completion/`worker_done` (timeout sized to the front; on expiry check state once, extend or escalate — no heartbeat polling). If a wait outlives any plausible front duration, check once and escalate or redispatch — do not wait silently. Message the user at dispatch, blocker, and close. Surface human decisions immediately; name the thread; single answers go in-thread (relay verbatim); no blocking question UI. Autonomous Captains decide reversible in-scope items in the Bead (captain contract); no peer debate agents. Resume via task IDs or run key (front-key prefix); else list matches and get a named user decision before adopting any. Blocker/gap → Bead + pointer redispatch, never a fix essay. **Done when:** each front has a result or blocker, and decisions are answered or recorded.

4. **Close + hand over.** Update Beads from returned results. Ready-to-land fronts store front report + retrospective as a **Bead comment** (Captain contract template). Close when the Bead's own criteria are met; else leave remaining work explicit. Tell the user what changed, open decisions, front keys / task IDs / routes, and any **process** signal from those comments worth acting on (recurrent waste, suggested skill/repo fixes) — do not re-litigate product taste. Do not prescribe how work lands (merge, PR, push, branch cleanup). **Done when:** Beads match what the user hears, open decisions are explicit, and each ready-to-land front has a retrospective comment on its Bead.
