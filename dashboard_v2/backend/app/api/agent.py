"""Agent chat API (Phase 4a). Threads CRUD + the streaming chat turn.

`POST /api/agent/chat` streams the turn as SSE (sse-starlette) using the same wire format as the
events feed. It creates a thread on first message (so the client can start with no thread), emits a
`thread` event up front carrying the id, then relays `AgentSession.run_turn`'s events. The turn keeps
running server-side even if the client disconnects mid-stream — the assistant message is persisted
regardless (DESIGN §5.3), so a reconnect re-reads it via `GET /api/threads/{id}/messages`.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, field_validator
from sse_starlette.sse import EventSourceResponse

from app.config import deep_merge
from app.domain.agent import AgentDef
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
    unknown name falls back to the default (resolve_agent is graceful). Resume passes the last
    assistant turn's `agent` here (D15 #5) so a suspended turn finishes on the agent that started it;
    the per-message mode (4c) is still not carried across the confirm round-trip."""
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
        memory=getattr(s, "memory", None),
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


@router.get("/agent/default-prompt")
async def get_default_prompt() -> dict[str, str]:
    """The baked `DEFAULT_SYSTEM_PROMPT` text (7e-a). The Conf editor uses this to back
    `[Load default]` (pre-fill the override field with a copy) and `[Restore default]` (clear
    the override → the loop falls back to baked at runtime). Removes the "blank = mystery" UX
    of the empty override field."""
    from app.services.agent.session import DEFAULT_SYSTEM_PROMPT
    return {"text": DEFAULT_SYSTEM_PROMPT}


@router.get("/agents")
async def list_agents(request: Request) -> dict[str, Any]:
    """Discovered specialist agent names + the resolved default (7d/D14) — for the composer
    `/agent <name>` switch and a quick reference. Names come from `agents/<name>/` folders; the
    default/root agent isn't listed (`default` is what a bare thread resolves to)."""
    s = request.app.state.settings
    return {
        "agents": s.list_agent_names(),
        "default": s.resolve_agent(None).name,
    }


#: A skill folder name: lowercase slug, no path separators — guards the file CRUD below against
#: traversal (the name becomes `skills_dir/<name>/SKILL.md`).
_SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

#: Scaffold for a brand-new skill so the editor opens with valid frontmatter, not a blank file.
_SKILL_TEMPLATE = (
    "---\n"
    "name: {name}\n"
    "description: When to use this skill (the selector matches the user message against this).\n"
    "# allowed_tools: [ping_host, wake_host]   # optional — narrows the toolset while active\n"
    "---\n\n"
    "Instructions for the agent when this skill is active.\n"
)


class SkillContent(BaseModel):
    content: str = ""


def _skill_md_path(request: Request, name: str) -> Path:
    """Resolve `skills_dir/<name>/SKILL.md`, validating the name (422 on a bad/unsafe slug)."""
    if not _SKILL_NAME.match(name):
        raise HTTPException(
            status_code=422, detail="invalid skill name (lowercase letters, digits, '-' or '_')"
        )
    return request.app.state.settings.skills_dir_path() / name / "SKILL.md"


@router.get("/skills/{name}")
async def get_skill(name: str, request: Request) -> dict[str, Any]:
    """The raw `SKILL.md` text for the editor (7d). 404 if the skill doesn't exist; a fresh name
    returns the scaffold template so the editor opens populated."""
    p = _skill_md_path(request, name)
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"unknown skill '{name}'")
    return {"name": name, "content": p.read_text(encoding="utf-8")}


@router.put("/skills/{name}")
async def put_skill(name: str, body: SkillContent, request: Request) -> dict[str, Any]:
    """Create or overwrite `skills/<name>/SKILL.md` (7d). The FileSkillProvider re-scans per call, so
    a save is live with no restart. Blank content → the scaffold template (used by 'add skill')."""
    p = _skill_md_path(request, name)
    p.parent.mkdir(parents=True, exist_ok=True)
    content = body.content if body.content.strip() else _SKILL_TEMPLATE.format(name=name)
    # Write bytes with the file's existing EOL (LF default for a new file) to avoid CRLF churn.
    newline = "\r\n" if (p.is_file() and b"\r\n" in p.read_bytes()) else "\n"
    p.write_bytes(content.replace("\r\n", "\n").replace("\n", newline).encode("utf-8"))
    return {"name": name, "content": content}


@router.delete("/skills/{name}")
async def delete_skill(name: str, request: Request) -> dict[str, Any]:
    """Remove a skill's `SKILL.md` (7d) and its folder if it's left empty (resource files the owner
    dropped in are preserved — only an empty folder is cleaned up). Idempotent: 404 if not present."""
    p = _skill_md_path(request, name)
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"unknown skill '{name}'")
    p.unlink()
    try:
        p.parent.rmdir()  # only succeeds when empty — keep any sibling resources
    except OSError:
        pass
    return {"name": name, "deleted": True}


# ── Agents file API (Phase 7e-c, D14) ─────────────────────────────────────────────────────────
# Agents are folder-only: `$CTRLB_HOME/agents/<name>/` = `agent.yaml` (overrides) + `SOUL.md`
# (persona). The default/root agent IS the workspace (root `SOUL.md` + config.yaml globals /
# `agent.defaults`) — its fields are edited in Conf, its persona via the SOUL.md endpoint; it has no
# `agent.yaml` and can't be created/deleted here. Mirrors the skills file API above. Agent names
# reuse the same slug guard as skills (`_SKILL_NAME`) — lowercase, no path separators.


class AgentBody(BaseModel):
    """The `agent.yaml` override fields (an `AgentDef` minus `name`/`prompt`). Validated against
    `AgentDef` (merged onto `agent.defaults`) so a bad value 422s — same guarantee the 7d
    `PUT /api/settings` path gave."""

    agent: dict[str, Any] = Field(default_factory=dict)


class SoulContent(BaseModel):
    content: str = ""


def _write_text_eol(p: Path, text: str) -> None:
    """Atomic write preserving the file's existing EOL (LF for a new file) — avoids CRLF churn,
    same recipe as `put_skill`."""
    newline = "\r\n" if (p.is_file() and b"\r\n" in p.read_bytes()) else "\n"
    data = text.replace("\r\n", "\n").replace("\n", newline).encode("utf-8")
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, p)


def _agent_folder(request: Request, name: str, *, allow_default: bool = False) -> tuple[Path, bool]:
    """Resolve an agent's folder + whether it's the default/root. Validates the slug (422). The
    default agent maps to the workspace root and is only addressable when `allow_default` (the SOUL.md
    endpoints) — never for `agent.yaml` create/delete (those live in Conf)."""
    s = request.app.state.settings
    if name == s.DEFAULT_AGENT_NAME:
        if not allow_default:
            raise HTTPException(
                status_code=422,
                detail="the default agent is the workspace root — edit its defaults in Conf, its persona via SOUL.md",
            )
        return s.home_dir(), True
    if not _SKILL_NAME.match(name):
        raise HTTPException(
            status_code=422, detail="invalid agent name (lowercase letters, digits, '-' or '_')"
        )
    return s.agents_dir_path() / name, False


def _agent_payload(name: str, agent: AgentDef, folder: Path, is_default: bool) -> dict[str, Any]:
    soul_p = folder / "SOUL.md"
    return {
        "name": name,
        "is_default": is_default,
        "agent": agent.model_dump(mode="json"),
        "soul": soul_p.read_text(encoding="utf-8") if soul_p.is_file() else "",
    }


@router.get("/agents/{name}")
async def get_agent(name: str, request: Request) -> dict[str, Any]:
    """The resolved `AgentDef` (agent.yaml merged onto `agent.defaults`) + its `SOUL.md` persona, for
    the editor. 404 if a specialist folder is absent. The `default` name returns the root agent."""
    s = request.app.state.settings
    folder, is_default = _agent_folder(request, name, allow_default=True)
    agent = s.load_agent(name)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    return _agent_payload(name, agent, folder, is_default)


@router.put("/agents/{name}")
async def put_agent(name: str, body: AgentBody, request: Request) -> dict[str, Any]:
    """Create or update a specialist's `agent.yaml` (D14). Validates the merged def (422 on a bad
    value). A brand-new folder is scaffolded with a `SOUL.md` from the baked default. Loaded fresh
    per turn, so the change is live with no restart."""
    from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

    s = request.app.state.settings
    folder, _ = _agent_folder(request, name)  # rejects the default agent
    fields = {k: v for k, v in body.agent.items() if k not in ("name", "prompt")}
    merged = deep_merge(dict(s.agent.defaults), fields)
    merged["name"] = name
    try:
        AgentDef.model_validate(merged)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"invalid agent: {e.errors()[0]['msg']}") from e
    folder.mkdir(parents=True, exist_ok=True)
    _write_text_eol(folder / "agent.yaml", yaml.safe_dump(fields, sort_keys=False, allow_unicode=True))
    soul_p = folder / "SOUL.md"
    if not soul_p.is_file():
        _write_text_eol(soul_p, DEFAULT_SYSTEM_PROMPT + "\n")
    return _agent_payload(name, s.load_agent(name), folder, False)


@router.delete("/agents/{name}")
async def delete_agent(name: str, request: Request) -> dict[str, Any]:
    """Delete a specialist agent's whole folder (agent.yaml + SOUL.md + its memories). The default
    agent can't be deleted. Idempotent: 404 if absent."""
    folder, _ = _agent_folder(request, name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    shutil.rmtree(folder)
    return {"name": name, "deleted": True}


@router.get("/agents/{name}/soul")
async def get_agent_soul(name: str, request: Request) -> dict[str, Any]:
    """The raw `SOUL.md` persona for an agent (incl. `default` → root SOUL.md). Empty string if the
    file doesn't exist yet (the loop falls back to inference.system_prompt → baked)."""
    folder, _ = _agent_folder(request, name, allow_default=True)
    if name != request.app.state.settings.DEFAULT_AGENT_NAME and not folder.is_dir():
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    p = folder / "SOUL.md"
    return {"name": name, "content": p.read_text(encoding="utf-8") if p.is_file() else ""}


@router.put("/agents/{name}/soul")
async def put_agent_soul(name: str, body: SoulContent, request: Request) -> dict[str, Any]:
    """Write an agent's `SOUL.md` persona (incl. `default` → root SOUL.md). Blank content removes the
    file → the loop falls back to `inference.system_prompt` → the baked default."""
    folder, is_default = _agent_folder(request, name, allow_default=True)
    if not is_default and not folder.is_dir():
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    p = folder / "SOUL.md"
    if body.content.strip():
        folder.mkdir(parents=True, exist_ok=True)
        _write_text_eol(p, body.content)
    elif p.is_file():
        p.unlink()  # blank → remove so the prompt falls back to inference.system_prompt → baked
    return {"name": name, "content": body.content}


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
    # Continue as the last assistant turn's agent (D15 #5): last assistant message's `agent` →
    # thread.agent → default (no explicit override on resume). So a thread keeps talking to the
    # specialist you last used until you `/agent`-switch on a fresh turn.
    msgs = await request.app.state.messages.list(thread.id)
    last_agent = next((m.agent for m in reversed(msgs) if m.role == "assistant" and m.agent), None)
    session = _session(request, thread, agent_name=last_agent)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        yield {"event": "thread", "data": json.dumps({"threadId": thread.id, "title": thread.title})}
        async for ev in session.resume(thread, body.call_id, body.decision, body.confirm_token):
            yield {"event": ev.event, "data": json.dumps(ev.data)}

    return EventSourceResponse(gen())
