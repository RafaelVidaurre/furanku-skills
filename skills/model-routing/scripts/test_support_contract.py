"""Exercise public routing entrypoints together, with synthetic external tools.

Catalog, configuration, CLI serialization, quota adapter, and Crew packets are
real. HOME/CODEX_HOME and CodexBar are isolated; no live accounts are accessed.
"""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

import pytest
import router

ROOT = Path(__file__).resolve().parents[3]
CREW = ROOT / 'skills/crew/scripts/assignment.py'


@pytest.fixture
def cli(tmp_path, monkeypatch):
    home, repo, bin_dir = (tmp_path / name for name in ('home', 'repo', 'bin'))
    for path in (home, repo, bin_dir):
        path.mkdir()
    monkeypatch.setenv('HOME', str(home))
    monkeypatch.setenv('CODEX_HOME', str(home / 'codex'))
    monkeypatch.setenv('PATH', str(bin_dir) + os.pathsep + os.environ['PATH'])
    subprocess.run(['git', 'init', '-q', str(repo)], check=True)
    fake = bin_dir / 'codexbar'
    fake.write_text('#!' + sys.executable + '\n' + '''
import datetime, json, sys
if sys.argv[1:] == ['--version']:
    print('CodexBar 0.77.0')
    raise SystemExit
assert sys.argv[1:] == ['usage', '--provider', 'cursor', '--source', 'auto', '--format', 'json', '--no-credits']
print(json.dumps([{
    'provider': 'cursor', 'source': 'web',
    'rateWindowLabels': {'primary': 'Total', 'secondary': 'Cursor', 'tertiary': 'Third Party'},
    'usage': {
        'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'identity': {'providerID': 'cursor', 'accountID': 'synthetic-cursor-account', 'loginMethod': 'Cursor Free'},
        'primary': {'usedPercent': 40, 'windowMinutes': 43200},
        'secondary': {'usedPercent': 20, 'windowMinutes': 43200},
        'tertiary': {'usedPercent': 80, 'windowMinutes': 43200},
    }
}]))
''')
    fake.chmod(0o700)

    def run(script, *args, code=0):
        result = subprocess.run([sys.executable, str(script), *args, '--repo', str(repo)],
                                capture_output=True, text=True, timeout=15)
        assert result.returncode == code, f'{result.args}\n{result.stdout}\n{result.stderr}'
        return result.stdout
    return repo, run


@pytest.mark.parametrize('command', ['accounts', 'list'])
def test_catalog_models_and_billing_providers_reach_public_reports(cli, command):
    repo, run = cli
    # An unfamiliar harness must be visible as unsupported, rather than vanish.
    config = repo / '.furanku-skills/model-routing/config.json'
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({'version': 4, 'routes': {}, 'candidates': {
        'future/test/high': {'launch': {'agent': 'future', 'model': 'test', 'effort': 'high'},
                             'features': [], 'capabilities': {}}
    }}))
    brief = json.loads(run(router.__file__, 'brief', '--format', 'json'))
    catalog = json.loads(router.CATALOG.read_text())['candidates']
    assert set(catalog) <= set(brief['candidates']), 'Catalog additions were excluded from the routing brief'
    models = json.loads(run(Path(router.__file__).with_name('config.py'), 'models', '--format', 'json'))['models']
    assert set(brief['candidates']) == {row['candidate'] for row in models}
    expected = {
        (row.get('quota_pool') or row.get('quota_provider') or {}).get('provider')
        or row.get('quota_account') or row['launch']['agent']
        for row in brief['candidates'].values()
    }
    report = json.loads(run(router.__file__, command, '--format', 'json'))
    assert expected <= {row['provider'] for row in report['accounts']}, 'A routing billing provider silently disappeared from the account report'
    future = next(row for row in report['accounts'] if row['provider'] == 'future')
    assert future['measurement']['status'] == 'unknown'
    assert future['measurement']['detail'], 'Unsupported providers need an actionable explanation'
    cursor = next(row for row in report['accounts'] if row['provider'] == 'cursor')
    assert cursor['id'] == 'synthetic-cursor-account'
    assert [(w['label'], w['percentRemaining']) for w in cursor['measurement']['windows']] == [
        ('Total', 60), ('Cursor', 80), ('Third Party', 20),
    ]
    rendered = run(router.__file__, command)
    for provider in expected:
        assert f'| {provider.title()} |' in rendered
    assert 'Unverified' in rendered and 'Third Party: 20%' in rendered


def test_cursor_web_usage_does_not_silently_authorize_a_cli_launch(cli):
    _, run = cli
    args = ('check', '--candidate', 'cursor/claude-opus-5-5/high', '--codexbar',
            '--launchable-via', 'cursor', '--reason', 'Check the requested Cursor tuple.')
    pending = json.loads(run(router.__file__, *args, code=2))
    assert pending['status'] == 'needs-acceptance'
    assert pending['quota']['account']['provider'] == 'cursor'
    assert pending['quota']['account']['account_id'] == 'synthetic-cursor-account'
    assert 'report-only' in pending['quota']['detail']
    selected = json.loads(run(router.__file__, *args, '--accept-quota-unknown', 'Synthetic contract-test acceptance.'))
    assert selected['status'] == 'selected'


def test_builtin_crew_launchers_have_catalog_models_and_preserve_packet_tuples(cli):
    _, run = cli
    # Read the actual manifest rather than maintain a parallel list of harnesses.
    import importlib.util
    spec = importlib.util.spec_from_file_location('crew_contract', CREW)
    crew = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(crew)
    catalog = json.loads(router.CATALOG.read_text())['candidates']
    for agent in crew.KNOWN_MANIFESTS['orca']['launchable_agents']:
        matches = [(key, row) for key, row in catalog.items() if row['launch']['agent'] == agent]
        assert matches, f'Crew advertises {agent}, but routing has no candidate for it'
        key, candidate = matches[0]
        decision = {'status': 'selected', 'selected': {'id': key, **candidate['launch']},
                    'reason': 'Synthetic support contract; no agent is launched.', 'quota': {'status': 'known'}}
        packet = json.loads(run(CREW, 'packet', '--title', 'Check launch support', '--role', 'worker',
                                '--reports-to', 'user', '--manifest', 'orca', '--extra', 'front_key=test/support',
                                '--work-ref', 'beads:synthetic', '--decision-json', json.dumps(decision)))
        assert {field: packet['routing'][field] for field in ('agent', 'model', 'effort')} == candidate['launch']
        assert packet.get('launch_argv'), f'No launch command for advertised harness {agent}'
        assert shlex.split(packet['launch_command']) == packet['launch_argv']
        for field in ('model', 'effort'):
            if not any(candidate['launch'][field] in arg for arg in packet['launch_argv']):
                assert field in packet.get('launch_warning', ''), f'{agent} silently lost {field}'


@pytest.mark.parametrize('effort', ['high', 'xhigh'])
def test_terra_61_reaches_crew_as_an_exact_codex_tuple(cli, effort):
    _, run = cli
    key = f'codex/gpt-6.1-terra/{effort}'
    brief = json.loads(run(router.__file__, 'brief', '--format', 'json'))
    candidate = brief['candidates'][key]
    assert candidate['launch'] == {'agent': 'codex', 'model': 'gpt-6.1-terra', 'effort': effort}
    decision = {'status': 'selected', 'selected': {'id': key, **candidate['launch']},
                'reason': 'Synthetic contract test.', 'quota': {'status': 'known'}}
    packet = json.loads(run(CREW, 'packet', '--title', 'Check Terra', '--role', 'worker',
                            '--reports-to', 'user', '--manifest', 'orca', '--extra', 'front_key=test/terra',
                            '--work-ref', 'beads:synthetic', '--decision-json', json.dumps(decision)))
    assert packet['routing']['model'] == 'gpt-6.1-terra'
    assert packet['routing']['effort'] == effort
    assert 'gpt-6.1-terra' in packet['launch_argv']
