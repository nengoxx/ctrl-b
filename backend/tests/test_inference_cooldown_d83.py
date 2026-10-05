"""D83 Slice B — the cross-turn connect cooldown (`EndpointHealth`): an unreachable server is DEMOTED behind
the healthy chain entries for `inference.connect_cooldown_s`, never skipped; any success clears it.

Every test drives `InferenceClient` over fake SDK clients (no network, R4) with an INJECTED monotonic clock:
  A. SET only from `InferenceError.unreachable` (a 503 / plain error never marks); WARNING on the
     healthy→marked transition only, INFO on the clear; `0` = off (no mark, no demotion).
  B. the demotion: a marked primary is walked LAST (stable partition of the exact `chain_for` objects), the
     demoted call narrates nothing, expiry re-tries it first, a success clears it — on BOTH `stream_chat` and
     `complete`, with or without a `StreamReport`.
  C. attribution: a demoted serve is `degraded` with `primary` = the CONFIGURED head; `degraded` compares by
     OBJECT identity (a duplicate-provider chain); a demoted primary that serves at the tail is NOT degraded.
  D. shape: 1-entry chain untouched; an agent `ModelRef.model` override stays on its own entry; iteration-1
     pricing (`target_for`) + the summarizer guard (`effective_window_for`) read the demotion-aware head while
     `min_chain_window` stays order-free; the ledger is app-owned and survives a client rebuild.

Run under pytest from `backend/`.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

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
)
from app.config import InferenceCfg, ModelCfg, ProviderCfg, SectionRef, Settings
from app.core.provider_registry import EndpointGates, EndpointHealth, resolve_lenient

_REQ = httpx.Request("POST", "http://x/v1/chat/completions")
_MSGS = [{"role": "user", "content": "hi"}]


class _Clock:
    """An injectable monotonic clock the test advances by hand."""

    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def _unreachable(_kw):
    """The exact shape the SDK raises for a refused connect: `APIConnectionError(...) from httpx.ConnectError`."""
    try:
        raise httpx.ConnectError("[Errno 111] Connection refused")
    except httpx.ConnectError as exc:
        raise openai.APIConnectionError(request=_REQ) from exc


def _busy(_kw):
    raise InferenceError("busy", status=503)  # alive-but-busy: never a mark


def _boom(_kw):
    raise RuntimeError("boom")  # a plain failure (5xx-ish / bad response): never a mark


def _ok(text: str):
    return lambda kw: _Stream([_Chunk(_Delta(content=text))]) if kw.get("stream") else _Resp(text)


class _Switch:
    """A per-endpoint behaviour the test can flip between calls (the server comes back)."""

    def __init__(self, fn: Callable[[dict], Any]) -> None:
        self.fn = fn

    def __call__(self, kw):
        return self.fn(kw)


def _build(
    reg, behaviors: dict[str, object], *, clock: _Clock | None = None, health: EndpointHealth | None = None
):
    clock = clock or _Clock()
    health = health if health is not None else EndpointHealth(clock=clock)
    client = InferenceClient(reg, health=health)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes, clock, health


def _calls(fake) -> int:
    return len(fake.chat.completions.calls)


def _stream(client, **kw):
    async def go():
        return [x async for x in client.stream_chat(_MSGS, **kw)]

    return run_async(go())


def _text(items) -> str:
    return "".join(d.text for d in items if isinstance(d, ChatDelta))


def _pair(cooldown: float = 60.0, **dead_kw):
    """`corsair` (primary) + `strata` (fallback) on distinct servers."""
    return registry(
        [
            target("corsair", "http://corsair:5001/v1", "qwen", **dead_kw),
            target("strata", "http://corsair:18081/v1", "x"),
        ],
        connect_cooldown_s=cooldown,
    )


GID_CORSAIR = "http://corsair:5001/v1"


# ══ A. set / log / off ══════════════════════════════════════════════════════════════════════════════


def test_an_unreachable_hop_marks_its_server_and_warns_once_per_window(caplog) -> None:
    client, fakes, clock, health = _build(
        _pair(), {"http://corsair:5001/v1": _unreachable, "http://corsair:18081/v1": _ok("from strata")}
    )
    with caplog.at_level(logging.WARNING, logger="ctrlb.inference"):
        items = _stream(client)
    assert _text(items) == "from strata"
    # the SETTING call narrates through the real FailoverNotice, tier `unreachable`
    assert [i for i in items if isinstance(i, FailoverNotice)] == [
        FailoverNotice(from_endpoint="corsair", to_endpoint="strata", category="unreachable")
    ]
    assert health.demoted(GID_CORSAIR)
    warns = [r for r in caplog.records if "unreachable" in r.getMessage() and r.levelno == logging.WARNING]
    assert len(warns) == 1
    # past expiry routing considers it healthy again: the primary is retried, fails again → a FRESH
    # healthy→marked transition (C1 — `mark` pruned the expired entry), so it warns again: ≤ one per window
    clock.t += 61
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="ctrlb.inference"):
        _stream(client)
    assert _calls(fakes["http://corsair:5001/v1"]) == 2
    assert health.demoted(GID_CORSAIR)
    warns = [r for r in caplog.records if "marked for" in r.getMessage() and r.levelno == logging.WARNING]
    assert len(warns) == 1


def test_mark_prunes_expired_entries_and_rearming_a_live_window_is_quiet() -> None:
    """C1: `mark` drops every EXPIRED entry first — a key orphaned by a URL edit / a removed provider cannot
    linger, and a post-expiry failure is a fresh transition — while re-arming a LIVE window (a concurrent
    caller failing inside it) is not."""
    clock = _Clock()
    health = EndpointHealth(clock=clock)
    assert health.mark("http://old/v1", 60) is True
    assert health.mark("http://old/v1", 60) is False  # live window: a re-arm, not a transition
    clock.t += 61  # `old` expires (its provider was removed / re-pointed — nothing will ever clear it)
    assert health.mark("http://new/v1", 60) is True
    assert set(health._until) == {"http://new/v1"}  # the orphan was pruned
    assert health.mark("http://old/v1", 60) is True  # back after expiry ⇒ fresh again


@pytest.mark.parametrize("failure", [_busy, _boom])
def test_a_non_unreachable_failure_never_marks(failure) -> None:
    client, _, _, health = _build(
        _pair(retry_attempts=0), {"http://corsair:5001/v1": failure, "http://corsair:18081/v1": _ok("s")}
    )
    assert _text(_stream(client)) == "s"
    assert not health.demoted(GID_CORSAIR)
    assert health._until == {}


def test_cooldown_zero_is_off_no_mark_and_no_demotion() -> None:
    health = EndpointHealth(clock=_Clock())
    client, fakes, _, _ = _build(
        _pair(cooldown=0),
        {"http://corsair:5001/v1": _unreachable, "http://corsair:18081/v1": _ok("s")},
        health=health,
    )
    _stream(client)
    assert health._until == {}  # 0 sets nothing
    health.mark(GID_CORSAIR, 60)  # a mark left by an earlier (cooldown-on) generation…
    _stream(client)
    assert _calls(fakes["http://corsair:5001/v1"]) == 2  # …is ignored: the primary is still tried first


# ══ B. demote, expire, clear ════════════════════════════════════════════════════════════════════════


def test_a_marked_primary_is_walked_last_and_the_demoted_call_narrates_nothing() -> None:
    client, fakes, _, health = _build(
        _pair(), {"http://corsair:5001/v1": _unreachable, "http://corsair:18081/v1": _ok("s")}
    )
    _stream(client)  # sets the mark
    report = StreamReport()
    items = _stream(client, report=report)
    assert _text(items) == "s"
    assert _calls(fakes["http://corsair:5001/v1"]) == 1  # NOT re-dialled while marked
    assert not [i for i in items if isinstance(i, FailoverNotice)]  # no per-call notice (R11)
    # C. attribution of the demoted serve: degraded, fallback FROM the configured head, no failed hop
    assert (report.served, report.degraded, report.primary, report.failures) == (
        "strata",
        True,
        "corsair",
        [],
    )
    assert health.demoted(GID_CORSAIR)


def test_demote_never_skip_a_marked_primary_still_serves_when_the_healthy_hops_fail() -> None:
    sw = _Switch(_unreachable)
    strata = _Switch(_ok("s"))
    client, fakes, _, health = _build(
        _pair(retry_attempts=0), {"http://corsair:5001/v1": sw, "http://corsair:18081/v1": strata}
    )
    _stream(client)  # mark corsair
    sw.fn, strata.fn = _ok("corsair back"), _boom
    report = StreamReport()
    items = _stream(client, report=report)
    assert _text(items) == "corsair back"
    assert [i for i in items if isinstance(i, FailoverNotice)] == [
        FailoverNotice(from_endpoint="strata", to_endpoint="corsair", category="other")  # walked names
    ]
    # the demoted CONFIGURED head served at the tail → not a fallback serve; the success clears the mark
    assert (report.served, report.degraded, report.primary) == ("corsair", False, "corsair")
    assert not health.demoted(GID_CORSAIR) and health._until == {}


def test_expiry_retries_the_primary_first_and_a_success_clears(caplog) -> None:
    sw = _Switch(_unreachable)
    client, fakes, clock, health = _build(
        _pair(), {"http://corsair:5001/v1": sw, "http://corsair:18081/v1": _ok("s")}
    )
    _stream(client)
    clock.t += 30
    _stream(client)
    assert _calls(fakes["http://corsair:5001/v1"]) == 1  # still inside the window
    clock.t += 31  # past the 60 s window
    sw.fn = _ok("corsair back")
    report = StreamReport()
    with caplog.at_level(logging.INFO, logger="ctrlb.inference"):
        items = _stream(client, report=report)
    assert _text(items) == "corsair back"
    assert _calls(fakes["http://corsair:5001/v1"]) == 2
    assert (report.served, report.degraded) == ("corsair", False)
    assert health._until == {}
    assert [r for r in caplog.records if r.levelno == logging.INFO and "cooldown cleared" in r.getMessage()]


def test_complete_demotes_and_clears_too_and_the_clear_needs_no_report() -> None:
    sw = _Switch(_unreachable)
    client, fakes, clock, health = _build(
        _pair(), {"http://corsair:5001/v1": sw, "http://corsair:18081/v1": _ok("s")}
    )
    report = StreamReport()
    assert run_async(client.complete(_MSGS, report=report)) == "s"
    assert health.demoted(GID_CORSAIR)
    assert run_async(client.complete(_MSGS)) == "s"  # demoted: corsair not dialled
    assert _calls(fakes["http://corsair:5001/v1"]) == 1
    clock.t += 61
    sw.fn = _ok("c")
    assert run_async(client.complete(_MSGS)) == "c"  # report=None — the CLEAR still runs (R14)
    assert health._until == {}


def test_stream_clear_needs_no_report() -> None:
    client, _, _, health = _build(
        registry([target("solo", "http://solo/v1", "m")]), {"http://solo/v1": _ok("hi")}
    )
    health.mark("http://solo/v1", 60)
    assert _text(_stream(client)) == "hi"
    assert health._until == {}


# ══ C. attribution by identity ══════════════════════════════════════════════════════════════════════


def test_a_duplicate_provider_serve_is_degraded_by_identity() -> None:
    """One provider twice (two models on the same box): the second entry serving is a FALLBACK serve even
    though the provider name matches the configured head."""
    reg = registry(
        [
            target("corsair", "http://corsair:5001/v1", "qwen", retry_attempts=0),
            target("corsair", "http://corsair:5001/v1", "gemma"),
        ]
    )
    calls: list[str] = []

    def behave(kw):
        calls.append(kw["model"])
        if kw["model"] == "qwen":
            raise RuntimeError("qwen OOM")
        return _Stream([_Chunk(_Delta(content="gemma"))])

    client, _, _, _ = _build(reg, {"http://corsair:5001/v1": behave})
    report = StreamReport()
    assert _text(_stream(client, report=report)) == "gemma"
    assert calls == ["qwen", "gemma"]
    assert (report.served, report.degraded, report.primary) == ("corsair", True, "corsair")
    assert report.served_target is not None and report.served_target.model == "gemma"


def test_one_mark_demotes_every_entry_on_that_server() -> None:
    reg = registry(
        [
            target("corsair", "http://corsair:5001/v1", "qwen"),
            target("corsair", "http://corsair:5001/v1", "gemma"),
            target("strata", "http://corsair:18081/v1", "x"),
        ],
        connect_cooldown_s=60,
    )
    client, _, _, health = _build(reg, {})
    health.mark(GID_CORSAIR, 60)
    attempted, head = client._resolve_chain(None, None)
    assert [(t.provider, t.model) for t in attempted] == [
        ("strata", "x"),
        ("corsair", "qwen"),
        ("corsair", "gemma"),
    ]
    assert head is reg.inference_chain[0]
    # the partition moves the EXACT chain objects (never re-resolved)
    assert {id(t) for t in attempted} == {id(t) for t in reg.inference_chain}


# ══ D. shape ════════════════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("shape", ["failover_off", "one_entry"])
def test_a_pre_existing_mark_on_a_failover_off_or_one_entry_chain_is_a_no_op(shape) -> None:
    """C3(d): with nothing to demote behind, a marked server is still dialled first and its serve is NOT a
    fallback serve — and that serve clears the mark."""
    if shape == "failover_off":
        reg = registry(
            [
                target("corsair", "http://corsair:5001/v1", "qwen"),
                target("strata", "http://corsair:18081/v1", "x"),
            ],
            failover=False,
        )
    else:
        reg = registry([target("corsair", "http://corsair:5001/v1", "qwen")])
    client, fakes, _, health = _build(
        reg, {"http://corsair:5001/v1": _ok("c"), "http://corsair:18081/v1": _ok("s")}
    )
    health.mark(GID_CORSAIR, 60)
    report = StreamReport()
    assert _text(_stream(client, report=report)) == "c"
    assert _calls(fakes["http://corsair:5001/v1"]) == 1 and _calls(fakes["http://corsair:18081/v1"]) == 0
    assert (report.served, report.degraded, report.primary) == ("corsair", False, "corsair")
    assert health._until == {}


def test_a_retry_on_a_demoted_walk_names_the_walked_endpoint(monkeypatch) -> None:
    """C3(a): `HopRetry.index` is a position in the WALKED chain — with corsair demoted, a transient 503 on
    strata (now position 0) must narrate `strata`, never the configured position-0 `corsair`."""

    async def _no_sleep(_d):
        return None

    monkeypatch.setattr("app.core.failover.asyncio.sleep", _no_sleep)
    attempts = {"n": 0}

    def strata(kw):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise InferenceError("busy", status=503)
        return _Stream([_Chunk(_Delta(content="s"))])

    client, fakes, _, health = _build(
        _pair(), {"http://corsair:5001/v1": _ok("c"), "http://corsair:18081/v1": strata}
    )
    health.mark(GID_CORSAIR, 60)
    items = _stream(client)
    assert _text(items) == "s"
    retries = [i for i in items if isinstance(i, RetryNotice)]
    assert [(r.endpoint, r.attempt, r.category) for r in retries] == [("strata", 1, "transient")]
    assert _calls(fakes["http://corsair:5001/v1"]) == 0  # the demoted primary was never needed


def test_a_mid_stream_failure_clears_on_the_first_chunk_and_never_marks() -> None:
    """C3(b): reachability is proved by the FIRST chunk — the clear lands before the drain, so a stream that
    dies later still leaves the mark cleared; and the mid-stream path never marks, even for an error whose
    cause is an httpx connect failure (that is not "the server is down" once it has answered)."""

    def mid_stream_drop(_kw):
        try:
            raise httpx.ConnectError("reset mid-stream")
        except httpx.ConnectError as exc:
            try:
                raise openai.APIConnectionError(request=_REQ) from exc
            except openai.APIConnectionError as wrapped:
                return _Stream([_Chunk(_Delta(content="partial")), wrapped])

    reg = registry([target("solo", "http://solo/v1", "m")])
    client, _, _, health = _build(reg, {"http://solo/v1": mid_stream_drop})
    health.mark("http://solo/v1", 60)  # an existing mark: the first chunk clears it
    with pytest.raises(InferenceError):
        _stream(client)
    assert health._until == {}
    with pytest.raises(InferenceError):  # unmarked server, same drop: still nothing set
        _stream(client)
    assert health._until == {}


def test_a_cancellation_mid_connect_never_marks(monkeypatch) -> None:
    """C3(c): a turn cancelled while the REAL SDK stack is still connecting (the socket layer patched to
    hang — never the network) propagates `CancelledError` and arms nothing: cancellation is excluded
    before the cause walk, so a stopped turn can never demote a healthy server."""

    entered = asyncio.Event()

    async def _hang(*_a, **_k):
        entered.set()
        await anyio.sleep(3600)

    monkeypatch.setattr(anyio, "connect_tcp", _hang)
    reg = registry(
        [target("dead", "http://dead.invalid:5001/v1", "m"), target("alive", "http://alive/v1", "m")],
        connect_timeout_s=30.0,
    )
    clock = _Clock()
    health = EndpointHealth(clock=clock)
    client = InferenceClient(reg, health=health)
    real = client._client
    alive = _Client(_ok("a"))
    client._client = lambda ep: real(ep) if ep.provider == "dead" else alive  # type: ignore[assignment]

    async def go():
        task = asyncio.ensure_future(_drain(client.stream_chat(_MSGS)))
        await asyncio.wait_for(entered.wait(), 5)  # provably parked inside the 30 s connect
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            await client._close_clients()

    run_async(go())
    assert health._until == {}
    assert _calls(alive) == 0  # a cancel is not a hop


async def _drain(gen):
    return [x async for x in gen]


def test_a_one_entry_chain_is_untouched() -> None:
    reg = registry([target("solo", "http://solo/v1", "m")], connect_cooldown_s=60)
    client, _, _, health = _build(reg, {})
    health.mark("http://solo/v1", 60)
    attempted, head = client._resolve_chain(None, None)
    assert attempted == [head] and head is reg.inference_chain[0]


def _settings_registry(**inf):
    s = Settings(
        providers={
            "corsair": ProviderCfg(
                base_url="http://corsair:5001/v1",
                api_mode="llamacpp",
                models={"qwen": ModelCfg(context_window=32768), "gemma": ModelCfg(context_window=8192)},
            ),
            "strata": ProviderCfg(
                base_url="http://corsair:18081/v1",
                api_mode="llamacpp",
                models={"x": ModelCfg(context_window=262144)},
            ),
        },
        inference=InferenceCfg(
            provider="corsair", model="qwen", fallbacks=[SectionRef(provider="strata")], **inf
        ),
    )
    reg, _ = resolve_lenient(s)
    return reg


def test_an_agent_model_override_stays_on_its_own_entry_through_demotion() -> None:
    reg = _settings_registry()
    seen: list[tuple[str, str]] = []

    def record(name, ok):
        def behave(kw):
            seen.append((name, kw["model"]))
            if not ok:
                raise RuntimeError(f"{name} down")
            return _Stream([_Chunk(_Delta(content=name))])

        return behave

    client, _, _, health = _build(
        reg,
        {
            "http://corsair:5001/v1": record("corsair", True),
            "http://corsair:18081/v1": record("strata", False),
        },
    )
    health.mark(GID_CORSAIR, 60)
    attempted, head = client._resolve_chain("corsair", "gemma")
    assert [(t.provider, t.model) for t in attempted] == [("strata", "x"), ("corsair", "gemma")]
    assert head is not None and head is attempted[1]
    assert (head.provider, head.model) == ("corsair", "gemma")
    report = StreamReport()
    assert _text(_stream(client, mode="corsair", model="gemma", report=report)) == "corsair"
    # strata kept ITS model; the override followed the corsair entry to the tail
    assert seen == [("strata", "x"), ("corsair", "gemma")]
    assert (report.served, report.degraded) == ("corsair", False)


def test_pricing_reads_the_demotion_aware_head_and_min_window_stays_order_free() -> None:
    reg = _settings_registry()
    client, _, _, health = _build(reg, {})

    async def windows():
        return (
            client.target_for(None, None),
            await client.effective_window_for(None, None),
            await client.min_chain_window(None, None),
        )

    t, w, m = run_async(windows())
    assert t is not None
    assert (t.provider, w, m) == ("corsair", 32768, 32768)  # unmarked: configured head
    health.mark(GID_CORSAIR, 60)
    t, w, m = run_async(windows())
    assert t is not None
    assert (t.provider, w) == ("strata", 262144)  # iteration-1 pricing + the summarizer guard follow the walk
    assert m == 32768  # the D60 gate prices the whole chain, order-free


def test_connect_cooldown_config_default_validation_and_policy() -> None:
    assert InferenceCfg().connect_cooldown_s == 60.0
    assert InferenceCfg(connect_cooldown_s=0).connect_cooldown_s == 0  # 0 = off is legal
    for bad in (-1, float("inf"), float("nan")):
        with pytest.raises(ValidationError):
            InferenceCfg(connect_cooldown_s=bad)
    assert _settings_registry(connect_cooldown_s=15).inference_policy.connect_cooldown_s == 15


def test_the_ledger_is_app_owned_and_survives_a_client_rebuild() -> None:
    from app.runtime import resolve_generation, set_inference

    s = Settings(
        providers={"a": ProviderCfg(base_url="http://a/v1", models={"m": ModelCfg()})},
        inference=InferenceCfg(provider="a"),
    )
    app = SimpleNamespace(state=SimpleNamespace(settings=s, endpoint_gates=EndpointGates()))
    reg = resolve_generation(app, s)  # type: ignore[arg-type] — memoizes the ledger beside the gates
    health = app.state.endpoint_health
    assert isinstance(health, EndpointHealth)
    set_inference(app, reg)  # type: ignore[arg-type]
    first = app.state.inference
    set_inference(app, resolve_generation(app, s))  # type: ignore[arg-type] — a settings PUT rebuild
    assert app.state.inference is not first
    assert app.state.endpoint_health is health
    assert first._health is health and app.state.inference._health is health
