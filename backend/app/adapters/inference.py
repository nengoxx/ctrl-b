"""OpenAI-compatible chat inference (DESIGN §7, RESEARCH "LLM backends").

One `AsyncOpenAI` client shape covers every backend — local llama.cpp and cloud differ only by
`base_url`/`api_key`/`model`. Clients are built lazily per base_url and cached. `stream_chat` yields
typed `ChatDelta`s so the agent loop stays agnostic of the SDK: `text` is answer content, `reasoning`
is a thinking model's chain-of-thought (llama.cpp exposes it as `reasoning_content`), streamed
separately so the UI can render it dimmed without polluting the saved answer.

Failover (D18): a request's selected endpoint delegates to an ordered chain (`config.endpoint_chain`)
on **any** error — the selected endpoint, then the other of local/cloud, then `inference.fallbacks`.
Streaming fails over at **initiation only** (the industry-standard "confirm the provider is alive with
a first token before committing"): `stream_chat` opens the stream + pulls the first chunk per endpoint;
once a chunk arrives we're committed (a mid-stream drop is a clean error, never a jarring restart). The
model override (an agent's `ModelRef.model`) applies to the *selected* endpoint only — fallbacks use
their own model (a local model id won't exist on a cloud backend). All reuses `core/failover.py`.

Failures (backend down, slow load timeout, auth, all-endpoints-failed) raise `InferenceError` — the
session boundary turns it into a clean SSE `error` event + an `ErrorPart`, never a stack trace.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, AsyncIterator, cast

import anyio
import httpx
from openai import AsyncOpenAI

from app.config import InferenceCfg, InferenceEndpointCfg
from app.core.failover import FailoverError, failover

if TYPE_CHECKING:  # SDK param type — only needed to satisfy the typed `.create()` overload
    from openai.types.chat import ChatCompletionMessageParam

log = logging.getLogger("ctrlb.inference")

# llama.cpp / many local servers ignore the key but the SDK requires a non-empty string.
_PLACEHOLDER_KEY = "sk-no-key-required"

#: The llama.cpp window probe (D42). `/props` is served at the SERVER ROOT, not under the OpenAI
#: `/v1` path, so the probe strips a trailing `/v1` off the base_url before appending this.
_PROPS_PATH = "/props"
#: Probe timeout — a few seconds, independent of `request_timeout_s` (a 10-minute thinking budget must
#: not stall the lazy window probe; a failed probe just memoizes None). Named, never inline (D42).
_PROBE_TIMEOUT_S = 3.0


def _props_url(base_url: str) -> str:
    """Turn an OpenAI-style base_url (usually `…/v1`) into the llama.cpp `/props` URL at the server
    root. Strips ONE trailing `/v1` (with any trailing slashes) then appends `/props`, so
    `http://host:5001/v1` → `http://host:5001/props` and a root-style `http://host:5001` still works."""
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return f"{root}{_PROPS_PATH}"


@dataclass(frozen=True)
class _ProbedWindow:
    """One memoized `/props` probe result (D42). `n_ctx` is the effective per-slot window
    (`default_generation_settings.n_ctx`) or `None` when the probe failed / the field was absent;
    `n_ctx_train` (`meta.n_ctx_train`) is the model's training context, kept as a sanity ceiling —
    an `n_ctx` above it is still honoured (upward overrides allowed) but logged. A failed probe is
    memoized as `_ProbedWindow(None, None)` too, so a dead endpoint is asked exactly once."""

    n_ctx: int | None
    n_ctx_train: int | None


class InferenceError(RuntimeError):
    """Any backend failure (unreachable, timeout, auth, bad response, all-endpoints-failed)."""


@dataclass
class StreamReport:
    """Optional out-param for `stream_chat`/`complete` so the session can surface failover degradation
    (D18): `served` is the endpoint name that answered (e.g. "cloud"); `degraded` is True when a
    fallback had to save us; `failures` carries each failed hop's error. Pass one to learn whether the
    request fell over — the failover primitive also logs it server-side regardless.

    Also the channel for prompt-cache telemetry (ACA-18): `prompt_tokens` is how many tokens the server
    prefilled this call and `cached_tokens` how many it reused from the prompt-prefix cache — read off
    the response wherever the endpoint reports it (llama.cpp `timings.prompt_n`/`cache_n`, streaming
    `prompt_progress`; OpenAI `usage.prompt_tokens`/`usage.prompt_tokens_details.cached_tokens`). `None`
    means the endpoint didn't report that number (e.g. a local server without `return_progress`, or a
    cloud one without `stream_options: {include_usage: true}`) — NOT a cache miss. The session logs it
    next to its A8 estimate so prefix cost + hit rate read together.

    `served_endpoint` (D42) is the endpoint OBJECT that actually answered (`chain[served_index][1]`) —
    distinct from `served` (its name): the session prices iteration 2+'s window-aware compaction
    trigger against the endpoint that served (its `context_window`/probe + the `prompt_tokens` anchor
    come from the same serve). `None` until a call completes."""

    served: str = ""
    degraded: bool = False
    failures: list[str] = field(default_factory=list)
    prompt_tokens: int | None = None
    cached_tokens: int | None = None
    served_endpoint: InferenceEndpointCfg | None = None


@dataclass
class ToolCallRequest:
    """One completed tool call the model asked for. `arguments` is the raw JSON string the model
    emitted — parsed + validated against the tool's `input_model` by the session (a malformed
    blob becomes an error result fed back, never a crash)."""

    id: str
    name: str
    arguments: str = ""


@dataclass
class ChatDelta:
    """One streamed increment. `text`/`reasoning` are per-token; `tool_calls` is the terminal
    delta carrying the fully-accumulated calls once the stream finishes (OpenAI streams them as
    index-keyed fragments, reassembled here)."""

    text: str = ""
    reasoning: str = ""
    tool_calls: list[ToolCallRequest] = field(default_factory=list)


#: A resolved chain entry: (name, endpoint, model-to-use). The model is the override for the selected
#: endpoint, else the endpoint's own — precomputed so failover attempts don't re-derive it.
_ChainEntry = tuple[str, InferenceEndpointCfg, str]


class InferenceClient:
    """Builds + caches one OpenAI client per base_url; streams chat completions as `ChatDelta`s, with
    a primary→fallback chain (D18) applied at stream initiation."""

    def __init__(self, cfg: InferenceCfg) -> None:
        self._cfg = cfg
        self._clients: dict[str, AsyncOpenAI] = {}
        #: Per-endpoint request gate (D40 rider). Lazily built, keyed on `(base_url, limit)` so a
        #: config hot-reload that CHANGES an endpoint's `max_concurrent_requests` mints a fresh
        #: semaphore under the new key — in-flight holders keep draining the old object, new requests
        #: queue on the new one. (A reconfigure also builds a whole new `InferenceClient`, so this dict
        #: is usually fresh anyway; the key still protects an in-place cfg swap.) `None` limit → no
        #: entry, no acquire (unlimited, zero behavior change).
        self._sems: dict[tuple[str, int], asyncio.Semaphore] = {}
        #: Memoized `/props` window probes, keyed by base_url (D42). Populated on first `probed_context_window`
        #: per URL — including FAILED probes (memoized as `_ProbedWindow(None, None)`), so a dead/cloud
        #: endpoint is hit at most once. No invalidation bookkeeping: `runtime.set_inference` rebuilds the
        #: whole `InferenceClient` on ANY inference-settings change, so a config edit re-probes for free.
        self._window_memo: dict[str, _ProbedWindow] = {}
        #: Lazily-built httpx client for the raw `/props` GET (the SDK is chat-only). Built on first probe,
        #: reused per-process like the SDK clients; not aclosed on rebuild (same as the SDK clients here).
        self._probe_http: httpx.AsyncClient | None = None

    def _probe_client(self) -> httpx.AsyncClient:
        if self._probe_http is None:
            self._probe_http = httpx.AsyncClient(timeout=_PROBE_TIMEOUT_S)
        return self._probe_http

    async def probed_context_window(self, ep: InferenceEndpointCfg) -> int | None:
        """The effective context window for `ep` as reported by the llama.cpp `/props` probe, or `None`
        when unavailable (probe failed, non-200, malformed body, no `n_ctx`, or a blank base_url). Lazy +
        memoized per base_url for the client's lifetime; NEVER raises (the `_capture_cache_telemetry`
        posture — a probe must not block or fail a turn). Endpoint-agnostic: it probes whatever base_url
        it is given (only meaningful for a local llama.cpp — cloud has no `/props` — but callers decide
        who to probe; the config>probe>fallback resolution policy lands in Wave 2)."""
        base_url = ep.base_url
        if not base_url:
            return None
        cached = self._window_memo.get(base_url)
        if cached is None:
            cached = await self._probe_props(base_url)
            self._window_memo[base_url] = cached
        return cached.n_ctx

    def _is_probe_eligible(self, ep: InferenceEndpointCfg) -> bool:
        """The ONE home for the D42 probe-eligibility rule: only the configured LOCAL llama.cpp
        endpoint is probed — cloud/OpenAI has no `/props` (verified), and `fallbacks` rely on their
        manual `context_window`. Matched by `base_url` against the live local endpoint, so it holds for
        BOTH the selected-endpoint object (iteration 1) and the served-endpoint object off the failover
        chain (iteration 2+) — they are the same configured endpoints. A blank local base_url makes
        nothing eligible."""
        local = self._cfg.local
        return bool(ep.base_url) and ep.base_url == local.base_url

    async def effective_window(self, ep: InferenceEndpointCfg) -> int | None:
        """Resolve `ep`'s effective context window per the D42 ladder — **config > probe > None**:
        the explicit `ep.context_window` wins (the owner runs the server and may set a value that
        exceeds the probe — the silent down-clamp is the recorded anti-pattern); else the probed
        `/props` `n_ctx` **only for the probe-eligible local llama.cpp** (`_is_probe_eligible` — one
        rule, one place); else `None` ⇒ the caller's `threshold_tokens` absolute-fallback trigger.
        Never raises (the probe swallows all failures to `None`)."""
        if ep.context_window is not None:
            return ep.context_window
        if self._is_probe_eligible(ep):
            return await self.probed_context_window(ep)
        return None

    async def _probe_props(self, base_url: str) -> _ProbedWindow:
        """GET `{root}/props` once and extract the window. NEVER raises — any exception / non-200 /
        malformed body ⇒ `_ProbedWindow(None, None)` (memoized by the caller, so no retry storm)."""
        url = _props_url(base_url)
        try:
            resp = await self._probe_client().get(url)
            if resp.status_code != 200:
                return _ProbedWindow(None, None)
            body = resp.json()
            gen = body.get("default_generation_settings") if isinstance(body, dict) else None
            meta = body.get("meta") if isinstance(body, dict) else None
            n_ctx = gen.get("n_ctx") if isinstance(gen, dict) else None
            n_ctx_train = meta.get("n_ctx_train") if isinstance(meta, dict) else None
            n_ctx = n_ctx if isinstance(n_ctx, int) and not isinstance(n_ctx, bool) else None
            n_ctx_train = (
                n_ctx_train if isinstance(n_ctx_train, int) and not isinstance(n_ctx_train, bool) else None
            )
            if n_ctx is not None and n_ctx_train is not None and n_ctx > n_ctx_train:
                # Upward overrides are allowed (the owner may raise the served window past the model's
                # training context), but it's worth a breadcrumb — an unexpectedly huge n_ctx is a smell.
                log.info("probe %s: n_ctx=%d exceeds n_ctx_train=%d (honoured)", url, n_ctx, n_ctx_train)
            return _ProbedWindow(n_ctx, n_ctx_train)
        except Exception:  # noqa: BLE001 — a window probe must NEVER fail or block a turn (D42)
            return _ProbedWindow(None, None)

    def _sem_for(self, ep: InferenceEndpointCfg) -> asyncio.Semaphore | None:
        """The request-gate semaphore for this endpoint, or `None` when unlimited. Built lazily on
        first use (inside a running loop, so the 3.14 `asyncio.Semaphore` binds to the right loop).

        LOW-1 caveat: the key is `(base_url, limit)`, so two DISTINCT endpoint entries that share a
        base_url but declare DIFFERENT `max_concurrent_requests` mint independent semaphores — their
        limits add, over-subscribing that backend. Unreachable in the shipped config (the chain is
        local + `cloud=None`, one entry per base_url) and keyed this way deliberately: a hot-reload
        that changes an endpoint's limit must NOT reuse the old-limit semaphore, so `limit` is part of
        the key on purpose. Coalesce on `base_url` alone only if a future config lets two live entries
        share one URL with different caps."""
        limit = ep.max_concurrent_requests
        if limit is None:
            return None
        key = (ep.base_url, limit)
        sem = self._sems.get(key)
        if sem is None:
            sem = asyncio.Semaphore(limit)
            self._sems[key] = sem
        return sem

    def _client(self, ep: InferenceEndpointCfg) -> AsyncOpenAI:
        if not ep.base_url:
            raise InferenceError("no inference base_url configured")
        if ep.base_url not in self._clients:
            self._clients[ep.base_url] = AsyncOpenAI(
                base_url=ep.base_url,
                api_key=ep.api_key or _PLACEHOLDER_KEY,
                timeout=self._cfg.request_timeout_s,
                max_retries=0,  # a 10-minute thinking call must not be silently retried
            )
        return self._clients[ep.base_url]

    def model_for(self, mode: str | None = None) -> str:
        return self._cfg.endpoint(mode).model

    def _resolve_chain(self, mode: str | None, model_override: str | None) -> list[_ChainEntry]:
        """The failover chain with the per-entry model resolved: the override applies to the *selected*
        (index 0) endpoint only; every fallback uses its own configured model."""
        return [
            (name, ep, (model_override if idx == 0 else None) or ep.model)
            for idx, (name, ep) in enumerate(self._cfg.endpoint_chain(mode))
        ]

    @staticmethod
    def _chunk_deltas(chunk: Any, pending: dict[int, dict[str, str]]) -> list[ChatDelta]:
        """Process one raw stream chunk → the `ChatDelta`s to yield, accumulating tool-call fragments
        (index-keyed id/name/arguments) into `pending`. Shared by the first probed chunk + the rest."""
        out: list[ChatDelta] = []
        if not chunk.choices:
            return out
        delta = chunk.choices[0].delta
        if delta is None:
            return out
        # Thinking models stream chain-of-thought separately; field name varies by server, so check
        # the typed attr and the SDK's passthrough `model_extra`.
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning is None and getattr(delta, "model_extra", None):
            reasoning = delta.model_extra.get("reasoning_content") or delta.model_extra.get("reasoning")
        if reasoning:
            out.append(ChatDelta(reasoning=reasoning))
        if delta.content:
            out.append(ChatDelta(text=delta.content))
        for tc in delta.tool_calls or []:
            slot = pending.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function and tc.function.name:
                slot["name"] = tc.function.name
            if tc.function and tc.function.arguments:
                slot["arguments"] += tc.function.arguments
        return out

    @staticmethod
    def _capture_cache_telemetry(chunk: Any, report: StreamReport | None) -> None:
        """Read prompt-cache telemetry off one stream chunk into `report` (ACA-18), wherever the
        endpoint reports it — cheap attribute reads, only the final chunk carries anything. Never
        raises + never issues an extra request; a field the backend didn't send just stays `None`.

        - OpenAI-style (cloud): the final chunk carries `usage` when `stream_options.include_usage`
          was sent — `usage.prompt_tokens` + `usage.prompt_tokens_details.cached_tokens`. (Note:
          OpenAI reports `cached_tokens == 0` below 1024 prompt tokens — that is the documented floor,
          not a cache failure.)
        - llama.cpp: non-standard `timings` (`prompt_n`/`cache_n`) or streaming `prompt_progress`
          (`total`/`cache`, gated on the endpoint's `return_progress`) ride the SDK passthrough
          `model_extra`."""
        if report is None:
            return
        usage = getattr(chunk, "usage", None)
        if usage is not None:
            pt = getattr(usage, "prompt_tokens", None)
            if isinstance(pt, int):
                report.prompt_tokens = pt
            details = getattr(usage, "prompt_tokens_details", None)
            ct = getattr(details, "cached_tokens", None)
            if isinstance(ct, int):
                report.cached_tokens = ct
        extra = getattr(chunk, "model_extra", None)
        if not isinstance(extra, dict):
            return
        timings = extra.get("timings")
        if isinstance(timings, dict):
            pn, cn = timings.get("prompt_n"), timings.get("cache_n")
            if isinstance(pn, int):
                report.prompt_tokens = pn
            if isinstance(cn, int):
                report.cached_tokens = cn
        progress = extra.get("prompt_progress")
        if isinstance(progress, dict):
            total, cache = progress.get("total"), progress.get("cache")
            if isinstance(total, int):
                report.prompt_tokens = total
            if isinstance(cache, int):
                report.cached_tokens = cache

    def _record(self, report: StreamReport | None, chain: list[_ChainEntry], result: Any) -> None:
        if report is not None:
            served = chain[result.served_index]
            report.served = served[0]
            # D42: stamp the endpoint OBJECT that actually answered — the session prices iteration 2+'s
            # window trigger against it (window + anchor from the same serve). One-line chokepoint add.
            report.served_endpoint = served[1]
            report.degraded = result.degraded
            report.failures = result.failures

    async def complete(
        self,
        messages: list[dict],
        *,
        mode: str | None = None,
        model: str | None = None,
        report: StreamReport | None = None,
    ) -> str:
        """Buffered (non-streaming) completion — used by the compactor's summarizer (4e), which wants
        the whole text at once. `mode`/`model` override the configured endpoint + model (the summarizer
        is separately selectable, D11). Walks the failover chain (buffered: each attempt returns the
        text). Raises `InferenceError` if every endpoint fails / none configured."""
        chain = self._resolve_chain(mode, model)
        if not chain:
            raise InferenceError("no inference endpoint configured")

        async def attempt(entry: _ChainEntry) -> str:
            name, ep, use_model = entry
            if not use_model:
                raise InferenceError(f"no model configured for '{name}'")
            # D40 rider: gate this endpoint per-attempt (the endpoint actually being called, inside the
            # failover chain — never around it). Buffered call: hold the permit for the whole request
            # and release in `finally`. The summarizer runs here AFTER the parent turn's stream closed
            # (its permit already released), so it never deadlocks against the parent at limit 1.
            sem = self._sem_for(ep)
            if sem is not None:
                await sem.acquire()
            try:
                # We carry messages as our own `list[dict]` (OpenAI wire shape, built across the loop);
                # cast to the SDK's param type at this boundary rather than retyping the whole loop.
                # Same per-endpoint `extra_body` merge as `stream_chat` (ACA-18): the summarizer's calls
                # deserve the cache pin too, and the pin must never leak across the failover chain. The
                # SDK's `create()` takes `extra_body` as a first-class param (None → omitted).
                resp = await self._client(ep).chat.completions.create(
                    model=use_model,
                    messages=cast("list[ChatCompletionMessageParam]", messages),
                    stream=False,
                    extra_body=ep.extra_body or None,
                )
                if not resp.choices:
                    raise InferenceError("inference returned no choices")
                return resp.choices[0].message.content or ""
            finally:
                if sem is not None:
                    sem.release()

        try:
            result = await failover(chain, attempt, label=lambda e: e[0])
        except FailoverError as exc:
            raise InferenceError(str(exc)) from exc
        self._record(report, chain, result)
        return result.value

    async def stream_chat(
        self,
        messages: list[dict],
        *,
        mode: str | None = None,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | None = None,
        report: StreamReport | None = None,
    ) -> AsyncIterator[ChatDelta]:
        """Stream a chat completion as per-token `ChatDelta`s, failing over at **stream initiation**.

        `messages` is OpenAI shape; `tools` is the optional function toolset. `tool_choice` overrides
        the default policy when `tools` are present (`None` → today's `"auto"`; e.g. `"none"` keeps the
        toolset in the prompt for cache stability while forbidding calls — ACA-21). `mode`/`model`
        select + override the endpoint (an `AgentDef` picks its own backend+model, D11). Each chain
        endpoint is
        probed by opening the stream + pulling its first chunk; the first that produces a chunk wins
        (failover at init — no token has reached the user yet). After that we iterate the rest with no
        further failover: a mid-stream drop raises `InferenceError` (can't restart a partial reply). Tool
        calls arrive as index-keyed fragments, reassembled and emitted as one terminal
        `ChatDelta(tool_calls=[...])`. Raises `InferenceError` if every endpoint fails / none configured.
        """
        chain = self._resolve_chain(mode, model)
        if not chain:
            raise InferenceError("no inference endpoint configured")
        kwargs: dict[str, Any] = {"messages": messages, "stream": True}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice or "auto"

        async def attempt(entry: _ChainEntry) -> tuple[Any, Any, asyncio.Semaphore | None]:
            name, ep, use_model = entry
            if not use_model:
                raise InferenceError(f"no model configured for '{name}'")
            # D40 rider: gate this endpoint per-attempt (the endpoint actually called, INSIDE the chain
            # — never around it). A streamed response holds its slot for the ENTIRE stream lifetime, so
            # the permit is HANDED to the consumer (returned as the 3rd tuple element) and released in
            # the outer generator's `finally` when the stream closes — NOT here. A failed attempt
            # (create error / dead first chunk / cancel during the probe) releases before failing over.
            sem = self._sem_for(ep)
            if sem is not None:
                await sem.acquire()
            try:
                # Merge this endpoint's `extra_body` PER-ENDPOINT, never into the shared `kwargs` — an
                # OpenAI backend 400s on unknown args, so the local endpoint's `cache_prompt`/`return_progress`
                # must not leak onto the cloud hop (ACA-18; same discipline as voice.py's extra_body).
                call_kwargs = {**kwargs, "extra_body": ep.extra_body} if ep.extra_body else kwargs
                stream = await self._client(ep).chat.completions.create(model=use_model, **call_kwargs)
                try:
                    first = await stream.__anext__()  # confirm the provider is alive + producing tokens
                except BaseException as exc:
                    # ANY first-read failure closes the backend stream BEFORE the permit is released
                    # by the outer handler below — incl. `CancelledError` (a BaseException; the old
                    # `except Exception` close let a cancel-during-probe leak the live generation) and
                    # the empty-stream case (Codex HIGH: close-before-release, see the finally below).
                    await _shielded_close(stream)
                    if isinstance(exc, StopAsyncIteration):
                        raise InferenceError("inference returned an empty stream") from exc
                    raise
            except BaseException:
                if sem is not None:
                    sem.release()  # permit not handed off → release before the next endpoint / raise
                raise
            return first, stream, sem

        try:
            result = await failover(chain, attempt, label=lambda e: e[0])
        except FailoverError as exc:
            raise InferenceError(str(exc)) from exc
        self._record(report, chain, result)

        first, stream, sem = result.value
        pending: dict[int, dict[str, str]] = {}
        try:
            self._capture_cache_telemetry(first, report)
            for delta in self._chunk_deltas(first, pending):
                yield delta
            async for chunk in stream:
                self._capture_cache_telemetry(chunk, report)
                for delta in self._chunk_deltas(chunk, pending):
                    yield delta
            if pending:
                yield ChatDelta(
                    tool_calls=[
                        ToolCallRequest(id=s["id"], name=s["name"], arguments=s["arguments"])
                        for _, s in sorted(pending.items())
                    ]
                )
        except InferenceError:
            raise
        except Exception as exc:  # noqa: BLE001 — a mid-stream error: normalize, no failover
            raise InferenceError(str(exc)) from exc
        finally:
            # D40 rider — the crux: release the request slot when the STREAM closes, riding this
            # generator's own lifetime, NOT the opener's return. The stream is consumed here (yielded
            # upward), so the permit is held across the whole response and freed on exhaustion, on a
            # mid-stream error, or on consumer `aclose()`/GC. Callers (`session._drive`) fully drain
            # this `async for` BEFORE running any tool / subagent fan-out, so the permit is provably
            # released before tool execution — no completion ever holds a slot across tools (no
            # hold-and-wait → no deadlock at limit 1, pinned by `test_inference_gate_d40`).
            #
            # CLOSE-BEFORE-RELEASE (Codex HIGH, 2026-07-19): on `aclose()`/cancel the backend is still
            # GENERATING — an abandoned stream occupies the real llama.cpp slot, so releasing the
            # permit first would admit a second request while the backend is busy, defeating
            # `max_concurrent_requests` exactly where it matters. Close to completion (shielded, so a
            # cancel can't interrupt the close and free the permit early), THEN release — the nested
            # finally guarantees the release even if the close path re-raises the in-flight cancel.
            try:
                await _shielded_close(stream)
            finally:
                if sem is not None:
                    sem.release()


async def _safe_close(stream: Any) -> None:
    """Best-effort close of an OpenAI stream that broke during the first-chunk probe."""
    try:
        await stream.close()
    except Exception:  # noqa: BLE001 — closing a broken stream is best-effort
        pass


async def _shielded_close(stream: Any) -> None:
    """Drive `_safe_close` to COMPLETION even under cancellation (Codex HIGH, 2026-07-19 — the D40
    request gate's close-before-release rule). An abandoned/cancelled stream still occupies the real
    backend slot until the HTTP response is closed, so the close must LAND before the caller releases
    the endpoint permit; an unshielded `await` here could be interrupted by the very cancel that
    triggered the cleanup, freeing the permit while the backend keeps generating. Same retained-task +
    `asyncio.shield` + second-await discipline as the session's `_persist_shielded` (both cancellation
    shapes defeated); `_safe_close` itself never raises, so the only re-raise out of here is an
    in-flight `CancelledError` — which the caller's release path must (and does) tolerate."""
    task = asyncio.ensure_future(_safe_close(stream))
    with anyio.CancelScope(shield=True):
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task  # the inner task is uncancellable by the outer cancel — let it finish
            raise
