"""FORMAL-AUDIT FIX WAVE B — the machinery batch (Codex-audit findings, one pinning test per item).

  B1 (C3-H1) — a *raw* `task.cancel()` arriving while `_run_calls` is parked INSIDE its shielded
       persistence tail (and the same for `Database.transaction()`'s rollback arm) must NOT abandon
       the write: an anyio shield alone doesn't suppress a raw asyncio cancel. The fix runs the tail
       as its own uncancellable task (`asyncio.ensure_future` + `await asyncio.shield` + a second
       `await`). Verified by parking inside the tail via a blocking `update`/`rollback`, cancelling,
       then releasing — the write completes and the CancelledError is re-raised.
  B2 (C3-M3) — a COMMIT failure inside `transaction()` rolls back (not left mid-transaction) and a
       subsequent transaction still works.
  B3 (C4-M2) — in the done-but-unreleased window `turn_status`/`turn_stream` report THIS turn (the
       settled handle), not the PREVIOUS turn still sitting in the terminal cache.
  B4 (C4-M3) — a cancel landing before the drain task's first step is backfilled by `_cleanup`:
       terminal_status set, terminal sentinel pushed (subscribers unblock), marker released.
  B5 (C2-M2) — a registered OpenAPI operation carries `timeout_s` (the server's `call_timeout_s`), so
       `ActionService`'s outer deadline times out a never-completing handler.
  B7 (C5-M2) — compaction's `_split` never folds a durably-suspended call into the head.
  B8 (C5-M3) — `_finalize` retries ONCE with `tools=None` when `tool_choice="none"` is rejected.

(B6 hardens `test_deadline_policy_aca67.py` in place; B9 is config-only, pinned by
`test_config_example_qh8.py`.)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import tempfile
import uuid
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace
from typing import cast

from _async import run_async


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "computers: {}\n"):
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


# ── B1 — raw cancel inside the persistence tail must not tear the write ──────────────────────────


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def _ok_outcome(summary: str, output: str):
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    return InvokeOutcome(
        needs_confirm=False, result=ToolResult(state=RunState.OK, summary=summary, output=output)
    )


def test_b1_raw_cancel_inside_tail_persists_and_reraises() -> None:
    """A raw `task.cancel()` delivered while `_run_calls` is parked INSIDE a shielded persist (the
    FIRST `update` is blocked — post-D40 that is call_one's PER-CALL persist, through the same
    `_persist_shielded` helper the finally backstop uses) still completes the write and re-raises
    CancelledError — the inner persist task is uncancellable by the outer cancel (C3-H1)."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    with _workspace(), _client() as c:
        s = c.app.state
        agent = s.settings.resolve_agent(None)
        session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent)
        thread = run_async(s.threads.create(Thread()))
        cid = uuid.uuid4().hex
        assistant = Message(
            thread_id=thread.id,
            role="assistant",
            actor=Actor.AGENT,
            agent="default",
            parts=[ToolCallPart(call_id=cid, tool="call_one", args={"n": 1}, state=RunState.PENDING)],
        )
        run_async(s.messages.add(assistant))

        async def fake_invoke(tool, args, **kw):
            return _ok_outcome("ran one", "one done")

        session._actions.invoke = fake_invoke

        parked = asyncio.Event()
        release = asyncio.Event()
        real_update = session._messages.update
        first = {"blocked": False}

        async def blocking_update(msg):
            # Block the FIRST update — the tail's `update(assistant)` inside the shielded transaction.
            if not first["blocked"]:
                first["blocked"] = True
                parked.set()
                await release.wait()
            return await real_update(msg)

        session._messages.update = blocking_update
        cancelled_seen = {"v": False}

        async def go() -> None:
            async def runner() -> None:
                from app.services.agent.session import _BatchOutcome

                try:
                    outcome = _BatchOutcome()
                    async for _ev in session._run_calls(thread, assistant, {}, _guard(), outcome=outcome):
                        pass
                except asyncio.CancelledError:
                    cancelled_seen["v"] = True
                    raise

            task = asyncio.ensure_future(runner())
            await parked.wait()  # parked INSIDE the tail (blocked in `update`)
            task.cancel()  # raw cancel while inside the shielded tail
            await asyncio.sleep(0)  # let the cancel reach the shield await + enter the recovery await
            release.set()  # unblock the tail — the inner task must still finish
            with contextlib.suppress(asyncio.CancelledError):
                await task

        run_async(go())

        assert cancelled_seen["v"] is True, "CancelledError must re-raise out of _run_calls"
        # The completed call survived the raw cancel: assistant flipped OK + a tool message persisted.
        msgs = run_async(s.messages.list(thread.id))
        arow = next(m for m in msgs if m.role == "assistant")
        assert {cp.call_id: cp.state for cp in arow.tool_calls()} == {cid: RunState.OK}
        tool_rows = [m for m in msgs if m.role == "tool"]
        assert len(tool_rows) == 1 and [r.call_id for r in tool_rows[0].tool_results()] == [cid]


# ── B1 (db) + B2 — the shielded rollback and the commit-failure arm ─────────────────────────────


async def _fresh_db():
    from app.db import Database

    path = Path(tempfile.mkdtemp()) / "t.db"
    db = Database(path)
    await db.connect()
    return db


async def _count(db, sql: str, params: tuple = ()) -> int:
    rows = await db.query(sql, params)
    return int(rows[0]["n"]) if rows else 0


def test_b1_rollback_interrupted_by_cancel_leaves_connection_usable() -> None:
    """A raw cancel arriving while `Database.transaction()`'s rollback is in flight must still finish
    the rollback (the connection isn't left mid-BEGIN) — a subsequent transaction works (C3-H1)."""

    async def go() -> None:
        db = await _fresh_db()
        await db.execute("CREATE TABLE kv (k TEXT)")
        parked = asyncio.Event()
        release = asyncio.Event()
        real_rollback = db.conn.rollback

        async def blocking_rollback():
            parked.set()
            await release.wait()
            return await real_rollback()

        db.conn.rollback = blocking_rollback  # type: ignore[method-assign]
        cancelled = {"v": False}

        async def runner() -> None:
            try:
                async with db.transaction():
                    await db.execute("INSERT INTO kv (k) VALUES ('x')")
                    raise ValueError("boom")  # → the rollback arm
            except asyncio.CancelledError:
                cancelled["v"] = True
                raise
            except ValueError:
                pass

        task = asyncio.ensure_future(runner())
        await parked.wait()  # parked inside the (shielded) rollback
        task.cancel()  # raw cancel mid-rollback
        await asyncio.sleep(0)
        release.set()
        with contextlib.suppress(asyncio.CancelledError):
            await task

        db.conn.rollback = real_rollback  # type: ignore[method-assign]
        assert cancelled["v"] is True
        # The connection is NOT poisoned: a fresh transaction commits, and 'x' was rolled back.
        async with db.transaction():
            await db.execute("INSERT INTO kv (k) VALUES ('y')")
        rows = await db.query("SELECT k FROM kv")
        assert [r["k"] for r in rows] == ["y"]
        await db.close()

    run_async(go())


def test_b2_commit_failure_rolls_back_and_connection_recovers() -> None:
    """A COMMIT failure inside `transaction()` rolls the batch back (not left mid-transaction) and a
    later transaction still commits (C3-M3)."""

    async def go() -> None:
        db = await _fresh_db()
        await db.execute("CREATE TABLE kv (k TEXT)")
        real_commit = db.conn.commit
        boom = {"raised": False}

        async def failing_commit():
            boom["raised"] = True
            raise RuntimeError("commit failed")

        db.conn.commit = failing_commit  # type: ignore[method-assign]
        raised = False
        try:
            async with db.transaction():
                await db.execute("INSERT INTO kv (k) VALUES ('x')")
        except RuntimeError:
            raised = True
        db.conn.commit = real_commit  # type: ignore[method-assign]

        assert raised and boom["raised"], "the commit error must propagate"
        assert await _count(db, "SELECT COUNT(*) AS n FROM kv") == 0, "the failed-commit batch rolled back"
        # The connection recovered: a subsequent transaction commits.
        async with db.transaction():
            await db.execute("INSERT INTO kv (k) VALUES ('y')")
        assert await _count(db, "SELECT COUNT(*) AS n FROM kv") == 1
        await db.close()

    run_async(go())


# ── B3 — done-but-unreleased reports the CURRENT turn, not the prior one in the cache ────────────


def test_b3_done_but_unreleased_reports_current_turn() -> None:
    from app.api.agent import turn_status, turn_stream
    from app.services.agent.turns import TerminalRecord, TurnHandle

    with _workspace(), _client() as c:
        state = c.app.state
        tid = "thread-b3"

        async def go() -> None:
            # Cache still holds the PREVIOUS turn A; a done-but-unreleased handle for turn B is live.
            state.turn_terminals = OrderedDict()
            state.turn_terminals[tid] = TerminalRecord(turn_id="A", terminal_status="error")
            handle = TurnHandle(thread_id=tid, kind="chat", turn_id="B")
            handle.terminal_status = "completed"

            async def _noop():
                return None

            done_task = asyncio.ensure_future(_noop())
            await done_task
            handle.task = done_task
            state.turns[tid] = handle

            req = SimpleNamespace(app=SimpleNamespace(state=state))
            st = await turn_status(tid, req)
            assert st == {
                "active": False,
                "terminal_status": "completed",
                "turn_id": "B",
                "steer_queue": [],  # D41 carry (empty)
            }, st
            resp = await turn_stream(tid, req)
            body = json.loads(bytes(resp.body))
            assert body == {"active": False, "terminal_status": "completed", "turn_id": "B"}, body

        run_async(go())


# ── B4 — a never-started drain task is cleaned up (terminal set + sentinel pushed + released) ─────


def test_b4_cancel_before_first_step_is_cleaned_up() -> None:
    from app.api.agent import _turn_response
    from app.services.agent.session import AgentEvent
    from app.services.agent.turns import TERMINAL, reserve

    with _workspace(), _client() as c:
        state = c.app.state
        tid = "thread-b4"

        async def go() -> None:
            handle = reserve(state.turns, tid, "chat")
            thread = SimpleNamespace(id=tid, title="t")

            async def events():
                # Never reached — we cancel before the drain task's first step.
                yield AgentEvent("message.start", {"messageId": "m", "role": "assistant", "agent": "default"})

            req = SimpleNamespace(app=SimpleNamespace(state=state))
            await _turn_response(req, cast("object", thread), events(), stream=True, handle=handle)
            assert handle.task is not None
            queue = handle.subscribers[0]

            handle.task.cancel()  # cancel before the drain coroutine's first step ever runs
            with contextlib.suppress(asyncio.CancelledError):
                await handle.task
            # let the done-callback (`_cleanup`) run
            for _ in range(10):
                if handle.terminal_status is not None:
                    break
                await asyncio.sleep(0)

            assert handle.terminal_status == "cancelled", handle.terminal_status
            assert await queue.get() is TERMINAL, "the subscriber must receive the terminal sentinel"
            assert state.turns.get(tid) is None, "the thread marker must be released"

        run_async(go())


# ── B5 — an OpenAPI operation carries a wall-clock deadline ───────────────────────────────────────


def test_b5_openapi_tool_carries_timeout_and_times_out() -> None:
    from app.adapters.openapi_tools import OpenApiToolProvider
    from app.config import OpenApiServerCfg
    from app.domain.enums import Actor, Privilege, RunState

    spec_doc = {"paths": {"/do": {"get": {"operationId": "do_it"}}}}

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return spec_doc

    class _Http:
        async def get(self, _url):
            return _Resp()

        async def request(self, *a, **kw):
            await asyncio.sleep(30)  # never-completing handler
            return _Resp()

    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            server = OpenApiServerCfg(name="srv", base_url="http://x", call_timeout_s=0.2)
            provider = OpenApiToolProvider([server])
            provider._clients["srv"] = _Http()  # type: ignore[assignment]
            await provider.discover(state.actions.registry)

            spec = state.actions.registry.get("api__srv__do_it").spec
            assert spec.timeout_s == 0.2, "the OpenAPI spec must carry the server's call_timeout_s"

            out = await state.actions.invoke(
                "api__srv__do_it", {}, actor=Actor.USER, privilege=Privilege.FULL
            )
            assert out.result is not None and out.result.state == RunState.TIMEOUT

        run_async(go())


# ── B7 — compaction never folds a durably-suspended call ─────────────────────────────────────────


def test_b7_split_keeps_suspended_call_in_tail() -> None:
    from app.adapters.inference import InferenceClient
    from app.domain.agent import CompactionCfg
    from app.domain.conversation import Message, TextPart, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.compaction import Compactor
    from app.services.conversation import MessageRepo

    cfg = CompactionCfg(enabled=True, keep_last_messages=2)
    comp = Compactor(cast("InferenceClient", None), cast("MessageRepo", None), cfg)

    def user(t):
        return Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text=t)])

    def asst(t):
        return Message(thread_id="t", role="assistant", actor=Actor.AGENT, parts=[TextPart(text=t)])

    suspended = Message(
        thread_id="t",
        role="assistant",
        actor=Actor.AGENT,
        parts=[ToolCallPart(call_id="c1", tool="shutdown_host", args={}, state=RunState.AWAITING_CONFIRM)],
    )
    # keep_last=2 would fold indices 0..3 — which includes the suspended call at index 1.
    history = [user("a"), suspended, user("b"), asst("ok"), user("c"), asst("done")]
    head, tail = comp._split(history)

    assert suspended not in head, "a suspended call must never be folded into the head"
    assert suspended in tail, "the suspended call must stay verbatim in the tail"
    assert head == [], "the boundary snaps before the suspend's turn → nothing safe to fold here"


# ── B8 — `_finalize` falls back to tools=None when tool_choice='none' is rejected ────────────────


def test_b8_finalize_retries_with_tools_none() -> None:
    from app.adapters.inference import ChatDelta, InferenceError
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    with _workspace(), _client() as c:
        state = c.app.state

        async def go() -> None:
            agent = state.settings.resolve_agent(None)
            session = AgentSession(
                state.threads, state.messages, state.inference, state.settings, state.actions, agent
            )
            thread = await state.threads.create(Thread())
            calls = {"n": 0}

            async def fake_stream(
                messages, *, mode=None, model=None, tools=None, tool_choice=None, report=None
            ):
                calls["n"] += 1
                if tool_choice is not None:  # first attempt: tools + tool_choice='none' rejected
                    raise InferenceError("400 tool_choice not supported")
                yield ChatDelta(text="final answer")  # fallback attempt: tools=None succeeds

            session._inference.stream_chat = fake_stream

            events = [ev async for ev in session._finalize(thread, None, None)]
            kinds = [e.event for e in events]
            done = next(e for e in events if e.event == "done")
            text = "".join(e.data["delta"] for e in events if e.event == "text.delta")

            assert calls["n"] == 2, "the first (tool_choice=none) call fails → retried once with tools=None"
            assert "text.delta" in kinds and "final answer" in text
            assert done.data["state"] == "completed"

        run_async(go())


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
