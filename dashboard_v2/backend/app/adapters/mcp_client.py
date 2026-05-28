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

Transport: **Streamable HTTP** (the current spec transport) is wired here. `stdio` (local
subprocess) is a marked follow-up — the owner's only server is Streamable HTTP, so shipping
untested stdio code would be guesswork.

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

_RISK = {"low": Risk.LOW, "med": Risk.MED, "high": Risk.HIGH}


class McpError(RuntimeError):
    """Any MCP failure (server down, transport unsupported, bad response) — normalized to a result."""


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
    return _RISK.get(server.risk, Risk.MED)


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
        """Open one short-lived MCP session over the server's transport. Entered + exited within a
        single coroutine (the SDK's anyio task groups require that)."""
        if server.transport != "streamable_http":
            raise McpError(f"transport '{server.transport}' not wired yet (stdio is a follow-up)")
        if not server.url:
            raise McpError("no url configured for streamable_http server")
        # Imported lazily so the module loads even if a transport's extra isn't present.
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        async with streamablehttp_client(
            server.url, headers=server.headers or None, timeout=server.connect_timeout_s
        ) as (read, write, _get_session_id):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session

    async def discover(self, registry: "ToolRegistry") -> list[dict]:
        """Connect to each enabled server, list its tools, and register a wrapper per tool into the
        shared registry. Per-server isolated: a failure logs + is reported, never raised. Returns a
        per-server summary for the startup log / a future health endpoint."""
        summary: list[dict] = []
        for server in self._servers:
            try:
                async with self._session(server) as session:
                    resp = await asyncio.wait_for(
                        session.list_tools(), timeout=server.connect_timeout_s
                    )
                tools = list(resp.tools)
            except Exception as exc:  # noqa: BLE001 — a bad server must not break startup
                log.warning("MCP server %r discovery failed: %s", server.name, exc)
                summary.append({"server": server.name, "tools": 0, "error": str(exc)})
                continue

            registered = 0
            for tool in tools:
                name = _qualified(server.name, tool.name)
                spec = ToolSpec(
                    name=name,
                    title=getattr(tool, "title", None) or tool.name,
                    description=tool.description or "",
                    category="mcp",
                    input_model=_PassthroughArgs,
                    raw_schema=tool.inputSchema or {"type": "object", "properties": {}},
                    risk=_risk_for(tool, server),
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
        down mid-session, transport error) becomes a clean ERROR `ToolResult` — never an exception
        bubbling into the agent loop."""
        try:
            async with self._session(server) as session:
                result = await asyncio.wait_for(
                    session.call_tool(remote_name, args), timeout=server.connect_timeout_s
                )
        except McpError as exc:
            return ToolResult(state=RunState.ERROR, summary=f"{remote_name} unavailable", error=str(exc)[:300])
        except asyncio.TimeoutError:
            return ToolResult(
                state=RunState.TIMEOUT, summary=f"{remote_name} timed out", error="MCP call timed out"
            )
        except Exception as exc:  # noqa: BLE001 — normalize any SDK/transport error
            return ToolResult(state=RunState.ERROR, summary=f"{remote_name} failed", error=str(exc)[:300])
        return _to_result(result, remote_name)
