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


def read(provider, dependency, env=None):
    if provider not in ('claude', 'codex'):
        return {'status': 'unknown', 'windows': [], 'source': 'codexbar',
                'detail': f'CodexBar routing adapter has no verified quota contract for {provider}'}
    raw = run([dependency['command'], 'usage', '--provider', provider, '--source', 'cli',
               '--format', 'json', '--no-credits'], env)
    try:
        return measurement(json.loads(raw), provider)
    except json.JSONDecodeError:
        raise ValueError('CodexBar returned invalid JSON') from None


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
    if record.get('source') not in ({'claude', 'cli'} if provider == 'claude' else {'codex-cli', 'cli'}):
        raise ValueError('CodexBar returned an unexpected source for the selected CLI profile')
    identity = usage.get('identity') or {}
    if not isinstance(identity, dict) or identity.get('providerID', provider) != provider:
        raise ValueError('CodexBar identity does not match provider')
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
        if not isinstance(window, dict):
            raise ValueError('CodexBar schema: invalid quota window')
        used = window.get('usedPercent')
        minutes = window.get('windowMinutes')
        if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used) or not 0 <= used <= 100:
            raise ValueError('CodexBar schema: invalid quota percentage')
        if minutes is not None and (isinstance(minutes, bool) or not isinstance(minutes, (int, float)) or not math.isfinite(minutes) or minutes <= 0):
            raise ValueError('CodexBar schema: invalid quota duration')
        windows.append({'id': key, 'label': label, 'scope': scope, 'percentRemaining': 100 - used,
                        'windowSeconds': minutes * 60 if minutes else None,
                        'resetsAt': window.get('resetsAt')})
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
