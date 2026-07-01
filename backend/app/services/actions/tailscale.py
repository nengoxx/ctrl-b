"""Tailscale Serve control (Phase 6c-2, DECISIONS D20) — the in-app HTTPS toggle.

`tailscale serve --bg <port>` fronts the local frontend with a real TLS cert at the device's tailnet
name, so the phone mic gets a secure context (`HTTPS_TAILSCALE.md`). **Serve only, never funnel** —
tailnet-only, so the no-public-bind boundary (AGENTS §6) holds by construction.

tailscaled is the **source of truth** for on/off: `resolve_status` reads it live (no stored flag, so
nothing can drift). Enable/disable are typed actions invoked at USER/FULL by `api/access.py` (so each
flip is audited as an Event via `ActionService._record`); status is a plain read (no audit on a poll).
The `tailscale` binary is exec'd directly with argv (no shell → no injection; `target_port` is an int).
"""

from __future__ import annotations

import json
import os
import shutil

from pydantic import BaseModel

from app.config import TailscaleCfg
from app.core.proc import run_capture
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult

# Fallback locations when `tailscale` isn't on the backend's PATH (narrower than a login shell's,
# especially on Windows where the backend may not inherit the installer's PATH entry).
_FALLBACK_BINS = [
    r"C:\Program Files\Tailscale\tailscale.exe",
    "/usr/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
]


def _bin() -> str | None:
    """The `tailscale` CLI path, or None if not found."""
    return shutil.which("tailscale") or next((p for p in _FALLBACK_BINS if os.path.exists(p)), None)


def _serves_port(serve_json: str, port: int) -> bool:
    """True if any Web handler in `tailscale serve status --json` proxies our frontend port."""
    try:
        data = json.loads(serve_json or "{}")
    except json.JSONDecodeError:
        return False
    for web in (data.get("Web") or {}).values():
        for handler in (web.get("Handlers") or {}).values():
            proxy = handler.get("Proxy", "") or ""
            if proxy.rstrip("/").endswith(f":{port}"):
                return True
    return False


async def resolve_status(cfg: TailscaleCfg) -> dict:
    """Live Tailscale Serve status from tailscaled (the source of truth). Shape:
    `{available, serving, url, target_port, reason}` — `available` = CLI present + daemon Running;
    `serving` = Serve is currently proxying our `target_port`; `url` = the device's `https://…ts.net`
    (present whenever available, so the panel can show the prospective URL even when off)."""
    out: dict = {
        "available": False,
        "serving": False,
        "url": None,
        "target_port": cfg.target_port,
        "reason": None,
    }
    binpath = _bin()
    if not binpath:
        out["reason"] = "tailscale CLI not found"
        return out

    try:
        st = await run_capture([binpath, "status", "--json"], timeout_s=cfg.timeout_s)
    except (OSError, ValueError) as exc:
        out["reason"] = f"tailscale status failed: {exc}"
        return out
    if st.timed_out:
        out["reason"] = "tailscale not responding"
        return out
    if st.code != 0:
        out["reason"] = st.output.strip()[:200] or f"tailscale status exit {st.code}"
        return out
    try:
        status = json.loads(st.output)
    except json.JSONDecodeError:
        out["reason"] = "could not parse tailscale status"
        return out
    state = status.get("BackendState")
    if state != "Running":
        out["reason"] = f"tailscale backend is {state or 'unknown'} (logged out?)"
        return out

    out["available"] = True
    dns = ((status.get("Self") or {}).get("DNSName") or "").rstrip(".")
    if dns:
        out["url"] = f"https://{dns}"

    try:
        sv = await run_capture([binpath, "serve", "status", "--json"], timeout_s=cfg.timeout_s)
    except OSError, ValueError:
        return out  # available, but couldn't read serve state → serving stays False
    if not sv.timed_out and sv.code == 0:
        out["serving"] = _serves_port(sv.output, cfg.target_port)
    return out


class _NoArgs(BaseModel):
    """No parameters — the port comes from `tailscale.target_port`, not the caller."""


async def _serve_cmd(ctx: InvocationContext, *, off: bool) -> ToolResult:
    """Run `tailscale serve --bg <port> [off]`. Never raises — normalizes into a ToolResult."""
    cfg = ctx.deps.settings.tailscale
    if not cfg.enabled:
        return ToolResult(state=RunState.DENIED, summary="Tailscale control is disabled (tailscale.enabled)")
    binpath = _bin()
    if not binpath:
        return ToolResult(
            state=RunState.ERROR, summary="tailscale CLI not found", error="tailscale not on PATH"
        )
    # `serve` only — funnel is never constructed (no public exposure; the no-public-bind rule).
    argv = [binpath, "serve", "--bg", str(cfg.target_port)]
    if off:
        argv.append("off")
    try:
        cap = await run_capture(argv, timeout_s=cfg.timeout_s)
    except (OSError, ValueError) as exc:
        return ToolResult(state=RunState.ERROR, summary="tailscale serve could not start", error=str(exc))
    if cap.timed_out:
        return ToolResult(state=RunState.ERROR, summary="tailscale serve timed out", error="timed out")
    if cap.code != 0:
        return ToolResult(
            state=RunState.ERROR,
            summary="tailscale serve failed",
            error=cap.output.strip()[:300] or f"exit {cap.code}",
        )
    verb = "disabled" if off else "enabled"
    return ToolResult(
        state=RunState.OK,
        summary=f"HTTPS {verb} (Tailscale Serve · port {cfg.target_port})",
        output=cap.output.strip(),
    )


@action(
    "tailscale_serve_enable",
    title="Enable HTTPS (Tailscale Serve)",
    icon="lock",
    category="action",
    risk=Risk.MED,
    ui_exposed=False,
    agent_exposed=False,
)
async def tailscale_serve_enable(inp: _NoArgs, ctx: InvocationContext) -> ToolResult:
    """Turn on tailnet-only HTTPS for the frontend via Tailscale Serve (never funnel). USER-driven from
    the Conf → Access panel; audited."""
    return await _serve_cmd(ctx, off=False)


@action(
    "tailscale_serve_disable",
    title="Disable HTTPS (Tailscale Serve)",
    icon="lock-open",
    category="action",
    risk=Risk.MED,
    ui_exposed=False,
    agent_exposed=False,
)
async def tailscale_serve_disable(inp: _NoArgs, ctx: InvocationContext) -> ToolResult:
    """Turn off the Tailscale Serve HTTPS front door for the frontend port. USER-driven; audited."""
    return await _serve_cmd(ctx, off=True)
