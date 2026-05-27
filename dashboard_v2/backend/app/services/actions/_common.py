"""Shared inputs + helpers for the built-in actions.

`HostTargetInput` targets a host (wake/shutdown/ping); `ServiceTargetInput` targets a service
(start/stop/restart/open). `run_service_command` is the one place the service-control actions
resolve a service → its host → the per-OS command and run it over SSH, so the three control
actions stay one tiny file each (DESIGN.md §3) while sharing the lookup/redaction logic.
"""

from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field

from app.adapters import ssh
from app.core.redact import redact
from app.core.tool import InvocationContext
from app.domain.enums import RunState
from app.domain.result import ToolResult


class HostTargetInput(BaseModel):
    """Host-targeted fleet actions (wake/shutdown/ping)."""

    host_id: str = Field(description="Stable slug id of the target host (GET /api/hosts → id)")


class ServiceTargetInput(BaseModel):
    """Service-targeted actions (start/stop/restart/open)."""

    service_id: str = Field(
        description="Stable slug id of the target service (GET /api/services → id)"
    )


async def run_service_command(
    action: str, verb: str, inp: ServiceTargetInput, ctx: InvocationContext
) -> ToolResult:
    """Resolve the service + its host, run the per-OS `action` command over SSH, return a result.

    `action` is the `cmd` key (`start`/`stop`/`restart`); `verb` is the human phrasing for
    summaries ("started"). Missing service/host/command/credentials each surface as a clean
    DENIED/ERROR result — never an exception. The host password is redacted from any output.
    """
    svc = ctx.deps.services.service(inp.service_id)
    if svc is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown service '{inp.service_id}'")
    host = ctx.deps.fleet.host(svc.host_id)
    if host is None:
        return ToolResult(
            state=RunState.ERROR, summary=f"service '{svc.name}' references unknown host"
        )

    command = svc.command_for(action, host.os_type)
    if not command:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no {action} command configured for {svc.name} on {host.os_type}",
        )
    if not host.ssh_username or host.ssh_password is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no SSH credentials for {host.name} — cannot {action} {svc.name}",
        )

    secret = host.ssh_password.get_secret_value()
    res = await asyncio.to_thread(
        ssh.run_command,
        host=host.ip,
        port=host.ssh_port,
        username=host.ssh_username,
        password=secret,
        command=command,
    )
    if not res.ok:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to {action} {svc.name}",
            error=redact(res.error, [secret]),
        )
    output = redact((res.stdout + res.stderr).strip() or None, [secret])
    return ToolResult(state=RunState.OK, summary=f"{verb} {svc.name} on {host.name}", output=output)
