"""When a mesh's simple collision counts as covering what is seen. Included into editor/collision.py as text.

Coverage is the share of sampled render-mesh vertices within `cover_cm` of the simple collision. A mesh is covered
when at least RULE["coveredShare"] of them are, or when no vertex is farther out than RULE["underfitCm"]: a mesh the
decomposition fits a little small all over has no part missing. Distances are engine units (centimetres).
"""
RULE = {
    "coveredShare": 0.98,
    "coverMinCm": 1.5,        # a vertex farther than this outside the collision is a visible part a body passes through
    "coverMaxCm": 2.5,
    "coverShareOfSize": 0.02,  # 2% of a large mesh's size, between the two limits above
    "underfitCm": 4.5,
    "hullCounts": [4, 8, 12, 16],
    "hullVertices": 48,
    "voxels": [300000, 1000000],
    "samples": 1500,
}


def rule_with(overrides):
    rule = dict(RULE)
    rule.update(overrides or {})
    return rule


def cover_cm(size, rule=RULE):
    return max(rule["coverMinCm"], min(rule["coverMaxCm"], rule["coverShareOfSize"] * size))


def covered(result, rule=RULE):
    return result["covered"] >= rule["coveredShare"] or 0 <= result["worst"] <= rule["underfitCm"]


def summarize(distances, points, limit):
    """Coverage of `points` given each one's distance outside the collision; `gaps` is the box round the uncovered ones."""
    found = [(d, p) for d, p in zip(distances, points) if d > limit]
    result = {"covered": round(1 - len(found) / max(1, len(points)), 4),
              "worst": round(max([g[0] for g in found], default=0), 1)}
    if found:
        result["gaps"] = [[round(min(g[1][k] for g in found)) for k in range(3)],
                          [round(max(g[1][k] for g in found)) for k in range(3)]]
    return result
