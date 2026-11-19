"""Make the Unreal inventory test packages: run in the editor's Python commandlet. Writes /Game/Fixture and /FixtureKit.

The inputs are first copied into an Inputs/ folder of the project (for /Game) and of the plugin (for /FixtureKit), and
imported from there, so each imported asset records a path relative to its own package and no path of the machine
that made it: the engine stores a source outside the package's root relative to its own binaries."""
import os
import shutil
import unreal

INPUTS = os.environ.get("JAM_FIXTURE_INPUTS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "inputs")
PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
ROOTS = {"/Game": os.path.join(PROJECT, "Inputs"), "/FixtureKit": os.path.join(PROJECT, "Plugins", "FixtureKit", "Inputs")}
for folder in ROOTS.values():
    shutil.copytree(INPUTS, folder, dirs_exist_ok=True)
# Interchange's texture import stores the source's absolute path in its node ids; the classic texture factory stores
# only the relative one.
unreal.SystemLibrary.execute_console_command(None, "Interchange.FeatureFlags.Import.PNG 0")
tools = unreal.AssetToolsHelpers.get_asset_tools()
lib = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary


def imported(file, dest, name):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", os.path.join(ROOTS["/" + dest.split("/")[1]], file))
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", False)
    tools.import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths"))
    unreal.log("JAMFIX imported %s -> %s" % (file, paths))
    return paths


crate_tex = imported("T_Crate.png", "/Game/Fixture/Textures", "T_Crate")
icon_tex = imported("T_Icon.png", "/FixtureKit/Icons", "T_Icon")
mesh_paths = imported("SM_Crate.gltf", "/Game/Fixture/Meshes", "SM_Crate")

base = tools.create_asset("M_Base", "/Game/Fixture/Materials", unreal.Material, unreal.MaterialFactoryNew())
sample = mel.create_material_expression(base, unreal.MaterialExpressionTextureSampleParameter2D, -300, 0)
sample.set_editor_property("parameter_name", "Albedo")
sample.set_editor_property("texture", unreal.load_asset("/Engine/EngineResources/DefaultTexture"))
mel.connect_material_property(sample, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
try:
    mel.recompile_material(base)
except RuntimeError as e:  # 5.9 refuses without a renderer; the package does not need it
    unreal.log_warning("JAMFIX material not compiled: %s" % e)

mi = tools.create_asset("MI_Crate", "/Game/Fixture/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
mel.set_material_instance_parent(mi, base)
mel.set_material_instance_texture_parameter_value(mi, "Albedo", unreal.load_asset(crate_tex[0]))

mesh = None
for p in mesh_paths:
    a = unreal.load_asset(p)
    if isinstance(a, unreal.StaticMesh):
        mesh = a
if mesh is not None:
    mesh.set_material(0, mi)

label = tools.create_asset("PAL_Fixture", "/Game/Fixture", unreal.PrimaryAssetLabel, None)
if mesh is not None:
    label.set_editor_property("explicit_assets", [mesh])
rules = label.get_editor_property("rules")
rules.set_editor_property("priority", 3)
label.set_editor_property("rules", rules)

label.set_editor_property("label_assets_in_my_directory", True)
rules.set_editor_property("apply_recursively", False)
rules.set_editor_property("cook_rule", unreal.PrimaryAssetCookRule.ALWAYS_COOK)
label.set_editor_property("rules", rules)

factory = unreal.BlueprintFactory()
factory.set_editor_property("parent_class", unreal.Actor)
bp = tools.create_asset("BP_Crate", "/Game/Fixture/Blueprints", unreal.Blueprint, factory)
unreal.BlueprintEditorLibrary.compile_blueprint(bp)
crate_class = unreal.load_object(None, "/Game/Fixture/Blueprints/BP_Crate.BP_Crate_C")
label.set_editor_property("explicit_blueprints", [crate_class])

# A data asset whose class is a Blueprint with a variable of each kind the field reader decodes (DA_Fields), so the
# reader's values can be compared with the engine's (dump_fields.py).
bel = unreal.BlueprintEditorLibrary


def pin(text):
    t = unreal.EdGraphPinType()
    if not t.import_text(text):
        raise RuntimeError("pin type %s" % text)
    return t


def imported_text(kind, text):
    value = kind()
    if not value.import_text(text):
        raise RuntimeError("%s from %s" % (kind.__name__, text))
    return value


basic, struct_type, array, set_type, map_type = bel.get_basic_type_by_name, bel.get_struct_type, bel.get_array_type, bel.get_set_type, bel.get_map_type
arena = unreal.PrimaryAssetId(unreal.PrimaryAssetType("Map"), "Arena")
VARIABLES = [
    ("Flag", basic("bool"), True),
    ("Count", basic("int"), 42),
    ("Big", basic("int64"), 1 << 40),
    ("Ratio", basic("real"), 0.25),
    ("Label", basic("string"), "crate"),
    ("Id", basic("name"), unreal.Name("CrateId")),
    ("Title", basic("text"), unreal.Text("Crate of things")),
    ("Offset", struct_type(unreal.Vector.static_struct()), unreal.Vector(1.5, -2.0, 3.0)),
    ("Turn", struct_type(unreal.Rotator.static_struct()), unreal.Rotator(roll=30.0, pitch=10.0, yaw=20.0)),
    ("Tint", struct_type(unreal.LinearColor.static_struct()), unreal.LinearColor(0.25, 0.5, 0.75, 1.0)),
    ("Shade", struct_type(unreal.Color.static_struct()), unreal.Color(r=10, g=20, b=30, a=255)),
    ("Place", struct_type(unreal.Transform.static_struct()), unreal.Transform(unreal.Vector(1, 2, 3), unreal.Rotator(roll=0, pitch=0, yaw=90), unreal.Vector(2, 2, 2))),
    ("Mark", struct_type(unreal.Guid.static_struct()), unreal.GuidLibrary.new_guid()),
    ("Path", struct_type(unreal.SoftObjectPath.static_struct()), unreal.SoftObjectPath("/Game/Fixture/Textures/T_Crate.T_Crate")),
    ("Asset", struct_type(unreal.PrimaryAssetId.static_struct()), arena),
    ("Mesh", bel.get_object_reference_type(unreal.StaticMesh.static_class()), "MESH"),
    ("Look", bel.get_object_reference_type(unreal.MaterialInterface.static_class()), unreal.load_asset("/Game/Fixture/Materials/MI_Crate")),
    ("Kind", bel.get_class_reference_type(unreal.Actor.static_class()), unreal.StaticMeshActor.static_class()),
    ("Icon", pin('(PinCategory="softobject",PinSubCategoryObject="/Script/Engine.Texture2D")'), unreal.load_asset(icon_tex[0])),
    ("Spawn", pin('(PinCategory="softclass",PinSubCategoryObject="/Script/Engine.Actor")'), crate_class),
    ("Channel", pin('(PinCategory="byte",PinSubCategoryObject="/Script/Engine.ECollisionChannel")'), unreal.CollisionChannel.ECC_CAMERA),
    ("Attach", pin('(PinCategory="byte",PinSubCategoryObject="/Script/Engine.EAttachmentRule")'), unreal.AttachmentRule.KEEP_WORLD),
    ("Numbers", array(basic("int")), [3, 1, 2]),
    ("Names", set_type(basic("name")), {unreal.Name("beta"), unreal.Name("alpha")}),
    ("Scores", map_type(basic("string"), basic("int")), {"alpha": 1, "beta": 2}),
    ("Points", array(struct_type(unreal.Vector.static_struct())), [unreal.Vector(1, 0, 0), unreal.Vector(0, 1, 0)]),
    ("Meshes", array(bel.get_object_reference_type(unreal.StaticMesh.static_class())), ["MESH", None]),
    ("Spots", map_type(basic("name"), struct_type(unreal.Vector.static_struct())), {"door": unreal.Vector(4, 5, 6)}),
    ("Assets", array(struct_type(unreal.PrimaryAssetId.static_struct())), [arena, unreal.PrimaryAssetId(unreal.PrimaryAssetType("Item"), "Crate")]),
    ("Payload", struct_type(unreal.InstancedStruct.static_struct()), imported_text(unreal.InstancedStruct, "/Script/CoreUObject.Vector(X=1,Y=2,Z=3)")),
    ("Payloads", array(struct_type(unreal.InstancedStruct.static_struct())),
     [imported_text(unreal.InstancedStruct, "/Script/Engine.PrimaryAssetRules(Priority=4)"), unreal.InstancedStruct()]),
    ("Lod", struct_type(unreal.PerPlatformInt.static_struct()), imported_text(unreal.PerPlatformInt, '(Default=2,PerPlatform=(("Android", 1)))')),
    ("Fade", struct_type(unreal.PerPlatformFloat.static_struct()), imported_text(unreal.PerPlatformFloat, '(Default=0.5,PerPlatform=(("IOS", 0.25)))')),
    ("Cast", struct_type(unreal.PerPlatformBool.static_struct()), imported_text(unreal.PerPlatformBool, '(Default=True,PerPlatform=(("Android", False)))')),
    ("Rate", struct_type(unreal.PerPlatformFrameRate.static_struct()),
     imported_text(unreal.PerPlatformFrameRate, '(Default=(Numerator=30,Denominator=1),PerPlatform=(("Android", (Numerator=15,Denominator=1))))')),
    ("Caption", basic("text"), unreal.Text("{count} crates").format(count=3)),
    ("Shout", basic("text"), unreal.Text("crate").to_upper()),
    ("Share", basic("text"), unreal.Text.as_percent(0.25)),
    ("Note", basic("text"), "LOCALIZED"),
]
factory = unreal.BlueprintFactory()
factory.set_editor_property("parent_class", unreal.PrimaryDataAsset)
fields_class = tools.create_asset("BPD_Fields", "/Game/Fixture/Data", unreal.Blueprint, factory)
for name, kind, _ in VARIABLES:
    if not bel.add_member_variable(fields_class, name, kind):
        raise RuntimeError("variable %s" % name)
    bel.set_blueprint_variable_instance_editable(fields_class, name, True)
bel.compile_blueprint(fields_class)
data_factory = unreal.DataAssetFactory()
data_factory.set_editor_property("data_asset_class", bel.generated_class(fields_class))
data = tools.create_asset("DA_Fields", "/Game/Fixture/Data", bel.generated_class(fields_class), data_factory)
for name, _, value in VARIABLES:
    if isinstance(value, str) and value == "MESH":
        value = mesh
    elif isinstance(value, list):
        value = [mesh if isinstance(v, str) and v == "MESH" else v for v in value]
    if isinstance(value, str) and value == "LOCALIZED":  # a localized text (namespace, key, source), as the editor makes them
        unreal.TextLibrary.edit_text_property_source_string(data, name, "Handle with care")
        continue
    data.set_editor_property(name, value)


def blueprint(name, folder, parent):
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", parent)
    return tools.create_asset(name, folder, unreal.Blueprint, factory)


def variables(bp, declared, defaults):
    """Add instance-editable variables, compile, then set their defaults on the class default object."""
    for name, kind in declared:
        if not bel.add_member_variable(bp, name, kind):
            raise RuntimeError("variable %s" % name)
        bel.set_blueprint_variable_instance_editable(bp, name, True)
    bel.compile_blueprint(bp)
    defaults_object = unreal.get_default_object(bel.generated_class(bp))
    for name, value in defaults.items():
        defaults_object.set_editor_property(name, value)
    return bel.generated_class(bp)


# A class hierarchy for subclass matching and effective values: DA_Child sets only Damage; Weight comes from
# BPD_Child's defaults, Tag and Icon from BPD_Base's.
base_class = variables(blueprint("BPD_Base", "/Game/Fixture/Data", unreal.PrimaryDataAsset),
                       [("Weight", basic("real")), ("Tag", basic("name")), ("Icon", pin('(PinCategory="softobject",PinSubCategoryObject="/Script/Engine.Texture2D")'))],
                       {"Weight": 2.5, "Tag": unreal.Name("base"), "Icon": unreal.load_asset(icon_tex[0])})
child_class = variables(blueprint("BPD_Child", "/Game/Fixture/Data", base_class), [("Damage", basic("int"))], {"Damage": 7, "Weight": 4.0})
data_factory = unreal.DataAssetFactory()
data_factory.set_editor_property("data_asset_class", child_class)
tools.create_asset("DA_Child", "/Game/Fixture/Data", child_class, data_factory).set_editor_property("Damage", 9)

# Actors composed of components: construction-script components on BP_Pickup, an inherited one changed and one added
# on BP_PickupGold, and a native component's default changed on BP_Hero.
subobjects = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
handles = unreal.SubobjectDataBlueprintFunctionLibrary


def component(bp, parent, cls, name, values):
    handle, reason = subobjects.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=parent, new_class=cls, blueprint_context=bp))
    if not handles.is_handle_valid(handle):
        raise RuntimeError("component %s: %s" % (name, reason))
    subobjects.rename_subobject(handle, unreal.Text(name))
    template = handles.get_object_for_blueprint(handles.get_data(handle), bp)
    for key, value in values.items():
        template.set_editor_property(key, value)
    return handle


pickup = blueprint("BP_Pickup", "/Game/Fixture/Blueprints", unreal.Actor)
root = subobjects.k2_gather_subobject_data_for_blueprint(pickup)[0]
body = component(pickup, root, unreal.StaticMeshComponent, "Body", {"static_mesh": mesh})
component(pickup, body, unreal.SphereComponent, "Trigger", {"sphere_radius": 50.0})
bel.compile_blueprint(pickup)
gold = blueprint("BP_PickupGold", "/Game/Fixture/Blueprints", bel.generated_class(pickup))
gold_handles = subobjects.k2_gather_subobject_data_for_blueprint(gold)
for handle in gold_handles:
    data_of = handles.get_data(handle)
    if str(handles.get_variable_name(data_of)) == "Body":
        handles.get_object_for_blueprint(data_of, gold).set_editor_property("cast_shadow", False)
component(gold, gold_handles[0], unreal.PointLightComponent, "Glow", {"intensity": 1234.0})
bel.compile_blueprint(gold)
hero = blueprint("BP_Hero", "/Game/Fixture/Blueprints", unreal.Character)
bel.compile_blueprint(hero)
unreal.get_default_object(bel.generated_class(hero)).get_editor_property("character_movement").set_editor_property("max_walk_speed", 777.0)

# A level sequence whose shot metadata holds optionals: one set to false, one to 2, the rest unset.
shot = tools.create_asset("LS_Shot", "/Game/Fixture", unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
unreal.LevelSequenceShotMetaDataLibrary.set_is_no_good(shot, False)
unreal.LevelSequenceShotMetaDataLibrary.set_favorite_rating(shot, 2)
author = shot.find_meta_data_by_class(unreal.MovieSceneMetaData)
if author is not None:
    author.set_author("fixture")  # not the user name of the machine that made it

saved = [lib.save_directory("/Game/Fixture", only_if_is_dirty=False, recursive=True), lib.save_directory("/FixtureKit", only_if_is_dirty=False, recursive=True)]
unreal.log("JAMFIX saved %s" % saved)
