"""Tiny filesystem helpers shared across the API + service layers.

`write_text_eol` is the one EOL-preserving atomic text write used by every file-backed editor
(SOUL.md, agent.yaml, SKILL.md, …) and the `skill_manage` tool — so a save never churns an LF file
to CRLF (or vice versa) and a crash mid-write can't truncate the file. Extracted here (7e-f-2) so
the skills file API and the agent self-author tool share one writer instead of each re-deriving it.
"""

from __future__ import annotations

import os
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
