"""OpenAI-compatible embeddings client (Phase 4f, D9).

A thin async wrapper over an `/v1/embeddings` endpoint — local llama.cpp or a cloud provider
(verified live against OpenRouter `qwen/qwen3-embedding-4b`). Same `AsyncOpenAI` client shape as the
chat `InferenceClient`; built lazily and cached. `embed()` returns one vector per input text.

There's no consumer yet — the vector `MemoryProvider` + semantic search land in Phase 7 (DESIGN §6).
This is the seam they plug into: a configured, tested embeddings backend on `Deps`. Failures raise
`EmbeddingsError`, which a caller turns into graceful degradation (skip recall), never a crash.
"""

from __future__ import annotations

from openai import AsyncOpenAI

from app.config import EmbeddingsCfg

_PLACEHOLDER_KEY = "sk-no-key-required"  # local servers ignore it; the SDK needs a non-empty string


class EmbeddingsError(RuntimeError):
    """Any embeddings-backend failure (unreachable, auth, bad response) — caught by the caller."""


class EmbeddingsClient:
    def __init__(self, cfg: EmbeddingsCfg) -> None:
        self._cfg = cfg
        self._client: AsyncOpenAI | None = None

    @property
    def configured(self) -> bool:
        return bool(self._cfg.enabled and self._cfg.base_url and self._cfg.model)

    @property
    def model(self) -> str:
        return self._cfg.model

    @property
    def dim(self) -> int | None:
        return self._cfg.dim

    def _http(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                base_url=self._cfg.base_url,
                api_key=self._cfg.api_key or _PLACEHOLDER_KEY,
                timeout=self._cfg.timeout_s,
                max_retries=0,
            )
        return self._client

    async def embed(self, texts: list[str] | str, *, model: str | None = None) -> list[list[float]]:
        """Embed one or more texts → one vector each (input order preserved). Raises
        `EmbeddingsError` if unconfigured or on any backend failure."""
        if not self.configured:
            raise EmbeddingsError("embeddings backend is not configured")
        items = [texts] if isinstance(texts, str) else list(texts)
        if not items:
            return []
        try:
            resp = await self._http().embeddings.create(model=model or self._cfg.model, input=items)
        except EmbeddingsError:
            raise
        except Exception as exc:  # noqa: BLE001 — normalize any SDK/transport error
            raise EmbeddingsError(str(exc)) from exc
        # The API may return items out of order; sort by `index` to match input order.
        ordered = sorted(resp.data, key=lambda d: getattr(d, "index", 0))
        return [list(d.embedding) for d in ordered]

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
