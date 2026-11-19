"""Previews of the project's Unreal content for the catalog: one viewable file per package, made for the package's
current version and indexed by its project path (the toolkit's engine-previews schema). docs/previews.md says what
each class gets.

A package's version is its inventory `hash` (the package's own SavedHash, or its legacy guid), else size:mtime. A
preview is made again only when the version changed, or when a thumbnail stands in for an engine preview the engine
can now make. Thumbnails stored in packages are read here without the editor; everything else is made by
`editor/previews.py` in one editor process per batch, which needs a renderer for the baked materials.
"""
import datetime
import json
import os
import re
import struct

from . import cli
from .errors import AdapterError, Handoff
from .packages import Unreadable
from .thumbnails import main_thumbnail

INDEX = "index.json"
BATCH = 200             # packages per editor process: bounds its memory and keeps each call under the transport timeout
MAX_CRASHES = 3         # editor processes that may stop early in one run before the rest is left waiting
PREVIEW_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|glb|wav)$")

# Class of the package's main asset -> how the editor makes its preview.
METHODS = {
    "/Script/Engine.Texture2D": "texture",
    "/Script/Engine.StaticMesh": "gltf",
    "/Script/Engine.SkeletalMesh": "gltf",
    "/Script/Engine.Material": "gltf",
    "/Script/Engine.MaterialInstanceConstant": "gltf",
    "/Script/Engine.AnimSequence": "gltf",
    "/Script/Engine.Skeleton": "preview-mesh",
    "/Script/Engine.Blueprint": "actor",
    "/Script/Engine.SoundWave": "wav",
}
EXTENSIONS = {"texture": "png", "gltf": "glb", "preview-mesh": "glb", "actor": "glb", "wav": "wav"}
KINDS = {"png": "image", "jpg": "image", "glb": "model", "wav": "audio"}
HOW = {
    "texture": "the texture's source image",
    "gltf": "glTF export, materials baked",
    "preview-mesh": "glTF export of its preview mesh",
    "actor": "glTF export of the actor's components",
    "wav": "the sound's source audio",
    "thumbnail": "the thumbnail stored in the package",
}


def js_number(value):
    """A number as JavaScript prints it, so a version made here equals the toolkit's."""
    value = float(value)
    return str(int(value)) if value.is_integer() else repr(value)


def version(entry):
    return entry.get("hash") or "%s:%s" % (js_number(entry["size"]), js_number(entry["mtimeMs"]))


def file_stem(text):
    return re.sub(r"[^A-Za-z0-9._-]", "-", text)


def glob(pattern):
    """`**` any depth, `*` within one folder; matched against the whole project path, as the catalog does."""
    parts = ["[^/]*".join(re.escape(text) for text in part.split("*")) for part in pattern.split("**")]
    return re.compile("^" + ".*".join(parts) + "$")


def main_class(entry):
    return next((a["class"] for a in entry.get("assets", []) if a["id"] == entry.get("main")), None)


def read_index(path, adapter_id="unreal"):
    """The previous index's entries by project path; nothing when it is missing, unreadable or another adapter's."""
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(value, dict) or value.get("format") != 1 or value.get("adapter") != adapter_id or not isinstance(value.get("files"), dict):
        return {}
    return value["files"]


def glb_meshes(path):
    """How many meshes a GLB holds, or None when the file is not one."""
    try:
        with open(path, "rb") as f:
            head = f.read(20)
            if len(head) < 20 or head[:4] != b"glTF":
                return None
            length, kind = struct.unpack("<II", head[12:20])
            if kind != 0x4E4F534A:
                return None
            return len(json.loads(f.read(length)).get("meshes", []))
    except (OSError, ValueError, struct.error):
        return None


class Previews:
    """One run: decides what each package needs, writes stored thumbnails, sends the rest to the editor, and keeps the
    index and the folder in step."""

    def __init__(self, cfg, inventory, out, full=False, engine=True, only=(), limit=None, editor=None):
        self.cfg = cfg
        self.inventory = inventory
        self.out = out
        self.dir = os.path.join(cfg.project, *out.split("/"))
        self.previous = read_index(os.path.join(self.dir, INDEX), inventory.get("adapter", "unreal"))
        self.full = full
        self.engine = engine
        self.only = [glob(p) for p in only]
        self.limit = limit
        self.editor = editor
        self.files = {}
        self.counts = {"made": 0, "reused": 0, "failed": 0, "waiting": 0, "none": 0}
        self.timing = {}    # method -> [packages, seconds in the editor]
        self.details = []   # every editor result of this run, written to the work folder for a person

    # ---- deciding
    def _settled(self, old, method):
        """Whether the previous entry for this version is as good as this run can make."""
        if old.get("file") is None:
            return bool(old.get("failed")) and method is not None and old.get("how") == HOW[method]    # tried this way already
        if not os.path.isfile(os.path.join(self.dir, old["file"])):
            return False
        return method is None or old.get("how") == HOW[method] or bool(old.get("failed")) or not self.engine

    def _stored(self, path, entry):
        try:
            return main_thumbnail(os.path.join(self.cfg.project, *path.split("/")), entry["main"])
        except (OSError, Unreadable):
            return None

    def _write(self, path, v, ext, data, how, failed=None):
        name = "%s.%s" % (file_stem(v), ext)
        with open(os.path.join(self.dir, name), "wb") as f:
            f.write(data)
        self.files[path] = dict({"version": v, "file": name, "kind": KINDS[ext], "how": how}, **({"failed": failed} if failed else {}))

    def plan(self):
        """Fill what needs no editor; return the editor's jobs."""
        os.makedirs(self.dir, exist_ok=True)
        jobs = []
        for path, entry in sorted(self.inventory["files"].items()):
            if "unread" in entry or not entry.get("main"):
                continue
            old = self.previous.get(path)
            if self.only and not any(p.match(path) for p in self.only):
                if old:
                    self.files[path] = old
                continue
            v, method = version(entry), METHODS.get(main_class(entry))
            if not self.full and old and old.get("version") == v and self._settled(old, method):
                self.files[path] = old
                self.counts["reused" if old.get("file") else "failed"] += 1
                continue
            thumbnail = self._stored(path, entry)
            if method is None:
                if thumbnail:
                    self._write(path, v, thumbnail[0], thumbnail[1], HOW["thumbnail"])
                    self.counts["made"] += 1
                else:
                    self.counts["none"] += 1
                continue
            if self.engine and (self.limit is None or len(jobs) < self.limit):
                jobs.append({"path": path, "asset": entry["main"], "method": method, "version": v, "thumbnail": thumbnail,
                             "file": os.path.join(self.dir, "%s.%s" % (file_stem(v), EXTENSIONS[method]))})
                continue
            self.counts["waiting"] += 1
            if thumbnail:
                self._write(path, v, thumbnail[0], thumbnail[1], HOW["thumbnail"])
                self.counts["made"] += 1
            elif old and old.get("file"):
                self.files[path] = old      # an older version's preview stays shown until the engine makes the new one
        return jobs

    # ---- the editor
    def _apply(self, job, result):
        spent = self.timing.setdefault(job["method"], [0, 0.0])
        spent[0] += 1
        spent[1] += float(result.get("seconds") or 0)
        self.details.append(dict(result, method=job["method"]))
        error = result.get("error")
        if not error:
            target = job["file"]
            if not os.path.isfile(target) or os.path.getsize(target) == 0:
                error = "the editor reported success but wrote no file"
            elif target.endswith(".glb"):
                meshes = glb_meshes(target)
                error = "the export is not a GLB" if meshes is None else "the export holds no mesh: nothing to show" if meshes == 0 else None
            if error and os.path.isfile(target):
                os.remove(target)
        if error:
            self.counts["failed"] += 1
            if job["thumbnail"]:
                self._write(job["path"], job["version"], job["thumbnail"][0], job["thumbnail"][1], HOW["thumbnail"], failed=error)
            else:
                self.files[job["path"]] = {"version": job["version"], "how": HOW[job["method"]], "failed": error}
            return
        self.counts["made"] += 1
        self.files[job["path"]] = {"version": job["version"], "file": os.path.basename(job["file"]),
                                   "kind": KINDS[EXTENSIONS[job["method"]]], "how": HOW[job["method"]]}

    def run(self, jobs):
        """Send the jobs to the editor in batches. An editor process that stops early costs only the package it was
        on; the next one carries on after it."""
        pending, crashes = list(jobs), 0
        while pending:
            batch = pending[:BATCH]
            progress = os.path.join(self.dir, ".progress.jsonl")
            if os.path.exists(progress):
                os.remove(progress)
            sent = [{k: job[k] for k in ("path", "asset", "method", "file")} for job in batch]
            stopped = None
            try:
                reported, = self.editor(self.cfg, "previews", [("previews", "previews", {"jobs": sent, "progress": progress})], render=True)
                results = {r["path"]: r for r in reported.get("results", [])}
            except Handoff:
                self.save()
                raise
            except AdapterError as error:
                stopped, results = error, _read_progress(progress)
            if os.path.exists(progress):
                os.remove(progress)
            for job in batch:
                if job["path"] in results:
                    self._apply(job, results[job["path"]])
            done = {job["path"] for job in batch if job["path"] in results}
            rest = [job for job in batch if job["path"] not in done]
            if rest:
                # The package the editor was on when it stopped, or one it never reported.
                why = "the editor stopped while making it: %s" % stopped.message[:300] if stopped else "the editor returned no result for it"
                self._apply(rest[0], {"error": why})
                crashes += 1 if stopped else 0
            pending = rest[1:] + pending[len(batch):]
            self.save()
            if crashes >= MAX_CRASHES and pending:
                self.counts["waiting"] += len(pending)
                for job in pending:
                    old = self.previous.get(job["path"])
                    if old and old.get("file"):
                        self.files[job["path"]] = old
                break

    # ---- the folder
    def save(self):
        """Write the index atomically and remove preview files it no longer names."""
        index = {"format": 1, "adapter": self.inventory.get("adapter", "unreal"),
                 "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "files": self.files}
        full = os.path.join(self.dir, INDEX)
        temporary = full + ".tmp-%d" % os.getpid()
        with open(temporary, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=1, sort_keys=True)
        os.replace(temporary, full)
        named = {entry["file"] for entry in self.files.values() if entry.get("file")}
        for name in os.listdir(self.dir):
            if PREVIEW_FILE.match(name) and name not in named:
                os.remove(os.path.join(self.dir, name))

    def write_details(self):
        if self.details:
            cli.write_details(self.cfg, "%s/previews-last-run.json" % self.cfg.work_dir, self.details)

    def receipt(self):
        out = dict({"index": "%s/%s" % (self.out, INDEX), "previews": sum(1 for e in self.files.values() if e.get("file"))}, **self.counts)
        if self.timing:     # beyond the contract: where the editor's time went, by method
            out["editorSeconds"] = {method: {"packages": n, "seconds": round(s, 1)} for method, (n, s) in sorted(self.timing.items())}
        return out


def _read_progress(path):
    """What the editor reported, one JSON line per package, before it stopped."""
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    result = json.loads(line)
                except ValueError:
                    continue
                if isinstance(result, dict) and "path" in result:
                    out[result["path"]] = result
    except OSError:
        pass
    return out


def read_inventory(path):
    try:
        with open(path, encoding="utf-8") as f:
            value = json.load(f)
    except (OSError, ValueError) as e:
        raise AdapterError("invalid", "cannot read the inventory %s: %s" % (path, e), fix="run jam engine inventory first")
    if not isinstance(value, dict) or not isinstance(value.get("files"), dict):
        raise AdapterError("invalid", "%s is not an inventory" % path, fix="run jam engine inventory --full")
    return value
