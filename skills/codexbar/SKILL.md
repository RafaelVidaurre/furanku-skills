---
name: codexbar
description: Read Claude and Codex account quotas through the official CodexBar CLI. Use when checking usage or rate-limit failures, setting up multiple account profiles, installing CodexBar CLI, or migrating an older quota reader to CodexBar.
---

# CodexBar CLI

Use the official `codexbar` executable. Model-routing owns the account inventory, quota normalization and launch gate; this skill owns CLI setup and direct diagnosis.

## Setup

Check `codexbar --version` against [the tested routing dependency](../model-routing/references/runtime-dependencies.json). Install that release from [official CodexBar releases](https://github.com/steipete/CodexBar/releases), choosing the host OS/architecture tarball and verifying its published checksum. Extract the complete bundle and put its executable or symlink on PATH. Existing app installations can use Preferences → Advanced → Install CLI. Follow [official CLI documentation](https://github.com/steipete/CodexBar/blob/v0.77.0/docs/cli.md) for platform-specific installation.

A different version needs adapter contract verification before changing the declared dependency. Missing tools, unsupported platforms, and installation failures are explicit readiness gaps.

**Complete when:** `codexbar --version` matches the routing dependency.

## Accounts and quota

For all configured profiles, use the [model-routing account workflow](../model-routing/references/accounts.md):

```sh
python3 <model-routing-dir>/scripts/router.py accounts --repo <root>
```

For direct diagnosis, run the same CLI command in the affected profile environment:

```sh
codexbar usage --provider claude --source cli --format json --no-credits
codexbar usage --provider codex --source cli --format json --no-credits
```

Bind `CLAUDE_CONFIG_DIR` or `CODEX_HOME` to the intended profile and unset the credential overrides listed in model-routing's `accounts.py` `UNSET_ENV`. Use the supported native sign-in flow in that profile for missing authentication. Ask the user to complete sign-in, never to send credentials. Keep credentials in native stores.

`--all-accounts` is CodexBar's own account discovery/configuration surface; it does not establish a launch binding for arbitrary orchestrator profiles. Explicit per-profile reads support several Claude accounts, including separate organizations with the same email, and several Codex accounts without copying credentials into a second store.

Use explicit `--source cli` for profile attribution. Auto/web sources can select a browser account instead. Preserve returned identity, update time, each quota window, and error. Missing windows are unknown, not unused allowance. An HTTP rate-limit failure is not proof of exhausted subscription quota. After a failure, follow the supported readiness remedy and recheck once; do not add retries or substitute another reader.

**Complete when:** each requested profile has an identity-attributed result or an explicit source failure; a launch decision also passes model-routing's binding gate.
