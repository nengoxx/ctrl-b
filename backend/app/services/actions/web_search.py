"""web_search — query the configured SearXNG instance for the agent (Phase 4f, D9).

A `category="utility"` tool (LOW risk, agent-only): the chat agent calls it to look something up
on the web; it auto-runs in the loop (no confirm gate) like ping. Not `ui_exposed` — the generic
Utils-card registry is Phase 8, so there's no button yet (harmless in `/api/actions`, like
`task_plan`). The SearXNG round-trip lives in the adapter (`ctx.deps.searxng`); this file just
shapes the input, formats results for the model, and normalizes failures into a `ToolResult`.
"""

from __future__ import annotations

from dataclasses import asdict

from pydantic import BaseModel, Field

from app.adapters.searxng import SearxngError
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult


class WebSearchInput(BaseModel):
    query: str = Field(..., description="The search query — what to look up on the web.")
    count: int = Field(
        5, ge=1, le=20, description="Maximum number of results to return (1-20)."
    )
    categories: str | None = Field(
        None,
        description="Optional SearXNG category filter, comma-separated "
        "(e.g. 'general', 'news', 'it'). Omit for a general search.",
    )


def _format(results: list) -> str:
    """Render results as a compact numbered list the model reads — title, url, snippet per hit."""
    lines: list[str] = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r.title}\n   {r.url}")
        if r.content:
            lines.append(f"   {r.content}")
    return "\n".join(lines)


@action(
    "web_search",
    title="Web search",
    description=(
        "Search the public internet (via SearXNG) for information. Use ONLY when the owner asks for "
        "something that requires looking up external/online information. Do NOT use this for fleet, "
        "host, or service operations — those have dedicated tools (wake/ping/start/stop/restart)."
    ),
    icon="search",
    category="utility",
    risk=Risk.LOW,
    ui_exposed=False,
    agent_exposed=True,
)
async def web_search(inp: WebSearchInput, ctx: InvocationContext) -> ToolResult:
    """Search the web via the configured SearXNG instance and return the top results."""
    client = ctx.deps.searxng if ctx.deps else None
    if client is None or not client.configured:
        return ToolResult(
            state=RunState.DENIED,
            summary="web search is not configured (set a SearXNG endpoint in config)",
        )
    try:
        results = await client.search(
            inp.query, count=inp.count, categories=inp.categories
        )
    except SearxngError as exc:
        return ToolResult(
            state=RunState.ERROR, summary="web search failed", error=str(exc)[:300]
        )

    data = {"query": inp.query, "results": [asdict(r) for r in results]}
    if not results:
        return ToolResult(
            state=RunState.OK, summary=f"No web results for '{inp.query}'.", data=data
        )
    return ToolResult(
        state=RunState.OK,
        summary=f"{len(results)} web result(s) for '{inp.query}'.",
        data=data,
        output=_format(results),
    )
