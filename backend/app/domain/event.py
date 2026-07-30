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
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import Actor, RunState

#: Who set an invocation in motion. Records the IMMEDIATE initiator only — an automation's
#: subagent's calls read `subagent`, not `automation` (D-4 "ancestry semantics"): the authoritative
#: "descended from an automation" predicate is a non-null `run_id`, preserved through descendants.
#:
#: `unknown` is a READ-SIDE SENTINEL, never written by the gate (post-14a review, LOW): rollback is by
#: tag (D32), so a downgraded build can legitimately read rows a newer one wrote with an origin kind
#: this build has never heard of. The events read boundary coerces those to `unknown` rather than
#: raising — one strange row in the audit trail must not take `GET /api/events` down with it. Nothing
#: in `app/` ever constructs it (pinned by `test_attribution_14a.py`).
OriginKind = Literal["user_chat", "automation", "subagent", "system", "unknown"]
#: Why the permission gate let an invocation through (or, for `policy`, why it didn't): `auto` = the
#: risk/privilege decision allowed it outright · `confirmed` = it executed against a confirm token ·
#: `approval` = a persisted D44 approval rule matched · `policy` = the gate DENIED it. The
#: machine-readable column D44's summary-string marker lacked (that marker is unchanged).
DecisionReason = Literal["auto", "confirmed", "approval", "policy"]


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
    actor: Actor
    action: str
    target: str | None = None  # host id / resource the action touched
    status: RunState
    summary: str | None = None
    output: str | None = None  # redacted + truncated upstream
    #: The `Origin` flattened onto the audit row (one column each, matching migration 4) — the shape
    #: a history query filters on. The defaults are exactly what a legacy row backfills to.
    origin: OriginKind = "user_chat"
    origin_id: str | None = None
    run_id: str | None = None
    decision: DecisionReason | None = None  # NULL for a record written outside the permission gate
