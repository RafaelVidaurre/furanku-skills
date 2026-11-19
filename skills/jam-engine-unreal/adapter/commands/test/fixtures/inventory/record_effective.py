"""Record what a real editor reports for the fixtures' effective values (editor/fields.py) into effective.json, which
test_fields.py replays through a stand-in for the editor. Run with plain python3 from a project folder that holds a
copy of a fixture set, a jam.config.json listing ENGINE_FIELDS (test_fields.py) and a jam.local.json whose
engine.transport reaches that engine's editor:

    python3 record_effective.py <project folder> <fixture set folder>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
import engine_inventory  # noqa: E402
from jam_unreal import cli, config  # noqa: E402

project, fixture_set = sys.argv[1], sys.argv[2]
calls = []
run_editor = cli.editor


def recording(cfg, verb, steps):
    results = run_editor(cfg, verb, steps)
    calls.extend({"step": name, "result": result} for (name, _, _), result in zip(steps, results))
    return results


engine_inventory.cli.editor = recording
engine_inventory.build(config.load(project), ["--out", "effective-inventory.json", "--engine"])
with open(os.path.join(fixture_set, "effective.json"), "w") as f:
    json.dump({"engine": calls[0]["result"]["engine"], "calls": calls}, f, indent=1, sort_keys=True)
