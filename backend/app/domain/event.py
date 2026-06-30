"""Event — the single audit record for everything privileged (DESIGN.md §0.5, §8).

Every action invocation writes one Event: it is both the audit trail (persisted in SQLite) and
the live activity feed (published on the in-proc EventBus → `/api/events/stream`). `output` is
redacted before write — SSH passwords / keys never land here.

The field set mirrors the `events` table (db.py migration 1): id, ts, actor, action, target,
status, summary, output.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.domain.enums import Actor, RunState


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    ts: datetime = Field(default_factory=_now)
    actor: Actor
    action: str
    target: str | None = None  # host id / resource the action touched
    status: RunState
    summary: str | None = None
    output: str | None = None  # redacted + truncated upstream
