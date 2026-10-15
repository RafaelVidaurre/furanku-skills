# Accounts and quota-aware launches

Use this reference for account inventory, account priorities, reserves, or moving work after an account runs out. Runtime account selection is separate from capability/model selection.

## Human report

`$model-routing accounts` and `$model-routing list` run:

```sh
python3 <skill-dir>/scripts/router.py accounts --repo <root>
```

Return the generated table unchanged, with one row per account and diagnostics below it. `router.py list` aliases `accounts`; `--format json` serves automation and retains full account IDs. The human layout is [accounts-template.md](accounts-template.md). `$model-routing models` still runs `config.py models`; the low-level `config.py list` remains a compatibility alias for that model view.

Account reports request a live quota-axi read for every configured direct source, bypassing its success cache. A failed refresh stays unavailable and includes the source's error; it does not borrow another profile's reading. Orca discovery supplies snapshots, not a refresh API. Use a direct quota source for profiles that can be read locally; explicitly configured `quota_source: orca` remains snapshot-only and the report explains this limitation. Authentication or Keychain permission gaps require the provider's supported setup flow, not repeated reads.

Without account configuration, the report explains that no accounts are configured. To inspect Orca without configuring launch profiles, use `--account-source orca`. Discovery calls the resolved Orca CLI's `account list --json`; it does not read Orca's private credential stores. Unsupported CLI versions and unavailable tools are reported as failures.

**Complete when:** the report identifies every discovered account independently, including duplicate email addresses, and labels stale/unknown measurements with their timestamps.

## Configuration

Add optional `account_routing` to a version 4 configuration using `config.py write`. The highest layer that defines it replaces the entire policy. Keep identities and paths in the private global or machine-repo layer.

```json
{
  "version": 4,
  "routes": {},
  "account_routing": {
    "source": "configured",
    "low_remaining_percent": 10,
    "max_age_seconds": 300,
    "profiles": {
      "claude:short-window": {
        "profile": "/absolute/private/claude-profile",
        "priority": 100,
        "min_remaining_percent": 0
      },
      "claude:backup": {
        "profile": "/absolute/private/other-claude-profile"
      },
      "codex:primary": {
        "profile": "/absolute/private/codex-home"
      }
    }
  }
}
```

- `source: configured` works independently of any orchestrator. `source: orca` discovers all accounts from Orca; profile keys then use `provider:<Orca account ID>`. Removed accounts cease to be eligible. Configure the exact profile observed in the supported native launcher or its process environment; discovery does not infer paths from account IDs or historical directory layouts. Verify its native authentication before writing the binding through `config.py write`. Discovered accounts without profiles remain visible but are not selectable.
- `orca_command` optionally selects the exact executable. Otherwise use the Orca skill's environment/platform resolution. Remote/WSL profiles are shown but this local launcher does not claim to bind them.
- `quota_source` defaults to `quota-axi`: its pinned `--profile-only --full --json` reads exactly the configured Claude/Codex credential file, with no Keychain, credential refresh, or fallback. `quota_source: orca` explicitly uses Orca's account-bound quota snapshots instead; active snapshots are joined to the active account ID, inactive snapshots to their own account ID. Neither source silently falls back to another after failure. For Claude snapshots, the adapter also checks `claude auth status --json` in the configured profile and requires matching email and organization. These identify the login, not a unique Orca profile: duplicate identities still require the exact account ID and observed profile at launch.
- `quota_source: quota-axi-keychain` supports Claude profiles backed by macOS Keychain. It uses quota-axi's profile lanes and accepts only the exact configured `accountLocator.path`; other returned accounts cannot supply its quota. Launch checks reuse evidence for at most 90 seconds; account reports request a live read. Both disable delegated credential refresh and never request Keychain permission automatically. A permission gap makes this source unavailable until the user's supported permission flow succeeds. An authorized explicit change to `quota_source: orca` is a separate supported policy choice when native identity and fresh account-bound snapshots establish readiness; it is not an automatic fallback or a reason to repeat sign-in or workspace trust.
- Orca snapshots may be old, incomplete, or rate limited. `max_age_seconds` (default 300, maximum 1800) is enforced; passing a reset time does not manufacture fresh headroom. Authentication failures, missing identity, unknown scope semantics, and malformed percentages cannot establish eligibility. For Keychain-only Claude profiles, use the Keychain mode or Orca snapshots with a verified native launch profile; never copy credentials between accounts.
- `priority` defaults to 0; larger wins among eligible accounts. `min_remaining_percent` overrides the default reserve for one account. A reserve of 0 uses a priority account until its allowance is exhausted. Within a priority tier, keep Orca's active account while healthy; otherwise choose the most remaining allowance, then stable account key.
- Every applicable quota window binds eligibility, including weekly limits and named model windows. An account with a fresh five-hour window and an exhausted week is unavailable. Quota credits are not automatically redeemed and paid overage is not enabled.
- `accounts` / candidate `quota_account` retain their fixed-launcher meaning. Account selection applies only to direct Claude/Codex candidates; fixed-account, external-provider, and rotating-proxy candidates retain their existing gates.

Account priority chooses among accounts for the selected model; it does not bypass disabled/explicit models or hard task requirements. To spend a provider's short window before other providers, add a private preference to choose its task-capable enabled candidates while that prioritized account has eligible allowance. Preserve exact-route instructions.

**Complete when:** the effective report shows the intended policy, a live gate decision includes `account_binding`, and its provider/profile matches the intended account.

## Launch and resume

With `--quota-axi`, briefs and checks refresh the account inventory. A successful account-aware decision includes `account_binding` with the exact profile environment, credential overrides to unset, measured time, expiry, and discovery provenance when available. Consumers must enforce that binding; a model/effort tuple alone is insufficient. Crew rejects expired bindings and distinguishes native preparation from an explicit custom command through its mechanism manifest. Its Orca procedure owns the native identity and task-delivery checks.

An Orca inventory read does not refresh its quota snapshots. When the selected native account's snapshot expires, use Orca's supported usage refresh if available, then recheck; otherwise report the missing refresh capability. Keep the freshness policy unchanged and retain unavailable evidence. A healthy different account does not authorize delivery to a native process bound to the stale account.

Check immediately before each new launch or recovery. After exhaustion, checkpoint completed work and the remaining contract, settle/fence the old owner through the consumer's lifecycle, rerun routing within the same model/task constraints, and launch a continuation with the new binding. For Orca, follow Crew's account-bound terminal attachment procedure. Keep the workspace and work record; do not assume a provider's conversation ID is portable between accounts.

This policy selects accounts at launch boundaries. It does not migrate or restart a running agent automatically. When a fresh reading after reset makes the priority account eligible again, the next check selects it again. All accounts unusable is a refusal, with inventory evidence; unknown quota is not permission to bill a guessed account.

**Complete when:** the consumer launched with the emitted binding, or reports the concrete account/source readiness gap. A controlled transition test establishes selection logic; it does not prove an exhausted live session resumed.
