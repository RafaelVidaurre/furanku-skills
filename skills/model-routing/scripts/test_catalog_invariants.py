"""Rules every shipped catalog candidate follows, whatever models it lists.

These checks read the real catalog but pin no model, score or evidence status,
so adding, re-scoring or replacing a model needs no test change. Behavior tests
use the fixture catalog in testdata/ (see routing_fixture.py).
"""
from datetime import date
import json

import pytest

import router

CATALOG = json.loads(router.CATALOG.read_text(encoding="utf-8"))
CANDIDATES = CATALOG["candidates"]
CONFIDENCE = {"high", "medium", "low"}


def iso_date(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def test_catalog_lists_candidates():
    assert CANDIDATES


@pytest.mark.parametrize("candidate_id", sorted(CANDIDATES))
def test_candidate_is_well_formed(candidate_id):
    candidate = CANDIDATES[candidate_id]
    # A malformed built-in would be silently dropped from routing at run time.
    router.validate_compiled_candidate(candidate_id, candidate)
    launch = candidate["launch"]
    assert candidate_id == f"{launch['agent']}/{launch['model']}/{launch['effort']}"
    assert launch["effort"] in router.EFFORT_RANK
    assert set(candidate["capabilities"]) == set(router.DIMENSIONS)

    for dimension, cell in candidate["capabilities"].items():
        where = f"{candidate_id}.{dimension}"
        if cell["status"] == "known":
            assert cell.get("scale"), f"{where} must name its benchmark scale"
            assert 0 <= cell["conservative"] <= cell["score"] <= 1, where
            assert cell["confidence"] in CONFIDENCE, where
            assert iso_date(cell["assessed_at"]), where
            assert all(url.startswith("https://") for url in cell["evidence"]), where
        else:
            assert "score" not in cell and "conservative" not in cell, where
            assert iso_date(cell["researched_at"]), where

    for metric, item in candidate.get("economics", {}).items():
        where = f"{candidate_id}.economics.{metric}"
        assert item.get("source", "").startswith("https://"), where
        assert iso_date(item.get("assessed_at")), where
