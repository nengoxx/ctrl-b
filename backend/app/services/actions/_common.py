"""Shared inputs + helpers for the built-in actions.

`HostTargetInput` targets a host (wake/shutdown/ping); `ServiceTargetInput` targets a service
(start/stop/restart/open). `run_service_command` is the one place the service-control actions
resolve a service → its host → the per-OS command and run it over SSH, so the three control
actions stay one tiny file each (DESIGN.md §3) while sharing the lookup/redaction logic.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable

from pydantic import BaseModel, Field

from app.adapters import ssh
from app.adapters.ssh import SshResult
from app.core.redact import redact
from app.core.tool import InvocationContext
from app.domain.enums import OSType, RunState
from app.domain.host import Host, host_addresses
from app.domain.result import ToolResult

log = logging.getLogger(__name__)

#: The `ActionService`-level backstop deadline for every SSH-backed fleet action (reboot/shutdown +
#: the service start/stop/restart controls). paramiko's own `timeout=10` (ssh.py) covers TCP connect
#: + channel reads but NOT `getaddrinfo` — a host row with an unresolvable name can wedge the
#: `asyncio.to_thread` resolve for the platform's DNS timeout (tens of seconds), which no adapter
#: bound catches. This wraps the whole `to_thread(ssh.run_command, …)` call: paramiko's 10 s
#: (connect + read) + a DNS worst case + margin → 30 s. One shared constant so the five actions stay
#: consistent; config-overridability arrives later as an additive ToolOverride field (ROADMAP E0a) —
#: do NOT add a parallel config map now.
SSH_ACTION_TIMEOUT_S = 30.0

#: Per-candidate SSH CONNECT-phase deadline for the D47 failover loop — distinct from and NESTED
#: inside the 30 s whole-call `SSH_ACTION_TIMEOUT_S` backstop. Passed as `run_command`'s
#: `connect_timeout`, so it bounds ONLY the TCP connect, leaving the exec/channel-read phase on
#: `run_command`'s own 10 s `timeout` (a slow-but-connected command must not be cut off or re-run).
#: Kept SHORT so failover stays snappy: 6 s is generous for a TCP connect on both the LAN and the
#: overlay (each measured ~0–1 ms, ROADMAP D3) yet ≤ paramiko's 10 s default. Worst real case fits
#: the 30 s backstop: 6 s failed connect + 6 s connect + 10 s exec ≈ 22 s (a post-connect failure
#: never triggers a second candidate, so at most one exec phase runs).
SSH_CONNECT_TIMEOUT_S = 6.0

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


async def run_ssh_failover(host: Host, run: Callable[[str, float], SshResult]) -> SshResult:
    """Run one SSH operation against a multi-homed host with ordered connect-failover (D47).

    Iterates `host_addresses(host, host.ssh_prefer_vpn)` (the single LAN>VPN source of truth),
    invoking `run(address, SSH_CONNECT_TIMEOUT_S)` per candidate on a worker thread (SYS-16: never
    block the event loop with paramiko) — the callable's second arg is the CONNECT-phase timeout it
    forwards as `run_command`'s `connect_timeout`. Advances to the next address ONLY on
    `kind == "connect"` (a PRE-connect socket error — the timeout/refused/DNS failover class); an
    `ok`/`auth`/`ssh` result returns immediately (connected + wrong password, or a post-connect read
    failure, is a real error the command may already have run — never a retry). The last candidate's
    result returns as-is, whatever it is. The whole loop runs INSIDE the 30 s `SSH_ACTION_TIMEOUT_S`
    action backstop, so the per-candidate connect timeout is deliberately short enough to fit.

    This is the ONE failover implementation — the three SSH call sites (service control here, plus
    shutdown/reboot) route through it, so address resolution + failover semantics are identical
    everywhere with zero triplication.
    """
    addresses = host_addresses(host, host.ssh_prefer_vpn)
    last = len(addresses) - 1
    for i, address in enumerate(addresses):
        res = await asyncio.to_thread(run, address, SSH_CONNECT_TIMEOUT_S)
        if res.kind != "connect" or i == last:
            return res
        log.info("ssh connect-failover for %s: %s → %s", host.name, address, addresses[i + 1])
    # `ip` is required so `host_addresses` never returns [] in practice — this only guards the
    # type checker (and a degenerate blank-ip config) against the empty-candidate case.
    return SshResult(ok=False, error="no reachable address configured", kind="connect")


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
    username = host.ssh_username  # narrowed to str by the guard above; bound for the closure
    # POSIX: rewrite `sudo` → `sudo -S` and feed the SSH password as the sudo password (no TTY on
    # an exec channel). Windows commands run as-is (its sudo has no `-S`).
    run_cmd, pipe_pw = (command, False)
    if host.os_type != OSType.WINDOWS:
        run_cmd, pipe_pw = _prepare_sudo(command)
    res = await run_ssh_failover(
        host,
        lambda address, connect_timeout: ssh.run_command(
            host=address,
            port=host.ssh_port,
            username=username,
            password=secret,
            command=run_cmd,
            connect_timeout=connect_timeout,  # exec/read keeps run_command's own 10s timeout
            stdin_data=secret if pipe_pw else None,
        ),
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
