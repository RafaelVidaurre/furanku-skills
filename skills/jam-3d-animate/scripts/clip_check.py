"""Check an animation clip on the project rig against its clip spec. Runs in Blender,
from the project root (the spec's paths are project-relative).

    blender --background --python-exit-code 1 --python clip_check.py -- <clip.glb> <clip.json> <out-dir>
            [--animation <name>] [--contact-height <m> --contact-speed <m/s>]
            [--travel <travel.json> | --travel-velocity <vx>,<vz>] [--provider-contacts <file>]
            [--loop-end auto|open|duplicate] [--sheet-frames 8] [--view side|front|three-quarter|back]
            [--size 320x400] [--video auto|none] [--ffmpeg <path>] [--engine workbench|cycles]

Measures the clip as stored, on whole frames of the spec's fps, in the glTF frame (metres, +Y up, front +Z):
contacts detected from each foot's height and speed (never from a provider's contact flags; --provider-contacts is
stamped into the report beside them), slide and penetration per contact window, jumps at the first and last frames,
the loop seam when the spec loops, frame rate, length and whether the clip's skeleton is the project rig's. Each
measure is held against the spec's `accept` thresholds. Contact detection takes `contacts.detect` from the spec, or
--contact-height and --contact-speed.

An in-place clip has had its travel removed, so its planted feet move backward with the ground. Give back the travel
for the contact measures with --travel (the travel.json root_convention.py wrote) or --travel-velocity (a constant
ground velocity, m/s, glTF x and z; 0,0 for a motion that never travelled). The check refuses an in-place clip without
one of them.

Writes clip-report.json, clip-sheet.png (stills over time; green markers under planted points, red where a window
failed) with its tiles in sheet/, and clip.mp4 when an encoder is found (Blender's own, else ffmpeg); otherwise the
report says why there is no video. Exits 0 when every check passed, 1 when one failed or the clip could not be read.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamanim  # noqa: E402
from jamanim import gltf, measure, report, skelmap, spec as specs, travel as trav  # noqa: E402


def parse(argv):
    p = argparse.ArgumentParser(prog="clip_check.py", description=__doc__.split("\n\n")[0])
    p.add_argument("clip"); p.add_argument("spec"); p.add_argument("out")
    p.add_argument("--animation"); p.add_argument("--contact-height", type=float); p.add_argument("--contact-speed", type=float)
    p.add_argument("--travel"); p.add_argument("--travel-velocity"); p.add_argument("--provider-contacts")
    p.add_argument("--loop-end", choices=("auto", "open", "duplicate"), default="auto")
    p.add_argument("--sheet-frames", type=int, default=8)
    p.add_argument("--view", choices=("side", "front", "three-quarter", "back"), default="side")
    p.add_argument("--size", default="320x400"); p.add_argument("--video", choices=("auto", "none"), default="auto")
    p.add_argument("--ffmpeg"); p.add_argument("--engine", choices=("workbench", "cycles"), default="workbench")
    return p.parse_args(argv)


def fail(msg):
    print("error: " + msg)
    sys.exit(1)


def to_gltf(v):
    """Blender's frame (Z up, front -Y) to glTF's (Y up, front +Z); +X is the character's left in both."""
    return (v[0], v[2], -v[1])


def to_blender(v):
    return Vector((v[0], -v[2], v[1]))


# ---- reading the clip ----------------------------------------------------------------------------------------------

def load_scene(clip, fps, animation):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = int(round(fps)), int(round(fps)) / fps
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(clip), disable_bone_shape=True)
    arms = [o for o in scene.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        fail("%s holds %d armatures; one is expected" % (clip, len(arms)))
    arm = arms[0]
    action = bpy.data.actions.get(animation)
    if action is None:
        candidates = [a for a in bpy.data.actions if a.name.startswith(animation)]
        if len(candidates) != 1:
            fail("Blender did not import the animation %r as one action (actions: %s)" % (animation, ", ".join(a.name for a in bpy.data.actions)))
        action = candidates[0]
    ad = arm.animation_data or arm.animation_data_create()
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    ad.action = action
    if hasattr(ad, "action_slot") and ad.action_slot is None and len(getattr(action, "slots", [])):
        ad.action_slot = action.slots[0]
    meshes = [o for o in scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)]
    return scene, arm, action, meshes


def foot_vertices(meshes, arm, at):
    """{limb: [(mesh, vertex indices)]} of vertices weighted mostly to a bone of that foot (its bone or below it)."""
    out = {}
    for limb in ("foot.l", "foot.r"):
        root = arm.data.bones[at[limb]]
        chain = {root.name} | {b.name for b in root.children_recursive}
        found = []
        for ob in meshes:
            names = {g.index: g.name for g in ob.vertex_groups}
            idx = []
            for v in ob.data.vertices:
                if v.groups:
                    g = max(v.groups, key=lambda g: g.weight)
                    if names.get(g.group) in chain and g.weight > 0:
                        idx.append(v.index)
            if idx:
                found.append((ob, np.array(idx)))
        out[limb] = found
    return out


def lowest(found):
    """Lowest world height (Blender Z) of the given vertices as currently posed; None without any."""
    if not found:
        return None
    dg = bpy.context.evaluated_depsgraph_get()
    best = None
    for ob, idx in found:
        ev = ob.evaluated_get(dg)
        co = np.empty(len(ev.data.vertices) * 3); ev.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)[idx]
        M = np.array(ev.matrix_world)
        z = (co @ M[:3, :3].T + M[:3, 3])[:, 2].min()
        best = z if best is None else min(best, z)
    return float(best)


def sample(scene, arm, frame0, frames, points, feet):
    """Per frame: heads and tails of every bone [F, K, 3], contact points {key: [F, 3]}, lowest foot height {limb: [F]}."""
    labels = [(b.name, end) for b in arm.pose.bones for end in ("head", "tail")]
    pos = np.zeros((frames, len(labels), 3)); pts = {k: np.zeros((frames, 3)) for k in points}
    low = {limb: np.zeros(frames) for limb in feet if feet[limb]}
    W = arm.matrix_world
    for f in range(frames):
        scene.frame_set(frame0 + f)
        k = 0
        for pb in arm.pose.bones:
            pos[f, k] = to_gltf(W @ pb.head); pos[f, k + 1] = to_gltf(W @ pb.tail); k += 2
        for key in points:
            pts[key][f] = to_gltf(W @ arm.pose.bones[key[2]].head)
        for limb in low:
            low[limb][f] = lowest(feet[limb])
    return labels, pos, pts, low


# ---- evidence ------------------------------------------------------------------------------------------------------

def material(name, rgba):
    """A flat colour both renderers show: the viewport colour (Workbench) and the surface colour (Cycles)."""
    mat = bpy.data.materials.new(name); mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = rgba
    return mat


VIEWS = {"side": Vector((1, 0, 0.12)), "front": Vector((0, -1, 0.12)), "back": Vector((0, 1, 0.12)), "three-quarter": Vector((0.7, -0.7, 0.25))}


def stage(scene, hips_track, ground, height, top, extent, a, frames, frame0, markers):
    """Lights, a checkered ground, a camera that follows the hips over the ground, frame stamps, contact markers. The
    frame reaches from below the ground to above `top`, the highest joint of the clip (a raised arm, a jump)."""
    width, height_px = (int(x) for x in a.size.lower().split("x"))
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = width, height_px, 100
    world = bpy.data.worlds.new("clip-check"); world.color = (0.5, 0.5, 0.5); scene.world = world
    if a.engine == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"; scene.display.shading.color_type = "MATERIAL"
    else:
        scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 8
        world.use_nodes = True
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.0; sun.rotation_euler = (0.9, 0.0, 0.5)
        scene.collection.objects.link(sun)
    scene.view_settings.view_transform = "Standard"
    scene.render.use_stamp = True
    for prop in scene.render.bl_rna.properties:
        if prop.identifier.startswith("use_stamp_") and prop.type == "BOOLEAN" and not prop.is_readonly:
            setattr(scene.render, prop.identifier, prop.identifier == "use_stamp_frame")
    scene.render.stamp_font_size = max(10, height_px // 22)

    # ground: squares a quarter of the figure's height, two colours, covering where the clip goes
    tile = height / 4.0
    (x0, y0), (x1, y1) = extent
    nx, ny = int(math.ceil((x1 - x0) / tile)) + 6, int(math.ceil((y1 - y0) / tile)) + 6
    import bmesh
    bm = bmesh.new()
    light, dark = material("ground-light", (0.62, 0.62, 0.62, 1)), material("ground-dark", (0.42, 0.42, 0.42, 1))
    ox, oy = math.floor(x0 / tile) - 3, math.floor(y0 / tile) - 3
    for i in range(nx):
        for j in range(ny):
            vs = [bm.verts.new(((ox + i + di) * tile, (oy + j + dj) * tile, ground)) for di, dj in ((0, 0), (1, 0), (1, 1), (0, 1))]
            face = bm.faces.new(vs); face.material_index = (ox + i + oy + j) % 2
    mesh = bpy.data.meshes.new("ground"); bm.to_mesh(mesh); bm.free()
    mesh.materials.append(light); mesh.materials.append(dark)
    scene.collection.objects.link(bpy.data.objects.new("ground", mesh))

    # contact markers: one green and one red sphere per contact point, shown on planted frames
    for (key, ok, bad) in markers:
        for ob, color in ((ok, (0.1, 0.8, 0.2, 1)), (bad, (0.9, 0.1, 0.1, 1))):
            ob.data.materials.append(material(ob.name, color))

    above = max(height * 1.25, top - ground + height * 0.12)
    cam_data = bpy.data.cameras.new("camera"); cam_data.type = "ORTHO"; cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = above + height * 0.25
    cam = bpy.data.objects.new("camera", cam_data); scene.collection.objects.link(cam); scene.camera = cam
    d = VIEWS[a.view].normalized()
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_start, cam_data.clip_end = 0.01, 40 * height
    for f in range(frames):
        x, y = hips_track[f]
        cam.location = Vector((x, y, ground + (above - height * 0.25) / 2)) + d * (10 * height)
        cam.keyframe_insert("location", frame=frame0 + f)
    return width, height_px


def add_markers(scene, contact_keys, height):
    import bmesh
    out = []
    for key in contact_keys:
        pair = []
        for tag in ("ok", "bad"):
            bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=height * 0.018)
            mesh = bpy.data.meshes.new("marker-%s-%s" % (key[1], tag)); bm.to_mesh(mesh); bm.free()
            ob = bpy.data.objects.new(mesh.name, mesh); scene.collection.objects.link(ob)
            pair.append(ob)
        out.append((key, pair[0], pair[1]))
    return out


def key_markers(markers, pts_world, planted_state, frame0, frames, toward_camera):
    """planted_state[key][f] is None (not planted), True (planted, window passed) or False (planted, window failed).
    Markers sit on their joint, moved toward the camera so the foot does not hide them."""
    for key, ok, bad in markers:
        for f in range(frames):
            state = planted_state[key][f]
            loc = to_blender(pts_world[key][f]) + toward_camera
            for ob, show in ((ok, state is True), (bad, state is False)):
                ob.location = loc; ob.hide_render = not show
                ob.keyframe_insert("location", frame=frame0 + f); ob.keyframe_insert("hide_render", frame=frame0 + f)


def render_sheet(scene, out, frame0, frames, count, size):
    width, height_px = size
    picks = sorted(set(int(round(x)) for x in np.linspace(0, frames - 1, max(2, min(count, frames)))))
    folder = os.path.join(out, "sheet"); os.makedirs(folder, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    tiles = []
    for f in picks:
        scene.frame_set(frame0 + f)
        path = os.path.join(folder, "frame-%04d.png" % f)
        scene.render.filepath = os.path.abspath(path)
        bpy.ops.render.render(write_still=True)
        tiles.append((f, path))
    columns = min(4, len(tiles)); rows = -(-len(tiles) // columns)
    canvas = np.zeros((rows * height_px, columns * width, 4), dtype=np.float32); canvas[..., 3] = 1.0; canvas[..., :3] = 0.5
    for k, (_, path) in enumerate(tiles):
        img = bpy.data.images.load(path)
        px = np.empty(width * height_px * 4, dtype=np.float32); img.pixels.foreach_get(px)
        r, c = k // columns, k % columns
        canvas[(rows - 1 - r) * height_px:(rows - r) * height_px, c * width:(c + 1) * width] = px.reshape(height_px, width, 4)
        bpy.data.images.remove(img)
    sheet = os.path.join(out, "clip-sheet.png")
    img = bpy.data.images.new("clip-sheet", columns * width, rows * height_px, alpha=False)
    img.pixels.foreach_set(canvas.reshape(-1)); img.filepath_raw = os.path.abspath(sheet); img.file_format = "PNG"; img.save()
    return sheet, picks, columns


def render_video(scene, out, frame0, frames, fps, a):
    """(path, None) or (None, reason)."""
    if a.video == "none":
        return None, "not asked for (--video none)"
    path = os.path.join(out, "clip.mp4")
    scene.frame_start, scene.frame_end = frame0, frame0 + frames - 1
    s = scene.render.image_settings
    formats = [e.identifier for e in s.bl_rna.properties["file_format"].enum_items]
    if "FFMPEG" in formats and not a.ffmpeg:
        try:
            if hasattr(s, "media_type"):
                s.media_type = "VIDEO"
            s.file_format = "FFMPEG"
            scene.render.ffmpeg.format = "MPEG4"; scene.render.ffmpeg.codec = "H264"
            scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
            scene.render.filepath = os.path.abspath(os.path.join(out, "clip-video-"))
            bpy.ops.render.render(animation=True)
            made = [n for n in os.listdir(out) if n.startswith("clip-video-") and n.endswith(".mp4")]
            if made:
                os.replace(os.path.join(out, made[0]), path)
                return path, None
        except (RuntimeError, TypeError, AttributeError) as e:
            print("note: Blender's own video encoder failed (%s); trying ffmpeg" % e)
        if hasattr(s, "media_type"):
            s.media_type = "IMAGE"
    ffmpeg = a.ffmpeg or shutil.which("ffmpeg")
    if not ffmpeg:
        return None, "this Blender build has no video encoder and no ffmpeg was found (pass --ffmpeg <path>)"
    frames_dir = os.path.join(out, "video-frames"); os.makedirs(frames_dir, exist_ok=True)
    s.file_format = "PNG"
    scene.render.filepath = os.path.abspath(os.path.join(frames_dir, "f"))
    bpy.ops.render.render(animation=True)
    done = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-framerate", str(fps), "-start_number", str(frame0),
                           "-i", os.path.join(frames_dir, "f%04d.png"), "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", path],
                          capture_output=True, text=True)
    shutil.rmtree(frames_dir, ignore_errors=True)
    if done.returncode != 0 or not os.path.isfile(path):
        return None, "ffmpeg failed: " + (done.stderr or "")[-300:]
    return path, None


# ---- main ----------------------------------------------------------------------------------------------------------

def main():
    a = parse(jamanim.script_args(sys.argv))
    try:
        s = specs.load(a.spec)
        smap = skelmap.load(s["rig"]["map"])
    except (specs.SpecError, skelmap.MapError) as e:
        fail("the clip spec is not usable: %s" % e)
    detect = s["contacts"]["detect"]
    detect_from = "clip spec contacts.detect"
    if a.contact_height is not None or a.contact_speed is not None:
        if a.contact_height is None or a.contact_speed is None:
            fail("give both --contact-height and --contact-speed")
        detect, detect_from = {"height": a.contact_height, "speed": a.contact_speed}, "--contact-height/--contact-speed"
    if detect is None:
        fail("contact detection needs a height and a speed: set contacts.detect in the clip spec, or pass --contact-height <m> --contact-speed <m/s>")
    fps = float(s["fps"])
    os.makedirs(a.out, exist_ok=True)

    # the file itself: animation, key times, skeleton
    try:
        g = gltf.Gltf(a.clip)
        _, anim = g.animation(a.animation)
        name = anim.get("name") or a.animation
        times = g.key_times(name)
        clip_skeleton = g.skeleton()
        rig_skeleton = gltf.Gltf(s["rig"]["model"]).skeleton()
    except (gltf.GltfError, OSError) as e:
        fail(str(e))
    on_frames, off = gltf.whole_frames(times, fps)
    first, last = int(round(times[0] * fps)), int(round(times[-1] * fps))
    frames = last - first + 1
    if frames < 4:
        fail("the clip has %d frames at %s fps; the check needs at least 4" % (frames, fps))
    clip_bones, rig_bones = dict(clip_skeleton), dict(rig_skeleton)
    rig_match = {"missing": sorted(set(rig_bones) - set(clip_bones)), "extra": sorted(set(clip_bones) - set(rig_bones)),
                 "reparented": sorted(b for b in rig_bones if b in clip_bones and clip_bones[b] != rig_bones[b])}
    try:
        at = skelmap.on_rig(smap, clip_bones)
    except skelmap.MapError as e:
        fail(str(e))

    scene, arm, action, meshes = load_scene(a.clip, fps, name)
    frame0 = int(round(action.frame_range[0]))
    limbs = ["foot.l", "foot.r"] + sorted({w["limb"] for w in s["contacts"]["planted"] if w["limb"].startswith("hand")})
    keys = skelmap.contact_points(at, limbs)
    feet = foot_vertices(meshes, arm, at)

    # rest: where the ground is and how high each contact point stands on it
    arm.data.pose_position = "REST"; bpy.context.view_layer.update()
    W = arm.matrix_world
    rest_point = {lm: (W @ arm.pose.bones[bone].head).z for _, lm, bone in keys}
    soles = [x for x in (lowest(feet[l]) for l in ("foot.l", "foot.r")) if x is not None]
    flat = s["ground"]["kind"] == "flat"
    if soles:
        ground, ground_from = min(soles), "the lowest foot vertex with the rig at rest"
    else:
        ground, ground_from = 0.0, "y = 0: the clip has no mesh weighted to the feet"
    rest_heights = {lm: z - ground for lm, z in rest_point.items()}
    figure_top = max((W @ pb.tail).z for pb in arm.pose.bones)
    fig_height = figure_top - ground
    arm.data.pose_position = "POSE"; bpy.context.view_layer.update()

    labels, pos, pts, low = sample(scene, arm, frame0, frames, keys, feet)
    if not soles:   # no foot mesh: the joints at their rest height stand in for the soles
        for limb in ("foot.l", "foot.r"):
            cols = [(lm, pts[k][:, 1]) for k in pts for lm in [k[1]] if k[0] == limb]
            low[limb] = np.min([h - rest_heights[lm] for lm, h in cols], axis=0) + 0.0
    depth = {limb: np.maximum(0.0, ground - low[limb]) for limb in low} if flat else None

    # travel given back to an in-place clip, for the contact measures only
    travel_note = None
    contact_pts = pts
    if a.travel or a.travel_velocity:
        try:
            t = trav.load(a.travel, frames, fps) if a.travel else trav.constant([float(x) for x in a.travel_velocity.split(",")], frames, fps)
        except (ValueError, OSError) as e:
            fail(str(e))
        contact_pts = {k: v.copy() for k, v in pts.items()}
        for k in contact_pts:
            contact_pts[k][:, 0] += t[:, 0]; contact_pts[k][:, 2] += t[:, 1]
        travel_note = {"from": (report.stamp("travel", a.travel) if a.travel else {"velocity": [float(x) for x in a.travel_velocity.split(",")]}),
                       "netMetres": report.mm(np.linalg.norm(t[-1]))}
    elif s["root"]["mode"] == "in-place":
        fail("this clip is in place, so its planted feet move with the travel that was taken off it: pass --travel <travel.json> "
             "(written by root_convention.py) or --travel-velocity <vx>,<vz> (m/s; 0,0 for a motion that never travelled)")

    windows = measure.contact_windows(contact_pts, fps, detect, ground if flat else None, rest_heights, depth)
    acc = s["accept"]

    # boundaries and seam
    b = measure.boundary_jumps(pos)
    boundary = {end: dict(worst=measure.worst(b[end][0], labels, b[end][1], b["interior"]), bones=measure.per_bone(b[end][0], labels))
                for end in ("start", "end")}
    boundary["interior"] = measure.roughest(b["interior"], labels)
    seam = None
    if s["loop"]:
        if s["root"]["mode"] == "root-motion":
            ref_bone = s["root"]["bone"] or at["hips"]
            if ref_bone not in clip_bones:
                fail("root.bone %r is not a bone of this clip" % ref_bone)
            k = labels.index((ref_bone, "head"))
            rel = pos.copy(); rel[:, :, 0] -= pos[:, k:k + 1, 0]; rel[:, :, 2] -= pos[:, k:k + 1, 2]
            relative_to = "the ground position of %s" % ref_bone
        else:
            rel, relative_to = pos, "the world (in-place)"
        both = measure.seam_jumps(rel)
        if a.loop_end != "auto":
            chosen, how = a.loop_end, "--loop-end"
        else:
            chosen, how = measure.loop_end(frames, fps, s["length"], rel)
        mine, other = (("open-end", "duplicate-end") if chosen == "open" else ("duplicate-end", "open-end"))
        seam = {"convention": mine, "chosenBy": how,
                "relativeTo": relative_to, "worst": measure.worst(both[mine][0], labels, both[mine][1], both["interior"]),
                "bones": measure.per_bone(both[mine][0], labels),
                "other": {"convention": other, "worst": measure.worst(both[other][0], labels, both[other][1], both["interior"])},
                "interior": measure.roughest(both["interior"], labels)}

    # verdicts
    slide = max((w["slide"] for w in windows), default=None)
    pen_measured = max((float(d.max()) for d in depth.values()), default=0.0) if flat else None
    accept = {"footSlide": measure.judge("footSlide", slide, acc["footSlide"]),
              "penetration": measure.judge("penetration", pen_measured, acc["penetration"],
                                           None if flat else "the ground is not flat (%s); judge penetration from the sheet and video" % s["ground"]["description"]),
              "boundaryJump": measure.judge("boundaryJump", max(boundary["start"]["worst"]["jump"], boundary["end"]["worst"]["jump"]), acc["boundaryJump"])}
    if s["loop"]:
        accept["loopSeam"] = measure.judge("loopSeam", seam["worst"]["jump"], acc["loopSeam"])
    if not windows:
        accept["footSlide"] = measure.judge("footSlide", None, acc["footSlide"], "no contact was detected; see the sheet, or the detection numbers")
    duration = (frames - 1) / fps
    lengths = [duration] + ([frames / fps] if s["loop"] else [])
    half = 0.5 / fps
    checks = {"skeleton": {"passed": not any(rig_match.values()), **rig_match},
              "wholeFrames": {"passed": on_frames, "largestOffsetFrames": round(off, 5)},
              "length": {"passed": any(s["length"]["min"] - half <= L <= s["length"]["max"] + half for L in lengths),
                         "seconds": round(duration, 4), "loopCycleSeconds": round(frames / fps, 4) if s["loop"] else None,
                         "wanted": s["length"]}}
    failures = [k for k, v in checks.items() if not v["passed"]] + [k for k, v in accept.items() if v["passed"] is False]
    unmeasured = [k for k, v in accept.items() if v["passed"] is None]

    for w in windows:
        w["passed"] = w["slide"] <= acc["footSlide"] + 1e-12 and ("penetration" not in w or w["penetration"] <= acc["penetration"] + 1e-12)

    hips_k = labels.index((at["hips"], "head"))
    hips_g = pos[:, hips_k]
    root_facts = {"mode": s["root"]["mode"], "bone": s["root"]["bone"],
                  "hipsNetTravel": report.mm(np.linalg.norm(hips_g[-1, [0, 2]] - hips_g[0, [0, 2]])),
                  "hipsHeightRange": report.mm(hips_g[:, 1].max() - hips_g[:, 1].min())}
    if s["root"]["bone"] and s["root"]["bone"] in clip_bones:
        rk = labels.index((s["root"]["bone"], "head"))
        root_facts["rootNetTravel"] = report.mm(np.linalg.norm(pos[-1, rk, [0, 2]] - pos[0, rk, [0, 2]]))

    # evidence
    hips_track = [(to_blender(p).x, to_blender(p).y) for p in hips_g]
    allx = [to_blender(p).x for p in pos.reshape(-1, 3)]; ally = [to_blender(p).y for p in pos.reshape(-1, 3)]
    markers = add_markers(scene, keys, fig_height)
    state = {k: [None] * frames for k in keys}
    for w in windows:
        k = next(k for k in keys if k[1] == w["point"])
        for f in range(w["from"], w["to"] + 1):
            state[k][f] = w["passed"]
    size = stage(scene, hips_track, ground, fig_height, float(pos[..., 1].max()), ((min(allx), min(ally)), (max(allx), max(ally))), a, frames, frame0, markers)
    key_markers(markers, pts, state, frame0, frames, VIEWS[a.view].normalized() * fig_height * 0.3)
    sheet, picks, columns = render_sheet(scene, a.out, frame0, frames, a.sheet_frames, size)
    video, why_no_video = render_video(scene, a.out, frame0, frames, fps, a)

    doc = {"tool": "jam-3d-animate clip_check.py " + jamanim.VERSION, "blender": bpy.app.version_string,
           "clip": report.stamp("clip", a.clip), "spec": report.stamp("spec", a.spec), "animation": name,
           "rig": {"model": report.stamp("rig", s["rig"]["model"]), "map": report.stamp("map", s["rig"]["map"])},
           "frame": {"units": "meters", "up": "+Y", "front": "+Z"},
           "fps": fps, "frames": frames, "seconds": round(duration, 4), "loop": s["loop"],
           "ground": {"kind": s["ground"]["kind"], "description": s["ground"]["description"], "height": report.mm(ground), "from": ground_from},
           "detect": dict(detect, **{"from": detect_from}),
           "restHeights": {k: report.mm(v) for k, v in rest_heights.items()},
           "penetrationMeasuredOn": "foot mesh vertices" if soles else "foot joints at their rest height",
           "travelAddedForContacts": travel_note,
           "contacts": windows,
           "feet": {limb: {"penetration": report.mm(depth[limb].max()), "frame": int(np.argmax(depth[limb]))} for limb in depth} if depth else None,
           "expectedContacts": measure.coverage(s["contacts"]["planted"], windows, fps, frames),
           "providerContacts": dict(report.stamp("provider-contacts", a.provider_contacts), note="reported beside the measured contacts; not used")
           if a.provider_contacts else None,
           "boundary": boundary, "seam": seam, "root": root_facts,
           "checks": checks, "accept": accept, "failures": failures, "unmeasured": unmeasured, "passed": not failures,
           "evidence": {"sheet": dict(report.stamp("sheet", sheet), frames=picks, columns=columns, view=a.view),
                        "video": report.stamp("video", video) if video else {"skipped": why_no_video}}}
    out_report = os.path.join(a.out, "clip-report.json")
    report.write(out_report, doc)
    print(json.dumps({"report": out_report.replace(os.sep, "/"), "passed": doc["passed"], "failures": failures, "unmeasured": unmeasured,
                      "sheet": sheet.replace(os.sep, "/"), "video": video.replace(os.sep, "/") if video else None,
                      "accept": {k: v["measured"] for k, v in accept.items()}}))
    sys.exit(0 if doc["passed"] else 1)


if __name__ == "__main__":
    main()
