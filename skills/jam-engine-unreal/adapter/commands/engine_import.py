#!/usr/bin/env python3
"""Import delivered files into the Unreal project. The adapter's `import` command.

    engine_import.py --kind static <model.glb|.fbx> [--dest /Game/<folder>] [--name <Name>] [--collision-complexity simple-and-complex]
    engine_import.py --kind textures <file.png> ... | --texture <role>=<file.png> ... [--dest /Game/<folder>]     role: color | normal | masks
    engine_import.py --kind skinned <mesh.fbx> [--skeleton <profile id>] [--name <Name>] [--dest /Game/<folder>]
                     [--slot "<material slot>=<color.png>,<normal.png>,<masks.png>" | --slot "<material slot>=/Game/<existing material>"] ...
                     [--two-sided <material slot>] ... [--parent-material /Game/<existing parent>] [--physics-asset /Game/<asset> | none]
    engine_import.py --kind animation <clip.glb> --target <skeleton or skeletal mesh id> [--name <Name>] [--dest /Game/<folder>] [--run <jam run id>]
    engine_import.py --kind audio <sound.wav> ... [--dest /Game/<folder>] [--name <Name>]
    engine_import.py --kind audio-variants <take.wav> ... | --variant /Game/<sound wave> ... [--asset /Game/<folder>/<Name>] [--name <Name>]
Common: [--normal-green up|down] (convention of the normal maps given; default up) [--details <file.json>] [--project <dir>]

Files are project-relative paths with forward slashes, given after the flags or with --source. Without --dest the
folder comes from the project's `engine.facts.extra.destinations.<kind>`; without --name the asset is named after
the file. A file `<source stem>.import.json` beside a source supplies any of name, dest, skeleton, slots, twoSided,
physicsAsset and normalGreen for it; flags win over it. A texture given without a role takes it from its file name
(`_Normal` or `_N`: normal; `_ORM`, `_Masks` or `_MetallicRoughness`: masks; anything else: color).
Prints {"assets": [{"id", "kind", "source", "sha256", "skeleton"?}]}. Importing the same source to the same destination
again reimports into the same asset id; a static mesh that already exists is refused (docs/import.md, "Replacing a mesh").
An animation clip is a .glb holding the skinned rig and its named animations; it is refused when the target's skeleton
lacks any of its joints, or when a sequence it would make exists and was imported from another file, unless an import
with the same --run made it (a later attempt of a run replaces its own sequence). Each animation
sequence is listed with the skeleton it plays on; a sequence the editor did not save fails the import.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, gltf, locks, paths, receipts  # noqa: E402
from jam_unreal.errors import AdapterError  # noqa: E402

KINDS = ("static", "skinned", "animation", "textures", "audio", "audio-variants")
TEXTURE_ROLES = ("color", "normal", "masks")
MATERIAL_KINDS = {"color": "BaseColor", "normal": "Normal", "masks": "ORM"}


def sidecar(cfg, source):
    """Import options written beside a source by whatever produced it: `<stem>.import.json`."""
    path = os.path.splitext(paths.absolute(cfg.project, source))[0] + ".import.json"
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
    except ValueError as e:
        raise AdapterError("invalid", "%s is not valid JSON: %s" % (os.path.basename(path), e))
    return value if isinstance(value, dict) else {}


def texture_role(source):
    stem = os.path.splitext(os.path.basename(source))[0].lower()
    if re.search(r"(_normal|_nrm|_n)$", stem):
        return "normal"
    if re.search(r"(_orm|_masks|_metallicroughness|_occlusionroughnessmetallic)$", stem):
        return "masks"
    return "color"


def stored(result_source, project_dir, given):
    """The source the asset stores, project-relative; an asset that names a file outside the project is refused."""
    if not result_source:
        receipts.note("the engine reported no stored source for %s; the receipt names the file you gave" % given)
        return given
    return paths.project_relative(result_source, project_dir)


def lock(cfg, ids):
    taken = locks.ensure(cfg.project, [paths.asset_file(i, cfg.facts) for i in ids], cfg.locks)
    for path in taken:
        receipts.note("locked %s" % path)


def texture_item(cfg, role, source):
    relative, digest = paths.source_stamp(cfg.project, source, "texture")
    name = cfg.named("texture", cli.asset_name(os.path.splitext(os.path.basename(relative))[0]))
    return {"source": relative, "sha256": digest, "name": name, "role": role}


def flip_green(cfg, given):
    return given != (cfg.facts.get("textures") or {}).get("normalGreen", "down")


def import_static(cfg, a):
    if len(a.source) != 1:
        raise AdapterError("invalid", "--kind static takes exactly one --source")
    source, digest = paths.source_stamp(cfg.project, a.source[0])
    side = sidecar(cfg, source)
    base = cli.asset_name(a.name or side.get("name") or os.path.splitext(os.path.basename(source))[0])
    prefix = cfg.prefix("staticMesh")
    base = base[len(prefix):] if prefix and base.startswith(prefix) else base
    dest = cfg.destination("static", a.dest or side.get("dest"))
    mesh_id = paths.asset_id(dest, cfg.named("staticMesh", base))
    result, = cli.editor(cfg, "import-static", [("mesh", "import_static", {
        "source": source, "sha256": digest, "dest": dest, "name": paths.object_name(mesh_id), "base": base,
        "prefixes": {k: cfg.prefix(k) for k in ("texture", "material", "materialInstance")}, "complexity": a.collision_complexity})])
    cli.write_details(cfg, a.details, result)
    for key, why in (result.get("unavailable") or {}).items():
        receipts.note("not applied: %s (%s)" % (key, why))
    for asset_id, held in sorted((result.get("sources") or {}).items()):   # the textures and materials remember the file too
        if held and asset_id != mesh_id:
            paths.project_relative(held, result.get("projectDir"))
    assets = []
    for item in result["assets"]:
        if item["id"] == mesh_id:
            assets.append(receipts.asset(mesh_id, "static-mesh", stored(result.get("source"), result.get("projectDir"), source), digest))
        else:
            assets.append(receipts.asset(item["id"], item["kind"]))
    return receipts.import_receipt(assets)


def import_textures(cfg, a):
    items = []
    for spec in a.texture:
        role, _, source = spec.partition("=")
        if role not in TEXTURE_ROLES or not source:
            raise AdapterError("invalid", "--texture takes <role>=<file> with role one of %s: %r" % (", ".join(TEXTURE_ROLES), spec))
        items.append(texture_item(cfg, role, source))
    items += [texture_item(cfg, texture_role(source), source) for source in a.source]
    if not items:
        raise AdapterError("invalid", "--kind textures needs at least one file, or --texture <role>=<file>")
    dest = cfg.destination("textures", a.dest)
    lock(cfg, [paths.asset_id(dest, i["name"]) for i in items])
    result, = cli.editor(cfg, "import-textures", [("textures", "import_textures", {"dest": dest, "textures": items, "flipGreen": flip_green(cfg, a.normal_green or "up")})])
    cli.write_details(cfg, a.details, result)
    return receipts.import_receipt([
        receipts.asset(result["textures"][i["name"]]["id"], "texture", stored(result["textures"][i["name"]].get("source"), result.get("projectDir"), i["source"]), i["sha256"])
        for i in items])


def import_skinned(cfg, a):
    if len(a.source) != 1:
        raise AdapterError("invalid", "--kind skinned takes exactly one --source: one skinned mesh per import")
    source, digest = paths.source_stamp(cfg.project, a.source[0])
    side = sidecar(cfg, source)
    skeleton_id = a.skeleton or side.get("skeleton") or cfg.default_skeleton()
    skeleton = cfg.skeleton(skeleton_id)
    prefix = cfg.prefix("skeletalMesh")
    base = cli.asset_name(a.name or side.get("name") or os.path.splitext(os.path.basename(source))[0])
    base = base[len(prefix):] if prefix and base.startswith(prefix) else base
    given_dest = a.dest or side.get("dest")
    dest = given_dest.rstrip("/") if given_dest else cfg.destination("skinned") + "/" + base
    mesh_id = paths.asset_id(dest + "/Meshes", cfg.named("skeletalMesh", base))
    slot_specs = list(a.slot)
    if not slot_specs:
        for slot, value in (side.get("slots") or {}).items():
            slot_specs.append("%s=%s" % (slot, value if isinstance(value, str) else ",".join(value[k] for k in TEXTURE_ROLES)))
    two_sided = a.two_sided or side.get("twoSided") or []
    normal_green = a.normal_green or side.get("normalGreen") or "up"
    textures, instances, slots = [], [], {}
    material_prefix = cfg.prefix("material")
    for spec in slot_specs:
        slot, _, value = spec.partition("=")
        if not slot or not value:
            raise AdapterError("invalid", "--slot takes \"<material slot>=<color>,<normal>,<masks>\" or \"<material slot>=/Game/<material>\": %r" % spec)
        if value.startswith("/"):
            slots[slot] = value
            continue
        files = value.split(",")
        if len(files) != 3:
            raise AdapterError("invalid", "--slot %s needs three maps in order: color, normal, masks" % slot)
        maps = [texture_item(cfg, role, f) for role, f in zip(TEXTURE_ROLES, files)]
        textures += maps
        stem = cli.asset_name(slot)
        stem = stem[len(material_prefix):] if material_prefix and stem.startswith(material_prefix) else stem
        instance = paths.asset_id(dest + "/Materials", cfg.named("materialInstance", stem))
        instances.append({"id": instance, "twoSided": slot in two_sided,
                          "textures": {MATERIAL_KINDS[m["role"]]: paths.asset_id(dest + "/Textures", m["name"]) for m in maps}})
        slots[slot] = instance
    unknown = [s for s in two_sided if s not in slots]
    if unknown:
        raise AdapterError("invalid", "--two-sided names no --slot: %s" % ", ".join(unknown))
    parent = a.parent_material or paths.asset_id(dest + "/Materials", cfg.named("material", base))
    physics_given = a.physics_asset or side.get("physicsAsset")
    physics = None if physics_given == "none" else (physics_given or skeleton.get("physicsAsset"))
    steps = []
    if textures:
        steps.append(("textures", "import_textures", {"dest": dest + "/Textures", "textures": textures, "flipGreen": flip_green(cfg, normal_green)}))
        steps.append(("materials", "import_materials", {"parent": parent, "buildParent": not a.parent_material, "instances": instances}))
    steps.append(("mesh", "import_skinned", {"source": source, "sha256": digest, "dest": dest + "/Meshes", "name": paths.object_name(mesh_id),
                                             "skeleton": skeleton["skeleton"], "physicsAsset": physics, "slots": slots}))
    lock(cfg, [mesh_id] + [i["id"] for i in instances] + [paths.asset_id(dest + "/Textures", t["name"]) for t in textures] + ([] if a.parent_material or not textures else [parent]))
    results = cli.editor(cfg, "import-skinned", steps)
    cli.write_details(cfg, a.details, dict(zip([s[0] for s in steps], results)))
    unsaved = [step[0] for step, result in zip(steps, results) if result.get("saved") is not True]
    if unsaved:
        raise AdapterError("save-failed", "the editor did not save every asset of the %s step%s for %s" % (" and ".join(unsaved), "s" if len(unsaved) > 1 else "", mesh_id),
                           fix="look at the editor's log for the save error (a read-only or locked file), fix it, and import again")
    if textures and results[1].get("notCompiled"):
        receipts.note("%s was saved without compiling its shaders: this editor has no renderer; they compile where it is next rendered" % parent)
    mesh = results[-1]
    if paths.package_of(mesh.get("skeleton") or "") != paths.package_of(skeleton["skeleton"]):
        raise AdapterError("wrong-skeleton", "%s was imported on %s, not on %s" % (mesh_id, mesh.get("skeleton"), skeleton["skeleton"]),
                           fix="the importer ignored the skeleton option: see docs/import.md, \"Skinned mesh\"")
    assets = [receipts.asset(mesh_id, "skeletal-mesh", stored(mesh.get("source"), mesh.get("projectDir"), source), digest)]
    if textures:
        reported = results[0]["textures"]
        assets += [receipts.asset(reported[t["name"]]["id"], "texture", stored(reported[t["name"]].get("source"), results[0].get("projectDir"), t["source"]), t["sha256"]) for t in textures]
        if not a.parent_material:
            assets.append(receipts.asset(parent, "material"))
        assets += [receipts.asset(i["id"], "material-instance") for i in instances]
    return receipts.import_receipt(assets)


def import_animation(cfg, a):
    if len(a.source) != 1:
        raise AdapterError("invalid", "--kind animation takes exactly one clip file")
    if not a.target:
        raise AdapterError("invalid", "--kind animation needs --target: the skeleton or skeletal mesh already in the project that the clip plays on",
                           fix="pass --target /Game/<folder>/<asset>")
    source, digest = paths.source_stamp(cfg.project, a.source[0])
    if not source.lower().endswith(".glb"):
        raise AdapterError("invalid", "%s: an animation clip is imported from a .glb file" % source, fix="export the clip as glTF binary with its skinned rig")
    facts = gltf.clip_facts(paths.absolute(cfg.project, source))
    side = sidecar(cfg, source)
    base = cli.asset_name(a.name or side.get("name") or os.path.splitext(os.path.basename(source))[0])
    prefix = cfg.prefix("animSequence")
    base = base[len(prefix):] if prefix and base.startswith(prefix) else base
    dest = cfg.destination("animation", a.dest or side.get("dest"))
    name = cfg.named("animSequence", base)
    # The importer names one animation after `name`, several as `name` followed by each animation's own name.
    planned = [paths.asset_id(dest, name)] if len(facts["animations"]) == 1 else [paths.asset_id(dest, name + cli.asset_name(n)) for n in facts["animations"]]
    lock(cfg, planned)
    result, = cli.editor(cfg, "import-animation", [("animation", "import_animation", {
        "source": source, "sha256": digest, "target": paths.package_of(a.target), "joints": [gltf.unreal_name(j) for j in facts["joints"]], "dest": dest, "name": name,
        "planned": planned, "run": a.run})])
    cli.write_details(cfg, a.details, result)
    if result.get("saved") is not True:
        raise AdapterError("save-failed", "the editor imported %s but did not save every sequence (%s)" % (source, ", ".join(item["id"] for item in result.get("assets") or [])),
                           fix="look at the editor's log for the save error (a read-only or locked file), fix it, and import again")
    for path in result.get("other") or []:
        receipts.note("the import also made %s, which is not an animation" % path)
    return receipts.import_receipt([
        receipts.asset(item["id"], "animation-sequence", stored(item.get("source"), result.get("projectDir"), source), digest, item["skeleton"])
        for item in result["assets"]])


def import_audio(cfg, a):
    if not a.source:
        raise AdapterError("invalid", "--kind audio needs at least one --source")
    if a.name and len(a.source) != 1:
        raise AdapterError("invalid", "--name applies to a single --source")
    dest = cfg.destination("audio", a.dest)
    items = []
    for given in a.source:
        source, digest = paths.source_stamp(cfg.project, given)
        name = cfg.named("soundWave", cli.asset_name(a.name or os.path.splitext(os.path.basename(source))[0]))
        items.append({"source": source, "sha256": digest, "asset": paths.asset_id(dest, name)})
    lock(cfg, [i["asset"] for i in items])
    result, = cli.editor(cfg, "import-audio", [("audio", "import_audio", {"items": items})])
    cli.write_details(cfg, a.details, result)
    by_id = {s["id"]: s for s in result["sounds"]}
    return receipts.import_receipt([
        receipts.asset(i["asset"], "sound-wave", stored(by_id[i["asset"]].get("source"), result.get("projectDir"), i["source"]), i["sha256"]) for i in items])


def import_audio_variants(cfg, a):
    if not a.source and not a.variant:
        raise AdapterError("invalid", "--kind audio-variants needs the takes' files, or --variant <sound wave id> for takes already imported")
    patch = cfg.option("audio", "variantPatch")
    toolsets = cfg.option("audio", "toolsets")
    if not patch or not isinstance(toolsets, dict) or not all(toolsets.get(k) for k in ("authoring", "inspection", "discovery")):
        raise AdapterError("missing-config", "random-variant sources need the project's shared patch and the editor's MetaSound toolset names",
                           fix="set engine.facts.extra.audio.variantPatch and engine.facts.extra.audio.toolsets in jam.config.json (docs/audio.md)")
    if a.asset:
        asset = paths.package_of(a.asset)
    else:
        # several files are several takes of one sound: the sound is named after the folder that holds them
        folder = os.path.basename(os.path.dirname(paths.portable(a.source[0]))) if a.source else None
        name = a.name or folder
        if not name:
            raise AdapterError("invalid", "name the variant source with --asset /Game/<folder>/<Name> or --name <Name>")
        asset = paths.asset_id(cfg.destination("audio", a.dest), cfg.named("soundSource", cli.asset_name(name)))
    paths.asset_file(asset, cfg.facts)
    waves = []
    if a.source:
        name, a.name = a.name, None
        waves = import_audio(cfg, a)["assets"]
        a.name = name
    lock(cfg, [asset])
    variants = ["%s.%s" % (paths.package_of(v), paths.object_name(v)) for v in [w["id"] for w in waves] + a.variant]
    result, = cli.editor(cfg, "import-variants", [("variants", "audio_variants", {
        "asset": asset, "variants": variants, "patch": patch, "toolsets": toolsets, "author": cfg.option("audio", "author")})])
    cli.write_details(cfg, a.details, result)
    return receipts.import_receipt(waves + [receipts.asset(asset, "sound-source")])


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="engine_import.py", description="Import delivered files into the Unreal project.")
    p.add_argument("--kind", required=True, choices=KINDS)
    p.add_argument("files", nargs="*")
    p.add_argument("--source", action="append", default=[])
    p.add_argument("--texture", action="append", default=[])
    p.add_argument("--slot", action="append", default=[])
    p.add_argument("--two-sided", action="append", default=[])
    p.add_argument("--variant", action="append", default=[])
    p.add_argument("--destination", "--dest", dest="dest")  # --destination is what jam passes
    for flag in ("--name", "--skeleton", "--target", "--parent-material", "--physics-asset", "--asset", "--details", "--run"):
        p.add_argument(flag)
    p.add_argument("--normal-green", choices=("up", "down"))
    p.add_argument("--collision-complexity", choices=("simple-and-complex",))
    a = p.parse_args(argv)
    a.source = a.source + a.files
    return {"static": import_static, "textures": import_textures, "skinned": import_skinned, "animation": import_animation, "audio": import_audio,
            "audio-variants": import_audio_variants}[a.kind](cfg, a)


if __name__ == "__main__":
    cli.run(build)
