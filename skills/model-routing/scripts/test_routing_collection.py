"""Routing collection must not wait on unrelated providers or unbounded tools."""
from types import SimpleNamespace
from unittest.mock import patch
import subprocess
import pytest
import router
import accounts


def test_codex_check_collects_only_bound_codex_profiles():
    candidates = {'codex/test/high': {'launch': {'agent': 'codex', 'model': 'test', 'effort': 'high'}}}
    args = SimpleNamespace(codexbar=True, repo='.', runtime_file=None, native_account_only=[])
    policy = {'source': 'configured', 'profiles': {
        'codex:a': {'profile': '/synthetic/codex'},
        'claude:b': {'profile': '/synthetic/claude'},
    }}
    measured = []
    def measure(row, dependency, **kwargs):
        measured.append(row['provider'])
        return {'status': 'unknown', 'windows': [], 'detail': 'fetch failed'}
    with patch.object(router, 'compile_brief', return_value={'account_routing': policy}), \
         patch.object(router, 'load_codexbar', return_value={}) as broad, \
         patch.object(accounts.codexbar, 'verify'), patch.object(accounts, 'profile_measurement', side_effect=measure):
        runtime = router.load_runtime(args, candidates)
    assert measured == ['codex']
    broad.assert_not_called()
    assert runtime['account_inventory']['accounts'][0]['measurement']['status'] == 'unknown'


@pytest.mark.parametrize('exact', [False, True])
def test_cli_check_limits_collection_but_keeps_exact_fallback(exact, capsys):
    primary = {'launch': {'agent': 'codex', 'model': 'test', 'effort': 'high'}}
    fallback = {'launch': {'agent': 'grok', 'model': 'test', 'effort': 'high'}}
    compiled = {'candidates': {'primary': primary, 'fallback': fallback, 'unrelated': {'launch': {'agent': 'claude', 'model': 'other', 'effort': 'low'}}},
                'exact': {'config': {'routes': {'worker': primary['launch']}}}}
    args = ['check', '--codexbar'] + (['--exact-route', 'worker', '--route-basis', 'requested'] if exact else ['--candidate', 'primary', '--reason', 'test'])
    with patch.object(router, 'compile_brief', return_value=compiled), \
         patch.object(router.exact_config, 'repo_info', return_value=('.', None)), \
         patch.object(router.exact_config, 'quota_unusable_policy', return_value={'launch': fallback['launch']}), \
         patch.object(router, 'match_candidate', side_effect=lambda c, launch: next(k for k, v in c['candidates'].items() if v['launch'] == launch)), \
         patch.object(router, 'load_runtime', return_value={}) as collect, \
         patch.object(router, 'check', return_value={'status': 'refused'}):
        assert router.main(args) == 1
    assert set(collect.call_args.args[1]) == ({'primary', 'fallback'} if exact else {'primary'})


def test_failed_profile_read_stays_unavailable_with_recovery_guidance():
    runtime = {'account_inventory': {'accounts': [{'key': 'codex:synthetic', 'provider': 'codex',
        'measurement': {'status': 'unknown', 'windows': [], 'source': 'codexbar'}}]}}
    result = router.runtime_for(runtime, 'test', {'launch': {'agent': 'codex', 'model': 'test', 'effort': 'high'}})
    assert result['quota']['status'] == 'unavailable'
    assert 'readiness change' in result['quota']['detail']
    assert 'account_binding' not in result


def test_native_inventory_skips_inactive_profiles_before_reading():
    policy = {'source': 'orca', 'profiles': {f'codex:{key}': {'profile': '/synthetic/' + key} for key in ('active', 'inactive')}}
    discovered = {'result': {'codex': {'accounts': [{'id': 'active'}, {'id': 'inactive'}], 'activeAccountId': 'active'}}}
    with patch.object(accounts.codexbar, 'verify'), patch.object(accounts, 'command_json', return_value=discovered), \
         patch.object(accounts, 'profile_measurement', return_value={'status': 'unknown', 'windows': []}) as measure:
        result = accounts.inventory(policy, {}, providers={'codex'}, native_only_providers={'codex'})
    assert [r['id'] for r in result['accounts']] == ['active']
    assert measure.call_count == 1


def test_profile_timeout_reaches_unavailable_gate_without_binding():
    candidates = {'test': {'launch': {'agent': 'codex', 'model': 'test', 'effort': 'high'}}}
    args = SimpleNamespace(codexbar=True, repo='.', runtime_file=None, native_account_only=[])
    policy = {'profiles': {'codex:a': {'profile': '/synthetic/a'}}}
    with patch.object(router, 'compile_brief', return_value={'account_routing': policy}), \
         patch.object(accounts.codexbar, 'verify'), patch.object(accounts, 'profile_measurement', side_effect=subprocess.TimeoutExpired(['secret-must-not-appear'], 120)):
        runtime = router.load_runtime(args, candidates)
    result = router.runtime_for(runtime, 'test', candidates['test'])
    assert result['quota']['status'] == 'unavailable'
    assert 'timeout' in result['quota']['detail']
    assert 'secret-must-not-appear' not in result['quota']['detail']
    assert 'account_binding' not in result


def test_exact_route_without_catalog_match_still_collects_quota(capsys):
    launch = {'agent': 'codex', 'model': 'uncatalogued', 'effort': 'high'}
    compiled = {'candidates': {}, 'exact': {'config': {'routes': {'worker': launch}}}}
    with patch.object(router, 'compile_brief', return_value=compiled), \
         patch.object(router.exact_config, 'repo_info', return_value=('.', None)), \
         patch.object(router.exact_config, 'quota_unusable_policy', return_value=None), \
         patch.object(router, 'load_runtime', return_value={}) as collect, \
         patch.object(router, 'check', return_value={'status': 'refused'}):
        router.main(['check', '--exact-route', 'worker', '--route-basis', 'requested', '--codexbar'])
    assert list(collect.call_args.args[1].values()) == [{'launch': launch}]
