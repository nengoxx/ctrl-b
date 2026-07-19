"""Phase D17 — dual-mode chat (streaming + buffered).

Buffered mode is a second *consumer* of the same `run_turn()`/`resume()` `AgentEvent` generator via
`collect_turn` — the loop is never forked. The per-request signal is a `stream` boolean in the body
(OpenAI convention; default false, the PWA sends true); the server `agent.streaming` setting is
authoritative (`on`/`off` force it, `auto` honors the field).

What's exercised:
  1. `collect_turn` folds completed / suspended-confirm / suspended-question / error / capped streams
     — and crucially captures `permission` (with the confirm token) so a buffered confirm is resumable.
  2. `_effective_stream` truth table (on/off/auto × stream true/false).
  3. The chat endpoint content-negotiates: stream:false → application/json payload; stream:true →
     text/event-stream; setting `off` forces JSON even when the client asks to stream.
  4. Parity: the same scripted turn yields the same terminal state + messageId either way.

The endpoint tests spy on `api.agent._session` to feed scripted events (no model). All on a temp
`$CTRLB_HOME`.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async


def _client(config_text: str = "server:\n  port: 5433\n"):
    from fastapi.testclient import TestClient

    from app.main import create_app

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app())


@contextlib.contextmanager
def _env_cleanup():
    try:
        yield
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _run(coro):
    return run_async(coro)


def _ev(event: str, **data):
    from app.services.agent.session import AgentEvent

    return AgentEvent(event, data)


async def _stream(events):
    for e in events:
        yield e


# ── 1: collect_turn folds each terminal shape ─────────────────────────────────────────────────


def test_collect_completed() -> None:
    from app.services.agent.session import collect_turn

    out = _run(
        collect_turn(
            _stream(
                [
                    _ev("message.start", messageId="m1", role="assistant"),
                    _ev("text.delta", messageId="m1", delta="hi"),  # discarded
                    _ev("message.end", messageId="m1"),
                    _ev("done", threadId="t1", state="completed"),
                ]
            )
        )
    )
    assert out == {"state": "completed", "messageId": "m1", "notices": []}  # notices empty on a plain turn


def test_collect_folds_notices() -> None:
    """ACA-11/D40: `collect_turn` buffers each `notice` event's text into `notices` (live breadcrumbs
    like failover + "compacting…" aren't persisted, so a buffered consumer would otherwise miss them)."""
    from app.services.agent.session import collect_turn

    out = _run(
        collect_turn(
            _stream(
                [
                    _ev("message.start", messageId="m1"),
                    _ev("notice", text="// compacting the conversation…"),
                    _ev("notice", text="// inference failover → cloud (primary unavailable)"),
                    _ev("message.end", messageId="m1"),
                    _ev("done", threadId="t1", state="completed"),
                ]
            )
        )
    )
    assert out["notices"] == [
        "// compacting the conversation…",
        "// inference failover → cloud (primary unavailable)",
    ]


def test_collect_suspended_confirm_carries_token() -> None:
    from app.services.agent.session import collect_turn

    out = _run(
        collect_turn(
            _stream(
                [
                    _ev("message.start", messageId="m1"),
                    _ev("message.end", messageId="m1"),
                    _ev(
                        "tool.permission", callId="c1", tool="reboot_host", token="tok-123", prompt="confirm?"
                    ),
                    _ev("done", threadId="t1", state="suspended"),
                ]
            )
        )
    )
    assert out["state"] == "suspended"
    # The token is the one thing not persisted — buffered resume depends on it riding the payload.
    assert out["permission"]["token"] == "tok-123"
    assert out["permission"]["callId"] == "c1"


def test_collect_suspended_question() -> None:
    from app.services.agent.session import collect_turn

    out = _run(
        collect_turn(
            _stream(
                [
                    _ev("message.start", messageId="m1"),
                    _ev("tool.question", callId="q1", tool="question", question="which host?"),
                    _ev("done", threadId="t1", state="suspended"),
                ]
            )
        )
    )
    assert out["state"] == "suspended"
    assert out["question"]["question"] == "which host?"


def test_collect_error_and_capped() -> None:
    from app.services.agent.session import collect_turn

    err = _run(
        collect_turn(
            _stream(
                [
                    _ev("error", message="backend down", retryable=True),
                    _ev("done", threadId="t1", state="error"),
                ]
            )
        )
    )
    assert err["state"] == "error" and err["error"]["message"] == "backend down"

    capped = _run(
        collect_turn(
            _stream(
                [
                    _ev("message.end", messageId="m1"),
                    _ev("done", threadId="t1", state="capped"),
                ]
            )
        )
    )
    assert capped["state"] == "capped" and capped["messageId"] == "m1"


# ── 2: the resolver ───────────────────────────────────────────────────────────────────────────


def test_effective_stream_truth_table() -> None:
    from app.api.agent import _effective_stream

    assert _effective_stream("on", False) is True and _effective_stream("on", True) is True
    assert _effective_stream("off", True) is False and _effective_stream("off", False) is False
    assert _effective_stream("auto", True) is True and _effective_stream("auto", False) is False


# ── 3 + 4: endpoint content-negotiation + parity (scripted session, no model) ──────────────────


class _FakeSession:
    """Yields a scripted event stream for both run_turn and resume — stands in for AgentSession so the
    endpoint runs without an LLM."""

    def __init__(self, events):
        self._events = events

    async def run_turn(self, *a, **k):
        for e in self._events:
            yield e

    async def resume(self, *a, **k):
        for e in self._events:
            yield e


@contextlib.contextmanager
def _fake_session(events):
    import app.api.agent as agent_api

    orig = agent_api._session
    agent_api._session = lambda *a, **k: _FakeSession(events)
    try:
        yield
    finally:
        agent_api._session = orig


_COMPLETED = None  # built lazily (needs AgentEvent imported under the app env)


def _completed_events():
    return [
        _ev("message.start", messageId="m-x", role="assistant"),
        _ev("text.delta", messageId="m-x", delta="hello"),
        _ev("message.end", messageId="m-x"),
        _ev("done", threadId="t", state="completed"),
    ]


def test_endpoint_buffered_vs_streamed_and_parity() -> None:
    with _env_cleanup():
        with _client() as c:  # default streaming = auto
            # stream:false → buffered JSON with the folded payload.
            with _fake_session(_completed_events()):
                r = c.post("/api/agent/chat", json={"text": "hi", "stream": False})
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("application/json")
            body = r.json()
            assert body["state"] == "completed" and body["messageId"] == "m-x"
            assert "threadId" in body

            # stream:true → SSE; the same terminal state + messageId appear in the frames (parity).
            with _fake_session(_completed_events()):
                r2 = c.post("/api/agent/chat", json={"text": "hi", "stream": True})
            assert r2.headers["content-type"].startswith("text/event-stream")
            assert '"state": "completed"' in r2.text and "m-x" in r2.text


def _suspended_confirm_events():
    return [
        _ev("message.start", messageId="m-c"),
        _ev("message.end", messageId="m-c"),
        _ev("tool.permission", callId="c1", tool="reboot_host", token="tok-xyz", prompt="confirm?"),
        _ev("done", threadId="t", state="suspended"),
    ]


def test_endpoint_buffered_suspend_carries_token() -> None:
    # The full endpoint → payload path must surface the confirm token (not persisted) so a buffered
    # confirm stays resumable — the frontend seeds confirmTokens[callId] from it.
    with _env_cleanup():
        with _client() as c:
            with _fake_session(_suspended_confirm_events()):
                r = c.post("/api/agent/chat", json={"text": "reboot it", "stream": False})
            assert r.headers["content-type"].startswith("application/json")
            body = r.json()
            assert body["state"] == "suspended"
            assert body["permission"]["token"] == "tok-xyz"
            assert body["permission"]["callId"] == "c1"


def test_setting_off_forces_buffered_even_when_client_asks_stream() -> None:
    with _env_cleanup():
        with _client("server:\n  port: 5433\nagent:\n  streaming: off\n") as c:
            assert c.app.state.settings.agent.streaming == "off"
            with _fake_session(_completed_events()):
                r = c.post("/api/agent/chat", json={"text": "hi", "stream": True})  # asks to stream
            assert r.headers["content-type"].startswith("application/json")  # overridden → buffered


def test_setting_on_forces_stream_even_when_client_buffers() -> None:
    with _env_cleanup():
        with _client("server:\n  port: 5433\nagent:\n  streaming: on\n") as c:
            with _fake_session(_completed_events()):
                r = c.post("/api/agent/chat", json={"text": "hi", "stream": False})  # asks to buffer
            assert r.headers["content-type"].startswith("text/event-stream")  # overridden → stream


# ── 5: the REAL ACA-11 notice timing at the _drive level (not just synthetic notices → collect_turn) ──


def _real_drive_session(c):
    """A real `AgentSession` whose `stream_chat` replays a single text-only turn (no model, no tools →
    the loop runs one iteration and completes). Returns (session, thread). The caller stubs the
    compactor to drive the ACA-11 `should_compact`/`compact` branch."""
    from app.adapters.inference import ChatDelta
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    session = AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)
    thread = _run(s.threads.create(Thread()))

    async def fake_stream(messages, **kw):
        yield ChatDelta(text="done")

    session._inference.stream_chat = fake_stream
    return session, thread


def test_drive_emits_compacting_notice_before_compact_runs() -> None:
    """ACA-11 (§7 seam, `_drive` ~778): the "// compacting…" breadcrumb is yielded BEFORE the (slow)
    compaction call runs — so a buffered/streaming consumer sees the stall immediately. `compact` is
    gated: the notice must arrive with the gate STILL UNSET. Reorder the notice after `compact()` (or
    drop the `should_compact` guard) and the first `__anext__` blocks on the gate → `wait_for` fails."""
    import asyncio

    with _env_cleanup():
        with _client() as c:
            session, thread = _real_drive_session(c)
            gate = asyncio.Event()

            async def _should(_thread, **_kw):  # **_kw absorbs the D42 window/reserve/estimate kwargs
                return True

            async def _compact(_thread, **_kw):
                await gate.wait()  # a slow, multi-second compaction stand-in
                return None

            session._compactor.should_compact = _should
            session._compactor.compact = _compact

            async def scenario():
                gen = session.run_turn(thread, "hello")
                first = await asyncio.wait_for(gen.__anext__(), timeout=2)
                assert first.event == "notice"
                assert "compacting" in first.data["text"]
                assert not gate.is_set()  # the notice preceded compact() actually running
                gate.set()
                rest = [ev async for ev in gen]
                return first, rest

            _first, rest = _run(scenario())
            # the turn still completes normally after compaction releases; no SECOND notice.
            assert [e.event for e in rest].count("notice") == 0
            assert any(e.event == "done" and e.data["state"] == "completed" for e in rest)


def test_drive_no_notice_when_should_compact_false() -> None:
    """The symmetric pin: `should_compact` False → NO `notice` event anywhere in the turn (the
    breadcrumb is gated on the real decision, never emitted on a no-op iteration)."""
    with _env_cleanup():
        with _client() as c:
            session, thread = _real_drive_session(c)

            async def _should(_thread, **_kw):  # **_kw absorbs the D42 window/reserve/estimate kwargs
                return False

            async def _compact(_thread, **_kw):
                return None  # no-op: nothing to fold

            session._compactor.should_compact = _should
            session._compactor.compact = _compact

            events = _run(_collect_turn_events(session.run_turn(thread, "hello")))
            assert not any(e.event == "notice" for e in events)
            assert any(e.event == "done" and e.data["state"] == "completed" for e in events)


async def _collect_turn_events(gen):
    return [ev async for ev in gen]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
