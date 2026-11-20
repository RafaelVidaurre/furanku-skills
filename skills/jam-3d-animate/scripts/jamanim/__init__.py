"""Pure helpers behind the jam-3d-animate scripts: the clip spec, skeleton maps, a glTF reader, and the clip
measurements (contacts, slide, penetration, boundary and seam jumps, travel). Nothing here imports Blender; `gltf`,
`measure` and `travel` use numpy."""
VERSION = "1"


def script_args(argv):
    """A Blender script's own arguments: what follows the first "--", without a second "--" that a wrapper such as
    `jam blender <script> -- <arguments>` may pass through."""
    rest = argv[argv.index("--") + 1:] if "--" in argv else []
    while rest[:1] == ["--"]:
        rest = rest[1:]
    return rest
