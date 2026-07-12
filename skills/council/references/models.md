# Model CLIs — safe seat invocation

Read this file during setup, liveness probes, and council rounds. CLI flags change; re-read the installed CLI's `--help` and preserve every admission criterion below when adapting a recipe. A CLI without an equivalent safe mode does not get a seat.

## Detection

```bash
for cli in claude codex grok gemini opencode cursor-agent; do
  command -v "$cli" 2>/dev/null
done
```

Detection only resolves paths; it does not execute them. Show the provider and resolved absolute path to the user first. After approval, run `<absolute-path> --version`, then the seat recipe with `Reply with exactly: OK` from a private airlock. Save the approved absolute path in machine config and re-approve it if resolution changes.

## Admission criteria

A seat invocation must satisfy all of these:

1. It is one-shot: prompt text in, answer text on stdout, then exit.
2. Built-in tools, browser/search, MCP servers, subagents, hooks, plugins, project instructions, and memory are disabled; or an OS sandbox demonstrably exposes only the airlock.
3. Its working directory is the private airlock, never the project. The CLI gets no project path, extra directory, attachment, or inherited project session.
4. It uses normal permission enforcement. Force, auto-approve, YOLO, and permission-bypass modes are outside the council protocol.
5. It loads only the user's approved executable and model. The skill never installs, updates, downloads, or shares a session on its own.

Admission is complete when the installed version's help and liveness probe demonstrate all five criteria. If a criterion cannot be verified, omit that CLI and tell the user which criterion failed.

## Running seats

Create the airlock once per council and keep all paths absolute:

```bash
run_dir="$(mktemp -d "${TMPDIR:-/tmp}/council.XXXXXX")"
chmod 700 "$run_dir"
git -C "$run_dir" init -q
```

The empty Git repository lets repository-oriented CLIs start without a trust-bypass flag. Put the approved prompt in `$prompt_file`; redirect stdout to `$reply_file` from the moderator's shell. Both paths must be children of `$run_dir`. Run all seats of a round in parallel. Allow up to 10 minutes for high-effort seats, then apply the failure rule in `SKILL.md`.

The recipes below are safety baselines for versions exposing these flags. Validate model and effort values as plain IDs/enums before inserting them. If a flag is unavailable, substitute only a documented flag that preserves the admission criteria.

### claude (Claude Code — Anthropic models)

```bash
(
  cd "$run_dir" &&
  "$claude_path" -p --safe-mode --tools "" --disable-slash-commands \
    --no-session-persistence --no-chrome --model "$model" --effort "$effort" \
    < "$prompt_file"
) > "$reply_file"
```

`--safe-mode` removes customizations; `--tools ""` removes built-in tools. Keep both. Confirm supported model IDs and effort values with the installed CLI.

### codex (OpenAI models)

```bash
(
  cd "$run_dir" &&
  "$codex_path" exec --ephemeral --ignore-user-config --ignore-rules \
    -C "$run_dir" -s read-only \
    --disable shell_tool --disable unified_exec --disable apps \
    --disable browser_use --disable in_app_browser --disable computer_use \
    --disable hooks --disable plugins --disable memories \
    -m "$model" -c "model_reasoning_effort=\"$effort\"" - \
    < "$prompt_file"
) > "$reply_file"
```

Run `codex features list` first and disable every enabled execution, browser, app, hook, plugin, and memory feature exposed by that version. `-s read-only` is defense in depth, not a substitute for removing tools. The airlock's empty repository removes any need for a repository-check bypass.

### grok (xAI models)

```bash
"$grok_path" --prompt-file "$prompt_file" --cwd "$run_dir" --verbatim \
  --tools "" --disable-web-search --no-memory --no-subagents \
  --permission-mode plan --model "$model" > "$reply_file"
```

`--prompt-file` is the one-shot path for long briefs. Keep tool removal, web disablement, memory disablement, and plan permissions together. Map effort only when the installed version documents an effort flag.

### gemini (Google models)

```bash
(
  cd "$run_dir" &&
  "$gemini_path" -p "" -m "$model" --sandbox --approval-mode plan \
    --output-format text < "$prompt_file"
) > "$reply_file"
```

Admit Gemini only after verifying that the configured sandbox mounts the airlock alone and that no extension or MCP tool is active. Plan mode alone is read-only, not tool-free.

### CLIs without a verified boundary

At the time of writing, `opencode run --pure` disables external plugins but does not document a disable-all-tools mode, and `cursor-agent --print` documents access to write and shell tools. Omit them unless a newer installed version exposes a mode that meets every admission criterion. Provider diversity never overrides the safety gate.

## Choosing default models

Prefer each provider's flagship reasoning model at high effort where an effort knob exists. Confirm a model ID is real by running the liveness probe with it — a wrong ID fails fast. When unsure of the current flagship's ID, run the CLI with no `--model` flag: its default is usually a sane current model.
