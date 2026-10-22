"""Bounded reads, atomic publication and process-shared ingestion locking."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import tempfile

MAX_STATE_BYTES = 16 * 1024 * 1024


def read_json(path, default):
    try:
        with open(path, "rb") as source:
            raw = source.read(MAX_STATE_BYTES + 1)
    except FileNotFoundError:
        return default
    if len(raw) > MAX_STATE_BYTES:
        raise ValueError("Stored news state exceeds the size limit")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        return default


def atomic_bytes(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        with os.fdopen(fd, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def atomic_json(path, value):
    encoded = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(encoded) > MAX_STATE_BYTES:
        raise ValueError("News state exceeds the publication size limit")
    atomic_bytes(path, encoded)


@contextmanager
def ingestion_lock(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory / ".ingest.lock", "a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError(
                "Another ingestion process is already running"
            ) from error
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
