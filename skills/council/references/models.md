# Model CLIs — detection and seat invocation

How to find which agent CLIs exist on this machine and spawn a council seat on each. CLIs change fast: if a flag below errors, run `<cli> --help` and adapt rather than giving up on the seat.

## Detection

```bash
for cli in claude codex grok gemini opencode cursor-agent; do
  command -v "$cli" >/dev/null && echo "$cli"
done
```

A CLI on PATH may still be unauthenticated or broken. Liveness probe — run the seat recipe with the prompt `Reply with exactly: OK` and a short timeout; a seat is live only if it answers.

## Running seats

Every recipe below is one-shot and headless: prompt in, plain text out, exits. Run all seats of a round **in parallel in the background**, each redirecting stdout to its own round file. High-effort seats can take several minutes — allow a generous timeout (10 min) before declaring a seat unresponsive. Pass long prompts via stdin or a temp file rather than fighting shell quoting.

### claude (Claude Code — Anthropic models)

```bash
claude -p --model claude-fable-5 --effort high "<prompt>" 
```

- Models: `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`.
- Effort: `--effort low|medium|high`.
- `-p` runs without permission prompts: reads work, mutations are denied — safe for a seat by default.

### codex (OpenAI models)

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -s read-only --skip-git-repo-check "<prompt>"
```

- Model via `-m`; reasoning effort via `-c model_reasoning_effort="minimal|low|medium|high"`.
- `-s read-only` sandboxes the seat; `-o <file>` can capture just the final message.

### grok (xAI models)

```bash
grok -p "<prompt>" --model <model-id>
```

- `-p/--single`: single-turn, prints to stdout, exits. `--prompt-file <path>` for long briefs.
- No reasoning-effort flag observed; effort requests for a grok seat map to model choice only.

### gemini (Google models)

```bash
gemini -p "<prompt>" -m <model-id> --approval-mode plan
```

- `--approval-mode plan` keeps the seat read-only. No effort flag.

### opencode (multi-provider)

```bash
opencode run -m <provider/model> "<prompt>"
```

- Model must be `provider/model` form (e.g. `anthropic/claude-sonnet-5`).

### cursor-agent (multi-provider)

```bash
cursor-agent -p --output-format text --model <model> "<prompt>"
```

## Choosing default models

Prefer each provider's flagship reasoning model at high effort where an effort knob exists. Confirm a model ID is real by running the liveness probe with it — a wrong ID fails fast. When unsure of the current flagship's ID, run the CLI with no `--model` flag: its default is usually a sane current model.
