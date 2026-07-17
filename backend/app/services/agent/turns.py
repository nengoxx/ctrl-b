"""Per-thread turn-marker registry (ACA Slice 2, D38).

One busy-truth for the chat stack: `app.state.turns: dict[thread_id, TurnHandle]` records the turn
currently owning each thread. Every thread-mutating endpoint (chat, resume, plan, apply, compact,
exec) `reserve()`s the thread's marker synchronously at the top of the handler and `release()`s it
when the turn finishes; a second concurrent turn on the same thread hits `TurnBusy` → HTTP 409.

This is a **registry entry, not a held lock** (the server field consensus: Goose's
`active_prompt_runs`, opencode's `runners` map) — a plain dict on `app.state`, safe under the
single-threaded event loop because `reserve()` does its check-and-set with **no `await`** between the
membership test and the insert (the D38 TOCTOU guarantee). It intentionally replaces the old
`active_turns` int as the busy signal for the rediscovery gates (that gauge missed resume turns —
`count=False` — and stays as telemetry only).

**Cross-slice contract:** Slice 3's `TurnRegistry` extends THIS `TurnHandle` in place with
`task`/`ring`/`seq` (the server-owned durable-turn ring), and Slice 5's steer queue +
optimistic-concurrency hook hang off `turn_id`. Keep the class the single busy-marker shape — do not
fork a parallel record.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

TurnKind = Literal["chat", "resume", "exec", "plan", "apply", "compact"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class TurnHandle:
    """The turn currently owning a thread. `turn_id` (uuid4 hex) correlates logs and is Slice 5's
    optimistic-concurrency key (Goose's `run_id`). Slice 3 extends this SAME dataclass with
    `task`/`ring`/`seq` — see the module cross-slice contract; don't spawn a sibling record."""

    thread_id: str
    kind: TurnKind
    turn_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    started_at: datetime = field(default_factory=_now)


class TurnBusy(Exception):
    """A turn is already running on the thread. Carries the live `TurnHandle` so the caller can
    surface which turn holds it; the endpoints map this to HTTP 409."""

    def __init__(self, handle: TurnHandle) -> None:
        self.handle = handle
        super().__init__(
            f"turn {handle.turn_id} ({handle.kind}) is already running on thread {handle.thread_id}"
        )


def reserve(turns: dict[str, TurnHandle], thread_id: str, kind: TurnKind) -> TurnHandle:
    """Check-and-set the thread's marker **synchronously** — raise `TurnBusy(existing)` if one is
    held, else create + insert + return a fresh `TurnHandle`. There is deliberately NO `await`
    anywhere in here: under the single-threaded loop the membership test and the insert are one
    atomic step, so two concurrent posts to the same thread can't both slip through (D38 TOCTOU)."""
    existing = turns.get(thread_id)
    if existing is not None:
        raise TurnBusy(existing)
    handle = TurnHandle(thread_id=thread_id, kind=kind)
    turns[thread_id] = handle
    return handle


def release(turns: dict[str, TurnHandle], handle: TurnHandle) -> None:
    """Drop the thread's marker, but only if the stored handle **is** this one (identity via
    `turn_id`). A stale release — e.g. a turn that already yielded ownership — must never evict a
    newer turn's marker, so a mismatch is a no-op."""
    current = turns.get(handle.thread_id)
    if current is not None and current.turn_id == handle.turn_id:
        del turns[handle.thread_id]
