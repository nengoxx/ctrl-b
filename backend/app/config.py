"""Config loading/saving + typed settings (Phase 0 slice).

Secrets model — **hybrid** (DECISIONS §config-secrets):
- `config.yaml` is the single **UI-managed source of truth**, including nested secrets
  (per-host SSH creds, per-endpoint API keys, per-MCP-server env/headers). It's gitignored,
  masked on API read, written atomically — the Conf tab round-trips it. Structured, repeating
  secrets don't fit a flat `.env`, and the UI can't rewrite `.env`, so they stay here.
- `.env` is the **bootstrap + override** layer: deploy knobs (`CTRLB_CONFIG`, `CTRLB_DB`) and
  overrides for **declared, one-level scalars** (`CTRLB_<SECTION>__<KEY>`) that **win over**
  `config.yaml`. It deliberately cannot carry a secret: every credential lives two levels down
  (`providers.<name>.api_key`, `computers[].ssh_password`), so `config.yaml` is the only home for
  one. An override naming an undeclared path is warned about at load (UPDATE_PLAN slice 3).

`.env` populates `os.environ` (real env always wins); the override layer is then applied on top
of the parsed YAML before validation.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import logging
import os
import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Literal, TypeGuard

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, Field, SecretStr, ValidationError, field_validator, model_validator
from ruamel.yaml import YAML
from ruamel.yaml.error import CommentMark
from ruamel.yaml.tokens import CommentToken

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
    "CONFIG_VERSION_KEY",
    "yaml_rt",
    "delete_path",
    "env_override_vars",
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


#: The config-shape marker key written by `app.config_migration` (UPDATE_PLAN §3.2). Declared HERE,
#: not in the migration package, because `config.py` must never import that package (G5 — the legacy
#: knowledge stays in one deletable place) while both ends need the one name: the migration writes it,
#: `load_settings` pops it, and `PUT /api/settings` strips it. It is file-shape metadata, never
#: settings — `Settings` sections are `extra="allow"`, so left in place it would ride `model_dump` out
#: through `GET /api/settings` and back in through a PUT, where a stale client echoing an old value
#: would pass `prune_unchanged` and write the stale marker down, silently weakening downgrade
#: detection (§3.8).
CONFIG_VERSION_KEY = "config_version"


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

    def agent_from(self, name: str, folder: Path, agent_yaml: dict[str, Any] | None) -> AgentDef:
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
        agent = self.agent_from(self.DEFAULT_AGENT_NAME, self.home_dir(), None)
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
                raw = loaded
        return self.agent_from(name, folder, raw)

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


def env_override_vars(environ: Mapping[str, str] | None = None) -> list[tuple[str, str, str]]:
    """Every `CTRLB_<SECTION>__<KEY>` override present in the environment, as `(var, section, key)`.

    The ONE parser for the override grammar. `_apply_env_overrides` applies what it returns, and
    `app.config_migration` reads the same list to spot a variable addressing a path a migration step
    retired. Spelled twice, the two would drift on their first disagreement: a retired-path check that
    matched upper-case variable names would miss `CTRLB_Embeddings__Api_Key`, which this overlay
    lower-cases and applies.

    Values are deliberately **not** returned — a `(var, value)` list is a secret-bearing structure that
    ends up logged sooner or later, and the one caller that needs a value reads it itself.
    """
    env = os.environ if environ is None else environ
    out: list[tuple[str, str, str]] = []
    for full in env:
        if not full.startswith(ENV_PREFIX):
            continue
        body = full[len(ENV_PREFIX) :]
        if body in _BOOTSTRAP_KEYS or "__" not in body:
            continue
        section, _, key = body.partition("__")
        out.append((full, section.lower(), key.lower()))
    return out


def _env_path_is_declared(section: str, key: str) -> bool:
    """True if `<section>.<key>` names a declared field of a declared `Settings` section.

    The check the one-level overlay never had. Sections are `extra="allow"`, so an override onto a key
    nobody declares is accepted, ignored, and indistinguishable from one that works — which is exactly
    how `.env.example` shipped four secret overrides (`CTRLB_STT__KEY`, …) naming fields that never
    existed. Derived from the model rather than from a list, so it stays true as sections gain fields.

    A section whose value is not a nested model (`providers`, `computers`, the list sections) is
    undeclared here too: this grammar is one level deep and cannot address inside them, and the
    overlay's string assignment then fails validation loudly instead of vanishing.
    """
    field = Settings.model_fields.get(section)
    ann = field.annotation if field is not None else None
    return isinstance(ann, type) and issubclass(ann, BaseModel) and key in ann.model_fields


def _loggable(s: str) -> str:
    """Escape operator-supplied text on its way to a log line — **including the path derived from it**.

    A variable name is not a secret, but it is untrusted text: `env(1)` and `execve` accept a newline
    inside a variable name even though no shell can produce one, and an unescaped one forges a second
    journal entry with an attacker's severity. Escaping only the name is not enough, which a test
    caught — `section`/`key` are slices of that same name. Ordinary ASCII passes through unchanged.
    """
    return s.encode("unicode_escape").decode("ascii")


def _apply_env_overrides(raw: dict[str, Any]) -> dict[str, Any]:
    """Overlay `CTRLB_<SECTION>__<KEY>=value` env vars onto the parsed YAML (env wins).

    Scalar, one-level overrides only — structured config (host lists, MCP servers) is edited
    in `config.yaml`/the UI, by design. Values stay strings; Pydantic coerces them on validate.

    An override onto an undeclared path is applied exactly as before and **warned about**: it cannot
    take effect, and the operator who set it believes it did. Warned rather than refused, deliberately
    — every peer project ignores an unrecognised prefixed variable outright (R6 §3), and a boot that
    dies over a stale line in `.env` takes down the only UI there is to fix it with. The one class that
    IS refused lives in `app.config_migration`: a variable addressing a path a migration retired, at
    the attended `--check`/`--apply` gate.
    """
    # ONE snapshot, parsed and read from: `os.environ` is process-global mutable state, so collecting
    # names and then re-reading each by name is a torn read — a concurrent `del` raises `KeyError` and a
    # concurrent write applies a value that was never the one we decided to apply.
    env = dict(os.environ)
    for full, section, key in env_override_vars(env):
        if not _env_path_is_declared(section, key):
            _LOG.warning(
                "%s targets `%s.%s`, which this build does not define, so it cannot take effect. "
                "Config overrides are one level deep (CTRLB_<SECTION>__<KEY>) and cannot address "
                "provider credentials; those live in config.yaml.",
                *(_loggable(s) for s in (full, section, key)),
            )
        bucket = raw.get(section)
        if not isinstance(bucket, dict):
            bucket = {}
            raw[section] = bucket
        bucket[key] = env[full]
    return raw


_LOG = logging.getLogger("ctrlb.config")

#: Every config-held `ModelRef` home, as key paths — the closed list (A11/D48 C1). Declared as data
#: rather than buried in a walker because two callers need the paths themselves: the rename cascade
#: walks the refs, and the config migration must name the exact `…mode` keys it consumed.
#: (Per-agent overrides live in `agents/<name>/agent.yaml` — separate files with their own homes.)
MODEL_REF_HOMES: tuple[tuple[str, ...], ...] = (
    ("agent", "defaults", "model"),
    ("agent", "defaults", "compaction", "summarizer"),
    ("agent", "defaults", "routing", "lead"),
    ("agent", "compaction", "summarizer"),  # the GLOBAL summarizer, not the per-agent default
)


def model_ref_at(raw_doc: dict[str, Any], home: Sequence[str]) -> dict[str, Any] | None:
    """The `ModelRef` dict at one `MODEL_REF_HOMES` path, or `None` if absent or not a mapping."""
    node: Any = raw_doc
    for part in home:
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node if isinstance(node, dict) else None


def walk_model_refs(raw_doc: dict[str, Any], fn: Any) -> None:
    """Call `fn(ref_dict)` on every present config-held `ModelRef` home, to mutate it in place.
    Shared by the rename cascade (`runtime`) and the resolve-advisory walk (`core.provider_registry`)."""
    for home in MODEL_REF_HOMES:
        ref = model_ref_at(raw_doc, home)
        if ref is not None:
            fn(ref)


class ConfigValidationError(ValueError):
    """A config this build cannot load — carrying a **sanitised** message (locations only).

    Its whole reason to exist is that the pydantic error it replaces must never escape: `str()` of a
    `ValidationError` appends `input_value=…` for every failing field, which for a provider is the
    whole provider dict **including its `api_key`**. Uncaught at `main.py`, that traceback lands in the
    systemd journal — a secret in a log, which the security model forbids outright.
    """


def sanitise_validation_error(exc: ValidationError, origin: str, stage: str = "") -> str:
    """Render a pydantic `ValidationError` as locations + messages only, never `input`.

    Shared by `load_settings` (the live boot path) and `app.config_migration` (which found the hazard
    first): both validate operator-authored, secret-bearing documents, and neither may echo a value.

    **What `loc` can still contain, deliberately: a KEY.** A provider named `sk-…` appears here, because
    a location is a path of field names and mapping keys. That is not a leak in this system — keys are
    public identity: `mask_secrets` masks *values* under secret-named keys and passes every key through,
    provider names ride `GET /api/settings` unmasked, and they are advertised to the model as
    `/<provider>` composer verbs. Suppressing dynamic locations would reduce this to "something in
    `providers` is wrong" while protecting nothing that is not already on the chat surface.
    """
    stage = f" {stage}" if stage else ""
    lines = [f"{origin}: {len(exc.errors())} validation error(s){stage}"]
    for err in exc.errors()[:10]:
        loc = ".".join(str(x) for x in err["loc"]) or "<root>"
        lines.append(f"  {loc}: {err['msg']} [{err['type']}]")
    return "\n".join(lines)


def load_settings(path: Path | None = None) -> Settings:
    """Load settings: `.env` → `os.environ`, then YAML, then env overrides (env wins), then validate.

    There is no migration here, by design (UPDATE_PLAN G5). The config on disk is already the shape
    this build understands, because `app.config_migration` — the one place that knows anything about
    older shapes — converged it before the app was allowed to start. That is what lets the legacy
    knowledge be deleted in one piece later, and it is why this function is four lines of work.
    """
    load_dotenv()
    p = path or config_path()
    raw: Any = yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else {}
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError(f"{p} must contain a YAML mapping at the top level")
    raw.pop(CONFIG_VERSION_KEY, None)  # file-shape metadata, never settings (UPDATE_PLAN §3.8)
    try:
        return Settings.model_validate(_apply_env_overrides(raw))
    except ValidationError as exc:
        message = sanitise_validation_error(exc, str(p))
    # Raised OUTSIDE the handler on purpose. `raise … from None` only suppresses *display* of the
    # chained exception — the object still reaches through `__context__` to a `ValidationError` whose
    # `str()` carries `input_value=…`, i.e. the rejected secret, one attribute away from any logger.
    # Once the handler has exited there is no active exception, so the new error carries no reference.
    # `del raw` for the same reason one level down: the raising frame is captured in the traceback, and
    # `raw` is the whole config. Nothing renders frame locals today (no `exc_info=True` in this app, no
    # locals-aware formatter), so this is defence in depth against a future logging change, not a live
    # leak — but it costs one line and the "no secret in a log" rule admits no exceptions.
    del raw
    raise ConfigValidationError(message)


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


def yaml_rt() -> YAML:
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


# ── Comment-preserving key removal ───────────────────────────────────────────────────────────────
# ruamel parks a key's trailing comment on the *preceding* entry: `ca.items[key][2]` is ONE token
# holding that key's own end-of-line comment PLUS every full-line comment that follows it, up to the
# next key. So a bare `del node[key]` silently destroys the operator's prose for whatever came AFTER
# the deleted region — verified live: the A11 migration's `inference.cloud` delete took the four-line
# `# Voice (Phase 6, D18 failover)…` section header with it. There is no library API for this (ruamel
# ticket #377); the sanctioned recipe is to rescue the block and re-attach it to the surviving entry
# that now precedes it, which is what `_delete_key` does. The rule it implements is symmetric: the
# block ABOVE the key documents that key and dies WITH it (owner ruling, 2026-07-26 — a stale comment
# describing config that no longer exists misleads whoever reads the file next), while the block
# TRAILING the deleted region documents whatever comes after it and is re-homed verbatim.


def _entry_keys(node: Any) -> list[Any]:
    """The node's entry keys in file order — mapping keys, or positional indices for a sequence."""
    return list(node.keys()) if hasattr(node, "keys") else list(range(len(node)))


def _trailing_slot(node: Any) -> int:
    """Which `ca.items` slot holds an entry's trailing comment: mappings park it at 2 (after the
    value), sequences at 0."""
    return 2 if hasattr(node, "keys") else 0


def _last_comment_slot(node: Any, key: Any) -> tuple[Any, Any]:
    """Return the `(owner, owner_key)` whose comment slot is positionally LAST inside the region that
    `node[key]` occupies in the file — i.e. descend to the deepest-last leaf. Only that slot can hold
    text belonging to what follows the region; comments parked anywhere else inside it genuinely
    describe the content being removed."""
    value = node[key]
    if getattr(value, "ca", None) is not None and len(value):
        return _last_comment_slot(value, _entry_keys(value)[-1])
    return node, key


def _take_trailing_comment(node: Any, key: Any) -> str:
    """Return the comment text that must SURVIVE the removal of `node[key]`, verbatim (indentation,
    blank lines and non-standard spacing included); `""` when there is none.

    That is the tail of the deleted region's deepest-last slot, split at the first newline: the head is
    the deleted line's own end-of-line comment and dies with it, while the remainder documents whatever
    comes NEXT and is re-homed. A slot shaped unexpectedly (a future ruamel change) degrades to `""` —
    the comment is lost exactly as it is today, never a crash."""
    owner, owner_key = _last_comment_slot(node, key)
    slot = owner.ca.items.get(owner_key)
    value = getattr(slot[_trailing_slot(owner)] if slot else None, "value", None)
    if not isinstance(value, str):
        return ""
    _own_eol, newline, tail = value.partition("\n")
    return tail if newline else ""


def _drop_comment_above(node: Any, key: Any, keys: list[Any], index: int) -> None:
    """Remove the comment block sitting directly ABOVE `node[key]`: it documents the key being deleted,
    and leaving it behind would describe config that no longer exists — a reader cannot tell a stale
    block from a live one (owner ruling, 2026-07-26).

    Where that block lives depends on position. For the FIRST key it is the mapping's leading comment,
    one list shared with the parent's slot, so clearing it in place clears both. Otherwise it is the
    tail of the PRECEDING entry's trailing token, which keeps only its own end-of-line comment. A block
    a previous delete re-homed above this key (slot 1) documents this key too, so it goes as well.

    One caveat if a caller ever deletes a TOP-LEVEL key that is first in the file: what reads as the
    file's header banner is, to ruamel, that key's leading block, and it would go too. Not reachable
    today — every deleter addresses keys inside a section, never a bare root key."""
    slot = node.ca.items.get(key)
    if slot and slot[1]:
        slot[1] = []
    if not index:
        leading = getattr(node.ca, "comment", None)
        if leading and leading[1]:
            leading[1].clear()
        return
    owner, owner_key = _last_comment_slot(node, keys[index - 1])
    preceding = owner.ca.items.get(owner_key)
    position = _trailing_slot(owner)
    token = preceding[position] if preceding else None
    value = getattr(token, "value", None)
    if token is None or not isinstance(value, str):  # `token is None` narrows for the assignment below
        return
    own_eol, newline, _above = value.partition("\n")
    if own_eol.strip():
        token.value = own_eol + newline
    else:
        preceding[position] = None


def _attach_comment_after(node: Any, key: Any, text: str) -> None:
    """Render `text` on the lines directly BELOW the entry `node[key]`. Appends to that entry's
    existing comment token when it has one, otherwise creates one (a leading newline marks "no
    end-of-line comment of my own"). Assumes the entry ends its own line — see `_place_comment_after`."""
    if getattr(node, "ca", None) is None:  # a plain dict (fresh file) holds no comments at all
        return
    slot = node.ca.items.setdefault(key, [None, None, None, None])
    index = _trailing_slot(node)
    token = slot[index]
    if token is None:
        slot[index] = CommentToken("\n" + text, CommentMark(0))
        return
    if not token.value.endswith("\n"):
        token.value += "\n"
    token.value += text


def _attach_comment_before(node: Any, key: Any, text: str) -> None:
    """Render `text` on the lines directly ABOVE the entry `node[key]`. The block's own indentation is
    already baked into it, so only the first line is dedented onto the token's column mark."""
    if getattr(node, "ca", None) is None:  # a plain dict (fresh file) holds no comments at all
        return
    first, newline, rest = text.partition("\n")
    column = len(first) - len(first.lstrip(" "))
    slot = node.ca.items.setdefault(key, [None, None, None, None])
    slot[1] = [CommentToken(first.lstrip(" ") + newline + rest, CommentMark(column))] + (slot[1] or [])


def _place_comment_after(node: Any, key: Any, text: str) -> str:
    """Render `text` immediately after the region `node[key]` occupies. Returns `""` once placed, or
    `text` when nothing at this level can anchor it, so the caller re-homes it one level up.

    The anchor is the region's LAST line, which for a container means its deepest-last leaf — hence
    the recursion. An EMPTY container renders inline (`stt: {}`), so nothing inside it can carry a
    comment and a token on its own entry would land between the key and its value, which no longer
    parses; those hang above the FOLLOWING entry instead, which is the same file position."""
    value = node[key]
    if getattr(value, "ca", None) is None:  # a scalar leaf owns the last line of its region
        _attach_comment_after(node, key, text)
        return ""
    if len(value):
        text = _place_comment_after(value, _entry_keys(value)[-1], text)
        if not text:
            return ""
    keys = _entry_keys(node)
    index = keys.index(key)
    # Nothing follows at this level either — bubble up. A sequence is only ever entered at its last
    # item (see the recursion above), so it always lands here rather than on the "before" path.
    if index == len(keys) - 1:
        return text
    _attach_comment_before(node, keys[index + 1], text)
    return ""


def _delete_key(node: Any, key: Any) -> str:
    """Delete `key` from the ruamel mapping `node`, re-homing the comment block that trailed it.

    Returns the orphan text the caller must re-home ONE LEVEL UP — that happens when the delete leaves
    `node` with no entry able to anchor the block (see `_place_comment_after`), typically because the
    mapping is now empty. Normally returns `""`. Missing keys are a no-op, so repeated deletes stay
    idempotent."""
    if key not in node:
        return ""
    if getattr(node, "ca", None) is None:  # a plain dict (fresh file) holds no comments to rescue
        del node[key]
        return ""
    keys = _entry_keys(node)
    index = keys.index(key)
    orphan = _take_trailing_comment(node, key)
    _drop_comment_above(node, key, keys, index)
    del node[key]
    if not orphan:
        return ""
    if not len(node):  # nothing left here to anchor it to
        return orphan
    if index:
        return _place_comment_after(node, keys[index - 1], orphan)
    _attach_comment_before(node, keys[1], orphan)  # no preceding entry — above the new first key
    return ""


def sync_mapping(node: Any, target: dict[str, Any]) -> None:
    """Make the ruamel mapping `node` match `target` while preserving the file as much as possible:
    set only the leaves that differ (so unchanged lines keep their comments/quoting), recurse into
    nested mappings, **add** keys new to `target`, and **delete** keys absent from `target`. Unlike
    `_deep_set` this also removes keys — so it's the right tool for replacing a host entry / its
    `services` map where the submission is the source of truth (a removed service really disappears)."""
    orphan = _sync_mapping(node, target)
    if orphan:
        # Only reachable when the OUTERMOST mapping was synced empty; there is no enclosing entry to
        # re-home into, so the block is dropped (today's behaviour — never a malformed file).
        _LOG.warning("dropped a comment orphaned by emptying the outermost synced mapping")


def _sync_mapping(node: Any, target: dict[str, Any]) -> str:
    """`sync_mapping`'s recursion, returning the comment orphan this level could not place (see
    `_delete_key`). Each frame is the parent of the next, so it re-homes what its child hands back."""
    unplaced = ""
    for k, v in target.items():
        cur = node.get(k)
        if isinstance(v, dict) and hasattr(cur, "get"):
            orphan = _sync_mapping(cur, v)
            if orphan:
                unplaced += _place_comment_after(node, k, orphan)
        elif cur != v or k not in node:
            node[k] = v
    for k in [k for k in node if k not in target]:
        unplaced += _delete_key(node, k)
    return unplaced


def delete_path(doc: Any, parts: Sequence[Any]) -> None:
    """Delete a key path from a ruamel doc if present, rescuing the comment block the removal would
    orphan (see `_delete_key`). Missing intermediates or a missing leaf are a no-op — idempotent, so
    re-running a migration whose keys are already gone is clean. Takes pre-split SEGMENTS: dotted
    notation cannot address a key whose own name contains a dot (`models["gpt-4.1"]`)."""
    node: Any = doc
    ancestors: list[tuple[Any, Any]] = []  # walked (parent, key) pairs, to re-home an orphan upward
    for part in parts[:-1]:
        if not hasattr(node, "get"):
            return
        ancestors.append((node, part))
        node = node.get(part)
    if not hasattr(node, "get"):
        return
    orphan = _delete_key(node, parts[-1])
    while orphan and ancestors:  # the delete emptied `node` — climb until a level can anchor the block
        orphan = _place_comment_after(*ancestors.pop(), orphan)
    if orphan:
        _LOG.warning(
            "dropped a comment orphaned by deleting %s — no entry left to anchor it",
            ".".join(map(str, parts)),
        )


def edit_config_yaml(mutate: Any, path: Path | None = None) -> None:
    """Edit a config file in place with a comment/format-preserving round-trip: load the ruamel doc (or
    a fresh mapping), run `mutate(doc)` to apply changes (set/sync/delete keys), then write atomically
    at 0600 while keeping the file's existing line ending.

    This is the single chokepoint for every YAML write — `apply_patch_to_yaml`, the hosts/integration
    CRUD endpoints and the config migration all funnel through it, so a plain `yaml.safe_dump` (which
    would strip comments, reorder, expand defaults and flip EOL) is never used on an operator's file.
    Path-agnostic: the migration runner uses it for `agents/<name>/agent.yaml` too, which is why a
    hand-written agent file keeps its comments through a migration.
    """
    p = path or config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = p.read_bytes() if p.exists() else b""
    # Detect EOL from the raw bytes — `read_text` would universal-translate CRLF→LF and hide it.
    newline = "\r\n" if b"\r\n" in raw_bytes else "\n"
    y = yaml_rt()
    doc = y.load(raw_bytes.decode("utf-8")) if raw_bytes else None
    if not hasattr(doc, "get"):  # empty/new file → start from a fresh mapping
        doc = {}
    mutate(doc)
    buf = io.StringIO()
    y.dump(doc, buf)
    # Preserve the file's existing line ending (LF default for a new file) and write bytes directly,
    # so a Windows host doesn't silently rewrite an LF config to CRLF (which would churn every line).
    out = buf.getvalue().replace("\r\n", "\n").replace("\n", newline)
    _write_replace_0600(p, out.encode("utf-8"))  # 0600 contract on the secret-bearing config (FX-A)


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
