"""The unified capability model — actions + utility tools + MCP are one interface (DESIGN.md §3).

A `Tool` is a `ToolSpec` (metadata + a Pydantic `input_model`) plus an async `run`. Built-in
actions register via the `@action` decorator into the module-level `registry`; the UI renders the
`ui_exposed` subset and (Phase 4) the agent sees the `agent_exposed` union. Adding a capability is
one registration — never a new switch statement.

Phase 2 builds the framework + the three fleet actions. The `@tool` (utility) and MCP wrappers in
the same shape arrive in their phases; this file is the seam they slot into.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from fnmatch import fnmatch
from typing import (
    TYPE_CHECKING,
    Any,
    Awaitable,
    Callable,
    Literal,
    Protocol,
    TypeVar,
    cast,
    runtime_checkable,
)

from pydantic import BaseModel

from app.domain.enums import Actor, Privilege, Risk
from app.domain.result import ToolResult

if TYPE_CHECKING:  # avoid a core→services import cycle; Deps is structural here
    from app.domain.agent import AgentDef
    from app.services.deps import Deps


ToolCategory = Literal["action", "utility", "builtin", "mcp"]


class ToolSpec(BaseModel):
    name: str  # unique; namespaced for MCP ("mcp:server:tool")
    title: str
    description: str = ""
    icon: str | None = None
    category: ToolCategory = "action"
    input_model: type[BaseModel]  # → JSON Schema for the agent + request validation
    #: For tools whose param schema is defined externally (MCP servers): the native JSON Schema to
    #: hand the model verbatim. When set, it's used over `input_model.model_json_schema()` in
    #: `to_openai_tools`; `input_model` is then a permissive passthrough (the remote validates).
    raw_schema: dict[str, Any] | None = None
    risk: Risk = Risk.LOW
    confirm: bool = False  # force confirmation regardless of privilege
    #: Retry-safety hints, aligned with MCP tool annotations (`readOnlyHint`/`idempotentHint`, same
    #: false defaults). `read_only` = doesn't modify anything; `idempotent` = re-running with the same
    #: args has no additional effect. `retry_safe` (below) = `read_only or idempotent` — a **UX** signal
    #: (I4/J-audit): the failed-turn retry auto-resends a retry-safe turn but copies a non-safe one to
    #: the composer for review, so it can't silently repeat a `reboot`/`restart`/`run_shell`/`spawn`.
    #: A UX hint only — NOT a safety control (that stays the confirm/privilege gate; MCP says treat
    #: hints as advisory). MCP/OpenAPI tools derive these from their own annotations.
    read_only: bool = False
    idempotent: bool = False
    agent_exposed: bool = True
    ui_exposed: bool = False  # shows as a Utils card / host button
    #: A core builtin every agent can always reach: `for_agent` unions these in regardless of the
    #: agent's `tools` allowlist *and* any skill narrowing (the cognitive set — task_plan/memory/
    #: session_search). It removes the footgun where a specialist with an explicit `tools` list
    #: silently loses a builtin, and means a new core builtin needs no per-agent allowlist update.
    core: bool = False
    #: The per-tool wall-clock deadline `ActionService._execute` enforces via `asyncio.wait_for`
    #: (E0a). **Deadline policy (ACA-7): every registered tool either declares its bound here OR is
    #: documented in `ADAPTER_BOUNDED` below (or is category `"mcp"`) as already covered by an
    #: adapter / subprocess / local-DB bound** — enforced by `test_deadline_policy_aca67`. `None`
    #: means "no `ActionService`-level bound"; it is only correct when the tool's own I/O is already
    #: bounded elsewhere. Note the bound gives up *waiting* — it does not kill a thread blocked in
    #: `asyncio.to_thread` (see `ActionService._execute`).
    timeout_s: float | None = None

    model_config = {"arbitrary_types_allowed": True}

    @property
    def retry_safe(self) -> bool:
        """Safe to blindly re-run (read-only or idempotent) — the retry-of-a-failed-turn UX signal."""
        return self.read_only or self.idempotent


#: The documented allowlist for the `ToolSpec.timeout_s` policy (ACA-7): registered tools that carry
#: NO `ActionService`-level deadline (`timeout_s is None`) because their own I/O is already bounded.
#: Maps tool name → the covering bound, so the "why is this unbounded?" answer lives in ONE place.
#: `test_deadline_policy_aca67` walks the live registry and fails if a spec has `timeout_s is None`,
#: is not covered here, and is not a dynamically-registered integration tool — so a NEW tool must
#: either declare a bound or be triaged into this map (fail-closed).
#:
#: Two dynamic tool *classes* are covered by construction and need no per-name entry (their bound is
#: fixed at the adapter, not per tool): MCP + OpenAPI tools (`category == "mcp"`) self-bound via the
#: McpClient / OpenAPI-adapter deadlines (McpServerCfg.call/connect_timeout_s · OpenApiServerCfg.
#: connect_timeout_s on the httpx client); open-terminal tools (`terminal_*`) are bounded by
#: `OpenTerminalCfg.timeout_s` on their httpx client.
ADAPTER_BOUNDED: dict[str, str] = {
    # host/service reads + non-SSH controls
    "ping_host": "fleet.ping_host bounds the ping subprocess (asyncio.wait_for, timeout_s + 1s)",
    "check_service": "svc.probe_port TCP connect bounded by asyncio.wait_for (1.5s)",
    "wake_host": "fire-and-forget UDP magic packet (wol.send_magic); no reply is awaited",
    "open_service_url": "pure — builds a URL string from config, performs no I/O",
    # subprocess-backed
    "tailscale_serve_enable": "run_capture(timeout_s=TailscaleCfg.timeout_s) bounds the tailscale CLI",
    "tailscale_serve_disable": "run_capture(timeout_s=TailscaleCfg.timeout_s) bounds the tailscale CLI",
    "run_shell": "run_capture(timeout_s=ShellCfg.timeout_s) — the process is killed on timeout",
    # httpx-backed
    "web_search": "SearxngCfg.timeout_s on the cached httpx client",
    "ip_info": "httpx client timeout (_HTTP_TIMEOUT) on the ip-api request",
    # in-process / local DB / control-flow — no external I/O to bound
    "memory": "local SQLite/file memory write; the git commit is bounded by MemoryGitCfg.commit_timeout_s",
    "skill_manage": "local file + SQLite write, no external I/O",
    "task_plan": "in-process turn state persisted to local SQLite, no external I/O",
    "session_search": "local SQLite FTS query, no external I/O",
    "question": "control-flow signal to the loop; returns immediately, no I/O",
    "spawn_subagents": "each child runs under its own asyncio.timeout(agent.subagent_child_timeout_s)",
}


@dataclass
class InvocationContext:
    """The "world handle" passed to every tool. `deps` carries the adapters/services a tool
    reaches for (fleet, events, settings). `cancel`/headless nuances arrive with the agent loop
    (Phase 4); Phase 2 actions are short and synchronous-ish under a threadpool."""

    actor: Actor
    privilege: Privilege
    interactive: bool = True
    confirm_token: str | None = None
    deps: "Deps | None" = None
    #: Subagent nesting (4.5, DESIGN §5.5). `depth` is 0 for a top-level turn and +1 per spawn
    #: level; `agent` is the AgentDef whose turn this is — `spawn_subagents` reads both to enforce
    #: `max_subagent_depth` / `max_concurrent_subagents` and to clamp child privilege to the parent.
    depth: int = 0
    agent: "AgentDef | None" = None

    def require_deps(self) -> "Deps":
        """The world-handle a deps-using tool needs, narrowed to non-`None`. `deps` is optional on
        the context by construction (a deps-free tool — e.g. `question` — runs with a deps-less
        ctx, and tests build one), but every *real* invocation through `ActionService` injects it.
        A tool that reaches for `deps` calls this once at the top: `deps = ctx.require_deps()`. A
        missing `deps` here is a programming error (a deps-using tool invoked without a world), so
        it raises rather than returning `None` — turning an invisible invariant into a clear failure
        and giving the type checker the non-`None` `Deps` it needs for every `deps.…` access."""
        if self.deps is None:
            raise RuntimeError("this tool requires InvocationContext.deps, but none was provided")
        return self.deps


@runtime_checkable
class Tool(Protocol):
    spec: ToolSpec

    async def run(self, inp: BaseModel, ctx: InvocationContext) -> ToolResult: ...


# A built-in action/tool is a plain async fn (inp, ctx) -> ToolResult. `ToolFn` is **generic in the
# input model** (`TInput`) so the `@action`/`@tool` decorators preserve each tool's *precise*
# signature (`question(inp: QuestionInput, ...)` stays typed as such) instead of widening it to
# `BaseModel`. The registry, however, stores handlers *heterogeneously* under one `dict[str, Tool]`,
# which necessarily erases each narrow input back to the common `ToolFn[BaseModel]` — an inherently
# contravariant step. That single erasure lives at one `cast` in `action()` below (never per-tool),
# and is runtime-safe because a tool is only ever called with an instance of exactly its
# `input_model` (validated JSON → that model, in `ActionService`).
TInput = TypeVar("TInput", bound=BaseModel)
ToolFn = Callable[[TInput, InvocationContext], Awaitable[ToolResult]]


@dataclass
class FunctionTool:
    """Wraps a decorated function as a `Tool`."""

    spec: ToolSpec
    fn: "ToolFn[BaseModel]"  # erased storage form (see the ToolFn note above)

    async def run(self, inp: BaseModel, ctx: InvocationContext) -> ToolResult:
        return await self.fn(inp, ctx)


class UnknownTool(KeyError):
    """Raised by `ToolRegistry.get` for an unregistered name."""


@dataclass
class ToolRegistry:
    """The single source feeding UI buttons today and the agent toolset (Phase 4)."""

    _tools: dict[str, Tool] = field(default_factory=dict)

    def register(self, tool: Tool) -> None:
        if tool.spec.name in self._tools:
            raise ValueError(f"duplicate tool name: {tool.spec.name!r}")
        self._tools[tool.spec.name] = tool

    def remove(self, name: str) -> bool:
        """Drop a tool by name. Returns whether it was present. Used by integration re-discovery
        (Phase 7c) to clear stale MCP/OpenAPI tools before re-registering the current set."""
        return self._tools.pop(name, None) is not None

    def remove_category(self, category: str) -> int:
        """Drop every tool of a category, returning the count removed. MCP **and** OpenAPI tools both
        register as `"mcp"` (the remote-tool bucket), so `remove_category("mcp")` clears them all
        ahead of a fresh `discover()` — the registry is rebuilt between agent turns, never mid-turn."""
        names = [n for n, t in self._tools.items() if t.spec.category == category]
        for n in names:
            del self._tools[n]
        return len(names)

    def get(self, name: str) -> Tool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise UnknownTool(name) from exc

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def ui_tools(self) -> list[Tool]:
        return [t for t in self._tools.values() if t.spec.ui_exposed]

    def agent_tools(self) -> list[Tool]:
        """The subset *any* agent may call (Phase 4): every `agent_exposed` tool. `for_agent`
        narrows this to a specific `AgentDef`'s allowlist (4.5)."""
        return [t for t in self._tools.values() if t.spec.agent_exposed]

    def for_agent(self, allow: list[str] | str = "*") -> list[Tool]:
        """The tools a specific agent may call (DESIGN §5.1): `agent_tools()` intersected with the
        agent's `tools` allowlist, **plus** the always-on `core` builtins. `"*"` (the default) is
        every agent tool; a list is matched by glob (`fnmatch`) so a pattern like `mcp__web-tools__*`
        or `*_service` selects a family. A skill may narrow the allowlist further at selection time —
        never widen it — but the `core` set survives both the allowlist and skill narrowing, since
        the narrowed allowlist is fed back through here. Order is stable (registration order)."""
        tools = self.agent_tools()
        if allow == "*":
            return tools
        patterns = list(allow)
        return [t for t in tools if t.spec.core or any(fnmatch(t.spec.name, p) for p in patterns)]

    def to_openai_tools(self, tools: list[Tool] | None = None) -> list[dict[str, Any]]:
        """Render tools as OpenAI `tools` function defs (the input model → JSON Schema). Defaults
        to `agent_tools()`. The model picks by `name`/`description`; we validate args on the way
        back through each tool's `input_model`, so a hallucinated arg shape fails cleanly."""
        return [
            {
                "type": "function",
                "function": {
                    "name": t.spec.name,
                    "description": t.spec.description or t.spec.title,
                    "parameters": t.spec.raw_schema or t.spec.input_model.model_json_schema(),
                },
            }
            for t in (tools if tools is not None else self.agent_tools())
        ]


#: The default registry built-in actions register into at import time. main.py imports the
#: action modules (triggering registration) and reads this — see services/actions/__init__.py.
registry = ToolRegistry()


def _infer_input_model(fn: Callable[..., Any]) -> type[BaseModel]:
    """Pull the input BaseModel from the first parameter's annotation. `eval_str=True` resolves
    string annotations (action modules use `from __future__ import annotations`)."""
    params = list(inspect.signature(fn, eval_str=True).parameters.values())
    if not params:
        raise TypeError(f"{fn.__name__} must take (inp, ctx)")
    ann = params[0].annotation
    if not (isinstance(ann, type) and issubclass(ann, BaseModel)):
        raise TypeError(f"{fn.__name__}'s first parameter must be annotated with a Pydantic model")
    return ann


def _docsummary(fn: Callable[..., Any]) -> str:
    """Fallback tool description from the function docstring: the first *paragraph* (up to a blank
    line), with wrapped lines collapsed to one — so a description that spans several physical lines
    isn't truncated mid-sentence. An explicit `description=` always wins over this."""
    doc = inspect.getdoc(fn) or ""
    para = doc.split("\n\n", 1)[0]  # first paragraph
    return " ".join(line.strip() for line in para.splitlines() if line.strip())


def action(
    name: str,
    *,
    title: str | None = None,
    description: str | None = None,
    icon: str | None = None,
    category: ToolCategory = "action",
    risk: Risk = Risk.LOW,
    confirm: bool = False,
    read_only: bool = False,
    idempotent: bool = False,
    ui_exposed: bool = True,
    agent_exposed: bool = True,
    core: bool = False,
    timeout_s: float | None = None,
    into: ToolRegistry | None = None,
) -> Callable[[ToolFn[TInput]], ToolFn[TInput]]:
    """Register an action into the registry. The function keeps its identity (returned as-is) so
    it stays unit-testable directly; the registry holds the wrapped `Tool`. `category` defaults to
    `action` (fleet/service ops); agent-only builtins like `task_plan` pass `category="builtin"`.
    `read_only`/`idempotent` (MCP-aligned) drive retry-safety (see `ToolSpec.retry_safe`).

    Generic in `TInput` so the decorated function's precise input-model type is preserved (see the
    `ToolFn` note); the single narrow→base erasure is the `cast` at registration below."""

    def deco(fn: ToolFn[TInput]) -> ToolFn[TInput]:
        spec = ToolSpec(
            name=name,
            title=title or name.replace("_", " ").title(),
            description=description or _docsummary(fn),
            icon=icon,
            category=category,
            input_model=_infer_input_model(fn),
            risk=risk,
            confirm=confirm,
            read_only=read_only,
            idempotent=idempotent,
            ui_exposed=ui_exposed,
            agent_exposed=agent_exposed,
            core=core,
            timeout_s=timeout_s,
        )
        (into or registry).register(FunctionTool(spec=spec, fn=cast("ToolFn[BaseModel]", fn)))
        return fn

    return deco


def tool(
    name: str,
    *,
    title: str | None = None,
    description: str | None = None,
    icon: str | None = None,
    risk: Risk = Risk.LOW,
    read_only: bool = False,
    idempotent: bool = False,
    agent_exposed: bool = True,
    timeout_s: float | None = None,
    into: ToolRegistry | None = None,
) -> Callable[[ToolFn[TInput]], ToolFn[TInput]]:
    """Register a **utility tool** — a self-contained, context-free capability (no host_id / chat
    context) the owner runs from the Tools tab card *and* the agent may call. Thin sugar over
    `action` presetting `category="utility"` + `ui_exposed=True` (and `confirm=False`); everything
    else (the input-model introspection, registration, the registry it feeds) is identical. Adding
    a utility = one file with one `@tool`. Keep the input model **flat** (scalar `Field(...)`s) so the
    generic Tools-tab card renders it without per-tool UI code."""
    return action(
        name,
        title=title,
        description=description,
        icon=icon,
        category="utility",
        risk=risk,
        confirm=False,
        read_only=read_only,
        idempotent=idempotent,
        ui_exposed=True,
        agent_exposed=agent_exposed,
        timeout_s=timeout_s,
        into=into,
    )


def spec_to_dict(spec: ToolSpec) -> dict[str, Any]:
    """Public DTO for `GET /api/actions` — metadata + the input JSON Schema, no Python types."""
    return {
        "name": spec.name,
        "title": spec.title,
        "description": spec.description,
        "icon": spec.icon,
        "category": spec.category,
        "risk": spec.risk.value,
        "confirm": spec.confirm,
        "retry_safe": spec.retry_safe,  # UX signal for the failed-turn retry guard (I4)
        "ui_exposed": spec.ui_exposed,
        "agent_exposed": spec.agent_exposed,
        "core": spec.core,
        "input_schema": spec.input_model.model_json_schema(),
    }
