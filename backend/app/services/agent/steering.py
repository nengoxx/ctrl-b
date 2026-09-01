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
    #: The staged `attachment_id`s this steer carries (D68 / plan §3, council E7). Sending WHILE
    #: STREAMING is a supported path, so a steer that names files must carry them — dropping them
    #: here would silently lose the owner's photo the moment they sent it a second too early. The
    #: ids stay UNCLAIMED in the queue: the drain claims them into the thread when it persists the
    #: message, which is the only place a thread id is in scope. One more optional field on the
    #: unified submission object, never a parallel id-keyed map (the extend-don't-migrate directive).
    attachments: list[str] = field(default_factory=list)
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

    def appendleft(self, entry: SteerEntry) -> int:
        """Enqueue `entry` at the FRONT; return the new depth (D41 MED-3 requeue). Bypasses the cap — a
        requeue restores an ALREADY-accepted entry (a drain-B head whose spawn prelude raised), it does
        not admit a new submission, so it must not be refused by a full queue."""
        self.entries.appendleft(entry)
        return len(self.entries)

    def peek(self) -> list[SteerEntry]:
        """A stable ordered copy of the pending entries (the drain reads this, then `commit()`s)."""
        return list(self.entries)

    def commit(self, ids_or_count: Iterable[str] | int) -> int:
        """Clear entries AFTER a successful persist (wave 2's transactional drain calls this only once
        the persist txn has committed). Accepts either an explicit set of `entry_id`s (remove exactly
        those) or an int count (pop that many from the FRONT, FIFO) — the drain uses whichever it has.
        Returns the COUNT actually removed (D41 MED-2): drain-B's head commit is load-bearing — a return
        of 0 means the head we peeked is no longer owned by this queue (harvested / DELETEd / the queue
        was popped-and-recreated by a fresh POST), so the caller must NOT spawn a turn from a stale head.

        LOW (D41): a DELETE (`remove`) racing a drain's persist window can report `{removed: true}` for a
        message the drain has ALREADY persisted (the commit here lands just after the remove) — a
        sub-millisecond window, single-user, accepted: the worst case is one entry that both persisted
        AND read back as unsent, not a lost or double-run message."""
        if isinstance(ids_or_count, int):
            n = min(ids_or_count, len(self.entries))
            for _ in range(n):
                self.entries.popleft()
            return n
        drop = set(ids_or_count)
        before = len(self.entries)
        self.entries = deque(e for e in self.entries if e.entry_id not in drop)
        return before - len(self.entries)

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


class SteerSource:
    """The session-facing peek/commit view over ONE thread's steer queue (D41 Drain A, wave 2).

    `AgentSession` consumes this and nothing else — it never reaches into `app.state.steer_queues`, so
    the session stays **registry-ignorant** (the API layer owns the queue registry; the session owns a
    tiny injected port). `peek()` returns a stable ordered copy of the currently-pending entries;
    `commit(entry_ids)` removes EXACTLY those (by id, via `SteerQueue.commit`), so any entry enqueued
    DURING a drain (it wasn't in the peeked snapshot) survives to the next loop top. A missing queue
    (never created / already drained-to-empty) peeks empty and commits to a no-op — the session need
    not know whether a queue exists."""

    def __init__(self, queues: dict[str, SteerQueue], thread_id: str) -> None:
        self._queues = queues
        self._thread_id = thread_id

    def peek(self) -> list[SteerEntry]:
        q = self._queues.get(self._thread_id)
        return q.peek() if q is not None else []

    def commit(self, entry_ids: list[str]) -> int:
        """Remove EXACTLY `entry_ids` from the thread's queue and return the COUNT actually removed
        (D41 FIX 1 — every exec run point claims its entry atomically: `commit([id]) != 1` means the
        entry was DELETEd/harvested since the peek, so the caller must skip it, never run it). A missing
        queue commits to 0. Prunes an emptied queue's registry key (FIX 5 registry-leak sweep)."""
        q = self._queues.get(self._thread_id)
        if q is None:
            return 0
        removed = q.commit(entry_ids)
        prune_if_empty(self._queues, self._thread_id, q)
        return removed


def prune_if_empty(queues: dict[str, SteerQueue], thread_id: str, queue: SteerQueue) -> None:
    """Drop an emptied queue's registry key — but ONLY if the registry still references THIS exact queue
    object (identity guard, D41 FIX 5). A drain/DELETE that empties a queue would otherwise leave an
    empty `SteerQueue` shell keyed on the thread forever; sweeping it here (in the one module helper, not
    scattered at every call site) keeps `app.state.steer_queues` from accumulating dead threads. The
    identity check means a queue a fresh POST recreated between the empty and this call is never clobbered
    (the recreated object is a different instance → the `is` test fails → left intact)."""
    if len(queue) == 0 and queues.get(thread_id) is queue:
        del queues[thread_id]


def steer_source_for(state, thread_id: str) -> SteerSource:
    """Build the `SteerSource` the session drains (D41). Binds `app.state.steer_queues` + `thread_id`
    into the injected view; the API layer calls this when constructing a chat/resume session so the
    session can drain steers without importing the registry."""
    return SteerSource(state.steer_queues, thread_id)


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


def requeue_front(state, thread_id: str, entry: SteerEntry) -> None:
    """Put `entry` back at the FRONT of the thread's queue, CREATING the queue if it vanished (D41
    MED-3). Drain-B's failure path calls this to return a head it had already committed off the queue
    when the spawn prelude (`_auto_route_agent`/`_build_session`/`run_turn`) raised — so the message is
    never lost: it drains at the next opportunity or harvests on Stop. Cap-exempt (via `appendleft`) — a
    requeue restores an already-accepted entry, it doesn't admit a new one."""
    q = state.steer_queues.get(thread_id)
    if q is None:
        q = SteerQueue()
        state.steer_queues[thread_id] = q
    q.appendleft(entry)
