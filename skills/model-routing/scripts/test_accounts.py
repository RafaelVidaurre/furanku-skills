"""Account policy invariants; tool seams use synthetic, non-secret fixtures."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import accounts
import router

NOW = datetime(2026, 10, 13, 8, tzinfo=timezone.utc)
DEP = {'package': 'quota-axi', 'version': '0.1.61', 'schema_version': 5, 'account_schema_version': 6}


def row(identity, remaining=80, priority=0, status='known', active=False):
    return {'key': 'claude:' + identity, 'id': identity, 'provider': 'claude',
            'label': 'same@example.test', 'profile': '/profiles/' + identity,
            'priority': priority, 'min_remaining_percent': 0 if priority else 10,
            'active': active, 'runtime': 'host',
            'measurement': {'status': status, 'refreshed_at': NOW.isoformat(),
                            'windows': [{'id': 'session', 'percentRemaining': remaining}]}}


def test_priority_exhaustion_and_reset_preserve_account_identity():
    preferred, backup = row('five-hour', 2, 100), row('weekly', 90, active=True)
    report = {'accounts': [preferred, backup]}
    assert accounts.choose(report, 'claude', 'sonnet')['id'] == 'five-hour'
    preferred['measurement']['windows'][0]['percentRemaining'] = 0
    assert accounts.choose(report, 'claude', 'sonnet')['id'] == 'weekly'
    preferred['measurement']['status'] = 'stale'
    preferred['measurement']['windows'][0]['percentRemaining'] = 100
    assert accounts.choose(report, 'claude', 'sonnet')['id'] == 'weekly'
    preferred['measurement']['status'] = 'known'
    assert accounts.choose(report, 'claude', 'sonnet')['id'] == 'five-hour'


def test_reserve_keeps_active_until_low_and_never_uses_exhausted_week():
    active, other = row('active', 30, active=True), row('other', 100)
    report = {'accounts': [active, other]}
    assert accounts.choose(report, 'claude', 'sonnet')['id'] == 'active'
    active['measurement']['windows'][0]['percentRemaining'] = 10
    assert accounts.choose(report, 'claude', 'sonnet')['id'] == 'other'
    other['measurement']['windows'].append({'id': 'weekly', 'percentRemaining': 0})
    assert accounts.choose(report, 'claude', 'sonnet') is None


@pytest.mark.parametrize('bad', [None, float('nan'), -1, 101, True])
def test_unknown_or_invalid_allowance_is_never_eligible(bad):
    assert accounts.choose({'accounts': [row('bad', bad)]}, 'claude', 'sonnet') is None


def test_named_model_limit_binds_only_its_model():
    candidate = row('profile')
    candidate['measurement']['scopes'] = [
        {'scope': 'all_models', 'status': 'known', 'effectivePercentRemaining': 70},
        {'scope': 'model:sonnet', 'status': 'known', 'effectivePercentRemaining': 0}]
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'sonnet') is None
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'claude-sonnet-5-5') is None
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'haiku')['id'] == 'profile'


def test_orca_joins_inactive_quota_by_id_and_does_not_retain_deleted_profile():
    policy = {'source': 'orca', 'profiles': {f'claude:{i}': {'profile': '/profiles/' + i, 'quota_source': 'orca'} for i in ['one', 'two', 'removed']}}
    ts = NOW.timestamp() * 1000
    def usage(used, age=0):
        return {'status': 'ok', 'updatedAt': ts - age * 1000, 'session': {'usedPercent': used, 'windowMinutes': 300}}
    fixture = {'ok': True, 'result': {'claude': {'activeAccountId': 'one', 'accounts': [{'id': 'one', 'email': 'duplicate@example.test'}, {'id': 'two', 'email': 'duplicate@example.test'}]},
              'rateLimits': {'claude': usage(12), 'inactiveClaudeAccounts': [{'accountId': 'two', 'rateLimits': usage(99, 301)}]}}}
    with patch.object(accounts, 'command_json', return_value=fixture), patch.object(accounts, 'verify_claude_launch', return_value=True):
        report = accounts.inventory(policy, DEP, NOW)
    first, second = report['accounts']
    assert first['id'] == 'one' and accounts.remaining(first) == 88
    assert second['id'] == 'two' and accounts.remaining(second) == 1
    assert second['measurement']['status'] == 'stale'
    assert len(report['accounts']) == 2


def test_profile_only_probe_is_bound_and_does_not_inherit_other_credentials():
    candidate = row('quoted path')
    fixture = {'schemaVersion': 5, 'providers': [{'provider': 'claude', 'state': {'status': 'fresh', 'refreshedAt': NOW.isoformat()}, 'windows': [], 'quotaSemantics': {'status': 'known'}}]}
    with patch.dict(os.environ, {'CLAUDE_CODE_OAUTH_TOKEN': 'synthetic', 'ANTHROPIC_BASE_URL': 'https://example.test', 'QUOTA_AXI_SNAPSHOT': 'fixture'}), patch.object(accounts, 'command_json', return_value=fixture) as run:
        accounts.profile_measurement(candidate, DEP)
    argv, env = run.call_args.args
    assert '--profile-only' in argv and argv[argv.index('--provider') + 1] == 'claude'
    assert env['CLAUDE_CONFIG_DIR'] == '/profiles/quoted path'
    assert not {'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'QUOTA_AXI_SNAPSHOT'} & env.keys()


def test_profile_identity_mismatch_fails_closed(tmp_path):
    policy = {'source': 'orca', 'profiles': {'codex:one': {'profile': str(tmp_path)}}}
    fixture = {'result': {'codex': {'accounts': [{'id': 'one', 'email': 'one@example.test', 'providerAccountId': 'expected'}]}}}
    reading = {'source': 'quota-axi', 'status': 'known', 'refreshed_at': NOW.isoformat(), 'windows': [], 'identity': {'email': 'one@example.test', 'accountId': 'different'}}
    with patch.object(accounts, 'command_json', return_value=fixture), patch.object(accounts, 'profile_measurement', return_value=reading):
        report = accounts.inventory(policy, DEP, NOW)
    assert report['accounts'][0]['measurement']['status'] == 'unknown'


def test_router_uses_selected_account_not_parent_account_exhaustion():
    runtime = {'harnesses': {'claude': {'status': 'auth-required', 'quota': {'status': 'exhausted'}}}, 'account_inventory': {'accounts': [row('healthy', 50)]}, 'account_max_age_seconds': 300}
    candidate = {'launch': {'agent': 'claude', 'model': 'sonnet', 'effort': 'high'}}
    state = router.runtime_for(runtime, 'candidate', candidate)
    assert state['quota']['status'] == 'known'
    assert state['account_binding']['env'] == {'CLAUDE_CONFIG_DIR': '/profiles/healthy'}
    runtime['harnesses']['claude']['health'] = 'offline'
    assert router.runtime_for(runtime, 'candidate', candidate)['health'] == 'offline'
    runtime['account_inventory']['accounts'][0]['measurement']['status'] = 'unknown'
    assert router.runtime_for(runtime, 'candidate', candidate)['quota']['status'] == 'unavailable'
    candidate['quota_pool'] = {'provider': 'claude'}
    assert router.runtime_for(runtime, 'candidate', candidate)['quota']['status'] == 'pooled'


def test_multiple_quota_lanes_never_take_last_account(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('CLAUDE_CONFIG_DIR', '/profiles/one')
    def lane(path, amount):
        return {'provider': 'claude', 'accountLocator': {'path': path}, 'account': {'email': path}, 'state': {'status': 'fresh'},
                'quotaSemantics': {'status': 'known', 'effectiveAvailability': [{'scope': 'all_models', 'effectivePercentRemaining': amount}]}}
    snapshot = {'schemaVersion': DEP['schema_version'], 'providers': [lane('/profiles/one', 0), lane('/profiles/two', 100)]}
    runtime = router.quota_axi_runtime(snapshot, {})
    assert runtime['harnesses']['claude']['quota']['status'] == 'exhausted'
    assert router.quota_summary(runtime['harnesses']['claude'])['effective_percent_remaining'] == 0


def test_account_policy_is_private_whole_layer_override(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path / 'home'))
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex'))
    repo = tmp_path / 'repo'; repo.mkdir()
    global_file = tmp_path / 'home/.furanku-skills/model-routing/config.json'
    global_file.parent.mkdir(parents=True)
    global_file.write_text(json.dumps({'version': 4, 'routes': {}, 'account_routing': {'profiles': {'claude:one': {'profile': '/profiles/one'}}}}))
    local = repo / '.furanku-skills/model-routing/config.json';local.parent.mkdir(parents=True)
    local.write_text(json.dumps({'version': 4, 'routes': {}, 'account_routing': {'profiles': {}}}))
    assert router.compile_brief(repo)['account_routing'] == {'profiles': {}}


def test_orca_quota_does_not_prove_native_profile_authentication():
    candidate = row('one')
    candidate['expected_identity'] = {'email': 'one@example.test', 'organizationUuid': 'org-one'}
    with patch.object(accounts, 'command_json', return_value={'loggedIn': False}):
        assert not accounts.verify_claude_launch(candidate)
    with patch.object(accounts, 'command_json', return_value={'loggedIn': True, 'email': 'one@example.test', 'orgId': 'different'}):
        assert not accounts.verify_claude_launch(candidate)
    with patch.object(accounts, 'command_json', return_value={'loggedIn': True, 'email': 'one@example.test', 'orgId': 'org-one'}):
        assert accounts.verify_claude_launch(candidate)
    candidate['launch_ready'] = False
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'sonnet') is None


def test_keychain_lanes_require_the_exact_profile_and_do_not_prompt():
    candidate = row('keychain-profile')
    candidate['quota_source'] = 'quota-axi-keychain'
    fixture = {'schemaVersion': 6, 'providers': [
        {'provider': 'claude', 'accountLocator': {'path': '/different'}, 'state': {'status': 'fresh'}, 'quotaSemantics': {'status': 'known'}},
        {'provider': 'claude', 'accountLocator': {'path': candidate['profile']}, 'state': {'status': 'error', 'error': 'keychain_prompt_required'}, 'quotaSemantics': {'status': 'unknown'}}]}
    with patch.object(accounts, 'command_json', return_value=fixture) as run:
        reading = accounts.profile_measurement(candidate, DEP)
    assert reading['status'] == 'unknown'
    assert reading['detail'] == 'keychain_prompt_required'
    argv, env = run.call_args.args
    assert '--allow-keychain-prompt' not in argv
    assert '--no-credential-refresh' in argv
    assert argv[argv.index('--max-age') + 1] == '90s'
    assert env['QUOTA_AXI_CLAUDE_PROFILES'] == candidate['profile']
    fixture['providers'].pop()
    with patch.object(accounts, 'command_json', return_value=fixture), pytest.raises(ValueError):
        accounts.profile_measurement(candidate, DEP)


@pytest.mark.parametrize('command', ['accounts', 'list'])
def test_account_report_requests_live_read_and_surfaces_failed_refresh(tmp_path, monkeypatch, capsys, command):
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex'))
    config = tmp_path / '.furanku-skills/model-routing/config.json'
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({'version': 4, 'routes': {}, 'account_routing': {
        'profiles': {'claude:one': {'profile': '/profiles/one', 'quota_source': 'quota-axi-keychain'}}}}))
    # Provider still returns a historical window after a failed refresh. It must
    # remain unavailable in the report and unusable by selection.
    fixture = {'schemaVersion': 6, 'providers': [{
        'provider': 'claude', 'accountLocator': {'path': '/profiles/one'},
        'state': {'status': 'error', 'error': 'rate_limited', 'refreshedAt': NOW.isoformat()},
        'windows': [{'id': 'five_hour', 'percentRemaining': 90}],
        'quotaSemantics': {'status': 'known', 'effectiveAvailability': [
            {'scope': 'all_models', 'effectivePercentRemaining': 90}]}}]}
    with patch.object(accounts, 'command_json', return_value=fixture) as run:
        assert router.main([command, '--repo', str(tmp_path), '--format', 'json']) == 0
    report = json.loads(capsys.readouterr().out)
    argv, env = run.call_args.args
    assert argv[argv.index('--max-age') + 1] == '0'
    assert env['QUOTA_AXI_CLAUDE_PROFILES'] == '/profiles/one'
    assert accounts.choose(report, 'claude', 'sonnet') is None
    rendered = accounts.render(report)
    assert 'Unavailable' in rendered and 'rate_limited' in rendered
    assert 'historical' in rendered


def test_snapshot_only_report_explains_why_it_cannot_refresh():
    fixture = {'result': {'claude': {'accounts': [{'id': 'one'}], 'activeAccountId': 'one'},
                         'rateLimits': {'claude': {'status': 'ok', 'updatedAt': (NOW.timestamp() - 301) * 1000,
                                                  'session': {'usedPercent': 20}}}}}
    with patch.object(accounts, 'command_json', return_value=fixture):
        report = accounts.inventory({'source': 'orca'}, DEP, NOW, refresh=True)
    rendered = accounts.render(report)
    assert 'Stale' in rendered
    assert 'No launch profile configured' in rendered
    assert 'exceeds the freshness limit' in rendered


def test_report_has_one_safe_table_row_per_account_and_distinct_short_ids():
    first, second = row('12345678-first'), row('12345678-second')
    first['label'] = 'unsafe|label\n<br>newline'
    first['measurement']['windows'].append({'id': 'weekly', 'percentRemaining': 10, 'resetsAt': '2026-10-14T11:00:00+01:00'})
    report = {'captured_at': NOW.isoformat(), 'accounts': [first, second]}
    rendered = accounts.render(report)
    assert len([line for line in rendered.splitlines() if line.startswith('| Claude |')]) == 2
    assert '12345678-f' in rendered and '12345678-s' in rendered
    assert 'unsafe\\|label &lt;br&gt;newline' in rendered
    assert 'session: 80%<br>weekly: 10%' in rendered
    assert 'weekly: Oct 14 10:00' in rendered
