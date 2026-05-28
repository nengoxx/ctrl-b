"""OpenAI-compatible chat inference (DESIGN §7, RESEARCH "LLM backends").

One `AsyncOpenAI` client shape covers every backend — local llama.cpp and cloud differ only by
`base_url`/`api_key`/`model`. Clients are built lazily per mode and cached. `stream_chat` yields
typed `ChatDelta`s so the agent loop stays agnostic of the SDK: `text` is answer content,
`reasoning` is a thinking model's chain-of-thought (llama.cpp exposes it as `reasoning_content`),
streamed separately so the UI can render it dimmed without polluting the saved answer.

Failures (backend down, slow load timeout, auth) raise `InferenceError` — the session boundary
turns it into a clean SSE `error` event + an `ErrorPart`, never a stack trace to the client.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from app.config import InferenceCfg, InferenceEndpointCfg

# llama.cpp / many local servers ignore the key but the SDK requires a non-empty string.
_PLACEHOLDER_KEY = "sk-no-key-required"


class InferenceError(RuntimeError):
    """Any backend failure (unreachable, timeout, auth, bad response) — caught at the session."""


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


class InferenceClient:
    """Builds + caches one OpenAI client per mode; streams chat completions as `ChatDelta`s."""

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

    async def complete(
        self,
        messages: list[dict],
        *,
        mode: str | None = None,
        model: str | None = None,
    ) -> str:
        """Buffered (non-streaming) completion — used by the compactor's summarizer (4e), which
        wants the whole text at once, not token deltas. `mode`/`model` override the configured
        endpoint + model (the summarizer is separately selectable from the chat model, D11); when
        either is `None` the endpoint's default is used. Raises `InferenceError` on any failure."""
        ep = self._cfg.endpoint(mode)
        client = self._client(ep)
        use_model = model or ep.model
        if not use_model:
            raise InferenceError(f"no model configured for mode '{mode or self._cfg.default_mode}'")
        try:
            resp = await client.chat.completions.create(
                model=use_model, messages=messages, stream=False
            )
        except InferenceError:
            raise
        except Exception as exc:  # noqa: BLE001 — normalize any SDK/transport error
            raise InferenceError(str(exc)) from exc
        if not resp.choices:
            raise InferenceError("inference returned no choices")
        return resp.choices[0].message.content or ""

    async def stream_chat(
        self,
        messages: list[dict],
        *,
        mode: str | None = None,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[ChatDelta]:
        """Stream a chat completion. `messages` is OpenAI shape; `tools` is the optional function
        toolset (the agent loop passes `registry.to_openai_tools(...)`). `mode`/`model` override the
        configured endpoint + model (an `AgentDef` selects its own backend+model, D11); when either
        is `None` the endpoint's default is used.

        Yields per-token `text`/`reasoning` deltas live. Tool calls arrive as index-keyed
        fragments, reassembled here and emitted as one terminal `ChatDelta(tool_calls=[...])`
        after the stream ends. Raises `InferenceError` on any backend failure.
        """
        ep = self._cfg.endpoint(mode)
        client = self._client(ep)
        use_model = model or ep.model
        if not use_model:
            raise InferenceError(f"no model configured for mode '{mode or self._cfg.default_mode}'")
        kwargs: dict[str, Any] = {"model": use_model, "messages": messages, "stream": True}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        # Accumulate tool-call fragments by their stream index; merge id/name/arguments deltas.
        pending: dict[int, dict[str, str]] = {}
        try:
            stream = await client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                # Thinking models stream chain-of-thought separately; field name varies by
                # server, so check the typed attr and the SDK's passthrough `model_extra`.
                reasoning = getattr(delta, "reasoning_content", None)
                if reasoning is None and getattr(delta, "model_extra", None):
                    reasoning = delta.model_extra.get("reasoning_content") or delta.model_extra.get(
                        "reasoning"
                    )
                if reasoning:
                    yield ChatDelta(reasoning=reasoning)
                if delta.content:
                    yield ChatDelta(text=delta.content)
                for tc in delta.tool_calls or []:
                    slot = pending.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function and tc.function.name:
                        slot["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        slot["arguments"] += tc.function.arguments
            if pending:
                yield ChatDelta(
                    tool_calls=[
                        ToolCallRequest(
                            id=slot["id"], name=slot["name"], arguments=slot["arguments"]
                        )
                        for _, slot in sorted(pending.items())
                    ]
                )
        except InferenceError:
            raise
        except Exception as exc:  # noqa: BLE001 — normalize any SDK/transport error
            raise InferenceError(str(exc)) from exc
