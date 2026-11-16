"""The pure parts of the transcript aligner: no model is loaded and nothing is downloaded."""
import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts" / "audio"
sys.path.insert(0, str(SCRIPTS))

import align  # noqa: E402

ENGLISH = json.loads((SCRIPTS / "homophones" / "en.json").read_text(encoding="utf-8"))


def differs(script, heard, language="en", homophones=ENGLISH):
    return align.mismatch(script, heard, language, homophones)["mismatch"]


def test_punctuation_case_and_dropped_letters_are_not_mismatches():
    assert not differs("Hello, FAMILY!", "hello family")
    assert not differs("He's lookin' at you funny.", "He's looking at you funny.")
    assert not differs("...What're YOU lookin' at?", "What are you looking at?")
    assert not differs("To the well-worn road!", "To the well worn road.")


def test_wrong_missing_and_extra_words_are_mismatches():
    assert differs("A thin coat", "A thing coat")
    assert differs("What're you looking at?", "What was you looking at?")
    assert differs("To family!", "The weather is sunny")
    assert differs("To family!", "")
    assert differs("Get him outta here.", "Get him out of here.")
    result = align.mismatch("one two three four", "one two four", "en", ENGLISH)
    assert result["wordErrorRate"] == pytest.approx(0.25)
    assert result["transcript"] == "one two four"


def test_same_sound_spellings_come_from_the_language_list_and_a_project_can_add_its_own():
    for script, heard in [("Back to your X, kid!", "Back to your ex, kid!"), ("Ok!", "Okay!"), ("Let's frisk 'im!", "Let's frisk him."), ("Poor ol' Gus.", "Poor old Gus.")]:
        assert not differs(script, heard), script
    # Without the list the same pairs are differences: the rule is data, not code.
    assert differs("Back to your X, kid!", "Back to your ex, kid!", homophones={})
    assert differs("A bow for the Don.", "A bow for the dawn.")
    assert not differs("A bow for the Don.", "A bow for the dawn.", homophones={**ENGLISH, "dawn": "don"})


def test_english_contraction_rules_stay_out_of_other_languages():
    assert differs("Estoy cantin'", "Estoy canting", language="es", homophones={})
    assert not differs("¿Dónde está?", "donde esta", language="es", homophones={})
    assert align.normalized_words("Größe zählt", "de") == ["große", "zahlt"]


def test_numbers_are_compared_as_spoken_words():
    pytest.importorskip("num2words", reason="num2words is part of the optional alignment environment")
    assert not differs("Take 2.", "Take two.")
    assert differs("Take 2.", "Take three.")


def test_fallback_timings_keep_every_authored_word_in_order_inside_the_recording():
    words = align.proportional("Not yet, Frankie.", 2.75)
    assert [word["word"] for word in words] == ["Not", "yet,", "Frankie."]
    end = 0
    for word in words:
        assert word["start"] >= end
        assert word["end"] > word["start"]
        assert word["end"] <= 2.75
        end = word["end"]
    assert end == pytest.approx(2.75)
    assert align.proportional("", 1.0) == []


def test_check_reports_what_is_missing_without_loading_a_model(monkeypatch, capsys):
    state = align.check()
    assert state["available"] == (not state["missing"])
    assert set(state["missing"]) <= set(align.REQUIRED)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    assert align.main(["--check"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["available"] is False and printed["missing"] == align.REQUIRED
    # Asked to align without its packages, it stops with what is missing and prints no result.
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"items": [], "homophones": {}})))
    assert align.main([]) == 3
    captured = capsys.readouterr()
    assert captured.out == "" and "missing Python packages" in captured.err
