"""Agent chat API (Phase 4a). Threads CRUD + the streaming chat turn.

`POST /api/agent/chat` streams the turn as SSE (sse-starlette) using the same wire format as the
events feed. It creates a thread on first message (so the client can start with no thread), emits a
`thread` event up front carrying the id, then relays `AgentSession.run_turn`'s events. Turn lifetime
is tied to the stream: on client disconnect sse-starlette cancels the generator, cancelling the
in-flight step with it — completed steps are already persisted, so a reconnect re-reads them via
`GET /api/threads/{id}/messages`. Buffered mode (D17 `stream:false`) runs the whole turn in the
handler and survives disconnects. Server-owned durable turns (disconnect-proof streaming, replay,
explicit cancel) LANDED in Slice 3 (D39, ACA-1): a spawned drain task owns the loop and the SSE
response is a subscriber, with re-attach/status/cancel at `/api/agent/turns/*` (below).
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from sse_starlette.sse import EventSourceResponse
from starlette.responses import Response

from app.config import Settings, deep_merge, is_provider_slug, providers_rev
from app.core.fsutil import write_text_eol
from app.core.memory import StoreScope, StoreSpec, store_by_key
from app.domain.agent import AgentDef
from app.domain.automation import AutomationSnapshot
from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
from app.domain.enums import Actor, Privilege, RunState
from app.domain.event import ORIGIN_USER_CHAT, Event, Origin
from app.domain.plan import Plan
from app.domain.result import ToolResult
from app.runtime import clear_reasoning_demotions, rediscover_integrations
from app.services.agent.compaction import compaction_state_for, prune_compaction_state
from app.services.agent.exec import run_user_exec
from app.services.agent.planning import TaskPlanInput
from app.services.agent.proposals import apply_proposal
from app.services.agent.routing import prune_routing_state, routing_state_for
from app.services.agent.selector import select_agent
from app.services.agent.session import AgentSession, collect_turn
from app.services.agent.skills import remove_skill_md, valid_skill_slug, write_skill_md
from app.services.agent.steering import (
    SteerEntry,
    SteerQueueFull,
    enqueue,
    prune_if_empty,
    requeue_front,
    steer_source_for,
)
from app.services.agent.turns import (
    TASK_KINDS,
    TurnBusy,
    TurnHandle,
    TurnKind,
    active_task_turns,
    cancel_turn,
    drain_turn,
    get_terminal,
    make_subscriber,
    record_terminal,
    release,
    remove_subscriber,
    reserve,
    subscribe_events,
)
from app.services.agent.turns import _push_terminal as push_terminal

log = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])


def _coerce_privilege(v: object) -> object:
    """Coerce a raw `/privilege` input to a known level or None — lenient like `_coerce_mode`, so an
    unknown/blank value (a stray composer token) becomes "no override" instead of 422-ing the turn.
    Shared by `ChatRequest` + `ResumeRequest` so the session level survives a confirm round-trip."""
    if v is None or v == "":
        return None
    return v if v in {p.value for p in Privilege} else None


def _coerce_mode(v: object) -> object:
    """Coerce a raw request `mode` to a valid PROVIDER-NAME slug or None (A11/D48 C7/R14). SYNTAX-ONLY:
    a request model can't see settings, so we only check the slug shape (the ONE `is_provider_slug`
    pattern); an unknown-but-valid slug survives here and is resolved LATER against the captured registry
    (`Registry.chain_for` coerces an unknown/non-routable provider → None → the default chain, logged).
    Junk (non-string / bad slug) becomes None = "no override" instead of 422-ing the turn. Shared by
    `ChatRequest` + `ResumeRequest` so a `/<provider>` turn resumes on the same provider (ACA-16)."""
    return v if is_provider_slug(v) else None


class ChatRequest(BaseModel):
    text: str = Field(min_length=1)
    thread_id: str | None = None
    mode: str | None = None  # a `/<provider>` name (A11 D48 C7); None → the configured default chain
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

    @field_validator("mode", mode="before")
    @classmethod
    def _known_mode(cls, v: object) -> object:
        return _coerce_mode(v)

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
    #: Optional free-text steer for the summarizer (D42) — `/compact <instructions>` passthrough (e.g.
    #: "focus on the deploy steps, drop the chit-chat"). Additive + schema-only in this wave; the FE may
    #: send nothing today. Threaded into the summarizer prompt by a later wave. `None`/blank → the
    #: default fixed-section template unchanged.
    instructions: str | None = None


class ResumeRequest(BaseModel):
    """Resolve a suspended tool call. `decision` is execute|execute_always|dismiss|answer: `execute`
    re-runs a confirm-gated call (carry the `confirm_token` from `tool.permission`), `execute_always`
    runs it AND persists an args-exact 'always allow' rule so future identical calls auto-run (D44 W2),
    `dismiss` skips it (confirm *or* question), `answer` supplies the owner's reply to a `question` (A2)
    in `answer`. `privilege` carries the session override across the round-trip (A1/D16) so the
    continuation gates the same."""

    thread_id: str
    call_id: str
    #: The resume decision (A1/C1-H1) — fail-closed. `Literal` 422s any junk value at the API so it
    #: can't fall through to EXECUTE (the old `str` field's documented "anything else is execute" hole,
    #: which also marked an `answer`-against-a-confirm OK without running). The before-validator strips
    #: surrounding whitespace first, so a trimmed valid value ("dismiss ") still passes the Literal.
    #: `execute_always` (D44 W2) behaves EXACTLY as `execute` downstream except it first persists the
    #: grant rule — a `resume`-local branch, invisible to `_drive`.
    decision: Literal["execute", "execute_always", "dismiss", "answer"] = "execute"
    confirm_token: str | None = None
    answer: str | None = None  # the owner's reply when decision == "answer" (A2)
    privilege: Privilege | None = None
    #: `/<provider>` inference mode carried across the confirm round-trip (ACA-16/S2-D; A11 D48 C7). None →
    #: the configured default chain. Unlike `privilege` (a security stance, always re-sent), the PWA stashes
    #: the turn's mode and re-sends it here so a `/<provider>` turn *resumes* on that provider — same
    #: per-message semantics as `ChatRequest.mode`, threaded endpoint → `session.resume` → `_drive`.
    mode: str | None = None
    #: The turn's active skills (C5-M1), carried across the confirm round-trip so the resumed half
    #: runs under the SAME narrowed toolset + injected instructions the owner confirmed against (same
    #: shape as `ChatRequest.skills`; the PWA re-sends the turn's pinned skills). Re-activated verbatim
    #: on resume — no re-selection.
    skills: list[str] = Field(default_factory=list)
    stream: bool = False  # dual-mode delivery (D17); the PWA re-sends true so the continuation matches

    @field_validator("mode", mode="before")
    @classmethod
    def _known_mode(cls, v: object) -> object:
        return _coerce_mode(v)

    @field_validator("privilege", mode="before")
    @classmethod
    def _known_privilege(cls, v: object) -> object:
        return _coerce_privilege(v)

    @field_validator("decision", mode="before")
    @classmethod
    def _strip_decision(cls, v: object) -> object:
        """Trim surrounding whitespace before the `Literal` check (A1) so a padded valid value
        ("dismiss ") still resolves; a truly unknown token still 422s."""
        return v.strip() if isinstance(v, str) else v


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


def _build_session(
    state,
    thread: Thread | None = None,
    agent_name: str | None = None,
    privilege: Privilege | None = None,
    automation: AutomationSnapshot | None = None,
) -> AgentSession:
    """Build a session from `app.state` (NOT a Request) — the state-shaped core of `_session`, shared
    with the D41 drain-B spawn (`start_steer_turn`, which has only `state`, never a Request) and with the
    A3 automation runner. Resolves which `AgentDef` drives the turn: `agent_name` (the `/agent <name>`
    switch, 7d) wins; else the thread's `agent` field (D11); else the configured default. `privilege` is
    the `/privilege` session override (A1/D16). Wires the D41 Drain-A `steer_source` when a thread is
    resolved (subagent sessions build the session directly with the `None` default — children are never
    steered).

    `automation` (A3/D49 §D-3) is the ONE options object that turns this into an UNATTENDED run — the
    frozen claim snapshot itself, so the builder cannot disagree with the row the run was claimed from.
    Everything it changes is derived here rather than passed as a bag of bools:

      * `interactive=False` — a confirm-gated call denies in place instead of parking the run forever.
      * `message_actor=AUTOMATION` — the injected prompt was not typed by the owner.
      * `question_policy` — what an unattended `question` resolves to (§D-3 ladder).
      * no `steer_source` — there is no composer to steer a scheduled run from.
      * compaction state only for a ROLLING thread: those grow across runs and need the thrash machine;
        a fresh per-run thread cannot outlive its one turn, so a per-thread state entry would just leak.
      * `origin=automation` + the run id — the attribution D-4 threads through every action it takes.

    Kept as ONE builder on purpose (the no-parallel-implementation rule): a separate automation builder
    would be a second place for the steer/compaction/routing/skills wiring to drift."""
    name = agent_name or (thread.agent if thread else None)
    agent = resolve_session_agent(state.settings, name, privilege)
    return AgentSession(
        state.threads,
        state.messages,
        state.inference,
        state.settings,
        state.actions,
        agent,
        skills=getattr(state, "skills", None),
        selector=getattr(state, "skill_selector", None),
        memory=getattr(state, "memory", None),
        interactive=automation is None,
        steer_source=(
            steer_source_for(state, thread.id) if thread is not None and automation is None else None
        ),
        compaction_state=(
            compaction_state_for(state, thread.id)
            if thread is not None and (automation is None or automation.rolling)
            else None
        ),
        routing_state=(routing_state_for(state, thread.id) if thread is not None else None),
        # Who set this in motion (D-4). Stated, never inherited from the field default: this is THE
        # shared builder, so an automation run overrides the obvious arguments instead of relying on an
        # omission — and an interactive turn says out loud that it is the owner talking to the app.
        origin=(
            ORIGIN_USER_CHAT
            if automation is None
            else Origin(kind="automation", id=automation.automation_id, run_id=automation.run_id)
        ),
        message_actor=Actor.USER if automation is None else Actor.AUTOMATION,
        question_policy="skip" if automation is None else automation.question_policy,
    )


def _session(
    request: Request,
    thread: Thread | None = None,
    agent_name: str | None = None,
    privilege: Privilege | None = None,
) -> AgentSession:
    """Build a session for an endpoint (the Request-shaped wrapper over `_build_session`). `agent_name`
    (the per-message `/agent <name>` switch, 7d) wins; else the thread's `agent` field (D11); else the
    configured default. An unknown name falls back to the default (resolve_agent is graceful).
    `privilege` is the `/privilege` session override (A1/D16) — resume re-sends it so the continuation
    gates at the same level (a security stance, unlike `mode` which isn't carried). Resume passes the
    last assistant turn's `agent` here (D15 #5) so a suspended turn finishes on the agent that started
    it."""
    return _build_session(request.app.state, thread, agent_name, privilege)


def _auto_route_agent(state, thread: Thread, explicit_agent: str | None, text: str) -> str | None:
    """Resolve the agent NAME for a turn, including the auto-router (7e-g, D15 #8): an explicit
    `/agent` (or a thread-sticky agent) always wins; only when nothing pins the agent AND the switch is
    on does the keyword selector pick a specialist by matching `text`. Extracted so the chat endpoint
    AND the D41 drain-B spawn resolve the agent identically (a spawned steer turn routes exactly as the
    fresh POST that enqueued it would have — D41 §9 captured-params fidelity)."""
    agent_name = explicit_agent
    selector = getattr(state, "agent_selector", None)
    if (
        agent_name is None
        and thread.agent is None
        and state.settings.agent.auto_rotate
        and selector is not None
    ):
        agent_name = select_agent(state.settings, selector, text)
    return agent_name


def _effective_stream(setting: str, requested: bool) -> bool:
    """Resolve whether a turn streams (D17). The server `agent.streaming` setting is authoritative —
    `on` always streams, `off` always buffers (so the override applies to every client, e.g. a flaky
    link), `auto` honors the client's `stream` field. Pure → unit testable."""
    if setting == "on":
        return True
    if setting == "off":
        return False
    return requested  # "auto"


# The single 409 detail for a thread that already has a live turn (D38 busy-truth; the manual
# rediscover endpoint uses its own message). Actionable per Goose's busy-error precedent.
_TURN_BUSY_DETAIL = "a turn is already running on this thread — wait for it to finish"
# A3/D49 §D-3: an automation's ROLLING thread is the automation's own continuing conversation. Chatting
# into it would interleave the owner's turns with scheduled runs and silently change what the next run
# reads as its context, so v1 refuses (takeover/detach is a recorded future). 403, not the busy 409:
# nothing is running — this is simply not the owner's thread to talk in.
_AUTOMATION_THREAD_DETAIL = (
    "this thread belongs to an automation's continuing conversation — read it from the automation's "
    "run history instead; chatting into it would change what its next scheduled run sees"
)


async def _reject_automation_thread(state, thread: Thread) -> None:
    """Refuse an interactive turn aimed at an automation-owned ROLLING thread (§D-3).

    Only rolling threads are owned: a `fresh` per-run thread is deliberately free to continue in chat once
    its run is terminal (the AnythingLLM pattern), and while such a run is LIVE the turn marker already
    refuses through the ordinary busy path. Tolerates a missing repo (`getattr`) so unit paths that build
    an app state without the automations subsystem behave exactly as before."""
    repo = getattr(state, "automations", None)
    if repo is None:
        return
    if await repo.rolling_owner(thread.id) is not None:
        raise HTTPException(status_code=403, detail=_AUTOMATION_THREAD_DETAIL)


# The 409 detail when the server-wide concurrency cap (`agent.turns.max_active_turns`, D39) is hit by
# a NEW task-bearing turn (chat/resume). Distinct + actionable, separate from the per-thread busy 409.
_TURN_CAP_DETAIL = "too many turns are running — wait for one to finish"


def _reserve_or_busy(state, thread_id: str, kind: TurnKind, cfg) -> TurnHandle:
    """Cap-check then `reserve` the thread marker (D38/D39) — but let `TurnBusy` PROPAGATE unmapped so
    a caller that wants to inspect the live holder can (the chat/exec steer path, D41). The
    **server-wide cap** (a NEW task-bearing chat/resume when `max_active_turns` are already running)
    still maps to HTTP 409 here — sync kinds (exec/plan/apply/compact) are exempt. The cap read and the
    `reserve` insert run with no `await` between them, so the D38 TOCTOU guarantee extends to the cap.

    `_reserve_turn` wraps this and maps the propagated `TurnBusy` to the busy 409 — that is the
    handle-or-409 chokepoint the five sync endpoints use, unchanged. Only chat/exec call THIS directly,
    because they upgrade the per-thread busy case to a 202 enqueue instead of a 409 (D41)."""
    if kind in TASK_KINDS and active_task_turns(state.turns) >= cfg.max_active_turns:
        raise HTTPException(status_code=409, detail=_TURN_CAP_DETAIL)
    return reserve(state.turns, thread_id, kind, ring_size=cfg.ring_size)


def _reserve_turn(request: Request, thread_id: str, kind: TurnKind) -> TurnHandle:
    """Reserve the thread's turn marker (D38) or 409 — the single chokepoint mapping both busy-state
    refusals to HTTP so all six thread-mutating endpoints share them:

    - **per-thread busy** (`TurnBusy`) — a turn already owns THIS thread.
    - **server-wide cap** (D39) — a NEW task-bearing turn (chat/resume) when `max_active_turns` are
      already running. Sync kinds (exec/plan/apply/compact) are exempt: they run inline, are short,
      and already hold the per-thread marker, so they don't count against the detached-turn budget.

    Both checks run synchronously before `reserve` inserts — no `await` between the cap read and the
    insert, so the D38 TOCTOU guarantee extends to the cap. (Chat/exec call `_reserve_or_busy` instead
    so they can steer-enqueue on the per-thread busy case — D41 — rather than always 409.)"""
    state = request.app.state
    try:
        return _reserve_or_busy(state, thread_id, kind, state.settings.agent.turns)
    except TurnBusy as e:
        raise HTTPException(status_code=409, detail=_TURN_BUSY_DETAIL) from e


def _steer_202(state, thread_id: str, holder: TurnHandle, entry: SteerEntry, cfg) -> JSONResponse:
    """Append a steer to the thread's queue and build the 202 (D41). SYNCHRONOUS — the caller invokes
    it in the SAME await-free block as the `TurnBusy` catch, so there is no orphan window between the
    failed reserve and the append (the D38 TOCTOU discipline; the holder can't change under the
    single-threaded loop). A queue already at `steer_queue_max` (`SteerQueueFull`) → the 409 busy
    detail verbatim (an overflow is "still busy"). Nothing is persisted here — the durable thread never
    shows text the model hasn't seen; the drain (waves 2–3) is the only writer."""
    try:
        position = enqueue(state, thread_id, entry, cfg.steer_queue_max)
    except SteerQueueFull as e:
        raise HTTPException(status_code=409, detail=_TURN_BUSY_DETAIL) from e
    return JSONResponse(
        {
            "queued": True,
            "turn_id": holder.turn_id,
            "entry_id": entry.entry_id,
            "position": position,
            "depth": len(state.steer_queues[thread_id]),
        },
        status_code=202,
    )


def _sse_frame(turn_id: str, seq: int, ev: Any) -> dict[str, Any]:
    """One SSE frame for an `AgentEvent`, framed EXACTLY like the live chat stream: the wire `id` is
    `turn_id:seq` — the client's reconnect cursor (D39). One source of truth for the framing, shared
    by `_turn_response`'s live `gen()` and the re-attach stream (`turn_stream`)."""
    return {"event": ev.event, "id": f"{turn_id}:{seq}", "data": json.dumps(ev.data)}


async def _stream_live(
    handle: TurnHandle, queue: asyncio.Queue, *, after_seq: int = 0
) -> AsyncIterator[dict[str, Any]]:
    """Frame a subscriber queue's `(seq, event)` pairs as SSE dicts until the terminal sentinel, then
    DETACH in the finally (never release — the drain task's done-callback owns that). Dedupes by
    `seq > after_seq` so a re-attach whose synchronously-built tail/snapshot prefix overlaps events
    already queued is not double-emitted (D39). Shared by the live stream + re-attach.

    Continuity guard (S3 review): `turns._force_put` (the terminal sentinel) can evict the OLDEST real
    event from an exactly-full but still-connected queue — leaving a `seq` gap this consumer would
    otherwise carry to `done` and settle a damaged stream over. On a gap (`seq > expected`) BREAK: the
    finally detaches, the SSE closes with no `done`, and the client recovers via re-attach/reload
    (items 3+7). `expected` is SEEDED to `after_seq + 1` (not the first received pair) so an eviction
    of the queue's very FIRST event — the leading-edge gap — also trips the guard; an originating
    stream attaches before the drain task starts, so its first event is seq 1 == `after_seq(0) + 1`."""
    expected = after_seq + 1
    try:
        async for seq, ev in subscribe_events(queue):
            if seq > expected:
                break  # gap from a `_force_put` eviction — stop, don't let the consumer settle damaged
            expected = seq + 1
            if seq <= after_seq:
                continue  # already covered by the prefix (tail-replay / snapshot)
            yield _sse_frame(handle.turn_id, seq, ev)
    finally:
        remove_subscriber(handle, queue)


def _spawn_drain_task(
    state, thread: Thread, events: AsyncIterator[Any], handle: TurnHandle, cfg
) -> asyncio.Task:
    """The ONE server-owned drain-task spawn (D39/D41): create `drain_turn(handle, events, …)` on
    `handle.task` and wire the idempotent `_cleanup` done-callback (marker release + terminal record +
    the D41 drain-B chain). Shared by `_turn_response` (which ADDITIONALLY attaches a client subscriber
    + transport around this) and the drain-B `start_steer_turn` (subscriber-less — the spawned steer
    turn has no client). Callers that need the D39 zero-gap join attach their subscriber BEFORE calling
    this (there is no `await` between here and `create_task`)."""
    task = asyncio.create_task(drain_turn(handle, events, state.messages))
    handle.task = task

    def _cleanup(_t: asyncio.Task) -> None:
        # Runs once when the task ends, whichever terminal path. The task's own finally set
        # `handle.terminal_status` BEFORE the terminal sentinel (D39/M2 ordering), so it is normally
        # settled here.
        #
        # Never-started-task window (C4-M3): a cancel landing BEFORE the drain coroutine's first step
        # skips `drain_turn`'s try/finally entirely — so `terminal_status` is unset AND no terminal
        # sentinel was pushed, leaving every subscriber blocked on the queue and a cancel probe
        # reading a null terminal. The done-callback ALWAYS fires when the task reaches done, so
        # backfill here: settle the status from the task outcome (`cancelled` if the task was
        # cancelled, else `error`) and push the terminal sentinel so every subscriber unblocks. Both
        # are sync — safe in a done-callback. No-op on the normal path (status already set).
        if handle.terminal_status is None:
            handle.terminal_status = "cancelled" if _t.cancelled() else "error"
            push_terminal(handle)
        # RELEASE FIRST (Slice-3 audit INFO-5): if the cache insert ever raised, a release-second
        # ordering would leak the marker and 409 the thread forever — a missed terminal-cache entry is
        # merely a reload fallback, the safe failure of the two.
        release(state.turns, handle)
        record_terminal(state.turn_terminals, handle, linger_s=cfg.linger_s, cap=cfg.terminal_cache_cap)
        # D43/A4: a turn that ended with the routing state back to all-defaults (no live episode, no
        # failure counter, no pending route snapshot — a healthy worker thread) drops its now-inert entry
        # so `app.state.routing_state` doesn't accumulate dead threads; a mid-episode state (or a thread
        # with a still-suspended lead call) is NOT all-default → preserved. No cancel-clear is needed
        # anymore: the per-turn route lock + failure flag are `_drive` turn-locals now, so a Stop
        # mid-turn leaks nothing (the decrement, committed at the fresh decision, deliberately stands).
        prune_routing_state(state.routing_state, thread.id)
        # D41 Drain B: a `completed` turn that leaves pending steers spawns the next turn (or drains an
        # all-exec queue) — synchronously in this sync done-callback. Suppressed at shutdown / on a
        # cancel that already harvested the queue (see `_maybe_spawn_drain_b`).
        _maybe_spawn_drain_b(state, thread, handle, cfg)

    task.add_done_callback(_cleanup)
    return task


def _maybe_spawn_drain_b(state, thread: Thread, handle: TurnHandle, cfg) -> None:
    """D41 Drain B (turn end, `completed` ONLY). Called from the drain task's SYNC done-callback: iff
    the turn completed AND the thread still has pending steers AND we are NOT shutting down, RESERVE the
    thread marker SYNCHRONOUSLY (no `await` before the reserve — the callback is sync) then
    `create_task` the async body. The synchronous reserve means no fresh-POST race and no loser path
    (FIFO chronology holds); a `TurnBusy` here means a fresh POST already won the thread (it arrived
    BEFORE this callback ran, not during) — leave the queue, it drains into that winner's loop top.

    Suppressions: `suspended`/`cancelled`/`error` terminals never spawn (only `completed`); a cancel
    that harvested the queue first (§Cancel) leaves it absent → nothing to spawn; `state.shutting_down`
    (set at the top of the lifespan finally) blocks a natural completion from spawning past the drain
    snapshot into a closing DB."""
    if handle.terminal_status != "completed":
        return
    if getattr(state, "shutting_down", False):
        return
    q = state.steer_queues.get(thread.id)
    if not q:  # absent (harvested by a racing cancel) or empty → nothing to drain
        return
    try:
        new_handle = reserve(state.turns, thread.id, "chat", ring_size=cfg.ring_size)
    except TurnBusy:
        return  # a fresh POST won the thread first → it will drain the queue at its own loop top
    # FIX 2: the body task IS the durable task — assign it to `new_handle.task` immediately (no None
    # gap after the sync reserve), so from this instant `turn_status` reads active, Stop can cancel the
    # drain (all-exec queues included, which previously ran task-less + invisible), and the lifespan
    # drain snapshot (`h.task is not None`) includes it. The message-seed path later REPLACES this task
    # with the seeded turn's drain task (via `_spawn_drain_task`) — single ownership at every instant.
    new_handle.task = asyncio.create_task(_drain_b_body(state, thread, new_handle, cfg))


async def _run_steer_exec(state, thread: Thread, q, entry: SteerEntry) -> None:
    """Run ONE queued `exec` steer during a drain-B body: re-check `shell.user_exec_enabled` LIVE
    (fail-closed — disabling the shell mid-queue must drop, never run) then the SHARED `run_user_exec`
    (the same run_shell@FULL + atomic pair the `/exec` endpoint and Drain A use). Unlike Drain A there is
    no live stream to carry a `notice`, so a dropped command is logged at INFO.

    ATOMIC CLAIM-BEFORE-RUN (D41 FIX 1, formerly MED-1): the entry is claimed OFF the queue BEFORE
    `run_user_exec` AND the claim is verified — `commit` returns the count removed, and a return != 1
    means the entry was DELETEd/harvested since the `peek()` snapshot (e.g. a DELETE landed while the
    prior leading exec's run was awaiting), so it is no longer ours to run: skip it, never invoke
    run_shell. Claim-first also gives lost-on-crash over double-run — a Stop/harvest arriving
    mid-execution can no longer hand a still-queued, already-running command back to the composer. The
    trade (a crash between claim and run loses the command) is the in-memory queue's accepted failure."""
    if not state.settings.shell.user_exec_enabled:
        log.info("steer drain-B: shell disabled — dropped queued command (entry %s)", entry.entry_id)
        q.commit([entry.entry_id])
        prune_if_empty(state.steer_queues, thread.id, q)
        return
    if q.commit([entry.entry_id]) != 1:
        return  # DELETEd/harvested since the peek — skip, never run
    prune_if_empty(state.steer_queues, thread.id, q)
    await run_user_exec(state.actions, state.messages, thread.id, entry.text)


async def _drain_b_body(state, thread: Thread, handle: TurnHandle, cfg) -> None:
    """The async body a drain-B spawn runs while holding the freshly-reserved `handle` (FIX 2: this
    coroutine IS `handle.task` — the durable, cancellable, snapshot-visible drain-B task). FIFO ordering
    (D41): any `exec` steers LEADING the queue run first (gate-rechecked), then —
      • if a `message` entry exists → pop that head message and seed a new turn via `start_steer_turn`,
        which hands `handle` to the seeded turn's OWN drain task (`_spawn_drain_task` REPLACES
        `handle.task` and attaches the `_cleanup` done-callback that owns release/terminal/chain). We set
        `handed_off` so this body's `finally` does NOT also release — single ownership.
      • if the queue is ALL exec (no message) → run every entry, mark `completed`; the `finally` then
        releases + records a terminal + CHAINS `_maybe_spawn_drain_b` (picking up any message a steer
        202'd DURING the all-exec run — the stranded-message fix) — NO model turn.

    Ownership (FIX 2): unless we `handed_off` to a seeded turn's drain task, the `finally` is the SINGLE
    release point. A Stop cancelling this task mid-exec surfaces as `CancelledError` (marked `cancelled`,
    then released by the finally); a spawn-prelude raise re-enqueues the committed head at the FRONT
    (MED-3) so no message is lost. `record_terminal`/the chain fire ONLY on a clean `completed` all-exec
    drain, never on cancel/abandon/stale-head."""
    # MED-4: re-check shutdown as the FIRST statement — closes the check→spawn→shutdown gap where a
    # natural completion's `_maybe_spawn_drain_b` passed the shutdown guard, reserved the marker, and
    # scheduled this body, THEN the lifespan finally's first statement set `shutting_down`. Release and
    # bail so a natural completion can't spawn a turn into a closing DB.
    if getattr(state, "shutting_down", False):
        release(state.turns, handle)
        return
    committed_head: SteerEntry | None = None  # MED-3: the head we popped this invocation, for requeue
    handed_off = False  # FIX 2: True once the seeded turn's drain task owns `handle` (skip finally release)
    try:
        q = state.steer_queues.get(thread.id)
        if not q:  # harvested by a cancel between the sync reserve and this body → the finally releases
            return
        entries = q.peek()
        first_msg = next((i for i, e in enumerate(entries) if e.kind == "message"), None)
        # Run any leading exec entries (all of them, when there is no message) FIFO.
        leading = entries if first_msg is None else entries[:first_msg]
        for e in leading:
            live_q = state.steer_queues.get(thread.id)
            if live_q is None:  # harvested mid-drain → stop (the finally releases)
                break
            await _run_steer_exec(state, thread, live_q, e)
        if first_msg is None:
            # All-exec queue: no turn to spawn — mark completed; the finally releases + records a
            # terminal + chains (a message that arrived DURING the run drains via the chain, FIX 2).
            handle.terminal_status = "completed"
            return
        # Seed a new turn with the head message; the remaining entries drain at its loop top (Drain A).
        head = entries[first_msg]
        live_q = state.steer_queues.get(thread.id)
        if live_q is None:  # harvested after the leading execs ran → the finally releases the orphan
            return
        # MED-2: the head commit is LOAD-BEARING. `commit` returns the count actually removed — if it
        # removed nothing, the head we peeked is no longer OWNED by this queue (harvested / DELETEd, or
        # the queue was popped-and-recreated by a fresh POST between the peek and here). Spawning a turn
        # from a stale head would double-spawn / seed a message this queue no longer owns, so abandon —
        # never spawn from an entry no longer owned (the finally releases; terminal stays unset so it
        # neither records a terminal nor chains).
        if live_q.commit([head.entry_id]) != 1:  # pop ONLY the head (run_turn persists it as the user msg)
            return
        prune_if_empty(state.steer_queues, thread.id, live_q)  # FIX 5: head-only queue → drop the shell
        committed_head = head  # committed off the queue → requeue it in the except path if the spawn raises
        await start_steer_turn(state, thread, [head])
        handed_off = True  # the seeded turn's drain task now owns `handle` (release/terminal/chain)
    except asyncio.CancelledError:
        # A Stop / shutdown cancelled this body task mid-drain (before the handoff). The in-flight
        # `run_user_exec` was already claimed off the queue (FIX 1), so nothing double-runs. Mark the
        # terminal so the cancel endpoint's response carries it, then re-raise: the finally releases.
        handle.terminal_status = "cancelled"
        raise
    except Exception:
        log.exception("D41 drain-B body failed for thread %s", thread.id)
        # MED-3: a spawn-prelude raise (`_auto_route_agent`/`_build_session`/`run_turn`) AFTER the head
        # was committed off the queue would LOSE the message. If we committed it this invocation and have
        # NOT handed off to a seeded drain task yet (the raise beat the spawn), put the head back at the
        # FRONT of the thread's queue (created if it vanished) so it drains at the next opportunity /
        # harvests on Stop. Nothing is persisted; the finally releases.
        if committed_head is not None and not handed_off:
            requeue_front(state, thread.id, committed_head)
    finally:
        # SINGLE release point (FIX 2): unless a seeded turn's drain task took ownership (`handed_off`),
        # free the marker here. A clean `completed` all-exec drain ALSO records a terminal (so a probe
        # settles) and CHAINS — re-checking the queue for a message that arrived during the run. On any
        # non-completed exit (cancel / abandon / stale-head / prelude-raise) we ONLY release: no terminal
        # record, no chain (`_maybe_spawn_drain_b`'s own `!= "completed"` guard would suppress it anyway).
        if not handed_off:
            release(state.turns, handle)
            if handle.terminal_status == "completed":
                record_terminal(
                    state.turn_terminals, handle, linger_s=cfg.linger_s, cap=cfg.terminal_cache_cap
                )
                _maybe_spawn_drain_b(state, thread, handle, cfg)


async def start_steer_turn(state, thread: Thread, entries: list[SteerEntry]) -> None:
    """Start a fresh turn seeded by a queued steer (D41 Drain B) — the state-shaped mirror of the chat
    endpoint's turn-start internals (`_build_session` deps → `run_turn` → the server-owned drain-task
    spawn). `entries[0]` is a `message` head whose CAPTURED params (`mode`/`agent`/`privilege`/
    `skills`) play the roles `body.*` play for a fresh POST, incl. the auto-router — so the spawned turn
    runs exactly as the POST that enqueued it would have (D41 §9). The head marker is ALREADY reserved
    (by `_maybe_spawn_drain_b`, kind `chat`); this looks it up and hands it to the drain task.

    The head text is persisted as the user message by `run_turn` itself (NOT here) — mirroring the chat
    endpoint, which never persists the message separately, it just calls `session.run_turn`. Any
    remaining queued entries stay put and drain at this new turn's first loop top (Drain A)."""
    head = entries[0]
    handle = state.turns.get(thread.id)
    if handle is None:  # defensive — the caller reserved it; a vanished marker means abandon the spawn
        return
    agent_name = _auto_route_agent(state, thread, head.agent, head.text)
    # The captured privilege round-trips as a string (`body.privilege.value` at enqueue); re-hydrate it
    # to `Privilege | None`, tolerating a junk value like the endpoint's lenient `_coerce_privilege`.
    privilege: Privilege | None = None
    if head.privilege is not None and head.privilege in {p.value for p in Privilege}:
        privilege = Privilege(head.privilege)
    session = _build_session(state, thread, agent_name=agent_name, privilege=privilege)
    handle.mode = head.mode  # the turn's inference mode — the snapshot carries it (D39)
    events = session.run_turn(thread, head.text, mode=head.mode, skills=head.skills)
    _spawn_drain_task(state, thread, events, handle, state.settings.agent.turns)


async def _turn_response(
    request: Request,
    thread: Thread,
    events: AsyncIterator[Any],
    *,
    stream: bool,
    handle: TurnHandle,
) -> Response:
    """Wire a reserved turn to its transport as a **server-owned drain task** (D39, the ACA-1 core
    inversion). `events` is `session.run_turn(...)`/`session.resume(...)`. Instead of the client's
    stream BEING the executor, a subscriber queue is attached synchronously and a `drain_turn` task is
    spawned on `handle.task`: the task drives the loop to completion regardless of the client, and the
    SSE generator (or the buffered `collect_turn` wrapper) is just a consumer reading that queue. A
    phone lock / dropped socket now detaches the subscriber, not the loop — completed AND remaining
    steps still run + persist.

    Marker release rides the task's `add_done_callback` (idempotent cleanup ONLY), which fires exactly
    once whenever the task reaches done — every terminal path (completed/suspended/cancelled/error) —
    decoupled from any awaiting consumer. `handle.terminal_status` is set inside the task's own
    `finally` BEFORE the terminal sentinel, so there is no done-but-unmarked window."""
    head = {"threadId": thread.id, "title": thread.title}
    state = request.app.state
    cfg = state.settings.agent.turns

    # Attach the subscriber synchronously, THEN spawn the drain task — no `await` between (D39
    # zero-gap join: the task can't emit before the subscriber is listening). The buffered (stream=
    # False) consumer is same-process and drains as fast as the loop produces, so it gets an UNBOUNDED
    # queue (maxsize=0): a >queue_size synchronous event burst must never detach+truncate it — that
    # could drop the `permission` frame → a non-resumable buffered confirm. Restores the pre-inversion
    # lossless guarantee; SSE subscribers stay bounded (overflow → detach, S3-F).
    queue = make_subscriber(handle, cfg.subscriber_queue_size if stream else 0)
    _spawn_drain_task(state, thread, events, handle, cfg)

    async def _consume(after_seq: int = 0) -> AsyncIterator[Any]:
        # Drain the subscriber queue as `AgentEvent`s until the terminal sentinel, then DETACH (never
        # release — the task's done-callback owns that). Detach on ANY exit (completion or the client
        # cancelling the generator) so the drain task stops fanning out to a gone consumer. Same
        # `_force_put`-eviction continuity guard as `_stream_live`, `expected` SEEDED to `after_seq + 1`
        # (a leading-edge eviction also trips it): BREAK on a `seq` gap so a damaged stream never
        # settles (the buffered queue is unbounded above, so this is belt-and-braces). Buffered is
        # always a fresh attach (after_seq=0), so its first event is seq 1 == 0 + 1.
        expected = after_seq + 1
        try:
            async for seq, ev in subscribe_events(queue):
                if seq > expected:
                    break  # gap from a `_force_put` eviction — stop before yielding a damaged tail
                expected = seq + 1
                yield ev
        finally:
            remove_subscriber(handle, queue)

    if not stream:
        # Buffered D17 collapses into a subscriber: `collect_turn` drains the same queue, so buffered
        # turns are server-owned + cancellable for free (re-attach is documented degraded — the PWA
        # always streams).
        payload = await collect_turn(_consume())
        return JSONResponse({**head, **payload})

    async def gen() -> AsyncIterator[dict[str, Any]]:
        yield {"event": "thread", "data": json.dumps(head)}
        # A fresh subscriber has no prefix to dedupe against — stream every event (`_stream_live`
        # frames `turn_id:seq` + detaches in its finally, the shared framing with re-attach).
        async for frame in _stream_live(handle, queue):
            yield frame

    # The chat SSE gains a keepalive (ping) + a frozen-reader drop (send_timeout) — neither existed at
    # HEAD (S3-F). `ping`/`ping_s` are int seconds (sse-starlette's ping is int-typed; a sub-second
    # SSE keepalive is meaningless), passed straight through.
    return EventSourceResponse(gen(), ping=cfg.ping_s, send_timeout=cfg.send_timeout_s)


# ── Durable-turn re-attach / status / cancel (ACA Slice 3, D39) ─────────────────────────────────
# The read-side surface over the server-owned drain task: a lightweight status probe (wave-4's
# cold-load re-attach depends on it), a re-attach SSE stream (tail-replay or snapshot then live),
# and an idempotent cancel. All read-only w.r.t. the turn marker — NONE `_reserve_turn`-guarded:
# they must work EXACTLY while a thread is busy.


def _parse_cursor(cursor: str | None) -> tuple[str, int] | None:
    """Parse a `turn_id:seq` reconnect cursor → `(turn_id, seq)` or None (absent / malformed). The
    `turn_id` is uuid4 hex (no colons), so a single split on the last `:` is unambiguous."""
    if not cursor:
        return None
    turn_id, sep, seq = cursor.rpartition(":")
    if not sep or not turn_id or not seq.isdigit():
        return None
    return turn_id, int(seq)


@router.get("/agent/turns/{thread_id}")
async def turn_status(thread_id: str, request: Request) -> dict[str, Any]:
    """Lightweight status probe (D39/M4) — read-only, no turn-guard. A live handle → the running
    turn's identity + current `seq` (the client's cursor floor for a re-attach); else the terminal
    cache → the finished turn's outcome; else `{active: false}` (unknown / lingered out → reload).
    Wave-4's cold page-load re-attach probes this before deciding to attach or reload."""
    state = request.app.state
    handle = state.turns.get(thread_id)
    # D41: carry the thread's pending steer queue (ordered; [] when none) on EVERY branch so a reload /
    # cold-load re-renders queued bubbles from server truth instead of dropping them. Read-only.
    q = state.steer_queues.get(thread_id)
    steer = [{"entry_id": e.entry_id, "kind": e.kind, "text": e.text} for e in q.peek()] if q else []
    # LIVE only while a drain TASK is genuinely running. Three exclusions collapse into one guard:
    #   • `task is None` — a SYNC-kind marker (exec/plan/apply/compact) runs inline in its handler and
    #     never spawns a task; its `terminal_status` stays None forever, so without this it would read
    #     active:true and a re-attach subscriber would wait on a queue nothing ever dispatches to. (A
    #     pre-spawn chat/resume handle also briefly has task=None → reads inactive; harmless — that
    #     turn's own POST carries its stream, no one re-attaches in that synchronous window.)
    #   • `terminal_status` set — the drain task already pushed the terminal sentinel but its
    #     `_cleanup` done-callback hasn't run yet (one `call_soon` tick); a re-attach then would get a
    #     fresh queue that never sees TERMINAL → wedged SSE + leaked subscriber.
    # Either → fall through to the terminal path. (Known one-tick divergence, accepted: in the
    # done-but-unreleased window `reserve()` still 409s on membership while this probe reads
    # inactive — never treat an inactive probe as "reserve will succeed"; the callback runs on the
    # next loop iteration, before any client could round-trip a POST.)
    if handle is not None and handle.terminal_status is None and handle.task is not None:
        return {
            "active": True,
            "turn_id": handle.turn_id,
            "seq": handle.seq,
            "kind": handle.kind,
            "started_at": handle.started_at.isoformat(),
            "steer_queue": steer,
        }
    # Done-but-unreleased (C4-M2): a settled handle (`terminal_status` set — the drain task finished
    # but its `_cleanup` done-callback hasn't recorded to the cache yet, one `call_soon` tick) is
    # AUTHORITATIVE for its own turn. Prefer it over the cache, which in this window still holds the
    # PREVIOUS turn's record — consulting the cache first would report the prior turn's outcome under
    # THIS turn's probe. Only fall back to the cache (then the unsettled-handle fallback) otherwise.
    if handle is not None and handle.terminal_status is not None:
        return {
            "active": False,
            "terminal_status": handle.terminal_status,
            "turn_id": handle.turn_id,
            "steer_queue": steer,
        }
    rec = get_terminal(state.turn_terminals, thread_id, linger_s=state.settings.agent.turns.linger_s)
    if rec is not None:
        return {
            "active": False,
            "terminal_status": rec.terminal_status,
            "turn_id": rec.turn_id,
            "steer_queue": steer,
        }
    if handle is not None:  # an unsettled sync-kind / pre-spawn marker — report it (terminal null)
        return {
            "active": False,
            "terminal_status": handle.terminal_status,
            "turn_id": handle.turn_id,
            "steer_queue": steer,
        }
    return {"active": False, "steer_queue": steer}


@router.get("/agent/turns/{thread_id}/stream")
async def turn_stream(thread_id: str, request: Request, cursor: str | None = None) -> Response:
    """Re-attach to a live turn (D39). Optional `?cursor=turn_id:seq`. Read-only — NOT
    `_reserve_turn`-guarded (a detached-but-running turn already holds its marker; this just attaches
    another subscriber to it).

    - **Live turn:** attach a subscriber queue and build the reply prefix SYNCHRONOUSLY — there is
      deliberately NO `await` between `make_subscriber` and the tail/snapshot build (the D39 zero-gap
      join: the drain task cannot dispatch an event we'd miss in that window). Then:
        · cursor matches THIS turn AND its `seq+1` still sits in the ring → **tail-replay** the ring's
          `(seq, ev)` with `seq > cursor.seq`, framed identically to the live stream, then live from
          the queue (deduped `seq > after_seq`).
        · otherwise → **ONE `turn.sync` snapshot** (the accumulator; carries `mode` so the client
          re-pins `modeByCall`) then live. Snapshot is always available regardless of ring eviction —
          the durable floor is per-step SQLite; the ring is only a cache.
    - **No live turn:** a JSON `{active:false, terminal_status, turn_id}` (from the cache or nulls) —
      the CHOSEN shape for D39's "terminal sentinel for late re-attachers": a plain JSON answer, not
      an SSE stream, so the client falls back to a reload rather than opening a dead stream."""
    state = request.app.state
    cfg = state.settings.agent.turns
    handle = state.turns.get(thread_id)
    # NOT live (→ the JSON terminal answer) in three cases, mirroring `turn_status`'s guard:
    #   • no handle;
    #   • `terminal_status` set — the drain task finished but its `_cleanup` done-callback hasn't run
    #     yet; attaching would hand back a fresh queue that never receives TERMINAL (wedged SSE);
    #   • `task is None` — a SYNC-kind marker (exec/plan/apply/compact) with no drain task ever
    #     dispatches, so a subscriber would wait forever. (A pre-spawn chat/resume handle also reads
    #     task=None briefly → JSON answer; harmless, its own POST carries the stream.)
    if handle is None or handle.terminal_status is not None or handle.task is None:
        # Done-but-unreleased (C4-M2): a settled handle (`terminal_status` set, `_cleanup` not yet
        # fired) is authoritative for its own turn — prefer it over the cache, which in this one-tick
        # window still holds the PREVIOUS turn's record. Fall back to the cache only when the handle
        # isn't settled (a sync-kind / pre-spawn marker) or is absent.
        if handle is not None and handle.terminal_status is not None:
            return JSONResponse(
                {
                    "active": False,
                    "terminal_status": handle.terminal_status,
                    "turn_id": handle.turn_id,
                }
            )
        rec = get_terminal(state.turn_terminals, thread_id, linger_s=cfg.linger_s)
        return JSONResponse(
            {
                "active": False,
                "terminal_status": (
                    rec.terminal_status
                    if rec is not None
                    else (handle.terminal_status if handle is not None else None)
                ),
                "turn_id": (
                    rec.turn_id if rec is not None else (handle.turn_id if handle is not None else None)
                ),
            }
        )

    # ── Zero-gap join (D39): attach synchronously, THEN build the prefix synchronously. No `await`
    # between these two steps, so no event can be dispatched to the ring/queue in the gap.
    queue = make_subscriber(handle, cfg.subscriber_queue_size)
    parsed = _parse_cursor(cursor)
    prefix: list[dict[str, Any]] = []
    if (
        parsed is not None
        and parsed[0] == handle.turn_id
        and handle.ring
        and parsed[1] >= handle.ring[0][0] - 1  # seq+1 still in the ring → tail-replay is lossless
    ):
        cur_seq = parsed[1]
        prefix = [_sse_frame(handle.turn_id, seq, ev) for seq, ev in handle.ring if seq > cur_seq]
    else:
        snap = handle.accumulator.snapshot(mode=handle.mode, seq=handle.seq)
        # D41 MED-1 — carry the thread's PENDING steer queue (read LIVE at snapshot-build time; disjoint
        # from the accumulator's already-drained `steers`) so a cold-load / re-attach re-renders queued
        # bubbles instead of the FE's forced reload wiping them. Mirrors `turn_status`'s per-branch carry.
        q = state.steer_queues.get(thread_id)
        snap["steer_queue"] = (
            [{"entry_id": e.entry_id, "kind": e.kind, "text": e.text} for e in q.peek()] if q else []
        )
        prefix = [{"event": "turn.sync", "id": f"{handle.turn_id}:{handle.seq}", "data": json.dumps(snap)}]
    after_seq = handle.seq  # every prefix frame is through `seq` — live-dedupe strictly beyond it

    async def gen() -> AsyncIterator[dict[str, Any]]:
        for frame in prefix:
            yield frame
        async for frame in _stream_live(handle, queue, after_seq=after_seq):
            yield frame

    return EventSourceResponse(gen(), ping=cfg.ping_s, send_timeout=cfg.send_timeout_s)


async def _cancel_turn_id(request: Request) -> str | None:
    """Parse the optional `{turn_id}` from a cancel request body (A6/C4-H2). A cancel with no body
    (the legacy shape) or a non-JSON/non-dict body → `None` (cancel the live turn, whatever it is).
    A non-empty string `turn_id` scopes the cancel to that specific turn."""
    try:
        body = await request.json()
    except Exception:
        return None  # empty body / not JSON → legacy unscoped cancel
    if isinstance(body, dict):
        tid = body.get("turn_id")
        if isinstance(tid, str) and tid:
            return tid
    return None


# ── Replayable Stop-harvest receipt (D41 FIX 4) ────────────────────────────────────────────────
# `app.state.steer_harvests: dict[thread_id, {entries, turn_id, ts}]` — the `turn_terminals` linger
# pattern applied to Stop's steer harvest. A cancel harvests the queue destructively (pop), so a Stop
# whose RESPONSE was lost (socket drop) would, on retry, get an EMPTY queue and the composer would
# never restore the harvested lines. This small short-lived cache lets a repeat cancel within
# `linger_s` return the SAME entries (`harvest_replayed:true`). Cleared when the linger expires (swept
# on read) or a new turn starts on the thread (the entries are stale context by then — see chat/exec).


def _sweep_harvests(harvests: dict[str, dict[str, Any]], linger_s: float, now: float) -> None:
    """Drop receipts older than `linger_s` (monotonic seconds). Opportunistic — called on every
    record/replay, so there is no background sweeper (the `turn_terminals` discipline)."""
    for tid in [t for t, r in harvests.items() if now - r["ts"] > linger_s]:
        del harvests[tid]


def _record_or_replay_harvest(
    state, thread_id: str, harvested, handle: TurnHandle | None, cfg
) -> tuple[list[dict[str, Any]], bool]:
    """FIX 4. If THIS cancel harvested a live queue → snapshot its entries into a replayable receipt and
    return `(entries, replayed=False)`. If the queue was already gone (a repeat Stop) → return a still
    lingering prior receipt's entries as `(entries, replayed=True)` so a lost Stop response recovers;
    absent → `([], False)`."""
    harvests = state.steer_harvests
    now = time.monotonic()
    _sweep_harvests(harvests, cfg.linger_s, now)
    if harvested is not None:
        entries = [{"entry_id": e.entry_id, "kind": e.kind, "text": e.text} for e in harvested.peek()]
        harvests[thread_id] = {
            "entries": entries,
            "turn_id": handle.turn_id if handle is not None else None,
            "ts": now,
        }
        return entries, False
    rec = harvests.get(thread_id)
    if rec is not None:
        return rec["entries"], True
    return [], False


@router.post("/agent/turns/{thread_id}/cancel")
async def cancel_turn_endpoint(
    thread_id: str, request: Request, turn_id: str | None = None
) -> dict[str, Any]:
    """Cancel a running turn (D39/S3-C, opencode's unstick affordance). Idempotent. **This handler
    WRITES NOTHING to the thread** — `cancel_turn` only fires the task's single cancel; ALL thread
    mutation (the stale in-flight-call reconcile + the terminal persist) happens INSIDE the drain task's
    own CancelledError path, while it still holds the thread's marker (no successor race). That is why
    this route is NOT `_reserve_turn`-guarded (cancel must work exactly while the thread is busy) and why
    `test_turn_guard_invariant.py` doesn't flag it — its source carries no mutation markers.

    Scope (A6 / D41 FIX 3): the `?turn_id=` QUERY PARAM scopes the cancel to a SPECIFIC turn. It is read
    SYNCHRONOUSLY and the scope check runs BEFORE the harvest, so a DELAYED Stop for turn A (the socket
    dropped, the client retried, a successor turn B started) neither cancels B nor HARVESTS B's steer
    queue — the successor's queue is not yours. On a scoped mismatch we refuse WITHOUT harvesting and
    hand back the live turn (`{cancelled:false, active:true, turn_id:<live>}`). A stale JSON body
    `{turn_id}` is still accepted for back-compat (below, after the harvest) but the query param wins;
    the FE sends the query param.

    Order (D41 FIX 3): (1) sync scope-check-before-harvest; (2) sync harvest-first (the D41 convergent
    HIGH — a `_cleanup` racing a natural completion finds the queue ABSENT → its drain-B spawn is
    structurally suppressed; Stop can neither auto-run nor lose a steer); (3) the cancel + settle.

    Replayable harvest (D41 FIX 4): the harvest is stored in `app.state.steer_harvests` (the
    `turn_terminals` linger pattern) BEFORE returning, so a Stop whose RESPONSE was lost (socket drop)
    can retry: a REPEAT cancel within the linger returns the SAME entries with `harvest_replayed:true`
    instead of an empty queue (the old lossy behaviour). Cleared when the linger expires or a new turn
    starts on the thread (see chat/exec).

    Live turn → fire the single cancel (`cancelling` latch makes a repeat a no-op — a second raw
    `task.cancel()` would pierce the persistence shield, D39 H2), then await the task under
    `shutdown_grace_s` so the response carries the settled `terminal_status`."""
    state = request.app.state
    cfg = state.settings.agent.turns
    handle = state.turns.get(thread_id)
    # (1) SYNC SCOPE-CHECK BEFORE HARVEST (FIX 3): the query-param turn_id is available synchronously, so
    # a scoped Stop that names a turn OTHER than the live one refuses WITHOUT touching the successor's
    # queue. Only guards a genuinely-live task-bearing turn; no-live-turn / sync-kind falls through to
    # the harvest (an orphan / no-successor scoped Stop harvests correctly).
    if turn_id and handle is not None and handle.task is not None and turn_id != handle.turn_id:
        q = state.steer_queues.get(thread_id)  # read-only peek — do NOT harvest the successor's queue
        steer = [{"entry_id": e.entry_id, "kind": e.kind, "text": e.text} for e in q.peek()] if q else []
        return {"cancelled": False, "active": True, "turn_id": handle.turn_id, "steer_queue": steer}
    # (2) HARVEST-FIRST (D41 convergent HIGH): synchronous pop before any `await`, so a racing `_cleanup`
    # finds the queue absent. FIX 4: store the harvest receipt (or replay a prior one on a repeat Stop).
    harvested = state.steer_queues.pop(thread_id, None)
    steer, replayed = _record_or_replay_harvest(state, thread_id, harvested, handle, cfg)
    resp: dict[str, Any] = {"steer_queue": steer}
    if replayed:
        resp["harvest_replayed"] = True
    if handle is None or handle.task is None:
        return {**resp, "cancelled": False, "active": False}
    # (3) back-compat: a JSON-body `{turn_id}` still scopes (the query param already won above if set).
    want_turn = turn_id or await _cancel_turn_id(request)
    if want_turn is not None and want_turn != handle.turn_id:
        # A stale/mistargeted Stop via the legacy body — the named turn is not the one running now.
        return {**resp, "cancelled": False, "active": True, "turn_id": handle.turn_id}
    fired = cancel_turn(handle)  # False if already cancelling / already done (the latch)
    # `asyncio.wait` does NOT re-raise the awaited task's CancelledError (unlike a direct `await
    # task`), so the endpoint settles cleanly whether the turn ends by cancel or was already ending.
    await asyncio.wait([handle.task], timeout=cfg.shutdown_grace_s)
    return {**resp, "cancelled": fired, "terminal_status": handle.terminal_status}


@router.delete("/agent/turns/{thread_id}/steer/{entry_id}")
async def delete_steer(thread_id: str, entry_id: str, request: Request) -> dict[str, Any]:
    """Cancel a still-queued steer (D41) — the FE's "unsend a queued bubble". SYNCHRONOUS dequeue, no
    turn-guard (the queue is not busy-state). Present → `{removed: true}`; absent (already drained /
    spawned into a turn, or never there) → `{removed: false, reason: "already sent"}` at 200 (NOT 404,
    so the FE resolves the bubble to its swapped form gracefully instead of erroring)."""
    q = request.app.state.steer_queues.get(thread_id)
    if q is not None and q.remove(entry_id):
        prune_if_empty(request.app.state.steer_queues, thread_id, q)  # FIX 5: drop an emptied queue shell
        return {"removed": True}
    return {"removed": False, "reason": "already sent"}


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
    if thread is not None:
        await _reject_automation_thread(request.app.state, thread)  # §D-3 rolling-thread guard
    if thread is None:
        thread = await threads.create(Thread(title=body.text[:60]))

    # Apply any pending MCP/OpenAPI integration edits at the turn boundary (Phase 7c-b) — before the
    # session reads the toolset, so the registry is rebuilt between turns, never mid-loop. ACA-17
    # rider (D38/S2-B): only when NO turn marker is held on ANY thread — a live turn elsewhere may be
    # iterating the registry, so skip and let `integrations_dirty` re-fire at the next quiet boundary.
    if getattr(request.app.state, "integrations_dirty", False) and not request.app.state.turns:
        await rediscover_integrations(request.app)

    # Auto-route to a specialist (7e-g, D15 #8) only when nothing pins the agent — an explicit
    # `/agent` (body.agent) or a thread-sticky agent always wins, and the switch is off by default.
    # `thread.agent` is never set in normal chat (created None), so "no pin" → per-turn routing.
    state = request.app.state
    agent_name = _auto_route_agent(state, thread, body.agent, body.text)

    # Reserve the thread's turn marker (D38) — synchronous check-and-set, after the thread is resolved
    # and the auto-rediscover boundary, before the response is built. Ownership transfers to the
    # server-owned drain task (`_turn_response` releases it via the task's done-callback, D39); if
    # anything raises before we hand off, release + re-raise so no marker leaks.
    #
    # D41 (Slice 5): when the thread ALREADY runs a chat/resume turn, STEER — enqueue the message
    # (202) instead of the old 409. The captured `SteerEntry` is built ONCE and reused by both steer
    # paths below.
    cfg = state.settings.agent.turns
    steer_entry = SteerEntry(
        kind="message",
        text=body.text,
        mode=body.mode,
        agent=body.agent,
        privilege=body.privilege.value if body.privilege is not None else None,
        skills=body.skills,
    )
    # CAP-SHADOWS-STEER corner fix (D41 wave-1): check the LIVE holder synchronously BEFORE the reserve
    # — if a chat/resume turn already owns this thread, enqueue directly (never touching
    # `_reserve_or_busy`). Otherwise a saturated `max_active_turns` would make `_reserve_or_busy` raise
    # the CAP 409 before we ever learn the thread is busy, so steering a busy thread would 409 instead
    # of 202. The cap gates genuinely-NEW turns only; steering an already-running thread must always
    # queue. This check→enqueue block is await-free (D38 TOCTOU). The `except TurnBusy` below stays as
    # the belt for the race where a turn appears BETWEEN this check and the reserve.
    live = state.turns.get(thread.id)
    if live is not None and live.kind in ("chat", "resume"):
        return _steer_202(state, thread.id, live, steer_entry, cfg)
    try:
        handle = _reserve_or_busy(state, thread.id, "chat", cfg)
    except TurnBusy as e:
        if e.handle.kind not in ("chat", "resume"):
            raise HTTPException(status_code=409, detail=_TURN_BUSY_DETAIL) from e
        return _steer_202(state, thread.id, e.handle, steer_entry, cfg)
    # D41 FIX 4: a genuinely-new turn started → drop any lingering Stop-harvest receipt (its entries are
    # stale context now that a fresh turn owns the thread). A steer-enqueue (202 above) is NOT a new turn.
    state.steer_harvests.pop(thread.id, None)
    try:
        session = _session(request, thread, agent_name=agent_name, privilege=body.privilege)
        stream = _effective_stream(request.app.state.settings.agent.streaming, body.stream)
        handle.mode = body.mode  # the turn's inference mode — the snapshot carries it (D39)
        events = session.run_turn(thread, body.text, mode=body.mode, skills=body.skills)
        return await _turn_response(request, thread, events, stream=stream, handle=handle)
    except Exception:
        # Release only PRE-handoff. Once `_turn_response` spawned the drain task (`handle.task` set),
        # its done-callback is the SINGLE marker owner — releasing here (e.g. buffered `collect_turn`
        # raising) would free the marker while the orphan turn still runs, letting a concurrent POST
        # reserve the same thread (one-turn-per-thread violated).
        if handle.task is None:
            release(request.app.state.turns, handle)
        raise


@router.post("/exec", response_model=None)  # union return (dict | 202 steer Response) — no response model
async def exec_shell(body: ExecRequest, request: Request) -> dict[str, Any] | Response:
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
    if thread is not None:
        await _reject_automation_thread(request.app.state, thread)  # §D-3 rolling-thread guard
    if thread is None:
        thread = await threads.create(Thread(title=f"! {body.command[:58]}"))

    # Reserve the thread's turn marker (D38). D41 (Slice 5): a `!cmd` to a thread already running a
    # chat/resume turn STEERS — enqueue the command (202) instead of the old 409, drained at the
    # running turn's loop top / turn end (waves 2–3). The `user_exec_enabled` 403 above stays BEFORE
    # this reserve (fail-early UX); the drain-side re-check (fail-closed) is wave 2's. A sync holder
    # keeps the 409. The catch→append is synchronous-atomic (no `await`; D38 TOCTOU). Non-steer path:
    # released in the finally.
    state = request.app.state
    cfg = state.settings.agent.turns
    steer_entry = SteerEntry(kind="exec", text=body.command)
    # CAP-SHADOWS-STEER corner fix (D41 wave-1, mirrors chat): steer a busy chat/resume thread BEFORE
    # the reserve so a saturated `max_active_turns` cap can't shadow the enqueue with a 409. Await-free
    # (D38 TOCTOU); the `except TurnBusy` below is the belt for the check↔reserve race.
    live = state.turns.get(thread.id)
    if live is not None and live.kind in ("chat", "resume"):
        return _steer_202(state, thread.id, live, steer_entry, cfg)
    try:
        handle = _reserve_or_busy(state, thread.id, "exec", cfg)
    except TurnBusy as e:
        if e.handle.kind not in ("chat", "resume"):
            raise HTTPException(status_code=409, detail=_TURN_BUSY_DETAIL) from e
        return _steer_202(state, thread.id, e.handle, steer_entry, cfg)
    state.steer_harvests.pop(thread.id, None)  # D41 FIX 4: a new turn started → drop the stale receipt
    try:
        # ONE user-exec implementation (D41): run_shell@FULL + the atomic assistant+tool pair persist,
        # shared verbatim with the steer drain (`run_user_exec`). Response shape unchanged.
        exec_out = await run_user_exec(
            request.app.state.actions, request.app.state.messages, thread.id, body.command
        )
        return {"threadId": thread.id, "callId": exec_out.call_id, "state": exec_out.result.state.value}
    finally:
        release(request.app.state.turns, handle)


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


def _clean_model_name(settings: Settings, provider: str, wire_id: str) -> str | None:
    """Map a resolved WIRE model id back to its clean catalog name for `GET /api/providers` (so the FE
    picker can correlate the effective section with the per-provider `models` clean-name list). An
    uncataloged raw-id passthrough has no clean name → the raw id is returned as-is."""
    if not wire_id:
        return None
    pc = settings.providers.get(provider)
    if pc is not None:
        for clean, m in pc.models.items():
            if (m.id or clean) == wire_id:
                return clean
    return wire_id  # uncataloged passthrough


@router.get("/providers")
async def get_providers(request: Request) -> dict[str, Any]:
    """The composer + Conf provider directory (A11/D48 C7/R9) — a lightweight NAKED, NON-SECRET read
    (no api_key, no base_url; names + catalogs + the effective default chain only), modeled on
    `GET /api/appearance`. The composer consumes `verbs` directly for `/<provider>` completion; Conf
    reads the full `providers` map + `sections`. Resolved LENIENTLY (boot policy) so `sections` reports
    the EFFECTIVE chain (post-lenient promotion, what the registry actually resolved — C9), and
    `warnings` are the current generation's lenient/boot notices + the LIVE skill-collision set.

    `verbs` = composer-routable CHAT providers only (C7/R9): a provider in the inference chain, OR a
    non-chain provider whose catalog has exactly ONE model (multi-model non-chain providers coerce to the
    default and are NOT advertised). A provider shadowed by a skill or a reserved built-in verb is excluded
    (precedence built-ins > skills > providers). A provider referenced ONLY by a voice/embeddings section
    (not in the inference chain) is ALSO excluded — the referencing section determines usage, so a whisper
    server must not surface as a chat `/verb` (no-capability-tags principle; typed-verb ROUTABILITY via
    `chain_for` is unchanged, C7). All such providers stay in the `providers` map for Conf."""
    from app.core.provider_registry import (
        RESERVED_VERBS,
        is_reserved_verb,
        provider_skill_collision_warnings,
        resolve_lenient,
    )

    settings: Settings = request.app.state.settings
    registry, warnings = resolve_lenient(settings)
    chain = registry.inference_chain

    def _ref(t: Any) -> dict[str, Any]:
        return {"provider": t.provider, "model": _clean_model_name(settings, t.provider, t.model)}

    def _section(ch: tuple[Any, ...]) -> dict[str, Any]:
        return {
            "provider": ch[0].provider if ch else None,
            "model": _clean_model_name(settings, ch[0].provider, ch[0].model) if ch else None,
            "fallbacks": [_ref(t) for t in ch[1:]],
        }

    skill_names = (
        [s.name for s in request.app.state.skills.list()]
        if getattr(request.app.state, "skills", None) is not None
        else []
    )
    # A provider used ONLY by a voice/embeddings section (absent from the inference chain) is not a chat
    # verb (R9): the referencing section determines usage.
    inference_providers = {t.provider for t in chain}
    voice_emb_providers = {
        t.provider for t in (*registry.stt_chain, *registry.tts_chain, *registry.embeddings_chain)
    }
    verbs = [
        name
        for name, rp in registry.providers.items()
        if rp.verb_target is not None
        and name not in set(skill_names)
        and not is_reserved_verb(name)
        and not (name in voice_emb_providers and name not in inference_providers)
    ]
    return {
        "providers": {
            name: {"api_mode": p.api_mode, "models": list(p.models.keys())}
            for name, p in settings.providers.items()
        },
        "rev": providers_rev(settings),
        "sections": {
            "inference": _section(chain),
            "stt": _section(registry.stt_chain),
            "tts": _section(registry.tts_chain),
            "embeddings": _section(registry.embeddings_chain),
        },
        "reserved_verbs": list(RESERVED_VERBS),
        "verbs": verbs,
        "warnings": list(warnings)
        + provider_skill_collision_warnings(settings.providers.keys(), skill_names),
    }


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


def _read_skill_md(p: Path) -> str | None:
    """Blocking read of a `SKILL.md`, or None if absent — one `to_thread` hop for the exists+read
    pair (SYS-16) so the check and the read can't straddle the event loop."""
    return p.read_text(encoding="utf-8") if p.is_file() else None


@router.get("/skills/{name}")
async def get_skill(name: str, request: Request) -> dict[str, Any]:
    """The raw `SKILL.md` text for the editor (7d). 404 if the skill doesn't exist; a fresh name
    returns the scaffold template so the editor opens populated."""
    p = _skill_root(request, name) / name / "SKILL.md"
    content = await asyncio.to_thread(_read_skill_md, p)
    if content is None:
        raise HTTPException(status_code=404, detail=f"unknown skill '{name}'")
    return {"name": name, "content": content}


@router.put("/skills/{name}")
async def put_skill(name: str, body: SkillContent, request: Request) -> dict[str, Any]:
    """Create or overwrite `skills/<name>/SKILL.md` (7d). The FileSkillProvider re-scans per call, so
    a save is live with no restart. Blank content → the scaffold template (used by 'add skill')."""
    root = _skill_root(request, name)
    content = body.content if body.content.strip() else _SKILL_TEMPLATE.format(name=name)
    await asyncio.to_thread(write_skill_md, root, name, content)
    return {"name": name, "content": content}


@router.delete("/skills/{name}")
async def delete_skill(name: str, request: Request) -> dict[str, Any]:
    """Remove a skill's `SKILL.md` (7d) and its folder if it's left empty (resource files the owner
    dropped in are preserved — only an empty folder is cleaned up). Idempotent: 404 if not present."""
    if not await asyncio.to_thread(remove_skill_md, _skill_root(request, name), name):
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


def _load_agent_payload(s: Settings, name: str, folder: Path, is_default: bool) -> dict[str, Any] | None:
    """Blocking load (agent.yaml) + payload build (SOUL.md read) in one `to_thread` hop (SYS-16).
    None → no such specialist folder (the caller 404s)."""
    agent = s.load_agent(name)
    if agent is None:
        return None
    return _agent_payload(name, agent, folder, is_default)


def _scaffold_agent(
    s: Settings, name: str, folder: Path, fields: dict[str, Any], default_prompt: str
) -> dict[str, Any]:
    """The whole blocking write side of `PUT /agents/{name}` — mkdir → agent.yaml → scaffold SOUL.md
    → reload → payload — hoisted into one `to_thread` hop (SYS-16). Kept as one sequence so the
    mkdir/is_file/write chain doesn't straddle the loop (validation already ran on the caller)."""
    folder.mkdir(parents=True, exist_ok=True)
    write_text_eol(folder / "agent.yaml", yaml.safe_dump(fields, sort_keys=False, allow_unicode=True))
    soul_p = folder / "SOUL.md"
    if not soul_p.is_file():
        write_text_eol(soul_p, default_prompt + "\n")
    agent = s.load_agent(name)
    assert agent is not None, "agent.yaml was just written, so the folder resolves"
    return _agent_payload(name, agent, folder, False)


def _delete_agent_folder(folder: Path) -> bool:
    """Blocking is_dir + rmtree in one hop (SYS-16). False → nothing there (the caller 404s)."""
    if not folder.is_dir():
        return False
    shutil.rmtree(folder)
    return True


def _read_soul(folder: Path, *, require_folder: bool) -> str | None:
    """Blocking SOUL.md read in one hop (SYS-16). None → the specialist folder is missing (404);
    "" → no SOUL.md yet (the loop falls back to inference.system_prompt → baked)."""
    if require_folder and not folder.is_dir():
        return None
    p = folder / "SOUL.md"
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def _write_soul(folder: Path, content: str, *, require_folder: bool) -> bool:
    """Blocking SOUL.md write-or-remove in one hop (SYS-16). False → folder missing (the caller
    404s). Blank content removes the file so the prompt falls back to inference.system_prompt."""
    if require_folder and not folder.is_dir():
        return False
    p = folder / "SOUL.md"
    if content.strip():
        folder.mkdir(parents=True, exist_ok=True)
        write_text_eol(p, content)
    elif p.is_file():
        p.unlink()
    return True


@router.get("/agents/{name}")
async def get_agent(name: str, request: Request) -> dict[str, Any]:
    """The resolved `AgentDef` (agent.yaml merged onto `agent.defaults`) + its `SOUL.md` persona, for
    the editor. 404 if a specialist folder is absent. The `default` name returns the root agent."""
    s = request.app.state.settings
    folder, is_default = _agent_folder(request, name, allow_default=True)
    payload = await asyncio.to_thread(_load_agent_payload, s, name, folder, is_default)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    return payload


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
    payload = await asyncio.to_thread(_scaffold_agent, s, name, folder, fields, DEFAULT_SYSTEM_PROMPT)
    # D46/F6: an agent-file edit can change reasoning_effort/reasoning_tokens, but (unlike an
    # inference-section edit) it never rebuilds the inference client — so clear the learned reasoning
    # demotions here or a corrected setting would stay stripped. Blanket-on-mutation (not field-diffing):
    # simpler, and re-learning a still-unsupported control costs one 400 on the next turn.
    clear_reasoning_demotions(request.app)
    return payload


@router.delete("/agents/{name}")
async def delete_agent(name: str, request: Request) -> dict[str, Any]:
    """Delete a specialist agent's whole folder (agent.yaml + SOUL.md + its memories). The default
    agent can't be deleted. Idempotent: 404 if absent."""
    folder, _ = _agent_folder(request, name)
    if not await asyncio.to_thread(_delete_agent_folder, folder):
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    # D46/F6: deleting a specialist drops its reasoning settings — clear demotions so a later agent that
    # reuses the same (endpoint, model) starts fresh (blanket-on-mutation; see `put_agent`).
    clear_reasoning_demotions(request.app)
    return {"name": name, "deleted": True}


@router.get("/agents/{name}/soul")
async def get_agent_soul(name: str, request: Request) -> dict[str, Any]:
    """The raw `SOUL.md` persona for an agent (incl. `default` → root SOUL.md). Empty string if the
    file doesn't exist yet (the loop falls back to inference.system_prompt → baked)."""
    folder, _ = _agent_folder(request, name, allow_default=True)
    require = name != request.app.state.settings.DEFAULT_AGENT_NAME
    content = await asyncio.to_thread(_read_soul, folder, require_folder=require)
    if content is None:
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
    return {"name": name, "content": content}


@router.put("/agents/{name}/soul")
async def put_agent_soul(name: str, body: SoulContent, request: Request) -> dict[str, Any]:
    """Write an agent's `SOUL.md` persona (incl. `default` → root SOUL.md). Blank content removes the
    file → the loop falls back to `inference.system_prompt` → the baked default."""
    folder, is_default = _agent_folder(request, name, allow_default=True)
    ok = await asyncio.to_thread(_write_soul, folder, body.content, require_folder=not is_default)
    if not ok:
        raise HTTPException(status_code=404, detail=f"unknown agent '{name}'")
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
    truncated?, rejected?}` — `removed: 0` means nothing was foldable (already compact / within the
    floor), `rejected: true` (D42) means the produced summary would not shrink the context so the fold
    was abandoned. `body.instructions` (the `/compact <instructions>` steer) threads into the
    summarizer prompt as an emphasis block."""
    threads = request.app.state.threads
    thread = await threads.get(body.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"unknown thread '{body.thread_id}'")
    # Reserve the thread's turn marker (D38) — compaction read-modify-writes can race the loop's own
    # `_compactor.compact` (double summary insertion); 409 while a turn is live. Released in finally.
    handle = _reserve_turn(request, thread.id, "compact")
    try:
        result = await _session(request, thread).compact(thread, instructions=body.instructions)
        # D42 R3: a manual compact that leaves the thread healthy resets the thrash machine to
        # all-defaults — drop the now-inert entry so `app.state.compaction_state` doesn't accumulate
        # dead threads (`compaction_state_for` re-mints it lazily; a still-latched entry is preserved).
        prune_compaction_state(request.app.state.compaction_state, thread.id)
        return result
    finally:
        release(request.app.state.turns, handle)


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

    # Reserve the thread's turn marker (D38) — a plan-dot tap read-modify-writes the same task_plan
    # rows the live loop updates (clobber either way); 409 while a turn is live. Released in finally.
    handle = _reserve_turn(request, body.thread_id, "plan")
    try:
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
            # SYS-1: the call + result rows are one edit — update them atomically.
            async with request.app.state.db.transaction():
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
        tool_msg = Message(
            thread_id=body.thread_id,
            role="tool",
            actor=Actor.USER,
            parts=[ToolResultPart(call_id=call_id, result=result)],
        )
        # SYS-1: persist the fresh call + result pair atomically.
        async with request.app.state.db.transaction():
            await messages.add(assistant)
            await messages.add(tool_msg)
        return {
            "plan": plan.model_dump(),
            "updated": False,
            "messages": [assistant.model_dump(mode="json"), tool_msg.model_dump(mode="json")],
        }
    finally:
        release(request.app.state.turns, handle)


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
    # Reserve the thread's turn marker (D38, kind "resume") — released via the drain task's
    # done-callback (D39; covers SSE + buffered); release + re-raise on any pre-handoff error.
    handle = _reserve_turn(request, thread.id, "resume")
    try:
        session = _session(request, thread, agent_name=last_agent, privilege=body.privilege)
        stream = _effective_stream(request.app.state.settings.agent.streaming, body.stream)
        handle.mode = body.mode  # carried onto the snapshot (D39) — same as chat
        events = session.resume(
            thread,
            body.call_id,
            body.decision,
            body.confirm_token,
            body.answer,
            mode=body.mode,
            skills=body.skills,
            app=request.app,  # D44 W2: the `execute_always` grant reuses the settings write machinery
        )
        return await _turn_response(request, thread, events, stream=stream, handle=handle)
    except Exception:
        # Release only PRE-handoff (see `chat`): post-spawn the drain task's done-callback is the
        # single marker owner, so releasing here would free the marker under a still-running turn.
        if handle.task is None:
            release(request.app.state.turns, handle)
        raise


class ApplyRequest(BaseModel):
    """Owner resolution of a proposed write (7e-f-3). A proposable tool (`memory`/`skill_manage`) with
    its auto-write switch off returns an OK result carrying `data["proposed"]` instead of writing; the
    chat bubble's Approve/Dismiss posts here. `decision` is apply|dismiss."""

    thread_id: str
    call_id: str
    #: Fail-closed (A3/C1-M3). `Literal` 422s any junk so an unknown value ("reject") can no longer
    #: fall through to APPLY the write — only exact `apply`/`dismiss` are accepted. The before-validator
    #: strips surrounding whitespace first so a padded valid value still passes.
    decision: Literal["apply", "dismiss"] = "apply"

    @field_validator("decision", mode="before")
    @classmethod
    def _strip_decision(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


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

    # Reserve the thread's turn marker (D38) — apply does the same in-place read-modify-write on the
    # call/result rows as /agent/plan (clobber risk vs the live loop); 409 while a turn is live.
    handle = _reserve_turn(request, body.thread_id, "apply")
    try:
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
            result_part.result = _resolved(
                result_part.result,
                applied=False,
                summary="the owner rejected this proposed write — not applied",
            )
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
            # C3-M2: a gate-denial / failed apply is auditable too — the owner clicked Approve and the
            # write did NOT run, so record it as a USER Event with the failure state (mirrors the
            # success record below) rather than leaving a silent gap in the audit trail.
            await deps.events.record(
                Event(
                    actor=Actor.USER,
                    action=call_part.tool,
                    status=written.state,
                    summary=written.summary,
                )
            )
            return {
                "call_id": body.call_id,
                "decision": "apply",
                "applied": False,
                "result": written.model_dump(mode="json"),
            }

        result_part.result = _resolved(written, applied=True)
        call_part.state = RunState.OK
        # SYS-1: flip the call state + rewrite the result row atomically (they can be two rows).
        # C3-M1 convergence: the write has ALREADY run (the memory/skill file is mutated). Persisting
        # the resolved call/result rows is what marks the proposal done so a re-approve can't duplicate
        # the append. If the atomic txn fails AFTER the successful write, retry the two row-updates
        # individually — each statement is atomic on its own, so the proposal still resolves and the
        # dup window closes. Only if THAT also fails do we leave it pending and surface a 500 whose
        # message states the write DID run — the owner must NOT re-approve (a re-approve would duplicate
        # the append). Tradeoff: a rare stuck-pending bubble over a silent duplicate write.
        try:
            async with request.app.state.db.transaction():
                await messages.update(call_msg)
                if result_msg is not call_msg:
                    await messages.update(result_msg)
        except Exception:
            log.exception(
                "apply %s: row-transaction failed after a successful write — retrying rows individually",
                call_part.tool,
            )
            try:
                await messages.update(call_msg)  # each update is its own atomic write+commit
                if result_msg is not call_msg:
                    await messages.update(result_msg)
            except Exception as exc:
                log.exception(
                    "apply %s: could NOT persist the resolution after a successful write — proposal "
                    "stays pending; do NOT re-approve (the write already ran, a re-approve would "
                    "duplicate)",
                    call_part.tool,
                )
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "the write ran but its result could not be saved — do not re-approve "
                        f"(it already applied): {str(exc)[:200]}"
                    ),
                ) from exc
        await deps.events.record(
            Event(actor=Actor.USER, action=call_part.tool, status=written.state, summary=written.summary)
        )
        return {
            "call_id": body.call_id,
            "decision": "apply",
            "applied": True,
            "result": result_part.result.model_dump(mode="json"),
        }
    finally:
        release(request.app.state.turns, handle)
