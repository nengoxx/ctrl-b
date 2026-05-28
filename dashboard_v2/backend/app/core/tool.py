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
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Literal, Protocol, runtime_checkable

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
    agent_exposed: bool = True
    ui_exposed: bool = False  # shows as a Utils card / host button
    timeout_s: float | None = None

    model_config = {"arbitrary_types_allowed": True}


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


@runtime_checkable
class Tool(Protocol):
    spec: ToolSpec

    async def run(self, inp: BaseModel, ctx: InvocationContext) -> ToolResult: ...


# A built-in action/tool is a plain async fn (inp, ctx) -> ToolResult.
ToolFn = Callable[[BaseModel, InvocationContext], Awaitable[ToolResult]]


@dataclass
class FunctionTool:
    """Wraps a decorated function as a `Tool`."""

    spec: ToolSpec
    fn: ToolFn

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
        agent's `tools` allowlist. `"*"` (the default) is every agent tool; a list is matched by
        glob (`fnmatch`) so a pattern like `mcp__web-tools__*` or `*_service` selects a family.
        A skill may narrow this further at selection time — never widen it."""
        tools = self.agent_tools()
        if allow == "*":
            return tools
        patterns = list(allow)
        return [t for t in tools if any(fnmatch(t.spec.name, p) for p in patterns)]

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


def _infer_input_model(fn: ToolFn) -> type[BaseModel]:
    """Pull the input BaseModel from the first parameter's annotation. `eval_str=True` resolves
    string annotations (action modules use `from __future__ import annotations`)."""
    params = list(inspect.signature(fn, eval_str=True).parameters.values())
    if not params:
        raise TypeError(f"{fn.__name__} must take (inp, ctx)")
    ann = params[0].annotation
    if not (isinstance(ann, type) and issubclass(ann, BaseModel)):
        raise TypeError(f"{fn.__name__}'s first parameter must be annotated with a Pydantic model")
    return ann


def _docsummary(fn: ToolFn) -> str:
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
    ui_exposed: bool = True,
    agent_exposed: bool = True,
    timeout_s: float | None = None,
    into: ToolRegistry | None = None,
) -> Callable[[ToolFn], ToolFn]:
    """Register an action into the registry. The function keeps its identity (returned as-is) so
    it stays unit-testable directly; the registry holds the wrapped `Tool`. `category` defaults to
    `action` (fleet/service ops); agent-only builtins like `task_plan` pass `category="builtin"`."""

    def deco(fn: ToolFn) -> ToolFn:
        spec = ToolSpec(
            name=name,
            title=title or name.replace("_", " ").title(),
            description=description or _docsummary(fn),
            icon=icon,
            category=category,
            input_model=_infer_input_model(fn),
            risk=risk,
            confirm=confirm,
            ui_exposed=ui_exposed,
            agent_exposed=agent_exposed,
            timeout_s=timeout_s,
        )
        (into or registry).register(FunctionTool(spec=spec, fn=fn))
        return fn

    return deco


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
        "ui_exposed": spec.ui_exposed,
        "agent_exposed": spec.agent_exposed,
        "input_schema": spec.input_model.model_json_schema(),
    }
