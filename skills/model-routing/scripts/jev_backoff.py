"""Credential-scoped admission and cooldown shared by Jev CLI processes."""

from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import random
import stat
import tempfile
import time

if os.name == "nt":
    import msvcrt
else:
    import fcntl


class Busy(Exception):
    pass


class StorageError(Exception):
    pass


def lock_file(stream):
    if os.name == "nt":
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def unlock_file(stream):
    if os.name == "nt":
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class Cooldown:
    def __init__(self, path):
        self.path = path
        if path.is_symlink():
            raise StorageError()
        self.state = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(self.state, dict):
            raise StorageError()
        failures = self.state.get("failures", 0)
        retry_at = self.state.get("retry_at", 0)
        if (type(failures) is not int or not 0 <= failures <= 64
                or type(retry_at) not in (int, float) or not math.isfinite(retry_at) or retry_at < 0):
            raise StorageError()

    def remaining(self):
        return max(0, self.state.get("retry_at", 0) - time.time())

    def save(self):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile("w", dir=self.path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                os.fchmod(stream.fileno(), 0o600)
                json.dump(self.state, stream, allow_nan=False)
            os.replace(temporary, self.path)
        except OSError:
            raise StorageError() from None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def limited(self, server_delay, diagnostics):
        failures = min(64, self.state.get("failures", 0) + 1)
        ceiling = min(60, 2 ** min(failures, 6))
        delay = server_delay if server_delay is not None else random.uniform(ceiling / 2, ceiling)
        self.state = {"failures": failures, "retry_at": time.time() + delay,
                      "delay_source": "server" if server_delay is not None else "exponential_backoff",
                      "diagnostics": diagnostics}
        self.save()
        return delay

    def success(self):
        if self.state:
            self.state = {}
            self.save()


@contextmanager
def admission(key, endpoint):
    root = Path.home() / ".furanku-skills/model-routing/gateway-backoff"
    fingerprint = hashlib.sha256((endpoint + "\0" + key).encode()).hexdigest()
    stream = None
    acquired = False
    try:
        if root.is_symlink():
            raise StorageError()
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        lock = root / (fingerprint + ".lock")
        fd = os.open(lock, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        stream = os.fdopen(fd, "r+b")
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise StorageError()
        try:
            lock_file(stream)
            acquired = True
        except (BlockingIOError, PermissionError):
            raise Busy() from None
        if os.fstat(fd).st_size == 0:
            stream.write(b"0")
            stream.flush()
        cooldown = Cooldown(root / (fingerprint + ".json"))
    except (OSError, ValueError, UnicodeError):
        if acquired:
            unlock_file(stream)
        if stream is not None:
            stream.close()
        raise StorageError() from None
    except (Busy, StorageError):
        if acquired:
            unlock_file(stream)
        if stream is not None:
            stream.close()
        raise
    try:
        yield cooldown
    finally:
        unlock_file(stream)
        stream.close()
