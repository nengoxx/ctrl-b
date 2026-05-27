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

#: Per-OS shutdown command. Windows mirrors the live `wol_server_win.py`. POSIX uses `sudo -S`
#: (read the password from stdin, `-p ''` silences the prompt) because an SSH exec channel has no
#: TTY for an interactive sudo prompt — the SSH password is fed in as the sudo password.
_SHUTDOWN_CMD: dict[OSType, str] = {
    OSType.WINDOWS: "shutdown /s /f /t 0",
    OSType.LINUX: "sudo -S -p '' shutdown now",
    OSType.MACOS: "sudo -S -p '' shutdown -h now",
}

#: Markers that mean sudo never ran the command (auth/TTY problem) — so a clean connect isn't
#: success. Lowercased substring match against the captured output.
_SUDO_FAILED = (
    "incorrect password",
    "sorry, try again",
    "a terminal is required",
    "interactive authentication is required",
    "authentication failure",
    "is not in the sudoers",
)


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
        # POSIX shutdown runs under `sudo -S`; feed the SSH password as the sudo password.
        stdin_data=secret if host.os_type != OSType.WINDOWS else None,
    )

    if not res.ok:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to shut down {host.name}",
            error=redact(res.error, [secret]),
        )
    # sudo can connect cleanly yet refuse to run (wrong password / no passwordless sudo / no TTY).
    # Catch that explicitly so we don't report a shutdown that never happened.
    combined = (res.stdout + res.stderr).lower()
    if any(marker in combined for marker in _SUDO_FAILED):
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to shut down {host.name}",
            error="sudo could not authenticate — the SSH password must also be the sudo password, "
            "or grant passwordless sudo for shutdown on this host",
        )
    # A successful shutdown often drops the connection mid-command; a clean connect with no sudo
    # error is success. Surface captured output only when present.
    output = redact((res.stdout + res.stderr).strip() or None, [secret])
    return ToolResult(state=RunState.OK, summary=f"sent shutdown command to {host.name}", output=output)
