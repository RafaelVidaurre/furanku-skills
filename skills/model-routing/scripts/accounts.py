"""Account discovery, quota reporting, and deterministic account policy.

Orca can discover launch identities; CodexBar CLI alone measures quota. This adapter reads only
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
import codexbar

PROFILE_ENV = {'claude': 'CLAUDE_CONFIG_DIR', 'codex': 'CODEX_HOME'}
# Explicit credentials override profile selection in vendor CLIs.
UNSET_ENV = {
    'claude': ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
               'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
               'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'],
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
        if set(row) - {'profile', 'label', 'priority', 'min_remaining_percent', 'quota_source', 'discovery', 'expected_identity'}:
            raise ValueError(f'{source}: unknown profile fields for {key}')
        if not isinstance(row.get('profile'), str) or not Path(row['profile']).expanduser().is_absolute():
            raise ValueError(f'{source}: {key} requires an absolute profile directory')
        if row.get('quota_source', 'codexbar') != 'codexbar':
            raise ValueError(f'{source}: {key} uses a retired quota source; migrate quota_source to codexbar')
        if row.get('discovery', 'orca') not in ('orca', 'configured'):
            raise ValueError(f'{source}: invalid discovery for {key}')
        expected = row.get('expected_identity', {})
        if not isinstance(expected, dict) or set(expected) - {'email', 'organizationUuid', 'organization', 'providerAccountId'} or any(not isinstance(v, str) or not v.strip() for v in expected.values()):
            raise ValueError(f'{source}: invalid expected_identity for {key}')
        for field in ('priority', 'min_remaining_percent'):
            value = row.get(field, 0)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f'{source}: invalid {field} for {key}')
        if not 0 <= row.get('min_remaining_percent', 0) <= 100:
            raise ValueError(f'{source}: invalid min_remaining_percent for {key}')


def command_json(argv, env=None, *, timeout=120):
    result = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=timeout)
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


def profile_environment(row):
    env = os.environ.copy()
    for key in UNSET_ENV[row['provider']]:
        env.pop(key, None)
    env[PROFILE_ENV[row['provider']]] = row['profile']
    return env


def profile_measurement(row, dependency, *, refresh=False):
    env = profile_environment(row)
    native = None
    if row['provider'] == 'claude':
        native = command_json(['claude', 'auth', 'status', '--json'], env, timeout=10)
        expected = row.get('expected_identity', {})
        if not native.get('loggedIn') or not native.get('email') or not native.get('orgId') or any(
            expected.get(key) and native.get(remote) != expected[key]
            for key, remote in [('email', 'email'), ('organizationUuid', 'orgId')]):
            raise ValueError('Claude profile is signed out or native identity does not match configured account')
    result = codexbar.read(row['provider'], dependency, env)
    identity = result.get('identity', {})
    expected = row.get('expected_identity', {})
    if result['status'] == 'known':
        if any(expected.get(k) and identity.get(k) != expected[k] for k in ('email', 'organization')):
            raise ValueError('Measured identity does not match configured account')
        if native:
            if identity.get('email') != native['email'] or not native.get('orgName') or identity.get('organization') != native['orgName']:
                raise ValueError('Measured identity does not match native Claude organization')
            identity['organizationUuid'] = native['orgId']
    return result


def inventory(policy, dependency, now=None, *, refresh=False, providers=None, native_only_providers=()):
    validate(policy, 'account routing')
    supplied_now = now
    now = now or datetime.now(timezone.utc)
    rows = {}
    if policy.get('source') == 'orca':
        data = command_json([orca_command(policy), 'account', 'list', '--json'])['result']
        for provider, group in data.items():
            if not isinstance(group, dict) or not isinstance(group.get('accounts'), list):
                continue
            for account in group['accounts']:
                identity = account['id']
                active = identity == group.get('activeAccountId')
                key = f'{provider}:{identity}'
                if policy.get('profiles') and key not in policy['profiles']:
                    continue
                rows[key] = {'key': key, 'id': identity, 'provider': provider,
                             'discovery': {'source': 'orca', 'command': orca_command(policy)},
                             'launch_ready': not account.get('needsSignIn', False),
                             'label': account.get('email') or account.get('name') or identity,
                             'active': active, 'host_active': identity == group.get('activeAccountIdsByRuntime', {}).get('host', group.get('activeAccountId')), 'expected_identity': {k: account[k] for k in ('email', 'providerAccountId', 'organizationUuid') if account.get(k)}, 'runtime': account.get('managedAuthRuntime', account.get('managedHomeRuntime', 'host'))}
    for key, config in policy.get('profiles', {}).items():
        if policy.get('source') == 'orca' and key not in rows and config.get('discovery') != 'configured':
            continue  # Removed accounts cannot survive discovery through private configuration.
        provider, identity = key.split(':', 1)
        row = rows.setdefault(key, {'key': key, 'id': identity, 'provider': provider, 'label': identity, 'active': False, 'runtime': 'host'})
        discovered = row.get('expected_identity', {})
        configured = deepcopy(config)
        configured.pop('discovery', None)
        row.update(configured)
        if discovered:
            row['expected_identity'] = discovered
        row['profile'] = str(Path(row['profile']).expanduser())
    codexbar.verify(dependency)
    def measure(row):
        if row.get('profile'):
            try:
                row['measurement'] = profile_measurement(row, dependency, refresh=refresh)
            except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
                row['measurement'] = {'status': 'unknown', 'windows': [], 'source': 'codexbar', 'detail': str(exc)}
        measurement = row.setdefault('measurement', {'status': 'unknown', 'windows': []})
        if measurement['status'] == 'known' and not fresh(measurement.get('refreshed_at'), policy.get('max_age_seconds', 300), supplied_now or datetime.now(timezone.utc)):
            measurement['status'] = 'stale'
            measurement['detail'] = '; '.join(filter(None, [measurement.get('detail'), 'Last successful reading exceeds the freshness limit']))
        if not row.get('profile'):
            measurement['detail'] = 'No launch profile configured for a CodexBar CLI read'
        row['priority'] = row.get('priority', 0)
        row['min_remaining_percent'] = row.get('min_remaining_percent', policy.get('low_remaining_percent', 10))
        return row
    with ThreadPoolExecutor(max_workers=4) as pool:
        selected_rows = [row for row in rows.values()
                         if (providers is None or row['provider'] in providers)
                         and (row['provider'] not in native_only_providers
                              or (row.get('host_active', row.get('active'))
                                  and row.get('discovery', {}).get('source') == 'orca'))]
        measured = list(pool.map(measure, selected_rows))
    return {'captured_at': now.isoformat(), 'accounts': measured}


def remaining(row, model=''):
    measurement = row['measurement']
    families = {model.split('[')[0], *[f for f in ('fable', 'opus', 'sonnet', 'haiku') if f in model.split('-')]}
    values = [w.get('percentRemaining') for w in measurement['windows']
              if w.get('scope', 'all_models') == 'all_models'
              or w.get('scope', '').removeprefix('model:') in families]
    if not values or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not 0 <= x <= 100 for x in values):
        return None
    return min(values)


def failure_category(measurement):
    """Bounded diagnostic labels; never echo provider error text into decisions."""
    detail = str(measurement.get('detail') or '').lower()
    for tokens, label in (
        (('timed out', 'timeout'), 'timeout'),
        (('rate limit', '429'), 'provider rate limited'),
        (('schema',), 'schema mismatch'),
        (('identity', 'does not match'), 'identity mismatch'),
        (('fetch failed', 'network', 'connection'), 'source connectivity failure'),
        (('signed out', 'sign-in', 'unauthorized', 'authentication'), 'sign-in required'),
        (('freshness',), 'stale reading'),
    ):
        if any(token in detail for token in tokens):
            return label
    return 'source reading unavailable' if measurement.get('status') != 'known' else 'reserve or launch eligibility'


def choose(report, provider, model, *, native_only=False):
    eligible = []
    for row in report['accounts']:
        if native_only and (not row.get('host_active', row.get('active')) or row.get('discovery', {}).get('source') != 'orca'):
            continue
        left = remaining(row, model)
        if row['provider'] == provider and row.get('profile') and row.get('runtime') == 'host' and row.get('launch_ready', True) and row['measurement']['status'] == 'known' and left is not None and left > row['min_remaining_percent']:
            eligible.append(row)
    return min(eligible, key=lambda r: (-r['priority'], not r.get('active', False), -remaining(r, model), r['key'])) if eligible else None


def binding(row, max_age):
    result = {'key': row['key'], 'provider': row['provider'], 'id': row['id'], 'label': row['label'],
            'env': {PROFILE_ENV[row['provider']]: row['profile']}, 'unset_env': UNSET_ENV[row['provider']],
            'refreshed_at': row['measurement']['refreshed_at'], 'max_age_seconds': max_age}
    if row.get('discovery'):
        result['discovery'] = deepcopy(row['discovery'])
        result['expected_identity'] = deepcopy(row.get('expected_identity', {}))
    return result


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
