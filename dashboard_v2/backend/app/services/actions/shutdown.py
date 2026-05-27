"""shutdown_host — SSH a per-OS shutdown command (HIGH risk, confirm-gated).

Missing SSH credentials → DENIED (surfaced, not a crash). Connection/auth failures come back as a
typed ERROR from the SSH adapter. The command and any echoed output are redacted against the host
password before they touch a ToolResult/Event — the password never leaves the adapter call.
"""

from __future__ import annotations

import asyncio

from app.adapters import ssh
from app.core.redact import redact
from app.core.tool import InvocationContext, action
from app.domain.enums import OSType, Risk, RunState
from app.domain.result import ToolResult
from app.services.actions._common import HostTargetInput

#: Per-OS shutdown command — matches the live `wol_server_win.py` for Windows/Linux.
_SHUTDOWN_CMD: dict[OSType, str] = {
    OSType.WINDOWS: "shutdown /s /f /t 0",
    OSType.LINUX: "sudo shutdown now",
    OSType.MACOS: "sudo shutdown -h now",
}


@action("shutdown_host", title="Shut down", icon="power", risk=Risk.HIGH, confirm=True)
async def shutdown_host(inp: HostTargetInput, ctx: InvocationContext) -> ToolResult:
    """Shut down a host over SSH (per-OS command; requires configured SSH credentials)."""
    host = ctx.deps.fleet.host(inp.host_id)
    if host is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown host '{inp.host_id}'")
    if not host.ssh_username or host.ssh_password is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no SSH credentials configured for {host.name} — cannot shut down",
        )

    command = _SHUTDOWN_CMD[host.os_type]
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
            summary=f"failed to shut down {host.name}",
            error=redact(res.error, [secret]),
        )
    # Some hosts drop the connection mid-command (a successful shutdown often does); a clean
    # connect with empty stderr is success. Surface captured output only when present.
    output = redact((res.stdout + res.stderr).strip() or None, [secret])
    return ToolResult(state=RunState.OK, summary=f"sent shutdown command to {host.name}", output=output)
