"""Write the import fixtures. Runs in Blender (5.1 was used):

    blender --background --python-exit-code 1 --python make_fixtures.py -- <this folder>

    Crate.glb, Stool.glb   a box with one textured material named "Material" (its image named "Image") and a UCX_ hull
                           named for the box: two props whose own material and image names collide
    Hero.fbx               a column skinned to root, hips and spine, with material slots Skin and Cloth
    T_Rock_Color.png, T_Rock_Normal.png, T_Rock_ORM.png   8x8 texture maps
"""
import os
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def image(name, color, size=8):
    img = bpy.data.images.new(name, size, size)
    img.pixels = list(color) * (size * size)
    return img


reset()
for name, color in (("T_Rock_Color", (0.5, 0.4, 0.3, 1)), ("T_Rock_Normal", (0.5, 0.5, 1, 1)), ("T_Rock_ORM", (1, 0.6, 0, 1))):
    img = image(name, color)
    img.filepath_raw = os.path.join(out, name + ".png")
    img.file_format = "PNG"
    img.save()

for prop in ("Crate", "Stool"):
    reset()
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
    mesh = bpy.context.active_object
    mesh.name = prop
    img = image("Image", (0.8, 0.2, 0.1, 1))
    img.pack()
    material = bpy.data.materials.new("Material")
    material.use_nodes = True
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = img
    material.node_tree.links.new(texture.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    mesh.data.materials.append(material)
    bpy.ops.mesh.primitive_cube_add(size=1.02, location=(0, 0, 0.5))
    bpy.context.active_object.name = "UCX_" + prop
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, prop + ".glb"), export_format="GLB")

reset()
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.15, depth=1.8, location=(0, 0, 0.9))
body = bpy.context.active_object
body.name = "Body"
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.subdivide(number_cuts=3)
bpy.ops.object.mode_set(mode="OBJECT")
for slot in ("Skin", "Cloth"):
    body.data.materials.append(bpy.data.materials.new(slot))
for poly in body.data.polygons:
    poly.material_index = 1 if poly.center.z > 0 else 0   # the upper half, in the mesh's own space
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
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
bpy.ops.export_scene.fbx(filepath=os.path.join(out, "Hero.fbx"), object_types={"ARMATURE", "MESH"}, add_leaf_bones=False, bake_anim=False, armature_nodetype="NULL")
