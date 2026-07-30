"""EventService — persist every privileged invocation as an `Event` and publish it live.

One write path (SQLite, audit trail) + one live feed (EventBus → `/api/events/stream`), per
DESIGN.md §0.5/§8/§12. `output` is redacted upstream by the action layer before it reaches here;
this service does not handle secrets.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.core.events import EventBus
from app.db import Database
from app.domain.enums import Actor, RunState
from app.domain.event import Event


class EventService:
    def __init__(self, db: Database, bus: EventBus) -> None:
        self._db = db
        self._bus = bus

    async def record(self, event: Event) -> Event:
        """Persist + publish. Returns the event (id/ts already populated by the model)."""
        await self._db.execute(
            "INSERT INTO events "
            "(id, ts, actor, action, target, status, summary, output, origin, origin_id, run_id, decision) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event.id,
                event.ts.isoformat(),
                event.actor.value,
                event.action,
                event.target,
                event.status.value,
                event.summary,
                event.output,
                event.origin,
                event.origin_id,
                event.run_id,
                event.decision,
            ),
        )
        self._bus.publish(event)
        return event

    async def recent(self, limit: int = 100) -> list[Event]:
        rows = await self._db.query(
            "SELECT id, ts, actor, action, target, status, summary, output, "
            "origin, origin_id, run_id, decision "
            "FROM events ORDER BY ts DESC LIMIT ?",
            (max(1, min(limit, 500)),),
        )
        return [
            Event(
                id=r["id"],
                ts=_parse_ts(r["ts"]),
                actor=Actor(r["actor"]),
                action=r["action"],
                target=r["target"],
                status=RunState(r["status"]),
                summary=r["summary"],
                output=r["output"],
                origin=r["origin"],
                origin_id=r["origin_id"],
                run_id=r["run_id"],
                decision=r["decision"],
            )
            for r in rows
        ]


def _parse_ts(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
