"""Write the animation-import fixtures. Runs in Blender (5.1 was used):

    blender --background --python-exit-code 1 --python make_clips.py -- <this folder>

A column skinned to a three-bone chain (root, hips, spine):
    mesh.glb   the skinned column, no animation: what a skinned import puts in the engine
    clip.glb   the same rig with one animation, Wave (spine turns 40 degrees and back, 30 frames at 30 fps)
    two.glb    the same rig with two animations, Bow (40 frames) and Wave
    wrong.glb  Wave on a rig whose spine bone is named chest: a skeleton the target lacks
"""
import math
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.15, depth=1.8, location=(0, 0, 0.9))
mesh = bpy.context.active_object
mesh.name = "Body"
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.subdivide(number_cuts=3)
bpy.ops.object.mode_set(mode="OBJECT")
data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
parent = None
for name, z0, z1 in (("root", 0.0, 0.05), ("hips", 0.05, 0.9), ("spine", 0.9, 1.8)):
    bone = data.edit_bones.new(name)
    bone.head, bone.tail = (0, 0, z0), (0, 0, z1)
    bone.parent = parent
    parent = bone
bpy.ops.object.mode_set(mode="OBJECT")
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def export(name, **options):
    bpy.ops.export_scene.gltf(filepath="%s/%s" % (out, name), export_format="GLB", export_skins=True, export_materials="NONE", **options)


def action(name, axis, degrees, last):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    bone = rig.pose.bones["spine"]
    bone.rotation_mode = "XYZ"
    for frame, angle in ((1, 0), (last // 2, degrees), (last, 0)):
        rotation = [0.0, 0.0, 0.0]
        rotation[axis] = math.radians(angle)
        bone.rotation_euler = rotation
        bone.keyframe_insert("rotation_euler", frame=frame)
    return act


export("mesh.glb", export_animations=False)
rig.animation_data_create()
action("Wave", 1, 40, 30)
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 30
export("clip.glb", export_animations=True, export_animation_mode="ACTIONS")
data.bones["spine"].name = "chest"
export("wrong.glb", export_animations=True, export_animation_mode="ACTIONS")
data.bones["chest"].name = "spine"
action("Bow", 0, 60, 40)
rig.animation_data.action = None
export("two.glb", export_animations=True, export_animation_mode="ACTIONS")
