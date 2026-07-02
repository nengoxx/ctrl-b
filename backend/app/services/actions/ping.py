"""ping_host — one ICMP echo to a host (low risk, no confirm). Reuses the fleet ping primitive.

Determining "host is offline" is a successful outcome (state=OK with `data.online=False`), not an
error — only a failure of the probe itself (e.g. no `ping` binary) is ERROR.
"""

from __future__ import annotations

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services import fleet as fleet_mod
from app.services.actions._common import HostTargetInput


@action("ping_host", title="Ping", icon="activity", risk=Risk.LOW)
async def ping_host(inp: HostTargetInput, ctx: InvocationContext) -> ToolResult:
    """Send one ICMP echo to a host and report whether it is reachable and its latency."""
    host = ctx.require_deps().fleet.host(inp.host_id)
    if host is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown host '{inp.host_id}'")

    status = await fleet_mod.ping_host(host)
    data = {"online": status.online, "ping_ms": status.ping_ms}

    # "ping not found" is the only real probe failure; a timeout just means offline.
    if status.error and not status.online and "not found" in status.error:
        return ToolResult(
            state=RunState.ERROR, summary=f"could not ping {host.name}", error=status.error, data=data
        )
    if status.online:
        latency = f"{status.ping_ms}ms" if status.ping_ms is not None else "online"
        return ToolResult(state=RunState.OK, summary=f"{host.name} is up · {latency}", data=data)
    return ToolResult(state=RunState.OK, summary=f"{host.name} is unreachable", data=data)
