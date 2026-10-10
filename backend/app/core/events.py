"""In-process EventBus — pub/sub powering the live activity SSE feed (DESIGN.md §8, §12).

A single bus instance lives on `app.state`. Every recorded Event is published to it; each SSE
client holds a bounded queue subscribed to the bus. Publishing never blocks or fails the action
that produced the event: a full/slow subscriber queue drops the oldest item rather than back-
pressuring the producer (the canonical state is always the persisted Event in SQLite).

The bus also carries `ThreadFrame` — a conversation's live status (D84, CONVERSATIONS_PLAN §5): the
SAME queue + the same drop-oldest semantics, never persisted, rendered on the wire as `event: thread`
with no `id` (it is never replayed — a reconnecting client refetches its lists instead).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from pydantic import BaseModel

from app.domain.event import Event

_QUEUE_MAXSIZE = 256

#: A conversation's live states: `running`, the five turn terminals (`TurnHandle.terminal_status`), and
#: `seen` (the owner's `seen_at` moved).
ThreadFrameState = Literal["running", "completed", "suspended", "capped", "error", "cancelled", "seen"]


class ThreadFrame(BaseModel):
    """A conversation's live status (D84 / CONVERSATIONS_PLAN §5, DESIGN §12) — never persisted.

    `agent` is the conversation's HOME agent (`Thread.agent`), never the responder. `chained` = a
    drain-B steer turn was spawned behind this terminal (the client notifies on that turn's own frames
    instead). `turn_id` is `None` on a `seen` frame. Every frame is built by ONE producer,
    `app.api.agent._publish_thread_frame`, which drops archived threads."""

    thread_id: str
    state: ThreadFrameState
    turn_id: str | None = None
    agent: str | None = None
    chained: bool = False


#: What the bus carries — a persisted `Event` or a non-persisted `ThreadFrame`.
BusItem = Event | ThreadFrame


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[BusItem]] = set()

    def publish(self, event: BusItem) -> None:
        """Fan an item out to every subscriber. Non-blocking; drops oldest on a full queue."""
        for q in self._subscribers:
            if q.full():
                try:
                    q.get_nowait()  # shed the oldest so the newest always lands
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(event)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator["asyncio.Queue[BusItem]"]:
        q: asyncio.Queue[BusItem] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._subscribers.add(q)
        try:
            yield q
        finally:
            self._subscribers.discard(q)
