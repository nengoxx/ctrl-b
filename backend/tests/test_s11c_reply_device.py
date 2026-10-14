"""S11 (c) — each assistant REPLY carries the device that asked for it (owner ruling 2026-10-14: "only
the device that started a turn auto-speaks it; any other device reads it with the play button").

The client sends its per-profile id as `X-Ctrlb-Device` on every own turn; `_request_device` reads it
STRICTLY (32 lowercase hex, else `None`) once per request-driven turn, inside `_session` (chat · resume ·
regenerate), and a steer captures it at enqueue so the drain-B turn it seeds is built with the COMMITTED
head's device. The session stamps it on every assistant `Message` it writes and on its `message.start`;
the row keeps it in `meta` (no migration), the accumulator's open message carries it into the snapshot.
It is bookkeeping for the client's speak decision only: it never reaches the model's context nor the
prompt stamps. Automations build with none.

Reuses the D41 Drain-A harness (the real `AgentSession` + SQLite with a scripted `stream_chat`).
"""

from __future__ import annotations

import pytest
from _async import run_async
from starlette.requests import Request
from test_steer_drain_a_d41 import (
    _client,
    _enqueue,
    _Fake,
    _msg_entry,
    _no_compact,
    _ok_invoke_factory,
    _text,
    _tool,
    _workspace,
)
from test_steer_drain_b_d41 import _new_thread, _run_body_directly

import app.api.agent as agent_api
from app.domain.conversation import Message, TextPart, Thread
from app.services.agent.session import AgentEvent, AgentSession
from app.services.agent.turns import TurnAccumulator

OWN = "a" * 32
OTHER = "b" * 32


def _request(headers: dict[str, str]) -> Request:
    return Request(
        {"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}
    )


# ── the header: strict, else None ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"X-Ctrlb-Device": OWN}, OWN),
        ({"x-ctrlb-device": "0123456789abcdef0123456789abcdef"}, "0123456789abcdef0123456789abcdef"),
        ({}, None),  # an older client / a blocked-storage client sends none
        ({"X-Ctrlb-Device": "A" * 32}, None),  # uppercase is not the minted shape
        ({"X-Ctrlb-Device": "a" * 31}, None),
        ({"X-Ctrlb-Device": "a" * 33}, None),
        ({"X-Ctrlb-Device": OWN + "\n"}, None),  # `fullmatch`, not a `$` that tolerates a newline
        ({"X-Ctrlb-Device": "g" * 32}, None),
        ({"X-Ctrlb-Device": ""}, None),
    ],
)
def test_request_device_is_strict(headers, expected) -> None:
    assert agent_api._request_device(_request(headers)) == expected


# ── the session: every assistant row + every message.start carries it ───────────────────────────
def _device_session(c, fake, *, device: str | None, max_iterations: int | None = None):
    s = c.app.state
    update: dict = {"max_parallel_tools": 1}
    if max_iterations is not None:
        update["max_iterations"] = max_iterations
    agent = s.settings.resolve_agent(None).model_copy(update=update)
    thread = run_async(s.threads.create(Thread()))
    session = AgentSession(
        s.threads, s.messages, fake, s.settings, s.actions, agent, interactive=True, device=device
    )
    _no_compact(session)
    session._actions.invoke = _ok_invoke_factory()
    return session, thread


def _drain(session, thread) -> list[AgentEvent]:
    async def go():
        return [ev async for ev in session.run_turn(thread, "hi")]

    return run_async(go())


def test_every_assistant_message_of_a_turn_carries_the_device_in_meta_and_on_message_start() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        # a tool step, then the answer: TWO assistant messages from the main loop's site
        fake = _Fake([[_tool("ping_host", {"host_id": "a"})], [_text("It is awake.")]])
        session, thread = _device_session(c, fake, device=OWN)
        events = _drain(session, thread)

        starts = [e.data for e in events if e.event == "message.start"]
        assert len(starts) == 2
        assert all(d["device"] == OWN for d in starts)
        rows = run_async(s.messages.list(thread.id))  # round-trip through the repo's `meta`
        assistants = [m for m in rows if m.role == "assistant"]
        assert len(assistants) == 2
        assert all(m.device == OWN for m in assistants)
        # the owner's row is not a reply — it carries nothing
        assert all(m.device is None for m in rows if m.role != "assistant")
        # the API's history dump is the same `Message`, so the client reads it off the row
        body = c.get(f"/api/threads/{thread.id}/messages").json()
        assert [m["device"] for m in body if m["role"] == "assistant"] == [OWN, OWN]


def test_the_wrap_up_reply_at_the_step_cap_carries_it_too() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        # one iteration, spent on a tool call → the forced wrap-up (`_finalize`) writes the reply
        fake = _Fake([[_tool("ping_host", {"host_id": "a"})], [_text("Wrapping up.")]])
        session, thread = _device_session(c, fake, device=OWN, max_iterations=1)
        events = _drain(session, thread)

        starts = [e.data for e in events if e.event == "message.start"]
        assert len(starts) == 2  # the capped step + the wrap-up
        assert all(d["device"] == OWN for d in starts)
        rows = run_async(s.messages.list(thread.id))
        assistants = [m for m in rows if m.role == "assistant"]
        assert assistants[-1].text() == "Wrapping up."
        assert all(m.device == OWN for m in assistants)


def test_a_session_built_without_a_device_stamps_none_and_writes_no_meta_for_it() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        session, thread = _device_session(c, _Fake([[_text("ok")]]), device=None)
        events = _drain(session, thread)
        assert [e.data["device"] for e in events if e.event == "message.start"] == [None]
        rows = run_async(s.messages.list(thread.id))
        assert all(m.device is None for m in rows)
        raw = run_async(s.messages.db.query("SELECT meta FROM messages WHERE thread_id = ?", (thread.id,)))
        assert all("device" not in (r["meta"] or "") for r in raw)


def test_device_never_reaches_the_model_nor_the_prompt_stamps() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        fake = _Fake([[_text("first")], [_text("second")]])
        session, thread = _device_session(c, fake, device=OWN)
        _drain(session, thread)
        # a second turn assembles the first turn's stamped reply into its context
        _drain(session, thread)
        assert OWN not in repr(fake.seen)
        rows = run_async(s.messages.list(thread.id))
        assert all(OWN not in repr(m.prompt_stamps) for m in rows)


def test_the_repo_round_trips_device_through_meta_and_edit_text_keeps_it() -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        thread = run_async(s.threads.create(Thread()))
        m = Message(thread_id=thread.id, role="assistant", parts=[TextPart(text="hi")], device=OTHER)
        run_async(s.messages.add(m))
        assert run_async(s.messages.get(m.id)).device == OTHER
        from datetime import datetime, timezone

        run_async(s.messages.edit_text(m.id, [TextPart(text="edited")], datetime.now(timezone.utc)))
        after = run_async(s.messages.get(m.id))
        assert after.text() == "edited"
        assert after.device == OTHER
        assert after.edited is not None


# ── the snapshot: the open message carries it ────────────────────────────────────────────────────
def test_the_accumulator_carries_the_open_messages_device_into_the_snapshot() -> None:
    acc = TurnAccumulator()
    acc.fold(
        AgentEvent("message.start", {"messageId": "m", "role": "assistant", "agent": "a", "device": OWN})
    )
    acc.fold(AgentEvent("text.delta", {"messageId": "m", "delta": "Hi"}))
    snap = acc.snapshot(mode=None, seq=2)
    assert snap["message"]["device"] == OWN
    assert snap["message"]["text"] == "Hi"


# ── the routes: chat · resume · regenerate build with the request's device ──────────────────────
@pytest.fixture
def built(monkeypatch):
    """Spy on the ONE builder: record the `device` every session was built with (delegating)."""
    seen: list[str | None] = []
    real = agent_api._build_session

    def spy(state, thread=None, agent_name=None, privilege=None, automation=None, device=None):
        seen.append(device)
        return real(state, thread, agent_name, privilege, automation, device=device)

    monkeypatch.setattr(agent_api, "_build_session", spy)
    return seen


def test_chat_resume_and_regenerate_build_the_session_with_the_requests_device(built) -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        s.inference = _Fake([[_text("The first take.")], [_text("The second take.")]])
        r = c.post("/api/agent/chat", json={"text": "hi", "stream": False}, headers={"X-Ctrlb-Device": OWN})
        assert r.status_code == 200, r.text
        thread_id = r.json()["threadId"]
        assert built == [OWN]
        rows = c.get(f"/api/threads/{thread_id}/messages").json()
        first = [m for m in rows if m["role"] == "assistant"][-1]
        assert first["device"] == OWN

        # a regenerate pressed on ANOTHER device: the new take is that device's (v4 residual 3)
        r = c.post(
            "/api/agent/regenerate",
            json={"thread_id": thread_id, "message_id": first["id"], "stream": False},
            headers={"X-Ctrlb-Device": OTHER},
        )
        assert r.status_code == 200, r.text
        assert built == [OWN, OTHER]
        rows = c.get(f"/api/threads/{thread_id}/messages").json()
        take = [m for m in rows if m["role"] == "assistant"][-1]
        assert take["parts"][0]["text"] == "The second take."
        assert take["device"] == OTHER

        # resume (a bogus call id bails before the model — only the build is asserted)
        r = c.post(
            "/api/agent/resume",
            json={"thread_id": thread_id, "call_id": "nope", "decision": "dismiss"},
            headers={"X-Ctrlb-Device": OWN},
        )
        assert r.status_code == 200, r.text
        assert built == [OWN, OTHER, OWN]

        # no header (an older client) → None
        r = c.post("/api/agent/chat", json={"text": "again", "thread_id": thread_id, "stream": False})
        assert r.status_code == 200, r.text
        assert built[-1] is None


# ── the steer: captured at enqueue; drain B builds with the COMMITTED head's device ─────────────
def test_a_steer_captures_the_sending_device_at_enqueue(monkeypatch) -> None:
    captured = []
    monkeypatch.setattr(
        agent_api, "_steer_202", lambda state, tid, live, entry, cfg: captured.append(entry) or {"queued": 1}
    )
    with _workspace(), _client() as c:
        s = c.app.state
        thread = _new_thread(s)
        from app.services.agent.turns import release, reserve

        h = reserve(s.turns, thread.id, "chat", ring_size=s.settings.agent.turns.ring_size)
        h.task = object()  # a live chat turn holds the thread → the POST steers
        try:
            c.post(
                "/api/agent/chat",
                json={"text": "and also", "thread_id": thread.id, "stream": False},
                headers={"X-Ctrlb-Device": OTHER},
            )
        finally:
            h.task = None
            release(s.turns, h)
        assert [e.device for e in captured] == [OTHER]


def test_drain_b_builds_the_seeded_turn_with_the_committed_heads_device(built) -> None:
    with _workspace(), _client() as c:
        s = c.app.state
        cfg = s.settings.agent.turns
        thread = _new_thread(s)
        s.inference = _Fake([[_text("ok")]])
        head = _msg_entry("steered")
        head.device = OTHER
        tail = _msg_entry("second")
        tail.device = OWN  # drains at the seeded turn's loop top — it does not decide the turn's device
        _enqueue(s, thread.id, head)
        _enqueue(s, thread.id, tail)

        _run_body_directly(s, thread, cfg)

        assert built == [OTHER]
        rows = run_async(s.messages.list(thread.id))
        assert [m.device for m in rows if m.role == "assistant"] == [OTHER]


def test_an_automation_run_builds_with_no_device() -> None:
    """The runner calls the one builder without a device; its replies belong to no device."""
    import inspect

    from app.services.automations import runner

    src = inspect.getsource(runner)
    call = src[src.index("session = _build_session(") :]
    call = call[: call.index(")\n") + 1]
    assert "device" not in call
