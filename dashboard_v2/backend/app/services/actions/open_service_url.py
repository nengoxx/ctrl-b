"""open_service_url — resolve a service's browser-openable URL (low risk, no SSH).

The UI builds the svc-row link client-side from the host IP + port; this action is the
agent-facing equivalent ("open jellyfin" → returns the URL in `data.url`), so it isn't a UI
button (`ui_exposed=False`). A port-less or unresolvable service is a clean DENIED outcome.
"""

from __future__ import annotations

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.actions._common import ServiceTargetInput


@action(
    "open_service_url",
    title="Open service URL",
    icon="external-link",
    risk=Risk.LOW,
    ui_exposed=False,
)
async def open_service_url(inp: ServiceTargetInput, ctx: InvocationContext) -> ToolResult:
    """Return the browser URL for a service (http://host:port/path)."""
    svc = ctx.deps.services.service(inp.service_id)
    if svc is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown service '{inp.service_id}'")
    url = ctx.deps.services.url_for(svc.id)
    if url is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"{svc.name} has no reachable URL (no port or unknown host)",
        )
    return ToolResult(state=RunState.OK, summary=f"{svc.name} → {url}", data={"url": url})
