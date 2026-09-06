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
import copy
import hashlib
import io
import ipaddress
import json
import logging
import os
import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Literal, Protocol, TypeGuard

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, Field, SecretStr, ValidationError, field_validator, model_validator
from ruamel.yaml import YAML
from ruamel.yaml.error import CommentMark
from ruamel.yaml.scalarstring import SingleQuotedScalarString
from ruamel.yaml.tokens import CommentToken

from app.core.media import MEDIA_NAMESPACES, MediaItem, MediaPin, is_addressable_name
from app.core.pwa import PWA_ICON_VARIANTS
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
    "looks_masked",
    "providers_rev",
    "validation_detail",
    "CONFIG_VERSION_KEY",
    "yaml_rt",
    "delete_path",
    "env_override_vars",
    "loggable",
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
    #: What this model accepts as INPUT (D68 §5) — e.g. `[text, image]` for a vision model. The
    #: external convention (OpenRouter's `architecture.input_modalities`; the opencode/goose catalogs)
    #: rather than a `vision: bool`, so the next modality is one more string instead of a second flag.
    #: Omitted/None = TEXT-ONLY: an attachment's images are replaced by an in-band ERROR note for this
    #: model, which is the safe default for an endpoint nobody has annotated.
    input_modalities: list[str] | None = None
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


class CoreMemoryCfg(BaseModel):
    """Core Memory (D57) — the first tier-2 backend: one shared, Claude-Code-native markdown corpus
    (a `MEMORY.md` routing index + semantic topic files) read on demand instead of injected whole.
    `root` relative → resolved against `memories_dir_path()` (so the D26 repo versions it); absolute
    honored but unversioned. All caps are **characters**, all read live (no restart)."""

    model_config = {"extra": "allow"}

    root: str = "core"  # corpus root; relative → under the memory dir, absolute honored
    #: Rendered index-block cap. 10240 since D61 ④ (the owner's ~10K sizing — Kilo's 8192 sat at 99%
    #: fill on a realistic corpus): a deployment that OMITS the key adopts it on upgrade, one that
    #: pinned 8192 keeps it (and keeps the pressure, which is what the client's hint is for).
    index_char_limit: int = Field(default=10240, ge=1)
    topic_char_limit: int = Field(default=4096, ge=1)  # per-`read` topic cap (S3)
    #: Per-turn total recall cap (S3). 24576 since D64 §2.5 (6 × the 4096 topic cap): paging charges
    #: the `core_memory_recall` FRAME once per page, and the §14f measured family (17,183 chars of
    #: sources ≈ 8 pages) landed within noise of the old 20480 once that framing was priced. A
    #: deployment that OMITS the key adopts the new headroom on upgrade; one that pinned a value
    #: keeps it. Not raised further and not raisable mid-turn: the cap also protects small-context
    #: models, so a topic no turn can read is an owner/file job, not a knob to widen (D64 §2.3).
    recall_char_limit: int = Field(default=24576, ge=1)
    #: The MINIMUM a single read-class call charges against `recall_char_limit` (D60 §15b-3). Reads no
    #: longer count against `max_calls_per_tool`, so the recall budget is their only bound — and a
    #: zero-char result (an empty `search`, a refused `read`) would otherwise cost nothing and loop
    #: forever. At the defaults this caps a turn at ~80 read-class calls. `ge=1`: a 0 disables the
    #: bound, which is the failure this field exists to prevent.
    recall_min_charge_chars: int = Field(default=256, ge=1)
    consolidation_nudge_pct: int = Field(default=80, ge=1, le=100)  # index cap pressure → nudge (S4)


class LongTermCfg(BaseModel):
    """The tier-2 long-term memory slot (D57). Tier 1 (the file memory above) is always on; tier 2 is
    **one selectable backend at a time** — `backend` is the ONLY switch (null = off, the Conf enable
    switch writes it; no sibling bool). A future backend is one new Literal value + one nested cfg
    object beside `core`, never a parallel flat key."""

    model_config = {"extra": "allow"}

    backend: Literal["core"] | None = None  # null = tier 2 off (default)
    core: CoreMemoryCfg = Field(default_factory=CoreMemoryCfg)


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
    #: The tier-2 long-term slot (D57) — off by default; everything about it nests here rather than
    #: adding a top-level key, so tier 1 and tier 2 stay one `memory:` section.
    longterm: LongTermCfg = Field(default_factory=LongTermCfg)

    def core_memory_on(self) -> bool:
        """Whether tier 2 is Core Memory right now: `backend` is the only tier-2 switch, and the
        memory master switch still gates it (the whole slot lives inside `memory:`).

        THE definition, on the config object both tiers already read, so the corpus
        (`CoreMemoryCorpus.enabled`) and the tier-1 surfaces that reword themselves when tier 2 is on
        (the `memory` tool's `describe=`, §4b-5) ask the same question in one place — neither tier's
        module has to import the other's (§8-4)."""
        return bool(self.enabled) and self.longterm.backend == "core"


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
    #: Also the gate-wait bound (D48 amendment) — `allow_inf_nan=False` so `timeout_s: .inf`, which YAML
    #: parses happily and `gt=0` accepts, cannot turn a saturated hop back into an indefinite park.
    timeout_s: float = Field(default=60.0, gt=0, allow_inf_nan=False)


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
    # `allow_inf_nan=False` on both: since the D48 amendment these also bound the request-gate WAIT
    # (connect on a hop with a fallback, timeout on the last one), and YAML's `.inf` passes `gt=0`
    # happily — which would restore the indefinite park the bound exists to remove (Codex).
    connect_timeout_s: float = Field(default=3.0, gt=0, allow_inf_nan=False)  # unreachable → fall over
    timeout_s: float = Field(default=30.0, gt=0, allow_inf_nan=False)  # read window for the op itself
    extra_body: dict[str, Any] = Field(default_factory=dict)  # advanced: passthrough to the server


class SttServiceCfg(VoiceServiceCfg):
    """STT service (Phase 6). `language` forces the transcription language (`""` → auto-detect; no
    per-turn picker — owner's call). `vad_filter` drops silence (avoids whisper's silence
    hallucinations; on by default). `hotwords` is a space-separated bias list — proper nouns / fleet
    names whisper would otherwise mangle (e.g. "minig"→"mini G"). `vad_filter`/`hotwords` are
    faster-whisper/Speaches extras, sent to the server via `extra_body` by the adapter (they're not
    standard OpenAI params), so a non-faster-whisper fallback just ignores/rejects them.

    The `auto_*` knobs are CLIENT behavior (nothing here transcribes): `auto_send` sends the transcript
    the moment it lands, and the `auto_stop` block (R51 Tier 0) ends the recording itself after
    `auto_stop_silence_s` of continuous silence below `auto_stop_threshold`. Both ride
    `GET /voice/status` to the always-on mic. Auto-stop defaults OFF — push-to-talk is unchanged until
    the owner flips it."""

    language: str = "en"  # default English; "" → auto-detect
    vad_filter: bool = True  # voice-activity-detection: skip silence
    hotwords: str = ""  # space-separated recognition bias (fleet names, jargon)
    # Reject an oversized clip before buffering it upstream (SYS-17b). Default = OpenAI Whisper's own
    # 25 MB limit; `gt=0` so a blanked Conf field can't disable the cap (an int, so `.inf`/NaN are
    # rejected by type — mirrors the `allow_inf_nan=False` intent on the timeout fields above).
    max_upload_bytes: int = Field(default=25 * 1024 * 1024, gt=0)
    # Client behavior (not a transcription param): True → the PWA mic *sends* the transcript
    # immediately; False (default) → fills the composer for review-before-send. Surfaced to the
    # always-on mic via `GET /voice/status` (the Conf-scoped settings query isn't read on Fleet/Agent).
    auto_send: bool = False
    # R51 Tier 0 — auto-stop dictation: the PWA watches the recording's energy and stops through its
    # ordinary stop path after a silence run (`auto_send` then applies unchanged). OFF by default, so
    # the shipped behavior stays push-to-talk until the owner asks for hands-free.
    auto_stop: bool = False
    #: The silence run that ends a recording. Bounded both ways so a blanked/absurd Conf value can't
    #: wedge dictation — a ~0 s window would end every clip before a word, an unbounded one never ends.
    auto_stop_silence_s: float = Field(default=3.0, ge=0.5, le=30.0)
    #: Normalized RMS floor treated as silence. A STARTING default with no field provenance (the peers
    #: that ship this measure different quantities) — the knob exists so the owner calibrates it on the
    #: phone against quiet speech + room noise; the bounds keep it a floor, never a mute or a gate.
    auto_stop_threshold: float = Field(default=0.01, ge=0.001, le=0.5)


class TtsServiceCfg(VoiceServiceCfg):
    """TTS service (Phase 6; chunked synthesis = D63). `format` is the `response_format`/container —
    mp3 is the universally `<audio>`-seekable choice the mini-player needs for a WHOLE-clip synth.
    Playback speed stays **client-side** (`<audio>.playbackRate`, live-adjustable without re-synth —
    owner's call), so it's not here.

    The `chunk_*` block is the D63 client policy: the reply is split into speakable chunks that
    synth+play sequentially on the one `<audio>` element (time-to-first-audio ~0.7 s vs ~13.6 s
    whole-clip, R50 P2). It is delivered to the PWA verbatim by `GET /voice/status` — nothing here is
    a secret, and no layer below the browser chunks anything. `chunking: "off"` = today's whole-blob
    path, which is also why `chunk_format` is separate from `format`: chunks want a container that is
    sample-exact from a pipe (`opus`; Speaches' pipe-muxed mp3 carries ~48 ms of dead air per chunk,
    R50 P1), while `format` keeps governing the single-blob path the mini-player scrubs."""

    format: str = "mp3"  # response_format (mp3|opus|aac|flac|wav|pcm)
    # Reject an over-long synthesis request (SYS-17a). Default = OpenAI's own TTS input limit; `gt=0`
    # so a blanked Conf field can't disable the cap (an int, so `.inf`/NaN are rejected by type).
    max_text_chars: int = Field(default=4096, gt=0)
    # D63 — chunked synthesis. `sentence` ships ON (owner ruling; the one peer with the three-way mode
    # defaults the same way). `off` = the pre-D63 whole-blob path, byte-identical.
    chunking: Literal["off", "paragraph", "sentence"] = "sentence"
    chunk_format: str = "opus"  # per-chunk response_format (request > model > service at the wire)
    chunk_min_words: int = Field(default=4, ge=1)  # merge floor — a chunk under EITHER floor keeps
    chunk_min_chars: int = Field(default=50, ge=1)  # accumulating forward (open-webui's rule + numbers)
    chunk_max_chars: int = Field(default=400, gt=0)  # split at the last word boundary under this
    chunk_lookahead: int = Field(default=1, ge=1, le=4)  # synth-ahead depth (1 = synth N+1 while N plays)
    # C3 S2 — read-along: auto-TTS starts speaking WHILE the reply streams, a sentence at a time, instead
    # of waiting for turn end. Meaningless under `chunking: "off"` (one chunk of the whole message is
    # unknowable mid-stream), which is why it lives beside `mode`. ON by default — owner ruling
    # 2026-09-06 after the device round passed (shipped OFF pending that round, the `auto_stop` precedent).
    chunk_read_along: bool = True

    @model_validator(mode="after")
    def _chunk_bounds(self) -> "TtsServiceCfg":
        """The two orderings that must hold for the chunker to make progress (D63): a floor above the
        cap would never close a chunk, and a cap above the per-message limit would emit a first chunk
        the per-request 422 rejects. Checked at LOAD so a bad Conf save 422s instead of muting TTS."""
        if self.chunk_min_chars > self.chunk_max_chars:
            raise ValueError(
                f"chunk_min_chars ({self.chunk_min_chars}) must be <= chunk_max_chars ({self.chunk_max_chars})"
            )
        if self.chunk_max_chars > self.max_text_chars:
            raise ValueError(
                f"chunk_max_chars ({self.chunk_max_chars}) must be <= max_text_chars ({self.max_text_chars})"
            )
        return self


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
    #: Wake-on-connect (ROADMAP D2-B): opening the live SSE stream fires `wake_host` for this machine.
    #: An additive optional field on the unified per-host object — deliberately NOT a `wake.targets`
    #: list beside it (CLAUDE.md hard rule); the next per-host automation dimension joins here too.
    #: Needs a `mac` to do anything (the wake itself DENIES without one, same as the button).
    wake_on_connect: bool = False
    #: Wake-on-presence (D2-A / D50): this machine participates in the owner-device tailnet edge — the
    #: phone's confirmed OFFLINE→ONLINE transition wakes it. The next dimension on the SAME object, per
    #: the `wake_on_connect` precedent. Observed but never fired in 15a; armed in 15b.
    wake_on_presence: bool = False
    #: Per-host override of `wake.presence_cooldown_s` (D50). `None` ⇒ the global value — one optional
    #: field rather than a second cooldown map beside the global one.
    wake_presence_cooldown_s: int | None = Field(default=None, ge=0)
    tags: list[str] = []
    services: dict[str, ServiceCfg] = Field(default_factory=dict)
    #: Per-host, per-theme presentation override (Phase 11 / D28 §9.9) — an OPEN pass-through blob the
    #: theme owns the schema for (planet/beacon/angle/art), keyed by themeId. Defined day-1 so the YAML
    #: shape is settled once (never a migration); CONSUMED since frontier F2 (2026-07-12): `_host_dto`
    #: passes it through verbatim and frontier's present() validates/clamps `appearance.frontier {x,y}`
    #: (its `image` key was RETIRED at D53 M2 — the owner's `media/frontier/rigs/` pool replaces it, and
    #: a leftover key is inert here because nothing on this side ever typed the blob). No per-theme
    #: Pydantic union — that would force a server change per theme.
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
    - `max_calls`: this tool's per-turn call cap (D60 ②) — REPLACE semantics: absent → the agent's
      blanket `max_calls_per_tool`, present → that number for this tool. Read live by the agent
      loop's `_LoopGuard`, never overlaid onto the spec.
    """

    model_config = {"extra": "allow"}  # forward-compat: an unknown future field round-trips

    description: str | None = None
    agent_mode: AgentMode | None = None
    approvals: list[ApprovalRule] | None = None
    max_calls: int | None = Field(default=None, ge=1)  # ge=1: a 0 cap refuses the tool's FIRST call


class PromptOverride(BaseModel):
    """The owner's customization of ONE registered prompt (Phase 18, D56) — keyed by the registry id
    in `Settings.prompts`, the same one-unified-object-per-item shape as `ToolOverride`.

    - `override`: full replacement of the baked default. Blank/None → the default.
    - `append`: emitted after whichever base won, separated by a blank line. Rides the LIVE default,
      so an append-only customization never goes stale when the default is edited upstream.

    Both blank = unset, everywhere (L-5): restoring a prompt is deleting its entry, not storing a
    copy of the default. `resolve()` (services/agent/prompts.py) is the only reader.
    """

    model_config = {"extra": "allow"}  # forward-compat: an unknown future field round-trips

    override: str | None = None
    append: str | None = None


class AppearanceCfg(BaseModel):
    """Active appearance selection (Phase 11 / D28 §9.11, extended M3 §14.3) — the cross-device-synced
    theme picker state.

    Backend-authoritative, server-stamped last-write-wins: the client writes the whole selection
    through the normal `PUT /api/settings` deep-merge; the server stamps `updated_at` on its own clock
    (no cross-device skew). Read back cheaply via `GET /api/appearance` (the full settings doc is
    Conf-tab-scoped, so it can't drive first-paint / reconcile). Defaults mirror the frontend `ui` store
    (cosmos/dark/violet since D51 V0 — see the field comment below).

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

    # The unseeded selection = the frontend's first-boot triple. A DOCUMENTED MIRROR (D51 allowlist) of
    # `DEFAULT_THEME` in `frontend/src/theme-engine/resolve.ts` plus that theme's declared ThemeDef defaults
    # (cosmos: dark/violet) — another process can't import the TS constant, so `tests/
    # test_arch_invariants_sys10.py` pins this field to that declaration and fails if the two drift.
    theme: str = "cosmos"
    mode: str = "dark"
    accent: str = "violet"
    motion: str | None = None  # ambient animations: "full" | "reduced"; None = unseeded → client keeps local
    perf: str | None = None  # frosted-bar blur: "full" | "lite"; None = unseeded → client keeps local
    theme_settings: dict[str, dict[str, Any]] | None = None  # open per-theme options (§14.3); None = unseeded
    #: The shared kit BACKGROUND layer (`media/kit/background/`) — whether a participating theme paints it
    #: at all. An appearance field rather than a per-theme setting because the asset is shared: the owner's
    #: choice must survive a theme switch. Same unseeded-until-written contract as the two above (a
    #: pre-existing config keeps the client's local value, which defaults to ON so a dropped image shows).
    kit_background_visible: bool | None = None
    #: The app bar's BRAND SUBTITLE — whether the bar shows the active theme's own subtitle line beside the
    #: wordmark (gacha's Japanese line, frontier's live rig count). Synced rather than per-device for the
    #: same reason as the switch above: it is one answer to "how much text do I want in my bar", not a
    #: per-screen layout choice. The client default is **off** (G6.3's owner ruling — icon + title only —
    #: kept as the resting state; the switch is how the subtitle comes back). A theme that fills no subtitle
    #: shows nothing in EITHER state: there is no default text, the kit's retired "dashboard" literal
    #: included. Same unseeded-until-written contract as the fields above.
    appbar_subtitle_visible: bool | None = None
    #: The TRANSCRIPT AVATARS switch (D70 §8.5, ruling 20) — whether an assistant who-line leads with the
    #: message agent's avatar instead of the role dot. Synced rather than per-device for the same reason as
    #: the two switches above: it is one answer to "do I want faces in my chat", not a per-screen layout
    #: choice, and the art it governs is per-AGENT (shared) while the mode is the owner's viewing
    #: preference. The client default is **on** — an agent with no avatar draws the dot either way, so the
    #: switch does nothing until one is given a picture. Same unseeded-until-written contract.
    chat_avatars_visible: bool | None = None
    #: The installed home-screen icon's baked-in backdrop (D59 / W5) — one id from `PWA_ICON_VARIANTS`,
    #: which `/manifest.webmanifest` turns into that variant's maskable `src`. Synced like the switches
    #: above rather than device-local: it is one answer to "what does my app icon look like", and the
    #: manifest is served per-request from THIS value so a change needs no restart. Same
    #: unseeded-until-written contract (None → `DEFAULT_PWA_ICON_BG`, today's transparent icon).
    pwa_icon_background: str | None = None
    updated_at: datetime | None = None  # server-stamped on each write; None until first saved

    @field_validator("pwa_icon_background")
    @classmethod
    def _known_pwa_icon_variant(cls, v: str | None) -> str | None:
        """The value SELECTS A FILENAME from a closed allowlist — it is never a path. Validating at the
        config boundary means a typo (or anything else) 422s on the PUT instead of reaching the manifest as
        a `src` nothing can serve, which for an installed app is an icon that silently fails to update."""
        if v is not None and v not in PWA_ICON_VARIANTS:
            raise ValueError(f"unknown pwa icon background {v!r} (expected one of {list(PWA_ICON_VARIANTS)})")
        return v


class NotificationEventsCfg(BaseModel):
    """Which event CLASSES are notify-worthy (F1). Each class is one optional field on the ONE unified
    events object — the next class is an additive field with a default, never a sibling map.

    All five default **on**, because the master `NotificationsCfg.enabled` is what actually arms the
    feature (owner's spam guard, ROADMAP F1 "decided defaults"): nothing can fire while it's off, so a
    per-class default of False would only mean "enabling notifications does nothing".

    - `agent_input`: the agent is blocked on the owner — a confirm bubble or a `question` (the class
      that turns notifications into the response channel for an unattended agent).
    - `turn_done`: an agent turn ended — completed, capped, or errored. NOT `suspended`, which always
      accompanies a confirm/question frame and is therefore already covered by `agent_input`.
    - `action_failed`: a recorded Event whose `RunState` is a failure (error / denied / timeout).
    - `automation_done`: a scheduled or manual automation run reached a terminal (A3 14d) — the class
      that makes an unattended run reportable at all, since nobody is watching the tab when it fires.
      A FAILED run notifies under this class too, not under `action_failed`: the toggle governs
      automation noise as a whole, and one run must never raise two notifications.
    - `host_up_down`: the monitor confirmed a fleet host went down or came back (D50 M5) — ONE class
      for BOTH directions, since a host's liveness is one concern the owner arms or silences as a
      whole. The client classifies on the ACTION name (`host_up`/`host_down`), never on `status`:
      both directions record `OK` here, because the observation succeeded."""

    model_config = {"extra": "allow"}

    agent_input: bool = True
    turn_done: bool = True
    action_failed: bool = True
    automation_done: bool = True
    host_up_down: bool = True


class NotificationsCfg(BaseModel):
    """Notifications (F1). v1 ships the **foreground channel only**: the PWA's own Notifications API,
    driven client-side by the live SSE feeds it is already subscribed to. There is deliberately no
    server-side sender here — no Web Push / VAPID, no ntfy, no bot (all ROADMAP F1 futures). That is
    why this section is pure preference: the backend stores it and hands it to the client, and the
    client owns delivery + gating.

    `enabled=False` by default: the whole feature is opt-in, and while it is off NOTHING fires
    regardless of the per-class toggles below. When a future channel lands it joins this object as its
    own optional field (`web_push: WebPushCfg`), never a parallel top-level section."""

    model_config = {"extra": "allow"}

    enabled: bool = False
    events: NotificationEventsCfg = Field(default_factory=NotificationEventsCfg)


def _presence_address(raw: str | None, where: str) -> str | None:
    """One watched address, validated and normalized — or `None` when it was not given.

    A typo'd address must 422 at the config boundary rather than become a device that is permanently
    UNKNOWN (tailnet) or permanently absent (LAN): neither reader can tell a bad address from a quiet
    one, and a wake that silently never fires is the worst failure mode this feature has. Normalizing
    through `ipaddress` also makes the monitor's address FINGERPRINT canonical, so ` 192.168.1.143 `
    and `192.168.1.143` cannot read as an edit that re-baselines the device every load.
    """
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        raise ValueError(
            f"{where} {raw!r} is not an IP address — give a numeric address (a tailnet 100.x.y.z, a "
            "LAN 192.168.x.y), never a node key or a MagicDNS/host name"
        ) from None


class PresenceDeviceCfg(BaseModel):
    """ONE watched owner device — the unified object BOTH presence sources read (D2-C).

    One list of device objects rather than `presence_device_ips` plus a `presence_lan_ips` beside it:
    that is the parallel-sibling shape the extend-don't-migrate directive bans, and it is the version
    that gets expensive — every further dimension (this per-device damping constant, a friendly name,
    a per-device enable) would be another top-level list and another merge site. Here the next
    dimension is an additive optional field. The pre-D2-C `presence_device_ips` folds into it in
    `config_migration/steps.py`; no reader of the old key survives (the no-legacy-seams rule).

    - `name`: what the journal calls this device, and the KEY the monitor's per-device state is held
      under — so it is stripped, non-empty and unique across the list. A rename re-baselines, which is
      correct: the state was evidence about whatever that name used to mean.
    - `tailnet_ip` / `lan_ip`: the two sources' addresses, at least one required. The tailnet one is
      what the LocalAPI `whois` takes and the only stable-enough handle there (a node key rotates on
      re-auth, a NodeID changes on re-registration; R12 §4); the LAN one should be a DHCP RESERVATION
      on the router, because a lease-assigned address can drift after a router restart and v1 has no
      automated stale-address warning — the presence transition journal is the diagnostic.
    - `lan_offline_after_s`: how long this device must be CONTINUOUSLY unreachable on the LAN (on
      probes we could actually make) before its next reply counts as an arrival. Per-DEVICE because
      the constant is a property of the radio and its power management, not of the server: 900 s is
      five times the field's 180 s floor (HA's `consider_home`, whose ceiling is 21600 s) because the
      unknown here is the Doze gap — a phone that drops its Wi-Fi association while idle looks exactly
      like a phone that left the house, and the damping constant is the only thing that separates them.
      Deliberately NOT floor-validated, for D50 overrule ①'s reason: a single-owner app prefers
      configurable over a 422, and the owner sizes this from their own journal.

    Nothing here is a per-HOST dimension: `wake_on_presence` already means "wake when the owner
    arrives" and does not care which radio noticed.
    """

    model_config = {"extra": "allow"}

    name: str
    tailnet_ip: str | None = None
    lan_ip: str | None = None
    lan_offline_after_s: int = Field(default=900, ge=0)

    @field_validator("name")
    @classmethod
    def _named(cls, v: str) -> str:
        name = v.strip()
        if not name:
            raise ValueError("a wake.presence_devices entry needs a name — it keys the device's state")
        return name

    @field_validator("tailnet_ip")
    @classmethod
    def _tailnet_address(cls, v: str | None) -> str | None:
        return _presence_address(v, "wake.presence_devices tailnet_ip")

    @field_validator("lan_ip")
    @classmethod
    def _lan_address(cls, v: str | None) -> str | None:
        return _presence_address(v, "wake.presence_devices lan_ip")

    @model_validator(mode="after")
    def _has_an_address(self) -> "PresenceDeviceCfg":
        """A device with no address is a device nothing can observe — an entry that looks configured
        and is inert, which is precisely the silent failure the address validation above exists to
        prevent."""
        if self.tailnet_ip is None and self.lan_ip is None:
            raise ValueError(
                f"wake.presence_devices entry {self.name!r} needs at least one of `tailnet_ip` or `lan_ip`"
            )
        return self

    @property
    def addresses(self) -> tuple[str | None, str | None]:
        """`(tailnet_ip, lan_ip)` — the monitor's re-baselining fingerprint (D50 M2, generalized)."""
        return (self.tailnet_ip, self.lan_ip)


#: A whole 24h clock time: `H:MM` / `HH:MM`, optionally with a seconds field the validator then
#: requires to be zero. Anchored at both ends on purpose — the bug this replaced was a `split(":")`
#: that read the first two fields of `"23:00:garbage"` and threw the rest away.
_HHMM_RE = re.compile(r"(\d{1,2}):(\d{2})(?::(\d{2}))?")


class QuietHoursCfg(BaseModel):
    """`wake.quiet_hours` — the local-time window in which a LAN arrival wakes nothing (D2-C).

    ONE nested object rather than flat `quiet_start`/`quiet_end` keys, so the dimensions this will
    grow (weekdays, an explicit zone, per-source scope) are additive fields here.

    Both times are `"HH:MM"` STRINGS: a bare `23:00` in YAML is a number (1.1 sexagesimal), and a
    `datetime.time` field would happily read that number as seconds-since-midnight — 00:23, silently.
    So the value stays text, quoted, and is parsed here where a bad one is a 422 with a sentence.

    **`start == end` is REFUSED.** Under the wrap-midnight inversion it would mean all-day suppression,
    so an accidental `08:00`–`08:00` would silently kill every LAN wake; "unset" already expresses
    disabled, which is also the default.
    """

    model_config = {"extra": "allow"}

    start: str
    end: str

    @field_validator("start", "end", mode="before")
    @classmethod
    def _hhmm(cls, v: Any) -> str:
        """`"23:00"` → `"23:00"`, anything else → a 422 that says what to write. `mode="before"` so an
        unquoted `23:00` (an int, to YAML) is caught HERE with its own explanation rather than by
        pydantic's generic "input should be a valid string".

        The match is WHOLE (D2-C review LOW-4). A loose `split(":")` accepted `"23:00:garbage"` and
        silently kept the first two fields — a window the owner would read back as the one they typed
        while it meant something else, in the one feature whose failure mode is silence. `HH:MM:SS` is
        still accepted with a ZERO seconds field, because that is what a browser time input emits when
        its step includes seconds; a non-zero one is refused rather than truncated, for the same
        reason. A one-digit hour is fine (`7:05`); minutes and seconds must be two digits, since
        `7:5` is a guess about what the owner meant.
        """
        if not isinstance(v, str):
            raise ValueError(
                f'a quiet-hours time must be a quoted 24h clock time like "23:00" — {v!r} is not a '
                "string (an unquoted 23:00 is a NUMBER in YAML)"
            )
        m = _HHMM_RE.fullmatch(v.strip())
        if m is None or (m.group(3) or "00") != "00":
            raise ValueError(f'quiet-hours time {v!r} is not a 24h clock time like "23:00"')
        hour, minute = int(m.group(1)), int(m.group(2))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError(f"quiet-hours time {v!r} is outside 00:00–23:59")
        return f"{hour:02d}:{minute:02d}"

    @model_validator(mode="after")
    def _not_the_whole_day(self) -> "QuietHoursCfg":
        if self.start == self.end:
            raise ValueError(
                f"wake.quiet_hours start and end are both {self.start!r} — that would suppress every "
                "LAN wake, all day. Remove the `quiet_hours` block to disable quiet hours"
            )
        return self

    @property
    def start_minutes(self) -> int:
        return int(self.start[:2]) * 60 + int(self.start[3:])

    @property
    def end_minutes(self) -> int:
        return int(self.end[:2]) * 60 + int(self.end[3:])


class WakeCfg(BaseModel):
    """Fleet wake automation (ROADMAP D2) — BOTH triggers' tunables, as this section's original
    docstring planned.

    **D2-B wake-on-connect** (`ComputerCfg.wake_on_connect`): the SSE stream connect fires `wake_host`
    for each flagged, offline host, and `cooldown_s` bounds how often one host can be re-woken by
    reconnects (a phone walking in and out of wifi range reopens the stream constantly).

    **D2-A/D2-C wake-on-presence** (D50 + the LAN-arrival trigger, `ComputerCfg.wake_on_presence`):
    the monitor loop watches the owner's device(s) on TWO sources and fires on a confirmed
    away→home edge. The tailnet source answers "the owner WANTS the servers" (the connect itself
    carries the intent, since the phone keeps Tailscale off until then); the LAN source answers "the
    owner is HOME" (their phone reappearing on the home Wi-Fi). The `presence_*`/`lan_*`/`quiet_hours`
    fields below are that trigger's half; they are additional optional fields on THIS object rather
    than a second wake-ish section.

    - `presence_devices`: the watched devices, one `PresenceDeviceCfg` each carrying both addresses
      and its own LAN damping constant. Empty ⇒ the whole presence half of the monitor is inert and
      costs nothing.
    - `presence_offline_after_s`: how long a device must be CONTINUOUSLY observed offline ON THE
      TAILNET (healthy reads only) before its next online tick counts as a genuine arrival. This is
      what makes a one-tick radio blip unable to fire a wake, and 120 s is R12's watchdog floor. The
      LAN source keeps its own, per-device constant — an OFF tailnet is a deliberate act, an absent
      LAN reply is a radio, and one number cannot mean both. Deliberately NOT floor-validated (D50
      overrule ①) — a single-owner app prefers configurable over a 422; `0` means "arm on the first
      offline observation", which is a blip away from firing.
    - `presence_cooldown_s`: per-HOST seconds between presence-driven wakes, shared across every
      device AND both sources. Distinct from `cooldown_s` because the two triggers mean different
      things: a dashboard open is cheap and frequent, an arrival is rare and deliberate.
    - `tailscale_socket_path`: where tailscaled's LocalAPI socket lives. **Config, not an OS branch**
      (ARCHITECTURE §6): the default is the Linux path, and Synology/QNAP/macOS simply set their own
      (R12 §4 lists them) instead of this file growing a server-OS-sniffing ladder.
    - `lan_probe_count` / `lan_probe_timeout_s`: how the LAN source asks — 3 echoes at 1 s per echo
      (HA's `ICMP_TIMEOUT`), deliberately distinct from the fleet sweep's single 2 s echo. Several
      echoes ride out 802.11 DTIM buffering on a dozing phone, which is the difference between a
      damping constant and a coin flip.
    - `lan_health_ip`: an always-on address on the same LAN — normally the router, and never one of
      the watched devices (refused below) — probed alongside them. `ping` reports an unreachable
      device and a dead LOCAL link identically, so without a health gate an unplugged server would
      arm every device and wake the whole fleet on reconnect (the LAN analogue of D50 H2). While this
      address does not answer, every LAN no-reply that tick is UNKNOWN instead of offline. Unset ⇒ no
      gate: a documented posture, and setting it is the recommended one.
    - `quiet_hours`: the local-time window in which a LAN arrival wakes nothing. Unset by default.
      **LAN fires only** — a Tailscale connect is a deliberate act ("I want the servers"), and
      silencing that at night would be user-hostile; the LAN arrival is automatic and is exactly what
      the owner asked to silence.

    `cooldown_s=0` disables the connect cooldown (every connect may wake). WOL is idempotent, so a
    cooldown is Event-log noise reduction, not a safety property."""

    model_config = {"extra": "allow"}

    cooldown_s: int = Field(default=300, ge=0)  # per-host seconds between wake-on-connect fires
    presence_devices: list[PresenceDeviceCfg] = Field(default_factory=list)
    presence_offline_after_s: int = Field(default=120, ge=0)
    presence_cooldown_s: int = Field(default=3600, ge=0)
    tailscale_socket_path: str = "/var/run/tailscale/tailscaled.sock"
    lan_probe_count: int = Field(default=3, ge=1)
    lan_probe_timeout_s: int = Field(default=1, ge=1)  # per ECHO, not per probe
    lan_health_ip: str | None = None
    quiet_hours: QuietHoursCfg | None = None

    @field_validator("lan_health_ip")
    @classmethod
    def _health_address(cls, v: str | None) -> str | None:
        return _presence_address(v, "wake.lan_health_ip")

    @field_validator("presence_devices")
    @classmethod
    def _distinct_devices(cls, v: list[PresenceDeviceCfg]) -> list[PresenceDeviceCfg]:
        """Names and addresses are both UNIQUE across the list.

        Two devices sharing a name would share one state entry and silently halve the fleet's
        evidence; two sharing an address are one device counted twice, which double-probes it and
        makes a single arrival look like two. Neither is representable rather than merely unlikely —
        the pre-D2-C list validator de-duplicated silently, and a silent de-dup on a NAMED object
        would delete an entry the owner can see in their config."""
        for what, values in (
            ("name", [d.name for d in v]),
            ("address", [a for d in v for a in d.addresses if a is not None]),
        ):
            seen: set[str] = set()
            for value in values:
                if value in seen:
                    raise ValueError(f"wake.presence_devices: {what} {value!r} is used by two devices")
                seen.add(value)
        return v

    @model_validator(mode="after")
    def _health_address_is_not_a_watched_device(self) -> "WakeCfg":
        """The health address may not BE one of the watched devices (D2-C review MED-2).

        The gate's whole premise is that the health address answers whether the device does — so
        pointing it at the device itself makes the two questions one, and the feature quietly stops
        working in both directions: while the phone is away its own missing reply closes the gate, so
        its absence reads UNKNOWN and never ARMS, and when it comes back it is simply online with
        nothing armed behind it. Configured, plausible-looking, and it can never fire — the failure
        mode this feature's every other validation exists to prevent. Refused at the boundary, where
        the sentence can name the fix, rather than discovered over a week of mornings.
        """
        if self.lan_health_ip is None:
            return self
        clash = next((d.name for d in self.presence_devices if d.lan_ip == self.lan_health_ip), None)
        if clash is not None:
            raise ValueError(
                f"wake.lan_health_ip {self.lan_health_ip!r} is also device {clash!r}'s lan_ip — the "
                "health address has to be a DIFFERENT always-on box on the same LAN (the router), or "
                f"{clash!r} can never arm: its own absence would switch the gate off"
            )
        return self


class MonitorCfg(BaseModel):
    """The fleet monitor loop (D2-A/D50 §15a) — the tunables of the backend's own periodic watcher.

    The loop reads `FleetService.status_all()` (never `ping_host`: one sweep shared with the UI) and
    turns confirmed up/down transitions into Events. Damping is asymmetric on purpose — the two
    directions have different costs: a false DOWN is noise in the audit log, a false UP is harmless,
    so we damp down hard and recover fast (Gatus's 3/2, R13 §1.3).

    `enabled=True` is a safe default because it arms nothing: 15a only records host transitions, and
    the presence half stays inert until `wake.presence_devices` is populated. Turning it OFF is the
    master switch — the loop keeps idling and applies the change with no restart (and clears its
    counters, so re-enabling re-baselines silently instead of replaying a stale incident).

    - `poll_seconds`: the tick interval. Cross-field validated `>= server.poll_seconds` on `Settings`
      (see there for why a shorter one would be actively wrong).
    - `down_after_checks` / `up_after_checks`: consecutive same-direction observations before a
      transition is CONFIRMED and recorded. A check that could not be made at all (`HostStatus.error`)
      is UNKNOWN — it resets both counters and never produces a transition."""

    model_config = {"extra": "allow"}

    enabled: bool = True
    poll_seconds: int = Field(default=30, ge=1, le=3600)
    down_after_checks: int = Field(default=3, ge=1, le=100)
    up_after_checks: int = Field(default=2, ge=1, le=100)


class AutomationsCfg(BaseModel):
    """Scheduled agent automations (A3/D49 §D-7) — the TUNABLES only.

    The automations themselves live in SQLite, deliberately (§D-1): they are agent-writable records, and
    a bad one must never be able to brick the config-validated boot — the unit crash-loops on a config
    this build cannot load, and the only UI for fixing that is the one that would be down. What belongs
    in config is what the OPERATOR sets once: how the runner behaves.

    `enabled=True` is safe as a default because it arms nothing on its own: with no automations stored,
    the loop polls an empty table. Turning it OFF is the master switch (the loop keeps idling and applies
    the change with no restart), which is what makes it useful during an incident.

    - `poll_seconds`: how often the claim scan runs. Named to match `server.poll_seconds`.
    - `default_timeout_s`: the wall-clock deadline for a run that sets none of its own; the runner cancels
      the turn through `cancel_turn` when it passes.
    - `max_count`: how many definitions may exist AT ALL (counted + inserted in one transaction, so the
      cap cannot be raced). A cap the agent can hit too — hence the refusal names the remedy.
    - `misfire_grace_s`: how late a slot may still fire. Past it the run is recorded `missed` and skipped
      (owner ruling 3) — a box asleep at 09:00 does not run the 09:00 job at noon.
    - `keep_runs`: run rows kept per automation; older ones are pruned WITH their per-run threads (an
      hourly automation would otherwise leave ~8.7k invisible archived threads a year)."""

    model_config = {"extra": "allow"}

    enabled: bool = True
    poll_seconds: int = Field(default=10, ge=1, le=3600)
    default_timeout_s: int = Field(default=300, ge=1, le=86_400)
    max_count: int = Field(default=20, ge=1, le=500)
    misfire_grace_s: int = Field(default=300, ge=0, le=86_400)
    keep_runs: int = Field(default=50, ge=1, le=1000)


class MediaRoleCfg(BaseModel):
    """The owner's persisted state for ONE media role folder — that role's LIBRARY (D65, §2.2).

    ONE object per role rather than an `order:` map beside a `hidden:` map beside a `focal:` map — the
    next per-role dimension is an additive field with a default here (the extend-don't-migrate
    directive, D48's `providers` precedent). Today it carries exactly one:

    - `files`: the library, in the owner's PRIORITY order. Each entry is a `MediaItem` — exactly one
      of `name` (a file in the folder) or `bundled` (an id the role ships), plus that entry's own
      `key`/`hidden`/`focal`. It OVERRIDES the index's default collation for the entries it lists;
      anything on disk it does not name follows in that collation and the role's unlisted bundled ids
      follow as the fallback tier, and an entry whose file is gone is ignored (a deleted drop must not
      404 a listing).

    `files` REPLACED the `order: [names]` list at `config_version` 2 — the same list, grown from bare
    names into per-item objects because the entry had to carry `hidden` and `focal`. The migration is
    in `config_migration/steps.py`; no reader of the old key survives here (the no-legacy-seams rule).
    """

    model_config = {"extra": "allow"}

    files: list[MediaItem] = Field(default_factory=list)


class MediaNsCfg(BaseModel):
    """`media.namespaces.<ns>` — everything the gallery persists for ONE namespace (D53, MEDIA_PLAN §4).

    Deliberately NOT the art itself: the files live in `$CTRLB_HOME/media/<ns>/<role>/` and the role
    folder a file sits in IS its assignment (§5.4's re-rule). This block only records the two things a
    folder listing cannot: the owner's ORDER inside a role, and the cross-role `slots` pins.

    Namespace-GENERIC by construction: one model for every row of `MEDIA_NAMESPACES`, so a namespace is
    a registry row and never a pydantic class of its own. `slots` is therefore a MAP whose keys the
    registry validates (`Settings._known_media_namespaces_roles_and_slots`) rather than typed fields —
    typed per-namespace slot fields would force an `isinstance` branch one layer up, which is the
    banned sibling shape (§4).

    Each slot value is a `MediaPin`: **the same `{name}`/`{bundled}` identity union a `files` entry
    carries** (the 2026-08-26 owner ruling, "W9"), with `null`/absent meaning unpinned. It used to be a
    bare STEM, and a stem is ambiguous by construction — a file's stem and a bundled id are two
    identity spaces that both answer to `lyra`, and two files can share a stem inside one of them — so
    one pin value could mean two pictures and the collation order picked. The union names ONE entry:
    `{name: lyra.webp}` is that file, `{bundled: lyra}` is the shipped art. A pin that names nothing
    the library holds still degrades to the role's own ladder in the client resolver — never a hole,
    never a crash (§5.3), and never silently dropped here, which would hide the owner's typo.
    """

    model_config = {"extra": "allow"}

    roles: dict[str, MediaRoleCfg] = Field(default_factory=dict)
    slots: dict[str, MediaPin | None] = Field(default_factory=dict)


class MediaWriteCfg(BaseModel):
    """`media.write` — the write-path tunables (D65 §2.2). Per-OPERATION rather than per-namespace: the
    cap is about what this SERVER accepts through one endpoint, not about what a theme's art should be.

    - `max_bytes`: the streamed upload cap (15 MB, owner ruling ③). The route counts the body as it
      arrives and answers `413` past this — never from `Content-Length`, which is a claim.
    """

    model_config = {"extra": "allow"}

    max_bytes: int = Field(default=15 * 1024 * 1024, gt=0)


class MediaCfg(BaseModel):
    """`media` — the owner's whole media state (D65's fold).

    The namespaces moved DOWN one level (`media.<ns>` → `media.namespaces.<ns>`) for one structural
    reason: this block needed a sibling that is not a namespace (`write`), and a `write:` key beside
    `gacha:`/`kit:` would parse as a namespace called "write". The fold is the migration's whole
    reason and it is what keeps every future non-namespace knob additive.
    """

    model_config = {"extra": "allow"}

    write: MediaWriteCfg = Field(default_factory=MediaWriteCfg)
    namespaces: dict[str, MediaNsCfg] = Field(default_factory=dict)


class AttachmentsCfg(BaseModel):
    """`attachments` — composer attachments (D68 / ATTACHMENTS_PLAN §6).

    One block for the whole feature, grown with optional fields as the slices land (the
    extend-don't-migrate directive): S1 owns the three knobs the STORE needs — how many files one
    message may carry, how big one file may be, and how long an unclaimed staging file survives —
    and S2 adds the four the MODEL FEED reads. `extra="allow"` so a config written by a later slice
    round-trips through this build instead of being dropped on save.

    - `max_files_per_message`: the per-send ceiling the chat POST refuses past. A ceiling on the
      CLAIM rather than on the store: staging is id-addressed and has no message to belong to yet.
    - `max_file_mb`: the streamed upload cap. The mint counts the body as it arrives and answers
      `413` past this — never from `Content-Length`, which is a claim (R55).
    - `staging_orphan_hours`: how long a staged file may sit unclaimed. It is BOTH the boot sweep's
      cutoff and the claim's freshness test, deliberately one number: a file the sweep would reclaim
      must not still be claimable, or the two rules would disagree about the same file.
    - `max_inline_chars` (S2 §4.2): how much of a text attachment is injected into the user turn,
      and equally the page size `read_attachment` reads by — ONE number, so "what one page holds"
      cannot disagree with "what the turn was given". 16k is ratified (§0b-4) *because* the paged
      tool can reach the rest of the file.
    - `image_tokens` (S2 §4.1): what one sent image is PRICED at by the estimator. A per-provider
      tiling formula is not knowable here (every backend counts differently), so this is the honest
      single figure the field clusters around — and it is read at estimate time, never baked into a
      persisted row (confirm N1).
    - `max_images_per_request` (S2 §4.1): how many images ONE assembled request may carry across the
      whole history. Past it the OLDEST degrade to a stub, because history accumulation is otherwise
      unbounded (council E5).
    - `resend` (S2 §4.5): do images from EARLIER turns ride along again? True by default (7/7 of the
      field; dropping them breaks follow-up questions about a photo). Off, only the current turn's
      images are sent and older ones render as stubs.
    - `max_pdf_pages` / `max_extracted_chars` (S4 §4.3): how far a claimed PDF's text extraction
      goes — how many pages it reads, and how many characters it collects before it stops. **Soft
      bounds** (§0b-3, owner-ratified): they stop the ITERATION, they cannot interrupt one
      pathological `extract_text()` call, and the page that crosses the character bound rides whole.
      They are also the send's worst-case wait, because extraction happens once, inside the claim —
      lower them if a huge document ever makes a send feel slow. Neither is what the MODEL sees:
      `max_inline_chars` caps the injected page, and `read_attachment` pages the rest.
    - `image_max_dimension` / `image_quality` (S3 §6): the CLIENT's downscale — the longest edge a
      staged photo is re-encoded to, and the encoder quality it is re-encoded at. Server-held for the
      same reason every other client knob is (`voice.stt.auto_send`'s precedent): the browser must
      not carry its own copy of a tunable the owner edits in Conf. Read by the composer over
      `GET /api/providers` (the one non-secret surface the composer already loads from every tab);
      nothing on the server consumes them — the bytes that arrive are already re-encoded, and
      `max_file_mb` is what actually bounds them.
    """

    model_config = {"extra": "allow"}

    max_files_per_message: int = Field(default=10, gt=0)
    max_file_mb: int = Field(default=10, gt=0)
    staging_orphan_hours: int = Field(default=24, gt=0)
    image_max_dimension: int = Field(default=2048, gt=0)
    image_quality: float = Field(default=0.85, gt=0, le=1)
    max_inline_chars: int = Field(default=16000, gt=0)
    image_tokens: int = Field(default=1000, ge=0)
    max_images_per_request: int = Field(default=10, ge=0)
    resend: bool = True
    #: 400 000 characters ≈ LibreChat's `fileTokenLimit: 100_000` — the field's ONE shipped cap on
    #: extracted document text (R61 §2.2/§9.1-3) — at the `CHARS_PER_TOKEN` ratio this codebase
    #: already estimates with. 200 pages is derived rather than clustered (no peer in R61 bounds PDF
    #: pages at all): at the ~2 000 characters a dense prose page carries, the two bounds bite at the
    #: same document size, so neither silently dominates the other.
    max_pdf_pages: int = Field(default=200, gt=0)
    max_extracted_chars: int = Field(default=400_000, gt=0)

    @property
    def max_bytes(self) -> int:
        """`max_file_mb` in bytes — computed HERE so the route, the ladder's 413 and the tests can
        never each do their own multiplication."""
        return self.max_file_mb * 1024 * 1024

    @property
    def staging_orphan_s(self) -> float:
        """`staging_orphan_hours` in seconds, for the same reason."""
        return self.staging_orphan_hours * 3600.0


class RoleplayPersonaCfg(BaseModel):
    """`roleplay.persona` — the OWNER's persona (ROLEPLAY_PLAN §3.2), global across agents; the
    per-agent override of the NAME half is `AgentDef.user_name`.

    - `name`: what `{{user}}` renders as. "" → the literal `"User"` (ruling 7's last rung).
    - `description`: who the owner is, injected as its own head block after the roster when
      non-empty (§4.2) — the same block for every agent, because the persona is a fact about the
      owner rather than about any one character.
    """

    model_config = {"extra": "allow"}

    name: str = ""
    description: str = ""


class CardImportCfg(BaseModel):
    """`roleplay.card_import` — what the card importer will accept (D70 / ROLEPLAY_PLAN §5.3, Emma F8).

    Config-shaped rather than baked constants for the reason every other limit here is: a card the
    owner wants is refused by a number, and a number they cannot reach is a wall. Every cap is
    enforced for EVERY container (§7) on the existing cap+1/413 posture — read one byte past the
    limit, which is the least that still proves "over" without materialising the excess.

    - `max_bytes`: the multipart body cap. 15 MB = the media write path's own ceiling
      (`media.write.max_bytes`), because a PNG card IS an image upload with metadata glued on.
    - `max_card_json_bytes`: the DECODED card JSON — the base64 out of a PNG chunk, the `card.json`
      member of a CHARX, or a bare `.json` body. It is what ends up serialised into `agent.yaml`
      (the `card` stash), so it is bounded separately from the container that carried it.
    - `charx_max_entries` / `charx_max_entry_bytes` / `charx_max_total_bytes`: the zip's own bounds —
      how many members it may declare, how big any one may be, and how much it may claim to expand
      to. Checked against the DECLARED sizes before anything is decompressed (the zip-bomb guard),
      and again against the bytes actually read.
    """

    model_config = {"extra": "allow"}

    max_bytes: int = Field(default=15_000_000, gt=0)
    max_card_json_bytes: int = Field(default=2_000_000, gt=0)
    charx_max_entries: int = Field(default=500, gt=0)
    charx_max_entry_bytes: int = Field(default=15_000_000, gt=0)
    charx_max_total_bytes: int = Field(default=50_000_000, gt=0)


class RoleplayCfg(BaseModel):
    """`roleplay` — the character-agent globals (D70 / ROLEPLAY_PLAN §3.2).

    - `enabled` is PRESENTATION ONLY (P2): it shows/hides the UI clutter of the character fields.
      Nothing server-side branches on it — the §4 assembly is universal, so a character keeps
      working with the switch off.
    - `default_tools` is the explicit allowlist written to a newly created/imported character (§5.5,
      consumed by S2): a minimal starting set the owner freely widens, never a capability ceiling.
    - `card_import` holds what the importer will ACCEPT (S2) — a nested object rather than five
      `card_import_*` siblings, per the extend-don't-migrate directive.

    Additive with defaults throughout ⇒ no config migration (the D68 precedent); `extra="allow"` so
    a config written by a later slice round-trips through this build instead of being dropped."""

    model_config = {"extra": "allow"}

    enabled: bool = False
    default_tools: list[str] = Field(default_factory=lambda: ["web_search"])
    persona: RoleplayPersonaCfg = Field(default_factory=RoleplayPersonaCfg)
    card_import: CardImportCfg = Field(default_factory=CardImportCfg)


class LorebooksCfg(BaseModel):
    """`lorebooks` — the lorebook subsystem's globals (D70 / ROLEPLAY_PLAN §3.2/§6).

    A TOP-LEVEL section, not a key under `roleplay`: books are roleplay-INDEPENDENT (§6, ruling 9) —
    the manager is visible whether or not the character UI is, and an ordinary agent may carry one.

    - `books`: globally-attached book slugs — every agent, every turn. Unioned with the agent's own
      `lorebooks` list and slug-deduped, so binding a book twice counts once (§6.3).
    - `scan_depth`: how many prior chat messages join the incoming one in the haystack. ST's shipped
      default (2). `0` scans only what the owner just said.
    - `budget_chars`: the ceiling on ACTIVATED entry content for one turn. Over it, entries are
      evicted lowest-`priority`-first (§6.4's V3 model, not ST's refusal). The framing does not
      count — the budget bounds the owner's text, and the framing is a constant.
    - `max_import_bytes`: the book-import body cap, on the same cap+1/413 posture every other
      upload here uses (`CardImportCfg`). A book is JSON the owner exported from another app, so it
      is bounded by the same reasoning a card is: read one byte past the limit, never materialise
      the excess.

    Additive with defaults ⇒ no config migration (the D68 precedent); `extra="allow"` so a config
    written by a later slice round-trips through this build."""

    model_config = {"extra": "allow"}

    books: list[str] = Field(default_factory=list)
    scan_depth: int = Field(default=2, ge=0)
    budget_chars: int = Field(default=4000, gt=0)
    max_import_bytes: int = Field(default=15_000_000, gt=0)


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
    #: Foreground notification preferences (F1) — read by the client through the thin
    #: `GET /api/notifications`; the backend never sends a notification itself.
    notifications: NotificationsCfg = Field(default_factory=NotificationsCfg)
    #: Fleet wake automation (ROADMAP D2) — the D2-B connect cooldown + the D2-A presence tunables.
    wake: WakeCfg = Field(default_factory=WakeCfg)
    #: The fleet monitor loop (D2-A/D50) — interval + the asymmetric up/down damping thresholds.
    monitor: MonitorCfg = Field(default_factory=MonitorCfg)
    #: Scheduled agent automations (A3/D49) — runner tunables only; the definitions live in SQLite.
    automations: AutomationsCfg = Field(default_factory=AutomationsCfg)
    #: Owner media state (D52/G5 + D53 + **D65's fold**): the per-operation `write` tunables plus
    #: `namespaces`, keyed by NAMESPACE — that map mirrors `MEDIA_NAMESPACES`, which is why it is not
    #: per-theme: `kit` is a namespace no theme owns. Purely additive: a config with no `media:` key
    #: loads the defaults, which is what keeps every consumer on its bundled art until the owner
    #: touches the gallery.
    media: MediaCfg = Field(default_factory=MediaCfg)
    #: Composer attachments (D68) — the store/transport tunables. A sibling of `media`, not a key
    #: inside it: the two share a persist PIPELINE (council E9) but not a purpose, and folding
    #: attachment knobs under `media.write` would make one cap answer for the owner's art library and
    #: for whatever the phone attaches to a chat.
    attachments: AttachmentsCfg = Field(default_factory=AttachmentsCfg)
    #: Character agents (D70) — the UI-visibility switch, the import-time minimal toolset, and the
    #: owner's own persona. A sibling of `agent`, not a key inside it: the per-agent half of this
    #: feature lives on `AgentDef` (flat fields, P1), and this section holds only what is GLOBAL.
    roleplay: RoleplayCfg = Field(default_factory=RoleplayCfg)
    #: The lorebook subsystem (D70 §6). Its own top-level section rather than a key under
    #: `roleplay`, because books are roleplay-INDEPENDENT: any agent may carry one and the manager
    #: is visible with the character UI switched off (ruling 9).
    lorebooks: LorebooksCfg = Field(default_factory=LorebooksCfg)
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
    #: Per-prompt overrides (Phase 18, D56), keyed by the registry id in `services/agent/prompts.py`
    #: → a unified `PromptOverride` (`override` + `append`, both optional). Read live per model call
    #: by `resolve()` — there is no cache, so an edit applies from the next resolve. An id with no
    #: entry (or an entry whose fields are blank) runs on the baked default; an id the registry does
    #: not know is preserved on disk and simply never read.
    prompts: dict[str, PromptOverride] = Field(default_factory=dict)
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

    @model_validator(mode="after")
    def _monitor_interval_covers_the_fleet_cache(self) -> "Settings":
        """`monitor.poll_seconds >= server.poll_seconds` (D50 M4) — a cross-field rule, so it lives
        here rather than on either section.

        Not a style preference: the monitor counts CONSECUTIVE CHECKS, and its checks come from
        `FleetService.status_all()`, whose TTL cache is keyed on `server.poll_seconds`. Ticking faster
        than that TTL serves the SAME cached sweep to several ticks, and the damping would then count
        one observation as two or three — confirming a transition off a single ping."""
        if self.monitor.poll_seconds < self.server.poll_seconds:
            raise ValueError(
                f"monitor.poll_seconds ({self.monitor.poll_seconds}) must be >= server.poll_seconds "
                f"({self.server.poll_seconds}) — a shorter interval would count one cached fleet "
                "sweep as several consecutive checks"
            )
        return self

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

    @field_validator("media")
    @classmethod
    def _known_media_namespaces_roles_and_slots(cls, v: MediaCfg) -> MediaCfg:
        """Every key is checked against `MEDIA_NAMESPACES` (D53 §4). A namespace, role or slot key that
        is not in the registry would be silently inert — a typo the owner could never see — so it is a
        load/PUT error instead. The same rule reaches inside a `files` entry (D65):

        * a `name` is a FILENAME inside its role folder, never a path — `is_addressable_name` is the
          one predicate (defect #8 re-ruled it: a `\\` is an ordinary POSIX filename character that
          this surface SERVES, so refusing to let config name such a file only made it unreorderable);
        * a `bundled` id must be one this role actually SHIPS, or the entry occupies a priority slot
          for a picture no client could map;
        * `(kind, id)` is unique within a role (Emma #10) — a list naming one entry twice has no
          single answer to "where does it sit".

        …and since "W9" the SAME two rules reach inside a `slots` PIN, because a pin persists the same
        identity union. It is checked against the pin's SOURCE role (`MediaSlot.source`) — a seat binds
        an entry of *another* role's library, so "is this a real bundled id" is a question about that
        role and about no other. Anything a pin can be checked for, it is checked for here rather than
        in `MediaPin` itself, for the reason the `files` rules live here: this is where the registry
        row is in scope.
        """
        for ns, block in v.namespaces.items():
            row = MEDIA_NAMESPACES.get(ns)
            if row is None:
                raise ValueError(f"unknown media namespace {ns!r} (expected one of {list(MEDIA_NAMESPACES)})")
            for role, cfg in block.roles.items():
                if role not in row.roles:
                    raise ValueError(
                        f"unknown media role {role!r} in namespace {ns!r} (expected one of {list(row.roles)})"
                    )
                where = f"media.namespaces.{ns}.roles.{role}.files"
                seen: set[tuple[str, str]] = set()
                for item in cfg.files:
                    if item.name is not None and not is_addressable_name(item.name):
                        raise ValueError(f"{where}: {item.name!r} is not a bare filename")
                    if item.bundled is not None and item.bundled not in row.roles[role].bundled:
                        raise ValueError(
                            f"{where}: {item.bundled!r} is not a bundled id of this role "
                            f"(expected one of {list(row.roles[role].bundled)})"
                        )
                    if item.identity in seen:
                        raise ValueError(f"{where}: {item.identity[1]!r} is listed twice")
                    seen.add(item.identity)
            for slot, pin in block.slots.items():
                srow = row.slots.get(slot)
                if srow is None:
                    raise ValueError(
                        f"unknown media slot {slot!r} in namespace {ns!r} (expected one of {list(row.slots)})"
                    )
                if pin is None:  # `null` IS the shape for "unpinned" — the gallery's own Clear write.
                    continue
                where = f"media.namespaces.{ns}.slots.{slot}"
                ships = row.roles[srow.source].bundled
                if pin.name is not None and not is_addressable_name(pin.name):
                    raise ValueError(f"{where}: {pin.name!r} is not a bare filename")
                if pin.bundled is not None and pin.bundled not in ships:
                    raise ValueError(
                        f"{where}: {pin.bundled!r} is not a bundled id of the {srow.source!r} role "
                        f"this seat binds from (expected one of {list(ships)})"
                    )
        return v

    def media_overrides(self, ns: str) -> tuple[dict[str, list[MediaItem]], dict[str, MediaPin]]:
        """`(files-by-role, slots)` for one media namespace — the projection the namespace-generic media
        index consumes, so the API layer never branches on a namespace. Empty for a namespace the owner
        has never touched, which is exactly what "no owner overrides" looks like.

        A CLEARED pin does not ride: `null` is what the gallery's Clear writes, and "unpinned" is the
        absence of the key — which is what every resolver already reads as unset. Nothing else is
        filtered here: since "W9" a pin is a typed object, so the shapes this used to quietly swallow
        (a blank string, a stem naming nothing) are load errors one level up instead of values that
        reach the resolver looking like intent."""
        block = self.media.namespaces.get(ns)
        if block is None:
            return {}, {}
        files = {role: list(cfg.files) for role, cfg in block.roles.items() if cfg.files}
        slots = {k: v for k, v in block.slots.items() if v is not None}
        return files, slots

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
                wake_on_connect=cfg.wake_on_connect,
                wake_on_presence=cfg.wake_on_presence,
                wake_presence_cooldown_s=cfg.wake_presence_cooldown_s,
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

    def lorebooks_dir_path(self) -> Path:
        """`$CTRLB_HOME/lorebooks/` — one `<slug>.yaml` per book (D70 §6.1). A sibling of `agents/`
        and `skills/` under the one workspace root, for the same reason they are: a book is
        owner-authored, diffable, editable in place, and discovered by scanning."""
        return self.home_dir() / "lorebooks"

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


def loggable(s: str) -> str:
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
        # Warned ONCE per process. `load_settings` runs at least twice on a normal boot since slice 4
        # (the import-time preflight proves the config loads, then the lifespan loads it for real) and
        # again on every config write, so an un-deduplicated warning repeats an identical line at the
        # operator on the one channel they have. Keyed by the variable, so a DIFFERENT bad variable
        # still speaks up.
        if not _env_path_is_declared(section, key) and full not in _WARNED_ENV_PATHS:
            _WARNED_ENV_PATHS.add(full)
            _LOG.warning(
                "%s targets `%s.%s`, which this build does not define, so it cannot take effect. "
                "Config overrides are one level deep (CTRLB_<SECTION>__<KEY>) and cannot address "
                "provider credentials; those live in config.yaml.",
                *(loggable(s) for s in (full, section, key)),
            )
        bucket = raw.get(section)
        if not isinstance(bucket, dict):
            bucket = {}
            raw[section] = bucket
        bucket[key] = env[full]
    return raw


_LOG = logging.getLogger("ctrlb.config")

#: Variables already warned about this process (see `_apply_env_overrides`). Deliberately unbounded:
#: it is keyed by env-var name, so its size is bounded by the environment itself.
_WARNED_ENV_PATHS: set[str] = set()

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


class _HasErrors(Protocol):
    """Structural type for "a validation error that can list its problems" — pydantic's
    `ValidationError` and FastAPI's `RequestValidationError` both satisfy it with different
    signatures, and `config.py` sits below the API layer, so neither is imported here."""

    def errors(self, *args: Any, **kwargs: Any) -> Sequence[Any]: ...


def validation_detail(exc: _HasErrors) -> list[dict[str, Any]]:
    """The API-safe rendering of a `ValidationError` — `{loc, msg, type}` and nothing else.

    The structured sibling of `sanitise_validation_error` (which renders the same facts as a log line),
    for the 422 bodies. `exc.errors()` includes **`input`: the rejected value**, and every endpoint that
    validates a submitted document therefore echoed that document back over the wire on rejection —
    `providers.*.api_key` from a settings PUT, `ssh_password` from a host PUT, an MCP server's
    `env`/`headers` from an integrations PUT. Confirmed with a canary during the A11 pre-release
    frontend audit: a rejected settings save returned the real key in `detail[0].input`, and the UI
    rendered it into a toast.

    Rebuilt field-by-field rather than trusting `include_input=False` alone, so a future pydantic field
    that echoes the input has to be added here consciously. `loc` is kept — see
    `sanitise_validation_error` for why a location is not a secret in this system.

    Takes anything with an `errors()` — pydantic's `ValidationError` AND FastAPI's
    `RequestValidationError`, which is the one that matters most (it fires BEFORE any handler runs) and
    whose `errors()` accepts **no keyword arguments at all**. Hence the fallback, and hence the rebuild
    being the actual guarantee rather than the kwargs: typed structurally so `config.py`, which sits
    below the API layer, does not have to import FastAPI to name it.
    """
    try:
        raw = exc.errors(include_url=False, include_context=False, include_input=False)
    except TypeError:  # FastAPI's RequestValidationError.errors() takes no kwargs
        raw = exc.errors()
    return [{"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")} for e in raw]


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
        # `loggable` here too: the origin is the CTRLB_CONFIG path, i.e. operator-supplied text on
        # its way to the journal — the same forged-log-line class the override warning closes.
        message = sanitise_validation_error(exc, loggable(str(p)))
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


def save_settings_comment_stripping_for_tests(settings: Settings, path: Path | None = None) -> None:
    """TESTS ONLY — persist a whole `Settings` via `yaml.safe_dump`, which STRIPS comments/key order.

    The real write path is `edit_config_yaml` (the comment-preserving ruamel chokepoint every UI/PUT/
    migration write routes through); this whole-document dump is a fixture convenience for seeding a
    temp config from a `Settings` object. Named explicitly and kept OUT of `__all__` so it can never be
    mistaken for the production writer sitting a chokepoint away (SYS-6). Do not call it on the live
    `config.yaml`.

    Persists atomically (write temp + `os.replace`) so a crash can't truncate config.

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
    of the **masked** providers subtree, first 16 hex chars. One helper reused by `GET /api/providers`
    (served as `rev`), the PUT concurrency guard (a `providers`-carrying PUT whose base != this → 409),
    and the PUT response (`providers_rev`, the post-write value). `sort_keys` makes it order-independent.

    It hashes the MASKED dump, not the raw one (A11 pre-release audit, LOW). The digest is published
    next to the masked values, so hashing raw secrets turns the pair into an offline verification
    oracle: a guess can be confirmed by recomputing the digest, with the mask cutting the search space.
    The cost is exactly the change the client cannot see either — a secret rotated to one with the same
    `ab…yz` mask leaves the fingerprint equal — and that is harmless here, because a stale draft
    submitting the mask restores whatever is CURRENTLY on disk (`unmask_secrets`), so it cannot clobber
    the rotation it failed to notice.
    """
    sub = {name: mask_secrets(p.model_dump(mode="json")) for name, p in settings.providers.items()}
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


def _yaml11_safe(v: Any) -> Any:
    """Quote incoming strings the loader would misread. The writer is ruamel in YAML 1.2, where
    `23:00` / `no` / `on` are plain strings and dump unquoted — but `load_settings` reads with
    PyYAML's YAML 1.1 resolver, which takes them back as int 1380 / bool / bool. Any NEW string
    landing in the doc must therefore be single-quoted unless a 1.1 read returns it verbatim
    (strings already in the file keep their own quoting via `preserve_quotes`). Multiline strings
    are left alone: ruamel emits them in a style both resolvers agree on, and quoting would churn
    prompt-override blocks. Recurses into dicts/lists so sequence entries (e.g. a presence-device
    map inside a list) get the same guard — KEYS included: a map written as `{"no": {"on": …}}`
    reloads as `{False: {True: …}}` otherwise, which is not a mangled value but a mangled TREE (the
    S2 review's MED-6; a character card's stash is arbitrary author-chosen keys)."""
    if isinstance(v, dict):
        return {_yaml11_key(k): _yaml11_safe(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_yaml11_safe(x) for x in v]
    if isinstance(v, str):
        return _yaml11_scalar(v)
    return v


def _yaml11_scalar(v: str) -> Any:
    """One string, single-quoted unless a YAML-1.1 read gives it back verbatim (see `_yaml11_safe`)."""
    if "\n" in v:
        return v
    try:
        loaded = yaml.safe_load(v)
    except yaml.YAMLError:
        return SingleQuotedScalarString(v)
    if not isinstance(loaded, str) or loaded != v:
        return SingleQuotedScalarString(v)
    return v


def _yaml11_key(k: Any) -> Any:
    """A mapping key under the same rule. Non-string keys are left alone: JSON has none, and a YAML
    doc's own `3:`/`yes:` key is the operator's, written the way they wrote it."""
    return _yaml11_scalar(k) if isinstance(k, str) else k


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
            node[k] = _yaml11_safe(v)


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
            # A key NEW to this node is written under the same 1.1 guard its value gets (MED-6);
            # one already in the file keeps its own form, quoting and comment.
            node[k if k in node else _yaml11_key(k)] = _yaml11_safe(v)
    for k in [k for k in node if k not in target]:
        unplaced += _delete_key(node, k)
    return unplaced


def dealias_mapping(doc: Any) -> Any:
    """`doc` with every YAML ALIAS given its own independent node, returned for chaining.

    ruamel loads `routing: *m` as the SAME object `model: &m …` is, so a later `sync_mapping` that
    writes one of them writes both — two keys the file states separately end up whatever the last
    sync said (the S2 review's MED-7). Walking by object identity and deep-copying the second and
    further sightings is the whole fix: after it, each occurrence is the value the file showed at
    that key, and the anchor is simply expanded on save.

    NOT wired into `edit_config_yaml`: expanding an operator's anchors is only acceptable where the
    caller owns the whole file and the write is a full replace — `_scaffold_agent`'s `agent.yaml`
    and (D70 S3, the same class) a lorebook's `<slug>.yaml`, both of which are dumped whole from an
    editor submission or from imported JSON, where one shared dict object reached by two keys is an
    accident of the parse rather than something the file said. `config.yaml`'s anchors belong to the
    operator and every other `sync_mapping` caller edits a subtree of a file it does not own."""
    seen: set[int] = set()

    def walk(node: Any) -> Any:
        if not isinstance(node, dict | list):
            return node
        if id(node) in seen:
            return copy.deepcopy(node)  # a second sighting of one object IS the alias
        seen.add(id(node))
        if isinstance(node, dict):
            for k in list(node):
                node[k] = walk(node[k])
        else:
            for i, v in enumerate(node):
                node[i] = walk(v)
        return node

    return walk(doc)


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


def looks_masked(value: Any) -> bool:
    """True if `value` has the SHAPE of a display mask, judged without reference to any stored secret.

    `_is_unchanged_secret` can only recognise a mask by rebuilding it from `stored`, so when there is
    **no** stored counterpart it returns False and the write path takes the incoming value "as new" —
    writing the literal `sk…yz` to disk **as the credential**. That happens on delete-then-recreate, on
    a rename submitted without `provider_renames`, and on any hand-built PUT: not a leak, but silent
    auth breakage that presents as a provider outage (A11 pre-release audit, MUST-FIX).

    The two forms `_mask` can emit are `••••` (≤4 chars) and `ab…yz` — always exactly five codepoints
    with `…` in the middle, which is what this tests. It deliberately does NOT use `re.fullmatch` with a
    `.`-based pattern: `.` excludes newline, so a credential with a trailing newline (`"ab-token\n"` →
    `"ab…n\n"`) failed the shape test and the literal mask was persisted as the credential — the exact
    bug this predicate exists to close (Codex, pre-release review). A real credential containing `…` is
    not representable through the masked round-trip in any case — inherent to masking, not introduced
    here.
    """
    return isinstance(value, str) and (value == "••••" or (len(value) == 5 and value[2] == "…"))


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
                if _is_unchanged_secret(v, sv):
                    out[k] = sv  # masked/blank + a real stored value → keep what is on disk
                elif looks_masked(v):
                    continue  # a mask with NOTHING to restore: drop the key rather than write `sk…yz`
                else:
                    out[k] = v  # a genuinely new value
            elif k in _SECRET_MAP_KEYS and _is_flat_scalar_map(v):
                sm = sv if isinstance(sv, dict) else {}
                out[k] = {
                    # `_map_key_is_secret` gates the RESTORE too: blank-keeps is a *secret* affordance
                    # (the leaf branch fires only on `_SECRET_LEAF_KEYS`), so a non-secret `env`/`headers`
                    # entry — displayed raw, never masked — must take an explicit blank rather than
                    # silently keeping the stored value. Dropping this guard here would have made a
                    # visible entry unclearable through the UI (Fable, pre-release review).
                    mk: (
                        sm.get(mk) if _map_key_is_secret(mk) and _is_unchanged_secret(mv, sm.get(mk)) else mv
                    )
                    for mk, mv in v.items()
                    # Same rule inside a credential map, and the same drop: a masked entry with nothing
                    # stored is omitted rather than persisted as the literal mask.
                    if not (
                        _map_key_is_secret(mk)
                        and looks_masked(mv)
                        and not _is_unchanged_secret(mv, sm.get(mk))
                    )
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
