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
    description=(
        "Build the browser URL for a service (http://host:port/path) from config so the owner can "
        "open it. This ONLY constructs the link — it does NOT contact the service, so a returned "
        "URL is NOT evidence the service is running. To confirm a service is up, use `check_service`."
    ),
    icon="external-link",
    risk=Risk.LOW,
    ui_exposed=False,
)
async def open_service_url(inp: ServiceTargetInput, ctx: InvocationContext) -> ToolResult:
    """Return the browser URL for a service (http://host:port/path). Does not test reachability."""
    svc = ctx.deps.services.service(inp.service_id)
    if svc is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown service '{inp.service_id}'")
    url = ctx.deps.services.url_for(svc.id)
    if url is None:
        return ToolResult(
            state=RunState.DENIED,
            summary=f"{svc.name} has no URL (no port or unknown host)",
        )
    return ToolResult(
        state=RunState.OK,
        summary=f"{svc.name} → {url} (link only — not checked; use check_service to confirm it is up)",
        data={"url": url},
    )
