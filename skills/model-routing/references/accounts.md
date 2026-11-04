# Accounts and quota-aware launches

Use this reference for inventory, priorities, reserves, or moving work after an account runs out. Model selection and account selection are separate decisions.

## Read and verify

Run `python3 <skill-dir>/scripts/router.py accounts --repo <root>` and return its table unchanged. `list` aliases `accounts`; `--format json` retains complete IDs. The layout is [accounts-template.md](accounts-template.md).

CodexBar CLI is the sole live quota reader. Install the exact version in [runtime-dependencies.json](runtime-dependencies.json), following the [CodexBar skill](../../codexbar/SKILL.md). The adapter checks the installed version and runs `codexbar usage --provider <claude|codex> --source cli --format json --no-credits` once per selected profile. CodexBar reads Codex quota for the accounts it lists, not for `CODEX_HOME`, so a Codex profile adds `--all-accounts` and takes the one entry whose email equals the profile's expected email; a Codex profile without an expected email, an email CodexBar does not list, or an email it lists more than once stays unknown. Add every Codex account to CodexBar. Reports also cover every billing provider in the effective catalog: Cursor uses the [Cursor web usage contract](cursor.md#capability-and-usage-evidence); providers without a qualified reader or launch profile appear with an explicit unavailable reason. Rotating-proxy policies keep their existing pooled semantics.

Claude uses `CLAUDE_CONFIG_DIR`; Codex uses `CODEX_HOME`. Credential overrides are unset. Claude first runs native `claude auth status --json` in the same profile, verifies email and organization ID against configured/discovered identity, then matches CodexBar's email and, when CodexBar reports one, organization name; a blank organization stays unknown when another configured or discovered Claude account shares that email with a different or missing organization UUID. Registrations with the same email and verified native organization UUID are aliases of one billing identity. The ambiguity check uses the full inventory, including accounts excluded from selection. Profile selection defaults to `profile_mode: directory`, including an explicit override that spells `~/.claude`. Use `profile_mode: native-default` only for Claude's observed native default at that path; collection and launch then keep `CLAUDE_CONFIG_DIR` unset. Its binding carries `native_default_profile` for process-home verification. Selection modes can use different credential storage, so path equality never changes a configured mode. Native identity and attributed quota still have to match. See the [native configuration directory](https://code.claude.com/docs/en/env-vars). CodexBar's Codex CLI output reports email but no stable account ID: the measured email establishes quota attribution; Orca's account ID remains discovery/launch evidence, never a fabricated measured ID. Native launch identity checks remain mandatory.

Only returned windows are reported. Every applicable general and named-model window binds selection; an exhausted week blocks a healthy session. Missing windows remain unreported, never 100%. Invalid percentages, unknown scoped windows, conflicting identity, stale data, and provider errors cannot establish headroom. Claude CLI percentages may be coarse (`percentOnly`); they are not token counts. Credits and paid overage are not enabled.

A read failure is reported once with its source error. There is no automatic retry, browser fallback, OAuth fallback, or borrowing another account's quota. After supported sign-in/network recovery, rerun the same check. A provider rate limit and an exhausted allowance are different outcomes. CodexBar does not fix upstream rate limits, and its CLI parser can fail after a provider UI change.

**Complete when:** requested profiles have individually attributed readings or explicit unavailable results.

## Private configuration

Add `account_routing` to a version 4 configuration with `config.py write`. The highest defining layer replaces the entire policy. Keep personal identities and paths in a private global or machine-repo layer.

```json
{
  "version": 4,
  "routes": {},
  "account_routing": {
    "source": "configured",
    "low_remaining_percent": 5,
    "max_age_seconds": 1800,
    "profiles": {
      "claude:personal": {
        "profile": "/absolute/private/claude-personal",
        "expected_identity": {"email": "user@example.test", "organizationUuid": "personal-org"},
        "priority": 100,
        "min_remaining_percent": 0
      },
      "claude:team": {
        "profile": "/absolute/private/claude-team",
        "expected_identity": {"email": "user@example.test", "organizationUuid": "team-org"}
      },
      "codex:primary": {
        "profile": "/absolute/private/codex-home",
        "expected_identity": {"email": "user@example.test"}
      }
    }
  }
}
```

- `source: configured` works without an orchestrator. `source: orca` calls the supported `account list --json` for account metadata only; all embedded quota snapshots are ignored. Keys use `provider:<Orca account ID>`. When profiles are configured, only those entries are reported; removed Orca accounts cease to be eligible. Without profiles, `--account-source orca` lists discovered accounts as unavailable until their launch profiles are configured.
- An independent profile alongside Orca accounts must explicitly set `discovery: configured`; it is usable by profile-selecting command launchers, not by Orca-native launches. This opt-in cannot accidentally resurrect a removed Orca account.
- Configure the exact profile observed in the supported native launcher or its process environment, not a path guessed from an account ID. `orca_command` optionally selects the Orca executable. Remote profiles cannot be bound by a local launch.
- `expected_identity` pins email and, for Claude, organization UUID (optionally organization name). Orca-discovered identity takes precedence over configured identity. Profile sign-in changes require re-verification. Never copy credentials between accounts.
- `quota_source` is optional and accepts only `codexbar`. To migrate a prior configuration, replace its retired quota-source values with `codexbar`, verify profile identities, and write the updated private layer with `config.py write`. Legacy sources are refused with a migration message; they are not silently reinterpreted.
- `priority` defaults to 0. `min_remaining_percent` overrides the default soft reserve (5%). For the same model, prefer an eligible account above its reserve; if none exists, use a positive account at or below reserve. Reserve alone never refuses a launch. Within the selected group, higher priority wins, then retain the active Orca account, then prefer greater allowance and stable account key. Zero and unknown allowance remain unusable.
- `max_age_seconds` defaults to 1800 (30 minutes) and accepts any finite positive duration in seconds. Explicit shorter or longer limits remain binding. Passing a reset time requires a new reading and never manufactures fresh headroom. Account priorities do not override model policy, task requirements, or exact routes.

`accounts` / candidate `quota_account` retain their fixed-launcher meaning. Dynamic selection applies only to direct Claude/Codex candidates; external-provider and pooled candidates keep their existing gates.

For a policy that follows the machine's native Claude default, keep `source: orca` and use only this Claude profile row, preserving other providers and unrelated configuration:

```json
"claude:system-default": {
  "profile": "~/.claude",
  "profile_mode": "native-default",
  "discovery": "configured",
  "min_remaining_percent": 0
}
```

Omit `expected_identity` to follow the identity currently verified by public Orca discovery and native authentication. Write the merged private layer through `config.py write`, then check it with the helper installation the launcher actually uses. A stale project-local helper may lack this mode even when a global copy supports it; refresh it through the supported skills installer before diagnosing sign-in or requesting an account switch.

**Complete when:** the effective report shows the intended policy and a live decision binds the intended provider/profile.

## Launch and resume

With `--codexbar`, briefs collect only visible candidates' providers; checks collect only the requested candidate/exact route and its configured fallback. Account-aware selection does not also read ambient provider quota. Fresh, attributed quota facts are reused from private files under `~/.furanku-skills/model-routing/quota-cache/` until the freshness limit or a reported reset. The cache retains the original measurement timestamp and all model-scoped windows; reuse does not renew freshness. Keys bind provider/account, profile path and selection mode, expected identity, reader command/version and environment contract. Claude native identity and organization checks still run on reuse. Credentials, provider errors, unknown and report-only readings are never cached. Missing, unreadable or corrupt files fall back to the supported reader; an unwritable cache leaves the read usable.

Ambient provider reads without an explicit launch profile remain fresh reads: their identity is not independently qualified before collection, so a prior ambient account cannot supply a reusable account binding.

Cache access follows no symlinks, including in ancestor directories. Ancestors must belong to the current user or root and be protected from other users' writes; root-owned sticky temporary directories retain their normal child protection. The cache directory must be owned by the current user with mode `0700`; cache files must be regular, owned by that user, have mode `0600`, and have one link. Reads are bounded to 128 KiB. Unsafe paths are left untouched and trigger fresh collection. Platforms without descriptor-relative no-follow operations and ownership checks also collect fresh quota. Existing directories are never chmodded to make them qualify.

`accounts` and its `list` alias force fresh collection. Programmatic callers can pass `inventory(..., refresh=True)` or `profile_measurement(..., refresh=True)`. After a confirmed usage limit, call `invalidate_quota_cache(row_or_binding, dependency)` before the next check: an inventory row supplies its profile identity, while an emitted binding carries its opaque `quota_cache_key`. If invalidation returns false because the file could not be removed, force refresh on recovery checks until the old file can be removed or replaced. A failed refresh removes the prior reusable reading when the cache is writable; it never caches the error.

Profile reads run with up to four concurrent jobs. Each CodexBar usage process has a 120-second timeout and its owned process group is terminated on timeout; Claude native identity preflight has a separate 10-second limit. These are collection deadlines, not orchestration waits.

A successful account-aware decision includes `account_binding`: exact environment, credential overrides to unset, measurement time, expiry, verified `quota_identity`, and discovery provenance when available. The measured identity is retained for static profiles too, so recovery can exclude aliases of an exhausted billing account. Consumers enforce the binding at launch. Bindings pin the producing installation's public environment contract by path and hash so saved decisions and router wrappers use the same credential-removal rules; a changed contract requires a fresh routing check. Crew rejects expired bindings; its Orca procedure verifies the account ID and actual native process profile before task delivery.

Crew's built-in Orca Claude and Codex adapters can bind an alternate or configured-only profile through an Orca terminal and therefore check all configured accounts while preserving model and effort. They prefer native preparation for an active Orca-discovered account. Configured-only profiles use the exact environment-bound command and native identity proof without an Orca registration. A consumer constrained to native-only launch or otherwise unable to select accounts passes `--native-account-only claude` or `--native-account-only codex`. Collection and selection are then limited to the active Orca host account. A healthy inactive account cannot supply its evidence. The distinct `claude:system-default` row with `discovery: configured` and `profile_mode: native-default` can bind Orca's selected system default when public discovery reports a null host account plus matching default home, email and organization. The binding marks `discovery.selection: system-default`; its configured row name is not a managed Orca account ID. Native authentication and CodexBar must independently match that identity before it is eligible, including when Orca warns that default metadata may have been copied. A registered account row is never promoted into this selection. Public metadata verifies email and organization UUID; an optional organization-name pin remains for native/quota verification, while an unsupported provider account ID stays unqualified. Missing metadata, a changed host selection or a different configured identity cannot borrow that reading. An independent personal profile needs a profile-selecting launch surface or supported registration with the native orchestrator before native launch.

Check immediately before each launch or recovery. After exhaustion, checkpoint completed work and the remaining contract, settle the old owner through the consumer lifecycle, rerun routing within the same model/task constraints, and launch a continuation with the new binding. Preserve the workspace and work record; provider conversation IDs may not transfer across accounts. This policy does not automatically migrate running agents.

All accounts unusable is a refusal. Unknown quota does not authorize billing a guessed account. After a new readiness signal, run one check of the same decision; another full inventory read is not a remedy.

**Complete when:** the consumer launches with the emitted binding or reports the concrete readiness gap. A controlled selection test does not prove live session recovery.
