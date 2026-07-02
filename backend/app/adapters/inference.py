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

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, AsyncIterator, cast

from openai import AsyncOpenAI

from app.config import InferenceCfg, InferenceEndpointCfg
from app.core.failover import FailoverError, failover

if TYPE_CHECKING:  # SDK param type — only needed to satisfy the typed `.create()` overload
    from openai.types.chat import ChatCompletionMessageParam

# llama.cpp / many local servers ignore the key but the SDK requires a non-empty string.
_PLACEHOLDER_KEY = "sk-no-key-required"


class InferenceError(RuntimeError):
    """Any backend failure (unreachable, timeout, auth, bad response, all-endpoints-failed)."""


@dataclass
class StreamReport:
    """Optional out-param for `stream_chat`/`complete` so the session can surface failover degradation
    (D18): `served` is the endpoint name that answered (e.g. "cloud"); `degraded` is True when a
    fallback had to save us; `failures` carries each failed hop's error. Pass one to learn whether the
    request fell over — the failover primitive also logs it server-side regardless."""

    served: str = ""
    degraded: bool = False
    failures: list[str] = field(default_factory=list)


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

    def _record(self, report: StreamReport | None, chain: list[_ChainEntry], result: Any) -> None:
        if report is not None:
            report.served = chain[result.served_index][0]
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
            # We carry messages as our own `list[dict]` (OpenAI wire shape, built across the loop);
            # cast to the SDK's param type at this boundary rather than retyping the whole loop.
            resp = await self._client(ep).chat.completions.create(
                model=use_model,
                messages=cast("list[ChatCompletionMessageParam]", messages),
                stream=False,
            )
            if not resp.choices:
                raise InferenceError("inference returned no choices")
            return resp.choices[0].message.content or ""

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
        report: StreamReport | None = None,
    ) -> AsyncIterator[ChatDelta]:
        """Stream a chat completion as per-token `ChatDelta`s, failing over at **stream initiation**.

        `messages` is OpenAI shape; `tools` is the optional function toolset. `mode`/`model` select +
        override the endpoint (an `AgentDef` picks its own backend+model, D11). Each chain endpoint is
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
            kwargs["tool_choice"] = "auto"

        async def attempt(entry: _ChainEntry) -> tuple[Any, Any]:
            name, ep, use_model = entry
            if not use_model:
                raise InferenceError(f"no model configured for '{name}'")
            stream = await self._client(ep).chat.completions.create(model=use_model, **kwargs)
            try:
                first = await stream.__anext__()  # confirm the provider is alive + producing tokens
            except StopAsyncIteration as exc:
                raise InferenceError("inference returned an empty stream") from exc
            except Exception:
                await _safe_close(stream)  # broken on first read → release it before failing over
                raise
            return first, stream

        try:
            result = await failover(chain, attempt, label=lambda e: e[0])
        except FailoverError as exc:
            raise InferenceError(str(exc)) from exc
        self._record(report, chain, result)

        first, stream = result.value
        pending: dict[int, dict[str, str]] = {}
        try:
            for delta in self._chunk_deltas(first, pending):
                yield delta
            async for chunk in stream:
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


async def _safe_close(stream: Any) -> None:
    """Best-effort close of an OpenAI stream that broke during the first-chunk probe."""
    try:
        await stream.close()
    except Exception:  # noqa: BLE001 — closing a broken stream is best-effort
        pass
