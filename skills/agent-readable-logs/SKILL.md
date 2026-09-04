---
name: agent-readable-logs
description: Establish, audit, and maintain logging that coding agents can retrieve through documented bounded commands - one stable retrieval interface per emitter, one parseable event per line with correlation fields, actionable failure summaries from project-owned scripts, and a scoped Logs block in the agent instruction file. Use when the user asks to make application, test-runner, or script logs agent-readable, or to audit a project's log accessibility and shape; and, in a project whose instruction file already carries a Logs block, when a change adds an emitter, edits a log call site, or swaps a logging library or destination.
license: MIT
compatibility: The bundled validator requires Python 3. Retrieval commands are adapted to the project's operating environment and available tools.
metadata:
  author: rafaelvidaurre
---

# Agent-Readable Logs

Every emitter gets one stable interface the agent can read in a bounded window. The agent never prints a whole log; it reads a tail, a filtered slice, or a summary. Project specifics (language, library, destinations, commands) live in the project; this skill fixes the record shape and the procedure.

Pick the branch first. A `## Logs` block in the project's canonical agent instruction file (`AGENTS.md` or the file the project's agents read) means the contract is adopted: use **Maintain**. Otherwise use **Set up**. An audit request runs the Maintain full pass.

The record shape lives in [references/log-shape.md](references/log-shape.md). Read it before changing any emitter or log call site, in either branch.

## Set up

### 1. Survey the emitters

Search executable entrypoints, task and package configuration, service manifests, test configuration, and CI configuration for anything that writes logs: servers, workers, scripts, test runners, CI jobs. For each, record today's destination (stdout, file, journal, platform log, collector, CI service), format, and how it is read now.

**Complete when:** every emitter found in those locations is listed with destination, format, and current read path, and each intentionally excluded emitter is named with the reason.

### 2. Give each emitter a stable retrieval interface

Keep an existing destination when a bounded command can read it (`journalctl -u <unit> -n 100`, `kubectl logs --tail=100`, a platform or collector query, the runner's own report file). For a local process with no such interface, use a fixed gitignored file, `logs/<emitter>.log` at the repository root by default, or the project's existing fixed-path convention.

Preserve each runner's supported output and exit semantics: prefer its native output-file or report option; use redirection or `tee` only after checking exit status, CI annotations, and the human-facing summary still work. When concurrent runs are possible, use a run-specific destination plus a stable pointer to the current run; never truncate a path another process may be writing.

**Complete when:** each surveyed emitter has a destination and a tested bounded read command, and one probe event from each controllable emitter was retrieved through that command.

### 3. Apply the record shape

Configure the project's existing logging library to emit the shape in the reference (JSON formatter, structured handler, or equivalent). Write a custom formatter only when no library option produces it. Map existing field names and levels deliberately; record any mapping in the Logs block.

Validate a non-empty sample from every emitter, using absolute paths for both the installed skill and the sample:

```sh
python3 <skill-dir>/scripts/check_log_shape.py <project>/logs/dev.log <project>/logs/test.log
```

The validator enforces encoding, required fields, timestamp, level, key grammar, flat scalar attributes, trace-id rules, and a secret-key heuristic. It does not check correlation coverage, severity choice, message stability, or redaction of values inside messages; confirm those by reading the same samples.

**Complete when:** the validator exits 0 on a non-empty sample per emitter, and the manual checks (correlation carried across a unit of work, severities match impact, no secret values in `msg`) pass on those samples.

### 4. Make project-owned scripts fail readably

For wrappers and scripts the project owns: exit non-zero on failure, exit 0 for "nothing to do", and print as the final lines the failed operation, the reason, and the next safe action, with no credentials echoed. Third-party tools keep their documented exit conventions; note benign non-zero statuses in the Logs block when the agent must tell them apart.

**Complete when:** each modified script has a safe automated test or non-destructive forced-failure probe showing a non-zero status and that terminal summary, and any failure path that cannot be exercised safely is recorded as such.

### 5. Publish the Logs block

Fill [assets/agents-md-entry.md](assets/agents-md-entry.md) from the survey and merge it into the canonical instruction file with the narrowest scope covering the emitters (root file, or a package's file in a monorepo). Delete placeholder lines that do not apply. Keep the block under ten lines and keep the rules in one place: other sections of the file point here rather than repeating them.

Bounded reads are the only reads: `tail`, `grep` or `jq` with a filter, a platform query with a line limit. When a supported harness has an output cap and a bounded diagnostic still truncates evidence, document a command-specific limit adjustment in that harness's own configuration rather than widening reads.

**Complete when:** every local read command in the block ran against a sample, every long-running or verbose command passed a bounded smoke check, remote commands (CI) are syntax-checked with their prerequisite stated, and the file has one Logs block.

### 6. Agent-session records, only if asked

When the request also covers the agent's own transcripts or run output: session transcripts, history, and telemetry stay machine-local or become retained CI artifacts with a retention period; a durable decision record is a reviewed artifact (the `decision-trail` skill covers that). Committed project configuration, rules, hooks, and skills stay in git.

**Complete when:** no raw transcript, history, telemetry export, or tool local-state file is tracked by git.

## Maintain

Each event below names its check. Apply the checks for every event the current change triggers; an audit applies all of them to the whole project.

- **New emitter** (service, worker, script, test runner, CI job): run steps 1 to 3 for it and add its line to the Logs block. Complete when its sample validates and its read command is in the block.
- **Log call site added or edited**: the line follows the shape (short stable `msg`, values in attributes, severity from impact, correlation field carried, no secret values). Complete when a sample containing the new line validates.
- **Logging library, formatter, or destination changed**: re-validate a sample from every affected emitter and re-run every affected read command. Complete when both pass and the Logs block names the current destination and commands.
- **Contract violation seen while reading a log** (free text, missing field, unbounded read, secret value): fix the emitter in the same change, or file an issue naming the emitter and the violation. Complete when one of the two is done and stated in the handoff.
- **Logs block drift** (a command fails, a path moved, a variable renamed): fix the block. Complete when every command in it runs again.

Make the drift gate automatic: copy `scripts/check_log_shape.py` (single file, standard library only) into the project's tooling directory and run it in the test or CI step over the sample logs the test run produces, so a violating emitter fails the build. Record the skill version copied so it can be refreshed.

**Complete when:** the validator runs in the project's own test or CI step over real samples, and the emitter inventory, read commands, and Logs block match the current code.
