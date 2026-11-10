"""Recovery uses existing observations and preserves launch gates; no agents start."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest
import recovery
import router

ORIGINAL = 'codex/gpt-6.1-sol/high'
ALTERNATIVE = 'grok/grok-4.7/high'
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def case(tmp_path, monkeypatch):
    home = tmp_path / 'home'
    home.mkdir()
    monkeypatch.setenv('HOME', str(home))
    monkeypatch.setenv('CODEX_HOME', str(home / 'codex'))
    repo = tmp_path / 'repo'
    repo.mkdir()
    compiled = router.compile_brief(str(repo))
    args = SimpleNamespace(repo=str(repo), role='worker', exact_route=None, route_basis=None,
                           candidate=ORIGINAL, reason='Implement the bounded change.',
                           explicit_basis=None, max_effort_basis=None, require_feature=[],
                           launchable_via=['codex,grok'], accept_quota_unknown=None,
                           native_account_only=[], policy_file=None,
                           require_original=False, alternative=ALTERNATIVE,
                           equivalence_reason='Both candidates meet this bounded implementation task.')
    runtime = {'harnesses': {name: {'quota': {'status': 'known', 'effective_percent_remaining': 50}}
                            for name in ('codex', 'grok')}}
    original = router.check(compiled, args, runtime)
    assert original['status'] == 'selected'
    event = {'attempt': 'orchestrator:attempt-1', 'evidence': 'orchestrator:event-2',
             'phase': 'interrupted', 'cause': 'quota_exhausted', 'settled': True,
             'observed_at': NOW.isoformat(), 'decision': original}
    return compiled, args, runtime, event


def plan(case):
    compiled, args, runtime, event = case
    recovery.prepare(args, event)
    return recovery.plan(compiled, args, runtime, event, NOW)


def configure(case, **patch):
    case[0]['recovery_layers'].append({'scope': 'repo', 'config': {'recovery': patch}})


def test_ready_equivalent_reuses_task_constraints_and_cannot_retry_exhausted_pool(case):
    result = plan(case)
    assert result['action'] == 'resume'
    assert result['decision']['selected']['id'] == ALTERNATIVE
    case[1].alternative = ORIGINAL
    assert plan(case)['action'] == 'ask'


@pytest.mark.parametrize('failure', ['unknown', 'auth_required', 'rate_limited', 'start_failed'])
def test_non_quota_failures_are_left_with_the_orchestrator(case, failure):
    case[3]['cause'] = failure
    assert plan(case)['action'] == 'inspect'


def test_unsettled_attempt_cannot_spawn_a_duplicate(case):
    case[3]['settled'] = False
    assert plan(case)['action'] == 'settle_attempt'


@pytest.mark.parametrize('constraint', ['original', 'vision', 'launcher', 'explicit', 'quota'])
def test_alternative_cannot_bypass_original_requirements(case, constraint):
    compiled, args, runtime, event = case
    if constraint == 'original': event['decision']['require_original'] = True
    if constraint == 'vision': event['decision']['requirements']['features'] = ['unavailable-feature']
    if constraint == 'launcher': event['decision']['requirements']['launchable_agents'] = ['codex']
    if constraint == 'explicit': compiled['candidates'][ALTERNATIVE]['explicit'] = True
    if constraint == 'quota': runtime['harnesses']['grok']['quota']['status'] = 'unknown'
    assert plan(case)['action'] == 'ask'


def test_reserve_is_conditional_on_a_ready_equivalent(case):
    compiled, args, runtime, _ = case
    runtime['harnesses']['codex']['quota']['effective_percent_remaining'] = 3
    original = router.check(compiled, args, runtime)
    assert recovery.reserve_alternative(compiled, args, runtime, original)['status'] == 'alternative-available'
    runtime['harnesses']['grok']['quota']['status'] = 'unknown'
    assert recovery.reserve_alternative(compiled, args, runtime, original)['status'] == 'selected'
    runtime['harnesses']['grok']['quota'] = {'status': 'known', 'effective_percent_remaining': 2}
    assert recovery.reserve_alternative(compiled, args, runtime, original)['status'] == 'selected'


@pytest.mark.parametrize('no_reply, expected', [('stop', 'stop'), ('continue', 'resume')])
def test_question_deadline_uses_configured_no_reply_choice(case, no_reply, expected):
    configure(case, on_limit='ask', on_no_reply=no_reply)
    case[3]['question'] = {'id': 'question-1', 'asked_at': (NOW - timedelta(seconds=599)).isoformat()}
    waiting = plan(case)
    assert waiting['action'] == 'await_answer'
    assert waiting['question_id'] == 'question-1'
    case[3]['question']['asked_at'] = (NOW - timedelta(seconds=600)).isoformat()
    assert plan(case)['action'] == expected


def test_explicit_answer_wins_and_repeated_planning_has_no_side_effect(case):
    configure(case, on_no_reply='continue')
    case[3]['question'] = {'id': 'question-1', 'asked_at': (NOW-timedelta(hours=1)).isoformat(), 'answer': 'stop'}
    assert plan(case)['action'] == 'stop'
    assert plan(case) == plan(case)


def test_wait_deadline_is_anchored_and_reset_requires_recheck(case):
    configure(case, on_limit='wait', max_wait_seconds=120)
    case[3]['resets_at'] = (NOW+timedelta(seconds=60)).isoformat()
    assert plan(case)['action'] == 'wait'
    case[3]['resets_at'] = (NOW+timedelta(seconds=121)).isoformat()
    assert plan(case)['action'] == 'ask'
    case[3]['resets_at'] = NOW.isoformat()
    assert plan(case)['action'] == 'recheck'


def test_replacement_bound_and_assignment_policy_are_preserved(case, tmp_path):
    compiled, args, runtime, event = case
    overrides = tmp_path / 'policy.json'
    overrides.write_text(json.dumps({'on_limit': 'ask'}))
    args.policy_file = str(overrides)
    event['decision'] = router.check(compiled, args, runtime)
    args.policy_file = None
    assert plan(case)['action'] == 'ask'
    event['replacement_count'] = 2
    assert plan(case)['action'] == 'stop'


def test_recovery_public_entrypoint_without_orca_or_provider_tools(case, tmp_path):
    compiled, args, runtime, event = case
    event_file, runtime_file = tmp_path / 'event.json', tmp_path / 'runtime.json'
    event_file.write_text(json.dumps(event))
    runtime_file.write_text(json.dumps(runtime))
    result = subprocess.run([sys.executable, router.__file__, 'recover', '--repo', args.repo,
                             '--event-file', str(event_file), '--runtime-file', str(runtime_file),
                             '--alternative', ALTERNATIVE, '--equivalence-reason', args.equivalence_reason],
                            capture_output=True, text=True)
    assert result.returncode == 2, result.stderr
    output = json.loads(result.stdout)
    assert output['action'] == 'resume'
    assert output['decision']['selected']['id'] == ALTERNATIVE


def test_exhausted_proxy_pool_does_not_bypass_recovery(case):
    compiled, args, runtime, event = case
    compiled['candidates'][ALTERNATIVE]['quota_pool'] = {'provider': 'codex', 'detail': 'Synthetic shared billing pool'}
    assert plan(case)['action'] == 'ask'


def exact_assignment(case, **settings):
    compiled, args, runtime, event = case
    compiled['exact']['config']['routes']['review'] = deepcopy(compiled['candidates'][ORIGINAL]['launch'])
    compiled['exact']['route_provenance']['review'] = []
    compiled['recovery_layers'].append({'scope': 'repo', 'config': {'routes': {'review': {'recovery': settings}}}})
    args.exact_route, args.route_basis, args.candidate, args.reason = 'review', 'Use the review route for this task.', None, None
    event['decision'] = router.check(compiled, args, runtime)
    assert event['decision']['status'] == 'exact'


def test_route_edits_cannot_change_the_saved_required_model(case):
    exact_assignment(case)
    compiled, args, runtime, event = case
    event['decision']['require_original'] = True
    compiled['exact']['config']['routes']['review'] = deepcopy(compiled['candidates'][ALTERNATIVE]['launch'])
    assert plan(case)['action'] == 'ask'


def test_candidate_override_cannot_rewrite_a_saved_tuple(case):
    case[3]['decision']['require_original'] = True
    case[0]['candidates'][ORIGINAL]['launch'] = deepcopy(case[0]['candidates'][ALTERNATIVE]['launch'])
    with pytest.raises(ValueError, match='Original launch tuple'):
        plan(case)


def test_legacy_flat_crew_route_retains_its_tuple(case):
    exact_assignment(case, max_replacements=0)
    original = case[3]['decision']
    flat = {**original, **original['selected'], 'candidate': original['selected']['id'], 'route': original['exact_route']}
    flat.pop('selected')
    flat.pop('exact_route')
    flat.pop('provenance')
    flat['source'] = {'scope': 'repo', 'path': 'synthetic-config.json'}
    case[3]['decision'] = flat
    assert plan(case)['action'] == 'stop'
    assert recovery.pinned_original(case[0], case[1], flat)['exact']['config']['routes']['review']['model'] == flat['model']
    assert recovery.pinned_original(case[0], case[1], flat)['exact']['route_provenance']['review']['winner'] == flat['source']


def test_route_policy_survives_an_equivalent_replacement(case):
    exact_assignment(case, max_replacements=1)
    first = plan(case)
    assert first['action'] == 'resume'
    assert first['decision']['recovery_context'] == {'role': 'worker', 'route': 'review'}
    case[3]['decision'] = first['decision']
    case[3]['replacement_count'] = 1
    case[1].candidate = ALTERNATIVE
    case[1].exact_route = case[1].route_basis = None
    assert plan(case)['action'] == 'stop'


def test_exhausted_account_aliases_cannot_be_retried(case):
    compiled, args, runtime, event = case
    rows = []
    for name in ('original', 'alias'):
        rows.append({'key': 'codex:' + name, 'provider': 'codex', 'id': name, 'label': name,
                     'profile': '/synthetic/' + name, 'runtime': 'host', 'min_remaining_percent': 5,
                     'priority': 0, 'active': False,
                     'measurement': {'status': 'known', 'refreshed_at': NOW.isoformat(),
                                     'identity': {'email': 'same@example.test'},
                                     'windows': [{'id': 'session', 'percentRemaining': 80}]}})
    runtime['account_inventory'] = {'accounts': rows}
    event['decision']['account_binding'] = {'key': 'codex:original', 'provider': 'codex',
                                          'quota_identity': {'email': 'same@example.test'}}
    args.alternative = None
    assert plan(case)['action'] == 'ask'
    rows[1]['measurement']['identity']['email'] = 'independent@example.test'
    result = plan(case)
    assert result['action'] == 'resume'
    assert result['decision']['account_binding']['key'] == 'codex:alias'
