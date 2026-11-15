# Run and transfer operations

`winremote-client --help` is the CLI authority. It uses the official MCP client
and the existing Codex/Claude `winremote` HTTP connection configuration. An
explicit `--config` JSON file can select another configured host. Credentials
stay in local configuration; do not put them in requests, logs or notifications.
The native tools are `RunSubmit`, `RunList`, `RunStatus`, `RunCancel`, `RunLog`,
`RunSnapshot`, `UploadBegin/Chunk/Finish` and `ArtifactInfo/Read`.

## Installation and maintenance

Read [setup and upgrades](setup.md) when installing, repairing or upgrading
either side. It gives the release, host setup, client connection and capability
checks. A missing capability is an installation failure, not permission to
improvise a launcher.

To restart the scheduled-task server remotely, run
`tools/restart-server-task.ps1` from the winremote-mcp repository, at the
installed release tag, through RunSubmit. Supply the exact task name, port and expected server command
fragment, and verify no unrelated work will be interrupted. It verifies
process identity, waits for the old listener to close and requires a new
listener. After reconnecting, verify RunList and a real owned command;
a scheduler restart receipt alone does not prove activation.

## Submit one bounded command

Write a JSON request file, then run `winremote-client submit <file>`. Example:

```json
{
  "command": ["C:\\tools\\python.exe", "tools\\check.py", "--out", "C:\\evidence\\run-17"],
  "cwd": "C:\\work\\checkout-17",
  "owner": "project/session",
  "request_id": "check-17",
  "timeout": 120,
  "queue_timeout": 600,
  "isolation": "shared",
  "workspace_access": "exclusive",
  "resources": {"path:C:\\evidence\\run-17": "exclusive"},
  "hidden": true
}
```

Use the executable reported by `RunList`'s machine metadata only when it is the
intended runtime; application-specific interpreters and pinned engines still
come from the project. `command` is argv, without shell quoting. A shell command
uses an explicit noninteractive shell executable as argv. The server also
suppresses interactive Git credential prompts for owned runs.

Cwd receives a path claim automatically. Additional `resources` map names to
`shared` or `exclusive`. All claims are acquired atomically. A whole-machine
exclusive request conflicts with every workload regardless of named resources.
Ordinary direct MCP operations also honor these barriers and fail with
`host_busy` rather than waiting invisibly. Use the run queue for work that
should wait; metadata/status/cancellation remain available.

```sh
winremote-client status <run-id>
winremote-client wait <run-id> --seconds 60
winremote-client log <run-id> --offset 0 --limit 8192
winremote-client cancel <run-id> --owner project/session
```

A wait that expires returns exit 3 with the still-active run; it does not cancel
or resubmit it. A terminal failure returns nonzero. `RunLog` uses byte offsets;
full stdout/stderr and the final JSON receipt remain in `output_dir`.
`cleanup_uncertain` retains resource claims until the process state is resolved.
Owner labels provide attribution, not authentication or permission to cancel
another person's work. Never infer ownership from a process name or start time.

## Fixed claims and resident sessions

The host-runs client and server have no supported operation to amend, release or
transfer a running run's resource claims. Claims remain held through execution
and uncertain cleanup; changing an existing owner/request ID's specification is
rejected rather than updating it. A resident run holding `desktop` exclusive
therefore still blocks another desktop claimant even when its process is idle.
Shared-machine isolation permits only compatible resources.

Inspect RunStatus/RunList and coordinate with the actual owner to establish
which phases need desktop interaction, which must preserve an uninterrupted
native session, and when claims can naturally release. Continue compatible
immutable reads and disjoint preparation; use the project's approved alternate
machine for eligible checks, or wait for the conflicting phase to finish. Keep
needed resources declared even when admitting concurrent diagnostics. Without
a supported change in place, preserve the resident test and report the exact
limitation; cancellation/restart needs the owner's authorization and must respect
session-continuity acceptance. Editing queue state, detaching owned children or
launching outside the queue is not a claim-release mechanism.

## Process custody

The worker survives client or MCP-server disconnection. On Windows a gated
child joins its Job Object before the command can start; worker death closes
the job. Recovery verifies absence before releasing claims. Local POSIX runs
use owned process groups. Deliberately escaping containment, external service
creation and unrelated user processes are outside a command's cleanup promise;
such work needs its own explicit lifecycle and resource declaration.

## Observe your own held run

A plain `Snapshot` or file read against a held claim fails with `host_busy`,
including your own run. `RunSubmit` returns a one-time `observer_token` for the
new run; only its digest is stored. Status, listings and request_id retries never
return it. Keep it private:

```sh
winremote-client submit request.json --observer-token-out ./evidence/run-17.observer
winremote-client snapshot <run-id> ./evidence/run-17-desktop.jpg \
  --observer-token-file ./evidence/run-17.observer
winremote-client log <run-id> --path 'C:\Users\me\AppData\Roaming\Godot\app_userdata\App\logs\godot.log' \
  --offset 0 --observer-token-file ./evidence/run-17.observer
```

The client never prints the token. Without `--observer-token-out` it is withheld,
and observation of that run is unavailable. Observation is read-only and only
while the run is `running` or `cleanup_uncertain`:

- `RunSnapshot` needs a `desktop` claim held by that run.
- A `RunLog` path must lie inside one of the run's path claims or its output
  directory, and is read as a growing file by byte offset.

The owning run and queued requests do not block the observation; any other held
conflicting claim still returns `host_busy`. Each admitted observation appends a
nonsecret receipt (time, run, machine, tool, bytes, SHA-256) to the run's
`observations.jsonl`. Capturing during a whole-machine exclusive measurement
perturbs it, so observe outside measured windows.

## Source and evidence

```sh
winremote-client upload ./source.bundle 'C:\staging\source.bundle'
winremote-client download 'C:\evidence\run-17\bundle.zip' ./evidence/run-17.zip
winremote-client stage ./repo --commit HEAD --base <known-host-commit> \
  --repository 'C:\cache\project.git' --checkout 'C:\work\checkout-17' \
  --owner project/session
```

`stage` creates a Git bundle locally, uploads it, then submits bundle verification,
fetch and a new detached worktree through the same queue. Omit `--base` for a
self-contained bundle; use it only when its prerequisite commit is already in
the host repository. The repository may be an existing host repository or a
new bare cache. A pre-existing destination checkout is refused. Inspect the
staging run's completion and source receipt before using the checkout.
Keep the returned run ID: rerunning `stage` creates a new bundle/submission,
and an existing destination is deliberately refused.

Upload/download stream chunks between files and MCP calls, resume partial
transfers and verify length plus SHA-256 before atomic publication. Repeating a
transfer to identical completed content is safe; different existing content is
refused. Use fresh artifact paths. On interruption repeat the same transfer;
on a hash failure retain the partial file and diagnose the changed/corrupt
input. Binary payloads never need to be copied or rewritten by the model.

## Local execution

`winremote-client --local submit/list/status/cancel/wait` uses the same contract
with this machine's queue and process supervision. It starts no remote server
and uses no substitute transport. Windows-specific acceptance remains on
Windows; local benchmark evidence remains a separate machine series.
