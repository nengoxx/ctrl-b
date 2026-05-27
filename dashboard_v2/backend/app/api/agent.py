"""Agent chat API (Phase 4a). Threads CRUD + the streaming chat turn.

`POST /api/agent/chat` streams the turn as SSE (sse-starlette) using the same wire format as the
events feed. It creates a thread on first message (so the client can start with no thread), emits a
`thread` event up front carrying the id, then relays `AgentSession.run_turn`'s events. The turn keeps
running server-side even if the client disconnects mid-stream — the assistant message is persisted
regardless (DESIGN §5.3), so a reconnect re-reads it via `GET /api/threads/{id}/messages`.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sse_starlette.sse import EventSourceResponse

from app.domain.conversation import Thread
from app.services.agent.session import AgentSession

router = APIRouter(tags=["agent"])


class ChatRequest(BaseModel):
    text: str = Field(min_length=1)
    thread_id: str | None = None
    mode: str | None = None  # "local" | "cloud"; None → configured default (4c switches per-msg)

    @field_validator("mode")
    @classmethod
    def _known_mode(cls, v: str | None) -> str | None:
        # InferenceCfg.endpoint() treats any non-"local" string as "cloud"; reject junk so a typo'd
        # mode falls back to the configured default instead of silently routing to cloud.
        return v if v in ("local", "cloud") else None


class ResumeRequest(BaseModel):
    """Resolve a suspended tool call (4b confirm bubble). `decision` is execute|dismiss; execute
    must carry the `confirm_token` from the `tool.permission` event."""

    thread_id: str
    call_id: str
    decision: str = "execute"  # "execute" | "dismiss"
    confirm_token: str | None = None


def _session(request: Request) -> AgentSession:
    s = request.app.state
    return AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions)


@router.get("/threads")
async def list_threads(request: Request) -> list[dict[str, Any]]:
    return [t.model_dump(mode="json") for t in await request.app.state.threads.list()]


@router.post("/threads")
async def create_thread(request: Request) -> dict[str, Any]:
    thread = await request.app.state.threads.create(Thread())
    return thread.model_dump(mode="json")


@router.get("/threads/{thread_id}/messages")
async def list_messages(thread_id: str, request: Request) -> list[dict[str, Any]]:
    threads = request.app.state.threads
    if await threads.get(thread_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{thread_id}'")
    msgs = await request.app.state.messages.list(thread_id)
    return [m.model_dump(mode="json") for m in msgs]


@router.post("/agent/chat")
async def chat(body: ChatRequest, request: Request) -> EventSourceResponse:
    """Stream one chat turn. Body: `{text, thread_id?, mode?}`. SSE events per DESIGN §12."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id) if body.thread_id else None
    if thread is None:
        thread = await threads.create(Thread(title=body.text[:60]))
    session = _session(request)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        # Tell the client the thread id first (it may have just been created).
        yield {"event": "thread", "data": json.dumps({"threadId": thread.id, "title": thread.title})}
        async for ev in session.run_turn(thread, body.text, mode=body.mode):
            yield {"event": ev.event, "data": json.dumps(ev.data)}

    return EventSourceResponse(gen())


@router.post("/agent/resume")
async def resume(body: ResumeRequest, request: Request) -> EventSourceResponse:
    """Resolve a suspended tool call and continue the turn over a fresh SSE stream (DESIGN §5.3).
    Body: `{thread_id, call_id, decision, confirm_token?}`."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")
    session = _session(request)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        yield {"event": "thread", "data": json.dumps({"threadId": thread.id, "title": thread.title})}
        async for ev in session.resume(thread, body.call_id, body.decision, body.confirm_token):
            yield {"event": ev.event, "data": json.dumps(ev.data)}

    return EventSourceResponse(gen())
