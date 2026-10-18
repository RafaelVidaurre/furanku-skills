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
DEP = router.runtime_dependency('codexbar')


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
    candidate['measurement']['windows'] = [
        {'id': 'session', 'scope': 'all_models', 'percentRemaining': 70},
        {'id': 'sonnet', 'scope': 'model:sonnet', 'percentRemaining': 0}]
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'sonnet') is None
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'claude-sonnet-5-5') is None
    assert accounts.choose({'accounts': [candidate]}, 'claude', 'haiku')['id'] == 'profile'


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


def test_native_launch_filters_before_priority_and_never_borrows_duplicate_quota():
    inactive = row('priority', 99, 100)
    active = row('active', 40, active=True)
    for account in (inactive, active):
        account['discovery'] = {'source': 'orca', 'command': 'orca'}
    report = {'accounts': [inactive, active]}
    assert accounts.choose(report, 'claude', 'opus')['id'] == 'priority'
    assert accounts.choose(report, 'claude', 'opus', native_only=True)['id'] == 'active'
    runtime = {'account_inventory': report, 'account_max_age_seconds': 300,
               'native_account_only': ['claude']}
    candidate = {'launch': {'agent': 'claude', 'model': 'opus'}}
    state = router.runtime_for(runtime, 'fixture', candidate)
    assert state['account_binding']['id'] == 'active'
    assert state['quota']['effective_percent_remaining'] == 40
    active['measurement']['status'] = 'stale'
    assert accounts.choose(report, 'claude', 'opus', native_only=True) is None
    assert router.runtime_for(runtime, 'fixture', candidate)['quota']['status'] == 'unavailable'
    active['measurement']['status'] = 'known'
    active.pop('discovery')
    assert accounts.choose(report, 'claude', 'opus', native_only=True) is None


def test_native_launch_cannot_fall_back_to_unattributed_provider_quota():
    state = router.runtime_for({'native_account_only': ['claude'],
        'harnesses': {'claude': {'quota': {'status': 'known', 'effective_percent_remaining': 99}}}},
        'fixture', {'launch': {'agent': 'claude', 'model': 'opus'}})
    assert state['quota']['status'] == 'unavailable'
