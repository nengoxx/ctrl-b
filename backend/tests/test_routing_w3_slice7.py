"""ACA Slice 7 / D43 Wave 3 — the failure-fallback routing machine.

Layered like the compaction W3 suite:
  - schema (`RoutingCfg`: `lead` required, the two `ge=1` bounds);
  - `RoutingState` trio (lazy-mint/memoize + prune-when-default; `suspended_routes` snapshot map);
  - the decision matrix driven through `AgentSession._drive` on the TestClient app (routing off =
    today; fresh worker/lead; the episode open→decrement→close with EXACTLY one notice each way; the
    `/local` prefix bypass; a resume reading its per-call route SNAPSHOT);
  - all-four-locals ride the routed lead ref in BOTH call paths (the main loop AND `_finalize` — the
    H2 pin), asserted on the captured `stream_chat` kwargs;
  - the compaction output-reserve prices the ROUTED ref on a lead turn;
  - structural counting (single-endpoint error counts, multi-endpoint outage / degraded don't,
    exhaustion + stall count, completed resets, suspended is neutral);
  - a mid-episode state survives turns; a healthy thread prunes;
  - the D43 Codex-review fix-set (section H): per-call route SNAPSHOTS survive a fresh turn B on the
    same thread + a config edit/disable mid-suspend (defects 1+2); conclude-after-finalize so a Stop
    mid-wrap-up stays neutral + the close notice precedes `done` (defect 3).
"""

from __future__ import annotations

import asyncio
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
_WORKER = ModelRef(provider="local", model="WORKER", max_tokens=111, reasoning_effort="low")
_LEAD = ModelRef(provider="cloud", model="LEAD", max_tokens=999, reasoning_effort="high")
# A DIFFERENT lead — a mid-suspend owner edit swaps `rcfg.lead` to this; the frozen snapshot must win.
_LEAD2 = ModelRef(provider="cloud", model="LEAD2", max_tokens=888, reasoning_effort="high")


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
    session._compactor = Compactor(
        session._inference, state.messages, session._compaction_cfg, session._settings
    )

    async def no_window(ep):
        return None

    session._inference.effective_window = no_window  # type: ignore[assignment]
    session._inference.endpoint = lambda mode=None: SimpleNamespace(base_url=None)  # type: ignore[assignment]
    return session


def _mk_stream(captured, behaviors):
    """A scripted `stream_chat`: records each call's four routed locals, then acts per the popped
    behavior — "text" (complete), ("err", n) (raise with `endpoints_tried=n`), ("degraded",) (a
    rescued serve), ("call", name, args) (one tool-call iteration), ("cancel",) (raise
    `asyncio.CancelledError` — a Stop landing DURING this model call). Defaults to "text" when drained."""
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
        if isinstance(beh, tuple) and beh[0] == "cancel":
            raise asyncio.CancelledError  # a Stop cancelled the task during this model call
            yield  # unreachable — keeps this an async generator

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
            assert rs == RoutingState()  # a clean worker turn wrote nothing (prune-able, no snapshot)

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
            assert rs.suspended_routes == {}  # no snapshot written on the prefix path

        _run(go())


def test_resume_reads_snapshot_no_second_decrement() -> None:
    """Suspend INSIDE an episode: the resume READS its per-call ROUTE SNAPSHOT (stays on the lead) and
    does NOT decrement again — the logical turn consumed the episode turn exactly once, and the snapshot
    is popped on the way out (the ACA-16 parallel, now keyed per-call)."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=2)
            rs = state.routing_state[thread.id]
            # The fresh half already decided lead + decremented 2→1, then suspended on "k1" and froze
            # its routed LEAD ref under that call_id.
            rs.suspended_routes = {"k1": _LEAD}
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
            assert cap[0]["model"] == "LEAD"  # resume continued on the snapshot's lead
            assert rs.fallback_remaining == 1  # NOT decremented a second time for the same logical turn
            assert rs.suspended_routes == {}  # the snapshot was popped at resume

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
    """A WORKER turn that SUSPENDS (a `question`) is neither counted nor reset; a worker route is NOT
    snapshotted (its resume falls to the worker naturally), so `suspended_routes` stays empty."""
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
            assert rs.suspended_routes == {}  # worker route not pinned (resume falls to the worker)

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
            session._compactor = Compactor(
                session._inference, state.messages, session._compaction_cfg, session._settings
            )

            async def no_window(ep):
                return None

            session._inference.effective_window = no_window  # type: ignore[assignment]
            session._inference.endpoint = lambda mode=None: SimpleNamespace(base_url=None)  # type: ignore[assignment]
            cap: list = []
            session._inference.stream_chat = _mk_stream(cap, ["text"])  # type: ignore[assignment]
            _ = [ev async for ev in session._drive(thread)]
            assert cap[0]["model"] == "WORKER"  # never routed to the lead

        _run(go())


# ── G. R1: routing disabled mid-episode resets the WHOLE state (prunable + a fresh re-enable) ─────────


def test_disabled_mid_episode_resets_whole_state_and_re_enable_is_fresh() -> None:
    """The owner disables routing mid-episode (cfg → None). `_conclude_routing` must reset the WHOLE
    state to defaults (episode counters too, not just the per-turn locks), so the entry prunes AND a
    later re-enable starts a fresh count — never a silent mid-episode lead route (D43 Invariant 4)."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            # routing OFF now, but a stale mid-episode state (+ an orphaned snapshot) left from before
            # it was disabled.
            session = _routing_session(state, thread, routing=False)
            rs = state.routing_state[thread.id]
            rs.fallback_remaining = 2
            rs.consecutive_failures = 1
            rs.suspended_routes = {"stale": _LEAD}
            events = await _drive(session, thread, [], ["text"])
            assert _notices(events) == []  # routing off → no notice
            assert rs == RoutingState()  # the WHOLE state reset — counters AND the orphaned snapshot
            prune_routing_state(state.routing_state, thread.id)
            assert thread.id not in state.routing_state  # the orphaned entry now drops

            # Re-enable routing: a fresh count, no resurrected episode.
            session._routing_cfg = RoutingCfg(lead=_LEAD, failure_threshold=2, fallback_turns=2)
            session._agent = session._agent.model_copy(update={"routing": session._routing_cfg})
            cap: list = []
            ev = await _drive(session, thread, cap, ["text"])
            assert cap[0]["model"] == "WORKER"  # no silent mid-episode lead route
            assert _notices(ev) == []  # no phantom open/close notice

        _run(go())


# ── H. the D43 Codex-review fix-set: per-call snapshots, conclude-after-finalize, turn-local flags ────


async def _suspend_on_lead(state, thread, session, fbt=2):
    """Open an episode (`fbt`) and drive ONE fresh turn that routes to the lead and SUSPENDS on a
    `question`, freezing its LEAD route snapshot. Returns `(assistant, call_id)` for the resume."""
    state.routing_state[thread.id].fallback_remaining = fbt
    cap: list = []
    await _drive(session, thread, cap, [("call", "question", '{"prompt": "which host?"}')])
    assert cap[0]["model"] == "LEAD"  # turn A ran on the lead
    rs = state.routing_state[thread.id]
    assert len(rs.suspended_routes) == 1  # exactly one frozen snapshot, keyed by the awaiting call
    call_id = next(iter(rs.suspended_routes))
    assistant = await session._find_pending(thread, call_id)
    assert assistant is not None
    return assistant, call_id


def test_suspended_lead_survives_a_fresh_turn_b_then_resumes_on_lead() -> None:
    """Defect 1: turn A suspends on the LEAD, then a FRESH turn B runs + concludes on the SAME thread.
    B's decision must NOT clobber A's per-call snapshot (the old per-thread `current_route` slot bug),
    so A's resume still runs the LEAD — and a `/local`-PREFIX turn B is equally inert."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go(prefix_b: bool) -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=2)
            assistant, call_id = await _suspend_on_lead(state, thread, session, fbt=2)
            snap_before = dict(state.routing_state[thread.id].suspended_routes)

            # Turn B on the SAME thread: either a fresh routed turn (still episode → lead) or a
            # /local-prefix turn (bypasses the router entirely). Neither may touch A's snapshot.
            capb: list = []
            await _drive(session, thread, capb, ["text"], **({"mode": "local"} if prefix_b else {}))
            assert capb[0]["model"] == "WORKER" if prefix_b else capb[0]["model"] == "LEAD"
            assert state.routing_state[thread.id].suspended_routes == snap_before  # A's snapshot intact

            # Resume A: it still runs the LEAD its logical turn started on.
            capr: list = []
            await _drive(
                session, thread, capr, ["text"], resume_assistant=assistant, resume_answers={call_id: "h1"}
            )
            assert capr[0]["model"] == "LEAD"
            assert call_id not in state.routing_state[thread.id].suspended_routes  # popped at resume

        _run(go(prefix_b=False))
        _run(go(prefix_b=True))


def test_config_edit_or_disable_mid_suspend_does_not_change_the_resumed_half() -> None:
    """Defect 2: while A is suspended on the lead, the owner mutates the routing cfg. A's resume must
    still run the ORIGINAL snapshot ModelRef (never a re-dereference of the live `rcfg.lead`) — for both
    a lead-model SWAP and a full DISABLE; after A concludes disabled, the reset still prunes."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go(disable: bool) -> None:
            thread = await _mk_thread(state)
            session = _routing_session(state, thread, fbt=2)
            assistant, call_id = await _suspend_on_lead(state, thread, session, fbt=2)

            # Owner edits the cfg mid-suspend: either swap the lead model, or disable routing entirely.
            if disable:
                session._routing_cfg = None
                session._agent = session._agent.model_copy(update={"routing": None})
            else:
                session._routing_cfg = RoutingCfg(lead=_LEAD2, failure_threshold=2, fallback_turns=2)
                session._agent = session._agent.model_copy(update={"routing": session._routing_cfg})

            capr: list = []
            await _drive(
                session, thread, capr, ["text"], resume_assistant=assistant, resume_answers={call_id: "h1"}
            )
            assert capr[0]["model"] == "LEAD"  # the ORIGINAL snapshot, not _LEAD2 and not the worker
            if disable:
                # The disable-reset dropped the whole state (counters + any snapshot) → prune-able.
                assert state.routing_state[thread.id] == RoutingState()
                prune_routing_state(state.routing_state, thread.id)
                assert thread.id not in state.routing_state

        _run(go(disable=False))
        _run(go(disable=True))


def test_stop_during_wrapup_stays_neutral_but_uncancelled_counts() -> None:
    """Defect 3: with `failure_threshold=1`, a WORKER stall forces `_finalize`. A Stop landing DURING
    the wrap-up call (cancel mid-finalize) raises out BEFORE `_conclude_routing` runs → no failure
    counted, no episode armed (the flags are turn-locals); the un-cancelled variant DOES count + arms."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go(cancel: bool) -> None:
            thread = await _mk_thread(state)
            # ft=1, max_stall=1, max_repeat=1: the second identical call is suppressed → stall → finalize.
            session = _routing_session(state, thread, ft=1, max_iters=8, max_repeat=1, max_stall=1)
            wrapup = ("cancel",) if cancel else "text"
            behaviors = [("call", "task_plan", "{}"), ("call", "task_plan", "{}"), wrapup]
            if cancel:
                with pytest.raises(asyncio.CancelledError):
                    await _drive(session, thread, [], behaviors)
                rs = state.routing_state[thread.id]
                assert rs.consecutive_failures == 0  # the cancelled wrap-up counted nothing
                assert rs.fallback_remaining == 0  # no episode armed
                # the next FRESH turn routes to the worker (no episode).
                cap: list = []
                await _drive(session, thread, cap, ["text"])
                assert cap[0]["model"] == "WORKER"
            else:
                await _drive(session, thread, [], behaviors)
                rs = state.routing_state[thread.id]
                # the worker stall counted, hit ft=1, and armed the episode.
                assert rs.fallback_remaining == 2 and rs.consecutive_failures == 0

        _run(go(cancel=True))
        _run(go(cancel=False))


def test_lead_finalize_close_notice_precedes_done() -> None:
    """Defect 3 (ordering): a LEAD turn on the episode's LAST lead turn that EXHAUSTS into `_finalize`
    must emit the `// back to the worker model` close notice AFTER the wrap-up content (message.end) and
    strictly BEFORE `done` — conclude now runs by intercepting `_finalize`'s terminal `done`."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _mk_thread(state)
            # fbt=1 → a single (last) lead turn; max_iters=1 → one tool round then exhaust into _finalize.
            session = _routing_session(state, thread, fbt=1, max_iters=1)
            state.routing_state[thread.id].fallback_remaining = 1
            events = await _drive(session, thread, [], [("call", "task_plan", "{}"), "text"])
            kinds = [e.event for e in events]
            notices = [i for i, e in enumerate(events) if e.event == "notice"]
            done_i = kinds.index("done")
            close_i = next(i for i in notices if "back to the worker model" in events[i].data.get("text", ""))
            last_msg_end = max(i for i, e in enumerate(events) if e.event == "message.end")
            assert last_msg_end < close_i < done_i  # after the final content, before done
            assert state.routing_state[thread.id] == RoutingState()  # episode closed, prune-able

        _run(go())
