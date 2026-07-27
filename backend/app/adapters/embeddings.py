"""OpenAI-compatible embeddings client with failover over a resolved target chain (Phase 4f, D9 / A11).

A thin async wrapper over `/v1/embeddings` (local llama.cpp or a cloud provider — verified live against
OpenRouter `qwen/qwen3-embedding-4b`). Same `AsyncOpenAI` shape as the chat/voice adapters. A11/D48
Slice 2 re-keys it onto a `tuple[ResolvedTarget, ...]` chain + a frozen `EmbeddingsPolicy`, so embeddings
gains failover for free and never reads live `Settings` (C10). One SDK client is cached per provider name
(they die with the generation — drain).

There's no consumer yet — the vector `MemoryProvider` + semantic search land in Phase 7 (DESIGN §6). This
is the seam they plug into. Failures raise `EmbeddingsError`, which a caller turns into graceful
degradation (skip recall), never a crash.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from openai import AsyncOpenAI

from app.core.failover import FailoverError, failover_collect
from app.core.provider_registry import EndpointGates

if TYPE_CHECKING:
    from contextlib import AbstractAsyncContextManager

    from app.domain.provider import EmbeddingsPolicy, ResolvedTarget

_PLACEHOLDER_KEY = "sk-no-key-required"  # local servers ignore it; the SDK needs a non-empty string


class EmbeddingsError(RuntimeError):
    """Any embeddings-backend failure (unreachable, auth, bad response) — caught by the caller."""


class EmbeddingsClient:
    """Runs `embed` through the resolved chain (primary → fallbacks) via `core.failover`. `enabled` is
    passed in at construction (frozen per generation, R11) alongside the chain + policy. `dim` is the
    chain's agreed vector dimension (the resolver enforced agreement, C8)."""

    def __init__(
        self,
        chain: "tuple[ResolvedTarget, ...]",
        policy: "EmbeddingsPolicy",
        gates: EndpointGates | None = None,
        *,
        enabled: bool = True,
    ) -> None:
        self._chain = chain
        self._policy = policy
        self._enabled = enabled
        self._gates = gates if gates is not None else EndpointGates()
        self._clients: dict[str, AsyncOpenAI] = {}  # cached per provider name; die with the generation
        self._inflight = 0
        self._retired = False

    @property
    def configured(self) -> bool:
        return bool(self._enabled and self._chain)

    @property
    def model(self) -> str:
        """The PRIMARY target's wire model id (empty when unconfigured)."""
        return self._chain[0].model if self._chain else ""

    @property
    def dim(self) -> int | None:
        """The chain's agreed vector dimension — the first non-null `dim` across targets (the resolver
        already enforced agreement / dropped mismatches, C8). None ⇒ revealed at first embed."""
        for t in self._chain:
            if t.dim is not None:
                return t.dim
        return None

    def _client(self, target: "ResolvedTarget") -> AsyncOpenAI:
        if target.provider not in self._clients:
            self._clients[target.provider] = AsyncOpenAI(
                base_url=target.base_url,
                api_key=(target.api_key.get_secret_value() if target.api_key else "") or _PLACEHOLDER_KEY,
                timeout=self._policy.timeout_s,
                max_retries=0,
            )
        return self._clients[target.provider]

    def _gate(self, target: "ResolvedTarget") -> "AbstractAsyncContextManager[None]":
        """The shared D40 request gate for this target (`EndpointGates.hold`), so an embed contends on
        the same cap as chat/voice on that server. The wait is bounded by `timeout_s` — the section has
        no separate connect budget, and `timeout_s` is the whole-request window, so waiting longer than
        one entire request for a *slot* means this hop is saturated and the chain should fall over (A11
        pre-release audit MED). Unlimited targets cost nothing."""
        return self._gates.hold(target, wait_s=self._policy.timeout_s)

    async def embed(self, texts: list[str] | str, *, model: str | None = None) -> list[list[float]]:
        """Embed one or more texts → one vector each (input order preserved). Walks the chain on any
        error (failover). Raises `EmbeddingsError` if unconfigured or if every target failed."""
        if not self.configured:
            raise EmbeddingsError("embeddings backend is not configured")
        items = [texts] if isinstance(texts, str) else list(texts)
        if not items:
            return []
        self._inflight += 1
        try:

            async def attempt(target: "ResolvedTarget") -> list[list[float]]:
                async with self._gate(target):
                    resp = await self._client(target).embeddings.create(
                        model=model or target.model, input=items
                    )
                # The API may return items out of order; sort by `index` to match input order.
                ordered = sorted(resp.data, key=lambda d: getattr(d, "index", 0))
                return [list(d.embedding) for d in ordered]

            try:
                result = await failover_collect(self._chain, attempt, label=lambda t: t.provider)
            except FailoverError as exc:
                raise EmbeddingsError(str(exc)) from exc
            return result.value
        finally:
            await self._release_inflight()

    async def _close_clients(self) -> None:
        for client in list(self._clients.values()):
            try:
                await client.close()
            except Exception:  # noqa: BLE001 — best-effort
                pass
        self._clients.clear()

    async def _release_inflight(self) -> None:
        self._inflight -= 1
        if self._retired and self._inflight <= 0:
            await self._close_clients()

    async def retire(self) -> None:
        """Retire this generation (R5): close idle clients now, else defer to the last in-flight embed."""
        self._retired = True
        if self._inflight <= 0:
            await self._close_clients()

    async def aclose(self) -> None:
        """Shutdown close (main.py lifespan)."""
        await self._close_clients()
