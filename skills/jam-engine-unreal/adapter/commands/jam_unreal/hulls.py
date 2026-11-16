"""Collision hull geometry for a static mesh, before it is exported with the mesh for import.

A spec lists shapes in the model's own frame and units:
    {"boxes": [[xmin, ymin, zmin, xmax, ymax, zmax], ...],
     "prisms": [[cx, cy, radius, zmin, zmax, sides], ...],     an upright cylinder as an n-sided prism
     "hullBelow": z,                                          one hull round every mesh vertex at or under z
     "merge": m}                                              hull points closer than m are merged when a hull is heavy
Each shape becomes one convex hull named with the engine's prefix and the render mesh's name, which is how the engine
pairs collision with a mesh on import. This module is the engine-free part; dcc/ucx_collision.py builds the meshes.
"""
import math

MAX_HULL_POINTS = 48      # the jam's hull budget: a hull with more points is merged and rebuilt
DEFAULT_MERGE = 0.012     # metres


class SpecError(ValueError):
    pass


def validate(spec):
    if not isinstance(spec, dict):
        raise SpecError("the collision spec must be a JSON object")
    unknown = sorted(set(spec) - {"boxes", "prisms", "hullBelow", "merge"})
    if unknown:
        raise SpecError("unknown collision spec field: " + ", ".join(unknown))
    for i, box in enumerate(spec.get("boxes", [])):
        if not (isinstance(box, list) and len(box) == 6 and all(isinstance(v, (int, float)) for v in box)):
            raise SpecError("boxes[%d] must be [xmin, ymin, zmin, xmax, ymax, zmax]" % i)
        if not all(box[k] < box[k + 3] for k in range(3)):
            raise SpecError("boxes[%d] has a minimum that is not below its maximum" % i)
    for i, prism in enumerate(spec.get("prisms", [])):
        if not (isinstance(prism, list) and len(prism) == 6 and all(isinstance(v, (int, float)) for v in prism)):
            raise SpecError("prisms[%d] must be [cx, cy, radius, zmin, zmax, sides]" % i)
        if prism[2] <= 0 or prism[3] >= prism[4] or int(prism[5]) != prism[5] or prism[5] < 3:
            raise SpecError("prisms[%d] needs a positive radius, zmin below zmax and at least 3 sides" % i)
    for key in ("hullBelow", "merge"):
        if key in spec and not isinstance(spec[key], (int, float)):
            raise SpecError("%s must be a number" % key)
    if spec.get("merge", DEFAULT_MERGE) <= 0:
        raise SpecError("merge must be positive")
    if not (spec.get("boxes") or spec.get("prisms") or "hullBelow" in spec):
        raise SpecError("the collision spec describes no shape")
    return spec


def box_points(box):
    return [(x, y, z) for x in (box[0], box[3]) for y in (box[1], box[4]) for z in (box[2], box[5])]


def prism_points(prism):
    cx, cy, radius, z0, z1, sides = prism
    sides = int(sides)
    points = []
    for i in range(sides):
        angle = 2 * math.pi * (i + 0.5) / sides
        for z in (z0, z1):
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle), z))
    return points


def below(points, height):
    """The points of the mesh a `hullBelow` hull wraps."""
    return [p for p in points if p[2] <= height]


def shape_points(spec, mesh_points=()):
    """One point list per shape, in spec order: boxes, prisms, then the hull below a height."""
    shapes = [box_points(b) for b in spec.get("boxes", [])] + [prism_points(p) for p in spec.get("prisms", [])]
    if "hullBelow" in spec:
        shapes.append(below(mesh_points, spec["hullBelow"]))
    return shapes


def hull_names(mesh_name, count, prefix="UCX_"):
    """`UCX_<mesh>` for one hull, `UCX_<mesh>_01`, `_02`, ... for several."""
    if count == 1:
        return [prefix + mesh_name]
    return ["%s%s_%02d" % (prefix, mesh_name, i + 1) for i in range(count)]


def bounds(points):
    return [min(p[k] for p in points) for k in range(3)], [max(p[k] for p in points) for k in range(3)]
