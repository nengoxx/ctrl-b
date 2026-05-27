"""Central secret redaction (DESIGN.md §0.6, §11). Runs on any captured `output` before it lands
in a ToolResult / Event / log / SSE payload. Phase 2's only in-scope secret is the SSH password,
which the action passes here so a command echo can't leak it. Grows as more secret sources appear.
"""

from __future__ import annotations

from collections.abc import Iterable

_MASK = "••••"


def redact(text: str | None, secrets: Iterable[str | None] = ()) -> str | None:
    """Replace each non-empty secret value in `text` with a mask. Idempotent, order-independent."""
    if not text:
        return text
    for s in secrets:
        if s:
            text = text.replace(s, _MASK)
    return text
