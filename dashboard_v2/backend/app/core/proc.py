"""Run a subprocess and capture its combined output, with a kill-on-timeout.

The shared exec core behind host-management actions that shell out to a binary — `run_shell`
(`services/actions/shell.py`, via a shell) and the Tailscale Serve actions (`services/actions/
tailscale.py`, the `tailscale` binary directly, no shell). Extracted so the subprocess + timeout +
kill-and-reap boilerplate lives in one place (DECISIONS D20). Redaction/truncation stays with the
caller (each builds its own `ToolResult` with the right summary)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class Capture:
    """Outcome of `run_capture`. `code` is the process exit code (None if killed on timeout);
    `output` is decoded, combined stdout+stderr; `timed_out` flags the kill path."""

    code: int | None
    output: str
    timed_out: bool


async def run_capture(argv: list[str], *, timeout_s: float, cwd: str | None = None) -> Capture:
    """Exec `argv` (no shell), capturing combined stdout+stderr; kill + reap on timeout. Raises
    `OSError`/`ValueError` only if the process can't *start* (binary missing / bad cwd) — the caller
    decides how to surface that. A non-zero exit is a normal `Capture`, not an exception."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()  # reap the killed process
        return Capture(code=None, output="", timed_out=True)
    return Capture(code=proc.returncode, output=out_bytes.decode("utf-8", "replace"), timed_out=False)
