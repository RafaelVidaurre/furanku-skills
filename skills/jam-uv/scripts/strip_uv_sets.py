"""Keep one UV set in a GLB and remove the others, without touching geometry, skins or images.

python strip_uv_sets.py <in.glb> <out.glb> [--keep N]

A glTF material reads its textures through the first UV set unless it says otherwise, and many engines import only
that one: a leftover layout ahead of the baked one scrambles every texture. --keep names the set the textures were
made for (default 0); it becomes the first and only set and every material is pointed at it. The file is edited
directly (no DCC round trip), so everything else stays byte-for-byte the same. Prints what was removed and exits
1 when a mesh lacks the set to keep, 2 on wrong input. Needs numpy.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402


def strip(model, keep=0):
    """(doc, blob, removed) with only UV set `keep`, renamed to the first set."""
    doc = model.doc
    wanted = f"TEXCOORD_{keep}"
    removed, drop, still_used = [], set(), set()
    for mesh_index, mesh in enumerate(doc.get("meshes", [])):
        for number, primitive in enumerate(mesh["primitives"]):
            sets = sorted(k for k in primitive["attributes"] if k.startswith("TEXCOORD_"))
            if sets and wanted not in sets:
                raise glb.GlbError(f"mesh {mesh.get('name', mesh_index)} primitive {number} has no UV set {keep} (it has {', '.join(sets)})")
    for mesh_index, mesh in enumerate(doc.get("meshes", [])):
        for number, primitive in enumerate(mesh["primitives"]):
            attributes = primitive["attributes"]
            for name in sorted(k for k in attributes if k.startswith("TEXCOORD_") and k != wanted):
                drop.add(attributes.pop(name))
                removed.append(f"{mesh.get('name', mesh_index)}[{number}].{name}")
            if wanted in attributes and wanted != "TEXCOORD_0":
                attributes["TEXCOORD_0"] = attributes.pop(wanted)
            still_used |= set(attributes.values()) | {primitive.get("indices")}
            for target in primitive.get("targets", []):
                still_used |= set(target.values())
    for material in doc.get("materials", []):
        holders = [material, material.get("pbrMetallicRoughness", {})] + [e for e in material.get("extensions", {}).values() if isinstance(e, dict)]
        for holder in holders:
            for value in holder.values():
                if isinstance(value, dict) and "index" in value:
                    value.pop("texCoord", None)
                    transform = value.get("extensions", {}).get("KHR_texture_transform")
                    if transform:
                        transform.pop("texCoord", None)
    new_doc, blob = model.rebuilt(drop_accessors=drop - still_used)
    return new_doc, blob, removed


def main(argv=None):
    parser = argparse.ArgumentParser(description="Keep one UV set in a GLB and remove the others.")
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--keep", type=int, default=0, help="index of the UV set the textures were made for (default 0)")
    args = parser.parse_args(argv)
    if os.path.abspath(args.source) == os.path.abspath(args.destination):
        print("error: write to a new file; the source is left as it is", file=sys.stderr)
        return 2
    try:
        doc, blob, removed = strip(glb.read(args.source), args.keep)
    except glb.GlbError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(os.path.abspath(args.destination)), exist_ok=True)
    glb.write(args.destination, doc, blob)
    print(json.dumps({"written": args.destination, "kept": f"TEXCOORD_{args.keep} as TEXCOORD_0", "removed": removed}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
