"""SSH command execution over paramiko — mirrors the live `wol_server_win.py` flow.

Blocking (paramiko is sync); call `run_command` via `asyncio.to_thread`. Outcomes are returned
as a typed `SshResult` rather than raised, so the action layer can render a clean ToolResult for
auth failures / unreachable hosts (DESIGN.md §11, §15). The password is taken as a plain `str`
here (the caller unwraps the `SecretStr` at the edge) and is never logged or returned.

Phase 2 uses `AutoAddPolicy` to match the current server's behavior; known_hosts pinning is a
tracked post-v1 hardening item (ROADMAP G).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import paramiko


@dataclass
class SshResult:
    """Never-raises outcome of one SSH attempt. `kind` is the failure CATEGORY (from the exception
    CLASS, never string-sniffed) the D47 failover loop dispatches on: "ok" on success · "auth" (bad
    credentials — a REAL error, never retried) · "connect" (the failover class: timeout / refused /
    DNS failure / no-route — advance to the next address) · "ssh" (a protocol-level SSHException)."""

    ok: bool
    stdout: str = ""
    stderr: str = ""
    error: str | None = None  # connection-level failure (auth / unreachable / timeout)
    kind: Literal["ok", "auth", "connect", "ssh"] = "ok"


def run_command(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    command: str,
    timeout: float = 10.0,
    connect_timeout: float | None = None,
    stdin_data: str | None = None,
) -> SshResult:
    """Run `command` over SSH. `stdin_data`, when set, is written to the command's stdin then the
    write side is closed — used to feed a password to `sudo -S` (no TTY on an exec channel). It's
    treated as a secret: never logged, scrubbed from output by the caller's `redact`.

    `timeout` bounds the exec/channel-read PHASE; `connect_timeout` (None ⇒ reuse `timeout`) bounds
    ONLY the connect PHASE — both the TCP connect AND the SSH protocol-banner read (paramiko's own
    `banner_timeout` defaults to 15 s, which would blow a short connect budget, so we pin it to the
    connect timeout). `auth_timeout` is deliberately left at paramiko's default: a slow-but-succeeding
    auth must not be aborted at the short connect budget — it stays bounded by the caller's backstop.

    The connect/exec split is load-bearing for D47 failover: only a PRE-connect failure is the
    retryable `connect` class — a POST-connect error (a `socket.timeout` reading a slow-but-connected
    command's output, or a mid-command SSHException) is classified `ssh`, NEVER `connect`, so the
    failover loop can't re-execute a command that may already be running (a double-restart footgun)."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_t = connect_timeout if connect_timeout is not None else timeout
    connected = False
    try:
        client.connect(
            host,
            port=port,
            username=username,
            password=password,
            timeout=connect_t,
            banner_timeout=connect_t,  # else paramiko's 15s banner read outlives a short connect budget
            allow_agent=False,
            look_for_keys=False,
        )
        connected = True  # past this line every failure is post-connect (exec/read), not the failover class
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        if stdin_data is not None:
            try:
                stdin.write(stdin_data if stdin_data.endswith("\n") else stdin_data + "\n")
                stdin.flush()
                stdin.channel.shutdown_write()
            except OSError:
                pass  # channel already closing (e.g. the command exited fast) — read what we got
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        return SshResult(ok=True, stdout=out, stderr=err)
    except paramiko.AuthenticationException:
        # MUST stay above SSHException — AuthenticationException subclasses it. Auth is never a
        # failover trigger (connected + wrong password is a real error, not a next-address retry).
        return SshResult(ok=False, error="authentication failed — check username/password", kind="auth")
    except paramiko.SSHException as exc:
        # PHASE rule (D47): a PRE-connect SSHException is a PATH problem worth the other address —
        # paramiko 5.x wraps a banner-read timeout as `SSHException("Error reading SSH protocol
        # banner…")`, and negotiation failures land here too. A POST-connect SSHException (channel
        # died mid-command) is terminal — the command may already have run, so never re-execute.
        return SshResult(ok=False, error=f"SSH error: {exc}", kind="ssh" if connected else "connect")
    except OSError as exc:
        # Same phase rule: only a PRE-connect socket error is the retryable failover class —
        # unreachable / refused / timeout / DNS (gaierror) / NoValidConnectionsError all subclass
        # OSError. A POST-connect OSError (a `socket.timeout` during the exec/read phase of a
        # slow-but-connected command) must NOT re-execute elsewhere → classify it `ssh`, not `connect`.
        return SshResult(ok=False, error=str(exc), kind="connect" if not connected else "ssh")
    finally:
        client.close()
