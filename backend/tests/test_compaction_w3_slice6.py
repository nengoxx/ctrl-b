"""ACA Slice 6 / D42 Wave 3 — the clearing tier + summarizer v2 + two-floor split + thrash machine.

Layered so each unit is testable in isolation:
  - `plan_clearing` (pure): selection (old + large outputs), the four structural never-clear classes,
    the chars/5 gain pricing, the recent-step protection, the floor;
  - the clearing render (`_tool_content(cleared=…)`) + the A12 verbatim invariant (the plan mutates no
    row);
  - the two-floor `_split` (pure via a deps-free Compactor): token floor vs message floor, the active
    task_plan pair pinned in the tail (superseded folds), the suspend-snap;
  - the summarizer v2 (`_summarize` against a fake inference): the five-section template, the
    `/compact` instructions block (manual only), the overflow guard;
  - the inflation-reject (`compact` against a real DB + fake summarizer): rejected + DB untouched,
    force never bypasses it;
  - the thrash machine (driving `_drive`/`session.compact` on the TestClient app): failure counts only
    didn't-shrink, truncation-shrink = success, per-turn backoff, the latching breaker + one notice,
    manual reset unlatches, force works while latched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path
from typing import cast

from _async import run_async

from app.adapters.inference import ChatDelta, InferenceClient, ToolCallRequest
from app.db import Database
from app.domain.agent import CompactionCfg
from app.domain.conversation import Message, TextPart, ToolCallPart, ToolResultPart
from app.domain.enums import Actor, RunState
from app.domain.result import ToolResult
from app.services.agent.compaction import (
    _SUMMARIZER_SECTIONS,
    CLEAR_CHARS_PER_TOKEN,
    OUTPUT_CLEARED_PLACEHOLDER,
    SUMMARY_PREFIX,
    TRUNCATION_NOTICE,
    ClearingPlan,
    CompactionState,
    Compactor,
    estimate_tokens,
    plan_clearing,
    prune_compaction_state,
)
from app.services.agent.session import _tool_content
from app.services.conversation import MessageRepo


def _run(coro):
    return run_async(coro)


# ── history builders ─────────────────────────────────────────────────────────────────────────────


def _user(t: str = "hi") -> Message:
    return Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text=t)])


def _asst_call(call_id: str, tool: str, *, state: RunState = RunState.OK) -> Message:
    return Message(
        thread_id="t",
        role="assistant",
        actor=Actor.AGENT,
        parts=[ToolCallPart(call_id=call_id, tool=tool, args={}, state=state)],
    )


def _tool_msg(call_id: str, *, output: str, state: RunState = RunState.OK, real: bool = True) -> Message:
    """A `tool` message. `real=True` stamps `duration_ms` (a genuine execution — clearable); `real=False`
    leaves it None (a synthesized/steering placeholder — structurally exempt)."""
    res = ToolResult(state=state, summary="did a thing", output=output)
    if real:
        res.duration_ms = 5
    return Message(
        thread_id="t",
        role="tool",
        actor=Actor.AGENT,
        parts=[ToolResultPart(call_id=call_id, result=res)],
    )


_BIG = "x" * 3000  # 3000 chars ≈ 750 tok > the 500-tok floor → clearable
_SMALL = "y" * 100  # ≈ 25 tok < floor → never cleared


def _round(i: int, tool: str = "ping", *, output: str, real: bool = True) -> list[Message]:
    """One assistant-tool-call round (a "step"): the call + its result, keyed on a shared id."""
    cid = f"c{i}"
    return [_asst_call(cid, tool, state=RunState.OK), _tool_msg(cid, output=output, real=real)]


# ── A. plan_clearing (pure) ───────────────────────────────────────────────────────────────────────


def test_clearing_selects_old_large_outputs_only() -> None:
    cfg = CompactionCfg(clear_keep_steps=2, clear_output_min_tokens=500)
    # 4 rounds of big outputs; clear_keep_steps=2 protects rounds 2 & 3, so only c0 + c1 clear.
    history = [_user()]
    for i in range(4):
        history += _round(i, output=_BIG)
    plan = plan_clearing(history, cfg)
    assert plan.cleared_call_ids == frozenset({"c0", "c1"})
    # gain is priced at chars/CLEAR_CHARS_PER_TOKEN (conservative), summed over the two cleared outputs.
    assert plan.gain == 2 * (len(_BIG) // CLEAR_CHARS_PER_TOKEN)


def test_clearing_floor_skips_small_outputs() -> None:
    cfg = CompactionCfg(clear_keep_steps=1, clear_output_min_tokens=500)
    history = [_user(), *_round(0, output=_SMALL), *_round(1, output=_BIG)]
    plan = plan_clearing(history, cfg)
    assert plan.empty  # c0 is small (below the floor), c1 is the protected most-recent step


def test_clearing_recent_steps_protected() -> None:
    cfg = CompactionCfg(clear_keep_steps=2, clear_output_min_tokens=500)
    history = [_user(), *_round(0, output=_BIG), *_round(1, output=_BIG)]
    # Only 2 steps and clear_keep_steps=2 → both protected → nothing cleared.
    assert plan_clearing(history, cfg).empty


def test_clearing_exempts_suspend_paired() -> None:
    cfg = CompactionCfg(clear_keep_steps=1, clear_output_min_tokens=500)
    susp = _asst_call("c0", "shutdown_host", state=RunState.AWAITING_CONFIRM)
    history = [_user(), susp, _tool_msg("c0", output=_BIG), *_round(1, output=_BIG)]
    plan = plan_clearing(history, cfg)
    assert "c0" not in plan.cleared_call_ids  # suspend-paired result is structurally exempt


def test_clearing_exempts_task_plan_and_memory() -> None:
    cfg = CompactionCfg(clear_keep_steps=1, clear_output_min_tokens=500)
    history = [
        _user(),
        *_round(0, "task_plan", output=_BIG),
        *_round(1, "memory", output=_BIG),
        *_round(2, "ping", output=_BIG),
        *_round(3, "ping", output=_BIG),  # c3 is the protected most-recent step
    ]
    plan = plan_clearing(history, cfg)
    assert "c0" not in plan.cleared_call_ids and "c1" not in plan.cleared_call_ids
    assert "c2" in plan.cleared_call_ids  # a plain old tool IS cleared
    assert "c3" not in plan.cleared_call_ids  # protected recent step


def test_clearing_exempts_synthesized_results() -> None:
    """A synthesized result (no real execution → `duration_ms is None`) is never cleared, even with a
    large output — the structural marker, not a content string-match."""
    cfg = CompactionCfg(clear_keep_steps=1, clear_output_min_tokens=500)
    history = [_user(), *_round(0, output=_BIG, real=False), *_round(1, output=_BIG)]
    plan = plan_clearing(history, cfg)
    assert "c0" not in plan.cleared_call_ids  # synthesized → exempt


def test_clearing_disabled_is_empty() -> None:
    cfg = CompactionCfg(enabled=False)
    history = [_user(), *_round(0, output=_BIG), *_round(1, output=_BIG), *_round(2, output=_BIG)]
    assert plan_clearing(history, cfg).empty


def test_clearing_gain_pushes_trigger_net_of_clearing() -> None:
    """The SAME plan feeds the trigger: subtracting `plan.gain` can pull an over-threshold estimate
    back under the line (the Wave-2 `clearing_gain` seam, now driven by a real plan)."""
    cfg = CompactionCfg(threshold_frac=0.85, clear_keep_steps=1, clear_output_min_tokens=500)
    history = [_user(), *_round(0, output=_BIG), *_round(1, output=_BIG)]  # c0 clearable
    plan = plan_clearing(history, cfg)
    assert plan.gain > 0
    comp = Compactor(cast("InferenceClient", None), cast("MessageRepo", None), cfg)
    # window 10000 → line 8500. An 8600 estimate is over, but net of the clearing gain it drops under.
    assert comp._over_threshold(history, window=10000, estimated_tokens=8600) is True
    assert comp._over_threshold(history, window=10000, estimated_tokens=8600, clearing=plan) is (
        8600 - plan.gain > 8500
    )


# ── B. the clearing render + A12 verbatim ─────────────────────────────────────────────────────────


def test_tool_content_clears_output_keeps_state_line() -> None:
    res = ToolResult(state=RunState.OK, summary="ran ping", output="LOTS OF OUTPUT", error=None)
    cleared = _tool_content(res, cleared=True)
    assert OUTPUT_CLEARED_PLACEHOLDER in cleared
    assert "LOTS OF OUTPUT" not in cleared
    assert "[ok] ran ping" in cleared  # the [state] summary line survives
    # a non-cleared render keeps the real output
    assert "LOTS OF OUTPUT" in _tool_content(res, cleared=False)


def test_tool_content_cleared_keeps_error_line() -> None:
    res = ToolResult(state=RunState.ERROR, summary="oops", output="BIG", error="boom")
    cleared = _tool_content(res, cleared=True)
    assert "error: boom" in cleared and OUTPUT_CLEARED_PLACEHOLDER in cleared and "BIG" not in cleared


def test_plan_clearing_does_not_mutate_history_rows() -> None:
    """A12: clearing is assembly-time only — the plan selects ids but never touches the DB row's
    verbatim output (GET /threads/{id}/messages stays unchanged)."""
    cfg = CompactionCfg(clear_keep_steps=1, clear_output_min_tokens=500)
    history = [_user(), *_round(0, output=_BIG), *_round(1, output=_BIG)]
    tool_row = history[2]  # c0's tool message
    plan = plan_clearing(history, cfg)
    assert "c0" in plan.cleared_call_ids
    assert tool_row.tool_results()[0].result.output == _BIG  # row untouched


# ── C. the two-floor `_split` (pure) ──────────────────────────────────────────────────────────────


def _split_compactor(cfg: CompactionCfg) -> Compactor:
    return Compactor(cast("InferenceClient", None), cast("MessageRepo", None), cfg)


def test_split_token_floor_beats_message_floor_when_fat() -> None:
    """Fat messages + a small message floor: the token floor extends the tail PAST the 2-message
    message floor to hold ≥ keep_recent_tokens (cut = min → the larger tail wins)."""
    cfg = CompactionCfg(keep_last_messages=2, keep_recent_tokens=250)
    # 6 fat messages (~101 tok each). token floor needs 3 to reach 250; message floor keeps only 2.
    history = [_user("z" * 400) if i % 2 == 0 else _asst("z" * 400) for i in range(6)]
    head, tail = comp_split(cfg, history)
    assert len(tail) >= 3  # token floor extended the tail beyond the 2-message message floor
    assert estimate_tokens(tail) >= cfg.keep_recent_tokens


def test_split_message_floor_beats_token_floor_when_thin() -> None:
    """Thin messages: the token floor is satisfied by ~2 messages, but the 8-message message floor
    keeps more → the message floor is binding."""
    cfg = CompactionCfg(keep_last_messages=8, keep_recent_tokens=10)
    history = [_user("hi") if i % 2 == 0 else _asst("ok") for i in range(12)]
    head, tail = comp_split(cfg, history)
    assert len(tail) >= 8  # the message floor kept at least its 8 recent messages


def test_split_active_task_plan_pair_never_folds() -> None:
    """The MOST-RECENT task_plan call + its result stay in the tail even when the floors would fold
    them; a SUPERSEDED earlier task_plan pair may fold."""
    cfg = CompactionCfg(keep_last_messages=1, keep_recent_tokens=1)
    history = [
        _user("start"),
        *_round(0, "task_plan", output="old plan"),  # superseded → may fold
        _user("more"),
        *_round(1, "ping", output="p"),
        _user("go"),
        *_round(2, "task_plan", output="live plan"),  # ACTIVE → must stay in the tail
        _user("last"),
    ]
    head, tail = comp_split(cfg, history)
    # the active task_plan call + its result are in the tail…
    tail_tools = [cp.tool for m in tail for cp in m.tool_calls()]
    assert "task_plan" in tail_tools
    assert any("c2" == rp.call_id for m in tail for rp in m.tool_results())
    # …and the superseded one folded into the head.
    head_tools = [cp.tool for m in head for cp in m.tool_calls()]
    assert "task_plan" in head_tools
    assert any("c0" == cp.call_id for m in head for cp in m.tool_calls())


def test_split_suspend_snap_still_holds() -> None:
    cfg = CompactionCfg(keep_last_messages=2, keep_recent_tokens=1)
    susp = _asst_call("c1", "shutdown_host", state=RunState.AWAITING_CONFIRM)
    history = [_user("a"), susp, _user("b"), _asst("ok"), _user("c"), _asst("done")]
    head, tail = comp_split(cfg, history)
    assert susp not in head and susp in tail


def _asst(t: str) -> Message:
    return Message(thread_id="t", role="assistant", actor=Actor.AGENT, parts=[TextPart(text=t)])


def comp_split(cfg: CompactionCfg, history: list[Message]):
    return _split_compactor(cfg)._split(history)


# ── D. the summarizer v2 (`_summarize` against a fake inference) ──────────────────────────────────


class _FakeInfer:
    """Duck-typed inference for `_summarize`: captures the payload + serves a canned window/reply."""

    def __init__(self, *, window: int | None = None, reply: str = "the summary body") -> None:
        self._window = window
        self._reply = reply
        self.payloads: list[list[dict]] = []

    async def effective_window_for(self, mode: str | None = None) -> int | None:
        return self._window

    async def complete(self, payload, *, mode=None, model=None, **_kw) -> str:
        self.payloads.append(payload)
        return self._reply


def _summarize(fake: _FakeInfer, *, instructions: str | None = None) -> tuple[str, bool]:
    comp = Compactor(cast("InferenceClient", fake), cast("MessageRepo", None), CompactionCfg())
    head = [_user("please wake corsair"), _asst("done, corsair is up")]
    return _run(comp._summarize(head, instructions=instructions))


def test_summarizer_template_has_five_pinned_sections() -> None:
    fake = _FakeInfer()
    body, truncated = _summarize(fake)
    assert not truncated and body.startswith(SUMMARY_PREFIX)
    system = fake.payloads[0][0]["content"]
    for section in _SUMMARIZER_SECTIONS:
        assert f"## {section}" in system
    assert "Rules & Constraints" in system and "Next Steps" in system  # the ACA-pinned names


def test_summarizer_instructions_threaded_on_manual_only() -> None:
    with_inst = _FakeInfer()
    _summarize(with_inst, instructions="focus on the deploy steps")
    assert (
        "The user asked to focus this summary on: focus on the deploy steps"
        in with_inst.payloads[0][0]["content"]
    )
    # auto-compaction (no instructions) never carries the emphasis block
    without = _FakeInfer()
    _summarize(without, instructions=None)
    assert "The user asked to focus this summary on" not in without.payloads[0][0]["content"]


def test_summarizer_overflow_guard_trips_to_truncation_fold() -> None:
    """A transcript over the summarizer window (minus the margin) skips the doomed call for the
    truncation-fold — `complete` is never invoked."""
    fake = _FakeInfer(window=5)  # tiny window → any real transcript overflows
    body, truncated = _summarize(fake)
    assert truncated and body == TRUNCATION_NOTICE
    assert fake.payloads == []  # the summarizer was NOT called


def test_summarizer_no_window_proceeds_best_effort() -> None:
    fake = _FakeInfer(window=None)  # unresolvable window → cannot guard → proceed
    body, truncated = _summarize(fake)
    assert not truncated and body.startswith(SUMMARY_PREFIX) and fake.payloads


# ── E. the inflation-reject (`compact` against a real DB) ─────────────────────────────────────────


async def _fresh_repos():
    from app.services.conversation import ThreadRepo

    db = Database(Path(tempfile.mkdtemp()) / "t.db")
    await db.connect()
    return MessageRepo(db), ThreadRepo(db)


class _InflateInfer:
    """Summarizer that returns a HUGE body (bigger than any small head) → the fold would inflate."""

    async def effective_window_for(self, mode: str | None = None) -> int | None:
        return None  # no overflow guard → the (inflating) summarizer actually runs

    async def complete(self, payload, *, mode=None, model=None, **_kw) -> str:
        return "Z" * 50000


def test_inflation_reject_leaves_db_untouched() -> None:
    async def go() -> None:
        from app.domain.conversation import Thread

        messages, threads = await _fresh_repos()
        thread = await threads.create(Thread())
        # A small head → the huge summary is guaranteed larger → must reject.
        for t in ("one", "two", "three", "four"):
            m = _user(t)
            m.thread_id = thread.id
            await messages.add(m)
        cfg = CompactionCfg(keep_last_messages=1, keep_recent_tokens=1)
        comp = Compactor(cast("InferenceClient", _InflateInfer()), messages, cfg)

        res = await comp.compact(thread, force=True)  # force does NOT bypass the reject
        assert res is not None and res.rejected is True and res.removed == 0
        # DB untouched: no message flipped `compacted`, no summary system message inserted.
        live = await messages.list(thread.id, include_compacted=False)
        assert len(live) == 4 and all(not m.compacted for m in live)
        assert not any(m.role == "system" for m in live)

    _run(go())


class _FixedInfer:
    """Summarizer returning a FIXED-size body, so the reject comparison is deterministic (R5)."""

    def __init__(self, body: str) -> None:
        self._body = body

    async def effective_window_for(self, mode: str | None = None) -> int | None:
        return None  # no overflow guard

    async def complete(self, payload, *, mode=None, model=None, **_kw) -> str:
        return self._body


def test_inflation_reject_prices_head_net_of_clearing() -> None:
    """R5: the reject prices the folded head NET of the free clearing trim. A head whose bulk is a
    cleared tool output no longer inflates the comparison: a medium summary that would shrink against
    the FAT (untrimmed) head but NOT against the trimmed head is now REJECTED. Without the plan (head
    priced full) the SAME summary folds — proving the head-net pricing flips the decision."""

    async def go() -> None:
        from app.domain.conversation import Thread

        # head = [user, asst_call c0, tool c0 BIG] (~757 tok); tail = [user, asst]. clearing clears c0
        # (gain 600 → head_net ~157). A ~408-tok summary is > head_net (reject) but < head_full (accept).
        def _history(thread_id: str) -> list[Message]:
            msgs = [_user("u0"), *_round(0, output=_BIG), _user("u1"), _asst("reply")]
            for m in msgs:
                m.thread_id = thread_id
            return msgs

        cfg = CompactionCfg(keep_last_messages=1, keep_recent_tokens=1)
        plan = ClearingPlan(frozenset({"c0"}), {"c0": len(_BIG) // CLEAR_CHARS_PER_TOKEN})
        summary_body = "Z" * 1600  # ~408 tok once the SUMMARY_PREFIX is added

        # With the clearing plan → head priced net (~157) → the summary inflates → REJECT.
        messages, threads = await _fresh_repos()
        thread = await threads.create(Thread())
        for m in _history(thread.id):
            await messages.add(m)
        comp = Compactor(cast("InferenceClient", _FixedInfer(summary_body)), messages, cfg)
        res = await comp.compact(thread, force=True, clearing=plan)
        assert res is not None and res.rejected is True and res.removed == 0

        # SAME summary, NO clearing plan → head priced full (~757) → the summary shrinks → FOLDS.
        messages2, threads2 = await _fresh_repos()
        thread2 = await threads2.create(Thread())
        for m in _history(thread2.id):
            await messages2.add(m)
        comp2 = Compactor(cast("InferenceClient", _FixedInfer(summary_body)), messages2, cfg)
        res2 = await comp2.compact(thread2, force=True)
        assert res2 is not None and res2.rejected is False and res2.removed > 0

    _run(go())


# ── E2. the thrash-state prune (`prune_compaction_state`, R3) ──────────────────────────────────────


def test_prune_compaction_state_pops_default_keeps_latched() -> None:
    """R3: `prune_compaction_state` drops an all-default entry (re-mintable lazily) but PRESERVES any
    live residual — a latched breaker, or a non-zero failure counter — so the cross-turn latch survives."""
    store: dict[str, CompactionState] = {
        "default": CompactionState(),
        "latched": CompactionState(breaker_latched=True, notice_emitted=True),
        "failing": CompactionState(consecutive_failures=2),
    }
    for tid in ("default", "latched", "failing", "missing"):
        prune_compaction_state(store, tid)
    assert "default" not in store  # all-default → popped
    assert "latched" in store  # latched breaker survives
    assert "failing" in store  # a live failure counter survives


def test_manual_reset_then_prune_drops_the_entry() -> None:
    """R3 end-to-end: a manual compact that leaves the thread under threshold RESETS the machine to
    all-defaults; the endpoint then prunes the now-inert entry (here we call the same helper the
    `/agent/compact` endpoint calls). A still-latched thread would be preserved instead."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed_history(state, thread)
            session = _thrash_session(state, thread, max_failures=1)
            cs = state.compaction_state[thread.id]

            _ = [ev async for ev in session._drive(thread)]
            assert cs.breaker_latched is True  # latched after one failing turn
            # while latched, prune must NOT drop it (a live residual survives turns until reset)
            prune_compaction_state(state.compaction_state, thread.id)
            assert thread.id in state.compaction_state

            async def big_window(ep):
                return 10_000_000

            async def small_summary(payload, *, mode=None, model=None, **_kw):
                return "tiny"

            session._inference.effective_window = big_window  # type: ignore[assignment]
            session._inference.complete = small_summary  # type: ignore[assignment]

            await session.compact(thread)  # resets to all-defaults (under threshold)
            assert cs == CompactionState()  # confirm the reset
            prune_compaction_state(state.compaction_state, thread.id)  # the endpoint's prune step
            assert thread.id not in state.compaction_state  # the inert entry was dropped

        _run(go())


# ── F. the thrash machine (driving the app) ───────────────────────────────────────────────────────


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


def _thrash_session(state, thread, *, max_failures: int = 3):
    """A session wired to ALWAYS want compaction (small window, foldable floors) and ALWAYS reject the
    fold (an inflating summarizer). Text-only model replies end each turn."""
    from app.api.agent import _build_session

    session = _build_session(state, thread)
    cfg = CompactionCfg(
        keep_last_messages=2, keep_recent_tokens=5, threshold_frac=0.85, max_consecutive_failures=max_failures
    )
    session._compaction_cfg = cfg
    session._compactor = Compactor(session._inference, state.messages, cfg)

    async def over_window(ep):  # a tiny window keeps the estimate over threshold every iteration
        return 50

    async def no_guard(mode=None):  # let the inflating summarizer actually run (no overflow guard)
        return None

    async def inflate(payload, *, mode=None, model=None, **_kw):
        return "Z" * 50000  # bigger than the small head → inflation-reject → a failure

    session._inference.effective_window = over_window  # type: ignore[assignment]
    session._inference.effective_window_for = no_guard  # type: ignore[assignment]
    session._inference.complete = inflate  # type: ignore[assignment]

    async def text_only(messages, *, mode=None, model=None, tools=None, report=None, **_kw):
        yield ChatDelta(text="ok")

    session._inference.stream_chat = text_only  # type: ignore[assignment]
    return session


async def _seed_history(state, thread) -> None:
    # LARGE messages so a real fold SHRINKS the head (a tiny summary / truncation-notice is smaller) —
    # the inflation-reject only bites a pathologically small head.
    for i in range(6):
        m = _user("u" * 400) if i % 2 == 0 else _asst("a" * 400)
        m.thread_id = thread.id
        await state.messages.add(m)


def test_thrash_breaker_latches_at_cap_with_one_notice() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed_history(state, thread)
            session = _thrash_session(state, thread, max_failures=3)
            cs = state.compaction_state[thread.id]

            latch_notices = 0
            for turn in range(4):  # 3 failing turns latch; the 4th must not re-attempt
                events = [ev async for ev in session._drive(thread)]
                latch_notices += sum(
                    1 for e in events if e.event == "notice" and "keeps failing" in e.data.get("text", "")
                )
                if turn == 0:
                    assert cs.consecutive_failures == 1
                if turn == 2:
                    assert cs.breaker_latched is True and cs.consecutive_failures == 3

            assert latch_notices == 1, "exactly ONE latch notice, ever"
            assert cs.breaker_latched is True

        _run(go())


def test_thrash_backoff_skips_within_turn_retries() -> None:
    """After a failed fold, no re-attempt until the NEXT turn — a 2-iteration turn attempts the
    summarizer exactly once."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed_history(state, thread)
            session = _thrash_session(state, thread)

            calls = {"n": 0}

            async def counting_inflate(payload, *, mode=None, model=None, **_kw):
                calls["n"] += 1
                return "Z" * 50000

            session._inference.complete = counting_inflate  # type: ignore[assignment]

            # Iteration 1: a task_plan tool call (progress → the loop continues); iteration 2: text.
            seq = [
                ChatDelta(tool_calls=[ToolCallRequest(id="tp", name="task_plan", arguments="{}")]),
                ChatDelta(text="done"),
            ]

            async def scripted(messages, *, mode=None, model=None, tools=None, report=None, **_kw):
                yield seq.pop(0) if seq else ChatDelta(text="done")

            session._inference.stream_chat = scripted  # type: ignore[assignment]

            _ = [ev async for ev in session._drive(thread)]
            assert calls["n"] == 1, "the summarizer was attempted once (iteration 1), backed off after"

        _run(go())


def test_thrash_manual_reset_unlatches_and_force_works_while_latched() -> None:
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed_history(state, thread)
            session = _thrash_session(state, thread, max_failures=1)  # latch after ONE failure
            cs = state.compaction_state[thread.id]

            _ = [ev async for ev in session._drive(thread)]
            assert cs.breaker_latched is True  # latched after one failing turn

            # Manual /compact: force runs even while latched (a SHRINKING summarizer this time), and the
            # thread ends under threshold → the machine RESETS (unlatched, failures cleared).
            async def big_window(ep):
                return 10_000_000  # so the post-compact re-check reads UNDER threshold

            async def small_summary(payload, *, mode=None, model=None, **_kw):
                return "tiny"

            session._inference.effective_window = big_window  # type: ignore[assignment]
            session._inference.complete = small_summary  # type: ignore[assignment]

            out = await session.compact(thread)
            assert out.get("rejected") is not True  # force ran a real (shrinking) fold while latched
            assert cs.breaker_latched is False and cs.consecutive_failures == 0

        _run(go())


def test_thrash_truncation_shrink_counts_as_success() -> None:
    """A summarizer failure that ends in a SHRINKING truncation-fold is a SUCCESS (resets the counter)
    — the ONLY failure is the didn't-shrink inflation-reject."""
    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            from app.adapters.inference import InferenceError
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed_history(state, thread)
            session = _thrash_session(state, thread)
            cs = state.compaction_state[thread.id]
            cs.consecutive_failures = 2  # pretend we were mid-thrash

            async def boom(payload, *, mode=None, model=None, **_kw):
                raise InferenceError("summarizer down")  # → TRUNCATION_NOTICE, which SHRINKS the head

            session._inference.complete = boom  # type: ignore[assignment]

            events = [ev async for ev in session._drive(thread)]
            assert any(e.event == "compaction" for e in events)  # a fold happened (truncation)
            assert cs.consecutive_failures == 0  # success reset the counter

        _run(go())


# ── G. hot-settings application (D42 Invariant 11 / R6) ────────────────────────────────────────────


def test_settings_written_compaction_applies_at_next_session() -> None:
    """D42 Invariant 11 (R6): compaction knobs written via the settings surface apply at the NEXT
    built session with no restart (sessions build per-turn off live settings), and a written
    `inference.local.context_window` moves the window-aware trigger line. Uses the temp-config
    TestClient pattern — never the real config.yaml."""
    from app.api.agent import _build_session

    with _workspace(), _client() as c:
        state = c.app.state

        # baseline: the default global compaction knobs a freshly built session sees.
        base = _build_session(state)
        assert base._compaction_cfg.threshold_frac == 0.85  # the D42 default

        # PUT global compaction knobs + a local context window through the real settings endpoint.
        r = c.put(
            "/api/settings",
            json={
                "agent": {"compaction": {"threshold_frac": 0.6, "keep_recent_tokens": 2048}},
                "inference": {"local": {"context_window": 40000}},
            },
        )
        assert r.status_code == 200, r.text

        # the NEXT built session's Compactor sees the new values (hot at next turn, no restart).
        after = _build_session(state)
        assert after._compaction_cfg.threshold_frac == 0.6
        assert after._compaction_cfg.keep_recent_tokens == 2048

        async def go() -> None:
            local_ep = state.settings.inference.endpoint("local")
            window = await state.inference.effective_window(local_ep)
            assert window == 40000  # config context_window wins the ladder
            # the trigger line moved: window(40000) × frac(0.6) = 24000 (was None → threshold_tokens).
            assert after._compactor._trigger_limit(window, None) == 40000 * 0.6
            # a DIFFERENT context window moves it again (proves the line tracks the live config).
            r2 = c.put("/api/settings", json={"inference": {"local": {"context_window": 8192}}})
            assert r2.status_code == 200, r2.text
            ep2 = state.settings.inference.endpoint("local")
            assert await state.inference.effective_window(ep2) == 8192
            newer = _build_session(state)
            assert newer._compactor._trigger_limit(8192, None) == 8192 * 0.6

        _run(go())


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
