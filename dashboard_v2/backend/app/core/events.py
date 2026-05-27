"""In-process EventBus — pub/sub powering the live activity SSE feed (DESIGN.md §8, §12).

A single bus instance lives on `app.state`. Every recorded Event is published to it; each SSE
client holds a bounded queue subscribed to the bus. Publishing never blocks or fails the action
that produced the event: a full/slow subscriber queue drops the oldest item rather than back-
pressuring the producer (the canonical state is always the persisted Event in SQLite).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.domain.event import Event

_QUEUE_MAXSIZE = 256


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()

    def publish(self, event: Event) -> None:
        """Fan an event out to every subscriber. Non-blocking; drops oldest on a full queue."""
        for q in self._subscribers:
            if q.full():
                try:
                    q.get_nowait()  # shed the oldest so the newest always lands
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(event)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator["asyncio.Queue[Event]"]:
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._subscribers.add(q)
        try:
            yield q
        finally:
            self._subscribers.discard(q)
