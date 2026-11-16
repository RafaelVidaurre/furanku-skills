"""Compare animated joint positions evaluated in the engine with the same evaluation in the DCC tool.

Both sides give world positions per animation, frame and bone in engine units and axes. Positions are compared
relative to one anchor bone (the pelvis on a humanoid), so a different placement of the whole character is ignored.
A few centimetres is the expected size of difference; a larger one means the engine is not reading the skeleton as
the DCC tool does.
"""
import math


def compare(engine, dcc, anchor="pelvis", who="character"):
    """engine: {label: {who: {frame: {bone: [x, y, z]}}}}; dcc: {label: {frame: {bone: [x, y, z]}}}."""
    out = {}
    for label, frames in dcc.items():
        if label not in engine:
            raise ValueError("the engine evaluated no animation labelled %r" % label)
        for frame, engine_pose in engine[label][who].items():
            if frame not in frames:
                raise ValueError("the DCC positions of %s have no frame %s" % (label, frame))
            dcc_pose = frames[frame]

            def relative(pose, bone):
                return [pose[bone][i] - pose[anchor][i] for i in range(3)]

            differences = {bone: round(math.dist(relative(engine_pose, bone), relative(dcc_pose, bone)), 2) for bone in engine_pose}
            worst = max(differences, key=differences.get)
            out["%s@%s" % (label, frame)] = {"maxDifference": differences[worst], "worst": worst, "all": differences}
    return out


def problems(comparison, root_scale, tolerance):
    """What the comparison shows to be wrong: a scaled root bone, or joints farther apart than the tolerance."""
    found = []
    if root_scale is not None and any(abs(s - 1) > 1e-3 for s in root_scale):
        found.append({"message": "the root bone's scale in the engine is %s, not 1" % root_scale,
                      "fix": "export bones in centimetres under an armature object scaled 0.01 (docs/skinned-export.md)"})
    for key, entry in sorted(comparison.items()):
        if entry["maxDifference"] > tolerance:
            found.append({"message": "%s: %s is %.2f engine units from the DCC pose (tolerance %s)" % (key, entry["worst"], entry["maxDifference"], tolerance),
                          "fix": "check bone axes and the rest pose against the reference skeleton (docs/skinned-export.md)"})
    return found
