"""CodexBar boundary: captured-shape fixtures, real process/environment, routing gates.

Synthetic identities; no vendor endpoints or user profiles are accessed.
"""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

import pytest
import accounts
import codexbar
import router

DEP = router.runtime_dependency('codexbar')


def payload(provider='codex', used=20):
    return [{'provider': provider, 'source': 'codex-cli' if provider == 'codex' else 'claude',
             'rateWindowLabels': {'primary': 'Session', 'secondary': 'Weekly'},
             'usage': {'updatedAt': datetime.now(timezone.utc).isoformat(),
                       'identity': {'providerID': provider, 'accountEmail': 'user@example.test',
                                    'accountOrganization': 'Personal'},
                       'primary': None, 'secondary': {'usedPercent': used, 'windowMinutes': 10080},
                       'tertiary': None}}]


def test_weekly_only_is_reported_without_invented_session_or_account_id():
    reading = codexbar.measurement(payload(), 'codex')
    assert reading['status'] == 'known'
    assert len(reading['windows']) == 1
    assert reading['windows'][0]['percentRemaining'] == 80
    assert 'accountId' not in reading['identity']


def test_general_week_exhaustion_cannot_be_overridden_by_model_headroom():
    raw = payload('claude', 100)
    raw[0]['usage'].update(primary={'usedPercent': 0, 'windowMinutes': 300},
        extraRateWindows=[{'id': 'claude-weekly-scoped-fable', 'title': 'Fable only',
                           'window': {'usedPercent': 0, 'windowMinutes': 10080}}])
    m = codexbar.measurement(raw, 'claude')
    assert accounts.remaining({'measurement': m}, 'claude-fable-5') == 0
    raw[0]['usage']['secondary']['usedPercent'] = 20
    raw[0]['usage']['extraRateWindows'][0]['window']['usedPercent'] = 100
    m = codexbar.measurement(raw, 'claude')
    assert accounts.remaining({'measurement': m}, 'claude-fable-5') == 0
    assert accounts.remaining({'measurement': m}, 'claude-sonnet-5-5') == 80


@pytest.mark.parametrize('value', [None, True, '20', -1, 101, float('nan'), float('inf')])
def test_malformed_window_never_authorizes_launch(value):
    raw = payload(); raw[0]['usage']['secondary']['usedPercent'] = value
    with pytest.raises(ValueError, match='percentage'):
        codexbar.measurement(raw, 'codex')


@pytest.mark.parametrize('change', ['missing', 'tertiary', 'scope', 'email', 'source', 'extra-account'])
def test_unusable_contract_is_explicit(change):
    raw = payload()
    if change == 'missing': raw[0]['usage']['secondary'] = None
    if change == 'tertiary': raw[0]['usage']['tertiary'] = {'usedPercent': 0}
    if change == 'scope': raw[0]['usage']['extraRateWindows'] = [{'id': 'unknown', 'window': {'usedPercent': 0}}]
    if change == 'email': raw[0]['usage']['identity'].pop('accountEmail')
    if change == 'source': raw[0]['source'] = 'web'
    if change == 'extra-account': raw.append(deepcopy(raw[0]))
    try:
        assert codexbar.measurement(raw, 'codex')['status'] == 'unknown'
    except ValueError:
        assert change in ('email', 'source', 'extra-account')


def test_cli_error_ignores_cached_usage_and_is_not_retried():
    raw = payload(); raw[0]['error'] = {'message': 'HTTP 429: rate limited', 'kind': 'provider'}
    with patch.object(codexbar, 'run', return_value=json.dumps(raw)) as run:
        m = codexbar.read('codex', DEP)
    assert run.call_count == 1 and m['status'] == 'unknown' and m['windows'] == []
    assert '429' in m['detail']


def test_native_organization_preflight_and_measured_name_must_match():
    row = {'provider': 'claude', 'profile': '/synthetic/profile',
           'expected_identity': {'email': 'user@example.test', 'organizationUuid': 'org-personal'}}
    status = {'loggedIn': True, 'email': 'user@example.test', 'orgId': 'org-team', 'orgName': 'Team'}
    with patch.object(accounts, 'command_json', return_value=status), patch.object(codexbar, 'read') as read:
        with pytest.raises(ValueError, match='identity'):
            accounts.profile_measurement(row, DEP)
        read.assert_not_called()
    status.update(orgId='org-personal', orgName='Personal')
    with patch.object(accounts, 'command_json', return_value=status), patch.object(codexbar, 'read', return_value=codexbar.measurement(payload('claude'), 'claude')):
        assert accounts.profile_measurement(row, DEP)['identity']['organizationUuid'] == 'org-personal'
        status['orgName'] = 'Team'
        with pytest.raises(ValueError, match='organization'):
            accounts.profile_measurement(row, DEP)
    personal = payload('claude')
    personal[0]['usage'].pop('accountOrganization', None)
    personal[0]['usage'].get('identity', {}).pop('accountOrganization', None)
    status.update(orgName="user@example.test's Organization")
    with patch.object(accounts, 'command_json', return_value=status), patch.object(codexbar, 'read', return_value=codexbar.measurement(personal, 'claude')):
        assert accounts.profile_measurement(row, DEP)['identity']['organizationUuid'] == 'org-personal'
    personal[0]['usage']['accountEmail'] = 'other@example.test'
    personal[0]['usage'].get('identity', {}).pop('accountEmail', None)
    with patch.object(accounts, 'command_json', return_value=status), patch.object(codexbar, 'read', return_value=codexbar.measurement(personal, 'claude')):
        with pytest.raises(ValueError, match='does not match'):
            accounts.profile_measurement(row, DEP)


def test_codex_profile_identity_mismatch_refuses_without_binding():
    policy = {'profiles': {'codex:one': {'profile': '/synthetic/one', 'expected_identity': {'email': 'other@example.test'}}}}
    with patch.object(codexbar, 'verify'), patch.object(codexbar, 'read', return_value=codexbar.measurement(payload(), 'codex')):
        report = accounts.inventory(policy, DEP)
    assert accounts.choose(report, 'codex', 'test') is None
    assert 'identity' in report['accounts'][0]['measurement']['detail']


def test_orca_snapshots_are_ignored_and_independent_profile_is_explicit():
    policy = {'source': 'orca', 'profiles': {
        'codex:one': {'profile': '/synthetic/one'}, 'codex:removed': {'profile': '/synthetic/removed'},
        'codex:personal': {'profile': '/synthetic/personal', 'discovery': 'configured'}}}
    discovery = {'result': {'codex': {'activeAccountId': 'one', 'accounts': [{'id': 'one'}]},
                           'rateLimits': {'codex': {'status': 'ok', 'session': {'usedPercent': 0}}}}}
    with patch.object(codexbar, 'verify'), patch.object(accounts, 'command_json', return_value=discovery), patch.object(codexbar, 'read', return_value={'status': 'unknown', 'windows': [], 'detail': 'unavailable'}):
        report = accounts.inventory(policy, DEP)
    assert {r['id'] for r in report['accounts']} == {'one', 'personal'}
    assert accounts.choose(report, 'codex', 'test') is None


@pytest.mark.parametrize('fault', [None, 'directory', 'active-managed', 'home', 'identity', 'missing-metadata', 'missing-selection', 'auth', 'quota', 'organization', 'organization-mismatch', 'provider-id', 'registered', 'removed', 'other-key'])
def test_orca_default_selection_requires_explicit_profile_and_measured_identity(tmp_path, monkeypatch, fault):
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex'))
    profile = str(tmp_path / '.claude')
    config = {'profile': profile, 'profile_mode': 'native-default', 'discovery': 'configured',
              'expected_identity': {'email': 'user@example.test', 'organizationUuid': 'org-personal'}}
    group = {'accounts': [], 'activeAccountId': None, 'activeAccountIdsByRuntime': {'host': None},
             'systemDefaultHome': profile, 'systemDefaultEmail': 'user@example.test',
             'systemDefaultOrganizationUuid': 'org-personal', 'systemDefaultMayBeCopied': True}
    native = {'loggedIn': True, 'email': 'user@example.test', 'orgId': 'org-personal', 'orgName': 'Personal'}
    if fault == 'directory': config['profile_mode'] = 'directory'
    elif fault == 'active-managed': group['activeAccountIdsByRuntime']['host'] = 'managed'
    elif fault == 'home': group['systemDefaultHome'] = '/synthetic/other-home/.claude'
    elif fault == 'identity': config['expected_identity']['email'] = 'other@example.test'
    elif fault == 'missing-metadata': del group['systemDefaultOrganizationUuid']
    elif fault == 'missing-selection':
        del group['activeAccountId']
        del group['activeAccountIdsByRuntime']
    elif fault == 'auth': native['orgId'] = 'other-org'
    elif fault == 'organization': config['expected_identity']['organization'] = 'Personal'
    elif fault == 'organization-mismatch': config['expected_identity']['organization'] = 'Other'
    elif fault == 'provider-id': config['expected_identity']['providerAccountId'] = 'unprovable'
    elif fault == 'registered':
        group['accounts'] = [{'id': 'system-default', 'email': 'registered@example.test', 'organizationUuid': 'registered-org'}]
        config.pop('expected_identity')
    elif fault == 'removed': config['discovery'] = 'orca'
    measurement = {'status': 'unknown', 'windows': []} if fault == 'quota' else codexbar.measurement(payload('claude'), 'claude')
    policy = {'source': 'orca', 'orca_command': 'synthetic-orca', 'profiles': {'claude:other' if fault in ['removed', 'other-key'] else 'claude:system-default': config}}
    def command(args, *rest, **kwargs):
        if args == ['synthetic-orca', 'account', 'list', '--json']: return {'result': {'claude': group}}
        assert args == ['claude', 'auth', 'status', '--json']
        return native
    with patch.object(codexbar, 'verify'), patch.object(accounts, 'command_json', side_effect=command), patch.object(codexbar, 'read', return_value=measurement) as read:
        report = accounts.inventory(policy, DEP, providers=['claude'], native_only_providers=['claude'])
    chosen = accounts.choose(report, 'claude', 'opus', native_only=True)
    if fault in [None, 'organization']:
        assert chosen['id'] == 'system-default'
        assert chosen['discovery'] == {'source': 'orca', 'command': 'synthetic-orca', 'selection': 'system-default'}
        assert accounts.binding(chosen, 300)['native_default_profile'] == profile
        assert chosen['measurement']['identity']['organizationUuid'] == 'org-personal'
        if fault == 'organization': assert chosen['expected_identity']['organization'] == 'Personal'
    else:
        assert chosen is None
        if fault not in ['quota', 'organization-mismatch']: read.assert_not_called()


@pytest.mark.parametrize('source', ['quota-axi', 'quota-axi-keychain', 'orca'])
def test_legacy_quota_sources_require_explicit_migration(source):
    with pytest.raises(ValueError, match='retired quota source'):
        accounts.validate({'profiles': {'claude:one': {'profile': '/synthetic', 'quota_source': source}}}, 'test')


def test_stale_measurement_and_unsupported_provider_remain_unknown():
    m = codexbar.measurement(payload(), 'codex')
    m['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
    runtime = router.codexbar_runtime({'codex': m}, {})
    assert runtime['harnesses']['codex']['quota']['status'] == 'stale'
    with patch.object(codexbar, 'run') as run:
        assert codexbar.read('kimi', DEP)['status'] == 'unknown'
        run.assert_not_called()


def test_real_process_receives_exact_profile_and_scrubbed_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic-secret')
    monkeypatch.setenv('OPENAI_BASE_URL', 'synthetic-endpoint')
    script = tmp_path / 'fake-codexbar'
    script.write_text('#!' + sys.executable + '\nimport os,sys,json\n'
        'assert sys.argv[1:] == ["usage","--provider","codex","--source","cli","--format","json","--no-credits"]\n'
        'assert os.environ["CODEX_HOME"] == "/synthetic/space profile"\n'
        'assert "OPENAI_API_KEY" not in os.environ and "OPENAI_BASE_URL" not in os.environ\n'
        'print(' + repr(json.dumps(payload())) + ')\n')
    script.chmod(0o700)
    result = accounts.profile_measurement({'provider': 'codex', 'profile': '/synthetic/space profile'}, {**DEP, 'command': str(script)})
    assert result['status'] == 'known'
    env = accounts.profile_environment({'provider': 'claude', 'profile': '/synthetic/claude'})
    assert not set(accounts.UNSET_ENV['claude']) & env.keys()


@pytest.mark.parametrize('native_default', [False, True])
def test_default_directory_keeps_explicit_and_native_selection_distinct(tmp_path, monkeypatch, native_default):
    monkeypatch.setenv('HOME', str(tmp_path / 'home'))
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex'))
    monkeypatch.setenv('CLAUDE_CONFIG_DIR', '/synthetic/ambient-profile')
    for name in accounts.UNSET_ENV['claude']:
        monkeypatch.setenv(name, 'synthetic-override')
    binary = tmp_path / 'bin'
    binary.mkdir()
    monkeypatch.setenv('PATH', str(binary) + os.pathsep + os.environ['PATH'])
    profile = str(Path.home() / '.claude')
    profile_check = 'assert \"CLAUDE_CONFIG_DIR\" not in os.environ\n' if native_default else 'assert os.environ.get(\"CLAUDE_CONFIG_DIR\") == ' + repr(profile) + '\n'
    check_env = (profile_check +
                 'assert not set(' + repr(accounts.UNSET_ENV['claude']) + ') & os.environ.keys()\n')
    status = {'loggedIn': True, 'email': 'user@example.test', 'orgId': 'org-personal', 'orgName': 'Personal'}
    for name, args, output in [
        ('claude', ['auth', 'status', '--json'], status),
        ('fake-codexbar', ['usage', '--provider', 'claude', '--source', 'cli', '--format', 'json', '--no-credits'], payload('claude')),
    ]:
        script = binary / name
        script.write_text('#!' + sys.executable + '\nimport os,sys,json\n' + check_env +
                          'assert sys.argv[1:] == ' + repr(args) + '\nprint(' + repr(json.dumps(output)) + ')\n')
        script.chmod(0o700)
    row = {'key': 'claude:default', 'id': 'default', 'provider': 'claude', 'label': 'Synthetic default',
           'profile': profile, 'profile_mode': 'native-default' if native_default else 'directory', 'expected_identity': {'email': 'user@example.test', 'organizationUuid': 'org-personal'}}
    row['measurement'] = accounts.profile_measurement(row, {**DEP, 'command': str(binary / 'fake-codexbar')})
    assert row['measurement']['status'] == 'known'
    assert row['measurement']['identity']['organizationUuid'] == 'org-personal'
    binding = accounts.binding(row, 300)
    if native_default:
        assert binding['env'] == {}
        assert binding['native_default_profile'] == profile
        assert 'CLAUDE_CONFIG_DIR' in binding['unset_env']
    else:
        assert binding['env'] == {'CLAUDE_CONFIG_DIR': profile}
        assert 'native_default_profile' not in binding
        assert 'CLAUDE_CONFIG_DIR' not in binding['unset_env']


def test_timeout_ends_owned_process_and_reports_failure(tmp_path):
    marker = tmp_path / 'finished'
    with pytest.raises(ValueError, match='timed out'):
        codexbar.run([sys.executable, '-c', 'import time,pathlib; time.sleep(10); pathlib.Path(' + repr(str(marker)) + ').touch()'], timeout=0.05)
    assert not marker.exists()


def test_version_mismatch_is_not_silently_accepted():
    with patch.object(codexbar, 'run', return_value='CodexBar 0.76.0'), pytest.raises(ValueError, match='version mismatch'):
        codexbar.verify(DEP)


def test_proxy_quota_keeps_billing_provider_and_model_limits():
    m = codexbar.measurement(payload(), 'codex')
    candidates = {'proxy': {'launch': {'agent': 'claude', 'model': 'gpt-test'},
                            'quota_provider': {'provider': 'codex'}, 'quota_account': 'codex'}}
    runtime = router.codexbar_runtime({'codex': m}, candidates)
    state = router.runtime_for(runtime, 'proxy', candidates['proxy'])
    assert state['quota']['account']['provider'] == 'codex'
    assert state['quota']['effective_percent_remaining'] == 80
    reasons, _ = router.gate('proxy', candidates['proxy'], runtime, expected_accounts={'codex': 'different@example.test'})
    assert any('measured for account' in reason for reason in reasons)
