# Open-source agent-orchestration landscape for Commander

Research date: 2026-07-24 (Europe/Lisbon)

## Scope and method

This report compares [Commander](../skills/commander/SKILL.md) with seven popular
open-source systems that coordinate coding agents, plus one narrowly relevant
handoff micro-pattern. The shortlist favors systems with an
inspectable orchestration skill or workflow, not general-purpose agent SDKs.

All external claims below come from first-party repositories, source files,
documentation, or GitHub's repository API. Star counts are a dated popularity
signal, not evidence of quality. Source links are pinned to the repository HEAD
observed during this research; GitHub API links remain live and their counts
will drift.

Observed repository heads:

| Project | Commit inspected |
| --- | --- |
| Superpowers | `3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9` |
| Paperclip | `14f20be92b86a49ff2c35495e5b0fa4d719998ef` |
| Ruflo | `26c35b59b40a0a95b286ccf5ac675a15edcc995f` |
| GSD | `bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815` |
| BMAD Method | `bb45db4aa4496c69239f9c0629c290fd1b072fc9` |
| wshobson/agents | `c4b82b0ad771190355eb8e204b1329732a18449a` |
| Task Master | `c0c98d367c55296bfe69e65680625b6db437af02` |
| Cavecrew | `0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0` |

## Executive findings

Facts:

1. Commander's own source is structurally much thinner than every comparator.
   Its 56-line skill delegates durable work state to Beads and coordination
   mechanics to Orca, then adds only model-effort routing and Bead-first context
   discipline. That separation is unusual and worth preserving
   ([Commander](../skills/commander/SKILL.md)). It does **not** imply a small
   activated stack: the locally installed Commander + `orchestration` +
   `orca-cli` path measures about 11,977 `o200k_base` tokens if all three skill
   bodies are loaded.
2. The most concrete token-saving protocol is in Superpowers: pass agents file
   paths rather than bodies; generate task-scoped briefs and diff packages;
   make detailed reports file-backed; return fewer than 15 lines to the
   controller; and never append accumulated task history to later prompts
   ([SDD skill](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/SKILL.md),
   [implementer contract](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/implementer-prompt.md)).
3. GSD has the broadest explicit context-budget policy: read depth changes with
   context-window size and utilization, orchestrators pass paths at normal
   context sizes, workflow files have enforced size budgets, and a two-stage
   namespace router reduces the eager skill listing from a documented
   approximately 2,150 tokens to approximately 120
   ([architecture](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/docs/ARCHITECTURE.md),
   [context budget](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/references/context-budget.md)).
4. Paperclip is the closest full control-plane comparator. Its current skill
   uses compact inbox and heartbeat-context endpoints, comment deltas,
   task-session continuity, atomic checkout, explicit budget limits, and
   durable final dispositions rather than replaying whole task histories
   ([Paperclip skill](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/skills/paperclip/SKILL.md),
   [README](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/README.md)).
5. BMAD's current code-review workflow uses just-in-time step files, parallel
   configurable review layers, continued operation when one review layer
   fails, and centralized deduplication, severity assignment, and action
   routing
   ([review skill](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/SKILL.md),
   [review step](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/steps/step-02-review.md),
   [triage step](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/steps/step-03-triage.md)).
6. Multiple comparators treat file ownership and dependency shape as
   preconditions to safe parallelism. GSD disables parallel execution for a
   wave when declared file sets overlap; wshobson/agents specifies one owner
   per file and explicit interface contracts
   ([GSD execute-phase](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/workflows/execute-phase.md),
   [parallel feature development](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/agent-teams/skills/parallel-feature-development/SKILL.md)).
7. Cavecrew is a useful micro-pattern rather than a full orchestrator: its
   investigator, builder, and reviewer have rigid path-first receipts and
   terminal one-line refusal states. The repository's approximately 60% output
   reduction is an author claim; no committed benchmark result was found for
   that specific number
   ([Cavecrew skill](https://github.com/JuliusBrussee/caveman/blob/0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0/skills/cavecrew/SKILL.md),
   [builder](https://github.com/JuliusBrussee/caveman/blob/0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0/agents/cavecrew-builder.md)).
8. The main opportunity is not another planning methodology. It is reducing
   Commander's effective dependency load and adding small policy contracts for
   terse delivery receipts, deterministic resume reconciliation,
   controller-context thresholds, and cost-aware routing. Retry circuit
   breaking and brief task sweeps already exist in the installed Orca
   orchestration owner and should not be duplicated in Commander.

Recommendation:

Preserve Commander's thin architecture. Add a small number of policy-level
contracts to Commander, and put mechanism-level details in the existing owner
(Orca orchestration, Beads conventions, or a helper script). The highest-value
stack change is a narrower dependency-loading path. The highest-value
Commander-owned changes are a file-backed worker receipt contract plus resume
reconciliation; they directly reduce repeated context and prevent duplicate
dispatch after compaction.

## Popularity snapshot

GitHub stars observed 2026-07-24:

| Project | Stars | Why it is in the comparison |
| --- | ---: | --- |
| [obra/superpowers](https://github.com/obra/superpowers) | 260,263 | A directly comparable skill-driven controller that dispatches implementers and reviewers |
| [paperclipai/paperclip](https://github.com/paperclipai/paperclip) | 74,627 | A durable multi-agent control plane with atomic checkout, sessions, budgets, governance, and delta context |
| [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | 65,750 | A broad multi-agent orchestration, memory, topology, and routing platform |
| [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) | 64,779 | A file-backed, fresh-context, multi-agent software-delivery workflow |
| [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | 51,052 | A staged software-delivery method with skills, durable artifacts, tracking, and review gates |
| [wshobson/agents](https://github.com/wshobson/agents) | 38,189 | A large skill marketplace with explicit team-coordination and orchestration workflows |
| [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) | 27,894 | An adjacent durable AI task manager with dependencies, model roles, and verification fields |

Counts are from the first-party GitHub repository API:
[Superpowers](https://api.github.com/repos/obra/superpowers),
[Paperclip](https://api.github.com/repos/paperclipai/paperclip),
[Ruflo](https://api.github.com/repos/ruvnet/ruflo),
[GSD](https://api.github.com/repos/gsd-build/get-shit-done),
[BMAD](https://api.github.com/repos/bmad-code-org/BMAD-METHOD),
[wshobson/agents](https://api.github.com/repos/wshobson/agents), and
[Task Master](https://api.github.com/repos/eyaltoledano/claude-task-master).

The Cavecrew micro-pattern is also unusually popular: skills.sh showed 210.2K
deduplicated installs on the research date
([Cavecrew on skills.sh](https://www.skills.sh/juliusbrussee/caveman/cavecrew),
[install-count definition](https://www.skills.sh/docs/api)). Its parent
repository had 92,559 GitHub stars
([GitHub API](https://api.github.com/repos/JuliusBrussee/caveman)).

## Baseline: what Commander already does differently

Facts:

- Commander deliberately does not own a task database or coordination runtime.
  Beads owns outcomes, acceptance criteria, dependencies, claims, blockers,
  and completion; Orca owns tasks, dispatches, waits, questions, gates, and
  completion signals
  ([Commander lines 8-13](../skills/commander/SKILL.md)).
- It has a simple hierarchy: Commander normally dispatches Workers directly;
  Captains are introduced only when integrating several Workers is substantial;
  Workers never delegate
  ([Commander lines 15-23](../skills/commander/SKILL.md)).
- The Bead is the downstream contract. Dispatches carry the Bead ID and paths
  to authoritative sources instead of paraphrased project knowledge
  ([Commander context discipline](../skills/commander/SKILL.md)).
- Routing is more exact than in the comparators: three base roles plus
  specialists resolve to exact agent, model, and effort combinations through
  layered configuration
  ([Commander routing](../skills/commander/SKILL.md),
  [configuration](../skills/commander/references/configuration.md)).
- Acceptance is centralized: Commander alone compares delivery evidence with
  Bead acceptance criteria and mutates Beads
  ([Commander role](../skills/commander/SKILL.md)).

### Measured prompt footprint

The following local measurement uses `tiktoken`'s `o200k_base` encoding over
the Markdown sources installed on this machine. It is a source-size comparison,
not an API billing trace: runtimes may cache, progressively load, or omit some
skill bodies.

| Source | Words | Tokens |
| --- | ---: | ---: |
| Commander `SKILL.md` | 993 | 1,303 |
| Installed Orca `orchestration` `SKILL.md` | 3,193 | 5,232 |
| Installed `orca-cli` `SKILL.md` | 3,002 | 5,442 |
| Declared core path if all three load | 7,188 | 11,977 |
| Core plus Commander's setup-only references | 9,215 | 15,542 |

The current routing resolver also returned 398 tokens of formatted JSON for the
local four-route configuration; the routes alone were 117 tokens when selected
and compacted. Exact values vary with configuration, but the duplicated source
and layer metadata is avoidable on routine runs.

Commander's 55-token description is not a meaningful priority. The dependency
path is. The current thin core was also a deliberate recent change: commit
`d5bf667` removed Commander's duplicated delivery loop, boundary tables, and
operator boilerplate. Reintroducing that procedure would reverse the strongest
token-efficiency improvement already made in this repository.

Inference:

Commander likely has one of the lowest *intrinsic* prompt burdens in the
shortlist, but not necessarily the lowest effective burden once its declared
dependencies load. The next optimization should measure which dependency
bodies actually enter ordinary runs, then slim or defer them at their canonical
owners without copying their behavior into Commander.

## Comparator 1: Superpowers subagent-driven development

Popularity: 260,263 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/obra/superpowers)). Skills.sh
reported 155.0K installs for
[`subagent-driven-development`](https://www.skills.sh/obra/superpowers/subagent-driven-development)
and 143.9K for
[`dispatching-parallel-agents`](https://www.skills.sh/obra/superpowers/dispatching-parallel-agents)
on the same date.

### Facts

- The controller reads an implementation plan, dispatches a fresh implementer
  for each task, runs one task-scoped reviewer for both spec compliance and
  quality, and ends with a whole-branch review
  ([SDD control loop](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/SKILL.md)).
- Implementation tasks are serial to avoid conflicts. Fix rounds 1-3 resume
  the same implementer; rounds 4-5 use a fresh, more capable implementer; after
  five rounds the controller adjudicates residual findings and blocks only on
  load-bearing ones
  ([SDD process and fix loop](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/SKILL.md)).
- Every plan has a git-ignored workspace and progress ledger. On resume, the
  controller trusts the ledger and git history rather than conversation memory,
  avoiding re-dispatch of completed tasks after compaction
  ([SDD setup](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/SKILL.md)).
- Task requirements, implementer reports, and review diffs are passed as files.
  The implementer returns only status, commits, one test line, concerns, and
  the report path in fewer than 15 lines. The reviewer reads one generated diff
  package instead of re-reading changed files or re-running the whole suite
  ([implementer prompt](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/implementer-prompt.md),
  [reviewer prompt](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/task-reviewer-prompt.md)).
- Model selection accounts for task complexity and total turn count, not only
  per-token price. It explicitly warns that omitted model selection can inherit
  the controller's most expensive model
  ([SDD model selection](https://github.com/obra/superpowers/blob/3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9/skills/subagent-driven-development/SKILL.md)).

### Difference from Commander

Superpowers is a concrete implementation-plan executor; Commander is a standing
project manager. Commander has stronger durable task ownership and more exact
model-effort routing, while Superpowers has a substantially more precise
delivery receipt, recovery map, reviewer input package, and bounded failure
loop.

### Improvement signal

Adopt the artifact handoff and terse receipt pattern, not Superpowers' mandatory
per-task review volume. Commander can keep risk-based review while requiring a
uniform receipt that it can judge without pulling full worker transcripts into
its context.

## Comparator 2: Paperclip

Popularity: 74,627 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/paperclipai/paperclip)).

### Facts

- Paperclip is a server/UI control plane for heterogeneous agents. It owns
  goals, org structure, task checkout, heartbeat execution, budgets, approvals,
  sessions, workspaces, cost events, and audit trails rather than prescribing
  how an individual agent writes code
  ([README](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/README.md)).
- Task checkout and budget enforcement are atomic. Checkout returns `409` when
  another agent owns the task, and the skill forbids retrying that conflict.
  Runs are heartbeat-bounded and must leave a durable final disposition with a
  real continuation, review, blocker, or completion path
  ([Paperclip skill](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/skills/paperclip/SKILL.md)).
- The current skill has a scoped-wake fast path, compact `inbox-lite` and
  `heartbeat-context` reads, exact-comment and cursor-based comment delta
  fetches, and full-thread fallback only for cold starts or named need. Wake
  payloads can inline only the new comment batch
  ([heartbeat procedure](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/skills/paperclip/SKILL.md)).
- It persists task sessions across heartbeats, recovers orphaned runs, and
  preserves execution workspaces for follow-up tasks. Budget rules auto-pause
  at 100% and direct agents above 80% to critical work only
  ([README systems](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/README.md),
  [skill critical rules](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/skills/paperclip/SKILL.md)).
- Its token-optimization plan starts by correcting cumulative-versus-delta
  telemetry, then prioritizes safe session reuse, separating static bootstrap
  from dynamic wake context, delta APIs, controlled session rotation with a
  carry-forward summary, and per-agent skill allowlists. The plan defines
  outcome guardrails alongside token metrics
  ([token optimization plan](https://github.com/paperclipai/paperclip/blob/14f20be92b86a49ff2c35495e5b0fa4d719998ef/doc/plans/2026-03-13-TOKEN-OPTIMIZATION-PLAN.md)).

### Difference from Commander

Paperclip owns much of the combined Beads + Orca control-plane surface and is
designed for persistent autonomous operation across heterogeneous agents.
Commander has no server, heartbeat, budget ledger, or session service and is
far cheaper to adopt. Both emphasize identifiers and pointers, centralized
task ownership, and durable status. Paperclip is more operationally explicit
about atomic claims, delta context, session reuse, cost telemetry, and valid
waiting paths; Commander is stronger at exact model-effort routing and
acceptance against a concise Bead contract.

### Improvement signal

Paperclip provides the strongest evidence that token work should begin with
trustworthy per-run telemetry, not prompt shortening by intuition. Preserve a
Worker/Captain continuation handle when the runtime supports it, distinguish
static bootstrap from dynamic dispatch context, and fetch only state deltas on
resume. The implementation belongs in Orca/Beads; Commander needs only the
context and acceptance policy.

Do not recreate Paperclip's server, heartbeats, budgets, or governance in the
skill. If projects need that control plane, Paperclip is a product alternative,
not a pattern to hand-roll in Markdown.

## Comparator 3: GSD (Get Shit Done)

Popularity: 64,779 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/gsd-build/get-shit-done)).

### Facts

- GSD uses commands as entry points, thin workflow orchestrators, fresh-context
  specialist agents, a CLI/SDK query layer, and human-readable state under
  `.planning/`
  ([architecture](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/docs/ARCHITECTURE.md)).
- Context rules forbid reading agent definitions or inlining large files in
  subagent prompts. Below a 500k context window, orchestrators read only
  frontmatter/status/summaries; utilization tiers progressively restrict reads
  and call for checkpointing at 70% or more usage
  ([context budget](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/references/context-budget.md)).
- Its skill router exposes six short namespace skills instead of an eager list
  of 86 concrete skills, documented as approximately 120 tokens versus 2,150.
  Workflow source also has tested line budgets and moves mode-specific bodies,
  templates, and references behind just-in-time reads
  ([progressive disclosure](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/docs/ARCHITECTURE.md)).
- Execution groups plans into dependency waves. Plans in a wave run in parallel
  only when their declared `files_modified` sets do not overlap; overlap forces
  that wave to sequential execution
  ([execute-phase](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/workflows/execute-phase.md)).
- Before dispatch, it looks for production commits without a corresponding
  summary and stops to offer explicit recovery choices. It can also infer
  success from committed artifacts when a runtime drops an agent-completion
  signal
  ([execute-phase recovery](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/workflows/execute-phase.md)).
- Verification is goal-backward: truth, artifacts, wiring, tests. It explicitly
  rejects task completion as sufficient proof of phase-goal achievement
  ([verify-phase](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/workflows/verify-phase.md)).

### Difference from Commander

GSD owns its full lifecycle, artifact schema, state files, agents, and execution
mechanics. Commander instead composes Beads and Orca. Commander is much smaller
and less prescriptive, but its phrase "when its own thread grows long" is not an
operational budget, and it does not define how to reconcile dropped completion
signals or detect unsafe parallel overlap.

### Improvement signal

Add runtime-independent context thresholds and reconciliation invariants, but
keep GSD's 200k/500k numbers as implementation evidence rather than universal
Commander constants. If the harness exposes context utilization, Commander
should become progressively more artifact-only and checkpoint before emergency
compaction.

GSD's namespace router is not directly useful to Commander because Commander
fires only on explicit invocation. Its broader lesson is to keep eager
descriptions short and push conditional depth behind references, which
Commander already does.

## Comparator 4: BMAD Method

Popularity: 51,052 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/bmad-code-org/BMAD-METHOD)).

### Facts

- BMAD progressively produces analysis, planning, architecture, epic/story,
  implementation, and review artifacts. Each phase's documents inform the
  next; implementation centers on a focused story file and a shared
  `project-context.md`
  ([workflow map](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/docs/reference/workflow-map.md),
  [project context](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/docs/explanation/project-context.md)).
- Its newer multi-step skills use micro-files loaded one at a time. Steps are
  sequential, outputs are append-only, and document-producing flows can store
  completed steps in frontmatter
  ([implementation-readiness skill](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/3-solutioning/bmad-check-implementation-readiness/SKILL.md),
  [code-review skill](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/SKILL.md)).
- Sprint state is stored in `sprint-status.yaml`, and the status skill validates
  statuses, detects stale or orphaned work, and deterministically recommends
  the next workflow
  ([sprint-status skill](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-sprint-status/SKILL.md)).
- Code review runs configured review layers in parallel. A failed or empty
  layer is recorded while remaining layers continue. The controller then
  normalizes and deduplicates findings, reads the implicated code, assigns
  final severity itself, and routes findings to decision, patch, defer, or
  dismiss
  ([review execution](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/steps/step-02-review.md),
  [triage](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/steps/step-03-triage.md),
  [persistence and action](https://github.com/bmad-code-org/BMAD-METHOD/blob/bb45db4aa4496c69239f9c0629c290fd1b072fc9/src/bmm-skills/4-implementation/bmad-code-review/steps/step-04-present.md)).

### Difference from Commander

BMAD builds and owns a substantial document pipeline; Commander expects the
repository and Beads to hold the contract. BMAD's context is more curated but
also more duplicated. Commander already centralizes acceptance, but it does not
say how to combine conflicting or partially failed independent reviews.

### Improvement signal

Use BMAD's centralized review triage: reviewers report evidence, while
Commander assigns final consequence against the Bead and reports failed review
layers. Do not copy the full phase/document pipeline. Just-in-time step files
are useful only if Commander gains enough conditional behavior to justify a
reference; the current 56-line core does not need decomposition.

## Comparator 5: wshobson/agents

Popularity: 38,189 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/wshobson/agents)). Skills.sh
reported 6.8K installs for
[`team-composition-patterns`](https://www.skills.sh/wshobson/agents/team-composition-patterns)
and 4.7K weekly installs for
[`team-communication-protocols`](https://www.skills.sh/wshobson/agents/team-communication-protocols)
on the same date.

### Facts

- Its task-coordination skill recommends wide, shallow dependency graphs and
  requires each task description to state objective, owned files,
  requirements, interface contracts, acceptance criteria, and out-of-scope
  boundaries
  ([task coordination](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/agent-teams/skills/task-coordination-strategies/SKILL.md)).
- Its parallel-development skill has one cardinal rule: one owner per file.
  Shared files get a designated owner, other agents request changes, and
  stable interface-contract files allow parallel work without concurrent edits
  ([parallel feature development](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/agent-teams/skills/parallel-feature-development/SKILL.md)).
- Its communication skill prefers direct messages and reserves broadcasts for
  shared critical changes because each broadcast fans out to every teammate
  ([team communication](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/agent-teams/skills/team-communication-protocols/SKILL.md)).
- The full-stack orchestrator persists step outputs and `state.json`, can resume
  an in-progress workflow, halts on failure, and runs testing, security, and
  performance agents in parallel
  ([full-stack orchestrator](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/full-stack-orchestration/commands/full-stack-feature.md)).
- That same orchestrator repeatedly inserts complete prior artifact contents
  into later prompts. This is file-backed durability but not token-efficient
  handoff
  ([full-stack prompts](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/full-stack-orchestration/commands/full-stack-feature.md)).

### Difference from Commander

Commander already has stronger sources of truth for acceptance and coordination
but lacks explicit file ownership and interface boundaries. Its path-reference
rule is more token-efficient than wshobson/agents' full-content prompt
composition.

### Improvement signal

Before parallel dispatch, require enough ownership information to detect shared
writes and name the agent that owns integration seams. Add ownership to the
Bead convention or Orca task record, not as a second Commander-only task
schema. Preserve Commander's path-only prompts and do not copy full artifact
bodies into dispatches.

## Comparator 6: Ruflo

Popularity: 65,750 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/ruvnet/ruflo)).

### Facts

- Ruflo's task-orchestrator skill describes decomposition, dependency graphs,
  parallel/sequential/adaptive execution, progress tracking, result synthesis,
  dynamic replanning, and optional hierarchical sub-orchestrators
  ([task orchestrator](https://github.com/ruvnet/ruflo/blob/26c35b59b40a0a95b286ccf5ac675a15edcc995f/.agents/skills/agent-orchestrator-task/SKILL.md)).
- Its adaptive coordinator describes topology selection among hierarchical,
  mesh, ring, and hybrid patterns based on complexity, parallelizability,
  dependencies, and performance feedback
  ([adaptive coordinator](https://github.com/ruvnet/ruflo/blob/26c35b59b40a0a95b286ccf5ac675a15edcc995f/.agents/skills/agent-adaptive-coordinator/SKILL.md)).
- Its memory coordinator declares project, coordination, and learning
  namespaces plus compression, deduplication, indexing, and cleanup
  ([memory coordinator](https://github.com/ruvnet/ruflo/blob/26c35b59b40a0a95b286ccf5ac675a15edcc995f/.agents/skills/agent-memory-coordinator/SKILL.md)).
- Ruflo offers a lightweight plugin path and a much larger full CLI path with
  agents, commands, skills, MCP tools, hooks, memory, and a daemon
  ([README installation comparison](https://github.com/ruvnet/ruflo/blob/26c35b59b40a0a95b286ccf5ac675a15edcc995f/README.md)).

### Difference from Commander

Ruflo is an orchestration platform; Commander is a small policy layer over
systems already present. Ruflo exposes adaptive topology and persistent
retrieval that Commander does not, while Commander's explicit two-tier rule,
Bead contract, and exact model-effort routing are much easier to audit.

Several Ruflo skill files state capabilities or show pseudocode rather than
define a closed operational protocol. They are evidence of design surface, not
proof that each behavior improves delivery or token use.

### Improvement signal

Do not add vector memory or topology switching to Commander without measured
need. Beads and repository artifacts already provide durable, inspectable
memory. A bounded version of adaptive topology is useful: choose direct Workers
for independent tasks and a Captain only for a workstream with significant
integration, which Commander already does. Make that decision checkable with
dependency and file-overlap signals rather than adding more topologies.

## Comparator 7: Task Master

Popularity: 27,894 stars on 2026-07-24
([GitHub API](https://api.github.com/repos/eyaltoledano/claude-task-master)).

### Facts

- Task Master stores tasks with status, dependencies, priority, implementation
  details, test strategy, and subtasks. Its `next` operation chooses eligible
  work whose dependencies are satisfied
  ([task structure](https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/apps/docs/capabilities/task-structure.mdx)).
- It can analyze task complexity, recommend subtask counts, expand tasks, and
  update all future tasks after an implementation pivot
  ([task structure and expansion](https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/apps/docs/capabilities/task-structure.mdx),
  [workflow overview](https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/README-task-master.md)).
- Model configuration has main, research, and fallback roles rather than
  responsibility-tier plus specialist routing
  ([Task Master overview](https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/README-task-master.md)).
- Its agent rules explicitly recommend retrieving several known tasks in one
  multi-ID operation instead of one call per task
  ([Task Master rules](https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/.cursor/rules/taskmaster/taskmaster.mdc)).

### Difference from Commander

Task Master is closest to Beads, not Commander. It validates Commander's choice
to depend on a durable task owner instead of embedding task management in the
manager skill. Commander has stronger orchestration boundaries and routing;
Task Master has explicit complexity-driven decomposition and efficient batch
task retrieval.

### Improvement signal

Do not reproduce Task Master inside Commander. If Beads supports bounded
multi-item reads, use one selected-Bead query at run start/resume rather than
repeatedly fetching items one at a time or loading the entire project graph.
Treat complexity-driven expansion as a Captain-selection hint, not as an
automatic reason to create more subtasks.

## Core difference matrix

This compact matrix keeps the closest skill/workflow comparisons readable;
Paperclip has its own section, while the Cavecrew micro-pattern is summarized
in the executive and popularity notes above.

| Dimension | Commander | Superpowers | GSD | BMAD | wshobson/agents | Ruflo | Task Master |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Controller scope | Standing project manager | One implementation plan | Full project/phase workflow | Full staged method | Per-domain orchestrators and team skills | Full platform | Durable task service |
| Durable work state | Beads; Orca ledger | Plan workspace ledger + git | `.planning/` + git | Story files + sprint YAML + generated docs | Workflow state JSON + artifacts | Memory, task, and swarm services | Task JSON/files |
| Delegation shape | Worker; Captain when integration is substantial | Fresh serial implementer; reviewer; final reviewer | Fresh agents in dependency waves | Workflow-specific agents; parallel review layers | Parallel team with explicit file ownership | Multiple adaptive topologies | Does not itself provide a standing delivery-manager loop |
| Context strategy | Bead ID + paths; manager stays context-poor | Brief/report/diff files + terse receipts | Path-only prompts, read-depth tiers, JIT references | Progressive documents and JIT step files | Mixed: good task bounds, but full artifact insertion in some workflows | Memory retrieval and broad plugin surface | Per-task records; batched task retrieval |
| Verification | Commander judges evidence against Bead AC | Self-review, task review, scoped re-review, final review | Plan checks, goal-backward verification, tests, UAT | Readiness gate and parallel adversarial review | Domain-specific review agents | Specialized review/testing agents | Per-task `testStrategy` |
| Failure handling | Blocked work becomes named user decision; exact retry protocol delegated | Four statuses, changed retry, 5-round breaker | Recovery from commits/artifacts, fallback or abort choices | Failed review layers disclosed; remaining layers continue | Halt-on-failure in full-stack workflow | Adaptive replanning is declared | Status/dependency updates; no equivalent controller breaker |
| Routing | Exact agent + model + effort by role/specialist | Cost tier by task/review complexity | Per-agent model profiles | Current-session capability for review layers; configurable workflows | Static model tiers/agent profiles | Multi-provider/adaptive | Main/research/fallback |

## Recommendations for Commander

The recommendations below are design recommendations, not descriptions of
current Commander behavior.

### P0: measure and thin the declared dependency path

An ordinary Commander run currently names both `orchestration` and `orca-cli`
as required dependencies. On this machine, loading both beside Commander is
about 11,977 tokens before Beads, task specifications, repository context, or
worker results.

Trace one representative direct-Worker run and record which sections of each
dependency actually enter the model context. Then change the canonical
dependency owners so the common supervised path loads only its required core
and discloses worktree, terminal, browser, automation, and uncommon recovery
reference on demand. If `orchestration` is sufficient for the common path,
make `orca-cli` conditional; if it is not, split the needed `orca-cli` branch
behind a precise context pointer.

Do not copy those mechanics into Commander. The saving comes from progressive
disclosure at the source owner, not a shorter duplicate.

Completion criterion: a traced direct-Worker run loads one copy of every rule
it uses, omits unrelated Orca branches, and behaves identically on dispatch,
wait, completion, and recovery.

### P0: define one terse, file-backed delivery receipt

Add a policy such as:

> Every direct dispatch returns only status, commit or artifact identifiers, a
> one-line verification result, concerns, and paths to detailed evidence.
> Detailed logs and reports remain in worker-owned artifacts. Commander reads
> only the evidence needed to decide the Bead's acceptance criteria.

Use a small status vocabulary:

- `DONE`
- `DONE_WITH_CONCERNS`
- `NEEDS_CONTEXT`
- `BLOCKED`

Why: this is Superpowers' most transferable token-saving mechanism. It bounds
what remains resident in the manager thread and gives failure handling a typed
input. The report format belongs in the Orca orchestration contract if that
skill already owns dispatch payloads; Commander should state only the policy
and acceptance responsibility.

Completion criterion: every dispatch has one terse receipt and every cited
evidence path is readable; no acceptance decision requires importing the full
worker transcript.

### P0: make resume reconciliation deterministic

On start and resume:

1. Read the selected Bead set in one bounded operation.
2. Reconcile each Bead with only this run's Orca task/dispatch records.
3. Check delivered artifact or commit identifiers before re-dispatching work
   whose completion signal may have been lost.
4. Repair stale tracking or name a user decision; never use conversation memory
   as the completion authority.

Why: both Superpowers and GSD explicitly defend against the high-cost failure
where compaction or a missing signal causes completed work to run again.
Commander says it can restart from Beads, but not how Beads, Orca, and delivered
artifacts are reconciled.

Completion criterion: after a simulated context restart or missing worker-done
message, Commander identifies the same accepted, pending, and blocked Beads
without duplicate dispatch.

### P0: add a controller-context budget and checkpoint trigger

Recommended behavior when the runtime exposes context utilization:

- early run: normal bounded reads;
- middle of the window: frontmatter/status/receipts only;
- around two-thirds consumed: stop launching new work, reconcile state, write
  the checkpoint to Beads/Orca, and restart the Commander session;
- never paste full worker reports merely to summarize them.

The exact threshold should be tested in the target harness. GSD's 50-70%
degrading tier and 70% emergency checkpoint are useful starting evidence, not a
portable law.

Also audit eager tool and skill-schema overhead outside Commander. GSD
correctly notes that unused MCP schemas can dominate per-turn input cost
([context budget](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/references/context-budget.md)).
Commander should report such overhead if observable, not mutate human tool
configuration.

Completion criterion: a long run checkpoints before involuntary compaction and
resumes from durable state with no task-history replay.

### P1: gate parallel work on ownership and interfaces

Before parallel dispatch, require each concurrent Bead or Orca task to identify:

- owned files or directories when predictable;
- shared interface files and their single owner;
- upstream dependencies;
- the integrator for cross-worker seams.

If known write sets overlap, serialize the conflicting work or place it under
one Captain. This is a scheduling safety check, not a second task database.

Why: it prevents merge conflicts, repeated investigation, and integration
rework. Both GSD and wshobson/agents use this signal.

Completion criterion: no two concurrently dispatched Workers are expected to
write the same file unless a named integration protocol and owner exist.

### P1: make acceptance goal-backward and centralize review triage

For higher-risk Beads, derive the minimum evidence from the acceptance
criteria:

- observable truths;
- required artifacts;
- required wiring or integration;
- behavioral tests or other verification.

Independent reviewers should return findings and evidence, not final project
severity. Commander deduplicates the findings, assigns consequence against the
Bead, discloses failed review lanes, and decides accept, fix, defer, or ask.

Why: this combines GSD's goal-backward verification with BMAD's central triage
without paying for mandatory multi-review on every task.

Completion criterion: an artifact that exists but is stubbed, unwired, or not
proved by the required behavior cannot be accepted merely because its worker
reported completion.

### P1: optimize routing for expected total work

Keep exact configured routes, but choose among them by expected end-to-end
turns and correction risk, not by per-token price alone. A cheap model that
requires several retries can consume more tokens than a stronger model that
finishes once. Mechanical, integration-heavy, design, and risk-sensitive review
work are useful routing signals only when they map to configured routes; do not
invent an unconfigured model fallback.

Completion criterion: every dispatch records one exact configured route, and
route selection can be explained by the task's bounded complexity and risk
rather than model-name prestige or lowest nominal price.

### P1: reuse Orca's breaker and change retry conditions

Do not re-dispatch the same task with the same prompt and same route after a
blocker. Every retry must change at least one condition:

- add missing context;
- split the task;
- choose a more capable configured route;
- correct the Bead or acceptance criteria;
- request a named user decision.

The installed Orca orchestration skill already circuit-breaks after three
consecutive failures on one task. Keep that mechanism there. Commander only
needs the acceptance invariant that open load-bearing findings cannot loop
indefinitely or be silently accepted.

Completion criterion: repeated failure either changes the execution conditions
or becomes a named blocked decision; it never creates an unbounded identical
retry loop.

### P2: batch selected state reads

Resolve the run's explicit Bead set once, and batch task/status retrieval where
the underlying tools permit. Avoid both extremes: one API call per Bead and a
full-project dump. Task Master's multi-ID retrieval rule is the relevant
adjacent precedent.

Completion criterion: starting or resuming a run uses a bounded number of state
queries proportional to dependency layers, not one conversational turn per
task.

### P2: add a compact routine routing view

Keep the resolver's full layer and source output for setup and diagnosis. Add a
routine mode that emits only the selected route rows in compact JSON. In the
measured local configuration, this reduced the resolver result from 398 to 117
tokens.

Completion criterion: routine dispatch resolution exposes every selected
route's exact agent, model, effort, and specialist work description without
repeating layer provenance; setup and diagnostic modes still expose full
provenance.

## What not to import

- Do not reproduce Beads' task schema or Orca's coordination loop in Commander.
  That would violate the repo's single-source-of-truth rule and increase eager
  context.
- Do not require a BMAD/GSD-style full document lifecycle for ordinary work.
  Commander should consume repository artifacts that already exist.
- Do not make every Bead pay for implementer + multiple reviewers. Preserve
  Commander's risk-based independent review.
- Do not paste file bodies into dispatch prompts as wshobson/agents'
  full-stack workflow does. Commander's path-reference rule is better.
- Do not add vector memory while Beads, git, and repository artifacts can
  answer the same recovery question transparently.
- Do not add dynamic topology names. Direct Worker versus Captain already
  captures the useful distinction; make the choice evidence-based instead.
- Do not add a namespace router solely for Commander. Its explicit-only trigger
  already avoids broad automatic routing.

## Suggested ownership of changes

| Improvement | Canonical owner |
| --- | --- |
| Manager remains context-poor; acceptance responsibility; checkpoint trigger | Commander |
| Progressive disclosure of coordination, worktree, terminal, and recovery branches | Orca `orchestration` and `orca-cli` skills |
| Dispatch receipt schema; retry status and breaker; task/dispatch reconciliation mechanics | Orca `orchestration` skill |
| Work outcome, acceptance criteria, dependencies, accepted/blocked result | Beads |
| File ownership and interface metadata | Beads convention or Orca task record, whichever already owns task decomposition |
| Exact agent/model/effort selection | Commander routing |
| Compact routine resolver output | Commander `config.py` |
| Artifact generation, test commands, implementation details | Worker/Captain and repository |

This placement is as important as the individual rules. The most
token-efficient Commander is not the one with the shortest wording at any cost;
it is the one that states each policy once and points to a precise owner for the
mechanics.

## Proposed validation before editing Commander

1. Run one medium multi-Bead project with the current skill and capture:
   loaded skill/dependency bodies, manager input tokens by turn, number and size
   of dispatch prompts, worker result sizes, repeated file reads, compactions,
   and duplicate dispatches.
2. Slim only dependency branches proven unused in the common path; verify
   orchestration behavior is unchanged.
3. Add only the terse receipt and deterministic resume contract.
4. Repeat the same workload or a close fixture.
5. Compare:
   - manager input tokens;
   - total turns;
   - total worker turns;
   - compactions/restarts;
   - acceptance defects found after completion;
   - merge conflicts and repeated work.
6. Add context thresholds or overlap gates only when the trace shows the
   corresponding problem.

This staged test prevents adopting elaborate comparator machinery on reputation
alone and turns token efficiency into a measured property.
