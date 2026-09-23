"""Contract tests for the codemap viewer template and its example fixture."""
import json
import re
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / "assets" / "viewer.html"
FIXTURE = SKILL / "assets" / "example.map.json"
PLACEHOLDER = "/*__CODEMAP_JSON__*/"
RUNTIMES = {"server", "client", "shared", "cli", "build", "none"}
NATURES = {"product", "tooling", "test", "content", "docs", "experiment"}
ROLES = {"surface", "adapter", "core", "kernel", "none"}
CHECKS = {"cycle", "core-uses-adapter", "crosses-the-wire", "product-uses-support"}
EXTERNAL_KINDS = {"datastore", "service", "runtime", "devtool"}
FLOW_KINDS = {"network", "file", "process"}
SPECIAL_AREAS = {"build-verify", "unsorted"}


def render(template: str, map_json: str) -> str:
    return template.replace(PLACEHOLDER, map_json.replace("</script", "<\\/script"))


def load():
    return json.loads(FIXTURE.read_text())


def test_placeholder_appears_exactly_once():
    assert TEMPLATE.read_text().count(PLACEHOLDER) == 1


def test_template_is_self_contained():
    html = TEMPLATE.read_text()
    assert not re.search(r"<link[^>]+href=[\"']?https?:", html, re.I)
    assert not re.search(r"<script[^>]+src=", html, re.I)
    assert not re.search(r"https?://(?!www\.w3\.org/)", html), "no external URLs besides the SVG namespace"
    assert "@import" not in html


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
        assert set(counts["runtimes"]) <= RUNTIMES - {"none"}
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
    assert set(data["system"]["runtime_counts"]) == RUNTIMES - {"none"}


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
    assert {f["check"] for f in health} == CHECKS
    for f in health:
        assert f["level"] in ("components", "modules")
        assert set(f["nodes"]) <= (mods if f["level"] == "modules" else comps)
        assert f["meaning"] and f["evidence"]
        assert isinstance(f["accepted"], bool)
        assert f["confidence"] is None or 0 <= f["confidence"] <= 1
    assert any(f["accepted"] for f in health) and any(not f["accepted"] for f in health)
    flagged_edges = {(e["from"], e["to"]): e for e in data["edges"]["components"] if e["finding"]}
    for f in health:
        if f["level"] != "components":
            continue
        pairs = [(a, b) for a in f["nodes"] for b in f["nodes"] if a != b] if f["check"] == "cycle" else [tuple(f["nodes"])]
        assert any(p in flagged_edges and flagged_edges[p]["finding"] == f["check"] for p in pairs), f


def test_screens_describe_state_and_never_hand_the_reader_pipeline_steps():
    """What the map shows is written for people; the agent does the pipeline work instead of asking the reader to."""
    import build
    agent_steps = re.compile(r"re-?run(ning)? decide|add evidence|draft\.json|\bthe draft\b|codemap\.py|scan\.json", re.I)
    code = re.sub(r"^\s*//.*$", "", TEMPLATE.read_text(), flags=re.M)
    assert not agent_steps.search(code), agent_steps.search(code)
    for text in (build.UNSORTED_DEFINITION, build.BUILD_VERIFY_DEFINITION, *build.MEANINGS.values()):
        assert not agent_steps.search(text), text


def project_map():
    """Small overlapping projects, including one evidenced only by infrastructure."""
    components = [
        {"id": "api", "name": "API", "area": "app", "nature": "product", "runtime": "server", "role": "surface", "runnable": True},
        {"id": "game", "name": "Game", "area": "app", "nature": "product", "runtime": "client", "role": "surface", "runnable": True},
        {"id": "shared", "name": "Shared", "area": "lib", "nature": "product", "runtime": "shared", "role": "kernel", "runnable": False},
    ]
    views = []
    for kind in ("request", "game-loop", "ecs", "infrastructure", "compiler"):
        views.append({
            "id": kind, "project": "infra" if kind == "infrastructure" else "api-project", "kind": kind,
            "title": kind, "question": "How does work move?", "scope": "Declared staging" if kind == "infrastructure" else "One operation", "summary": "Grounded behavior",
            "evidence": ["src/entry"], "decision": {"status": "accepted", "value": True},
            "nodes": [{"id": n, "label": n, "kind": role, "component": "api" if n == "entry" and kind != "infrastructure" else None, "detail": "Explains " + n, "evidence": ["src/entry"]} for n, role in (("entry", "system"), ("work", "component data"), ("reject", "response"))],
            "edges": [{"from": a, "to": b, "label": label, "detail": "Explains " + label, "kind": "network" if kind == "infrastructure" else "control", "evidence": ["src/entry"]} for a, b, label in (("entry", "work", "continue"), ("entry", "reject", "reject"), ("work", "entry", "repeat"), ("work", "work", "next tick"))],
        })
    views.append({**views[0], "id": "unsupported", "decision": {"status": "rejected", "value": False}})
    return {
        "schema": "codemap.map/1", "meta": {"import_coverage": {"languages": ["TypeScript"], "parsed_files": 3, "unparsed_files": 7, "inventory_available": True}}, "landscape": {"enabled": True},
        "system": {"name": "Repository", "actors": [{"id": "visitor", "name": "Visitor", "uses": ["api"]}, {"id": "player", "name": "Player", "uses": ["game"]}], "externals": [{"id": "db", "name": "Database", "used_by": ["api", "game"], "kind": "datastore"}]},
        "areas": [{"id": "app", "name": "Application", "components": ["api", "game"], "hue": 100}, {"id": "lib", "name": "Libraries", "components": ["shared"], "hue": 200}],
        "components": components, "modules": [{"id": c["id"] + "/main", "name": "main", "component": c["id"], "files": []} for c in components],
        "edges": {"components": [{"from": "api", "to": "shared", "count": 2}, {"from": "game", "to": "shared", "count": 5}, {"from": "api", "to": "game", "count": 1}], "modules": [{"from": "api/main", "to": "game/main", "count": 1}], "areas": []},
        "flows": [{"from": "visitor", "to": "api", "kind": "network", "label": "request"}, {"from": "api", "to": "db", "kind": "network", "label": "query"}, {"from": "game", "to": "db", "kind": "network", "label": "save"}],
        "health": [{"nodes": ["api", "game"], "check": "cycle", "accepted": False}], "unresolved": [],
        "projects": [{"id": "api-project", "name": "API project", "kind": "web-service", "components": ["api", "shared"]}, {"id": "game-project", "name": "Game project", "kind": "game", "components": ["game", "shared"]}, {"id": "infra", "name": "Infrastructure", "kind": "infrastructure", "components": []}],
        "project_relations": [{"from": "api-project", "to": "game-project", "label": "serves", "detail": "API serves game", "evidence": ["README.md"]}], "views": views,
    }


def run_viewer_js(body, cards=False):
    """Execute the shipped model/layout/router code in Node; DOM rendering is checked in a browser."""
    import subprocess
    html = TEMPLATE.read_text()
    code = html.split("(function () {", 1)[1].split("/* ================================================================== state */", 1)[0]
    routes = html.split("function parseHash(", 1)[1].split("/* ================================================================== dom helpers */", 1)[0]
    program = code + "\nconst assert = require('node:assert/strict');\n"
    program += "const repositoryModel = buildModel(" + json.dumps(project_map()) + ");\n"
    program += "let M = repositoryModel; const state = {route: {}}; const cache = new Map(); const modelFor = (id) => id ? projectModel(repositoryModel, id) : repositoryModel;\n"
    program += html[html.index("function trunc("):html.index("function swatch(")]
    program += "function parseHash(" + routes + "\n"
    if cards:
        program += html[html.index("function importCoverage("):html.index("function frameCard(")]
        program += html[html.index("function navigateTo("):html.index("function routeForFinding(")]
        program += html[html.index("function navigateOrSelect("):html.index("function selectEdgeOrGo(")]
        program += """
const h = (tag, attrs, ...children) => ({tag, attrs, children: children.flat(Infinity).filter(x => x != null)});
const pathRow = p => h('path', {}, p), compList = ids => h('components', {}, ...ids), openBtn = () => null;
const lensList = () => null, swatch = () => null, shapeGlyph = () => null, edgeGlyph = () => null;
let navigation = null, selection = null;
const go = (route, opts) => navigation = {route, opts}, select = sel => selection = sel;
const textOf = node => node == null ? '' : typeof node === 'object' ? (Array.isArray(node) ? node : node.children || []).map(textOf).join(' ') : String(node);
const elements = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(elements)];
"""
    program += body
    result = subprocess.run(["node", "-"], input=program, text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_project_scope_preserves_sharing_and_removes_foreign_relationships():
    run_viewer_js("""
const api = modelFor('api-project'), game = modelFor('game-project');
assert.deepEqual([...api.byComp.keys()], ['api', 'shared']);
assert.equal(api.byComp.get('shared'), game.byComp.get('shared'));
assert.deepEqual(api.actors.map(a => a.id), ['visitor']);
assert.deepEqual(api.externals[0].used_by, ['api']);
assert.equal(api.flows.length, 2);
assert.equal(api.edgesOf.component.length, 1);
assert.equal(api.edgesOf.area[0].count, 2);
assert.equal(api.edgesOf.module.length, 0);
assert.equal(api.health.length, 0);
assert.equal(api.areaCounts(api.byArea.get('app')).product, 1);
assert.equal(api.runtimeCounts().client, undefined);
assert.ok(!layoutProject(api).nodes.some(n => n.id === 'game'));
assert.ok(!layoutMatrix(api).nodes.some(n => n.id === 'game'));
assert.ok(!layoutShips(api).nodes.some(n => n.id === 'game'));
assert.deepEqual(availableLenses(modelFor('infra')).map(l => l.id), ['purpose']);
const singleRoot = buildModel({...modelFor('infra').map, landscape: {enabled: false}});
assert.equal(singleRoot.project, undefined);
assert.deepEqual(availableLenses(singleRoot).map(l => l.id), ['purpose']);
assert.equal(modelFor('infra').views.length, 1);
assert.ok(Number.isFinite(layoutProject(modelFor('infra')).bounds.w));
""")


def test_graphs_preserve_branches_repeats_evidence_and_code_owners():
    run_viewer_js("""
assert.ok(!repositoryModel.byView.has('unsupported'));
for (const view of repositoryModel.views) {
  const graph = layoutView(modelFor(view.project), view);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 4);
  assert.equal(new Set(graph.edges.map(e => e.id)).size, 4);
  assert.equal(new Set(graph.edges.map(e => e.d)).size, 4);
  assert.equal(graph.edges.filter(e => e.from === 'entry').length, 2);
  assert.ok(graph.edges.some(e => e.from === e.to));
  assert.ok(graph.edges.every(e => e.data.evidence[0] === 'src/entry' && !/NaN|Infinity/.test(e.d)));
  assert.equal(graph.nodes[0].hue, view.kind === 'infrastructure' ? null : 100);
  assert.equal(graph.nodes[1].sub, 'component data');
  assert.ok(graph.bounds.y < Math.min(...graph.nodes.map(n => n.y - n.h / 2)));
}
assert.equal(layoutLandscape(repositoryModel).edges[0].data.detail, 'API serves game');
""")


def test_routes_roundtrip_keep_project_context_and_degrade_safely():
    run_viewer_js("""
for (const hash of ['#/project/api-project', '#/project/api-project/layers', '#/project/api-project/area/app', '#/project/api-project/component/api', '#/view/request', '#/system']) {
  assert.equal(hashFor(parseHash(hash)), hash);
}
assert.equal(layoutFor(parseHash('#/')).lens, 'landscape');
assert.equal(layoutFor(parseHash('#/system')).lens, 'purpose');
assert.equal(parentRoute(parseHash('#/view/request')).project, 'api-project');
assert.equal(parentRoute(parseHash('#/project/api-project/component/api')).project, 'api-project');
assert.equal(parentRoute(parseHash('#/project/api-project')).project, undefined);
assert.equal(parseHash('#/project/api-project/component/game').level, 0);
assert.equal(parseHash('#/project/api-project/component/game').project, 'api-project');
for (const hash of ['#/view/missing', '#/view/unsupported', '#/project/missing', '#/view/%broken']) assert.equal(hashFor(parseHash(hash)), '#/');
state.route = parseHash('#/project/api-project');
assert.equal(routeInto({kind: 'component', data: {id:'api'}}).project, 'api-project');
assert.equal(routeInto({kind: 'concept', data: {component:'api'}}), null);
repositoryModel.landscape = false; cache.clear();
assert.equal(layoutFor(parseHash('#/')).lens, 'purpose');
assert.equal(parseHash('#/domain/app').id, 'app');
assert.equal(parseHash('#/runtime').lens, 'layers');
""")


def test_view_cards_explain_evidence_and_navigate_to_real_scoped_component():
    run_viewer_js("""
M = modelFor('api-project'); state.route = parseHash('#/view/request');
const view = repositoryModel.byView.get('request');
state.layout = layoutView(M, view);
const concept = conceptCard(view.nodes[0]);
assert.ok(textOf(concept).includes('Explains entry'));
assert.ok(textOf(concept).includes('src/entry'));
assert.ok(elements(concept).some(e => e.tag === 'components' && e.children.includes('api')));
navigateTo('component', 'api');
assert.equal(hashFor(navigation.route), '#/project/api-project/area/app');
assert.equal(navigation.opts.select, 'api');
state.layout.nodes[0].id = 'api'; navigation = null;
navigateOrSelect('component', 'api');
assert.equal(navigation.opts.select, 'api');
state.layout.nodes[0].id = 'entry';
const edge = graphEdgeCard(state.layout.edges[0]);
assert.ok(textOf(edge).includes('Explains continue'));
assert.ok(textOf(edge).includes('src/entry'));
elements(edge).find(e => e.tag === 'button').attrs.onclick();
assert.equal(selection.id, 'entry');
assert.ok(!textOf(viewLinks()).includes('unsupported'));
const l1 = {items: [], append(...xs) {this.items.push(...xs);}}, l2 = {items: [], append(...xs) {this.items.push(...xs);}};
renderGraphLegend(state.layout, l1, l2);
assert.ok(textOf(l2.items).includes('control flow'));
assert.ok(!textOf(l2.items).includes('network traffic'));
assert.ok(!textOf(l2.items).includes('imports'));
M = modelFor('infra');
assert.ok(textOf(viewCard(repositoryModel.byView.get('infrastructure'))).includes('Declared staging'));
assert.ok(textOf(projectCoverage(M.project)).includes('outside the source scan'));
assert.ok(textOf(projectCoverage(M.project)).includes('7 tracked files outside import parsing'));
""", cards=True)


def test_old_maps_keep_existing_lenses_without_project_metadata():
    run_viewer_js("const legacy = buildModel(" + json.dumps(load()) + """ );
assert.equal(legacy.landscape, false);
assert.equal(legacy.projects.length, 0);
assert.equal(legacy.views.length, 0);
assert.equal(availableLenses(legacy).length, 5);
for (const layout of [layoutSystem(legacy), layoutMatrix(legacy), layoutShips(legacy), layoutShips(legacy, true), layoutSize(legacy), layoutModules(legacy, legacy.map.components[0].id)]) {
  assert.ok(layout.nodes.length > 0);
  assert.ok(Object.values(layout.bounds).every(Number.isFinite));
}
""")
