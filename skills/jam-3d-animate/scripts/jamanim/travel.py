"""Travel: the horizontal ground motion a clip carries, and the travel file the root convention writes.

    travel.json: {"fps": 30, "frames": 31, "mode": "line", "convention": "in-place",
                  "travel": [[x, z], ...]}      (per frame, metres in the glTF frame, relative to the first frame)

Two ways to read travel from the hips' ground projection g [F, 2]:
- "line": a constant velocity from the first frame's position to the last's. Everything else the hips do (sway, a
  speed that varies within the clip) stays on the hips. A loop whose last frame is one before its first pose comes
  round again ("open-end") spans a whole cycle instead: from the first frame to where the frame after the last one
  would be, extrapolated from the last three.
- "hips": exactly the hips' ground projection. The hips then keep no horizontal motion of their own.
"""
import json

import numpy as np

MODES = ("line", "hips")


def curve(ground, mode, loop_end=None):
    """Travel per frame [F, 2], relative to the first frame. loop_end: None (not a loop), "open" or "duplicate"."""
    g = np.asarray(ground, dtype=np.float64)
    if mode == "hips":
        return g - g[0]
    if mode == "line":
        if len(g) < 2:
            return np.zeros_like(g)
        if loop_end == "open" and len(g) >= 3:
            net, span = (3 * g[-1] - 3 * g[-2] + g[-3]) - g[0], len(g)
        else:
            net, span = g[-1] - g[0], len(g) - 1
        return net[None, :] * (np.arange(len(g)) / span)[:, None]
    raise ValueError("unknown travel mode %r (known: %s)" % (mode, ", ".join(MODES)))


def write(path, fps, mode, convention, travel, loop_end=None):
    doc = {"fps": fps, "frames": len(travel), "mode": mode, "convention": convention, "loopEnd": loop_end,
           "travel": [[round(float(x), 6), round(float(z), 6)] for x, z in travel]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")


def load(path, frames, fps):
    """The travel of a travel.json as [F, 2]; refuses a file made for another frame count or rate."""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    t = np.asarray(doc.get("travel", []), dtype=np.float64)
    if t.shape != (frames, 2):
        raise ValueError("%s holds travel for %d frames; the clip has %d" % (path, len(t), frames))
    if abs(float(doc.get("fps", fps)) - fps) > 1e-9:
        raise ValueError("%s was written at %s fps; the clip is at %s" % (path, doc.get("fps"), fps))
    return t


def constant(velocity, frames, fps):
    """Travel of a constant horizontal velocity (vx, vz) in m/s."""
    t = np.arange(frames)[:, None] / fps
    return t * np.asarray(velocity, dtype=np.float64)[None, :]
