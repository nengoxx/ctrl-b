"""Event — the single audit record for everything privileged (DESIGN.md §0.5, §8).

Every action invocation writes one Event: it is both the audit trail (persisted in SQLite) and
the live activity feed (published on the in-proc EventBus → `/api/events/stream`). `output` is
redacted before write — SSH passwords / keys never land here.

The field set mirrors the `events` table (db.py migrations 1 + 4): id, ts, actor, action, target,
status, summary, output + the attribution quartet (origin, origin_id, run_id, decision).

Attribution (D49 / AUTOMATIONS_PLAN §D-4) answers "who set this in motion, and why was it allowed"
— the questions `actor` alone can't: `actor` is the audit *subject* (AGENT for a loop's tool calls,
whoever the invocation runs as), while `Origin` is the *initiator* of the chain the call belongs to.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.enums import Actor, RunState


def _as_enum(value: object, enum: type[StrEnum]) -> object:
    """`value` as its `StrEnum` member when the vocabulary has it, else unchanged (see `StoredActor`)."""
    if isinstance(value, enum):
        return value
    if isinstance(value, str):
        try:
            return enum(value)
        except ValueError:
            return value  # a row from a build that knew a member this one doesn't — keep the raw text
    return value


#: Who set an invocation in motion — the WRITABLE vocabulary: exactly what a caller may declare at the
#: gate. Records the IMMEDIATE initiator only — an automation's subagent's calls read `subagent`, not
#: `automation` (D-4 "ancestry semantics"): the authoritative "descended from an automation" predicate
#: is a non-null `run_id`, preserved through descendants.
OriginKind = Literal["user_chat", "automation", "subagent", "system"]
#: What a STORED origin may read as: the writable kinds plus the `unknown` sentinel. Two types rather
#: than one wider one (post-14a verify, LOW) so "read-only" is carried by the type system instead of a
#: convention: `Origin.kind` takes `OriginKind`, so `Origin(kind="unknown")` is a `ValidationError` and
#: no code path can mint one — while `Event.origin` and the read coercion accept it.
#:
#: Why the sentinel exists: rollback is by tag (D32), so a downgraded build can legitimately read rows a
#: newer one wrote with an origin kind it has never heard of. The events read boundary degrades those to
#: `unknown` rather than raising — one strange row must not take `GET /api/events` down with it.
EventOriginKind = OriginKind | Literal["unknown"]
#: The sentinel itself, named once (the read boundary and its tests are its only users).
UNKNOWN_ORIGIN: EventOriginKind = "unknown"
#: Why the permission gate let an invocation through (or, for `policy`, why it didn't): `auto` = the
#: risk/privilege decision allowed it outright · `confirmed` = it executed against a confirm token ·
#: `approval` = a persisted D44 approval rule matched · `policy` = the gate DENIED it. The
#: machine-readable column D44's summary-string marker lacked (that marker is unchanged).
DecisionReason = Literal["auto", "confirmed", "approval", "policy"]

#: What a STORED `actor`/`status` may read as (14a carry-forward). The strict enum is what any code path
#: WRITES; a plain `str` is what a row this build cannot interpret degrades to on the way OUT.
#:
#: Same rollback fragility as `origin` above, same rule — one strange row must not take `GET /api/events`
#: down with it — but a different shape, because these are ENUMS: adding an `UNKNOWN` member would make
#: the sentinel mintable at every write site (and `RunState` is shared with live tool results, where an
#: "unreadable" state has no business existing). The union keeps the enums closed and PRESERVES the raw
#: text instead of collapsing it, which for an audit surface is strictly better than a sentinel: the row
#: still says what it actually recorded. `StrEnum` members compare equal to their value, so every existing
#: `event.actor == Actor.AGENT` / status-string consumer is unaffected either way; the read boundary
#: (`services/events.py`) is the only place that mints the `str` arm.
StoredActor = Actor | str
StoredStatus = RunState | str


class Origin(BaseModel):
    """Who initiated an invocation — a frozen value type threaded from the entry point down through
    `ActionService.invoke` (a REQUIRED kwarg there, so a new call site cannot silently mislabel) onto
    `InvocationContext` and every Event it records.

    `id` names the initiator within its kind (an automation's id, a subagent's agent name); `run_id`
    is the automation-run id, PRESERVED through every descendant so the ancestry predicate stays
    transitive however deep a subagent tree goes.
    """

    model_config = {"frozen": True}

    kind: OriginKind
    id: str | None = None
    run_id: str | None = None


#: The interactive-chat default — the origin of a UI action, a `/api/agent` turn and every legacy
#: (pre-migration-4) Event row. Named once so no call site spells the literal.
ORIGIN_USER_CHAT = Origin(kind="user_chat")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    ts: datetime = Field(default_factory=_now)
    #: Written as an `Actor`/`RunState` by every producer (the gate, the exec path, the automation
    #: runner). Typed as the wider `Stored*` union ONLY so the read boundary can hand back a row whose
    #: value this build does not know — see the types' own note. The before-validators below decide the
    #: arm explicitly rather than leaving it to union inference, so a known value is ALWAYS the enum.
    actor: StoredActor
    action: str
    target: str | None = None  # host id / resource the action touched
    status: StoredStatus
    summary: str | None = None
    output: str | None = None  # redacted + truncated upstream
    #: The `Origin` flattened onto the audit row (one column each, matching migration 4) — the shape
    #: a history query filters on. The defaults are exactly what a legacy row backfills to. `origin`
    #: is the WIDER read type: a stored row may degrade to `UNKNOWN_ORIGIN`, which an `Origin` cannot be.
    origin: EventOriginKind = "user_chat"
    origin_id: str | None = None
    run_id: str | None = None
    decision: DecisionReason | None = None  # NULL for a record written outside the permission gate

    @field_validator("actor", mode="before")
    @classmethod
    def _coerce_actor(cls, v: object) -> object:
        """A known value becomes the real `Actor` member; anything else passes through as text.

        Explicit rather than left to pydantic's smart-union inference: for `Actor | str` a plain string
        input could plausibly satisfy either arm, and "user" landing as a bare `str` would silently take
        `.value` away from every consumer. This makes the arm deterministic — enum for the vocabulary,
        text only for what this build cannot read."""
        return _as_enum(v, Actor)

    @field_validator("status", mode="before")
    @classmethod
    def _coerce_status(cls, v: object) -> object:
        return _as_enum(v, RunState)
