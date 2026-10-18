# Accounts and quota-aware launches

Use this reference for inventory, priorities, reserves, or moving work after an account runs out. Model selection and account selection are separate decisions.

## Read and verify

Run `python3 <skill-dir>/scripts/router.py accounts --repo <root>` and return its table unchanged. `list` aliases `accounts`; `--format json` retains complete IDs. The layout is [accounts-template.md](accounts-template.md).

CodexBar CLI is the sole live quota reader. Install the exact version in [runtime-dependencies.json](runtime-dependencies.json), following the [CodexBar skill](../../codexbar/SKILL.md). The adapter checks the installed version and runs `codexbar usage --provider <claude|codex> --source cli --format json --no-credits` once per selected profile. Other billing providers currently return unknown: their CodexBar output contracts have not been qualified by this adapter. Rotating-proxy policies keep their existing pooled semantics.

Claude uses `CLAUDE_CONFIG_DIR`; Codex uses `CODEX_HOME`. Credential overrides are unset. Claude first runs native `claude auth status --json` in the same profile, verifies email and organization ID against configured/discovered identity, then matches CodexBar's email and organization name. Two accounts with one email remain distinct. CodexBar's Codex CLI output reports email but no stable account ID: the measured email and exact profile establish quota attribution; Orca's account ID remains discovery/launch evidence, never a fabricated measured ID. Native launch identity checks remain mandatory.

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
    "low_remaining_percent": 10,
    "max_age_seconds": 300,
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
- `priority` defaults to 0; higher wins among eligible accounts. `min_remaining_percent` overrides the default reserve (10%). Zero reserve uses an account until exhausted. Within a priority tier, retain the active Orca account while eligible, then prefer greater allowance and stable account key.
- `max_age_seconds` defaults to 300 (maximum 1800). Passing a reset time does not manufacture fresh headroom. Account priorities do not override model policy, task requirements, or exact routes.

`accounts` / candidate `quota_account` retain their fixed-launcher meaning. Dynamic selection applies only to direct Claude/Codex candidates; external-provider and pooled candidates keep their existing gates.

**Complete when:** the effective report shows the intended policy and a live decision binds the intended provider/profile.

## Launch and resume

With `--codexbar`, briefs read only visible candidates' providers; checks read only the requested candidate/exact route and its configured fallback. Account-aware selection does not also read ambient provider quota. Profile reads run with up to four concurrent jobs. Each CodexBar usage process has a 120-second timeout and its owned process group is terminated on timeout; Claude native identity preflight has a separate 10-second limit. These are collection deadlines, not orchestration waits.

A successful account-aware decision includes `account_binding`: exact environment, credential overrides to unset, measurement time, expiry, and discovery provenance when available. Consumers enforce it at launch. Crew rejects expired bindings; its Orca procedure verifies the account ID and actual native process profile before task delivery.

A consumer unable to select accounts passes `--native-account-only claude` or `--native-account-only codex`. Collection and selection are then limited to the active Orca host account. A healthy inactive account cannot supply its evidence. An independent personal profile needs a profile-selecting launch surface or supported registration with the native orchestrator before native launch.

Check immediately before each launch or recovery. After exhaustion, checkpoint completed work and the remaining contract, settle the old owner through the consumer lifecycle, rerun routing within the same model/task constraints, and launch a continuation with the new binding. Preserve the workspace and work record; provider conversation IDs may not transfer across accounts. This policy does not automatically migrate running agents.

All accounts unusable is a refusal. Unknown quota does not authorize billing a guessed account. After a new readiness signal, run one check of the same decision; another full inventory read is not a remedy.

**Complete when:** the consumer launches with the emitted binding or reports the concrete readiness gap. A controlled selection test does not prove live session recovery.
