"""Private disk cache contracts with synthetic readers and real temporary files."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
import stat
from unittest.mock import patch

import pytest
import accounts

NOW = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)
DEP = {'command': 'synthetic-codexbar', 'version': 'test'}


@pytest.fixture(autouse=True)
def private_home(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path / 'home'))
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex'))


def profile(provider='codex'):
    return {'key': provider + ':one', 'id': 'one', 'provider': provider,
            'label': 'Synthetic', 'profile': '/synthetic/profile',
            'expected_identity': {'email': 'user@example.test'}}


def reading():
    return {'status': 'known', 'source': 'codexbar', 'refreshed_at': NOW.isoformat(),
            'identity': {'email': 'user@example.test', 'organization': 'Personal'},
            'windows': [{'id': 'weekly', 'scope': 'all_models', 'percentRemaining': 70},
                        {'id': 'sonnet', 'scope': 'model:sonnet', 'percentRemaining': 0}]}


def test_repeated_launch_reuses_original_measurement_and_model_windows():
    row = profile()
    with patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        accounts.profile_measurement(row, DEP, now=NOW)
        cached = accounts.profile_measurement(row, DEP, now=NOW + timedelta(seconds=1799))
        assert read.call_count == 1
        assert cached['refreshed_at'] == NOW.isoformat()
        assert accounts.remaining({'measurement': cached}, 'sonnet') == 0
        assert accounts.remaining({'measurement': cached}, 'haiku') == 70
        path = accounts.quota_cache_path(row['quota_cache_key'])
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
        accounts.profile_measurement(row, DEP, now=NOW + timedelta(seconds=1801))
        assert read.call_count == 2


def test_read_completed_after_collection_started_is_reusable():
    row, fresh = profile(), reading()
    fresh['refreshed_at'] = (NOW + timedelta(milliseconds=500)).isoformat()
    with patch.object(accounts, 'datetime', wraps=datetime) as clock, \
            patch.object(accounts.codexbar, 'read', return_value=fresh) as read:
        clock.now.side_effect = [NOW, NOW + timedelta(seconds=1), NOW + timedelta(seconds=2)]
        accounts.profile_measurement(row, DEP)
        accounts.profile_measurement(row, DEP)
        assert read.call_count == 1


@pytest.mark.parametrize('change', ['profile', 'account', 'identity', 'reader', 'contract'])
def test_account_or_reader_contract_changes_cannot_borrow_cached_reading(change):
    row, dep = profile(), deepcopy(DEP)
    with patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        accounts.profile_measurement(row, dep, now=NOW)
        if change == 'profile': row['profile'] = '/synthetic/other'
        if change == 'account': row['key'] = 'codex:other'
        if change == 'identity': row['expected_identity']['email'] = 'other@example.test'
        if change == 'reader': dep['version'] = 'changed'
        with patch.object(accounts, 'QUOTA_CACHE_CONTRACT', 2 if change == 'contract' else 1):
            if change == 'identity':
                with pytest.raises(ValueError, match='identity'):
                    accounts.profile_measurement(row, dep, now=NOW)
            else:
                accounts.profile_measurement(row, dep, now=NOW)
        assert read.call_count == 2


def test_shorter_explicit_freshness_and_crossed_reset_require_new_readings():
    row = profile()
    fresh = reading()
    fresh['windows'][0]['resetsAt'] = (NOW + timedelta(seconds=120)).isoformat()
    with patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: deepcopy(fresh)) as read:
        accounts.profile_measurement(row, DEP, now=NOW)
        accounts.profile_measurement(row, DEP, now=NOW + timedelta(seconds=61), max_age_seconds=60)
        assert read.call_count == 2
        accounts.profile_measurement(row, DEP, now=NOW)
        accounts.profile_measurement(row, DEP, now=NOW + timedelta(seconds=121))
        assert read.call_count == 4


def test_force_refresh_failure_removes_old_success_and_binding_can_invalidate():
    row = profile()
    with patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        row['measurement'] = accounts.profile_measurement(row, DEP, now=NOW)
        binding = accounts.binding(row, accounts.DEFAULT_MAX_AGE_SECONDS)
        assert accounts.invalidate_quota_cache(binding, DEP)
        accounts.profile_measurement(row, DEP, now=NOW)
        assert read.call_count == 2
    unavailable = {'status': 'unknown', 'source': 'codexbar', 'windows': []}
    with patch.object(accounts.codexbar, 'read', return_value=unavailable) as read:
        assert accounts.profile_measurement(row, DEP, refresh=True, now=NOW)['status'] == 'unknown'
        assert accounts.profile_measurement(row, DEP, now=NOW)['status'] == 'unknown'
        assert read.call_count == 2
    assert not accounts.quota_cache_path(row['quota_cache_key']).exists()


def test_failed_invalidation_reports_that_recovery_must_bypass_cache():
    row = profile()
    path = accounts.quota_cache_path(accounts.quota_cache_key(row, DEP))
    accounts.write_quota_cache(accounts.quota_cache_key(row, DEP), reading())
    with patch.object(accounts.os, 'unlink', side_effect=PermissionError):
        assert accounts.invalidate_quota_cache(row, DEP) is False


@pytest.mark.parametrize('fault', ['corrupt', 'unreadable', 'unwritable', 'unverified', 'future',
                                 'invalid-window', 'huge-window', 'deep-json'])
def test_unusable_cache_degrades_to_reader_without_granting_headroom(fault):
    row = profile()
    key = accounts.quota_cache_key(row, DEP)
    facts = reading()
    if fault == 'unverified': facts['report_only'] = True
    if fault == 'future': facts['refreshed_at'] = (NOW + timedelta(seconds=1)).isoformat()
    if fault == 'invalid-window': facts['windows'][0]['percentRemaining'] = None
    if fault == 'huge-window': facts['windows'][0]['percentRemaining'] = 10 ** 1000
    path = accounts.quota_cache_path(key)
    accounts.write_quota_cache(key, reading())
    path.write_text('{' if fault == 'corrupt' else json.dumps(facts))
    if fault == 'deep-json': path.write_text('[' * 2000 + '0' + ']' * 2000)
    with patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        if fault == 'unreadable':
            path.chmod(0o000)
            result = accounts.profile_measurement(row, DEP, now=NOW)
        elif fault == 'unwritable':
            path.unlink()
            with patch.object(accounts.os, 'replace', side_effect=PermissionError):
                result = accounts.profile_measurement(row, DEP, now=NOW)
        else:
            result = accounts.profile_measurement(row, DEP, now=NOW)
    assert result['status'] == 'known'
    assert read.call_count == 1


@pytest.mark.parametrize('fault', ['file-symlink', 'directory-symlink', 'ancestor-symlink',
                                 'home-symlink', 'public-file', 'public-directory',
                                 'writable-ancestor', 'hardlink', 'oversize', 'fifo', 'unsupported'])
def test_unusable_cache_never_supplies_headroom_or_follows_redirects(tmp_path, fault):
    row = profile()
    key = accounts.quota_cache_key(row, DEP)
    accounts.write_quota_cache(key, reading())
    path = accounts.quota_cache_path(key)
    external = tmp_path / 'external.json'
    external.write_text(json.dumps(reading()))
    if fault == 'file-symlink':
        path.unlink()
        path.symlink_to(external)
    elif fault in ('directory-symlink', 'ancestor-symlink', 'home-symlink'):
        source = {'directory-symlink': path.parent,
                  'ancestor-symlink': path.parents[2], 'home-symlink': path.parents[3]}[fault]
        target = tmp_path / 'retained-directory'
        source.rename(target)
        source.symlink_to(target, target_is_directory=True)
    elif fault == 'public-file': path.chmod(0o644)
    elif fault == 'public-directory': path.parent.chmod(0o755)
    elif fault == 'writable-ancestor': path.parents[2].chmod(0o777)
    elif fault == 'hardlink': os.link(path, tmp_path / 'retained-hardlink')
    elif fault == 'oversize': path.write_bytes(b' ' * (accounts.QUOTA_CACHE_MAX_BYTES + 1))
    elif fault == 'fifo':
        path.unlink()
        os.mkfifo(path, 0o600)
    before = external.read_bytes()
    redirected_before = path.read_bytes() if fault.endswith('symlink') else None
    fresh = reading()
    fresh['windows'][0]['percentRemaining'] = 0
    with patch.object(accounts.codexbar, 'read', return_value=fresh) as read:
        if fault == 'unsupported':
            with patch.object(accounts.os, 'O_NOFOLLOW', create=True, new=None):
                result = accounts.profile_measurement(row, DEP, now=NOW)
        else:
            result = accounts.profile_measurement(row, DEP, now=NOW)
    assert read.call_count == 1
    assert accounts.remaining({'measurement': result}, 'haiku') == 0
    assert external.read_bytes() == before
    if fault.endswith('symlink'):
        assert (path if fault == 'file-symlink' else source).is_symlink()
        assert path.read_bytes() == redirected_before


@pytest.mark.parametrize('target', ['file', 'directory'])
def test_cache_owned_by_another_identity_is_not_trusted_or_invalidated(target):
    row = profile()
    key = accounts.quota_cache_key(row, DEP)
    accounts.write_quota_cache(key, reading())
    path = accounts.quota_cache_path(key)
    target_inode = (path if target == 'file' else path.parent).stat().st_ino
    real_stat, real_fstat = os.stat, os.fstat

    def wrong_owner(metadata):
        if metadata.st_ino != target_inode:
            return metadata
        values = list(metadata)
        values[4] = os.getuid() + 1
        return os.stat_result(values)

    with patch.object(accounts.os, 'stat', side_effect=lambda *a, **kw: wrong_owner(real_stat(*a, **kw))), \
            patch.object(accounts.os, 'fstat', side_effect=lambda *a, **kw: wrong_owner(real_fstat(*a, **kw))):
        assert accounts.read_quota_cache(key, 1800, NOW) is None
        assert accounts.invalidate_quota_cache(row, DEP) is False
    assert path.exists()


def test_cached_claude_quota_keeps_native_identity_and_ambiguity_checks():
    row = profile('claude')
    native = {'loggedIn': True, 'email': 'user@example.test', 'orgId': 'org-personal', 'orgName': 'Personal'}
    fresh = reading()
    fresh['identity'].pop('organization')
    with patch.object(accounts, 'command_json', return_value=native) as auth, \
            patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: deepcopy(fresh)) as read:
        accounts.profile_measurement(row, DEP, now=NOW)
        accounts.profile_measurement(row, DEP, now=NOW)
        assert read.call_count == 1 and auth.call_count == 2
        other = {**profile('claude'), 'expected_identity': {'email': 'user@example.test', 'organizationUuid': 'org-team'}}
        with pytest.raises(ValueError, match='ambiguous'):
            accounts.profile_measurement(row, DEP, now=NOW, inventory_rows=[row, other])
        row['expected_identity']['organizationUuid'] = 'org-personal'
        native['orgId'] = 'org-team'
        with pytest.raises(ValueError, match='native identity'):
            accounts.profile_measurement(row, DEP, now=NOW)
        assert read.call_count == 1


def test_native_identity_change_requires_new_quota_and_failed_refresh_discards_cache():
    row = profile('claude')
    native = {'loggedIn': True, 'email': 'user@example.test', 'orgId': 'org-personal', 'orgName': 'Personal'}
    with patch.object(accounts, 'command_json', return_value=native), \
            patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        accounts.profile_measurement(row, DEP, now=NOW)
        native['orgId'] = 'org-team'
        result = accounts.profile_measurement(row, DEP, now=NOW)
        assert read.call_count == 2
        assert result['identity']['organizationUuid'] == 'org-team'
        native['loggedIn'] = False
        with pytest.raises(ValueError, match='signed out'):
            accounts.profile_measurement(row, DEP, refresh=True, now=NOW)
    assert not accounts.quota_cache_path(row['quota_cache_key']).exists()


def test_inventory_applies_default_freshness_and_soft_reserve_to_cached_readings():
    row = profile()
    policy = {'profiles': {row['key']: {'profile': row['profile'], 'expected_identity': row['expected_identity']}}}
    with patch.object(accounts.codexbar, 'verify'), \
            patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        accounts.inventory(policy, DEP, now=NOW)
        report = accounts.inventory(policy, DEP, now=NOW + timedelta(minutes=20))
        assert read.call_count == 1
        selected = accounts.choose(report, 'codex', 'haiku')
        assert selected['measurement']['status'] == 'known'
        assert selected['min_remaining_percent'] == 5
        policy['max_age_seconds'] = 300
        stale = accounts.inventory(policy, DEP, now=NOW + timedelta(minutes=20))
        assert read.call_count == 2
        assert accounts.choose(stale, 'codex', 'haiku') is None


def test_longer_configured_freshness_reuses_only_until_its_own_limit():
    row = profile()
    policy = {'max_age_seconds': 3600, 'profiles': {
        row['key']: {'profile': row['profile'], 'expected_identity': row['expected_identity']}}}
    with patch.object(accounts.codexbar, 'verify'), \
            patch.object(accounts.codexbar, 'read', side_effect=lambda *a, **kw: reading()) as read:
        accounts.inventory(policy, DEP, now=NOW)
        valid = accounts.inventory(policy, DEP, now=NOW + timedelta(minutes=45))
        assert read.call_count == 1
        assert accounts.choose(valid, 'codex', 'haiku') is not None
        expired = accounts.inventory(policy, DEP, now=NOW + timedelta(seconds=3601))
        assert read.call_count == 2
        assert accounts.choose(expired, 'codex', 'haiku') is None
