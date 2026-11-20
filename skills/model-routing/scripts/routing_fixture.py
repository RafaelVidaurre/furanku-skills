"""Test support: run routing and Crew scripts against the fixture catalog.

Behavior tests use `testdata/routing-catalog.json`, never the shipped catalog,
so a catalog update changes no test. Its candidates carry neutral model names:

- `model-alpha`: codex and claudex (proxy billed to codex) at high; known
  reasoning, implementation and agentic cells plus task cost and speed.
- `model-beta`: codex and cursor at high; every capability cell unknown.
- `model-gamma`, `model-delta`: codex at max.
- `model-epsilon`: grok and cursor at high.
- `model-zeta`, `model-eta`, `model-theta`: claude at high; zeta and eta also
  on cursor.
- `vendor/model-iota`: opencode at max, a slash-separated model ID.

Checks over the shipped catalog belong in test_catalog_invariants.py and
test_support_contract.py, and pin no model.
"""

from __future__ import annotations

import atexit
import compileall
from pathlib import Path
import shutil
import tempfile

SKILLS = Path(__file__).resolve().parents[2]
FIXTURE_CATALOG = Path(__file__).resolve().with_name("testdata") / "routing-catalog.json"
_ROOT = None


def skills_root():
    """Return a copy of model-routing and Crew whose catalog is the fixture.

    One read-only copy serves the whole test process; its scripts resolve
    sibling skills and references as installed ones do. It is precompiled
    because the tests run scripts with PYTHONDONTWRITEBYTECODE set.
    """
    global _ROOT
    if _ROOT is None:
        base = Path(tempfile.mkdtemp(prefix="routing-fixture-"))
        atexit.register(shutil.rmtree, base, True)
        ignore = shutil.ignore_patterns("__pycache__", "test_*.py", "testdata")
        for name in ("model-routing", "crew"):
            shutil.copytree(SKILLS / name, base / "skills" / name, ignore=ignore)
        shutil.copyfile(FIXTURE_CATALOG, base / "skills/model-routing/references/routing-catalog.json")
        compileall.compile_dir(base, quiet=1)
        _ROOT = base / "skills"
    return _ROOT
