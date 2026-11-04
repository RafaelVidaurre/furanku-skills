"""Account discovery, quota reporting, and deterministic account policy.

Orca can discover launch identities; CodexBar CLI alone measures quota. This adapter reads only
non-secret tool output and carries the measured profile into the launch.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from html import escape
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import stat
import subprocess
from string import Template
import codexbar

DEFAULT_RESERVE_PERCENT = 5
DEFAULT_MAX_AGE_SECONDS = 1800
QUOTA_CACHE_CONTRACT = 1
QUOTA_CACHE_MAX_BYTES = 128 * 1024

ACCOUNT_ENVIRONMENT_PATH = Path(__file__).resolve().parent.parent / 'references/account-environment.json'
ACCOUNT_ENVIRONMENT_BYTES = ACCOUNT_ENVIRONMENT_PATH.read_bytes()
ACCOUNT_ENVIRONMENT = json.loads(ACCOUNT_ENVIRONMENT_BYTES)
PROFILE_ENV = ACCOUNT_ENVIRONMENT['profile_env']
# Explicit credentials override profile selection in vendor CLIs. The consumer
# validates this same list before constructing a command or native preparation.
UNSET_ENV = ACCOUNT_ENVIRONMENT['unset_env']


def validate(policy, source):
    if not isinstance(policy, dict) or set(policy) - {'source', 'orca_command', 'profiles', 'low_remaining_percent', 'max_age_seconds'}:
        raise ValueError(f'{source}: invalid account_routing fields')
    if policy.get('source', 'configured') not in ('configured', 'orca'):
        raise ValueError(f'{source}: account_routing.source must be configured or orca')
    if 'orca_command' in policy and (not isinstance(policy['orca_command'], str) or not policy['orca_command'].strip()):
        raise ValueError(f'{source}: orca_command must be an executable')
    for key, default in [('low_remaining_percent', DEFAULT_RESERVE_PERCENT), ('max_age_seconds', DEFAULT_MAX_AGE_SECONDS)]:
        value = policy.get(key, default)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or (isinstance(value, float) and not math.isfinite(value))
                or value < 0 or (key == 'max_age_seconds' and value == 0)
                or (key == 'low_remaining_percent' and value > 100)):
            raise ValueError(f'{source}: invalid {key}')
    profiles = policy.get('profiles', {})
    if not isinstance(profiles, dict):
        raise ValueError(f'{source}: profiles must be an object')
    for key, row in profiles.items():
        provider, sep, identity = key.partition(':')
        if provider not in PROFILE_ENV or not sep or not identity or not isinstance(row, dict):
            raise ValueError(f'{source}: invalid profile {key!r}')
        if set(row) - {'profile', 'profile_mode', 'label', 'priority', 'min_remaining_percent', 'quota_source', 'discovery', 'expected_identity'}:
            raise ValueError(f'{source}: unknown profile fields for {key}')
        if not isinstance(row.get('profile'), str) or not Path(row['profile']).expanduser().is_absolute():
            raise ValueError(f'{source}: {key} requires an absolute profile directory')
        profile_selection({'provider': provider, **row})
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


def profile_selection(row):
    provider = row['provider']
    selector = PROFILE_ENV[provider]
    selection = {'env': {selector: row['profile']}, 'unset_env': list(UNSET_ENV[provider])}
    mode = row.get('profile_mode', 'directory')
    if mode not in ('directory', 'native-default'):
        raise ValueError('profile_mode must be directory or native-default')
    # Claude's native default must use its ordinary credential storage, not an
    # explicit directory override, even when that override spells the same path.
    if mode == 'native-default':
        if provider != 'claude' or Path(row['profile']).expanduser() != Path.home() / '.claude':
            raise ValueError('native-default requires the current home Claude default profile')
        selection['env'] = {}
        selection['unset_env'].append(selector)
        selection['native_default_profile'] = row['profile']
    return selection


def profile_environment(row):
    selection = profile_selection(row)
    env = os.environ.copy()
    for key in selection['unset_env']:
        env.pop(key, None)
    env.update(selection['env'])
    return env


def quota_cache_key(row, dependency):
    """Address a reading by launch identity and the tested reader contract."""
    contract = {
        'version': QUOTA_CACHE_CONTRACT, 'reader': dependency,
        'environment': hashlib.sha256(ACCOUNT_ENVIRONMENT_BYTES).hexdigest(),
        'account': row.get('key'), 'provider': row['provider'],
        'profile': str(Path(row['profile']).expanduser().resolve()),
        'profile_mode': row.get('profile_mode', 'directory'),
        'expected_identity': row.get('expected_identity', {}),
    }
    return hashlib.sha256(json.dumps(contract, sort_keys=True).encode()).hexdigest()


def quota_cache_path(key):
    if not isinstance(key, str) or len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
        raise ValueError('Invalid quota cache key')
    return Path.home() / '.furanku-skills/model-routing/quota-cache' / (key + '.json')


@contextmanager
def quota_cache_directory(key, *, create=False):
    """Open a trusted directory chain without following any symlinks.

    Descriptor-relative operations keep subsequent file access anchored to the
    checked directories. Hosts without ownership/no-follow support skip caching.
    """
    if (not hasattr(os, 'getuid') or not getattr(os, 'O_NOFOLLOW', 0)
            or not getattr(os, 'O_DIRECTORY', 0) or os.open not in os.supports_dir_fd):
        raise OSError('Private quota caching is unsupported on this filesystem interface')
    path = quota_cache_path(key)
    parts = path.parent.parts
    if not path.is_absolute() or any(part in ('.', '..') for part in parts):
        raise OSError('Unsafe quota cache path')
    uid = os.getuid()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(path.anchor, flags)
    try:
        for index, part in enumerate(parts):
            if index:
                try:
                    child = os.open(part, flags, dir_fd=descriptor)
                except FileNotFoundError:
                    if not create:
                        raise
                    try:
                        os.mkdir(part, mode=0o700, dir_fd=descriptor)
                    except FileExistsError:
                        pass
                    child = os.open(part, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            metadata = os.fstat(descriptor)
            mode = stat.S_IMODE(metadata.st_mode)
            private = index == len(parts) - 1
            sticky_root = metadata.st_uid == 0 and mode & stat.S_ISVTX
            if (metadata.st_uid not in (0, uid)
                    or (mode & 0o022 and not sticky_root)
                    or (private and (metadata.st_uid != uid or mode != 0o700))):
                raise OSError('Unsafe quota cache directory ownership or permissions')
        yield descriptor
    finally:
        os.close(descriptor)


def private_cache_file(metadata):
    return (stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
            and stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_nlink == 1)


def invalidate_quota_cache(row, dependency):
    """Remove a row's reading, or a binding's quota_cache_key, after a usage limit.

    Rows require provider, profile, optional key/profile_mode/expected_identity;
    bindings carry the opaque cache key emitted by binding(). False means the
    file could not be removed, so callers must bypass reuse with refresh=True.
    """
    key = row.get('quota_cache_key') or quota_cache_key(row, dependency)
    try:
        with quota_cache_directory(key) as directory:
            name = quota_cache_path(key).name
            metadata = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if not private_cache_file(metadata):
                return False
            os.unlink(name, dir_fd=directory)
        return True
    except FileNotFoundError:
        return True
    except OSError:
        return False


def cacheable_measurement(result, max_age, now):
    if (not isinstance(result, dict) or result.get('status') != 'known'
            or result.get('source') != 'codexbar' or result.get('report_only')
            or not isinstance(result.get('identity'), dict)
            or not result['identity'].get('email')
            or not fresh(result.get('refreshed_at'), max_age, now)):
        return False
    windows = result.get('windows')
    if not isinstance(windows, list) or not windows:
        return False
    for window in windows:
        if not isinstance(window, dict):
            return False
        value = window.get('percentRemaining')
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not 0 <= value <= 100
                or window.get('scope', 'all_models') not in
                ('all_models', 'model:fable', 'model:opus', 'model:sonnet', 'model:haiku')):
            return False
        # A crossed reset requires a new reading, never inferred headroom.
        reset = window.get('resetsAt')
        if reset is not None:
            try:
                if datetime.fromisoformat(stamp(reset).replace('Z', '+00:00')).timestamp() <= now.timestamp():
                    return False
            except (ValueError, TypeError, AttributeError, OverflowError):
                return False
    return any(w.get('scope', 'all_models') == 'all_models' for w in windows)


def read_quota_cache(key, max_age, now):
    try:
        with quota_cache_directory(key) as directory:
            descriptor = os.open(quota_cache_path(key).name,
                                 os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            with os.fdopen(descriptor, 'rb') as source:
                metadata = os.fstat(source.fileno())
                if not private_cache_file(metadata) or metadata.st_size > QUOTA_CACHE_MAX_BYTES:
                    return None
                payload = source.read(QUOTA_CACHE_MAX_BYTES + 1)
                if len(payload) > QUOTA_CACHE_MAX_BYTES:
                    return None
        result = json.loads(payload)
        return result if cacheable_measurement(result, max_age, now) else None
    except (OSError, ValueError, TypeError, RecursionError):
        return None


def write_quota_cache(key, result):
    # Persist quota facts only; vendor output and credentials never enter cache.
    facts = {field: result[field] for field in
             ('status', 'source', 'windows', 'refreshed_at', 'identity', 'data_confidence')
             if field in result}
    try:
        payload = json.dumps(facts, allow_nan=False).encode()
        if len(payload) > QUOTA_CACHE_MAX_BYTES:
            return
        with quota_cache_directory(key, create=True) as directory:
            name = quota_cache_path(key).name
            try:
                if not private_cache_file(os.stat(name, dir_fd=directory, follow_symlinks=False)):
                    return
            except FileNotFoundError:
                pass
            temporary = '.quota-' + secrets.token_hex(12)
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 mode=0o600, dir_fd=directory)
            try:
                with os.fdopen(descriptor, 'wb') as target:
                    target.write(payload)
                os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
            finally:
                try:
                    os.unlink(temporary, dir_fd=directory)
                except FileNotFoundError:
                    pass
    except (OSError, ValueError, TypeError, RecursionError):
        pass  # A cache failure never prevents a supported provider read.


def profile_measurement(row, dependency, *, refresh=False, inventory_rows=(),
                        max_age_seconds=DEFAULT_MAX_AGE_SECONDS, now=None):
    supplied_now = now
    now = now or datetime.now(timezone.utc)
    env = profile_environment(row)
    key = quota_cache_key(row, dependency)
    if refresh:
        invalidate_quota_cache({'quota_cache_key': key}, dependency)
    native = None
    if row['provider'] == 'claude':
        native = command_json(['claude', 'auth', 'status', '--json'], env, timeout=10)
        expected = row.get('expected_identity', {})
        if not native.get('loggedIn') or not native.get('email') or not native.get('orgId') or any(
            expected.get(key) and native.get(remote) != expected[key]
            for key, remote in [('email', 'email'), ('organizationUuid', 'orgId')]):
            raise ValueError('Claude profile is signed out or native identity does not match configured account')
    expected = row.get('expected_identity', {})
    if row['provider'] == 'codex' and not expected.get('email'):
        raise ValueError('Codex profile has no expected email; CodexBar selects Codex accounts by email')
    result = None if refresh else read_quota_cache(key, max_age_seconds, now)
    if result and native and result['identity'].get('organizationUuid') != native['orgId']:
        result = None
    cache_hit = result is not None
    if not cache_hit:
        # A failed refresh cannot leave an older success reusable on next launch.
        invalidate_quota_cache({'quota_cache_key': key}, dependency)
        if row['provider'] == 'codex':
            result = codexbar.read('codex', dependency, env, account_email=expected['email'])
        else:
            result = codexbar.read(row['provider'], dependency, env)
    identity = result.get('identity', {})
    if result['status'] == 'known':
        if any(expected.get(k) and identity.get(k) != expected[k] for k in ('email', 'organization')):
            raise ValueError('Measured identity does not match configured account')
        if native:
            measured_org = identity.get('organization')
            if identity.get('email') != native['email'] or (measured_org and measured_org != native.get('orgName')):
                raise ValueError('Measured identity does not match native Claude organization')
            if not measured_org and any(
                    other is not row and other['provider'] == 'claude'
                    and other.get('expected_identity', {}).get('email') == native['email']
                    and other.get('expected_identity', {}).get('organizationUuid') != native['orgId']
                    for other in inventory_rows):
                raise ValueError('Measured Claude identity is ambiguous: blank organization and another account shares the email')
            identity['organizationUuid'] = native['orgId']
    if not cache_hit and cacheable_measurement(result, max_age_seconds, supplied_now or datetime.now(timezone.utc)):
        write_quota_cache(key, result)
    row['quota_cache_key'] = key
    return result


def inventory(policy, dependency, now=None, *, refresh=False, providers=None, native_only_providers=()):
    validate(policy, 'account routing')
    supplied_now = now
    now = now or datetime.now(timezone.utc)
    rows = {}
    data = {}
    if policy.get('source') == 'orca':
        data = command_json([orca_command(policy), 'account', 'list', '--json'])['result']
        for provider, group in data.items():
            if not isinstance(group, dict) or not isinstance(group.get('accounts'), list):
                continue
            for account in group['accounts']:
                identity = account['id']
                active = identity == group.get('activeAccountId')
                key = f'{provider}:{identity}'
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
        if (key == 'claude:system-default' and config.get('discovery') == 'configured'
                and not row.get('discovery') and row.get('profile_mode') == 'native-default'
                and policy.get('source') == 'orca'):
            group = data.get('claude', {})
            active_ids = group.get('activeAccountIdsByRuntime', {})
            active = active_ids.get('host', group.get('activeAccountId'))
            default_identity = {'email': group.get('systemDefaultEmail'), 'organizationUuid': group.get('systemDefaultOrganizationUuid')}
            expected = config.get('expected_identity', {})
            if (('host' in active_ids or 'activeAccountId' in group) and active is None
                    and group.get('systemDefaultHome') == row['profile']
                    and all(isinstance(value, str) and value.strip() for value in default_identity.values())
                    and not expected.get('providerAccountId')
                    and all(default_identity.get(field) == expected[field]
                            for field in ('email', 'organizationUuid') if expected.get(field))):
                row.update(active=True, host_active=True, launch_ready=True,
                           discovery={'source': 'orca', 'command': orca_command(policy), 'selection': 'system-default'},
                           expected_identity={**expected, **default_identity})
    codexbar.verify(dependency)
    def measure(row):
        if row.get('profile'):
            try:
                row['measurement'] = profile_measurement(row, dependency, refresh=refresh, inventory_rows=rows.values(),
                    max_age_seconds=policy.get('max_age_seconds', DEFAULT_MAX_AGE_SECONDS), now=supplied_now)
            except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
                row['measurement'] = {'status': 'unknown', 'windows': [], 'source': 'codexbar', 'detail': str(exc)}
        measurement = row.setdefault('measurement', {'status': 'unknown', 'windows': []})
        if measurement['status'] == 'known' and not fresh(measurement.get('refreshed_at'), policy.get('max_age_seconds', DEFAULT_MAX_AGE_SECONDS), supplied_now or datetime.now(timezone.utc)):
            measurement['status'] = 'stale'
            measurement['detail'] = '; '.join(filter(None, [measurement.get('detail'), 'Last successful reading exceeds the freshness limit']))
        if not row.get('profile'):
            measurement['detail'] = 'No launch profile configured for a CodexBar CLI read'
        row['priority'] = row.get('priority', 0)
        row['min_remaining_percent'] = row.get('min_remaining_percent', policy.get('low_remaining_percent', DEFAULT_RESERVE_PERCENT))
        return row
    with ThreadPoolExecutor(max_workers=4) as pool:
        selected_rows = [row for row in rows.values()
                         if (not policy.get('profiles') or row['key'] in policy['profiles'])
                         and (providers is None or row['provider'] in providers)
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
        (('ambiguous',), 'ambiguous organization'),
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
        if row['provider'] == provider and row.get('profile') and row.get('runtime') == 'host' and row.get('launch_ready', True) and row['measurement']['status'] == 'known' and not row['measurement'].get('report_only') and left is not None and left > 0:
            eligible.append(row)
    above_reserve = [r for r in eligible if remaining(r, model) > r['min_remaining_percent']]
    return min(above_reserve or eligible, key=lambda r: (-r['priority'], not r.get('active', False), -remaining(r, model), r['key'])) if eligible else None


def binding(row, max_age):
    result = {'key': row['key'], 'provider': row['provider'], 'id': row['id'], 'label': row['label'],
            **profile_selection(row),
            'environment_contract': {'path': str(ACCOUNT_ENVIRONMENT_PATH),
                                     'sha256': hashlib.sha256(ACCOUNT_ENVIRONMENT_BYTES).hexdigest()},
            'quota_identity': deepcopy(row['measurement'].get('identity', {})),
            'refreshed_at': row['measurement']['refreshed_at'], 'max_age_seconds': max_age}
    if row.get('quota_cache_key'):
        result['quota_cache_key'] = row['quota_cache_key']
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
        if m.get('report_only') and m.get('windows'):
            status = 'Unverified'
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
