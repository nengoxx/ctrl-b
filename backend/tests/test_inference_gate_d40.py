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

from app.adapters.inference import InferenceClient
from app.config import InferenceCfg, InferenceEndpointCfg


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


def _build(cfg: InferenceCfg, behaviors: dict[str, object]):
    client = InferenceClient(cfg)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _cfg(limit: int | None) -> InferenceCfg:
    return InferenceCfg(
        default_mode="local",
        failover=False,  # one endpoint — the gate, not the chain, is under test
        local=InferenceEndpointCfg(base_url="http://local/v1", model="m", max_concurrent_requests=limit),
    )


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
        # And the client built no semaphore for an unlimited endpoint.
        assert client._sems == {}

    asyncio.run(scenario())


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
