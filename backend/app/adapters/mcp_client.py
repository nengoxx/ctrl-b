"""MCP client (Phase 4f, D9) — connects to the owner's MCP servers and merges their tools.

The agent must see remote MCP tools as just more entries in the one toolset (DESIGN §3). So each
discovered remote tool is wrapped into an `McpTool` (the `Tool` protocol) and registered into the
**same** `ToolRegistry` as built-in actions — it then flows through the existing `ActionService`
(validation → permission gate → execute → audit Event) and renders in the same `.b.cmd` bubble.
The agent never special-cases "is this MCP."

Connection model is **per-call**: discovery opens a session to list tools (once, at startup), and
every tool call opens a fresh short-lived session, calls, and closes. This sidesteps the lifecycle
pitfalls of holding the SDK's anyio-task-group sessions open across FastAPI's lifespan, and makes
**failure isolation** trivial — a down server just fails its own call into a clean `ToolResult`,
never crashing the agent. Cost is a per-call MCP handshake, fine at homelab scale.

Transports: **Streamable HTTP** (`url` + optional `headers`) and **stdio** (a local subprocess —
`command`/`args`/`env`, the operator's env merged onto the SDK's safe default so `PATH` survives).
Both converge on a `ClientSession`; the rest of the flow (discover/wrap/call) is transport-agnostic.

Names are namespaced `mcp__<server>__<tool>` (sanitized to the OpenAI function-name charset
`[A-Za-z0-9_-]`, ≤64 chars) so two servers can expose a same-named tool without colliding.
"""

from __future__ import annotations

import asyncio
import logging
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, AsyncIterator

from pydantic import BaseModel

from app.config import McpServerCfg
from app.core.tool import InvocationContext, ToolSpec
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult

if TYPE_CHECKING:
    from app.core.tool import ToolRegistry

log = logging.getLogger("ctrlb.mcp")

#: Cap on the text we feed back to the model from one MCP call — a web crawl can return a whole
#: page; the full blob would blow the context window. Truncated with a marker (the agent can
#: re-call narrower if it needs more). The UI still shows this `output`.
_MAX_OUTPUT_CHARS = 6000


class McpError(RuntimeError):
    """Any MCP failure (server down, transport unsupported, bad response) — normalized to a result."""


def _is_cancel_scope_error(exc: BaseException) -> bool:
    """The cancel-during-handshake hazard: when a per-operation `asyncio.timeout` fires *inside*
    `session.initialize()`, the SDK's internal anyio task-group unwind can surface a
    `RuntimeError("Attempted to exit cancel scope in a different task than it was entered in")`
    instead of (or wrapping) the `TimeoutError` (open python-sdk issue class #521/#922/#1213). We
    treat that shape as a timeout, not a generic failure, so the effective-bound message still
    reads true. Recurse through a (Base)ExceptionGroup in case anyio wraps the unwind."""
    if isinstance(exc, RuntimeError) and "cancel scope" in str(exc).lower():
        return True
    inner = getattr(exc, "exceptions", None)  # (Base)ExceptionGroup
    if inner:
        return any(_is_cancel_scope_error(e) for e in inner)
    return False


class _PassthroughArgs(BaseModel):
    """Permissive input model for MCP tools: accepts any args (the remote server validates them).
    The native JSON Schema goes to the model via `ToolSpec.raw_schema`; `model_dump()` recovers the
    dict to forward to `call_tool`."""

    model_config = {"extra": "allow"}


def _qualified(server: str, tool: str) -> str:
    """`mcp__<server>__<tool>`, sanitized to the OpenAI function-name charset and clamped to 64."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", f"mcp__{server}__{tool}")
    return safe[:64]


def _risk_for(tool, server: McpServerCfg) -> Risk:
    """Per-tool risk, so read-only MCP ops (search, crawl, file read) don't gate while writes do.

    Honours MCP tool **annotations** as a safety signal that overrides the server default:
    `readOnlyHint=True` → LOW (auto-runs), `destructiveHint=True` → HIGH (always confirms — a floor,
    even on a server the owner marked `low`). A tool with no decisive hint falls back to the server's
    configured `risk` (default `med`). Most servers (e.g. emma's web-tools) don't set annotations, so
    set that server's `risk: low` in config to let its tools auto-run."""
    ann = getattr(tool, "annotations", None)
    if ann is not None:
        if getattr(ann, "destructiveHint", None) is True:
            return Risk.HIGH
        if getattr(ann, "readOnlyHint", None) is True:
            return Risk.LOW
    return server.risk  # already a Risk (coerced at the config boundary; default MED)


def _retry_hints_for(tool) -> tuple[bool, bool]:
    """`(read_only, idempotent)` from the MCP `readOnlyHint`/`idempotentHint` annotations → the
    retry-safety signal (`ToolSpec.retry_safe`). Advisory (UX only): an unset or even a lying hint just
    makes the failed-turn retry copy-to-draft — it never bypasses the confirm/privilege gate."""
    ann = getattr(tool, "annotations", None)
    if ann is None:
        return False, False
    return getattr(ann, "readOnlyHint", None) is True, getattr(ann, "idempotentHint", None) is True


@dataclass
class McpTool:
    """A remote MCP tool wrapped as a `Tool`. Holds the client + server so `run` opens a session,
    calls the remote tool, and normalizes the result — no built-in dep needed from `ctx`."""

    spec: ToolSpec
    _client: "McpClient"
    _server: McpServerCfg
    _remote_name: str

    async def run(self, inp: BaseModel, ctx: InvocationContext) -> ToolResult:  # noqa: ARG002
        return await self._client.call(self._server, self._remote_name, inp.model_dump(mode="json"))


def _to_result(call_result, tool_name: str) -> ToolResult:
    """Normalize an MCP `CallToolResult` into our `ToolResult` (DESIGN §3 — one outcome shape)."""
    parts: list[str] = []
    for c in call_result.content or []:
        text = getattr(c, "text", None)
        parts.append(text if text is not None else f"[{getattr(c, 'type', 'content')}]")
    output = "\n".join(p for p in parts if p).strip() or None
    if output and len(output) > _MAX_OUTPUT_CHARS:
        output = output[:_MAX_OUTPUT_CHARS] + "\n… [truncated]"

    data: dict = {}
    structured = getattr(call_result, "structuredContent", None)
    if structured:
        data["structured"] = structured

    if getattr(call_result, "isError", False):
        return ToolResult(
            state=RunState.ERROR,
            summary=f"{tool_name} reported an error",
            output=output,
            error=(output or "tool error")[:300],
            data=data,
        )
    # MCP output is arbitrary (text, JSON, markdown) — a first-line snippet is unreliable, so the
    # summary is a generic OK + size; the model reads the full `output`, and the UI can disclose it.
    size = f" · {len(output)} chars" if output else ""
    return ToolResult(state=RunState.OK, summary=f"{tool_name} ok{size}", output=output, data=data)


class McpClient:
    """Discovers + calls tools across the configured MCP servers (Streamable HTTP)."""

    def __init__(self, servers: list[McpServerCfg]) -> None:
        self._servers = [s for s in servers if s.enabled]

    @asynccontextmanager
    async def _session(self, server: McpServerCfg) -> AsyncIterator:
        """Open one short-lived MCP session over the server's transport — Streamable HTTP (`url`) or
        stdio (a local subprocess: `command`/`args`/`env`). Both converge on a `ClientSession`,
        entered + exited within a single coroutine (the SDK's anyio task groups require that).

        No deadline here: the *caller* wraps this whole `async with` — connect + `initialize()`
        handshake + the operation — in a single `asyncio.timeout` (discover/call), so the handshake
        can't hang unbounded (ACA-3). When that deadline fires mid-session, the stdio client's
        `__aexit__` still terminates the child on its own bounded ladder (graceful → 2 s → SIGKILL,
        SDK ≥ 1.11.0; installed 1.28.1), so total unwind can run ~2 s past the bound — expected, no
        redundant process-kill backstop is added on top of it."""
        # Imported lazily so the module loads even if a transport's extra isn't present.
        from mcp import ClientSession

        if server.transport == "streamable_http":
            if not server.url:
                raise McpError("no url configured for streamable_http server")
            import httpx
            from mcp.client.streamable_http import streamable_http_client

            # New SDK API (mcp>=1.24, replaces the deprecated `streamablehttp_client`): pass a pre-built
            # httpx client carrying our headers/timeout rather than per-call kwargs. The yielded 3-tuple
            # (read, write, get-session-id) is unchanged. The httpx client stays open for the session and
            # closes when this `async with` exits.
            async with (
                httpx.AsyncClient(headers=server.headers or None, timeout=server.connect_timeout_s) as _http,
                streamable_http_client(server.url, http_client=_http) as (read, write, _get_session_id),
            ):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session
        elif server.transport == "stdio":
            if not server.command:
                raise McpError("no command configured for stdio server")
            from mcp import StdioServerParameters
            from mcp.client.stdio import get_default_environment, stdio_client

            # Merge the operator's env onto the SDK's safe default (keeps PATH so `npx`/`uvx` resolve).
            env = {**get_default_environment(), **server.env} if server.env else None
            params = StdioServerParameters(command=server.command, args=server.args, env=env)
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session
        else:
            raise McpError(f"unsupported MCP transport '{server.transport}'")

    async def discover(self, registry: "ToolRegistry") -> list[dict]:
        """Connect to each enabled server, list its tools, and register a wrapper per tool into the
        shared registry. Per-server isolated: a failure logs + is reported, never raised. Returns a
        per-server summary for the startup log / a future health endpoint."""
        summary: list[dict] = []
        for server in self._servers:
            bound = server.connect_timeout_s
            try:
                # One deadline over the whole lifecycle — connect + `initialize()` + `list_tools` —
                # so a never-handshaking stdio server can't hang startup (ACA-3). See `_session`.
                async with asyncio.timeout(bound):
                    async with self._session(server) as session:
                        resp = await session.list_tools()
                tools = list(resp.tools)
            except Exception as exc:  # noqa: BLE001 — a bad server must not break startup
                if isinstance(exc, TimeoutError) or _is_cancel_scope_error(exc):
                    msg = f"discovery timed out after {bound:.1f}s"
                else:
                    msg = str(exc)
                log.warning("MCP server %r discovery failed: %s", server.name, msg)
                summary.append({"server": server.name, "tools": 0, "error": msg})
                continue

            registered = 0
            for tool in tools:
                name = _qualified(server.name, tool.name)
                read_only, idempotent = _retry_hints_for(tool)
                spec = ToolSpec(
                    name=name,
                    title=getattr(tool, "title", None) or tool.name,
                    description=tool.description or "",
                    category="mcp",
                    input_model=_PassthroughArgs,
                    raw_schema=tool.inputSchema or {"type": "object", "properties": {}},
                    risk=_risk_for(tool, server),
                    read_only=read_only,
                    idempotent=idempotent,
                    agent_exposed=True,
                    ui_exposed=False,
                )
                try:
                    registry.register(
                        McpTool(spec=spec, _client=self, _server=server, _remote_name=tool.name)
                    )
                    registered += 1
                except ValueError:
                    # Duplicate name (e.g. re-discovery in a second app instance under tests) — skip.
                    log.debug("MCP tool %r already registered; skipping", name)
            log.info("MCP server %r: registered %d tool(s)", server.name, registered)
            summary.append({"server": server.name, "tools": registered, "error": None})
        return summary

    async def call(self, server: McpServerCfg, remote_name: str, args: dict) -> ToolResult:
        """Open a fresh session, call the remote tool, normalize the result. Any failure (server
        down mid-session, transport error, deadline) becomes a clean ERROR/TIMEOUT `ToolResult` —
        never an exception bubbling into the agent loop.

        The deadline is `call_timeout_s` if set, else `connect_timeout_s` (ACA-3b: the call no longer
        borrows the connect budget once a call budget is configured). It bounds the *whole*
        lifecycle — connect + `initialize()` handshake + `call_tool` — in one `asyncio.timeout`."""
        bound = server.call_timeout_s if server.call_timeout_s is not None else server.connect_timeout_s
        try:
            async with asyncio.timeout(bound):
                async with self._session(server) as session:
                    result = await session.call_tool(remote_name, args)
        except McpError as exc:  # config/transport-unsupported — surfaced before the op
            return ToolResult(
                state=RunState.ERROR, summary=f"{remote_name} unavailable", error=str(exc)[:300]
            )
        except Exception as exc:  # noqa: BLE001 — normalize any SDK/transport error, never raise
            # TimeoutError, or the anyio cancel-scope RuntimeError from a timeout mid-`initialize()`,
            # both mean "we hit the deadline" — label them TIMEOUT with the effective bound.
            if isinstance(exc, TimeoutError) or _is_cancel_scope_error(exc):
                return ToolResult(
                    state=RunState.TIMEOUT,
                    summary=f"{remote_name} timed out",
                    error=f"MCP call exceeded {bound:.1f}s deadline",
                )
            return ToolResult(state=RunState.ERROR, summary=f"{remote_name} failed", error=str(exc)[:300])
        return _to_result(result, remote_name)
