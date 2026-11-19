"""Write what the engine's Asset Registry says about the fixture packages: classes, named tags, hard and soft package
dependencies, in the shape editor/inventory.py reports. The adapter's tests compare the package reader with this file."""
import json, os
import unreal
OUT = os.environ["JAM_FIXTURE_DUMP"]
TAGS = json.loads(os.environ["JAM_FIXTURE_TAGS"])
ar = unreal.AssetRegistryHelpers.get_asset_registry()
opt = lambda hard, soft: unreal.AssetRegistryDependencyOptions(include_soft_package_references=soft, include_hard_package_references=hard,
    include_searchable_names=False, include_soft_management_references=False, include_hard_management_references=False)
ar.scan_paths_synchronous(["/Game/Fixture", "/FixtureKit"], True)
packages = {}
for root in ("/Game/Fixture", "/FixtureKit"):
    for a in ar.get_assets_by_path(root, recursive=True, include_only_on_disk_assets=True):
        pkg = str(a.package_name)
        entry = packages.setdefault(pkg, {"assets": [], "hard": sorted(str(d) for d in ar.get_dependencies(pkg, opt(True, False)) or []),
                                          "soft": sorted(str(d) for d in ar.get_dependencies(pkg, opt(False, True)) or [])})
        tags = {}
        for t in TAGS:
            v = unreal.AssetRegistryHelpers.get_tag_value(a, t)
            if v is not None:
                tags[t] = str(v)
        entry["assets"].append({"id": "%s.%s" % (pkg, a.asset_name), "class": a.asset_class_path.export_text(), "tags": tags})
with open(OUT, "w") as f:
    json.dump({"engine": unreal.SystemLibrary.get_engine_version(), "packages": packages}, f, indent=1, sort_keys=True)
