"""Report how much each edge of every part stretches between the mesh as modelled (the rig-fit pose) and Manny's bind pose.
blender --background --python edge_stretch.py -- <character-rig-fit-pose.blend> <character-rigged.blend>
Edges stretched more than 2x mean the skin tears when the arms and hands are posed."""
import bpy, sys
a, b = sys.argv[-2:]
def load(path):
    bpy.ops.wm.open_mainfile(filepath=path); cos, edges, groups = [], [], []
    for o in sorted((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: o.name):
        base = len(cos)
        cos += [v.co.copy() for v in o.data.vertices]; edges += [(base + e.vertices[0], base + e.vertices[1]) for e in o.data.edges]
        groups += [[(o.name, o.vertex_groups[g.group].name, round(g.weight, 2)) for g in v.groups] for v in o.data.vertices]
    return cos, edges, groups
c0, edges, _ = load(a); c1, _, groups = load(b)
rows = []
for i, j in edges:
    l0 = (c0[i] - c0[j]).length; l1 = (c1[i] - c1[j]).length
    if l0 > 1e-6: rows.append((l1 / l0, i, j))
rows.sort(reverse=True)
print("edges stretched >2x:", sum(1 for r in rows if r[0] > 2), " >1.5x:", sum(1 for r in rows if r[0] > 1.5), "of", len(rows))
for r, i, j in rows[:14]: print(round(r, 2), [round(x, 3) for x in c0[i]], groups[i], "|", groups[j])
