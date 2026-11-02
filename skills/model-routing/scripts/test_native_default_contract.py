"""Native default routing through public CLIs, with synthetic vendor boundaries."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
ROUTER = ROOT / 'skills/model-routing/scripts/router.py'
CONFIG = ROUTER.with_name('config.py')
CREW = ROOT / 'skills/crew/scripts/assignment.py'


@pytest.mark.parametrize('alias_org, remaining, selected', [
    ('default-org', 80, True),
    ('other-org', 80, False),
    (None, 80, False),
    ('default-org', 0, False),
])
def test_default_alias_preserves_identity_and_quota_gates(tmp_path, alias_org, remaining, selected):
    home, repo, binary = (tmp_path / name for name in ('home', 'repo', 'bin'))
    for path in (home, repo, binary):
        path.mkdir()
    env = {**os.environ, 'HOME': str(home), 'CODEX_HOME': str(home / 'codex'),
           'PATH': str(binary) + os.pathsep + os.environ['PATH'],
           'CLAUDE_CONFIG_DIR': '/synthetic/ambient-profile',
           'CLAUDE_CODE_OAUTH_TOKEN': 'synthetic-override'}
    subprocess.run(['git', 'init', '-q', str(repo)], env=env, check=True)
    profile = str(home / '.claude')
    group = {'accounts': [{'id': 'registered-alias', 'email': 'default@example.test',
                           **({'organizationUuid': alias_org} if alias_org else {})}],
             'activeAccountId': None, 'activeAccountIdsByRuntime': {'host': None},
             'systemDefaultHome': profile, 'systemDefaultEmail': 'default@example.test',
             'systemDefaultOrganizationUuid': 'default-org'}
    capabilities = {'schemaVersion': 1, 'commands': [
        {'command': 'agent launch', 'flags': ['agent', 'model', 'effort', 'worktree', 'surface', 'json']},
        {'command': 'orchestration worker-start',
         'flags': ['spec', 'task', 'terminal', 'run', 'retry-of', 'worktree', 'json']},
    ]}
    orca = binary / 'orca'
    orca.write_text('#!' + sys.executable + '\nimport json,sys\n' +
        f'responses = {{("account", "list", "--json"): {{"ok": True, "result": {{"claude": {group!r}}}}}, '
        f'("agent-context", "--json"): {capabilities!r}}}\n' +
        'print(json.dumps(responses[tuple(sys.argv[1:])]))\n')
    claude = binary / 'claude'
    claude.write_text('#!' + sys.executable + '\nimport json,os,sys\n' +
        'assert sys.argv[1:] == ["auth", "status", "--json"]\n' +
        'assert "CLAUDE_CONFIG_DIR" not in os.environ\n' +
        'assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ\n' +
        'print(json.dumps({"loggedIn": True, "email": "default@example.test", '
        '"orgId": "default-org", "orgName": "Default"}))\n')
    codexbar = binary / 'codexbar'
    codexbar.write_text('#!' + sys.executable + '\nimport datetime,json,os,sys\n' +
        'if sys.argv[1:] == ["--version"]:\n print("CodexBar 0.77.0"); raise SystemExit\n' +
        'assert sys.argv[1:] == ["usage", "--provider", "claude", "--source", "cli", "--format", "json", "--no-credits"]\n' +
        'assert "CLAUDE_CONFIG_DIR" not in os.environ\n' +
        'assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ\n' +
        'print(json.dumps([{"provider": "claude", "source": "claude", "usage": {'
        '"updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), '
        '"identity": {"providerID": "claude", "accountEmail": "default@example.test"}, '
        f'"primary": {{"usedPercent": {100 - remaining}, "windowMinutes": 300}}'
        '}}]))\n')
    for executable in (orca, claude, codexbar):
        executable.chmod(0o700)

    def run(script, *args, code=0):
        result = subprocess.run([sys.executable, str(script), *args], env=env,
                                capture_output=True, text=True, timeout=15)
        assert result.returncode == code, result.stdout + result.stderr
        return json.loads(result.stdout)

    # This policy follows native sign-in changes, with no permanent identity pin.
    config = tmp_path / 'input.json'
    config.write_text(json.dumps({'version': 4, 'routes': {}, 'account_routing': {
        'source': 'orca', 'orca_command': str(orca), 'profiles': {
            'claude:system-default': {'profile': profile, 'profile_mode': 'native-default',
                                      'discovery': 'configured', 'min_remaining_percent': 0},
        }}}))
    run(CONFIG, 'write', 'global', '--file', str(config))
    run(ROUTER, 'setup', '--selector', 'agent')
    decision = run(ROUTER, 'check', '--repo', str(repo), '--codexbar',
                   '--candidate', 'claude/claude-opus-5-5/high',
                   '--reason', 'Preserve the requested native-default launch.',
                   '--native-account-only', 'claude', '--launchable-via', 'claude',
                   code=0 if selected else 1)
    if not selected:
        assert decision['status'] == 'refused'
        assert 'account_binding' not in decision
        if remaining:
            assert 'ambiguous organization' in ' '.join(decision['reasons'])
        return
    binding = decision['account_binding']
    assert binding['key'] == 'claude:system-default'
    assert binding['discovery']['selection'] == 'system-default'
    assert binding['env'] == {} and 'CLAUDE_CONFIG_DIR' in binding['unset_env']
    assert binding['native_default_profile'] == profile
    assert binding['expected_identity'] == {'email': 'default@example.test', 'organizationUuid': 'default-org'}
    saved = tmp_path / 'decision.json'
    saved.write_text(json.dumps(decision))
    packet = run(CREW, 'packet', '--repo', str(repo), '--manifest', 'orca',
                 '--extra', 'front_key=fixture/default', '--title', 'Native default contract',
                 '--role', 'worker', '--reports-to', 'user', '--work-ref', 'beads:synthetic',
                 '--decision-json', str(saved))
    assert packet['launch_method'] == 'orca-native'
    assert packet['account_binding'] == binding
    assert packet['prepare_argv'][1:3] == ['agent', 'launch']
    assert '--prompt' not in packet['prepare_argv']
    assert 'launch_command' not in packet
