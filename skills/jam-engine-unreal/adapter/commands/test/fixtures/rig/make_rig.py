"""Write the Control Rig fixture: run in the editor's Python commandlet, in a project with the ControlRig plugin enabled.

    UnrealEditor-Cmd <project> -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi -stdout

Makes /Game/Rig/CR_Fixture, a Control Rig whose graph adds two numbers and links the sum to both inputs of a
multiplication, and writes links.json in the project folder: each link's pin paths as the editor reads them. Copy
Content/Rig/CR_Fixture.uasset and links.json into fixtures/rig/<engine version>/."""
import json, os, unreal
PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
rig = unreal.ControlRigBlueprintFactory.create_new_control_rig_asset(desired_package_path="/Game/Rig/CR_Fixture")
model = rig.get_default_model()
controller = rig.get_controller(model)
add = controller.add_unit_node_from_struct_path("/Script/RigVM.RigVMFunction_MathFloatAdd", "Execute", unreal.Vector2D(0, 0), "Add")
mul = controller.add_unit_node_from_struct_path("/Script/RigVM.RigVMFunction_MathFloatMul", "Execute", unreal.Vector2D(300, 0), "Mul")
if not (controller.add_link("Add.Result", "Mul.A") and controller.add_link("Add.Result", "Mul.B")):
    raise RuntimeError("the links were not added")
unreal.EditorAssetLibrary.save_asset("/Game/Rig/CR_Fixture", only_if_is_dirty=False)
links = []
for graph in rig.get_all_models():
    for link in graph.get_links():
        links.append({"path": link.get_path_name(), "source": link.get_source_pin().get_pin_path(), "target": link.get_target_pin().get_pin_path()})
open(os.path.join(PROJECT, "links.json"), "w").write(json.dumps({"engine": unreal.SystemLibrary.get_engine_version(), "links": links}, indent=1))
