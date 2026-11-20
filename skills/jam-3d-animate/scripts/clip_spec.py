"""Check a clip spec (clip.json) and print it in its long form. Plain Python, no Blender.

    python3 clip_spec.py <clip.json> [--no-files]

Exits 0 and prints the spec with every path resolved when it is complete; exits 1 and prints one line per problem
otherwise. --no-files skips checking that the rig and its skeleton map exist. The fields are described in
jamanim/spec.py and references/clip-spec.md.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jamanim import skelmap, spec  # noqa: E402


def main(argv=None):
    p = argparse.ArgumentParser(prog="clip_spec.py", description=__doc__.split("\n\n")[0])
    p.add_argument("spec"); p.add_argument("--no-files", action="store_true")
    a = p.parse_args(argv)
    try:
        s = spec.load(a.spec, check_files=not a.no_files)
        if not a.no_files:
            skelmap.load(s["rig"]["map"])
    except (spec.SpecError, skelmap.MapError) as e:
        for problem in getattr(e, "problems", [str(e)]):
            print("error: " + problem)
        return 1
    print(json.dumps(s, indent=1))
    if s["contacts"]["detect"] is None:
        print("note: contacts.detect is not set; the clip check then needs --contact-height and --contact-speed", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
