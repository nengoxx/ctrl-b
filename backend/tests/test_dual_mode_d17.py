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
    assert out == {"state": "completed", "messageId": "m1"}


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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
