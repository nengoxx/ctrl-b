"""ACA Slice 7 / D43 Wave 2 — the SESSION/WIRE layer: typed `inference.retry`/`inference.failover`
AgentEvents, the post-hoc degraded-notice supersession, `collect_turn` buffered parity, and the
`retry_status` snapshot field for a re-attach mid-backoff.

Wave 1 (test_retry_failover_w1_slice7.py) proved the inference layer: `stream_chat` re-yields
`RetryNotice`/`FailoverNotice` control items before the first `ChatDelta`. Wave 2 upgrades the two
session consumers from SKIP → EMIT and adds the snapshot state. Units:
  A. the SESSION (`_drive`) emits `inference.retry` (exact payload) → `inference.failover` → streams,
     order pinned, with NO post-hoc degraded `notice` (deleted — no double-narration).
  B. `_finalize` (the second consumer) emits the same control events.
  C. `collect_turn` folds both kinds into `notices` text in the house `// …` voice (buffered parity).
  D. `retry_status`: present in the snapshot DURING a backoff window, absent after the first delta,
     absent (cleared) on a following notice and at turn end.

Run: `python tests/test_retry_failover_w2_slice7.py` from `backend/` (plain asserts + a __main__ runner)
or under pytest.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import AsyncIterator

from _async import run_async

# reuse the slice-6 session harness (temp workspace + real _build_session over a client app)
from test_modelref_wire_w4_slice6 import _client_app, _workspace

from app.adapters.inference import ChatDelta, FailoverNotice, RetryNotice
from app.domain.agent import ModelRef
from app.services.agent.session import AgentEvent, collect_turn
from app.services.agent.turns import TurnAccumulator


def _run(coro):
    return run_async(coro)


def _session(state, thread):
    """A real session via `_build_session` with the context-window probe stubbed to a huge value so
    pre-stream auto-compaction never fires (the tiny test thread stays under threshold) — the wire
    behaviour under test is isolated from compaction."""
    from app.api.agent import _build_session

    session = _build_session(state, thread)

    async def big_window(ep):
        return 10_000_000

    session._inference.effective_window = big_window  # type: ignore[assignment]
    return session


def _fake_stream(items, *, degraded: bool = False, served: str = ""):
    """A fake `stream_chat` yielding `items` (control items + ChatDeltas). `degraded` stamps the passed
    `StreamReport` as a fallback-rescued serve — to prove the DELETED post-hoc notice never re-narrates."""

    async def stream_chat(messages, *, report=None, max_tokens=None, reasoning_effort=None, **_kw):
        if report is not None and degraded:
            report.degraded = True
            report.served = served
        for it in items:
            yield it

    return stream_chat


async def _new_thread(state):
    from app.domain.conversation import Thread

    return await state.threads.create(Thread())


async def _aiter(evs) -> AsyncIterator[AgentEvent]:
    for e in evs:
        yield e


# ══ A. the SESSION emits the control events (order + exact payload) ═══════════════════════════════════


def test_session_emits_retry_then_failover_then_streams() -> None:
    """A flaky provider through `_drive`: two RetryNotices + one FailoverNotice interleaved before the
    text delta emit as `inference.retry` (exact payload) then `inference.failover`, in that order —
    and NO post-hoc degraded `notice` double-narrates the serve."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _new_thread(state)
            session = _session(state, thread)
            session._inference.stream_chat = _fake_stream(  # type: ignore[assignment]
                [
                    RetryNotice(
                        endpoint="local", attempt=1, max_attempts=2, delay_s=2.0, category="transient"
                    ),
                    RetryNotice(
                        endpoint="local", attempt=2, max_attempts=2, delay_s=4.0, category="transient"
                    ),
                    FailoverNotice(from_endpoint="local", to_endpoint="cloud", category="transient"),
                    ChatDelta(text="answer"),
                ],
                degraded=True,
                served="cloud",
            )

            events = [ev async for ev in session._drive(thread)]
            retry_i = [i for i, e in enumerate(events) if e.event == "inference.retry"]
            fail_i = [i for i, e in enumerate(events) if e.event == "inference.failover"]
            text_i = [i for i, e in enumerate(events) if e.event == "text.delta"]
            # order: every retry, then the failover, then the first streamed delta
            assert retry_i and fail_i and text_i
            assert max(retry_i) < fail_i[0] < text_i[0]
            retries = [events[i] for i in retry_i]
            assert retries[0].data == {
                "endpoint": "local",
                "attempt": 1,
                "max": 2,
                "delaySeconds": 2.0,
                "category": "transient",
            }
            assert retries[1].data == {
                "endpoint": "local",
                "attempt": 2,
                "max": 2,
                "delaySeconds": 4.0,
                "category": "transient",
            }
            assert events[fail_i[0]].data == {"from": "local", "to": "cloud", "category": "transient"}
            # B (deleted post-hoc notice): the degraded serve is narrated by the ONE typed failover event
            # only — no `notice` event re-narrates it (nothing double-narrates).
            assert len([e for e in events if e.event == "inference.failover"]) == 1
            assert not any(e.event == "notice" for e in events)
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "completed"

        _run(go())


def test_session_degraded_serve_no_double_narration_without_control_item() -> None:
    """Even a degraded serve that streams cleanly (no control item re-yielded to the session — the D18
    degraded flag alone) produces NO `notice`: the post-hoc block is gone. Live narration is the typed
    event's job; a stub that doesn't re-yield one simply says nothing (Invariant 5)."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _new_thread(state)
            session = _session(state, thread)
            session._inference.stream_chat = _fake_stream(  # type: ignore[assignment]
                [ChatDelta(text="hi")], degraded=True, served="cloud"
            )
            events = [ev async for ev in session._drive(thread)]
            assert not any(e.event == "notice" for e in events)
            assert next(e for e in events if e.event == "done").data["state"] == "completed"

        _run(go())


# ══ B. the second consumer: `_finalize` emits the events too ══════════════════════════════════════════


def test_finalize_emits_control_events() -> None:
    """`_finalize` (the forced wrap-up call) is the SECOND `stream_chat` consumer — it emits the same
    typed control events above its delta checks."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            thread = await _new_thread(state)
            session = _session(state, thread)
            session._inference.stream_chat = _fake_stream(  # type: ignore[assignment]
                [
                    RetryNotice(
                        endpoint="local", attempt=1, max_attempts=2, delay_s=2.0, category="transient"
                    ),
                    FailoverNotice(from_endpoint="local", to_endpoint="cloud", category="transient"),
                    ChatDelta(text="final answer"),
                ]
            )
            events = [ev async for ev in session._finalize(thread, "local", None, ModelRef())]
            kinds = [e.event for e in events]
            assert "inference.retry" in kinds and "inference.failover" in kinds
            r = next(e for e in events if e.event == "inference.retry")
            assert r.data == {
                "endpoint": "local",
                "attempt": 1,
                "max": 2,
                "delaySeconds": 2.0,
                "category": "transient",
            }
            fo = next(e for e in events if e.event == "inference.failover")
            assert fo.data == {"from": "local", "to": "cloud", "category": "transient"}
            # order: control events precede the text delta
            assert max(i for i, e in enumerate(events) if e.event == "inference.failover") < next(
                i for i, e in enumerate(events) if e.event == "text.delta"
            )
            assert next(e for e in events if e.event == "done").data["state"] == "completed"

        _run(go())


# ══ C. collect_turn buffered parity ══════════════════════════════════════════════════════════════════


def test_collect_turn_folds_retry_and_failover_as_notices() -> None:
    """Buffered mode (`collect_turn`) has no live surface, so both new kinds fold into `notices` text in
    the house `// …` voice (the D40 pattern)."""

    async def go() -> None:
        evs = [
            AgentEvent("message.start", {"messageId": "m1"}),
            AgentEvent(
                "inference.retry",
                {"endpoint": "local", "attempt": 1, "max": 2, "delaySeconds": 2.0, "category": "transient"},
            ),
            AgentEvent("inference.failover", {"from": "local", "to": "cloud", "category": "transient"}),
            AgentEvent("message.end", {"messageId": "m1"}),
            AgentEvent("done", {"threadId": "t", "state": "completed"}),
        ]
        out = await collect_turn(_aiter(evs))
        assert out["notices"] == [
            "// retrying local in 2s (attempt 1/2 — transient)",
            "// failover → cloud (transient)",
        ]
        assert out["state"] == "completed"

    _run(go())


# ══ D. the retry_status snapshot field ═══════════════════════════════════════════════════════════════


def test_retry_status_present_mid_backoff_absent_after_delta_and_at_end() -> None:
    """`retry_status` rides the snapshot ONLY while a same-endpoint backoff is in flight: an
    `inference.retry` sets `{endpoint, attempt, max, untilTs}` (untilTs ≈ now + delaySeconds); the NEXT
    event of any kind (a delta, another notice, the terminal) clears it — so a re-attach mid-backoff
    renders the retry line, never a dead spinner, and a no-retry turn's snapshot shape is unchanged."""
    acc = TurnAccumulator()
    acc.fold(AgentEvent("message.start", {"messageId": "m", "role": "assistant", "agent": "a"}))
    # no retry yet → the key is absent (stable no-retry snapshot shape)
    assert "retry_status" not in acc.snapshot(mode=None, seq=1)

    before = datetime.now(timezone.utc).timestamp()
    acc.fold(
        AgentEvent(
            "inference.retry",
            {"endpoint": "local", "attempt": 2, "max": 2, "delaySeconds": 3.0, "category": "transient"},
        )
    )
    snap = acc.snapshot(mode=None, seq=2)
    rs = snap["retry_status"]
    assert rs["endpoint"] == "local" and rs["attempt"] == 2 and rs["max"] == 2
    assert before + 3.0 <= rs["untilTs"] <= before + 3.0 + 5.0  # ~now + delay (generous slack)

    # the next delta clears it
    acc.fold(AgentEvent("text.delta", {"messageId": "m", "delta": "hi"}))
    assert acc.retry_status is None
    assert "retry_status" not in acc.snapshot(mode=None, seq=3)

    # set again, then ANOTHER notice (a failover) clears it too
    acc.fold(
        AgentEvent(
            "inference.retry",
            {"endpoint": "cloud", "attempt": 1, "max": 2, "delaySeconds": 1.0, "category": "transient"},
        )
    )
    assert acc.retry_status is not None
    acc.fold(AgentEvent("inference.failover", {"from": "cloud", "to": "local", "category": "transient"}))
    assert acc.retry_status is None

    # set again, then the terminal clears it (defensive at turn end)
    acc.fold(
        AgentEvent(
            "inference.retry",
            {"endpoint": "local", "attempt": 1, "max": 2, "delaySeconds": 1.0, "category": "transient"},
        )
    )
    assert acc.retry_status is not None
    acc.fold(AgentEvent("done", {"threadId": "t", "state": "completed"}))
    assert acc.retry_status is None


def test_retry_status_never_leaks_into_a_dispatched_snapshot_without_a_retry() -> None:
    """A full ordinary turn (no retry) never grows a `retry_status` key — the field defaults None and is
    only ever set by an `inference.retry`."""
    acc = TurnAccumulator()
    for ev in (
        AgentEvent("message.start", {"messageId": "m", "role": "assistant", "agent": "a"}),
        AgentEvent("text.delta", {"messageId": "m", "delta": "hello"}),
        AgentEvent("message.end", {"messageId": "m"}),
        AgentEvent("done", {"threadId": "t", "state": "completed"}),
    ):
        acc.fold(ev)
    assert acc.retry_status is None
    assert "retry_status" not in acc.snapshot(mode=None, seq=4)


if __name__ == "__main__":
    import os
    import tempfile
    from pathlib import Path

    os.environ.setdefault("CTRLB_CONFIG", str(Path(tempfile.gettempdir()) / "ctrlb_slice7_w2_test.yaml"))
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
