"""check_service — is a service actually reachable right now? (low risk, no SSH).

The honest liveness check the agent needs: a live **TCP connect** to the service's port (via
`ServiceService.status_of`, the same probe the Fleet tab uses), reported as UP/DOWN. This exists
because `open_service_url` only *builds* the link from config — it never tests it, so a returned
URL is NOT evidence the service is running (a model was mistaking it for confirmation). An offline
host short-circuits to DOWN. The probe succeeding or failing is a normal result (state OK with
`data.online`), not a tool error.
"""

from __future__ import annotations

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.actions._common import ServiceTargetInput


@action(
    "check_service",
    title="Check service",
    description=(
        "Check whether a service is actually running and reachable RIGHT NOW via a live TCP probe "
        "to its port (also reports DOWN if its host is offline). Use THIS to confirm a service is "
        "up — `open_service_url` only builds the link and does not test reachability."
    ),
    icon="activity",
    risk=Risk.LOW,
    ui_exposed=False,
)
async def check_service(inp: ServiceTargetInput, ctx: InvocationContext) -> ToolResult:
    """Live TCP-probe a service and report whether it is reachable."""
    deps = ctx.require_deps()
    svc = deps.services.service(inp.service_id)
    if svc is None:
        return ToolResult(state=RunState.ERROR, summary=f"unknown service '{inp.service_id}'")
    status = await deps.services.status_of(inp.service_id)
    if status is None:
        return ToolResult(state=RunState.ERROR, summary=f"could not probe '{inp.service_id}'")
    where = f" on port {svc.port}" if svc.port is not None else " (no port; tracks host)"
    if status.online:
        return ToolResult(
            state=RunState.OK,
            summary=f"{svc.name} is UP — reachable{where}",
            data={"online": True},
        )
    detail = f" ({status.error})" if status.error else ""
    return ToolResult(
        state=RunState.OK,
        summary=f"{svc.name} is DOWN — not reachable{where}{detail}",
        data={"online": False, "error": status.error},
    )
