# Known models

Read this file when Commander setup, editing, or a current-run override identifies a model or effort in human terms. This is a dated shortcut around routine live catalog queries, not proof of account entitlement.

Snapshot: 2026-07-16, from Codex CLI 0.144.4, Claude Code 2.1.210, Grok CLI 0.2.101, and the providers' first-party documentation listed below.

## Resolve a request

1. Build the candidate-agent set. An explicit provider or agent is a hard filter. Otherwise consider installed agents from the tables below; an exact listed model ID, display name, or alias may narrow that set. Descriptive fit supports a recommendation only and never resolves model identity without user confirmation. **Complete when:** the request has a bounded installed-agent set or needs a named provider choice.
2. Within that set, compare case-insensitively after removing spaces, `_`, and `-`, while retaining every version, family, tier, and context token. Match only exact IDs, display names, or aliases in the tables below; use no edit distance or substring winner. **Complete when:** the bundled catalog produces zero, one, or multiple explicit agent-model candidates.
3. Normalize an effort only with these rules: `light` -> `low`; `extra high`, `extra-high`, or `x-high` -> `xhigh`; `maximum` -> `max`. Keep `ultra` literal. Terms such as `standard`, `balanced`, `highest`, `auto`, `deep`, and `ultracode` do not identify a portable effort. **Complete when:** the request contains one exact supported effort or still needs discovery or user choice.
4. Accept a bundled result only when exactly one model wins and the exact effort is in that model's list. Label its evidence `bundled-known`; checking the candidate executable with `command -v` is enough. **Complete when:** the configuration contains the table's exact `agent`, model ID, and effort.
5. Run **Machine discovery** when no model wins, multiple models win, a requested effort is absent from the row, the user asks for dynamic machine state, or live CLI evidence is newer and contradictory. Label a unique live result `machine-discovered`; label exact strings supplied by the user after an unresolved zero-turn probe `user-attested`. **Complete when:** discovery yields one exact compatible combination or identifies the unresolved decision.

When setup must recommend an omitted effort, use the role guidance in [Configuration](configuration.md) and check it against the chosen row. Use a provider default only when the user asks for that default. A bundled-known result may still fail because of account availability; report that launch failure and obtain approval before changing the combination.

## Codex

Use `agent: codex`.

| Exact model | Human matches | Default | Efforts | Provider-described fit |
| --- | --- | --- | --- | --- |
| `gpt-5.6-sol` | Sol; 5.6 Sol; GPT 5.6 Sol | `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | Complex, open-ended, high-value work where detail and polish matter |
| `gpt-5.6-terra` | Terra; 5.6 Terra; GPT 5.6 Terra | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | Pragmatic everyday all-rounder |
| `gpt-5.6-luna` | Luna; 5.6 Luna; GPT 5.6 Luna | `medium` | `low`, `medium`, `high`, `xhigh`, `max` | Clear, repeatable, high-volume work; fastest and lowest-cost current recommendation |
| `gpt-5.5` | GPT 5.5; 5.5 | `medium` | `low`, `medium`, `high`, `xhigh` | Frontier model for complex work |
| `gpt-5.4` | GPT 5.4; 5.4 | `medium` | `low`, `medium`, `high`, `xhigh` | Strong everyday model |
| `gpt-5.4-mini` | GPT 5.4 Mini; 5.4 Mini | `medium` | `low`, `medium`, `high`, `xhigh` | Small, fast, cost-efficient model |
| `gpt-5.3-codex-spark` | GPT 5.3 Codex Spark; Codex Spark; Spark | `high` | `low`, `medium`, `high`, `xhigh` | Ultra-fast coding model |

Bare `GPT 5.6` does not choose Sol, Terra, or Luna. `Power` is a changing preset, not a model alias. `Ultra` authorizes Codex subagent delegation only when that behavior also fits Commander's role boundary.

## Claude Code

Use `agent: claude`.

| Exact model | Human matches | Efforts |
| --- | --- | --- |
| `claude-fable-5` | Claude Fable 5; Fable 5 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-8` | Claude Opus 4.8; Opus 4.8 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-sonnet-5` | Claude Sonnet 5; Sonnet 5 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-7` | Claude Opus 4.7; Opus 4.7 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-6` | Claude Opus 4.6; Opus 4.6 | `low`, `medium`, `high`, `max` |
| `claude-opus-4-5-20251101` | Claude Opus 4.5; Opus 4.5 | `low`, `medium`, `high` |
| `claude-sonnet-4-6` | Claude Sonnet 4.6; Sonnet 4.6 | `low`, `medium`, `high`, `max` |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5; Sonnet 4.5 | none; not routable while effort is required |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5; Haiku 4.5 | none; not routable while effort is required |

The installed moving selectors are `fable`, `opus`, `sonnet`, `haiku`, `best`, and `default`. The installed context selectors are exactly `fable[1m]`, `opus[1m]`, and `sonnet[1m]`; `opusplan` is a hybrid. Preserve one of those exact strings only when the user asks for moving, account-default, extended-context, or hybrid semantics, then use machine discovery because its target and effort compatibility can change. `Claude 5` and `Claude 4.5` are ambiguous.

## Grok

Use `agent: grok`.

| Exact model | Human matches | Default | Efforts |
| --- | --- | --- | --- |
| `grok-4.5` | Grok 4.5 | `high` | `low`, `medium`, `high` |
| `grok-composer-2.5-fast` | Composer 2.5 | none | none; not routable while effort is required |

Bare `Grok Build`, `Composer`, and `fast` require discovery. The API aliases `grok-4.5-latest` and `grok-build-latest` are not installed CLI model IDs. Generic effort words accepted by the CLI parser are not evidence that a listed model supports them.

## Machine discovery

Query only the requested or candidate agent and keep the probe to help or catalog operations that perform no model turn.

### Codex

```sh
command -v codex
codex debug models
```

When `jq` is installed, keep the result compact:

```sh
codex debug models | jq '{models: [.models[] | select(.visibility == "list") | {slug, display_name, default_reasoning_level, efforts: [.supported_reasoning_levels[].effort]}]}'
```

**Complete when:** one picker-visible model and one of its reported efforts satisfy the request.

### Claude Code

```sh
command -v claude
claude --help
claude -p "/model" --output-format json --no-session-persistence
```

Resolve a candidate with zero-turn `/model <candidate>` and compare the returned identity with the request because deprecated IDs may be remapped. The global `--effort` vocabulary is not model-specific evidence; intersect the identity with current first-party model compatibility. **Complete when:** the returned identity and a model-supported effort form one exact combination.

### Grok

```sh
command -v grok
grok models
```

After `grok models` refreshes the first-party cache, inspect `models_cache.json` under the Grok home directory. Use only `id`, `name`, `supports_reasoning_effort`, `reasoning_effort`, and `reasoning_efforts`; this cache shape is observed behavior, so a changed or absent shape leaves discovery unresolved. **Complete when:** one listed ID has an explicitly reported compatible effort.

### Another agent

Inspect the installed executable's help and non-interactive catalog equivalent. If it cannot expose a model-specific effort vocabulary without a model turn, ask the user to attest the exact strings. **Complete when:** one combination is machine-discovered or user-attested, or the missing choice is named.

Machine discovery never invokes a model or enters authentication, subscription, usage, quota, credit, account, or billing controls.

## Sources

- OpenAI: [Codex models](https://learn.chatgpt.com/docs/models)
- Anthropic: [Claude Code model configuration](https://code.claude.com/docs/en/model-config), [model overview](https://platform.claude.com/docs/en/about-claude/models/overview), and [effort compatibility](https://platform.claude.com/docs/en/build-with-claude/effort)
- xAI: [Grok CLI reference](https://docs.x.ai/build/cli/reference), [Grok 4.5](https://docs.x.ai/developers/models/grok-4.5), and [reasoning effort](https://docs.x.ai/developers/model-capabilities/text/reasoning)
