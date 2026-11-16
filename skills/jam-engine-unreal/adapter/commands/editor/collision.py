"""Measure how well each static mesh's simple collision covers its render mesh, and refit the ones it does not. Runs inside a live Unreal editor.

ARGS: {"mode": "measure" | "fit",
       "meshes": ["<static mesh id>", ...],
       "rule": {...}}      overrides of the coverage rule (jam_unreal/coverage.py)
"measure" reports coverage only. "fit" refits the meshes that fail it with the engine's convex decomposition (V-HACD,
the mesh editor's Auto Convex Collision) over the render mesh, so a shaft, a leg, an arm or a knot becomes its own thin
convex piece; it tries each hull count at each voxel budget until the mesh is covered, saves the best fit, and leaves
alone a mesh that is already covered or that no fit covers better. A few convex pieces per mesh, never per-triangle
collision. Coverage: the share of sampled render-mesh vertices within the cover distance of the simple collision.

A freshly fitted collision cooks over the next editor frames, so this script waits between frames with top-level
await: it cannot run in a commandlet.
"""
# jam: include coverage
import asyncio

import unreal


async def main(ARGS):
    rule = rule_with(ARGS.get('rule'))
    mode = ARGS.get('mode', 'measure')
    sme = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    def limit_for(mesh):
        box = mesh.get_bounding_box()
        size = max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
        return cover_cm(size, rule)

    def vertices(mesh):
        points = []
        for section in range(mesh.get_num_sections(0)):
            points += unreal.ProceduralMeshLibrary.get_section_from_static_mesh(mesh, 0, section)[0]
        stride = max(1, len(points) // rule['samples'])
        return points[::stride]

    def gaps(body, at, points, limit):
        distances = [body.get_closest_point_on_collision(at + p)[0] for p in points]
        return summarize(distances, [(p.x, p.y, p.z) for p in points], limit)

    async def measure(mesh):
        """Share of sampled vertices within the cover distance of the simple collision, the worst gap and where the gaps are."""
        at = unreal.Vector(0, 0, 100000)
        points = vertices(mesh)
        for attempt in range(20):
            # A freshly fitted collision cooks over the next frames; until then the body has none.
            actor = actors.spawn_actor_from_object(mesh, at)
            try:
                distance, _ = actor.static_mesh_component.get_closest_point_on_collision(at + points[0])
                if distance >= 0:
                    return gaps(actor.static_mesh_component, at, points, limit_for(mesh))
            finally:
                actor.destroy_actor()
            await asyncio.sleep(0.2)
        return {'covered': 0.0, 'worst': -1, 'note': 'no simple collision'}

    def shapes(mesh):
        geom = mesh.get_editor_property('body_setup').get_editor_property('agg_geom')
        return {k: len(geom.get_editor_property(k)) for k in ('box_elems', 'sphere_elems', 'sphyl_elems', 'convex_elems')
                if len(geom.get_editor_property(k))}

    report = []
    for path in ARGS['meshes']:
        mesh = unreal.load_asset(path)
        if not isinstance(mesh, unreal.StaticMesh):
            raise RuntimeError('not a static mesh: ' + path)
        entry = {'id': path.split('.')[0], 'mesh': path.split('.')[0].rsplit('/', 1)[-1], 'before': await measure(mesh), 'shapes': shapes(mesh)}
        if mode == 'fit' and not covered(entry['before'], rule):
            best, last = None, None
            for hulls in rule['hullCounts']:
                for voxels in rule['voxels']:
                    sme.set_convex_decomposition_collisions(mesh, hulls, rule['hullVertices'], voxels)
                    last = {'hulls': hulls, 'voxels': voxels, **(await measure(mesh))}
                    if not best or last['covered'] > best['covered']:
                        best = last
                    if covered(last, rule):
                        break
                if covered(last, rule):
                    break
            if best['covered'] <= entry['before']['covered']:
                # Nothing fitted closer than what it had: drop the edits and keep the saved collision.
                unreal.EditorLoadingAndSavingUtils.reload_packages([mesh.get_outermost()], unreal.ReloadPackagesInteractionMode.ASSUME_POSITIVE)
                entry['kept'] = True
            else:
                if best is not last:
                    # An earlier budget did best: fit it again (V-HACD gives the same hulls for the same input).
                    sme.set_convex_decomposition_collisions(mesh, best['hulls'], rule['hullVertices'], best['voxels'])
                unreal.EditorAssetLibrary.save_loaded_asset(mesh, False)
                entry['after'] = best
            mesh = unreal.load_asset(path)
            entry['shapes'] = shapes(mesh)
        report.append(entry)
        await asyncio.sleep(0)
    return {'report': report}
