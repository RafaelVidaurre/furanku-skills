"""Translate official CodexBar CLI output; never fetch provider APIs ourselves."""
import json
import math
import os
import signal
import subprocess


def run(argv, env=None, timeout=120):
    # Own the process group so a timeout also ends CLI probe children.
    proc = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, start_new_session=True)
    try:
        stdout, _stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
        raise ValueError(f'CodexBar timed out after {timeout:g} seconds') from None
    if proc.returncode not in (0, 1) or not stdout.strip():
        raise ValueError(f'CodexBar failed (exit {proc.returncode}); run the same CLI command for diagnostics')
    return stdout


def verify(dependency):
    version = run([dependency['command'], '--version'], timeout=10).strip()
    if version != 'CodexBar ' + dependency['version']:
        raise ValueError(f"CodexBar version mismatch; install tested version {dependency['version']}")


def read(provider, dependency, env=None, *, account_email=None):
    if provider not in ('claude', 'codex', 'cursor'):
        return {'status': 'unknown', 'windows': [], 'source': 'codexbar',
                'detail': f'CodexBar routing adapter has no verified quota contract for {provider}'}
    source = 'auto' if provider == 'cursor' else 'cli'
    argv = [dependency['command'], 'usage', '--provider', provider, '--source', source,
            '--format', 'json', '--no-credits']
    # CodexBar reads Codex quota for its own selected account and ignores CODEX_HOME,
    # so a profile's reading is picked by email from every account CodexBar lists.
    if account_email is not None:
        argv.insert(-3, '--all-accounts')
    try:
        payload = json.loads(run(argv, env))
    except json.JSONDecodeError:
        raise ValueError('CodexBar returned invalid JSON') from None
    if account_email is None:
        return measurement(payload, provider)
    if not isinstance(payload, list):
        raise ValueError('CodexBar schema: expected a list of accounts')
    matches = [record for record in payload if record_email(record) == account_email]
    if len(matches) != 1:
        return {'status': 'unknown', 'windows': [], 'source': 'codexbar', 'detail': (
            'CodexBar lists several accounts with this email; quota cannot be attributed' if matches
            else 'CodexBar lists no account with this email; add the account to CodexBar')}
    return measurement(matches, provider)


def record_email(record):
    if not isinstance(record, dict):
        return None
    usage = record.get('usage') if isinstance(record.get('usage'), dict) else {}
    identity = usage.get('identity') if isinstance(usage.get('identity'), dict) else {}
    return identity.get('accountEmail') or usage.get('accountEmail') or record.get('account')


def quota_window(key, window, label, scope):
    if not isinstance(window, dict):
        raise ValueError('CodexBar schema: invalid quota window')
    used = window.get('usedPercent')
    minutes = window.get('windowMinutes')
    if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used) or not 0 <= used <= 100:
        raise ValueError('CodexBar schema: invalid quota percentage')
    if minutes is not None and (isinstance(minutes, bool) or not isinstance(minutes, (int, float)) or not math.isfinite(minutes) or minutes <= 0):
        raise ValueError('CodexBar schema: invalid quota duration')
    return {'id': key, 'label': label, 'scope': scope, 'percentRemaining': 100 - used,
            'windowSeconds': minutes * 60 if minutes else None,
            'resetsAt': window.get('resetsAt')}


def cursor_measurement(record, usage, identity, result):
    if record.get('source') != 'web':
        raise ValueError('CodexBar returned an unexpected Cursor source')
    account_id = identity.get('accountID')
    email = identity.get('accountEmail') or usage.get('accountEmail')
    if not any(isinstance(v, str) and v.strip() for v in (account_id, email)):
        raise ValueError('CodexBar returned no measured Cursor account identity')
    result.update(refreshed_at=usage.get('updatedAt'), report_only=True,
                  identity={k: v for k, v in {
                      'account_id': account_id, 'email': email,
                      'login_method': identity.get('loginMethod') or usage.get('loginMethod'),
                  }.items() if isinstance(v, str) and v.strip()})
    labels = record.get('rateWindowLabels') or {}
    if not isinstance(labels, dict):
        raise ValueError('CodexBar schema: invalid Cursor window labels')
    for key, label, scope in (('primary', 'Total', 'all_models'),
                              ('secondary', 'Cursor', 'cursor_models'),
                              ('tertiary', 'Third Party', 'third_party')):
        if usage.get(key) is None:
            continue
        if labels.get(key) != label:
            raise ValueError('CodexBar schema: unmapped Cursor quota window')
        result['windows'].append(quota_window(key, usage[key], label, scope))
    result['detail'] = (
        'Cursor web account usage is report-only; its identity and model entitlement '
        'have not been verified against the launch CLI account'
    )
    if usage.get('extraRateWindows'):
        result['detail'] += '; additional Cursor windows are unmapped'
    return result


def measurement(payload, provider):
    if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict) or payload[0].get('provider') != provider:
        raise ValueError('CodexBar must return exactly the requested provider/account')
    record = payload[0]
    result = {'status': 'unknown', 'source': 'codexbar', 'windows': [], 'refresh_attempts': 1}
    error = record.get('error')
    if error:
        result['detail'] = error.get('message', 'CodexBar provider error') if isinstance(error, dict) else 'CodexBar provider error'
        return result
    usage = record.get('usage')
    if not isinstance(usage, dict):
        raise ValueError('CodexBar schema: missing usage object')
    identity = usage.get('identity') or {}
    if not isinstance(identity, dict) or identity.get('providerID', provider) != provider:
        raise ValueError('CodexBar identity does not match provider')
    if provider == 'cursor':
        return cursor_measurement(record, usage, identity, result)
    if record.get('source') not in ({'claude', 'cli'} if provider == 'claude' else {'codex-cli', 'cli'}):
        raise ValueError('CodexBar returned an unexpected source for the selected CLI profile')
    email = identity.get('accountEmail') or usage.get('accountEmail')
    org = identity.get('accountOrganization') or usage.get('accountOrganization')
    if not isinstance(email, str) or not email.strip():
        raise ValueError('CodexBar returned no measured account identity')
    for field in ('accountEmail', 'accountOrganization'):
        if identity.get(field) and usage.get(field) and identity[field] != usage[field]:
            raise ValueError('CodexBar returned conflicting account identity')
    result.update(refreshed_at=usage.get('updatedAt'), identity={'email': email, 'organization': org},
                  data_confidence=usage.get('dataConfidence'))
    labels = record.get('rateWindowLabels') or {}
    if not isinstance(labels, dict):
        raise ValueError('CodexBar schema: invalid window labels')
    windows = []
    def add(key, window, label, scope):
        windows.append(quota_window(key, window, label, scope))
    for key in ('primary', 'secondary'):
        if usage.get(key) is not None:
            add(key, usage[key], labels.get(key, key), 'all_models')
    if usage.get('tertiary') is not None:
        # Semantics vary by provider/version; never silently discard a limit.
        result['detail'] = 'CodexBar returned an unmapped tertiary quota window'
        return result
    extras = usage.get('extraRateWindows') or []
    if not isinstance(extras, list):
        raise ValueError('CodexBar schema: invalid extra rate windows')
    for extra in extras:
        if not isinstance(extra, dict):
            raise ValueError('CodexBar schema: invalid extra rate window')
        key = extra.get('id', '')
        family = key.removeprefix('claude-weekly-scoped-')
        if provider != 'claude' or key == family or family not in ('fable', 'opus', 'sonnet', 'haiku'):
            result['detail'] = 'CodexBar returned an unmapped scoped quota window'
            return result
        add(key, extra.get('window'), extra.get('title', key), 'model:' + family)
    result['windows'] = windows
    if not windows or not any(w['scope'] == 'all_models' for w in windows):
        result['detail'] = 'CodexBar reported no general quota windows'
    else:
        result['status'] = 'known'
    return result
