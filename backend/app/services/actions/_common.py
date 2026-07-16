"""Shared inputs + helpers for the built-in actions.

`HostTargetInput` targets a host (wake/shutdown/ping); `ServiceTargetInput` targets a service
(start/stop/restart/open). `run_service_command` is the one place the service-control actions
resolve a service → its host → the per-OS command and run it over SSH, so the three control
actions stay one tiny file each (DESIGN.md §3) while sharing the lookup/redaction logic.
"""

from __future__ import annotations

import asyncio
import re

from pydantic import BaseModel, Field

from app.adapters import ssh
from app.core.redact import redact
from app.core.tool import InvocationContext
from app.domain.enums import OSType, RunState
from app.domain.result import ToolResult

#: The `ActionService`-level backstop deadline for every SSH-backed fleet action (reboot/shutdown +
#: the service start/stop/restart controls). paramiko's own `timeout=10` (ssh.py) covers TCP connect
#: + channel reads but NOT `getaddrinfo` — a host row with an unresolvable name can wedge the
#: `asyncio.to_thread` resolve for the platform's DNS timeout (tens of seconds), which no adapter
#: bound catches. This wraps the whole `to_thread(ssh.run_command, …)` call: paramiko's 10 s
#: (connect + read) + a DNS worst case + margin → 30 s. One shared constant so the five actions stay
#: consistent; config-overridability arrives later as an additive ToolOverride field (ROADMAP E0a) —
#: do NOT add a parallel config map now.
SSH_ACTION_TIMEOUT_S = 30.0

#: A bare `sudo` not already in stdin mode (`-S`), and not part of a longer word. Rewritten so an
#: SSH exec (no TTY) can authenticate sudo by piping the password to stdin (same trick as
#: shutdown_host). On a multi-sudo command only the first consumes the piped password; the rest
#: reuse sudo's cached credential within the session.
_SUDO_RE = re.compile(r"(?<![\w-])sudo(?!\s+-S\b)\b")

#: Markers that mean sudo refused to run (auth/TTY/not-a-sudoer) — a clean connect isn't success.
_SUDO_FAILED = (
    "incorrect password",
    "sorry, try again",
    "a terminal is required",
    "interactive authentication is required",
    "authentication failure",
    "is not in the sudoers",
)


def _prepare_sudo(command: str) -> tuple[str, bool]:
    """If `command` uses sudo, switch it to non-interactive stdin auth and signal the caller to
    pipe the password. Idempotent — an explicit `sudo -S` is left untouched. POSIX only (the
    caller skips this for Windows, where sudo has no `-S`)."""
    if "sudo" not in command:
        return command, False
    return _SUDO_RE.sub("sudo -S -p ''", command), True


class HostTargetInput(BaseModel):
    """Host-targeted fleet actions (wake/shutdown/ping)."""

    host_id: str = Field(description="Stable slug id of the target host (GET /api/hosts → id)")


class ServiceTargetInput(BaseModel):
    """Service-targeted actions (start/stop/restart/open)."""

    service_id: str = Field(description="Stable slug id of the target service (GET /api/services → id)")


async def run_service_command(
    action: str, verb: str, inp: ServiceTargetInput, ctx: InvocationContext
) -> ToolResult:
    """Resolve the service + its host, run the per-OS `action` command over SSH, return a result.

    `action` is the `cmd` key (`start`/`stop`/`restart`); `verb` is the human phrasing for
    summaries ("started"). Missing service/host/command/credentials each surface as a clean
    DENIED/ERROR result — never an exception. The host password is redacted from any output.
    """
    deps = ctx.require_deps()
    svc = deps.services.service(inp.service_id)
    if svc is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown service '{inp.service_id}'")
    host = deps.fleet.host(svc.host_id)
    if host is None:
        return ToolResult(state=RunState.ERROR, summary=f"service '{svc.name}' references unknown host")

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
    # POSIX: rewrite `sudo` → `sudo -S` and feed the SSH password as the sudo password (no TTY on
    # an exec channel). Windows commands run as-is (its sudo has no `-S`).
    run_cmd, pipe_pw = (command, False)
    if host.os_type != OSType.WINDOWS:
        run_cmd, pipe_pw = _prepare_sudo(command)
    res = await asyncio.to_thread(
        ssh.run_command,
        host=host.ip,
        port=host.ssh_port,
        username=host.ssh_username,
        password=secret,
        command=run_cmd,
        stdin_data=secret if pipe_pw else None,
    )
    if not res.ok:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to {action} {svc.name}",
            error=redact(res.error, [secret]),
        )
    combined = (res.stdout + res.stderr).lower()
    if pipe_pw and any(marker in combined for marker in _SUDO_FAILED):
        return ToolResult(
            state=RunState.ERROR,
            summary=f"failed to {action} {svc.name}",
            error="sudo could not authenticate — the SSH password must also be the sudo password, "
            "or grant passwordless sudo for this command on the host",
        )
    output = redact((res.stdout + res.stderr).strip() or None, [secret])
    return ToolResult(state=RunState.OK, summary=f"{verb} {svc.name} on {host.name}", output=output)
