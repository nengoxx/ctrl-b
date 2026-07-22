"""A11/D48 — the unified provider registry resolver (core/provider_registry.py).

canonical_base_url · strict-vs-lenient policy pairs · sole-model omission · blank-primary promotion ·
duplicate-target rejection/dedup · gate None-conflict min-wins · uncataloged-id probe eligibility ·
chain_for verb semantics (R10) · the max_tokens_field ladder (C6).
"""

from __future__ import annotations

from app.config import InferenceCfg, ModelCfg, ProviderCfg, SectionRef, Settings
from app.core.provider_registry import (
    RegistryError,
    canonical_base_url,
    resolve_lenient,
    resolve_strict,
)


def _settings(providers: dict, inference: InferenceCfg) -> Settings:
    return Settings(providers=providers, inference=inference)


# ── canonical_base_url (C4) ──────────────────────────────────────────────────────────────────────
def test_canonical_base_url() -> None:
    assert canonical_base_url("http://X:80/v1/") == "http://x/v1"
    assert canonical_base_url("https://Y:443/v1") == "https://y/v1"
    assert canonical_base_url("http://host:5001/v1") == "http://host:5001/v1"
    assert canonical_base_url("http://host:5001/v1/") == "http://host:5001/v1"
    # path preserved — different paths are different gates by design
    assert canonical_base_url("http://host/a") != canonical_base_url("http://host/b")
    assert canonical_base_url("host:9000/v1") == "http://host:9000/v1"  # scheme defaulted


# ── the max_tokens_field ladder (C6) ─────────────────────────────────────────────────────────────
def _mtf(*, api_mode="openai", provider_mtf=None, model_mtf=None):
    s = _settings(
        {
            "p": ProviderCfg(
                base_url="http://p/v1",
                api_mode=api_mode,
                max_tokens_field=provider_mtf,
                models={"m": ModelCfg(max_tokens_field=model_mtf)},
            )
        },
        InferenceCfg(provider="p"),
    )
    reg, _ = resolve_lenient(s)
    return reg.inference_chain[0].resolved_max_tokens_field


def test_max_tokens_field_ladder() -> None:
    assert _mtf() == "max_completion_tokens"  # openai derives the new spelling
    assert _mtf(api_mode="llamacpp") == "max_tokens"  # else derives the classic
    assert _mtf(api_mode="llamacpp", provider_mtf="max_completion_tokens") == "max_completion_tokens"
    assert (
        _mtf(provider_mtf="max_tokens", model_mtf="max_completion_tokens") == "max_completion_tokens"
    )  # model wins


# ── sole-model omission (C5) ─────────────────────────────────────────────────────────────────────
def test_sole_model_omission_strict_and_lenient() -> None:
    two = _settings(
        {"p": ProviderCfg(base_url="http://p/v1", models={"a": ModelCfg(), "b": ModelCfg()})},
        InferenceCfg(provider="p"),  # no model + 2 in catalog → error/drop
    )
    errs = resolve_strict(two)
    assert isinstance(errs, list) and any("must be named" in e.message for e in errs)
    reg, warns = resolve_lenient(two)
    assert reg.inference_chain == () and any("must be named" in w for w in warns)
    # exactly one model → omission is fine
    one = _settings(
        {"p": ProviderCfg(base_url="http://p/v1", models={"only": ModelCfg(id="wire/only")})},
        InferenceCfg(provider="p"),
    )
    reg2, _ = resolve_lenient(one)
    assert reg2.inference_chain[0].model == "wire/only"


# ── blank/absent primary with fallbacks (C5) ─────────────────────────────────────────────────────
def test_blank_primary_promotes_lenient_but_422s_strict() -> None:
    s = _settings(
        {"fb": ProviderCfg(base_url="http://fb/v1", models={"m": ModelCfg()})},
        InferenceCfg(provider=None, fallbacks=[SectionRef(provider="fb", model="m")]),
    )
    errs = resolve_strict(s)
    assert isinstance(errs, list) and any("blank/invalid" in e.message for e in errs)
    reg, warns = resolve_lenient(s)
    assert [t.provider for t in reg.inference_chain] == ["fb"]  # promoted the first valid fallback
    assert any("promoted the first valid fallback" in w for w in warns)


# ── duplicate-target rejection / dedup (C5) ──────────────────────────────────────────────────────
def test_duplicate_target_rejects_strict_dedups_lenient() -> None:
    s = _settings(
        {"p": ProviderCfg(base_url="http://p/v1", models={"m": ModelCfg()})},
        InferenceCfg(provider="p", fallbacks=[SectionRef(provider="p", model="m")]),  # same target twice
    )
    errs = resolve_strict(s)
    assert isinstance(errs, list) and any("duplicate target" in e.message for e in errs)
    reg, warns = resolve_lenient(s)
    assert len(reg.inference_chain) == 1  # deduped
    assert any("duplicate target" in w for w in warns)


# ── gate None-conflict → min-wins (C4) ───────────────────────────────────────────────────────────
def test_gate_none_conflict_min_wins_lenient_422_strict() -> None:
    s = _settings(
        {
            "a": ProviderCfg(
                base_url="http://box/v1", max_concurrent_requests=None, models={"m": ModelCfg()}
            ),
            "b": ProviderCfg(
                base_url="http://BOX:80/v1", max_concurrent_requests=2, models={"n": ModelCfg()}
            ),
        },
        InferenceCfg(provider="a", fallbacks=[SectionRef(provider="b", model="n")]),
    )
    errs = resolve_strict(s)
    assert isinstance(errs, list) and any("conflicting max_concurrent_requests" in e.message for e in errs)
    reg, warns = resolve_lenient(s)
    assert all(t.max_concurrent_requests == 2 for t in reg.inference_chain)  # min of {None, 2}
    assert any("conflicting max_concurrent_requests" in w for w in warns)


# ── uncataloged raw-id passthrough + probe eligibility (C5) ──────────────────────────────────────
def test_uncataloged_id_passthrough_and_probe_eligibility() -> None:
    s = _settings(
        {"p": ProviderCfg(base_url="http://p/v1", api_mode="llamacpp", models={"known": ModelCfg()})},
        InferenceCfg(provider="p", model="raw/uncataloged"),  # not in catalog
    )
    reg, _ = resolve_lenient(s)
    t = reg.inference_chain[0]
    assert t.model == "raw/uncataloged" and t.context_window is None  # passthrough, no window
    assert t.api_mode == "llamacpp"  # probe-eligible (the adapter gates on api_mode == llamacpp)
    # a non-llamacpp uncataloged id is NOT probe-eligible
    s2 = _settings(
        {"p": ProviderCfg(base_url="http://p/v1", api_mode="openrouter", models={"known": ModelCfg()})},
        InferenceCfg(provider="p", model="raw/x"),
    )
    reg2, _ = resolve_lenient(s2)
    assert reg2.inference_chain[0].api_mode == "openrouter"


# ── chain_for verb semantics (R10) ───────────────────────────────────────────────────────────────
def _two_provider_reg(*, failover=True):
    s = _settings(
        {
            "llamacpp": ProviderCfg(
                base_url="http://l/v1", api_mode="llamacpp", models={"minig": ModelCfg()}
            ),
            "openrouter": ProviderCfg(
                base_url="http://o/v1", api_mode="openrouter", models={"q": ModelCfg(id="qwen/q")}
            ),
            "solo": ProviderCfg(base_url="http://s/v1", models={"only": ModelCfg()}),  # not in the chain
            "multi": ProviderCfg(
                base_url="http://m/v1", models={"x": ModelCfg(), "y": ModelCfg()}
            ),  # non-chain multi
        },
        InferenceCfg(
            provider="llamacpp", fallbacks=[SectionRef(provider="openrouter", model="q")], failover=failover
        ),
    )
    reg, _ = resolve_lenient(s)
    return reg


def test_chain_for_verb_semantics() -> None:
    reg = _two_provider_reg()
    assert [t.provider for t in reg.chain_for(None)] == ["llamacpp", "openrouter"]  # default chain
    # a verb for a provider IN the chain hoists it to the front (its first-occurrence model)
    assert [t.provider for t in reg.chain_for("openrouter")] == ["openrouter", "llamacpp"]
    # a non-chain SOLE-model provider is verb-routable → [solo, *chain]
    assert [t.provider for t in reg.chain_for("solo")] == ["solo", "llamacpp", "openrouter"]
    # a non-chain MULTI-model provider is NOT verb-routable → coerces to the default chain
    assert [t.provider for t in reg.chain_for("multi")] == ["llamacpp", "openrouter"]
    # unknown verb → default chain
    assert [t.provider for t in reg.chain_for("nope")] == ["llamacpp", "openrouter"]
    # failover off → strictly the chosen / primary
    off = _two_provider_reg(failover=False)
    assert [t.provider for t in off.chain_for(None)] == ["llamacpp"]
    assert [t.provider for t in off.chain_for("openrouter")] == ["openrouter"]


def test_chain_for_coercion_honors_failover_off() -> None:
    # FX1 (Codex#1): an unknown / non-routable mode COERCES to the section default — but the coercion must
    # NOT re-enable failover the operator turned off. With failover=False every coercion → [primary] only.
    off = _two_provider_reg(failover=False)
    assert [t.provider for t in off.chain_for("nope")] == ["llamacpp"]  # unknown provider
    assert [t.provider for t in off.chain_for("multi")] == ["llamacpp"]  # non-routable multi-model
    # a known provider whose requested MODEL can't resolve also coerces to [primary] under failover off
    assert [t.provider for t in off.chain_for("openrouter", "no-such-model")] == [
        "openrouter"
    ]  # raw-id passthrough
    assert [t.provider for t in off.chain_for("solo", None)] == ["solo"]
    # and with failover ON the same coercions return the full default chain (unchanged behavior)
    on = _two_provider_reg(failover=True)
    assert [t.provider for t in on.chain_for("nope")] == ["llamacpp", "openrouter"]
    assert [t.provider for t in on.chain_for("multi")] == ["llamacpp", "openrouter"]


def test_config_held_ref_strict_and_lenient() -> None:
    # FX4 (Codex#4): a config-held ModelRef (here the GLOBAL compaction summarizer) whose provider is not
    # in `providers` is a strict ERROR (422) but a lenient warning; a set provider + omitted model on a
    # multi-model provider is a WARNING (chain_for coerces at call time); a set model is always legal.
    from app.core.provider_registry import Registry

    providers = {"p": ProviderCfg(base_url="http://p/v1", models={"a": ModelCfg(), "b": ModelCfg()})}
    ghost = Settings(
        providers=providers,
        inference=InferenceCfg(provider="p", model="a"),
        agent={"compaction": {"summarizer": {"provider": "ghost"}}},
    )
    errs = resolve_strict(ghost)
    assert isinstance(errs, list) and any("ghost" in e.message for e in errs)
    _reg, warns = resolve_lenient(ghost)
    assert any("ghost" in w for w in warns)
    # set provider + omitted model on a multi-model provider → WARNING, not an error
    omit = Settings(
        providers=providers,
        inference=InferenceCfg(provider="p", model="a"),
        agent={"compaction": {"summarizer": {"provider": "p"}}},
    )
    assert isinstance(resolve_strict(omit), Registry)
    _r2, warns2 = resolve_lenient(omit)
    assert any("omits the model" in w for w in warns2)
    # a set model (raw-id or cataloged) is always legal — no error
    ok = Settings(
        providers=providers,
        inference=InferenceCfg(provider="p", model="a"),
        agent={"compaction": {"summarizer": {"provider": "p", "model": "raw/id"}}},
    )
    assert isinstance(resolve_strict(ok), Registry)


def test_catalog_key_shadows_wire_id_warning() -> None:
    # FX5 (Codex#13): within one provider, a clean KEY equal to a DIFFERENT model's wire id → warning.
    s = _settings(
        {
            "p": ProviderCfg(
                base_url="http://p/v1", models={"foo": ModelCfg(id="bar"), "bar": ModelCfg(id="baz")}
            )
        },
        InferenceCfg(provider="p", model="foo"),
    )
    _reg, warns = resolve_lenient(s)
    assert any("bar" in w and "spells the wire id" in w for w in warns)


def test_resolve_strict_returns_registry_on_success() -> None:
    from app.core.provider_registry import Registry

    reg = resolve_strict(
        _settings(
            {"p": ProviderCfg(base_url="http://p/v1", models={"m": ModelCfg()})}, InferenceCfg(provider="p")
        )
    )
    assert isinstance(reg, Registry) and not isinstance(reg, list)


def test_registry_error_is_structured() -> None:
    errs = resolve_strict(_settings({}, InferenceCfg(provider="missing")))
    assert isinstance(errs, list) and all(isinstance(e, RegistryError) and e.path and e.message for e in errs)
