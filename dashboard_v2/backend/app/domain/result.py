"""ToolResult — the single outcome shape for every action/tool/MCP call (DESIGN.md §3, §11).

Expected, user-facing failures (host offline, no MAC, SSH auth) are returned as a ToolResult
with `state ∈ {ERROR, DENIED, TIMEOUT}` and a clear `summary` — *data*, not exceptions, so the
UI and (later) the agent can read and react. Unexpected exceptions are caught at the service
boundary and normalized into this same shape. `output` is already redacted + truncated before
it lands here (never raw secrets).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.domain.enums import RunState


class Artifact(BaseModel):
    """A file produced by a tool (e.g. captions .json) offered for download. Unused in Phase 2
    but part of the result shape so later tools don't reshape ToolResult."""

    name: str
    media_type: str = "application/octet-stream"
    path: str | None = None  # server-side path; the API turns it into a download URL


class ToolResult(BaseModel):
    state: RunState
    summary: str  # one-line, human + agent readable
    data: dict[str, Any] = Field(default_factory=dict)  # structured (UI panels / agent reasoning)
    output: str | None = None  # captured long text (already redacted + truncated)
    error: str | None = None
    artifacts: list[Artifact] = Field(default_factory=list)
    duration_ms: int | None = None

    @property
    def ok(self) -> bool:
        return self.state == RunState.OK
