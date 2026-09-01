"""A11/D48 test helpers: build a resolved `Registry` + `ResolvedTarget`s directly, so inference-adapter
tests don't need to round-trip a full `Settings`. Mirrors the shape the real resolver produces (a chain
of targets + a per-provider `ResolvedProvider`), keyed by provider name for chain labels/verbs."""

from __future__ import annotations

from typing import Any

from pydantic import SecretStr

from app.core.provider_registry import Registry, ResolvedProvider, canonical_base_url
from app.domain.provider import ResolvedTarget, SectionPolicy


def target(
    provider: str,
    base_url: str,
    model: str = "m",
    *,
    api_mode: str = "openai",
    api_key: str | None = None,
    max_concurrent_requests: int | None = None,
    retry_attempts: int | None = 2,
    context_window: int | None = None,
    extra_body: dict[str, Any] | None = None,
    input_modalities: list[str] | None = None,
    max_tokens_field: str | None = None,
    language: str | None = None,
    voice: str | None = None,
    speed: float | None = None,
    fmt: str | None = None,
    dim: int | None = None,
) -> ResolvedTarget:
    mtf = max_tokens_field or ("max_completion_tokens" if api_mode == "openai" else "max_tokens")
    return ResolvedTarget(
        provider=provider,
        base_url=base_url,
        api_key=SecretStr(api_key) if api_key else None,
        api_mode=api_mode,  # type: ignore[arg-type]
        resolved_max_tokens_field=mtf,  # type: ignore[arg-type]
        model=model,
        context_window=context_window,
        extra_body=extra_body or {},
        input_modalities=input_modalities,  # D68 §5: None = text-only, the conservative default
        language=language,
        voice=voice,
        speed=speed,
        format=fmt,
        dim=dim,
        gate_identity=canonical_base_url(base_url),
        max_concurrent_requests=max_concurrent_requests,
        retry_attempts=retry_attempts,
    )


def registry(
    targets: list[ResolvedTarget],
    *,
    failover: bool = True,
    request_timeout_s: float = 600.0,
    retry_attempts: int = 2,
) -> Registry:
    """A `Registry` whose inference chain is exactly `targets` (blank/dedup already applied by the caller).
    Each distinct provider becomes a `ResolvedProvider` catalog of its own targets; the verb target is the
    provider's FIRST occurrence in the chain (matching the resolver)."""
    chain = tuple(targets)
    first_by_prov: dict[str, ResolvedTarget] = {}
    cat: dict[str, dict[str, ResolvedTarget]] = {}
    for t in chain:
        first_by_prov.setdefault(t.provider, t)
        cat.setdefault(t.provider, {})[t.model] = t
    providers = {
        p: ResolvedProvider(
            name=p,
            api_mode=first_by_prov[p].api_mode,
            catalog=tuple(cat[p]),
            targets=cat[p],
            bare=first_by_prov[p],
            verb_target=first_by_prov[p],
        )
        for p in first_by_prov
    }
    policy = SectionPolicy(
        request_timeout_s=request_timeout_s, failover=failover, retry_attempts=retry_attempts
    )
    return Registry(providers=providers, inference_chain=chain, inference_policy=policy, warnings=())
