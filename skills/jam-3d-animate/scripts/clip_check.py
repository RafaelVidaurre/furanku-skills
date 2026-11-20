"""Check an animation clip on the project rig against its clip spec. Runs in Blender,
from the project root (the spec's paths are project-relative).

    blender --background --python-exit-code 1 --python clip_check.py -- <clip.glb> <clip.json> <out-dir>
            [--measure-only] [--animation <name>] [--contact-height <m> --contact-speed <m/s>]
            [--travel <travel.json> | --travel-velocity <vx>,<vz>] [--provider-contacts <file>]
            [--loop-end auto|open|duplicate] [--sheet-frames 8] [--view side|front|three-quarter|back]
            [--size 320x400] [--video auto|none] [--ffmpeg <path>] [--engine workbench|cycles]

Measures the clip as stored, on whole frames of the spec's fps, in the glTF frame (metres, +Y up, front +Z):
whether the file holds one animation and the project rig's skeleton (bones, parents and rest), whether it is sampled
on every frame, its length, contacts detected from each foot's height and speed, slide over every detected and
declared contact, penetration, jumps at the first and last frames and between frames inside the clip, and the loop seam
when the spec loops. A foot's travel within the contact height on frames no contact holds (a low swing, a lift-off or
touch-down, or a slide faster than detection) is reported, not judged: a run of it longer than the slide threshold is
listed in `unjudged` for a person to judge from the sheet and video. Each measure is held against the
spec's `accept` thresholds; jumps inside the clip against `accept.boundaryJump`. Contact detection takes
`contacts.detect` from the spec, or --contact-height and --contact-speed. Contacts a provider returned are never used;
--provider-contacts stamps their file into the report beside the measured ones.

--measure-only reads no thresholds (the spec may have none yet) and judges nothing: the report holds the measures and
`passed` is null. Without detection numbers it then leaves the detected contacts unmeasured.

An in-place clip has had its travel removed, so its planted feet move backward with the ground. Give back the travel
for the contact measures with --travel (the travel.json root_convention.py wrote) or --travel-velocity (a constant
ground velocity, m/s, glTF x and z; 0,0 for a motion that never travelled). The check refuses an in-place clip without
one of them.

Writes clip-report.json, clip-sheet.png (stills over time; green markers on planted points, red where their window
failed, amber on a foot's travel at ground height that is for a person to judge) with its tiles in clip-sheet/, and clip.mp4 when an encoder is found (Blender's own, else ffmpeg);
otherwise the report says why there is no video. Exits 0 when every check passed (with --measure-only: when the clip
was measured), 1 when one failed or the clip could not be read.
"""
import argparse
import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jamanim  # noqa: E402
from jamanim import blend, gltf, measure, report, skelmap, spec as specs, travel as trav  # noqa: E402
from jamanim.blend import to_blender, to_gltf  # noqa: E402

# The clip's skeleton is the project rig's when every joint's rest lies within these of the rig's: far above the
# round-off of exporting the same rig again, far below any edit to it.
REST_POSITION = 1e-4       # metres
REST_LINEAR = 2e-4         # largest entry of the difference of the world rotation-and-scale matrices (about 0.01 degree)


def parse(argv):
    p = argparse.ArgumentParser(prog="clip_check.py", description=__doc__.split("\n\n")[0])
    p.add_argument("clip"); p.add_argument("spec"); p.add_argument("out")
    p.add_argument("--measure-only", action="store_true")
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


# ---- reading the clip ----------------------------------------------------------------------------------------------

def load_scene(clip, fps, animation):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    blend.gltf_rate(scene, fps)
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
    blend.assign(arm, action)
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


def main():
    a = parse(jamanim.script_args(sys.argv))
    blend.require_version(fail)
    judge = not a.measure_only
    try:
        s = specs.load(a.spec, thresholds=judge)
        smap = skelmap.load(s["rig"]["map"])
    except (specs.SpecError, skelmap.MapError, OSError) as e:
        fail("the clip spec is not usable: %s" % e)
    detect = s["contacts"]["detect"]
    detect_from = "clip spec contacts.detect"
    if a.contact_height is not None or a.contact_speed is not None:
        if a.contact_height is None or a.contact_speed is None:
            fail("give both --contact-height and --contact-speed")
        detect, detect_from = {"height": a.contact_height, "speed": a.contact_speed}, "--contact-height/--contact-speed"
    if detect is None and judge:
        fail("contact detection needs a height and a speed: set contacts.detect in the clip spec, or pass --contact-height <m> --contact-speed <m/s>")
    fps = float(s["fps"])
    os.makedirs(a.out, exist_ok=True)

    # the file itself: animations, key times, skeleton and its rest
    try:
        g = gltf.Gltf(a.clip)
        _, anim = g.animation(a.animation)
        names = g.animation_names()
        name = anim.get("name") or a.animation
        times = g.key_times(name)
        sampled = gltf.sampling(g, fps, name)
        clip_skeleton = g.skeleton()
        rig = gltf.Gltf(s["rig"]["model"])
        rig_skeleton = rig.skeleton()
    except (gltf.GltfError, OSError) as e:
        fail(str(e))
    first, last = int(round(times[0] * fps)), int(round(times[-1] * fps))
    frames = last - first + 1
    if frames < 4:
        fail("the clip has %d frames at %s fps; the check needs at least 4" % (frames, fps))
    clip_bones, rig_bones = dict(clip_skeleton), dict(rig_skeleton)
    rig_match = {"missing": sorted(set(rig_bones) - set(clip_bones)), "extra": sorted(set(clip_bones) - set(rig_bones)),
                 "reparented": sorted(b for b in rig_bones if b in clip_bones and clip_bones[b] != rig_bones[b])}
    rest = gltf.rest_difference(g, rig, [b for b in rig_bones if b in clip_bones])
    rest_ok = rest["position"] <= REST_POSITION and rest["linear"] <= REST_LINEAR
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

    # contacts: detected windows, windows the spec declares, and travel at ground height outside both
    windows = measure.contact_windows(contact_pts, fps, detect, ground if flat else None, rest_heights, depth) if detect else []
    declared = measure.declared_slides(contact_pts, s["contacts"]["planted"], fps, frames)
    coverage = measure.coverage(s["contacts"]["planted"], windows, fps, frames) if detect else [None] * len(declared)
    expected = [dict(d, detectedShare=c["detectedShare"] if c else None) for d, c in zip(declared, coverage)]
    grounded = measure.grounded_runs(contact_pts, fps, detect, ground, rest_heights, windows, declared) if detect and flat else []

    # boundaries, jumps inside the clip, seam
    b = measure.boundary_jumps(pos)
    boundary = {end: dict(worst=measure.worst(b[end][0], labels, b[end][1], b["baseline"]), bones=measure.per_bone(b[end][0], labels))
                for end in ("start", "end")}
    boundary["smooth"] = measure.roughest(b["baseline"], labels)
    boundary["interior"] = measure.worst_step(b["steps"], labels) if frames >= measure.STEP_FRAMES else None
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
                "relativeTo": relative_to, "worst": measure.worst(both[mine][0], labels, both[mine][1], both["baseline"]),
                "bones": measure.per_bone(both[mine][0], labels),
                "other": {"convention": other, "worst": measure.worst(both[other][0], labels, both[other][1], both["baseline"])}}

    # measures, then verdicts against the spec's thresholds
    slides = [("detected", w["slide"]) for w in windows] + [("declared", e["slide"]) for e in expected if e["slide"] is not None]
    measures = {"footSlide": max((v for _, v in slides), default=None),
                "penetration": max((float(d.max()) for d in depth.values()), default=0.0) if flat else None,
                "boundaryJump": max(boundary["start"]["worst"]["jump"], boundary["end"]["worst"]["jump"]),
                "interiorJump": boundary["interior"]["jump"] if boundary["interior"] else None}
    why = {"footSlide": ("no contact was detected or declared; see the sheet, or the detection numbers" if detect
                         else "no detection numbers were given and no contact is declared"),
           "interiorJump": "the clip has fewer than %d frames, so no step lies inside it" % measure.STEP_FRAMES,
           "penetration": "the ground is not flat (%s); judge penetration from the sheet and video" % s["ground"]["description"]}
    if s["loop"]:
        measures["loopSeam"] = seam["worst"]["jump"]
    acc = s["accept"]
    accept = None
    if judge:
        threshold_of = dict(acc, interiorJump=acc["boundaryJump"])
        accept = {k: measure.judge(k, v, threshold_of[k], why.get(k)) for k, v in measures.items()}
        for w in windows:
            w["passed"] = w["slide"] <= acc["footSlide"] + 1e-12 and ("penetration" not in w or w["penetration"] <= acc["penetration"] + 1e-12)
        for e in expected:
            e["passed"] = None if e["slide"] is None else e["slide"] <= acc["footSlide"] + 1e-12
        for r in grounded:
            r["toJudge"] = r["travel"] > acc["footSlide"] + 1e-12
    duration = (frames - 1) / fps
    lengths = [duration] + ([frames / fps] if s["loop"] else [])
    half = 0.5 / fps
    checks = {"animations": {"passed": len(names) == 1, "names": names, "measured": name},
              "skeleton": {"passed": not any(rig_match.values()) and rest_ok, **rig_match,
                           "rest": {"position": report.mm(rest["position"]), "positionBone": rest["positionBone"],
                                    "linear": round(rest["linear"], 6), "linearBone": rest["linearBone"],
                                    "tolerance": {"position": REST_POSITION, "linear": REST_LINEAR}}},
              "wholeFrames": sampled,
              "length": {"passed": any(s["length"]["min"] - half <= L <= s["length"]["max"] + half for L in lengths),
                         "seconds": round(duration, 4), "loopCycleSeconds": round(frames / fps, 4) if s["loop"] else None,
                         "wanted": s["length"]}}
    unmeasured = [k for k, v in measures.items() if v is None]
    unjudged = (["groundTravel"] if any(r["toJudge"] for r in grounded) else []) if judge else None
    if judge:
        failures = [k for k, v in checks.items() if not v["passed"]] + [k for k, v in accept.items() if v["passed"] is False]
        passed = not failures
    else:
        failures, passed = None, None

    hips_k = labels.index((at["hips"], "head"))
    hips_g = pos[:, hips_k]
    root_facts = {"mode": s["root"]["mode"], "bone": s["root"]["bone"],
                  "hipsNetTravel": report.mm(np.linalg.norm(hips_g[-1, [0, 2]] - hips_g[0, [0, 2]])),
                  "hipsHeightRange": report.mm(hips_g[:, 1].max() - hips_g[:, 1].min())}
    if s["root"]["bone"] and s["root"]["bone"] in clip_bones:
        rk = labels.index((s["root"]["bone"], "head"))
        root_facts["rootNetTravel"] = report.mm(np.linalg.norm(pos[-1, rk, [0, 2]] - pos[0, rk, [0, 2]]))

    # evidence: planted points green, red where their window failed, amber where a foot's travel at ground height is to judge
    hips_track = [(to_blender(p).x, to_blender(p).y) for p in hips_g]
    allx = [to_blender(p).x for p in pos.reshape(-1, 3)]; ally = [to_blender(p).y for p in pos.reshape(-1, 3)]
    markers = blend.add_markers(scene, keys, fig_height)
    state = {k: [None] * frames for k in keys}
    for run in windows:
        k = next(k for k in keys if k[1] == run["point"])
        for f in range(run["from"], run["to"] + 1):
            ok = run.get("passed", True) is not False
            state[k][f] = ok if state[k][f] is None else (state[k][f] and ok)
    for run in grounded:
        if run.get("toJudge"):
            for k in (k for k in keys if k[0] == run["limb"]):
                for f in range(run["from"], run["to"] + 1):
                    state[k][f] = "judge"
    size = blend.stage(scene, hips_track, ground, fig_height, float(pos[..., 1].max()), ((min(allx), min(ally)), (max(allx), max(ally))), a, frames, frame0, markers)
    blend.key_markers(markers, pts, state, frame0, frames, blend.VIEWS[a.view].normalized() * fig_height * 0.3)
    picks = blend.even_frames(frames, a.sheet_frames)
    sheet, columns = blend.render_sheet(scene, a.out, frame0, picks, size)
    video, why_no_video = blend.render_video(scene, a.out, frame0, frames, fps, a)

    doc = {"tool": "jam-3d-animate clip_check.py " + jamanim.VERSION, "blender": bpy.app.version_string, "measureOnly": not judge,
           "clip": report.stamp("clip", a.clip), "spec": report.stamp("spec", a.spec), "animation": name,
           "rig": {"model": report.stamp("rig", s["rig"]["model"]), "map": report.stamp("map", s["rig"]["map"])},
           "frame": {"units": "meters", "up": "+Y", "front": "+Z"},
           "fps": fps, "frames": frames, "seconds": round(duration, 4), "loop": s["loop"],
           "ground": {"kind": s["ground"]["kind"], "description": s["ground"]["description"], "height": report.mm(ground), "from": ground_from},
           "detect": dict(detect, **{"from": detect_from}) if detect else None,
           "restHeights": {k: report.mm(v) for k, v in rest_heights.items()},
           "penetrationMeasuredOn": "foot mesh vertices" if soles else "foot joints at their rest height",
           "travelAddedForContacts": travel_note,
           "contacts": windows if detect else None,
           "grounded": grounded if detect and flat else None,
           "feet": {limb: {"penetration": report.mm(depth[limb].max()), "frame": int(np.argmax(depth[limb]))} for limb in depth} if depth else None,
           "expectedContacts": expected,
           "providerContacts": dict(report.stamp("provider-contacts", a.provider_contacts), note="reported beside the measured contacts; not used")
           if a.provider_contacts else None,
           "boundary": boundary, "seam": seam, "root": root_facts,
           "checks": checks, "measures": {k: (None if v is None else report.mm(v)) for k, v in measures.items()},
           "accept": accept, "failures": failures, "unmeasured": unmeasured, "unjudged": unjudged, "passed": passed,
           "evidence": {"sheet": dict(report.stamp("sheet", sheet), frames=picks, columns=columns, view=a.view),
                        "video": report.stamp("video", video) if video else {"skipped": why_no_video}}}
    out_report = os.path.join(a.out, "clip-report.json")
    report.write(out_report, doc)
    print(json.dumps({"report": out_report.replace(os.sep, "/"), "passed": passed, "failures": failures, "unmeasured": unmeasured, "unjudged": unjudged,
                      "sheet": sheet.replace(os.sep, "/"), "video": video.replace(os.sep, "/") if video else None,
                      "measures": doc["measures"]}))
    sys.exit(0 if passed is not False else 1)


if __name__ == "__main__":
    main()
