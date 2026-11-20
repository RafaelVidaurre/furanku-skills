"""Rotations as 3x3 matrices and glTF quaternions (x, y, z, w). Functions take one item or a stack along the first axes."""
import numpy as np


def unit(v, axis=-1):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.where(n < 1e-12, 1.0, n)


def quat_to_mat(q):
    q = unit(np.asarray(q, dtype=np.float64))
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    m = np.empty(q.shape[:-1] + (3, 3))
    m[..., 0, 0] = 1 - 2 * (y * y + z * z); m[..., 0, 1] = 2 * (x * y - z * w); m[..., 0, 2] = 2 * (x * z + y * w)
    m[..., 1, 0] = 2 * (x * y + z * w); m[..., 1, 1] = 1 - 2 * (x * x + z * z); m[..., 1, 2] = 2 * (y * z - x * w)
    m[..., 2, 0] = 2 * (x * z - y * w); m[..., 2, 1] = 2 * (y * z + x * w); m[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def mat_to_quat(m):
    """Quaternions (x, y, z, w) of rotation matrices, w >= 0."""
    m = np.asarray(m, dtype=np.float64)
    flat = m.reshape(-1, 3, 3)
    out = np.empty((len(flat), 4))
    for i, r in enumerate(flat):
        t = r[0, 0] + r[1, 1] + r[2, 2]
        if t > 0:
            s = np.sqrt(t + 1.0) * 2
            q = ((r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s)
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
            q = (0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s)
        elif r[1, 1] > r[2, 2]:
            s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
            q = ((r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s)
        else:
            s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
            q = ((r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s)
        q = np.array(q)
        out[i] = unit(q if q[3] >= 0 else -q)
    return out.reshape(m.shape[:-2] + (4,))


def continuous(quats):
    """A quaternion track with signs chosen so neighbours lie in one hemisphere (no long way round when interpolated)."""
    q = np.array(quats, dtype=np.float64)
    for i in range(1, len(q)):
        if np.dot(q[i], q[i - 1]) < 0:
            q[i] = -q[i]
    return q


def slerp(a, b, t):
    a, b = unit(np.asarray(a, dtype=np.float64)), unit(np.asarray(b, dtype=np.float64))
    t = np.asarray(t, dtype=np.float64)[..., None]
    d = np.sum(a * b, axis=-1, keepdims=True)
    b = np.where(d < 0, -b, b); d = np.abs(d)
    theta = np.arccos(np.clip(d, -1.0, 1.0))
    s = np.sin(theta)
    small = s < 1e-6
    wa = np.where(small, 1 - t, np.sin((1 - t) * theta) / np.where(small, 1, s))
    wb = np.where(small, t, np.sin(t * theta) / np.where(small, 1, s))
    return unit(wa * a + wb * b)


def axis_angle(axis, angle):
    """Rotation matrix about a unit axis by an angle in radians (stacks broadcast)."""
    axis = unit(axis)
    angle = np.asarray(angle, dtype=np.float64)
    x, y, z = axis[..., 0], axis[..., 1], axis[..., 2]
    c, s = np.cos(angle), np.sin(angle)
    C = 1 - c
    m = np.empty(np.broadcast(x, angle).shape + (3, 3))
    m[..., 0, 0] = c + x * x * C; m[..., 0, 1] = x * y * C - z * s; m[..., 0, 2] = x * z * C + y * s
    m[..., 1, 0] = y * x * C + z * s; m[..., 1, 1] = c + y * y * C; m[..., 1, 2] = y * z * C - x * s
    m[..., 2, 0] = z * x * C - y * s; m[..., 2, 1] = z * y * C + x * s; m[..., 2, 2] = c + z * z * C
    return m


def arc(a, b, fallback=(0.0, 0.0, 1.0)):
    """The shortest rotation turning direction a onto direction b (stacks broadcast). Opposite directions turn half a
    circle about the axis most perpendicular to them among `fallback` and the world axes."""
    a, b = np.broadcast_arrays(unit(a), unit(b))
    shape = a.shape[:-1]
    A, B = a.reshape(-1, 3), b.reshape(-1, 3)
    axis = np.cross(A, B)
    s = np.linalg.norm(axis, axis=-1)
    c = np.sum(A * B, axis=-1)
    out = axis_angle(np.where(s[:, None] < 1e-9, np.array([1.0, 0.0, 0.0]), axis), np.arctan2(s, c))
    for i in np.nonzero((s < 1e-9) & (c < 0))[0]:
        v = A[i]
        for cand in (np.asarray(fallback, dtype=np.float64), np.eye(3)[0], np.eye(3)[1], np.eye(3)[2]):
            p = cand - v * np.dot(v, cand)
            if np.linalg.norm(p) > 1e-3:
                break
        out[i] = axis_angle(unit(p), np.pi)
    return out.reshape(shape + (3, 3))


def angle_between(a, b):
    """Angle in degrees between directions (stacks broadcast)."""
    a, b = unit(a), unit(b)
    return np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b), axis=-1), np.sum(a * b, axis=-1)))


def rotation_angle(r):
    """Angle in degrees of rotation matrices."""
    t = (np.trace(r, axis1=-2, axis2=-1) - 1) / 2
    return np.degrees(np.arccos(np.clip(t, -1.0, 1.0)))


def rot_of(m):
    """The rotation of 4x4 (or 3x3) transforms with any uniform or axis scale removed: columns normalised."""
    r = np.asarray(m, dtype=np.float64)[..., :3, :3]
    return r / np.linalg.norm(r, axis=-2, keepdims=True)


def frame(primary, secondary):
    """An orthonormal frame (columns: primary, secondary made perpendicular, their cross product)."""
    x = unit(primary)
    y = unit(secondary - x * np.sum(secondary * x, axis=-1, keepdims=True))
    return np.stack([x, y, np.cross(x, y)], axis=-1)


def trs(t, q, s):
    """4x4 transforms from translations, quaternions and scales (stacks)."""
    t, q, s = np.asarray(t, dtype=np.float64), np.asarray(q, dtype=np.float64), np.asarray(s, dtype=np.float64)
    m = np.zeros(np.broadcast_shapes(t.shape[:-1], q.shape[:-1], s.shape[:-1]) + (4, 4))
    m[..., :3, :3] = quat_to_mat(q) * s[..., None, :]
    m[..., :3, 3] = t
    m[..., 3, 3] = 1.0
    return m
