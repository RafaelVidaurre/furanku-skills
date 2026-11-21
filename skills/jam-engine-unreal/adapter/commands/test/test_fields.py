"""Property values (`assets[].fields`, `components`) read from export data, against what the engine holds for the same
objects; subclasses selected through the parent chain; effective values from the engine, replayed.

fixtures/inventory/<engine version>/fields.json is the engine's view of what the reader finds: each leaf path read with
get_editor_property in that engine's editor. effective.json is what that editor's editor/fields.py reported for
ENGINE_FIELDS (record_effective.py). After make_fixtures.py (see test_inventory.py), in the same folder:

    JAM_FIXTURE_DUMP=<folder>/fields.json JAM_FIXTURE_FIELDS="$(PYTHONPATH=<this folder>/.. python3 <this folder>/test_fields.py <folder>)" \\
        UnrealEditor-Cmd <folder>/Fixture.uproject -run=pythonscript -script=<...>/dump_fields.py <same flags>
"""
import datetime
import json
import os
import shutil
import struct
import sys

import pytest

from jam_unreal import config, fields, hierarchy, inventory, packages
from jam_unreal.errors import AdapterError
from jam_unreal.fields import Package, read_fields
from jam_unreal.packages import read_package

from test_adapter import ADAPTER, bridge, run_command
from test_inventory import FIXTURES, VERSIONS, file_of, fixture_project

DATA = "/Game/Fixture/Data/DA_Fields"
LABEL = "/Game/Fixture/PAL_Fixture"
CHILD = "/Game/Fixture/Data/DA_Child"
SHOT = "/Game/Fixture/LS_Shot"
DATA_CLASS = "/Game/Fixture/Data/BPD_Fields.BPD_Fields_C"
BASE_CLASS = "/Game/Fixture/Data/BPD_Base.BPD_Base_C"
CHILD_CLASS = "/Game/Fixture/Data/BPD_Child.BPD_Child_C"
PICKUP, GOLD, HERO = ("/Game/Fixture/Blueprints/" + n for n in ("BP_Pickup", "BP_PickupGold", "BP_Hero"))
LABEL_PROPERTIES = ["Rules", "bLabelAssetsInMyDirectory", "ExplicitAssets", "ExplicitBlueprints"]
CONFIG = [{"class": "/Script/Engine.PrimaryAssetLabel", "properties": LABEL_PROPERTIES}, {"class": DATA_CLASS}]
# What the comparison with the engine reads: each class named exactly, so no parent chain is involved.
SELECTION = {"/Script/Engine.PrimaryAssetLabel": set(LABEL_PROPERTIES), DATA_CLASS: None, BASE_CLASS: None, CHILD_CLASS: None,
             PICKUP + ".BP_Pickup_C": None, GOLD + ".BP_PickupGold_C": None, HERO + ".BP_Hero_C": None, "/Script/LevelSequence.LevelSequence": set()}
COMPARED = (DATA, LABEL, CHILD, "/Game/Fixture/Data/BPD_Base", "/Game/Fixture/Data/BPD_Child", PICKUP, GOLD, HERO, SHOT)
# The fields effective.json was recorded for.
ENGINE_FIELDS = [{"class": DATA_CLASS}, {"class": BASE_CLASS}, {"class": "/Script/Engine.Actor", "properties": ["InitialLifeSpan", "Tags"]},
                 {"class": "/Script/LevelSequence.LevelSequence"}]


def facts(fields=CONFIG):
    return {"extra": {"inventory": {"fields": fields}}}


def display(text):
    """A text value as the engine displays it: a formatted text with its arguments in place."""
    if isinstance(text, str):
        return text
    if "format" in text:
        out = display(text["format"])
        args = text["args"].items() if isinstance(text["args"], dict) else enumerate(text["args"])
        for key, value in args:
            out = out.replace("{%s}" % key, display(value) if isinstance(value, (dict, str)) else "%g" % value)
        return out
    if "transform" in text:
        inner = display(text["text"])
        return inner.upper() if text["transform"] == "ToUpper" else inner.lower()
    if "asPercent" in text:
        return "%g%%" % (text["asPercent"] * 100)
    if "asNumber" in text:
        return "%g" % text["asNumber"]
    raise AssertionError("no display form for %r" % text)


TEXTS = {"format", "transform", "asPercent", "asNumber"}


def leaves(value, path="", out=None):
    """A field value as {leaf path: value}: `.` into structs, `[i]` into arrays and sets, `{key}` into maps and
    per-platform overrides, `#` for a length; a reference is its engine id, a formatted text its display string. The
    paths dump_fields.py reads in the engine."""
    out = {} if out is None else out
    if isinstance(value, dict) and ("object" in value or "soft" in value):
        out[path] = value.get("object") or value.get("soft")
    elif isinstance(value, dict) and TEXTS & set(value):
        out[path] = display(value)
    elif isinstance(value, dict) and "unparsed" not in value:
        for key, inner in value.items():
            if key == "PerPlatform" and isinstance(inner, dict):
                out[path + ".PerPlatform#"] = len(inner)
                for platform, setting in inner.items():
                    leaves(setting, "%s.PerPlatform{%s}" % (path, platform), out)
                continue
            leaves(inner, path + "." + key if path else key, out)
    elif isinstance(value, list):
        out[path + "#"] = len(value)
        for i, inner in enumerate(value):
            if isinstance(inner, dict) and set(inner) == {"key", "value"}:
                leaves(inner["value"], "%s{%s}" % (path, inner["key"]), out)
            else:
                leaves(inner, "%s[%d]" % (path, i), out)
    else:
        out[path] = value
    return out


def engine_objects(root):
    """{engine object path: its fields} for what the comparison reads: each selected asset (or a Blueprint's class
    default object) and each component in its own package."""
    out = {}
    for package in COMPARED:
        for asset in read_package(file_of(root, package), package, SELECTION)["assets"]:
            if "fields" not in asset:
                continue
            generated = packages.tag_path(asset["tags"].get("GeneratedClass"))
            target = "%s.Default__%s" % (package, generated.rsplit(".", 1)[-1]) if generated and asset["class"] not in SELECTION else asset["id"]
            out[target] = asset["fields"]
            for component in asset.get("components", []):
                if component["path"].startswith(package + ".") and "fields" in component:
                    out[component["path"]] = component["fields"]
    return out


def same(mine, engine):
    if isinstance(mine, int) and isinstance(engine, str) and engine.count(".") == 4:  # a date: ticks, and as Python prints it
        moment = datetime.datetime(1, 1, 1) + datetime.timedelta(microseconds=mine // 10)
        return moment.strftime("%Y.%m.%d-%H.%M.%S") == engine
    if isinstance(engine, str) and isinstance(mine, (int, float)) and not isinstance(mine, bool):  # from a struct's text
        try:
            engine = float(engine)
        except ValueError:
            return False
    if isinstance(engine, float) or isinstance(mine, float):
        return mine == pytest.approx(engine, rel=1e-6, abs=1e-9)
    if isinstance(mine, str) and isinstance(engine, str) and engine.isupper() and mine != engine:
        # an enum: the file holds the C++ name (EAttachmentRule::KeepWorld), Python its own (KEEP_WORLD)
        return mine.split("::")[-1].replace("_", "").upper() == engine.replace("_", "")
    return mine == engine


# Paths the engine must be able to read for the comparison to mean something: every value of the data assets, the
# label and the Blueprints' defaults, and the component and optional values the fixtures set.
FULLY_COMPARED = (DATA + ".DA_Fields", LABEL + ".PAL_Fixture", CHILD + ".DA_Child", "/Game/Fixture/Data/BPD_Base.Default__BPD_Base_C",
                  "/Game/Fixture/Data/BPD_Child.Default__BPD_Child_C")
MUST = {(PICKUP + ".BP_Pickup_C:Body_GEN_VARIABLE", "StaticMesh"), (PICKUP + ".BP_Pickup_C:Trigger_GEN_VARIABLE", "SphereRadius"),
        (GOLD + ".BP_PickupGold_C:Glow_GEN_VARIABLE", "Intensity"), (HERO + ".Default__BP_Hero_C:CharMoveComp", "MaxWalkSpeed"),
        (SHOT + ".LS_Shot:MovieSceneShotMetaData_0", "bIsNoGood"), (SHOT + ".LS_Shot:MovieSceneShotMetaData_0", "FavoriteRating")}


# ---- the reader against the engine
@pytest.mark.parametrize("version", VERSIONS)
def test_offline_values_are_what_the_engine_holds_for_the_values_the_file_sets(version):
    with open(os.path.join(FIXTURES, version, "fields.json")) as f:
        expected = json.load(f)
    assert expected["engine"].startswith(version)
    objects = engine_objects(os.path.join(FIXTURES, version))
    assert sorted(objects) == sorted(expected["assets"])
    compared = set()
    for path, engine in expected["assets"].items():
        mine = leaves(objects[path])
        assert sorted(mine) == sorted(engine), path
        for leaf, value in engine.items():
            if isinstance(value, dict) and "error" in value:  # a property the editor's Python cannot read
                assert path not in FULLY_COMPARED, (path, leaf, value)
                continue
            assert same(mine[leaf], value), (path, leaf, mine[leaf], value)
            compared.add((path, leaf))
    assert MUST <= compared
    assert len([p for p in compared if p[0] == DATA + ".DA_Fields"]) > 90
    assert "unparsed" not in json.dumps(objects)


@pytest.mark.parametrize("version", VERSIONS)
def test_every_kind_of_value_is_in_the_readers_encoding(version):
    root = os.path.join(FIXTURES, version)
    data = read_package(file_of(root, DATA), DATA, SELECTION)["assets"][0]["fields"]
    assert data["Flag"] is True and data["Count"] == 42 and data["Big"] == 1 << 40 and data["Title"] == "Crate of things"
    assert data["Offset"] == {"X": 1.5, "Y": -2.0, "Z": 3.0} and data["Shade"] == {"R": 10, "G": 20, "B": 30, "A": 255}
    assert data["Attach"] == "EAttachmentRule::KeepWorld" and data["Channel"] == "ECC_Camera"
    assert data["Scores"] == [{"key": "alpha", "value": 1}, {"key": "beta", "value": 2}]
    assert data["Mesh"] == {"object": "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.SM_Crate", "class": "/Script/Engine.StaticMesh"}
    assert data["Icon"] == {"soft": "/FixtureKit/Icons/T_Icon.T_Icon"} and data["Meshes"][1] is None
    # instanced structs, natively and tagged serialized, and an empty one
    assert data["Payload"] == {"struct": "/Script/CoreUObject.Vector", "value": {"X": 1.0, "Y": 2.0, "Z": 3.0}}
    assert data["Payloads"] == [{"struct": "/Script/Engine.PrimaryAssetRules", "value": {"Priority": 4}}, None]
    # per-platform values
    assert data["Lod"] == {"Default": 2, "PerPlatform": {"Android": 1}}
    assert data["Fade"] == {"Default": 0.5, "PerPlatform": {"IOS": 0.25}}
    assert data["Cast"] == {"Default": True, "PerPlatform": {"Android": False}}
    assert data["Rate"] == {"Default": {"Numerator": 30, "Denominator": 1}, "PerPlatform": {"Android": {"Numerator": 15, "Denominator": 1}}}
    # texts built by formatting, and a localized text (its dev notes are skipped)
    assert data["Caption"] == {"format": "{count} crates", "args": {"count": 3}}
    assert data["Shout"] == {"transform": "ToUpper", "text": "crate"}
    assert data["Share"] == {"asPercent": 0.25}
    assert data["Note"] == "Handle with care"
    # optionals: one set to false, one to 2, the rest unset and absent
    shot = read_package(file_of(root, SHOT), SHOT, {"/Script/LevelSequence.LevelSequence": None})["assets"][0]
    metadata, = [c for c in shot["components"] if c["class"] == "/Script/MovieScene.MovieSceneShotMetaData"]
    assert metadata["fields"] == {"bIsNoGood": False, "FavoriteRating": 2}


# ---- selection
def test_only_the_listed_classes_and_properties_are_read(tmp_path):
    cfg = fixture_project(tmp_path, facts=facts())
    result, _ = inventory.scan(cfg)
    with_fields = {a["id"]: sorted(a["fields"]) for e in result["files"].values() for a in e.get("assets", []) if "fields" in a}
    assert sorted(with_fields) == ["/Game/Fixture/Data/BPD_Fields.BPD_Fields", DATA + ".DA_Fields", LABEL + ".PAL_Fixture"]
    assert with_fields[LABEL + ".PAL_Fixture"] == sorted(LABEL_PROPERTIES)
    assert len(with_fields[DATA + ".DA_Fields"]) == 39
    assert len(result["fieldsConfig"]) == 16
    assert {a["fieldsSource"] for e in result["files"].values() for a in e.get("assets", []) if "fields" in a} == {"file"}

    plain, _ = inventory.scan(fixture_project(tmp_path / "plain"))
    assert "fieldsConfig" not in plain and "fields" not in json.dumps(plain)


def selected(tmp_path, listed, previous=None, name="p"):
    cfg = fixture_project(tmp_path / name, facts=facts(listed))
    result, _ = inventory.scan(cfg, previous)
    return result, {a["id"].rsplit(".", 1)[-1]: a for e in result["files"].values() for a in e.get("assets", []) if "fields" in a}


def test_a_listed_class_selects_its_subclasses_through_blueprint_parents(tmp_path):
    _, got = selected(tmp_path, [{"class": BASE_CLASS, "properties": ["Weight", "Damage"]}])
    assert sorted(got) == ["BPD_Base", "BPD_Child", "DA_Child"]
    assert got["DA_Child"]["fields"] == {"Damage": 9}  # what its file sets; Weight is BPD_Child's default
    assert got["BPD_Child"]["fields"] == {"Damage": 7, "Weight": 4.0} and got["BPD_Base"]["fields"] == {"Weight": 2.5}
    _, got = selected(tmp_path, [{"class": "/Script/Engine.PrimaryDataAsset", "properties": ["Count"]}], name="q")
    assert sorted(got) == ["BPD_Base", "BPD_Child", "BPD_Fields", "DA_Child", "DA_Fields"]
    assert got["DA_Fields"]["fields"] == {"Count": 42}


def test_a_listed_class_reads_the_union_of_the_properties_listed_on_it_and_on_its_parents():
    parent_of = {"/Game/W.W_C": "/Game/I.I_C", "/Game/I.I_C": "/Script/Engine.PrimaryDataAsset"}
    expanded = hierarchy.expand({"/Script/Engine.PrimaryDataAsset": {"A"}, "/Game/W.W_C": {"B"}}, parent_of)
    assert expanded == {"/Script/Engine.PrimaryDataAsset": {"A"}, "/Game/W.W_C": {"A", "B"}, "/Game/I.I_C": {"A"}}
    assert hierarchy.expand({"/Game/I.I_C": None, "/Game/W.W_C": {"B"}}, parent_of)["/Game/W.W_C"] is None


def test_code_classes_derive_through_the_projects_headers(tmp_path):
    module = tmp_path / "Source" / "MyGame"
    (module / "Items").mkdir(parents=True)
    (module / "MyGame.Build.cs").write_text("")
    (module / "Items" / "Items.h").write_text("""
UCLASS(BlueprintType, meta = (DisplayName = "Item (base)"))
class MYGAME_API UItemDefinition : public UPrimaryDataAsset
{ GENERATED_BODY() };
UCLASS()
class MYGAME_API UWeaponDefinition final : public UItemDefinition, public IThing
{ GENERATED_BODY() };
UCLASS() class AGun : public AActor {};
""")
    plugin = tmp_path / "Plugins" / "Kit" / "Source" / "KitRuntime"
    plugin.mkdir(parents=True)
    (plugin / "KitRuntime.Build.cs").write_text("")
    (plugin / "Sword.h").write_text("UCLASS()\nclass KITRUNTIME_API USwordDefinition : public UWeaponDefinition {};\n")
    assert hierarchy.native_parents(str(tmp_path)) == {"/Script/MyGame.ItemDefinition": "PrimaryDataAsset", "/Script/MyGame.WeaponDefinition": "ItemDefinition",
                                                       "/Script/MyGame.Gun": "Actor", "/Script/KitRuntime.SwordDefinition": "WeaponDefinition"}
    parent_of = hierarchy.parents({}, str(tmp_path), ["/Script/Engine.PrimaryDataAsset"])
    assert hierarchy.ancestors("/Script/KitRuntime.SwordDefinition", parent_of) == [
        "/Script/MyGame.WeaponDefinition", "/Script/MyGame.ItemDefinition", "/Script/Engine.PrimaryDataAsset"]
    assert "/Script/MyGame.Gun" not in parent_of  # Actor is no class the project knows: the chain stops


def test_code_class_parents_an_engine_run_learned_are_kept_and_select_more(tmp_path):
    listed = [{"class": "/Script/Engine.Actor", "properties": ["Tags"]}]
    first, got = selected(tmp_path, listed)
    assert sorted(got) == ["BP_Crate", "BP_Pickup", "BP_PickupGold"]  # BP_Hero is a Character, whose parents no file names
    learned = {"/Script/Engine.Character": "/Script/Engine.Pawn", "/Script/Engine.Pawn": "/Script/Engine.Actor"}
    second, got = selected(tmp_path, listed, dict(first, parents=learned))
    assert sorted(got) == ["BP_Crate", "BP_Hero", "BP_Pickup", "BP_PickupGold"]
    assert second["parents"] == learned and second["fieldsConfig"] != first["fieldsConfig"]


@pytest.mark.parametrize("bad", ["Icon", [{"properties": ["A"]}], [{"class": "Item"}], [{"class": "/Script/G.Item", "properties": "A"}]])
def test_a_field_list_the_reader_cannot_use_is_an_error_that_says_how_to_write_it(tmp_path, bad):
    cfg = fixture_project(tmp_path, facts=facts(bad))
    with pytest.raises(AdapterError) as e:
        inventory.scan(cfg)
    assert e.value.code == "invalid" and "engine.facts.extra.inventory.fields" in e.value.fix


def test_entries_naming_a_class_twice_merge_their_properties():
    cfg = type("Cfg", (), {"extra": {"inventory": {"fields": [{"class": "/Script/G.Item", "properties": ["A"]}, {"class": "/Script/G.Item", "properties": ["B"]},
                                                              {"class": "/Script/G.Tool", "properties": ["A"]}, {"class": "/Script/G.Tool"}]}}})()
    selection, key = inventory.field_selection(cfg)
    assert selection == {"/Script/G.Item": {"A", "B"}, "/Script/G.Tool": None} and key


# ---- components
def components(asset):
    return {c["name"]: c for c in asset.get("components", [])}


def test_actor_blueprints_list_their_components_with_their_values(tmp_path):
    _, got = selected(tmp_path, [{"class": "/Script/Engine.Actor", "properties": []}, {"class": "/Script/Engine.Character", "properties": []}])
    pickup = components(got["BP_Pickup"])
    assert pickup["Body"]["class"] == "/Script/Engine.StaticMeshComponent" and pickup["Body"]["path"] == PICKUP + ".BP_Pickup_C:Body_GEN_VARIABLE"
    assert pickup["Body"]["fields"]["StaticMesh"]["object"].endswith("SM_Crate.SM_Crate")
    assert pickup["Body"]["fieldReferences"] == [{"property": "StaticMesh", "to": "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.SM_Crate", "kind": "hard"}]
    assert pickup["Trigger"]["fields"]["SphereRadius"] == 50.0
    gold = components(got["BP_PickupGold"])
    assert gold["Glow"]["fields"] == {"Intensity": 1234.0} and "from" not in gold["Glow"]
    # an inherited component it changes is read from its own package; one it leaves is the parent's
    assert gold["Body"]["fields"] == {"CastShadow": False} and gold["Body"]["from"] == PICKUP + ".BP_Pickup_C" and "inherited" not in gold["Body"]
    assert gold["Trigger"]["inherited"] is True and gold["Trigger"]["from"] == PICKUP + ".BP_Pickup_C" and gold["Trigger"]["fields"]["SphereRadius"] == 50.0
    hero = components(got["BP_Hero"])  # a code class's components, named by the property that holds them
    assert {"CapsuleComponent", "Mesh", "CharacterMovement", "ArrowComponent"} <= set(hero)
    assert hero["CharacterMovement"]["fields"] == {"MaxWalkSpeed": 777.0} and hero["CharacterMovement"]["path"].endswith("Default__BP_Hero_C:CharMoveComp")
    assert got["BP_Hero"]["fields"] == {}  # the listed properties: none


def test_a_listed_objects_instanced_subobjects_are_its_components(tmp_path):
    _, got = selected(tmp_path, [{"class": "/Script/LevelSequence.LevelSequence", "properties": ["MetaDataObjects"]}])
    shot = got["LS_Shot"]
    assert [r["to"] for r in shot["fieldReferences"]] == [SHOT + ".LS_Shot:MovieSceneMetaData_0", SHOT + ".LS_Shot:MovieSceneShotMetaData_0"]
    parts = components(shot)
    assert parts["MovieSceneMetaData_0"]["fields"]["Author"] == "fixture"
    assert parts["MovieScene_0.NodeGroupCollection"]["class"] == "/Script/MovieScene.MovieSceneNodeGroupCollection"


# ---- references
@pytest.mark.parametrize("version", VERSIONS)
def test_each_reference_in_a_value_names_the_property_that_holds_it_and_is_one_of_the_packages_references(version):
    root = os.path.join(FIXTURES, version)
    for package in COMPARED:
        entry = read_package(file_of(root, package), package, SELECTION)
        refs = [r for a in entry["assets"] for r in a.get("fieldReferences", [])]
        refs += [r for a in entry["assets"] for c in a.get("components", []) for r in c.get("fieldReferences", [])]
        header = {(r["to"], r["kind"]) for r in entry["references"]}
        for r in refs:
            to = r["to"].split(".")[0]
            if to == package:
                continue  # an object of the same package: a subobject, a component
            kinds = {"hard": {"hard"}, "native": {"native"}, "soft": {"soft", "hard"}}[r["kind"]]
            assert any((to, k) in header for k in kinds), r
    data = read_package(file_of(root, DATA), DATA, SELECTION)["assets"][0]["fieldReferences"]
    assert {"property": "Mesh", "to": "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.SM_Crate", "kind": "hard"} in data
    assert {"property": "Meshes[0]", "to": "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.SM_Crate", "kind": "hard"} in data
    assert {"property": "Icon", "to": "/FixtureKit/Icons/T_Icon.T_Icon", "kind": "soft"} in data
    assert {"property": "Kind", "to": "/Script/Engine.StaticMeshActor", "kind": "native"} in data
    label = read_package(file_of(root, LABEL), LABEL, SELECTION)["assets"][0]["fieldReferences"]
    assert label == [{"property": "ExplicitAssets[0]", "to": "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate.SM_Crate", "kind": "soft"},
                     {"property": "ExplicitBlueprints[0]", "to": "/Game/Fixture/Blueprints/BP_Crate.BP_Crate_C", "kind": "soft"}]


# ---- native layouts
@pytest.mark.parametrize("version", VERSIONS)
def test_a_blueprints_own_object_decodes_pin_types_and_slate_vectors(version):
    root = os.path.join(FIXTURES, version)
    package = "/Game/Fixture/Data/BPD_Fields"
    blueprint = read_package(file_of(root, package), package, {"/Script/Engine.Blueprint": None})["assets"][0]
    assert blueprint["fields"]["ParentClass"] == {"object": "/Script/Engine.PrimaryDataAsset", "class": "/Script/CoreUObject.Class"}
    variables = {v["VarName"]: v["VarType"] for v in blueprint["fields"]["NewVariables"]}
    assert variables["Count"]["PinCategory"] == "int" and variables["Count"]["ContainerType"] == "EPinContainerType::None"
    assert variables["Scores"]["ContainerType"] == "EPinContainerType::Map" and variables["Scores"]["PinValueType"]["TerminalCategory"] == "int"
    assert variables["Mesh"]["PinSubCategoryObject"] == {"object": "/Script/Engine.StaticMesh", "class": "/Script/CoreUObject.Class"}
    package = "/Game/Fixture/Blueprints/BP_Crate"
    crate = read_package(file_of(root, package), package, {"/Script/Engine.Blueprint": None})["assets"][0]
    offset = crate["fields"]["LastEditedDocuments"][0]["SavedViewOffset"]
    assert set(offset) == {"X", "Y"} and "unparsed" not in json.dumps(crate["fields"])
    package = "/Game/Fixture/Meshes/SM_Crate/StaticMeshes/SM_Crate"
    mesh = read_package(file_of(root, package), package, {"/Script/Engine.StaticMesh": None})["assets"][0]
    assert mesh["fields"]["SourceModels"][0]["ScreenSize"] == {"Default": 0.0, "PerPlatform": {}}


class Writer:
    """Builds a tagged property stream as an editor package stores it, for layouts no installed engine writes."""

    def __init__(self, ue5):
        self.ue5, self.names, self.data = ue5, ["None"], b""

    def name(self, text):
        if text not in self.names:
            self.names.append(text)
        return struct.pack("<ii", self.names.index(text), 0)

    @staticmethod
    def string(text):
        return struct.pack("<i", len(text) + 1) + text.encode() + b"\0"

    def tag(self, name, kind, value, params=(), bool_value=False, struct_name=None, inner=False):
        """One property: the old layout (before UE5 1012) names its type and parameters; the new one is not built."""
        out = self.name(name) + self.name(kind) + struct.pack("<ii", len(value), 0)
        if kind == "StructProperty":
            out += self.name(struct_name) + b"\0" * 16
        elif kind == "BoolProperty":
            out += bytes([bool_value])
        elif kind in ("ByteProperty", "EnumProperty", "ArrayProperty", "SetProperty"):
            out += self.name(params[0])
        elif kind == "MapProperty":
            out += self.name(params[0]) + self.name(params[1])
        out += b"\0"  # no property guid
        if self.ue5 >= fields.PROPERTY_TAG_EXTENSION:
            out += b"\0"
        return out if inner else out + value

    def stream(self, *tags):
        return (b"\0" if self.ue5 >= fields.PROPERTY_TAG_EXTENSION else b"") + b"".join(tags) + self.name("None")


@pytest.mark.parametrize("ue5", [1010, 1011])
def test_the_property_tag_layout_before_ue5_1012_is_read(ue5):
    """No installed engine (5.8, 5.9) writes a package older than object version 1018, so this stream is built from
    the layout FPropertyTag's loader reads before PROPERTY_TAG_COMPLETE_TYPE_NAME (1012); 1011 adds an extension byte
    after each tag and before the object's properties."""
    w = Writer(ue5)
    vector = struct.pack("<ddd", 1.5, -2.0, 3.0)
    inner = w.tag("Name", "NameProperty", w.name("Map"))
    tagged = inner + w.name("None")
    points_inner = w.tag("Points", "StructProperty", b"\0" * 48, struct_name="Vector", inner=True)
    points = struct.pack("<i", 2) + points_inner + struct.pack("<dddddd", 1, 0, 0, 0, 1, 0)
    data = w.stream(
        w.tag("Count", "IntProperty", struct.pack("<i", 5)),
        w.tag("Flag", "BoolProperty", b"", bool_value=True),
        w.tag("Offset", "StructProperty", vector, struct_name="Vector"),
        w.tag("Kind", "StructProperty", tagged, struct_name="PrimaryAssetType"),
        w.tag("Points", "ArrayProperty", points, params=("StructProperty",)),
        w.tag("Mode", "ByteProperty", w.name("EMode::Fast"), params=("EMode",)),
        w.tag("Scores", "MapProperty", struct.pack("<ii", 0, 1) + w.name("alpha") + struct.pack("<i", 7), params=("NameProperty", "IntProperty")),
        w.tag("Tags", "SetProperty", struct.pack("<ii", 0, 2) + w.name("a") + w.name("b"), params=("NameProperty",)),
        w.tag("Bytes", "ArrayProperty", struct.pack("<i", 2) + b"\x01\x02", params=("ByteProperty",)),
    )
    package = Package("/Game/T", ue5, w.names, [], [{"class": 0, "outer": 0, "name": "T"}], [])
    values, refs = read_fields(data, package)
    assert values == {"Count": 5, "Flag": True, "Offset": {"X": 1.5, "Y": -2.0, "Z": 3.0}, "Kind": {"Name": "Map"},
                      "Points": [{"X": 1.0, "Y": 0.0, "Z": 0.0}, {"X": 0.0, "Y": 1.0, "Z": 0.0}], "Mode": "EMode::Fast",
                      "Scores": [{"key": "alpha", "value": 7}], "Tags": ["a", "b"], "Bytes": [1, 2]}
    assert refs == []


def new_tag(w, name, kind_tree, value):
    """A property tag in the UE5 1012+ layout: the type as a tree of (name, parameter count)."""
    def tree(node):
        name_, params = node
        return w.name(name_) + struct.pack("<i", len(params)) + b"".join(tree(p) for p in params)
    return w.name(name) + tree(kind_tree) + struct.pack("<i", len(value)) + b"\0" + value


def read_new(w, tags, custom, imports=(), exports=None):
    exports = exports or [{"class": 0, "outer": 0, "name": "T"}]
    package = Package("/Game/T", 1018, w.names, list(imports), exports, [], custom)
    data = b"\0" + b"".join(tags) + w.name("None")
    return read_fields(data, package)


def test_delegates_and_field_paths_name_their_target():
    imports = [{"class_package": "/Script/CoreUObject", "class": "Package", "outer": 0, "name": "/Script/Engine", "package": None},
               {"class_package": "/Script/CoreUObject", "class": "Class", "outer": -1, "name": "Actor", "package": None}]
    w = Writer(1018)
    custom = {fields.FORTNITE_MAIN: fields.COMPACT_DYNAMIC_DELEGATE_PAYLOADS}
    one = struct.pack("<i", 1) + w.name("OnUse")
    many = struct.pack("<i", 2) + struct.pack("<i", 1) + w.name("OnA") + struct.pack("<i", 0) + w.name("OnB")
    payload = struct.pack("<i", 1) + struct.pack("<i", 1) + w.name("OnC" + fields.PAYLOAD_SUFFIX)
    path = struct.pack("<i", 1) + w.name("bHidden") + struct.pack("<i", -2)
    values, refs = read_new(w, [new_tag(w, "Used", ("DelegateProperty", []), one),
                                new_tag(w, "Changed", ("MulticastInlineDelegateProperty", []), many),
                                new_tag(w, "Carried", ("MulticastSparseDelegateProperty", []), payload),
                                new_tag(w, "Watched", ("FieldPathProperty", [("BoolProperty", [])]), path)], custom, imports)
    assert values["Used"] == {"function": "OnUse", "target": {"object": "/Game/T.T", "class": "/Script/CoreUObject.Class"}}
    assert values["Changed"] == [{"function": "OnA", "target": {"object": "/Game/T.T", "class": "/Script/CoreUObject.Class"}}, {"function": "OnB", "target": None}]
    assert values["Carried"] == {"unparsed": "MulticastSparseDelegateProperty"}
    assert values["Watched"] == {"field": "/Script/Engine.Actor:bHidden"}
    w = Writer(1018)  # between the payload versions a flag follows each delegate
    values, _ = read_new(w, [new_tag(w, "Used", ("DelegateProperty", []), struct.pack("<i", 0) + w.name("OnUse") + struct.pack("<I", 0))],
                         {fields.FORTNITE_MAIN: fields.DYNAMIC_DELEGATE_PAYLOADS})
    assert values["Used"] == {"function": "OnUse", "target": None}


def text(w, history, body):
    return struct.pack("<i", 0) + struct.pack("<b", history) + body


def test_texts_built_by_formatting_keep_their_format_and_arguments():
    w = Writer(1018)
    custom = {fields.FORTNITE_MAIN: fields.ADD_DEV_NOTES_TO_FTEXT, fields.UE5_RELEASE_STREAM: fields.TEXT_FORMAT_ARGUMENT_DATA_64BIT}
    base = text(w, 0, w.string("ns") + w.string("key") + w.string("{who} owes {n}") + w.string("a note"))
    invariant = text(w, -1, struct.pack("<I", 1) + w.string("you"))
    argument_data = text(w, 3, base + struct.pack("<i", 2) + w.string("who") + bytes([4]) + invariant + w.string("n") + bytes([0]) + struct.pack("<q", 5))
    currency = text(w, 6, w.string("EUR") + bytes([3]) + struct.pack("<d", 2.5) + struct.pack("<I", 1) + struct.pack("<III", 0, 1, 0)[:8]
                    + bytes([0]) + struct.pack("<iiii", 1, 9, 0, 2) + w.string("de"))
    date = text(w, 7, struct.pack("<q", 638700000000000000) + bytes([2]) + w.string("UTC") + w.string(""))
    table = text(w, 11, w.name("ST_Items") + w.string("Sword"))
    generated = text(w, 12, w.name("Gen") + struct.pack("<i", 3) + b"abc")   # FTextHistory_TextGenerator: its contents are the generator's own
    blank = text(w, 12, w.name("None"))
    values, _ = read_new(w, [new_tag(w, n, ("TextProperty", []), v) for n, v in
                             (("Owed", argument_data), ("Price", currency), ("Day", date), ("Name", table), ("Made", generated), ("Blank", blank))], custom)
    assert values["Owed"] == {"format": "{who} owes {n}", "args": {"who": "you", "n": 5}}
    assert values["Price"] == {"asCurrency": 2.5, "currency": "EUR", "culture": "de"}
    assert values["Day"] == {"asDate": "2024-12-17T02:40:00"}
    assert values["Name"] == {"table": "ST_Items", "key": "Sword"}
    assert values["Made"] == {"generator": "Gen"} and values["Blank"] == ""


@pytest.mark.parametrize("version", ["5.8", "5.9"])
def test_control_rig_links_are_read_as_the_pin_paths_the_editor_reads(version):
    """A Control Rig graph's links serialize two pin paths and no tagged properties (fixtures/rig/make_rig.py wrote the
    package and links.json in that engine). Its rig hierarchy serializes its own element format, which stays unread."""
    folder = os.path.join(os.path.dirname(FIXTURES), "rig", version)
    with open(os.path.join(folder, "links.json"), encoding="utf-8") as f:
        engine = json.load(f)["links"]
    rig = read_package(os.path.join(folder, "CR_Fixture.uasset"), "/Game/Rig/CR_Fixture", {"/Script/ControlRigDeveloper.ControlRigBlueprint": None})["assets"][0]
    by_class = {}
    for component in rig["components"]:
        by_class.setdefault(component["class"], []).append(component)
    assert [(c["path"], c["fields"]) for c in by_class["/Script/RigVMDeveloper.RigVMLink"]] == [
        (link["path"], {"SourcePinPath": link["source"], "TargetPinPath": link["target"]}) for link in engine]
    assert [c["fieldsError"] for c in by_class["/Script/ControlRig.RigHierarchy"]] == ["the object stores no tagged properties: its class serializes itself"]


def test_self_serialized_data_that_does_not_parse_is_a_fields_error():
    package = Package("/Game/A", 1012, [], [], [], [])
    link = "/Script/RigVMDeveloper.RigVMLink"
    two = struct.pack("<i", 2) + b"A\x00" + struct.pack("<i", 2) + b"B\x00"
    assert fields.read_self_serialized(two, package, link) == ({"SourcePinPath": "A", "TargetPinPath": "B"}, [])
    for data, cls, message in ((two + b"x", link, "1 bytes this reader does not know"), (two[:6], link, "read past the end"),
                               (two, "/Script/ControlRig.RigHierarchy", "its class serializes itself")):
        with pytest.raises(fields.FieldsError, match=message):
            fields.read_self_serialized(data, package, cls)


# ---- what the reader cannot read
def script_offset(path):
    """Where the first export's tagged properties start in the file."""
    with open(path, "rb") as f:
        r = packages._Reader(f, os.path.getsize(path))
        r.window(0, 1 << 16)
        s = packages._summary(r)
        export = packages._exports(r, s, packages._names(r, s))[0]
    return export["offset"] + export["script"][0]


@pytest.mark.parametrize("version", VERSIONS)
def test_a_broken_export_keeps_the_header_data_and_says_why_its_fields_are_missing(tmp_path, version):
    source = file_of(os.path.join(FIXTURES, version), DATA)
    broken = tmp_path / "DA_Fields.uasset"
    shutil.copy(source, broken)
    with open(broken, "r+b") as f:
        f.seek(script_offset(str(broken)) + 1)  # past the object's extension byte: the first tag's name
        f.write(struct.pack("<i", 0x7FFFFFF0))
    good = read_package(source, DATA, SELECTION)
    entry = read_package(str(broken), DATA, SELECTION)
    asset = entry["assets"][0]
    assert "name index" in asset["fieldsError"] and "fields" not in asset and "fieldReferences" not in asset
    assert asset["class"] == DATA_CLASS and asset["tags"] == good["assets"][0]["tags"]
    assert entry["references"] == good["references"]


# ---- reuse
def test_changing_the_field_list_reads_again_only_the_packages_it_can_change(tmp_path):
    plain = fixture_project(tmp_path)
    first, counts = inventory.scan(plain)
    assert counts["read"] == 16
    project_config = tmp_path / "jam.config.json"
    project_config.write_text(json.dumps({"engine": {"adapter": "unreal", "facts": facts()}}))
    cfg = config.load(str(tmp_path), ADAPTER, environ={})
    second, counts = inventory.scan(cfg, first)
    assert (counts["read"], counts["reused"]) == (3, 13)
    assert "fields" in second["files"]["Content/Fixture/Data/DA_Fields.uasset"]["assets"][0]
    third, counts = inventory.scan(cfg, second)
    assert (counts["read"], counts["reused"]) == (0, 16) and third["files"] == second["files"]

    project_config.write_text(json.dumps({"engine": {"adapter": "unreal", "facts": facts([{"class": DATA_CLASS, "properties": ["Count"]}])}}))
    cfg = config.load(str(tmp_path), ADAPTER, environ={})
    fourth, counts = inventory.scan(cfg, third)
    assert (counts["read"], counts["reused"]) == (3, 13)
    assert fourth["files"]["Content/Fixture/Data/DA_Fields.uasset"]["assets"][0]["fields"] == {"Count": 42}
    assert "fields" not in fourth["files"]["Content/Fixture/PAL_Fixture.uasset"]["assets"][0]

    project_config.write_text(json.dumps({"engine": {"adapter": "unreal"}}))
    cfg = config.load(str(tmp_path), ADAPTER, environ={})
    fifth, counts = inventory.scan(cfg, fourth)
    assert (counts["read"], counts["reused"]) == (2, 14) and "fieldsConfig" not in fifth
    assert "fields" not in json.dumps(fifth)


def test_the_inventory_command_reads_the_fields_the_project_lists(tmp_path):
    fixture_project(tmp_path, facts=facts())
    code, receipt, err = run_command(tmp_path, "engine_inventory.py", "--out", "inv.json")
    assert code == 0, err
    written = json.loads((tmp_path / "inv.json").read_text())
    assert written["fieldsConfig"] == inventory.Scan(config.load(str(tmp_path), ADAPTER, environ={})).inventory["fieldsConfig"]
    assert written["files"]["Content/Fixture/Data/DA_Fields.uasset"]["assets"][0]["fields"]["Count"] == 42


# ---- effective values from the engine
def replay(tmp_path, version):
    """A stand-in for the editor that answers editor/fields.py with what the real editor reported (effective.json)."""
    with open(os.path.join(FIXTURES, version, "effective.json")) as f:
        recorded = json.load(f)
    merged = {"engine": recorded["engine"], "parents": {}, "assets": {}}
    for call in recorded["calls"]:
        merged["parents"].update(call["result"]["parents"])
        merged["assets"].update(call["result"]["assets"])
    source = ('{"inventory-fields": lambda a, R=__import__("json").loads(%r): '
              '{"engine": R["engine"], "parents": R["parents"], "assets": {i["id"]: R["assets"][i["id"]] for i in a["assets"] if i["id"] in R["assets"]}}}') % json.dumps(merged)
    return bridge(tmp_path, source), recorded


def engine_inventory(tmp_path, version, *extra):
    fixture_project(tmp_path, version, facts=facts(ENGINE_FIELDS))
    local, recorded = replay(tmp_path, version)
    code, receipt, err = run_command(tmp_path, "engine_inventory.py", "--out", "inv.json", *extra, local=local)
    assert code == 0, err
    written = json.loads((tmp_path / "inv.json").read_text())
    return written, {a["id"].rsplit(".", 1)[-1]: a for e in written["files"].values() for a in e.get("assets", []) if "fields" in a}, recorded


@pytest.mark.parametrize("version", VERSIONS)
def test_with_the_engine_listed_assets_get_their_effective_values(tmp_path, version):
    written, got, recorded = engine_inventory(tmp_path, version, "--engine")
    assert recorded["engine"].startswith(version) and len(recorded["calls"]) == 2  # the second asks about BP_Hero
    # inherited values a file does not hold: DA_Child sets only Damage
    assert got["DA_Child"]["fieldsSource"] == "engine"
    assert got["DA_Child"]["fields"] == {"Damage": 9, "Weight": 4.0, "Tag": "base", "Icon": {"soft": "/FixtureKit/Icons/T_Icon.T_Icon"}}
    assert {"property": "Icon", "to": "/FixtureKit/Icons/T_Icon.T_Icon", "kind": "soft"} in got["DA_Child"]["fieldReferences"]
    # native defaults: a Blueprint's actor properties nobody set
    assert got["BP_Pickup"]["fields"] == {"InitialLifeSpan": 0.0, "Tags": []}
    # the components as the editor composes the actor, inherited and native ones included
    gold = components(got["BP_PickupGold"])
    assert sorted(gold) == ["Body", "DefaultSceneRoot", "Glow", "Trigger"]
    assert gold["Body"]["inherited"] is True and gold["Body"]["fields"] == {"CastShadow": False}
    assert gold["Glow"]["fields"] == {"Intensity": 1234.0} and "inherited" not in gold["Glow"]
    hero = components(got["BP_Hero"])
    assert hero["CharacterMovement"]["native"] is True and hero["CharacterMovement"]["fields"] == {"MaxWalkSpeed": 777.0}
    # the code-class parents that selected BP_Hero are kept for runs without the engine
    assert written["parents"]["/Script/Engine.Pawn"] == "/Script/Engine.Actor"
    # what the editor's Python cannot read stays what the file says (protected properties)
    shot = components(got["LS_Shot"])
    assert shot["MovieSceneShotMetaData_0"]["fields"] == {"FavoriteRating": 2, "bIsNoGood": False}
    # every value the file sets is the effective value too
    data = read_package(file_of(os.path.join(FIXTURES, version), DATA), DATA, SELECTION)["assets"][0]["fields"]
    effective = got["DA_Fields"]["fields"]
    for name, value in data.items():
        if isinstance(value, dict) and TEXTS & set(value):
            assert effective[name] == display(value), name  # the engine gives a text's display string
        else:  # the file's leaves; the engine's has the defaults of the rest too (a struct's other fields)
            engine = leaves(effective[name])
            for leaf, expected in leaves(value).items():
                assert same(expected, engine[leaf]), (name, leaf)


@pytest.mark.parametrize("version", VERSIONS)
def test_effective_values_stay_until_their_file_changes(tmp_path, version):
    first, got, _ = engine_inventory(tmp_path, version, "--engine")
    code, receipt, err = run_command(tmp_path, "engine_inventory.py", "--out", "inv.json", "--previous", "inv.json")
    assert code == 0, err and (receipt["read"], receipt["reused"]) == (0, 16)
    again = json.loads((tmp_path / "inv.json").read_text())
    assert again["files"] == first["files"] and again["parents"] == first["parents"]
    child = tmp_path / "Content/Fixture/Data/DA_Child.uasset"
    os.utime(child, ns=(os.stat(child).st_atime_ns, os.stat(child).st_mtime_ns + 5_000_000))
    code, receipt, _ = run_command(tmp_path, "engine_inventory.py", "--out", "inv.json", "--previous", "inv.json")
    asset = json.loads((tmp_path / "inv.json").read_text())["files"]["Content/Fixture/Data/DA_Child.uasset"]["assets"][0]
    assert receipt["read"] == 1 and asset["fieldsSource"] == "file" and asset["fields"] == {"Damage": 9}


def test_effective_values_fall_back_to_the_files_where_the_editor_cannot_read_them():
    entry = {"assets": [{"id": "/Game/A.A", "fields": {"Secret": 3, "Open": 1}, "fieldsSource": "file",
                         "fieldReferences": [{"property": "Secret", "to": "/Game/B.B", "kind": "hard"}]},
                        {"id": "/Game/C.C", "fields": {"X": 1}, "fieldsSource": "file"}]}
    inv = {"files": {"Content/A.uasset": entry}}
    reported = {"/Game/A.A": {"fields": {"Secret": {"unparsed": "Secret (not readable from the editor's Python)"}, "Open": 1, "Hidden": {"unparsed": "Hidden"}}},
                "/Game/C.C": {"error": "the editor could not load it"}}
    assert inventory.apply_effective(inv, reported) == 1
    a, c = entry["assets"]
    assert a["fields"] == {"Secret": 3, "Open": 1, "Hidden": {"unparsed": "Hidden"}} and a["fieldsSource"] == "engine"
    assert a["fieldReferences"] == [{"property": "Secret", "to": "/Game/B.B", "kind": "hard"}]
    assert c == {"id": "/Game/C.C", "fields": {"X": 1}, "fieldsSource": "file", "fieldsEngineError": "the editor could not load it"}


def field_paths(root):
    """JAM_FIXTURE_FIELDS for dump_fields.py: each object's leaf paths, as this reader finds them in `root`."""
    return json.dumps({path: sorted(leaves(values)) for path, values in engine_objects(root).items()})


if __name__ == "__main__":
    print(field_paths(sys.argv[1]))
