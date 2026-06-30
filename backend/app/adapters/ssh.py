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

import paramiko


@dataclass
class SshResult:
    ok: bool
    stdout: str = ""
    stderr: str = ""
    error: str | None = None  # connection-level failure (auth / unreachable / timeout)


def run_command(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    command: str,
    timeout: float = 10.0,
    stdin_data: str | None = None,
) -> SshResult:
    """Run `command` over SSH. `stdin_data`, when set, is written to the command's stdin then the
    write side is closed — used to feed a password to `sudo -S` (no TTY on an exec channel). It's
    treated as a secret: never logged, scrubbed from output by the caller's `redact`."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            host,
            port=port,
            username=username,
            password=password,
            timeout=timeout,
            allow_agent=False,
            look_for_keys=False,
        )
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
        return SshResult(ok=False, error="authentication failed — check username/password")
    except paramiko.SSHException as exc:
        return SshResult(ok=False, error=f"SSH error: {exc}")
    except OSError as exc:  # socket errors: unreachable / timeout / DNS
        return SshResult(ok=False, error=str(exc))
    finally:
        client.close()
