"""Which classes derive from which, as far as the project's own files say, so a field list naming a class also
selects its subclasses.

Two sources, neither needing the engine:
- Blueprint classes: every Blueprint-like asset records `GeneratedClass` and `ParentClass` as Asset Registry tags,
  so the chain through Blueprints in the inventory is known exactly.
- The project's C++ classes: `UCLASS()` declarations in the project's and its plugins' `Source/**/*.h` name their
  parent. The parent's module is not in the header, so it is resolved by its name among the classes the project knows.

An engine class's own parents (PrimaryDataAsset -> DataAsset) are in neither, so a chain stops at the first engine
class; listing an engine class selects what derives from it directly or through project classes.
"""
import glob
import os
import re

from .packages import tag_path

UCLASS = re.compile(r"\bUCLASS\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*class\s+(?:[A-Z0-9_]+_API\s+)?(\w+)(?:\s+final)?\s*:\s*public\s+([\w:]+)")


def reflected_name(cpp):
    """`UItemDefinition` -> `ItemDefinition`, `AWeapon` -> `Weapon`: the name the engine registers a C++ class under."""
    return cpp[1:] if len(cpp) > 1 and cpp[0] in "UA" and cpp[1].isupper() else cpp


def _module_of(header, stop):
    """The module a header belongs to: the nearest folder above it holding `<Module>.Build.cs`."""
    folder = os.path.dirname(header)
    while folder.startswith(stop) and len(folder) >= len(stop):
        found = glob.glob(os.path.join(folder, "*.Build.cs"))
        if found:
            return os.path.basename(found[0])[:-len(".Build.cs")]
        parent = os.path.dirname(folder)
        if parent == folder:
            break
        folder = parent
    return None


def native_parents(project_dir):
    """{"/Script/<Module>.<Class>": "<parent's C++ name, reflected>"} from the UCLASS declarations under the project's
    and its plugins' Source folders."""
    out = {}
    sources = [os.path.join(project_dir, "Source")] + sorted(glob.glob(os.path.join(project_dir, "Plugins", "**", "Source"), recursive=True))
    for source in sources:
        if not os.path.isdir(source):
            continue
        for folder, dirs, files in os.walk(source):
            dirs[:] = sorted(d for d in dirs if d not in ("ThirdParty", "Intermediate", "Binaries"))
            for name in sorted(files):
                if not name.endswith(".h"):
                    continue
                path = os.path.join(folder, name)
                try:
                    with open(path, encoding="utf-8", errors="replace") as f:
                        text = f.read()
                except OSError:
                    continue
                if "UCLASS" not in text:
                    continue
                module = None
                for cls, parent in UCLASS.findall(text):
                    module = module or _module_of(path, source)
                    if module:
                        out["/Script/%s.%s" % (module, reflected_name(cls))] = reflected_name(parent.split("::")[-1])
    return out


def parents(files, project_dir=None, known=(), learned=None):
    """{class path: parent class path} from the inventory's Blueprint tags, the project's C++ headers and `learned`
    (code-class parents an engine run reported). `known` are more class paths (a field list's) a C++ parent's name may
    resolve to."""
    out = dict(learned or {})
    names = {}

    def remember(path):
        if path and path.startswith("/Script/"):
            names.setdefault(path.rsplit(".", 1)[-1], path)

    for path in known:
        remember(path)
    for entry in files.values():
        for asset in entry.get("assets", []):
            remember(asset.get("class"))
            tags = asset.get("tags") or {}
            generated, parent = tag_path(tags.get("GeneratedClass")), tag_path(tags.get("ParentClass"))
            remember(parent)
            remember(tag_path(tags.get("NativeParentClass")))
            if generated and parent and generated != parent:
                out[generated] = parent
    if project_dir:
        native = native_parents(project_dir)
        for path in native:
            remember(path)
        for path, parent in native.items():
            resolved = names.get(parent)
            if resolved and resolved != path:
                out[path] = resolved
    return out


def ancestors(cls, parent_of):
    """The class's parents, nearest first, as far as `parent_of` knows them."""
    out, seen = [], {cls}
    while cls in parent_of:
        cls = parent_of[cls]
        if cls in seen:
            break
        seen.add(cls)
        out.append(cls)
    return out


def expand(selection, parent_of):
    """The field selection with every known subclass of a listed class added. A class under several listed classes
    (itself included) reads the union of their properties; one of them reading all properties makes it read all."""
    out = dict(selection)
    for cls in parent_of:
        listed = [a for a in [cls] + ancestors(cls, parent_of) if a in selection]
        if not listed or listed == [cls]:
            continue
        props = set()
        for a in listed:
            if selection[a] is None:
                props = None
                break
            props |= selection[a]
        out[cls] = props
    return out
