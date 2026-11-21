"""Helpers pasted into editor scripts (`# jam: include editor_shared`). They touch `unreal` only inside functions.

Sources are always named relative to the project and resolved against the editor's own project folder, so an asset
stores a project-relative source whichever machine the editor runs on.
"""
import hashlib
import os


def jam_project_dir():
    import unreal
    return unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())


def jam_source(relative, sha256=None, project_dir=None):
    """Absolute path of a project-relative source in the editor's checkout; its bytes must match the caller's."""
    project_dir = project_dir or jam_project_dir()
    if os.path.isabs(relative) or ".." in relative.replace("\\", "/").split("/"):
        raise RuntimeError("source must be relative to the project: " + relative)
    path = os.path.join(project_dir, *relative.split("/"))
    if not os.path.isfile(path):
        raise RuntimeError("source is missing from the editor's checkout: " + relative)
    if sha256:
        with open(path, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != sha256:
                raise RuntimeError("source differs in the editor's checkout: " + relative)
    return path


def jam_stored_source(asset, project_dir=None):
    """The first source file an asset remembers, relative to the project when it lies inside it; None when it has none."""
    project_dir = project_dir or jam_project_dir()
    try:
        names = [str(n) for n in asset.get_editor_property("asset_import_data").extract_filenames()]
    except Exception:
        return None
    if not names or not names[0]:
        return None
    try:
        relative = os.path.relpath(names[0], project_dir).replace(os.sep, "/")
    except ValueError:      # another drive
        return names[0]
    return names[0] if relative.startswith("..") else relative


JAM_RUN_TAG = "jam.run"


def jam_asset_run(asset):
    """The jam run whose import made `asset` (its `jam.run` metadata tag); None for an asset no run imported."""
    import unreal
    return unreal.EditorAssetLibrary.get_metadata_tag(asset, JAM_RUN_TAG) or None


def jam_mark_run(asset, run):
    """Record on `asset` the jam run that imported it, or clear the record for an import outside a run."""
    import unreal
    if run:
        unreal.EditorAssetLibrary.set_metadata_tag(asset, JAM_RUN_TAG, run)
    else:
        unreal.EditorAssetLibrary.remove_metadata_tag(asset, JAM_RUN_TAG)


def jam_refuse_other_source(asset_id, asset, source, run=None, project_dir=None):
    """Refuse to import `source` over `asset`, already at `asset_id`, when the asset was imported from another file (or
    remembers none) by anything but the same jam run: a re-import replaces its own source's asset, and a later attempt
    of a run replaces what an earlier attempt of that run imported, never another clip's."""
    stored = jam_stored_source(asset, project_dir)
    if stored == source:
        return
    made_by = jam_asset_run(asset)
    if run and made_by == run:
        return
    raise RuntimeError("%s exists, imported from %s%s, not from %s%s: import this clip under another name, or delete that asset first"
                       % (asset_id, stored or "a file it does not remember", " by run %s" % made_by if made_by else "",
                          source, " by run %s" % run if run else ""))


class JamRefusal(RuntimeError):
    """A refusal with the adapter's error code and fix; the command reports it as given instead of as an editor error."""

    def __init__(self, code, message, fix=None):
        RuntimeError.__init__(self, message)
        self.jam_code = code
        self.jam_fix = fix


def jam_refuse_outside_project(sources, made, existed=()):
    """Call before saving. When an asset of this import remembers a source outside the project (`sources`: asset id ->
    jam_stored_source, which leaves such a path absolute), delete the assets in `made` that this import created, leave
    those it reimported (`existed`) unsaved, and refuse with machine-path."""
    outside = {i: s for i, s in sorted(sources.items()) if s and os.path.isabs(s)}
    if not outside:
        return
    import unreal
    deleted = [i for i in made if i not in existed and unreal.EditorAssetLibrary.delete_asset(i)]
    kept = [i for i in made if i in existed]
    fix = "nothing was saved"
    if deleted:
        fix += "; the editor deleted the assets this import created (%s)" % ", ".join(deleted)
    if kept:
        fix += "; %s, imported before, %s reimported and left unsaved: in a running editor do not save %s (restart it to drop the change)" % (
            ", ".join(kept), "was" if len(kept) == 1 else "were", "it" if len(kept) == 1 else "them")
    raise JamRefusal("machine-path", "%s store%s a source outside the project: %s" % (
        ", ".join(outside), "s" if len(outside) == 1 else "", ", ".join(sorted(set(outside.values())))),
        fix=fix + ". Import from a file inside the project checkout, so the stored path is relative to it")


def jam_dirty_packages():
    import unreal
    return sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
