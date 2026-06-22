"""D18 — LLM inference failover chain. Stream-initiation failover + buffered failover over the
ordered chain (selected → other-of-local/cloud → fallbacks), reusing core/failover. A fake OpenAI
client lets each endpoint succeed/fail independently — no real backend.

Run: ./.venv/Scripts/python.exe tests/test_inference_failover_d18.py
"""

from __future__ import annotations

import asyncio

from app.adapters.inference import InferenceClient, InferenceError, StreamReport
from app.config import InferenceCfg, InferenceEndpointCfg


# ── fakes for the AsyncOpenAI stream/buffered shapes ──
class _Delta:
    def __init__(self, content="", reasoning=None):
        self.content = content
        self.reasoning_content = reasoning
        self.tool_calls = []
        self.model_extra = None


class _Chunk:
    def __init__(self, delta):
        self.choices = [type("Ch", (), {"delta": delta})()]


class _Stream:
    """An async iterator of chunks; an Exception item raises when reached."""

    def __init__(self, items):
        self._items = list(items)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        x = self._items.pop(0)
        if isinstance(x, Exception):
            raise x
        return x

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
        return self._behavior(kwargs)  # returns a _Stream/_Resp or raises


class _Client:
    def __init__(self, behavior):
        self.chat = type("Chat", (), {"completions": _Completions(behavior)})()


def _build(cfg: InferenceCfg, behaviors: dict[str, object]):
    """An InferenceClient whose `_client(ep)` returns the fake bound to ep.base_url."""
    client = InferenceClient(cfg)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _cfg(**kw) -> InferenceCfg:
    base = dict(
        default_mode="local",
        local=InferenceEndpointCfg(base_url="http://local/v1", model="minig"),
        cloud=InferenceEndpointCfg(base_url="http://cloud/v1", model="gemma"),
    )
    base.update(kw)
    return InferenceCfg(**base)


def _down(_kw):
    raise RuntimeError("backend down")


def _streams(*texts):
    return lambda _kw: _Stream([_Chunk(_Delta(content=t)) for t in texts])


async def _collect(client, **kw):
    return [d async for d in client.stream_chat([{"role": "user", "content": "hi"}], **kw)]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ── tests ──
def test_chain_order():
    c = _cfg(fallbacks=[InferenceEndpointCfg(base_url="http://x/v1", model="x")])
    assert [n for n, _ in c.endpoint_chain("local")] == ["local", "cloud", "fallback1"]
    assert [n for n, _ in c.endpoint_chain("cloud")] == ["cloud", "local", "fallback1"]
    assert [n for n, _ in c.endpoint_chain("local") if False] == []  # sanity
    assert [n for n, _ in _cfg(failover=False).endpoint_chain("local")] == ["local"]


def test_stream_failover_at_create():
    client, _ = _build(_cfg(), {"http://local/v1": _down, "http://cloud/v1": _streams("from ", "cloud")})
    report = StreamReport()
    deltas = _run(_collect(client, report=report))
    assert "".join(d.text for d in deltas) == "from cloud"
    assert report.served == "cloud" and report.degraded is True
    assert len(report.failures) == 1  # local failed once before cloud answered


def test_stream_failover_at_first_chunk():
    # local opens a stream but errors on the FIRST read → still fails over (init-time).
    client, fakes = _build(
        _cfg(),
        {
            "http://local/v1": lambda _kw: _Stream([RuntimeError("died on first token")]),
            "http://cloud/v1": _streams("ok"),
        },
    )
    deltas = _run(_collect(client))
    assert "".join(d.text for d in deltas) == "ok"


def test_no_midstream_failover():
    # local's first chunk is fine, then it drops → InferenceError, and cloud is NEVER tried.
    client, fakes = _build(
        _cfg(),
        {
            "http://local/v1": lambda _kw: _Stream([_Chunk(_Delta(content="par")), RuntimeError("drop")]),
            "http://cloud/v1": _streams("should-not-run"),
        },
    )
    raised = False
    try:
        _run(_collect(client))
    except InferenceError:
        raised = True
    assert raised
    assert fakes["http://cloud/v1"].chat.completions.calls == []  # no failover after first chunk


def test_model_override_applies_to_primary_only():
    client, fakes = _build(_cfg(), {"http://local/v1": _down, "http://cloud/v1": _streams("x")})
    _run(_collect(client, model="custom-model"))
    assert fakes["http://local/v1"].chat.completions.calls[0]["model"] == "custom-model"  # selected
    assert fakes["http://cloud/v1"].chat.completions.calls[0]["model"] == "gemma"  # fallback = its own


def test_buffered_complete_failover():
    client, _ = _build(_cfg(), {"http://local/v1": _down, "http://cloud/v1": lambda _kw: _Resp("buffered")})
    report = StreamReport()
    text = _run(client.complete([{"role": "user", "content": "hi"}], report=report))
    assert text == "buffered"
    assert report.served == "cloud" and report.degraded is True


def test_all_endpoints_fail_raises():
    client, _ = _build(_cfg(), {"http://local/v1": _down, "http://cloud/v1": _down})
    raised = False
    try:
        _run(_collect(client))
    except InferenceError:
        raised = True
    assert raised


def test_failover_off_does_not_try_fallback():
    client, fakes = _build(_cfg(failover=False), {"http://local/v1": _down, "http://cloud/v1": _streams("x")})
    raised = False
    try:
        _run(_collect(client))
    except InferenceError:
        raised = True
    assert raised
    assert fakes["http://cloud/v1"].chat.completions.calls == []  # off → only the selected endpoint


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
