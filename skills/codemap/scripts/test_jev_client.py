"""Hermetic request/response boundary checks for codemap's Jev client; no live Gateway requests."""

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
import jev_client as jc


PAYLOAD = {
    "model": jc.MODEL,
    "state": {"id": "sim-core", "responsibility": "owns the tick loop"},
    "questions": {
        "layer": {"type": "choice", "instructions": "Pick the layer.",
                  "criteria": {"domain": "core rules", "surface": "UI", "abstain": "cannot tell"}},
        "quality": {"type": "score", "instructions": "Rate the card.", "criteria": ["poor", "fair", "good"]},
        "upward": {"type": "boolean", "instructions": "Is it fine?", "criteria": {"true": "fine", "false": "smell"}},
    },
}
RESPONSE = {
    "model": jc.MODEL,
    "answers": {
        "layer": {"type": "choice", "choice": "domain", "probabilities": {"domain": 0.8, "surface": 0.15, "abstain": 0.05}},
        "quality": {"type": "score", "score": 1.4, "probabilities": {"0": 0.1, "1": 0.4, "2": 0.5}, "legend": ["poor", "fair", "good"]},
        "upward": {"type": "boolean", "probability": 0.3},
    },
    "providerMetadata": {"typesafe": {"confidence": {"layer": 0.7, "quality": 0.5, "upward": 0.9}},
                         "gateway": {"cost": "0.0002"}},
    "usage": {"inputTokens": 120, "outputTokens": 12},
}


def store_key(key):
    path = jc.credential_path()
    path.parent.mkdir(parents=True, mode=0o700)
    path.write_text(json.dumps({"AI_GATEWAY_API_KEY": key}))
    path.chmod(0o600)
    return path


class JevClientTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.environment = mock.patch.dict(os.environ, {"HOME": str(self.home)}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    # --- credentials ---------------------------------------------------------

    def test_environment_key_wins_over_machine_credential(self):
        store_key("saved-test-key")
        self.assertEqual(jc.load_key(), "saved-test-key")
        with mock.patch.dict(os.environ, {"AI_GATEWAY_API_KEY": "env-test-key"}):
            self.assertEqual(jc.load_key(), "env-test-key")
            self.assertEqual(jc.key_source(), "environment")

    def test_missing_key_names_model_routing_setup_and_never_networks(self):
        with mock.patch("urllib.request.OpenerDirector.open") as transport, self.assertRaises(jc.Error) as caught:
            jc.evaluate(PAYLOAD)
        transport.assert_not_called()
        self.assertIn("model-routing skill's jev.py setup", str(caught.exception))
        self.assertIn("AI_GATEWAY_API_KEY", str(caught.exception))

    def test_unsafe_or_linked_credential_is_refused(self):
        path = store_key("test-key")
        path.chmod(0o644)
        with self.assertRaises(jc.Error):
            jc.saved_key()
        path.chmod(0o600)
        path.write_text('AI_GATEWAY_API_KEY=$(touch should-not-exist)')
        with self.assertRaises(jc.Error):
            jc.saved_key()
        path.unlink()
        path.symlink_to(self.home / "elsewhere")
        with self.assertRaises(jc.Error):
            jc.saved_key()

    def test_status_reports_source_without_networking_or_echoing(self):
        store_key("secret-test-key")
        with mock.patch("urllib.request.OpenerDirector.open") as transport:
            status = subprocess.run([sys.executable, str(Path(jc.__file__).resolve()), "status"], text=True,
                                    capture_output=True, check=False, env=dict(os.environ), cwd=self.home)
        transport.assert_not_called()
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(json.loads(status.stdout)["source"], "machine")
        self.assertNotIn("secret-test-key", status.stdout + status.stderr)

    # --- request validation --------------------------------------------------

    def test_valid_request_of_all_three_types_is_normalized_with_typesafe_only(self):
        clean = jc.validate_request(PAYLOAD)
        self.assertEqual(clean["providerOptions"], {"gateway": {"only": ["typesafe-ai"]}})
        self.assertEqual(set(clean["questions"]), {"layer", "quality", "upward"})
        zdr = deepcopy(PAYLOAD)
        zdr["providerOptions"] = {"gateway": {"zeroDataRetention": True, "only": ["someone-else"]}}
        self.assertEqual(jc.validate_request(zdr)["providerOptions"]["gateway"], {"only": ["typesafe-ai"], "zeroDataRetention": True})

    def test_invalid_requests_are_rejected_per_type(self):
        mutations = {
            "wrong model": lambda p: p.update(model="other/model"),
            "no state": lambda p: p.update(state=3),
            "no questions": lambda p: p.update(questions={}),
            "unknown type": lambda p: p["questions"]["layer"].update(type="rank"),
            "no instructions": lambda p: p["questions"]["layer"].update(instructions=" "),
            "choice with one option": lambda p: p["questions"]["layer"].update(criteria={"only": "one"}),
            "choice with empty description": lambda p: p["questions"]["layer"]["criteria"].update(domain=""),
            "choice with too many options": lambda p: p["questions"]["layer"].update(criteria={str(i): "x" for i in range(256)}),
            "score as dict": lambda p: p["questions"]["quality"].update(criteria={"0": "poor", "1": "good"}),
            "score with one rung": lambda p: p["questions"]["quality"].update(criteria=["only"]),
            "score with eleven rungs": lambda p: p["questions"]["quality"].update(criteria=["r"] * 11),
            "boolean missing false": lambda p: p["questions"]["upward"].update(criteria={"true": "fine"}),
            "boolean extra key": lambda p: p["questions"]["upward"].update(criteria={"true": "a", "false": "b", "maybe": "c"}),
            "boolean empty description": lambda p: p["questions"]["upward"].update(criteria={"true": "a", "false": ""}),
        }
        for label, mutate in mutations.items():
            payload = deepcopy(PAYLOAD)
            mutate(payload)
            with self.subTest(label), self.assertRaises(jc.Error):
                jc.validate_request(payload)

    # --- response validation -------------------------------------------------

    def test_clean_result_keeps_each_answer_type_with_confidence_usage_and_cost(self):
        result = jc.validate_result(deepcopy(RESPONSE), jc.validate_request(PAYLOAD)["questions"])
        self.assertEqual(result["answers"]["layer"], {"type": "choice", "choice": "domain",
                                                      "probabilities": {"domain": 0.8, "surface": 0.15, "abstain": 0.05}, "confidence": 0.7})
        self.assertEqual(result["answers"]["quality"]["score"], 1.4)
        self.assertEqual(result["answers"]["quality"]["legend"], ["poor", "fair", "good"])
        self.assertEqual(result["answers"]["upward"], {"type": "boolean", "probability": 0.3, "confidence": 0.9})
        self.assertEqual(result["usage"], {"inputTokens": 120, "outputTokens": 12})
        self.assertEqual(result["cost_usd"], 0.0002)

    def test_missing_confidence_and_cost_stay_absent(self):
        response = deepcopy(RESPONSE)
        response.pop("providerMetadata")
        result = jc.validate_result(response, jc.validate_request(PAYLOAD)["questions"])
        self.assertNotIn("confidence", result["answers"]["layer"])
        self.assertIsNone(result["cost_usd"])

    def test_invalid_answers_are_rejected_per_type(self):
        mutations = {
            "wrong model": lambda r: r.update(model="unexpected"),
            "answer ids differ": lambda r: r["answers"].update(other=r["answers"].pop("layer")),
            "choice type swapped": lambda r: r["answers"]["layer"].update(type="boolean"),
            "choice outside set": lambda r: r["answers"]["layer"].update(choice="tooling"),
            "choice distribution incomplete": lambda r: r["answers"]["layer"].update(probabilities={"domain": 1}),
            "choice nan": lambda r: r["answers"]["layer"]["probabilities"].update(domain=float("nan")),
            "choice bool probability": lambda r: r["answers"]["layer"]["probabilities"].update(domain=True),
            "choice sum off": lambda r: r["answers"]["layer"]["probabilities"].update(domain=0.5),
            "choice not argmax": lambda r: r["answers"]["layer"].update(choice="abstain"),
            "score out of range": lambda r: r["answers"]["quality"].update(score=2.5),
            "score negative": lambda r: r["answers"]["quality"].update(score=-0.1),
            "score bool": lambda r: r["answers"]["quality"].update(score=True),
            "score distribution incomplete": lambda r: r["answers"]["quality"].update(probabilities={"0": 0.5, "1": 0.5}),
            "score sum off": lambda r: r["answers"]["quality"]["probabilities"].update({"2": 0.9}),
            "boolean above one": lambda r: r["answers"]["upward"].update(probability=1.2),
            "boolean string": lambda r: r["answers"]["upward"].update(probability="0.3"),
            "confidence above one": lambda r: r["providerMetadata"]["typesafe"]["confidence"].update(layer=2),
            "cost negative": lambda r: r["providerMetadata"]["gateway"].update(cost="-1"),
        }
        questions = jc.validate_request(PAYLOAD)["questions"]
        for label, mutate in mutations.items():
            response = deepcopy(RESPONSE)
            mutate(response)
            with self.subTest(label), self.assertRaises(jc.Error):
                jc.validate_result(response, questions)

    # --- transport ------------------------------------------------------------

    def test_evaluate_sends_bearer_key_once_and_returns_timed_clean_result(self):
        store_key("test-key")
        with mock.patch("urllib.request.OpenerDirector.open", return_value=io.BytesIO(json.dumps(RESPONSE).encode())) as transport:
            result = jc.evaluate(PAYLOAD)
        transport.assert_called_once()
        request = transport.call_args.args[0]
        self.assertEqual(request.full_url, jc.ENDPOINT)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        sent = json.loads(request.data)
        self.assertEqual(sent["providerOptions"]["gateway"]["only"], ["typesafe-ai"])
        self.assertEqual(sent["state"], PAYLOAD["state"])
        self.assertIn("elapsed_seconds", result)
        self.assertEqual(result["answers"]["upward"]["probability"], 0.3)
        self.assertNotIn("test-key", json.dumps(result))

    def test_http_errors_map_to_hints_without_echoing_bodies_or_retrying(self):
        store_key("test-key")
        expectations = {400: "invalid", 401: "jev.py setup", 402: "credits", 403: "access",
                        422: "invalid", 429: "rate limited", 529: "overloaded", 500: "evaluation failed"}
        for code, hint in expectations.items():
            failure = urllib.error.HTTPError(jc.ENDPOINT, code, "private-reason", {}, io.BytesIO(b"private-body test-key"))
            with self.subTest(code=code), mock.patch("urllib.request.OpenerDirector.open", side_effect=failure) as transport:
                with self.assertRaises(jc.Error) as caught:
                    jc.evaluate(PAYLOAD)
                transport.assert_called_once()
                message = str(caught.exception)
                self.assertIn(str(code), message)
                self.assertIn(hint, message)
                self.assertNotIn("private", message)
                self.assertNotIn("test-key", message)

    def test_customer_verification_required_explains_payment_card(self):
        store_key("test-key")
        body = {"error": {"type": "customer_verification_required", "message": "private test-key body"}}
        failure = urllib.error.HTTPError(jc.ENDPOINT, 403, "Forbidden", {}, io.BytesIO(json.dumps(body).encode()))
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=failure):
            with self.assertRaises(jc.Error) as caught:
                jc.evaluate(PAYLOAD)
        self.assertIn("customer_verification_required", str(caught.exception))
        self.assertIn("payment card", str(caught.exception))
        self.assertNotIn("private", str(caught.exception))

    def test_connection_failure_and_bad_json_are_actionable(self):
        store_key("test-key")
        with mock.patch("urllib.request.OpenerDirector.open", side_effect=urllib.error.URLError("dns")):
            with self.assertRaises(jc.Error) as caught:
                jc.evaluate(PAYLOAD)
        self.assertIn("connection failed", str(caught.exception))
        with mock.patch("urllib.request.OpenerDirector.open", return_value=io.BytesIO(b"<html>")):
            with self.assertRaises(jc.Error) as caught:
                jc.evaluate(PAYLOAD)
        self.assertIn("invalid JSON", str(caught.exception))

    def test_oversized_request_and_response_are_refused(self):
        store_key("test-key")
        big = deepcopy(PAYLOAD)
        big["state"] = "x" * (jc.MAX_BYTES + 1)
        with mock.patch("urllib.request.OpenerDirector.open") as transport, self.assertRaises(jc.Error):
            jc.evaluate(big)
        transport.assert_not_called()
        with mock.patch("urllib.request.OpenerDirector.open", return_value=io.BytesIO(b"[" + b" " * jc.MAX_BYTES + b"]")):
            with self.assertRaises(jc.Error) as caught:
                jc.evaluate(PAYLOAD)
        self.assertIn("1 MB", str(caught.exception))

    def test_redirect_is_refused(self):
        self.assertIsNone(jc.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid"))

    def test_cli_evaluate_reads_stdin_and_reports_errors_as_json(self):
        with mock.patch.dict(os.environ, {"AI_GATEWAY_API_KEY": "env-test-key"}):
            with mock.patch("urllib.request.OpenerDirector.open", return_value=io.BytesIO(json.dumps(RESPONSE).encode())), \
                    mock.patch("sys.stdin", io.StringIO(json.dumps(PAYLOAD))), \
                    mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                self.assertEqual(jc.main(["evaluate", "--request", "-"]), 0)
            self.assertEqual(json.loads(out.getvalue())["answers"]["layer"]["choice"], "domain")
            with mock.patch("sys.stdin", io.StringIO('{"model": "wrong"}')), mock.patch("sys.stderr", new_callable=io.StringIO) as err:
                self.assertEqual(jc.main(["evaluate", "--request", "-"]), 1)
            self.assertEqual(json.loads(err.getvalue())["status"], "error")


if __name__ == "__main__":
    unittest.main()


def test_choice_tolerates_rounding_between_choice_and_maximum():
    import jev_client as jc
    questions = {"q": {"type": "choice", "instructions": "pick", "criteria": {"a": "A", "b": "B"}}}
    result = {"model": jc.MODEL, "answers": {"q": {"type": "choice", "choice": "a", "probabilities": {"a": 0.49, "b": 0.51}}},
              "usage": {"inputTokens": 1, "outputTokens": 1}}
    assert jc.validate_result(result, questions)["answers"]["q"]["choice"] == "a"
    result["answers"]["q"]["probabilities"] = {"a": 0.3, "b": 0.7}
    try:
        jc.validate_result(result, questions)
    except jc.Error as exc:
        assert "inconsistent" in str(exc)
    else:
        raise AssertionError("a 0.4 gap must still be rejected")
