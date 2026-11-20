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


def jam_refuse_other_source(asset_id, asset, source, project_dir=None):
    """Refuse to import `source` over `asset`, already at `asset_id`, when the asset was imported from another file (or
    remembers none): a re-import replaces its own source's asset, never another clip's."""
    stored = jam_stored_source(asset, project_dir)
    if stored != source:
        raise RuntimeError("%s exists, imported from %s, not from %s: import this clip under another name, or delete that asset first"
                           % (asset_id, stored or "a file it does not remember", source))


def jam_dirty_packages():
    import unreal
    return sorted(p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
