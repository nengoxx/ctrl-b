"""wake_host — send a Wake-on-LAN magic packet (low risk). `mac=None` is a first-class DENIED
outcome (surfaced, never a crash), mirroring DESIGN.md §15. The packet is fire-and-forget UDP:
OK means "sent", not "host is up" — the next status poll confirms the wake.
"""

from __future__ import annotations

import asyncio

from app.adapters import wol
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.actions._common import HostTargetInput


@action("wake_host", title="Wake", icon="zap", risk=Risk.LOW)
async def wake_host(inp: HostTargetInput, ctx: InvocationContext) -> ToolResult:
    """Send a Wake-on-LAN magic packet to power on a host (requires a configured MAC)."""
    host = ctx.deps.fleet.host(inp.host_id)
    if host is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown host '{inp.host_id}'")
    if not host.mac:
        return ToolResult(
            state=RunState.DENIED, summary=f"no MAC configured for {host.name} — cannot wake"
        )

    try:
        await asyncio.to_thread(wol.send_magic, host.mac)
    except ValueError as exc:  # malformed MAC
        return ToolResult(state=RunState.DENIED, summary=f"invalid MAC for {host.name}", error=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface as data, don't 500
        return ToolResult(state=RunState.ERROR, summary=f"failed to wake {host.name}", error=str(exc))

    return ToolResult(
        state=RunState.OK,
        summary=f"sent wake-up packet to {host.name}",
        data={"mac": host.mac},
    )
