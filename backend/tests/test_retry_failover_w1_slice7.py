"""ACA Slice 7 / D43 Wave 1 — the failover async generator + the retryable classifier + the visible
transient-retry tier (the inference/failover layer only; no wire events reach the FE yet).

Units, each testable in isolation:
  A. `core.failover` as an async GENERATOR: control items live, the `FailoverResult` as the LAST item;
     the default policy yields no `HopRetry`; a retry policy yields `HopRetry`→…→`HopFailover`→result.
  B. `failover_collect`: drains the generator, discards control items, returns the result (byte-for-byte
     the old return-a-value shape — voice/embeddings/`complete()` parity).
  C. `categorize` (the classifier matrix) + `_parse_retry_after` (delta-seconds, HTTP-date, malformed).
  D. the retry tier over `stream_chat` (fake SDK): budget per endpoint honored (global/override/0),
     the backoff curve + Retry-After-wins + cap, next-hop after budget, RetryNotice/FailoverNotice
     interleaved before the first ChatDelta, retry only at initiation (no mid-stream retry).
  E. the permit is FREE during a backoff (a second limit-1 request proceeds) + a cancel during the
     backoff cleans up with nothing open (asyncio.wait_for pattern).
  F. `streamed_any` honesty: a control item before the first delta leaves the D42 backstop able to fire.

Run: `python tests/test_retry_failover_w1_slice7.py` from `backend/` (plain asserts + a __main__ runner)
or under pytest.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from types import SimpleNamespace

import pytest
from _async import run_async
from _reg import registry, target

# import the D42 backstop harness verbatim (F: prove the control item leaves streamed_any honest)
from test_modelref_wire_w4_slice6 import (
    _OVERFLOW,
    _backstop_session,
    _client_app,
    _seed,
    _workspace,
)

from app.adapters.inference import (
    ChatDelta,
    FailoverNotice,
    InferenceClient,
    InferenceError,
    RetryNotice,
    _parse_retry_after,
    _retry_delay,
    categorize,
)
from app.config import InferenceCfg, ModelCfg, ProviderCfg, Settings
from app.core.failover import (
    NEXT_HOP,
    RETRY_AFTER,
    FailoverError,
    FailoverResult,
    HopFailover,
    HopRetry,
    failover,
    failover_collect,
)
from app.core.provider_registry import resolve_lenient


def _run(coro):
    return run_async(coro)


# ══ A. the failover async generator ════════════════════════════════════════════════════════════════


def test_generator_default_policy_yields_result_last_no_retries() -> None:
    """Default policy = always next-hop: a → fail, b → ok yields ONE HopFailover then the FailoverResult
    as the final item; never a HopRetry."""

    async def attempt(ep):
        if ep == "a":
            raise RuntimeError("a down")
        return f"ok:{ep}"

    async def go():
        items = [x async for x in failover(["a", "b"], attempt)]
        assert isinstance(items[-1], FailoverResult)  # the result is the LAST item
        assert items[-1].value == "ok:b" and items[-1].served_index == 1
        assert [type(x).__name__ for x in items[:-1]] == ["HopFailover"]
        assert not any(isinstance(x, HopRetry) for x in items)

    _run(go())


def test_generator_retry_policy_emits_retries_then_failover_then_result() -> None:
    """A policy asking for 2 retries on a failing hop: HopRetry(1/2), HopRetry(2/2), HopFailover(0→1),
    then the FailoverResult from b — in that order, result last."""
    seen: dict[str, int] = {"a": 0}

    async def attempt(ep):
        if ep == "a":
            seen["a"] += 1
            raise RuntimeError("a busy")
        return f"ok:{ep}"

    def policy(_exc, done):
        return RETRY_AFTER(0.0, 2) if done < 2 else NEXT_HOP  # 0s backoff → instant

    async def go():
        items = [x async for x in failover(["a", "b"], attempt, policy=policy)]
        retries = [x for x in items if isinstance(x, HopRetry)]
        assert [(r.index, r.attempt, r.max_attempts) for r in retries] == [(0, 1, 2), (0, 2, 2)]
        assert isinstance(items[-3], HopRetry) and isinstance(items[-2], HopFailover)
        assert isinstance(items[-1], FailoverResult) and items[-1].value == "ok:b"
        assert seen["a"] == 3  # 1 initial + 2 retries on the SAME hop

    _run(go())


def test_generator_all_fail_raises_failovererror() -> None:
    async def attempt(ep):
        raise ValueError(f"down:{ep}")

    async def go():
        try:
            _ = [x async for x in failover(["a", "b"], attempt)]
            raise AssertionError("expected FailoverError")
        except FailoverError as exc:
            assert len(exc.failures) == 2

    _run(go())


# ══ B. failover_collect byte-compat ══════════════════════════════════════════════════════════════════


def test_failover_collect_returns_result_discards_control_items() -> None:
    async def attempt(ep):
        if ep == "a":
            raise RuntimeError("boom")
        return f"ok:{ep}"

    async def go():
        res = await failover_collect(["a", "b"], attempt, label=str)
        assert res.value == "ok:b" and res.served_index == 1
        assert res.degraded is True and len(res.failures) == 1 and "boom" in res.failures[0]

    _run(go())


def test_failover_collect_empty_chain_raises() -> None:
    async def attempt(ep):  # pragma: no cover — never called
        return ep

    async def go():
        try:
            await failover_collect([], attempt)
            raise AssertionError("expected FailoverError")
        except FailoverError as exc:
            assert exc.failures == []

    _run(go())


# ══ C. the classifier + retry_after parsing ══════════════════════════════════════════════════════════


def _err(*, status=None, code=None, retry_after=None, msg="boom") -> InferenceError:
    return InferenceError(msg, code=code, status=status, retry_after=retry_after)


def test_categorize_transient() -> None:
    assert categorize(_err(status=429)) == "transient"
    assert categorize(_err(status=503)) == "transient"
    assert categorize(_err(retry_after=5.0, status=500)) == "transient"  # Retry-After present wins
    # llama.cpp busy shapes (build-verified): 503 by status, or flattened by the body markers
    assert categorize(_err(status=503, msg="no slot available")) == "transient"
    flat = _err(msg="all endpoints failed: local: Error code: 503 - Loading model (unavailable_error)")
    assert categorize(flat) == "transient"


def test_categorize_fatal_for_endpoint() -> None:
    assert categorize(_err(status=401)) == "fatal_for_endpoint"
    assert categorize(_err(status=403)) == "fatal_for_endpoint"
    assert categorize(_err(status=404, msg="The model 'x' does not exist")) == "fatal_for_endpoint"
    assert categorize(_err(code="insufficient_quota", status=429)) == "transient"  # 429 wins (busy-then)
    assert categorize(_err(code="model_not_found")) == "fatal_for_endpoint"
    assert categorize(_err(msg="Error code: 401 - invalid api key")) == "fatal_for_endpoint"
    # R3: a fatal status/code OUTRANKS a Retry-After header — an auth error carrying Retry-After must
    # hop to different credentials, never retry in place.
    assert categorize(_err(status=401, retry_after=5.0)) == "fatal_for_endpoint"
    assert categorize(_err(code="insufficient_quota", retry_after=5.0)) == "fatal_for_endpoint"


def test_categorize_other_and_overflow() -> None:
    assert categorize(_err(status=500)) == "other"
    assert categorize(RuntimeError("connection refused")) == "other"
    assert categorize(RuntimeError("read operation timed out")) == "other"
    # overflow delegates to is_context_overflow (a 400 + the code / the llama.cpp message)
    assert categorize(_err(status=400, code="context_length_exceeded")) == "overflow"
    assert categorize(_err(status=400, msg="the request exceeds the available context size")) == "overflow"


def test_parse_retry_after_delta_seconds() -> None:
    exc = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "12"}))
    assert _parse_retry_after(exc) == 12.0
    neg = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "-3"}))
    assert _parse_retry_after(neg) is None  # malformed/negative → None


def test_parse_retry_after_http_date() -> None:
    when = datetime.now(timezone.utc) + timedelta(seconds=60)
    exc = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": format_datetime(when)}))
    got = _parse_retry_after(exc)
    assert got is not None and 50 <= got <= 61  # ~60s from now (a little clock slack)
    past = datetime.now(timezone.utc) - timedelta(seconds=30)
    exc2 = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": format_datetime(past)}))
    assert _parse_retry_after(exc2) == 0.0  # a past date floors at 0


def test_parse_retry_after_malformed_and_absent() -> None:
    bad = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "soon-ish"}))
    assert _parse_retry_after(bad) is None
    assert _parse_retry_after(RuntimeError("no response attr")) is None  # non-HTTP → None
    empty = SimpleNamespace(response=SimpleNamespace(headers={}))
    assert _parse_retry_after(empty) is None


def test_retry_delay_curve_and_cap() -> None:
    assert _retry_delay(0, None) == 2.0  # base
    assert _retry_delay(1, None) == 4.0  # base × 2
    assert _retry_delay(2, None) == 8.0
    assert _retry_delay(5, None) == 30.0  # base × 2^5 = 64 → capped at 30
    assert _retry_delay(0, 10.0) == 10.0  # a larger Retry-After wins the curve
    assert _retry_delay(0, 100.0) == 30.0  # …but never past the cap


def test_resolve_retry_attempts_global_override_disable() -> None:
    """A11: the per-hop budget is resolved onto ResolvedTarget.retry_attempts (provider override > global)."""

    def _build_reg(retry):
        s = Settings(
            providers={
                "a": ProviderCfg(base_url="http://a/v1", retry_attempts=retry, models={"m": ModelCfg()})
            },
            inference=InferenceCfg(provider="a", retry_attempts=2),
        )
        reg, _ = resolve_lenient(s)
        return reg.inference_chain[0].retry_attempts

    assert _build_reg(None) == 2  # None inherits the global
    assert _build_reg(5) == 5  # override wins
    assert _build_reg(0) == 0  # 0 disables


# ══ D. the retry tier over stream_chat (fake SDK) ════════════════════════════════════════════════════


class _Delta:
    def __init__(self, content=""):
        self.content = content
        self.reasoning_content = None
        self.tool_calls = []
        self.model_extra = None


class _Chunk:
    def __init__(self, delta):
        self.choices = [type("Ch", (), {"delta": delta})()]


class _Stream:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._chunks:
            return self._chunks.pop(0)
        raise StopAsyncIteration

    async def close(self):
        pass


class _Completions:
    def __init__(self, behavior):
        self._behavior = behavior
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._behavior(kwargs)


class _Client:
    def __init__(self, behavior):
        self.chat = type("Chat", (), {"completions": _Completions(behavior)})()


def _build(reg, behaviors: dict[str, object], gates=None):
    client = InferenceClient(reg, gates=gates)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _ok_stream(*texts):
    return lambda _kw: _Stream([_Chunk(_Delta(t)) for t in texts])


def _busy(_kw):
    raise InferenceError("no slot available", status=503)  # a transient (retry-worthy) init failure


async def _collect(client, **kw):
    return [d async for d in client.stream_chat([{"role": "user", "content": "hi"}], **kw)]


def _text(items) -> str:
    return "".join(d.text for d in items if isinstance(d, ChatDelta))


def _cfg(*, failover=True, local=None, cloud=None):
    local = local if local is not None else target("local", "http://local/v1", "minig")
    cloud = cloud if cloud is not None else target("cloud", "http://cloud/v1", "gemma")
    return registry([local, cloud], failover=failover)


def _instant_backoff(monkeypatch) -> None:
    """Shrink the backoff curve so the retry LOOP runs without real waiting (the curve math is pinned
    separately in `test_retry_delay_curve_and_cap`)."""
    monkeypatch.setattr("app.adapters.inference._RETRY_BASE_DELAY_S", 0.001)
    monkeypatch.setattr("app.adapters.inference._RETRY_DELAY_CAP_S", 0.01)


def test_transient_retries_same_endpoint_then_hops(monkeypatch) -> None:
    """local 503s forever with the default budget (2): 3 create calls on local (1 + 2 retries), TWO
    RetryNotices + ONE FailoverNotice interleaved before the first ChatDelta, then cloud answers."""
    _instant_backoff(monkeypatch)
    client, fakes = _build(_cfg(), {"http://local/v1": _busy, "http://cloud/v1": _ok_stream("cloud")})
    items = _run(_collect(client))
    assert len(fakes["http://local/v1"].chat.completions.calls) == 3  # init + 2 retries, SAME endpoint
    assert len(fakes["http://cloud/v1"].chat.completions.calls) == 1
    retries = [x for x in items if isinstance(x, RetryNotice)]
    failovers = [x for x in items if isinstance(x, FailoverNotice)]
    assert [(r.endpoint, r.attempt, r.max_attempts, r.category) for r in retries] == [
        ("local", 1, 2, "transient"),
        ("local", 2, 2, "transient"),
    ]
    assert [(f.from_endpoint, f.to_endpoint) for f in failovers] == [("local", "cloud")]
    # every control item precedes the first ChatDelta
    first_delta = next(i for i, x in enumerate(items) if isinstance(x, ChatDelta))
    assert all(not isinstance(x, ChatDelta) for x in items[:first_delta])
    assert _text(items) == "cloud"


def test_per_endpoint_override_and_zero_disables(monkeypatch) -> None:
    _instant_backoff(monkeypatch)
    # override=1 → exactly ONE retry on local before the hop
    cfg1 = _cfg(local=target("local", "http://local/v1", "m", retry_attempts=1))
    c1, f1 = _build(cfg1, {"http://local/v1": _busy, "http://cloud/v1": _ok_stream("x")})
    items1 = _run(_collect(c1))
    assert len(f1["http://local/v1"].chat.completions.calls) == 2  # init + 1 retry
    assert len([x for x in items1 if isinstance(x, RetryNotice)]) == 1

    # override=0 → NO retry, straight next-hop (today's behaviour for this endpoint)
    cfg0 = _cfg(local=target("local", "http://local/v1", "m", retry_attempts=0))
    c0, f0 = _build(cfg0, {"http://local/v1": _busy, "http://cloud/v1": _ok_stream("x")})
    items0 = _run(_collect(c0))
    assert len(f0["http://local/v1"].chat.completions.calls) == 1  # init only, no retry
    assert not any(isinstance(x, RetryNotice) for x in items0)


def test_fatal_and_other_do_not_retry(monkeypatch) -> None:
    """A fatal_for_endpoint (401) and an `other` (connection) both hop immediately — no RetryNotice."""
    _instant_backoff(monkeypatch)

    def _auth(_kw):
        raise InferenceError("bad key", status=401)

    c, f = _build(_cfg(), {"http://local/v1": _auth, "http://cloud/v1": _ok_stream("y")})
    items = _run(_collect(c))
    assert len(f["http://local/v1"].chat.completions.calls) == 1  # no retry on a fatal error
    assert not any(isinstance(x, RetryNotice) for x in items)
    assert any(isinstance(x, FailoverNotice) for x in items) and _text(items) == "y"


def test_retry_after_header_floors_the_backoff(monkeypatch) -> None:
    """A 503 carrying Retry-After LARGER than the curve makes the retry wait that long (the value rides
    into the delay). We capture the sleep instead of waiting, and assert the delay came from the header."""
    slept: list[float] = []

    async def _fake_sleep(d):
        slept.append(d)

    monkeypatch.setattr("app.core.failover.asyncio.sleep", _fake_sleep)

    def _busy_retry_after(_kw):
        raise InferenceError("slow down", status=503, retry_after=9.0)  # header floor 9s > curve 2s

    cfg = _cfg(local=target("local", "http://local/v1", "m", retry_attempts=1))
    c, _f = _build(cfg, {"http://local/v1": _busy_retry_after, "http://cloud/v1": _ok_stream("z")})
    _run(_collect(c))
    assert slept == [9.0]  # the one retry slept the Retry-After value, not the 2s curve


def test_no_retry_after_first_streamed_token(monkeypatch) -> None:
    """Retry is INITIATION-only: a mid-stream drop (after the first chunk committed) raises with NO
    retry and NO failover — the single endpoint is called exactly once."""
    _instant_backoff(monkeypatch)

    class _RaisingStream(_Stream):
        async def __anext__(self):
            if self._chunks:
                return self._chunks.pop(0)
            raise RuntimeError("mid-stream drop")

    def behavior(_kw):
        return _RaisingStream([_Chunk(_Delta("partial"))])

    client, fakes = _build(_cfg(failover=False), {"http://local/v1": behavior})
    raised = False
    try:
        _run(_collect(client))
    except InferenceError:
        raised = True
    assert raised
    assert len(fakes["http://local/v1"].chat.completions.calls) == 1  # no re-attempt mid-stream


# ══ E. permit-free backoff + cancel-during-backoff ═══════════════════════════════════════════════════


def _slot_cfg():
    """A SINGLE local endpoint, limit 1, failover off — so a retry re-attempts the SAME slot and the
    backoff's permit behaviour is observable in isolation."""
    return registry(
        [target("local", "http://local/v1", "m", max_concurrent_requests=1, retry_attempts=1)],
        failover=False,
    )


def test_permit_is_free_during_backoff(monkeypatch) -> None:
    """A limit-1 endpoint: request 1 fails transiently and enters a backoff; a SECOND request must be
    able to acquire the slot DURING that backoff (the failed attempt released its permit; the sleep
    holds none). If the permit leaked into the backoff, request 2 would block until request 1 finished."""
    monkeypatch.setattr("app.adapters.inference._RETRY_BASE_DELAY_S", 0.4)  # a real, observable backoff

    state = {"n": 0}

    def behavior(_kw):
        state["n"] += 1
        if state["n"] == 1:
            raise InferenceError("no slot available", status=503)  # request-1's failing init
        return _Stream([_Chunk(_Delta("ok"))])  # every later create succeeds

    client, _f = _build(_slot_cfg(), {"http://local/v1": behavior})

    async def go():
        t1 = asyncio.create_task(_collect(client))
        await asyncio.sleep(0.05)  # t1 failed once → now in its ~0.4s backoff, permit released
        assert state["n"] == 1 and not t1.done()
        # t2 must complete DURING t1's backoff (timeout < the 0.4s backoff) — proves the slot is free
        r2 = await asyncio.wait_for(_collect(client), timeout=0.25)
        assert _text(r2) == "ok"
        assert not t1.done()  # t1 is still sleeping in its backoff (concurrency, not serialization)
        r1 = await asyncio.wait_for(t1, timeout=2.0)
        assert _text(r1) == "ok"  # t1 wakes, re-attempts the slot, succeeds

    _run(go())


def test_cancel_during_backoff_cleans_up(monkeypatch) -> None:
    """A cancel landing during the backoff sleep propagates with NOTHING open (no stream, no permit):
    a fresh request on the same limit-1 endpoint proceeds afterward — a leaked permit would deadlock it."""
    monkeypatch.setattr(
        "app.adapters.inference._RETRY_BASE_DELAY_S", 30.0
    )  # long backoff → cancel lands in it

    state = {"n": 0}

    def behavior(_kw):
        state["n"] += 1
        if state["n"] == 1:
            raise InferenceError("no slot available", status=503)
        return _Stream([_Chunk(_Delta("ok"))])

    client, _f = _build(_slot_cfg(), {"http://local/v1": behavior})

    async def go():
        t = asyncio.create_task(_collect(client))
        await asyncio.sleep(0.05)  # t failed once → parked in the long backoff
        assert state["n"] == 1
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t
        # nothing was held across the backoff → a new request acquires the single slot at once
        out = await asyncio.wait_for(_collect(client), timeout=2.0)
        assert _text(out) == "ok"

    _run(go())


# ══ F. streamed_any honesty (session scope-D) ════════════════════════════════════════════════════════


def _scripted_with_notices(overflow_calls: int, then_text: str = "recovered"):
    """A fake `stream_chat` that yields a RetryNotice + FailoverNotice (control items BEFORE any delta),
    then overflows for the first `overflow_calls` calls, then streams `then_text`."""
    calls = {"n": 0}

    async def stream_chat(messages, *, max_tokens=None, reasoning_effort=None, **_kw):
        n = calls["n"]
        calls["n"] += 1
        if n < overflow_calls:
            yield RetryNotice(endpoint="local", attempt=1, max_attempts=2, delay_s=2.0, category="transient")
            yield FailoverNotice(from_endpoint="local", to_endpoint="cloud", category="transient")
            raise _OVERFLOW
        yield ChatDelta(text=then_text)

    return stream_chat, calls


def test_control_item_before_first_delta_keeps_backstop_honest() -> None:
    """D42 backstop pin under D43: a control item emitted BEFORE the first delta must NOT flip
    `streamed_any` — so an overflow with nothing-actually-streamed still gets the one forced fold +
    same-slot re-stream (if the skip touched `streamed_any`, the backstop would be suppressed → error)."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed(state, thread)
            session = _backstop_session(state, thread)
            stream_chat, calls = _scripted_with_notices(overflow_calls=1, then_text="recovered")
            session._inference.stream_chat = stream_chat  # type: ignore[assignment]

            events = [ev async for ev in session._drive(thread)]
            kinds = [e.event for e in events]
            assert kinds.count("compaction") == 1  # the backstop DID fire (streamed_any stayed False)
            assert calls["n"] == 2  # first overflowed after the notices, second recovered
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "completed"
            live = await state.messages.list(thread.id, include_compacted=False)
            recovered = [m for m in live if m.role == "assistant" and m.text() == "recovered"]
            assert len(recovered) == 1

        _run(go())


if __name__ == "__main__":
    import os
    import tempfile
    from pathlib import Path

    os.environ.setdefault("CTRLB_CONFIG", str(Path(tempfile.gettempdir()) / "ctrlb_slice7_test.yaml"))
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()  # the monkeypatch-taking tests only run under pytest; skip them here
            except TypeError as exc:
                if "monkeypatch" in str(exc):
                    print(f"skip {name} (needs pytest monkeypatch)")
                    continue
                raise
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed (monkeypatch tests run under pytest)")
