"""Config loading/saving + typed settings (Phase 0 slice).

Secrets model — **hybrid** (DECISIONS §config-secrets):
- `config.yaml` is the single **UI-managed source of truth**, including nested secrets
  (per-host SSH creds, per-endpoint API keys, per-MCP-server env/headers). It's gitignored,
  masked on API read, written atomically — the Conf tab round-trips it. Structured, repeating
  secrets don't fit a flat `.env`, and the UI can't rewrite `.env`, so they stay here.
- `.env` is the **bootstrap + override** layer: deploy knobs (`CTRLB_CONFIG`, `CTRLB_DB`) and
  optional scalar secret overrides (`CTRLB_<SECTION>__<KEY>`) that **win over** `config.yaml`.
  This lets you keep a key out of the YAML if you prefer, without breaking the UI.

`.env` populates `os.environ` (real env always wins); the override layer is then applied on top
of the parsed YAML before validation.
"""

from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import logging
import os
import re
from dataclasses import dataclass
from dataclasses import field as _dc_field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, ClassVar, Literal, TypeGuard
from urllib.parse import urlsplit

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator
from ruamel.yaml import YAML

from app.domain.agent import AgentDef, CompactionCfg, ModelRef
from app.domain.enums import OSType, Risk
from app.domain.host import Host
from app.domain.service import Service

__all__ = [
    "Settings",
    "ModelRef",
    "AgentDef",
    "CompactionCfg",
    "TurnsCfg",
    "load_settings",
    "save_settings",
    "mask_secrets",
    "secret_values",
    "unmask_secrets",
    "deep_merge",
    "apply_patch_to_yaml",
    "prune_unchanged",
    "edit_config_yaml",
    "sync_mapping",
    "deep_set",
    "host_slug",
    "is_provider_slug",
    "is_secret_sentinel_name",
    "providers_rev",
]

# backend/app/config.py -> repo root (where config.yaml / ctrlb.db / skills / agents default)
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

ENV_PREFIX = "CTRLB_"
#: Env vars handled as bootstrap paths, not as config-section overrides.
_BOOTSTRAP_KEYS = {"HOME", "CONFIG", "DB", "ENV"}

#: Secret identification (see the mask/secret_values/unmask helpers below). Two disjoint rules:
#:  1. `_SECRET_LEAF_KEYS` — DECLARED config keys whose value is a secret. **Exact names, not
#:     substrings**, so non-secret fields like `threshold_tokens`/`max_tokens`/`*_key` are never
#:     masked. Adding a secret field = add its exact name here (the secret-hygiene test fails if a
#:     secret-looking field is left unclassified — see `SECRET_HINTS`).
#:  2. `_SECRET_MAP_KEYS` — config keys holding an arbitrary USER-keyed credential map (MCP/OpenAPI
#:     `env`/`headers`). Their keys aren't known up front, so inside them a value is masked only when
#:     its OWN key matches `_MAP_SECRET_HINTS` — keeping routine headers (`Content-Type`) visible
#:     while masking `Authorization`/`X-API-Key`/tokens.
_SECRET_LEAF_KEYS = frozenset({"api_key", "ssh_password"})
_SECRET_MAP_KEYS = frozenset({"env", "headers"})
#: Sub-key hints for the arbitrary maps ONLY (never applied to declared config field names). Broad on
#: purpose: inside a credential map, under-masking a token is the real risk while a wrongly-masked
#: value is merely cosmetic (a string shown as ••••; `unmask` restores it).
_MAP_SECRET_HINTS = ("password", "secret", "token", "key", "auth", "bearer", "credential", "cookie")
#: Broad candidate hints for the **drift-guard test only** (not used at runtime): the test flags any
#: config field whose name matches one of these and fails unless it's classified (secret set, or the
#: test's known-non-secret allowlist) — so a future `client_secret` can't silently go unmasked.
SECRET_HINTS = ("password", "secret", "token", "key")

#: Provider slug (A11/D48): the `providers` map key + the `/<provider>` composer verb.
_PROVIDER_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_+.-]{0,31}$")
#: Exact NAMES a provider/model key must NOT collide with (D48 C1 defense-in-depth): a name that equals a
#: secret sentinel key would confuse the path-aware secret machinery, so the PUT/schema reject it. Built
#: from the secret sets + the extra sentinels D48 names. Shared by the schema (here) and, in wave B2, the
#: PUT-level rejection.
_SECRET_SENTINEL_NAMES = _SECRET_LEAF_KEYS | _SECRET_MAP_KEYS | frozenset({"password", "token"})


def is_secret_sentinel_name(name: object) -> bool:
    """True if `name` collides with a secret-sentinel key (`api_key`/`ssh_password`/`password`/`token`/
    `env`/`headers`) — the D48 C1 provider/model name guard. Case-insensitive, whitespace-stripped."""
    return isinstance(name, str) and name.strip().lower() in _SECRET_SENTINEL_NAMES


def is_provider_slug(v: object) -> bool:
    """True if `v` is a string matching the provider slug (`^[a-z0-9][a-z0-9_+.-]{0,31}$`). The ONE
    syntax check shared by the schema (provider map keys) and the SYNTAX-ONLY request-mode coercion
    (`api/agent.py._coerce_mode`, D48 C7/R14 — a mode string is a provider name; request models can't
    see settings, so resolution against the captured registry coerces an unknown-but-valid slug)."""
    return isinstance(v, str) and bool(_PROVIDER_SLUG_RE.match(v))


def _is_flat_scalar_map(v: object) -> TypeGuard[dict[Any, Any]]:
    """True if `v` is a dict whose values are ALL scalars (no nested dict/list) — a genuine credential
    map (`env`/`headers`: str→str). The path-aware discriminator (D48 C1): a provider/model OBJECT that
    happens to be keyed by a sentinel name (`providers['env']`) carries nested structure (its `models`
    map), so it fails this and recurses normally instead of being flat-masked as a credential map."""
    return isinstance(v, dict) and all(not isinstance(mv, (dict, list)) for mv in v.values())


def _env_file() -> Path:
    override = os.environ.get("CTRLB_ENV")
    return Path(override).expanduser().resolve() if override else _PROJECT_ROOT / ".env"


def load_dotenv() -> None:
    """Populate `os.environ` from `.env`. Real environment variables always take precedence."""
    p = _env_file()
    if not p.exists():
        return
    for k, v in dotenv_values(p).items():
        if v is not None and k not in os.environ:
            os.environ[k] = v


def home_path() -> Path:
    """The relocatable workspace root (D14/D15 #2) holding `config.yaml`, `ctrlb.db`, `SOUL.md`,
    `memories/`, `skills/`, `agents/`. `CTRLB_HOME` wins; otherwise the project root, so an existing
    corsair checkout keeps working unchanged. emma / new installs set `CTRLB_HOME=~/.ctrl-b`."""
    override = os.environ.get("CTRLB_HOME")
    return Path(override).expanduser().resolve() if override else _PROJECT_ROOT


def config_path() -> Path:
    """Resolve the config file path. An explicit `CTRLB_CONFIG` still overrides directly (back-compat
    + the temp-config test workflow); otherwise it derives from `$CTRLB_HOME` (D15 #2 — layered)."""
    override = os.environ.get("CTRLB_CONFIG")
    return Path(override).expanduser().resolve() if override else home_path() / "config.yaml"


class ServerCfg(BaseModel):
    host: str = "127.0.0.1"  # tailnet-only; fronted by Tailscale Serve for HTTPS
    port: int = 5433  # 5433 so v2 runs alongside the live Flask app on 5432
    poll_seconds: int = 5  # fleet status poll cadence
    feature_cycle_seconds: int = 6  # hero "now monitoring" auto-cycle period (online hosts only)
    debug: bool = False  # off by default — debug is an RCE surface (ARCHITECTURE §7)


class ModelCfg(BaseModel):
    """One model in a provider's catalog (A11/D48). The map KEY is the clean display name; `id` is the
    WIRE model id sent to the server (defaults to the key when absent — lossless). The typed per-role
    fields are declared for every consumer section so adding the next per-model datum is one additive
    field, never a sibling map: chat (`context_window`/`extra_body`/`max_tokens_field`), TTS
    (`voice`/`speed`/`format`), STT (`language`), embeddings (`dim`). `extra="allow"` keeps a future
    per-model field round-tripping. The voice/embeddings consumers arrive in Slice 2; the schema is
    complete now (D48 Final config shape)."""

    model_config = {"extra": "allow"}

    id: str | None = None  # wire model id; None -> the catalog KEY (auto-hidden in UI when == key)
    #: Manual context window in tokens (D42) - drives the fraction-of-window compaction trigger.
    #: Precedence: this explicit value > the probed llama.cpp /props n_ctx > None (=> the absolute
    #: threshold_tokens fallback). Config wins over the probe (upward overrides allowed).
    context_window: int | None = Field(default=None, ge=1)
    #: OpenAI-SDK passthrough merged into THIS model's chat call - MODEL-level, never provider-wide
    #: (OpenAI 400s on unknown args). Canonical use: the llama.cpp prompt-cache pin {cache_prompt:true}
    #: + streaming cache telemetry (return_progress / stream_options.include_usage).
    extra_body: dict[str, Any] = Field(default_factory=dict)
    #: Per-model override of the output-cap field spelling (D46/C6 ladder: model > provider > derived).
    #: None inherits the provider's max_tokens_field, which itself derives from api_mode when unset.
    max_tokens_field: Literal["max_tokens", "max_completion_tokens"] | None = None
    dim: int | None = Field(default=None, ge=1)  # embeddings vector dimension (Slice 2)
    voice: str | None = None  # TTS server voice id (Slice 2)
    speed: float | None = Field(default=None, gt=0)  # TTS playback speed (Slice 2)
    language: str | None = None  # STT forced language (Slice 2)
    format: str | None = None  # TTS response container (Slice 2)


class ProviderCfg(BaseModel):
    """One CONNECTION (A11/D48): base_url + server behavior + a name-keyed model catalog. The top-level
    `providers` map KEY is the provider slug (^[a-z0-9][a-z0-9_+.-]{0,31}$, validated on Settings) -
    also the /<provider> composer verb. SERVER-capacity + wire-dialect knobs are provider-level
    (api_mode / max_concurrent_requests / retry_attempts / max_tokens_field); per-model data live on
    ModelCfg. Adding the next connection knob is one additive field here (the "shape data to extend"
    rule). api_key optional (omitted = no-auth); masked in the API, blank-keeps on PUT."""

    model_config = {"extra": "allow"}

    base_url: str = ""  # e.g. http://192.168.1.137:5001/v1
    api_key: str | None = None  # optional; omitted = no-auth
    #: Which API wire shape THIS server speaks (D45/D46). Drives BOTH the reasoning translation and the
    #: derived max_tokens_field. openai (default) | llamacpp | openrouter | none. NOT auto-detected from
    #: base_url (D46 field research) - only the operator knows.
    api_mode: Literal["openai", "llamacpp", "openrouter", "none"] = "openai"
    #: App-side request gate (D40) - SERVER capacity, so PROVIDER-level: the D40 semaphore keys on this
    #: provider's canonical base_url. None = unlimited. Providers sharing a gate identity must agree on
    #: the cap (the resolver enforces min-wins / 422).
    max_concurrent_requests: int | None = Field(default=None, ge=1)
    #: Per-provider override of the global CHAT-STREAM same-endpoint retry budget (D43). None inherits
    #: InferenceCfg.retry_attempts; 0 disables retries for this provider.
    retry_attempts: int | None = Field(default=None, ge=0)
    #: Provider default for the output-cap field spelling (D46). None -> derived from api_mode.
    max_tokens_field: Literal["max_tokens", "max_completion_tokens"] | None = None
    models: dict[str, ModelCfg] = Field(default_factory=dict)  # name-keyed catalog


class SectionRef(BaseModel):
    """A flat provider(+model) pointer used by a consumer section's fallbacks (and, in Slice 2, voice
    reuses it - A11/D48). `model` is omittable iff the named provider's catalog has exactly one model;
    a clean name is provider-relative, an uncataloged string passes through as a raw wire id
    (probe-eligible only on a llamacpp provider)."""

    provider: str
    model: str | None = None


class InferenceCfg(BaseModel):
    """Chat inference (A11/D48). The connection details live in the top-level `providers` map; this
    section only POINTS at them: a flat `provider` primary (+ optional `model`) and an ordered
    `fallbacks` list of SectionRef. Keeps the request-shaping knobs that were always section-level -
    request_timeout_s / system_prompt* / failover / retry_attempts."""

    provider: str | None = None  # PRIMARY provider name; None -> unconfigured (chat 422s)
    #: The primary's model - omittable iff the provider's catalog has exactly one model (terse-config
    #: rule). A clean catalog name, or an uncataloged raw wire id (passthrough).
    model: str | None = None
    #: Ordered N-deep failover chain after the primary (D18). Each {provider, model?}.
    fallbacks: list[SectionRef] = Field(default_factory=list)
    request_timeout_s: float = 600.0  # thinking models load slowly + stream slowly - be generous
    system_prompt: str = ""  # optional override of the built-in default agent prompt (replace)
    #: Additive guidance appended to whichever base prompt is active (7e-a). Emitted as its own
    #: `system` message after the base. The per-agent equivalent is AgentDef.prompt_append.
    system_prompt_append: str = ""
    #: Failover (D18). On -> walk [primary, *fallbacks] until one answers; off -> strictly the primary.
    #: Chain construction lives in core/provider_registry.py.
    failover: bool = True
    #: Global CHAT-STREAM same-endpoint retry budget (D43/A7). A per-provider ProviderCfg.retry_attempts
    #: overrides it. 0 = today's instant next-hop everywhere. Chat stream only.
    retry_attempts: int = Field(default=2, ge=0)


class TurnsCfg(BaseModel):
    """Server-owned durable-turn knobs (ACA Slice 3, D39). Every tunable of the turn registry /
    drain task / SSE keepalive lives here — no magic numbers anywhere in the turn machinery.

    `ring_size` is the replay-window knob: the per-turn event ring keeps the last N `(seq, event)`
    pairs so a briefly-dropped client can tail-replay from its cursor. Undersizing it never loses
    data — it only forces a reconnecting client onto the ONE snapshot event (rebuilt from the
    event-fold accumulator) instead of a cheap tail-replay; the per-step SQLite persistence is the
    durable floor, the ring is purely a reconnect cache.

    `subscriber_queue_size` bounds each attached consumer's fan-out queue; on overflow that ONE
    slow subscriber is detached (it re-attaches via snapshot) — events are never shed for the
    connected subscribers (S3-F). `ping_s` (INT seconds — sse-starlette's ping is int-typed, so a
    sub-second keepalive is meaningless) / `send_timeout_s` are the chat SSE keepalive + frozen-reader
    drop (there is no keepalive on the chat stream at HEAD). `shutdown_grace_s` bounds the lifespan
    registry drain (kept under uvicorn's graceful timeout). `linger_s` is how long a finished turn
    stays in the capped terminal cache for late re-attach, and `max_active_turns` caps concurrently
    running task-bearing turns (chat/resume) across all threads. `linger_s`/`max_active_turns` land
    complete now but are consumed by wave 3 (terminal cache + endpoints). `steer_queue_max` caps a
    thread's per-thread steer queue (D41/Slice 5); a submission past the cap gets the 409 busy detail
    verbatim, so steering a hammered thread degrades to today's refuse rather than unbounded growth."""

    ring_size: int = Field(default=2048, ge=1)  # per-turn replay ring depth (reconnect cache, not durability)
    subscriber_queue_size: int = Field(
        default=256, ge=1
    )  # per-subscriber fan-out queue bound (overflow → detach)
    terminal_cache_cap: int = Field(
        default=32, ge=1
    )  # finished-turn terminal cache entries (evict-oldest; pairs with linger_s — review fix)
    ping_s: int = Field(
        default=15, ge=1
    )  # chat SSE keepalive interval, INT seconds (sse-starlette ping is int-typed; sub-second is meaningless)
    send_timeout_s: float = Field(default=30.0, gt=0)  # drop a frozen SSE reader without touching the turn
    shutdown_grace_s: float = Field(
        default=5.0, gt=0
    )  # lifespan registry-drain budget (< uvicorn graceful timeout)
    linger_s: float = Field(default=60.0, gt=0)  # terminal-cache retention for late re-attach (wave 3)
    max_active_turns: int = Field(
        default=4, ge=1
    )  # cap on concurrent task-bearing turns (chat/resume; wave 3 endpoints)
    steer_queue_max: int = Field(
        default=8, ge=1
    )  # per-thread steer-queue depth cap (D41/Slice 5); overflow → the 409 busy detail verbatim


class AgentCfg(BaseModel):
    """Agent-runtime settings (D10/D11/D14). `default_agent` names which `agents/<name>/` folder a
    new thread uses (blank → the default/root agent). `global_subagent_limit` caps concurrent
    subagents across the *whole* tree (§5.5), independent of any one agent's fan-out cap.
    `extra="allow"` so later per-knob additions round-trip."""

    model_config = {"extra": "allow"}

    compaction: CompactionCfg = Field(default_factory=CompactionCfg)
    #: Server-owned durable-turn knobs (ACA Slice 3, D39) — `agent.turns.*`. Nested sub-model like
    #: `compaction`; all turn-registry/drain/SSE tunables live here (no magic numbers in the loop).
    turns: TurnsCfg = Field(default_factory=TurnsCfg)
    default_agent: str = ""  # name of the default agent folder; "" → built-in default
    default_title: str = ""  # optional display name for the default/root agent (slug stays "default")
    #: Inheritance base for folder-discovered agents (D14/D15 #1). An `AgentDef`-shaped mapping
    #: (no `name`/`prompt`) whose fields a specialist's `agent.yaml` overrides via
    #: `deep_merge(defaults, agent_yaml)` at load. Absent → the `AgentDef` code defaults. May set
    #: `model` (a per-agent `ModelRef` still wins; the inference section's primary provider is the floor
    #: when neither sets it). The default agent (no `agent.yaml`) is built from this + globals.
    defaults: dict[str, Any] = Field(default_factory=dict)
    global_subagent_limit: int = 6  # process-wide cap on concurrent subagents (tree-wide)
    #: Security rail: clamp a subagent's privilege so it can never exceed its parent's (§5.5).
    #: True (default) is the safe choice; set False if you deliberately want a configured subagent
    #: to run at a higher privilege than the agent that spawned it.
    subagent_clamp_privilege: bool = True
    skills_dir: str = "skills"  # dir scanned for <name>/SKILL.md (relative → $CTRLB_HOME)
    skills_enabled: bool = True  # master switch for the skills subsystem (4.5)
    # The `skill_manage` self-author tool may write SKILL.md autonomously; off → propose-only
    # (returns data["proposed"], never writes/blocks), mirroring `memory.auto_write` (7e-f-2, D14).
    skills_auto_write: bool = True
    # Auto-route a turn to the best-matching specialist when no `/agent` is pinned (7e-g, D15 #8).
    # Off by default — explicit `/agent` + `spawn_subagents` stay primary. The default
    # `KeywordAgentSelector` matches the user message against each agent's name+description.
    auto_rotate: bool = False
    # Min matching tokens for an auto-route pick (conservative; a tie or below-threshold → the
    # default agent). Floored at 1 so a blanked Conf field can't make every message route.
    auto_rotate_min_overlap: int = Field(default=2, ge=1)
    # Per-child wall-clock cap for `spawn_subagents` (§5.5): a stuck child can't hold the batch open
    # forever. Read live per fan-out, so a Conf edit applies to the next spawn without a restart.
    subagent_child_timeout_s: float = Field(default=180.0, gt=0)
    # Default `KeywordSkillSelector` tuning (built from these at startup): min token overlap for a
    # skill to match the user message, and the cap on how many skills activate per turn. Baked at
    # construction like the selector always has been — a Conf edit needs a restart (unlike the
    # per-call `auto_rotate_min_overlap` above); see services/agent/skills.py + core/agents.py.
    skill_min_overlap: int = Field(default=1, ge=1)
    skill_max_active: int = Field(default=2, ge=1)
    # Dual-mode chat delivery (D17). Authoritative server-side: `on` always streams (SSE), `off`
    # always buffers (one JSON response — e.g. for a flaky link), `auto` honors the request's
    # `stream` field (the PWA always sends true). Enforced in api/agent.py `_effective_stream`.
    streaming: Literal["auto", "on", "off"] = "auto"

    @field_validator("streaming", mode="before")
    @classmethod
    def _yaml_bool_streaming(cls, v: object) -> object:
        # YAML 1.1 parses the bare tokens `on`/`off` (two of our three values!) as booleans, so a
        # hand-edited `streaming: off` arrives as Python False. Coerce it back to the string literal.
        if v is True:
            return "on"
        if v is False:
            return "off"
        return v


class MemoryGitCfg(BaseModel):
    """Auto-version the memory directory in a local git repo (D26). Best-effort: a git failure never
    breaks a memory write. `enabled` gates the whole backup; `reconcile_interval_s` is the periodic
    sweep that captures the owner's *manual* edits (0 → sweep off; startup reconcile + write-commits
    still run). Identity is set per-commit via `-c` (global git config untouched). All read live."""

    model_config = {"extra": "allow"}

    enabled: bool = True  # master switch for the git backup
    author_name: str = "ctrl-b memory"  # commit identity (per-commit -c, never global)
    author_email: str = "memory@ctrl-b.local"
    commit_timeout_s: float = Field(default=10.0, gt=0)  # per git invocation; the hang backstop
    reconcile_interval_s: int = Field(default=120, ge=0)  # external-edit sweep cadence; 0 = off


class MemoryCfg(BaseModel):
    """File-based agent memory (7e-d, D14/D15 #4). Per-agent `MEMORY.md` (isolated) + a global
    `USER.md` (the owner profile, shared across agents), injected into each turn's system context
    after the prompt appends. Hermes-named keys + matching defaults so the files are portable to/from
    Hermes/OpenClaw. All memory lives under `memory_dir` (the **memory directory** = the D26 git repo
    root). `extra="allow"` so later knobs (vector recall, consolidation) round-trip."""

    model_config = {"extra": "allow"}

    enabled: bool = True  # master switch for the memory subsystem
    user_profile_enabled: bool = True  # inject + (7e-d-2) allow writes to the global USER.md
    auto_write: bool = True  # agent may write memory autonomously; off → propose-only (D15 #6)
    # Proactive consolidation nudge (Slice 1b): when a store's usage ≥ `consolidation_nudge_pct`, the
    # injected memory block adds a "consolidate before adding" line (merge with replace / drop stale with
    # remove / reconcile contradictions). Default OFF (owner's call) — opt in per deployment. Hermes-style
    # cap-pressure guidance; the hard over-cap error still fires regardless.
    consolidation_nudge: bool = False
    consolidation_nudge_pct: int = Field(default=80, ge=1, le=100)
    # The memory directory (D26): all memory files + the git repo root. Relative → resolved against
    # $CTRLB_HOME; absolute honored as-is. Renamed from the hardcoded "memories" so it's relocatable.
    memory_dir: str = "memories"
    git_backup: MemoryGitCfg = Field(default_factory=MemoryGitCfg)
    # Floored at 1 so a blanked Conf field (→ 0) can't silently wedge the agent's memory writes:
    # at cap 0 every non-empty write over-caps. The PUT 422s instead, surfacing the bad value.
    memory_char_limit: int = Field(
        default=2200, ge=1
    )  # per-agent MEMORY.md cap (~800 tokens, Hermes default)
    user_char_limit: int = Field(default=1375, ge=1)  # global USER.md cap (~500 tokens, Hermes default)
    # Emotional/affective state (D27 slice B) — a per-agent `STATE.md` the model rewrites (SET
    # semantics) and that's injected next to the persona. Opt-in (default OFF, like the nudge); small
    # cap so it stays a terse "Mood / Energy / Lately …", not a journal. Writes auto-apply (the agent's
    # own mood isn't a fact-about-the-world that needs the auto_write Approve gate — D27 #1).
    state_enabled: bool = False
    state_char_limit: int = Field(default=600, ge=1)  # per-agent STATE.md cap (~220 tokens)
    # Periodic reflection (D27 slice C, Hermes-style) — every `reflection_interval` user turns, inject a
    # one-shot nudge to review the conversation and save anything durably worth remembering (memory saves
    # follow the normal auto_write/propose path; state saves auto-apply). Opt-in (default OFF, like the
    # nudge + state). Gated by the master `enabled` switch too.
    reflection_enabled: bool = False
    reflection_interval: int = Field(default=10, ge=1)  # user turns between reflection nudges


class EmbeddingsCfg(BaseModel):
    """OpenAI-compatible embeddings backend (Phase 4f, D9; A11/D48 Slice 2). Points at the top-level
    `providers` map — a flat `provider` primary (+ optional `model`) and an ordered `fallbacks` list of
    `SectionRef` (embeddings gains failover for free). The connection details + the vector dimension
    (`ModelCfg.dim`) live on the referenced provider/model, not here. `enabled=False` (or an empty
    chain) makes `EmbeddingsClient.configured` false so consumers degrade gracefully. `timeout_s` is the
    section-level SDK read window (the `EmbeddingsPolicy`)."""

    model_config = {"extra": "allow"}

    provider: str | None = None  # PRIMARY provider name; None -> unconfigured (embeddings off)
    #: The primary's model — omittable iff the provider's catalog has exactly one model (terse-config
    #: rule). A clean catalog name, or an uncataloged raw wire id (passthrough).
    model: str | None = None
    #: Ordered N-deep failover chain after the primary (D48). Each {provider, model?}. All non-null
    #: `dim`s across the chain must AGREE (C8) — the resolver 422s (strict) / drops-mismatched+warns.
    fallbacks: list[SectionRef] = Field(default_factory=list)
    enabled: bool = True
    timeout_s: float = 60.0


class VoiceServiceCfg(BaseModel):
    """Base for a voice service (STT or TTS): points at the top-level `providers` map — a flat
    `provider` primary (+ optional `model`) and an ordered `fallbacks` list of `SectionRef` (D48
    Slice 2). On **any** failure the chain walks to the next hop (Phase 6 Q2 — ensure functionality,
    surface the degradation; voice chains always walk, there is deliberately no failover toggle).
    Split timeouts make the failover snappy: `connect_timeout_s` is how fast we give up *reaching* a
    dead endpoint before falling over; `timeout_s` is the (generous) read window for the actual
    transcription/synthesis. `extra_body` is the OpenAI-SDK escape hatch — arbitrary fields passed
    straight to the server for params we don't model as typed fields (rarely needed; usually empty)."""

    model_config = {"extra": "allow"}

    provider: str | None = None  # PRIMARY provider name; None -> that service unconfigured (control hidden)
    #: The primary's model — omittable iff the provider's catalog has exactly one model (terse-config
    #: rule). A clean catalog name, or an uncataloged raw wire id (passthrough).
    model: str | None = None
    #: Ordered N-deep failover chain after the primary (D48). Each {provider, model?}.
    fallbacks: list[SectionRef] = Field(default_factory=list)
    # Floored >0 so a blanked Conf field (→ 0) can't silently wedge voice (a 0s timeout fails every
    # call instantly); the PUT 422s instead, surfacing the bad value — mirrors the memory-cap floors.
    connect_timeout_s: float = Field(default=3.0, gt=0)  # fail-fast on an unreachable endpoint → fall over
    timeout_s: float = Field(default=30.0, gt=0)  # read window for the transcription/synthesis itself
    extra_body: dict[str, Any] = Field(default_factory=dict)  # advanced: passthrough to the server


class SttServiceCfg(VoiceServiceCfg):
    """STT service (Phase 6). `language` forces the transcription language (`""` → auto-detect; no
    per-turn picker — owner's call). `vad_filter` drops silence (avoids whisper's silence
    hallucinations; on by default). `hotwords` is a space-separated bias list — proper nouns / fleet
    names whisper would otherwise mangle (e.g. "minig"→"mini G"). `vad_filter`/`hotwords` are
    faster-whisper/Speaches extras, sent to the server via `extra_body` by the adapter (they're not
    standard OpenAI params), so a non-faster-whisper fallback just ignores/rejects them."""

    language: str = "en"  # default English; "" → auto-detect
    vad_filter: bool = True  # voice-activity-detection: skip silence
    hotwords: str = ""  # space-separated recognition bias (fleet names, jargon)
    # Client behavior (not a transcription param): True → the PWA mic *sends* the transcript
    # immediately; False (default) → fills the composer for review-before-send. Surfaced to the
    # always-on mic via `GET /voice/status` (the Conf-scoped settings query isn't read on Fleet/Agent).
    auto_send: bool = False


class TtsServiceCfg(VoiceServiceCfg):
    """TTS service (Phase 6). `format` is the `response_format`/container — mp3 is the universally
    `<audio>`-seekable choice the mini-player needs. Playback speed stays **client-side**
    (`<audio>.playbackRate`, live-adjustable without re-synth — owner's call), so it's not here."""

    format: str = "mp3"  # response_format (mp3|opus|aac|flac|wav|pcm)


class VoiceCfg(BaseModel):
    """Voice subsystem (Phase 6) — push-to-talk **STT** + read-aloud **TTS**, each an
    OpenAI-compatible proxy with a primary→fallback chain so a down endpoint degrades instead of
    failing (D-failover). `enabled=False` (or a service with no configured endpoints) makes that
    service report unconfigured (`VoiceClient.configured`), so the PWA hides the mic / auto-TTS rather
    than offering a dead control. `extra="allow"` so later knobs round-trip."""

    model_config = {"extra": "allow"}

    enabled: bool = True
    stt: SttServiceCfg = Field(default_factory=SttServiceCfg)
    tts: TtsServiceCfg = Field(default_factory=TtsServiceCfg)


class SearxngCfg(BaseModel):
    """SearXNG metasearch endpoint backing the agent `web_search` tool (Phase 4f, D9). Hits the
    instance's `/search?format=json` API (the instance must enable the JSON format in its
    `settings.yml`). `enabled=False` (or an empty `base_url`) makes `web_search` report it's
    unconfigured rather than erroring. `extra="allow"` so a future SearXNG-MCP variant round-trips."""

    model_config = {"extra": "allow"}

    base_url: str = ""  # e.g. http://192.168.1.160:8888 (no trailing /search)
    enabled: bool = True
    timeout_s: float = 10.0  # a metasearch fan-out can be slow-ish; keep it bounded
    language: str | None = None  # optional default UI language passed to SearXNG (e.g. "en")


class OpenTerminalCfg(BaseModel):
    """open-webui/open-terminal endpoint (Phase 4f) — a Bearer-auth REST API giving the agent a
    remote shell + file ops on the host it runs on. Wired as curated typed actions (terminal_exec /
    read / write / list / grep / glob). Risk is **per-operation and configurable**: reads default
    LOW (auto-run) while `exec` and file writes default HIGH (the agent confirms — it's arbitrary
    remote shell). `enabled=False`/empty `base_url` makes the tools report unconfigured."""

    model_config = {"extra": "allow"}

    base_url: str = ""  # e.g. http://192.168.1.160:9999 (no trailing slash)
    api_key: str = ""  # HTTP Bearer token
    enabled: bool = True
    timeout_s: float = 30.0  # per-request timeout
    default_wait_s: float = 30.0  # synchronous-execute wait window (server returns when done/elapsed)
    # Coerced to Risk at load (Pydantic boundary): a valid low|med|high string → the enum; a bad value
    # fails validation at startup rather than silently defaulting (which would weaken the confirm gate).
    exec_risk: Risk = Risk.HIGH  # risk for terminal_exec — HIGH gates on confirm
    write_risk: Risk = Risk.HIGH  # risk for file writes/replace
    read_risk: Risk = Risk.LOW  # risk for read/list/grep/glob (LOW auto-runs)


class ShellCfg(BaseModel):
    """Guarded local shell (Phase 5) — the Claude-Code/Codex `!` escape hatch. The **user** types
    `!<cmd>` (routed to `POST /api/exec`) to run a real command **on the backend host** (the box
    running ctrl-b — corsair/emma), distinct from open-terminal (a *remote* box). Output feeds the
    agent's context (the command + result are persisted into the thread) so a later turn can read it.

    Two independent gates: `user_exec_enabled` governs the `!` path; `agent_exec_enabled` governs the
    agent's own `run_shell` tool. BOTH default OFF (owner directive 2026-06-29 + external_audit S/R15):
    arbitrary local shell is a real RCE surface, so it's opt-in even for the owner — the owner drives all
    shell work through the agent's curated tools (open-terminal), not the raw `!` escape hatch. `enabled`
    is the master switch that still registers the action so it can be turned on per-deployment when wanted.
    """

    model_config = {"extra": "allow"}

    enabled: bool = True  # master switch — registers the run_shell action
    user_exec_enabled: bool = False  # the `!<cmd>` composer escape hatch (POST /api/exec) — OFF by default
    agent_exec_enabled: bool = False  # the agent's run_shell tool (D3 gate; off → confirm only at FULL)
    workdir: str = ""  # cwd for commands; blank → $CTRLB_HOME (home_dir())
    timeout_s: float = 60.0  # kill the process after this many seconds
    max_output_chars: int = 6000  # truncate captured stdout/stderr to this length


class TailscaleCfg(BaseModel):
    """Tailscale Serve control (Phase 6c-2, DECISIONS D20) — the in-app HTTPS toggle. `serve` **only**,
    never `funnel`: tailnet-only HTTPS so the phone mic gets a secure context (the no-public-bind rule
    holds by construction). `target_port` is the local port Serve fronts — default 5433, the backend-
    served SPA (the prod topology; owner decision 2026-07-07, QH-11 — the old 5173 default encoded the
    dev-Vite topology, the wrong safe-default direction). Set `tailscale.target_port` in `config.yaml`
    (or `CTRLB_TAILSCALE__TARGET_PORT` in `.env`) to front dev Vite (5173) or anything else.
    **tailscaled is the source of truth** for on/off: we read `tailscale serve status` live and
    store no on/off flag here, so a stored flag can't drift from reality. See `HTTPS_TAILSCALE.md`."""

    model_config = {"extra": "allow"}

    enabled: bool = True  # whether the Conf → Access panel + actions are active
    target_port: int = 5433  # local port Serve proxies — prod SPA; override via config/.env (QH-11)
    timeout_s: float = 15.0  # subprocess timeout for the `tailscale` CLI calls


class OpenApiServerCfg(BaseModel):
    """An OpenAPI/REST service whose operations are auto-registered as agent tools (Phase 4f) — the
    HTTP sibling of an MCP server, for Open WebUI "tool servers" or any service exposing an OpenAPI
    doc. The spec is fetched from `spec_url` (or `base_url` + `/openapi.json`) at startup and each
    operation becomes a tool `api__<server>__<operationId>`. `risk` gates the **mutating** ops
    (POST/PUT/PATCH/DELETE → `risk`, default `med`); **GET/HEAD auto-run** (LOW) since they're reads.
    Optional `include` allowlists operationIds/paths. Bearer auth via `api_key` (+ `auth_scheme`)."""

    model_config = {"extra": "allow"}

    name: str
    base_url: str = ""  # service root, e.g. http://host:port
    spec_url: str = ""  # explicit OpenAPI doc URL; blank → base_url + /openapi.json
    enabled: bool = True
    risk: Risk = Risk.MED  # risk for mutating ops (low|med|high); GET/HEAD always LOW
    connect_timeout_s: float = 15.0
    #: Wall-clock backstop for a whole tool call (ACA C2-M2). Each registered OpenAPI operation's
    #: ToolSpec carries this as its `timeout_s`, so `ActionService`'s outer deadline (`asyncio.wait_for`)
    #: bounds the ENTIRE request. httpx's `connect_timeout_s` only bounds the connect + the gap between
    #: chunks (read timeout is per-chunk), so a server that drip-feeds bytes could otherwise hold the
    #: turn open forever. Separate from `connect_timeout_s` so a legitimately slow endpoint gets a
    #: longer overall budget; tunable per server (no hardcoding). Mirrors `McpServerCfg.call_timeout_s`.
    call_timeout_s: float = 60.0
    api_key: str = ""  # optional bearer/api token
    auth_scheme: str = "Bearer"  # prefix for the auth header value ("" → raw key)
    auth_header: str = "Authorization"
    headers: dict[str, str] = Field(default_factory=dict)
    include: list[str] = Field(default_factory=list)  # optional operationId/path allowlist


class McpServerCfg(BaseModel):
    """One MCP server the agent connects to as a client (Phase 4f, D9). `transport` selects the
    wire: `streamable_http` (the current spec transport — `url` + optional `headers`) or `stdio`
    (a local subprocess — `command` + `args` + `env`; wired in a later slice). Each server's tools
    are namespaced `mcp__<server>__<tool>` and registered into the same registry as built-in
    actions, so they flow through the same permission gate + agent loop. `risk` sets the gate for
    *all* of this server's tools — `med`/`high` make the agent confirm before each call (safe
    default for remote tools); set `low` for a server you fully trust to let its tools auto-run."""

    model_config = {"extra": "allow"}

    name: str
    transport: str = "streamable_http"  # "streamable_http" | "stdio"
    enabled: bool = True
    risk: Risk = Risk.MED  # low | med | high — gate for this server's tools
    connect_timeout_s: float = 10.0  # bound startup discovery + per-call handshake
    #: Per-*call* deadline (connect + handshake + the tool op). `None` → falls back to
    #: `connect_timeout_s`. Split out so a legitimately slow tool (a web crawl) gets a longer budget
    #: than discovery without loosening the startup/handshake bound (ACA-3b — the call no longer
    #: borrows `connect_timeout_s` when this is set). Flat wall-clock (no progress-extension).
    call_timeout_s: float | None = None
    # streamable_http
    url: str = ""  # e.g. http://192.168.1.160:3003/mcp
    headers: dict[str, str] = Field(default_factory=dict)
    # stdio (later slice)
    command: str = ""
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


def _slug(name: str) -> str:
    """Stable id from a host name: lowercase, non-alphanumerics → '-' (DESIGN.md §2)."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "host"


#: Public alias — the hosts CRUD API maps a path `id` back to its `computers:` key via this.
host_slug = _slug


class ServiceCfg(BaseModel):
    """One entry under a computer's `services:` map (Phase 3).

    `cmd` is keyed by action (`start`/`stop`/`restart`) → `{os_type: command}`; only the host's
    OS variant runs, and a missing one surfaces as a DENIED result. State is derived (port probe),
    never stored, so there is no status field here.
    """

    model_config = {"extra": "allow"}

    kind: str | None = None
    port: int | None = None
    path: str = ""
    autostart: bool = False
    cmd: dict[str, dict[str, str]] = Field(default_factory=dict)


class ComputerCfg(BaseModel):
    """One entry under `config.yaml`'s `computers:` map — the live wol_server shape preserved.

    Secrets stay plain `str` at the config layer (the file is gitignored and the API masks on
    read via `mask_secrets`); the domain `Host` wraps the password in `SecretStr` for redaction.
    Services nest under their host (`services:` map) so everything about a machine lives together
    and renaming the host re-slugs both the host id and its service ids in lockstep.
    """

    model_config = {"extra": "allow"}

    ip: str
    mac: str | None = None
    ssh_username: str | None = None
    ssh_password: str | None = None
    ssh_port: int = 22
    os_type: str = "linux"
    role: str | None = None
    #: VPN/overlay address (Slice 1, D47 / ROADMAP D3) — a MagicDNS **name** (PREFERRED over an IP)
    #: or an IP on the overlay network. Deliberately GENERIC: today's overlay is Tailscale, but
    #: neither this field nor the `host_addresses` resolver names it — the only `tailscale` coupling
    #: stays in the Serve integration (ROADMAP D3 hardcoding note). `None` ⇒ the host is LAN-only and
    #: `host_addresses` yields exactly `[ip]` (today's behavior, byte-identical for configs without it).
    vpn_host: str | None = None
    #: Per-host SSH failover preference (Slice 1, D47). `False` ⇒ the general LAN>VPN candidate order;
    #: `True` ⇒ VPN-first SSH connect/failover (e.g. a host whose LAN sshd is firewalled but whose
    #: overlay sshd answers). The LAN>VPN order lives ONLY in `host_addresses`, never at a call site.
    ssh_prefer_vpn: bool = False
    tags: list[str] = []
    services: dict[str, ServiceCfg] = Field(default_factory=dict)
    #: Per-host, per-theme presentation override (Phase 11 / D28 §9.9) — an OPEN pass-through blob the
    #: theme owns the schema for (planet/beacon/angle/art), keyed by themeId. Defined day-1 so the YAML
    #: shape is settled once (never a migration); CONSUMED since frontier F2 (2026-07-12): `_host_dto`
    #: passes it through verbatim and frontier's present() validates/clamps `appearance.frontier
    #: {image,x,y}`. No per-theme Pydantic union — that would force a server change per theme.
    appearance: dict[str, dict[str, Any]] = Field(default_factory=dict)


#: The tri-state agent-access mode for a tool (Phase 8b, D22). Overlays the registry spec's
#: `(agent_exposed, core)` pair: **core** = always reachable (bypasses the per-agent allowlist *and*
#: per-turn skill narrowing) · **enabled** = in the general toolset, subject to allowlist/skill
#: narrowing · **disabled** = never offered to the agent. `None` (the default) means "use the tool's
#: compile-time default" — see `runtime.apply_tool_overrides` / `agent_mode_of`.
AgentMode = Literal["core", "enabled", "disabled"]


class ApprovalRule(BaseModel):
    """One standing 'always allow' grant for a tool (Slice 8, D44). Allow-only by construction —
    matching NEVER produces a deny, only a risk-derived CONFIRM→ALLOW downgrade in
    `permissions.decide`. Consulted per-invocation by `ApprovalRule`-aware `ActionService.invoke`.

    `extra="forbid"` (review H1): a typo'd key must 422, never silently degrade into a whole-action
    grant (`args=None` matches every call). Reserved-but-unbuilt fields (TTL/subject, §8) become real
    optional fields when built, not smuggled through `extra`."""

    model_config = {"extra": "forbid"}

    #: {top-level input field: fnmatch glob}; None/{} = whole-action grant. Values are match patterns
    #: (globs), compared against `permissions.canonical_str` of the arg at gate time.
    args: dict[str, str] | None = None

    @field_validator("args", mode="before")
    @classmethod
    def _coerce_scalar_patterns(cls, v: Any) -> Any:
        """Str-coerce scalar pattern values so an unquoted YAML scalar (`cwd: 5`) doesn't brick
        `Settings.model_validate` (review F8) — pydantic won't lax-coerce int→str for a `dict[str,str]`
        field. JSON encoding is used (not `str`) so the stored pattern mirrors `canonical_str`'s
        encoding (`true`/`5`/`1.5`), keeping a YAML-authored scalar matchable; non-scalars pass through
        to fail validation normally."""
        if not isinstance(v, dict):
            return v
        return {k: json.dumps(x) if isinstance(x, bool | int | float) else x for k, x in v.items()}


class ToolOverride(BaseModel):
    """Per-tool override of the registry spec (Phase 8b, D22) — the **one unified object** the owner
    edits in the Tools tab, keyed by tool name in `Settings.tool_overrides`. Each dimension is an
    optional field that falls back to the tool's compile-time default when unset, so adding the next
    dimension (per-tool `settings` — ROADMAP E0a) is a purely additive field, never a new sibling map
    (CLAUDE.md hard rule). Applied onto the live registry specs by `runtime.apply_tool_overrides`.

    - `description`: the model-facing text in the OpenAI tool schema (generalizes the 7d-a override).
      Blank/None → the built-in description.
    - `agent_mode`: the tri-state agent-access mode (`AgentMode`). None → the compile-time default.
    - `approvals`: standing 'always allow' grants (`ApprovalRule` list, D44). None/empty = no grants;
      NEVER touched by `apply_tool_overrides` — consulted live per-invocation by `ActionService`.
    """

    model_config = {"extra": "allow"}  # forward-compat: an unknown future field round-trips

    description: str | None = None
    agent_mode: AgentMode | None = None
    approvals: list[ApprovalRule] | None = None


class AppearanceCfg(BaseModel):
    """Active appearance selection (Phase 11 / D28 §9.11, extended M3 §14.3) — the cross-device-synced
    theme picker state.

    Backend-authoritative, server-stamped last-write-wins: the client writes the whole selection
    through the normal `PUT /api/settings` deep-merge; the server stamps `updated_at` on its own clock
    (no cross-device skew). Read back cheaply via `GET /api/appearance` (the full settings doc is
    Conf-tab-scoped, so it can't drive first-paint / reconcile). Defaults mirror the frontend `ui` store.

    `theme_settings` is an OPEN per-theme options map (`{themeId: {key: value}}`, D29 §14.3) — the theme
    owns the schema, so the server is a pass-through (no per-theme Pydantic union that would force a
    server change per theme). `motion`/`perf` are device levers kept consistent across devices (owner
    directive 2026-06-26). Typed (not `extra="allow"`) — the open map is a typed `dict` field, not a
    free-for-all on the selection block.

    The M3 fields default to **None** ("no opinion yet"), NOT to their UI defaults — a pre-M3 config has
    a stamped `updated_at` (theme/mode/accent were synced since Phase 11), so a concrete default here
    would look *authored* and the client's LWW reconcile (`server.x ?? local.x`) would wipe the owner's
    local reduced-motion / lite-blur / just-migrated per-theme prefs on the first upgrade load. None lets
    the client keep local until the first real appearance write seeds these (the patch sends the full
    selection). Same unseeded-until-written contract as `updated_at`."""

    theme: str = "vapor"
    mode: str = "dark"
    accent: str = "dark"
    motion: str | None = None  # ambient animations: "full" | "reduced"; None = unseeded → client keeps local
    perf: str | None = None  # frosted-bar blur: "full" | "lite"; None = unseeded → client keeps local
    theme_settings: dict[str, dict[str, Any]] | None = None  # open per-theme options (§14.3); None = unseeded
    updated_at: datetime | None = None  # server-stamped on each write; None until first saved


class Settings(BaseModel):
    """Typed view over `config.yaml`.

    `extra="allow"` so config written by later phases (inference/agents/voice/…) round-trips
    losslessly through current code instead of being silently dropped on save.
    """

    model_config = {"extra": "allow"}

    server: ServerCfg = Field(default_factory=ServerCfg)
    appearance: AppearanceCfg = Field(default_factory=AppearanceCfg)
    #: Top-level name-keyed CONNECTION map (A11/D48): each `ProviderCfg` carries base_url + server
    #: behavior + a model catalog. Consumer sections (`inference`, and in Slice 2 voice/embeddings) point
    #: at these via flat `provider` + `fallbacks`. The map KEY is the provider slug + the `/<provider>`
    #: composer verb; keys are validated for slug shape + secret-sentinel collision below.
    providers: dict[str, ProviderCfg] = Field(default_factory=dict)
    inference: InferenceCfg = Field(default_factory=InferenceCfg)
    agent: AgentCfg = Field(default_factory=AgentCfg)
    memory: MemoryCfg = Field(default_factory=MemoryCfg)
    searxng: SearxngCfg = Field(default_factory=SearxngCfg)
    embeddings: EmbeddingsCfg = Field(default_factory=EmbeddingsCfg)
    voice: VoiceCfg = Field(default_factory=VoiceCfg)
    open_terminal: OpenTerminalCfg = Field(default_factory=OpenTerminalCfg)
    shell: ShellCfg = Field(default_factory=ShellCfg)
    tailscale: TailscaleCfg = Field(default_factory=TailscaleCfg)
    openapi_servers: list[OpenApiServerCfg] = Field(default_factory=list)
    mcp_servers: list[McpServerCfg] = Field(default_factory=list)
    #: Agents are **folder-only** (D14/D15 #3): discovered by scanning `$CTRLB_HOME/agents/<name>/`
    #: (`agent.yaml` + `SOUL.md`), never stored as a `config.yaml` list. The default/generalist agent
    #: lives at the root (`SOUL.md` + globals, no `agent.yaml`). See `resolve_agent` / `list_agent_names`.
    #: Per-tool overrides (Phase 8b, D22), keyed by tool name → a unified `ToolOverride`
    #: (description + tri-state `agent_mode`, both optional). Generalizes the 7d-a description map:
    #: one object the owner extends with the next dimension, never a parallel sibling map (CLAUDE.md
    #: hard rule). Applied onto the live registry specs by `runtime.apply_tool_overrides`; a field
    #: left None means "use the tool's compile-time default". Legacy `tool_descriptions` is folded in
    #: by `_fold_legacy_tool_descriptions` below (zero-touch migration).
    tool_overrides: dict[str, ToolOverride] = Field(default_factory=dict)
    #: Keyed by host name, preserving the live `wol_server_win.py` `computers{}` shape so the
    #: owner can copy their existing config.yaml unchanged (HANDOFF — migration reference).
    computers: dict[str, ComputerCfg] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _fold_legacy_tool_descriptions(cls, data: Any) -> Any:
        """Migrate the pre-8b `tool_descriptions: {name: text}` map into the unified
        `tool_overrides: {name: {description: text}}` (D22, zero-touch). Runs before field validation
        so a hand-written or previously-saved config with the old key still loads. An explicit
        `tool_overrides[name].description` wins; the legacy key is dropped after folding so it never
        round-trips back to disk."""
        if not isinstance(data, dict) or "tool_descriptions" not in data:
            return data
        legacy = data.get("tool_descriptions")
        if not isinstance(legacy, dict):
            return data
        data = dict(data)  # don't mutate the caller's dict
        overrides = dict(data.get("tool_overrides") or {})
        for name, text in legacy.items():
            if not isinstance(text, str) or not text.strip():
                continue
            existing = overrides.get(name)
            if isinstance(existing, ToolOverride):
                existing = existing.model_dump()
            elif isinstance(existing, dict):
                existing = dict(existing)
            else:
                existing = {}
            # Fold only when the unified entry has *no* description set. Guard on `is None`, NOT
            # falsiness: an explicit `""` is a deliberate "restore the built-in" (the catalog's clear),
            # so it must win over the legacy text — otherwise blanking a description on disk silently
            # reverts to the legacy value on the next load.
            if existing.get("description") is None:
                existing["description"] = text
            overrides[name] = existing
        data["tool_overrides"] = overrides
        data.pop("tool_descriptions", None)
        return data

    @field_validator("providers")
    @classmethod
    def _validate_provider_and_model_names(cls, v: dict[str, ProviderCfg]) -> dict[str, ProviderCfg]:
        """Enforce the A11/D48 provider+model naming rules at the schema boundary: provider keys are
        slugs (`^[a-z0-9][a-z0-9_+.-]{0,31}$`), model clean names are non-empty (stripped), and NEITHER
        may collide with a secret-sentinel key (C1 defense-in-depth). A bad name 422s the load/PUT."""
        for pname, pcfg in v.items():
            if not _PROVIDER_SLUG_RE.match(pname):
                raise ValueError(
                    f"provider name {pname!r} is not a valid slug (^[a-z0-9][a-z0-9_+.-]{{0,31}}$)"
                )
            if is_secret_sentinel_name(pname):
                raise ValueError(f"provider name {pname!r} collides with a secret-sentinel key")
            for mname in pcfg.models:
                if not mname.strip():
                    raise ValueError(f"provider {pname!r} has an empty model name")
                if is_secret_sentinel_name(mname):
                    raise ValueError(f"model name {mname!r} collides with a secret-sentinel key")
        return v

    def hosts(self) -> list[Host]:
        """Project the `computers` map into typed domain `Host`s (stable slug id from name)."""
        return [
            Host(
                id=_slug(name),
                name=name,
                ip=cfg.ip,
                mac=cfg.mac,
                ssh_username=cfg.ssh_username,
                ssh_password=SecretStr(cfg.ssh_password) if cfg.ssh_password else None,
                ssh_port=cfg.ssh_port,
                os_type=OSType.coerce(cfg.os_type),
                role=cfg.role,
                vpn_host=cfg.vpn_host,
                ssh_prefer_vpn=cfg.ssh_prefer_vpn,
                tags=cfg.tags,
            )
            for name, cfg in self.computers.items()
        ]

    def services(self) -> list[Service]:
        """Project the nested `services` maps into typed `Service`s (id = `{host_id}.{slug}`).

        Loaded "like hosts": the id is decoupled from the display name, and `cmd`'s OS keys are
        coerced to `OSType` so the action layer can index by the host's OS directly.
        """
        out: list[Service] = []
        for name, cfg in self.computers.items():
            host_id = _slug(name)
            for svc_name, svc in cfg.services.items():
                out.append(
                    Service(
                        id=f"{host_id}.{_slug(svc_name)}",
                        host_id=host_id,
                        name=svc_name,
                        kind=svc.kind,
                        port=svc.port,
                        path=svc.path,
                        autostart=svc.autostart,
                        cmd={
                            action: {OSType.coerce(os): command for os, command in by_os.items()}
                            for action, by_os in svc.cmd.items()
                        },
                    )
                )
        return out

    #: Name of the default/generalist agent — the root workspace (no `agent.yaml`). Its persona is
    #: the root `SOUL.md` (→ `inference.system_prompt` → baked); its `ModelRef`/limits come from
    #: `agent.defaults` (or the `AgentDef` code defaults). `default_agent_def` synthesizes it.
    DEFAULT_AGENT_NAME: ClassVar[str] = "default"

    def home_dir(self) -> Path:
        """The relocatable workspace root (D14/D15 #2)."""
        return home_path()

    def agents_dir_path(self) -> Path:
        """`$CTRLB_HOME/agents/` — scanned for specialist `<name>/` folders."""
        return self.home_dir() / "agents"

    def memories_dir_path(self) -> Path:
        """The **memory directory** (D26): the default agent's `MEMORY.md` + the global `USER.md`, the
        `agents/<slug>/` specialist memory, and the git repo root. `memory.memory_dir` resolved against
        `$CTRLB_HOME` (default `memories`), or honored as-is if absolute."""
        p = Path(self.memory.memory_dir).expanduser()
        return p if p.is_absolute() else (self.home_dir() / p)

    def secret_values(self) -> list[str]:
        """The live config's secret leaf values (api keys, ssh passwords, …) — for redacting them out
        of free text like `session_search` snippets (7e-e, D15 #7). Plain strings at the config layer
        (the file is gitignored; the API masks on read), so `model_dump()` yields the real values."""
        return secret_values(self.model_dump())

    def skills_dir_path(self) -> Path:
        """Absolute path to the skills directory. `agent.skills_dir` (default `skills`) resolved against
        `$CTRLB_HOME` — the same root as `memories_dir_path`/`agents_dir_path`, so every workspace dir
        shares one root (the `CTRLB_CONFIG` file override never splits skills off) — or honored as-is if
        absolute."""
        p = Path(self.agent.skills_dir).expanduser()
        return p if p.is_absolute() else (self.home_dir() / p)

    @staticmethod
    def _read_soul(folder: Path) -> str:
        """Read `<folder>/SOUL.md` (the agent's persona), or "" if absent/blank. Fed into
        `AgentDef.prompt`, so `_system_prompt()` keeps its SOUL.md → `inference.system_prompt` →
        baked precedence with no change."""
        p = folder / "SOUL.md"
        if not p.is_file():
            return ""
        return p.read_text(encoding="utf-8").strip()

    def _agent_from(self, name: str, folder: Path, agent_yaml: dict[str, Any] | None) -> AgentDef:
        """Build an `AgentDef` from `agent.defaults` (inheritance base) + `agent_yaml` (overrides) +
        the folder name + its `SOUL.md`. `deep_merge(defaults, overrides)` is the same merge
        `PUT /api/settings` uses; the folder name always wins for `name` (D15 #1/#3)."""
        defaults = dict(self.agent.defaults)
        defaults.pop("title", None)  # title is per-agent identity — never inherited from defaults
        override = dict(agent_yaml or {})
        merged = deep_merge(defaults, override)
        # D48 C7 (audit L2): a `ModelRef.model` clean name is PROVIDER-RELATIVE — never carried across
        # providers. When the override points `model.provider` at a DIFFERENT provider than the default and
        # does NOT set its own `model.model`, the inherited model would resolve as a raw wire id on the
        # wrong provider — so drop it (merged model → provider-only). Post-deep_merge pointer-half fixup.
        o_model, m_model = override.get("model"), merged.get("model")
        if (
            isinstance(o_model, dict)
            and isinstance(m_model, dict)
            and "provider" in o_model
            and "model" not in o_model
        ):
            def_model = defaults.get("model")
            def_prov = def_model.get("provider") if isinstance(def_model, dict) else None
            if o_model.get("provider") != def_prov:
                merged["model"] = {k: v for k, v in m_model.items() if k != "model"}
        merged["name"] = name
        merged.pop("prompt", None)  # persona is SOUL.md, never agent.yaml
        agent = AgentDef.model_validate(merged)
        soul = self._read_soul(folder)
        if soul:
            agent.prompt = soul
        return agent

    def default_agent_def(self) -> AgentDef:
        """The default/generalist agent — the workspace root (D14). Built from `agent.defaults` +
        globals; persona = root `SOUL.md`; display name = `agent.default_title`. Always available so
        the loop has an `AgentDef` to run."""
        agent = self._agent_from(self.DEFAULT_AGENT_NAME, self.home_dir(), None)
        agent.title = self.agent.default_title
        return agent

    def _load_agent_folder(self, name: str) -> AgentDef | None:
        """Load `agents/<name>/` (agent.yaml + SOUL.md) or `None` if the folder is absent. Loaded
        fresh per call so an edit is live with no restart (D14)."""
        folder = self.agents_dir_path() / name
        if not folder.is_dir():
            return None
        yaml_p = folder / "agent.yaml"
        raw: dict[str, Any] = {}
        if yaml_p.is_file():
            loaded = yaml.safe_load(yaml_p.read_text(encoding="utf-8")) or {}
            if isinstance(loaded, dict):
                raw = _fold_agent_yaml_modes(loaded)
        return self._agent_from(name, folder, raw)

    def load_agent(self, name: str) -> AgentDef | None:
        """Public resolver for the file-per-agent API: the default/root agent for `DEFAULT_AGENT_NAME`,
        else the `agents/<name>/` folder, or `None` if that specialist folder is absent."""
        if name == self.DEFAULT_AGENT_NAME:
            return self.default_agent_def()
        return self._load_agent_folder(name)

    def list_agent_names(self) -> list[str]:
        """Specialist agent names — each subdir of `agents/` carrying an `agent.yaml` or `SOUL.md`
        (a valid slug). Sorted for stable ordering. The default/root agent is not listed here."""
        d = self.agents_dir_path()
        if not d.is_dir():
            return []
        out = [
            p.name
            for p in d.iterdir()
            if p.is_dir()
            and _slug(p.name) == p.name
            and ((p / "agent.yaml").is_file() or (p / "SOUL.md").is_file())
        ]
        return sorted(out)

    def resolve_agent(self, name: str | None = None) -> AgentDef:
        """Resolve an `AgentDef` by name (folder-only, D15 #3). `name=None` → the configured
        `agent.default_agent` folder, else the root default agent. An unknown/since-deleted name
        falls back to the default rather than 500ing — a thread that references it keeps working."""
        target = name or self.agent.default_agent or None
        if target:
            loaded = self._load_agent_folder(target)
            if loaded is not None:
                return loaded
        return self.default_agent_def()


def _apply_env_overrides(raw: dict[str, Any]) -> dict[str, Any]:
    """Overlay `CTRLB_<SECTION>__<KEY>=value` env vars onto the parsed YAML (env wins).

    Scalar, one-level overrides only — structured config (host lists, MCP servers) is edited
    in `config.yaml`/the UI, by design. Values stay strings; Pydantic coerces them on validate.
    """
    for full, value in os.environ.items():
        if not full.startswith(ENV_PREFIX):
            continue
        body = full[len(ENV_PREFIX) :]
        if body in _BOOTSTRAP_KEYS or "__" not in body:
            continue
        section, _, key = body.partition("__")
        section, key = section.lower(), key.lower()
        bucket = raw.get(section)
        if not isinstance(bucket, dict):
            bucket = {}
            raw[section] = bucket
        bucket[key] = value
    return raw


def _env_override_paths() -> set[str]:
    """The dotted `section.key` paths currently set by a `CTRLB_<SECTION>__<KEY>` env override — the
    mirror of `_apply_env_overrides`' write targets. Used by the migration to tell when a consumed
    legacy secret leaf came ONLY from the environment (so it must not be materialized to disk; FX-B)."""
    paths: set[str] = set()
    for full in os.environ:
        if not full.startswith(ENV_PREFIX):
            continue
        body = full[len(ENV_PREFIX) :]
        if body in _BOOTSTRAP_KEYS or "__" not in body:
            continue
        section, _, key = body.partition("__")
        paths.add(f"{section.lower()}.{key.lower()}")
    return paths


_MIGRATION_LOG = logging.getLogger("ctrlb.config.migration")

#: Module-level channels for the quarantined A11 legacy fold. NOT persisted into Settings.
#: The chat slot_map ("local"/"cloud" -> created provider name) from the most recent `_migrate_legacy`,
#: read by the raw-YAML agent.yaml `mode:`->`provider:` fold (R11 — a module-level stash inside the
#: quarantined fold; validation context is unusable because `_load_agent_folder` runs per-call, live,
#: decoupled from the one config-load that computed the map).
_SLOT_MAP: dict[str, str] = {}


@dataclass(frozen=True)
class PendingMigration:
    """The write-back channel for a completed in-memory legacy->new inference fold (A11/D48 C3/step 4).
    Set on the module-level `_PENDING_MIGRATION` by `load_settings` and consumed by the FIRST successful
    write through the ONE YAML chokepoint (`edit_config_yaml`), so it fires for EVERY writer — the
    settings PUT AND the host/integration CRUD that bypass `apply_settings_patch` (D48 Migration step 4:
    "the channel lives at the chokepoint so ALL writers trigger it"). NEVER persisted into Settings.
    `writeback` = the materialized new-shape subtrees to sync onto the on-disk doc; `delete_list` = the
    dotted consumed-legacy keys to remove. Both fire together with the caller's mutation under ONE atomic
    `edit_config_yaml` + a 0600 pre-write backup, guarded by legacy-keys-present (a non-empty file) so a
    409/422-rejected request — which returns before reaching the chokepoint — triggers neither."""

    writeback: dict[str, Any] = _dc_field(default_factory=dict)
    delete_list: tuple[str, ...] = ()


#: The pending legacy->new migration from the most recent `load_settings`, re-derived from disk on every
#: load (a migrated doc yields None). Consumed + cleared by `edit_config_yaml` on the first successful
#: write. Process-wide + serialized by `settings_write_lock` (held by every config writer), so the
#: single-consumer guarantee holds. Dev/prod are separate processes + `CTRLB_HOME` roots — no cross-race.
_PENDING_MIGRATION: PendingMigration | None = None


def walk_model_refs(raw_doc: dict[str, Any], fn: Any) -> None:
    """Visit every config-held `ModelRef` home in a raw config doc and call `fn(ref_dict)` to mutate it
    in place (A11/D48 C1 — the closed list): `agent.defaults.model`, `agent.defaults.compaction.summarizer`,
    the GLOBAL `agent.compaction.summarizer`, `agent.defaults.routing.lead`. ONE shared helper used by the
    migration mode->provider rewrite now and by the rename cascade in wave B2. Skips absent/non-dict homes.
    (Per-agent overrides live in `agents/*/agent.yaml` — separate files, folded at their own load.)"""
    agent = raw_doc.get("agent")
    if not isinstance(agent, dict):
        return
    homes: list[Any] = []
    defaults = agent.get("defaults")
    if isinstance(defaults, dict):
        homes.append(defaults.get("model"))
        comp = defaults.get("compaction")
        if isinstance(comp, dict):
            homes.append(comp.get("summarizer"))
        routing = defaults.get("routing")
        if isinstance(routing, dict):
            homes.append(routing.get("lead"))
    comp_g = agent.get("compaction")
    if isinstance(comp_g, dict):
        homes.append(comp_g.get("summarizer"))
    for home in homes:
        if isinstance(home, dict):
            fn(home)


def _canonical_base_url_key(url: str) -> str:
    """Lowercased scheme+host, default ports elided, trailing slash stripped, path preserved — the
    migration endpoint-dedup key (matches `core.provider_registry.canonical_base_url`; a tiny pure
    duplicate here to avoid a config->core import cycle)."""
    parts = urlsplit(url if "://" in url else f"http://{url}")
    scheme = (parts.scheme or "http").lower()
    host = (parts.hostname or "").lower()
    port = parts.port
    default = {"http": 80, "https": 443}.get(scheme)
    netloc = host if (port is None or port == default) else f"{host}:{port}"
    return f"{scheme}://{netloc}{parts.path.rstrip('/')}"


def _provider_name_from_api_mode(api_mode: str, taken: set[str]) -> str:
    """Derive a provider name from an endpoint's api_mode, suffixing -2,-3... on collision (D48 step 1)."""
    base = api_mode if api_mode in ("llamacpp", "openrouter", "openai", "none") else "openai"
    if base not in taken:
        return base
    i = 2
    while f"{base}-{i}" in taken:
        i += 1
    return f"{base}-{i}"


def _provider_name_from_host_port(base_url: str, taken: set[str]) -> str:
    """Derive a provider name for a MIGRATED voice/embeddings endpoint from its base_url (D48 step 2): a
    host-port slug (lowercased host with dots kept, `-<port>` only when the port is explicit; scheme/path
    stripped), sanitized to the provider slug charset (`^[a-z0-9][a-z0-9_+.-]{0,31}$`), suffixed -2,-3…
    on collision. Chat endpoints use `_provider_name_from_api_mode`; voice/embeddings have no api_mode
    identity, so the host is the natural name (e.g. `http://emma:9000/v1` → `emma-9000`)."""
    parts = urlsplit(base_url if "://" in base_url else f"http://{base_url}")
    host = (parts.hostname or "").lower()
    slug = f"{host}-{parts.port}" if parts.port is not None else host
    slug = re.sub(r"[^a-z0-9_+.\-]", "-", slug)  # replace out-of-charset chars
    slug = re.sub(r"^[^a-z0-9]+", "", slug)[:32] or "provider"  # must start with [a-z0-9], cap 32
    if slug not in taken:
        return slug
    # Suffix `-N` on collision, but keep the WHOLE name ≤ 32 (the provider-slug cap the model validates):
    # truncate the BASE so `base + "-N"` fits, re-truncating as N grows to more digits (FX-D).
    i = 2
    while True:
        suffix = f"-{i}"
        candidate = f"{slug[: 32 - len(suffix)]}{suffix}"
        if candidate not in taken:
            return candidate
        i += 1


def _voice_service_is_legacy(svc: Any) -> bool:
    """A `voice.stt`/`voice.tts` subtree is legacy-shaped iff it carries a `primary`/`fallback` slot
    AND has no new-shape `provider` pointer (D48 migration step 2 trigger). The `provider` guard is the
    subtree-level new-wins rule the chat + embeddings triggers already apply: a hand-authored doc holding
    BOTH shapes keeps the new pointer untouched (legacy ignored, not deleted — the recorded residual)."""
    return isinstance(svc, dict) and "provider" not in svc and ("primary" in svc or "fallback" in svc)


def _embeddings_is_legacy(emb: Any) -> bool:
    """The `embeddings` subtree is legacy-shaped iff it carries any single-endpoint field
    (`base_url`/`api_key`/`model`/`dim`) AND has no new-shape `provider` pointer (D48 step 2 trigger)."""
    return (
        isinstance(emb, dict)
        and "provider" not in emb
        and any(k in emb for k in ("base_url", "api_key", "model", "dim"))
    )


def _migrate_legacy(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str], list[str]]:
    """Quarantined raw-YAML fold (A11/D48 §Migration): the legacy local/cloud/fallbacks `inference` shape,
    the `voice.stt`/`voice.tts` primary/fallback slots, and the single-endpoint `embeddings` block -> the
    top-level `providers` map + each section's flat `provider`+`fallbacks`. Returns
    (migrated_raw, slot_map, delete_list).

    PER-SUBTREE idempotent + independent: each of the four folds (chat / stt / tts / embeddings) fires iff
    ITS OWN subtree is legacy-shaped, regardless of the others — so a Slice-1-migrated config (chat already
    on `providers:`) with legacy voice MERGES the voice endpoints into the EXISTING providers map (dedup by
    canonical base_url + api_key, against pre-existing AND freshly-created providers). Nothing legacy ->
    the input `raw` is returned unchanged (identity), {}, []; re-running on a migrated doc is a no-op.

    Two phases: (1) fold every legacy endpoint into `providers` (dedup + accrete models), recording each
    section's ordered `(provider, model)` ref list; (2) once the catalog is FINAL, materialize each
    section's `provider`/`model`/`fallbacks` — the model is omitted iff the (possibly merged) provider ends
    with exactly one model. Chat names derive from api_mode; voice/embeddings names are host-port slugs.
    Chat-held ModelRef homes are rewritten mode->provider via the shared walk helper + slot_map."""
    inf = raw.get("inference")
    chat_legacy = (
        "providers" not in raw
        and isinstance(inf, dict)
        and "provider" not in inf
        and any(k in inf for k in ("local", "cloud", "fallbacks"))
    )
    raw_voice = raw.get("voice")
    if not isinstance(raw_voice, dict):
        raw_voice = {}
    stt_legacy = _voice_service_is_legacy(raw_voice.get("stt"))
    tts_legacy = _voice_service_is_legacy(raw_voice.get("tts"))
    raw_emb = raw.get("embeddings")
    if not isinstance(raw_emb, dict):
        raw_emb = {}
    emb_legacy = _embeddings_is_legacy(raw_emb)
    if not (chat_legacy or stt_legacy or tts_legacy or emb_legacy):
        return raw, {}, []

    # Seed the providers map + identity index from any EXISTING providers (a Slice-1-migrated doc), so a
    # voice/embeddings endpoint sharing a base_url+key with an existing provider REUSES it (never dups).
    providers: dict[str, dict[str, Any]] = copy.deepcopy(raw.get("providers") or {})
    by_identity: dict[tuple[str, str | None], str] = {}
    for pname, pcfg in providers.items():
        if isinstance(pcfg, dict) and pcfg.get("base_url"):
            by_identity.setdefault((_canonical_base_url_key(pcfg["base_url"]), pcfg.get("api_key")), pname)

    slot_map: dict[str, str] = {}
    delete_list: list[str] = []

    def _add_endpoint(
        ep: dict[str, Any],
        *,
        name_for: Any,
        model_entry: Any,
        default_model: str = "",
        require_model: bool = False,
    ) -> tuple[str, str] | None:
        base_url = ep.get("base_url") or ""
        if not base_url:
            return None
        model = ep.get("model") or default_model or ""
        if require_model and not model:  # embeddings: a blank model = never configured -> drop
            return None
        api_key = ep.get("api_key")
        identity = (_canonical_base_url_key(base_url), api_key)
        name = by_identity.get(identity)
        if name is None:
            name = name_for(ep, base_url, set(providers))
            prov: dict[str, Any] = {"base_url": base_url}
            if api_key:
                prov["api_key"] = api_key
            if ep.get("api_mode") and ep["api_mode"] != "openai":
                prov["api_mode"] = ep["api_mode"]
            for k in ("max_concurrent_requests", "retry_attempts", "max_tokens_field"):
                if ep.get(k) is not None:
                    prov[k] = ep[k]
            prov["models"] = {}
            providers[name] = prov
            by_identity[identity] = name
        if model:
            # Accrete per-field into an EXISTING model entry (FX-C): a Slice-1 chat fold (or an earlier
            # voice fold) may already hold this model KEY, so `setdefault(model, …)` would drop THIS
            # endpoint's migrated fields (e.g. the embeddings `dim` for a model the chat fold created).
            # Per-field `setdefault` merges each new field in without overwriting a field already present.
            entry = providers[name].setdefault("models", {}).setdefault(model, {})  # name == id
            for k, v in model_entry(ep).items():
                entry.setdefault(k, v)
        return name, model

    def _chat_name(ep: dict[str, Any], _url: str, taken: set[str]) -> str:
        return _provider_name_from_api_mode(str(ep.get("api_mode") or "openai"), taken)

    def _hostport_name(_ep: dict[str, Any], url: str, taken: set[str]) -> str:
        return _provider_name_from_host_port(url, taken)

    def _chat_model(ep: dict[str, Any]) -> dict[str, Any]:
        entry: dict[str, Any] = {}
        if ep.get("context_window") is not None:
            entry["context_window"] = ep["context_window"]
        if ep.get("extra_body"):
            entry["extra_body"] = ep["extra_body"]
        return entry

    migrated: dict[str, Any] = dict(raw)
    # (section-dict, ordered refs) pairs, materialized in phase 2 once the catalog is final.
    to_materialize: list[tuple[dict[str, Any], list[tuple[str, str]]]] = []

    # ── chat fold ──
    if chat_legacy:
        assert isinstance(inf, dict)

        def _ep(v: Any) -> dict[str, Any]:
            return v if isinstance(v, dict) else {}

        named_slots = {"local": _ep(inf.get("local")), "cloud": _ep(inf.get("cloud"))}
        fallbacks = [f for f in inf.get("fallbacks") or [] if isinstance(f, dict)]
        _dm = inf.get("default_mode")
        default_mode = str(_dm) if _dm in ("local", "cloud") else "local"
        for slot in ("local", "cloud"):
            res = _add_endpoint(named_slots[slot], name_for=_chat_name, model_entry=_chat_model)
            if res is not None:
                slot_map[slot] = res[0]
        other = "cloud" if default_mode == "local" else "local"
        chat_refs: list[tuple[str, str]] = []
        for ep in [named_slots[default_mode], named_slots[other], *fallbacks]:
            res = _add_endpoint(ep, name_for=_chat_name, model_entry=_chat_model)
            if res is not None:
                chat_refs.append(res)
        new_inf = {k: v for k, v in inf.items() if k not in ("default_mode", "local", "cloud", "fallbacks")}
        migrated["inference"] = new_inf
        to_materialize.append((new_inf, chat_refs))
        delete_list += ["inference.default_mode", "inference.local", "inference.cloud"]

    # ── voice folds (stt / tts, each independent) ──
    if stt_legacy or tts_legacy:
        new_voice = copy.deepcopy(raw_voice)
        migrated["voice"] = new_voice
        for svc_name, is_legacy, default_model in (
            ("stt", stt_legacy, "whisper-1"),
            ("tts", tts_legacy, "tts-1"),
        ):
            if not is_legacy:
                continue
            svc = raw_voice.get(svc_name)
            svc = svc if isinstance(svc, dict) else {}
            primary = svc.get("primary")
            primary = primary if isinstance(primary, dict) else {}
            fallback = svc.get("fallback")
            fallback = fallback if isinstance(fallback, dict) else {}

            def _voice_model(ep: dict[str, Any], *, _svc: str = svc_name) -> dict[str, Any]:
                # TTS: the endpoint's `voice` id lands on the model entry (voice ids are model-specific).
                # STT: no per-model field (language is service-level, stays on the section knobs).
                entry: dict[str, Any] = {}
                if _svc == "tts" and ep.get("voice"):
                    entry["voice"] = ep["voice"]
                return entry

            svc_refs: list[tuple[str, str]] = []
            for ep in (primary, fallback):
                res = _add_endpoint(
                    ep, name_for=_hostport_name, model_entry=_voice_model, default_model=default_model
                )
                if res is not None:
                    svc_refs.append(res)
            new_svc = {k: v for k, v in svc.items() if k not in ("primary", "fallback")}
            new_voice[svc_name] = new_svc
            to_materialize.append((new_svc, svc_refs))
            delete_list += [f"voice.{svc_name}.{k}" for k in ("primary", "fallback") if k in svc]

    # ── embeddings fold (the block itself is the single endpoint; its `dim` -> the model entry) ──
    if emb_legacy:
        emb_dim = raw_emb.get("dim")

        def _emb_model(_ep: dict[str, Any]) -> dict[str, Any]:
            return {"dim": emb_dim} if emb_dim is not None else {}

        res = _add_endpoint(raw_emb, name_for=_hostport_name, model_entry=_emb_model, require_model=True)
        emb_refs = [res] if res is not None else []
        new_emb = {k: v for k, v in raw_emb.items() if k not in ("base_url", "api_key", "model", "dim")}
        migrated["embeddings"] = new_emb
        to_materialize.append((new_emb, emb_refs))
        delete_list += [f"embeddings.{k}" for k in ("base_url", "api_key", "model", "dim") if k in raw_emb]

    migrated["providers"] = providers

    # ── phase 2: materialize each section's provider/model/fallbacks against the FINAL catalog ──
    def _section_ref(pname: str, model: str) -> dict[str, Any]:
        ref: dict[str, Any] = {"provider": pname}
        if len(providers[pname].get("models") or {}) != 1 and model:
            ref["model"] = model  # a merged multi-model provider must name its model
        return ref

    for sect, refs in to_materialize:
        if not refs:
            continue
        pname, model = refs[0]
        sect["provider"] = pname
        if len(providers[pname].get("models") or {}) != 1 and model:
            sect["model"] = model
        sect["fallbacks"] = [_section_ref(p, m) for p, m in refs[1:]]

    # ── chat-held ModelRef homes: mode->provider via the slot_map (only when the chat fold ran) ──
    if chat_legacy:

        def _rewrite(ref: dict[str, Any]) -> None:
            if "mode" not in ref:
                return
            mode_val = ref.pop("mode")
            if isinstance(mode_val, str):
                ref["provider"] = slot_map.get(mode_val, mode_val)  # None mode -> provider absent (inherit)

        walk_model_refs(migrated, _rewrite)

    return migrated, slot_map, delete_list


def _fold_agent_yaml_modes(raw: dict[str, Any]) -> dict[str, Any]:
    """Raw-YAML `mode:`->`provider:` fold for a loaded `agent.yaml` (A11/D48 NO-LEGACY-SEAMS). Rewrites
    the agent's ModelRef homes (`model`, `compaction.summarizer`, `routing.lead`) in place, mapping a
    legacy `local`/`cloud` value through the module-level `_SLOT_MAP` from the last config-load migration;
    any other string is kept (a possibly-dangling provider name -> graceful default-chain at resolve),
    absent stays absent. No write-back (C1: no cross-file transactions; the agents editor writes the new
    shape on its next save)."""

    def rewrite(ref: Any) -> None:
        if isinstance(ref, dict) and "mode" in ref:
            mode_val = ref.pop("mode")
            if isinstance(mode_val, str):
                ref["provider"] = _SLOT_MAP.get(mode_val, mode_val)

    rewrite(raw.get("model"))
    comp = raw.get("compaction")
    if isinstance(comp, dict):
        rewrite(comp.get("summarizer"))
    routing = raw.get("routing")
    if isinstance(routing, dict):
        rewrite(routing.get("lead"))
    return raw


def load_settings(path: Path | None = None) -> Settings:
    """Load settings: `.env` → `os.environ`, then YAML, then env overrides (env wins), then the
    quarantined A11 legacy->new inference fold (`_migrate_legacy`) BEFORE Pydantic validation. When the
    fold fires, the `_PENDING_MIGRATION` write-back channel is armed for the first successful config write
    (re-derived from disk on every load, so a migrated file leaves it cleared).

    FX-B — the fold runs TWICE, over two inputs: the RUNTIME doc (env overrides applied) feeds
    `Settings.model_validate` + the `_SLOT_MAP` (unchanged behavior, env still wins THIS boot), while the
    DISK-TRUTH doc (pre-env) builds the write-back + delete-list. This keeps an env-only secret (e.g.
    `CTRLB_EMBEDDINGS__API_KEY`, which sits on a legacy path the fold consumes) OUT of the materialized
    config.yaml — otherwise the first save would persist the environment secret into the file. The fold is
    pure dict work, so the second run is cheap. When the two runs disagree on a consumed legacy secret leaf
    (an env override sat on a folded legacy path with no on-disk value), we warn ONCE naming the env var
    and the `providers.<name>.api_key` home it should move to."""
    global _SLOT_MAP, _PENDING_MIGRATION
    load_dotenv()
    p = path or config_path()
    raw: Any = yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else {}
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError(f"{p} must contain a YAML mapping at the top level")
    disk_raw = copy.deepcopy(raw)  # DISK-TRUTH snapshot for the write-back (taken BEFORE env overrides)
    env_raw = _apply_env_overrides(raw)  # RUNTIME doc (mutates `raw` in place; env wins this boot)

    # Runtime run → what the app resolves this boot (+ the slot_map for the per-call agent.yaml fold).
    migrated_rt, slot_map_rt, delete_list_rt = _migrate_legacy(env_raw)
    _SLOT_MAP = slot_map_rt if migrated_rt is not env_raw else {}

    # Disk-truth run → the ONE-time write-back materialized on the first successful config write.
    migrated_disk, _slot_disk, delete_list_disk = _migrate_legacy(disk_raw)
    if migrated_disk is not disk_raw:  # a fold fired on the ON-DISK doc → arm the write-back
        # Carry every folded new-shape subtree onto the write-back channel. `providers` is always
        # present; the section subtrees ride when present (`sync_mapping` makes an unchanged one a no-op,
        # so over-inclusion is safe — the migration writeback materializes on the first successful write).
        writeback: dict[str, Any] = {"providers": migrated_disk.get("providers", {})}
        for sect in ("inference", "voice", "embeddings", "agent"):
            val = migrated_disk.get(sect)
            if isinstance(val, dict):
                writeback[sect] = val
        _PENDING_MIGRATION = PendingMigration(writeback=writeback, delete_list=tuple(delete_list_disk))
        _MIGRATION_LOG.warning(
            "A11: migrated legacy provider config in memory -> %d provider(s); legacy keys %s will be "
            "removed + a config.yaml.bak-a11-* backup written on the next save.",
            len(migrated_disk.get("providers", {})),
            delete_list_disk,
        )
    else:
        _PENDING_MIGRATION = None

    # FX-B — a consumed legacy secret leaf that exists ONLY via an env override is used this boot but must
    # NOT be written to disk. Warn (once per such leaf) pointing at the new provider home.
    env_paths = _env_override_paths()
    disk_consumed = set(delete_list_disk)
    for dotted in delete_list_rt:
        if not dotted.endswith(".api_key") or dotted in disk_consumed or dotted not in env_paths:
            continue
        section = dotted.split(".", 1)[0]
        sect_doc = migrated_rt.get(section)
        home = sect_doc.get("provider") if isinstance(sect_doc, dict) else None
        env_var = ENV_PREFIX + dotted.upper().replace(".", "__")
        _MIGRATION_LOG.warning(
            "A11/FX-B: env override %s sits on a legacy path the migration consumed; its value is used "
            "THIS boot but is NOT written to config.yaml. Move it to providers.%s.api_key to persist it.",
            env_var,
            home or "<provider>",
        )
    return Settings.model_validate(migrated_rt)


def _write_replace_0600(p: Path, data: bytes) -> None:
    """Atomically replace `p` with `data`, guaranteeing the result is mode 0600 (the deployment
    contract for the secret-bearing config). Write THROUGH an fd opened at 0600 and `os.replace`
    it in — never `Path.write_bytes` (which lands at the process umask, e.g. 0664 on emma, and
    `os.replace` would then transfer that onto the config, stripping 0600). This is the same idiom
    as the `.bak-a11` backup a chokepoint away, and it self-heals a config a past writer already
    degraded to 0664 (the replaced inode is always the fresh 0600 tmp). A stale `.tmp` from a prior
    crash is removed first so `O_EXCL` can guarantee THIS process created the file at 0600 (an
    `O_TRUNC` reuse would keep the stale file's old mode). Windows: the `os.open` mode arg is a
    no-op there — the code stays OS-agnostic (no os-branch)."""
    tmp = p.with_suffix(p.suffix + ".tmp")
    with contextlib.suppress(FileNotFoundError):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, p)


def save_settings(settings: Settings, path: Path | None = None) -> None:
    """Persist settings atomically (write temp + `os.replace`) so a crash can't truncate config.

    Note: only `config.yaml` is ever rewritten by the app — `.env` is owned by the operator.

    Dumped with `mode="json"` so domain `StrEnum`s (`Privilege`, `Risk`, `OSType`, …) serialize to
    their string values — `mode="python"` keeps the enum *member*, which `yaml.safe_dump` can't
    represent (it dispatches on the exact subclass type) and raises `RepresenterError`. That path
    is only reached once a config carries an enum (e.g. an `agents[]` entry's `privilege`), so the
    bug stayed latent while `agents` was empty; `mode="json"` keeps every section YAML-safe.
    """
    p = path or config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    data = settings.model_dump(mode="json", exclude_none=False)
    _write_replace_0600(p, yaml.safe_dump(data, sort_keys=False, allow_unicode=True).encode("utf-8"))


def providers_rev(settings: Settings) -> str:
    """The `providers` subtree base revision/fingerprint (A11/D48 C2/R8): sha256 of the canonical JSON
    of the RAW (unmasked) providers subtree, first 16 hex chars. One helper reused by `GET /api/providers`
    (served as `rev`), the PUT concurrency guard (a `providers`-carrying PUT whose base != this → 409),
    and the PUT response (`providers_rev`, the post-write value). Only the 16-char digest ever leaves the
    process — the unmasked subtree is hashed but never emitted. `sort_keys` makes it order-independent."""
    sub = {name: p.model_dump(mode="json") for name, p in settings.providers.items()}
    canonical = json.dumps(sub, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def deep_merge(base: Any, patch: Any) -> Any:
    """Recursively overlay `patch` onto `base` (a copy). Dicts merge key-by-key; everything else
    (scalars, lists) is replaced by the patch value. Used by `PUT /api/settings` so a partial form
    submission updates only the sections it carries without clobbering the rest of the config.

    Lists are replaced wholesale, not merged — so this is for **scalar/section** edits. Editing a
    *list* section (e.g. `mcp_servers`, `agents`, `computers`) goes through a dedicated endpoint
    that handles add/remove + secret carry-over explicitly, never this generic merge.
    """
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for k, v in patch.items():
            out[k] = deep_merge(base.get(k), v) if k in base else v
        return out
    return patch


def prune_unchanged(patch: Any, current: Any) -> Any:
    """Return `patch` reduced to only the leaves that differ from `current`. The UI submits whole
    form groups (e.g. all of `server` + `inference`), but we want to **write only what actually
    changed** so the persisted file is touched minimally — unchanged lines (incl. unchanged secrets)
    keep their original text/quoting/comments. Empty sub-dicts (no changes inside) are dropped."""
    if isinstance(patch, dict):
        cur = current if isinstance(current, dict) else {}
        out: dict[str, Any] = {}
        for k, v in patch.items():
            if isinstance(v, dict):
                sub = prune_unchanged(v, cur.get(k))
                if sub:
                    out[k] = sub
            elif v != cur.get(k):
                out[k] = v
        return out
    return patch


def _yaml_rt() -> YAML:
    """A round-trip YAML configured to preserve the operator's file as faithfully as possible."""
    y = YAML()  # round-trip mode (keeps comments, key order, anchors)
    y.preserve_quotes = True
    y.width = 4096  # don't wrap long URLs / keys onto continuation lines
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def deep_set(node: Any, patch: dict[str, Any]) -> None:
    """Recursively write `patch`'s leaves into the ruamel `node`, descending into existing maps so
    sibling keys + their comments survive. A scalar/list value replaces in place; a dict value
    descends (creating the intermediate map if the file didn't have it). Public (A11/B2 handoff #4):
    `runtime.apply_settings_patch` composes it with `sync_mapping` inside one `edit_config_yaml` mutate."""
    for k, v in patch.items():
        if isinstance(v, dict):
            child = node.get(k)
            if not hasattr(child, "get"):  # missing or not a mapping → create one
                node[k] = {}
                child = node[k]
            deep_set(child, v)
        else:
            node[k] = v


def sync_mapping(node: Any, target: dict[str, Any]) -> None:
    """Make the ruamel mapping `node` match `target` while preserving the file as much as possible:
    set only the leaves that differ (so unchanged lines keep their comments/quoting), recurse into
    nested mappings, **add** keys new to `target`, and **delete** keys absent from `target`. Unlike
    `_deep_set` this also removes keys — so it's the right tool for replacing a host entry / its
    `services` map where the submission is the source of truth (a removed service really disappears)."""
    for k, v in target.items():
        cur = node.get(k)
        if isinstance(v, dict) and hasattr(cur, "get"):
            sync_mapping(cur, v)
        elif cur != v or k not in node:
            node[k] = v
    for k in [k for k in node if k not in target]:
        del node[k]


def _delete_dotted(doc: Any, dotted: str) -> None:
    """Delete a dotted key path from a ruamel doc if present (A11/D48 write-back). Missing intermediates
    or a missing leaf are a no-op — idempotent, so a second write after the legacy keys are gone is clean."""
    parts = dotted.split(".")
    node: Any = doc
    for part in parts[:-1]:
        if not hasattr(node, "get"):
            return
        node = node.get(part)
    if hasattr(node, "get") and parts[-1] in node:
        del node[parts[-1]]


def _materialize_migration(doc: Any) -> None:
    """Fold the armed `_PENDING_MIGRATION` new-shape subtrees onto `doc` BEFORE the caller's mutate, so
    the caller's own edit wins on any overlap (A11/D48 step 4). Dict subtrees `sync_mapping` (add/replace
    + delete keys absent from the new shape — this is what drops the legacy `inference.local/cloud`);
    a scalar replaces. The consumed-legacy `delete_list` is applied by the caller after `mutate`."""
    pending = _PENDING_MIGRATION
    if pending is None:
        return
    for key, sub in pending.writeback.items():
        if isinstance(sub, dict):
            node = doc.get(key)
            if not hasattr(node, "get"):
                doc[key] = {}
                node = doc[key]
            sync_mapping(node, sub)
        else:
            doc[key] = sub


def edit_config_yaml(mutate: Any, path: Path | None = None) -> None:
    """Edit the config file in place with a comment/format-preserving round-trip: load the ruamel
    doc (or a fresh mapping), run `mutate(doc)` to apply changes (set/sync/delete keys), then write
    atomically while keeping the file's existing line ending. This is the single chokepoint for every
    YAML write — `apply_patch_to_yaml` + the hosts/integration CRUD endpoints all funnel through it, so a
    plain `yaml.safe_dump` (which would strip comments, reorder, expand defaults, flip EOL) is never used
    on the operator's file.

    A11/D48 step 4 / F5 — the ONE atomic materialization of a legacy migration lives HERE, at the
    chokepoint, so EVERY writer triggers it (the settings PUT and the host/integration CRUD alike). When
    `_PENDING_MIGRATION` is armed (a fold fired at load + no config write has landed since): a one-time
    `config.yaml.bak-a11-*` snapshot of the CURRENT file is written (mode 0600, same dir) BEFORE the
    replacement; the migrated new-shape subtrees are folded on FIRST (caller's `mutate` still wins on
    overlap); the consumed-legacy keys are deleted AFTER `mutate`; and the channel is cleared so it fires
    exactly once. All of it rides this SINGLE atomic write, so a caller that aborts before reaching here
    (a 409/422) makes neither backup nor delete. No fsync is added (R25/QH9 OS-branch allowlist is closed).
    Every config writer holds `settings_write_lock`, so the single-consumer guarantee is race-free."""
    global _PENDING_MIGRATION
    pending = _PENDING_MIGRATION
    p = path or config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = p.read_bytes() if p.exists() else b""
    if pending is not None and raw_bytes:
        # The Hermes pre-migration backup convention: copy the pre-write file 0600 before replacing it.
        # Create the backup ATOMICALLY at 0600 (O_CREAT|O_EXCL|O_WRONLY, mode 0600) and write THROUGH the
        # fd — never write_bytes-then-chmod, which would land the secret-bearing content at the umask
        # default (0644) first and leave it world-readable if we crash before the chmod (Codex#9 / audit
        # M1). O_EXCL: if that exact stamped name already exists, suffix `-2`,`-3`… — never overwrite an
        # existing backup.
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bak = p.parent / f"{p.name}.bak-a11-{stamp}"
        n = 2
        while True:
            try:
                fd = os.open(bak, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                break
            except FileExistsError:
                bak = p.parent / f"{p.name}.bak-a11-{stamp}-{n}"
                n += 1
        with os.fdopen(fd, "wb") as bf:
            bf.write(raw_bytes)
        _MIGRATION_LOG.warning("A11: wrote pre-migration config backup %s (0600)", bak)
    # Detect EOL from the raw bytes — `read_text` would universal-translate CRLF→LF and hide it.
    newline = "\r\n" if b"\r\n" in raw_bytes else "\n"
    y = _yaml_rt()
    doc = y.load(raw_bytes.decode("utf-8")) if raw_bytes else None
    if not hasattr(doc, "get"):  # empty/new file → start from a fresh mapping
        doc = {}
    _materialize_migration(doc)  # new-shape subtrees first (caller's mutate wins on overlap)
    mutate(doc)
    for dotted in pending.delete_list if pending is not None else ():
        _delete_dotted(doc, dotted)
    buf = io.StringIO()
    y.dump(doc, buf)
    # Preserve the file's existing line ending (LF default for a new file) and write bytes directly,
    # so a Windows host doesn't silently rewrite an LF config to CRLF (which would churn every line).
    out = buf.getvalue().replace("\r\n", "\n").replace("\n", newline)
    _write_replace_0600(p, out.encode("utf-8"))  # 0600 contract on the secret-bearing config (FX-A)
    if pending is not None:
        _PENDING_MIGRATION = None  # consumed only on a SUCCESSFUL write through the chokepoint


def apply_patch_to_yaml(patch: dict[str, Any], path: Path | None = None) -> None:
    """Persist `patch` by editing the existing config file in place (comment/format/EOL preserving) —
    only the changed leaves are rewritten. `patch` should already be pruned to real changes (see
    `prune_unchanged`) with secrets unmasked (see `unmask_secrets`)."""
    if not patch:
        return
    edit_config_yaml(lambda doc: deep_set(doc, patch), path)


def _mask(value: object) -> str:  # stringifies internally → accepts any value (str/int/stored secret)
    s = str(value)
    if len(s) <= 4:
        return "••••"
    return f"{s[:2]}…{s[-2:]}"


def _map_key_is_secret(key: Any) -> bool:
    """True if a sub-key *inside an arbitrary credential map* (`env`/`headers`) names a secret. Applied
    ONLY within `_SECRET_MAP_KEYS`, never to declared config field names (rule 2 above)."""
    return isinstance(key, str) and any(h in key.lower() for h in _MAP_SECRET_HINTS)


def _is_unchanged_secret(incoming: Any, stored: Any) -> bool:
    """Write-path predicate: the incoming secret is *unchanged* (→ keep `stored`) when it's empty/None
    or equals `_mask(stored)`, AND a real stored value exists. Shared by leaf + map unmasking."""
    return (
        incoming is None or incoming == "" or (isinstance(incoming, str) and incoming == _mask(stored))
    ) and bool(stored)


def mask_secrets(data: Any) -> Any:
    """Recursively mask secret values for a settings response/log line. A DECLARED secret leaf
    (`_SECRET_LEAF_KEYS`) is masked; an arbitrary credential map (`_SECRET_MAP_KEYS`) has only its
    secret-named entries masked (routine headers stay visible). Everything else passes through — so
    non-secret fields like `threshold_tokens` are never touched."""
    if isinstance(data, dict):
        out: dict[str, Any] = {}
        for k, v in data.items():
            # Path-aware (D48 C1): the sentinel-leaf branch fires ONLY on a scalar value — a dict/list
            # under a sentinel-named KEY (a provider literally named `api_key`) recurses so its nested
            # real secrets still mask. The credential-map branch fires only on a genuine flat str->str
            # map, so a provider named `env`/`headers` recurses instead of being flat-masked.
            if k in _SECRET_LEAF_KEYS and isinstance(v, (str, int)) and v:
                out[k] = _mask(v)
            elif k in _SECRET_MAP_KEYS and _is_flat_scalar_map(v):
                out[k] = {
                    mk: (_mask(mv) if _map_key_is_secret(mk) and mv and isinstance(mv, (str, int)) else mv)
                    for mk, mv in v.items()
                }
            else:
                out[k] = mask_secrets(v)
        return out
    if isinstance(data, list):
        return [mask_secrets(v) for v in data]
    return data


def secret_values(data: Any) -> list[str]:
    """Collect the non-empty secret *leaf values* from a settings/dict tree — the value-level analog of
    `mask_secrets` (declared leaves + secret-named entries of the `env`/`headers` maps). Used to redact
    those secrets out of free text (e.g. `session_search` snippets) via `core.redact.redact`."""
    out: list[str] = []
    if isinstance(data, dict):
        for k, v in data.items():
            if k in _SECRET_LEAF_KEYS and isinstance(v, str) and v:
                out.append(v)
            elif k in _SECRET_MAP_KEYS and _is_flat_scalar_map(v):
                out.extend(
                    mv for mk, mv in v.items() if _map_key_is_secret(mk) and isinstance(mv, str) and mv
                )
            else:
                out.extend(secret_values(v))
    elif isinstance(data, list):
        for v in data:
            out.extend(secret_values(v))
    return out


def unmask_secrets(incoming: Any, stored: Any) -> Any:
    """Inverse of `mask_secrets` for the write path: where `incoming` carries a *masked* (or empty)
    secret, restore the real value from `stored`. Without this, re-saving a form that displays the
    masked secret (`ab…yz`) would overwrite the real credential in `config.yaml` with the mask —
    silent loss of SSH passwords / API keys (audit A2).

    A secret-keyed leaf is treated as **unchanged** (→ keep `stored`) when its incoming value is
    empty/None or equals `_mask(stored)`; any other (genuinely new) string is taken as-is. Walks
    dicts by key. **Lists are matched by a stable identity** (`base_url`/`url`/`name`) when the items
    carry one — so secret preservation survives a reorder/remove of a secret-bearing list edited inline
    (e.g. `inference.fallbacks`); it falls back to positional matching when no identity field exists.
    """
    if isinstance(incoming, dict):
        out: dict[str, Any] = {}
        stored_d = stored if isinstance(stored, dict) else {}
        for k, v in incoming.items():
            sv = stored_d.get(k)
            # Path-aware (D48 C1): only a SCALAR under a sentinel-named key is a secret leaf; a
            # dict/list (a provider named `api_key`) recurses so its nested secrets round-trip. The
            # map branch fires only on a genuine flat credential map.
            if k in _SECRET_LEAF_KEYS and not isinstance(v, (dict, list)):
                out[k] = (
                    sv if _is_unchanged_secret(v, sv) else v
                )  # keep stored on masked/blank, else take new
            elif k in _SECRET_MAP_KEYS and _is_flat_scalar_map(v):
                sm = sv if isinstance(sv, dict) else {}
                out[k] = {
                    mk: (
                        sm.get(mk) if _map_key_is_secret(mk) and _is_unchanged_secret(mv, sm.get(mk)) else mv
                    )
                    for mk, mv in v.items()
                }
            else:
                out[k] = unmask_secrets(v, sv)
        return out
    if isinstance(incoming, list):
        stored_l = [s for s in stored if isinstance(s, dict)] if isinstance(stored, list) else []
        # Match items by a stable identity so removing/reordering a secret-bearing entry keeps every
        # *other* entry's stored secret (positional matching would shift them onto the wrong stored item
        # and clobber real keys with masks). Fall back to index when no identity field is present.
        id_key = next(
            (
                k
                for k in ("base_url", "url", "name")
                if incoming and isinstance(incoming[0], dict) and incoming[0].get(k)
            ),
            None,
        )
        if id_key:
            by_id = {s.get(id_key): s for s in stored_l if s.get(id_key)}
            return [
                unmask_secrets(v, by_id.get(v.get(id_key)) if isinstance(v, dict) else None) for v in incoming
            ]
        stored_seq = stored if isinstance(stored, list) else []
        return [
            unmask_secrets(v, stored_seq[i] if i < len(stored_seq) else None) for i, v in enumerate(incoming)
        ]
    return incoming
