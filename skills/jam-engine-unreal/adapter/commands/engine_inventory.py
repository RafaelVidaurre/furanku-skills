#!/usr/bin/env python3
"""Read the project's Unreal content into an inventory file. The adapter's `inventory` command.

    engine_inventory.py --out <project path> [--previous <project path>] [--engine]

Every .uasset and .umap under /Game and under each content plugin is read from its package header, without the
editor; entries of --previous whose file has the same size and modification time are reused as they are. Assets of
the classes `engine.facts.extra.inventory.fields` lists, and of their subclasses, also get their property values
(docs/inventory.md).

--engine starts the editor, through the transport in jam.local.json, for what the files cannot give:
- packages the reader cannot read (another engine version, cooked): the Asset Registry fills in their classes and
  package dependencies (their tags cannot be listed from Python);
- effective property values of the listed classes' assets, inherited and native defaults included
  (`fieldsSource: "engine"`), and the code-class parents that select more subclasses.
Prints {"inventory", "files", "assets", "read", "reused", "removed", "unread"}.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jam_unreal import cli, inventory, paths  # noqa: E402


def build(cfg, argv):
    p = argparse.ArgumentParser(prog="engine_inventory.py")
    p.add_argument("--out", required=True)
    p.add_argument("--previous")
    p.add_argument("--engine", action="store_true")
    a = p.parse_args(argv)
    out = paths.portable(a.out, "--out")
    previous = inventory.read_previous(paths.absolute(cfg.project, paths.portable(a.previous, "--previous")) if a.previous else None, "unreal")
    if not previous:  # reading every file again (--full) keeps the class parents an engine run learned
        learned = inventory.read_previous(paths.absolute(cfg.project, out), "unreal").get("parents")
        previous = {"parents": learned} if learned else None
    run = inventory.Scan(cfg, previous)
    result, counts = run.inventory, run.counts
    unread = sorted(e["id"] for e in result["files"].values() if "unread" in e)
    if a.engine and unread:
        reported, = cli.editor(cfg, "inventory", [("inventory", "inventory", {"roots": [r["id"] for r in result["roots"]], "packages": unread, "tags": {}})])
        inventory.apply_engine(result, reported["packages"])
        counts["unread"] = len([e for e in result["files"].values() if "unread" in e])
    if a.engine and run.listed:
        request = inventory.engine_request(result, run.listed, run.selection, run.parent_of)
        reported, = cli.editor(cfg, "inventory", [("fields", "fields", request)])
        values = reported.get("assets") or {}
        if run.learn(reported.get("parents") or {}):
            # Assets only the engine's class parents select were read without what their files say (property
            # names, soft references, components): ask again for those, now that their files have been read.
            unknown = {item["id"] for item in request["assets"] if not item.get("listed")} & set(values)
            again = [item for item in inventory.engine_request(result, run.listed, run.selection, run.parent_of)["assets"] if item["id"] in unknown]
            if again:
                more, = cli.editor(cfg, "inventory", [("fields", "fields", dict(request, assets=again))])
                values.update(more.get("assets") or {})
        inventory.apply_effective(result, values)
    inventory.write(cfg, out, result)
    return {
        "inventory": out,
        "files": len(result["files"]),
        "assets": sum(len(e.get("assets", [])) for e in result["files"].values()),
        **counts,
    }


if __name__ == "__main__":
    cli.run(build)
