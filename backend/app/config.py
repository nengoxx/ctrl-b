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

import io
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Literal

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
    "host_slug",
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


class InferenceEndpointCfg(BaseModel):
    """One OpenAI-compatible chat backend (DESIGN §7). `api_key` is optional — local llama.cpp
    needs none (the client sends a placeholder)."""

    base_url: str = ""  # e.g. http://192.168.1.137:5001/v1
    api_key: str | None = None
    model: str = ""  # model id the backend loads, e.g. "minig+"
    #: OpenAI-SDK passthrough merged into this endpoint's chat call — PER-ENDPOINT, never blanket
    #: (OpenAI 400s on unknown args, so a global default would break the cloud chain — ACA-18). Mirrors
    #: `VoiceServiceCfg.extra_body`. Canonical use: llama.cpp prompt-cache pin `{cache_prompt: true}`
    #: (protective on older llama-server builds that defaulted it false) + streaming cache telemetry
    #: (`return_progress: true` for llama.cpp `prompt_progress`; `stream_options: {include_usage: true}`
    #: for a cloud backend's `usage.prompt_tokens_details.cached_tokens`). Declared explicitly because
    #: `InferenceEndpointCfg` has no `extra="allow"`.
    extra_body: dict[str, Any] = Field(default_factory=dict)


class InferenceCfg(BaseModel):
    """Chat inference (Phase 4). Two named backends — `local` + `cloud` — selected by
    `default_mode`; the `/local`//`/cloud` composer prefixes (4c) switch per-message. One
    `openai` client shape covers both (just a different base_url/key/model)."""

    default_mode: str = "local"  # "local" | "cloud"
    request_timeout_s: float = 600.0  # thinking models load slowly + stream slowly — be generous
    system_prompt: str = ""  # optional override of the built-in default agent prompt (replace)
    #: Additive guidance appended to whichever base prompt is active (7e-a). Emitted as its own
    #: `system` message after the base — mirrors how the roster + active skills are injected. The
    #: per-agent equivalent is `AgentDef.prompt_append`; both apply unless the agent opts out
    #: (`inherit_append=False`). Leaving this blank keeps today's behaviour.
    system_prompt_append: str = ""
    local: InferenceEndpointCfg = Field(default_factory=InferenceEndpointCfg)
    cloud: InferenceEndpointCfg = Field(default_factory=InferenceEndpointCfg)
    #: Failover (D18 follow-up). When on, a request whose selected endpoint fails walks a chain — the
    #: selected one, then the *other* of local/cloud, then `fallbacks` — until one answers (any error →
    #: next, "ensure functionality"). Configurable per the no-hardcoding rule; off → today's single-
    #: endpoint behavior (just the selected one).
    failover: bool = True
    #: Extra ordered fallback endpoints beyond the automatic local↔cloud pair (D18's N-deep chain). Each
    #: is any OpenAI-compatible backend; appended after local/cloud in `endpoint_chain`. The model
    #: override (an agent's `ModelRef.model`) applies only to the *selected* endpoint — fallbacks always
    #: use their own configured model (a local model id won't exist on a cloud backend).
    fallbacks: list[InferenceEndpointCfg] = Field(default_factory=list)

    def endpoint(self, mode: str | None = None) -> InferenceEndpointCfg:
        return self.local if (mode or self.default_mode) == "local" else self.cloud

    def endpoint_chain(self, mode: str | None = None) -> list[tuple[str, InferenceEndpointCfg]]:
        """The ordered failover chain for a request: `[selected, the-other-of-local/cloud, *fallbacks]`,
        with blank (`base_url`-less) endpoints dropped and duplicates (same base_url+model) removed.
        `failover=False` collapses it to just the selected endpoint. Returns `(name, endpoint)` pairs;
        the name labels failover logs + the degradation breadcrumb."""
        m = mode if mode in ("local", "cloud") else self.default_mode
        selected = "local" if m == "local" else "cloud"
        named = {"local": self.local, "cloud": self.cloud}
        # Failover off → strictly the selected endpoint (a blank one errors downstream, exactly the
        # pre-D18 behavior — don't silently route a disabled-failover request to the other endpoint).
        if not self.failover:
            return [(selected, named[selected])]
        other = "cloud" if selected == "local" else "local"
        ordered: list[tuple[str, InferenceEndpointCfg]] = [
            (selected, named[selected]),
            (other, named[other]),
            *((f"fallback{i + 1}", ep) for i, ep in enumerate(self.fallbacks)),
        ]
        chain: list[tuple[str, InferenceEndpointCfg]] = []
        seen: set[tuple[str, str]] = set()
        for name, ep in ordered:
            if not ep.base_url:
                continue
            key = (ep.base_url, ep.model)
            if key in seen:
                continue
            seen.add(key)
            chain.append((name, ep))
        return chain


class AgentCfg(BaseModel):
    """Agent-runtime settings (D10/D11/D14). `default_agent` names which `agents/<name>/` folder a
    new thread uses (blank → the default/root agent). `global_subagent_limit` caps concurrent
    subagents across the *whole* tree (§5.5), independent of any one agent's fan-out cap.
    `extra="allow"` so later per-knob additions round-trip."""

    model_config = {"extra": "allow"}

    compaction: CompactionCfg = Field(default_factory=CompactionCfg)
    default_agent: str = ""  # name of the default agent folder; "" → built-in default
    default_title: str = ""  # optional display name for the default/root agent (slug stays "default")
    #: Inheritance base for folder-discovered agents (D14/D15 #1). An `AgentDef`-shaped mapping
    #: (no `name`/`prompt`) whose fields a specialist's `agent.yaml` overrides via
    #: `deep_merge(defaults, agent_yaml)` at load. Absent → the `AgentDef` code defaults. May set
    #: `model` (a per-agent `ModelRef` still wins; `inference.default_mode` is the floor when neither
    #: sets it). The default agent (no `agent.yaml`) is built from this + globals.
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
    """OpenAI-compatible embeddings backend (Phase 4f, D9). One `/v1/embeddings` endpoint — local
    llama.cpp or a cloud provider (e.g. OpenRouter `qwen/qwen3-embedding-4b`) — powering the vector
    `MemoryProvider` + future semantic search (Phase 7). `enabled=False`/empty `base_url`/`model`
    makes `EmbeddingsClient.configured` false so consumers degrade gracefully. `dim` is optional
    metadata (the model's vector size) for store setup; left `None`, the first embed reveals it."""

    model_config = {"extra": "allow"}

    base_url: str = ""  # e.g. https://openrouter.ai/api/v1 or http://192.168.1.137:5002/v1
    api_key: str | None = None
    model: str = ""  # e.g. qwen/qwen3-embedding-4b
    enabled: bool = True
    timeout_s: float = 60.0
    dim: int | None = None  # optional: known embedding dimension


class VoiceEndpointCfg(BaseModel):
    """One OpenAI-compatible STT *or* TTS backend (Phase 6). `voice` is a TTS-only server voice id
    (ignored by STT). `api_key` is optional — local servers ignore it (the client sends a
    placeholder). Same shape spirit as `InferenceEndpointCfg`; the failover chain lives one level up
    on `VoiceServiceCfg`."""

    model_config = {"extra": "allow"}

    base_url: str = ""  # e.g. http://vault:8001/v1
    api_key: str | None = None
    model: str = ""  # e.g. "whisper-large-v3" (STT) or "tts-1"/a voice model (TTS)
    voice: str = ""  # TTS only — server voice id; STT ignores it


class VoiceServiceCfg(BaseModel):
    """Base for a voice service (STT or TTS): the ordered **primary → fallback** chain (D-failover)
    + the shared transport knobs. The active endpoint is `primary`; on **any** failure the request
    falls through to `fallback` (Phase 6 Q2 — ensure functionality, surface the degradation). Split
    timeouts make the failover snappy: `connect_timeout_s` is how fast we give up *reaching* a dead
    endpoint before falling over; `timeout_s` is the (generous) read window for the actual
    transcription/synthesis. `extra_body` is the OpenAI-SDK escape hatch — arbitrary fields passed
    straight to the server for params we don't model as typed fields (rarely needed; usually empty)."""

    model_config = {"extra": "allow"}

    # Floored >0 so a blanked Conf field (→ 0) can't silently wedge voice (a 0s timeout fails every
    # call instantly); the PUT 422s instead, surfacing the bad value — mirrors the memory-cap floors.
    connect_timeout_s: float = Field(default=3.0, gt=0)  # fail-fast on an unreachable endpoint → fall over
    timeout_s: float = Field(default=30.0, gt=0)  # read window for the transcription/synthesis itself
    extra_body: dict[str, Any] = Field(default_factory=dict)  # advanced: passthrough to the server
    primary: VoiceEndpointCfg = Field(default_factory=VoiceEndpointCfg)
    fallback: VoiceEndpointCfg = Field(default_factory=VoiceEndpointCfg)

    def endpoints(self) -> list[VoiceEndpointCfg]:
        """The ordered failover chain — primary then fallback — dropping any with a blank `base_url`
        (so a half-configured fallback doesn't add a guaranteed-failing hop). Fed to `core.failover`."""
        return [e for e in (self.primary, self.fallback) if e.base_url]


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


class ToolOverride(BaseModel):
    """Per-tool override of the registry spec (Phase 8b, D22) — the **one unified object** the owner
    edits in the Tools tab, keyed by tool name in `Settings.tool_overrides`. Each dimension is an
    optional field that falls back to the tool's compile-time default when unset, so adding the next
    dimension (per-tool `settings` — ROADMAP E0a) is a purely additive field, never a new sibling map
    (CLAUDE.md hard rule). Applied onto the live registry specs by `runtime.apply_tool_overrides`.

    - `description`: the model-facing text in the OpenAI tool schema (generalizes the 7d-a override).
      Blank/None → the built-in description.
    - `agent_mode`: the tri-state agent-access mode (`AgentMode`). None → the compile-time default.
    """

    model_config = {"extra": "allow"}  # forward-compat: an unknown future field round-trips

    description: str | None = None
    agent_mode: AgentMode | None = None


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
        merged = deep_merge(defaults, dict(agent_yaml or {}))
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
                raw = loaded
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


def load_settings(path: Path | None = None) -> Settings:
    """Load settings: `.env` → `os.environ`, then YAML, then env overrides (env wins)."""
    load_dotenv()
    p = path or config_path()
    raw: Any = yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else {}
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError(f"{p} must contain a YAML mapping at the top level")
    raw = _apply_env_overrides(raw)
    return Settings.model_validate(raw)


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
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    os.replace(tmp, p)


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


def _deep_set(node: Any, patch: dict[str, Any]) -> None:
    """Recursively write `patch`'s leaves into the ruamel `node`, descending into existing maps so
    sibling keys + their comments survive. A scalar/list value replaces in place; a dict value
    descends (creating the intermediate map if the file didn't have it)."""
    for k, v in patch.items():
        if isinstance(v, dict):
            child = node.get(k)
            if not hasattr(child, "get"):  # missing or not a mapping → create one
                node[k] = {}
                child = node[k]
            _deep_set(child, v)
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


def edit_config_yaml(mutate: Any, path: Path | None = None) -> None:
    """Edit the config file in place with a comment/format-preserving round-trip: load the ruamel
    doc (or a fresh mapping), run `mutate(doc)` to apply changes (set/sync/delete keys), then write
    atomically while keeping the file's existing line ending. This is the single chokepoint for every
    YAML write — `apply_patch_to_yaml` + the hosts CRUD endpoints all funnel through it, so a plain
    `yaml.safe_dump` (which would strip comments, reorder, expand defaults, flip EOL) is never used
    on the operator's file."""
    p = path or config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = p.read_bytes() if p.exists() else b""
    # Detect EOL from the raw bytes — `read_text` would universal-translate CRLF→LF and hide it.
    newline = "\r\n" if b"\r\n" in raw_bytes else "\n"
    y = _yaml_rt()
    doc = y.load(raw_bytes.decode("utf-8")) if raw_bytes else None
    if not hasattr(doc, "get"):  # empty/new file → start from a fresh mapping
        doc = {}
    mutate(doc)
    buf = io.StringIO()
    y.dump(doc, buf)
    # Preserve the file's existing line ending (LF default for a new file) and write bytes directly,
    # so a Windows host doesn't silently rewrite an LF config to CRLF (which would churn every line).
    out = buf.getvalue().replace("\r\n", "\n").replace("\n", newline)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(out.encode("utf-8"))
    os.replace(tmp, p)


def apply_patch_to_yaml(patch: dict[str, Any], path: Path | None = None) -> None:
    """Persist `patch` by editing the existing config file in place (comment/format/EOL preserving) —
    only the changed leaves are rewritten. `patch` should already be pruned to real changes (see
    `prune_unchanged`) with secrets unmasked (see `unmask_secrets`)."""
    if not patch:
        return
    edit_config_yaml(lambda doc: _deep_set(doc, patch), path)


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
            if k in _SECRET_LEAF_KEYS and v:
                out[k] = _mask(v) if isinstance(v, (str, int)) else v
            elif k in _SECRET_MAP_KEYS and isinstance(v, dict):
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
            elif k in _SECRET_MAP_KEYS and isinstance(v, dict):
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
            if k in _SECRET_LEAF_KEYS:
                out[k] = (
                    sv if _is_unchanged_secret(v, sv) else v
                )  # keep stored on masked/blank, else take new
            elif k in _SECRET_MAP_KEYS and isinstance(v, dict):
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
