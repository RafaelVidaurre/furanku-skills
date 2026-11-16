"""What every adapter command shares: one JSON object on standard output, words for people on standard error.

Exit 0: the receipt. Exit 1: {"error": {...}}. Exit 3: {"error": ..., "handoff": {"steps": [...]}}, when no transport
can reach the editor and the prepared scripts wait to be run by hand; running the same command again collects them.
"""
import json
import os
import re
import sys

from . import config as config_module
from .errors import AdapterError, Handoff
from .receipts import emit, note
from .transport import Step, run_steps

COMMANDS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def editor_script(name):
    return os.path.join(COMMANDS, "editor", name + ".py")


def dcc_script(name):
    return os.path.join(COMMANDS, "dcc", name + ".py")


def asset_name(text):
    """A file stem as an engine asset name: letters, digits and underscores."""
    return re.sub(r"[^A-Za-z0-9_]+", "_", text).strip("_")


def editor(cfg, verb, steps):
    """Run (name, script, args) steps in the editor and return their results in order."""
    return run_steps(cfg, verb, [Step(name, editor_script(script), args) for name, script, args in steps])


def write_details(cfg, path, value):
    """Everything the editor reported, for a person or a later check; receipts carry only the contract's fields."""
    if not path:
        return
    full = os.path.join(cfg.project, *path.replace("\\", "/").split("/"))
    os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=1)


def run(build, argv=None):
    """`build(cfg, argv)` returns the receipt; errors become the error object and a non-zero exit."""
    argv = list(sys.argv[1:] if argv is None else argv)
    project = None
    if "--project" in argv:
        i = argv.index("--project"); project = argv[i + 1]; del argv[i:i + 2]
    try:
        cfg = config_module.load(project)
        receipt = build(cfg, argv)
    except Handoff as handoff:
        note("editor-handoff: %s" % handoff.message)
        for step in handoff.steps:
            note("  %s %s -> %s%s" % ("done   " if step["done"] else "run    ", step["script"], step["result"], "  (needs a Python tool with top-level await)" if step["await"] else ""))
        note("fix: %s" % handoff.fix)
        emit(handoff.receipt())
        sys.exit(3)
    except AdapterError as error:
        note("%s: %s" % (error.code, error.message))
        if error.fix:
            note("fix: %s" % error.fix)
        emit(error.receipt())
        sys.exit(1)
    emit(receipt)
