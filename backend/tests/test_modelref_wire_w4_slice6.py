"""ACA Slice 6 / D42 Wave 4 — the ModelRef call-config wire + the reactive context-overflow backstop.

Five units, each testable in isolation:
  A. `InferenceClient._call_config` (pure): max_tokens under the endpoint's field name, reasoning_effort
     passthrough, the `"off"` chat_template_kwargs merge (over extra_body, no clobber, no mutation),
     unset → nothing;
  A2. the D45 per-dialect reasoning translation (openai / llamacpp / openrouter / none) + the explicit
     `reasoning_tokens` override precedence + the default-dialect back-compat pin;
  B. `InferenceError` code/status + `is_context_overflow` (the classifier matrix: OpenAI code, llama.cpp
     message, unrelated 400, 500);
  C. the kwargs reach `create()` through `stream_chat`/`complete` (fake SDK client) + the failover ride
     (params land on the fallback serve with the FALLBACK's max_tokens_field);
  D. the summarizer (`_summarize`): capped when `summarizer.max_tokens` is set, uncapped otherwise, and
     the overflow-guard margin tightens honestly when a cap is set;
  E. the reactive backstop (driving `_drive` on the TestClient app): overflow + nothing-streamed → one
     forced compaction + a same-slot re-stream; overflow after a partial stream → NO backstop; a second
     overflow in the same turn → no second attempt; an inflation-reject during the forced compact →
     normal error path.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import tempfile
from pathlib import Path
from typing import cast

import httpx
import pytest
from _async import run_async
from openai import BadRequestError
from pydantic import ValidationError

from app.adapters.inference import (
    _REASONING_BUDGETS,
    InferenceClient,
    InferenceError,
    _looks_self_hosted,
    _resolve_reasoning_budget,
    is_context_overflow,
    warn_suspect_reasoning_dialects,
)
from app.config import InferenceCfg, InferenceEndpointCfg
from app.domain.agent import CompactionCfg, ModelRef
from app.domain.conversation import Message, TextPart
from app.domain.enums import Actor
from app.services.agent.compaction import SUMMARY_PREFIX, TRUNCATION_NOTICE, Compactor
from app.services.conversation import MessageRepo


def _run(coro):
    return run_async(coro)


# ── A. `_call_config` (the pure per-endpoint wire builder) ─────────────────────────────────────────


def _ep(**kw) -> InferenceEndpointCfg:
    base = dict(base_url="http://local/v1", model="m")
    base.update(kw)
    return InferenceEndpointCfg(**base)


def test_call_config_max_tokens_uses_endpoint_field_name() -> None:
    """`max_tokens` lands under THIS endpoint's `max_tokens_field` — classic vs the reasoning-model name."""
    classic = InferenceClient._call_config(_ep(), max_tokens=256, reasoning_effort=None)
    assert classic == {"max_tokens": 256}
    reasoning = InferenceClient._call_config(
        _ep(max_tokens_field="max_completion_tokens"), max_tokens=256, reasoning_effort=None
    )
    assert reasoning == {"max_completion_tokens": 256}


def test_call_config_reasoning_effort_passes_through() -> None:
    cfg = InferenceClient._call_config(_ep(), max_tokens=None, reasoning_effort="high")
    assert cfg == {"reasoning_effort": "high"}


def test_call_config_off_merges_chat_template_kwargs_over_extra_body() -> None:
    """`"off"` merges `chat_template_kwargs:{enable_thinking:false}` OVER the endpoint's extra_body —
    the endpoint's OTHER keys (and other chat_template_kwargs sub-keys) survive, and the config object
    is NOT mutated. On the LLAMACPP dialect only: that key is a llama.cpp/vLLM concept (D45 audit FIX 4)."""
    ep = _ep(
        reasoning_dialect="llamacpp", extra_body={"cache_prompt": True, "chat_template_kwargs": {"foo": 1}}
    )
    original = dict(ep.extra_body)
    cfg = InferenceClient._call_config(ep, max_tokens=None, reasoning_effort="off")
    assert "reasoning_effort" not in cfg  # llama-server never reads it
    extra = cfg["extra_body"]
    assert extra["cache_prompt"] is True  # endpoint's other key survives
    assert extra["chat_template_kwargs"] == {
        "foo": 1,
        "enable_thinking": False,
    }  # sub-key survives, ours wins
    # the config object was never mutated
    assert ep.extra_body == original
    assert ep.extra_body["chat_template_kwargs"] == {"foo": 1}


def test_call_config_off_adds_chat_template_kwargs_with_no_extra_body() -> None:
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort="off"
    )
    assert cfg["extra_body"]["chat_template_kwargs"] == {"enable_thinking": False}


def test_call_config_off_template_lever_never_leaks_to_a_non_llamacpp_dialect() -> None:
    """D45 audit FIX 4: `chat_template_kwargs` is a llama.cpp/vLLM key and an OpenAI-shaped backend 400s
    on unknown body args (the ACA-18 rule) — so `off` must NOT smuggle it onto the cloud dialects, and
    `none` ("the server understands no reasoning control") must stay literally empty."""
    for dialect in ("openai", "openrouter", "none"):
        cfg = InferenceClient._call_config(
            _ep(reasoning_dialect=dialect), max_tokens=None, reasoning_effort="off"
        )
        assert "chat_template_kwargs" not in cfg.get("extra_body", {}), dialect
    assert (
        InferenceClient._call_config(_ep(reasoning_dialect="none"), max_tokens=None, reasoning_effort="off")
        == {}
    )


def test_call_config_unset_sends_nothing() -> None:
    """Unset fields contribute NOTHING — no None-valued keys, no empty extra_body."""
    assert InferenceClient._call_config(_ep(), max_tokens=None, reasoning_effort=None) == {}


def test_call_config_non_off_effort_leaves_extra_body_alone() -> None:
    ep = _ep(extra_body={"cache_prompt": True})
    cfg = InferenceClient._call_config(ep, max_tokens=100, reasoning_effort="low")
    assert cfg == {"max_tokens": 100, "reasoning_effort": "low", "extra_body": {"cache_prompt": True}}


# ── A2. `_call_config` per-dialect reasoning translation (D45) ─────────────────────────────────────
# NOTE: every section-A test above runs on the DEFAULT dialect ("openai"), so they double as the
# back-compat regression — an untouched config still produces today's payload byte-for-byte.


def test_call_config_default_dialect_is_openai_backcompat() -> None:
    """The default dialect keeps TODAY's exact payload: effort verbatim, no budget keys ever."""
    assert _ep().reasoning_dialect == "openai"
    cfg = InferenceClient._call_config(_ep(), max_tokens=64, reasoning_effort="high", reasoning_tokens=4096)
    assert cfg == {"max_tokens": 64, "reasoning_effort": "high"}


def test_call_config_openai_drops_reasoning_tokens() -> None:
    """OpenAI has no reasoning-token budget (`max_completion_tokens` is a COMBINED cap) — dropping the
    override is correct, not a gap."""
    cfg = InferenceClient._call_config(_ep(), max_tokens=None, reasoning_effort=None, reasoning_tokens=999)
    assert cfg == {}


def test_call_config_llamacpp_ladder_sends_both_budget_keys_and_no_effort() -> None:
    """llama.cpp: the ladder becomes a budget under BOTH the current name and the older alias, and
    `reasoning_effort` is deliberately NOT sent (llama-server never reads it)."""
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort="high"
    )
    assert cfg == {"extra_body": {"reasoning_budget_tokens": 8192, "thinking_budget_tokens": 8192}}
    assert "reasoning_effort" not in cfg


def test_call_config_llamacpp_explicit_tokens_override_the_ladder() -> None:
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort="high", reasoning_tokens=333
    )
    assert cfg == {"extra_body": {"reasoning_budget_tokens": 333, "thinking_budget_tokens": 333}}


def test_call_config_llamacpp_off_is_budget_zero_plus_enable_thinking_false() -> None:
    """`"off"` → the server's own 0 sentinel (sampler level) AND the template-level lever, both."""
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort="off"
    )
    assert cfg["extra_body"] == {
        "reasoning_budget_tokens": 0,
        "thinking_budget_tokens": 0,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    assert "reasoning_effort" not in cfg


def test_call_config_llamacpp_max_is_unrestricted_sentinel() -> None:
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort="max"
    )
    assert cfg == {"extra_body": {"reasoning_budget_tokens": -1, "thinking_budget_tokens": -1}}


def test_call_config_llamacpp_unset_sends_no_budget() -> None:
    """Nothing set ⇒ nothing on the wire — the server keeps its own `--reasoning-budget` default."""
    assert (
        InferenceClient._call_config(
            _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort=None
        )
        == {}
    )


def test_call_config_openrouter_explicit_tokens_excludes_effort() -> None:
    """OpenRouter: `reasoning.effort` and `reasoning.max_tokens` are MUTUALLY EXCLUSIVE (hard 400) —
    an explicit budget wins and the effort key must be absent."""
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort="high", reasoning_tokens=2000
    )
    assert cfg == {"extra_body": {"reasoning": {"max_tokens": 2000}}}
    assert "reasoning_effort" not in cfg


def test_call_config_openrouter_ladder_only_sends_effort() -> None:
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort="low"
    )
    assert cfg == {"reasoning_effort": "low"}


def test_call_config_openrouter_off_maps_to_none_enum() -> None:
    """Our ladder's `"off"` is spelled `"none"` in OpenRouter's enum — and nothing else rides along."""
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort="off"
    )
    assert cfg == {"reasoning_effort": "none"}


def test_call_config_openai_off_maps_to_none_enum() -> None:
    """D45 audit FIX 4 / LOW-6: `off` on the OpenAI dialect used to be a DOUBLE 400 — an out-of-enum
    `reasoning_effort: "off"` AND an unknown `chat_template_kwargs` body key. OpenAI's enum has `none`."""
    cfg = InferenceClient._call_config(_ep(), max_tokens=None, reasoning_effort="off")
    assert cfg == {"reasoning_effort": "none"}


def test_call_config_openrouter_max_clamps_to_xhigh() -> None:
    """D45 audit FIX 1: OpenRouter's enum is EXACTLY xhigh|high|medium|low|minimal|none — `max` is NOT
    accepted (https://openrouter.ai/docs/api_reference/parameters), so sending it 400s every request and
    burns the whole failover chain. Our `max` is chiefly llama.cpp's `-1` sentinel ⇒ clamp to the top
    real rung. `xhigh` IS accepted and must still pass verbatim."""
    clamped = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort="max"
    )
    assert clamped == {"reasoning_effort": "xhigh"}
    verbatim = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort="xhigh"
    )
    assert verbatim == {"reasoning_effort": "xhigh"}


def test_call_config_openrouter_effort_map_stays_inside_the_published_enum() -> None:
    """Every ladder rung must translate to a value OpenRouter actually accepts — a rung added later that
    silently passes verbatim would 400 in production, not in CI."""
    accepted = {"xhigh", "high", "medium", "low", "minimal", "none"}
    for rung in _REASONING_BUDGETS:
        cfg = InferenceClient._call_config(
            _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort=rung
        )
        assert cfg["reasoning_effort"] in accepted, f"{rung} → {cfg['reasoning_effort']} is not in the enum"


def test_call_config_endpoint_reasoning_object_deep_merges_and_suppresses_the_effort_kwarg() -> None:
    """D45 audit FIX 2: an endpoint that hand-sets `extra_body.reasoning` defeated the whole
    mutual-exclusion guarantee three ways. All three are pinned here."""
    hand_set = {"reasoning": {"exclude": True, "effort": "high"}}
    # 1. both spellings in ONE request — the exact hard 400 the openrouter branch exists to prevent.
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter", extra_body=hand_set), max_tokens=None, reasoning_effort="medium"
    )
    assert "reasoning_effort" not in cfg
    assert cfg["extra_body"]["reasoning"] == {"exclude": True, "effort": "high"}
    # 2. a per-call budget DEEP-merges: the endpoint's `exclude` survives (it used to be replaced
    #    wholesale by `extra.update(body)`), and the per-call `max_tokens` evicts the endpoint's `effort`.
    ep = _ep(reasoning_dialect="openrouter", extra_body=hand_set)
    original = {k: dict(v) for k, v in ep.extra_body.items()}
    cfg = InferenceClient._call_config(ep, max_tokens=None, reasoning_tokens=500, reasoning_effort=None)
    assert cfg == {"extra_body": {"reasoning": {"exclude": True, "max_tokens": 500}}}
    assert ep.extra_body == original  # still no config mutation
    # 3. the suppression is structural, not openrouter-specific: any non-empty merged `reasoning` object
    #    wins over the top-level kwarg, so the two spellings can never co-occur on any dialect.
    cfg = InferenceClient._call_config(
        _ep(extra_body={"reasoning": {"effort": "low"}}), max_tokens=None, reasoning_effort="high"
    )
    assert "reasoning_effort" not in cfg


def test_call_config_off_is_absolute_and_ignores_an_explicit_budget() -> None:
    """D45 audit FIX 3: `off` + `reasoning_tokens` used to emit "think up to N" at the sampler AND
    "emit no thinking block" at the template. `off` means off — the override is ignored everywhere."""
    llama = InferenceClient._call_config(
        _ep(reasoning_dialect="llamacpp"), max_tokens=None, reasoning_effort="off", reasoning_tokens=4096
    )
    assert llama == {
        "extra_body": {
            "reasoning_budget_tokens": 0,
            "thinking_budget_tokens": 0,
            "chat_template_kwargs": {"enable_thinking": False},
        }
    }
    router = InferenceClient._call_config(
        _ep(reasoning_dialect="openrouter"), max_tokens=None, reasoning_effort="off", reasoning_tokens=4096
    )
    assert router == {"reasoning_effort": "none"}
    assert _resolve_reasoning_budget("off", 4096) == 0


def test_call_config_emits_only_keys_the_sdk_actually_models() -> None:
    """D45 build-audit HIGH: `_call_config`'s dict is splatted into `AsyncCompletions.create`, whose
    signature is CLOSED (no `**kwargs`). Any top-level key the SDK does not model raises `TypeError`
    before a byte reaches the wire — so vendor keys MUST ride in `extra_body`. This pins the rule
    across every dialect: if the SDK ever models the reasoning keys, this fails and the branch may
    move back up to first-class kwargs."""
    import inspect

    from openai.resources.chat.completions import AsyncCompletions

    params = inspect.signature(AsyncCompletions.create).parameters
    assert not any(p.kind is p.VAR_KEYWORD for p in params.values()), "SDK grew **kwargs — re-check"
    for dialect in ("openai", "llamacpp", "openrouter", "none"):
        for effort in (None, "off", "minimal", "low", "medium", "high", "xhigh", "max"):
            for tokens in (None, 512):
                cfg = InferenceClient._call_config(
                    _ep(reasoning_dialect=dialect),
                    max_tokens=16,
                    reasoning_effort=effort,
                    reasoning_tokens=tokens,
                )
                unmodeled = set(cfg) - set(params)
                assert not unmodeled, f"{dialect}/{effort}/{tokens} would TypeError on: {unmodeled}"


def test_reasoning_budget_table_covers_every_ladder_rung() -> None:
    """The ladder table must be TOTAL over `ModelRef.reasoning_effort`'s Literal: `_resolve_reasoning_
    budget` looks up with `.get()`, so a rung added to the Literal without a table entry would SILENTLY
    send no budget on the budget dialects (no error, no failing test) — pin the two together."""
    from typing import get_args

    from app.adapters.inference import _REASONING_BUDGETS

    rungs = set(get_args(get_args(ModelRef.model_fields["reasoning_effort"].annotation)[0]))
    assert rungs == set(_REASONING_BUDGETS), "ladder Literal and _REASONING_BUDGETS drifted apart"


def test_call_config_dialect_none_drops_both() -> None:
    cfg = InferenceClient._call_config(
        _ep(reasoning_dialect="none"), max_tokens=32, reasoning_effort="high", reasoning_tokens=500
    )
    assert cfg == {"max_tokens": 32}


def test_call_config_dialect_branches_keep_extra_body_merge_and_no_mutation() -> None:
    """Every dialect preserves the invariants: the endpoint's extra_body still merges, per-call keys win,
    and the config object is NEVER mutated. Post-audit this asserts the RULED behaviour — it used to pass
    `off` + 77 and check only the template half, i.e. it ENCODED the FIX 3 contradiction: the template
    lever now exists on `llamacpp` alone (FIX 4), and the 77 is ignored outright (FIX 3)."""
    for dialect in ("openai", "llamacpp", "openrouter", "none"):
        ep = _ep(
            reasoning_dialect=dialect, extra_body={"cache_prompt": True, "chat_template_kwargs": {"foo": 1}}
        )
        original = {k: dict(v) if isinstance(v, dict) else v for k, v in ep.extra_body.items()}
        cfg = InferenceClient._call_config(ep, max_tokens=None, reasoning_effort="off", reasoning_tokens=77)
        assert cfg["extra_body"]["cache_prompt"] is True  # the endpoint's own keys always survive
        assert 77 not in cfg["extra_body"].values(), f"{dialect} honoured a budget under `off`"
        expected_ctk = {"foo": 1, "enable_thinking": False} if dialect == "llamacpp" else {"foo": 1}
        assert cfg["extra_body"]["chat_template_kwargs"] == expected_ctk, dialect
        assert ep.extra_body == original, f"{dialect} mutated the endpoint config"


def test_endpoint_reasoning_dialect_literal_rejects_junk() -> None:
    with pytest.raises(ValidationError):
        InferenceEndpointCfg(reasoning_dialect="llama")


# ── A3. the "your dialect is probably wrong" startup warning (D45 audit FIX 5) ─────────────────────


def test_self_hosted_base_url_heuristic() -> None:
    """Purely lexical, no DNS, no probe: loopback / private range / .local / a bare dotless host / any
    non-web port ⇒ self-hosted; a real cloud API on 443 ⇒ not."""
    for url in (
        "http://127.0.0.1:8080/v1",
        "http://localhost:5433/v1",
        "http://192.168.1.50:8080/v1",
        "http://10.0.0.4/v1",
        "http://172.20.3.9/v1",
        "http://emma:8080/v1",  # bare LAN hostname
        "http://box.local/v1",
        "https://emma.lobster-vector.ts.net:8080/v1",  # tailnet, non-web port
    ):
        assert _looks_self_hosted(url), url
    for url in ("https://api.openai.com/v1", "https://openrouter.ai/api/v1", "http://example.com/v1", ""):
        assert not _looks_self_hosted(url), url


def test_warn_fires_for_default_dialect_on_a_self_hosted_endpoint(caplog) -> None:
    """The feature ships INERT on every existing install (config.yaml is gitignored and keeps the
    back-compat default) — this warning is the only feedback the owner gets, so pin that it names the
    endpoint AND the exact key to set."""
    cfg = InferenceCfg(
        local=InferenceEndpointCfg(base_url="http://127.0.0.1:8080/v1", model="m"),
        cloud=InferenceEndpointCfg(base_url="https://api.openai.com/v1", model="gpt"),
        fallbacks=[InferenceEndpointCfg(base_url="http://emma:8081/v1", model="m")],
    )
    with caplog.at_level(logging.WARNING, logger="ctrlb.inference"):
        warn_suspect_reasoning_dialects(cfg)
    msgs = [r.getMessage() for r in caplog.records]
    assert len(msgs) == 2, msgs  # local + the fallback; the real cloud endpoint stays quiet
    assert "inference.local.reasoning_dialect: llamacpp" in msgs[0]
    assert "http://127.0.0.1:8080/v1" in msgs[0]
    assert "inference.fallbacks[0].reasoning_dialect: llamacpp" in msgs[1]


def test_warn_silent_once_the_dialect_is_set_or_the_endpoint_is_blank(caplog) -> None:
    cfg = InferenceCfg(
        local=InferenceEndpointCfg(
            base_url="http://127.0.0.1:8080/v1", model="m", reasoning_dialect="llamacpp"
        ),
        cloud=InferenceEndpointCfg(base_url="", model=""),
    )
    with caplog.at_level(logging.WARNING, logger="ctrlb.inference"):
        warn_suspect_reasoning_dialects(cfg)
    assert caplog.records == []


# ── B. InferenceError code/status + `is_context_overflow` ──────────────────────────────────────────


def _sdk_error(status: int, code: str | None, message: str) -> BadRequestError:
    """A real OpenAI SDK status error, shaped as the SDK builds it (`body` = the nested `error` object,
    so `.code` = body['code'] and `.status_code` = the HTTP status)."""
    req = httpx.Request("POST", "http://local/v1/chat/completions")
    resp = httpx.Response(status, request=req, json={"error": {"message": message, "code": code}})
    return BadRequestError(
        f"Error code: {status} - {message}", response=resp, body={"message": message, "code": code}
    )


def test_inference_error_carries_code_status() -> None:
    err = InferenceError("boom", code="context_length_exceeded", status=400)
    assert err.code == "context_length_exceeded" and err.status == 400
    assert str(err) == "boom"
    plain = InferenceError("nope")
    assert plain.code is None and plain.status is None


def test_overflow_openai_structured_code() -> None:
    """OpenAI shape: 400 + code `context_length_exceeded` matches on the structured fields."""
    err = InferenceError(
        "Error code: 400 - context_length_exceeded", code="context_length_exceeded", status=400
    )
    assert is_context_overflow(err) is True
    # the raw SDK error matches too (status_code + code attrs)
    assert is_context_overflow(_sdk_error(400, "context_length_exceeded", "too long")) is True


def test_overflow_llamacpp_message_shape() -> None:
    """llama.cpp reports it in the 400 message text, not a code — the substring path catches it."""
    err = InferenceError(
        "local: Error code: 400 - the request exceeds the available context size, try increasing it",
        code=None,
        status=400,
    )
    assert is_context_overflow(err) is True
    # flattened multi-hop: no status on the outer error, but "error code: 400" + a marker in the message
    flattened = InferenceError(
        "all endpoints failed: local: Error code: 400 - this model's maximum context length is 8192 tokens"
    )
    assert is_context_overflow(flattened) is True


def test_overflow_negative_matrix() -> None:
    """An unrelated 400 and any 5xx are NOT overflows (conservative)."""
    assert is_context_overflow(InferenceError("Error code: 400 - invalid 'tool_choice'", status=400)) is False
    assert is_context_overflow(_sdk_error(400, "invalid_request_error", "bad param")) is False
    assert is_context_overflow(InferenceError("Error code: 500 - internal", status=500)) is False
    # a marker phrase without a 400 (e.g. a 429 mentioning context) does not match
    assert is_context_overflow(InferenceError("Error code: 429 - context window busy", status=429)) is False
    assert is_context_overflow(RuntimeError("connection refused")) is False


# ── C. the kwargs reach `create()` (fake SDK client) + the failover ride ───────────────────────────


class _Delta:
    def __init__(self, content=""):
        self.content = content
        self.reasoning_content = None
        self.tool_calls = []
        self.model_extra = None


class _Chunk:
    def __init__(self, delta):
        self.choices = [type("Ch", (), {"delta": delta})()]


class _Stream:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        x = self._items.pop(0)
        if isinstance(x, Exception):
            raise x
        return x

    async def close(self):
        pass


class _Resp:
    def __init__(self, content):
        self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]


class _Completions:
    def __init__(self, behavior):
        self._behavior = behavior
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._behavior(kwargs)


class _Client:
    def __init__(self, behavior):
        self.chat = type("Chat", (), {"completions": _Completions(behavior)})()


def _build(cfg: InferenceCfg, behaviors: dict[str, object]):
    client = InferenceClient(cfg)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _cfg(**kw) -> InferenceCfg:
    base = dict(
        default_mode="local",
        local=InferenceEndpointCfg(base_url="http://local/v1", model="minig"),
        cloud=InferenceEndpointCfg(base_url="http://cloud/v1", model="gemma"),
    )
    base.update(kw)
    return InferenceCfg(**base)


def _stream_ok(*texts):
    return lambda _kw: _Stream([_Chunk(_Delta(content=t)) for t in texts])


async def _collect(client, **kw):
    return [d async for d in client.stream_chat([{"role": "user", "content": "hi"}], **kw)]


def test_stream_chat_threads_modeled_kwargs_to_create() -> None:
    client, fakes = _build(_cfg(), {"http://local/v1": _stream_ok("hi")})
    _run(_collect(client, max_tokens=128, reasoning_effort="high"))
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["max_tokens"] == 128
    assert call["reasoning_effort"] == "high"


def test_stream_chat_off_sends_chat_template_kwargs() -> None:
    """End-to-end through `stream_chat`: the template lever reaches the wire on a llamacpp endpoint —
    and (D45 audit FIX 4) does NOT on the default dialect, which sends the `none` enum value instead."""
    llama = _cfg(
        local=InferenceEndpointCfg(base_url="http://local/v1", model="m", reasoning_dialect="llamacpp")
    )
    client, fakes = _build(llama, {"http://local/v1": _stream_ok("hi")})
    _run(_collect(client, reasoning_effort="off"))
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert "reasoning_effort" not in call
    assert call["extra_body"]["chat_template_kwargs"] == {"enable_thinking": False}

    client, fakes = _build(_cfg(), {"http://local/v1": _stream_ok("hi")})
    _run(_collect(client, reasoning_effort="off"))
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["reasoning_effort"] == "none"
    assert "extra_body" not in call


def test_stream_chat_unset_kwargs_send_no_none_keys() -> None:
    client, fakes = _build(_cfg(), {"http://local/v1": _stream_ok("hi")})
    _run(_collect(client))
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert "max_tokens" not in call and "max_completion_tokens" not in call
    assert "reasoning_effort" not in call
    assert "extra_body" not in call  # no empty extra_body


def test_params_ride_to_fallback_with_its_own_field_name() -> None:
    """A failover serve applies max_tokens under the SERVING endpoint's field name (D42 chain-wide)."""

    def _down(_kw):
        raise RuntimeError("local down")

    cfg = _cfg(
        local=InferenceEndpointCfg(base_url="http://local/v1", model="minig"),  # max_tokens_field default
        cloud=InferenceEndpointCfg(
            base_url="http://cloud/v1", model="gemma", max_tokens_field="max_completion_tokens"
        ),
    )
    client, fakes = _build(cfg, {"http://local/v1": _down, "http://cloud/v1": _stream_ok("x")})
    _run(_collect(client, max_tokens=64))
    local_call = fakes["http://local/v1"].chat.completions.calls[0]
    cloud_call = fakes["http://cloud/v1"].chat.completions.calls[0]
    assert local_call["max_tokens"] == 64  # selected endpoint: classic name
    assert cloud_call["max_completion_tokens"] == 64  # fallback: its own field name
    assert "max_tokens" not in cloud_call


def test_complete_threads_modeled_kwargs_to_create() -> None:
    client, fakes = _build(_cfg(), {"http://local/v1": lambda _kw: _Resp("done")})
    out = _run(client.complete([{"role": "user", "content": "hi"}], max_tokens=99, reasoning_effort="low"))
    assert out == "done"
    call = fakes["http://local/v1"].chat.completions.calls[0]
    assert call["max_tokens"] == 99 and call["reasoning_effort"] == "low"


def test_stream_chat_overflow_populates_code_status() -> None:
    """A single-endpoint context-overflow surfaces as an InferenceError carrying the structured fields."""

    def _overflow(_kw):
        raise _sdk_error(400, "context_length_exceeded", "maximum context length is 8192")

    client, _ = _build(_cfg(failover=False), {"http://local/v1": _overflow})
    raised: InferenceError | None = None
    try:
        _run(_collect(client))
    except InferenceError as exc:
        raised = exc
    assert raised is not None
    assert raised.status == 400 and raised.code == "context_length_exceeded"
    assert is_context_overflow(raised) is True


# ── C2. the anchoring-inactive notice (R4) ─────────────────────────────────────────────────────────


class _UsageChunk:
    """A final stream chunk carrying `usage.prompt_tokens` (the cloud include_usage shape) — so the
    telemetry capture records a prompt total and anchoring is ACTIVE."""

    def __init__(self, prompt_tokens: int) -> None:
        self.choices = []
        self.usage = type("U", (), {"prompt_tokens": prompt_tokens, "prompt_tokens_details": None})()
        self.model_extra = None


def test_anchoring_notice_fires_once_when_no_prompt_total(caplog) -> None:
    """R4: a COMPLETED stream that reports NO prompt-token total logs the anchoring-inactive notice
    EXACTLY once per client instance — not on the second such stream."""
    import logging

    from app.adapters.inference import StreamReport

    client, _ = _build(_cfg(), {"http://local/v1": _stream_ok("hi")})
    with caplog.at_level(logging.INFO, logger="ctrlb.inference"):
        _run(_collect(client, report=StreamReport()))  # first completed stream, no total
        _run(_collect(client, report=StreamReport()))  # second, still no total
    notices = [r for r in caplog.records if "anchoring inactive" in r.getMessage()]
    assert len(notices) == 1  # emitted once, across two totals-less streams
    assert "return_progress" in notices[0].getMessage() and "include_usage" in notices[0].getMessage()


def test_anchoring_notice_silent_when_total_present(caplog) -> None:
    """A stream that DOES report a prompt total (anchoring active) never emits the notice."""
    import logging

    from app.adapters.inference import StreamReport

    behavior = lambda _kw: _Stream([_Chunk(_Delta(content="hi")), _UsageChunk(1234)])  # noqa: E731
    client, _ = _build(_cfg(), {"http://local/v1": behavior})
    report = StreamReport()
    with caplog.at_level(logging.INFO, logger="ctrlb.inference"):
        _run(_collect(client, report=report))
    assert report.prompt_tokens == 1234  # the total was captured → anchoring active
    assert not any("anchoring inactive" in r.getMessage() for r in caplog.records)


# ── D. the summarizer wire (`_summarize`) ──────────────────────────────────────────────────────────


class _FakeInfer:
    """Captures the `complete` kwargs + serves a canned window/reply (like the W3 fake, + kwargs)."""

    def __init__(self, *, window: int | None = None, reply: str = "the summary body") -> None:
        self._window = window
        self._reply = reply
        self.kwargs: list[dict] = []

    async def effective_window_for(self, mode: str | None = None) -> int | None:
        return self._window

    async def complete(
        self, payload, *, mode=None, model=None, max_tokens=None, reasoning_effort=None, reasoning_tokens=None
    ) -> str:
        self.kwargs.append(
            {
                "max_tokens": max_tokens,
                "reasoning_effort": reasoning_effort,
                "reasoning_tokens": reasoning_tokens,
            }
        )
        return self._reply


def _summarize_with(summarizer: ModelRef, fake: _FakeInfer):
    cfg = CompactionCfg(summarizer=summarizer)
    comp = Compactor(cast("InferenceClient", fake), cast("MessageRepo", None), cfg)
    head = [
        Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text="please wake corsair")]),
        Message(thread_id="t", role="assistant", actor=Actor.AGENT, parts=[TextPart(text="corsair is up")]),
    ]
    return _run(comp._summarize(head))


def test_summarizer_capped_when_max_tokens_set() -> None:
    fake = _FakeInfer()
    # D45: the summarizer's `reasoning_tokens` threads through too (a summary benefits from a low budget)
    body, truncated = _summarize_with(
        ModelRef(max_tokens=512, reasoning_effort="off", reasoning_tokens=128), fake
    )
    assert not truncated and body.startswith(SUMMARY_PREFIX)
    assert fake.kwargs[0] == {"max_tokens": 512, "reasoning_effort": "off", "reasoning_tokens": 128}


def test_summarizer_uncapped_when_max_tokens_unset() -> None:
    fake = _FakeInfer()
    _summarize_with(ModelRef(), fake)
    assert fake.kwargs[0] == {"max_tokens": None, "reasoning_effort": None, "reasoning_tokens": None}


def test_summarizer_overflow_guard_tightens_with_a_large_cap() -> None:
    """The guard reserves max(max_tokens, window×margin). A cap LARGER than the fraction margin
    tightens the guard: a transcript that fits with no cap now trips to the truncation-fold."""
    # window 2000, margin 0.2 → fraction reserve 400; the small payload (system + tiny transcript) fits.
    ok = _FakeInfer(window=2000)
    body, truncated = _summarize_with(ModelRef(), ok)
    assert not truncated and ok.kwargs  # ran the summarizer

    # same window, but a 1900-token output cap → reserve 1900 → limit 100 → the payload overflows → skip.
    tight = _FakeInfer(window=2000)
    body2, truncated2 = _summarize_with(ModelRef(max_tokens=1900), tight)
    assert truncated2 and body2 == TRUNCATION_NOTICE and tight.kwargs == []  # never called


# ── E. the reactive backstop (driving `_drive`) ────────────────────────────────────────────────────


def _client_app():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace():
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("computers: {}\n", encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _asst(t: str) -> Message:
    return Message(thread_id="t", role="assistant", actor=Actor.AGENT, parts=[TextPart(text=t)])


def _user(t: str) -> Message:
    return Message(thread_id="t", role="user", actor=Actor.USER, parts=[TextPart(text=t)])


async def _seed(state, thread) -> None:
    # LARGE messages so a real force-fold SHRINKS the head (a small summary is smaller).
    for i in range(6):
        m = _user("u" * 400) if i % 2 == 0 else _asst("a" * 400)
        m.thread_id = thread.id
        await state.messages.add(m)


_OVERFLOW = InferenceError(
    "Error code: 400 - context_length_exceeded", code="context_length_exceeded", status=400
)


def _backstop_session(state, thread, *, summary: str | None = "tiny summary"):
    """A session whose pre-stream auto-compaction is inert (big window, so never over threshold) and
    whose summarizer either shrinks (`summary` set) or inflates (`summary=None`, huge reply → reject)."""
    from app.api.agent import _build_session

    session = _build_session(state, thread)
    cfg = CompactionCfg(keep_last_messages=2, keep_recent_tokens=5)
    session._compaction_cfg = cfg
    session._compactor = Compactor(session._inference, state.messages, cfg)

    async def big_window(ep):
        return 10_000_000  # pre-stream trigger never fires; the backstop's force-fold ignores it anyway

    async def no_guard(mode=None):
        return None  # no summarizer overflow guard → the summarizer actually runs

    async def reply(payload, *, mode=None, model=None, max_tokens=None, reasoning_effort=None, **_kw):
        return ("Z" * 50000) if summary is None else summary

    session._inference.effective_window = big_window  # type: ignore[assignment]
    session._inference.effective_window_for = no_guard  # type: ignore[assignment]
    session._inference.complete = reply  # type: ignore[assignment]
    return session


def _scripted_stream(*, overflow_calls: int, then_text: str = "recovered", partial: str | None = None):
    """A fake `stream_chat`: raise overflow for the first `overflow_calls` calls, then stream `then_text`.
    `partial` (if set) yields a text delta BEFORE raising on the first call (the streamed-partial case)."""
    calls = {"n": 0}

    async def stream_chat(messages, *, max_tokens=None, reasoning_effort=None, **_kw):
        n = calls["n"]
        calls["n"] += 1
        from app.adapters.inference import ChatDelta

        if n < overflow_calls:
            if partial is not None:
                yield ChatDelta(text=partial)
            raise _OVERFLOW
        yield ChatDelta(text=then_text)

    return stream_chat, calls


def test_backstop_overflow_nothing_streamed_recovers_with_one_fold() -> None:
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed(state, thread)
            session = _backstop_session(state, thread)
            stream_chat, calls = _scripted_stream(overflow_calls=1, then_text="recovered")
            session._inference.stream_chat = stream_chat  # type: ignore[assignment]

            events = [ev async for ev in session._drive(thread)]
            kinds = [e.event for e in events]
            # exactly ONE message.start (same assistant slot re-used across the re-stream) …
            assert kinds.count("message.start") == 1
            assert kinds.count("compaction") == 1  # the forced backstop fold
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "completed"
            assert calls["n"] == 2  # first overflowed, second (post-fold) recovered
            # exactly ONE persisted assistant message carries the recovered text (no duplicate bubble),
            # and no ErrorPart was persisted for this turn.
            live = await state.messages.list(thread.id, include_compacted=False)
            recovered = [m for m in live if m.role == "assistant" and m.text() == "recovered"]
            assert len(recovered) == 1
            assert not any(p.__class__.__name__ == "ErrorPart" for m in live for p in m.parts)

        _run(go())


def test_backstop_skipped_after_partial_stream() -> None:
    """Overflow AFTER a visible partial reached the wire → NO backstop (can't re-stream a live bubble)."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed(state, thread)
            session = _backstop_session(state, thread)
            stream_chat, calls = _scripted_stream(overflow_calls=1, partial="half a word")
            session._inference.stream_chat = stream_chat  # type: ignore[assignment]

            events = [ev async for ev in session._drive(thread)]
            kinds = [e.event for e in events]
            assert "compaction" not in kinds  # no backstop fold
            assert calls["n"] == 1  # no re-stream
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "error"

        _run(go())


def test_backstop_second_overflow_same_turn_no_second_attempt() -> None:
    """The re-stream overflows again → the one-shot flag blocks a second fold → normal error path."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed(state, thread)
            session = _backstop_session(state, thread)
            stream_chat, calls = _scripted_stream(overflow_calls=2)  # both calls overflow
            session._inference.stream_chat = stream_chat  # type: ignore[assignment]

            events = [ev async for ev in session._drive(thread)]
            kinds = [e.event for e in events]
            assert kinds.count("compaction") == 1  # the fold happened exactly once
            assert calls["n"] == 2  # one re-stream, no third attempt
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "error"

        _run(go())


def test_backstop_inflation_reject_falls_to_error() -> None:
    """The forced compact inflation-rejects (huge summary) → nothing folded → normal error path."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        async def go() -> None:
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed(state, thread)
            session = _backstop_session(state, thread, summary=None)  # inflating summarizer → reject
            stream_chat, calls = _scripted_stream(overflow_calls=1)
            session._inference.stream_chat = stream_chat  # type: ignore[assignment]

            events = [ev async for ev in session._drive(thread)]
            kinds = [e.event for e in events]
            assert "compaction" not in kinds  # the reject writes nothing → no compaction event
            assert calls["n"] == 1  # no successful re-stream
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "error"

        _run(go())


# ── E2. the backstop-vs-semaphore regression pin (P4, D42 post-build audit) ─────────────────────────


def test_backstop_shares_single_slot_endpoint_without_deadlock() -> None:
    """P4 regression pin: the reactive backstop over a REAL `InferenceClient` whose endpoint is a
    SINGLE request slot (`max_concurrent_requests=1`), with the forced-compaction summarizer routed to
    that SAME endpoint.

    The first stream attempt context-overflows AT INIT (before any token) — so its permit MUST be
    released on the failed attempt (`stream_chat`'s except branch). The backstop then force-folds, and
    the summarizer's `complete()` must ACQUIRE that one slot without blocking; then the re-stream (that
    same endpoint) recovers. If the failed stream leaked its slot, `complete()` would deadlock on
    `sem.acquire()` — so a clean `completed` within the timeout IS the pin. Uses the section-C fake SDK
    transport (one behavior serving both the streaming `create(stream=True)` and the buffered
    `create(stream=False)`), NOT a stubbed `stream_chat`/`complete`, so the real semaphore path runs."""
    with _workspace(), _client_app() as c:
        state = c.app.state

        # A REAL client over a single-slot local endpoint + fake SDK transport (no failover chain).
        cfg = _cfg(
            local=InferenceEndpointCfg(base_url="http://local/v1", model="minig", max_concurrent_requests=1),
            failover=False,
        )
        seen = {"stream": 0, "complete": 0}

        def behavior(kw):
            if kw.get("stream"):
                seen["stream"] += 1
                if seen["stream"] == 1:  # first stream overflows at init (before any token)
                    raise _sdk_error(400, "context_length_exceeded", "maximum context length is 8192")
                return _Stream([_Chunk(_Delta(content="recovered"))])  # the post-fold re-stream
            seen["complete"] += 1  # the summarizer, same single-slot endpoint
            return _Resp("tiny summary")

        client, _ = _build(cfg, {"http://local/v1": behavior})

        # Keep only the /props window probes inert — the real semaphore path in stream_chat/complete
        # stays live (that is what this pin exercises).
        async def big_window(ep):
            return 10_000_000

        async def no_guard(mode=None):
            return None

        client.effective_window = big_window  # type: ignore[assignment]
        client.effective_window_for = no_guard  # type: ignore[assignment]

        async def go() -> None:
            from app.api.agent import _build_session
            from app.domain.conversation import Thread

            thread = await state.threads.create(Thread())
            await _seed(state, thread)
            session = _build_session(state, thread)
            session._inference = client  # the REAL single-slot client
            fold_cfg = CompactionCfg(keep_last_messages=2, keep_recent_tokens=5)
            session._compaction_cfg = fold_cfg
            session._compactor = Compactor(client, state.messages, fold_cfg)

            async def collect():
                return [ev async for ev in session._drive(thread)]

            events = await asyncio.wait_for(collect(), timeout=10.0)  # deadlock ⇒ TimeoutError, not hang
            kinds = [e.event for e in events]
            assert kinds.count("message.start") == 1  # one re-used assistant slot
            assert kinds.count("compaction") == 1  # exactly one forced fold
            done = next(e for e in events if e.event == "done")
            assert done.data["state"] == "completed"
            # one summarizer acquire + one recovering re-stream, all on the single slot, no deadlock
            assert seen == {"stream": 2, "complete": 1}
            live = await state.messages.list(thread.id, include_compacted=False)
            recovered = [m for m in live if m.role == "assistant" and m.text() == "recovered"]
            assert len(recovered) == 1

        _run(go())


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
