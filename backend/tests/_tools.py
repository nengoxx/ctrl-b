"""Shared test helper: synthetic tools in the live registry.

Several loop tests drive `_run_calls`/`_drive` with FAKE tool names (`call_one`/`call_two`) over a
stubbed `ActionService.invoke` — the machinery they pin (per-call persistence, cancel/reconcile,
shielded writes) doesn't care what the tool is. Since M1 (PROMPTS_PLAN §6 C-11) the session refuses
any name outside `for_agent(...)` BEFORE invoke, so a name the registry never heard of no longer
reaches the stub. Registering the fakes for the duration of the test restores the scenario without
weakening the guard: they are ordinary LOW-risk, agent-exposed, non-read-only builtins, so the
effective allowlist admits them and they still run on the SERIAL tail.
"""

from __future__ import annotations

import contextlib
from typing import Any

from pydantic import BaseModel


class _AnyArgs(BaseModel):
    """Permissive input model — these tools never really run (invoke is stubbed)."""

    model_config = {"extra": "allow"}


@contextlib.contextmanager
def temp_tools(registry, *names: str, **spec_kw: Any):
    """Register `names` as no-op agent tools, removing them on exit — the registry is a
    process-global singleton shared across `create_app()` calls, so a leaked tool poisons later tests."""
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import RunState
    from app.domain.result import ToolResult

    async def _noop(inp, ctx):  # noqa: ANN001
        return ToolResult(state=RunState.OK, summary="ok")

    spec_kw.setdefault("category", "builtin")
    spec_kw.setdefault("input_model", _AnyArgs)
    for name in names:
        registry.register(FunctionTool(spec=ToolSpec(name=name, title=name, **spec_kw), fn=_noop))
    try:
        yield names
    finally:
        for name in names:
            registry.remove(name)
