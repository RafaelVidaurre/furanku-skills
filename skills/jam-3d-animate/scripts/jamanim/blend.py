"""Blender helpers the jam-3d-animate scripts share: the version they need, frame rates, actions, the glTF/Blender
frames, and the evidence renders (a sheet of stills and a video). Imported inside Blender only."""
import math
import os
import shutil
import subprocess

import bmesh
import bpy
import numpy as np
from mathutils import Vector

MIN_VERSION = (5, 1, 0)


def require_version(fail):
    """Stop with a message on a Blender older than the version these scripts were validated on."""
    if tuple(bpy.app.version) < MIN_VERSION:
        fail("these scripts need Blender %s or later; this is %s" % (".".join(map(str, MIN_VERSION)), bpy.app.version_string))


def gltf_rate(scene, fps):
    """Set the scene so Blender's glTF importer and exporter put key times on whole frames of fps. They convert with
    fps x fps_base (Blender's own playback rate is fps / fps_base), so a rate that is not whole, such as 29.97, needs
    fps_base = fps / round(fps)."""
    whole = max(1, int(round(fps)))
    scene.render.fps, scene.render.fps_base = whole, fps / whole


def playback_rate(scene, fps):
    """Set the scene so Blender plays (and its video encoder writes) fps frames per second: fps / fps_base."""
    whole = max(1, int(round(fps)))
    scene.render.fps, scene.render.fps_base = whole, whole / fps


def assign(ob, action):
    """Make `action` the object's only animation (no NLA tracks), with its first slot."""
    ad = ob.animation_data or ob.animation_data_create()
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    ad.action = action
    if action is not None and hasattr(ad, "action_slot") and ad.action_slot is None and len(getattr(action, "slots", [])):
        ad.action_slot = action.slots[0]


def to_gltf(v):
    """Blender's frame (Z up, front -Y) to glTF's (Y up, front +Z); +X is the character's left in both."""
    return (v[0], v[2], -v[1])


def to_blender(v):
    return Vector((v[0], -v[2], v[1]))


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


def even_frames(frames, count):
    """count frames spread evenly from the first to the last (both included)."""
    return sorted(set(int(round(x)) for x in np.linspace(0, frames - 1, max(2, min(count, frames)))))


def render_sheet(scene, out, frame0, picks, size, labels=None, name="clip-sheet"):
    """Render each picked frame (relative to frame0) and tile them, four to a row, into <out>/<name>.png; the tiles stay
    in <out>/<name>/. labels: text stamped on each tile beside its frame number."""
    width, height_px = size
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    tiles = []
    for n, f in enumerate(picks):
        if labels:
            scene.render.use_stamp_note = True
            scene.render.stamp_note_text = labels[n]
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
    sheet = os.path.join(out, name + ".png")
    img = bpy.data.images.new(name, columns * width, rows * height_px, alpha=False)
    img.pixels.foreach_set(canvas.reshape(-1)); img.filepath_raw = os.path.abspath(sheet); img.file_format = "PNG"; img.save()
    return sheet, columns


def render_video(scene, out, frame0, frames, fps, a):
    """(path, None) or (None, reason)."""
    if a.video == "none":
        return None, "not asked for (--video none)"
    path = os.path.join(out, "clip.mp4")
    scene.frame_start, scene.frame_end = frame0, frame0 + frames - 1
    playback_rate(scene, fps)
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
