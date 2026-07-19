"""ACA Slice 7 / D43 Wave 3 — the failure-fallback routing machine.

Layered like the compaction W3 suite:
  - schema (`RoutingCfg`: `lead` required, the two `ge=1` bounds);
  - `RoutingState` trio (lazy-mint/memoize + prune-when-default);
  - the decision matrix driven through `AgentSession._drive` on the TestClient app (routing off =
    today; fresh worker/lead; the episode open→decrement→close with EXACTLY one notice each way; the
    `/local` prefix bypass; a resume reading `current_route`);
  - all-four-locals ride the routed lead ref in BOTH call paths (the main loop AND `_finalize` — the
    H2 pin), asserted on the captured `stream_chat` kwargs;
  - the compaction output-reserve prices the ROUTED ref on a lead turn;
  - structural counting (single-endpoint error counts, multi-endpoint outage / degraded don't,
    exhaustion + stall count, completed resets, suspended is neutral);
  - a mid-episode state survives turns; a healthy thread prunes.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from _async import run_async
from pydantic import ValidationError

from app.adapters.inference import ChatDelta, InferenceError, ToolCallRequest
from app.domain.agent import CompactionCfg, ModelRef, RoutingCfg
from app.domain.conversation import Message, ToolCallPart
from app.domain.enums import Actor, RunState
from app.services.agent.compaction import Compactor
from app.services.agent.routing import RoutingState, prune_routing_state, routing_state_for
from app.services.agent.session import _DISMISS


def _run(coro):
    return run_async(coro)


# Distinct refs so a captured call is unambiguously worker vs lead across ALL FOUR locals.
_WORKER = ModelRef(mode="local", model="WORKER", max_tokens=111, reasoning_effort="low")
_LEAD = ModelRef(mode="cloud", model="LEAD", max_tokens=999, reasoning_effort="high")


# ── A. schema ──────────────────────────────────────────────────────────────────────────────────────


def test_routingcfg_lead_required() -> None:
    with pytest.raises(ValidationError):
        RoutingCfg()  # type: ignore[call-arg]  — `lead` is required, no default


def test_routingcfg_bounds() -> None:
    ok = RoutingCfg(lead=_LEAD)
    assert (ok.failure_threshold, ok.fallback_turns) == (2, 2)  # documented defaults
    with pytest.raises(ValidationError):
        RoutingCfg(lead=_LEAD, failure_threshold=0)  # ge=1
    with pytest.raises(ValidationError):
        RoutingCfg(lead=_LEAD, fallback_turns=0)  # ge=1


# ── B. RoutingState trio (pure) ──────────────────────────────────────────────────────────────────────


def test_routing_state_for_lazy_mints_and_memoizes() -> None:
    state = SimpleNamespace(routing_state={})
    a = routing_state_for(state, "t1")
    b = routing_state_for(state, "t1")
    assert a is b  # memoized — the same object across a thread's turns
    assert a == RoutingState()  # freshly all-default


def test_prune_drops_only_all_defaults() -> None:
    store: dict[str, RoutingState] = {}
    routing_state_for(SimpleNamespace(routing_state=store), "healthy")
    prune_routing_state(store, "healthy")
    assert "healthy" not in store  # all-default → dropped

    mid = routing_state_for(SimpleNamespace(routing_state=store), "mid")
    mid.fallback_remaining = 1  # a live episode
    prune_routing_state(store, "mid")
    assert store.get("mid") is mid  # NOT all-default → preserved
    prune_routing_state(store, "absent")  # no KeyError on a missing thread


# ── C. the decision matrix (driven through _drive) ───────────────────────────────────────────────────


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace():
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("computers: {}\n", encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _routing_session(state, thread, *, ft=2, fbt=2, max_iters=16, max_repeat=2, max_stall=2, routing=True):
    """A session whose agent runs the WORKER ref + a routing cfg escalating to the LEAD ref. Inference
    is fully mocked (endpoint/effective_window stubbed; `stream_chat` scripted per test); compaction is
    disabled so it never perturbs the routing assertions."""
    from app.api.agent import _build_session

    session = _build_session(state, thread)
    agent = session._agent.model_copy(
        update={
            "model": _WORKER,
            "routing": RoutingCfg(lead=_LEAD, failure_threshold=ft, fallback_turns=fbt) if routing else None,
            "max_iterations": max_iters,
            "max_repeat_calls": max_repeat,
            "max_stall_iterations": max_stall,
        }
    )
    session._agent = agent
    session._routing_cfg = agent.routing
    session._compaction_cfg = CompactionCfg(enabled=False)
    session._compactor = Compactor(session._inference, state.messages, session._compaction_cfg)

    async def no_window(ep):
        return None

    session._inference.effective_window = no_window  # type: ignore[assignment]
    session._inference.endpoint = lambda mode=None: SimpleNamespace(base_url=None)  # type: ignore[assignment]
    return session


def _mk_stream(captured, behaviors):
    """A scripted `stream_chat`: records each call's four routed locals, then acts per the popped
    behavior — "text" (complete), ("err", n) (raise with `endpoints_tried=n`), ("degraded",) (a
    rescued serve), ("call", name, args) (one tool-call iteration). Defaults to "text" when drained."""
    seq = list(behaviors)

    async def stream_chat(
        messages,
        *,
        mode=None,
        model=None,
        max_tokens=None,
        reasoning_effort=None,
        tools=None,
        tool_choice=None,
        report=None,
        **_kw,
    ):
        captured.append(
            {"mode": mode, "model": model, "max_tokens": max_tokens, "reasoning_effort": reasoning_effort}
        )
        beh = seq.pop(0) if seq else "text"
        if beh == "text":
            yield ChatDelta(text="ok")
            return
        if isinstance(beh, tuple) and beh[0] == "err":
            raise InferenceError("boom", endpoints_tried=beh[1])
        if isinstance(beh, tuple) and beh[0] == "degraded":
            if report is not None:
                report.degraded = True
            yield ChatDelta(text="ok")
            return
        if isinstance(beh, tuple) and beh[0] == "call":
            yield ChatDelta(tool_calls=[ToolCallRequest(id=uuid.uuid4().hex, name=beh[1], arguments=beh[2])])
            return

    return stream_chat


async def _drive(session, thread, captured, behaviors, **kw):
    session._inference.stream_chat = _mk_stream(captured, behaviors)  # type: ignore[assignment]
    return [ev async for ev in session._drive(thread, **kw)]


def _notices(events):
    return [e.data.get("text", "") for e in events if e.event == "notice"]


def _mk_thread(state):
    from app.domain.conversation import Thread

    return state.threads.create(Thread())


def test_routing_off_is_todays_behavior() -> None:
    """Routing cfg None → the worker ref is used, zero routing state written."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, routing=False)
            cap: list = []
            await _drive(session, thread, cap, ["text"])
            assert cap[0]["model"] == "WORKER"
            # state was minted by _build_session but never mutated → still all-default (prune-able).
            assert state.routing_state[thread.id] == RoutingState()

        _run(go())


def test_fresh_worker_when_no_episode() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread)
            cap: list = []
            events = await _drive(session, thread, cap, ["text"])
            assert cap[0]["model"] == "WORKER"
            assert _notices(events) == []  # no episode → no notice
            rs = state.routing_state[thread.id]
            assert rs.current_route is None  # cleared at the clean end
            assert rs.consecutive_failures == 0 and rs.fallback_remaining == 0

        _run(go())


def test_fresh_lead_decrements_and_notices_once() -> None:
    """An active episode routes a fresh turn to the lead, consumes one turn, and the FIRST lead turn
    emits exactly one opening notice."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=2)
            state.routing_state[thread.id].fallback_remaining = 2  # open a 2-turn episode
            cap: list = []
            events = await _drive(session, thread, cap, ["text"])
            assert cap[0]["model"] == "LEAD"
            opens = [n for n in _notices(events) if "lead model for the next" in n]
            assert opens == ["// lead model for the next 2 turns (worker failing)"]
            assert state.routing_state[thread.id].fallback_remaining == 1  # decremented once

        _run(go())


def test_episode_open_run_close_one_notice_each_way() -> None:
    """A full episode (fbt=2): turn 1 opens + notices, turn 2 no notice, turn 3 returns to worker with
    exactly one close notice — and each notice fires exactly once across the episode."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=2)
            rs = state.routing_state[thread.id]
            rs.fallback_remaining = 2  # a pre-opened episode

            opens = closes = 0
            models: list = []
            for _ in range(3):
                cap: list = []
                ev = await _drive(session, thread, cap, ["text"])
                models.append(cap[0]["model"])
                opens += sum(1 for n in _notices(ev) if "lead model for the next" in n)
                closes += sum(1 for n in _notices(ev) if "back to the worker model" in n)
            assert models == ["LEAD", "LEAD", "WORKER"]  # two lead turns, then back to worker
            assert opens == 1 and closes == 1  # exactly one of each per episode
            assert rs == RoutingState()  # returned to all-defaults

        _run(go())


def test_prefix_bypasses_router_and_mutates_nothing() -> None:
    """A `/local`//`/cloud` prefix (`mode`) wins, runs the WORKER ref on that endpoint, and touches no
    routing state — even mid-episode."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=3)
            rs = state.routing_state[thread.id]
            rs.fallback_remaining = 3  # a live episode the prefix must IGNORE
            cap: list = []
            events = await _drive(session, thread, cap, ["text"], mode="local")
            assert cap[0]["model"] == "WORKER" and cap[0]["mode"] == "local"
            assert _notices(events) == []  # router untouched → no notice
            assert rs.fallback_remaining == 3  # NOT consumed
            assert rs.current_route is None  # never set

        _run(go())


def test_resume_reads_current_route_no_second_decrement() -> None:
    """Suspend INSIDE an episode: the resume READS `current_route` (stays on the lead) and does NOT
    decrement again — the logical turn consumed the episode turn exactly once (the ACA-16 parallel)."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=2)
            rs = state.routing_state[thread.id]
            # The fresh half already decided lead + decremented 2→1 and then suspended.
            rs.current_route = "lead"
            rs.fallback_remaining = 1
            asst = Message(
                thread_id=thread.id,
                role="assistant",
                actor=Actor.AGENT,
                agent=session._agent.name,
                parts=[
                    ToolCallPart(call_id="k1", tool="ping_host", args={}, state=RunState.AWAITING_CONFIRM)
                ],
            )
            await state.messages.add(asst)
            cap: list = []
            await _drive(
                session, thread, cap, ["text"], resume_assistant=asst, resume_tokens={"k1": _DISMISS}
            )
            assert cap[0]["model"] == "LEAD"  # resume continued on the lead
            assert rs.fallback_remaining == 1  # NOT decremented a second time for the same logical turn

        _run(go())


# ── D. all four locals ride the routed lead ref (main loop AND _finalize — the H2 pin) ────────────────


def test_all_four_locals_ride_lead_main_and_finalize() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            # fbt=1 so a single fresh lead turn; max_iters=1 forces the loop to EXHAUST into _finalize.
            session = _routing_session(state, thread, fbt=1, max_iters=1)
            state.routing_state[thread.id].fallback_remaining = 1
            cap: list = []
            # iter0 = a real task_plan tool round (main-loop lead call); the loop then exhausts →
            # _finalize makes the second (lead) call, which wraps up as text.
            await _drive(session, thread, cap, [("call", "task_plan", "{}"), "text"])
            assert len(cap) == 2
            for call in cap:  # BOTH the main-loop call AND the _finalize call ride the lead ref
                assert call == {
                    "mode": "cloud",
                    "model": "LEAD",
                    "max_tokens": 999,
                    "reasoning_effort": "high",
                }

        _run(go())


def test_reserve_prices_the_routed_ref_on_a_lead_turn() -> None:
    """The compaction output-reserve is the ROUTED ref's `max_tokens` — a lead turn prices the trigger
    with the lead's cap (999), not the worker's (111)."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=1)
            state.routing_state[thread.id].fallback_remaining = 1
            seen: dict = {}

            async def spy_should(thread, **kw):
                seen["reserve"] = kw.get("reserve_tokens")
                return False

            session._compactor.should_compact = spy_should  # type: ignore[assignment]
            await _drive(session, thread, [], ["text"])
            assert seen["reserve"] == 999  # lead.max_tokens, not worker.max_tokens

        _run(go())


# ── E. structural counting ───────────────────────────────────────────────────────────────────────────


def test_single_endpoint_error_counts_multi_outage_and_degraded_dont() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            # (a) a single-endpoint chain failure COUNTS.
            t1 = await _mk_thread(state)
            s1 = _routing_session(state, t1, ft=5)
            await _drive(s1, t1, [], [("err", 1)])
            assert state.routing_state[t1.id].consecutive_failures == 1

            # (b) a multi-endpoint total outage does NOT count (neutral) — and does NOT reset either.
            t2 = await _mk_thread(state)
            s2 = _routing_session(state, t2, ft=5)
            state.routing_state[t2.id].consecutive_failures = 2
            await _drive(s2, t2, [], [("err", 3)])
            assert state.routing_state[t2.id].consecutive_failures == 2  # untouched (neutral)

            # (c) a degraded-rescued serve completes → NOT a failure (resets).
            t3 = await _mk_thread(state)
            s3 = _routing_session(state, t3, ft=5)
            state.routing_state[t3.id].consecutive_failures = 2
            await _drive(s3, t3, [], [("degraded",)])
            assert state.routing_state[t3.id].consecutive_failures == 0  # clean serve resets

        _run(go())


def test_completed_resets_the_counter() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, ft=5)
            state.routing_state[thread.id].consecutive_failures = 3
            await _drive(session, thread, [], ["text"])
            assert state.routing_state[thread.id].consecutive_failures == 0

        _run(go())


def test_exhaustion_and_stall_finalize_count() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            # exhaustion: one tool round then max_iterations hit → _finalize.
            t1 = await _mk_thread(state)
            s1 = _routing_session(state, t1, ft=5, max_iters=1)
            await _drive(s1, t1, [], [("call", "task_plan", "{}"), "text"])
            assert state.routing_state[t1.id].consecutive_failures == 1

            # stall: max_repeat=1 + max_stall=1 → the second identical call is suppressed (no
            # progress) → the stall guard forces _finalize.
            t2 = await _mk_thread(state)
            s2 = _routing_session(state, t2, ft=5, max_iters=8, max_repeat=1, max_stall=1)
            await _drive(s2, t2, [], [("call", "task_plan", "{}"), ("call", "task_plan", "{}"), "text"])
            assert state.routing_state[t2.id].consecutive_failures == 1

        _run(go())


def test_suspended_is_neutral() -> None:
    """A turn that SUSPENDS (a `question`) is neither counted nor reset, and its route lock survives
    for the resume."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, ft=5)
            rs = state.routing_state[thread.id]
            rs.consecutive_failures = 2
            events = await _drive(session, thread, [], [("call", "question", '{"prompt": "which host?"}')])
            assert any(e.event == "done" and e.data.get("state") == "suspended" for e in events)
            assert rs.consecutive_failures == 2  # neutral: no count, no reset
            assert rs.current_route == "worker"  # preserved across the suspend for the resume

        _run(go())


def test_threshold_opens_episode_with_notice() -> None:
    """Reaching `failure_threshold` consecutive worker failures opens the episode (arming the next
    turn's lead route)."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, ft=2, fbt=2)
            await _drive(session, thread, [], [("err", 1)])  # failure 1
            assert state.routing_state[thread.id].fallback_remaining == 0  # not yet
            await _drive(session, thread, [], [("err", 1)])  # failure 2 → threshold
            rs = state.routing_state[thread.id]
            assert rs.fallback_remaining == 2 and rs.consecutive_failures == 0  # episode armed, counter reset
            # the NEXT fresh turn now routes to the lead + opens with a notice.
            cap: list = []
            ev = await _drive(session, thread, cap, ["text"])
            assert cap[0]["model"] == "LEAD"
            assert any("lead model for the next" in n for n in _notices(ev))

        _run(go())


def test_mid_episode_state_survives_turns() -> None:
    """The per-thread state is memoized across turns, so a live episode persists (not re-minted)."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=3)
            state.routing_state[thread.id].fallback_remaining = 3
            for expect in (2, 1):  # two lead turns, decrementing the SAME state object
                await _drive(session, thread, [], ["text"])
                assert state.routing_state[thread.id].fallback_remaining == expect

        _run(go())


# ── F. subagent inertness ────────────────────────────────────────────────────────────────────────────


def test_subagent_session_builds_none_and_never_routes() -> None:
    """A session built WITHOUT a routing_state (a headless subagent) is routing-inert: the field is
    None and the router never engages even though the AgentDef copied a routing cfg."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            from app.services.agent.session import AgentSession

            thread = await _mk_thread(state)
            agent = state.settings.default_agent_def().model_copy(
                update={"model": _WORKER, "routing": RoutingCfg(lead=_LEAD)}
            )
            session = AgentSession(
                state.threads,
                state.messages,
                state.inference,
                state.settings,
                state.actions,
                agent,
                interactive=False,
                depth=1,  # a headless child — no routing_state passed → None
            )
            assert session._routing_state is None
            session._compaction_cfg = CompactionCfg(enabled=False)
            session._compactor = Compactor(session._inference, state.messages, session._compaction_cfg)

            async def no_window(ep):
                return None

            session._inference.effective_window = no_window  # type: ignore[assignment]
            session._inference.endpoint = lambda mode=None: SimpleNamespace(base_url=None)  # type: ignore[assignment]
            cap: list = []
            session._inference.stream_chat = _mk_stream(cap, ["text"])  # type: ignore[assignment]
            _ = [ev async for ev in session._drive(thread)]
            assert cap[0]["model"] == "WORKER"  # never routed to the lead

        _run(go())
