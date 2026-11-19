"""What the Asset Registry holds for packages: their assets' classes, named tags, and hard and soft package
dependencies. Runs inside the Unreal editor, for the inventory's engine fallback and its conformance check.

ARGS: {"roots": ["/Game", ...], "packages": ["<package id>", ...] | null, "tags": {"<asset id>": ["<tag>", ...]}}
With packages null every package under the roots is reported. Python cannot list an asset's tags, so only the tags
named per asset are read. Blueprint generated classes are hidden by the registry and do not appear. `classLoaded` says
whether a code class could be loaded; when it could not, the registry holds no dependencies for that package.
"""
import unreal


def main(ARGS):
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(list(ARGS["roots"]), True)
    hard = unreal.AssetRegistryDependencyOptions(include_soft_package_references=False, include_hard_package_references=True,
                                                 include_searchable_names=False, include_soft_management_references=False,
                                                 include_hard_management_references=False)
    soft = unreal.AssetRegistryDependencyOptions(include_soft_package_references=True, include_hard_package_references=False,
                                                 include_searchable_names=False, include_soft_management_references=False,
                                                 include_hard_management_references=False)
    wanted = set(ARGS["packages"]) if ARGS.get("packages") is not None else None
    named_tags = ARGS.get("tags") or {}
    packages = {}
    for root in ARGS["roots"]:
        for data in registry.get_assets_by_path(root, recursive=True, include_only_on_disk_assets=True):
            package = str(data.package_name)
            if wanted is not None and package not in wanted:
                continue
            entry = packages.get(package)
            if entry is None:
                entry = packages[package] = {
                    "assets": [],
                    "hard": sorted(str(d) for d in registry.get_dependencies(package, hard) or []),
                    "soft": sorted(str(d) for d in registry.get_dependencies(package, soft) or []),
                }
            asset_id = "%s.%s" % (package, data.asset_name)
            tags = {}
            for tag in named_tags.get(asset_id, []):
                value = unreal.AssetRegistryHelpers.get_tag_value(data, tag)
                if value is not None:
                    tags[tag] = str(value)
            cls = data.asset_class_path.export_text()
            item = {"id": asset_id, "class": cls, "tags": tags}
            if cls.startswith("/Script/"):
                # A code class the editor could not load (a stale or missing module build): the registry then
                # records no dependencies for the package.
                item["classLoaded"] = unreal.find_object(None, cls) is not None
            entry["assets"].append(item)
    return {"engine": unreal.SystemLibrary.get_engine_version(), "packages": packages}
