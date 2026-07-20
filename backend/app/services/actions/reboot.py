"""reboot_host — SSH a per-OS reboot command (HIGH risk, confirm-gated).

The restart sibling of `shutdown_host` — same OS-agnostic shape, SSH path, sudo-over-stdin trick,
redaction, and sudo-auth-failure detection. Missing SSH credentials → DENIED. The command and any
echoed output are redacted against the host password before they touch a ToolResult/Event.
"""

from __future__ import annotations

from app.adapters import ssh
from app.core.redact import redact
from app.core.tool import InvocationContext, action
from app.domain.enums import OSType, Risk, RunState
from app.domain.result import ToolResult
from app.services.actions._common import SSH_ACTION_TIMEOUT_S, HostTargetInput, run_ssh_failover

#: Per-OS reboot command. Windows mirrors the shutdown action with `/r` (restart). POSIX uses
#: `sudo -S -p ''` (password from stdin, prompt silenced) because an SSH exec channel has no TTY.
_REBOOT_CMD: dict[OSType, str] = {
    OSType.WINDOWS: "shutdown /r /f /t 0",
    OSType.LINUX: "sudo -S -p '' shutdown -r now",
    OSType.MACOS: "sudo -S -p '' shutdown -r now",
}

#: Markers that mean sudo never ran the command (auth/TTY problem) — a clean connect isn't success.
_SUDO_FAILED = (
    "incorrect password",
    "sorry, try again",
    "a terminal is required",
    "interactive authentication is required",
    "authentication failure",
    "is not in the sudoers",
)


@action(
    "reboot_host",
    title="Reboot",
    icon="rotate-ccw",
    risk=Risk.HIGH,
    confirm=True,
    timeout_s=SSH_ACTION_TIMEOUT_S,  # backstop: paramiko's timeout doesn't cover getaddrinfo (DNS)
)
async def reboot_host(inp: HostTargetInput, ctx: InvocationContext) -> ToolResult:
    """Reboot a host over SSH (per-OS command; requires configured SSH credentials)."""
    host = ctx.require_deps().fleet.host(inp.host_id)
    if host is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown host '{inp.host_id}'")
    if not host.ssh_username or host.ssh_password is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no SSH credentials configured for {host.name} — cannot reboot",
        )

    command = _REBOOT_CMD.get(host.os_type)
    if command is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no reboot command defined for {host.os_type.value} hosts",
        )
    secret = host.ssh_password.get_secret_value()
    username = host.ssh_username  # narrowed to str by the guard above; bound for the closure
    # POSIX reboot runs under `sudo -S`; feed the SSH password as the sudo password.
    stdin_data = secret if host.os_type != OSType.WINDOWS else None
    res = await run_ssh_failover(  # ordered LAN>VPN candidates + connect-failover (D47)
        host,
        lambda address, connect_timeout: ssh.run_command(
            host=address,
            port=host.ssh_port,
            username=username,
            password=secret,
            command=command,
            connect_timeout=connect_timeout,  # exec/read keeps run_command's own 10s timeout
            stdin_data=stdin_data,
        ),
    )

    if not res.ok:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to reboot {host.name}",
            error=redact(res.error, [secret]),
        )
    combined = (res.stdout + res.stderr).lower()
    if any(marker in combined for marker in _SUDO_FAILED):
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to reboot {host.name}",
            error="sudo could not authenticate — the SSH password must also be the sudo password, "
            "or grant passwordless sudo for shutdown/reboot on this host",
        )
    # A reboot drops the SSH connection mid-command; a clean connect with no sudo error is success.
    output = redact((res.stdout + res.stderr).strip() or None, [secret])
    return ToolResult(state=RunState.OK, summary=f"sent reboot command to {host.name}", output=output)
