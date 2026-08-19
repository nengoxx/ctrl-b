"""ACA Slice 1 — A8 context-cost measurement + ACA-18 cache pin/telemetry + ACA-21 wrap-up retention.

Covers, with a fake AsyncOpenAI client (no real backend, same shape as `test_inference_failover_d18`):

  ACA-18 pin      — `InferenceEndpointCfg.extra_body` is merged PER-ENDPOINT into that endpoint's chat
                    call (never blanket — an OpenAI hop 400s on unknown args); an endpoint without it
                    sends no `extra_body` kwarg at all (not an empty dict).
  ACA-18 telemetry— `stream_chat` reads prompt/cache token counts off the response wherever the endpoint
                    reports them (OpenAI `usage`, llama.cpp `timings`/`prompt_progress`) into
                    `StreamReport`, and never crashes when they're absent.
  ACA-21 threading— `stream_chat` threads `tool_choice` (default `"auto"` when tools present, explicit
                    `"none"` honoured, ignored when no tools); `_finalize` sends the cached toolset with
                    `tool_choice="none"` instead of dropping it.
  A8 measurement  — `_log_context_cost` emits ONE debug line carrying the prefix/history estimate + the
                    cache telemetry, and degrades cleanly when nothing was reported.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

from _async import run_async
from _reg import registry, target

from app.adapters.inference import ChatDelta, InferenceClient, InferenceError, StreamReport
from app.domain.agent import ModelRef


# ── fakes for the AsyncOpenAI stream shape (chunk carries optional usage / model_extra) ──
class _Delta:
    def __init__(self, content=""):
        self.content = content
        self.reasoning_content = None
        self.tool_calls = []
        self.model_extra = None


class _Chunk:
    def __init__(self, delta=None, usage=None, model_extra=None, model=None):
        self.choices = [type("Ch", (), {"delta": delta})()] if delta is not None else []
        self.usage = usage
        self.model_extra = model_extra
        self.model = model  # the SERVED model id the endpoint echoes (Phase 18 / C-9)


class _Stream:
    def __init__(self, items):
        self._items = list(items)

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


def _build(reg, behaviors: dict[str, object]):
    client = InferenceClient(reg)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _down(_kw):
    raise RuntimeError("backend down")


def _streams(*chunks):
    return lambda _kw: _Stream(list(chunks))


def _collect(client, **kw):
    async def go():
        return [d async for d in client.stream_chat([{"role": "user", "content": "hi"}], **kw)]

    return run_async(go())


def _cfg(local_extra=None, cloud_extra=None):
    return registry(
        [
            target("local", "http://local/v1", "minig", extra_body=local_extra or {}),
            target("cloud", "http://cloud/v1", "gemma", extra_body=cloud_extra or {}),
        ]
    )


# ── ACA-18 pin: per-endpoint extra_body injection ──
def test_extra_body_is_per_endpoint():
    # local carries the cache pin + fails; cloud has none. Failover exercises both hops, so we can
    # assert each endpoint's recorded call independently.
    cfg = _cfg(local_extra={"cache_prompt": True, "return_progress": True})
    client, fakes = _build(cfg, {"http://local/v1": _down, "http://cloud/v1": _streams(_Chunk(_Delta("ok")))})
    _collect(client)
    local_call = fakes["http://local/v1"].chat.completions.calls[0]
    cloud_call = fakes["http://cloud/v1"].chat.completions.calls[0]
    assert local_call["extra_body"] == {"cache_prompt": True, "return_progress": True}
    # An endpoint with no extra_body sends NO such kwarg (not an empty dict) — mirrors voice.py.
    assert "extra_body" not in cloud_call


def test_extra_body_absent_when_unset():
    client, fakes = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("ok")))})
    _collect(client)
    assert "extra_body" not in fakes["http://local/v1"].chat.completions.calls[0]


# ── C6-e: complete() (the summarizer path, 69cddd7 rider) carries per-endpoint extra_body too ──
def _completion(text):
    """A non-streaming `create(stream=False)` response shape for `complete()`."""
    return lambda _kw: SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def _complete(client, **kw):
    async def go():
        return await client.complete([{"role": "user", "content": "hi"}], **kw)

    return run_async(go())


def test_complete_merges_extra_body_per_endpoint():
    cfg = _cfg(local_extra={"cache_prompt": True})
    client, fakes = _build(cfg, {"http://local/v1": _completion("summary")})
    assert _complete(client) == "summary"
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["stream"] is False
    assert call["extra_body"] == {"cache_prompt": True}  # the summarizer gets the cache pin too


def test_complete_extra_body_none_when_unset():
    # `complete()` sends NO `extra_body` kwarg when empty (D42 W4 `_call_config` omits it, mirroring
    # `stream_chat`'s discipline above) — never a leaked/empty dict, never an explicit None.
    client, fakes = _build(_cfg(), {"http://local/v1": _completion("s")})
    _complete(client)
    assert "extra_body" not in fakes["http://local/v1"].chat.completions.calls[0]


# ── ACA-21: tool_choice threading ──
_TOOLS = [{"type": "function", "function": {"name": "ping", "parameters": {"type": "object"}}}]


def test_tool_choice_defaults_to_auto():
    client, fakes = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("x")))})
    _collect(client, tools=_TOOLS)
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["tool_choice"] == "auto" and call["tools"] == _TOOLS


def test_tool_choice_none_is_honoured():
    client, fakes = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("x")))})
    _collect(client, tools=_TOOLS, tool_choice="none")
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["tool_choice"] == "none" and call["tools"] == _TOOLS


def test_tool_choice_ignored_without_tools():
    client, fakes = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("x")))})
    _collect(client, tools=None, tool_choice="none")
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert "tool_choice" not in call and "tools" not in call


# ── ACA-18 telemetry capture into StreamReport ──
def _usage(prompt, cached=None, completion=None):
    details = SimpleNamespace(cached_tokens=cached) if cached is not None else None
    return SimpleNamespace(prompt_tokens=prompt, completion_tokens=completion, prompt_tokens_details=details)


def test_telemetry_from_openai_usage():
    # cloud-style: a trailing usage-only chunk (empty choices) carries prompt/cached tokens.
    final = _Chunk(delta=None, usage=_usage(1200, cached=1024))
    client, _ = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("hi")), final)})
    report = StreamReport()
    _collect(client, report=report)
    assert report.prompt_tokens == 1200 and report.cached_tokens == 1024


def test_telemetry_from_llamacpp_timings():
    # llama.cpp-style: non-standard `timings` rides the SDK passthrough `model_extra`.
    final = _Chunk(delta=None, model_extra={"timings": {"prompt_n": 800, "cache_n": 640}})
    client, _ = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("hi")), final)})
    report = StreamReport()
    _collect(client, report=report)
    assert report.prompt_tokens == 800 and report.cached_tokens == 640


def test_telemetry_from_prompt_progress():
    final = _Chunk(delta=None, model_extra={"prompt_progress": {"total": 900, "cache": 512}})
    client, _ = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("hi")), final)})
    report = StreamReport()
    _collect(client, report=report)
    assert report.prompt_tokens == 900 and report.cached_tokens == 512


def test_telemetry_absent_does_not_crash():
    # A plain stream (no usage/timings) leaves the fields None — not a crash, not a 0.
    client, _ = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("hi")))})
    report = StreamReport()
    _collect(client, report=report)
    assert report.prompt_tokens is None and report.cached_tokens is None


def test_fmt_cache_zero_cached_renders_zero_not_not_reported():
    """C6-d — a REPORTED `cached_tokens=0` (OpenAI floors <1024-token prompts to 0) must render as
    "cached 0 (0% hit)", NOT "not reported" (which means the endpoint reported nothing at all). Only
    both-None is "not reported"."""
    from app.services.agent.session import _fmt_cache

    rendered = _fmt_cache(StreamReport(prompt_tokens=1200, cached_tokens=0))
    assert "cached 0" in rendered and "0% hit" in rendered
    assert "not reported" not in rendered
    # both absent → the one "not reported" case
    assert _fmt_cache(StreamReport()) == "not reported"


# ── Phase 18 / C-9: per-call usage — `include_usage` on by default, the owner still wins ──
def test_include_usage_is_requested_on_streams_by_default():
    """The one thing R31 verified cannot be reconstructed later, so it is asked for on every stream —
    as the modeled kwarg (this file's TRANSPORT rule: the SDK declares `stream_options`)."""
    client, fakes = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("hi")))})
    _collect(client)
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["stream_options"] == {"include_usage": True}
    assert "extra_body" not in call  # …and it does not conjure an extra_body the endpoint never set


def test_the_owners_stream_options_wins_and_is_not_duplicated():
    """`extra_body` is the owner's home for it (C-9): an endpoint that hand-set `stream_options`
    keeps its value verbatim, and ours is not added beside it — one spelling on the wire."""
    cfg = _cfg(local_extra={"stream_options": {"include_usage": False}})
    client, fakes = _build(cfg, {"http://local/v1": _streams(_Chunk(_Delta("hi")))})
    _collect(client)
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["extra_body"] == {"stream_options": {"include_usage": False}}
    assert "stream_options" not in call


def test_complete_never_asks_for_stream_options():
    """A non-streamed request carrying `stream_options` is a hard 400 — the summarizer reads usage
    off its buffered response instead."""
    client, fakes = _build(_cfg(), {"http://local/v1": _completion("summary")})
    _complete(client)
    assert "stream_options" not in fakes["http://local/v1"].chat.completions.calls[0]


def test_a_stream_options_rejection_retries_once_without_it(caplog):
    class _Rejected(Exception):
        status_code = 400

    def behavior(kwargs):
        seen.append(kwargs)
        if "stream_options" in kwargs:
            raise _Rejected("Unrecognized request argument supplied: stream_options")
        return _Stream([_Chunk(_Delta("hi"))])

    seen: list[dict] = []
    client, _ = _build(_cfg(), {"http://local/v1": behavior})
    with caplog.at_level(logging.WARNING, logger="app.adapters.inference"):
        deltas = _collect(client)
    assert [d.text for d in deltas] == ["hi"]  # the turn survived; telemetry is what was dropped
    assert len(seen) == 2 and "stream_options" not in seen[1]  # ONE retry, without it
    assert "stream_options" in caplog.text  # one warning naming what was dropped


def _both_rejecting(order):
    """A backend that 400s on `stream_options` AND on the reasoning controls, rejecting them in
    `order` — the compound case a classify-once ladder could not survive (it only ever disabled one
    cause, so the second rejection killed the hop). Returns (behavior, seen-kwargs list)."""

    class _Rejected(Exception):
        status_code = 400

    seen: list[dict] = []

    def behavior(kwargs):
        seen.append(kwargs)
        for cause in order:
            if cause == "usage" and "stream_options" in kwargs:
                raise _Rejected("Unrecognized request argument supplied: stream_options")
            if cause == "reasoning" and "reasoning_effort" in kwargs:
                raise _Rejected("Unsupported parameter: 'reasoning_effort' is not supported with this model")
        return _Stream([_Chunk(_Delta("hi"))])

    return behavior, seen


def test_an_endpoint_rejecting_both_capabilities_still_serves_the_turn():
    """Both orders, because the classifier order and the rejection order are independent: each retry
    disables the cause it just classified, so the hop converges in at most three `create()`s."""
    for order in (("usage", "reasoning"), ("reasoning", "usage")):
        behavior, seen = _both_rejecting(order)
        client, _ = _build(_cfg(), {"http://local/v1": behavior})
        deltas = _collect(client, reasoning_effort="high")
        assert [d.text for d in deltas] == ["hi"], order
        assert len(seen) == 3, order  # the bound: one open per disabled cause, then the clean one
        assert "stream_options" not in seen[-1] and "reasoning_effort" not in seen[-1], order


def test_an_owner_set_stream_options_rejection_raises_instead_of_retrying(caplog):
    """The owner's own `extra_body` key is the one on the wire — we added nothing — so its rejection is
    their config surfacing and must propagate. Retrying would re-send the identical payload and log a
    warning about dropping a key we never set."""

    class _Rejected(Exception):
        status_code = 400

    seen: list[dict] = []

    def behavior(kwargs):
        seen.append(kwargs)
        raise _Rejected("Unrecognized request argument supplied: stream_options")

    cfg = _cfg(local_extra={"stream_options": {"include_usage": True}})
    client, _ = _build(cfg, {"http://local/v1": behavior})
    with caplog.at_level(logging.WARNING, logger="app.adapters.inference"):
        try:
            _collect(client)
        except InferenceError:
            pass
        else:
            raise AssertionError("the owner's rejected stream_options must not be swallowed")
    assert len(seen) == 1  # ONE open — no pointless identical re-attempt
    assert "usage capture" not in caplog.text


def test_a_rejection_that_neither_cause_explains_still_raises():
    """The loop must not spin on an error it cannot fix: an unrelated 400 raises on the first pass."""

    class _Rejected(Exception):
        status_code = 400

    seen: list[dict] = []

    def behavior(kwargs):
        seen.append(kwargs)
        raise _Rejected("Unsupported parameter: 'tool_choice' is not supported with this model")

    client, _ = _build(_cfg(), {"http://local/v1": behavior})
    try:
        _collect(client)
    except InferenceError:
        pass
    else:
        raise AssertionError("an unrelated 400 must not be swallowed")
    assert len(seen) == 1  # ONE attempt on this hop — no retry, straight to the next endpoint


def test_completion_tokens_and_the_served_model_are_captured():
    final = _Chunk(delta=None, usage=_usage(1200, cached=1024, completion=42), model="served-7b")
    client, _ = _build(_cfg(), {"http://local/v1": _streams(_Chunk(_Delta("hi")), final)})
    report = StreamReport()
    _collect(client, report=report)
    assert (report.prompt_tokens, report.completion_tokens, report.model) == (1200, 42, "served-7b")


def test_complete_captures_usage_off_the_buffered_response():
    resp = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="summary"))],
        usage=_usage(900, completion=40),
        model="summarizer-7b",
    )
    client, _ = _build(_cfg(), {"http://local/v1": lambda _kw: resp})
    report = StreamReport()
    assert _complete(client, report=report) == "summary"
    assert (report.prompt_tokens, report.completion_tokens, report.model) == (900, 40, "summarizer-7b")


# ── A8 measurement: the context-cost debug line ──
def _bare_session():
    """An `AgentSession` with only the fields `_log_context_cost` touches — no DB/registry/model."""
    from app.services.agent.session import AgentSession

    s = AgentSession.__new__(AgentSession)
    s._static_head = [{"role": "system", "content": "x" * 400}]  # ~100 tok
    s._tools_cache = [{"type": "function", "function": {"name": "ping", "parameters": {}}}]
    s._head_tokens = None
    s._tools_tokens = None
    s._agent = SimpleNamespace(name="default")
    return s


def test_context_cost_logs_estimate_and_telemetry(caplog):
    s = _bare_session()
    messages = list(s._static_head) + [{"role": "user", "content": "y" * 200}]
    report = StreamReport(prompt_tokens=1200, cached_tokens=1024)
    with caplog.at_level(logging.DEBUG, logger="app.services.agent.session"):
        s._log_context_cost(messages, report)
    assert "context-cost" in caplog.text
    assert "head" in caplog.text and "tools" in caplog.text  # the estimate breakdown
    assert "cached 1024" in caplog.text  # the telemetry rode along on the same line
    # cached tokens are cached once per turn — a second call reuses them.
    assert s._head_tokens is not None and s._tools_tokens is not None


def test_context_cost_handles_missing_telemetry(caplog):
    s = _bare_session()
    messages = list(s._static_head)
    with caplog.at_level(logging.DEBUG, logger="app.services.agent.session"):
        s._log_context_cost(messages, StreamReport())  # both fields None
    assert "not reported" in caplog.text


def test_context_cost_skipped_when_not_debug(caplog):
    s = _bare_session()
    with caplog.at_level(logging.INFO, logger="app.services.agent.session"):
        s._log_context_cost(list(s._static_head), StreamReport(prompt_tokens=10))
    # DEBUG-guarded: nothing logged, and the estimate work was skipped (caches stay unset).
    assert "context-cost" not in caplog.text
    assert s._head_tokens is None and s._tools_tokens is None


# ── ACA-21: _finalize retains the cached toolset with tool_choice="none" ──
class _RecInference:
    """Records the kwargs `_finalize` calls `stream_chat` with; yields one text delta."""

    def __init__(self):
        self.kw: dict | None = None

    def stream_chat(self, messages, **kw):
        self.kw = kw

        async def gen():
            yield ChatDelta(text="final answer")

        return gen()

    async def min_chain_window(self, _mode=None, _model=None):  # D60 — the clearing pressure gate
        return None  # no window → always-on clearing (the pre-D60 behaviour this test assumes)


def test_finalize_retains_toolset_with_tool_choice_none():
    from app.config import Settings
    from app.services.agent.session import AgentSession

    s = AgentSession.__new__(AgentSession)
    s._settings = Settings()  # the wrap-up nudge resolves off the live Settings (D56)
    s._stamps = {}  # …and records its template identity into the turn's accumulator (Slice 2)
    s._static_head = [{"role": "system", "content": "sys"}]
    s._tools_cache = [{"type": "function", "function": {"name": "ping", "parameters": {}}}]
    s._head_tokens = None
    s._tools_tokens = None
    s._reflect_now = False
    # `_finalize` now threads `self._agent.model.max_tokens`/`.reasoning_effort` (D42 W4) → give the
    # stub agent a `model` shape carrying the unset defaults.
    s._agent = SimpleNamespace(name="default", model=SimpleNamespace(max_tokens=None, reasoning_effort=None))
    rec = _RecInference()
    s._inference = rec

    async def _assemble(
        _thread, *, clearing=None
    ):  # D42 Codex FIX 2 — finalize now assembles net-of-clearing
        return list(s._static_head)

    s._assemble = _assemble

    async def _plan_clearing(_thread, **_kw):  # D42 Codex FIX 2 — finalize computes a clearing plan
        from app.services.agent.compaction import ClearingPlan

        return ClearingPlan(frozenset(), {})

    s._plan_clearing = _plan_clearing

    added: list = []
    s._messages = SimpleNamespace(add=lambda m: _aret(added.append(m)))
    s._threads = SimpleNamespace(touch=lambda *_a: _aret(None))
    thread = SimpleNamespace(id="t1")

    async def drain():
        return [ev async for ev in s._finalize(thread, None, None, ModelRef())]

    events = run_async(drain())
    # The wrap-up call keeps the SAME cached toolset (prefix stays cached) but forbids calls.
    assert rec.kw is not None
    assert rec.kw["tool_choice"] == "none"
    assert rec.kw["tools"] is s._tools_cache
    assert any(ev.event == "done" and ev.data.get("state") == "completed" for ev in events)


async def _aret(value):
    return value
