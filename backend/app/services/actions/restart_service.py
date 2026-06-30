"""restart_service — run a service's per-OS restart command over SSH (`risk=MED`, gates at
CONFIRM like stop_service)."""

from __future__ import annotations

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk
from app.domain.result import ToolResult
from app.services.actions._common import ServiceTargetInput, run_service_command


@action("restart_service", title="Restart service", icon="refresh-cw", risk=Risk.MED)
async def restart_service(inp: ServiceTargetInput, ctx: InvocationContext) -> ToolResult:
    """Restart a service on its host (per-OS command; requires configured SSH credentials)."""
    return await run_service_command("restart", "restarted", inp, ctx)
