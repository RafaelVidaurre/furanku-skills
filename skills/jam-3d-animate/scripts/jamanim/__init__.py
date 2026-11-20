"""Helpers behind the jam-3d-animate scripts: the clip spec, skeleton maps, a glTF reader, the clip measurements
(contacts, slide, penetration, jumps, seams, travel) and key poses to frames. Only `blend` imports Blender, and only the
Blender scripts import it; `gltf`, `measure`, `poses` and `travel` use numpy."""
VERSION = "1"


def script_args(argv):
    """A Blender script's own arguments: what follows the first "--", without a second "--" that a wrapper such as
    `jam blender <script> -- <arguments>` may pass through."""
    rest = argv[argv.index("--") + 1:] if "--" in argv else []
    while rest[:1] == ["--"]:
        rest = rest[1:]
    return rest
