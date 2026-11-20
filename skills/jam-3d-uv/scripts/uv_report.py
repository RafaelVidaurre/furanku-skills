"""Measure a GLB's UV layout against stated thresholds and draw it.

python uv_report.py <model.glb> --out <dir> --texture-size N
    [--max-density-spread 3.0] [--max-overlap 0.002] [--min-gap-px N]
    [--declare-overlap "<why islands share space>"] [--declare-tiling "<why UVs leave 0-1>"]
    [--same-geometry-as <other.glb>] [--no-layout]

Meshes that share one UV square are measured as one layout; materials that each fill the square with their own
texture are measured apart. Measures, for the first UV set: UV sets per mesh, islands, coverage of the 0-1 square, the share of covered texels
claimed by more than one face (overlap), flipped faces (mirrored islands; up to 0.5% is taken as slivers), UVs outside 0-1 (tiling), texel density in
pixels per metre at --texture-size with its area-weighted P95/P5 spread, and padding: the smallest gap between two
islands and to the square's border, in pixels at --texture-size. --min-gap-px defaults to texture-size/256 (at
least 2). Overlap, flipped faces and tiling fail unless declared with a reason, which the report records; a tiling layout's
overlap and padding are not measured.
--same-geometry-as proves an unwrap moved no geometry: face centres must match the other file's (0.2% tolerance).

Writes <dir>/uv-report.json, <dir>/uv-layout.png (islands coloured, borders dark) and, when the model embeds a
base-colour texture, <dir>/uv-layout-over-base-color.png (with several layouts, one of each per material). Exits 0 when every check passes, 1 when one fails,
2 on wrong input. Needs numpy; the drawings need Pillow (--no-layout skips them).
"""
import argparse
import colorsys
import io
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb  # noqa: E402

GRID = 1024


def _percentile(values, weights, share):
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    return float(values[order][min(len(values) - 1, int(np.searchsorted(cumulative, share * cumulative[-1])))])


def islands_of(position_ids, uv, triangles):
    """Island label per triangle: triangles linked through corners that share both position and UV."""
    keys = np.concatenate([position_ids[:, None].astype(np.float64), np.round(uv * 1e5)], axis=1)
    _, corner = np.unique(keys, axis=0, return_inverse=True)
    corner = corner.reshape(-1)
    tri = corner[triangles]
    labels = glb.components(int(corner.max()) + 1, np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]]]))
    _, island = np.unique(labels[tri[:, 0]], return_inverse=True)
    return island.reshape(-1)


def rasterize(uv_tris, island, grid=GRID):
    """(coverage count per cell, island id + 1 per cell) for triangles in 0-1 UV space, sampled at cell centres."""
    count = np.zeros((grid, grid), dtype=np.uint16)
    owner = np.zeros((grid, grid), dtype=np.int32)
    scaled = uv_tris * grid
    for index in range(len(scaled)):
        (ax, ay), (bx, by), (cx, cy) = scaled[index]
        x0, x1 = max(int(np.floor(min(ax, bx, cx))), 0), min(int(np.ceil(max(ax, bx, cx))), grid - 1)
        y0, y1 = max(int(np.floor(min(ay, by, cy))), 0), min(int(np.ceil(max(ay, by, cy))), grid - 1)
        if x1 < x0 or y1 < y0:
            continue
        denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(denominator) < 1e-12:
            continue
        xs = np.arange(x0, x1 + 1) + 0.5
        ys = (np.arange(y0, y1 + 1) + 0.5)[:, None]
        w1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / denominator
        w2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / denominator
        hit = (w1 > 1e-6) & (w2 > 1e-6) & (1 - w1 - w2 > 1e-6)
        count[y0:y1 + 1, x0:x1 + 1] += hit
        owner[y0:y1 + 1, x0:x1 + 1][hit] = island[index] + 1
    return count, owner


def smallest_gap(owner, steps):
    """Smallest gap between two islands in grid cells (a lower bound), or None when it exceeds 2*steps cells."""
    labels = np.pad(owner, steps + 1)
    for step in range(steps + 1):
        for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
            other = np.roll(labels, (dy, dx), axis=(0, 1))
            if ((labels > 0) & (other > 0) & (labels != other)).any():
                return max(0, 2 * step - 1)
        grown = labels.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            other = np.roll(labels, (dy, dx), axis=(0, 1))
            take = (grown == 0) & (other > 0)
            grown[take] = other[take]
        labels = grown
    return None


def measure(primitives, texture_size, min_gap_px=None, grid=GRID):
    """UV facts for the first UV set of a list of primitives (dicts with positions, triangles, uvs)."""
    if not primitives:
        raise glb.GlbError("the file has no triangle meshes")
    min_gap_px = max(2, round(texture_size / 256)) if min_gap_px is None else min_gap_px
    sets = sorted({len(p["uvs"]) for p in primitives})
    missing = [f"{p['mesh']}[{p['primitive']}]" for p in primitives if 0 not in p["uvs"]]
    result = {"textureSize": texture_size, "uvSetsPerPrimitive": {"min": sets[0], "max": sets[-1]}, "primitivesWithoutUVs": missing,
              "primitives": len(primitives)}
    with_uv = [p for p in primitives if 0 in p["uvs"]]
    if not with_uv:
        return result
    offsets = np.cumsum([0] + [len(p["positions"]) for p in with_uv])
    positions = np.concatenate([p["positions"] for p in with_uv])
    uv = np.concatenate([p["uvs"][0] for p in with_uv])
    triangles = np.concatenate([p["triangles"] + offsets[i] for i, p in enumerate(with_uv)])
    uv = np.stack([uv[:, 0], 1.0 - uv[:, 1]], axis=1)   # glTF's V runs down; work with V up, as DCC layouts show it
    diagonal = float(np.linalg.norm(positions.max(axis=0) - positions.min(axis=0))) or 1.0
    position_ids = glb.weld(positions, diagonal * 1e-6)
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    world = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    ua, ub, uc = (uv[triangles[:, i]] for i in range(3))
    signed = 0.5 * ((ub[:, 0] - ua[:, 0]) * (uc[:, 1] - ua[:, 1]) - (uc[:, 0] - ua[:, 0]) * (ub[:, 1] - ua[:, 1]))
    real = world > (diagonal * 1e-6) ** 2
    flat = real & (np.abs(signed) < 1e-12)
    usable = real & ~flat
    island = islands_of(position_ids, uv, triangles)
    low, high = uv.min(axis=0), uv.max(axis=0)
    outside = bool(low.min() < -1e-4 or high.max() > 1 + 1e-4)
    # overlap and padding mean something only inside one square; a layout that leaves it (tiling) is not rasterized
    if outside:
        covered = gap = None
    else:
        count, owner = rasterize(uv[triangles], island, grid)
        covered = int((count > 0).sum())
        scale = texture_size / grid
        steps = int(np.ceil(min_gap_px / scale / 2)) + 1
        gap = smallest_gap(owner, steps)
    border = float(min(low.min(), 1 - high.max()) * texture_size)
    result.update({
        "triangles": int(len(triangles)),
        "islands": int(island.max()) + 1,
        "coverage": None if outside else round(covered / (grid * grid), 4),
        "overlapShare": None if outside else round(float((count > 1).sum()) / max(1, covered), 5),
        "flippedShare": round(float((signed[usable] < 0).sum()) / max(1, int(usable.sum())), 5),
        "zeroAreaUVShare": round(float(flat.sum()) / max(1, int(real.sum())), 5),
        "uvBounds": [round(float(v), 5) for v in (low[0], low[1], high[0], high[1])],
        "outsideUnitSquare": outside,
        "padding": None if outside else {"minGapPx": min_gap_px,
                                         "islandGapPx": None if gap is None else round(gap * scale, 1),
                                         "islandGapAtLeastPx": round(2 * steps * scale, 1) if gap is None else None,
                                         "borderGapPx": round(border, 1), "measuredOnGrid": grid},
    })
    if usable.any():
        density = np.sqrt(np.abs(signed[usable]) / world[usable]) * texture_size
        p5, p50, p95 = (_percentile(density, world[usable], s) for s in (0.05, 0.5, 0.95))
        result["texelDensityPxPerMeter"] = {"p5": round(p5, 1), "median": round(p50, 1), "p95": round(p95, 1)}
        result["densitySpreadP95overP5"] = round(p95 / p5, 3) if p5 > 0 else None
    result["_layout"] = {"uv": uv, "triangles": triangles, "island": island}
    return result


def compare(metrics, max_density_spread=3.0, max_overlap=0.002, declare_overlap=None, declare_tiling=None):
    rows = []

    def check(name, value, limit, passed, declared=None):
        row = {"id": name, "value": value, "limit": limit, "passed": bool(passed)}
        if not passed and declared:
            row["declared"] = declared
        rows.append(row)

    check("has-uvs", len(metrics["primitivesWithoutUVs"]), "0 meshes without UVs", not metrics["primitivesWithoutUVs"])
    check("single-uv-set", metrics["uvSetsPerPrimitive"]["max"], "1", metrics["uvSetsPerPrimitive"]["max"] <= 1)
    if "islands" not in metrics:
        return rows
    if metrics["overlapShare"] is not None:
        check("overlap", metrics["overlapShare"], f"<= {max_overlap}", metrics["overlapShare"] <= max_overlap, declare_overlap)
    check("flipped", metrics["flippedShare"], "<= 0.005", metrics["flippedShare"] <= 0.005, declare_overlap)
    check("zero-area", metrics["zeroAreaUVShare"], "<= 0.001", metrics["zeroAreaUVShare"] <= 0.001, declare_overlap)
    check("inside-unit-square", metrics["uvBounds"], "0-1", not metrics["outsideUnitSquare"], declare_tiling)
    spread = metrics.get("densitySpreadP95overP5")
    check("density-spread", spread, f"<= {max_density_spread}", spread is not None and spread <= max_density_spread, declare_tiling or declare_overlap)
    padding = metrics["padding"]
    if padding is not None:
        gap_ok = padding["islandGapPx"] is None or padding["islandGapPx"] >= padding["minGapPx"] or metrics["islands"] == 1
        check("island-gap", padding["islandGapPx"] if padding["islandGapPx"] is not None else f">= {padding['islandGapAtLeastPx']}",
              f">= {padding['minGapPx']} px", gap_ok, declare_overlap)
        check("border-gap", padding["borderGapPx"], f">= {padding['minGapPx'] / 2} px", padding["borderGapPx"] >= padding["minGapPx"] / 2, declare_overlap)
    return rows


def split_layouts(primitives, texture_size, min_gap_px=None, max_overlap=0.002, names=()):
    """[{materials, metrics}]: one layout when the meshes share a UV square, else one per material. Materials that
    each fill the square with their own texture overlap each other on purpose, which is not a fault."""
    def label(index):
        return "(none)" if index is None else (names[index] if index < len(names) and names[index] else f"material{index}")

    materials = sorted({p["material"] for p in primitives}, key=lambda m: -1 if m is None else m)
    together = measure(primitives, texture_size, min_gap_px)
    if len(materials) < 2 or (together.get("overlapShare") or 0) <= max_overlap:
        return [{"materials": [label(m) for m in materials], "metrics": together}]
    return [{"materials": [label(m)], "metrics": measure([p for p in primitives if p["material"] == m], texture_size, min_gap_px)} for m in materials]


def fingerprint(primitives):
    """Rounded face centres, for telling whether two files hold the same geometry whatever their vertex order."""
    centres = []
    for p in primitives:
        centres.append(p["positions"][p["triangles"]].mean(axis=1))
    centres = np.concatenate(centres)
    return np.unique(np.round(centres, 4), axis=0), len(centres)


def same_geometry(primitives, other):
    mine, count = fingerprint(primitives)
    theirs, other_count = fingerprint(other)
    merged = np.concatenate([mine, theirs])
    _, counts = np.unique(merged, axis=0, return_counts=True)
    unmatched = int((counts == 1).sum())
    share = unmatched / max(1, len(mine) + len(theirs))
    # a weld may drop a few doubled faces, so the counts may differ by a hair; the surfaces must coincide
    return {"triangles": [count, other_count], "unmatchedFaceCentreShare": round(share, 5),
            "same": abs(count - other_count) <= 0.002 * max(count, other_count) and share <= 0.002}


def draw(layout, path, size=1400, base=None):
    from PIL import Image, ImageDraw
    uv, triangles, island = layout["uv"], layout["triangles"], layout["island"]
    if base is None:
        image = Image.new("RGB", (size, size), (246, 246, 246))
    else:
        image = base.convert("RGB").resize((size, size))
    pen = ImageDraw.Draw(image)
    tiled = uv.min() < -1e-4 or uv.max() > 1 + 1e-4
    origin = np.floor(uv.min(axis=0)) if tiled else np.zeros(2)
    span = float(max(1.0, (np.ceil(uv.max(axis=0)) - origin).max())) if tiled else 1.0
    flat = (uv - origin) / span          # a tiling layout is drawn across all the tiles it spans
    points = flat[triangles]
    pixels = np.stack([points[:, :, 0] * size, (1 - points[:, :, 1]) * size], axis=2)
    if base is None:
        for index in range(len(pixels)):
            r, g, b = colorsys.hsv_to_rgb((int(island[index]) * 0.381966) % 1.0, 0.30, 0.95)
            pen.polygon([tuple(p) for p in pixels[index]], fill=(int(r * 255), int(g * 255), int(b * 255)), outline=(170, 170, 170))
    edges = np.sort(np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1)
    keys = np.round(np.concatenate([uv[edges[:, 0]], uv[edges[:, 1]]], axis=1) * 1e5)
    keys = np.where(keys[:, [0]] < keys[:, [2]], keys, keys[:, [2, 3, 0, 1]])
    _, first, counts = np.unique(keys, axis=0, return_index=True, return_counts=True)
    colour = (150, 20, 20) if base is None else (255, 235, 0)
    for edge in edges[first[counts == 1]]:
        ends = flat[edge]
        pen.line([(ends[0][0] * size, (1 - ends[0][1]) * size), (ends[1][0] * size, (1 - ends[1][1]) * size)], fill=colour, width=2)
    for line in range(1, int(span)):
        at = line / span * size
        pen.line([(at, 0), (at, size)], fill=(0, 0, 0))
        pen.line([(0, at), (size, at)], fill=(0, 0, 0))
    pen.rectangle([0, 0, size - 1, size - 1], outline=(0, 0, 0))
    image.save(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Measure a GLB's UV layout against stated thresholds and draw it.")
    parser.add_argument("model")
    parser.add_argument("--out", required=True, help="folder for uv-report.json and the layout drawings")
    parser.add_argument("--texture-size", type=int, required=True, help="pixels on a side of the texture the layout is for")
    parser.add_argument("--max-density-spread", type=float, default=3.0)
    parser.add_argument("--max-overlap", type=float, default=0.002)
    parser.add_argument("--min-gap-px", type=float)
    parser.add_argument("--declare-overlap", metavar="REASON", help="islands share space on purpose (mirrored or stacked)")
    parser.add_argument("--declare-tiling", metavar="REASON", help="UVs leave 0-1 on purpose (a tiling material)")
    parser.add_argument("--same-geometry-as", metavar="GLB")
    parser.add_argument("--no-layout", action="store_true")
    args = parser.parse_args(argv)
    try:
        model = glb.read(args.model)
        primitives = model.primitives()
        layouts = split_layouts(primitives, args.texture_size, args.min_gap_px, args.max_overlap, [m.get("name") for m in model.doc.get("materials", [])])
        geometry = same_geometry(primitives, glb.read(args.same_geometry_as).primitives()) if args.same_geometry_as else None
    except (glb.GlbError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    os.makedirs(args.out, exist_ok=True)
    if not args.no_layout:
        try:
            from PIL import Image
        except ImportError:
            print("error: drawing the layout needs Pillow (pip install Pillow), or pass --no-layout", file=sys.stderr)
            return 2
    failed, declared, drawings = [], [], []
    for layout in layouts:
        picture = layout["metrics"].pop("_layout", None)
        layout["checks"] = compare(layout["metrics"], args.max_density_spread, args.max_overlap, args.declare_overlap, args.declare_tiling)
        suffix = "" if len(layouts) == 1 else "-" + "".join(c if c.isalnum() or c in "-_" else "_" for c in str(layout["materials"][0]))
        label = "" if len(layouts) == 1 else f"{layout['materials'][0]}: "
        failed += [dict(c, id=label + c["id"]) for c in layout["checks"] if not c["passed"] and "declared" not in c]
        declared += [{"check": label + c["id"], "reason": c["declared"]} for c in layout["checks"] if "declared" in c]
        if picture is not None and not args.no_layout:
            draw(picture, os.path.join(args.out, f"uv-layout{suffix}.png"))
            drawings.append(f"uv-layout{suffix}.png")
            base = next((i for i in model.images() if i["bytes"] and any(u["slot"] == "baseColor" and u["material"] in layout["materials"] for u in i["usedBy"])), None)
            if base:
                draw(picture, os.path.join(args.out, f"uv-layout{suffix}-over-base-color.png"), base=Image.open(io.BytesIO(base["bytes"])))
                drawings.append(f"uv-layout{suffix}-over-base-color.png")
    extra = []
    if geometry:
        extra.append({"id": "same-geometry", "value": geometry, "limit": f"same face centres as {os.path.basename(args.same_geometry_as)}", "passed": geometry["same"]})
        failed += [c for c in extra if not c["passed"]]
    report = {"model": args.model, "layouts": layouts, "checks": extra, "declared": declared, "drawings": drawings, "passed": not failed,
              "method": f"first UV set; one layout per texture set (materials that overlap each other are measured apart); overlap and gaps on a {GRID} px grid "
                        "sampled at cell centres; density weighted by surface area, 1 unit = 1 m"}
    with open(os.path.join(args.out, "uv-report.json"), "w") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({"layouts": [{"materials": l["materials"], **l["metrics"]} for l in layouts], "failed": [c["id"] for c in failed], "declared": declared, "drawings": drawings}))
    if failed:
        print("error: " + "; ".join(f"{c['id']} is {c['value']} (limit {c['limit']})" for c in failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
