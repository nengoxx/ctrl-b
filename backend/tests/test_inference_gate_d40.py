"""D40 rider — the per-endpoint inference request gate (`InferenceEndpointCfg.max_concurrent_requests`).

A lazily-built per-endpoint `asyncio.Semaphore` at the inference-client chokepoint caps in-flight
requests to a non-queuing backend (the owner's llama.cpp: 1–2 slots). It is held for the ENTIRE
streamed response and released in `finally`, and NEVER held across tool execution / subagent
fan-out (the completion stream closes — releasing the permit — before the loop runs tools). These
pins prove the three properties that matter: serialize, no-hold-across-tools (no deadlock at 1),
and unlimited-when-None.

Fakes mirror `test_inference_failover_d18.py`: a fake AsyncOpenAI whose `create()` returns a
`_Stream`/`_Resp` and records each call, so overlap is observable without a real backend.
"""

from __future__ import annotations

import asyncio

from _reg import registry, target

from app.adapters.inference import ChatDelta, InferenceClient
from app.core.provider_registry import EndpointGates, canonical_base_url


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
    """Async chunk iterator. After its chunks, it blocks on `gate` (if given, until set) BEFORE
    raising StopAsyncIteration — so the consumer (and thus the held permit) stays live across the
    wait, letting a test observe whether a second request can overlap."""

    def __init__(self, chunks, gate: asyncio.Event | None = None):
        self._chunks = list(chunks)
        self._gate = gate
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._chunks:
            return self._chunks.pop(0)
        if self._gate is not None and not self._gate.is_set():
            await self._gate.wait()
        raise StopAsyncIteration

    async def close(self):
        self.closed = True


class _Resp:
    def __init__(self, content):
        self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]


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


def _build(reg, behaviors: dict[str, object], gates: EndpointGates | None = None):
    client = InferenceClient(reg, gates=gates)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _cfg(limit: int | None):
    # one target — the gate, not the chain, is under test
    return registry([target("local", "http://local/v1", "m", max_concurrent_requests=limit)], failover=False)


async def _collect(client):
    return [d async for d in client.stream_chat([{"role": "user", "content": "hi"}])]


def _calls(fake) -> list[dict]:
    return fake.chat.completions.calls


# ── (a) two concurrent streamed completions serialize at limit 1 ──────────────────────────────────
def test_limit1_serializes_two_concurrent_streams():
    async def scenario():
        gate = asyncio.Event()
        client, fakes = _build(
            _cfg(1),
            {"http://local/v1": lambda _kw: _Stream([_Chunk(_Delta("hi"))], gate)},
        )
        t1 = asyncio.create_task(_collect(client))
        t2 = asyncio.create_task(_collect(client))
        await asyncio.sleep(0.05)  # both tasks started; one holds the permit (blocked on `gate`)
        # The gate is the proof: at limit 1 exactly ONE request reached `create()`; the other is
        # parked on the semaphore, not yet dispatched to the backend.
        assert len(_calls(fakes["http://local/v1"])) == 1
        gate.set()  # release the first stream → its permit frees → the second proceeds
        r1 = await asyncio.wait_for(t1, timeout=2.0)
        r2 = await asyncio.wait_for(t2, timeout=2.0)
        assert "".join(d.text for d in r1) == "hi"
        assert "".join(d.text for d in r2) == "hi"
        assert len(_calls(fakes["http://local/v1"])) == 2  # both eventually served

    asyncio.run(scenario())


# ── (b) permit NOT held across the tool phase → no deadlock at limit 1 ─────────────────────────────
def test_limit1_no_deadlock_stream_then_tools_then_complete():
    async def scenario():
        def behavior(kw):
            return _Stream([_Chunk(_Delta("answer"))]) if kw.get("stream") else _Resp("summary")

        client, _ = _build(_cfg(1), {"http://local/v1": behavior})
        # completion 1 (streamed) fully consumed — the stream closes, releasing the permit BEFORE
        # any tool runs (session drains the `async for` before `_run_calls`).
        out = await _collect(client)
        assert "".join(d.text for d in out) == "answer"
        await asyncio.sleep(0.01)  # a "long tool phase" — no inference in flight, permit must be free
        # completion 2 (the summarizer, buffered): must acquire the now-free slot. A leaked permit
        # would hang here forever → wait_for turns a deadlock into a fast, legible failure.
        text = await asyncio.wait_for(client.complete([{"role": "user", "content": "sum"}]), timeout=2.0)
        assert text == "summary"

    asyncio.run(scenario())


# ── (c) None = unlimited → no acquire, requests overlap freely ─────────────────────────────────────
def test_none_is_unlimited_no_gating():
    async def scenario():
        gate = asyncio.Event()
        client, fakes = _build(
            _cfg(None),
            {"http://local/v1": lambda _kw: _Stream([_Chunk(_Delta("hi"))], gate)},
        )
        t1 = asyncio.create_task(_collect(client))
        t2 = asyncio.create_task(_collect(client))
        await asyncio.sleep(0.05)
        # No gate → BOTH requests reached `create()` concurrently (instrumented fake proves no
        # semaphore was ever acquired).
        assert len(_calls(fakes["http://local/v1"])) == 2
        gate.set()
        await asyncio.wait_for(t1, timeout=2.0)
        await asyncio.wait_for(t2, timeout=2.0)
        # And the registry built no semaphore for an unlimited endpoint.
        assert client._gates._sems == {}

    asyncio.run(scenario())


# ── (D42 Codex FIX 1) the cap is NOT split across client generations sharing one registry ──────────
def test_shared_gates_cap_not_split_across_generations():
    """A settings PUT rebuilds the `InferenceClient` but `set_inference` passes the SAME `EndpointGates`
    in — so an OLD-generation permit holder (limit 1) and a NEW-generation acquirer contend on the ONE
    semaphore: the new client's request MUST block until the old one releases. A per-client semaphore
    (the pre-fix bug) would let limit 1 become 2."""

    async def scenario():
        gates = EndpointGates()
        gate = asyncio.Event()
        cfg = _cfg(1)
        clientA, fakesA = _build(
            cfg, {"http://local/v1": lambda _kw: _Stream([_Chunk(_Delta("A"))], gate)}, gates
        )
        tA = asyncio.create_task(_collect(clientA))
        await asyncio.sleep(0.05)  # A acquired the single permit (parked on `gate`)
        assert len(_calls(fakesA["http://local/v1"])) == 1
        # rebuild: a NEW client generation, SAME registry, SAME endpoint+limit.
        clientB, fakesB = _build(
            cfg, {"http://local/v1": lambda _kw: _Stream([_Chunk(_Delta("B"))], gate)}, gates
        )
        tB = asyncio.create_task(_collect(clientB))
        await asyncio.sleep(0.05)
        # B is BLOCKED on the shared semaphore — it never reached create() while A holds the permit.
        assert len(_calls(fakesB["http://local/v1"])) == 0
        gate.set()  # release A → its permit frees → B proceeds on the SAME semaphore
        rA = await asyncio.wait_for(tA, timeout=2.0)
        rB = await asyncio.wait_for(tB, timeout=2.0)
        assert "".join(d.text for d in rA) == "A"
        assert "".join(d.text for d in rB) == "B"
        assert len(_calls(fakesB["http://local/v1"])) == 1  # B eventually served, once A freed the slot

    asyncio.run(scenario())


def test_changed_limit_mints_fresh_gate():
    """A CHANGED limit mints a NEW semaphore under the new `(gate_identity, limit)` key (old holders drain
    on the old one); an unchanged key returns the SAME object across generations. Keys are the CANONICAL
    base_url now (D48 C4), so aliased URLs of one server coalesce onto ONE gate."""

    async def scenario():
        gates = EndpointGates()
        gid = canonical_base_url("http://local/v1")
        s1 = gates.sem_for(gid, 1)
        s1_again = gates.sem_for(gid, 1)
        s2 = gates.sem_for(gid, 2)
        assert s1 is s1_again  # same gate_identity + limit ⇒ the SAME semaphore (shared across generations)
        assert s2 is not s1  # a changed limit ⇒ a fresh gate
        # Canonicalization equivalence: default port elided + host lowercased + trailing slash stripped.
        assert canonical_base_url("http://LOCAL:80/v1") == canonical_base_url("http://local/v1/")
        assert gates.sem_for(canonical_base_url("http://LOCAL:80/v1"), 1) is s1

    asyncio.run(scenario())


def test_min_wins_cap_on_resolved_target():
    """D48 C4: providers sharing a gate identity with conflicting caps ({None, 2}) resolve to min-of-finite
    (2) onto every affected `ResolvedTarget` (lenient boot)."""
    from app.config import InferenceCfg, ModelCfg, ProviderCfg, SectionRef, Settings
    from app.core.provider_registry import resolve_lenient

    s = Settings(
        providers={
            "a": ProviderCfg(
                base_url="http://box/v1", max_concurrent_requests=None, models={"m": ModelCfg()}
            ),
            "b": ProviderCfg(
                base_url="http://BOX:80/v1", max_concurrent_requests=2, models={"n": ModelCfg()}
            ),
        },
        inference=InferenceCfg(provider="a", fallbacks=[SectionRef(provider="b", model="n")]),
    )
    reg, warns = resolve_lenient(s)
    assert all(t.max_concurrent_requests == 2 for t in reg.inference_chain)  # min of {None, 2}
    assert any("conflicting max_concurrent_requests" in w for w in warns)


def test_generation_drain_retire_closes_clients():
    """A11/R6: an idle client's `retire()` closes its SDK clients immediately; a client with an in-flight
    turn defers the close until the last decrement (the generation-drain)."""

    async def scenario():
        gate = asyncio.Event()
        client, _ = _build(_cfg(None), {"http://local/v1": lambda _kw: _Stream([_Chunk(_Delta("hi"))], gate)})
        closed = {"n": 0}

        class _FakeSDK:
            async def close(self):
                closed["n"] += 1

        client._clients["local"] = _FakeSDK()  # type: ignore[assignment]
        t = asyncio.create_task(_collect(client))
        await asyncio.sleep(0.05)  # a turn is in flight (refcount 1)
        await client.retire()  # retire while draining → close DEFERRED
        assert closed["n"] == 0
        gate.set()
        await asyncio.wait_for(t, timeout=2.0)  # the turn drains → the deferred close fires
        assert closed["n"] == 1

    asyncio.run(scenario())


class _RaisingStream:
    """Yields its chunks, then RAISES `exc` on the next pull — a mid-stream drop after the first
    (probe) chunk has already committed the endpoint. Used to prove the permit is freed on a
    mid-stream error, not only on clean exhaustion."""

    def __init__(self, chunks, exc: Exception):
        self._chunks = list(chunks)
        self._exc = exc
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._chunks:
            return self._chunks.pop(0)
        raise self._exc

    async def close(self):
        self.closed = True


def _cfg2(limit: int | None):
    """A two-endpoint failover chain (local → cloud), each gated at `limit`."""
    return registry(
        [
            target("local", "http://local/v1", "m", max_concurrent_requests=limit),
            target("cloud", "http://cloud/v1", "m", max_concurrent_requests=limit),
        ],
        failover=True,
    )


# ── (LOW-3a) a FAILED failover attempt releases its permit before the next same-endpoint acquire ──
def test_failed_attempt_releases_permit_no_deadlock():
    async def scenario():
        state = {"local": 0}

        def local_behavior(_kw):
            state["local"] += 1
            if state["local"] == 1:
                raise RuntimeError("local down")  # attempt-1 fails INSIDE create() → must free its permit
            return _Stream([_Chunk(_Delta("local-ok"))])

        client, _ = _build(
            _cfg2(1),
            {
                "http://local/v1": local_behavior,
                "http://cloud/v1": lambda _kw: _Stream([_Chunk(_Delta("cloud-ok"))]),
            },
        )
        # call 1: local's attempt raises → failover to cloud answers. local's limit-1 permit MUST be
        # released on the failed attempt (the `except BaseException: sem.release()` in `attempt`).
        r1 = await asyncio.wait_for(_collect(client), timeout=2.0)
        # A failover serve interleaves a typed `FailoverNotice` (no `.text`) — join ChatDeltas only (D43).
        assert "".join(d.text for d in r1 if isinstance(d, ChatDelta)) == "cloud-ok"
        # call 2: local now succeeds → it must re-acquire the SAME limit-1 permit. A permit leaked by
        # the failed attempt-1 would deadlock here; wait_for turns that into a fast, legible failure.
        r2 = await asyncio.wait_for(_collect(client), timeout=2.0)
        assert "".join(d.text for d in r2) == "local-ok"

    asyncio.run(scenario())


# ── (LOW-3b) a MID-STREAM error releases the permit → the next call at limit 1 doesn't deadlock ────
def test_midstream_error_releases_permit_no_deadlock():
    async def scenario():
        def behavior(kw):
            # First (streamed) call: probe chunk commits, then the stream raises mid-iteration.
            # Second (buffered) call: a plain OK response.
            if kw.get("stream"):
                return _RaisingStream([_Chunk(_Delta("partial"))], RuntimeError("mid-stream drop"))
            return _Resp("recovered")

        client, _ = _build(_cfg(1), {"http://local/v1": behavior})
        # call 1: mid-stream error surfaces as InferenceError; the generator's `finally` frees the slot.
        raised = False
        try:
            await _collect(client)
        except Exception:  # noqa: BLE001 — the normalized InferenceError is expected
            raised = True
        assert raised
        # call 2: must acquire the now-free limit-1 permit (a leaked mid-stream permit → deadlock).
        text = await asyncio.wait_for(client.complete([{"role": "user", "content": "x"}]), timeout=2.0)
        assert text == "recovered"

    asyncio.run(scenario())


# ── (A11/R4/R5) voice + embeddings share the chat gate registry and drain on retire ──────────────
def test_voice_and_chat_share_the_same_gate_semaphore():
    """R4: a voice/embeddings attempt acquires the SAME `(gate_identity, limit)` semaphore chat uses on
    that server — so a whisper call and a chat call on one box contend on ONE cap. None → no semaphore."""
    from app.adapters.embeddings import EmbeddingsClient
    from app.adapters.voice import VoiceClient
    from app.domain.provider import EmbeddingsPolicy, SttPolicy, TtsPolicy

    gates = EndpointGates()
    t = target("box", "http://box:9000/v1", "w", max_concurrent_requests=1)
    vc = VoiceClient((t,), SttPolicy(), (), TtsPolicy(), gates)
    ic = InferenceClient(registry([t], failover=False), gates=gates)
    ec = EmbeddingsClient((t,), EmbeddingsPolicy(), gates)
    sem = gates.sem_for(t.gate_identity, 1)
    assert vc._sem_for(t) is sem and ic._sem_for(t) is sem and ec._sem_for(t) is sem  # ONE shared cap
    unlimited = target("free", "http://free/v1", "w", max_concurrent_requests=None)
    assert vc._sem_for(unlimited) is None  # None cap → zero overhead


def test_voice_retire_drains_inflight_before_close():
    """R5: a VoiceClient with an in-flight transcribe defers its SDK-client close until the op completes
    (the InferenceClient generation-drain pattern)."""

    async def scenario():
        from types import SimpleNamespace

        from app.adapters.voice import VoiceClient
        from app.domain.provider import SttPolicy, TtsPolicy

        gate = asyncio.Event()
        closed = {"n": 0}

        async def t_create(*, model, file, **kw):
            await gate.wait()
            return SimpleNamespace(text="hi")

        async def close():
            closed["n"] += 1

        fake = SimpleNamespace(
            audio=SimpleNamespace(transcriptions=SimpleNamespace(create=t_create)), close=close
        )
        t = target("s", "http://s/v1", "w")
        vc = VoiceClient((t,), SttPolicy(), (), TtsPolicy())
        vc._client = lambda tt, ct, to: fake  # type: ignore[assignment]
        vc._clients[("s", 3.0, 30.0)] = fake  # so the drain closes it
        task = asyncio.create_task(vc.transcribe(content=b"x", filename="a", content_type=None))
        await asyncio.sleep(0.05)  # in flight (refcount 1)
        await vc.retire()  # retire while draining → close DEFERRED
        assert closed["n"] == 0
        gate.set()
        text, served = await asyncio.wait_for(task, timeout=2.0)
        assert text == "hi" and served.served == "s"
        assert closed["n"] == 1  # the deferred close fired on the last in-flight completion

    asyncio.run(scenario())


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")


# ── Codex HIGH regressions: CLOSE-BEFORE-RELEASE (an abandoned stream must be closed, not leaked) ──
def test_midstream_aclose_closes_stream_before_permit_release():
    """`aclose()` after the first delta (a Stop cancelling the D39 drain task lands here): the
    backend stream must be CLOSED — an abandoned generation still occupies the real llama.cpp slot,
    so releasing the permit without closing would admit a second request while the backend is busy
    (the Codex HIGH). The follow-up call proves the permit was released as well (close THEN release)."""

    async def scenario():
        streams: list[_Stream] = []

        def behavior(_kw):
            # never-exhausting stream: one chunk, then parked on an unset gate (mid-generation)
            s = _Stream([_Chunk(_Delta("hi"))], asyncio.Event())
            streams.append(s)
            return s

        client, _ = _build(_cfg(1), {"http://local/v1": behavior})
        agen = client.stream_chat([{"role": "user", "content": "hi"}])
        first = await agen.__anext__()  # probe + first delta reach the consumer
        assert first.text == "hi"
        await agen.aclose()  # consumer abandons mid-generation
        assert streams[0].closed is True  # the backend slot was actually freed, not leaked
        # ...and the permit was released AFTER the close: a SECOND call on the SAME client (same
        # semaphore) must proceed at limit 1 — a leaked permit would park it forever.
        agen2 = client.stream_chat([{"role": "user", "content": "again"}])
        second = await asyncio.wait_for(agen2.__anext__(), timeout=2.0)
        assert second.text == "hi"
        await agen2.aclose()

    asyncio.run(scenario())


def test_cancel_during_probe_closes_stream_and_releases():
    """CancelledError during the first-chunk probe (`__anext__` parked, cancel arrives): the old
    `except Exception` close let a cancel — a BaseException — slip past `_safe_close`, leaking the
    live generation while the outer handler released the permit. Now ANY first-read failure closes
    the stream (shielded) before the release; the follow-up call proves no deadlock at limit 1."""

    async def scenario():
        streams: list[_Stream] = []
        probe_entered = asyncio.Event()

        class _ProbeBlockedStream(_Stream):
            async def __anext__(self):
                probe_entered.set()
                await asyncio.Event().wait()  # park forever — only cancellation exits

        def behavior(_kw):
            s = _ProbeBlockedStream([])
            streams.append(s)
            return s

        client, fakes = _build(_cfg(1), {"http://local/v1": behavior})
        t = asyncio.create_task(_collect(client))
        await asyncio.wait_for(probe_entered.wait(), timeout=2.0)  # the probe holds the permit
        t.cancel()
        with __import__("pytest").raises(asyncio.CancelledError):
            await t
        assert streams[0].closed is True  # closed despite the cancel (BaseException path)
        # permit released after the close → a normal call on the SAME client (same semaphore)
        # proceeds at limit 1; a leaked permit would park it forever.
        fakes["http://local/v1"].chat.completions._behavior = lambda _kw: _Stream([_Chunk(_Delta("ok"))])
        out = await asyncio.wait_for(_collect(client), timeout=2.0)
        assert "".join(d.text for d in out) == "ok"

    asyncio.run(scenario())
