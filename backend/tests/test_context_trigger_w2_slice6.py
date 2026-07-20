"""ACA Slice 6 / D42 Wave 2 — the window-aware trigger + the anchored estimator.

Four units, each testable in isolation (no live backend, no DB):
  1. the trigger math — `Compactor._over_threshold` / `_trigger_limit` (sync, history-free when the
     estimate is supplied): W×frac firing, the exact `reserve_output` subtraction, and the no-window
     `threshold_tokens` fallback (the v1 no-regression path);
  2. the window ladder — `InferenceClient.effective_window` (config > probe > None) + probe-eligibility
     (local only; cloud/fallbacks never probed), served by an `httpx.MockTransport` like Wave 1;
  3. the `StreamReport.served_endpoint` stamp — `InferenceClient._record` names the endpoint OBJECT
     that answered (unit-tested directly against a served-index result; the session reads it to price
     iteration 2+);
  4. the anchored estimator — `ContextEstimator`: anchor + post-watermark delta vs pure
     heuristic+overhead, and every invalidation path (fold, served-endpoint change, absent telemetry,
     watermark folded away).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import httpx
import pytest

import app.services.agent.compaction as compaction_mod
from app.adapters.inference import InferenceClient, StreamReport
from app.config import InferenceCfg, InferenceEndpointCfg
from app.domain.agent import CompactionCfg
from app.domain.conversation import Message, TextPart
from app.domain.enums import Actor
from app.services.agent.compaction import (
    ClearingPlan,
    Compactor,
    ContextEstimator,
    estimate_tokens,
)
from app.services.conversation import MessageRepo

# ── 1. The trigger math (`_over_threshold` / `_trigger_limit`) ─────────────────────────────────────


def _compactor(cfg: CompactionCfg) -> Compactor:
    """A Compactor with no inference/messages deps — `_over_threshold` is sync and, when handed
    `estimated_tokens`, never reads history, so the deps are unused."""
    return Compactor(cast("InferenceClient", None), cast("MessageRepo", None), cfg)


def test_window_trigger_fires_at_frac_of_window() -> None:
    """With a resolved window and no reserve, the line is EXACTLY `window × threshold_frac`."""
    c = _compactor(CompactionCfg(threshold_frac=0.85))
    # 10000 × 0.85 = 8500 → strictly-greater fires.
    assert c._over_threshold([], window=10000, estimated_tokens=8500) is False
    assert c._over_threshold([], window=10000, estimated_tokens=8501) is True


def test_reserve_output_subtracts_exactly_max_tokens() -> None:
    """`reserve_output=True` + a reserve subtracts EXACTLY it: line = W×frac − reserve (no cap)."""
    c = _compactor(CompactionCfg(threshold_frac=0.85, reserve_output=True))
    # 8500 − 1000 = 7500.
    assert c._over_threshold([], window=10000, reserve_tokens=1000, estimated_tokens=7500) is False
    assert c._over_threshold([], window=10000, reserve_tokens=1000, estimated_tokens=7501) is True


def test_reserve_output_false_ignores_reserve() -> None:
    """`reserve_output=False` → the reserve is ignored even when set; the line stays W×frac."""
    c = _compactor(CompactionCfg(threshold_frac=0.85, reserve_output=False))
    assert c._over_threshold([], window=10000, reserve_tokens=1000, estimated_tokens=8500) is False
    assert c._over_threshold([], window=10000, reserve_tokens=1000, estimated_tokens=8501) is True


def test_unset_max_tokens_reserves_nothing() -> None:
    """`reserve_tokens=None` (unset `ModelRef.max_tokens`) ⇒ nothing subtracted; the line is W×frac."""
    c = _compactor(CompactionCfg(threshold_frac=0.85, reserve_output=True))
    assert c._over_threshold([], window=10000, reserve_tokens=None, estimated_tokens=8500) is False
    assert c._over_threshold([], window=10000, reserve_tokens=None, estimated_tokens=8501) is True


def test_no_window_falls_back_to_threshold_tokens() -> None:
    """No window ⇒ the absolute `threshold_tokens` trigger — the v1 behavior, pinned unchanged."""
    c = _compactor(CompactionCfg(threshold_tokens=6000))
    assert c._over_threshold([], window=None, estimated_tokens=6000) is False
    assert c._over_threshold([], window=None, estimated_tokens=6001) is True


def test_no_window_no_estimate_uses_heuristic_history() -> None:
    """The FULL v1 path: no window AND no supplied estimate ⇒ `estimate_tokens(history) >
    threshold_tokens` (every existing caller/test keeps this exact behavior via the defaults)."""
    c = _compactor(CompactionCfg(threshold_tokens=100))
    small = [Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text="hi")])]
    big = [Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text="x" * 1000)])]
    assert c._over_threshold(small) is False  # estimate_tokens(small) ≈ 1 tok < 100
    assert c._over_threshold(big) is True  # ≈ 251 tok > 100


def test_disabled_never_over_threshold() -> None:
    c = _compactor(CompactionCfg(enabled=False))
    assert c._over_threshold([], window=10000, estimated_tokens=999999) is False


def test_negative_trigger_line_degrades_to_threshold_tokens(caplog) -> None:
    """R2: a reserve ≥ window×frac would drive the line ≤ 0 (thrash every turn). Degrade to the
    `threshold_tokens` fallback (not a negative line) and warn EXACTLY once across calls."""
    compaction_mod._degenerate_trigger_warned = False  # reset the module once-flag for the test
    c = _compactor(CompactionCfg(threshold_frac=0.85, reserve_output=True, threshold_tokens=6000))
    # 1000 × 0.85 = 850, minus a 2000 reserve = −1150 ≤ 0 → fall back to threshold_tokens=6000.
    with caplog.at_level("WARNING", logger="ctrlb.compaction"):
        assert c._over_threshold([], window=1000, reserve_tokens=2000, estimated_tokens=6000) is False
        assert c._over_threshold([], window=1000, reserve_tokens=2000, estimated_tokens=6001) is True
        # a second degenerate call must NOT re-warn
        assert c._over_threshold([], window=1000, reserve_tokens=5000, estimated_tokens=1) is False
    warnings = [r for r in caplog.records if "trigger line" in r.getMessage()]
    assert len(warnings) == 1, "exactly one degenerate-trigger warning"


def test_record_stores_cleared_at_anchor_for_delta_credit() -> None:
    """R1: `record(cleared_call_ids=…)` remembers what the anchored prompt was trimmed by, and
    `estimate` surfaces it as `cleared_at_anchor` (which the session passes to the trigger for the
    exact-delta credit). Heuristic mode surfaces `None`."""
    est = ContextEstimator()
    m1, m2 = _msg("a" * 40), _msg("b" * 40)
    est.record(
        total=5000, served_key="http://local/v1", watermark_id=m1.id, cleared_call_ids=frozenset({"c0"})
    )
    got = est.estimate([m1, m2], overhead=50, served_key="http://local/v1")
    assert got.anchored is True and got.cleared_at_anchor == frozenset({"c0"})
    # a fresh (heuristic) estimator surfaces None
    assert (
        ContextEstimator().estimate([m1], overhead=1, served_key="http://local/v1").cleared_at_anchor is None
    )


def test_clearing_plan_subtracts_gain_default_none() -> None:
    """The clearing seam: a passed `ClearingPlan` subtracts its gain from the estimate; the default
    `None` is a no-op. In heuristic mode (no `cleared_at_anchor`) the FULL gain is credited."""
    c = _compactor(CompactionCfg(threshold_frac=0.85))
    # default None → fires at 8501 (as above).
    assert c._over_threshold([], window=10000, estimated_tokens=8501) is True
    # a 2000-token clearing gain pulls 8501 → 6501, back under the 8500 line.
    plan = ClearingPlan(frozenset({"x"}), {"x": 2000})
    assert c._over_threshold([], window=10000, estimated_tokens=8501, clearing=plan) is False


def test_clearing_credit_is_delta_when_anchored() -> None:
    """R1 exact-delta: an ANCHORED estimate (a `cleared_at_anchor` set is supplied) credits ONLY the
    outputs cleared SINCE the anchor — the anchor total already reflects the anchor-time trim, so
    crediting the full gain would double-count it."""
    c = _compactor(CompactionCfg(threshold_frac=0.85))
    # P2 clears {a, b} (gain 2000 total); the anchor already had {a} trimmed (1000 of that gain).
    p2 = ClearingPlan(frozenset({"a", "b"}), {"a": 1000, "b": 1000})
    # HEURISTIC (cleared_at_anchor=None): full 2000 credit → 9600 − 2000 = 7600 < 8500 → under.
    assert c._over_threshold([], window=10000, estimated_tokens=9600, clearing=p2) is False
    # ANCHORED with {a} already cleared: credit only b's 1000 → 9600 − 1000 = 8600 > 8500 → over.
    assert (
        c._over_threshold(
            [], window=10000, estimated_tokens=9600, clearing=p2, cleared_at_anchor=frozenset({"a"})
        )
        is True
    )
    # ANCHORED with nothing cleared at the anchor: delta == full → same as heuristic (7600 under).
    assert (
        c._over_threshold([], window=10000, estimated_tokens=9600, clearing=p2, cleared_at_anchor=frozenset())
        is False
    )


# ── 2. The window ladder (`effective_window`) + probe-eligibility ─────────────────────────────────


def _client_with_handler(handler, **kw) -> InferenceClient:
    """An `InferenceClient` whose probe GETs are served by `handler` (an httpx MockTransport)."""
    cfg = InferenceCfg(**kw)
    client = InferenceClient(cfg)
    client._probe_http = httpx.AsyncClient(transport=httpx.MockTransport(handler))  # type: ignore[assignment]
    return client


def test_config_window_wins_over_probe() -> None:
    """An explicit `context_window` short-circuits the ladder — the probe is never hit (config > probe)."""
    hits = {"n": 0}

    def handler(_r: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 4096}})

    local = InferenceEndpointCfg(base_url="http://local/v1", model="m", context_window=32768)

    async def scenario() -> None:
        client = _client_with_handler(handler, local=local)
        assert await client.effective_window(local) == 32768
        assert hits["n"] == 0  # config won → no probe

    asyncio.run(scenario())


def test_probe_used_when_config_unset() -> None:
    """No config window on the LOCAL endpoint ⇒ the `/props` probe supplies `n_ctx`."""
    local = InferenceEndpointCfg(base_url="http://local/v1", model="m")  # context_window=None

    def handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 8192}})

    async def scenario() -> None:
        client = _client_with_handler(handler, local=local)
        assert await client.effective_window(local) == 8192

    asyncio.run(scenario())


def test_probe_zero_n_ctx_is_no_window() -> None:
    """Live-test find (2026-07-20): llama-server in ROUTER mode serves
    `default_generation_settings.n_ctx: 0` at the router layer (the real window is per model
    instance behind it — confirmed on vault b10069). Accepting 0 as the window made the D42
    trigger degenerate (constant overflow → destructive truncation), so a non-positive probe
    value now means "no usable probe" → the ladder falls through to config/threshold fallback."""
    local = InferenceEndpointCfg(base_url="http://local/v1", model="m")

    def handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"default_generation_settings": {"params": None, "n_ctx": 0}})

    async def scenario() -> None:
        client = _client_with_handler(handler, local=local)
        assert await client.effective_window(local) is None

    asyncio.run(scenario())


def test_neither_config_nor_probe_is_none() -> None:
    """Config unset AND the probe fails ⇒ None (⇒ the caller's `threshold_tokens` fallback)."""
    local = InferenceEndpointCfg(base_url="http://local/v1", model="m")

    def handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="nope")

    async def scenario() -> None:
        client = _client_with_handler(handler, local=local)
        assert await client.effective_window(local) is None

    asyncio.run(scenario())


def test_cloud_endpoint_not_probed_only_manual() -> None:
    """Probe-eligibility is LOCAL-only: a cloud/non-local endpoint with no `context_window` resolves
    to None WITHOUT hitting `/props` (cloud has no window field — manual config only)."""
    hits = {"n": 0}

    def handler(_r: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 4096}})

    local = InferenceEndpointCfg(base_url="http://local/v1", model="m")
    cloud = InferenceEndpointCfg(base_url="http://cloud/v1", model="c")  # not the local endpoint

    async def scenario() -> None:
        client = _client_with_handler(handler, local=local, cloud=cloud)
        assert await client.effective_window(cloud) is None
        assert hits["n"] == 0  # cloud is never probed
        # …but a MANUAL context_window on cloud is honoured (config path, no probe).
        cloud2 = InferenceEndpointCfg(base_url="http://cloud/v1", model="c", context_window=200000)
        assert await client.effective_window(cloud2) == 200000
        assert hits["n"] == 0

    asyncio.run(scenario())


# ── 3. The `served_endpoint` stamp (`_record`) ────────────────────────────────────────────────────


def test_record_stamps_served_endpoint_object() -> None:
    """After a failover serve, `_record` stamps the endpoint OBJECT that answered (`chain[served_index]
    [1]`) alongside its name — the session prices iteration 2+ against it."""
    local = InferenceEndpointCfg(base_url="http://local/v1", model="m")
    cloud = InferenceEndpointCfg(base_url="http://cloud/v1", model="c")
    chain = [("local", local, "m"), ("cloud", cloud, "c")]  # _ChainEntry shape: (name, ep, model)
    client = InferenceClient(InferenceCfg(local=local, cloud=cloud))

    report = StreamReport()
    # served_index=1 → the cloud fallback answered after local failed.
    result = SimpleNamespace(served_index=1, degraded=True, failures=["local: boom"])
    client._record(report, chain, result)  # type: ignore[arg-type]

    assert report.served == "cloud"
    assert report.served_endpoint is cloud  # the OBJECT, by identity
    assert report.degraded is True and report.failures == ["local: boom"]


def test_record_iteration_one_names_selected_endpoint() -> None:
    """No failover (served_index=0) → the stamp names the selected endpoint (iteration-1 pricing)."""
    local = InferenceEndpointCfg(base_url="http://local/v1", model="m")
    chain = [("local", local, "m")]
    client = InferenceClient(InferenceCfg(local=local))

    report = StreamReport()
    client._record(report, chain, SimpleNamespace(served_index=0, degraded=False, failures=[]))  # type: ignore[arg-type]
    assert report.served_endpoint is local and report.degraded is False


# ── 4. The anchored estimator (`ContextEstimator`) ────────────────────────────────────────────────


def _msg(text: str) -> Message:
    return Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text=text)])


def test_anchor_plus_delta_beats_pure_heuristic() -> None:
    """With telemetry present, the estimate = anchor + heuristic(messages AFTER the watermark) — the
    anchor captures the real head+tools+history total the chars/4 heuristic misses, so `overhead` is
    NOT re-added. It differs from (here, exceeds) the pure heuristic+overhead."""
    est = ContextEstimator()
    m1, m2, m3 = _msg("a" * 40), _msg("b" * 40), _msg("c" * 40)
    history = [m1, m2, m3]
    # The last model call prefilled a real 5000-token prompt (head+tools+[m1,m2]); watermark = m2.
    est.record(total=5000, served_key="http://local/v1", watermark_id=m2.id)

    got = est.estimate(history, overhead=200, served_key="http://local/v1")
    assert got.anchored is True
    assert got.tokens == 5000 + estimate_tokens([m3])  # only the post-watermark delta is heuristic

    heuristic = estimate_tokens(history) + 200
    assert got.tokens > heuristic  # the real prompt dwarfs chars/4 — anchoring is the point


def test_no_anchor_is_heuristic_plus_overhead() -> None:
    """Fresh estimator (no `record` yet — iteration 1) → `estimate_tokens(history) + overhead`."""
    est = ContextEstimator()
    history = [_msg("hello"), _msg("world")]
    got = est.estimate(history, overhead=123, served_key="http://local/v1")
    assert got.anchored is False
    assert got.tokens == estimate_tokens(history) + 123


def test_invalidate_on_fold_falls_back_to_heuristic() -> None:
    """A fold calls `invalidate()` → the next estimate is heuristic+overhead (the anchor's history is
    gone, so its total no longer maps to the shrunk context)."""
    est = ContextEstimator()
    history = [_msg("a" * 40), _msg("b" * 40)]
    est.record(total=5000, served_key="http://local/v1", watermark_id=history[0].id)
    est.invalidate()
    got = est.estimate(history, overhead=50, served_key="http://local/v1")
    assert got.anchored is False
    assert got.tokens == estimate_tokens(history) + 50


def test_invalidate_on_served_endpoint_change() -> None:
    """Pricing against a DIFFERENT served endpoint than the anchor was measured on ⇒ heuristic (a
    different backend tokenizes differently, so the anchor's count doesn't transfer)."""
    est = ContextEstimator()
    history = [_msg("a" * 40), _msg("b" * 40)]
    est.record(total=5000, served_key="http://local/v1", watermark_id=history[0].id)
    got = est.estimate(history, overhead=50, served_key="http://cloud/v1")  # served changed
    assert got.anchored is False
    assert got.tokens == estimate_tokens(history) + 50


def test_no_telemetry_total_drops_the_anchor() -> None:
    """`record(total=None)` — degraded/absent telemetry — drops the anchor (heuristic next)."""
    est = ContextEstimator()
    history = [_msg("a" * 40)]
    est.record(total=5000, served_key="http://local/v1", watermark_id=history[0].id)
    est.record(total=None, served_key="http://local/v1", watermark_id=history[0].id)  # no total
    got = est.estimate(history, overhead=50, served_key="http://local/v1")
    assert got.anchored is False


def test_watermark_folded_away_falls_back() -> None:
    """Backstop: if the watermark message is no longer in history (folded), the anchor isn't used."""
    est = ContextEstimator()
    m_gone, m_here = _msg("gone"), _msg("here")
    est.record(total=5000, served_key="http://local/v1", watermark_id=m_gone.id)
    got = est.estimate([m_here], overhead=50, served_key="http://local/v1")  # m_gone not present
    assert got.anchored is False
    assert got.tokens == estimate_tokens([m_here]) + 50


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-q"]))
