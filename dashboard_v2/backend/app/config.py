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
from pathlib import Path
from typing import Any, ClassVar

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, Field, SecretStr
from ruamel.yaml import YAML

from app.domain.agent import AgentDef, CompactionCfg, ModelRef
from app.domain.enums import OSType
from app.domain.host import Host
from app.domain.service import Service

__all__ = [
    "Settings", "ModelRef", "AgentDef", "CompactionCfg",
    "load_settings", "save_settings", "mask_secrets", "secret_values", "unmask_secrets", "deep_merge",
    "apply_patch_to_yaml", "prune_unchanged", "edit_config_yaml", "sync_mapping", "host_slug",
]

# dashboard_v2/backend/app/config.py -> dashboard_v2/
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

ENV_PREFIX = "CTRLB_"
#: Env vars handled as bootstrap paths, not as config-section overrides.
_BOOTSTRAP_KEYS = {"HOME", "CONFIG", "DB", "ENV"}

#: Substrings that mark a leaf value as secret (masked on read, never logged).
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
    host: str = "127.0.0.1"          # tailnet-only; fronted by Tailscale Serve for HTTPS
    port: int = 5433                 # 5433 so v2 runs alongside the live Flask app on 5432
    poll_seconds: int = 5            # fleet status poll cadence
    feature_cycle_seconds: int = 6   # hero "now monitoring" auto-cycle period (online hosts only)
    debug: bool = False              # off by default — debug is an RCE surface (ARCHITECTURE §7)


class InferenceEndpointCfg(BaseModel):
    """One OpenAI-compatible chat backend (DESIGN §7). `api_key` is optional — local llama.cpp
    needs none (the client sends a placeholder)."""

    base_url: str = ""               # e.g. http://192.168.1.137:5001/v1
    api_key: str | None = None
    model: str = ""                  # model id the backend loads, e.g. "minig+"


class InferenceCfg(BaseModel):
    """Chat inference (Phase 4). Two named backends — `local` + `cloud` — selected by
    `default_mode`; the `/local`//`/cloud` composer prefixes (4c) switch per-message. One
    `openai` client shape covers both (just a different base_url/key/model)."""

    default_mode: str = "local"      # "local" | "cloud"
    request_timeout_s: float = 600.0  # thinking models load slowly + stream slowly — be generous
    system_prompt: str = ""          # optional override of the built-in default agent prompt (replace)
    #: Additive guidance appended to whichever base prompt is active (7e-a). Emitted as its own
    #: `system` message after the base — mirrors how the roster + active skills are injected. The
    #: per-agent equivalent is `AgentDef.prompt_append`; both apply unless the agent opts out
    #: (`inherit_append=False`). Leaving this blank keeps today's behaviour.
    system_prompt_append: str = ""
    local: InferenceEndpointCfg = Field(default_factory=InferenceEndpointCfg)
    cloud: InferenceEndpointCfg = Field(default_factory=InferenceEndpointCfg)

    def endpoint(self, mode: str | None = None) -> InferenceEndpointCfg:
        return self.local if (mode or self.default_mode) == "local" else self.cloud


class AgentCfg(BaseModel):
    """Agent-runtime settings (D10/D11/D14). `default_agent` names which `agents/<name>/` folder a
    new thread uses (blank → the default/root agent). `global_subagent_limit` caps concurrent
    subagents across the *whole* tree (§5.5), independent of any one agent's fan-out cap.
    `extra="allow"` so later per-knob additions round-trip."""

    model_config = {"extra": "allow"}

    compaction: CompactionCfg = Field(default_factory=CompactionCfg)
    default_agent: str = ""              # name of the default agent folder; "" → built-in default
    default_title: str = ""              # optional display name for the default/root agent (slug stays "default")
    #: Inheritance base for folder-discovered agents (D14/D15 #1). An `AgentDef`-shaped mapping
    #: (no `name`/`prompt`) whose fields a specialist's `agent.yaml` overrides via
    #: `deep_merge(defaults, agent_yaml)` at load. Absent → the `AgentDef` code defaults. May set
    #: `model` (a per-agent `ModelRef` still wins; `inference.default_mode` is the floor when neither
    #: sets it). The default agent (no `agent.yaml`) is built from this + globals.
    defaults: dict[str, Any] = Field(default_factory=dict)
    global_subagent_limit: int = 6       # process-wide cap on concurrent subagents (tree-wide)
    #: Security rail: clamp a subagent's privilege so it can never exceed its parent's (§5.5).
    #: True (default) is the safe choice; set False if you deliberately want a configured subagent
    #: to run at a higher privilege than the agent that spawned it.
    subagent_clamp_privilege: bool = True
    skills_dir: str = "skills"           # dir scanned for <name>/SKILL.md (relative → project root)
    skills_enabled: bool = True          # master switch for the skills subsystem (4.5)


class MemoryCfg(BaseModel):
    """File-based agent memory (7e-d, D14/D15 #4). Per-agent `memories/MEMORY.md` (isolated) + a
    global `memories/USER.md` (the owner profile, shared across agents), injected into each turn's
    system context after the prompt appends. Hermes-named keys + matching defaults so the files are
    portable to/from Hermes/OpenClaw. `extra="allow"` so later knobs (vector recall, consolidation)
    round-trip."""

    model_config = {"extra": "allow"}

    enabled: bool = True                 # master switch for the memory subsystem
    user_profile_enabled: bool = True    # inject + (7e-d-2) allow writes to the global USER.md
    auto_write: bool = True              # agent may write memory autonomously; off → propose-only (D15 #6)
    memory_char_limit: int = 2200        # per-agent MEMORY.md cap (~800 tokens, Hermes default)
    user_char_limit: int = 1375          # global USER.md cap (~500 tokens, Hermes default)


class EmbeddingsCfg(BaseModel):
    """OpenAI-compatible embeddings backend (Phase 4f, D9). One `/v1/embeddings` endpoint — local
    llama.cpp or a cloud provider (e.g. OpenRouter `qwen/qwen3-embedding-4b`) — powering the vector
    `MemoryProvider` + future semantic search (Phase 7). `enabled=False`/empty `base_url`/`model`
    makes `EmbeddingsClient.configured` false so consumers degrade gracefully. `dim` is optional
    metadata (the model's vector size) for store setup; left `None`, the first embed reveals it."""

    model_config = {"extra": "allow"}

    base_url: str = ""               # e.g. https://openrouter.ai/api/v1 or http://192.168.1.137:5002/v1
    api_key: str | None = None
    model: str = ""                  # e.g. qwen/qwen3-embedding-4b
    enabled: bool = True
    timeout_s: float = 60.0
    dim: int | None = None           # optional: known embedding dimension


class SearxngCfg(BaseModel):
    """SearXNG metasearch endpoint backing the agent `web_search` tool (Phase 4f, D9). Hits the
    instance's `/search?format=json` API (the instance must enable the JSON format in its
    `settings.yml`). `enabled=False` (or an empty `base_url`) makes `web_search` report it's
    unconfigured rather than erroring. `extra="allow"` so a future SearXNG-MCP variant round-trips."""

    model_config = {"extra": "allow"}

    base_url: str = ""               # e.g. http://192.168.1.160:8888 (no trailing /search)
    enabled: bool = True
    timeout_s: float = 10.0          # a metasearch fan-out can be slow-ish; keep it bounded
    language: str | None = None      # optional default UI language passed to SearXNG (e.g. "en")


class OpenTerminalCfg(BaseModel):
    """open-webui/open-terminal endpoint (Phase 4f) — a Bearer-auth REST API giving the agent a
    remote shell + file ops on the host it runs on. Wired as curated typed actions (terminal_exec /
    read / write / list / grep / glob). Risk is **per-operation and configurable**: reads default
    LOW (auto-run) while `exec` and file writes default HIGH (the agent confirms — it's arbitrary
    remote shell). `enabled=False`/empty `base_url` makes the tools report unconfigured."""

    model_config = {"extra": "allow"}

    base_url: str = ""               # e.g. http://192.168.1.160:9999 (no trailing slash)
    api_key: str = ""                # HTTP Bearer token
    enabled: bool = True
    timeout_s: float = 30.0          # per-request timeout
    default_wait_s: float = 30.0     # synchronous-execute wait window (server returns when done/elapsed)
    exec_risk: str = "high"          # risk for terminal_exec (low|med|high) — HIGH gates on confirm
    write_risk: str = "high"         # risk for file writes/replace
    read_risk: str = "low"           # risk for read/list/grep/glob (LOW auto-runs)


class OpenApiServerCfg(BaseModel):
    """An OpenAPI/REST service whose operations are auto-registered as agent tools (Phase 4f) — the
    HTTP sibling of an MCP server, for Open WebUI "tool servers" or any service exposing an OpenAPI
    doc. The spec is fetched from `spec_url` (or `base_url` + `/openapi.json`) at startup and each
    operation becomes a tool `api__<server>__<operationId>`. `risk` gates the **mutating** ops
    (POST/PUT/PATCH/DELETE → `risk`, default `med`); **GET/HEAD auto-run** (LOW) since they're reads.
    Optional `include` allowlists operationIds/paths. Bearer auth via `api_key` (+ `auth_scheme`)."""

    model_config = {"extra": "allow"}

    name: str
    base_url: str = ""               # service root, e.g. http://host:port
    spec_url: str = ""               # explicit OpenAPI doc URL; blank → base_url + /openapi.json
    enabled: bool = True
    risk: str = "med"                # risk for mutating ops (low|med|high); GET/HEAD always LOW
    connect_timeout_s: float = 15.0
    api_key: str = ""                # optional bearer/api token
    auth_scheme: str = "Bearer"      # prefix for the auth header value ("" → raw key)
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
    transport: str = "streamable_http"     # "streamable_http" | "stdio"
    enabled: bool = True
    risk: str = "med"                       # low | med | high — gate for this server's tools
    connect_timeout_s: float = 10.0         # bound startup discovery + per-call connect
    # streamable_http
    url: str = ""                           # e.g. http://192.168.1.160:3003/mcp
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


class Settings(BaseModel):
    """Typed view over `config.yaml`.

    `extra="allow"` so config written by later phases (inference/agents/voice/…) round-trips
    losslessly through current code instead of being silently dropped on save.
    """

    model_config = {"extra": "allow"}

    server: ServerCfg = Field(default_factory=ServerCfg)
    inference: InferenceCfg = Field(default_factory=InferenceCfg)
    agent: AgentCfg = Field(default_factory=AgentCfg)
    memory: MemoryCfg = Field(default_factory=MemoryCfg)
    searxng: SearxngCfg = Field(default_factory=SearxngCfg)
    embeddings: EmbeddingsCfg = Field(default_factory=EmbeddingsCfg)
    open_terminal: OpenTerminalCfg = Field(default_factory=OpenTerminalCfg)
    openapi_servers: list[OpenApiServerCfg] = Field(default_factory=list)
    mcp_servers: list[McpServerCfg] = Field(default_factory=list)
    #: Agents are **folder-only** (D14/D15 #3): discovered by scanning `$CTRLB_HOME/agents/<name>/`
    #: (`agent.yaml` + `SOUL.md`), never stored as a `config.yaml` list. The default/generalist agent
    #: lives at the root (`SOUL.md` + globals, no `agent.yaml`). See `resolve_agent` / `list_agent_names`.
    #: Per-tool description overrides (Phase 7d), keyed by tool name → the model-facing text shown
    #: in the OpenAI tool schema. Lets the owner sharpen a tool's wording (which steers a weak local
    #: model's tool selection) without editing code. Applied onto the live registry specs by
    #: `runtime.apply_tool_descriptions`; an empty/blank value means "use the built-in description".
    tool_descriptions: dict[str, str] = Field(default_factory=dict)
    #: Keyed by host name, preserving the live `wol_server_win.py` `computers{}` shape so the
    #: owner can copy their existing config.yaml unchanged (HANDOFF — migration reference).
    computers: dict[str, ComputerCfg] = Field(default_factory=dict)

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
                            action: {
                                OSType.coerce(os): command for os, command in by_os.items()
                            }
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
        """`$CTRLB_HOME/memories/` — the default agent's `MEMORY.md` + the global `USER.md` (7e-d)."""
        return self.home_dir() / "memories"

    def secret_values(self) -> list[str]:
        """The live config's secret leaf values (api keys, ssh passwords, …) — for redacting them out
        of free text like `session_search` snippets (7e-e, D15 #7). Plain strings at the config layer
        (the file is gitignored; the API masks on read), so `model_dump()` yields the real values."""
        return secret_values(self.model_dump())

    def skills_dir_path(self) -> Path:
        """Absolute path to the skills directory. A relative `agent.skills_dir` resolves against the
        project root (alongside `config.yaml`), so a dropped-in `skills/<name>/SKILL.md` is found
        wherever the config lives."""
        p = Path(self.agent.skills_dir).expanduser()
        return p if p.is_absolute() else (config_path().parent / p)

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
        body = full[len(ENV_PREFIX):]
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
    y = YAML()                       # round-trip mode (keeps comments, key order, anchors)
    y.preserve_quotes = True
    y.width = 4096                   # don't wrap long URLs / keys onto continuation lines
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def _deep_set(node: Any, patch: dict[str, Any]) -> None:
    """Recursively write `patch`'s leaves into the ruamel `node`, descending into existing maps so
    sibling keys + their comments survive. A scalar/list value replaces in place; a dict value
    descends (creating the intermediate map if the file didn't have it)."""
    for k, v in patch.items():
        if isinstance(v, dict):
            child = node.get(k)
            if not hasattr(child, "get"):       # missing or not a mapping → create one
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
    if not hasattr(doc, "get"):                 # empty/new file → start from a fresh mapping
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


def _mask(value: str) -> str:
    s = str(value)
    if len(s) <= 4:
        return "••••"
    return f"{s[:2]}…{s[-2:]}"


def _is_secret_key(key: Any) -> bool:
    return isinstance(key, str) and any(h in key.lower() for h in SECRET_HINTS)


def mask_secrets(data: Any) -> Any:
    """Recursively mask values whose key looks secret. Use on every settings response/log line."""
    if isinstance(data, dict):
        out: dict[str, Any] = {}
        for k, v in data.items():
            if _is_secret_key(k) and v:
                out[k] = _mask(v) if isinstance(v, (str, int)) else v
            else:
                out[k] = mask_secrets(v)
        return out
    if isinstance(data, list):
        return [mask_secrets(v) for v in data]
    return data


def secret_values(data: Any) -> list[str]:
    """Collect the non-empty secret *leaf values* (keys matching `SECRET_HINTS`) from a settings/dict
    tree — the value-level analog of `mask_secrets` (which masks by key). Used to redact those
    secrets out of free text (e.g. `session_search` snippets) via `core.redact.redact`."""
    out: list[str] = []
    if isinstance(data, dict):
        for k, v in data.items():
            if _is_secret_key(k) and isinstance(v, str) and v:
                out.append(v)
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
    dicts by key and lists by index in lockstep with `stored` — fine for the scalar/positional edits
    `PUT /api/settings` allows; list *management* (reorder/insert) uses dedicated endpoints, not this.
    """
    if isinstance(incoming, dict):
        out: dict[str, Any] = {}
        stored_d = stored if isinstance(stored, dict) else {}
        for k, v in incoming.items():
            sv = stored_d.get(k)
            if _is_secret_key(k):
                if (v is None or v == "" or (isinstance(v, str) and v == _mask(sv))) and sv:
                    out[k] = sv          # masked/blank → unchanged: keep the stored real secret
                else:
                    out[k] = v           # a new value was typed
            else:
                out[k] = unmask_secrets(v, sv)
        return out
    if isinstance(incoming, list):
        stored_l = stored if isinstance(stored, list) else []
        return [
            unmask_secrets(v, stored_l[i] if i < len(stored_l) else None)
            for i, v in enumerate(incoming)
        ]
    return incoming
