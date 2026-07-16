# Commander model-catalog research

Research date: 2026-07-16 (Europe/Lisbon)

This is a dated evidence artifact. The maintained operational catalog and resolution rules live in `skills/commander/references/models.md`.

Scope: exact model and effort strings that Commander can pass to the locally
installed Codex, Claude Code, and Grok CLI harnesses. This report separates:

- **catalog-backed IDs**: listed or accepted by the installed first-party CLI;
- **provider aliases**: valid harness strings whose target can change;
- **display-name matches**: conservative natural-language normalization rules;
- **inference**: deliberately excluded from the bundled catalog.

The local commands below performed no model turns. Claude's probes reported
`num_turns: 0`, `duration_api_ms: 0`, and `total_cost_usd: 0`.

## Implementation conclusion

Bundle a dated catalog of verified **model-effort intersections**, not separate
model and effort lists. Normalize only case, punctuation, spacing, provider
prefixes, and the explicit aliases below. If a request does not resolve to one
catalog entry, query the installed CLI; do not use nearest-name guessing and do
not run a paid model turn as a probe.

Every bundled record should carry at least:

```text
agent, model, display_name, aliases[], efforts[], default_effort,
model_kind = pinned | moving-alias | hybrid, observed_at, source
```

An empty `efforts` list is meaningful. Commander currently requires a non-null
`effort`, so such a model is not a valid route until the schema can omit effort
or the harness exposes a proven sentinel.

## Codex CLI

Local evidence, observed 2026-07-16:

```sh
codex --version
# codex-cli 0.144.4

codex debug models | jq -r \
  '.models[] | [.slug, .display_name, .visibility,
  .default_reasoning_level,
  ([.supported_reasoning_levels[].effort] | join(","))] | @tsv'
```

`codex debug models` is the first-party machine catalog. OpenAI's current
[Codex model guide](https://learn.chatgpt.com/docs/models) independently names
the current recommended models and explains the user-facing reasoning labels.
Both sources were accessed 2026-07-16.

### Catalog-backed combinations

| Exact model | Display name | Default | Verified efforts |
| --- | --- | --- | --- |
| `gpt-5.6-sol` | GPT-5.6-Sol | `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-terra` | GPT-5.6-Terra | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-luna` | GPT-5.6-Luna | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `gpt-5.5` | GPT-5.5 | `medium` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.4` | GPT-5.4 | `medium` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.4-mini` | GPT-5.4-Mini | `medium` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.3-codex-spark` | GPT-5.3-Codex-Spark | `high` | `low`, `medium`, `high`, `xhigh` |

The live catalog also contains hidden `codex-auto-review`. Exclude it from the
general Commander catalog: it is not picker-visible and the catalog does not
establish it as a normal dispatch model.

### Safe Codex name normalization

Within `agent = codex`, these matches are unambiguous:

| User wording | Exact model |
| --- | --- |
| Sol, 5.6 Sol, GPT 5.6 Sol, GPT-5.6-Sol | `gpt-5.6-sol` |
| Terra, 5.6 Terra, GPT 5.6 Terra | `gpt-5.6-terra` |
| Luna, 5.6 Luna, GPT 5.6 Luna | `gpt-5.6-luna` |
| GPT 5.5, 5.5 | `gpt-5.5` |
| GPT 5.4, 5.4 | `gpt-5.4` |
| GPT 5.4 Mini, 5.4 Mini | `gpt-5.4-mini` |
| GPT 5.3 Codex Spark, Codex Spark, Spark | `gpt-5.3-codex-spark` |

OpenAI documents `codex --model gpt-5.6`, but this installation does not list
`gpt-5.6` in `codex debug models`. Treat bare “GPT 5.6” as a documented family
string that triggers live discovery; do not silently rewrite it to Sol, Terra,
or Luna.

Effort normalization is safe for `light` -> `low` and `extra high`, `extra-high`,
or `x-high` -> `xhigh`; the [official guide](https://learn.chatgpt.com/docs/models#pick-a-reasoning-effort)
explicitly equates UI **Light** with CLI **Low**. Map “maximum” to `max` only
when the selected model supports it. Require the word “ultra” explicitly:
OpenAI documents Ultra as automatic subagent delegation, not merely a stronger
single-agent reasoning level. That behavior must also satisfy Commander's role
delegation rules.

The current **Power** preset is Sol at medium effort according to the official
guide. Record it as dated preset metadata rather than a permanent alias.
“Faster,” “Smarter,” and “highest” do not identify exact combinations.

## Claude Code

Local evidence, observed 2026-07-16:

```sh
claude --version
# 2.1.210 (Claude Code)

claude --help
# --model accepts an alias or full model name
# --effort accepts low, medium, high, xhigh, max

claude -p "/model" --output-format json --no-session-persistence
# aliases: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m],
#          fable[1m], opusplan, default
```

Each exact ID below was also checked with zero-turn `/model <id>`. An invalid
control returned `Model 'claude-doesnotexist-99' not found`.

The authoritative public sources are Anthropic's [model overview](https://platform.claude.com/docs/en/about-claude/models/overview),
[effort compatibility table](https://platform.claude.com/docs/en/build-with-claude/effort),
[Claude Code model configuration](https://code.claude.com/docs/en/model-config),
and [model lifecycle table](https://platform.claude.com/docs/en/about-claude/model-deprecations),
all accessed 2026-07-16.

### Catalog-backed combinations

| Exact model | Safe display-name matches | Verified efforts |
| --- | --- | --- |
| `claude-fable-5` | Claude Fable 5, Fable 5 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-8` | Claude Opus 4.8, Opus 4.8 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-sonnet-5` | Claude Sonnet 5, Sonnet 5 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-7` | Claude Opus 4.7, Opus 4.7 | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-6` | Claude Opus 4.6, Opus 4.6 | `low`, `medium`, `high`, `max` |
| `claude-opus-4-5-20251101` | Claude Opus 4.5, Opus 4.5 | `low`, `medium`, `high` |
| `claude-sonnet-4-6` | Claude Sonnet 4.6, Sonnet 4.6 | `low`, `medium`, `high`, `max` |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5, Sonnet 4.5 | none verified |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5, Haiku 4.5 | none verified |

Do not infer every `claude --help` effort for every model. Anthropic's
model-specific compatibility table is narrower than the CLI parser's global
vocabulary.

### Claude moving aliases and modifiers

The installed zero-turn command currently resolves:

| Exact CLI alias | Current local resolution | Catalog treatment |
| --- | --- | --- |
| `fable` | Fable 5 | moving alias |
| `opus` | Opus 4.8 | moving alias |
| `sonnet` | Sonnet 5 | moving alias |
| `haiku` | Haiku 4.5 | moving alias; no verified effort |
| `best` | Fable 5 | account/provider-dependent alias |
| `default` | Opus 4.8, 1M context | account/provider-dependent alias |
| `opusplan` | Opus in plan mode, Sonnet in execution | hybrid, not one model |
| `fable[1m]`, `opus[1m]`, `sonnet[1m]` | corresponding family with 1M context | context modifier |

Versioned wording should map to the full pinned ID. Versionless wording such as
“latest Opus” may map to the moving `opus` alias if the user asked for latest
semantics. “Claude 5,” “Claude 4.5,” bare “best,” and bare “default” remain
ambiguous without the provider and intended stability.

Do not put `auto` or `ultracode` in Commander's effort catalog. They appear in
Claude's interactive `/effort` command, but not in the installed `--effort`
contract used for a routed session. `ultracode` is specifically `xhigh` plus
dynamic workflow orchestration, so it also crosses Commander's delegation
boundary.

Deprecated-ID recognition is not identity proof: the installed CLI silently
remapped deprecated `claude-opus-4-1-20250805` to Opus 4.8, while retired
`claude-opus-4-20250514` returned not found. Exclude deprecated and retired IDs
from the bundled exact catalog.

## Grok CLI

Local evidence, observed 2026-07-16:

```sh
grok --version
# grok 0.2.101 (5bc4b5dfadcf) [stable]

grok models
# default: grok-4.5
# available: grok-4.5, grok-composer-2.5-fast

grok --help
# --reasoning-effort <EFFORT>, alias --effort
```

The refreshed first-party machine cache at `~/.grok/models_cache.json` reports
model-specific effort metadata from `https://cli-chat-proxy.grok.com/v1/models`.
Its shape is observed first-party behavior, not a documented stable schema.

The public primary sources are the [Grok Build CLI reference](https://docs.x.ai/build/cli/reference),
[Grok 4.5 model page](https://docs.x.ai/developers/models/grok-4.5), and
[reasoning-effort guide](https://docs.x.ai/developers/model-capabilities/text/reasoning),
all accessed 2026-07-16.

### Catalog-backed combinations

| Exact model | Display name | Default | Verified efforts |
| --- | --- | --- | --- |
| `grok-4.5` | Grok 4.5 | `high` | `low`, `medium`, `high` |
| `grok-composer-2.5-fast` | Composer 2.5 | none | none; `supports_reasoning_effort=false` |

Safe normalization is “Grok 4.5” -> `grok-4.5` and “Composer 2.5” ->
`grok-composer-2.5-fast`. Bare “Grok Build,” “Composer,” and “fast” are not
exact model names and should trigger discovery.

The official API aliases `grok-4.5-latest` and `grok-build-latest` may help
classify user intent, but they are absent from this machine's `grok models`
catalog. Prefer the catalog-backed `grok-4.5` for a pinned route.

The generic CLI parser also accepts strings such as `none`, `minimal`, `xhigh`,
`max`, and `deep`; that is not evidence that either live model supports them.
Only the three Grok 4.5 combinations above are verified. Composer 2.5 cannot be
represented faithfully while Commander requires an effort value.

## Required fallback when normalization misses

1. Resolve the requested provider/harness first. Never fuzzy-match a model name
   across providers.
2. Normalize against the bundled aliases. Accept a result only if one entry
   wins and the requested effort belongs to that entry's `efforts` list.
3. If no entry wins, or a CLI version/catalog is newer than the bundle, query
   the installed executable with no model turn:

   ```sh
   command -v codex && codex debug models
   command -v claude && claude -p "/model" --output-format json --no-session-persistence
   command -v grok && grok models
   ```

4. For Claude, resolve a candidate alias or full ID with zero-turn
   `/model <candidate>` and intersect it with Anthropic's model-specific effort
   table. A successful deprecated-ID probe can still remap, so compare the
   returned display name with the requested identity.
5. For Grok, read `models_cache.json` only after `grok models`, and use
   `supports_reasoning_effort`, `reasoning_effort`, and `reasoning_efforts` when
   present. If that observed cache shape changes, report discovery unavailable.
6. If the CLI exposes a model but not a model-specific effort vocabulary, the
   combination remains unresolved. Ask for attestation rather than inventing a
   sentinel or spending a model turn.

## Guardrails for the bundled catalog

- Include `observed_at` and the CLI version; provider catalogs and moving
  aliases drift independently of the skill release.
- Match Unicode-casefolded words after removing spaces, `_`, and `-`, but only
  against explicit aliases. Do not use edit distance or substring winners.
- Prefer pinned IDs when the user supplied a version. Preserve moving aliases
  only when the user explicitly asked for “latest,” “best,” or provider default.
- Treat context suffixes, presets, hybrid modes, and orchestration modes as
  modifiers, not models or effort levels.
- Availability remains machine/account-specific. A bundled record avoids
  routine discovery; it does not override a contradictory live catalog.
- Discovery must stay non-inference and zero-turn; a CLI may refresh its own
  local catalog cache. Authentication, subscription, usage, quota, credits,
  and billing controls remain operator-only.
