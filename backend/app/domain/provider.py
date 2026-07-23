"""Resolved provider targets — frozen value types (A11 / D48 §Module boundary).

`domain/provider.py` holds ONLY frozen value types: what the resolver (`core/provider_registry.py`)
produces and what an adapter consumes at the wire. No I/O, no live `Settings`, no YAML — the same
layering discipline as `domain/agent.py`.

- `ResolvedTarget` is one fully-resolved connection+model: everything the wire needs to make a call,
  computed once at resolution (the `max_tokens_field` ladder, the effective concurrency cap post
  min-wins, the effective retry budget, the canonical `gate_identity`). An adapter reads these fields
  and calls `api_key.get_secret_value()` at the wire only.
- `SectionPolicy` is the per-call frozen snapshot of a consumer section's own knobs (chat: timeout /
  failover / global retry). Captured at resolution so no layer below `config.py` holds live Settings.

Both are `frozen=True` pydantic models (matching the config idiom); `api_key` carries `repr=False` so
a stray `repr()`/log never prints the credential.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, SecretStr

#: The wire-dialect enum (D45/D46), re-declared here so domain/adapters don't import it from config.
ApiMode = Literal["openai", "llamacpp", "openrouter", "none"]
#: The output-cap field spelling (D46) — resolved once onto `ResolvedTarget.resolved_max_tokens_field`.
MaxTokensField = Literal["max_tokens", "max_completion_tokens"]


class ResolvedTarget(BaseModel):
    """One fully-resolved provider+model target (A11 / D48 §Module boundary). Frozen: the resolver
    builds it, the adapter consumes it, nobody mutates it. Everything the wire needs in one object —
    the connection (base_url, api_key, api_mode, the resolved output-cap field), the wire model id +
    its metadata (context_window, extra_body, and the voice/embeddings role fields that arrive in
    Slice 2), the canonical `gate_identity`, and the effective concurrency/retry knobs (post min-wins /
    provider-over-global).

    Attribute names deliberately mirror what the chat adapter already read off the old endpoint object
    (`base_url` / `api_mode` / `resolved_max_tokens_field` / `extra_body` / `context_window`) so the
    wire builder is unchanged. `provider` is the connection name (the failover-log label + the `/verb`);
    `model` is the WIRE model id sent to the server."""

    model_config = {"frozen": True}

    provider: str  # the connection name (failover label + composer verb)
    base_url: str
    api_key: SecretStr | None = Field(
        default=None, repr=False
    )  # never printed; wire calls .get_secret_value()
    api_mode: ApiMode = "openai"
    #: The output-cap field spelling for THIS target (D46/C6 ladder resolved at construction): model
    #: explicit > provider explicit > derived-from-api_mode. The wire boundary reads ONLY this.
    resolved_max_tokens_field: MaxTokensField = "max_completion_tokens"
    model: str = ""  # the WIRE model id sent to the server (the catalog id, or a raw passthrough id)
    context_window: int | None = None  # chat; D42 explicit-window (explicit > probe > None)
    extra_body: dict[str, Any] = Field(default_factory=dict)  # chat-call passthrough (MODEL-level home)
    # Role fields (schema-complete in Slice 1; consumed by the voice/embeddings adapters in Slice 2).
    language: str | None = None  # STT
    voice: str | None = None  # TTS
    speed: float | None = None  # TTS
    format: str | None = None  # TTS
    dim: int | None = None  # embeddings
    #: Canonical full base_url (C4) — the D40 gate identity. Different paths = different gates by design.
    gate_identity: str = ""
    #: Effective per-server concurrency cap (C4 post min-wins across a shared gate_identity). None = unlimited.
    max_concurrent_requests: int | None = None
    #: Effective same-endpoint retry budget (D43): provider override > section global. None only when the
    #: section has no global (unreachable for chat — InferenceCfg.retry_attempts has a default).
    retry_attempts: int | None = None


class SectionPolicy(BaseModel):
    """The per-call frozen snapshot of a CHAT consumer section's own knobs (A11 / D48 §Module boundary).
    Captured at resolution and handed to the adapter so no layer below `config.py` reads live Settings.

    Chat scope now: `request_timeout_s` (the SDK client timeout), `failover` (walk the chain vs the sole
    selected target), `retry_attempts` (the GLOBAL same-endpoint budget — a target's own override lives
    on `ResolvedTarget.retry_attempts`)."""

    model_config = {"frozen": True}

    request_timeout_s: float = 600.0
    failover: bool = True
    retry_attempts: int = 2


class SttPolicy(BaseModel):
    """The per-call frozen snapshot of the STT service's own knobs (A11 / D48 §Module boundary / C8).
    Captured at resolution alongside the STT chain; the voice adapter reads it at the wire and never
    touches live Settings. `language` is the SERVICE fallback (a target's own `language` wins — C8
    model > service precedence); `vad_filter`/`hotwords` ride the SDK `extra_body` escape hatch (Speaches
    extras); `extra_body` is the service-level passthrough. The transport pair (`connect_timeout_s` /
    `timeout_s`) also keys the adapter's SDK-client cache (immutable per generation, C4/R10)."""

    model_config = {"frozen": True}

    language: str = ""  # SERVICE fallback (blank → omit → server auto-detects); model language wins
    vad_filter: bool = True
    hotwords: str = ""
    connect_timeout_s: float = 3.0
    timeout_s: float = 30.0
    extra_body: dict[str, Any] = Field(default_factory=dict)


class TtsPolicy(BaseModel):
    """The per-call frozen snapshot of the TTS service's own knobs (A11 / D48 §Module boundary / C8).
    `format` is the SERVICE fallback container (a target's own `format` wins — C8 model > service; the
    WINNING failover hop's effective format sets the response media type, never precomputed). The
    transport pair also keys the adapter's SDK-client cache. Voice id + speed are NOT here — they are
    request/model-level (C8: request > model voice > "alloy"; model speed)."""

    model_config = {"frozen": True}

    format: str = "mp3"  # SERVICE fallback; model format wins (C8)
    connect_timeout_s: float = 3.0
    timeout_s: float = 30.0
    extra_body: dict[str, Any] = Field(default_factory=dict)


class EmbeddingsPolicy(BaseModel):
    """The per-call frozen snapshot of the embeddings service's own knobs (A11 / D48 §Module boundary).
    Only `timeout_s` is section-level (the SDK client read window); `enabled` is passed into the client
    at construction (frozen per generation) and the chain's agreed `dim` (C8) rides the resolved targets."""

    model_config = {"frozen": True}

    timeout_s: float = 60.0
