"""The unified provider registry (A11 / D48). Resolution, gate registry, chain construction.

This is the ONE place that turns the config-layer `providers` map + a consumer section's flat
`provider`+`fallbacks` into `tuple[ResolvedTarget, ...]` chains the adapters consume. Two explicit
policies (D48 C2):

- `resolve_strict(settings)` — for a PUT: any problem is a `RegistryError`; returns the `Registry` on
  success or the error list. `runtime` runs this on every PUT and raises a typed error (→ 422 in B2).
- `resolve_lenient(settings)` — for boot: warn + drop/promote per C5, always returns `(Registry, warnings)`.

It owns the `(gate_identity, limit)` D40 semaphore registry (`EndpointGates`, moved here from the
adapter, keeping its app-owned lifetime + generation-drain) and the effective-value ladders
(`max_tokens_field` C6, min-wins concurrency C4, provider-over-global retry). Adapters below `config.py`
never see live `Settings` — only `ResolvedTarget` + `SectionPolicy`.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from pydantic import SecretStr

from app.domain.provider import (
    ApiMode,
    EmbeddingsPolicy,
    MaxTokensField,
    ResolvedTarget,
    SectionPolicy,
    SttPolicy,
    TtsPolicy,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterable

    from app.config import ProviderCfg, SectionRef, Settings

log = logging.getLogger("ctrlb.provider_registry")

#: Backend-canonical composer BUILT-IN verbs (D48 C7/R9). A `/<name>` the composer parses to a
#: first-class action, NOT a provider selection — so a provider may NOT take one of these names (the PUT
#: 422s via the strict resolver). Precedence is built-ins > skills > providers. Note `/local` + `/cloud`
#: are RETIRED provider-mode verbs, NOT reserved — a provider may legally be named `local`/`cloud`.
RESERVED_VERBS: tuple[str, ...] = ("agent", "privilege", "priv", "clear", "compact", "help")


def is_reserved_verb(name: object) -> bool:
    """True if `name` is a backend-canonical built-in composer verb (`RESERVED_VERBS`). Used by the
    strict resolver to 422 a colliding provider name and by `GET /api/providers` to keep such a name out
    of the advertised `verbs` list (defense-in-depth — the PUT already rejects it)."""
    return isinstance(name, str) and name in RESERVED_VERBS


def provider_skill_collision_warnings(
    provider_names: "Iterable[str]", skill_names: "Iterable[str]"
) -> list[str]:
    """The ONE backend-canonical provider-name-shadowed-by-skill warning helper (D48 C7/R9). Precedence is
    built-ins > skills > providers, so a provider whose name equals a LATER-created skill loses the
    `/<name>` verb to the skill — a soft warning (no hard rejection against the moving skill set),
    recomputed LIVE against `app.state.skills` on every PUT response + `GET /api/providers`, never frozen
    at save time. Pure: the caller passes the current provider + skill name sets."""
    skills = set(skill_names)
    return [
        f"provider {p!r} is shadowed by a skill of the same name — the /{p} verb selects the skill "
        f"(precedence built-ins > skills > providers)"
        for p in provider_names
        if p in skills
    ]


def canonical_base_url(url: str) -> str:
    """The canonical form of a base_url = the D40 `gate_identity` (D48 C4): scheme+host lowercased,
    default ports elided (80/http, 443/https), trailing slash stripped, **path preserved** (different
    paths are different gates by design). Query/fragment dropped. Pure — no DNS, no network."""
    parts = urlsplit(url if "://" in url else f"http://{url}")
    scheme = (parts.scheme or "http").lower()
    host = (parts.hostname or "").lower()
    port = parts.port
    default = {"http": 80, "https": 443}.get(scheme)
    netloc = host if (port is None or port == default) else f"{host}:{port}"
    return f"{scheme}://{netloc}{parts.path.rstrip('/')}"


def _looks_self_hosted(base_url: str) -> bool:
    """Cheap, PURELY LEXICAL "does this base_url point at a server on my own machine/LAN?" (D45 audit
    FIX 5, moved here from the adapter). Loopback / private range / `.local` / a bare dotless hostname /
    any non-web port say self-hosted; `https://api.openai.com/v1` says cloud. Advisory only."""
    try:
        parts = urlsplit(base_url if "://" in base_url else f"http://{base_url}")
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return False
    if not host:
        return False
    if host == "localhost" or host.endswith(".local") or "." not in host.strip("[]"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if ip.is_loopback or ip.is_private:
            return True
    return port is not None and port not in (80, 443)


@dataclass(frozen=True)
class RegistryError:
    """A structured resolution error (D48 C2): a config `path` + a human `message`. `resolve_strict`
    returns a list of these; `runtime` raises them as a `ProviderResolveError` (→ 422 in wave B2)."""

    path: str
    message: str


class ProviderResolveError(Exception):
    """Typed carrier for a strict-resolution failure (D48 C2/R26). Raised by `runtime` on a PUT whose
    merged config fails `resolve_strict`; wave B2 maps it to a 422 with `.errors`. For now it surfaces as
    a 4xx (not a 500) via the existing settings handler."""

    def __init__(self, errors: list[RegistryError]) -> None:
        super().__init__("; ".join(f"{e.path}: {e.message}" for e in errors) or "provider resolution failed")
        self.errors = errors


class GateWaitTimeout(TimeoutError):
    """A bounded gate acquire gave up waiting for a permit (`EndpointGates.hold(wait_s=…)`). A
    `TimeoutError` subclass so anything already treating a timeout as a transport failure keeps working;
    carries its own message because `str(TimeoutError())` is empty and `failover()` renders the hop
    failure as `f"{label}: {exc}"`."""


class EndpointGates:
    """The app-owned registry of per-target request-gate semaphores (D40 rider; A11 moved this here from
    the adapter). Keyed by `(gate_identity, limit)` now (D48 C4) — the canonicalized base_url, so two
    aliased URLs of one server share ONE gate. Owned once on `app.state.endpoint_gates` and passed into
    every `InferenceClient` generation, so a settings PUT that rebuilds the client does NOT mint a second
    semaphore for the same target: old-generation permit holders + new-generation acquirers contend on
    the ONE object, and the cap is never split across generations. A CHANGED `limit` mints a fresh gate
    under the new key (old holders drain on the old semaphore). A client built without a registry gets a
    private instance — behaviourally identical to the old per-client dict."""

    def __init__(self) -> None:
        self._sems: dict[tuple[str, int], asyncio.Semaphore] = {}

    def sem_for(self, gate_identity: str, limit: int) -> asyncio.Semaphore:
        """The semaphore for `(gate_identity, limit)`, built lazily on first use INSIDE the running loop.
        Same key ⇒ the SAME object across every client generation (the cap is shared); a new limit ⇒ a
        fresh object."""
        key = (gate_identity, limit)
        sem = self._sems.get(key)
        if sem is None:
            sem = asyncio.Semaphore(limit)
            self._sems[key] = sem
        return sem

    @asynccontextmanager
    async def hold(self, target: ResolvedTarget, *, wait_s: float | None = None) -> "AsyncIterator[None]":
        """Hold `target`'s gate permit for the duration of the block — the ONE bounded-acquire seam for
        the buffered callers (voice + embeddings).

        An unlimited target (`max_concurrent_requests is None`, the common speaches/openrouter case)
        yields immediately with zero overhead. A finite cap acquires the shared `(gate_identity, limit)`
        semaphore and releases it on the way out, exception or not.

        `wait_s` bounds the WAIT for a permit (A11 pre-release audit MED; the condition the owner
        attached to ratifying D48 Slice-2 call ③). The wait happens *inside* the failover attempt, so an
        unbounded one cannot fail over: a provider serving chat + STT at cap 1 can park a mic
        transcription behind a ten-minute stream with a healthy fallback sitting idle. On timeout this
        raises `GateWaitTimeout`, which `failover()` treats as any other attempt failure — the chain
        advances to the next hop. `None` = wait forever (the streaming chat path, where queueing behind
        the previous turn on the same box IS the correct behaviour)."""
        limit = target.max_concurrent_requests
        if limit is None:
            yield
            return
        sem = self.sem_for(target.gate_identity, limit)
        if wait_s is None:
            await sem.acquire()
        else:
            try:
                await asyncio.wait_for(sem.acquire(), wait_s)
            except TimeoutError as exc:
                # `wait_for` cancels the pending `acquire()`, which releases its waiter cleanly (no
                # permit is consumed) — so a timed-out hop leaves the cap exactly as it found it.
                raise GateWaitTimeout(
                    f"no free request slot after {wait_s:g}s "
                    f"(server at cap {limit}; shared with every provider on {target.gate_identity})"
                ) from exc
        try:
            yield
        finally:
            sem.release()


def _target_identity(t: ResolvedTarget) -> tuple[str, str | None, str, str]:
    """Duplicate-target identity (D48 C5): (canonical base_url, credential identity [compared, NEVER
    logged], wire model id, api_mode)."""
    return (t.gate_identity, t.api_key.get_secret_value() if t.api_key else None, t.model, t.api_mode)


@dataclass(frozen=True)
class ResolvedProvider:
    """A resolved provider for `GET /api/providers` + `/verb` routing + ModelRef model-override (A11).
    `catalog` = the clean model names; `targets` = each catalog model resolved to a `ResolvedTarget`
    (so a `ModelRef.model` override picks the exact one); `bare` = the connection with an empty model
    (for an uncataloged raw-id override); `verb_target` = the `ResolvedTarget` a `/<provider>` verb
    selects (its first occurrence in the section chain, else its sole catalog model, else None ⇒ not
    verb-routable — a multi-model non-chain provider coerces to the default, D48 C7)."""

    name: str
    api_mode: ApiMode
    catalog: tuple[str, ...]
    targets: dict[str, ResolvedTarget]
    bare: ResolvedTarget | None
    verb_target: ResolvedTarget | None


@dataclass(frozen=True)
class Registry:
    """The immutable resolution output for a settings generation (A11/D48). Holds the resolved providers
    (for GET /api/providers + verb routing), each consumer section's default failover chain (post-lenient)
    + its frozen policy snapshot, and the lenient warning set. Adapters hold this (it is resolution
    output, not Settings): chat calls `chain_for(mode)`; voice/embeddings read their section chain+policy.
    The stt/tts/embeddings sections have NO failover toggle (D48 — voice chains always walk)."""

    providers: dict[str, ResolvedProvider]
    inference_chain: tuple[ResolvedTarget, ...]
    inference_policy: SectionPolicy
    warnings: tuple[str, ...] = ()
    #: Voice/embeddings section chains + their frozen policy snapshots (Slice 2). Empty chain =
    #: section unconfigured (mic hidden / embeddings off). Defaults keep `_reg.py`-style construction
    #: (inference-only test registries) valid.
    stt_chain: tuple[ResolvedTarget, ...] = ()
    stt_policy: SttPolicy = field(default_factory=SttPolicy)
    tts_chain: tuple[ResolvedTarget, ...] = ()
    tts_policy: TtsPolicy = field(default_factory=TtsPolicy)
    embeddings_chain: tuple[ResolvedTarget, ...] = ()
    embeddings_policy: EmbeddingsPolicy = field(default_factory=EmbeddingsPolicy)

    def chain_for(self, mode: str | None, model: str | None = None) -> tuple[ResolvedTarget, ...]:
        """The failover chain for a request (D48 C7/R10). `mode` is a PROVIDER NAME end-to-end; `model`
        is the `ModelRef.model` override (provider-relative clean name, or an uncataloged raw wire id).
        - `mode`+`model` both `None` → the section default chain.
        - `model` set but `mode` None → override the model on the section PRIMARY provider.
        - a known provider (via `mode` or the model-only primary) → the chosen target (its `model` when
          given, else its verb target) then the section chain minus it, deduped; failover off → `[chosen]`.
        - an unknown / non-routable provider → the section DEFAULT (coerced to default, logged) — which
          itself honors `failover` (off ⇒ the primary only). A coercion must NOT silently re-enable
          failover the operator turned off (C5/C7 — Codex#1)."""

        def _default() -> tuple[ResolvedTarget, ...]:
            # The section default chain, honoring `failover` (off ⇒ strictly the primary — the pre-A11
            # single-endpoint behavior). The ONE default-return shared by all three branches so a coerced
            # unknown/non-routable mode can never bypass `failover: false`.
            return self.inference_chain if self.inference_policy.failover else self.inference_chain[:1]

        prov_name = mode
        if not prov_name and model and self.inference_chain:
            prov_name = self.inference_chain[0].provider  # model-only override rides the primary provider
        if not prov_name:
            return _default()
        rp = self.providers.get(prov_name)
        if rp is None:
            log.info("mode %r is not a known provider — using the default inference chain", mode)
            return _default()
        if model:
            chosen = rp.targets.get(model) or (
                rp.bare.model_copy(update={"model": model}) if rp.bare else None
            )
        else:
            chosen = rp.verb_target
        if chosen is None:
            log.info(
                "provider %r cannot resolve a target for model %r — using the default chain", prov_name, model
            )
            return _default()
        if not self.inference_policy.failover:
            return (chosen,)
        # [chosen, *chain minus the chosen PROVIDER's occurrence] (R10): the chosen (with its resolved
        # model) replaces its provider's slot in-place order, so a model override on the primary keeps the
        # rest of the chain and a verb hoists that provider to the front.
        rest = tuple(t for t in self.inference_chain if t.provider != chosen.provider)
        return (chosen, *rest)


def _derive_max_tokens_field(api_mode: str) -> MaxTokensField:
    return "max_completion_tokens" if api_mode == "openai" else "max_tokens"


def _bare_target(
    pname: str, pcfg: "ProviderCfg", global_retry: int, gate_cap: dict[str, int | None]
) -> ResolvedTarget:
    """A provider's bare connection target (empty wire model) — the base for an uncataloged raw-id
    override (`chain_for(..., model=<raw>)`)."""
    gid = canonical_base_url(pcfg.base_url)
    retry = pcfg.retry_attempts if pcfg.retry_attempts is not None else global_retry
    return ResolvedTarget(
        provider=pname,
        base_url=pcfg.base_url,
        api_key=SecretStr(pcfg.api_key) if pcfg.api_key else None,
        api_mode=pcfg.api_mode,
        resolved_max_tokens_field=pcfg.max_tokens_field or _derive_max_tokens_field(pcfg.api_mode),
        model="",
        gate_identity=gid,
        max_concurrent_requests=gate_cap.get(gid),
        retry_attempts=retry,
    )


def _build_target(
    pname: str,
    pcfg: "ProviderCfg",
    model_name: str | None,
    global_retry: int,
    gate_cap: dict[str, int | None],
    *,
    path: str,
    errors: list[RegistryError],
    warnings: list[str],
    strict: bool,
) -> ResolvedTarget | None:
    """Resolve one `SectionRef`/primary into a `ResolvedTarget`, or None (with an error/warning) when the
    model can't be resolved. Applies the model-omission rule (C5), the uncataloged raw-id passthrough
    (C5), and the max_tokens_field ladder (C6). The effective concurrency cap comes from `gate_cap`
    (post min-wins, C4); the retry budget is provider-over-global (D43)."""
    catalog = pcfg.models
    if model_name is None:
        if len(catalog) == 1:
            model_name = next(iter(catalog))
        else:
            msg = f"provider {pname!r} has {len(catalog)} models; a model must be named"
            if strict:
                errors.append(RegistryError(path, msg))
            else:
                warnings.append(msg)
            return None
    model_cfg = catalog.get(model_name)
    if model_cfg is not None:
        wire_id = model_cfg.id or model_name
        ctx = model_cfg.context_window
        extra = dict(model_cfg.extra_body)
        mtf = model_cfg.max_tokens_field or pcfg.max_tokens_field or _derive_max_tokens_field(pcfg.api_mode)
        voice, speed, language, fmt, dim = (
            model_cfg.voice,
            model_cfg.speed,
            model_cfg.language,
            model_cfg.format,
            model_cfg.dim,
        )
    else:  # uncataloged raw-id passthrough (C5): no window, probe-eligible only on a llamacpp provider
        wire_id = model_name
        ctx = None
        extra = {}
        mtf = pcfg.max_tokens_field or _derive_max_tokens_field(pcfg.api_mode)
        voice = speed = language = fmt = dim = None
    gid = canonical_base_url(pcfg.base_url)
    retry = pcfg.retry_attempts if pcfg.retry_attempts is not None else global_retry
    return ResolvedTarget(
        provider=pname,
        base_url=pcfg.base_url,
        api_key=SecretStr(pcfg.api_key) if pcfg.api_key else None,
        api_mode=pcfg.api_mode,
        resolved_max_tokens_field=mtf,
        model=wire_id,
        context_window=ctx,
        extra_body=extra,
        language=language,
        voice=voice,
        speed=speed,
        format=fmt,
        dim=dim,
        gate_identity=gid,
        max_concurrent_requests=gate_cap.get(gid),
        retry_attempts=retry,
    )


def _compute_gate_caps(
    settings: "Settings", errors: list[RegistryError], warnings: list[str], *, strict: bool
) -> dict[str, int | None]:
    """The effective per-gate concurrency cap (D48 C4). Providers sharing a `gate_identity` must declare
    the same `max_concurrent_requests` (None ≠ any finite value): strict 422s a conflict, lenient takes
    the min of the finite declared values + warns; all-equal ⇒ that value; all-None ⇒ None (unlimited)."""
    declared: dict[str, list[int | None]] = {}
    for pcfg in settings.providers.values():
        if not pcfg.base_url:
            continue
        declared.setdefault(canonical_base_url(pcfg.base_url), []).append(pcfg.max_concurrent_requests)
    caps: dict[str, int | None] = {}
    for gid, decls in declared.items():
        if len(set(decls)) <= 1:
            caps[gid] = decls[0]
            continue
        finite = [d for d in decls if d is not None]
        caps[gid] = min(finite) if finite else None
        msg = (
            f"providers sharing gate identity {gid} declare conflicting max_concurrent_requests "
            f"{sorted(str(d) for d in set(decls))} — using {caps[gid]!r} (min of finite)"
        )
        if strict:
            errors.append(RegistryError(gid, msg))
        else:
            warnings.append(msg)
    return caps


def _validate_config_refs(
    settings: "Settings", errors: list[RegistryError], warnings: list[str], *, strict: bool
) -> set[str]:
    """Validate every CONFIG-HELD `ModelRef` home against the providers map (D48 C7-b / Codex#4). The
    closed home list is the SAME `walk_model_refs` cascade the rename uses — `agent.defaults.model`, the
    global + per-agent-defaults `compaction.summarizer`, `agent.defaults.routing.lead` — so a provider a
    PUT deletes but a summarizer/routing ref still points at is caught (422 strict) instead of persisting
    a dangling reference. A ref whose `provider` is set but NOT in `providers` (or with no base_url) is an
    ERROR; a set-provider + omitted-model on a multi-model provider is a WARNING only (chain_for coerces
    to the default at call time); a set model is always legal (cataloged OR uncataloged raw-id — C5).
    agent.yaml FILES stay graceful-degradation (C1) — this walks only the config.yaml `agent` subtree.

    RETURNS the set of provider names these CHAT ModelRefs name (blank/None skipped). The caller unions
    it with the `inference` section's own refs to get the chat-referenced set — the scope for
    chat-specific advisories. Returned from here rather than re-walked so `walk_model_refs`' closed home
    cascade stays the ONE source of truth for "which providers serve chat"."""
    from app.config import walk_model_refs  # runtime import (config imports no core → no cycle)

    named: set[str] = set()
    refs: list[dict] = []
    walk_model_refs(settings.model_dump(mode="python"), refs.append)
    for ref in refs:
        provider = ref.get("provider")
        if not isinstance(provider, str) or not provider:
            continue  # None/blank → inherit the section default; not a dangling ref
        named.add(provider)
        pcfg = settings.providers.get(provider)
        if pcfg is None or not pcfg.base_url:
            msg = f"agent ModelRef references provider {provider!r} which is not defined or has no base_url"
            (
                errors.append(RegistryError(f"agent (provider {provider})", msg))
                if strict
                else warnings.append(msg)
            )
            continue
        if ref.get("model") is None and len(pcfg.models) != 1:
            warnings.append(
                f"agent ModelRef for provider {provider!r} omits the model but the provider has "
                f"{len(pcfg.models)} models — resolves to the default chain at call time"
            )
    return named


def _build_section_chain(
    section: str,
    providers: "dict[str, ProviderCfg]",
    primary_provider: str | None,
    primary_model: str | None,
    fallbacks: "list[SectionRef]",
    global_retry: int,
    gate_cap: dict[str, int | None],
    *,
    errors: list[RegistryError],
    warnings: list[str],
    strict: bool,
) -> tuple[ResolvedTarget, ...]:
    """Build ONE consumer section's failover chain (A11/D48 R3): the ONE primitive shared by inference,
    voice.stt, voice.tts, embeddings. Steps, all per-section: primary (`_build_target`), fallbacks,
    blank-primary-with-fallbacks (strict 422 / lenient promote fb[0], runtime-only), the sole-catalog-model
    rule + uncataloged passthrough (inside `_build_target`), and duplicate-target dedup by identity WITHIN
    the section (C5 — the same target may legally appear in stt AND tts). An EMPTY chain (no configured
    provider) is legal: the section is simply unconfigured. Only BROKEN refs (a named provider missing / no
    base_url, an unresolvable model, a duplicate, a blank primary with fallbacks) fail strict."""

    def _cfg(ref_provider: str) -> "ProviderCfg | None":
        pcfg = providers.get(ref_provider)
        return pcfg if (pcfg is not None and pcfg.base_url) else None

    primary: ResolvedTarget | None = None
    if primary_provider:
        pcfg = _cfg(primary_provider)
        if pcfg is None:
            msg = f"{section} primary provider {primary_provider!r} not found or has no base_url"
            (errors.append(RegistryError(f"{section}.provider", msg)) if strict else warnings.append(msg))
        else:
            primary = _build_target(
                primary_provider,
                pcfg,
                primary_model,
                global_retry,
                gate_cap,
                path=section,
                errors=errors,
                warnings=warnings,
                strict=strict,
            )

    fb: list[ResolvedTarget] = []
    for i, ref in enumerate(fallbacks):
        pcfg = _cfg(ref.provider)
        if pcfg is None:
            msg = f"{section} fallback provider {ref.provider!r} not found or has no base_url"
            (
                errors.append(RegistryError(f"{section}.fallbacks[{i}]", msg))
                if strict
                else warnings.append(msg)
            )
            continue
        t = _build_target(
            ref.provider,
            pcfg,
            ref.model,
            global_retry,
            gate_cap,
            path=f"{section}.fallbacks[{i}]",
            errors=errors,
            warnings=warnings,
            strict=strict,
        )
        if t is not None:
            fb.append(t)

    # blank/absent primary with configured fallbacks (C5): strict 422 / lenient promote first
    if primary is None and fb:
        if strict:
            errors.append(
                RegistryError(
                    f"{section}.provider",
                    "primary provider is blank/invalid but fallbacks are configured",
                )
            )
        else:
            warnings.append(
                f"{section} primary blank/invalid — promoted the first valid fallback (runtime-only)"
            )
            primary, fb = fb[0], fb[1:]

    chain: list[ResolvedTarget] = []
    seen: set[tuple[str, str | None, str, str]] = set()
    for t in ([primary] if primary else []) + fb:
        ident = _target_identity(t)
        if ident in seen:
            msg = f"duplicate target {t.provider}/{t.model} in the {section} chain"
            (errors.append(RegistryError(section, msg)) if strict else warnings.append(msg))
            continue
        seen.add(ident)
        chain.append(t)
    return tuple(chain)


def _enforce_dim_agreement(
    chain: tuple[ResolvedTarget, ...], errors: list[RegistryError], warnings: list[str], *, strict: bool
) -> tuple[ResolvedTarget, ...]:
    """Embeddings dim agreement (D48 C8): among the chain's targets carrying a non-null `dim`, all must
    AGREE — a mixed-dimension chain would corrupt a vector store on failover. Strict: a `RegistryError`.
    Lenient: keep the FIRST non-null dim, DROP the mismatched targets, and warn. Targets with no declared
    dim ride through either way (the dim is revealed at first embed)."""
    dims = [t.dim for t in chain if t.dim is not None]
    if len(dims) <= 1 or all(d == dims[0] for d in dims):
        return chain
    first = dims[0]
    msg = f"embeddings chain declares conflicting vector dims {sorted(set(dims))} — keeping {first}"
    if strict:
        errors.append(RegistryError("embeddings", msg))
        return chain  # best-effort; the strict error already blocks the PUT
    warnings.append(msg + " (dropped mismatched targets)")
    return tuple(t for t in chain if t.dim is None or t.dim == first)


def _resolve(settings: "Settings", *, strict: bool) -> tuple[Registry, list[RegistryError], list[str]]:
    """The shared resolver. Builds a best-effort `Registry`, collecting `errors` (strict) / `warnings`
    (lenient). `resolve_strict`/`resolve_lenient` wrap it."""
    errors: list[RegistryError] = []
    warnings: list[str] = []
    inf = settings.inference
    gate_cap = _compute_gate_caps(settings, errors, warnings, strict=strict)
    modelref_providers = _validate_config_refs(settings, errors, warnings, strict=strict)
    # The CHAT-referenced set: the `inference` section's own refs + every config-held ModelRef home.
    # Chat-specific advisories are scoped to this (see the api_mode advisory below).
    chat_referenced = ({inf.provider} | {f.provider for f in inf.fallbacks} | modelref_providers) - {None, ""}

    # ── reserved-verb collision (C7): a provider named like a built-in composer verb is a hard error on
    #    a PUT (strict) / a boot warning (lenient). The skill-shadow collision is SOFT + computed live in
    #    the API layer (needs app.state.skills), not here. ──
    for pname in settings.providers:
        if is_reserved_verb(pname):
            msg = f"provider name {pname!r} collides with a reserved built-in verb {RESERVED_VERBS}"
            (errors.append(RegistryError(f"providers.{pname}", msg)) if strict else warnings.append(msg))

    # ── catalog-key-shadows-wire-id (C2/D48 Codex#13): within ONE provider, a model clean KEY equal to a
    #    DIFFERENT model's wire id is ambiguous — a `/verb`/ModelRef to that name selects the CLEAN model
    #    (sends the other's raw id), never the raw wire id it happens to spell. A stable non-fatal warning
    #    in BOTH lifecycles (PUT envelope + GET /api/providers). Example {foo:{id:bar}, bar:{id:baz}}. ──
    for pname, pcfg in settings.providers.items():
        wire_of = {mname: (mcfg.id or mname) for mname, mcfg in pcfg.models.items()}
        for mname in pcfg.models:
            shadowed = [other for other, wid in wire_of.items() if other != mname and wid == mname]
            if shadowed:
                warnings.append(
                    f"provider {pname!r}: model clean name {mname!r} also spells the wire id of model "
                    f"{shadowed[0]!r} — a reference to {mname!r} selects the clean model, not that raw id"
                )

    # ── the api_mode-default self-hosted advisory (moved from warn_suspect_api_modes) ──
    #    SCOPED TO CHAT-REFERENCED PROVIDERS ONLY (research R3): the advice is about `reasoning_effort`,
    #    which only a chat consumer ever sends — firing it at a voice/embeddings-only endpoint (a whisper
    #    or TTS box is legitimately `api_mode: openai`) warns about SUSPECTED, not PROVEN, inertness. The
    #    field-wide rule is to warn at the REFERENCE site, never at declaration; a declaration referenced
    #    by no chat consumer is silent. `api_mode` is the wire DIALECT — role comes from the section.
    for pname, pcfg in settings.providers.items():
        if pname not in chat_referenced:
            continue
        if pcfg.base_url and pcfg.api_mode == "openai" and _looks_self_hosted(pcfg.base_url):
            warnings.append(
                f"provider {pname!r} (base_url={pcfg.base_url}) uses the default api_mode 'openai' but "
                f"looks self-hosted — llama-server IGNORES reasoning_effort, so the reasoning ladder is a "
                f"NO-OP there. If it is llama.cpp, set api_mode: llamacpp (D45/D46)."
            )

    # ── inference chain (the shared section-chain primitive; R3) ──
    chain = list(
        _build_section_chain(
            "inference",
            settings.providers,
            inf.provider,
            inf.model,
            inf.fallbacks,
            inf.retry_attempts,
            gate_cap,
            errors=errors,
            warnings=warnings,
            strict=strict,
        )
    )

    # ── voice + embeddings section chains (R3). No section-level failover toggle (voice always walks);
    #    they carry NO global retry (failover_collect walks, it does not same-endpoint retry). ──
    stt, tts = settings.voice.stt, settings.voice.tts
    stt_chain = _build_section_chain(
        "voice.stt",
        settings.providers,
        stt.provider,
        stt.model,
        stt.fallbacks,
        0,
        gate_cap,
        errors=errors,
        warnings=warnings,
        strict=strict,
    )
    tts_chain = _build_section_chain(
        "voice.tts",
        settings.providers,
        tts.provider,
        tts.model,
        tts.fallbacks,
        0,
        gate_cap,
        errors=errors,
        warnings=warnings,
        strict=strict,
    )
    emb = settings.embeddings
    embeddings_chain = _build_section_chain(
        "embeddings",
        settings.providers,
        emb.provider,
        emb.model,
        emb.fallbacks,
        0,
        gate_cap,
        errors=errors,
        warnings=warnings,
        strict=strict,
    )
    embeddings_chain = _enforce_dim_agreement(embeddings_chain, errors, warnings, strict=strict)

    # ── resolved providers (GET /api/providers + verb routing) ──
    chain_by_provider: dict[str, ResolvedTarget] = {}
    for t in chain:
        chain_by_provider.setdefault(t.provider, t)
    resolved_providers: dict[str, ResolvedProvider] = {}
    for pname, pcfg in settings.providers.items():
        catalog = tuple(pcfg.models.keys())
        # Resolve every catalog model (best-effort, no error pollution) so a ModelRef.model override can
        # pick the exact one; a chain occurrence's target is reused so identity dedup stays consistent.
        targets: dict[str, ResolvedTarget] = {}
        for mname in pcfg.models:
            t = chain_by_provider.get(pname)
            if t is None or t.provider != pname or (t.model != (pcfg.models[mname].id or mname)):
                t = _build_target(
                    pname,
                    pcfg,
                    mname,
                    inf.retry_attempts,
                    gate_cap,
                    path=f"providers.{pname}",
                    errors=[],
                    warnings=[],
                    strict=False,
                )
            if t is not None:
                targets[mname] = t
        bare = _bare_target(pname, pcfg, inf.retry_attempts, gate_cap) if pcfg.base_url else None
        vt = chain_by_provider.get(pname)
        if vt is None and pcfg.base_url and len(pcfg.models) == 1:
            vt = next(
                iter(targets.values()), None
            )  # sole-model non-chain provider is still verb-routable (C7)
        resolved_providers[pname] = ResolvedProvider(
            name=pname, api_mode=pcfg.api_mode, catalog=catalog, targets=targets, bare=bare, verb_target=vt
        )

    policy = SectionPolicy(
        request_timeout_s=inf.request_timeout_s, failover=inf.failover, retry_attempts=inf.retry_attempts
    )
    stt_policy = SttPolicy(
        language=stt.language,
        vad_filter=stt.vad_filter,
        hotwords=stt.hotwords,
        connect_timeout_s=stt.connect_timeout_s,
        timeout_s=stt.timeout_s,
        extra_body=dict(stt.extra_body),
    )
    tts_policy = TtsPolicy(
        format=tts.format,
        connect_timeout_s=tts.connect_timeout_s,
        timeout_s=tts.timeout_s,
        extra_body=dict(tts.extra_body),
    )
    embeddings_policy = EmbeddingsPolicy(timeout_s=emb.timeout_s)
    registry = Registry(
        providers=resolved_providers,
        inference_chain=tuple(chain),
        inference_policy=policy,
        warnings=tuple(warnings),
        stt_chain=stt_chain,
        stt_policy=stt_policy,
        tts_chain=tts_chain,
        tts_policy=tts_policy,
        embeddings_chain=embeddings_chain,
        embeddings_policy=embeddings_policy,
    )
    return registry, errors, warnings


def resolve_strict(settings: "Settings") -> Registry | list[RegistryError]:
    """Strict resolution for a PUT (D48 C2): the `Registry` on success, else the list of `RegistryError`.
    Any missing provider, unresolvable model, duplicate target, gate conflict, or blank-primary-with-
    fallbacks is an error (→ 422 in wave B2)."""
    registry, errors, _ = _resolve(settings, strict=True)
    return errors if errors else registry


def resolve_lenient(settings: "Settings") -> tuple[Registry, list[str]]:
    """Lenient resolution for boot (D48 C2/C5): always returns `(Registry, warnings)` — drops/promotes
    per C5, takes min-of-finite on a gate conflict, and surfaces every non-fatal notice as a warning."""
    registry, _, warnings = _resolve(settings, strict=False)
    return registry, warnings
