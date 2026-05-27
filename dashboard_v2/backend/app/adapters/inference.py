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

from dataclasses import dataclass
from typing import AsyncIterator

from openai import AsyncOpenAI

from app.config import InferenceCfg, InferenceEndpointCfg

# llama.cpp / many local servers ignore the key but the SDK requires a non-empty string.
_PLACEHOLDER_KEY = "sk-no-key-required"


class InferenceError(RuntimeError):
    """Any backend failure (unreachable, timeout, auth, bad response) — caught at the session."""


@dataclass
class ChatDelta:
    """One streamed increment. Exactly one field is non-empty per delta."""

    text: str = ""
    reasoning: str = ""


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

    async def stream_chat(
        self, messages: list[dict], *, mode: str | None = None
    ) -> AsyncIterator[ChatDelta]:
        """Stream a chat completion. `messages` is OpenAI shape ({role, content}).

        Yields `ChatDelta`s as tokens arrive. Raises `InferenceError` on any backend failure.
        """
        ep = self._cfg.endpoint(mode)
        client = self._client(ep)
        if not ep.model:
            raise InferenceError(f"no model configured for mode '{mode or self._cfg.default_mode}'")
        try:
            stream = await client.chat.completions.create(
                model=ep.model, messages=messages, stream=True
            )
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
        except InferenceError:
            raise
        except Exception as exc:  # noqa: BLE001 — normalize any SDK/transport error
            raise InferenceError(str(exc)) from exc
