"""Format conversion in an isolated Blender process; no retopology or UV edits.

blender --background --factory-startup --python-exit-code 1 \
  --python tools/jam/fbx-to-glb.py -- source.fbx destination.glb
"""
import sys
import json
from pathlib import Path
import bpy

source, destination, *options = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(Path(source).resolve()))
repairs = []
if '--opaque-untextured-materials' in options:
    # Some legacy FBX exports import fully opaque wood/skin as alpha zero.
    # This explicit opt-in repairs only unlinked constant-zero opacity;
    # texture-driven cutouts and other alpha values retain their source data.
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                alpha = node.inputs.get('Alpha')
                if alpha and not alpha.is_linked and alpha.default_value == 0:
                    alpha.default_value = 1
                    repairs.append(material.name)
Path(destination).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(Path(destination).resolve()), export_format='GLB')
print('CATALOG_ALPHA_REPAIRS=' + json.dumps(repairs))
