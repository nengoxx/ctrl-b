"""ActionService — the one place that runs an action end-to-end (DESIGN.md §3, §14).

Flow per invocation:
  validate args → `decide()` → ALLOW: execute · CONFIRM: mint/consume a one-time token ·
  DENY: synthesize a DENIED result → record an `Event` → return.

The confirm-token dance (DESIGN.md §14 "UI action"): a CONFIRM decision without a valid token
returns `needs_confirm` + a single-use, TTL'd token bound to (action, args). The client re-POSTs
with the token to execute. Tokens are in-memory (a restart invalidates them — acceptable for a
single-user tailnet panel; this isn't a CSRF defense, it's a deliberate two-step gate).

Phase 2 callers are the UI (`Actor.USER`, `Privilege.CONFIRM`). The agent path (Phase 4) reuses
this same service with its own actor/privilege.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from app.core.permissions import Decision, decide
from app.core.tool import InvocationContext, ToolRegistry
from app.domain.enums import Actor, Privilege, RunState
from app.domain.event import Event
from app.domain.result import ToolResult
from app.services.deps import Deps

_CONFIRM_TTL_S = 120.0


@dataclass
class _PendingConfirm:
    action: str
    args_json: str
    expires_at: float


@dataclass
class InvokeOutcome:
    """What the API turns into a response. Exactly one of (needs_confirm) / (result) is the
    payload; `event` is present whenever the action actually ran (or was denied)."""

    needs_confirm: bool
    result: ToolResult | None = None
    event: Event | None = None
    confirm_token: str | None = None
    confirm_prompt: str | None = None


class ActionService:
    def __init__(self, registry: ToolRegistry, deps: Deps) -> None:
        self._registry = registry
        self._deps = deps
        self._pending: dict[str, _PendingConfirm] = {}

    @property
    def registry(self) -> ToolRegistry:
        return self._registry

    async def invoke(
        self,
        name: str,
        raw_args: dict,
        *,
        actor: Actor = Actor.USER,
        privilege: Privilege = Privilege.CONFIRM,
        interactive: bool = True,
        confirm_token: str | None = None,
    ) -> InvokeOutcome:
        """Run an action. Raises `UnknownTool` (→404) / `ValidationError` (→422) for the API to
        map; every other outcome is data on a ToolResult."""
        tool = self._registry.get(name)  # UnknownTool → API 404
        inp = tool.spec.input_model.model_validate(raw_args)  # ValidationError → API 422
        args_json = inp.model_dump_json()

        decision = decide(tool.spec, privilege, interactive=interactive)

        if decision is Decision.DENY:
            result = ToolResult(
                state=RunState.DENIED,
                summary=f"{tool.spec.title} denied by policy (privilege={privilege.value})",
            )
            event = await self._record(actor, name, raw_args, result)
            return InvokeOutcome(needs_confirm=False, result=result, event=event)

        if decision is Decision.CONFIRM:
            if not self._consume_token(confirm_token, name, args_json):
                token = self._mint_token(name, args_json)
                return InvokeOutcome(
                    needs_confirm=True,
                    confirm_token=token,
                    confirm_prompt=f"{tool.spec.title}: confirm to proceed.",
                )

        result = await self._execute(tool, inp)
        event = await self._record(actor, name, raw_args, result)
        return InvokeOutcome(needs_confirm=False, result=result, event=event)

    async def _execute(self, tool, inp: BaseModel) -> ToolResult:
        ctx = InvocationContext(
            actor=Actor.USER, privilege=Privilege.CONFIRM, deps=self._deps, confirm_token=None
        )
        started = time.monotonic()
        try:
            result = await tool.run(inp, ctx)
        except Exception as exc:  # noqa: BLE001 — normalize any escape into a clean result
            result = ToolResult(
                state=RunState.ERROR, summary=f"{tool.spec.title} failed", error=str(exc)
            )
        if result.duration_ms is None:
            result.duration_ms = int((time.monotonic() - started) * 1000)
        return result

    async def _record(
        self, actor: Actor, name: str, raw_args: dict, result: ToolResult
    ) -> Event:
        event = Event(
            actor=actor,
            action=name,
            target=raw_args.get("host_id") or raw_args.get("service_id"),
            status=result.state,
            summary=result.summary,
            output=result.output,
        )
        return await self._deps.events.record(event)

    # ── confirm tokens ──────────────────────────────────────────────────────────────────────
    def _mint_token(self, action: str, args_json: str) -> str:
        self._sweep()
        token = secrets.token_urlsafe(18)
        self._pending[token] = _PendingConfirm(
            action=action, args_json=args_json, expires_at=time.monotonic() + _CONFIRM_TTL_S
        )
        return token

    def _consume_token(self, token: str | None, action: str, args_json: str) -> bool:
        """Single-use: a valid token for this exact (action, args) is removed and accepted."""
        if not token:
            return False
        self._sweep()
        pending = self._pending.get(token)
        if pending is None or pending.action != action or pending.args_json != args_json:
            return False
        del self._pending[token]
        return True

    def _sweep(self) -> None:
        now = time.monotonic()
        for tok in [t for t, p in self._pending.items() if p.expires_at < now]:
            del self._pending[tok]
