"""Agent chat API (Phase 4a). Threads CRUD + the streaming chat turn.

`POST /api/agent/chat` streams the turn as SSE (sse-starlette) using the same wire format as the
events feed. It creates a thread on first message (so the client can start with no thread), emits a
`thread` event up front carrying the id, then relays `AgentSession.run_turn`'s events. The turn keeps
running server-side even if the client disconnects mid-stream — the assistant message is persisted
regardless (DESIGN §5.3), so a reconnect re-reads it via `GET /api/threads/{id}/messages`.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sse_starlette.sse import EventSourceResponse

from app.domain.conversation import Message, ToolCallPart, ToolResultPart, Thread
from app.domain.enums import Actor, RunState
from app.domain.plan import Plan
from app.domain.result import ToolResult
from app.runtime import rediscover_integrations
from app.services.agent.planning import TaskPlanInput
from app.services.agent.session import AgentSession

router = APIRouter(tags=["agent"])


class ChatRequest(BaseModel):
    text: str = Field(min_length=1)
    thread_id: str | None = None
    mode: str | None = None  # "local" | "cloud"; None → configured default (4c switches per-msg)
    skills: list[str] = Field(default_factory=list)  # explicit /skill-name invocations (4.5)
    agent: str | None = None  # `/agent <name>` switch (7d); None → the thread's / configured default

    @field_validator("mode")
    @classmethod
    def _known_mode(cls, v: str | None) -> str | None:
        # InferenceCfg.endpoint() treats any non-"local" string as "cloud"; reject junk so a typo'd
        # mode falls back to the configured default instead of silently routing to cloud.
        return v if v in ("local", "cloud") else None


class CompactRequest(BaseModel):
    """Manual `/compact` (4e) — fold the thread's older turns into a summary now."""

    thread_id: str


class ResumeRequest(BaseModel):
    """Resolve a suspended tool call (4b confirm bubble). `decision` is execute|dismiss; execute
    must carry the `confirm_token` from the `tool.permission` event."""

    thread_id: str
    call_id: str
    decision: str = "execute"  # "execute" | "dismiss"
    confirm_token: str | None = None


def _session(
    request: Request, thread: Thread | None = None, agent_name: str | None = None
) -> AgentSession:
    """Build a session, resolving which `AgentDef` drives it. `agent_name` (the per-message `/agent
    <name>` switch, 7d) wins; else the thread's `agent` field (D11); else the configured default. An
    unknown name falls back to the default (resolve_agent is graceful). Resume passes no override, so
    a suspended turn finishes on the thread/default agent — same caveat as the per-message mode (4c)."""
    s = request.app.state
    agent = s.settings.resolve_agent(agent_name or (thread.agent if thread else None))
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        agent,
        skills=getattr(s, "skills", None),
        selector=getattr(s, "skill_selector", None),
    )


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

    # Apply any pending MCP/OpenAPI integration edits at the turn boundary (Phase 7c-b) — before the
    # session reads the toolset, so the registry is rebuilt between turns, never mid-loop.
    if getattr(request.app.state, "integrations_dirty", False):
        await rediscover_integrations(request.app)

    session = _session(request, thread, agent_name=body.agent)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        # Tell the client the thread id first (it may have just been created).
        yield {"event": "thread", "data": json.dumps({"threadId": thread.id, "title": thread.title})}
        request.app.state.active_turns += 1
        try:
            async for ev in session.run_turn(thread, body.text, mode=body.mode, skills=body.skills):
                yield {"event": ev.event, "data": json.dumps(ev.data)}
        finally:
            request.app.state.active_turns -= 1

    return EventSourceResponse(gen())


@router.get("/skills")
async def list_skills(request: Request) -> list[dict[str, Any]]:
    """Discovered skills (4.5) — name/description/allowed_tools for the composer `/skill-name`
    completion + the Conf → Skills panel. Re-scans the skills dir on each call."""
    provider = getattr(request.app.state, "skills", None)
    if provider is None:
        return []
    return [
        {"name": s.name, "description": s.description, "allowed_tools": s.allowed_tools}
        for s in provider.list()
    ]


@router.get("/agents")
async def list_agents(request: Request) -> dict[str, Any]:
    """Configured agent names + the resolved default (7d) — for the composer `/agent <name>` switch
    and a quick reference. The built-in default agent (used when `agents[]` is empty) isn't listed
    here; `default` is the name a bare thread resolves to."""
    s = request.app.state.settings
    return {
        "agents": [a.name for a in s.agents],
        "default": s.resolve_agent(None).name,
    }


@router.post("/agent/compact")
async def compact(body: CompactRequest, request: Request) -> dict[str, Any]:
    """Force context compaction on a thread (manual `/compact`). Returns `{removed, summaryId?,
    truncated?}` — `removed: 0` means nothing was foldable (already compact / within the floor)."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")
    return await _session(request, thread).compact(thread)


class PlanEditRequest(BaseModel):
    """User edit of the working plan from the UI (clicking a step's dot to toggle done). The full
    step list is sent (TodoWrite-style, same as the model's task_plan); validated leniently."""

    thread_id: str
    steps: list[Any] = Field(default_factory=list)


@router.post("/agent/plan")
async def edit_plan(body: PlanEditRequest, request: Request) -> dict[str, Any]:
    """Persist a user edit to the working plan by **updating the latest `task_plan` call + result in
    place** — so the panel re-derives it and the agent sees the change on its next turn (the call's
    `args.steps` is what round-trips into the model's context). If the thread has no plan yet, a
    fresh task_plan pair is appended. Reuses the existing message-history representation (no separate
    plan store), matching the model's own task_plan shape."""
    threads = request.app.state.threads
    messages = request.app.state.messages
    if await threads.get(body.thread_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")

    plan = Plan(steps=TaskPlanInput(steps=body.steps).steps)  # lenient coercion (status/field names)
    steps_dump = [s.model_dump() for s in plan.steps]
    total = len(plan.steps)
    summary = f"plan · {plan.done}/{total} done" if total else "plan cleared"
    result = ToolResult(state=RunState.OK, summary=summary, data={"plan": plan.model_dump()})

    msgs = await messages.list(body.thread_id)
    call_msg = call_part = None
    for m in msgs:
        for p in m.tool_calls():
            if p.tool == "task_plan":
                call_msg, call_part = m, p
    if call_part is not None:
        result_msg = next(
            (m for m in msgs if any(rp.call_id == call_part.call_id for rp in m.tool_results())),
            None,
        )
        call_part.args = {"steps": steps_dump}  # what the model sees next turn
        call_part.state = RunState.OK
        await messages.update(call_msg)
        if result_msg is not None:
            for rp in result_msg.tool_results():
                if rp.call_id == call_part.call_id:
                    rp.result = result
            await messages.update(result_msg)
        return {"plan": plan.model_dump(), "updated": True}

    # No prior plan — append a fresh task_plan pair (user-authored).
    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=body.thread_id,
        role="assistant",
        actor=Actor.USER,
        parts=[ToolCallPart(call_id=call_id, tool="task_plan", args={"steps": steps_dump}, state=RunState.OK)],
    )
    await messages.add(assistant)
    tool_msg = Message(
        thread_id=body.thread_id,
        role="tool",
        actor=Actor.USER,
        parts=[ToolResultPart(call_id=call_id, result=result)],
    )
    await messages.add(tool_msg)
    return {
        "plan": plan.model_dump(),
        "updated": False,
        "messages": [assistant.model_dump(mode="json"), tool_msg.model_dump(mode="json")],
    }


@router.post("/agent/resume")
async def resume(body: ResumeRequest, request: Request) -> EventSourceResponse:
    """Resolve a suspended tool call and continue the turn over a fresh SSE stream (DESIGN §5.3).
    Body: `{thread_id, call_id, decision, confirm_token?}`."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")
    session = _session(request, thread)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        yield {"event": "thread", "data": json.dumps({"threadId": thread.id, "title": thread.title})}
        async for ev in session.resume(thread, body.call_id, body.decision, body.confirm_token):
            yield {"event": ev.event, "data": json.dumps(ev.data)}

    return EventSourceResponse(gen())
