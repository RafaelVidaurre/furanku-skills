"""Account discovery, quota reporting, and deterministic account policy.

Discovery and measurements belong to Orca/quota-axi. This adapter reads only
non-secret tool output and carries the measured profile into the launch.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from html import escape
import json
import math
import os
from pathlib import Path
import subprocess
from string import Template

PROFILE_ENV = {'claude': 'CLAUDE_CONFIG_DIR', 'codex': 'CODEX_HOME'}
# Explicit credentials override profile selection in vendor CLIs.
UNSET_ENV = {
    'claude': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
               'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
               'CLAUDE_CODE_USE_FOUNDRY'],
    'codex': ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
}


def validate(policy, source):
    if not isinstance(policy, dict) or set(policy) - {'source', 'orca_command', 'profiles', 'low_remaining_percent', 'max_age_seconds'}:
        raise ValueError(f'{source}: invalid account_routing fields')
    if policy.get('source', 'configured') not in ('configured', 'orca'):
        raise ValueError(f'{source}: account_routing.source must be configured or orca')
    if 'orca_command' in policy and (not isinstance(policy['orca_command'], str) or not policy['orca_command'].strip()):
        raise ValueError(f'{source}: orca_command must be an executable')
    for key, default, upper in [('low_remaining_percent', 10, 100), ('max_age_seconds', 300, 1800)]:
        value = policy.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= upper:
            raise ValueError(f'{source}: invalid {key}')
    profiles = policy.get('profiles', {})
    if not isinstance(profiles, dict):
        raise ValueError(f'{source}: profiles must be an object')
    for key, row in profiles.items():
        provider, sep, identity = key.partition(':')
        if provider not in PROFILE_ENV or not sep or not identity or not isinstance(row, dict):
            raise ValueError(f'{source}: invalid profile {key!r}')
        if set(row) - {'profile', 'label', 'priority', 'min_remaining_percent', 'quota_source'}:
            raise ValueError(f'{source}: unknown profile fields for {key}')
        if not isinstance(row.get('profile'), str) or not Path(row['profile']).expanduser().is_absolute():
            raise ValueError(f'{source}: {key} requires an absolute profile directory')
        if row.get('quota_source', 'quota-axi') not in ('quota-axi', 'quota-axi-keychain', 'orca'):
            raise ValueError(f'{source}: invalid quota_source for {key}')
        if row.get('quota_source') == 'quota-axi-keychain' and provider != 'claude':
            raise ValueError(f'{source}: quota-axi-keychain requires Claude')
        if row.get('quota_source') == 'orca' and policy.get('source') != 'orca':
            raise ValueError(f'{source}: Orca quota requires Orca discovery')
        for field in ('priority', 'min_remaining_percent'):
            value = row.get(field, 0)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f'{source}: invalid {field} for {key}')
        if not 0 <= row.get('min_remaining_percent', 0) <= 100:
            raise ValueError(f'{source}: invalid min_remaining_percent for {key}')


def command_json(argv, env=None):
    result = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=120)
    if result.returncode not in (0, 1) or not result.stdout.strip():
        raise ValueError(f'{argv[0]} failed (exit {result.returncode}); run its diagnostic command')
    data = json.loads(result.stdout)
    if data.get('ok') is False:
        raise ValueError(f'{argv[0]} refused account discovery')
    return data


def orca_command(policy):
    import sys
    return policy.get('orca_command') or os.environ.get('ORCA_CLI_COMMAND') or (
        'orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else
        'orca-ide' if sys.platform.startswith('linux') and not os.environ.get('ORCA_TERMINAL_ID') else 'orca')


def stamp(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()
    return value


def fresh(value, max_age, now):
    try:
        age = now.timestamp() - datetime.fromisoformat(stamp(value).replace('Z', '+00:00')).timestamp()
        return 0 <= age <= max_age
    except (ValueError, TypeError, AttributeError, OverflowError):
        return False


def orca_measurement(value):
    windows = []
    for key in ('session', 'weekly', 'fableWeekly', 'monthly'):
        row = value.get(key)
        if isinstance(row, dict) and isinstance(row.get('usedPercent'), (int, float)):
            windows.append({'id': key, 'percentRemaining': 100 - row['usedPercent'],
                            'resetsAt': stamp(row.get('resetsAt')),
                            'windowSeconds': row.get('windowMinutes', 0) * 60})
    return {'status': 'known' if value.get('status') == 'ok' and not value.get('error') and windows else 'unknown',
            'refreshed_at': stamp(value.get('updatedAt')), 'windows': windows,
            'detail': value.get('error'), 'source': 'orca'}


def profile_environment(row):
    env = os.environ.copy()
    for key in UNSET_ENV[row['provider']] + ['QUOTA_AXI_SNAPSHOT', 'QUOTA_AXI_CLAUDE_PROFILES']:
        env.pop(key, None)
    env[PROFILE_ENV[row['provider']]] = row['profile']
    return env


def profile_measurement(row, dependency, *, refresh=False):
    env = profile_environment(row)
    command = ['npx', '-y', f"{dependency['package']}@{dependency['version']}",
               '--provider', row['provider'], '--full', '--json']
    keychain = row.get('quota_source') == 'quota-axi-keychain'
    if keychain:
        env['QUOTA_AXI_CLAUDE_PROFILES'] = row['profile']
        command += ['--no-credential-refresh', '--max-age', '0' if refresh else '90s']
    else:
        command += ['--profile-only']
    data = command_json(command, env)
    accepted_schemas = {dependency['schema_version']}
    if keychain:
        accepted_schemas.add(dependency.get('account_schema_version', dependency['schema_version']))
    if data.get('schemaVersion') not in accepted_schemas:
        raise ValueError('quota-axi schema does not match the pinned dependency')
    providers = data.get('providers', [])
    if keychain:
        providers = [p for p in providers if p.get('accountLocator', {}).get('path') == row['profile']]
    if len(providers) != 1 or providers[0].get('provider') != row['provider']:
        raise ValueError('quota-axi did not return exactly the requested provider')
    p = providers[0]
    state = p.get('state', {})
    return {'status': 'known' if state.get('status') == 'fresh' and not state.get('stale') and p.get('quotaSemantics', {}).get('status') == 'known' else 'unknown',
            'refreshed_at': state.get('refreshedAt'), 'windows': p.get('windows', []),
            'scopes': p.get('quotaSemantics', {}).get('effectiveAvailability', []),
            'detail': state.get('error'), 'source': 'quota-axi-keychain' if keychain else 'quota-axi', 'identity': p.get('account', {})}


def verify_claude_launch(row):
    """Orca quota alone does not prove the configured CLI profile is signed in."""
    status = command_json(['claude', 'auth', 'status', '--json'], profile_environment(row))
    expected = row.get('expected_identity', {})
    if not status.get('loggedIn'):
        return False
    return all(not expected.get(key) or status.get(remote) == expected[key]
               for key, remote in [('email', 'email'), ('organizationUuid', 'orgId')])


def inventory(policy, dependency, now=None, *, refresh=False):
    validate(policy, 'account routing')
    supplied_now = now
    now = now or datetime.now(timezone.utc)
    rows = {}
    if policy.get('source') == 'orca':
        data = command_json([orca_command(policy), 'account', 'list', '--json'])['result']
        limits = data.get('rateLimits', {})
        for provider, group in data.items():
            if not isinstance(group, dict) or not isinstance(group.get('accounts'), list):
                continue
            inactive = {x['accountId']: x.get('rateLimits') or {} for x in limits.get('inactive' + provider.title() + 'Accounts', [])}
            for account in group['accounts']:
                identity = account['id']
                active = identity == group.get('activeAccountId')
                key = f'{provider}:{identity}'
                rows[key] = {'key': key, 'id': identity, 'provider': provider,
                             'label': account.get('email') or account.get('name') or identity,
                             'active': active, 'expected_identity': {k: account[k] for k in ('email', 'providerAccountId', 'organizationUuid') if account.get(k)}, 'runtime': account.get('managedAuthRuntime', account.get('managedHomeRuntime', 'host')),
                             'measurement': orca_measurement(limits.get(provider, {}) if active else inactive.get(identity, {}))}
    for key, config in policy.get('profiles', {}).items():
        if policy.get('source') == 'orca' and key not in rows:
            continue  # Removed accounts cannot survive discovery through private configuration.
        provider, identity = key.split(':', 1)
        row = rows.setdefault(key, {'key': key, 'id': identity, 'provider': provider, 'label': identity, 'active': False, 'runtime': 'host'})
        row.update(deepcopy(config))
        row['profile'] = str(Path(row['profile']).expanduser())
    def measure(row):
        if row.get('profile') and row.get('quota_source', 'quota-axi') in ('quota-axi', 'quota-axi-keychain'):
            try:
                row['measurement'] = profile_measurement(row, dependency, refresh=refresh)
            except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
                row['measurement'] = {'status': 'unknown', 'windows': [], 'source': row.get('quota_source', 'quota-axi'), 'detail': str(exc)}
        measurement = row.setdefault('measurement', {'status': 'unknown', 'windows': []})
        if refresh and measurement.get('source') == 'orca':
            reason = ('Orca supplies cached snapshots; configure a direct quota source for live reads'
                      if row.get('profile') else 'No launch profile configured for a direct quota read')
            measurement['detail'] = '; '.join(filter(None, [measurement.get('detail'), reason]))
        if measurement['status'] == 'known' and not fresh(measurement.get('refreshed_at'), policy.get('max_age_seconds', 300), supplied_now or datetime.now(timezone.utc)):
            measurement['status'] = 'stale'
            measurement['detail'] = '; '.join(filter(None, [measurement.get('detail'), 'Last successful reading exceeds the freshness limit']))
        identity = measurement.get('identity', {})
        expected = row.get('expected_identity', {})
        if any(expected.get(k) and identity.get(remote) != expected[k] for k, remote in [('email', 'email'), ('providerAccountId', 'accountId')]) and measurement.get('source') in ('quota-axi', 'quota-axi-keychain') and measurement['status'] == 'known':
            measurement['status'] = 'unknown'
            measurement['detail'] = 'Measured identity does not match discovered account'
        if row.get('profile') and row['provider'] == 'claude' and measurement.get('source') == 'orca' and measurement['status'] == 'known':
            try:
                row['launch_ready'] = verify_claude_launch(row)
                if not row['launch_ready']:
                    measurement['detail'] = 'Claude CLI profile is signed out or does not match the Orca account'
            except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
                row['launch_ready'] = False
                measurement['detail'] = f'Claude profile verification failed: {exc}'
        row['priority'] = row.get('priority', 0)
        row['min_remaining_percent'] = row.get('min_remaining_percent', policy.get('low_remaining_percent', 10))
        return row
    with ThreadPoolExecutor(max_workers=4) as pool:
        measured = list(pool.map(measure, rows.values()))
    return {'captured_at': now.isoformat(), 'accounts': measured}


def remaining(row, model=''):
    measurement = row['measurement']
    scopes = measurement.get('scopes')
    if scopes is not None:
        model_name = model.split('[')[0]
        model_scopes = {'model:' + model_name}
        for family in ('fable', 'sonnet', 'haiku'):
            if model_name.startswith('claude-' + family + '-'):
                model_scopes.add('model:' + family)
        relevant = [s for s in scopes if s.get('scope') in {'all_models', 'all_products'} | model_scopes]
        if not relevant or any(s.get('status', 'known') != 'known' for s in relevant):
            return None
        values = [s.get('effectivePercentRemaining') for s in relevant]
    else:
        values = [w.get('percentRemaining') for w in measurement['windows'] if w['id'] != 'fableWeekly' or 'fable' in model]
    if not values or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not 0 <= x <= 100 for x in values):
        return None
    return min(values)


def choose(report, provider, model):
    eligible = []
    for row in report['accounts']:
        left = remaining(row, model)
        if row['provider'] == provider and row.get('profile') and row.get('runtime') == 'host' and row.get('launch_ready', True) and row['measurement']['status'] == 'known' and left is not None and left > row['min_remaining_percent']:
            eligible.append(row)
    return min(eligible, key=lambda r: (-r['priority'], not r.get('active', False), -remaining(r, model), r['key'])) if eligible else None


def binding(row, max_age):
    return {'key': row['key'], 'provider': row['provider'], 'id': row['id'], 'label': row['label'],
            'env': {PROFILE_ENV[row['provider']]: row['profile']}, 'unset_env': UNSET_ENV[row['provider']],
            'refreshed_at': row['measurement']['refreshed_at'], 'max_age_seconds': max_age}


def render(report):
    def cell(value):
        return escape(str(value if value is not None else '—')).replace('|', '\\|').replace('\n', ' ').replace('\r', ' ')

    def timestamp(value):
        try:
            return datetime.fromisoformat(stamp(value).replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%b %d %H:%M')
        except (ValueError, TypeError, AttributeError, OverflowError):
            return '—'

    def short_id(row):
        identity = row['id']
        others = [r['id'] for r in report['accounts'] if r['provider'] == row['provider'] and r['id'] != identity]
        length = min(8, len(identity))
        while length < len(identity) and any(other.startswith(identity[:length]) for other in others):
            length += 1
        return cell(identity[:length])

    lines, notes = [], []
    for row in sorted(report['accounts'], key=lambda r: (r['provider'], -r['priority'], r['key'])):
        m = row['measurement']
        amounts, resets = [], []
        for window in m['windows']:
            value = window.get('percentRemaining')
            left = f'{value:g}%' if isinstance(value, (int, float)) else 'Unknown'
            label = window.get('label') or window['id']
            if window.get('windowSeconds') == 18000:
                label = '5h'
            label = cell(label)
            amounts.append(f'{label}: {left}')
            resets.append(f"{label}: {timestamp(window.get('resetsAt'))}")
        status = {'known': 'Fresh', 'unknown': 'Unavailable', 'stale': 'Stale'}.get(m['status'], cell(m['status']))
        if m['status'] == 'known' and m.get('source') == 'orca':
            status = 'Cached'
        identity = short_id(row)
        account = f"{cell(row['label'])}<br>{identity}" + (' · active' if row['active'] else '')
        reading = f"{status}<br>{timestamp(m.get('refreshed_at'))}"
        lines.append('| ' + ' | '.join([
            cell(row['provider'].title()), account, '<br>'.join(amounts) or '—',
            '<br>'.join(resets) or '—', reading,
            f"{row['priority']:g} / {row['min_remaining_percent']:g}%"]) + ' |')
        if m.get('detail') or m['status'] != 'known':
            detail = m.get('detail') or 'The source did not return a usable quota reading'
            notes.append(f"- **{cell(row['provider'].title())} {identity}** ({cell(m.get('source'))}): {cell(detail)}.")
    template = (Path(__file__).resolve().parent.parent / 'references/accounts-template.md').read_text()
    return Template(template).substitute(captured_at=timestamp(report['captured_at']),
                                        rows='\n'.join(lines) or '| — | No accounts configured or discovered | — | — | — | — |',
                                        notes='\n'.join(notes))
