"""session_search — recall past conversations (7e-e, Hermes Tier 2, D15 #7).

A built-in, agent-only tool (no Utils card, no host button): the model calls it to find something
from an earlier session — a decision, a value, a thing the owner said — that isn't in the current
thread's working context. It runs the FTS5 index over message text (migration 3) through
`MessageRepo.search`, **global across all (non-archived) threads** (sessions stay agent-agnostic in
`ctrlb.db`, D14), and returns ranked snippets. Snippets are **redacted** (D15 #7) against the live
config secrets before they reach the model — defense-in-depth, the same `core.redact` the shell
actions use. Read-only → LOW risk, auto-runs under CONFIRM (no confirm gate), like `web_search`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.redact import redact
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult


class SessionSearchInput(BaseModel):
    query: str = Field(
        ...,
        description="What to recall from past conversations — keywords or a short phrase. Matches the "
        "text of past user/assistant messages (all words must appear).",
    )
    limit: int = Field(5, ge=1, le=20, description="Maximum number of past messages to return (1-20).")


def _format(hits: list[dict[str, Any]]) -> str:
    """Render hits as a compact numbered list the model reads — when, thread, role, snippet."""
    lines: list[str] = []
    for i, h in enumerate(hits, 1):
        when = (h.get("ts") or "")[:10]
        title = h.get("thread_title") or "(untitled)"
        who = h.get("agent") or h.get("thread_agent") or h.get("role")
        lines.append(f"{i}. [{when}] {title} · {who}: {h.get('snippet') or ''}")
    return "\n".join(lines)


@action(
    "session_search",
    title="Search sessions",
    description=(
        "Search your past conversations (across all sessions) for something you discussed before but "
        "that isn't in the current thread — a past decision, a value the owner gave you, an earlier "
        "request. Returns the best-matching messages with a snippet. Use it to recall context instead "
        "of asking the owner to repeat themselves; this searches history only, it takes no action."
    ),
    icon="history",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
    core=True,  # cognitive builtin — always reachable regardless of an agent's tools allowlist
)
async def session_search(inp: SessionSearchInput, ctx: InvocationContext) -> ToolResult:
    """Search your past conversations (all sessions) for something discussed earlier that isn't in the
    current thread. Returns ranked message snippets; history-only, takes no action."""
    deps = ctx.deps
    if deps is None or deps.messages is None:
        return ToolResult(state=RunState.DENIED, summary="session search is not available")

    hits = await deps.messages.search(inp.query, limit=inp.limit)
    secrets = deps.settings.secret_values() if deps.settings else []
    for h in hits:
        h["snippet"] = redact(h.get("snippet"), secrets)

    data = {"query": inp.query, "results": hits}
    if not hits:
        return ToolResult(state=RunState.OK, summary=f"No past sessions matched '{inp.query}'.", data=data)
    return ToolResult(
        state=RunState.OK,
        summary=f"{len(hits)} past message(s) matched '{inp.query}'.",
        data=data,
        output=_format(hits),
    )
