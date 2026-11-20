"""Rigid-transform math on plain tuples, so pack, unpack and the tests share it without numpy or Blender.

A quaternion is (x, y, z, w), the order MotionBricks stores. A transform is a 7-tuple: position (x, y, z), then the
rotation quaternion (x, y, z, w). Spaces: "glTF" is the glTF frame, which is also SOMA model space (metres, +Y up, the
character faces +Z, +X is its left). "Blender" is Blender's world frame (+Z up, the character faces -Y).
"""
import math

IDENTITY_Q = (0.0, 0.0, 0.0, 1.0)


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qconj(q):
    return (-q[0], -q[1], -q[2], q[3])


def qnormalize(q):
    n = math.sqrt(sum(c * c for c in q))
    if n < 1e-12:
        raise ValueError("zero-length quaternion")
    return tuple(c / n for c in q)


def qrot(q, v):
    """Rotate vector v by unit quaternion q."""
    x, y, z = v
    r = qmul(qmul(q, (x, y, z, 0.0)), qconj(q))
    return (r[0], r[1], r[2])


def qangle(a, b):
    """Angle in radians between two unit quaternions (as rotations)."""
    d = abs(sum(x * y for x, y in zip(a, b)))
    return 2.0 * math.acos(min(1.0, d))


def qaxis_angle(axis, angle):
    n = math.sqrt(sum(c * c for c in axis))
    s = math.sin(angle / 2.0) / n
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(angle / 2.0))


def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vlen(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


# glTF -> Blender is +90 degrees about X: glTF +Y (up) becomes Blender +Z, glTF +Z (front) becomes Blender -Y.
_H = math.sqrt(0.5)
GLTF_TO_BLENDER = (_H, 0.0, 0.0, _H)
BLENDER_TO_GLTF = qconj(GLTF_TO_BLENDER)


def vec_to_gltf(v):
    return qrot(BLENDER_TO_GLTF, v)


def vec_to_blender(v):
    return qrot(GLTF_TO_BLENDER, v)


def rot_to_gltf(q):
    """A world-space rotation measured in Blender's frame, expressed in the glTF frame."""
    return qnormalize(qmul(qmul(BLENDER_TO_GLTF, q), GLTF_TO_BLENDER))


def rot_to_blender(q):
    return qnormalize(qmul(qmul(GLTF_TO_BLENDER, q), BLENDER_TO_GLTF))


def topological_order(parents):
    """Joint indices with every parent before its children."""
    order, placed = [], [False] * len(parents)
    while len(order) < len(parents):
        progressed = False
        for i, p in enumerate(parents):
            if not placed[i] and (p < 0 or placed[p]):
                order.append(i)
                placed[i] = progressed = True
        if not progressed:
            raise ValueError("the joint hierarchy has a cycle")
    return order


def forward_kinematics(parents, locals_):
    """World (position, rotation) of every joint from local transforms (7-tuples)."""
    world = [None] * len(parents)
    for i in topological_order(parents):
        lp, lq = tuple(locals_[i][:3]), tuple(locals_[i][3:])
        p = parents[i]
        if p < 0:
            world[i] = (lp, qnormalize(lq))
        else:
            pp, pq = world[p]
            world[i] = (vadd(pp, qrot(pq, lp)), qnormalize(qmul(pq, lq)))
    return world


def locals_from_world_rotations(parents, world_q, root_position, reference_locals):
    """Local transforms on the reference skeleton: the root at root_position, every other joint at its reference
    translation from its parent, with the rotation that gives it world_q."""
    out = [None] * len(parents)
    for i in range(len(parents)):
        p = parents[i]
        if p < 0:
            out[i] = tuple(root_position) + tuple(world_q[i])
        else:
            q = qnormalize(qmul(qconj(world_q[p]), world_q[i]))
            out[i] = tuple(reference_locals[i][:3]) + q
    return out
