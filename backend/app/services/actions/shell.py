"""run_shell — a guarded shell command on the **backend host** (Phase 5, the `!` escape hatch).

This is the *local* sibling of `terminal.py`'s `terminal_exec` (which runs on a *remote* box over
REST). It runs on the machine hosting ctrl-b (corsair/emma) via `asyncio.create_subprocess_exec`
through a per-OS shell — the one legitimate server-OS branch (mirroring `fleet._ping_cmd`).

Two callers share the one exec core (`_run`), and BOTH are gated at the `ActionService.invoke`
chokepoint by `permissions.run_shell_gate`, keyed on the ACTOR (never the privilege — ISS-87);
`shell.enabled` closes it for everyone, before any confirm bubble (ISS-102):
  • the agent's `run_shell` tool (this `@action`; any non-USER actor) ← `shell.agent_exec_enabled` —
    off by default + HIGH risk, so the agent only gets it on an explicit opt-in and confirms each call
    below FULL privilege (FULL runs unasked);
  • the user `!<cmd>` path (`POST /api/exec`), which invokes this same action as `Actor.USER` at
    `privilege=FULL` ← `shell.user_exec_enabled` — the user typing `!` *is* the authorization; the
    endpoint's up-front check is UX, the chokepoint is the guarantee.

Output is redacted (config secret values masked) + truncated, and every run is audited as an Event
by `ActionService._record` (the egress funnel, which redacts the whole result once more). cwd defaults
to `$CTRLB_HOME`; the process is killed on timeout.
"""

from __future__ import annotations

import platform

from pydantic import BaseModel, Field

from app.core.proc import run_capture
from app.core.redact import clip, redact
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult


class ShellInput(BaseModel):
    command: str = Field(
        ...,
        description="Shell command to run on the backend host. Supports pipes, &&, ||, ; and "
        "redirections (run through the host's shell).",
    )


def _shell_argv(command: str) -> list[str]:
    """The shell binary + flags to run `command` as one command line. Per-OS — a legitimate
    server-OS branch (the host running ctrl-b), like `fleet._ping_cmd`."""
    if platform.system().lower() == "windows":
        return ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
    return ["bash", "-lc", command]


async def _run(command: str, ctx: InvocationContext) -> ToolResult:
    """The shared exec core. Never raises — any failure normalizes into a ToolResult."""
    deps = ctx.require_deps()
    cfg = deps.settings.shell
    cwd = cfg.workdir.strip() or str(deps.settings.home_dir())
    try:
        cap = await run_capture(_shell_argv(command), timeout_s=cfg.timeout_s, cwd=cwd)
    except (OSError, ValueError) as exc:  # shell binary missing / bad cwd
        return ToolResult(state=RunState.ERROR, summary=f"$ {command} — could not start", error=str(exc))

    if cap.timed_out:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"$ {command} — killed after {cfg.timeout_s:g}s",
            error="timed out",
            data={"timed_out": True},
        )

    output = redact(cap.output, deps.settings.secret_values()) or ""
    output = clip(output.strip(), cfg.max_output_chars)
    code = cap.code
    data = {"exit_code": code}
    if code == 0:
        return ToolResult(state=RunState.OK, summary=f"$ {command} — exit 0", output=output, data=data)
    return ToolResult(
        state=RunState.ERROR,
        summary=f"$ {command} — exit {code}",
        output=output,
        error=f"command exited {code}",
        data=data,
    )


@action(
    "run_shell",
    title="Run shell",
    icon="terminal",
    category="action",
    risk=Risk.HIGH,
    confirm=True,  # R1/D44: designer forced-confirm — un-approvable; behavior-neutral (decide treats HIGH ≡ confirm below FULL)
    ui_exposed=False,
    agent_exposed=True,
)
async def run_shell(inp: ShellInput, ctx: InvocationContext) -> ToolResult:
    """Run a shell command on the host running ctrl-b and return its combined stdout/stderr + exit
    code. Local to the backend box (use the terminal tools for a remote host). Arbitrary shell —
    gated by policy; the owner confirms unless explicitly granted."""
    return await _run(inp.command, ctx)
