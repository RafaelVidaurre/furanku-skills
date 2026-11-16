"""Measure a GLB's topology and compare it with a budget given as arguments.

python topology_report.py <model.glb> --out <report.json>
    [--max-triangles N] [--target-triangles N] [--max-materials N]
    [--min-quad-share F] [--require-closed] [--allow <check>=<reason> ...]

Measures triangles, materials, welded vertices, open edges, non-manifold edges, degenerate and duplicate faces, parts
(connected pieces) and small parts, and the share of triangles that pair into quads. glTF stores triangles only, so
the quad share is an estimate: two triangles count as a quad when the edge they share is the longest edge of both.
Vertices are welded by position first, because glTF splits them along UV seams and hard edges.

Exits 0 when every check passes or is allowed with a reason, 1 when a check fails, 2 on wrong input. Writes only
the report file. Needs numpy.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402

CHECKS = ("triangles", "materials", "non-manifold-edges", "degenerate-faces", "duplicate-faces", "small-parts", "open-edges", "quad-share")


def measure(primitives):
    """Topology facts of a list of primitives (dicts with `positions`, `triangles`, `material`)."""
    if not primitives:
        raise glb.GlbError("the file has no triangle meshes")
    offsets = np.cumsum([0] + [len(p["positions"]) for p in primitives])
    positions = np.concatenate([p["positions"] for p in primitives])
    triangles = np.concatenate([p["triangles"] + offsets[i] for i, p in enumerate(primitives)])
    low, high = positions.min(axis=0), positions.max(axis=0)
    diagonal = float(np.linalg.norm(high - low)) or 1.0
    welded = glb.weld(positions, diagonal * 1e-6)
    tris = welded[triangles]
    points = np.zeros((int(welded.max()) + 1, 3))
    points[welded] = positions
    a, b, c = points[tris[:, 0]], points[tris[:, 1]], points[tris[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    collapsed = (tris[:, 0] == tris[:, 1]) | (tris[:, 1] == tris[:, 2]) | (tris[:, 0] == tris[:, 2])
    degenerate = collapsed | (area < (diagonal * 1e-6) ** 2)
    good = tris[~degenerate]
    _, face_counts = np.unique(np.sort(good, axis=1), axis=0, return_counts=True)
    edges = np.sort(np.concatenate([good[:, [0, 1]], good[:, [1, 2]], good[:, [2, 0]]]), axis=1)
    unique_edges, edge_index, edge_counts = np.unique(edges, axis=0, return_inverse=True, return_counts=True)
    edge_index = edge_index.reshape(-1)
    labels = glb.components(len(points), unique_edges)
    part_of_face = labels[good[:, 0]] if len(good) else np.zeros(0, dtype=np.int64)
    _, part_sizes = np.unique(part_of_face, return_counts=True)
    small_limit = max(8, int(round(len(good) * 0.002)))
    # quad estimate: a triangle's longest edge; two triangles sharing the same longest edge make one quad
    n = len(good)
    lengths = np.stack([np.linalg.norm(points[good[:, i]] - points[good[:, (i + 1) % 3]], axis=1) for i in range(3)], axis=1) if n else np.zeros((0, 3))
    longest = edge_index.reshape(3, n).T[np.arange(n), lengths.argmax(axis=1)] if n else np.zeros(0, dtype=np.int64)
    _, longest_counts = np.unique(longest, return_counts=True)
    paired = int((longest_counts == 2).sum()) * 2
    materials = sorted({-1 if p["material"] is None else p["material"] for p in primitives})
    return {
        "triangles": int(len(triangles)),
        "exportedVertices": int(len(positions)),
        "weldedVertices": int(len(points)),
        "materials": len(materials),
        "primitives": len(primitives),
        "sizeMeters": [round(float(v), 5) for v in high - low],
        "openEdges": int((edge_counts == 1).sum()),
        "nonManifoldEdges": int((edge_counts > 2).sum()),
        "degenerateFaces": int(degenerate.sum()),
        "duplicateFaces": int((face_counts - 1).sum()),
        "parts": int(len(part_sizes)),
        "smallParts": int((part_sizes < small_limit).sum()),
        "smallPartLimitTriangles": small_limit,
        "largestPartShare": round(float(part_sizes.max() / max(1, len(good))), 4) if len(part_sizes) else 0.0,
        "quadPairShare": round(paired / max(1, n), 4),
    }


def compare(metrics, max_triangles=None, target_triangles=None, max_materials=None, min_quad_share=None, require_closed=False, allow=None):
    """Checks as {id, value, limit, passed, allowed?}; a check with no limit given is left out."""
    allow = allow or {}
    rows = []

    def check(name, value, limit, passed):
        row = {"id": name, "value": value, "limit": limit, "passed": bool(passed)}
        if not passed and name in allow:
            row["allowed"] = allow[name]
        rows.append(row)

    if max_triangles is not None:
        check("triangles", metrics["triangles"], f"<= {max_triangles}", metrics["triangles"] <= max_triangles)
    if max_materials is not None:
        check("materials", metrics["materials"], f"<= {max_materials}", metrics["materials"] <= max_materials)
    check("non-manifold-edges", metrics["nonManifoldEdges"], "0", metrics["nonManifoldEdges"] == 0)
    check("degenerate-faces", metrics["degenerateFaces"], "0", metrics["degenerateFaces"] == 0)
    check("duplicate-faces", metrics["duplicateFaces"], "0", metrics["duplicateFaces"] == 0)
    check("small-parts", metrics["smallParts"], "0", metrics["smallParts"] == 0)
    if require_closed:
        check("open-edges", metrics["openEdges"], "0", metrics["openEdges"] == 0)
    if min_quad_share is not None:
        check("quad-share", metrics["quadPairShare"], f">= {min_quad_share}", metrics["quadPairShare"] >= min_quad_share)
    notes = []
    if target_triangles is not None and metrics["triangles"] > target_triangles:
        notes.append(f"{metrics['triangles']} triangles is above the target of {target_triangles}")
    return rows, notes


def parse_allow(values):
    allow = {}
    for value in values or []:
        name, _, reason = value.partition("=")
        if name not in CHECKS or not reason.strip():
            raise SystemExit(f"error: --allow takes <check>=<reason> with a check from: {', '.join(CHECKS)}; got {value!r}")
        allow[name] = reason.strip()
    return allow


def main(argv=None):
    parser = argparse.ArgumentParser(description="Measure a GLB's topology and compare it with a budget.")
    parser.add_argument("model")
    parser.add_argument("--out", required=True, help="report file to write (.json)")
    parser.add_argument("--max-triangles", type=int)
    parser.add_argument("--target-triangles", type=int)
    parser.add_argument("--max-materials", type=int)
    parser.add_argument("--min-quad-share", type=float, help="smallest accepted quad share, 0-1 (deforming meshes)")
    parser.add_argument("--require-closed", action="store_true", help="fail on open edges")
    parser.add_argument("--allow", action="append", metavar="CHECK=REASON", help="accept a failing check, with the reason on record")
    args = parser.parse_args(argv)
    allow = parse_allow(args.allow)
    try:
        metrics = measure(glb.read(args.model).primitives())
    except (glb.GlbError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    checks, notes = compare(metrics, args.max_triangles, args.target_triangles, args.max_materials, args.min_quad_share, args.require_closed, allow)
    failed = [c for c in checks if not c["passed"] and "allowed" not in c]
    report = {"model": args.model, "metrics": metrics, "checks": checks, "notes": notes,
              "exceptions": [{"check": c["id"], "reason": c["allowed"]} for c in checks if "allowed" in c],
              "clean": not failed,
              "method": "vertices welded by position; quad share = triangles pairing across a mutual longest edge"}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({"metrics": metrics, "failed": [c["id"] for c in failed], "exceptions": report["exceptions"], "notes": notes}))
    if failed:
        print("error: " + "; ".join(f"{c['id']} is {c['value']} (limit {c['limit']})" for c in failed)
              + ". Fix the mesh, or pass --allow <check>=<reason> for what is intended", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
