"""Blender side of pack and unpack: import a glTF rig, read its rest and posed joints in the glTF frame, key poses on it,
export it. Imported only inside Blender."""
import bpy
from mathutils import Quaternion, Vector

from . import math3d as m

FPS = 30


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps, scene.render.fps_base = FPS, 1.0
    return scene


def _xyzw(q):
    return (q.x, q.y, q.z, q.w)


def _blender_q(q):
    return Quaternion((q[3], q[0], q[1], q[2]))


def import_armature(path, joints):
    """Import a .glb/.gltf and return the armature whose bones match the most of `joints`."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o not in before and o.type == "ARMATURE"]
    wanted = set(joints)
    best = max(arms, key=lambda a: len(wanted & set(a.data.bones.keys())), default=None)
    if best is None or not wanted & set(best.data.bones.keys()):
        raise ValueError(f"{path} holds no armature with SOMA joint names")
    return best


def rest_world(arm):
    """name -> (position, rotation) of every bone's rest, glTF frame."""
    out = {}
    for b in arm.data.bones:
        mat = arm.matrix_world @ b.matrix_local
        out[b.name] = (m.vec_to_gltf(tuple(mat.translation)), m.rot_to_gltf(_xyzw(mat.to_quaternion())))
    return out


def pose_world(arm):
    """name -> (position, rotation) of every bone in the current evaluated pose, glTF frame."""
    out = {}
    for pb in arm.pose.bones:
        mat = arm.matrix_world @ pb.matrix
        out[pb.name] = (m.vec_to_gltf(tuple(mat.translation)), m.rot_to_gltf(_xyzw(mat.to_quaternion())))
    return out


def animation(arm, name=None):
    """The armature's action (by name when given) and its frame range."""
    if name:
        action = bpy.data.actions.get(name) or next((a for a in bpy.data.actions if a.name.startswith(name)), None)
        if action is None:
            raise ValueError(f"no animation named {name}; found: {', '.join(a.name for a in bpy.data.actions) or 'none'}")
        arm.animation_data_create().action = action
        if hasattr(arm.animation_data, "action_slot") and getattr(action, "slots", None):
            arm.animation_data.action_slot = action.slots[0]
    ad = arm.animation_data
    if not ad or not ad.action:
        raise ValueError("the file holds no animation on its armature")
    start, end = ad.action.frame_range
    return ad.action.name, float(start), float(end)


def sample(arm, frame):
    """Evaluate the scene at a (fractional) frame and return pose_world()."""
    whole = int(frame // 1)
    bpy.context.scene.frame_set(whole, subframe=frame - whole)
    return pose_world(arm)


def _hierarchy(arm):
    order, seen = [], set()

    def visit(b):
        order.append(b)
        seen.add(b.name)
        for c in b.children:
            visit(c)
    for b in arm.data.bones:
        if b.parent is None:
            visit(b)
    return order


def key_poses(arm, frames, action_name, first_frame=0):
    """Key one pose per frame. Each frame maps bone name -> (world position, world rotation from the bone's rest),
    glTF frame, as soma.unpack_pose() returns them. Bones absent from a frame keep their rest relative to the parent."""
    arm.animation_data_create()
    action = bpy.data.actions.new(action_name)
    arm.animation_data.action = action
    A = arm.matrix_world
    A_inv = A.inverted()
    order = _hierarchy(arm)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    previous = {}
    for k, frame in enumerate(frames):
        posed = {}
        for b in order:
            pb = arm.pose.bones[b.name]
            if b.name in frame:
                pos, delta = frame[b.name]
                rest = A @ b.matrix_local
                rs = _blender_q(m.rot_to_blender(delta)).to_matrix() @ rest.to_3x3()
                world = rs.to_4x4()
                world.translation = Vector(m.vec_to_blender(pos))
                pa = A_inv @ world
            elif b.parent is not None:
                pa = posed[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local)
            else:
                pa = b.matrix_local.copy()
            posed[b.name] = pa
            if b.parent is None:
                basis = b.matrix_local.inverted() @ pa
            else:
                rel = b.parent.matrix_local.inverted() @ b.matrix_local
                basis = rel.inverted() @ (posed[b.parent.name].inverted() @ pa)
            loc, rot, _ = basis.decompose()
            if b.name in previous:
                rot.make_compatible(previous[b.name])
            previous[b.name] = rot
            pb.location, pb.rotation_quaternion = loc, rot
            pb.keyframe_insert("location", frame=first_frame + k)
            pb.keyframe_insert("rotation_quaternion", frame=first_frame + k)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = first_frame, first_frame + len(frames) - 1
    return action


def export_glb(path, animations=True):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_animations=animations,
                              export_force_sampling=True, export_yup=True)
