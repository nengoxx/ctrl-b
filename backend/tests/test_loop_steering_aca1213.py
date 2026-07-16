"""ACA Slice 1 — the agent-loop steering group (ACA-12, ACA-13, ACA-20).

Drives `_run_calls` / `_parse_args` / `MessageRepo.list` directly (no model) to cover:

  ACA-12 — the stall-guard progress key is now CALL-SCOPED (`result_sig(sig, result)`). The SAME
           call returning the SAME result still counts as no-progress (trips the stall guard), but
           two DIFFERENT calls returning identical text no longer collide into one stall bucket.
  ACA-13 — malformed tool-call arguments (JSONDecodeError or a non-object top level) synthesize an
           ERROR result echoing the raw blob and NEVER invoke the tool; a valid JSON object is
           parsed + invoked exactly as before, and an empty/whitespace blob keeps the legacy
           silent-`{}` path (a legitimate zero-arg call shape).
  ACA-20 — `MessageRepo.list` breaks a `ts` tie by `rowid` (insertion order), so a collision can't
           reorder a step's messages.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from _async import run_async


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


def _run(coro):
    return run_async(coro)


def _guard():
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=5, max_per_tool=10)


def _session(c, *, interactive: bool = True):
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    return AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=interactive
    )


def _assistant_with_call(c, session, *, tool: str, args: dict):
    """A persisted thread + an assistant message holding one PENDING `tool` call."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState

    s = c.app.state
    thread = _run(s.threads.create(Thread()))
    call_id = uuid.uuid4().hex
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[ToolCallPart(call_id=call_id, tool=tool, args=args, state=RunState.PENDING)],
    )
    _run(s.messages.add(assistant))
    return thread, assistant, call_id


def _stub_ok(session, *, summary: str = "ok", output: str = "pong"):
    """Replace `ActionService.invoke` with a stub that returns an identical OK result for any args
    (isolating the CALL signature as the only thing that varies)."""
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.action_service import InvokeOutcome

    calls: list[tuple[str, dict]] = []

    async def _fake(name, args, **kw):
        calls.append((name, args))
        return InvokeOutcome(
            needs_confirm=False, result=ToolResult(state=RunState.OK, summary=summary, output=output)
        )

    session._actions.invoke = _fake  # type: ignore[method-assign]
    return calls


def _result_event(events):
    return next(e for e in events if e.event == "tool.result")


# ── ACA-12 · call-scoped stall signature ────────────────────────────────────────────────────────


def test_result_sig_is_call_scoped() -> None:
    from app.domain.enums import RunState
    from app.domain.result import ToolResult
    from app.services.agent.session import _LoopGuard

    res = ToolResult(state=RunState.OK, summary="ok", output="pong")
    sig_a = _LoopGuard.sig("ping_host", {"host_id": "a"})
    sig_b = _LoopGuard.sig("ping_host", {"host_id": "b"})
    # Same call → same progress key; different call (even with identical result text) → different key.
    assert _LoopGuard.result_sig(sig_a, res) == _LoopGuard.result_sig(sig_a, res)
    assert _LoopGuard.result_sig(sig_a, res) != _LoopGuard.result_sig(sig_b, res)


def test_same_call_same_result_is_no_progress() -> None:
    with _workspace():
        with _client() as c:
            session = _session(c)
            _stub_ok(session)
            guard = _guard()
            # First execution of ping_host{host_id:a} → progress (a new outcome this turn).
            t1, a1, _ = _assistant_with_call(c, session, tool="ping_host", args={"host_id": "a"})
            _e1, _s1, prog1 = _run(session._run_calls(t1, a1, {}, guard))
            assert prog1 is True
            # The SAME call again (same guard, same sig, same result) → NO progress → `_drive` stalls.
            t2, a2, _ = _assistant_with_call(c, session, tool="ping_host", args={"host_id": "a"})
            _e2, _s2, prog2 = _run(session._run_calls(t2, a2, {}, guard))
            assert prog2 is False


def test_two_different_calls_same_text_both_progress() -> None:
    """The ACA-12 fix: two DIFFERENT calls returning identical text no longer false-positive as a
    stall (the old outcome-only key would have marked the second as no-progress)."""
    with _workspace():
        with _client() as c:
            session = _session(c)
            _stub_ok(session)  # identical result text for every call
            guard = _guard()
            t1, a1, _ = _assistant_with_call(c, session, tool="ping_host", args={"host_id": "a"})
            _e1, _s1, prog1 = _run(session._run_calls(t1, a1, {}, guard))
            t2, a2, _ = _assistant_with_call(c, session, tool="ping_host", args={"host_id": "b"})
            _e2, _s2, prog2 = _run(session._run_calls(t2, a2, {}, guard))
            assert prog1 is True and prog2 is True


# ── ACA-13 · malformed-args steering ────────────────────────────────────────────────────────────


def test_parse_args_classifies_malformed() -> None:
    from app.services.agent.session import _parse_args

    # Valid JSON object → parsed, no error signal.
    assert _parse_args('{"host_id": "a"}') == ({"host_id": "a"}, None)
    # Empty/whitespace-only = a legitimate zero-arg call shape → the old silent-{} path (a no-arg
    # tool runs; a tool with required fields gets the *schema* error, which steers better than a
    # JSON-repair message with an empty snippet).
    assert _parse_args("") == ({}, None)
    assert _parse_args("   ") == ({}, None)
    # Malformed: syntax error or non-object top level → ({}, raw) triggers the repair steering.
    assert _parse_args("{not json") == ({}, "{not json")
    assert _parse_args("[1,2]") == ({}, "[1,2]")


def test_malformed_args_error_without_invoking() -> None:
    with _workspace():
        with _client() as c:
            session = _session(c)
            calls = _stub_ok(session)  # would record any real invocation
            for raw in ("{not json", "[1,2]"):
                t, a, cid = _assistant_with_call(c, session, tool="ping_host", args={})
                events, suspended, _prog = _run(session._run_calls(t, a, {}, _guard(), bad_args={cid: raw}))
                assert not suspended
                res = _result_event(events).data["result"]
                assert res["state"] == "error"
                assert "not valid JSON" in res["output"]
                assert raw[:200] in res["output"]
            assert calls == []  # the tool was never invoked for any malformed blob


def test_valid_args_still_invoke() -> None:
    with _workspace():
        with _client() as c:
            session = _session(c)
            calls = _stub_ok(session)
            t, a, _ = _assistant_with_call(c, session, tool="ping_host", args={"host_id": "a"})
            events, suspended, prog = _run(session._run_calls(t, a, {}, _guard()))  # no bad_args
            assert not suspended and prog is True
            assert calls == [("ping_host", {"host_id": "a"})]  # invoked exactly once, with the args
            assert _result_event(events).data["result"]["state"] == "ok"


def test_malformed_call_counts_toward_per_tool_cap() -> None:
    """A malformed call is still a call — it increments the per-tool counter like any errored call,
    so a model spamming malformed JSON still trips the loop guard."""
    with _workspace():
        with _client() as c:
            session = _session(c)
            _stub_ok(session)
            guard = _guard()
            t, a, cid = _assistant_with_call(c, session, tool="ping_host", args={})
            _run(session._run_calls(t, a, {}, guard, bad_args={cid: "{bad"}))
            assert guard.tool_counts.get("ping_host") == 1


# ── ACA-20 · ts-collision tiebreaker ────────────────────────────────────────────────────────────


def test_list_breaks_ts_tie_by_insertion_order() -> None:
    from app.domain.conversation import Message, Thread
    from app.domain.enums import Actor

    with _workspace():
        with _client() as c:
            s = c.app.state
            thread = _run(s.threads.create(Thread()))
            ts = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)  # identical for every message
            ids = []
            for i in range(6):
                m = Message(
                    thread_id=thread.id,
                    role="assistant" if i % 2 == 0 else "tool",
                    actor=Actor.AGENT,
                    ts=ts,
                )
                _run(s.messages.add(m))
                ids.append(m.id)
            got = [m.id for m in _run(s.messages.list(thread.id))]
            assert got == ids  # rowid tiebreak → insertion order, never an undefined shuffle


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
