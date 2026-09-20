"""Behavior tests for persistent setup, selection ownership and launch gates."""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jev
import router
import selector


class SelectorTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        env = patch.dict(os.environ, {'HOME': str(self.root), 'CODEX_HOME': str(self.root / 'codex')}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        self.compiled = {'candidates': {
            'worker': {'launch': {'agent': 'codex', 'model': 'example', 'effort': 'high'}, 'features': ['tools']},
            'other': {'launch': {'agent': 'codex', 'model': 'other', 'effort': 'high'}, 'features': ['tools']},
        }, 'accounts': {}, 'preferences': [], 'candidate_sources': {}}
        self.task = self.root / 'task.json'
        self.task.write_text(json.dumps({'outcome': 'Implement the provided function.', 'acceptance_criteria': ['Regression passes']}))
        self.args = argparse.Namespace(repo='.', task_file=str(self.task), exact_route=None,
            candidate=None, reason=None, route_basis=None, use_quota_fallback=None, require_zdr=False,
            launchable_via=['codex'], require_feature=[], minimum_context=None, max_effort_basis=None,
            allow_model=[], allow_effort=[], accept_quota_unknown=None, quota_axi=False, runtime_file=None)
        self.runtime = {'candidates': {c: {'quota': {'status': 'known', 'effective_percent_remaining': 50}}
                                       for c in self.compiled['candidates']}}

    def enable(self):
        jev.store_key('synthetic-key')
        with patch.object(jev, 'evaluate_bounded', return_value={}):
            selector.setup('jev')

    def evaluate(self, payload):
        choices = payload['questions']['route']['criteria']
        choice = 'c001'
        return {'answers': {'route': {'choice': choice, 'confidence': 0.6,
                'probabilities': {c: 1.0 if c == choice else 0.0 for c in choices}}},
                'elapsed_seconds': .5, 'usage': {}, 'cost_usd': 0}

    def run_route(self, runtime=None, fresh=None, evaluate=None):
        with patch.object(jev, 'evaluate_bounded', side_effect=evaluate or self.evaluate), patch.object(
            router, 'compile_brief', return_value=fresh or self.compiled), patch.object(
            router, 'load_runtime', return_value=self.runtime if runtime is None else runtime):
            return selector.route(self.compiled, self.args, self.runtime)

    def test_unset_requires_choice_and_agent_mode_never_needs_gateway(self):
        self.assertEqual(selector.status()['status'], 'setup-required')
        with self.assertRaises(jev.Error):
            selector.route(self.compiled, self.args, self.runtime)
        with patch.object(jev, 'evaluate_bounded', side_effect=AssertionError('unexpected API')):
            selector.setup('agent')
            self.assertEqual(selector.status()['selector'], 'agent')
            self.args.candidate, self.args.reason = 'worker', 'Adequate for supplied patch.'
            self.assertEqual(selector.route(self.compiled, self.args, self.runtime)['status'], 'selected')
        result = subprocess.run([sys.executable, str(Path(router.__file__)), 'status'], cwd=self.root,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['selector'], 'agent')

    def test_failed_enable_preserves_choice_and_successful_disable_keeps_key(self):
        selector.setup('agent')
        jev.store_key('synthetic-key')
        with patch.object(jev, 'evaluate_bounded', side_effect=jev.Error('Gateway HTTP 401')):
            with self.assertRaises(jev.Error): selector.setup('jev')
        self.assertEqual(selector.status()['selector'], 'agent')
        self.enable()
        self.assertEqual(selector.status()['selector'], 'jev')
        selector.setup('agent')
        self.assertEqual(jev.saved_key(), 'synthetic-key')

    def test_enabled_selection_uses_jev_and_retains_provenance(self):
        self.enable()
        decision = self.run_route()
        self.assertEqual(decision['status'], 'selected')
        self.assertEqual(decision['selected']['id'], 'worker')
        self.assertEqual(decision['selector']['confidence'], .6)
        self.args.candidate = 'other'
        with self.assertRaises(jev.Error): self.run_route()

    def test_fresh_quota_refuses_or_requires_acceptance(self):
        self.enable()
        exhausted = {'candidates': {'worker': {'quota': {'status': 'exhausted'}}}}
        self.assertEqual(self.run_route(runtime=exhausted)['status'], 'refused')
        self.assertEqual(self.run_route(runtime={})['status'], 'needs-acceptance')

    def test_changed_candidate_or_preferences_refuses_launch(self):
        self.enable()
        changed = deepcopy(self.compiled)
        changed['candidates']['worker']['launch']['model'] = 'different'
        self.assertEqual(self.run_route(fresh=changed)['status'], 'refused')
        changed = deepcopy(self.compiled)
        changed['preferences'].append({'scope': 'global', 'text': 'Changed policy'})
        self.assertEqual(self.run_route(fresh=changed)['status'], 'refused')

    def test_abstention_and_provider_failure_have_no_agent_fallback(self):
        self.enable()
        def abstain(payload):
            result = self.evaluate(payload)
            result['answers']['route'].update(choice='abstain', probabilities={'abstain': 1})
            return result
        self.assertEqual(self.run_route(evaluate=abstain)['status'], 'refused')
        with self.assertRaises(jev.Error):
            self.run_route(evaluate=lambda _: (_ for _ in ()).throw(jev.Error('unavailable')))

    def test_principal_model_constraint_filters_before_call(self):
        self.enable()
        self.args.allow_model = ['other']
        self.assertEqual(self.run_route()['selected']['model'], 'other')
        self.args.allow_model = ['missing']
        with self.assertRaises(jev.Error): self.run_route()

    def test_interactive_setup_requires_explicit_yes_or_no(self):
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='n'):
            self.assertEqual(selector.setup()['selector'], 'agent')
        with patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value=''):
            with self.assertRaises(jev.Error): selector.setup()
        self.assertEqual(selector.status()['selector'], 'agent')

    def test_task_cannot_carry_raw_session_or_non_text_fields(self):
        self.task.write_text(json.dumps({'outcome': 'Review', 'session': {'secrets': 'hidden'}}))
        with self.assertRaises(jev.Error): selector.load_task(self.task)

    def test_whole_call_deadline_stops_trickling_transport(self):
        with patch('subprocess.run', side_effect=subprocess.TimeoutExpired('jev', 20)):
            with self.assertRaisesRegex(jev.Error, '20 seconds'):
                jev.evaluate_bounded({'model': jev.MODEL, 'state': 'test', 'questions': {
                    'route': {'type': 'choice', 'instructions': 'Choose.', 'criteria': {'a': 'A', 'b': 'B'}}}})


if __name__ == '__main__':
    unittest.main()
