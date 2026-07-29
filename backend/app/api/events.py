"""Events API (Phase 2). `GET /api/events` reads the recent audit trail; `GET /api/events/stream`
is the live SSE feed every recorded Event is published to (DESIGN.md §12).

The same EventBus powers the agent chat stream later; this is the fleet-activity slice. Each SSE
message carries the Event id so a reconnecting client could resume via `Last-Event-ID` (full
replay is a later refinement — the canonical history is always `GET /api/events`).

The stream's CONNECT is also the wake-on-connect trigger (ROADMAP D2-B): opening it means the owner
opened the dashboard. The work is detached + guarded in `services/wake_on_connect`, so this endpoint's
behavior is unchanged for anyone who hasn't flagged a host.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.services import wake_on_connect

router = APIRouter(tags=["events"])

_KEEPALIVE_S = 15.0


@router.get("/events")
async def list_events(request: Request, limit: int = 100) -> list[dict[str, Any]]:
    """Most-recent events first (audit trail)."""
    events = await request.app.state.events.recent(limit)
    return [e.model_dump(mode="json") for e in events]


@router.get("/events/stream")
async def stream_events(request: Request) -> EventSourceResponse:
    """Server-sent stream of live events. Emits a periodic comment keepalive so idle proxies
    (Tailscale Serve) don't drop the connection."""
    bus = request.app.state.event_bus

    async def gen() -> AsyncIterator[dict[str, Any]]:
        # Wake-on-connect (ROADMAP D2-B): this connect IS "the owner opened the dashboard". Detached
        # + guarded inside `schedule`, so it can neither delay the first frame nor fail the stream —
        # a config with no `wake_on_connect` host does nothing at all. See services/wake_on_connect.
        wake_on_connect.schedule(request.app)
        async with bus.subscribe() as queue:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_S)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": ""}
                    continue
                yield {"event": "event", "id": event.id, "data": event.model_dump_json()}

    return EventSourceResponse(gen())
