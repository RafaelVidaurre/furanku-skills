"""The joints of a plain test figure: an A-pose humanoid one unit tall, in the working frame (Z up, front -Y, +X its
left). make_test_humanoid.py builds a mesh on them; the tests use them as landmarks that are right by construction."""
import math

ARM_DROP = math.radians(40)
# finger: (name, offset across the hand, fan angle in degrees, lengths of its three bones)
FINGERS = (("index", -0.027, -18, (0.024, 0.015, 0.012)), ("middle", -0.009, -6, (0.026, 0.016, 0.012)),
           ("ring", 0.009, 6, (0.024, 0.015, 0.012)), ("pinky", 0.027, 18, (0.019, 0.012, 0.010)))
THUMB = (0.022, 0.017, 0.014)


def _add(a, b, k=1.0):
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def _unit(a):
    n = math.sqrt(sum(x * x for x in a))
    return (a[0] / n, a[1] / n, a[2] / n)


def arm_axes(sx):
    """(direction the arm runs, direction the palm faces) for the side with x sign `sx`."""
    return (sx * math.cos(ARM_DROP), 0.0, -math.sin(ARM_DROP)), (-sx * math.sin(ARM_DROP), 0.0, -math.cos(ARM_DROP))


def joints(mittens=False):
    """({landmark: (x, y, z)}, {"<finger>.<side>": fingertip}). With mittens there are no finger joints."""
    J = {"hips": (0.0, 0.0, 0.55), "spine": (0.0, 0.0, 0.62), "chest": (0.0, 0.0, 0.75), "neck": (0.0, 0.0, 0.80), "head": (0.0, 0.0, 0.845)}
    tips = {}
    for side, sx in (("l", 1.0), ("r", -1.0)):
        along, palm = arm_axes(sx)
        upper = (sx * 0.105, 0.0, 0.77); elbow = _add(upper, along, 0.16); wrist = _add(elbow, along, 0.15)
        J.update({"shoulder." + side: (sx * 0.02, 0.0, 0.77), "upper-arm." + side: upper, "lower-arm." + side: elbow, "hand." + side: wrist,
                  "upper-leg." + side: (sx * 0.05, 0.0, 0.50), "lower-leg." + side: (sx * 0.055, 0.0, 0.28),
                  "foot." + side: (sx * 0.058, 0.005, 0.06), "toes." + side: (sx * 0.062, -0.06, 0.015)})
        if mittens:
            continue
        for finger, across, fan, bones in FINGERS:
            d = _add(tuple(x * math.cos(math.radians(fan)) for x in along), (0.0, math.sin(math.radians(fan)), 0.0))   # fanned across the hand
            p = _add(_add(wrist, along, 0.055), (0.0, across, 0.0))
            for k, length in enumerate(bones, 1):
                J["%s-%d.%s" % (finger, k, side)] = p; p = _add(p, d, length)
            tips["%s.%s" % (finger, side)] = p
        d = _unit(_add(_add(tuple(x * 0.55 for x in along), (0.0, -0.8, 0.0)), palm, 0.15))
        p = _add(_add(wrist, along, 0.012), (0.0, -0.022, 0.0))
        for k, length in enumerate(THUMB, 1):
            J["thumb-%d.%s" % (k, side)] = p; p = _add(p, d, length)
        tips["thumb." + side] = p
    return J, tips
