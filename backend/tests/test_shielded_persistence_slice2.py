"""ACA Slice 2 wave 3 — shielded step persistence on cancellation (D38, AGENT_CHAT_AUDIT §5 item 3).

`_run_calls`' body is wrapped in `try/finally`; the `finally` persists the accumulated
`update(assistant)` + partial `result_parts` tool message inside `anyio.CancelScope(shield=True)`.
This closes ACA-1 scenario 2: a cancel landing mid-batch (inside `self._actions.invoke` for a later
call) used to skip the tail entirely, dropping the completed calls' results (Claude Code #3003:
persisted `tool_use` with no `tool_result` → corrupted session). Now the shielded finally still runs
under real task cancellation, so call #1's resolved state + result survive while the in-flight call #2
keeps its unresolved state (`_assemble` synthesizes "not executed"; A11's `cancelled` marker is
Slice 3's, deliberately NOT set here).

Drives the REAL `AgentSession` + persistence path against a temp workspace (no LLM). `_actions.invoke`
is stubbed per-call — the FIRST call resolves OK, the SECOND blocks in `invoke` until an **anyio task
group's cancel scope** is cancelled. The cancellation must be scope-based (level-triggered), not a raw
`asyncio.Task.cancel()`: asyncio cancellation is edge-triggered (`CancelledError` is delivered ONCE at
the blocked await), so the finally's writes would complete even UNSHIELDED and the test would pass
vacuously. Under an anyio cancel scope — exactly what Starlette runs handlers/streams inside —
cancellation is re-raised at EVERY await within the cancelled scope, so without `shield=True` the
finally's DB writes re-raise and the tail is torn. That is the condition this test reproduces (verified
non-vacuous: it FAILS with `shield=False`). Assertions read back through the message repo (real SQLite
round-trip), never mocks.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
import uuid
from pathlib import Path

import anyio
from _async import drain_run_calls, run_async


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def _session_two_calls(c):
    """Session + a persisted assistant message holding TWO PENDING tool calls (call_one, call_two)."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = run_async(s.threads.create(Thread()))
    cid1, cid2 = uuid.uuid4().hex, uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(call_id=cid1, tool="call_one", args={"n": 1}, state=RunState.PENDING),
            ToolCallPart(call_id=cid2, tool="call_two", args={"n": 2}, state=RunState.PENDING),
        ],
    )
    run_async(s.messages.add(assistant))
    return session, thread, assistant, cid1, cid2


def _ok_outcome(summary: str, output: str):
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    return InvokeOutcome(
        needs_confirm=False, result=ToolResult(state=RunState.OK, summary=summary, output=output)
    )


# ── the D38 verify case: cancel mid-batch → completed call survives, in-flight stays unresolved ──
def test_cancel_mid_batch_persists_completed_call_and_leaves_inflight_unresolved() -> None:
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        session, thread, _assistant, cid1, cid2 = _session_two_calls(c)

        entered_two = asyncio.Event()

        async def fake_invoke(tool, args, **kw):
            if tool == "call_one":
                return _ok_outcome("ran one", "one done")
            # call_two: announce we're mid-invoke, then block until the driving task is cancelled.
            entered_two.set()
            await asyncio.sleep(3600)
            raise AssertionError("unreachable — the task is cancelled while blocked here")

        session._actions.invoke = fake_invoke  # instance attr shadows the bound method

        cancelled_seen = {"value": False}

        async def runner() -> None:
            from app.services.agent.session import _BatchOutcome

            try:
                # D40: `_run_calls` is an async generator now — drain it; the per-call persists +
                # the finally backstop both run through the SAME dual-shield helper.
                outcome = _BatchOutcome()
                async for _ev in session._run_calls(thread, _assistant, {}, _guard(), outcome=outcome):
                    pass
            except anyio.get_cancelled_exc_class():
                # CancelledError re-raised OUT of _run_calls after the shielded finally ran.
                cancelled_seen["value"] = True
                raise

        async def drive() -> None:
            # An anyio cancel scope reproduces Starlette's level-triggered cancellation (re-raised at
            # every await inside the scope) — the condition the shield exists for.
            async with anyio.create_task_group() as tg:
                tg.start_soon(runner)
                await entered_two.wait()  # call_one resolved; call_two now blocked inside invoke
                tg.cancel_scope.cancel()

        run_async(drive())
        # 1) CancelledError propagated OUT of _run_calls (re-raised after the shielded finally).
        assert cancelled_seen["value"] is True

        # 2) The REAL persisted thread: assistant row has call #1 resolved (OK) + a tool message
        #    carrying call #1's result; call #2's state is still unresolved (PENDING).
        msgs = run_async(c.app.state.messages.list(thread.id))
        assistant_row = next(m for m in msgs if m.role == "assistant")
        by_id = {cp.call_id: cp for cp in assistant_row.tool_calls()}
        assert by_id[cid1].state == RunState.OK  # completed call survived the cancel
        assert by_id[cid2].state == RunState.PENDING  # in-flight call kept its unresolved state
        assert by_id[cid2].state not in {RunState.OK, RunState.ERROR, RunState.DENIED, RunState.SKIPPED}

        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1  # exactly one tool message persisted from the finally
        results = tool_rows[0].tool_results()
        assert [r.call_id for r in results] == [cid1]  # only call #1's result; call #2 has none
        assert results[0].result.state == RunState.OK


# ── the normal (non-cancelled) path persists exactly ONE tool message (no double-persist) ────────
def test_normal_two_call_batch_persists_one_tool_message() -> None:
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        session, thread, assistant, cid1, cid2 = _session_two_calls(c)

        async def fake_invoke(tool, args, **kw):
            return _ok_outcome(f"ran {tool}", f"{tool} done")

        session._actions.invoke = fake_invoke

        events, suspended, made_progress = drain_run_calls(session, thread, assistant, {}, _guard())
        # outcome unchanged on the normal path (now read off the `_BatchOutcome` holder)
        assert suspended is False and made_progress is True
        assert [e.event for e in events] == ["tool.result", "tool.result"]

        msgs = run_async(c.app.state.messages.list(thread.id))
        assistant_row = next(m for m in msgs if m.role == "assistant")
        assert {cp.call_id: cp.state for cp in assistant_row.tool_calls()} == {
            cid1: RunState.OK,
            cid2: RunState.OK,
        }
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1  # ONE message (the finally is the sole persistence point)
        assert [r.call_id for r in tool_rows[0].tool_results()] == [cid1, cid2]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
