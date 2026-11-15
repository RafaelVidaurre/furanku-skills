---
name: winremote-host-runs
description: Run project workloads and transfer artifacts through winremote MCP with durable ownership and conflict-aware concurrency. Use for Windows-host tests, builds, imports, captures and benchmarks, coordinating local runs, or setting up, connecting and upgrading the host-runs winremote server and client.
---

# Owned host runs

Use winremote's durable run queue and file-oriented MCP client. Project commands
remain responsible for application startup, test selection and acceptance.

This skill requires the host-runs build of winremote on the Windows host and
the matching `winremote-client` on the agent machine; upstream releases lack its
queue, owned jobs and verified transfers. To set up a host, connect an agent
machine, repair or upgrade, read [setup and upgrades](references/setup.md).

## Choose the workload and its conflicts

Read the project's run catalog and evidence requirements, then inspect
`winremote-client list` (native MCP: `RunList`). This metadata call is available
during exclusive work; a Shell probe is a workload and needs admission.
If the client or required MCP capability is unavailable, report the actual
failure. Keep the real winremote transport; do not substitute SSH, HTTP file
servers or another remote route.

Read [operations](references/operations.md) before the first submission or
artifact transfer. It contains the request contract, installation discovery,
source staging and recovery procedures.

Declare the resources the command actually shares or changes:

| Situation | Admission |
|---|---|
| Independent workspaces, outputs and application state | Concurrent shared-machine runs |
| Resident CLI/TUI waiting with negligible load and no desktop interaction | Shared-machine run; claim its actual paths, ports and application state |
| Several readers of immutable state | Shared claim on that resource |
| Shared checkout/cache writes, fixed outputs, port, desktop input or device settings | Exclusive claim on the affected resource |
| A measurement or operation requires a quiet whole machine | `isolation: exclusive` |

Resource names describe the real shared object, identically across projects.
Use `path:<absolute path>` for files/directories, `port:tcp:<number>` for a
port, `desktop` for interactive desktop ownership, and an agreed device or
application-state name where paths do not express the conflict. Path claims
cover descendants. Separate checkouts alone do not isolate application data,
ports or device state. Retain exclusive workspace access unless the command
is known to leave that workspace immutable and writes to isolated outputs.

Desktop ownership follows interaction: focus changes, desktop keyboard/mouse input,
window management or desktop-dependent capture/automation require `desktop`
exclusive. A resident terminal's existence alone does not require that claim.
Plan bounded desktop phases separately from resident waits when the application's
supported lifecycle permits it; preserve continuous native sessions when required.
A visible game run may own `desktop` alongside a resident CLI that leaves focus
and input alone and has disjoint claims. Hidden execution does not release an
explicit desktop claim. For an existing overbroad reservation, use
[fixed-claim coordination](references/operations.md#fixed-claims-and-resident-sessions).

The queue admits compatible work concurrently. Older conflicting requests
prevent starvation; disjoint requests may proceed. A queued whole-machine
exclusive request lets earlier work drain and holds later workloads. Agents
submit their request once; another agent's terminal does not grant execution.
If a project permits another machine when a conflicting host is unavailable,
use its approved route and record the actual machine.

## Run and accept evidence

1. Stage the intended source with the client, or verify an existing exact
   checkout. Use the project's independently established runtime and dependency
   identities. Preparation also declares the resources it changes.
2. Submit the project command as argv with project/session owner, stable request
   ID, execution deadline, queue deadline and resource claims. Use hidden
   execution for agent-driven graphical work unless the user requested a
   visible window. Preserve the returned run ID.
3. Use bounded status/wait calls. A disconnected client does not lose the run;
   inspect that ID or reuse the identical owner/request ID before retrying.
   Cancel by owned run ID. A cancellation request is not a cleanup receipt.
4. Require terminal state, `cleanup: complete`, expected counts/artifacts and
   the project's own log/semantic checks. The generic exit code proves process
   completion, not application correctness. Validate hidden-window behavior and
   meaningful capture dimensions/content when the project requires rendered
   evidence. Preserve interrupted evidence as incomplete.
5. Transfer artifacts with `winremote-client upload/download`; the client moves
   exact bytes over native MCP tools and verifies hashes. Keep the complete
   host evidence directory. Reuse accepted evidence when its inputs remain valid.

## Machine-scoped measurements

Choose admission from the measurement's required conditions:

- Quiet-host acceptance and benchmarks whose contract requires whole-machine
  isolation use `isolation: exclusive`. A negligible resident run still blocks
  that admission until it completes and releases its claims.
- When the user or project explicitly permits measurement alongside negligible
  resident work, use `isolation: shared` with the measurement's actual resource
  claims. Label the evidence as a concurrent diagnostic measurement, identify
  the resident work and permission, and validate its load before and during the
  measured window. Include CPU/GPU, I/O and input interference relevant to the
  workload, including update/automation bursts. Record the observed load and any
  agreed interference bound; if load is unverified or exceeds that bound, report
  the limitation and obtain a valid measurement before accepting the result.
  Co-residency permission does not override conflicting resource claims or an
  explicit quiet-host requirement. Diagnostic evidence alone establishes neither
  quiet-host acceptance nor a causal speedup.

Record the run's `machine.id`, hardware/runtime, workload/source, renderer,
resolution, power mode and relevant host load with every measurement. Baseline
and candidate must use the same machine and matched conditions, including
co-resident activity, before making a speedup/regression claim. Results from
different machines are separate series; label cross-machine comparisons
explicitly when they are the question.

The queue controls participating agent workloads, not unrelated user programs
or operating-system activity. Inspect the benchmark's load/validity evidence;
exclusivity alone does not certify a quiet measurement. Use
`winremote-client --local` for this machine's separate run queue and identity.
