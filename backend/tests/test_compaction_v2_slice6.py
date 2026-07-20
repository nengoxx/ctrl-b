"""ACA Slice 6 / D42 Wave 1 — schema/config knobs + the llama.cpp `/props` window probe.

Wave 1 is schema + probe ONLY (no trigger/estimator wiring, no ModelRef threading). These pins guard
the declared shapes (CompactionCfg knobs, ModelRef call config, InferenceEndpointCfg windows) and the
probe's three properties that matter: it reads `n_ctx`, strips `/v1` to hit the server root, and NEVER
raises (any failure ⇒ memoized None, one hit per base_url, re-probed only on a rebuilt client).

Probe fakes use `httpx.MockTransport` injected onto `InferenceClient._probe_http` — same "fake the
transport, observe the calls" spirit as `test_inference_gate_d40.py`'s faked SDK client.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.adapters.inference import InferenceClient, _props_url
from app.config import (
    InferenceCfg,
    InferenceEndpointCfg,
    Settings,
    load_settings,
    save_settings,
)
from app.domain.agent import CompactionCfg, ModelRef

# ── CompactionCfg knobs (D42) ─────────────────────────────────────────────────────────────────────


def test_compaction_defaults() -> None:
    """The new D42 knobs default to the locked values; the existing fields are untouched."""
    c = CompactionCfg()
    assert c.enabled is True
    assert c.threshold_frac == 0.85
    assert c.threshold_tokens == 6000  # the no-window fallback trigger only
    assert c.keep_recent_tokens == 4096
    assert c.clear_output_min_tokens == 500
    assert c.clear_keep_steps == 2
    assert c.max_consecutive_failures == 3
    assert c.reserve_output is True
    assert c.keep_last_messages == 8


@pytest.mark.parametrize("frac", [0.5, 0.85, 0.95])
def test_threshold_frac_accepts_in_bounds(frac: float) -> None:
    assert CompactionCfg(threshold_frac=frac).threshold_frac == frac


@pytest.mark.parametrize("frac", [0.49, 0.96, 0.0, 1.0])
def test_threshold_frac_rejects_out_of_bounds(frac: float) -> None:
    with pytest.raises(ValidationError):
        CompactionCfg(threshold_frac=frac)


def test_clear_keep_steps_floor_is_one() -> None:
    """`ge=1` IS the most-recent-step safety — a 0 must 422 at the boundary."""
    assert CompactionCfg(clear_keep_steps=1).clear_keep_steps == 1
    with pytest.raises(ValidationError):
        CompactionCfg(clear_keep_steps=0)


@pytest.mark.parametrize("knob", ["keep_recent_tokens", "clear_output_min_tokens"])
def test_compaction_token_floors_allow_zero_reject_negative(knob: str) -> None:
    """P3 (D42): the two surfaced token knobs are `ge=0` — 0 is a *valid* degenerate setting
    (keep_recent_tokens=0 → token floor off, the message floor still guards; clear_output_min_tokens=0
    → clear every eligible output). A negative is nonsensical → rejected at the boundary."""
    assert getattr(CompactionCfg(**{knob: 0}), knob) == 0
    assert getattr(CompactionCfg(**{knob: 1000}), knob) == 1000
    with pytest.raises(ValidationError):
        CompactionCfg(**{knob: -1})


# ── ModelRef call config (D42/A10) ──────────────────────────────────────────────────────────────


def test_modelref_new_fields_default_none() -> None:
    m = ModelRef()
    assert m.max_tokens is None
    assert m.reasoning_effort is None
    assert m.reasoning_tokens is None
    # the pointer half is unchanged
    assert m.mode is None and m.model is None


@pytest.mark.parametrize("effort", ["off", "minimal", "low", "medium", "high", "xhigh", "max"])
def test_modelref_reasoning_effort_literal_accepts(effort: str) -> None:
    assert ModelRef(reasoning_effort=effort).reasoning_effort == effort


def test_modelref_reasoning_effort_rejects_junk() -> None:
    with pytest.raises(ValidationError):
        ModelRef(reasoning_effort="turbo")


@pytest.mark.parametrize("field", ["max_tokens", "reasoning_tokens"])
def test_modelref_budget_fields_reject_zero_and_negative(field: str) -> None:
    """P1 (D42): `max_tokens`/`reasoning_tokens` are `ge=1` — 0 is never a meaningful budget (a
    0-token cap asks for an empty reply), so it is rejected at the boundary; `None` means inherit."""
    assert getattr(ModelRef(**{field: 1}), field) == 1
    assert getattr(ModelRef(**{field: 4096}), field) == 4096
    assert getattr(ModelRef(**{field: None}), field) is None
    for bad in (0, -1):
        with pytest.raises(ValidationError):
            ModelRef(**{field: bad})


def test_modelref_no_extra_allow() -> None:
    """Declared fields, no `extra='allow'` — an unknown key is dropped (pydantic default `ignore`),
    NOT retained as a passthrough on `model_extra`."""
    m = ModelRef(max_toknes=100)  # typo → ignored, not stored
    assert m.model_extra in (None, {})
    assert not hasattr(m, "max_toknes")


# ── InferenceEndpointCfg windows (D42) ──────────────────────────────────────────────────────────


def test_endpoint_context_window_defaults_none_and_floor() -> None:
    assert InferenceEndpointCfg().context_window is None
    assert InferenceEndpointCfg(context_window=8192).context_window == 8192
    with pytest.raises(ValidationError):
        InferenceEndpointCfg(context_window=0)


def test_endpoint_max_tokens_field_literal_and_derivation() -> None:
    """D46: the raw field is now `None`-by-default and DERIVED from `api_mode`
    (`openai` → `max_completion_tokens`, everything else → `max_tokens`); an explicit value always wins.
    Only `resolved_max_tokens_field` may be read at the wire."""
    assert InferenceEndpointCfg().max_tokens_field is None
    assert InferenceEndpointCfg().resolved_max_tokens_field == "max_completion_tokens"  # default api_mode
    for mode in ("llamacpp", "openrouter", "none"):
        assert InferenceEndpointCfg(api_mode=mode).resolved_max_tokens_field == "max_tokens"
    override = InferenceEndpointCfg(api_mode="llamacpp", max_tokens_field="max_completion_tokens")
    assert override.resolved_max_tokens_field == "max_completion_tokens"  # explicit always wins
    assert InferenceEndpointCfg(max_tokens_field="max_tokens").resolved_max_tokens_field == "max_tokens"
    with pytest.raises(ValidationError):
        InferenceEndpointCfg(max_tokens_field="tokens")


def test_fallback_endpoints_carry_new_fields_through_roundtrip() -> None:
    """Fallbacks are full `InferenceEndpointCfg` objects → `context_window`/`max_tokens_field` ride
    them with zero schema work (the unified-object payoff), and round-trip clean (only api_key is
    secret-carried; these non-secret fields survive save+reload verbatim)."""
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "config.yaml"
        s = Settings.model_validate(
            {
                "inference": {
                    "local": {"base_url": "http://x/v1", "model": "m", "context_window": 32768},
                    "fallbacks": [
                        {
                            "base_url": "http://fb/v1",
                            "model": "fb",
                            "context_window": 8192,
                            "max_tokens_field": "max_completion_tokens",
                        }
                    ],
                }
            }
        )
        save_settings(s, p)
        r = load_settings(p)
        assert r.inference.local.context_window == 32768
        assert r.inference.fallbacks[0].context_window == 8192
        assert r.inference.fallbacks[0].max_tokens_field == "max_completion_tokens"


# ── The `/props` window probe (D42) ─────────────────────────────────────────────────────────────


def test_props_url_strips_v1() -> None:
    assert _props_url("http://host:5001/v1") == "http://host:5001/props"
    assert _props_url("http://host:5001/v1/") == "http://host:5001/props"
    assert _props_url("http://host:5001") == "http://host:5001/props"
    assert _props_url("http://host:5001/") == "http://host:5001/props"


def _client_with_handler(
    handler, *, base_url: str = "http://local/v1"
) -> tuple[InferenceClient, InferenceEndpointCfg]:
    """An `InferenceClient` whose probe GETs are served by `handler` (an httpx MockTransport handler),
    with a matching local endpoint to probe."""
    ep = InferenceEndpointCfg(base_url=base_url, model="m")
    cfg = InferenceCfg(local=ep)
    client = InferenceClient(cfg)
    client._probe_http = httpx.AsyncClient(transport=httpx.MockTransport(handler))  # type: ignore[assignment]
    return client, ep


def test_probe_reads_n_ctx_and_hits_server_root() -> None:
    """A healthy `/props` at the SERVER ROOT (no `/v1`) yields `n_ctx`."""

    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(
            200,
            json={
                "default_generation_settings": {"n_ctx": 16384},
                "meta": {"n_ctx_train": 32768},
            },
        )

    async def scenario() -> None:
        client, ep = _client_with_handler(handler)
        assert await client.probed_context_window(ep) == 16384
        # /v1 stripped, root /props hit; the model param rides (the 2026-07-21 router-mode lever)
        assert seen == ["http://local/props?model=m"]

    asyncio.run(scenario())


def test_probe_honours_n_ctx_above_train() -> None:
    """Upward overrides allowed — an `n_ctx` above `n_ctx_train` is still returned (just logged)."""

    def handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"default_generation_settings": {"n_ctx": 40000}, "meta": {"n_ctx_train": 32768}},
        )

    async def scenario() -> None:
        client, ep = _client_with_handler(handler)
        assert await client.probed_context_window(ep) == 40000

    asyncio.run(scenario())


def test_probe_memoizes_one_hit_per_base_url() -> None:
    """Second call does not re-hit — memoized per base_url on the client instance."""
    hits = {"n": 0}

    def handler(_r: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 4096}})

    async def scenario() -> None:
        client, ep = _client_with_handler(handler)
        assert await client.probed_context_window(ep) == 4096
        assert await client.probed_context_window(ep) == 4096
        assert hits["n"] == 1

    asyncio.run(scenario())


def test_probe_memoizes_failures_too() -> None:
    """A failed probe (connection error) ⇒ None, memoized — no retry storm."""
    hits = {"n": 0}

    def handler(_r: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        raise httpx.ConnectError("dead")

    async def scenario() -> None:
        client, ep = _client_with_handler(handler)
        assert await client.probed_context_window(ep) is None
        assert await client.probed_context_window(ep) is None
        assert hits["n"] == 1  # the None is memoized

    asyncio.run(scenario())


def test_probe_never_raises_on_bad_responses() -> None:
    """404, malformed JSON, and a missing field all ⇒ None, never an exception."""

    def h_404(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="nope")

    def h_bad_json(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json{")

    def h_missing(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"meta": {"n_ctx_train": 32768}})  # no n_ctx

    async def scenario() -> None:
        for h in (h_404, h_bad_json, h_missing):
            client, ep = _client_with_handler(h)
            assert await client.probed_context_window(ep) is None

    asyncio.run(scenario())


def test_probe_blank_base_url_is_none() -> None:
    async def scenario() -> None:
        cfg = InferenceCfg(local=InferenceEndpointCfg(base_url="", model="m"))
        client = InferenceClient(cfg)
        assert await client.probed_context_window(cfg.local) is None

    asyncio.run(scenario())


def test_rebuilt_client_reprobes() -> None:
    """The memo lives on the client instance; `set_inference` rebuilds the client on any inference
    change, so a fresh `InferenceClient` re-probes (cache invalidation by construction)."""
    hits = {"n": 0}

    def handler(_r: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 2048}})

    async def scenario() -> None:
        c1, ep = _client_with_handler(handler)
        assert await c1.probed_context_window(ep) == 2048
        # a rebuild (new InferenceClient) has an empty memo → probes again
        c2, ep2 = _client_with_handler(handler)
        assert await c2.probed_context_window(ep2) == 2048
        assert hits["n"] == 2

    asyncio.run(scenario())


def test_probe_single_flight_concurrent_first_use_one_get() -> None:
    """D42 Codex FIX 6: N concurrent first-use `probed_context_window` calls issue EXACTLY ONE GET —
    the single-flight lock + memo double-check serializes the probe. Without it, each racer would see
    the empty memo and fire its own GET (hits == N)."""
    hits = {"n": 0}

    def handler(_r: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 4096}})

    async def scenario() -> None:
        client, ep = _client_with_handler(handler)
        results = await asyncio.gather(*(client.probed_context_window(ep) for _ in range(8)))
        assert results == [4096] * 8
        assert hits["n"] == 1  # single-flight: one GET despite 8 concurrent first-use callers

    asyncio.run(scenario())
