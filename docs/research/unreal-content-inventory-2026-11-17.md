# Unreal content inventory for the content catalog

Research note, 2026-11-17. Scope: how a catalog that runs outside the Unreal Editor (Node/TypeScript, local web app + CLI) can derive a project's content from the project itself: assets, types, attributes, references, previews, source files, staleness, and later import ("promotion"). Target engine: **UE 5.8**.

**Sources and how to read the citations.**
- **Docs.** Epic's prose docs now default to 5.9. Links carrying `?application_version=5.8` were read at 5.8; links without it were read at 5.9 and are only probably true for 5.8. The Python API pages are labelled "Unreal Python 5.8 (Experimental)" unless the link says 5.7.
- **Engine source.** `EpicGames/UnrealEngine` links point at the `5.8` branch and open only for a GitHub account linked to Epic.
- **Observed.** Facts marked **Observed** come from this research on the test project. Directory listings and read-only header parsing were run against the main checkout `project A's client folder`, because the a worktree has no `Content/` at all. Nothing in either checkout was modified.
- **Inference.** Recommendations are labelled **Inference**.

`S` below abbreviates `https://github.com/EpicGames/UnrealEngine/blob/5.8/`.

## The test projects

Two private projects were used, read-only. They are called project A and project B here.

| Fact | Consequence for the catalog |
|---|---|
| **Project A** (UE 5.8, 4,108 packages, no maps) builds its Unreal content from its own data with an import script; the generated content is not committed. Its content truth is JSON data and a server-side schema. | Unreal is a derived view there. The project's own catalog plugin links its data to the engine assets made from it. |
| Project A has no DataAssets, DataTables, gameplay tag tables or Asset Manager configuration. Its classes are mostly material instances, textures, static meshes and animations. | It has no gameplay archetypes inside Unreal to classify. |
| Project A's gameplay links (item → icon, creature → loot) live in JSON and in C++ strings, which the Asset Registry cannot see (§1). | The project's plugin must read its own data for gameplay relationships. |
| Project A records, per build step, which inputs produced which assets. | A ready-made source ↔ asset map, more reliable than AssetImportData (§5). |
| **Project B** (UE 5.9, 1,198 packages, 11 maps, a content plugin) keeps its truth in Unreal: data assets of its own C++ classes (outfits, acoustic presets). | The engine-side reading is the catalog's source there. |

## What the jam Unreal adapter already does (do not rebuild)

- **Transport.** [`commands/jam_unreal/transport.py`](../../skills/jam-engine-unreal/adapter/commands/jam_unreal/transport.py) runs any editor script in one of three ways:
  - `commandlet`: `UnrealEditor-Cmd <uproject> -run=pythonscript -script=… -unattended -nosplash -nullrhi -stdout`;
  - `command`: the project's bridge to a running editor;
  - `handoff`: an agent runs the script itself.

  Each way returns the JSON that `main(ARGS)` produced. A catalog inventory command should reuse this transport rather than add another.
- **`references`.** [`editor/references.py`](../../skills/jam-engine-unreal/adapter/commands/editor/references.py) calls `get_referencers` with every `AssetRegistryDependencyOptions` flag set. It also calls `scan_paths_synchronous(['/Game'], True)`, which forces a rescan, on every call.
- **`inspect`.** [`editor/inspect_asset.py`](../../skills/jam-engine-unreal/adapter/commands/editor/inspect_asset.py) loads one asset and reports bounds, triangle and vertex counts, material slots, LODs, Nanite, collision, skeleton, bones, sound facts and texture facts.
- **Stored source.** `jam_stored_source` in [`editor_shared.py`](../../skills/jam-engine-unreal/adapter/commands/jam_unreal/editor_shared.py) reads `asset_import_data.extract_filenames()` and makes the first one project-relative.
- **`import`** ([`engine_import.py`](../../skills/jam-engine-unreal/adapter/commands/engine_import.py)) handles static, skinned, texture and audio imports.
- **`capture`** is `null` in [`adapter.json`](../../skills/jam-engine-unreal/adapter/adapter.json). No preview or capture command exists.
- **Missing:** whole-project inventory, a dependency graph dump, tag dumps, thumbnails and glTF export.

## 1. How the Asset Registry works

**FAssetData.** It holds "information about an asset that can be determined before it is loaded": object path, package name, asset name, class and `TagsAndValues` ([Asset Registry, 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-registry-in-unreal-engine?application_version=5.8)). In Python, `asset_class` is deprecated in favour of `asset_class_path` (e.g. `/Script/Engine.StaticMesh`), and `get_asset()` "loads the asset if it is unloaded" ([AssetData, py 5.7](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetData?application_version=5.7)).

**Where tags come from.**
- **Searchable properties.** "The Asset Registry only gathers properties that are marked with the `AssetRegistrySearchable` `UPROPERTY()` flag". This "requires assets to be resaved before their properties will be discovered" ([same page](https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-registry-in-unreal-engine?application_version=5.8)).
- **Class-supplied tags.** Other tags come from `GetAssetRegistryTags`. **Version-sensitive:** since 5.4 the override is `GetAssetRegistryTags(FAssetRegistryTagsContext)`; the `TArray<FAssetRegistryTag>&` overload carries `UE_DEPRECATED(5.4, …)` ([S/Engine/Source/Runtime/CoreUObject/Public/UObject/Object.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Public/UObject/Object.h), ~L891–893).
- **Stored in the package.** Tags are written into each editor-saved package. Non-cooked saves "store the assets in the package", and the summary keeps `AssetRegistryDataOffset` ([S/…/PackageFileSummary.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Public/UObject/PackageFileSummary.h); `WritePackageData` in [S/…/SavePackageUtilities.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Private/UObject/SavePackage/SavePackageUtilities.cpp)).

**Observed:** the tags are rich even with no custom code.

| Asset | Tags seen |
|---|---|
| Texture2D | `Dimensions`, `SRGB`, `CompressionSettings`, `LODGroup`, `Filter`, `AssetImportData` |
| StaticMesh | `Triangles`, `Vertices`, `LODs`, `Materials`, `NaniteEnabled`, `CollisionPrims`, `ApproxSize` |
| SkeletalMesh | `Skeleton`, `PhysicsAsset`, `Materials`, `Bones`, `MorphTargets` |
| MaterialInstanceConstant | `Parent` |
| Blueprint | `ParentClass`, `NativeParentClass`, `IsDataOnly`, `ImplementedInterfaces`, `BlueprintComponents`, `NativeComponents`, `FiBData` |
| AnimSequence | `Skeleton`, `SequenceLength`, `Number of Frames` |

**Dependency graph.** The registry's dependency types are:
- **Categories:** `UE::AssetRegistry::EDependencyCategory` is Package, Manage or SearchableName ([API 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/CoreUObject/UE__AssetRegistry__EDependencyCa-?application_version=5.8)).
- **Properties:** `EDependencyProperty` distinguishes Hard/Soft, Game/EditorOnly ("needed in the game as well as the editor") and Build for Package dependencies, and Direct and CookRule for Manage dependencies ([API 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/CoreUObject/UE__AssetRegistry__EDependencyPr-?application_version=5.8)).
- **Nodes:** `FAssetIdentifier` can name a package, a primary asset id, or an object/value name ([API 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/CoreUObject/FAssetIdentifier?application_version=5.8)).
- **GameplayTags** appear as searchable-name dependencies, not as tags. The Reference Viewer toggle reads "Show/Hide Searchable Names (i.e. Gameplay Tags)" ([UReferenceViewerSettings](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/AssetManagerEditor/UReferenceViewerSettings?application_version=5.8)).
- **On disk only.** Python `get_dependencies`/`get_referencers` return "On disk references ONLY" ([AssetRegistry, py 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetRegistry?application_version=5.8)).
- **Built from package headers.** `FPackageReader::ReadDependencyData` builds the edges from the import map (hard), the soft package reference list, searchable names, and per-import editor-only flags ([S/…/AssetRegistry/Private/PackageReader.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/AssetRegistry/Private/PackageReader.cpp), L1095ff). It follows that string paths in JSON, config or C++ are **invisible** to the registry, as the adapter's `references.py` already warns.

**Build and cache.**

| Context | Behaviour | Source |
|---|---|---|
| Editor | "gathers information about unloaded assets asynchronously"; `OnFilesLoaded` fires when done | [Asset Registry 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-registry-in-unreal-engine?application_version=5.8) |
| Commandlet | "gathers information synchronously instead"; "The LoadModule() call will block until the gather is complete" | same |
| Editor cache | 5.8 writes `Intermediate/CachedAssetRegistry/CachedAssetRegistry_<shard>_<id>.bin`, each with a `.ref` file holding the binary's name, written "via a temp file + rename". 5.4–5.7 wrote `Intermediate/CachedAssetRegistry_N.bin`. Old caches are discarded ("cache is too old to read; discarding"). Flags: `-NoAssetRegistryCache`, `-NoAssetRegistryCacheRead`, `-NoAssetRegistryCacheWrite`. | [S/…/AssetDataGatherer.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/AssetRegistry/Private/AssetDataGatherer.cpp) L201–212, L315–445, L6012 |
| Cooked | The cook writes `AssetRegistry.bin`. `FAssetRegistryGenerator::SaveAssetRegistry` writes the development copy to `Metadata/DevelopmentAssetRegistry.bin`, "used for DLC cooks, incremental cooks, and editor viewing". Writeback "happens during the stage phase". | [S/…/Commandlets/AssetRegistryGenerator.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Editor/UnrealEd/Private/Commandlets/AssetRegistryGenerator.cpp) ~L2031; [forum, UE_Seb.Tho](https://forums.unrealengine.com/t/audit-staged-compressed-size/2665462) |
| Format | `FAssetRegistryVersion` gains values every minor release: 5.8 added `TagSetMapSupports64BitStringNum` and `MemoryMappedTagDataStore` | [S/…/CoreUObject/Public/AssetRegistry/AssetData.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Public/AssetRegistry/AssetData.h) L108–109; [5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes?application_version=5.8) ("Asset registry cache will now memory-map its tag data storage") |

**Observed cost:**
- The cache is 121 MiB for 4,108 project packages. Engine and plugin content is gathered as well.
- The log reads "memory-mapped=no, platform unsupported" on the Mac.
- The cache **file name changes on every write**: three different `<id>` values appeared across runs.
- One editor start logged "AssetRegistryGather time 0.7225s … Wall time 10.3110s".
- A 5.8 Python commandlet on the Mac spent ~10 s in engine init before running the script (log open 01:04:34, "Executing Class …PythonScriptCommandlet" 01:04:44.8, exit 01:04:52).

**Primary assets.**
- "By default, only UWorld Assets (levels) are Primary", and the project setting "Primary Asset Types to Scan" registers more ([Asset Management](https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-management-in-unreal-engine?application_version=5.8)).
- `UPrimaryDataAsset` has "a working version of `GetPrimaryAssetId` that uses the Asset's short name and native class" (same page).
- `FPrimaryAssetTypeInfo` has `PrimaryAssetType`, `AssetBaseClass`, `bHasBlueprintClasses`, `bIsEditorOnly`, `Directories`, `SpecificAssets` and `Rules` ([S/…/Engine/Classes/Engine/AssetManagerTypes.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Engine/Classes/Engine/AssetManagerTypes.h) L137–178).
- `UPrimaryAssetLabel` is "A seed file that is created to mark referenced assets as part of this primary asset" ([S/…/PrimaryAssetLabel.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Engine/Classes/Engine/PrimaryAssetLabel.h)). Labels and rules create **Manage** dependencies.
- `PrimaryAssetType`/`PrimaryAssetName` are stored as registry tags ([FPrimaryAssetId](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/CoreUObject/FPrimaryAssetId?application_version=5.8)).
- Python has no `unreal.AssetManager` class. It offers `unreal.SystemLibrary.get_primary_asset_id_list` and related calls ([SystemLibrary, py 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary?application_version=5.8)).
- **Inference:** Primary Asset Types are the closest thing Unreal has to the catalog's archetypes in projects that use them. Project A does not use them.

## 2. Ways for an outside tool to get the data

| Route | Editor needed | Speed (project A) | Reliability / determinism | Platform | Verdict |
|---|---|---|---|---|---|
| **(a) Editor Python** via `-run=pythonscript` (headless, "does not load levels automatically", shuts down after the script) or `-ExecutePythonScript` (full editor, "once everything is loaded") ([Python scripting 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python?application_version=5.8)) | Yes: an engine install plus compiled project modules | ~10 s start plus the query | Authoritative: the engine's own reader and class knowledge | Win + Mac | **Authoritative refresh and CI.** The adapter already has this transport. |
| **(b) Commandlets.** Built-in: `UDumpAssetRegistryCommandlet` (`-run=DumpAssetRegistry`, no usage docs; [API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UDumpAssetRegistryCommandlet?application_version=5.8)), `UAssetRegistryDumpCommandlet` ([API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UAssetRegistryDumpCommandlet?application_version=5.8)), `DiffAssetRegistries`. Console: `AssetRegistry.DumpState`, `AssetManager.DumpAssetDependencies`, which "writes out a .graphviz file" ([console ref 5.8](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-console-commands-reference?application_version=5.8)). There is **no** `-run=AssetRegistryGenerator`: `FAssetRegistryGenerator` is a cooker helper class ([API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/FAssetRegistryGenerator?application_version=5.8)). Custom: a `UCommandlet::Main` in an editor module, resolved from `-run=Foo` ([UCommandlet](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UCommandlet?application_version=5.8)). | Yes, plus a C++ build for a custom one | Same as (a) | Dump output formats are undocumented | Win + Mac | A custom C++ commandlet only pays off for C++-only APIs (thumbnail render, see §4). Otherwise use (a). |
| **(c) Remote Control** (Beta; port 30010; `PUT /remote/search/assets` returns only `Name`, `Class`, `Path`; `object/call` can invoke function libraries) ([quick start](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-quick-start-for-unreal-engine?application_version=5.8), [HTTP ref](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-api-http-reference-for-unreal-engine?application_version=5.8)). **Unreal MCP** (new and Experimental in 5.8; `http://127.0.0.1:8000/mcp`; "There is no authentication layer"; toolsets `SceneTools`, `ActorTools`, `MaterialInstanceTools`, `ObjectTools`; no documented asset-registry tool) ([Unreal MCP 5.8](https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor?application_version=5.8)). Project A enables MCP and binds HTTP to 127.0.0.1 (**Observed:** `Config/DefaultEngine.ini`). | A running editor | Fast once running | Depends on editor state, including unsaved in-memory edits | Win + Mac | Only as the adapter's `command` transport when an editor is already open. It cannot be the data source for page loads. |
| **(d) Cooked `AssetRegistry.bin` / `DevelopmentAssetRegistry.bin`** | A cook | Fast to read | Exists only after a cook/stage. The format moves every release, and the editor cache is a private format that the engine discards across versions. CUE4Parse reads `FAssetRegistryState`, for cooked games. | Any | **Reject** as the primary source. It is stale relative to editing and version-fragile. |
| **(e) Offline header parse** of `.uasset` (summary, name/import/export maps, soft package refs, searchable names, the embedded tag block, the thumbnail table) | No | **Observed:** 4,108 packages, class plus all tags, in 0.25 s with a warm cache and 0 errors | Format has no public spec ("There isn't a file format specification for .uassets", [Sweeney, forum](https://forums.unrealengine.com/t/is-there-any-specification-for-the-uasset-file-format/279846)). UE5 object version: 5.6 = 1017, 5.7 = 5.8 = 1018 ([S/…/Core/Public/UObject/ObjectVersion.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Core/Public/UObject/ObjectVersion.h)); 5.9 freezes the enum at 1018 per the 5.9 header. **Observed:** project A packages are `FileVersionUE5` 1018, `LegacyFileVersion` −9, saved by 5.8.4. | Any (pure file reads) | **Fast path for every page load**, gated on known versions and verified against (a). |
| **(f) Editor plugin/subsystem** writing a JSON snapshot on `OnAssetsAdded`/`OnAssetRemoved`/`OnAssetRenamed`/`OnAssetUpdatedOnDisk`/`OnFilesLoaded` ([IAssetRegistry](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/AssetRegistry/IAssetRegistry?application_version=5.8)) and `UPackage::PackageSavedWithContextEvent` ([UPackage](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/CoreUObject/UPackage?application_version=5.8)). Handlers must be fast or they "slow down the gathering process". | An editor open while editing | Instant reads | Fresh only while the editor runs. Edits made by commandlets, VCS syncs or other machines are missed until the next editor start. | Win + Mac | Optional, for teams that live in the editor. **Not useful for project A**, whose content is made by commandlet. |

**Offline parser options.**

| Parser | License | Language | Uncooked editor packages | UE version claims |
|---|---|---|---|---|
| Epic's own `uassetparser.py`, which parses the summary, the tag block and the thumbnail cache ([S/Engine/Plugins/VirtualProduction/Switchboard/…/uassetparser.py](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Plugins/VirtualProduction/Switchboard/Source/Switchboard/switchboard/devices/unreal/uassetparser.py)) | Unreal Engine EULA: do **not** vendor into this public MIT repo | Python | Yes. `KNOWN_SUPPORTED_UE5VER = 1018` | 5.8. Used for every **Observed** result here. |
| [UAssetAPI](https://github.com/atenfyr/UAssetAPI) | MIT | C# | Yes: "cooked and uncooked .uasset files from ~4.13 to 5.7"; also reads tagged properties | 5.7 claimed; 5.8 not claimed |
| [CUE4Parse](https://github.com/FabianFG/CUE4Parse) | Apache-2.0 | C# | Targets cooked archives and packages; reads AssetRegistry.bin | UE5 cooked |
| FModel | GPL-3.0 | C# | Cooked | — |
| unreal_asset (Rust) | MIT | Rust | — | Object version tops out near 5.2 |
| npm packages | — | JS | Young, unevaluated | — |

**Tools built on these readers** (added after review; read from each product's own page on 2026-11-17):

| Tool | How it reads | UE versions | Integration | License |
|---|---|---|---|---|
| [AssetHoard](https://assethoard.com/unreal-asset-manager) | Its own parser, editor packages straight from disk; previews meshes, sprites and audio | "UE4.10 through UE5.5 parse fully. UE5.6 and newer do not parse yet" | Desktop app with drag-out and export. No CLI or API documented | Commercial, one-time purchase |
| [UE-Agent-Asset-Toolkit](https://github.com/bradenleague/UE-Agent-Asset-Toolkit) | C# on UAssetAPI (.NET 8), a Python index, served over MCP. Covers parent classes, references, inheritance and GameplayTag search, DataTable rows and material parameters | "tested against UE 5.5; newer versions may have unsupported formats" | MCP tools (`inspect_asset`), plus a CLI for its index. No documented JSON export | MIT. 16 stars, 4 commits, no releases |
| [Innerscene UASSET viewer](https://www.innerscene.com/tools/uasset-viewer) | Its own reader, in the browser | Draws UE 4.0–4.27 static meshes. UE5 packages are read, but their Oodle-compressed geometry is not decoded | Web page only | Not stated |
| [UE Viewer (UModel)](https://github.com/gildor2/UEViewer) | Its own reader, mainly for cooked games; exports meshes, animations and textures | "all engine versions (from 1 to 4)" | Command-line exporter | MIT |

All four confirm the risk above: every offline reader trails Epic's format changes. The UE5 object-version bump in 5.6 left AssetHoard unable to parse 5.6+. None claims 5.8. UE-Agent-Asset-Toolkit shows how far route (e) goes with UAssetAPI (parents, references, DataTable rows, material parameters). It is the reference to test against project A before writing our own reader.

**Approaches from UE-Agent-Asset-Toolkit's source** (commit `35a86e1`, 2026-02-28) that the sections above did not consider:
- **Exported property values without the engine.** It parses tagged properties from exports with UAssetAPI. That covers DataTable rows, material parameters, data-asset fields through per-class extractors, and "deep refs" (asset paths found inside property values). §3 says effective values need the engine, which is true for inherited and native defaults. But the values a package overrides, and *which property* holds each reference, can be read from the files.
- **C++ header parsing.** `knowledge_index/cpp_parser.py` reads `UCLASS`/`UFUNCTION`/`UPROPERTY` declarations, specifiers and parent classes with regular expressions. That gives the native class hierarchy and its fields without the engine.
- **Blueprint bytecode.** `BytecodeAnalyzer.cs` and `ControlFlowAnalyzer.cs` read Kismet bytecode to find what a Blueprint calls and spawns.
- **Project profiles.** `profiles/*.json` hold class reclassification, name-prefix rules (`GE_` → GameplayEffect), and which classes get custom extractors. This is the same idea as the catalog's per-project class → type mapping.
- **Incremental indexing** compares mtime and size per file (`indexer.py`), the same as §6.

The Reference Viewer page adds two more: **C++ Packages** references (an asset's imports of `/Script/<Module>`, which link content to native modules), and **Size Map** / **Audit Assets**, which give disk and memory sizes and a CSV export ([Reference Viewer](https://dev.epicgames.com/documentation/en-us/unreal-engine/reference-viewer-in-unreal-engine)).

**Inference: implementing the reader.** Write a small TypeScript reader limited to the summary, names, imports, exports, soft package references, searchable names, the tag block and the thumbnail table. Refuse any package whose `FileVersionUE5`/`LegacyFileVersion` or custom versions it has not been validated against, and mark those packages "needs editor refresh". Check it in CI by diffing its output against route (a) on the same checkout. Use Epic's script and UAssetAPI as format references; do not copy EULA code.

## 3. Data-driven attributes

| Want | From tags alone (offline or registry) | Needs loading or a full property parse |
|---|---|---|
| Asset class; Blueprint parent and native parent; interfaces; data-only flag; component counts | Yes. These are `FBlueprintTags`: `ParentClassPath`, `NativeParentClassPath`, `ImplementedInterfaces`, `IsDataOnly`, `NumBlueprintComponents`, … ([API 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/CoreUObject/FBlueprintTags?application_version=5.8)) | — |
| DataTable row struct | Yes: `RowStructure` ([S/…/Engine/Private/DataTable.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Engine/Private/DataTable.cpp) L356) | Row values |
| Primary asset type and name | Yes (tags) | — |
| Designer fields (damage, icon, mesh) on DataAssets or Blueprint defaults | Only if the field is `AssetRegistrySearchable` (and resaved) or the class adds it in `GetAssetRegistryTags` | Everything else |
| Which assets a DataAsset or Blueprint points to (icon, meshes) | Yes, as **edges** (imports and soft refs), but not *which property* holds them | The property → asset mapping |
| SCS components and inherited overrides (ICH) | Counts only | `SubobjectDataSubsystem.k2_gather_subobject_data_for_blueprint` ([py 5.7](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SubobjectDataSubsystem?application_version=5.7)); `UBlueprint::InheritableComponentHandler` "Stores data to override (in children classes) components" ([API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UBlueprint?application_version=5.8)) |
| Effective (inherited) values | No | `unreal.get_default_object(bp.generated_class())` ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/module/unreal?application_version=5.7)) |

**Why offline property parsing is not enough.** Editor packages use tagged property serialization, so a parser can read them. Unversioned properties are only "used for full cooks for distribution" (`bUnversioned`, PackageFileSummary.h). But each object serializes only the delta against its archetype: `UObject::SerializeScriptProperties` passes a `DiffObject` from `GetArchetype()` into `SerializeTaggedProperties` ([S/…/CoreUObject/Private/UObject/Obj.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Private/UObject/Obj.cpp) ~L2052–2094). Native defaults live in compiled C++, not in any package. Effective values therefore need the engine.

**Inference: archetype classification.** Classify by (1) registry class plus `NativeParentClass`/`ParentClass` chain, (2) primary asset type where used, and (3) a per-project mapping file in the catalog ("class X or path Y → archetype Weapon"). Read designer fields in the authoritative refresh (route a) by loading only the classes the mapping names: CDO plus subobject data, written into the snapshot. To make fields cheap for later projects, mark them `AssetRegistrySearchable` in C++, which costs a resave. In project A the archetypes come from `its data folder/catalogs/*.json`, not from Unreal.

## 4. Previews

**Embedded thumbnails.**
- Packages can carry a thumbnail table (`ThumbnailTableOffset`). `SaveThumbnails` writes it only when the package `HasThumbnailMap()` and is not editor-filtered ([SavePackageUtilities.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Private/UObject/SavePackage/SavePackageUtilities.cpp) L1264–1320).
- Images are stored compressed, preferring JPEG ("prefer JPEG except on images that are trivially tiny"). A negative stored height marks JPEG ([S/…/Core/Private/Misc/ObjectThumbnail.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Core/Private/Misc/ObjectThumbnail.cpp) L7, L60–73, L152–159). An offline reader can therefore lift them as image bytes with no editor.
- **Observed:** **0 of 4,108** project A packages carry thumbnails (`ThumbnailTableOffset: 0`). Packages saved by commandlets never got a thumbnail map.

**Rendering thumbnails.**
- Python has no thumbnail export. The only thumbnail class is the UMG `AssetThumbnailWidget` ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetThumbnailWidget)).
- C++ has `ThumbnailTools::RenderThumbnail`, `GenerateThumbnailForObjectToSaveToDisk`, `CacheThumbnail` and `LoadThumbnailsFromPackage` ([S/…/UnrealEd/Public/ObjectTools.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Editor/UnrealEd/Public/ObjectTools.h) L764–882).
- Rendering needs an RHI. Epic support suggests "-RenderOffscreen so the editor runs in headless mode (without -nullrhi)" plus `-AllowCommandletRendering` ([forum](https://forums.unrealengine.com/t/static-mesh-merging-requires-rhi/2731294)).
- The adapter's commandlet transport passes `-nullrhi`, so a preview step needs its own arguments.

**glTF/GLB.**
- `unreal.GLTFExporter.export_to_gltf(object, file_path, options, selected_actors)` supports `UMaterialInterface, UStaticMesh, USkeletalMesh, UWorld, UAnimSequence, ULevelSequence, ULevelVariantSets` and writes `.glb` ([py 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GLTFExporter)).
- Material baking "renders a specific Material input's full expression into a 2D texture" ([exporter behaviour](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-the-gltf-exporter-handles-unreal-engine-content)). The docs do not say it needs a GPU; inferred, unconfirmed. Disabling baking (`GLTFExportOptions`) avoids the question.
- Interchange export is "currently nonfunctional" ([Interchange](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-assets-using-interchange-in-unreal-engine)).

**Screenshots.**
- `unreal.RenderingLibrary.export_render_target` writes PNG/HDR ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/RenderingLibrary)).
- `AutomationLibrary.take_high_res_screenshot` returns a latent task that needs ticking ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AutomationLibrary)), so it does not fit the commandlet route.
- `-RenderOffscreen` on macOS has only a 2020 community report ([forum](https://forums.unrealengine.com/t/rendering-in-headless-mode-possible/475619)) and the local project A precedent.

**Inference.** The cheapest previews come from **source files**. Project A sources are `.glb` and `.png` under its art folder, which the web app can render directly with no editor. Use embedded thumbnails when present. Generate engine-side GLB and thumbnails only as a batch job on the Windows RTX host, cached by package `SavedHash`.

## 5. Source files

- **Storage.** `UAssetImportData` keeps `FAssetImportInfo` entries (`RelativeFilename`, `Timestamp`, `FileMD5`, `DisplayLabelName`) and stores them as the hidden `AssetImportData` registry tag in JSON ([S/…/Engine/Private/EditorFramework/AssetImportData.cpp](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Engine/Private/EditorFramework/AssetImportData.cpp) L49; `SourceFileTagName`, `TT_Hidden` in DataTable.cpp L351). The tag can be read offline (**Observed**).
- **Path rules.** `SanitizeImportFilename`, same file L311–349, picks one of three forms:
  1. relative to the *package file* when the source is inside the project, engine or plugin directories;
  2. relative to `DataSourceFolder` (an Editor Per-Project User Setting) when the source lies under it;
  3. otherwise `IFileManager::ConvertToRelativePath`, which makes it relative to the engine's binaries directory.

  `ResolveImportFilename` tries those three in the same order (L365–410).
- **Observed reliability in project A.**
  - 3,415 assets carry entries. 3,189 of them do not resolve relative to the package.
  - Sources in the data folder lie outside the project folder, so they were stored relative to the Mac engine install (a second engine install/Engine/Binaries/Mac`).
  - 614 point into another worktree (`…/orca/workspaces/project A/project A/faster-playable/…`), because a build was promoted from there (`Saved/build-promotion-imports.json`).
  - The `FileMD5` values remain usable.
- **Inference.** Match on **MD5 of the source bytes** and the file name, not on the stored path. Alternatively set `DataSourceFolder` to the repo root so paths are stored repo-relative (untested). For project A, prefer a build-inputs record and its generated manifests. Interchange imports use `UInterchangeAssetImportData` with `script_extract_filenames()` ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeAssetImportData)).

## 6. Change detection

| Signal | Cost | Strength |
|---|---|---|
| `stat` walk of `Content/**/*.uasset` (size, mtime) | ms for ~4k files | A fast path only. Checkouts, LFS smudges and copies rewrite mtimes. |
| Package `SavedHash`, "Hash of the Package's bytes when it was saved to disk" (FIoHash, 20 bytes, UE5 ≥ 1016; replaced `Guid`, which is gone from 5.6+ headers) ([PackageFileSummary.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/CoreUObject/Public/UObject/PackageFileSummary.h), [ObjectVersion.h](https://github.com/EpicGames/UnrealEngine/blob/5.8/Engine/Source/Runtime/Core/Public/UObject/ObjectVersion.h) `PACKAGE_SAVED_HASH`) | One header read per changed-mtime file | A content identity per package; the cache key for previews and snapshots |
| `git ls-files -s` / LFS pointer oid | One git call | Good where Content is tracked. Not in project A. |
| Source drift: `FileMD5` in `AssetImportData` vs current source hash | One hash per source | Marks "needs reimport" |
| Editor cache `.ref` name change | One stat | Shows only that some editor gathered. Private format: do not rely on it. |

**Inference.** The snapshot records the `{package → SavedHash}` set it was built from. A page load stats the tree, re-reads only the headers whose `(size, mtime)` changed, and labels the editor-derived fields stale when any `SavedHash` differs. Engine-version drift is detected from `SavedByEngineVersion` in the summary. Watching `Content/` is optional; a stat walk is cheap enough.

## 7. Writing ("promotion")

**Python import APIs.**
- `AssetImportTask` has `automated` ("Avoid dialogs"), `replace_existing`, `save` and `async_` ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetImportTask)). `AssetTools.import_asset_tasks` runs the tasks ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetTools)).
- Interchange: `InterchangeManager.import_asset` ("synchronous asset import process") with `ImportAssetParameters.is_automated` ([py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/InterchangeManager), [py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/ImportAssetParameters)).
- "Interchange does not save imported assets." Call `EditorAssetLibrary.save_asset`, which "Will try to checkout the file first" ([forum](https://forums.unrealengine.com/t/automated-raw-assets-import-into-unreal-engine/2730986), [py](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/EditorAssetLibrary)).

**Known limits.**
- Interchange-in-commandlet async bugs were acknowledged in 5.1 ([forum, UE_FlavienP](https://forums.unrealengine.com/t/interchange-with-python-in-an-unreal-commandlet/724404)).
- 5.6 changed game-thread task synchronization ([forum](https://forums.unrealengine.com/t/crash-on-interchange-when-calling-asset-import-tasks-from-an-editor-utility-blueprint/2657436)).
- The `ImportAssets` commandlet cannot pass Interchange settings through its JSON ([forum](https://forums.unrealengine.com/t/importassetscommandlet-fbx/2682264)).
- 5.8 "Ensure[s] the PythonScript commandlet enables source control prior to running the script" ([5.8 notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes?application_version=5.8)).

**Inference.** Promotion should call the adapter's existing `import` command, which already runs these imports in the commandlet. In project A, promotion means adding the file to its data folder and running the project's content build. The catalog should not write `/Game/Generated` directly.

## Recommended architecture

| Layer | Runs where | Editor | Output the catalog reads |
|---|---|---|---|
| **L0 header index** (new, in the catalog, TypeScript) | Catalog process, on page load or `catalog refresh` | No | In-memory index plus a machine-local cache under `.catalog/.local/facts/` (where the catalog already keeps measured facts): per package the class, tags, imports, soft refs, searchable names, `SavedHash`, size/mtime, embedded thumbnail bytes and `AssetImportData` |
| **L1 inventory snapshot** (new adapter command `inventory`, a Python editor script over the existing transport) | Commandlet on the dev machine or CI; or `command` transport into an open editor | Yes, headless `-nullrhi` | A versioned JSON written to the configured work directory (exact path open): full `FAssetData` and tags for chosen roots, dependency edges with category and properties, primary asset ids, the Blueprint parent chain to native, and CDO/subobject fields for mapped archetype classes. Stamped with engine version and the `{package → SavedHash}` set. |
| **L2 previews** (new adapter command, filling the `capture: null` slot) | Batch on the GPU host (Windows RTX; Mac `-RenderOffscreen` to be qualified) | Yes, with an RHI | `previews/<SavedHash>.{jpg,glb}` |
| **Project manifests** (project A-specific readers) | Catalog process | No | its data folder, its generated manifests, a build-inputs record |

**Inference.**
- The catalog never needs the editor to render a page. L0 answers "what exists, of what type, with which engine tags and references". L1 adds what only the engine knows and is labelled stale per package by `SavedHash`.
- L0 and L1 cross-check each other in CI, which keeps the offline reader honest across engine upgrades.
- An editor plugin (route f) and Remote Control or MCP stay optional.

## Limitations and unknowns

- **No public format.** Offline package parsing has no format spec or stability promise. 5.6 → 5.7 changed the UE5 object version (1017 → 1018), and the summary, tag-block and custom-version layouts can change with any release. 5.9 freezes the global version, but custom versions keep moving. Not verified: whether 5.9 packages parse with the 5.8 layout.
- **Tags vary by class.** Registry tags for a class depend on its `GetAssetRegistryTags` and its `AssetRegistrySearchable` fields. Designer fields are usually absent unless the project opts in, and a resave is required.
- **Invisible references.** Registry edges miss string references in JSON, config and C++. In project A these carry most gameplay relationships.
- **Effective values need the engine.** Property values are deltas against archetypes and native defaults, so only the engine (L1) can give effective values.
- **Unconfirmed:**
  - thumbnail rendering and glTF material baking under `-RenderOffscreen` on 5.8 (no Epic doc; macOS unverified);
  - glTF Exporter maturity status;
  - Interchange reliability in `-run=pythonscript` on 5.8;
  - output format of `DumpAssetRegistry`;
  - the effect of `DataSourceFolder` on stored paths, in practice;
  - Asset Audit CSV export (doc page did not load).
- **Doc versions.** Several Python pages were read only at 5.7 (`AssetData`, `AssetRegistryDependencyOptions`, `SubobjectDataSubsystem`, `get_default_object`). The C++ API pages render client-side; most claims are from the 5.8 source instead.
- **Header-scan timing.** The 0.25 s figure is warm-cache on the Mac. Cold-disk, Windows and larger-project timings were not measured.
- **Adapter version mismatch.** The adapter declares `"versions": "5.9"` while the test project is 5.8.
- **License.** Epic's `uassetparser.py` is EULA code. Use it as a reference, not as vendored code. This is not legal advice.

## Open questions for the user

1. **What should the catalog derive "content" from?** For project A, should it read its data folder (the real source) with Unreal as the derived view? Or should it treat the generated Unreal assets as the items? The answer decides whether Unreal is primary or an annotation layer.
2. **Is a hand-written TypeScript `.uasset` header reader acceptable,** given the format risk? It would be version-gated and CI-checked against the editor. The alternative is editor-only snapshots refreshed by a commandlet (~10 s start plus the query).
3. **Where should snapshots and previews live?** Options are gitignored under the project (`Saved/`), the catalog's own state directory, or committed. Which machine produces L1 and L2: the Windows RTX host only, or the Mac too?
4. **How should archetypes be defined?** For projects whose truth is in Unreal, should they come from a per-project mapping file (class or path → archetype) or from Primary Asset Types? Should we encourage `AssetRegistrySearchable` on key fields?
5. **Should "promotion" in project A mean editing its data folder and running the project's content build,** rather than importing into `/Game`?
6. **Should the adapter's commandlet transport gain a rendering profile** (`-RenderOffscreen -AllowCommandletRendering`) for previews, and should L2 be qualified on the Mac?
