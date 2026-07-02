"""stop_service — run a service's per-OS stop command over SSH.

`risk=MED`: stopping a service interrupts whatever depends on it, so at `Privilege.CONFIRM` it
gates (returns a confirm token) rather than running blind — consistent with the post-v1 privilege
ladder riding on `risk` (DESIGN.md §3).
"""

from __future__ import annotations

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk
from app.domain.result import ToolResult
from app.services.actions._common import ServiceTargetInput, run_service_command


@action("stop_service", title="Stop service", icon="square", risk=Risk.MED, idempotent=True)
async def stop_service(inp: ServiceTargetInput, ctx: InvocationContext) -> ToolResult:
    """Stop a service on its host (per-OS command; requires configured SSH credentials)."""
    return await run_service_command("stop", "stopped", inp, ctx)
