"""Repository proposals: shared contracts and mechanical evidence validation.

No project ownership, kind or behavior is inferred here. Jev evaluates proposals.
"""
from pathlib import PurePosixPath
import json

PROJECT_KINDS = {
    "web-service": "Web service or API handling requests",
    "game": "Game or simulation advancing a world over time",
    "library": "Library or SDK used by callers",
    "cli": "Command-line application or developer tool",
    "data-pipeline": "Data pipeline or ETL processing datasets",
    "application": "Mobile, desktop or interactive application",
    "compiler": "Compiler or interpreter transforming or executing a language",
    "ml": "Machine-learning training or inference system",
    "embedded": "Embedded software or device firmware",
    "infrastructure": "Infrastructure or infrastructure-as-code",
    "other": "Other or mixed purpose; generic system picture",
}
VIEW_KINDS = ("request", "game-loop", "ecs", "library-api", "command", "data-pipeline",
              "app-lifecycle", "compiler", "ml-lifecycle", "device-lifecycle", "infrastructure")
EDGE_KINDS = ("control", "data", "network", "file", "process")
MAX_NODES, MAX_EDGES = 32, 64


def validate(proposals, component_ids, tracked_paths=None):
    """Validate both draft and map graph contracts, including optional inventory membership."""
    errors = []
    known_paths = set(tracked_paths) if tracked_paths is not None else None

    def rows(obj, key, where):
        value = obj.get(key, [])
        if not isinstance(value, list) or any(not isinstance(x, dict) for x in value):
            errors.append(f"{where}.{key}: expected object array")
            return []
        return value

    def strings(obj, key, where, nonempty=True):
        value = obj.get(key)
        if not isinstance(value, list) or any(not isinstance(x, str) or not x.strip() for x in value):
            errors.append(f"{where}.{key}: expected string array")
            return []
        if nonempty and not value:
            errors.append(f"{where}.{key}: needs evidence or members")
        if len(value) != len(set(value)):
            errors.append(f"{where}.{key}: duplicate values")
        return value

    def text(obj, keys, where):
        for key in keys:
            if not isinstance(obj.get(key), str) or not obj[key].strip():
                errors.append(f"{where}.{key}: required text")
            elif len(obj[key]) > 4000:
                errors.append(f"{where}.{key}: text exceeds 4000 characters")

    def evidence(obj, where):
        paths = strings(obj, "evidence", where)
        if len(paths) > 16:
            errors.append(f"{where}.evidence: at most 16 paths")
        for path in paths:
            if PurePosixPath(path).is_absolute() or ".." in PurePosixPath(path).parts or "\\" in path:
                errors.append(f"{where}.evidence: not a repository-relative path: {path!r}")
            elif known_paths is not None and path not in known_paths:
                errors.append(f"{where}.evidence: path absent from tracked inventory: {path!r}")

    def ids(items, where):
        result = set()
        for item in items:
            ident = item.get("id")
            if not isinstance(ident, str) or not ident.strip():
                errors.append(f"{where}: required id")
            elif ident in result:
                errors.append(f"{where}: duplicate id {ident!r}")
            else:
                result.add(ident)
        return result

    excerpts = rows(proposals, "evidence_excerpts", "repository")
    if len(excerpts) > 16:
        errors.append("evidence_excerpts: at most 16 snippets")
    seen_excerpts = set()
    for excerpt in excerpts:
        where = "evidence_excerpts"
        evidence({"evidence": [excerpt.get("path")]}, where)
        line = excerpt.get("start_line")
        if not isinstance(line, int) or isinstance(line, bool) or line < 1:
            errors.append("evidence_excerpts.start_line: expected positive integer")
        content = excerpt.get("text")
        if not isinstance(content, str) or not content.strip() or len(content) > 8000:
            errors.append("evidence_excerpts.text: needs 1-8000 characters of exact source text")
        key = (str(excerpt.get("path")), str(line))
        if key in seen_excerpts:
            errors.append("evidence_excerpts: duplicate path and start line")
        seen_excerpts.add(key)

    projects = rows(proposals, "projects", "repository")
    project_ids = ids(projects, "projects")
    for project in projects:
        where = f"project {project.get('id')}"
        text(project, ("name", "summary", "purpose"), where)
        evidence(project, where)
        for cid in strings(project, "components", where, nonempty=False):
            if cid not in component_ids:
                errors.append(f"{where}: unknown component {cid!r}")
    for rel in rows(proposals, "project_relations", "repository"):
        text(rel, ("from", "to", "label", "detail"), "project relation")
        evidence(rel, "project relation")
        if any(not isinstance(rel.get(k), str) or rel[k] not in project_ids for k in ("from", "to")):
            errors.append("project relation: dangling project")
        if rel.get("from") == rel.get("to"):
            errors.append("project relation: self relation")
    views = rows(proposals, "views", "repository")
    ids(views, "views")
    for view in views:
        where = f"view {view.get('id')}"
        text(view, ("project", "kind", "title", "question", "scope", "summary"), where)
        evidence(view, where)
        if not isinstance(view.get("project"), str) or view["project"] not in project_ids:
            errors.append(f"{where}: unknown project")
        if view.get("kind") not in VIEW_KINDS:
            errors.append(f"{where}: unsupported kind")
        nodes, edges = rows(view, "nodes", where), rows(view, "edges", where)
        if not 1 <= len(nodes) <= MAX_NODES or len(edges) > MAX_EDGES:
            errors.append(f"{where}: graph needs 1-{MAX_NODES} nodes and at most {MAX_EDGES} edges")
        node_ids = ids(nodes, where + ".nodes")
        for node in nodes:
            loc = where + f".node {node.get('id')}"
            text(node, ("label", "kind", "detail"), loc)
            evidence(node, loc)
            if "component" in node and (not isinstance(node["component"], str) or node["component"] not in component_ids):
                errors.append(f"{loc}: unknown component {node['component']!r}")
        seen_edges = set()
        for edge in edges:
            text(edge, ("from", "to", "label", "detail", "kind"), where + ".edge")
            evidence(edge, where + ".edge")
            if any(not isinstance(edge.get(k), str) or edge[k] not in node_ids for k in ("from", "to")):
                errors.append(f"{where}: dangling node edge")
            if edge.get("kind") not in EDGE_KINDS:
                errors.append(f"{where}: unsupported edge kind")
            key = tuple(str(edge.get(k)) for k in ("from", "to", "label", "kind"))
            if key in seen_edges:
                errors.append(f"{where}: duplicate edge")
            seen_edges.add(key)
    return errors


def inventory_paths(skeleton):
    inventory = skeleton.get("inventory")
    return inventory.get("tracked_paths") if isinstance(inventory, dict) else None


INSTRUCTIONS = {
    "repository_shape": (
        "Judge the proposed project boundaries AND relationships from grounded summaries and evidence. "
        "A repository is a storage boundary, not necessarily a product. Choose landscape only for multiple "
        "independently meaningful projects whose proposed relationships are supported. Package count alone "
        "does not justify a landscape; tightly coupled apps and shared libraries normally form one project. "
        "Choose single for one coherent product; abstain if the proposed boundaries or relationships lack "
        "evidence. Filenames are reading leads, never proof. Do not infer ownership or traffic from imports."),
    "project_kind": (
        "Choose the project's primary purpose from its grounded card and components. Kinds orient readers, "
        "not exclusive capabilities: a game may also have request and infrastructure views. Use other for a "
        "supported mixed purpose and abstain when evidence cannot establish purpose. Filenames alone are not proof."),
    "project_membership": (
        "Does the evidence support this component belonging to this project? Judge independently for each "
        "project: shared components can belong to several, without being copied or forced into one product. "
        "Expected membership is a proposal, not evidence by itself. Imports alone do not prove ownership. "
        "Return a probability near 0.5 when evidence is insufficient."),
    "view_support": (
        "Is this entire proposed view supported by supplied grounded facts and useful for its stated question "
        "and concrete scope? Assess every node and labeled edge, including order, branches and loops; filenames "
        "alone prove none of them. The primary project kind never filters views. Request views need concrete "
        "registration and execution semantics; loops need repeat/timing evidence; ECS needs entity, component "
        "data and system relations; infrastructure needs a named declared environment and traffic/resource "
        "evidence, and must not claim live deployment. Reject invented nodes, ordering or topology. Return a "
        "probability near 0.5 for missing evidence."),
}
BOOLEAN_QUESTIONS = ("project_membership", "view_support")


def questions(skeleton, draft):
    """Full states shared by decision and build, so stale/unjudged proposals never leak into maps."""
    projects = draft.get("projects", [])
    if not projects:
        return
    components = {c["id"]: {"id": c["id"], "path": c.get("path"), "kind": c.get("kind"),
                                "hints": c.get("hints", {}), "card": draft.get("components", {}).get(c["id"], {})}
                  for c in skeleton.get("components", [])}
    def with_sources(state, *targets):
        paths = set()
        def collect(value):
            if isinstance(value, dict):
                paths.update(p for p in value.get("evidence", []) if isinstance(p, str))
                for item in value.values():
                    collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)
        for target in targets:
            collect(target)
        excerpts = [excerpt for excerpt in draft.get("evidence_excerpts", []) if excerpt["path"] in paths]
        return dict(state, evidence_excerpts=excerpts) if excerpts else state

    context = {"system": {k: draft.get("system", {}).get(k) for k in ("name", "summary", "purpose")},
               "projects": projects, "project_relations": draft.get("project_relations", []),
               "revision": skeleton.get("meta", {}).get("repo", {}).get("sha")}
    inventory = skeleton.get("inventory", {})
    context["reading_leads"] = {key: {"paths": inventory.get(key, [])[:40], "omitted": max(0, len(inventory.get(key, [])) - 40)}
                                for key in ("documents", "manifests", "deployments")}
    yield "repository", "repository_shape", with_sources(dict(context, components=[
        {"id": cid, "path": c["path"], "summary": c["card"].get("summary"), "responsibility": c["card"].get("responsibility")}
        for cid, c in sorted(components.items())]), projects, draft.get("project_relations", []), list(components.values())), {
        "single": "One coherent project, potentially made from several packages or applications",
        "landscape": "Multiple independently meaningful projects, with supported boundaries and relationships",
        "abstain": "Insufficient evidence for the proposed boundaries or relationships"}
    for project in projects:
        pid = project["id"]
        state = {"project": project, "repository": context,
                 "components": [components[cid] for cid in project["components"] if cid in components]}
        yield f"project:{pid}", "project_kind", with_sources(state, project, state["components"]), dict(PROJECT_KINDS, abstain="Insufficient evidence")
        for cid in project["components"]:
            yield f"membership:{len(pid)}:{pid}:{cid}", "project_membership", with_sources({"project": project, "repository": context, "component": components.get(cid)}, project, components.get(cid)), {
                "true": "Evidence supports membership, including deliberately shared components",
                "false": "Evidence does not support membership"}
    for view in draft.get("views", []):
        yield f"view:{view['id']}", "view_support", with_sources({"view": view, "repository": context,
            "components": [components[cid] for cid in sorted({n["component"] for n in view["nodes"] if "component" in n}) if cid in components]}, view), {
            "true": "Every graph claim is grounded and answers the scoped question usefully",
            "false": "Unsupported graph claim, misleading scope, or not useful for this question"}


def question_errors(skeleton, draft):
    return [f"{node}: repository state exceeds 250 KB; narrow proposal cards before deciding"
            for node, _kind, state, _criteria in questions(skeleton, draft)
            if len(json.dumps(state, ensure_ascii=False).encode("utf-8")) > 250_000]
