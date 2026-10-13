"""Cross-process routing to Crew to a synthetic CLI: prove account custody."""
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
ROUTER = ROOT / 'skills/model-routing/scripts/router.py'
CREW = Path(__file__).with_name('assignment.py')


def test_gate_binding_survives_crew_shell_and_expires(tmp_path):
    env = os.environ.copy()
    env.update(HOME=str(tmp_path / 'home'), CODEX_HOME=str(tmp_path / 'codex'))
    profile = tmp_path / "profile with space ' and $literal"
    profile.mkdir()
    now = datetime.now(timezone.utc).isoformat()
    runtime = {'account_max_age_seconds': 300, 'account_inventory': {'accounts': [
        {'provider': 'claude', 'key': 'claude:priority', 'id': 'priority', 'label': 'test@example.test',
         'runtime': 'host', 'active': False, 'profile': str(profile), 'priority': 100, 'min_remaining_percent': 0,
         'measurement': {'status': 'known', 'refreshed_at': now, 'windows': [{'id': 'session', 'percentRemaining': 1}]}}]}}
    runtime_file = tmp_path / 'runtime.json';runtime_file.write_text(json.dumps(runtime))
    subprocess.run([sys.executable, str(ROUTER), 'setup', '--selector', 'agent'], env=env, capture_output=True, check=True)
    check = subprocess.run([sys.executable, str(ROUTER), 'check', '--repo', str(tmp_path), '--candidate', 'claude/claude-haiku-5-5/high', '--reason', 'Bounded implementation with review', '--runtime-file', str(runtime_file)], env=env, capture_output=True, text=True)
    assert check.returncode == 0, check.stderr + check.stdout
    decision = json.loads(check.stdout)
    decision_file = tmp_path / 'decision.json';decision_file.write_text(check.stdout)
    argv = [sys.executable, str(CREW), 'packet', '--repo', str(tmp_path), '--manifest', 'orca', '--extra', 'front_key=fixture/test', '--title', 'Fixture task', '--role', 'worker', '--reports-to', 'user', '--work-ref', 'beads:fixture', '--decision-json', str(decision_file)]
    packet_result = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert packet_result.returncode == 0, packet_result.stderr
    packet = json.loads(packet_result.stdout)
    assert packet['account_binding']['id'] == 'priority'
    assert packet['launch_method'] == 'command'
    # Execute the exact quoted command against a harmless fake CLI. No provider call.
    binary = tmp_path / 'bin';binary.mkdir()
    stub = binary / 'claude'
    stub.write_text('#!' + sys.executable + '\nimport os,json\nprint(json.dumps({"profile":os.environ.get("CLAUDE_CONFIG_DIR"),"override":os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")}))\n')
    stub.chmod(0o700)
    env.update(PATH=str(binary) + os.pathsep + env['PATH'], CLAUDE_CODE_OAUTH_TOKEN='synthetic-other-account')
    launched = subprocess.run(['/bin/sh', '-c', packet['launch_command']], env=env, capture_output=True, text=True, check=True)
    assert json.loads(launched.stdout) == {'profile': str(profile), 'override': None}
    decision['account_binding']['refreshed_at'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat()
    decision_file.write_text(json.dumps(decision))
    expired = subprocess.run(argv, env=env, capture_output=True, text=True)
    assert expired.returncode != 0 and 'expired' in expired.stderr


def test_account_binding_refuses_a_manifest_that_cannot_apply_it(tmp_path):
    env = {**os.environ, 'HOME': str(tmp_path), 'CODEX_HOME': str(tmp_path / 'codex')}
    decision = {'status': 'selected', 'selected': {'id': 'fixture', 'agent': 'claude', 'model': 'haiku', 'effort': 'high'}, 'reason': 'Bounded task',
                'account_binding': {'provider': 'claude', 'id': 'one', 'env': {'CLAUDE_CONFIG_DIR': '/profiles/one'}, 'refreshed_at': datetime.now(timezone.utc).isoformat(), 'max_age_seconds': 300}}
    path = tmp_path / 'decision.json';path.write_text(json.dumps(decision))
    manifest = {'mechanism': 'native', 'launchable_agents': ['claude'], 'communication': 'Harness messages', 'retire': 'Harness stop'}
    r = subprocess.run([sys.executable, str(CREW), 'packet', '--repo', str(tmp_path), '--manifest', json.dumps(manifest), '--title', 'Fixture', '--role', 'worker', '--reports-to', 'user', '--work-ref', 'beads:fixture', '--decision-json', str(path)], env=env, capture_output=True, text=True)
    assert r.returncode != 0 and 'cannot bind' in r.stderr
