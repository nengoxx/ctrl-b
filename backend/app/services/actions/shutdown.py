"""shutdown_host — SSH a per-OS shutdown command (HIGH risk, confirm-gated).

Missing SSH credentials → DENIED (surfaced, not a crash). Connection/auth failures come back as a
typed ERROR from the SSH adapter. The command and any echoed output are redacted against the host
password before they touch a ToolResult/Event — the password never leaves the adapter call.
"""

from __future__ import annotations

from app.adapters import ssh
from app.core.redact import redact
from app.core.tool import InvocationContext, action
from app.domain.enums import OSType, Risk, RunState
from app.domain.result import ToolResult
from app.services.actions._common import (
    SSH_ACTION_TIMEOUT_S,
    SSH_EXEC_TIMEOUT_S,
    HostTargetInput,
    run_ssh_failover,
)

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


@action(
    "shutdown_host",
    title="Shut down",
    icon="power",
    risk=Risk.HIGH,
    confirm=True,
    idempotent=True,
    timeout_s=SSH_ACTION_TIMEOUT_S,  # backstop: paramiko's timeout doesn't cover getaddrinfo (DNS)
)
async def shutdown_host(inp: HostTargetInput, ctx: InvocationContext) -> ToolResult:
    """Shut down a host over SSH (per-OS command; requires configured SSH credentials)."""
    host = ctx.require_deps().fleet.host(inp.host_id)
    if host is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown host '{inp.host_id}'")
    if not host.ssh_username or host.ssh_password is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no SSH credentials configured for {host.name} — cannot shut down",
        )

    command = _SHUTDOWN_CMD.get(host.os_type)
    if command is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"no shutdown command defined for {host.os_type.value} hosts",
        )
    secret = host.ssh_password.get_secret_value()
    username = host.ssh_username  # narrowed to str by the guard above; bound for the closure
    # POSIX shutdown runs under `sudo -S`; feed the SSH password as the sudo password.
    stdin_data = secret if host.os_type != OSType.WINDOWS else None
    res = await run_ssh_failover(  # ordered LAN>VPN candidates + connect-failover (D47)
        host,
        lambda address, connect_timeout: ssh.run_command(
            host=address,
            port=host.ssh_port,
            username=username,
            password=secret,
            command=command,
            connect_timeout=connect_timeout,  # short per-candidate connect budget
            timeout=SSH_EXEC_TIMEOUT_S,  # exec/read phase (explicit — the loop's deadline gate uses it)
            stdin_data=stdin_data,
        ),
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
