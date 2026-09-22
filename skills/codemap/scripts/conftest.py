"""Hermetic test setup: every test runs with HOME and FURANKU_SKILLS_HOME in a temp dir."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))


@pytest.fixture(autouse=True)
def hermetic_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    skills_home = tmp_path / "skills-home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("FURANKU_SKILLS_HOME", str(skills_home))
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    return skills_home
