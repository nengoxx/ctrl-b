"""Agent chat API (Phase 4a). Threads CRUD + the streaming chat turn.

`POST /api/agent/chat` streams the turn as SSE (sse-starlette) using the same wire format as the
events feed. It creates a thread on first message (so the client can start with no thread), emits a
`thread` event up front carrying the id, then relays `AgentSession.run_turn`'s events. Turn lifetime
is tied to the stream: on client disconnect sse-starlette cancels the generator, cancelling the
in-flight step with it — completed steps are already persisted, so a reconnect re-reads them via
`GET /api/threads/{id}/messages`. Buffered mode (D17 `stream:false`) runs the whole turn in the
handler and survives disconnects. Server-owned durable turns (disconnect-proof streaming, replay,
explicit cancel) are target design: AGENT_CHAT_AUDIT ACA-1 → Slice 3 (D35 proposed).
"""

from __future__ import annotations

import json
import shutil
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from sse_starlette.sse import EventSourceResponse
from starlette.responses import Response

from app.config import deep_merge
from app.core.fsutil import write_text_eol
from app.core.memory import StoreScope, StoreSpec, store_by_key
from app.domain.agent import AgentDef
from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
from app.domain.enums import Actor, Privilege, RunState
from app.domain.event import Event
from app.domain.plan import Plan
from app.domain.result import ToolResult
from app.runtime import rediscover_integrations
from app.services.agent.planning import TaskPlanInput
from app.services.agent.proposals import apply_proposal
from app.services.agent.selector import select_agent
from app.services.agent.session import AgentSession, collect_turn
from app.services.agent.skills import remove_skill_md, valid_skill_slug, write_skill_md

router = APIRouter(tags=["agent"])


def _coerce_privilege(v: object) -> object:
    """Coerce a raw `/privilege` input to a known level or None — lenient like `_known_mode`, so an
    unknown/blank value (a stray composer token) becomes "no override" instead of 422-ing the turn.
    Shared by `ChatRequest` + `ResumeRequest` so the session level survives a confirm round-trip."""
    if v is None or v == "":
        return None
    return v if v in {p.value for p in Privilege} else None


class ChatRequest(BaseModel):
    text: str = Field(min_length=1)
    thread_id: str | None = None
    mode: str | None = None  # "local" | "cloud"; None → configured default (4c switches per-msg)
    skills: list[str] = Field(default_factory=list)  # explicit /skill-name invocations (4.5)
    agent: str | None = None  # `/agent <name>` switch (7d); None → the thread's / configured default
    #: `/privilege <level>` session override (A1/D16). None → the resolved agent's own privilege (its
    #: `AgentDef.privilege`, itself layered over `agent.defaults`). Applied in `_session` by copying
    #: the resolved agent with this privilege — most-specific-wins, no clamp (an interactive owner may
    #: raise *or* lower it). Carried across the confirm resume too (it's a security stance, unlike
    #: `mode`) so a lowered session can't silently revert to the agent's higher default mid-turn.
    privilege: Privilege | None = None
    #: Dual-mode delivery (D17). `true` → SSE stream, `false` → one buffered JSON response. Default
    #: `false` mirrors the OpenAI convention (omit → non-streaming); the PWA always sends `true`. The
    #: server's `agent.streaming` setting is authoritative — it only matters in `auto` (see
    #: `_effective_stream`); `on`/`off` ignore this field.
    stream: bool = False

    @field_validator("mode")
    @classmethod
    def _known_mode(cls, v: str | None) -> str | None:
        # InferenceCfg.endpoint() treats any non-"local" string as "cloud"; reject junk so a typo'd
        # mode falls back to the configured default instead of silently routing to cloud.
        return v if v in ("local", "cloud") else None

    @field_validator("privilege", mode="before")
    @classmethod
    def _known_privilege(cls, v: object) -> object:
        return _coerce_privilege(v)


class ExecRequest(BaseModel):
    """User `!<cmd>` escape hatch (Phase 5). Runs on the backend host; creates a thread on first use
    like `/agent/chat`. No privilege field — the user typing `!` *is* the authorization (the run is at
    FULL), gated only by `shell.user_exec_enabled`."""

    command: str = Field(min_length=1)
    thread_id: str | None = None


class CompactRequest(BaseModel):
    """Manual `/compact` (4e) — fold the thread's older turns into a summary now."""

    thread_id: str


class ResumeRequest(BaseModel):
    """Resolve a suspended tool call. `decision` is execute|dismiss|answer: `execute` re-runs a
    confirm-gated call (carry the `confirm_token` from `tool.permission`), `dismiss` skips it (confirm
    *or* question), `answer` supplies the owner's reply to a `question` (A2) in `answer`. `privilege`
    carries the session override across the round-trip (A1/D16) so the continuation gates the same."""

    thread_id: str
    call_id: str
    decision: str = "execute"  # "execute" | "dismiss" | "answer"
    confirm_token: str | None = None
    answer: str | None = None  # the owner's reply when decision == "answer" (A2)
    privilege: Privilege | None = None
    stream: bool = False  # dual-mode delivery (D17); the PWA re-sends true so the continuation matches

    @field_validator("privilege", mode="before")
    @classmethod
    def _known_privilege(cls, v: object) -> object:
        return _coerce_privilege(v)


def resolve_session_agent(settings, name: str | None, privilege: Privilege | None) -> AgentDef:
    """Resolve the `AgentDef` driving a turn + apply the per-session privilege override (A1/D16). The
    resolution chain is most-specific-wins: `resolve_agent` already layers per-agent over the global
    `agent.defaults`; this copies that agent with the session `privilege` when one is set (the
    `/privilege` override), or returns it unchanged when not. Pure (no request/state) so it's unit
    testable. No clamp — an interactive owner may raise or lower the level."""
    agent = settings.resolve_agent(name)
    if privilege is not None:
        agent = agent.model_copy(update={"privilege": privilege})
    return agent


def _session(
    request: Request,
    thread: Thread | None = None,
    agent_name: str | None = None,
    privilege: Privilege | None = None,
) -> AgentSession:
    """Build a session, resolving which `AgentDef` drives it. `agent_name` (the per-message `/agent
    <name>` switch, 7d) wins; else the thread's `agent` field (D11); else the configured default. An
    unknown name falls back to the default (resolve_agent is graceful). `privilege` is the `/privilege`
    session override (A1/D16) — resume re-sends it so the continuation gates at the same level (a
    security stance, unlike `mode` which isn't carried). Resume passes the last assistant turn's
    `agent` here (D15 #5) so a suspended turn finishes on the agent that started it."""
    s = request.app.state
    name = agent_name or (thread.agent if thread else None)
    agent = resolve_session_agent(s.settings, name, privilege)
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


def _effective_stream(setting: str, requested: bool) -> bool:
    """Resolve whether a turn streams (D17). The server `agent.streaming` setting is authoritative —
    `on` always streams, `off` always buffers (so the override applies to every client, e.g. a flaky
    link), `auto` honors the client's `stream` field. Pure → unit testable."""
    if setting == "on":
        return True
    if setting == "off":
        return False
    return requested  # "auto"


async def _turn_response(
    request: Request,
    thread: Thread,
    events: AsyncIterator[Any],
    *,
    stream: bool,
    count: bool,
) -> Response:
    """Return a turn as SSE or as one buffered JSON response (D17), draining the **same** event
    generator either way — `collect_turn` is a second consumer, the loop is never forked. `events` is
    `session.run_turn(...)` or `session.resume(...)`. `count` toggles the `active_turns` gauge (chat
    counts; resume historically doesn't). The buffered payload reuses the persisted message — the
    client re-reads it via the normal restore path, so the body stays small + authoritative."""
    head = {"threadId": thread.id, "title": thread.title}

    async def _counted(src: AsyncIterator[Any]) -> AsyncIterator[Any]:
        if count:
            request.app.state.active_turns += 1
        try:
            async for ev in src:
                yield ev
        finally:
            if count:
                request.app.state.active_turns -= 1

    if not stream:
        payload = await collect_turn(_counted(events))
        return JSONResponse({**head, **payload})

    async def gen() -> AsyncIterator[dict[str, Any]]:
        yield {"event": "thread", "data": json.dumps(head)}
        async for ev in _counted(events):
            yield {"event": ev.event, "data": json.dumps(ev.data)}

    return EventSourceResponse(gen())


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
async def chat(body: ChatRequest, request: Request) -> Response:
    """Run one chat turn. Body: `{text, thread_id?, mode?, stream?, …}`. Returns SSE (DESIGN §12) or,
    when buffered (D17), one JSON payload `{threadId, title, state, messageId?, permission?, …}`."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id) if body.thread_id else None
    if thread is None:
        thread = await threads.create(Thread(title=body.text[:60]))

    # Apply any pending MCP/OpenAPI integration edits at the turn boundary (Phase 7c-b) — before the
    # session reads the toolset, so the registry is rebuilt between turns, never mid-loop.
    if getattr(request.app.state, "integrations_dirty", False):
        await rediscover_integrations(request.app)

    # Auto-route to a specialist (7e-g, D15 #8) only when nothing pins the agent — an explicit
    # `/agent` (body.agent) or a thread-sticky agent always wins, and the switch is off by default.
    # `thread.agent` is never set in normal chat (created None), so "no pin" → per-turn routing.
    agent_name = body.agent
    selector = getattr(request.app.state, "agent_selector", None)
    if (
        agent_name is None
        and thread.agent is None
        and request.app.state.settings.agent.auto_rotate
        and selector is not None
    ):
        agent_name = select_agent(request.app.state.settings, selector, body.text)

    session = _session(request, thread, agent_name=agent_name, privilege=body.privilege)
    stream = _effective_stream(request.app.state.settings.agent.streaming, body.stream)
    events = session.run_turn(thread, body.text, mode=body.mode, skills=body.skills)
    return await _turn_response(request, thread, events, stream=stream, count=True)


@router.post("/exec")
async def exec_shell(body: ExecRequest, request: Request) -> dict[str, Any]:
    """Run the user's `!<cmd>` on the backend host (Phase 5). Reuses the `run_shell` action at FULL
    privilege (so it executes + is audited as an Event), then persists the command + result into the
    thread as an `assistant` tool_call + `tool` result pair — the same shape the agent loop produces —
    so it renders as a command bubble *and* feeds the agent's context on the next turn. The client
    re-reads the thread to render it (no parallel render path)."""
    settings = request.app.state.settings
    if not settings.shell.user_exec_enabled:
        raise HTTPException(status_code=403, detail="user shell exec is disabled (shell.user_exec_enabled)")

    threads = request.app.state.threads
    thread = await threads.get(body.thread_id) if body.thread_id else None
    if thread is None:
        thread = await threads.create(Thread(title=f"! {body.command[:58]}"))

    outcome = await request.app.state.actions.invoke(
        "run_shell", {"command": body.command}, actor=Actor.USER, privilege=Privilege.FULL
    )
    result = outcome.result or ToolResult(state=RunState.ERROR, summary="run_shell produced no result")

    call_id = uuid.uuid4().hex
    messages = request.app.state.messages
    await messages.add(
        Message(
            thread_id=thread.id,
            role="assistant",
            actor=Actor.USER,
            parts=[
                ToolCallPart(
                    call_id=call_id, tool="run_shell", args={"command": body.command}, state=result.state
                )
            ],
        )
    )
    await messages.add(
        Message(
            thread_id=thread.id,
            role="tool",
            actor=Actor.USER,
            parts=[ToolResultPart(call_id=call_id, result=result)],
        )
    )
    return {"threadId": thread.id, "callId": call_id, "state": result.state.value}


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


def _skill_root(request: Request, name: str) -> Path:
    """The global skills dir (the default agent's set) — the root the `/api/skills` editor manages —
    after validating the slug (422 on a bad/unsafe name). The slug guard is shared with the
    `skill_manage` tool via `valid_skill_slug` (one source of truth)."""
    if not valid_skill_slug(name):
        raise HTTPException(
            status_code=422, detail="invalid skill name (lowercase letters, digits, '-' or '_')"
        )
    return request.app.state.settings.skills_dir_path()


@router.get("/skills/{name}")
async def get_skill(name: str, request: Request) -> dict[str, Any]:
    """The raw `SKILL.md` text for the editor (7d). 404 if the skill doesn't exist; a fresh name
    returns the scaffold template so the editor opens populated."""
    p = _skill_root(request, name) / name / "SKILL.md"
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"unknown skill '{name}'")
    return {"name": name, "content": p.read_text(encoding="utf-8")}


@router.put("/skills/{name}")
async def put_skill(name: str, body: SkillContent, request: Request) -> dict[str, Any]:
    """Create or overwrite `skills/<name>/SKILL.md` (7d). The FileSkillProvider re-scans per call, so
    a save is live with no restart. Blank content → the scaffold template (used by 'add skill')."""
    root = _skill_root(request, name)
    content = body.content if body.content.strip() else _SKILL_TEMPLATE.format(name=name)
    write_skill_md(root, name, content)
    return {"name": name, "content": content}


@router.delete("/skills/{name}")
async def delete_skill(name: str, request: Request) -> dict[str, Any]:
    """Remove a skill's `SKILL.md` (7d) and its folder if it's left empty (resource files the owner
    dropped in are preserved — only an empty folder is cleaned up). Idempotent: 404 if not present."""
    if not remove_skill_md(_skill_root(request, name), name):
        raise HTTPException(status_code=404, detail=f"unknown skill '{name}'")
    return {"name": name, "deleted": True}


# ── Agents file API (Phase 7e-c, D14) ─────────────────────────────────────────────────────────
# Agents are folder-only: `$CTRLB_HOME/agents/<name>/` = `agent.yaml` (overrides) + `SOUL.md`
# (persona). The default/root agent IS the workspace (root `SOUL.md` + config.yaml globals /
# `agent.defaults`) — its fields are edited in Conf, its persona via the SOUL.md endpoint; it has no
# `agent.yaml` and can't be created/deleted here. Mirrors the skills file API above. Agent names
# reuse the same slug guard as skills (`valid_skill_slug`) — lowercase, no path separators.


class AgentBody(BaseModel):
    """The `agent.yaml` override fields (an `AgentDef` minus `name`/`prompt`). Validated against
    `AgentDef` (merged onto `agent.defaults`) so a bad value 422s — same guarantee the 7d
    `PUT /api/settings` path gave."""

    agent: dict[str, Any] = Field(default_factory=dict)


class SoulContent(BaseModel):
    content: str = ""


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
    if not valid_skill_slug(name):
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
    write_text_eol(folder / "agent.yaml", yaml.safe_dump(fields, sort_keys=False, allow_unicode=True))
    soul_p = folder / "SOUL.md"
    if not soul_p.is_file():
        write_text_eol(soul_p, DEFAULT_SYSTEM_PROMPT + "\n")
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
        write_text_eol(p, body.content)
    elif p.is_file():
        p.unlink()  # blank → remove so the prompt falls back to inference.system_prompt → baked
    return {"name": name, "content": body.content}


# ── Memory file API (Phase 7e-d-3, D14/D15 #4) ────────────────────────────────────────────────
# The raw read/overwrite path behind the Conf Memory panel — per-agent `memories/MEMORY.md` (incl.
# `default` → root) + the global `memories/USER.md`. Path resolution lives on the provider
# (the D27 store registry → `_store_file`), so these endpoints route through it rather than
# re-deriving paths.
# Blank content clears the file (mirrors the SOUL.md editor). The agent's own writes go through the
# `memory` tool (7e-d-2); these are the owner's manual edits — uncapped (D-decision: soft cap).


class MemoryContent(BaseModel):
    content: str = ""


def _memory_provider(request: Request):
    prov = getattr(request.app.state, "memory", None)
    if prov is None:
        raise HTTPException(status_code=503, detail="memory provider is not available")
    return prov


def _resolve_agent_for_memory(request: Request, name: str) -> AgentDef:
    """Validate the slug (422), reject nothing for `default`, and load the AgentDef (404 if a
    specialist folder is absent). Reuses the agents-API slug/default guard."""
    _agent_folder(request, name, allow_default=True)  # slug validation + default handling (422)
    agent = request.app.state.settings.load_agent(name)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    return agent


@router.get("/agents/{name}/memory")
async def get_agent_memory(name: str, request: Request) -> dict[str, str]:
    """The raw `MEMORY.md` for an agent (incl. `default` → root `memories/MEMORY.md`), or "" if none."""
    agent = _resolve_agent_for_memory(request, name)
    return {"name": name, "content": _memory_provider(request).read_raw(agent, "memory")}


@router.put("/agents/{name}/memory")
async def put_agent_memory(name: str, body: MemoryContent, request: Request) -> dict[str, str]:
    """Overwrite an agent's `MEMORY.md`. Blank content clears the file. Re-read each turn → live."""
    agent = _resolve_agent_for_memory(request, name)
    return {"name": name, "content": await _memory_provider(request).overwrite(agent, "memory", body.content)}


@router.get("/memory/user")
async def get_user_memory(request: Request) -> dict[str, str]:
    """The raw global `USER.md` owner profile (shared across agents), or "" if none."""
    default = request.app.state.settings.default_agent_def()
    return {"content": _memory_provider(request).read_raw(default, "user")}


@router.put("/memory/user")
async def put_user_memory(body: MemoryContent, request: Request) -> dict[str, str]:
    """Overwrite the global `USER.md`. Blank content clears it. (`agent` arg is ignored for `user`.)"""
    default = request.app.state.settings.default_agent_def()
    return {"content": await _memory_provider(request).overwrite(default, "user", body.content)}


# Store-keyed routes (D27) — the generic per-agent editor for any AGENT-scoped store (`memory`, the
# new `state.md`). The bare `/agents/{name}/memory` routes above stay as the `memory` alias (no
# frontend big-bang); the lone GLOBAL store keeps `/memory/user` (generalize to `/memory/{store}` only
# if a second global store ever lands). An unknown or non-AGENT store key → 404.


def _agent_store_spec(store: str) -> StoreSpec:
    spec = store_by_key(store)
    if spec is None or spec.scope is not StoreScope.AGENT:
        raise HTTPException(status_code=404, detail=f"unknown agent memory store '{store}'")
    return spec


@router.get("/agents/{name}/memory/{store}")
async def get_agent_store(name: str, store: str, request: Request) -> dict[str, str]:
    """The raw text of one AGENT store (`memory`/`state`) for an agent, or "" if none."""
    spec = _agent_store_spec(store)
    agent = _resolve_agent_for_memory(request, name)
    return {"name": name, "store": spec.key, "content": _memory_provider(request).read_raw(agent, spec.key)}


@router.put("/agents/{name}/memory/{store}")
async def put_agent_store(name: str, store: str, body: MemoryContent, request: Request) -> dict[str, str]:
    """Overwrite one AGENT store (`memory`/`state`) for an agent. Blank clears it. Re-read each turn → live."""
    spec = _agent_store_spec(store)
    agent = _resolve_agent_for_memory(request, name)
    return {
        "name": name,
        "store": spec.key,
        "content": await _memory_provider(request).overwrite(agent, spec.key, body.content),
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
        parts=[
            ToolCallPart(call_id=call_id, tool="task_plan", args={"steps": steps_dump}, state=RunState.OK)
        ],
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
async def resume(body: ResumeRequest, request: Request) -> Response:
    """Resolve a suspended tool call and continue the turn (DESIGN §5.3). Returns SSE or, when
    buffered (D17), one JSON payload. Body: `{thread_id, call_id, decision, confirm_token?, stream?}`."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")
    # Continue as the last assistant turn's agent (D15 #5): last assistant message's `agent` →
    # thread.agent → default (no explicit override on resume). So a thread keeps talking to the
    # specialist you last used until you `/agent`-switch on a fresh turn.
    msgs = await request.app.state.messages.list(thread.id)
    last_agent = next((m.agent for m in reversed(msgs) if m.role == "assistant" and m.agent), None)
    session = _session(request, thread, agent_name=last_agent, privilege=body.privilege)
    stream = _effective_stream(request.app.state.settings.agent.streaming, body.stream)
    events = session.resume(thread, body.call_id, body.decision, body.confirm_token, body.answer)
    return await _turn_response(request, thread, events, stream=stream, count=False)


class ApplyRequest(BaseModel):
    """Owner resolution of a proposed write (7e-f-3). A proposable tool (`memory`/`skill_manage`) with
    its auto-write switch off returns an OK result carrying `data["proposed"]` instead of writing; the
    chat bubble's Approve/Dismiss posts here. `decision` is apply|dismiss."""

    thread_id: str
    call_id: str
    decision: str = "apply"  # "apply" | "dismiss"


def _resolved(result: ToolResult, *, applied: bool, summary: str | None = None) -> ToolResult:
    """A copy of a proposed result with the pending `proposed` cleared and an `applied`/`dismissed`
    marker set — so the bubble's affordance disappears and a reload doesn't resurrect it."""
    data = {k: v for k, v in (result.data or {}).items() if k != "proposed"}
    data["applied" if applied else "dismissed"] = True
    return result.model_copy(update={"data": data, "summary": summary or result.summary})


@router.post("/agent/apply")
async def apply_proposal_endpoint(body: ApplyRequest, request: Request) -> dict[str, Any]:
    """Approve or dismiss a pending proposed write (7e-f-3). Finds the proposed tool call + its result
    in the thread (mirrors `/agent/plan`'s in-place update), then:

    - **dismiss** → marks the stored result resolved (clears `proposed`) and persists it.
    - **apply** → resolves the agent that proposed it (the call's `message.agent`, 7e-c), re-runs the
      tool's gate + write via `apply_proposal` (bypassing only the auto-write switch). On a successful
      write it rewrites the stored result (clears `proposed`, marks `applied`), flips the call to OK,
      and audits the write as a USER Event. If the write fails (over cap / stale `old_text`), the
      proposal is left pending and the ERROR result is returned for the owner to retry or dismiss.
    """
    threads = request.app.state.threads
    messages = request.app.state.messages
    thread = await threads.get(body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")

    msgs = await messages.list(body.thread_id)
    call_msg = call_part = None
    for m in msgs:
        for p in m.tool_calls():
            if p.call_id == body.call_id:
                call_msg, call_part = m, p
    result_msg = result_part = None
    for m in msgs:
        for rp in m.tool_results():
            if rp.call_id == body.call_id:
                result_msg, result_part = m, rp
    if call_msg is None or call_part is None or result_msg is None or result_part is None:
        # each msg/part is set as a pair in the loops above, so the parts imply the msgs — checking
        # both keeps that invariant explicit for the type checker (and guards a truly missing pair).
        raise HTTPException(status_code=404, detail=f"no tool call '{body.call_id}' in this thread")
    if not isinstance(result_part.result.data, dict) or "proposed" not in result_part.result.data:
        raise HTTPException(status_code=409, detail="no pending proposal for this call")

    if body.decision == "dismiss":
        result_part.result = _resolved(result_part.result, applied=False, summary="proposal dismissed")
        await messages.update(result_msg)
        return {
            "call_id": body.call_id,
            "decision": "dismiss",
            "applied": False,
            "result": result_part.result.model_dump(mode="json"),
        }

    # apply — re-run the proposing agent's write, auto-write gate aside.
    deps = request.app.state.deps
    agent = request.app.state.settings.resolve_agent(call_msg.agent)
    written = await apply_proposal(deps, agent, call_part.tool, dict(call_part.args))
    if written.state is not RunState.OK:
        # Leave the proposal pending (it stays approvable/dismissable) and surface the failure.
        return {
            "call_id": body.call_id,
            "decision": "apply",
            "applied": False,
            "result": written.model_dump(mode="json"),
        }

    result_part.result = _resolved(written, applied=True)
    call_part.state = RunState.OK
    await messages.update(call_msg)
    if result_msg is not call_msg:
        await messages.update(result_msg)
    await deps.events.record(
        Event(actor=Actor.USER, action=call_part.tool, status=written.state, summary=written.summary)
    )
    return {
        "call_id": body.call_id,
        "decision": "apply",
        "applied": True,
        "result": result_part.result.model_dump(mode="json"),
    }
