"""Render a retarget for a person to judge, and check that Blender plays the written file as computed. Runs in Blender.

    blender --background --python-exit-code 1 --python retarget_evidence.py -- <retarget-report.json> <out-dir>
            [--animation <name>]... [--frames 6] [--size 320x420] [--samples 8]

Reads the source and the retargeted model named in the report. For each animation, at --frames evenly spaced frames, it
renders the source and the target each from the front and from its left side, every tile framed on its own character
with a ground plane at height zero, and writes <animation>-sheet.png: one column per frame, rows source front, target
front, source side, target side. Cameras follow the character, so travel does not show; the report's hipsTravel has it.

Playback check: at every frame of each animation, every joint the target map places is read from Blender's own glTF
import of the retargeted model and compared with the position computed by the retarget helpers. Writes
evidence-manifest.json: per animation the sheet, its SHA-256, the frames shown and the largest playback difference in
metres. Exits 1 when that difference exceeds 0.1% of the target's height.
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamretarget  # noqa: E402
from jamretarget import gltf, report, transfer  # noqa: E402
from jamretarget.skeleton import Skeleton  # noqa: E402


def parse(argv):
    p = argparse.ArgumentParser(prog="retarget_evidence.py", description=__doc__.split("\n\n")[0])
    p.add_argument("report"); p.add_argument("out")
    p.add_argument("--animation", action="append", default=[])
    p.add_argument("--frames", type=int, default=6)
    p.add_argument("--size", default="320x420"); p.add_argument("--samples", type=int, default=8)
    return p.parse_args(argv)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    new = [o for o in bpy.data.objects if o not in before]
    arms = [o for o in new if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise SystemExit("error: %s holds %d armatures; one is expected" % (path, len(arms)))
    shapes = {pb.custom_shape for pb in arms[0].pose.bones if pb.custom_shape}
    for o in [o for o in new if o in shapes]:
        bpy.data.objects.remove(o)
    return arms[0], [o for o in bpy.data.objects if o in set(new) and o.type == "MESH"]


def use_animation(arm, name):
    ad = arm.animation_data
    tracks = {t.name: t for t in ad.nla_tracks} if ad else {}
    if name not in tracks or not tracks[name].strips:
        raise SystemExit("error: %s has no animation %r after import" % (arm.name, name))
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = tracks[name].strips[0].action


def gltf_from_blender(v):
    return np.array([v[0], v[2], -v[1]])


def main():
    a = parse(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    width, height_px = (int(x) for x in a.size.lower().split("x"))
    with open(a.report, encoding="utf-8") as f:
        rep = json.load(f)
    source_path = next(i["path"] for i in rep["inputs"] if i["role"] == "source")
    model_path = rep["outputs"][0]["path"]
    names = [e["name"] for e in rep["animations"] if not a.animation or e["name"] in a.animation]
    if a.animation and len(names) != len(a.animation):
        raise SystemExit("error: the report has no animation named %s" % ", ".join(n for n in a.animation if n not in names))
    os.makedirs(a.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    src_arm, src_meshes = import_glb(source_path)
    tgt_arm, tgt_meshes = import_glb(model_path)
    fps = scene.render.fps / scene.render.fps_base

    # the retarget helpers' own reading of the written file
    tgt_skel = Skeleton(model_path, {bone: k for k, bone in rep["target"]["landmarks"].items()}, "retargeted")
    by_name = {an["name"]: an for an in tgt_skel.model.animations()}

    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("evidence"); world.use_nodes = True; scene.world = world
    bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.55, 0.57, 0.6, 1); bg.inputs[1].default_value = 0.8
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.0; sun.rotation_euler = (0.8, 0.0, 0.6)
    scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    ground = bpy.context.active_object; ground.name = "ground"
    mat = bpy.data.materials.new("ground"); mat.diffuse_color = (0.35, 0.36, 0.33, 1); ground.data.materials.append(mat)
    cam_data = bpy.data.cameras.new("camera"); cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("camera", cam_data); scene.collection.objects.link(cam); scene.camera = cam
    scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = a.samples; scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = width, height_px, 100
    scene.render.image_settings.file_format = "PNG"

    def coords(meshes):
        dg = bpy.context.evaluated_depsgraph_get()
        out = []
        for o in meshes:
            ev = o.evaluated_get(dg)
            co = np.empty(len(ev.data.vertices) * 3); ev.data.vertices.foreach_get("co", co)
            M = np.array(ev.matrix_world)
            out.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
        return np.concatenate(out) if out else None

    def joints(arm):
        return np.array([arm.matrix_world @ pb.head for pb in arm.pose.bones])

    def shoot(path, show, arm, meshes, view, size):
        for o in src_meshes + tgt_meshes:
            o.hide_render = o not in show
        P = coords(meshes) if meshes else joints(arm)
        lo, hi = P.min(axis=0), P.max(axis=0)
        centre = Vector(((lo + hi) / 2).tolist())
        ground.location = (centre.x, centre.y, 0.0); ground.scale = (4 * size, 4 * size, 1)
        d = Vector((0, -1, 0.08)) if view == "front" else Vector((1, 0, 0.08))
        cam.location = centre + d.normalized() * (8 * size)
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = 1.15 * size * max(1.0, width / height_px); cam_data.clip_end = 30 * size
        scene.render.filepath = os.path.abspath(path)
        bpy.ops.render.render(write_still=True)

    manifest = {"tool": "jam-3d-retarget retarget_evidence.py " + jamretarget.VERSION, "blender": bpy.app.version_string,
                "report": report.stamp("report", a.report), "animations": []}
    worst_all = 0.0
    for name in names:
        entry = next(e for e in rep["animations"] if e["name"] == name)
        use_animation(src_arm, name); use_animation(tgt_arm, name)
        times = entry["startSeconds"] + np.arange(entry["frames"]) / entry["fps"]
        trs, _ = gltf.sample_locals(tgt_skel.model, by_name[name], times, tgt_skel.rest)
        computed = transfer.world_of(tgt_skel, trs)
        bones = {k: tgt_skel.at[k] for k in tgt_skel.at}
        worst = 0.0
        for f, t in enumerate(times):
            frame = t * fps
            scene.frame_set(int(math.floor(frame)), subframe=float(frame - math.floor(frame)))
            for k, node in bones.items():
                pb = tgt_arm.pose.bones[rep["target"]["landmarks"][k]]
                seen = gltf_from_blender(tgt_arm.matrix_world @ pb.head)
                worst = max(worst, float(np.linalg.norm(seen - computed[f, node, :3, 3])))
        worst_all = max(worst_all, worst / rep["target"]["heightMeters"])
        shown = sorted({int(round(x)) for x in np.linspace(0, entry["frames"] - 1, max(1, a.frames))})
        tiles = []
        for f in shown:
            frame = times[f] * fps
            scene.frame_set(int(math.floor(frame)), subframe=float(frame - math.floor(frame)))
            for view in ("front", "side"):
                for who, arm, meshes, h in (("source", src_arm, src_meshes, rep["source"]["heightMeters"]),
                                            ("target", tgt_arm, tgt_meshes, rep["target"]["heightMeters"])):
                    path = os.path.join(a.out, "%s-%03d-%s-%s.png" % (name, f, who, view))
                    shoot(path, meshes, arm, meshes, view, 1.25 * h)
                    tiles.append((f, view, who, path))
        rows = [("front", "source"), ("front", "target"), ("side", "source"), ("side", "target")]
        canvas = np.zeros((len(rows) * height_px, len(shown) * width, 4), dtype=np.float32); canvas[..., 3] = 1.0
        for f, view, who, path in tiles:
            img = bpy.data.images.load(path)
            px = np.empty(width * height_px * 4, dtype=np.float32); img.pixels.foreach_get(px)
            r, c = rows.index((view, who)), shown.index(f)
            canvas[(len(rows) - 1 - r) * height_px:(len(rows) - r) * height_px, c * width:(c + 1) * width] = px.reshape(height_px, width, 4)
            bpy.data.images.remove(img)
            os.remove(path)
        sheet = os.path.join(a.out, "%s-sheet.png" % name)
        out_img = bpy.data.images.new(name + "-sheet", len(shown) * width, len(rows) * height_px, alpha=False)
        out_img.pixels.foreach_set(canvas.reshape(-1)); out_img.filepath_raw = os.path.abspath(sheet); out_img.file_format = "PNG"; out_img.save()
        manifest["animations"].append({"name": name, "sheet": report.stamp("sheet", sheet), "framesShown": shown,
                                       "rows": ["%s %s" % (who, view) for view, who in rows],
                                       "playbackCheckMeters": float("%.3g" % worst)})
    manifest["playbackCheckPassed"] = worst_all <= 1e-3
    out = os.path.join(a.out, "evidence-manifest.json")
    report.write(out, manifest)
    print(json.dumps({"manifest": out.replace(os.sep, "/"), "sheets": [e["sheet"]["path"] for e in manifest["animations"]],
                      "playbackCheckMeters": {e["name"]: e["playbackCheckMeters"] for e in manifest["animations"]}}))
    if not manifest["playbackCheckPassed"]:
        raise SystemExit("error: Blender plays the retargeted file differently from what was computed (see evidence-manifest.json)")


if __name__ == "__main__":
    main()
