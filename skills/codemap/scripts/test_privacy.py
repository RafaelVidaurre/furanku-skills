"""Privacy boundaries for legacy inputs and generated artifacts."""

import copy
from html.parser import HTMLParser
import json
from pathlib import Path

import pytest

import build
import codemap
import skeleton
import store

FIXTURES = Path(__file__).parent / "fixtures" / "build"
TEMPLATE = Path(__file__).parent.parent / "assets" / "viewer.html"
REMOTE = "https://example-user:synthetic-secret@example.invalid/repo?token=synthetic-query#private"


def inputs():
    load = lambda name: json.loads((FIXTURES / name).read_text())
    scan = load("scan.json")
    scan["repo"]["remote"] = REMOTE
    return scan, load("draft.json"), load("decisions.json")


def test_legacy_metadata_is_removed_at_each_output_boundary():
    scan, draft, decisions = inputs()
    sk = skeleton.skeleton(scan)
    assert sk["meta"]["repo"]["remote"] is None
    assert scan["repo"]["remote"] == REMOTE  # callers retain their input
    sk["meta"]["repo"]["remote"] = REMOTE
    result = build.build(sk, draft, decisions)
    assert result["meta"]["repo"]["remote"] is None
    result["meta"]["repo"]["remote"] = REMOTE
    assert REMOTE not in build.dumps(result)
    assert REMOTE not in build.render(result, TEMPLATE.read_text())
    assert result["meta"]["repo"]["remote"] == REMOTE
    assert REMOTE not in store.dumps(scan)


class DataScript(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.inside = False
        self.data = ""
        self.injected = []

    def handle_starttag(self, tag, attrs):
        if dict(attrs).get("id") == "codemap-data":
            self.inside = True
        if dict(attrs).get("id") == "injected":
            self.injected.append(tag)

    def handle_endtag(self, tag):
        if tag == "script":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.data += data


@pytest.mark.parametrize("text", [
    '</SCRIPT><img id=injected onerror=window.injected=true>',
    '</ScRiPt ><script id=injected>window.injected=true</script>',
    '<!--<script></script> café & \u2028 \u2029',
])
def test_real_template_keeps_hostile_json_inside_data_script(text):
    scan, draft, decisions = inputs()
    value = build.build(skeleton.skeleton(scan), draft, decisions)
    value["system"]["purpose"] = text
    value["system"][text] = text  # keys must be safe too
    parser = DataScript()
    parser.feed(build.render(value, TEMPLATE.read_text()))
    assert parser.injected == []
    assert json.loads(parser.data) == value


def test_snapshot_never_archives_raw_remote(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    target = store.paths(repo)["snapshots"] / ("a" * 40) / "map.json"
    target.parent.mkdir(parents=True)
    dirty = {"meta": {"repo": {"remote": REMOTE}}, "value": 1}
    target.write_text(json.dumps(dirty))
    sibling = target.with_name("map.json.superseded-1")
    sibling.write_text(json.dumps(dirty))
    updated = copy.deepcopy(dirty)
    updated["value"] = 2
    result = store.snapshot(repo, "a" * 40, updated)
    assert result["status"] == "superseded"
    assert all(REMOTE not in p.read_text() for p in target.parent.iterdir())
    assert json.loads(Path(result["superseded"]).read_text())["value"] == 1


def test_sanitize_cleans_all_managed_legacy_artifacts_and_is_idempotent(tmp_path, capsys):
    repo = tmp_path / "repo"
    repo.mkdir()
    paths = store.paths(repo)
    scan, draft, decisions = inputs()
    sk = skeleton.skeleton(scan)
    value = build.build(sk, draft, decisions)
    sk["meta"]["repo"]["remote"] = REMOTE
    value["meta"]["repo"]["remote"] = REMOTE
    value["system"]["purpose"] = '</SCRIPT><img id="injected">'
    for name, obj in (("scan", scan), ("skeleton", sk), ("map", value)):
        store.write_text(paths[name], json.dumps(obj))
    store.write_text(paths["html"], "old unsafe report")
    for suffix in ("", ".superseded-1"):
        store.write_text(paths["snapshots"] / "old-sha" / ("map.json" + suffix), json.dumps(value))
    assert codemap.main(["sanitize", "--repo", str(repo)]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "ok"
    first = {p: p.read_bytes() for p in paths["scan"].parent.rglob("*") if p.is_file()}
    assert all(REMOTE.encode() not in data for data in first.values())
    parser = DataScript()
    parser.feed(paths["html"].read_text())
    assert parser.injected == []
    assert json.loads(parser.data)["system"]["purpose"] == value["system"]["purpose"]
    assert codemap.main(["sanitize", "--repo", str(repo)]) == 0
    capsys.readouterr()
    assert first == {p: p.read_bytes() for p in first}


def test_sanitize_invalid_legacy_json_does_not_echo_secret(tmp_path, capsys):
    repo = tmp_path / "repo"
    repo.mkdir()
    store.write_text(store.paths(repo)["scan"], '{"' + REMOTE)
    assert codemap.main(["sanitize", "--repo", str(repo)]) == 1
    error = capsys.readouterr().err
    assert REMOTE not in error
    assert json.loads(error)["status"] == "error"


@pytest.mark.parametrize("old_map", [None, '{"broken":', '[{"meta":{"repo":{"remote":"' + REMOTE + '"}}}]'])
def test_build_recovers_missing_or_corrupt_active_map(tmp_path, capsys, old_map):
    repo = tmp_path / "repo"
    repo.mkdir()
    paths = store.paths(repo)
    scan, draft, decisions = inputs()
    for name, obj in (("skeleton", skeleton.skeleton(scan)), ("draft", draft), ("decisions", decisions)):
        store.write_json(paths[name], obj)
    store.write_text(paths["html"], "unsafe stale HTML")
    if old_map is not None:
        store.write_text(paths["map"], old_map)
    assert codemap.main(["build", "--repo", str(repo)]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "ok"
    assert store.read_json(paths["map"])["schema"] == "codemap.map/1"
    assert REMOTE not in paths["html"].read_text()


@pytest.mark.parametrize("shape", [
    [{"meta": {"repo": {"remote": REMOTE}}}],
    {"meta": [{"repo": {"remote": REMOTE}}]},
    {"meta": {"repo": [REMOTE]}},
    {"repo": REMOTE},
])
@pytest.mark.parametrize("artifact", ["map", "scan", "snapshot"])
def test_sanitize_rejects_unsupported_metadata_without_rewriting(tmp_path, capsys, shape, artifact):
    repo = tmp_path / "repo"
    repo.mkdir()
    paths = store.paths(repo)
    target = paths[artifact] if artifact != "snapshot" else paths["snapshots"] / "old-sha" / "map.json"
    raw = json.dumps(shape)
    store.write_text(target, raw)
    if artifact == "map":
        store.write_text(paths["html"], "old HTML")
    assert codemap.main(["sanitize", "--repo", str(repo)]) == 1
    error = capsys.readouterr().err
    assert REMOTE not in error
    assert json.loads(error)["status"] == "error"
    assert target.read_text() == raw
    if artifact == "map":
        assert paths["html"].read_text() == "old HTML"
