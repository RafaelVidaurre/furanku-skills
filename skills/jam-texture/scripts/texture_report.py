"""Report a GLB's textures and materials and compare them with a budget given as arguments.

python texture_report.py <model.glb> --out <report.json>
    [--max-texture-size N] [--max-texture-mib F] [--max-materials N]
    [--expect basecolor,normal,metallic-roughness,occlusion,emissive] [--extract <dir>]
    [--allow <check>=<reason> ...]

Lists every embedded image (pixel size, encoded bytes, which material slots read it) and every material (which
maps of the metallic-roughness workflow it has, and its plain values where it has none). Checks: every image at
most --max-texture-size on both sides; texture memory at most --max-texture-mib; materials at most
--max-materials; every map named in --expect present on every material; no image that nothing uses; no two
identical images; every texture read through the first UV set.

The memory estimate assumes uncompressed RGBA8 with a full mip chain for every embedded image, the same basis as
`jam measure`, so the two agree. An engine's compressed formats take less; the budget is compared on this basis.
--extract writes the images to a folder as files, for channel packing or conversion. Exits 0 when every check
passes or is allowed with a reason, 1 when one fails, 2 on wrong input. Needs numpy.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402

MAPS = {"basecolor": "baseColor", "metallic-roughness": "metallicRoughness", "normal": "normal", "occlusion": "occlusion", "emissive": "emissive"}
CHECKS = ("texture-size", "texture-memory", "materials", "expected-maps", "unused-images", "duplicate-images", "first-uv-set", "readable-images")
MEMORY_BASIS = "RGBA8 with a full mip chain for every embedded image, uncompressed (the basis `jam measure` uses)"
EXTENSION = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def mip_bytes(width, height):
    total = 0
    while True:
        total += width * height * 4
        if width == 1 and height == 1:
            return total
        width, height = max(1, width // 2), max(1, height // 2)


def describe(model):
    """(images, materials, facts) of a Glb."""
    doc = model.doc
    images = model.images()
    for image in images:
        image.pop("bytes")
        image["memoryMiB"] = round(mip_bytes(*image["size"]) / 1048576, 3) if image["size"] else None
    materials = []
    for index, material in enumerate(doc.get("materials", [])):
        pbr = material.get("pbrMetallicRoughness", {})
        slots = {**{k: v for k, v in pbr.items() if k.endswith("Texture")}, **{k: v for k, v in material.items() if k.endswith("Texture")}}
        maps, uv_sets = {}, set()
        for label, key in MAPS.items():
            info = slots.get(key + "Texture")
            if isinstance(info, dict) and info.get("index", -1) in range(len(doc.get("textures", []))):
                texture = doc["textures"][info["index"]]
                source = texture.get("source")
                for extension in texture.get("extensions", {}).values():
                    if isinstance(extension, dict) and source is None:
                        source = extension.get("source")
                maps[label] = source
                uv_sets.add(info.get("extensions", {}).get("KHR_texture_transform", {}).get("texCoord", info.get("texCoord", 0)))
        materials.append({"name": material.get("name") or f"material{index}", "maps": maps,
                          "values": {"baseColorFactor": pbr.get("baseColorFactor", [1, 1, 1, 1]), "metallicFactor": pbr.get("metallicFactor", 1),
                                     "roughnessFactor": pbr.get("roughnessFactor", 1)},
                          "occlusionPackedWithMetallicRoughness": "occlusion" in maps and maps.get("occlusion") == maps.get("metallic-roughness"),
                          "alphaMode": material.get("alphaMode", "OPAQUE"), "doubleSided": bool(material.get("doubleSided")),
                          "uvSets": sorted(uv_sets)})
    used_materials = sorted({p["material"] for p in model.primitives() if p["material"] is not None})
    facts = {"textureMiB": round(sum(mip_bytes(*i["size"]) for i in images if i["size"]) / 1048576, 3), "memoryBasis": MEMORY_BASIS,
             "images": len(images), "materials": len(materials), "materialsDrawn": len(used_materials),
             "encodedBytes": sum(i["byteLength"] or 0 for i in images)}
    return images, materials, facts


def compare(images, materials, facts, max_texture_size=None, max_texture_mib=None, max_materials=None, expect=(), allow=None):
    allow = allow or {}
    rows = []

    def check(name, value, limit, passed):
        row = {"id": name, "value": value, "limit": limit, "passed": bool(passed)}
        if not passed and name in allow:
            row["allowed"] = allow[name]
        rows.append(row)

    unreadable = [i["name"] for i in images if not i["size"]]
    check("readable-images", unreadable, "every image embedded and decodable", not unreadable)
    if max_texture_size is not None:
        over = [f"{i['name']} {i['size'][0]}x{i['size'][1]}" for i in images if i["size"] and max(i["size"]) > max_texture_size]
        check("texture-size", over, f"<= {max_texture_size} px", not over)
    if max_texture_mib is not None:
        check("texture-memory", facts["textureMiB"], f"<= {max_texture_mib} MiB", facts["textureMiB"] <= max_texture_mib + 1e-6)
    if max_materials is not None:
        check("materials", facts["materialsDrawn"], f"<= {max_materials}", facts["materialsDrawn"] <= max_materials)
    if expect:
        missing = [f"{m['name']}: {label}" for m in materials for label in expect if label not in m["maps"]]
        check("expected-maps", missing, "every expected map on every material", not missing)
    unused = [i["name"] for i in images if not i["usedBy"]]
    check("unused-images", unused, "none", not unused)
    seen, doubles = {}, []
    for image in images:
        if image["sha256"] and image["sha256"] in seen:
            doubles.append(f"{image['name']} = {seen[image['sha256']]}")
        elif image["sha256"]:
            seen[image["sha256"]] = image["name"]
    check("duplicate-images", doubles, "none", not doubles)
    other_uv = [m["name"] for m in materials if any(s != 0 for s in m["uvSets"])]
    check("first-uv-set", other_uv, "every texture reads the first UV set", not other_uv)
    return rows


def parse_allow(values):
    allow = {}
    for value in values or []:
        name, _, reason = value.partition("=")
        if name not in CHECKS or not reason.strip():
            raise SystemExit(f"error: --allow takes <check>=<reason> with a check from: {', '.join(CHECKS)}; got {value!r}")
        allow[name] = reason.strip()
    return allow


def parse_expect(text):
    labels = [t.strip() for t in (text or "").split(",") if t.strip()]
    for label in labels:
        if label not in MAPS:
            raise SystemExit(f"error: --expect takes maps from: {', '.join(MAPS)}; got {label!r}")
    return labels


def main(argv=None):
    parser = argparse.ArgumentParser(description="Report a GLB's textures and materials and compare them with a budget.")
    parser.add_argument("model")
    parser.add_argument("--out", required=True, help="report file to write (.json)")
    parser.add_argument("--max-texture-size", type=int)
    parser.add_argument("--max-texture-mib", type=float)
    parser.add_argument("--max-materials", type=int)
    parser.add_argument("--expect", help="maps every material must have")
    parser.add_argument("--extract", metavar="DIR", help="also write the embedded images to this folder")
    parser.add_argument("--allow", action="append", metavar="CHECK=REASON")
    args = parser.parse_args(argv)
    allow, expect = parse_allow(args.allow), parse_expect(args.expect)
    try:
        model = glb.read(args.model)
        raw = model.images() if args.extract else []
        images, materials, facts = describe(model)
    except (glb.GlbError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    extracted = []
    if args.extract:
        os.makedirs(args.extract, exist_ok=True)
        for image in raw:
            if image["bytes"]:
                base = "".join(c if c.isalnum() or c in "-_." else "_" for c in os.path.splitext(image["name"])[0]) or f"image{image['index']}"
                path = os.path.join(args.extract, f"{image['index']:02d}-{base}{EXTENSION.get(image['mimeType'], '.bin')}")
                with open(path, "wb") as handle:
                    handle.write(image["bytes"])
                extracted.append(path)
    checks = compare(images, materials, facts, args.max_texture_size, args.max_texture_mib, args.max_materials, expect, allow)
    failed = [c for c in checks if not c["passed"] and "allowed" not in c]
    report = {"model": args.model, **facts, "imageList": images, "materialList": materials, "checks": checks,
              "exceptions": [{"check": c["id"], "reason": c["allowed"]} for c in checks if "allowed" in c], "extracted": extracted, "clean": not failed}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({**facts, "sizes": [i["size"] for i in images], "maps": {m["name"]: sorted(m["maps"]) for m in materials},
                      "failed": [c["id"] for c in failed], "exceptions": report["exceptions"]}))
    if failed:
        print("error: " + "; ".join(f"{c['id']}: {c['value']} (limit {c['limit']})" for c in failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
