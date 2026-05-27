"""Config loading/saving + typed settings (Phase 0 slice).

`config.yaml` is the source of truth (DESIGN.md §9). The full `Settings` model — inference,
voice, agents, hosts, MCP, etc. — lands in later phases; Phase 0 only needs the server block
and the seams that everything else relies on: lenient round-tripping of the whole document,
atomic saves, and central secret masking.

Secrets are never logged and never returned unmasked. `mask_secrets()` is the single choke
point the settings API will reuse.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

# dashboard_v2/backend/app/config.py -> dashboard_v2/
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_CONFIG = _PROJECT_ROOT / "config.yaml"

#: Substrings that mark a leaf value as secret (masked on read, never logged).
SECRET_HINTS = ("password", "secret", "token", "key")


def config_path() -> Path:
    """Resolve the config file path (env `CTRLB_CONFIG` overrides the default location)."""
    override = os.environ.get("CTRLB_CONFIG")
    return Path(override).expanduser().resolve() if override else _DEFAULT_CONFIG


class ServerCfg(BaseModel):
    host: str = "127.0.0.1"          # tailnet-only; fronted by Tailscale Serve for HTTPS
    port: int = 5433                 # 5433 so v2 runs alongside the live Flask app on 5432
    poll_seconds: int = 5            # fleet status poll cadence
    debug: bool = False              # off by default — debug is an RCE surface (ARCHITECTURE §7)


class Settings(BaseModel):
    """Typed view over `config.yaml`.

    `extra="allow"` so config written by later phases (inference/agents/hosts/…) round-trips
    losslessly through Phase 0 code instead of being silently dropped on save.
    """

    model_config = {"extra": "allow"}

    server: ServerCfg = Field(default_factory=ServerCfg)


def load_settings(path: Path | None = None) -> Settings:
    """Load settings from YAML; a missing file yields built-in defaults (fresh install)."""
    p = path or config_path()
    if not p.exists():
        return Settings()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"{p} must contain a YAML mapping at the top level")
    return Settings.model_validate(raw)


def save_settings(settings: Settings, path: Path | None = None) -> None:
    """Persist settings atomically (write temp + `os.replace`) so a crash can't truncate config."""
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
