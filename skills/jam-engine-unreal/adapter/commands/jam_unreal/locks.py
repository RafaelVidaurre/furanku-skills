"""Git LFS locks for engine binaries, which cannot be merged: hold the lock before an editor writes the file.

`mode` comes from the configuration: `off` (the project does not lock), `check` (stop unless this user holds the lock
of every existing file) or `take` (lock existing files this user does not hold yet). A file that does not exist yet
needs no lock.
"""
import json
import os
import subprocess

from .errors import AdapterError


def _git(project, args):
    done = subprocess.run(["git", "-C", project] + args, capture_output=True, text=True, timeout=120,
                          env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
    return done.returncode, done.stdout, done.stderr


def verified(project, git=_git):
    """Locks split by owner, as the LFS server reports them: {"ours": [...], "theirs": [...]}."""
    code, out, err = git(project, ["lfs", "locks", "--verify", "--json"])
    if code != 0:
        raise AdapterError("locks-unavailable", "git lfs locks failed: %s" % (err or out).strip()[-300:],
                           fix="check the remote supports LFS file locking, or set engine.locks to off in jam.local.json")
    try:
        value = json.loads(out or "{}")
    except ValueError:
        value = None
    if not isinstance(value, dict) or not isinstance(value.get("ours"), list) or not isinstance(value.get("theirs"), list):
        raise AdapterError("locks-unavailable", "git lfs locks returned no verified ownership lists")
    return value


def ensure(project, files, mode, git=_git):
    """Make sure this user may write each existing file. Returns the files locked by this call."""
    if mode == "off":
        return []
    if mode not in ("check", "take"):
        raise AdapterError("invalid", "engine.locks must be off, check or take, not %r" % mode)
    existing = [f for f in files if os.path.isfile(os.path.join(project, *f.split("/")))]
    if not existing:
        return []
    state = verified(project, git)
    ours = {entry.get("path") for entry in state["ours"]}
    theirs = {entry.get("path"): (entry.get("owner") or {}).get("name") for entry in state["theirs"]}
    taken = []
    for path in existing:
        if path in theirs:
            raise AdapterError("locked", "%s is locked by %s" % (path, theirs[path] or "another user"),
                               fix="ask them to push and unlock it, then import again")
        if path in ours:
            continue
        if mode == "check":
            raise AdapterError("needs-lock", "%s is not locked by you" % path, fix="git lfs lock %s" % path)
        code, out, err = git(project, ["lfs", "lock", path])
        if code != 0:
            raise AdapterError("lock-failed", "could not lock %s: %s" % (path, (err or out).strip()[-300:]))
        taken.append(path)
    return taken


def deletable(project, files, git=_git):
    """Deleting needs more than writing: each file tracked, committed, unchanged and locked by this user."""
    state = verified(project, git)
    ours = {entry.get("path") for entry in state["ours"]}
    theirs = {entry.get("path") for entry in state["theirs"]}
    for path in files:
        if not os.path.isfile(os.path.join(project, *path.split("/"))):
            raise AdapterError("missing-asset", "not an asset file: %s" % path)
        if path in theirs or path not in ours:
            raise AdapterError("needs-lock", "deleting %s needs your own LFS lock on it" % path, fix="git lfs lock %s" % path)
        if git(project, ["ls-files", "--error-unmatch", "--", path])[0] != 0:
            raise AdapterError("untracked", "%s is not tracked: delete the file directly instead" % path)
        if git(project, ["status", "--porcelain", "--", path])[1].strip():
            raise AdapterError("uncommitted", "save and commit %s before deleting it" % path)
