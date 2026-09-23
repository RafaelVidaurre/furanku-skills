"""Contract tests for the codemap viewer template and its example fixture."""
import json
import re
import subprocess
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / "assets" / "viewer.html"
FIXTURE = SKILL / "assets" / "example.map.json"
PLACEHOLDER = "/*__CODEMAP_JSON__*/"
RUNTIMES = {"server", "client", "shared", "cli", "build", "none"}
NATURES = {"product", "tooling", "test", "content", "docs", "experiment"}
ROLES = {"surface", "adapter", "core", "kernel", "none"}
BASE_CHECKS = {"cycle", "core-uses-adapter", "crosses-the-wire", "product-uses-support"}
CHECKS = BASE_CHECKS | {"mixed-responsibility", "upward-dependency", "stability-inversion", "hub-coupling"}
EXTERNAL_KINDS = {"datastore", "service", "runtime", "devtool"}
FLOW_KINDS = {"network", "file", "process"}
SPECIAL_AREAS = {"build-verify", "unsorted"}


def render(template: str, map_json: str) -> str:
    return template.replace(PLACEHOLDER, map_json.replace("</script", "<\\/script"))


def load():
    return json.loads(FIXTURE.read_text())


def run_viewer_logic(program: str, data: dict):
    """Run the template's real model and layout functions without a browser profile."""
    script = TEMPLATE.read_text().rsplit("<script>", 1)[1].split("</script>", 1)[0]
    model = script.split("const M = (() =>", 1)[0]
    source = f"const assert = require('node:assert/strict');\n{model}\nconst input = {json.dumps(data)};\n{program}\n}})();"
    result = subprocess.run(["node", "-"], input=source, text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr


def test_placeholder_appears_exactly_once():
    assert TEMPLATE.read_text().count(PLACEHOLDER) == 1


def test_template_is_self_contained():
    html = TEMPLATE.read_text()
    assert not re.search(r"<link[^>]+href=[\"']?https?:", html, re.I)
    assert not re.search(r"<script[^>]+src=", html, re.I)
    assert not re.search(r"https?://(?!www\.w3\.org/)", html), "no external URLs besides the SVG namespace"
    assert "@import" not in html


def test_template_routes_and_lenses():
    html = TEMPLATE.read_text()
    for route in ("'#/area/'", "'#/component/'", "h === 'layers' || h === 'runtime'", "h === 'ships' || h === 'size'"):
        assert route in html
    for lens in ("id: 'purpose'", "id: 'layers'", "id: 'ships'", "id: 'size'"):
        assert lens in html
    assert "#/domain" not in html.replace("(?:area|domain)", "")
    assert "layoutSystem" in html and "layoutShips" in html and "layoutSize" in html and "layoutDomains" not in html


def test_fixture_tells_its_story_in_short_labels():
    data = load()
    assert data["system"]["summary"] and len(data["system"]["summary"].split()) <= 30
    for f in data["flows"]:
        assert len(f["label"]) <= 32 and f["detail"], f
    assert data["meta"]["activity"]["window_days"] == 90
    assert all("changes" in c["metrics"] for c in data["components"])


def test_rendered_example_is_small_and_valid():
    fixture = FIXTURE.read_text()
    data = json.loads(fixture)
    for key in ("schema", "meta", "system", "areas", "components", "modules", "edges", "flows", "health", "unresolved"):
        assert key in data
    assert "domains" not in data and "smells" not in data
    assert data["schema"] == "codemap.map/1"
    rendered = render(TEMPLATE.read_text(), fixture)
    assert PLACEHOLDER not in rendered
    assert len(rendered.encode()) < 1.5 * 1024 * 1024
    assert rendered.count("</script>") == TEMPLATE.read_text().count("</script>")


def test_fixture_references_resolve():
    data = load()
    areas = {a["id"] for a in data["areas"]}
    comps = {c["id"]: c for c in data["components"]}
    mods = {m["id"] for m in data["modules"]}
    unresolved = {u["component"] for u in data["unresolved"]}
    assert 3 <= len(areas - SPECIAL_AREAS) <= 7
    assert SPECIAL_AREAS <= areas
    for c in comps.values():
        assert "domain" not in c
        assert c["area"] in areas
        assert set(c["modules"]) <= mods
    assert "domains" not in data["edges"]
    for e in data["edges"]["components"]:
        assert e["from"] in comps and e["to"] in comps and e["reason"]
        assert {"count", "test_count", "test_only", "examples", "finding", "accepted"} <= set(e)
        assert e["finding"] is None or e["finding"] in CHECKS
    for e in data["edges"]["modules"]:
        assert e["from"] in mods and e["to"] in mods
    for e in data["edges"]["areas"]:
        assert e["from"] in areas and e["to"] in areas and e["from"] != e["to"] and e["reason"]
    assert len(unresolved) == 1 and next(iter(data["unresolved"]))["question"] == "area"
    assert comps[next(iter(unresolved))]["area"] == "unsorted"


def test_fixture_areas_hold_runnables_and_supporting_code_sits_in_build_verify():
    data = load()
    comps = {c["id"]: c for c in data["components"]}
    for a in data["areas"]:
        members = [comps[cid] for cid in a["components"]]
        assert [c["id"] for c in members] == sorted(c["id"] for c in members)
        assert all(c["area"] == a["id"] for c in members)
        assert a["runnables"] == [c["id"] for c in members if c["runnable"]]
        counts = a["counts"]
        assert counts["product"] == sum(c["nature"] == "product" for c in members)
        assert counts["supporting"] == len(members) - counts["product"]
        assert set(counts["runtimes"]) == RUNTIMES
        if a["id"] == "build-verify":
            assert a["hue"] is None and counts["product"] == 0 and counts["supporting"] > 0
        elif a["id"] == "unsorted":
            assert a["hue"] is None
        else:
            assert isinstance(a["hue"], int) and a["definition"] and a["runnables"], a["id"]
    for c in comps.values():
        if c["nature"] != "product":
            assert c["area"] == "build-verify", c["id"]
        if c["runnable"]:
            assert c["nature"] == "product" and c["runtime"] in {"client", "server", "cli"}
    runnables = [c for c in comps.values() if c["runnable"]]
    assert 3 <= len(runnables) <= 10


def test_fixture_carries_the_three_facts():
    data = load()
    comps = data["components"]
    for c in comps:
        assert "layer" not in c
        assert c["runtime"] in RUNTIMES and c["nature"] in NATURES and c["role"] in ROLES
        assert (c["role"] == "none") == (c["nature"] != "product"), c["id"]
        assert set(c["decision"]) == {"area", "runtime", "nature", "role"}
        for q in c["decision"].values():
            assert set(q) == {"confidence", "flag"}
        assert isinstance(c["hints"], dict)
    assert {c["nature"] for c in comps} == NATURES
    product = [c for c in comps if c["nature"] == "product"]
    assert {"client", "server"} <= {c["runtime"] for c in product}
    flagged = [c for c in comps if any(q["flag"] == "uncertain" for q in c["decision"].values())]
    assert len(flagged) == 1
    assert set(data["system"]["runtime_counts"]) == RUNTIMES


def test_fixture_people_externals_and_flows():
    data = load()
    comps = {c["id"]: c for c in data["components"]}
    areas = {a["id"] for a in data["areas"]}
    actors = data["system"]["actors"]
    externals = data["system"]["externals"]
    assert 1 <= len(actors) <= 6 and 1 <= len(externals)
    for a in actors:
        assert a["id"] and a["name"] and a["role"]
        assert 1 <= len(a["uses"]) <= 2
        for target in a["uses"]:
            assert target in areas or (target in comps and comps[target]["runnable"]), (a["id"], target)
    assert any(t in areas for a in actors for t in a["uses"]), "one person uses a whole area"
    drawn = [x for x in externals if x["kind"] != "devtool"]
    assert len(drawn) <= 8 and {x["kind"] for x in externals} == EXTERNAL_KINDS
    for x in externals:
        assert x["id"] and x["name"] and x["role"] and x["used_by"]
        assert set(x["used_by"]) <= set(comps)
    ids = set(comps) | {a["id"] for a in actors} | {x["id"] for x in externals}
    assert 8 <= len(data["flows"]) <= 10
    for f in data["flows"]:
        assert f["from"] in ids and f["to"] in ids and f["from"] != f["to"]
        assert f["kind"] in FLOW_KINDS and f["label"]
        for end in (f["from"], f["to"]):
            if end in comps:
                assert comps[end]["runnable"], (f, end)
    assert {f["kind"] for f in data["flows"]} == FLOW_KINDS


def test_fixture_health_covers_every_check():
    data = load()
    comps = {c["id"] for c in data["components"]}
    mods = {m["id"] for m in data["modules"]}
    health = data["health"]
    assert BASE_CHECKS <= {f["check"] for f in health} <= CHECKS
    for f in health:
        assert f["level"] in ("components", "modules")
        assert set(f["nodes"]) <= (mods if f["level"] == "modules" else comps)
        assert f["meaning"] and f["evidence"]
        assert isinstance(f["accepted"], bool)
        assert f["confidence"] is None or 0 <= f["confidence"] <= 1
    assert any(f["accepted"] for f in health) and any(not f["accepted"] for f in health)
    imports = {level: {(e["from"], e["to"]) for e in data["edges"][level] if e["count"] > 0 and not e["test_only"]} for level in ("components", "modules")}
    for f in health:
        if len(f["nodes"]) < 2:
            continue
        pairs = [(a, b) for a in f["nodes"] for b in f["nodes"] if a != b] if f["check"] == "cycle" else [tuple(f["nodes"])]
        assert any(p in imports[f["level"]] for p in pairs), f


def test_viewer_marks_only_embedded_open_findings():
    run_viewer_logic("""
      const M = buildModel(input), state = { tests: false };
      const open = input.health.filter(f => !f.accepted);
      assert.equal(M.findings.length, open.length);
      const edge = input.edges.components.find(e => e.finding && M.edgeFinding('components', e));
      assert.ok(edge);
      assert.ok(M.edgeFinding('components', edge));
      const accepted = input.edges.components.find(e => M.edgeFinding('components', e)?.accepted);
      assert.ok(accepted);
      const acceptedLayout = layoutMatrix(M, M.areaOf(M.byComp.get(accepted.from)));
      assert.ok(!acceptedLayout.edges.find(e => e.from === accepted.from && e.to === accepted.to).finding, 'accepted imports stay ordinary');
      const oldFlags = JSON.parse(JSON.stringify(input));
      oldFlags.health = [];
      const noResults = buildModel(oldFlags);
      assert.equal(noResults.edgeFinding('components', edge), null, 'edge flags cannot invent a finding');
      const freshEdge = input.edges.components.find(e => e.count > 0 && !e.test_only && !e.finding && M.isProduct(M.byComp.get(e.from)) && M.isProduct(M.byComp.get(e.to)));
      const newResult = { check: 'upward-dependency', level: 'components', nodes: [freshEdge.from, freshEdge.to], accepted: false };
      const withNew = buildModel({ ...oldFlags, health: [newResult] });
      assert.equal(withNew.edgeFinding('components', freshEdge), newResult, 'new findings come from map.health');
      const newLayout = layoutMatrix(withNew, withNew.areaOf(withNew.byComp.get(freshEdge.from)));
      assert.equal(newLayout.edges.find(e => e.from === freshEdge.from && e.to === freshEdge.to).finding, 'upward-dependency');
      const oneNode = { check: 'mixed-responsibility', level: 'components', nodes: [edge.from], accepted: false };
      const nodeResult = buildModel({ ...oldFlags, health: [oneNode] });
      assert.equal(nodeResult.findings[0], oneNode);
      assert.equal(nodeResult.edgeFinding('components', edge), null, 'one-part findings belong on the node');
    """, load())


def test_viewer_test_visibility_filters_layouts_edges_and_files():
    run_viewer_logic("""
      const product = input.components.find(c => c.nature === 'product' && input.modules.some(m => m.component === c.id));
      const code = input.modules.find(m => m.component === product.id);
      const test = { id: product.id + '/viewer-test', component: product.id, name: 'viewer-test', path: 'tests/viewer', test: true, files: [{ path: 'tests/viewer/smoke.test.ts', test: true }] };
      input.modules.push(test);
      input.edges.modules.push({ from: test.id, to: code.id, count: 0, test_count: 1, test_only: true, examples: [] });
      const M = buildModel(input), state = { tests: false };
      const testComp = input.components.find(c => c.nature === 'test');
      const testEdge = input.edges.components.find(e => e.test_only);
      assert.ok(testComp && testEdge);
      assert.equal(visibleComp(testComp), false);
      assert.equal(visibleMod(test), false);
      assert.equal(visibleEdge(testEdge, 'components'), false);
      assert.equal(visibleFile(test.files[0], test), false);
      assert.equal(visibleFile({ path: 'src/worker.spec.ts' }, code), false, 'old maps still identify named test files');
      assert.ok(!layoutMatrix(M, 'build-verify').nodes.some(n => n.id === testComp.id));
      assert.ok(!layoutModules(M, product.id).nodes.some(n => n.id === test.id));
      assert.ok(!layoutSize(M).nodes.some(n => n.id === testComp.id));
      state.tests = true;
      assert.equal(visibleComp(testComp), true);
      assert.equal(visibleMod(test), true);
      assert.equal(visibleEdge(testEdge, 'components'), true);
      assert.equal(visibleFile(test.files[0], test), true);
      assert.ok(layoutMatrix(M, 'build-verify').nodes.some(n => n.id === testComp.id));
      assert.ok(layoutModules(M, product.id).nodes.some(n => n.id === test.id));
      assert.ok(layoutSize(M).nodes.some(n => n.id === testComp.id));
    """, load())


def test_viewer_preferences_work_when_storage_is_unavailable():
    run_viewer_logic("""
      let localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
      assert.equal(readPref('codemap.tests', false), false);
      assert.equal(readPref('codemap.qualityMarks', true), true);
      assert.doesNotThrow(() => writePref('codemap.tests', true));
      const saved = new Map();
      localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
      writePref('codemap.tests', true);
      assert.equal(readPref('codemap.tests', false), true);
      writePref('codemap.tests', false);
      assert.equal(readPref('codemap.tests', true), false);
    """, load())


def test_screens_describe_state_and_never_hand_the_reader_pipeline_steps():
    """What the map shows is written for people; the agent does the pipeline work instead of asking the reader to."""
    import build
    agent_steps = re.compile(r"re-?run(ning)? decide|add evidence|draft\.json|\bthe draft\b|codemap\.py|scan\.json", re.I)
    code = re.sub(r"^\s*//.*$", "", TEMPLATE.read_text(), flags=re.M)
    assert not agent_steps.search(code), agent_steps.search(code)
    for text in (build.UNSORTED_DEFINITION, build.BUILD_VERIFY_DEFINITION, *build.MEANINGS.values()):
        assert not agent_steps.search(text), text
