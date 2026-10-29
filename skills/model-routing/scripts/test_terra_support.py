"""The built-in Terra candidates survive routing and Crew packet construction."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize('effort', ['high', 'xhigh'])
def test_terra_catalog_to_crew_packet(tmp_path, effort):
    env = {**os.environ, 'HOME': str(tmp_path), 'CODEX_HOME': str(tmp_path / 'codex')}
    repo = tmp_path / 'repo'
    repo.mkdir()
    subprocess.run(['git', 'init', '-q', str(repo)], check=True, env=env)
    def run(script, *args):
        result = subprocess.run([sys.executable, str(script), *args, '--repo', str(repo)],
                                env=env, text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    brief = run(ROOT / 'skills/model-routing/scripts/router.py', 'brief', '--format', 'json')
    candidate_id = f'codex/gpt-6.1-terra/{effort}'
    launch = brief['candidates'][candidate_id]['launch']
    assert launch == {'agent': 'codex', 'model': 'gpt-6.1-terra', 'effort': effort}
    decision = {'status': 'selected', 'selected': {'id': candidate_id, **launch},
                'reason': 'Synthetic contract test.', 'quota': {'status': 'known'}}
    packet = run(ROOT / 'skills/crew/scripts/assignment.py', 'packet', '--title', 'Check Terra',
                 '--role', 'worker', '--reports-to', 'user', '--manifest', 'orca',
                 '--extra', 'front_key=test/terra', '--work-ref', 'beads:synthetic',
                 '--decision-json', json.dumps(decision))
    assert {key: packet['routing'][key] for key in launch} == launch
    assert 'gpt-6.1-terra' in packet['launch_argv']
