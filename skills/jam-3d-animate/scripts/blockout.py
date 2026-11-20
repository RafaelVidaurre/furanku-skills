"""Block out a clip from its key poses: the project rig with one animation sampled on every frame of the spec's fps,
each bone carried from one key pose to the next (rotations slerped, translations and scales linearly, so travel on the
hips or a root bone goes straight and at a constant speed between two poses). A starting point that is already in the
clip format; the timing, arcs, overlap and contacts between the poses are keyed afterwards, in any program that exports
it. Plain Python with numpy, run from the project root (the spec's paths are project-relative).

    python3 blockout.py <clip.json> <out.glb> [--length <seconds>] [--loop-end open|duplicate]

Reads keyPoses.file, which keyposes.py writes. The clip starts at time 0. It lasts the spec's length when that is fixed;
for a length range, --length picks one inside it. Before the first pose the first pose holds; after the last pose the
last holds, or, for a loop, the motion goes on to the first pose again at the end of the cycle. A loop needs
--loop-end: `open` ends one frame before the first pose comes round again, `duplicate` repeats it as the last frame
(references/clip-spec.md, "A loop's last frame").

Prints the clip's path, frames and the poses' frames, and exits 0; exits 1 with one line per problem.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jamanim import gltf, poses, spec as specs  # noqa: E402


class Refused(ValueError):
    pass


def frame_count(s, length, loop_end, fps):
    """(frames in the file, frames in one loop or None)."""
    lo, hi = s["length"]["min"], s["length"]["max"]
    if length is None:
        if lo != hi:
            raise Refused("the spec's length is a range (%g to %g s): pick one with --length" % (lo, hi))
        length = lo
    elif not lo - 0.5 / fps <= length <= hi + 0.5 / fps:
        raise Refused("--length %g is outside the spec's length (%g to %g s)" % (length, lo, hi))
    n = int(round(length * fps))
    if s["loop"]:
        if loop_end not in ("open", "duplicate"):
            raise Refused("the clip loops: say how its last frame ends with --loop-end open or --loop-end duplicate")
        return (n if loop_end == "open" else n + 1), n
    return n + 1, None


def build(spec_path, out, length=None, loop_end=None):
    s = specs.load(spec_path)
    if not s["keyPoses"]:
        raise Refused("the clip spec lists no keyPoses")
    fps = float(s["fps"])
    frames, cycle = frame_count(s, length, loop_end, fps)
    pose_frames = [specs.frame_of(p["time"], fps) for p in s["keyPoses"]["poses"]]
    if pose_frames[-1] > (cycle if cycle is not None else frames - 1):
        raise Refused("a key pose (frame %d) lies past the clip's last frame" % pose_frames[-1])
    model = gltf.Gltf(s["keyPoses"]["file"])
    at = poses.at_poses(model, [f / fps for f in pose_frames])
    channels = {node: {p: poses.frames_between(v, pose_frames, frames, cycle) for p, v in paths.items()} for node, paths in at.items()}
    poses.write_with_animation(model, out, s["id"], fps, channels)
    check = gltf.sampling(gltf.Gltf(out), fps)
    if not check["passed"]:
        raise Refused("the written clip is not sampled on every frame: %s" % check)
    return {"clip": out.replace(os.sep, "/"), "animation": s["id"], "fps": fps, "frames": frames,
            "poses": [{"name": p["name"], "frame": f} for p, f in zip(s["keyPoses"]["poses"], pose_frames)]}


def main(argv=None):
    p = argparse.ArgumentParser(prog="blockout.py", description=__doc__.split("\n\n")[0])
    p.add_argument("spec"); p.add_argument("out")
    p.add_argument("--length", type=float); p.add_argument("--loop-end", choices=("open", "duplicate"))
    a = p.parse_args(argv)
    try:
        done = build(a.spec, a.out, a.length, a.loop_end)
    except specs.SpecError as e:
        for problem in e.problems:
            print("error: " + problem)
        return 1
    except (Refused, gltf.GltfError, OSError) as e:
        print("error: %s" % e)
        return 1
    print(json.dumps(done))
    return 0


if __name__ == "__main__":
    sys.exit(main())
