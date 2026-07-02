"""start_service — run a service's per-OS start command over SSH (low risk)."""

from __future__ import annotations

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk
from app.domain.result import ToolResult
from app.services.actions._common import ServiceTargetInput, run_service_command


@action("start_service", title="Start service", icon="play", risk=Risk.LOW, idempotent=True)
async def start_service(inp: ServiceTargetInput, ctx: InvocationContext) -> ToolResult:
    """Start a service on its host (per-OS command; requires configured SSH credentials)."""
    return await run_service_command("start", "started", inp, ctx)
