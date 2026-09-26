"""Hermetic credential and HTTP boundary checks; no live Gateway requests."""

from copy import deepcopy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jev
import jev_context
import jev_trial


PAYLOAD = {"model": jev.MODEL, "state": {"task": "Rename a local variable."},
           "questions": {"route": {"type": "choice", "instructions": "Choose an adequate option.",
                        "criteria": {"c001": "Bounded implementation", "abstain": "Insufficient information"}}}}
RESPONSE = {"model": jev.MODEL, "answers": {"route": {"type": "choice", "choice": "c001",
            "probabilities": {"c001": 0.9, "abstain": 0.1}}},
            "providerMetadata": {"typesafe": {"confidence": {"route": 0.7}},
                                 "gateway": {"cost": "0.0001"}},
            "usage": {"inputTokens": 100, "outputTokens": 10}}


class JevTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.environment = mock.patch.dict(os.environ, {
            "HOME": str(self.home), "CODEX_HOME": str(self.home / "codex")}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        jitter = mock.patch("jev_backoff.random.uniform", side_effect=lambda low, high: low)
        jitter.start()
        self.addCleanup(jitter.stop)

    def test_setup_stores_key_for_other_working_directories_without_echo(self):
        script = Path(jev.__file__).resolve()
        secret = "synthetic-test-credential"
        setup = subprocess.run([sys.executable, str(script), "setup", "--stdin"], input=secret + "\n",
                               text=True, capture_output=True, check=False, cwd=self.home)
        self.assertEqual(setup.returncode, 0, setup.stderr)
        self.assertNotIn(secret, setup.stdout + setup.stderr)
        path = jev.credential_path()
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(jev.load_key(), (secret, "machine"))
        other_repo = self.home / "other"
        other_repo.mkdir()
        status = subprocess.run([sys.executable, str(script), "status"], text=True, capture_output=True,
                                check=False, cwd=other_repo)
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(json.loads(status.stdout)["source"], "machine")
        self.assertNotIn(secret, status.stdout + status.stderr)

    def test_interactive_setup_uses_hidden_prompt(self):
        with mock.patch("sys.stdin.isatty", return_value=True), mock.patch(
            "getpass.getpass", return_value="hidden-test-key") as prompt, mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            result = jev.setup()
        prompt.assert_called_once()
        self.assertEqual(result["status"], "saved")
        self.assertNotIn("hidden-test-key", err.getvalue())
        self.assertEqual(jev.saved_key(), "hidden-test-key")

    def test_blank_input_preserves_saved_credential(self):
        jev.store_key("old-test-key")
        with mock.patch("sys.stdin", io.StringIO("\n")), self.assertRaises(jev.Error):
            jev.setup(True)
        self.assertEqual(jev.saved_key(), "old-test-key")

    def test_environment_override_does_not_rewrite_saved_key(self):
        jev.store_key("saved-test-key")
        with mock.patch.dict(os.environ, {"AI_GATEWAY_API_KEY": "override-test-key"}):
            self.assertEqual(jev.load_key(), ("override-test-key", "environment"))
        self.assertEqual(jev.saved_key(), "saved-test-key")

    def test_unsafe_file_is_not_loaded_or_executed(self):
        path = jev.store_key("test-key")
        path.chmod(0o644)
        with self.assertRaises(jev.Error):
            jev.saved_key()
        path.chmod(0o600)
        path.write_text('AI_GATEWAY_API_KEY=$(touch should-not-exist)')
        with self.assertRaises(jev.Error):
            jev.saved_key()
        self.assertFalse((Path.cwd() / "should-not-exist").exists())

    def test_symlink_is_not_overwritten(self):
        destination = self.home / "outside"
        destination.write_text("unchanged")
        path = jev.credential_path()
        path.parent.mkdir(parents=True)
        path.symlink_to(destination)
        with self.assertRaises(jev.Error):
            jev.store_key("test-key")
        self.assertEqual(destination.read_text(), "unchanged")

    def test_real_client_serializes_request_and_keeps_confidence_distinct(self):
        jev.store_key("test-key")
        with mock.patch("urllib.request.OpenerDirector.open", return_value=io.BytesIO(json.dumps(RESPONSE).encode())) as transport:
            result = jev.evaluate(PAYLOAD)
        request = transport.call_args.args[0]
        self.assertEqual(request.full_url, jev.ENDPOINT)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        sent = json.loads(request.data)
        self.assertEqual(sent["state"], PAYLOAD["state"])
        self.assertEqual(sent["providerOptions"]["gateway"]["only"], ["typesafe-ai"])
        self.assertNotIn("test-key", request.data.decode())
        self.assertEqual(result["answers"]["route"]["confidence"], 0.7)
        self.assertEqual(result["answers"]["route"]["probabilities"]["c001"], 0.9)
        self.assertEqual(result["status"], "recommendation")
        self.assertNotIn("test-key", json.dumps(result))

    def test_missing_key_does_not_make_a_request(self):
        with mock.patch("urllib.request.OpenerDirector.open") as transport, self.assertRaises(jev.Error):
            jev.evaluate(PAYLOAD)
        transport.assert_not_called()

    def test_provider_failure_is_not_retried_or_echoed(self):
        jev.store_key("test-key")
        failure = urllib.error.HTTPError(jev.ENDPOINT, 401, "test-key", {}, io.BytesIO(b"test-key"))
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=failure) as transport:
            with self.assertRaises(jev.Error) as caught:
                jev.evaluate(PAYLOAD)
        transport.assert_called_once()
        self.assertIn("401", str(caught.exception))
        self.assertNotIn("test-key", str(caught.exception))

    def test_429_retries_quickly_and_returns_attempt_count(self):
        jev.store_key("test-key")
        limited = urllib.error.HTTPError(jev.ENDPOINT, 429, "private body",
                                         {}, io.BytesIO(b"private body"))
        response = io.BytesIO(json.dumps(RESPONSE).encode())
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=[limited, response]) as transport, \
             mock.patch("jev.time.sleep") as sleep:
            result = jev.evaluate(PAYLOAD)
        self.assertEqual(transport.call_count, 2)
        self.assertEqual(sleep.call_count, 1)
        self.assertAlmostEqual(sleep.call_args.args[0], 1.0, delta=0.1)
        self.assertEqual(result["attempts"], 2)

    def test_429_respects_retry_after_and_fails_fast_when_it_exceeds_budget(self):
        jev.store_key("test-key")
        limited = urllib.error.HTTPError(jev.ENDPOINT, 429, "private body",
                                         {"Retry-After": "45"}, io.BytesIO(b"private body"))
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=limited) as transport, \
             mock.patch("jev.time.sleep") as sleep, self.assertRaises(jev.RateLimitError) as caught:
            jev.evaluate(PAYLOAD)
        transport.assert_called_once()
        sleep.assert_not_called()
        self.assertAlmostEqual(caught.exception.retry_after_seconds, 45, delta=0.1)
        self.assertNotIn("private body", str(caught.exception))

    def test_429_without_header_stops_after_three_attempts(self):
        jev.store_key("test-key")
        def limited(*_args, **_kwargs):
            raise urllib.error.HTTPError(jev.ENDPOINT, 429, "private body", {},
                                         io.BytesIO(b"private body"))
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=limited) as transport, \
             mock.patch("jev.time.sleep") as sleep, self.assertRaises(jev.RateLimitError) as caught:
            jev.evaluate(PAYLOAD)
        self.assertEqual(transport.call_count, 3)
        self.assertEqual(len(sleep.call_args_list), 2)
        for call, expected in zip(sleep.call_args_list, (1.0, 2.0)):
            self.assertAlmostEqual(call.args[0], expected, delta=0.1)
        self.assertAlmostEqual(caught.exception.retry_after_seconds, 4.0, delta=0.1)

    def test_bounded_client_preserves_retry_after_for_router(self):
        failure = {"status": "error", "code": "rate_limited", "attempts": 1,
                   "retry_after_seconds": 45, "error": "Gateway HTTP 429",
                   "diagnostics": {"code": "rate_limit_exceeded"}, "delay_source": "server"}
        completed = subprocess.CompletedProcess([], 1, "", json.dumps(failure))
        with mock.patch("jev.subprocess.run", return_value=completed), \
             self.assertRaises(jev.RateLimitError) as caught:
            jev.evaluate_bounded(PAYLOAD)
        self.assertAlmostEqual(caught.exception.retry_after_seconds, 45, delta=0.1)
        self.assertEqual(caught.exception.attempts, 1)
        self.assertEqual(caught.exception.diagnostics, failure['diagnostics'])
        self.assertEqual(caught.exception.delay_source, 'server')

    def test_cooldown_survives_process_restart_and_prevents_another_http_call(self):
        jev.store_key('test-key')
        error = urllib.error.HTTPError(jev.ENDPOINT, 429, '', {'Retry-After': '45'}, io.BytesIO(b'{}'))
        with mock.patch('urllib.request.OpenerDirector.open', side_effect=error), self.assertRaises(jev.RateLimitError):
            jev.evaluate(PAYLOAD)
        script = '''
import json, sys
from unittest.mock import patch
import jev
with patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('HTTP forbidden')):
    try:
        jev.evaluate(json.loads(sys.stdin.read()))
    except jev.RateLimitError as error:
        print(json.dumps({'attempts': error.attempts, 'delay': error.retry_after_seconds}))
'''
        child = subprocess.run([sys.executable, '-c', script], input=json.dumps(PAYLOAD),
                               cwd=Path(jev.__file__).parent, capture_output=True, text=True, timeout=5)
        self.assertEqual(child.returncode, 0, child.stderr)
        result = json.loads(child.stdout)
        self.assertEqual(result['attempts'], 0)
        self.assertGreater(result['delay'], 35)
        self.assertLessEqual(result['delay'], 45)

    def test_new_call_continues_backoff_and_success_resets_it(self):
        jev.store_key('test-key')
        def limited(*args, **kwargs):
            raise urllib.error.HTTPError(jev.ENDPOINT, 429, '', {}, io.BytesIO(b'{}'))
        with mock.patch('urllib.request.OpenerDirector.open', side_effect=limited), mock.patch('jev.time.sleep'):
            with mock.patch('jev_backoff.time.time', return_value=100), self.assertRaises(jev.RateLimitError):
                jev.evaluate(PAYLOAD)
            with mock.patch('jev_backoff.time.time', return_value=200), self.assertRaises(jev.RateLimitError) as caught:
                jev.evaluate(PAYLOAD)
        self.assertEqual(caught.exception.retry_after_seconds, 30)
        path = next((self.home / '.furanku-skills/model-routing/gateway-backoff').glob('*.json'))
        self.assertEqual(json.loads(path.read_text())['failures'], 6)
        with mock.patch('jev_backoff.time.time', return_value=300), mock.patch(
                'urllib.request.OpenerDirector.open', return_value=io.BytesIO(json.dumps(RESPONSE).encode())):
            jev.evaluate(PAYLOAD)
        self.assertEqual(json.loads(path.read_text()), {})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('test-key', path.name + path.read_text())

    def test_concurrent_client_cannot_make_duplicate_network_attempt(self):
        jev.store_key('test-key')
        with jev.jev_backoff.admission('test-key', jev.ENDPOINT):
            with mock.patch('urllib.request.OpenerDirector.open') as transport, self.assertRaises(jev.RateLimitError) as caught:
                jev.evaluate(PAYLOAD)
        transport.assert_not_called()
        self.assertEqual(caught.exception.reason, 'in_flight')
        self.assertEqual(caught.exception.attempts, 0)
        self.assertNotIn('HTTP 429', str(caught.exception))

    def test_429_diagnostics_cannot_echo_secrets_or_arbitrary_error_text(self):
        jev.store_key('test-key')
        body = {'error': {'type': 'rate_limit_error', 'code': 'test-key',
                          'message': 'Token rate limit exceeded: 1000 tokens per minute for private test-key', 'api_key': 'test-key'}}
        error = urllib.error.HTTPError(jev.ENDPOINT, 429, '',
            {'Retry-After': '60', 'x-ratelimit-limit-tokens': '1000', 'x-ratelimit-remaining': 'test-key'},
            io.BytesIO(json.dumps(body).encode()))
        with mock.patch('urllib.request.OpenerDirector.open', side_effect=error), self.assertRaises(jev.RateLimitError) as caught:
            jev.evaluate(PAYLOAD)
        self.assertEqual(caught.exception.diagnostics, {'type': 'rate_limit_error', 'code': 'unrecognized',
                         'message_category': 'token_rate', 'x-ratelimit-limit-tokens': 1000,
                         'stated_limit': {'count': 1000, 'unit': 'token', 'window_count': 1, 'window_unit': 'minute'}})
        path = next((self.home / '.furanku-skills/model-routing/gateway-backoff').glob('*.json'))
        self.assertNotIn('test-key', path.read_text() + str(caught.exception))

    def test_separate_keys_have_separate_cooldowns(self):
        with jev.jev_backoff.admission('key-a', jev.ENDPOINT) as cooldown:
            cooldown.limited(100, {})
        with jev.jev_backoff.admission('key-b', jev.ENDPOINT) as cooldown:
            self.assertEqual(cooldown.remaining(), 0)
        with jev.jev_backoff.admission('key-a', jev.ENDPOINT) as cooldown:
            self.assertGreater(cooldown.remaining(), 90)

    def test_cooldown_storage_failure_is_not_reported_as_a_network_failure(self):
        jev.store_key('test-key')
        body = io.BytesIO(b'{}')
        error = urllib.error.HTTPError(jev.ENDPOINT, 429, '', {}, body)
        with mock.patch('urllib.request.OpenerDirector.open', side_effect=error), \
             mock.patch('jev_backoff.os.replace', side_effect=OSError('private disk details')), \
             self.assertRaises(jev.Error) as caught:
            jev.evaluate(PAYLOAD)
        self.assertIn('shared Gateway cooldown', str(caught.exception))
        self.assertNotIn('private disk details', str(caught.exception))
        self.assertTrue(body.closed)

    def test_exponential_jitter_is_bounded_and_server_delay_takes_precedence(self):
        with jev.jev_backoff.admission('test-key', jev.ENDPOINT) as cooldown:
            with mock.patch('jev_backoff.random.uniform', side_effect=lambda low, high: high) as jitter:
                delays = [cooldown.limited(None, {}) for _ in range(9)]
                self.assertEqual(delays, [2, 4, 8, 16, 32, 60, 60, 60, 60])
                self.assertEqual(jitter.call_args_list[0], mock.call(1, 2))
                self.assertEqual(jitter.call_args_list[-1], mock.call(30, 60))
                self.assertEqual(cooldown.limited(120, {}), 120)
                self.assertEqual(jitter.call_count, 9)

    def test_redirect_is_refused(self):
        self.assertIsNone(jev.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid"))

    def test_gateway_verification_failure_explains_remedy_without_echoing_body(self):
        jev.store_key("test-key")
        body = {"error": {"type": "customer_verification_required", "message": "private test-key body"}}
        failure = urllib.error.HTTPError(jev.ENDPOINT, 403, "Forbidden", {}, io.BytesIO(json.dumps(body).encode()))
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=failure) as transport:
            with self.assertRaises(jev.Error) as caught:
                jev.evaluate(PAYLOAD)
        transport.assert_called_once()
        self.assertIn("customer_verification_required", str(caught.exception))
        self.assertIn("payment card", str(caught.exception))
        self.assertNotIn("test-key", str(caught.exception))
        self.assertNotIn("private", str(caught.exception))

    def test_invalid_answers_cannot_become_recommendations(self):
        mutations = [
            lambda r: r.update(model="unexpected"),
            lambda r: r["answers"].update(other=r["answers"].pop("route")),
            lambda r: r["answers"]["route"].update(choice="unoffered"),
            lambda r: r["answers"]["route"].update(probabilities={"c001": 1}),
            lambda r: r["answers"]["route"]["probabilities"].update(c001=float("nan")),
            lambda r: r["answers"]["route"]["probabilities"].update(c001=True),
            lambda r: r["answers"]["route"]["probabilities"].update(c001=0.1),
            lambda r: r["answers"]["route"].update(choice="abstain"),
            lambda r: r["providerMetadata"]["typesafe"]["confidence"].update(route=2),
        ]
        for mutate in mutations:
            response = deepcopy(RESPONSE)
            mutate(response)
            with self.subTest(response=response), self.assertRaises(jev.Error):
                jev.validate_result(response, PAYLOAD["questions"])

    def test_missing_confidence_stays_unknown(self):
        response = deepcopy(RESPONSE)
        response.pop("providerMetadata")
        result = jev.validate_result(response, PAYLOAD["questions"])
        self.assertIsNone(result["answers"]["route"]["confidence"])

    def test_zdr_is_an_explicit_request_option(self):
        ordinary = jev.validate_request(PAYLOAD)
        self.assertNotIn("zeroDataRetention", ordinary["providerOptions"]["gateway"])
        required = deepcopy(PAYLOAD)
        required["providerOptions"] = {"gateway": {"zeroDataRetention": True}}
        normalized = jev.validate_request(required)
        self.assertTrue(normalized["providerOptions"]["gateway"]["zeroDataRetention"])
        self.assertEqual(normalized["providerOptions"]["gateway"]["only"], ["typesafe-ai"])
        required["providerOptions"] = {"gateway": {"disallowPromptTraining": True}}
        normalized = jev.validate_request(required)
        self.assertTrue(normalized["providerOptions"]["gateway"]["disallowPromptTraining"])

    def test_trial_filters_with_real_gates_and_omits_private_runtime_and_labels(self):
        candidate = {
            "launch": {"agent": "codex", "model": "example", "effort": "high", "private_note": "PRIVATE_LAUNCH_NOTE"},
            "features": ["tools"], "capabilities": {}, "economics": {},
        }
        compiled = {"candidates": {"ok": candidate, "disabled": dict(candidate, enabled=False),
                                  "exhausted": deepcopy(candidate)},
                    "accounts": {}, "preferences": [{"scope": "global", "text": "Prefer adequate capability."}],
                    "layers": [{"path": "PRIVATE_CONFIG_PATH"}]}
        runtime = {"captured_at": "2026-09-20T00:00:00Z", "candidates": {
            "ok": {"quota": {"status": "known", "effective_percent_remaining": 50,
                    "account": {"provider": "codex", "email": "PRIVATE_EMAIL", "account_id": "PRIVATE_ACCOUNT"},
                    "detail": "PRIVATE_DIAGNOSTIC"}},
            "exhausted": {"quota": {"status": "exhausted"}},
        }}
        case = {"id": "example", "task": {"outcome": "Implement the supplied function."},
                "expected_models": ["PRIVATE_EXPECTATION"], "expectation_basis": "PRIVATE_LABEL"}
        payload, mapping, excluded = jev_trial.prepare_case(
            compiled, runtime, case, {"codex"}, allow_abstain=True)
        self.assertEqual(mapping, {"c001": "ok"})
        self.assertEqual(set(excluded), {"disabled", "exhausted"})
        self.assertNotIn("PRIVATE_", json.dumps(payload))
        profile = json.loads(payload["questions"]["route"]["criteria"]["c001"])
        self.assertEqual(profile["quota"]["anonymous_group"], "q1")
        self.assertEqual(profile["quota"]["status"], "known")

    def test_candidate_profile_carries_each_capability_scale(self):
        candidate = {"launch": {"agent": "codex", "model": "example", "effort": "high"},
                     "capabilities": {"reasoning": {
                         "status": "known", "score": 0.5, "conservative": 0.48, "confidence": "high",
                         "assessed_at": "2026-09-22", "evidence": ["https://example.com"],
                         "scale": "Index v2", "note": "Not comparable to Index v1."}}}
        reasoning = jev_context.candidate_profile(candidate, {})["capabilities"]["reasoning"]
        self.assertEqual(reasoning["scale"], "Index v2")
        self.assertEqual(reasoning["note"], "Not comparable to Index v1.")
        self.assertNotIn("evidence", reasoning)

    def test_trial_feature_and_launcher_constraints_leave_no_eligible_offer(self):
        compiled = {"candidates": {"worker": {"launch": {"agent": "codex", "model": "example", "effort": "high"},
                                            "features": ["tools"]}}, "accounts": {}, "preferences": []}
        with self.assertRaises(jev.Error):
            jev_trial.prepare_case(compiled, {}, {"task": {}, "require_features": ["vision"]}, {"codex"})
        with self.assertRaises(jev.Error):
            jev_trial.prepare_case(compiled, {}, {"task": {}}, {"claude"})

    def test_trial_keeps_unknown_quota_visible_without_accepting_it(self):
        compiled = {"candidates": {"worker": {"launch": {"agent": "codex", "model": "example", "effort": "high"},
                                            "features": ["tools"]}}, "accounts": {}, "preferences": []}
        payload, mapping, _excluded = jev_trial.prepare_case(
            compiled, {}, {"task": {"outcome": "Review code."}}, {"codex"},
            allow_abstain=True)
        profile = json.loads(payload["questions"]["route"]["criteria"]["c001"])
        self.assertEqual(profile["quota"]["status"], "unknown")
        self.assertNotIn("quota_acceptance", json.dumps(payload))
        self.assertEqual(mapping, {"c001": "worker"})

    def test_ordinary_choice_has_no_abstain_option_or_instruction(self):
        candidate = {"launch": {"agent": "codex", "model": "example", "effort": "high"},
                     "features": ["tools"]}
        compiled = {"candidates": {"first": candidate, "second": dict(candidate)},
                    "accounts": {}, "preferences": []}
        payload, mapping, _ = jev_context.prepare_case(
            compiled, {}, {"task": {"outcome": "Review code."}}, {"codex"})
        self.assertEqual(set(mapping), {"c001", "c002"})
        self.assertEqual(set(payload["questions"]["route"]["criteria"]), set(mapping))
        self.assertNotIn("abstain", payload["questions"]["route"]["instructions"].lower())

    def test_public_context_drops_private_profiles_and_preserves_candidate_states(self):
        compiled = {"candidates": {
            "codex/gpt-6-astra/high": {"enabled": True, "explicit": True, "private": "PRIVATE_PROFILE"},
            "codex/gpt-6-luna/max": {"enabled": False},
            "custom/private/high": {"private": "PRIVATE_CUSTOM"},
        }, "preferences": [{"scope": "global", "text": "PRIVATE_PREFERENCE"}]}
        jev_trial.use_public_context(compiled)
        self.assertNotIn("PRIVATE_", json.dumps(compiled))
        self.assertEqual(set(compiled["candidates"]), {
            "codex/gpt-6-astra/high", "codex/gpt-6-luna/max"})
        self.assertFalse(compiled["candidates"]["codex/gpt-6-luna/max"]["enabled"])
        self.assertTrue(compiled["candidates"]["codex/gpt-6-astra/high"]["explicit"])
        self.assertEqual(compiled["preferences"], jev_trial.PUBLIC_PREFERENCES)
        with self.assertRaisesRegex(jev.Error, "No eligible candidates"):
            jev_trial.prepare_case(compiled, {}, {"task": {"outcome": "Review code."}}, {"codex"})




class TypedEvaluationTest(unittest.TestCase):
    def payload(self):
        return {'model': jev.MODEL, 'state': {'result': 'All checks passed'}, 'questions': {
            'passed': {'type': 'boolean', 'instructions': 'Did the checks pass?'},
            'quality': {'type': 'score', 'instructions': 'Rate final quality.',
                        'criteria': ['Unusable result', 'Partly usable result', 'Requirements met']},
            'kind': {'type': 'choice', 'instructions': 'Classify the observed result.',
                     'criteria': {'test': 'Test output', 'prose': 'Prose artifact'}}}}

    def response(self):
        return {'model': jev.MODEL, 'answers': {
            'passed': {'type': 'boolean', 'probability': .98},
            'quality': {'type': 'score', 'score': 1.8, 'probabilities': {'0': 0, '1': .2, '2': .8}},
            'kind': {'type': 'choice', 'choice': 'test', 'probabilities': {'test': .9, 'prose': .1}}},
            'providerMetadata': {'typesafe': {'confidence': {'quality': .7, 'kind': .6}}}}

    def test_gateway_types_round_trip_without_conflating_score_probability_and_confidence(self):
        payload = jev.validate_request(self.payload())
        result = jev.validate_result(self.response(), payload['questions'])['answers']
        self.assertEqual(result['passed'], {'probability': .98})
        self.assertEqual(result['quality']['score'], 1.8)
        self.assertEqual(result['quality']['confidence'], .7)
        self.assertEqual(result['kind']['choice'], 'test')

    def test_invalid_types_levels_and_boolean_criteria_fail_before_transport(self):
        for change in ({'type': 'noul'}, {'type': 'score', 'criteria': ['Only one']},
                       {'type': 'score', 'criteria': ['valid', ' ']},
                       {'type': 'boolean', 'criteria': {'true': 'One side only'}}):
            with self.subTest(change=change):
                payload = self.payload()
                payload['questions']['passed'].update(change)
                with self.assertRaises(jev.Error): jev.validate_request(payload)

    def test_malformed_typed_answers_are_rejected(self):
        for key, change in [('passed', {'probability': True}), ('passed', {'probability': float('nan')}),
                            ('quality', {'score': 3}), ('quality', {'score': .2}),
                            ('quality', {'probabilities': {'0': 0, '1': 1}}),
                            ('passed', {'type': 'choice'})]:
            with self.subTest(key=key, change=change):
                response = self.response()
                response['answers'][key].update(change)
                with self.assertRaises(jev.Error): jev.validate_result(response, self.payload()['questions'])


if __name__ == "__main__":
    unittest.main()
