"""Per-thread steer queue (ACA Slice 5, D41).

`app.state.steer_queues: dict[thread_id, SteerQueue]` holds the mid-turn steers (messages + `!exec`)
submitted while a `chat`/`resume` turn already owns the thread — the D38 409 is upgraded to a 202
enqueue. The queue is **thread-id-keyed on `app.state`** (the `turn_terminals` precedent), NOT hung
off the live-only `TurnHandle` (which is deleted the moment the turn ends): it must outlive any one
turn so a steer queued behind turn A can drain into turn A's loop or spawn turn B. It is **not
busy-state** — every `not app.state.turns` read stays truthful (pinned by an arch test).

`SteerEntry` is a UNIFIED submission object (owner's extend-not-migrate directive: one object grown
with optional fields, not parallel name-keyed maps). It captures the ChatRequest params (minus
thread/stream) at enqueue, and carries BOTH drain semantics:
  - a **mid-loop drain** (into a running turn) contributes its `text` ONLY — `mode`/`agent`/
    `privilege`/`skills` are IGNORED (a steer cannot re-route or escalate a live turn: a stated
    security stance, not an accident);
  - a **turn-end spawn** (drain point B) runs a NEW turn under the entry's OWN captured params
    (`/cloud do X` queued behind a turn spawns on cloud; feeds Slice 6's per-endpoint
    `context_window` resolution its named `mode` dependency).

Wave 1 builds the queue core + the enqueue path (chat/exec endpoints) + the probe/DELETE read side;
the drains (points A and B) land in waves 2–3 — `commit()` is shaped now for wave 2's transactional
persist-then-clear.
"""

from __future__ import annotations

import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from collections.abc import Iterable

SteerKind = Literal["message", "exec"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SteerEntry:
    """One queued steer — a UNIFIED submission object (D41). `text` holds the message text for a
    `message` kind OR the shell command for an `exec` kind (one field, both meanings — the kind
    disambiguates). `mode`/`agent`/`privilege`/`skills` are the ChatRequest params captured at
    enqueue: a mid-loop drain ignores them (text-as-context only); a turn-end spawn runs under them.
    `exec` entries carry no params (the `!` escape hatch has none — see `ExecRequest`)."""

    kind: SteerKind
    text: str
    mode: str | None = None
    agent: str | None = None
    privilege: str | None = None
    skills: list[str] | None = None
    entry_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created_at: datetime = field(default_factory=_now)


class SteerQueueFull(Exception):
    """The thread's steer queue is at capacity (`TurnsCfg.steer_queue_max`). The endpoints map this
    to the same 409 busy detail the old un-queued path returned — an overflow is "still busy"."""

    def __init__(self, thread_id: str, cap: int) -> None:
        self.thread_id = thread_id
        self.cap = cap
        super().__init__(f"steer queue for thread {thread_id} is full (cap {cap})")


@dataclass
class SteerQueue:
    """A thread's FIFO of pending steers. Sync-only (mutated under the single-threaded event loop with
    no `await`, the D38 TOCTOU discipline) — the deque and its helpers never touch the DB. Persistence
    happens at DRAIN (wave 2), gated by `commit()` so the queue clears only AFTER a successful persist:
    un-persisted steer text has exactly ONE home at all times (the queue until commit)."""

    entries: deque[SteerEntry] = field(default_factory=deque)

    def append(self, entry: SteerEntry) -> int:
        """Enqueue `entry` at the tail; return its 1-based position (== the new depth)."""
        self.entries.append(entry)
        return len(self.entries)

    def peek(self) -> list[SteerEntry]:
        """A stable ordered copy of the pending entries (the drain reads this, then `commit()`s)."""
        return list(self.entries)

    def commit(self, ids_or_count: Iterable[str] | int) -> None:
        """Clear entries AFTER a successful persist (wave 2's transactional drain calls this only once
        the persist txn has committed). Accepts either an explicit set of `entry_id`s (remove exactly
        those) or an int count (pop that many from the FRONT, FIFO) — the drain uses whichever it has.
        Shape built now; the running-turn drain (wave 2) is its first caller."""
        if isinstance(ids_or_count, int):
            for _ in range(min(ids_or_count, len(self.entries))):
                self.entries.popleft()
        else:
            drop = set(ids_or_count)
            self.entries = deque(e for e in self.entries if e.entry_id not in drop)

    def remove(self, entry_id: str) -> bool:
        """Drop one entry by id (the DELETE endpoint / a targeted dequeue). True if it was present."""
        for i, e in enumerate(self.entries):
            if e.entry_id == entry_id:
                del self.entries[i]
                return True
        return False

    def pop_all(self) -> list[SteerEntry]:
        """Drain the whole queue and empty it (Stop's harvest, wave 3). Returns the entries in order."""
        drained = list(self.entries)
        self.entries.clear()
        return drained

    def __len__(self) -> int:
        return len(self.entries)


def enqueue(state, thread_id: str, entry: SteerEntry, cap: int) -> int:
    """Append `entry` to the thread's queue (creating it on first use) under the cap. Returns the
    entry's 1-based position. Raises `SteerQueueFull` when the queue already holds `cap` entries — the
    endpoints map that to the 409 busy detail. Synchronous (no `await`): a caller invokes it in the
    same await-free block as the `TurnBusy` catch so there is no orphan window (D38 TOCTOU)."""
    q = state.steer_queues.get(thread_id)
    if q is None:
        q = SteerQueue()
        state.steer_queues[thread_id] = q
    if len(q) >= cap:
        raise SteerQueueFull(thread_id, cap)
    return q.append(entry)
