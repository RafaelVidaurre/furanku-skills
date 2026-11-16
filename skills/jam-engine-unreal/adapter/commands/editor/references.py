"""List what refers to each asset, and optionally delete the assets nothing else refers to. Runs inside the Unreal editor.

ARGS: {"assets": ["<asset id>", ...], "delete": false}
Every reference type the asset registry knows is counted: hard, soft, game, editor-only, searchable names and
management references. References among the listed assets themselves do not block deleting them together.
The engine's delete is a force-delete, so with "delete" the script stops before deleting anything when any listed
asset is still referenced from outside the list. References held as strings in native code or config files are
invisible to the registry: search the project's source and config for the asset's name before deleting.
"""
import unreal


def main(ARGS):
    packages = [a.split('.')[0] for a in ARGS['assets']]
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(['/Game'], True)
    options = unreal.AssetRegistryDependencyOptions()
    for field in ['include_soft_package_references', 'include_hard_package_references', 'include_game_package_references', 'include_editor_only_package_references', 'include_searchable_names', 'include_soft_management_references', 'include_hard_management_references']:
        options.set_editor_property(field, True)
    selected = set(packages)
    references = []
    blocked = {}
    for package in packages:
        if not unreal.EditorAssetLibrary.does_asset_exist(package):
            raise RuntimeError('asset not found: ' + package)
        refs = sorted(str(ref) for ref in (registry.get_referencers(package, options) or []))
        references.append({'id': package, 'referencers': refs})
        outside = [ref for ref in refs if ref not in selected]
        if outside:
            blocked[package] = outside
    out = {'references': references}
    if ARGS.get('delete'):
        if blocked:
            raise RuntimeError('Assets still referenced: ' + str(blocked))
        out['deleted'] = [{'id': package, 'native': unreal.EditorAssetLibrary.delete_asset(package)} for package in packages]
    return out
