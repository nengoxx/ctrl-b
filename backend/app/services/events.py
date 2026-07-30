"""EventService — persist every privileged invocation as an `Event` and publish it live.

One write path (SQLite, audit trail) + one live feed (EventBus → `/api/events/stream`), per
DESIGN.md §0.5/§8/§12. `output` is redacted upstream by the action layer before it reaches here;
this service does not handle secrets.

The read (`recent`) is the ONE place a stored row becomes a domain `Event` again, so it is also the one
place that tolerates a row this build cannot fully interpret — see `_origin_kind`/`_decision` for the
Literal columns, and `Event`'s own `actor`/`status` validators for the enum ones. The rule is the same
everywhere: degrade the FIELD, never drop the record — a rollback (D32) is exactly when the history is
worth reading.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import cast, get_args

from app.core.events import EventBus
from app.db import Database
from app.domain.event import UNKNOWN_ORIGIN, DecisionReason, Event, EventOriginKind, OriginKind

#: The attribution vocabularies this build understands, derived from the domain Literals so there is no
#: second list to drift out of sync when a kind is added. `OriginKind` (not `EventOriginKind`) on purpose:
#: these are the values a build can have WRITTEN — anything else, sentinel included, lands in the
#: `UNKNOWN_ORIGIN` arm below, which is where a stored `unknown` belongs anyway.
_ORIGIN_KINDS: frozenset[str] = frozenset(get_args(OriginKind))
_DECISIONS: frozenset[str] = frozenset(get_args(DecisionReason))


def _origin_kind(value: object) -> EventOriginKind:
    """A stored `origin` narrowed to the vocabulary this build knows, anything else → `UNKNOWN_ORIGIN`.

    Why lenient here and nowhere else (post-14a review, LOW): `Event`'s fields are Literals, so a single
    row carrying a kind from a NEWER build would raise inside the list comprehension and fail the whole
    `GET /api/events` response — the audit trail going dark on the one occasion you most want to read it.
    Rollback is by tag (D32), so that row is a realistic artifact of a downgrade, not corruption. Degrade
    the one field, keep the history readable. Deliberately NOT symmetric, and the types say so: this
    returns the wider `EventOriginKind`, while `Origin.kind` only accepts `OriginKind` — so the gate
    cannot stamp a sentinel even by mistake.
    """
    return cast(OriginKind, value) if isinstance(value, str) and value in _ORIGIN_KINDS else UNKNOWN_ORIGIN


def _decision(value: object) -> DecisionReason | None:
    """A stored `decision` narrowed to the known reasons; anything else (incl. NULL) → `None`, which the
    column already means "no reason recorded". Same rationale as `_origin_kind`."""
    return cast(DecisionReason, value) if isinstance(value, str) and value in _DECISIONS else None


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
                # `str()` rather than `.value`: the fields are typed `Actor | str` for the read side (see
                # `domain/event.py`), and `StrEnum.__str__` IS the value — so this writes the same bytes
                # for a real member and passes an unreadable one through unchanged (a row round-tripped
                # by a downgraded build keeps what it said instead of being rewritten).
                str(event.actor),
                event.action,
                event.target,
                str(event.status),
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
                # 14a carry-forward: `Actor(...)`/`RunState(...)` RAISED on a value this build doesn't
                # know — inside this comprehension, so one row from a newer build blanked the whole audit
                # trail. Handing the raw column to the model instead lets its before-validator narrow it
                # to the enum when it can and keep the text when it can't (skipping the row is not an
                # option for an audit read; neither is inventing an actor it wasn't).
                actor=r["actor"],
                action=r["action"],
                target=r["target"],
                status=r["status"],
                summary=r["summary"],
                output=r["output"],
                origin=_origin_kind(r["origin"]),
                origin_id=r["origin_id"],
                run_id=r["run_id"],
                decision=_decision(r["decision"]),
            )
            for r in rows
        ]


def _parse_ts(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
