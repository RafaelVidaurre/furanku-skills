# Raw harness mechanism guide

Read this file when setup is evaluating direct harness commands or when the configured mechanism says to launch agent CLIs without a higher-level orchestrator.

Raw mode is a supervised job runner built from one-shot agent commands, isolated workspaces, operating-system processes, and Commander's private ledger. The examples below are discovery seeds. The installed CLI's current help and a live probe determine the actual command.

## Contents

- [Qualification](#qualification)
- [Current command seeds](#current-command-seeds)
- [Detached job directory](#detached-job-directory)
- [Non-blocking observation](#non-blocking-observation)
- [Follow-up and recovery](#follow-up-and-recovery)
- [Captain operation](#captain-operation)

## Qualification

Start with the machine's visible commands and extend the list from installed skills, project guidance, and the user's tools:

```sh
for cli in codex claude grok pi opencode gemini cursor-agent; do
  command -v "$cli" >/dev/null 2>&1 && printf '%s\n' "$cli"
done
```

For each candidate, inspect `<cli> --help`, its non-interactive subcommand, model listing if available, resume/session controls, permission controls, structured output, and version. Then run `Reply with exactly: OK` using the intended model and effort in a disposable read-only directory.

Raw mode qualifies only when a verified command can run headlessly, detach from Commander's turn, expose a stable PID or harness session, capture output and exit status, and be stopped. The Captain candidate must also be able to launch and observe child raw jobs in its own state namespace and allocated concurrency budget.

## Current command seeds

Adapt these only after checking the installed version:

| Harness | One-shot seed | Model and effort controls |
| --- | --- | --- |
| Codex | `codex exec -C <workspace> -s <qualified-sandbox> -o <report> -` | `-m <model> -c 'model_reasoning_effort="<effort>"'` |
| Claude Code | `claude -p --permission-mode <qualified-mode> <prompt>` | `--model <model> --effort <effort>` |
| Grok | `grok --prompt-file <brief> --permission-mode <qualified-mode>` | `--model <model> --reasoning-effort <effort>` |
| Pi | `pi -p <prompt>` from the workspace | `--model <model> --thinking <effort>` |
| OpenCode | `opencode run --dir <workspace> <prompt>` | `-m <provider/model> --variant <effort>` |

Give reviewers read-only or plan permissions. Give a Captain write access to its private coordination state and authority to launch and observe child jobs while keeping project deliverables read-only. Give a Sergeant the narrowest write and tool authority that can deliver its brief. When a harness cannot express a role boundary technically, isolate its workspace and record the enforcement gap during setup.

Use prompt files for long command packets. Shell-quote every path and argument, keep secrets out of command lines and logs, and run from the intended workspace so project instructions resolve correctly.

## Detached job directory

Give every dispatch its own private state directory:

```text
<state>/jobs/<job-id>/<dispatch-id>/
├── brief.md
├── pid
├── stdout.log
├── stderr.log
├── exit-code
└── report.md
```

Write `brief.md` before launch. The configured invocation or a verified post-exit extraction owns `report.md`; when the harness emits only a final answer on stdout, treat the completed stdout log as the report. Use a wrapper that writes `exit-code` only after the harness exits. A POSIX seed is:

```sh
job_dir=<absolute-private-job-directory>

nohup sh -c '
  dir=$1
  shift
  "$@" <"$dir/brief.md" >"$dir/stdout.log" 2>"$dir/stderr.log"
  code=$?
  printf "%s\n" "$code" >"$dir/exit-code.tmp"
  mv "$dir/exit-code.tmp" "$dir/exit-code"
' sh "$job_dir" <verified-harness-command> <verified-arguments...> \
  >/dev/null 2>&1 &

printf '%s\n' "$!" >"$job_dir/pid"
```

Treat this wrapper as a schematic: substitute an argument-safe invocation and account for harnesses whose prompt flag does not read stdin. Prefer a verified durable-agent or terminal/session interface when the environment provides one.

Record the job and PID or session in the ledger immediately. During qualification, prove that stopping this identity also stops every child process the harness creates; otherwise select a verified harness session or terminal/process-group manager. Return control after confirming the process survived startup long enough to create observable state; delivery continues in the background.

## Non-blocking observation

At interaction boundaries:

1. If `exit-code` exists, read it, the report, and bounded diagnostic tails; classify completion.
2. If no exit code exists, verify the recorded process or harness session is still alive.
3. If it is alive, compare output progress and leave the job running.
4. If it is gone, classify worker loss and preserve its workspace before continuation.

An old timestamp or quiet log is a reason to inspect, not proof of failure. Some high-effort jobs produce no output for long periods. A later Commander interaction or a verified completion notification performs the next reconciliation, keeping the user conversation available.

**Observation is complete when:** every inspected dispatch is classified from exit, process, session, or output evidence and has a recorded next action.

Structured harness output may provide stronger signals than logs. Prefer explicit authentication, model-not-found, quota, rate-limit, permission, and terminal completion events. Keep the raw evidence path in the job ledger.

## Follow-up and recovery

Use a verified resume or session command when it preserves the same worker context and workspace. Otherwise create a new dispatch directory and a continuation brief containing the prior report, relevant diagnostic tail, decisions, and current workspace state.

Before replacing a modifying process, prove the old process is gone or stop it through its harness/session interface. A PID is safe to signal only after its current command and job ownership have been verified. Record the stop result, then give the replacement exclusive ownership.

Candidate failures may fall through to another configured model/harness candidate inside raw mode. Exhaustion of raw candidates blocks the job.

## Captain operation

Run a Captain as its own detached raw job. Its command packet includes:

- the raw mechanism guide or equivalent configured instructions;
- the parent job and dispatch IDs;
- the private child-state directory it may write;
- its allocated concurrency slots;
- the configured Sergeant candidates;
- the concrete channel or file through which it reports to Commander.

The Captain launches child jobs in namespaced dispatch directories, observes them inside its own background process, and emits one consolidated completion report. Commander reserves the Captain's slots and monitors its report rather than writing the Captain's child state or taking over live children. If the Captain is lost, Commander inventories every child PID/session and workspace before appointing a replacement Captain.
