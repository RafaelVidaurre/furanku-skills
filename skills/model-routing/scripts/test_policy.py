#!/usr/bin/env python3
"""Recovery policy precedence and version-four compatibility contracts."""

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config
import policy


def layer(scope, recovery=None, roles=None, routes=None):
    return {"scope": scope, "path": f"/{scope}/config.json", "config": {
        "version": 4, "routes": routes or {}, "recovery": recovery or {},
        "role_recovery": roles or {}}}


class PolicyTests(unittest.TestCase):
    def test_layers_merge_fieldwise_and_scope_precedes_selector_specificity(self):
        layers = [
            layer("global", {"on_limit": "ask", "max_wait_seconds": 720},
                  {"worker": {"on_limit": "wait", "response_seconds": 20}},
                  {"review": {"recovery": {"response_seconds": 35}}}),
            layer("repo", {"on_limit": "equivalent"},
                  {"worker": {"max_replacements": 1}}),
            layer("machine-repo", {"response_seconds": 80}),
        ]
        resolved = policy.resolve_layers(layers, "worker", "review",
                                         {"on_no_reply": "continue"})
        self.assertEqual({"on_limit": "equivalent", "on_no_reply": "continue",
                          "response_seconds": 80, "max_wait_seconds": 720,
                          "max_replacements": 1}, resolved["policy"])
        self.assertEqual("machine-repo", resolved["sources"]["response_seconds"]["scope"])
        self.assertEqual("override", resolved["sources"]["on_no_reply"]["scope"])
        self.assertEqual("role_recovery.worker", resolved["sources"]["max_replacements"]["selector"])
        self.assertEqual(set(policy.DEFAULTS), set(resolved["configured_fields"]))

    def test_role_and_named_route_only_apply_when_requested(self):
        layers = [layer("global", {"on_limit": "ask"},
                        {"captain": {"on_limit": "wait"}},
                        {"review": {"recovery": {"on_limit": "equivalent"}}})]
        self.assertEqual("ask", policy.resolve_layers(layers)["policy"]["on_limit"])
        self.assertEqual("wait", policy.resolve_layers(layers, "captain")["policy"]["on_limit"])
        resolved = policy.resolve_layers(layers, "captain", "review")
        self.assertEqual("equivalent", resolved["policy"]["on_limit"])
        self.assertEqual("routes.review.recovery", resolved["sources"]["on_limit"]["selector"])
        self.assertNotIn("on_no_reply", resolved["configured_fields"])
        self.assertEqual("stop", resolved["policy"]["on_no_reply"])

    def test_legacy_v4_and_partial_policy_are_valid(self):
        config.validate_schema({"version": 4, "routes": {}}, "legacy")
        config.validate_schema({"version": 4, "routes": {
            "review": {"agent": "test", "model": "test", "effort": "high",
                       "on_quota_unusable": "ask", "recovery": {"on_limit": "wait"}}},
            "role_recovery": {"worker": {"max_replacements": 0}},
            "recovery": {"on_no_reply": "stop"}}, "partial")

    def test_invalid_policy_is_rejected_at_each_persistence_location(self):
        invalid = [{"on_limit": []}, {"on_no_reply": "launch"},
                   {"response_seconds": True}, {"response_seconds": 0},
                   {"max_wait_seconds": -1}, {"max_replacements": -1},
                   {"max_replacements": 2.5}, {"models": ["favorite"]}]
        for patch in invalid:
            for location in ("recovery", "role_recovery", "route"):
                with self.subTest(patch=patch, location=location):
                    document = {"version": 4, "routes": {}}
                    if location == "route":
                        document["routes"]["review"] = {"agent": "test", "model": "test",
                                                          "effort": "high", "recovery": patch}
                    else:
                        document[location] = {"worker": patch} if location == "role_recovery" else patch
                    with self.assertRaises(config.Error):
                        config.validate_schema(document, "invalid")
        with self.assertRaises(config.Error):
            config.validate_schema({"version": 4, "routes": {},
                                    "role_recovery": {"observer": {}}}, "invalid role")
        with self.assertRaises(ValueError):
            policy.resolve_layers([], role="observer")


if __name__ == "__main__":
    unittest.main()
