"""open-terminal actions (Phase 4f) — a curated set of typed tools over open-webui/open-terminal's
REST API: a remote shell (`terminal_exec`) + file ops (read/list/grep/glob/write). The agent gets a
real shell on the terminal host — the remote analog of the planned Phase-5 guarded `run_shell`.

Unlike the built-in fleet actions (which `@action`-register at import with a literal risk), these
register **dynamically** via `register_openterminal(registry, cfg)` so the risk per operation comes
from config: reads default LOW (auto-run) while `exec` and writes default HIGH (the agent confirms,
since this is arbitrary remote shell). All reach the client via `ctx.deps.open_terminal`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.adapters.openterminal import OpenTerminalError
from app.core.tool import FunctionTool, InvocationContext, ToolSpec
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult

if TYPE_CHECKING:
    from app.config import OpenTerminalCfg
    from app.core.tool import ToolRegistry

_RISK = {"low": Risk.LOW, "med": Risk.MED, "high": Risk.HIGH}
_MAX_OUTPUT_CHARS = 6000


def _client(ctx: InvocationContext):
    return getattr(ctx.deps, "open_terminal", None) if ctx.deps else None


def _unconfigured() -> ToolResult:
    return ToolResult(
        state=RunState.DENIED,
        summary="open-terminal is not configured (set open_terminal.base_url + api_key in config)",
    )


def _clip(text: str | None) -> str | None:
    if text and len(text) > _MAX_OUTPUT_CHARS:
        return text[:_MAX_OUTPUT_CHARS] + "\n… [truncated]"
    return text


# ── input models ──────────────────────────────────────────────────────────────────────────────
class TerminalExecInput(BaseModel):
    command: str = Field(
        ..., description="Shell command to run on the terminal host. Supports &&, ||, ;, pipes, redirections."
    )
    cwd: str | None = Field(None, description="Working directory; defaults to the server's workspace.")


class TerminalReadInput(BaseModel):
    path: str = Field(..., description="File path to read on the terminal host.")
    start_line: int | None = Field(None, description="1-based first line to read (optional).")
    end_line: int | None = Field(None, description="1-based last line to read (optional).")


class TerminalListInput(BaseModel):
    directory: str | None = Field(None, description="Directory to list; defaults to the workspace.")


class TerminalGrepInput(BaseModel):
    query: str = Field(..., description="Text or regex to search for in file contents.")
    path: str | None = Field(None, description="Directory or file to search under (optional).")
    regex: bool | None = Field(None, description="Treat `query` as a regex.")
    case_insensitive: bool | None = None
    include: str | None = Field(None, description="Only search files matching this glob, e.g. '*.py'.")
    max_results: int | None = None


class TerminalGlobInput(BaseModel):
    pattern: str = Field(..., description="Glob pattern to match file paths, e.g. '**/*.md'.")
    path: str | None = Field(None, description="Base directory to search (optional).")
    max_results: int | None = None


class TerminalWriteInput(BaseModel):
    path: str = Field(..., description="File path to write on the terminal host (created/overwritten).")
    content: str = Field(..., description="Full file content to write.")


# ── handlers ──────────────────────────────────────────────────────────────────────────────────
def _render_exec(res: dict) -> str:
    parts = res.get("output") or []
    return "".join(p.get("data", "") for p in parts if isinstance(p, dict)).strip()


async def terminal_exec(inp: TerminalExecInput, ctx: InvocationContext) -> ToolResult:
    client = _client(ctx)
    if client is None or not client.configured:
        return _unconfigured()
    try:
        res = await client.execute(inp.command, cwd=inp.cwd)
    except OpenTerminalError as exc:
        return ToolResult(state=RunState.ERROR, summary="terminal exec failed", error=str(exc)[:300])
    output = _clip(_render_exec(res))
    status, code = res.get("status"), res.get("exit_code")
    data = {"id": res.get("id"), "status": status, "exit_code": code}
    if status == "running":
        return ToolResult(
            state=RunState.OK,
            summary=f"still running (id={res.get('id')}) — wait window elapsed",
            output=output,
            data=data,
        )
    if code == 0:
        return ToolResult(state=RunState.OK, summary=f"$ {inp.command} — exit 0", output=output, data=data)
    return ToolResult(
        state=RunState.ERROR,
        summary=f"$ {inp.command} — exit {code}",
        output=output,
        error=f"command exited {code}",
        data=data,
    )


async def terminal_read_file(inp: TerminalReadInput, ctx: InvocationContext) -> ToolResult:
    client = _client(ctx)
    if client is None or not client.configured:
        return _unconfigured()
    try:
        res = await client.read_file(inp.path, start_line=inp.start_line, end_line=inp.end_line)
    except OpenTerminalError as exc:
        return ToolResult(state=RunState.ERROR, summary=f"could not read {inp.path}", error=str(exc)[:300])
    content = res.get("content") if isinstance(res, dict) else None
    return ToolResult(state=RunState.OK, summary=f"read {inp.path}", output=_clip(content), data=res if isinstance(res, dict) else {})


async def terminal_list(inp: TerminalListInput, ctx: InvocationContext) -> ToolResult:
    client = _client(ctx)
    if client is None or not client.configured:
        return _unconfigured()
    try:
        res = await client.list_dir(inp.directory)
    except OpenTerminalError as exc:
        return ToolResult(state=RunState.ERROR, summary="could not list directory", error=str(exc)[:300])
    entries = res.get("entries", []) if isinstance(res, dict) else []
    listing = "\n".join(f"{e.get('type','?')[:1]} {e.get('name')}" for e in entries)
    return ToolResult(
        state=RunState.OK, summary=f"{res.get('dir', inp.directory or '.')} · {len(entries)} entries",
        output=_clip(listing), data=res if isinstance(res, dict) else {},
    )


async def terminal_grep(inp: TerminalGrepInput, ctx: InvocationContext) -> ToolResult:
    client = _client(ctx)
    if client is None or not client.configured:
        return _unconfigured()
    try:
        res = await client.grep(
            inp.query, path=inp.path, regex=inp.regex, case_insensitive=inp.case_insensitive,
            include=inp.include, max_results=inp.max_results,
        )
    except OpenTerminalError as exc:
        return ToolResult(state=RunState.ERROR, summary="grep failed", error=str(exc)[:300])
    import json as _json
    return ToolResult(state=RunState.OK, summary=f"grep '{inp.query}'", output=_clip(_json.dumps(res, indent=1)), data=res if isinstance(res, dict) else {})


async def terminal_glob(inp: TerminalGlobInput, ctx: InvocationContext) -> ToolResult:
    client = _client(ctx)
    if client is None or not client.configured:
        return _unconfigured()
    try:
        res = await client.glob(inp.pattern, path=inp.path, max_results=inp.max_results)
    except OpenTerminalError as exc:
        return ToolResult(state=RunState.ERROR, summary="glob failed", error=str(exc)[:300])
    import json as _json
    return ToolResult(state=RunState.OK, summary=f"glob '{inp.pattern}'", output=_clip(_json.dumps(res, indent=1)), data=res if isinstance(res, dict) else {})


async def terminal_write_file(inp: TerminalWriteInput, ctx: InvocationContext) -> ToolResult:
    client = _client(ctx)
    if client is None or not client.configured:
        return _unconfigured()
    try:
        res = await client.write_file(inp.path, inp.content)
    except OpenTerminalError as exc:
        return ToolResult(state=RunState.ERROR, summary=f"could not write {inp.path}", error=str(exc)[:300])
    return ToolResult(state=RunState.OK, summary=f"wrote {inp.path} ({len(inp.content)} chars)", data=res if isinstance(res, dict) else {})


# ── dynamic registration (risk from config) ─────────────────────────────────────────────────────
def register_openterminal(registry: "ToolRegistry", cfg: "OpenTerminalCfg") -> int:
    """Register the open-terminal tools with per-op risk from `cfg`. Skips entirely if unconfigured
    (no base_url / disabled) so the tools simply aren't present. Returns how many registered."""
    if not (cfg.enabled and cfg.base_url):
        return 0
    table = [
        (terminal_exec, "terminal_exec", TerminalExecInput, cfg.exec_risk, "action", "terminal",
         "Run a shell command on the terminal host (open-terminal)."),
        (terminal_read_file, "terminal_read_file", TerminalReadInput, cfg.read_risk, "utility", "file-text",
         "Read a file on the terminal host."),
        (terminal_list, "terminal_list", TerminalListInput, cfg.read_risk, "utility", "folder",
         "List a directory on the terminal host."),
        (terminal_grep, "terminal_grep", TerminalGrepInput, cfg.read_risk, "utility", "search",
         "Search file contents on the terminal host (grep)."),
        (terminal_glob, "terminal_glob", TerminalGlobInput, cfg.read_risk, "utility", "search",
         "Find files by glob on the terminal host."),
        (terminal_write_file, "terminal_write_file", TerminalWriteInput, cfg.write_risk, "action", "file-plus",
         "Write (create/overwrite) a file on the terminal host."),
    ]
    n = 0
    for fn, name, model, risk, category, icon, desc in table:
        spec = ToolSpec(
            name=name,
            title=name.replace("_", " ").title(),
            description=desc,
            icon=icon,
            category=category,
            input_model=model,
            risk=_RISK.get(risk, Risk.HIGH),
            agent_exposed=True,
            ui_exposed=False,
        )
        try:
            registry.register(FunctionTool(spec=spec, fn=fn))
            n += 1
        except ValueError:
            pass  # already registered (e.g. a second app instance under tests)
    return n
