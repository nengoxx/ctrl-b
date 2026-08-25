"""Tiny filesystem helpers shared across the API + service layers.

`write_text_eol` is the one EOL-preserving atomic text write used by every file-backed editor
(SOUL.md, agent.yaml, SKILL.md, …) and the `skill_manage` tool — so a save never churns an LF file
to CRLF (or vice versa) and a crash mid-write can't truncate the file. Extracted here (7e-f-2) so
the skills file API and the agent self-author tool share one writer instead of each re-deriving it.

`atomic_write_text` is its LF-forcing, fsync'd sibling — the memory-directory writer (D26). It was
`services/agent/memory.py:_atomic_write` until D57 hoisted it here (CORE_MEMORY_PLAN §3, council M7):
tier 1 and the tier-2 corpus both need durable atomic replacement, and `write_text_eol` alone is not
that (no fsync, no dir-fsync). One writer, two callers — never a second copy.

`fsync_dir` is PUBLIC as of D65 (MEDIA_MANAGER_PLAN §3): the media write path's persist ladder ends
with a directory fsync so a freshly linked filename survives a power cut, and that is exactly what
`atomic_write_text` already needed — one helper, two callers, rather than a private one copied out.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path


def write_text_eol(p: Path, text: str) -> None:
    """Atomically write `text` to `p`, preserving the file's existing line ending (LF for a new
    file). Writes a temp sibling then `os.replace`s it into place, so a partial write never leaves a
    truncated file. The caller is responsible for creating `p.parent`."""
    newline = "\r\n" if (p.is_file() and b"\r\n" in p.read_bytes()) else "\n"
    data = text.replace("\r\n", "\n").replace("\n", newline).encode("utf-8")
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, p)


def atomic_write_text(path: Path, content: str) -> None:
    """Write `content` to `path` atomically (D26): temp file in the **same dir** → flush → `os.fsync`
    → `os.replace`, then best-effort parent-dir fsync (POSIX). Same-dir temp keeps `os.replace`/
    `MoveFileEx` atomic on one volume (the silent Windows non-atomic fallback only happens cross-volume).
    Forces LF newlines so memory files stay git-clean across platforms."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".md")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    fsync_dir(path.parent)


def fsync_dir(d: Path) -> None:
    """Best-effort fsync of a directory so a fresh file's name is durable (POSIX). No-op on Windows,
    which doesn't support directory fsync — and the git commit is the durable record regardless."""
    if os.name == "nt":
        return
    try:
        fd = os.open(str(d), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)
