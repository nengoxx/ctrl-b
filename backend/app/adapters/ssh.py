"""SSH command execution over paramiko — mirrors the live `wol_server_win.py` flow.

Blocking (paramiko is sync); call `run_command` via `asyncio.to_thread`. Outcomes are returned
as a typed `SshResult` rather than raised, so the action layer can render a clean ToolResult for
auth failures / unreachable hosts (DESIGN.md §11, §15). The password is taken as a plain `str`
here (the caller unwraps the `SecretStr` at the edge) and is never logged or returned.

Phase 2 uses `AutoAddPolicy` to match the current server's behavior; known_hosts pinning is a
tracked post-v1 hardening item (ROADMAP G).
"""

from __future__ import annotations

import time
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
    #: Failover taxonomy (set from the exception CLASS + connect PHASE, never string-sniffed): "ok" ·
    #: "auth" (bad credentials, terminal) · "connect" (PRE-connect socket/banner failure — the failover
    #: class, try the next address) · "ssh" = every TERMINAL non-auth outcome: a pre-exec protocol error,
    #: a POST-connect failure (read timeout / channel death / exhausted exec budget), OR "connected but
    #: not executed" (handshake ate the budget) — none of which may be retried on another address.
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
    exec_cutoff_s: float | None = None,
    exec_budget_s: float | None = None,
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

    `exec_cutoff_s` (D47 verify-2) is the MEASURED no-late-execution guarantee: seconds FROM THIS
    CALL'S ENTRY after which the command must NOT begin. Because auth is deliberately unbounded, no
    static pre-reservation can prove an exec window remains — so we MEASURE elapsed time (connect +
    banner + auth) and, if it has already overrun `exec_cutoff_s` once connected, we return WITHOUT
    calling `exec_command`. The command NEVER starts unless a full exec window is left, no matter how
    long the handshake took. This is what the caller's failover pre-gate cannot provide, and it also
    closes the pre-existing single-candidate overrun (even a lone attempt can't launch an exec it
    can't finish inside the backstop). Not executing ⇒ terminal `kind="ssh"` (no failover: by
    construction there is no budget for another candidate either).

    `exec_budget_s` (D47 round 3) is the TOTAL exec-phase budget. `exec_command(timeout=…)` sets only a
    PER-blocking-op channel timeout; our exec phase is SEQUENTIAL (stdin write/flush, stdout.read,
    stderr.read), so it could legally burn ~3× that per-op value. Instead we anchor ONE exec deadline
    on the same `t0` clock and re-slice the shared channel's timeout before each op, bounding the whole
    phase to `exec_budget_s` (±one op's granularity). `None` ⇒ old per-op behavior.

    The connect/exec split is load-bearing for D47 failover: only a PRE-connect failure is the
    retryable `connect` class — a POST-connect error (a `socket.timeout` reading a slow-but-connected
    command's output, or a mid-command SSHException) is classified `ssh`, NEVER `connect`, so the
    failover loop can't re-execute a command that may already be running (a double-restart footgun)."""
    t0 = time.monotonic()  # measured from call entry — the exec-cutoff clock (spans connect+banner+auth)
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
        if exec_cutoff_s is not None and time.monotonic() - t0 > exec_cutoff_s:
            # Connected, but the handshake (unbounded auth) ate the window — do NOT start the command.
            # Nothing was executed (the point); `finally` still closes the client. Terminal, no retry.
            return SshResult(
                ok=False,
                kind="ssh",
                error="connected, but too little time remained in the action budget to run the "
                "command safely — not executed",
            )
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        chan = stdout.channel  # paramiko shares ONE channel across stdin/stdout/stderr
        # Total exec-phase deadline on the t0 clock: from the cutoff point (t0+exec_cutoff_s), or from
        # now if no cutoff was given. `None` ⇒ leave exec_command's per-op `timeout` untouched (old behavior).
        exec_deadline: float | None = None
        if exec_budget_s is not None:
            base = (t0 + exec_cutoff_s) if exec_cutoff_s is not None else time.monotonic()
            exec_deadline = base + exec_budget_s

        def _reslice() -> None:
            """Bound the NEXT blocking channel op by the remaining slice of the total exec budget."""
            if exec_deadline is not None:
                chan.settimeout(max(0.1, exec_deadline - time.monotonic()))

        if stdin_data is not None:
            _reslice()
            try:
                stdin.write(stdin_data if stdin_data.endswith("\n") else stdin_data + "\n")
                stdin.flush()
                stdin.channel.shutdown_write()
            except OSError:
                pass  # channel already closing (e.g. the command exited fast) — read what we got
        _reslice()
        out = stdout.read().decode(errors="replace")
        _reslice()
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
