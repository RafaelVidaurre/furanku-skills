"""Tests for the map store."""

import json
import os
import stat
from pathlib import Path

import pytest

import store


def test_store_dir_uses_skills_home_and_repo_key(tmp_path, hermetic_home):
    repo = tmp_path / "proj"
    repo.mkdir()
    directory = store.store_dir(repo)
    assert directory.parent == hermetic_home / "codemap"
    assert directory.name.startswith("proj-")
    assert len(directory.name) == len("proj-") + 8
    assert directory == store.store_dir(str(repo) + "/")  # normalised


def test_home_falls_back_to_dot_furanku_skills(tmp_path, monkeypatch):
    monkeypatch.delenv("FURANKU_SKILLS_HOME")
    assert store.home() == Path(os.environ["HOME"]) / ".furanku-skills"


def test_paths_cover_every_artifact(tmp_path):
    paths = store.paths(tmp_path)
    assert set(paths) == {"scan", "skeleton", "draft", "decisions", "map", "changes", "html", "log", "snapshots"}
    assert paths["map"].name == "map.json"
    assert paths["html"].name == "index.html"
    assert paths["log"].name == "codemap.log"
    assert paths["snapshots"].name == "snapshots"


def test_write_json_is_sorted_indented_atomic_and_private(tmp_path):
    target = store.paths(tmp_path)["scan"]
    store.write_json(target, {"b": 1, "a": {"z": [1, 2], "y": None}})
    text = target.read_text()
    assert text == '{\n "a": {\n  "y": null,\n  "z": [\n   1,\n   2\n  ]\n },\n "b": 1\n}\n'
    assert [p.name for p in target.parent.iterdir()] == ["scan.json"]  # no temp files left
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    for directory in (target.parent, target.parent.parent):
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert store.read_json(target) == {"a": {"y": None, "z": [1, 2]}, "b": 1}


def test_snapshot_never_silently_overwrites(tmp_path):
    sha = "a" * 40
    first = store.snapshot(tmp_path, sha, {"v": 1})
    assert first["status"] == "created"
    assert store.read_json(first["path"]) == {"v": 1}
    assert store.snapshot(tmp_path, sha, {"v": 1})["status"] == "unchanged"
    third = store.snapshot(tmp_path, sha, {"v": 2})
    assert third["status"] == "superseded"
    assert Path(third["superseded"]).name == "map.json.superseded-1"
    assert json.loads(Path(third["superseded"]).read_text()) == {"v": 1}
    assert store.read_json(third["path"]) == {"v": 2}
    fourth = store.snapshot(tmp_path, sha, {"v": 3})
    assert Path(fourth["superseded"]).name == "map.json.superseded-2"
    with pytest.raises(ValueError):
        store.snapshot(tmp_path, "../escape", {})


def test_log_appends_one_json_line_per_command(tmp_path):
    store.log(tmp_path, "scan", "ok", sha="abc", files=3)
    store.log(tmp_path, "build", "error", error="boom")
    lines = store.paths(tmp_path)["log"].read_text().splitlines()
    assert len(lines) == 2
    first, second = (json.loads(line) for line in lines)
    assert first["command"] == "scan" and first["outcome"] == "ok" and first["files"] == 3
    assert second["error"] == "boom"
    assert first["time"].endswith("Z")
