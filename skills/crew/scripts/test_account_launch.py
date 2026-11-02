"""Cross-process routing to Crew to a synthetic CLI: prove account custody."""
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
ROUTER = ROOT / 'skills/model-routing/scripts/router.py'
CREW = Path(__file__).with_name('assignment.py')
ACCOUNT_ENVIRONMENT = json.loads((ROOT / 'skills/model-routing/references/account-environment.json').read_text())


@pytest.mark.parametrize('selection', ['managed', 'managed-default-path', 'native-default'])
def test_gate_binding_survives_crew_shell_and_expires(tmp_path, selection):
    native_default = selection == 'native-default'
    env = os.environ.copy()
    env.update(HOME=str(tmp_path / 'home'), CODEX_HOME=str(tmp_path / 'codex'))
    profile = Path(env['HOME']) / '.claude' if selection != 'managed' else tmp_path / "profile with space ' and $literal"
    profile.mkdir(parents=True)
    now = datetime.now(timezone.utc).isoformat()
    runtime = {'account_max_age_seconds': 300, 'account_inventory': {'accounts': [
        {'provider': 'claude', 'key': 'claude:priority', 'id': 'priority', 'label': 'test@example.test',
         'runtime': 'host', 'active': False, 'profile': str(profile), 'profile_mode': 'native-default' if native_default else 'directory', 'priority': 100, 'min_remaining_percent': 0,
         'measurement': {'status': 'known', 'refreshed_at': now, 'windows': [{'id': 'session', 'percentRemaining': 1}]}}]}}
    runtime_file = tmp_path / 'runtime.json';runtime_file.write_text(json.dumps(runtime))
    subprocess.run([sys.executable, str(ROUTER), 'setup', '--selector', 'agent'], env=env, capture_output=True, check=True)
    check = subprocess.run([sys.executable, str(ROUTER), 'check', '--repo', str(tmp_path), '--candidate', 'claude/claude-haiku-5-5/high', '--reason', 'Bounded implementation with review', '--runtime-file', str(runtime_file)], env=env, capture_output=True, text=True)
    assert check.returncode == 0, check.stderr + check.stdout
    decision = json.loads(check.stdout)
    decision_file = tmp_path / 'decision.json';decision_file.write_text(check.stdout)
    argv = [sys.executable, str(CREW), 'packet', '--repo', str(tmp_path), '--manifest', json.dumps({'mechanism': 'direct', 'launchable_agents': ['claude'], 'communication': 'Harness mail', 'retire': 'Harness stop', 'launch_argv': {'claude': ['claude', '--model', '{model}', '--effort', '{effort}']}}), '--title', 'Fixture task', '--role', 'worker', '--reports-to', 'user', '--work-ref', 'beads:fixture', '--decision-json', str(decision_file)]
    packet_result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert packet_result.returncode == 0, packet_result.stderr
    packet = json.loads(packet_result.stdout)
    assert packet['account_binding']['id'] == 'priority'
    if native_default:
        assert packet['account_binding']['env'] == {}
        assert packet['account_binding']['native_default_profile'] == str(profile)
        assert 'CLAUDE_CONFIG_DIR' in packet['account_binding']['unset_env']
    assert packet['launch_method'] == 'command'
    # Execute the exact quoted command against a harmless fake CLI. No provider call.
    binary = tmp_path / 'bin';binary.mkdir()
    stub = binary / 'claude'
    stub.write_text('#!' + sys.executable + '\nimport os,json\nprint(json.dumps({"profile":os.environ.get("CLAUDE_CONFIG_DIR"),"override":os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")}))\n')
    stub.chmod(0o700)
    env.update(PATH=str(binary) + os.pathsep + env['PATH'], CLAUDE_CODE_OAUTH_TOKEN='synthetic-other-account',
               CLAUDE_CONFIG_DIR='/synthetic/ambient-profile')
    launched = subprocess.run(['/bin/sh', '-c', packet['launch_command']], env=env, capture_output=True, text=True, check=True)
    assert json.loads(launched.stdout) == {'profile': None if native_default else str(profile), 'override': None}
    decision['account_binding']['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
    decision_file.write_text(json.dumps(decision))
    expired = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert expired.returncode != 0 and 'expired' in expired.stderr


def test_account_binding_refuses_a_manifest_that_cannot_apply_it(tmp_path):
    env = {**os.environ, 'HOME': str(tmp_path), 'CODEX_HOME': str(tmp_path / 'codex')}
    decision = {'status': 'selected', 'selected': {'id': 'fixture', 'agent': 'claude', 'model': 'haiku', 'effort': 'high'}, 'reason': 'Bounded task',
                'account_binding': {'provider': 'claude', 'id': 'one', 'env': {'CLAUDE_CONFIG_DIR': '/profiles/one'}, 'unset_env': ACCOUNT_ENVIRONMENT['unset_env']['claude'], 'refreshed_at': datetime.now(timezone.utc).isoformat(), 'max_age_seconds': 300}}
    path = tmp_path / 'decision.json';path.write_text(json.dumps(decision))
    manifest = {'mechanism': 'native', 'launchable_agents': ['claude'], 'communication': 'Harness messages', 'retire': 'Harness stop'}
    r = subprocess.run([sys.executable, str(CREW), 'packet', '--repo', str(tmp_path), '--manifest', json.dumps(manifest), '--title', 'Fixture', '--role', 'worker', '--reports-to', 'user', '--work-ref', 'beads:fixture', '--decision-json', str(path)], env=env, capture_output=True, text=True)
    assert r.returncode != 0 and 'cannot bind' in r.stderr


@pytest.mark.parametrize('provider, missing', [
    ('claude', 'CLAUDE_CODE_OAUTH_TOKEN'), ('codex', 'OPENAI_API_KEY'),
])
def test_managed_profile_binding_requires_all_credential_removals(tmp_path, provider, missing):
    env, argv, path, decision, log, response = native_fixture(tmp_path, provider=provider)
    decision['account_binding']['unset_env'].remove(missing)
    path.write_text(json.dumps(decision))
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert result.returncode != 0 and 'required credential override' in result.stderr
    assert not result.stdout


def test_alternate_router_environment_contract_controls_both_native_binding_checks(tmp_path):
    env, argv, path, decision, log, response = native_fixture(tmp_path)
    alternate = tmp_path / 'alternate'
    (alternate / 'scripts').mkdir(parents=True)
    (alternate / 'references').mkdir()
    router = alternate / 'scripts/router.py'
    router.write_text('# Saved decision replay does not execute this router.\n')
    contract = json.loads(json.dumps(ACCOUNT_ENVIRONMENT))
    contract['unset_env']['claude'].append('SYNTHETIC_CREDENTIAL_OVERRIDE')
    contract_path = alternate / 'references/account-environment.json'
    contract_path.write_text(json.dumps(contract))
    wrapper = tmp_path / 'router-wrapper.py'
    wrapper.write_text('# Saved decisions retain the producer contract through wrappers.\n')
    decision['account_binding']['environment_contract'] = {'path': str(contract_path), 'sha256': hashlib.sha256(contract_path.read_bytes()).hexdigest()}
    path.write_text(json.dumps(decision))
    argv += ['--router', str(wrapper)]
    refused = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert refused.returncode != 0 and 'required credential override' in refused.stderr
    assert not log.exists(), 'Contract refusal precedes native discovery'
    decision['account_binding']['unset_env'].append('SYNTHETIC_CREDENTIAL_OVERRIDE')
    path.write_text(json.dumps(decision))
    admitted = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert admitted.returncode == 0, admitted.stderr
    assert json.loads(admitted.stdout)['launch_method'] == 'orca-native'
    contract['unset_env']['claude'].append('SYNTHETIC_NEW_OVERRIDE')
    contract_path.write_text(json.dumps(contract))
    changed = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert changed.returncode != 0 and 'contract changed' in changed.stderr


def test_saved_declared_contract_replays_without_a_sibling_router(tmp_path):
    env, argv, path, decision, log, response = native_fixture(tmp_path)
    standalone = tmp_path / 'standalone-crew/scripts/assignment.py'
    standalone.parent.mkdir(parents=True)
    standalone.write_bytes(CREW.read_bytes())
    contract = ROOT / 'skills/model-routing/references/account-environment.json'
    decision['account_binding']['environment_contract'] = {'path': str(contract), 'sha256': hashlib.sha256(contract.read_bytes()).hexdigest()}
    path.write_text(json.dumps(decision))
    argv[1] = str(standalone)
    replay = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert replay.returncode == 0, replay.stderr
    assert json.loads(replay.stdout)['launch_method'] == 'orca-native'


def native_fixture(tmp_path, *, active='selected', provider='claude', surface='readiness-worker'):
    """Fake public discovery; preparation execution requires explicit opt-in."""
    env = {**os.environ, 'HOME': str(tmp_path / 'home'), 'CODEX_HOME': str(tmp_path / 'codex')}
    log = tmp_path / 'calls.jsonl'
    identity = {'email': 'same@example.test', 'organizationUuid': 'shared-org'}
    group = {'activeAccountId': active, 'activeAccountIdsByRuntime': {'host': active},
             'accounts': [dict(id=key, **identity) for key in ('selected', 'other')]}
    response = tmp_path / 'accounts.json'
    response.write_text(json.dumps({'ok': True, 'result': {provider: group}}))
    capability_file = tmp_path / 'capabilities.json'
    name = 'agent launch' if surface == 'agent-launch' else 'orchestration worker-start'
    flags = ['agent', 'model', 'effort', 'worktree', 'json']
    if surface == 'readiness-worker':
        flags += ['spec', 'task', 'terminal', 'run', 'retry-of', 'keep-open']
    if surface == 'agent-launch':
        flags += ['surface']
    commands = [{'command': name, 'flags': flags}]
    if surface == 'agent-launch':
        commands.append({'command': 'orchestration worker-start',
                         'flags': ['spec', 'task', 'terminal', 'run', 'retry-of', 'worktree', 'json']})
    capability_file.write_text(json.dumps({'schemaVersion': 1, 'commands': commands}))
    executable = tmp_path / 'fake orca'
    executable.write_text('#!' + sys.executable + '\n' +
        'import sys,json,pathlib\n' +
        f'with open({str(log)!r}, "a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n' +
        f'files = {{("account", "list", "--json"): {str(response)!r}, ("agent-context", "--json"): {str(capability_file)!r}}}\n' +
        'key = tuple(sys.argv[1:])\n' +
        'if key in files: print(pathlib.Path(files[key]).read_text())\n' +
        f'else: assert pathlib.Path({str(tmp_path / "allow-prepare")!r}).exists(), "unexpected launch or mutation"\n')
    executable.chmod(0o700)
    binding = {'provider': provider, 'id': 'selected',
               'env': {('CLAUDE_CONFIG_DIR' if provider == 'claude' else 'CODEX_HOME'): '/profiles/current'},
               'unset_env': list(ACCOUNT_ENVIRONMENT['unset_env'][provider]),
               'refreshed_at': datetime.now(timezone.utc).isoformat(), 'max_age_seconds': 300,
               'discovery': {'source': 'orca', 'command': str(executable)}, 'expected_identity': identity}
    decision = {'status': 'selected', 'selected': {'id': 'fixture', 'agent': provider, 'model': 'test-model', 'effort': 'high'},
                'reason': 'Fixture', 'account_binding': binding}
    path = tmp_path / 'decision.json'
    path.write_text(json.dumps(decision))
    argv = [sys.executable, str(CREW), 'packet', '--repo', str(tmp_path), '--manifest', 'orca',
            '--extra', 'front_key=fixture/test', '--title', 'Fixture', '--role', 'worker',
            '--reports-to', 'captain', '--work-ref', 'beads:fixture', '--decision-json', str(path)]
    return env, argv, path, decision, log, response


@pytest.mark.parametrize('provider', ['claude', 'codex'])
@pytest.mark.parametrize('surface', ['readiness-worker', 'agent-launch'])
def test_orca_native_prepares_through_supported_launcher_without_delivering(tmp_path, provider, surface):
    env, argv, path, decision, log, response = native_fixture(tmp_path, provider=provider, surface=surface)
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    packet = json.loads(result.stdout)
    assert packet['launch_method'] == 'orca-native'
    assert packet['account_binding'] == decision['account_binding']
    prepare = packet['prepare_argv']
    assert packet['prepare_surface'] == surface
    assert prepare[-6:] == ['--agent', provider, '--model', 'test-model', '--effort', 'high']
    if surface == 'agent-launch':
        assert prepare[1:3] == ['agent', 'launch']
        assert '--spec' not in prepare
        # Process verification needs a terminal even when the user's default is chat.
        assert prepare[3:5] == ['--surface', 'terminal']
    else:
        assert prepare[1:4] == ['orchestration', 'worker-start', '--spec']
        assert 'readiness only' in prepare[4]
        # Orca auto-releases finished workers; the prepared terminal must survive verification.
        assert prepare[5] == '--keep-open'
        assert packet['spec'] not in prepare
    assert 'env' not in prepare and '/profiles/current' not in prepare
    (tmp_path / 'allow-prepare').touch()
    # Execute the exact shell-quoted packet command at the harmless CLI boundary.
    launched = subprocess.run(['/bin/sh', '-c', packet['prepare_command'] +
                              ' --worktree current --run fixture-run --json'],
                              env=env, capture_output=True, text=True)
    assert launched.returncode == 0, launched.stderr
    calls = [json.loads(x) for x in log.read_text().splitlines()]
    assert calls == [['account', 'list', '--json'], ['agent-context', '--json'],
                     prepare[1:] + ['--worktree', 'current', '--run', 'fixture-run', '--json']]
    assert 'launch_command' not in packet and 'launch_argv' not in packet
    assert 'before task delivery' in packet['delivery_gate']
    assert packet['reports_to'] == 'captain'


@pytest.mark.parametrize('fault, expected', [
    ('inactive', 'cannot pin'), ('missing-discovery', 'Orca-discovered'),
    ('old', 'expired'), ('identity', 'identity changed'), ('signed-out', 'not ready'),
    ('unavailable', 'discovery unavailable'), ('unknown', 'discovery unavailable'),
    ('remote', 'not ready'), ('bool-age', 'expired'),
])
def test_native_account_refusal_never_launches_or_falls_back(tmp_path, fault, expected):
    env, argv, path, decision, log, response = native_fixture(tmp_path, active='other' if fault == 'inactive' else 'selected')
    binding = decision['account_binding']
    if fault == 'missing-discovery':
        del binding['discovery']
    elif fault == 'old':
        binding['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
    elif fault == 'bool-age':
        binding['max_age_seconds'] = True
    elif fault == 'identity':
        binding['expected_identity']['organizationUuid'] = 'different-org'
    elif fault in ('signed-out', 'remote'):
        data = json.loads(response.read_text())
        data['result']['claude']['accounts'][0].update({'needsSignIn': True} if fault == 'signed-out' else {'managedAuthRuntime': 'wsl'})
        response.write_text(json.dumps(data))
    elif fault == 'unavailable':
        response.write_text('{"ok": false}')
    elif fault == 'unknown':
        response.write_text('{"ok": true, "result": {}}')
    path.write_text(json.dumps(decision))
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert result.returncode != 0 and expected in result.stderr, result.stderr
    assert not result.stdout
    if log.exists():
        assert [json.loads(x) for x in log.read_text().splitlines()] == [['account', 'list', '--json']]


def test_binding_expiring_during_native_discovery_is_refused(tmp_path):
    import importlib.util
    from unittest.mock import patch
    spec = importlib.util.spec_from_file_location('crew_account_expiry_test', CREW)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    env, argv, path, decision, log, response = native_fixture(tmp_path)
    binding = decision['account_binding']
    module.account_binding_argv(binding, 'claude')
    def delayed_read(*args, **kwargs):
        binding['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
        return subprocess.CompletedProcess(args[0], 0, response.read_text())
    with patch.object(module.subprocess, 'run', side_effect=delayed_read):
        with pytest.raises(module.Error, match='expired'):
            module.orca_native_preparation(binding, decision['selected'])


@pytest.mark.parametrize('fault', [None, 'path', 'set-profile', 'not-unset', 'codex', 'no-path', 'missing-credential'])
def test_native_default_profile_is_explicit_and_never_weakens_binding(tmp_path, fault):
    env, argv, path, decision, log, response = native_fixture(tmp_path)
    binding = decision['account_binding']
    binding.update(env={}, native_default_profile=str(Path(env['HOME']) / '.claude'))
    binding['unset_env'].append('CLAUDE_CONFIG_DIR')
    if fault == 'path': binding['native_default_profile'] = '/synthetic/other-home/.claude'
    elif fault == 'set-profile': binding['env']['CLAUDE_CONFIG_DIR'] = binding['native_default_profile']
    elif fault == 'not-unset': binding['unset_env'].remove('CLAUDE_CONFIG_DIR')
    elif fault == 'codex':
        binding['provider'] = 'codex'
        binding['unset_env'] = list(ACCOUNT_ENVIRONMENT['unset_env']['codex']) + ['CLAUDE_CONFIG_DIR']
    elif fault == 'no-path': del binding['native_default_profile']
    elif fault == 'missing-credential': binding['unset_env'] = ['CLAUDE_CONFIG_DIR']
    path.write_text(json.dumps(decision))
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    if fault is not None:
        assert result.returncode != 0 and ('required credential override' if fault == 'missing-credential' else 'provider/profile') in result.stderr
        assert not result.stdout
        return
    assert result.returncode == 0, result.stderr
    packet = json.loads(result.stdout)
    assert packet['launch_method'] == 'orca-native'
    assert packet['account_binding'] == binding
    assert 'launch_command' not in packet
    assert 'before task delivery' in packet['delivery_gate']


@pytest.mark.parametrize('fault', [None, 'active-managed', 'home', 'identity', 'missing-metadata', 'selection', 'organization', 'provider-id'])
def test_orca_system_default_selection_is_rechecked_without_a_managed_account_id(tmp_path, fault):
    env, argv, path, decision, log, response = native_fixture(tmp_path, active=None)
    binding = decision['account_binding']
    profile = str(Path(env['HOME']) / '.claude')
    binding.update(id='configured-default', env={}, native_default_profile=profile)
    binding['unset_env'].append('CLAUDE_CONFIG_DIR')
    binding['discovery']['selection'] = 'system-default'
    data = json.loads(response.read_text())
    group = data['result']['claude']
    group.update(systemDefaultHome=profile, systemDefaultEmail='same@example.test', systemDefaultOrganizationUuid='shared-org')
    if fault == 'active-managed': group['activeAccountIdsByRuntime']['host'] = 'selected'
    elif fault == 'home': group['systemDefaultHome'] = '/synthetic/other-home/.claude'
    elif fault == 'identity': group['systemDefaultOrganizationUuid'] = 'other-org'
    elif fault == 'missing-metadata': del group['systemDefaultEmail']
    elif fault == 'selection': binding['discovery']['selection'] = 'unknown-default'
    elif fault == 'organization': binding['expected_identity']['organization'] = 'Personal'
    elif fault == 'provider-id': binding['expected_identity']['providerAccountId'] = 'unprovable'
    response.write_text(json.dumps(data))
    path.write_text(json.dumps(decision))
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    if fault not in [None, 'organization']:
        assert result.returncode != 0 and ('system-default' in result.stderr or 'selection kind' in result.stderr or 'identity changed' in result.stderr)
        assert not result.stdout
        return
    assert result.returncode == 0, result.stderr
    packet = json.loads(result.stdout)
    assert packet['launch_method'] == 'orca-native'
    assert packet['account_binding']['id'] == 'configured-default'
    assert packet['account_binding']['discovery']['selection'] == 'system-default'


@pytest.mark.parametrize('fault', ['missing', 'no-effort', 'no-attachment', 'malformed', 'future-schema', 'legacy-no-attachment'])
def test_unsupported_native_capabilities_refuse_without_launch(tmp_path, fault):
    env, argv, path, decision, log, response = native_fixture(
        tmp_path, surface='agent-launch' if fault == 'legacy-no-attachment' else 'readiness-worker')
    capabilities = tmp_path / 'capabilities.json'
    data = json.loads(capabilities.read_text())
    if fault == 'missing':
        data['commands'] = []
    elif fault in ('no-effort', 'no-attachment'):
        data['commands'][0]['flags'].remove('effort' if fault == 'no-effort' else 'terminal')
    elif fault == 'future-schema':
        data['schemaVersion'] = 2
    elif fault == 'legacy-no-attachment':
        data['commands'].pop()
    capabilities.write_text('interrupted output' if fault == 'malformed' else json.dumps(data))
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert result.returncode != 0 and 'capability' in result.stderr
    assert 'task delivery' in result.stderr and not result.stdout
    assert [json.loads(x) for x in log.read_text().splitlines()] == [
        ['account', 'list', '--json'], ['agent-context', '--json']]


def test_native_capability_interruption_and_expiry_leave_assignment_undelivered(tmp_path):
    import importlib.util
    from unittest.mock import patch
    spec = importlib.util.spec_from_file_location('crew_capability_test', CREW)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    env, argv, path, decision, log, response = native_fixture(tmp_path)
    binding = decision['account_binding']
    capabilities = (tmp_path / 'capabilities.json').read_text()
    calls = []

    def read(args, **kwargs):
        calls.append(args[1:])
        if args[1] == 'account':
            return subprocess.CompletedProcess(args, 0, response.read_text())
        if interrupt:
            raise subprocess.TimeoutExpired(args, 30)
        binding['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
        return subprocess.CompletedProcess(args, 0, capabilities)

    for interrupt, expected in [(True, 'capability discovery unavailable'), (False, 'expired')]:
        with patch.object(module.subprocess, 'run', side_effect=read):
            with pytest.raises(module.Error, match=expected):
                module.orca_native_preparation(binding, decision['selected'])
    assert calls == [['account', 'list', '--json'], ['agent-context', '--json']] * 2


@pytest.mark.parametrize('active_remaining, expected_method', [(10, 'command'), (80, 'orca-native')])
def test_orca_rotates_accounts_before_changing_astra(tmp_path, active_remaining, expected_method):
    env, argv, path, decision, log, response = native_fixture(tmp_path, provider='codex', active='other')
    capabilities = tmp_path / 'capabilities.json'
    data = json.loads(capabilities.read_text())
    data['commands'] += [
        {'command': 'terminal create', 'flags': ['worktree', 'command', 'json']},
        {'command': 'terminal wait', 'flags': ['terminal', 'for', 'timeout-ms', 'json']},
    ]
    capabilities.write_text(json.dumps(data))
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for key, remaining in [('other', active_remaining), ('selected', 99)]:
        rows.append({'key': 'codex:' + key, 'id': key, 'provider': 'codex', 'runtime': 'host',
                     'active': key == 'other', 'host_active': key == 'other', 'priority': 0, 'label': key,
                     'profile': str(tmp_path / ('profile ' + key)), 'min_remaining_percent': 10,
                     'discovery': decision['account_binding']['discovery'],
                     'expected_identity': decision['account_binding']['expected_identity'],
                     'measurement': {'status': 'known', 'refreshed_at': now,
                                     'windows': [{'id': 'weekly', 'percentRemaining': remaining}]}})
    runtime = tmp_path / 'runtime.json'
    runtime.write_text(json.dumps({'account_inventory': {'accounts': rows}, 'account_max_age_seconds': 300}))
    # Exercise Crew's actual check flags and the real router; only live collection is replaced.
    wrapper = tmp_path / 'fixture_router.py'
    wrapper.write_text('import runpy,sys\nsys.path.insert(0, ' + repr(str(ROUTER.parent)) + ')\n'
                       'sys.argv.remove("--codexbar")\nrunpy.run_path(' + repr(str(ROUTER)) + ', run_name="__main__")\n')
    subprocess.run([sys.executable, str(ROUTER), 'setup', '--selector', 'agent'], env=env, capture_output=True, check=True)
    argv = argv[:-2] + ['--candidate', 'codex/gpt-6-astra/high', '--reason', 'Architecture requires Astra reasoning',
                        '--router', str(wrapper), '--runtime-file', str(runtime)]
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr + result.stdout
    packet = json.loads(result.stdout)
    assert packet['routing']['model'] == 'gpt-6-astra' and packet['routing']['effort'] == 'high'
    assert packet['launch_method'] == expected_method
    selected = 'selected' if active_remaining == 10 else 'other'
    assert packet['account_binding']['id'] == selected
    assert [json.loads(x) for x in log.read_text().splitlines()] == [
        ['account', 'list', '--json'], ['agent-context', '--json']]
    if expected_method == 'command':
        assert packet['prepare_surface'] == 'profile-command'
        assert 'before task delivery' in packet['delivery_gate']
        binary = tmp_path / 'bin'; binary.mkdir()
        stub = binary / 'codex'
        stub.write_text('#!' + sys.executable + '\nimport os,json,sys\nprint(json.dumps({"profile":os.environ.get("CODEX_HOME"),"override":os.environ.get("OPENAI_API_KEY"),"argv":sys.argv[1:]}))\n')
        stub.chmod(0o700)
        env.update(PATH=str(binary) + os.pathsep + env['PATH'], OPENAI_API_KEY='synthetic-other-account')
        launched = subprocess.run(['/bin/sh', '-c', packet['launch_command']], env=env, capture_output=True, text=True, check=True)
        assert json.loads(launched.stdout) == {'profile': str(tmp_path / 'profile selected'), 'override': None,
            'argv': ['--no-alt-screen', '--model', 'gpt-6-astra', '-c', 'model_reasoning_effort=high']}


@pytest.mark.parametrize('fault, expected', [
    ('identity', 'identity changed'), ('signed-out', 'not ready'), ('expired', 'expired'),
    ('missing-terminal', 'capability'), ('missing-attachment', 'capability'),
])
def test_alternate_orca_account_requires_identity_freshness_and_launch_support(tmp_path, fault, expected):
    env, argv, path, decision, log, response = native_fixture(tmp_path, provider='codex', active='other')
    if fault == 'identity':
        decision['account_binding']['expected_identity']['email'] = 'wrong@example.test'
    elif fault == 'expired':
        decision['account_binding']['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
    elif fault == 'signed-out':
        data = json.loads(response.read_text())
        data['result']['codex']['accounts'][0]['needsSignIn'] = True
        response.write_text(json.dumps(data))
    elif fault == 'missing-attachment':
        capabilities = tmp_path / 'capabilities.json'
        data = json.loads(capabilities.read_text())
        data['commands'][0]['flags'].remove('terminal')
        capabilities.write_text(json.dumps(data))
    path.write_text(json.dumps(decision))
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert result.returncode != 0 and expected in result.stderr, result.stderr
    assert not result.stdout
    if log.exists():
        assert all(call in [['account', 'list', '--json'], ['agent-context', '--json']]
                   for call in map(json.loads, log.read_text().splitlines()))
