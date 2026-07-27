# Firstmate vs. Commander + Beads + Orca

Research date: 2026-07-24 (Europe/Lisbon)

Repository: [`kunchenguid/firstmate`](https://github.com/kunchenguid/firstmate)

Commit inspected: [`10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1`](https://github.com/kunchenguid/firstmate/tree/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1)

The repository name is **firstmate**, not `fistmate`.

## Recommendation

Do **not** replace the current Commander + Beads + Orca stack with Firstmate
yet.

Firstmate is a serious and unusually complete orchestration runtime, but it is
not a drop-in skill. Its own README calls it an "agent distro": a cloned
operational home containing an always-loaded `AGENTS.md`, private task state,
scripts, hooks, backends, project clones, and internal skills
([README](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/README.md#what-it-is)).
Adopting it would replace Commander's control plane and much of the current
Beads/Orca lifecycle rather than improve Commander in place.

The current stack remains the better fit when the goals are:

- one small, portable public skill;
- Beads as the durable work contract;
- Orca as the native task, worktree, terminal, and coordination owner;
- low controller-context overhead; and
- no second task database or supervision state machine.

Firstmate becomes the better candidate only if the desired product is a
turnkey, GitHub-centric multi-project crew appliance and the team is willing to
adopt its whole operating model. Even then, pilot it separately and use one
control plane per run. Do not nest Commander inside Firstmate or run Firstmate's
backlog and watcher as a second source of truth beside Beads and Orca.

## What is genuinely strong

Firstmate's robustness is mostly implemented in scripts and durable state, not
left to prompt compliance.

### Event-driven supervision

`fm-watch.sh` classifies routine events in bash and wakes the model only for an
actionable event. It writes an actionable wake to a durable queue before
advancing detector state, supports retryable PR receipts, suppresses benign
heartbeats, and separates ordinary foreground supervision from an optional
away-mode daemon
([architecture](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/architecture.md#event-driven-supervision)).

This is the strongest idea to borrow. A model should not spend a turn polling a
terminal merely to learn that nothing changed.

### Events are not current state

Firstmate explicitly treats status files as append-only wake-event logs.
`fm-crew-state.sh` computes current state from the validation run, backend
liveness, terminal evidence, and only then the latest recognized event
([architecture](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/architecture.md#event-driven-supervision),
[operating contract](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/AGENTS.md#8-supervision-protocol)).

That avoids a common recovery error: interpreting an old "working", "blocked",
or "done" message as live truth after the worker has moved on.

### Restart and concurrency safety

The startup path acquires a per-home session lock before mutation, drains the
durable wake queue, prints one bounded fleet digest, and reconciles recorded
tasks with live endpoints. A second session that cannot acquire the lock stays
read-only
([AGENTS.md](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/AGENTS.md#3-session-start--recovery)).

Commander says it is the single manager, but the current skill does not enforce
that statement with a lease. Firstmate shows what enforceable ownership looks
like.

### Fail-safe cleanup

Every task gets an isolated worktree. Cleanup refuses dirty or unlanded ship
work, verifies that the recorded backend identity resolves to the inspected
worktree, and delegates removal to the owning backend
([Orca lifecycle](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/orca-backend.md#lifecycle)).

The useful general rule is: retire operational state only after the delivery
artifact is proven durable, and bind that proof to the exact task identity.

### Explicit work and authority shapes

Firstmate distinguishes:

- **ship** tasks, which may change a project;
- **scout** tasks, which produce a standalone report and never push;
- `no-mistakes`, `direct-PR`, and `local-only` delivery modes; and
- a separate `+yolo` standing-authority flag.

These distinctions keep "investigate" from silently becoming "implement" and
keep delivery mechanics separate from merge authority
([README features](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/README.md#features)).

### Adapter boundaries and tests

Firstmate separates the agent harness from the runtime backend. Claude, Codex,
Grok, Pi, and OpenCode are harness adapters; tmux, Herdr, Zellij, Orca, and cmux
are endpoint/worktree backends
([runtime architecture](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/architecture.md#runtime-session-backends)).

At the inspected commit, the repository contained:

- 89 shell scripts under `bin/`;
- 96 `*.test.sh` behavior suites;
- 17 internal skills; and
- CI lanes for ShellCheck, complete test-inventory coverage, parallel and serial
  portable tests, real-Herdr tests, stock macOS Bash checks, and repository
  invariants
  ([CI workflow](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/.github/workflows/ci.yml)).

This is strong evidence of engineering effort. It is not yet evidence of
long-term operational maturity.

## The token-efficiency result is mixed

Firstmate's watcher can save many tokens during long-running fleets because
routine polling stays in bash. Its startup flow also prints one digest and tells
the agent to trust it rather than reread the same backlog, metadata, and context
files
([startup contract](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/AGENTS.md#3-session-start--recovery)).

But its prompt footprint is not small. Local source measurements used
`tiktoken` with `o200k_base` at the inspected commit:

| Loaded source | Tokens |
| --- | ---: |
| Firstmate always-loaded `AGENTS.md` | 10,798 |
| Conditional `harness-adapters` skill | 8,507 |
| Conditional `firstmate-orca` skill | 1,185 |
| Firstmate base + first Orca spawn path | 20,490 |
| All 17 internal skills, excluding `AGENTS.md` | 38,427 |
| Current Commander `SKILL.md` | 1,303 |
| Current Commander + installed `orchestration` + `orca-cli` skills | 11,977 |

The current-stack values are documented in the
[orchestration landscape report](orchestration-skills-landscape.md#measured-prompt-footprint).
These are source-size comparisons, not billing traces: caching, skill
progressive loading, generated startup digests, worker prompts, and the number
of wake turns all affect actual usage.

The practical conclusion is:

- **Firstmate is more efficient between events.**
- **The current stack is materially smaller on a normal Orca dispatch path.**
- Firstmate's generated startup digest can grow with project, captain, learning,
  and fleet records even though task tails are bounded.
- Firstmate currently has an unresolved user report titled
  ["Crazy token usage"](https://github.com/kunchenguid/firstmate/issues/923).
  That report is anecdotal, not a benchmark, but it is consistent with the
  measured prompt surface.

The best design combines Commander's small policy layer with Firstmate's
non-LLM event handling. Copy the watcher pattern, not the 10,798-token operating
contract.

## Why wholesale replacement is premature

### It duplicates the current sources of truth

Firstmate owns `data/backlog.md` through `tasks-axi`, task briefs and reports
under `data/`, task metadata and append-only events under `state/`, its own wake
queue, and its own current-state reconciler
([configuration](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/configuration.md#operational-home-layout-and-state)).

The current stack already assigns:

- outcomes, acceptance criteria, dependencies, blockers, and completion to
  Beads; and
- dispatch, questions, task lifecycle, worktrees, terminals, and provenance to
  Orca.

Running both would create two managers, two task ledgers, and two definitions of
current state. Reconciliation cost and failure modes would outweigh the extra
guardrails.

### Orca support is explicitly experimental

Firstmate's reference backend is tmux. Orca is explicit-only, macOS-only, has no
secondmate support, lacks Escape, and has no stable CLI/protocol version marker
([Orca limitations](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/orca-backend.md#limitations)).

For an Orca-native workflow, replacing a mature direct integration with an
experimental adapter is the wrong direction.

### It is broad and operationally expensive

The universal toolchain includes Node, Git, authenticated `gh`, no-mistakes,
gh-axi, chrome-devtools-axi, lavish-axi, tasks-axi, and quota-axi, plus the
selected backend's dependencies
([toolchain](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/docs/configuration.md#toolchain)).

Its multi-project clone registry, secondmate homes, X integration, five
backends, five harnesses, away-mode daemon, custom backlog, and update
propagation are valuable only when those capabilities are wanted. Otherwise
they are maintenance and prompt surface.

### It is popular but very young

The repository was created on 2026-06-12. On the research date it had 1,783
stars, 584 forks, no tagged releases, and a very high rate of ongoing changes
([GitHub repository API](https://api.github.com/repos/kunchenguid/firstmate),
[releases](https://github.com/kunchenguid/firstmate/releases)).

Recent open issues include a host-crash worktree lease hazard
([#947](https://github.com/kunchenguid/firstmate/issues/947)), a supervision
recovery deadlock ([#943](https://github.com/kunchenguid/firstmate/issues/943)),
the token-usage report ([#923](https://github.com/kunchenguid/firstmate/issues/923)),
and a stock macOS Bash parse failure in the task-brief generator
([#958](https://github.com/kunchenguid/firstmate/issues/958)).
Fast fixes and extensive tests are encouraging, but there is no stable release
line to adopt yet.

The Bash failure was independently reproduced at the inspected commit on the
current host:

```text
$ /bin/bash --version
GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)
$ /bin/bash -n bin/fm-brief.sh
bin/fm-brief.sh: line 314: unexpected EOF while looking for matching `)'
bin/fm-brief.sh: line 388: syntax error: unexpected end of file
```

The repository's macOS CI lane checks selected snapshot scripts and tests, not
`fm-brief.sh`, so that lane can pass while a core spawn-path script does not
parse under the stock macOS shell
([workflow](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/.github/workflows/ci.yml#L307-L342)).
The failure comes from an apostrophe inside a heredoc nested in command
substitution, a Bash 3.2 lexer hazard; Firstmate's own brief test documents the
hazard but runs in the modern-Bash lanes
([source](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/bin/fm-brief.sh#L310-L332),
[test](https://github.com/kunchenguid/firstmate/blob/10ee7797e50c88c9865d8fb382cdfee5c2b8bcd1/tests/fm-brief.test.sh#L1-L29)).
This is a concrete current defect and a useful lesson for the current stack:
backend contract tests need to exercise the real platform shell and the entire
dispatch-critical script set.

## Improvements to apply to the current stack

Ordered by expected value:

1. **Move routine supervision below the model.** Add an Orca-native watcher that
   emits only actionable state transitions. Keep the policy trigger in
   Commander tiny.
2. **Separate event history from authoritative current state.** Derive current
   state from Orca task/terminal facts and Beads acceptance state; never treat
   the latest message as truth by itself.
3. **Enforce one active manager per run.** Use a scoped, recoverable lease keyed
   to the repository or selected Bead set. A second Commander should be
   read-only.
4. **Make recovery one read.** Produce a compact, bounded resume snapshot:
   selected Beads, active Orca dispatches, unresolved decisions, delivery
   artifacts, and the next action. Do not replay history.
5. **Make cleanup evidence-bound.** Before removing a worktree or retiring a
   dispatch, prove that the accepted artifact belongs to that task and is
   durable. Preserve state on ambiguity.
6. **Adopt explicit `ship` and `scout` task shapes.** An investigation ends in a
   file-backed report; implementation needs separate authority.
7. **Configure only agents Commander launches.** The user-launched Commander
   session already has a model and effort. Firstmate likewise routes spawned
   crewmates and secondmates, not the primary session. Remove Commander's
   `commander` route and model-mismatch confirmation; retain worker, captain,
   and specialist routes.
8. **Test orchestration as a state machine.** Add backend contract tests for
   spawn, identity, current-state reads, wake deduplication, recovery, and
   cleanup refusal. Keep these tests in the mechanism owner, not Commander.
9. **Keep receipts terse and file-backed.** Workers should return outcome,
   evidence paths, validation result, blockers/decisions, and artifact identity
   in a bounded receipt. Detailed logs stay on disk.

## What not to copy

- The nautical persona and captain-facing vocabulary.
- A 492-line always-loaded operating contract.
- A second backlog, task metadata tree, or project registry.
- Multi-project clone ownership inside Commander.
- X integration, away mode, persistent secondmates, or five backend adapters
  without a demonstrated need.
- Harness facts inside Commander; those belong to dispatch/runtime adapters.
- Firstmate's primary-harness hooks when Orca can expose the state transition
  directly.

## Safe evaluation path

If Firstmate still looks attractive, evaluate it as a competing stack:

1. Pin an exact commit; do not track `main`.
2. Use a non-critical repository and `local-only` or non-`yolo` PR mode.
3. Start with the verified tmux backend to assess Firstmate itself.
4. Run the same representative fleet through both systems.
5. Record controller input/output tokens, worker tokens, number of model wake
   turns, recovery success after forced restart, duplicate dispatches, human
   interventions, and cleanup safety.
6. Try the experimental Orca backend only after the reference-backend run is
   understood.
7. Replace the current stack only if Firstmate wins on the measured workload
   and the team accepts its task store, project layout, toolchain, and release
   risk.

Until that evidence exists, improve the current owners with Firstmate's best
mechanisms and keep Commander thin.
