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

import os
import re
from pathlib import Path
from typing import Any

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, Field, SecretStr

from app.domain.enums import OSType
from app.domain.host import Host
from app.domain.service import Service

# dashboard_v2/backend/app/config.py -> dashboard_v2/
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_CONFIG = _PROJECT_ROOT / "config.yaml"

ENV_PREFIX = "CTRLB_"
#: Env vars handled as bootstrap paths, not as config-section overrides.
_BOOTSTRAP_KEYS = {"CONFIG", "DB", "ENV"}

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


def config_path() -> Path:
    """Resolve the config file path (env `CTRLB_CONFIG` overrides the default location)."""
    override = os.environ.get("CTRLB_CONFIG")
    return Path(override).expanduser().resolve() if override else _DEFAULT_CONFIG


class ServerCfg(BaseModel):
    host: str = "127.0.0.1"          # tailnet-only; fronted by Tailscale Serve for HTTPS
    port: int = 5433                 # 5433 so v2 runs alongside the live Flask app on 5432
    poll_seconds: int = 5            # fleet status poll cadence
    debug: bool = False              # off by default — debug is an RCE surface (ARCHITECTURE §7)


def _slug(name: str) -> str:
    """Stable id from a host name: lowercase, non-alphanumerics → '-' (DESIGN.md §2)."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "host"


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
    """
    p = path or config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    data = settings.model_dump(mode="python", exclude_none=False)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    os.replace(tmp, p)


def _mask(value: str) -> str:
    s = str(value)
    if len(s) <= 4:
        return "••••"
    return f"{s[:2]}…{s[-2:]}"


def mask_secrets(data: Any) -> Any:
    """Recursively mask values whose key looks secret. Use on every settings response/log line."""
    if isinstance(data, dict):
        out: dict[str, Any] = {}
        for k, v in data.items():
            if isinstance(k, str) and any(h in k.lower() for h in SECRET_HINTS) and v:
                out[k] = _mask(v) if isinstance(v, (str, int)) else v
            else:
                out[k] = mask_secrets(v)
        return out
    if isinstance(data, list):
        return [mask_secrets(v) for v in data]
    return data
