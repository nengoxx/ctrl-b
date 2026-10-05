"""D83 Slice A — fail fast on an unreachable LLM backend: the split connect timeout + the causal
`unreachable` tier.

  A. the SDK client is handed `httpx.Timeout(request_timeout_s, connect=connect_timeout_s)` (a bare float
     set all four phases to the 600 s read window); the knob validates and rides `SectionPolicy`.
  B. classification is CAUSAL (R5/R16): only an `httpx.ConnectError`/`ConnectTimeout` in the explicit
     `__cause__` chain is `unreachable`; read/pool timeouts, a `__context__`-only connect error and a
     cancellation never are.
  C. end to end through the REAL SDK + httpx/httpcore stack with the socket layer patched (R4 — never the
     network): `anyio.connect_tcp` hangs (the connect budget fires) or refuses → `unreachable` → the chain
     hops straight to the fallback, in both `stream_chat` initiation and the buffered `complete`, with no
     same-endpoint retry and a message that names the budget.

Run under pytest from `backend/`.
"""

from __future__ import annotations

import asyncio

import anyio
import httpx
import openai
import pytest
from _async import run_async
from _reg import registry, target
from pydantic import ValidationError
from test_inference_failover_d18 import _Chunk, _Client, _Delta, _Resp, _Stream

from app.adapters.inference import (
    ChatDelta,
    FailoverNotice,
    InferenceClient,
    InferenceError,
    RetryNotice,
    StreamReport,
    _as_inference_error,
    categorize,
)
from app.config import InferenceCfg, ModelCfg, ProviderCfg, Settings
from app.core.provider_registry import resolve_lenient

_REQ = httpx.Request("POST", "http://dead.invalid/v1/chat/completions")


def _raised_from(outer: BaseException, cause: BaseException) -> BaseException:
    """`outer` raised `from cause` — the exact shape the SDK builds (`APITimeoutError(...) from err`)."""
    try:
        try:
            raise cause
        except BaseException as inner:
            raise outer from inner
    except BaseException as exc:  # noqa: BLE001 — capturing the chained exception is the point
        return exc


# ══ A. the split timeout + the config knob ══════════════════════════════════════════════════════════


def test_sdk_client_gets_the_split_timeout() -> None:
    """The cached SDK client carries a SPLIT timeout: the generous read window + the connect budget."""
    reg = registry([target("local", "http://local/v1", "m")], request_timeout_s=600.0, connect_timeout_s=2.5)
    client = InferenceClient(reg)
    sdk = client._client(reg.inference_chain[0])
    try:
        assert isinstance(sdk.timeout, httpx.Timeout)
        assert sdk.timeout == httpx.Timeout(600.0, connect=2.5)
        assert sdk.timeout.read == 600.0 and sdk.timeout.connect == 2.5
    finally:
        run_async(client._close_clients())


def test_connect_timeout_config_default_validation_and_policy() -> None:
    """5 s default; floored >0 and finite (a blanked field / YAML `.inf` must 422, never wedge or park);
    the resolver copies it onto the frozen `SectionPolicy` beside `request_timeout_s`."""
    assert InferenceCfg().connect_timeout_s == 5.0
    for bad in (0, -1, float("inf"), float("nan")):
        with pytest.raises(ValidationError):
            InferenceCfg(connect_timeout_s=bad)
    s = Settings(
        providers={"a": ProviderCfg(base_url="http://a/v1", models={"m": ModelCfg()})},
        inference=InferenceCfg(provider="a", connect_timeout_s=1.5, request_timeout_s=300),
    )
    reg, _ = resolve_lenient(s)
    assert reg.inference_policy.connect_timeout_s == 1.5
    assert reg.inference_policy.request_timeout_s == 300


# ══ B. causal classification ════════════════════════════════════════════════════════════════════════


def test_connect_timeout_cause_is_unreachable_and_names_the_budget() -> None:
    exc = _raised_from(openai.APITimeoutError(request=_REQ), httpx.ConnectTimeout("timed out"))
    err = _as_inference_error(exc, connect_timeout_s=5.0)
    assert err is not None and err.unreachable is True
    assert str(err) == "no connection within 5s"
    assert categorize(err) == "unreachable"


def test_connect_error_cause_is_unreachable_and_keeps_the_os_text() -> None:
    exc = _raised_from(
        openai.APIConnectionError(request=_REQ), httpx.ConnectError("[Errno 111] Connection refused")
    )
    err = _as_inference_error(exc, connect_timeout_s=5.0)
    assert err is not None and err.unreachable is True
    assert "Connection refused" in str(err)
    assert categorize(err) == "unreachable"


@pytest.mark.parametrize(
    "cause",
    [httpx.ReadTimeout("timed out"), httpx.PoolTimeout("timed out"), httpx.WriteTimeout("timed out")],
)
def test_read_pool_write_timeouts_are_not_unreachable(cause: BaseException) -> None:
    """The SDK wraps EVERY httpx timeout in `APITimeoutError` — only the connect phase means "down"."""
    err = _as_inference_error(
        _raised_from(openai.APITimeoutError(request=_REQ), cause), connect_timeout_s=5.0
    )
    assert err is not None and err.unreachable is False
    assert categorize(err) == "other"


def test_a_dropped_pooled_socket_is_not_unreachable() -> None:
    """A stale keep-alive socket fails on read/write (`ReadError`/`RemoteProtocolError`) — a server that WAS
    reachable; it hops as `other` and never marks (the next call's fresh connect decides)."""
    for cause in (httpx.ReadError("reset"), httpx.RemoteProtocolError("closed")):
        err = _as_inference_error(_raised_from(openai.APIConnectionError(request=_REQ), cause))
        assert err is not None and err.unreachable is False
        assert categorize(err) == "other"


def test_context_only_connect_error_is_not_unreachable() -> None:
    """R16: only `__cause__` counts — an unrelated error raised while HANDLING a connect error (implicit
    `__context__`) is not "the server is down"."""
    try:
        try:
            raise httpx.ConnectError("refused")
        except httpx.ConnectError:
            raise RuntimeError("bug in a handler")  # noqa: B904 — the implicit context IS the case
    except RuntimeError as exc:
        caught = exc
    assert caught.__context__ is not None and caught.__cause__ is None
    err = _as_inference_error(caught)
    assert err is not None and err.unreachable is False


def test_cancellation_and_existing_inference_errors_pass_through() -> None:
    assert _as_inference_error(asyncio.CancelledError()) is None
    assert _as_inference_error(InferenceError("x", unreachable=True)) is None


def test_a_status_error_still_classifies_by_status() -> None:
    """The new tier never shadows the structured ones: a 503 stays transient."""
    assert categorize(InferenceError("busy", status=503)) == "transient"
    assert categorize(InferenceError("Connection error.")) == "other"  # no field ⇒ no tier from text


# ══ C. end to end through the real SDK stack, socket layer patched ═════════════════════════════════


async def _hang(*_a, **_k):
    await anyio.sleep(3600)  # a host that never answers the SYN — only the connect budget ends this


async def _refuse(*_a, **_k):
    raise OSError(111, "Connection refused")


def _chain_with_real_primary(connect_timeout_s: float):
    """`dead` uses the REAL `AsyncOpenAI` (real httpx/httpcore, socket connect patched by the test);
    `alive` is the fake SDK. `retry_attempts=2` on the dead hop proves an unreachable never retries."""
    reg = registry(
        [
            target("dead", "http://dead.invalid:5001/v1", "m", retry_attempts=2),
            target("alive", "http://alive/v1", "m"),
        ],
        connect_timeout_s=connect_timeout_s,
    )
    client = InferenceClient(reg)
    real = client._client
    fake = _Client(
        lambda kw: _Stream([_Chunk(_Delta(content="ok"))]) if kw.get("stream") else _Resp("buffered ok")
    )
    client._client = lambda ep: real(ep) if ep.provider == "dead" else fake  # type: ignore[assignment]
    return client


@pytest.mark.parametrize(("connect", "expect"), [(_hang, "no connection within 0.05s"), (_refuse, "refused")])
def test_stream_chat_hops_an_unreachable_primary(monkeypatch, connect, expect) -> None:
    monkeypatch.setattr(anyio, "connect_tcp", connect)
    client = _chain_with_real_primary(0.05)
    report = StreamReport()

    async def go():
        try:
            return await asyncio.wait_for(
                _drain(client.stream_chat([{"role": "user", "content": "hi"}], report=report)), 10
            )
        finally:
            await client._close_clients()

    items = run_async(go())
    assert "".join(d.text for d in items if isinstance(d, ChatDelta)) == "ok"
    notices = [i for i in items if isinstance(i, FailoverNotice)]
    assert notices == [FailoverNotice(from_endpoint="dead", to_endpoint="alive", category="unreachable")]
    assert not any(isinstance(i, RetryNotice) for i in items)  # unreachable is NEXT_HOP, never retry-same
    assert report.served == "alive" and report.degraded is True
    assert len(report.failures) == 1 and expect in report.failures[0].lower()


@pytest.mark.parametrize(("connect", "expect"), [(_hang, "no connection within 0.05s"), (_refuse, "refused")])
def test_complete_hops_an_unreachable_primary(monkeypatch, connect, expect) -> None:
    monkeypatch.setattr(anyio, "connect_tcp", connect)
    client = _chain_with_real_primary(0.05)
    report = StreamReport()

    async def go():
        try:
            return await asyncio.wait_for(
                client.complete([{"role": "user", "content": "hi"}], report=report), 10
            )
        finally:
            await client._close_clients()

    assert run_async(go()) == "buffered ok"
    assert report.served == "alive" and report.degraded is True
    assert len(report.failures) == 1 and expect in report.failures[0].lower()


def test_a_lone_unreachable_endpoint_raises_fast_with_the_reason(monkeypatch) -> None:
    """A single-entry chain whose server never answers fails in ~the connect budget, not the read window."""
    monkeypatch.setattr(anyio, "connect_tcp", _hang)
    reg = registry([target("dead", "http://dead.invalid:5001/v1", "m")], connect_timeout_s=0.05)
    client = InferenceClient(reg)

    async def go():
        try:
            await asyncio.wait_for(client.complete([{"role": "user", "content": "hi"}]), 10)
        finally:
            await client._close_clients()

    with pytest.raises(InferenceError) as info:
        run_async(go())
    assert "no connection within 0.05s" in str(info.value)
    assert info.value.endpoints_tried == 1


async def _drain(gen):
    return [x async for x in gen]
