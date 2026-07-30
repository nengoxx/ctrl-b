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

import asyncio
import secrets
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import BaseModel, ValidationError

if TYPE_CHECKING:
    from app.domain.agent import AgentDef

from app.core.permissions import NONE_CANON, Decision, approval_match, decide, exact_arg_pins
from app.core.tool import InvocationContext, ToolRegistry, UnknownTool
from app.domain.enums import Actor, Privilege, RunState
from app.domain.event import DecisionReason, Event, Origin
from app.domain.result import ToolResult
from app.services.deps import Deps

if TYPE_CHECKING:
    from app.config import ApprovalRule

_CONFIRM_TTL_S = 120.0
#: Mandatory audit marker appended to the executed action's summary when a persisted approval fired
#: (D44 §6): the sole visibility on the interactive→headless crossing. One format, defined once.
_APPROVAL_MARKER = " [auto-allowed: {detail}]"
#: Per-value cap inside the marker (post-audit MED-1). The marker is appended to EVERY auto-allowed
#: run's persisted `Event.summary`, and approvable tools take large or credential-bearing args
#: (`terminal_write_file.content`, MCP tool args) — an untruncated pattern would copy them into the
#: audit log on every run. Field NAMES stay full: which rule matched is the point of the marker.
_APPROVAL_VALUE_MAX = 32


def _approval_detail(rule: "ApprovalRule") -> str:
    """The args summary inside `_APPROVAL_MARKER` — `field=pattern` pairs (each pattern truncated to
    `_APPROVAL_VALUE_MAX`), `any args` for a whole-action grant (`args is None`), or `no args` for the
    empty-AND rule (`args == {}`, a zero-field tool — NOT a whole-action grant, LOW-1)."""
    if rule.args is None:
        return "any args"
    if not rule.args:
        return "no args"
    return ", ".join(f"{field}={_clip(pattern)}" for field, pattern in rule.args.items())


def _clip(pattern: str) -> str:
    """One pattern rendered for the audit marker: the `None` sentinel as readable `null` (it holds a
    NUL byte — never write that into a summary row), anything longer than the cap ellipsized."""
    shown = pattern.replace(NONE_CANON, "null")
    return shown if len(shown) <= _APPROVAL_VALUE_MAX else f"{shown[:_APPROVAL_VALUE_MAX]}…"


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
        # Single-flight reservations for `resume(execute)` (J2): call_ids currently executing, so a
        # concurrent double-execute of the same pending call can't fire a non-idempotent action twice.
        self._inflight: set[str] = set()

    @property
    def registry(self) -> ToolRegistry:
        return self._registry

    def approval_eligible(self, name: str, raw_args: dict) -> bool:
        """True iff a bubble 'always allow' rule for this EXACT call is expressible AND could ever fire
        (D44 W2/W3) — drives the `always_eligible` flag on `tool.permission` so the FE hides an
        affordance that would only persist an inert rule. Two gates: (1) value-based expressibility
        (`exact_arg_pins`): validate the args, then require every top-level value to canonicalize to a
        scalar pattern (a `None` optional pins as `"null"`) — False on a non-scalar field (list/dict —
        today just `spawn_subagents.tasks`) or on args that no longer validate; (2) `not spec.confirm`
        (W3 §1): a designer-pinned forced-confirm tool (shutdown/reboot/run_shell) is un-downgradable
        below FULL (R1, invariant 2), so a grant there writes a rule the gate's approval consult never
        reads (`invoke` skips `approval_match` when `spec.confirm`) — the affordance must never offer
        it. Actor-agnostic."""
        try:
            tool = self._registry.get(name)
            inp = tool.spec.input_model.model_validate(raw_args)
        except UnknownTool, ValidationError:
            return False
        if tool.spec.confirm:  # W3 §1: un-downgradable — an approval rule here would be inert
            return False
        return exact_arg_pins(inp.model_dump(mode="json")) is not None

    async def invoke(
        self,
        name: str,
        raw_args: dict,
        *,
        origin: Origin,
        actor: Actor = Actor.USER,
        privilege: Privilege = Privilege.CONFIRM,
        interactive: bool = True,
        confirm_token: str | None = None,
        depth: int = 0,
        agent: "AgentDef | None" = None,
        summary_note: str | None = None,
    ) -> InvokeOutcome:
        """Run an action. Raises `UnknownTool` (→404) / `ValidationError` (→422) for the API to
        map; every other outcome is data on a ToolResult.

        `origin` (D49 / AUTOMATIONS_PLAN §D-4) is who set this call in motion. It is REQUIRED and
        deliberately has NO default: a default would let a future call site mislabel its calls as
        interactive chat *silently* (R9's structural-omission warning), whereas an omission here is a
        type error at the site. It rides onto the `InvocationContext` and is stamped on the Event.

        `summary_note` is a caller-supplied breadcrumb appended to the result summary BEFORE the Event
        is recorded (post-audit LOW-3), so a note the caller can only know at call time — today the D44
        grant-failure note from `execute_always` — lands in the AUDIT LOG, not just the SSE stream.
        Appended on every recorded outcome (DENY included); a suspend records nothing, so it carries
        no note and the caller re-supplies it on the resumed call."""
        tool = self._registry.get(name)  # UnknownTool → API 404
        inp = tool.spec.input_model.model_validate(raw_args)  # ValidationError → API 422
        args_json = inp.model_dump_json()

        # Persisted approvals (D44, SLICE8_PLAN §3): consult the tool's live override rules ONLY when
        # they can apply — an override that has rules on a tool whose confirm the designer did NOT force
        # (`spec.confirm` is un-downgradable, R1). Live via `self._deps.settings` (shared object, mutated
        # in place by `runtime.apply_settings_inplace`), so a revoke wins from the very next invoke.
        override = self._deps.settings.tool_overrides.get(name)
        rule: "ApprovalRule | None" = None
        if override is not None and override.approvals and not tool.spec.confirm:
            rule = approval_match(override.approvals, inp.model_dump(mode="json"))

        # `run_shell` (Phase 5) is denied below FULL unless the owner opts the agent in via
        # `shell.agent_exec_enabled`; the user `!` path invokes it at FULL, so this never blocks it.
        decision = decide(
            tool.spec,
            privilege,
            interactive=interactive,
            run_shell_allowed=self._deps.settings.shell.agent_exec_enabled,
            approved=rule is not None,  # a matched approval downgrades a risk-derived CONFIRM to ALLOW
        )

        if decision is Decision.DENY:
            result = ToolResult(
                state=RunState.DENIED,
                summary=f"{tool.spec.title} denied by policy (privilege={privilege.value})",
            )
            if summary_note:
                result.summary = f"{result.summary}{summary_note}"
            event = await self._record(actor, name, raw_args, result, origin=origin, decision="policy")
            return InvokeOutcome(needs_confirm=False, result=result, event=event)

        # Why this call is about to run, for the audit row (D-4). `approval` uses the SAME predicate as
        # the D44 summary marker below (`rule is not None`), so the column and the marker can never
        # disagree about which runs an approval rule covered.
        reason: DecisionReason = "approval" if rule is not None else "auto"
        if decision is Decision.CONFIRM:
            if not self._consume_token(confirm_token, name, args_json):
                token = self._mint_token(name, args_json)
                return InvokeOutcome(
                    needs_confirm=True,
                    confirm_token=token,
                    confirm_prompt=f"{tool.spec.title}: confirm to proceed.",
                )
            reason = "confirmed"  # the gate asked and a one-time token came back

        result = await self._execute(
            tool,
            inp,
            actor=actor,
            privilege=privilege,
            interactive=interactive,
            depth=depth,
            agent=agent,
            origin=origin,
        )
        if rule is not None:  # D44 §6: mandatory audit marker on the approval-fired run's Event summary
            result.summary = f"{result.summary}{_APPROVAL_MARKER.format(detail=_approval_detail(rule))}"
        if summary_note:
            result.summary = f"{result.summary}{summary_note}"
        event = await self._record(actor, name, raw_args, result, origin=origin, decision=reason)
        return InvokeOutcome(needs_confirm=False, result=result, event=event)

    async def _execute(
        self,
        tool,
        inp: BaseModel,
        *,
        actor: Actor = Actor.USER,
        privilege: Privilege = Privilege.CONFIRM,
        interactive: bool = True,
        depth: int = 0,
        agent: "AgentDef | None" = None,
        origin: Origin,  # required, like at `invoke` — the context must never default its attribution
    ) -> ToolResult:
        # The context carries the real caller (actor/privilege/depth/agent/origin) so meta-tools like
        # spawn_subagents can enforce limits + clamp child privilege (DESIGN §5.5) and propagate
        # attribution (§D-4); ordinary tools ignore these fields.
        ctx = InvocationContext(
            actor=actor,
            privilege=privilege,
            interactive=interactive,
            deps=self._deps,
            confirm_token=None,
            depth=depth,
            agent=agent,
            origin=origin,
        )
        started = time.monotonic()
        # Per-tool deadline (DESIGN/E0a). `timeout_s=None` (the default) ⇒ NO bound — a tool we
        # haven't explicitly capped can never be cut off, so a too-tight global timeout can't bite us.
        # Note: this gives up *waiting*; it does NOT kill the work. A tool blocked in `asyncio.to_thread`
        # (e.g. getaddrinfo) keeps running in its thread until it returns — Python threads aren't
        # cancellable — and is then discarded. Harmless for a single-user panel; don't expect a kill.
        timeout = tool.spec.timeout_s
        try:
            if timeout and timeout > 0:
                result = await asyncio.wait_for(tool.run(inp, ctx), timeout)
            else:
                result = await tool.run(inp, ctx)
        except asyncio.TimeoutError, TimeoutError:
            # This arm fires for BOTH our own `wait_for` (a spec bound is set) and a `TimeoutError`
            # raised *inside* the tool with no spec bound (`socket.timeout` IS `TimeoutError` since
            # 3.10). Guard the format: `timeout` is None in the in-tool case, so `{timeout:.0f}` would
            # raise a `TypeError` *inside* the handler and escape `_execute` un-normalized (ACA-6).
            detail = f"after {timeout:.0f}s" if timeout else "(no spec deadline; in-tool timeout)"
            # Honest wording (D47 round 3): `wait_for` gives up WAITING but does not kill the work
            # (Python threads aren't cancellable — see the note above), so a just-started remote command
            # may still run to completion on the host. Say so — the irreducible remote-execution residual.
            result = ToolResult(
                state=RunState.TIMEOUT,
                summary=f"{tool.spec.title} timed out {detail} — it was not cancelled and may still "
                "be completing on the host",
            )
        except Exception as exc:  # noqa: BLE001 — normalize any escape into a clean result
            result = ToolResult(state=RunState.ERROR, summary=f"{tool.spec.title} failed", error=str(exc))
        if result.duration_ms is None:
            result.duration_ms = int((time.monotonic() - started) * 1000)
        return result

    async def record_policy_denial(
        self,
        name: str,
        raw_args: dict,
        result: ToolResult,
        *,
        actor: Actor,
        origin: Origin,
    ) -> Event:
        """Audit a denial the GATE returned `needs_confirm` for but the CALLER resolved as a refusal —
        today exactly one case: a confirm-gated call in a headless session (`decide` deliberately leaves
        the headless mapping to the caller, see its signature).

        A suspend records nothing, by design — the call has not happened yet and may still be allowed.
        But when the caller converts that suspend into a DENIED result there is no owner who could ever
        confirm it, so it IS a decided outcome and belongs in the audit log like any other policy denial
        (post-14d review, MED: an unattended run's refusals were visible only in the transcript). This is
        the SAME `_record` every other outcome takes — a public door onto it, not a second path — so the
        row carries the caller's origin/run_id attribution and `decision="policy"` exactly like the
        gate's own DENY.
        """
        return await self._record(actor, name, raw_args, result, origin=origin, decision="policy")

    async def _record(
        self,
        actor: Actor,
        name: str,
        raw_args: dict,
        result: ToolResult,
        *,
        origin: Origin,
        decision: DecisionReason,
    ) -> Event:
        event = Event(
            actor=actor,
            action=name,
            target=raw_args.get("host_id") or raw_args.get("service_id"),
            status=result.state,
            summary=result.summary,
            output=result.output,
            origin=origin.kind,
            origin_id=origin.id,
            run_id=origin.run_id,
            decision=decision,
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

    def confirm_token_for(self, name: str, raw_args: dict) -> str:
        """Mint a confirm token for a call whose confirmation is already established by DURABLE state
        (J3): an agent `resume(execute)` of a persisted `AWAITING_CONFIRM` call. The confirm token is
        an in-memory UX gate (SECURITY_MODEL §2.3) — it dies on a backend restart / 120s expiry / a
        client reload, which would strand the persisted bubble. Rather than depend on that ephemeral
        token surviving, the resume path re-mints one here for the pending call, so the very next
        `invoke` consumes it and the action runs in one click. Uses the SAME `(name, args_json)`
        binding `invoke` computes (`input_model.model_validate(...).model_dump_json()`), so the mint
        always matches. Safe: the caller only mints after finding the call persisted `AWAITING_CONFIRM`
        (the gate legitimately fired) and the owner explicitly chose `execute` — the two-step approval
        is intact; this only removes the fragile ephemeral dependency.

        ACA-9 (owner 2026-07-16, CONSUME) / C2-M1 single-liveness on the re-mint path: any confirm token
        already outstanding for this SAME pending `(action, args)` is consumed here before the re-mint,
        so exactly ONE live token remains afterward. The orphaned original has no legitimate redeemer —
        its bubble is being resolved right now — so a two-device double-tap of the stale Allow fails
        cleanly instead of firing the action a second time via `/api/actions`. (This deliberate re-mint
        consume is scoped to `confirm_token_for`, NOT the generic gate `_mint_token`: a plain CONFIRM
        re-ask on a stale token must be free to mint its own UX token without evicting a legitimately
        outstanding re-minted one — the J3 recovery invariant.) Restart-safe: `_pending` is empty after a
        restart (the token-loss case this method exists for), so there is simply nothing to consume."""
        inp = self._registry.get(name).spec.input_model.model_validate(raw_args)
        args_json = inp.model_dump_json()
        self._invalidate_pending(name, args_json)
        return self._mint_token(name, args_json)

    def revoke_pending(self, action: str, raw_args: dict) -> None:
        """Revoke any live confirm token bound to this exact `(action, args)` — the dismiss path
        (C1-H2/C2-M1). When the owner denies a confirm bubble, its token must die so it can't be
        redeemed via POST /api/actions inside the 120s TTL. Uses the SAME `(action, args_json)` binding
        `invoke`/`_mint_token` compute, so it targets exactly the token(s) the gate minted. Unknown tool
        / invalid persisted args → no token was ever minted, so treat as a clean no-op (never raise on a
        dismiss)."""
        try:
            inp = self._registry.get(action).spec.input_model.model_validate(raw_args)
        except UnknownTool, ValidationError:
            return  # nothing could have been minted for an unresolvable (tool, args)
        self._invalidate_pending(action, inp.model_dump_json())

    def begin_execute(self, call_id: str) -> bool:
        """Single-flight guard (J2) for `resume(execute)`: reserve a pending call's execution so a
        concurrent double-execute (double-tap, or two browser tabs) of the SAME call can't fire a
        non-idempotent action twice. Returns False if it's already in flight, else reserves it and
        returns True. The membership test + add are synchronous with no `await` between them, so they
        run atomically under the single-threaded event loop. Pair every True with `end_execute` in a
        `finally`. (Sequential re-execute is already blocked by the durable resolved state; this only
        closes the concurrent window the server-side re-mint opened by dropping single-use tokens.)"""
        if call_id in self._inflight:
            return False
        self._inflight.add(call_id)
        return True

    def end_execute(self, call_id: str) -> None:
        """Release a `begin_execute` reservation (idempotent)."""
        self._inflight.discard(call_id)

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

    def _invalidate_pending(self, action: str, args_json: str) -> None:
        """Drop every outstanding confirm token bound to this exact `(action, args)` — the orphan
        consume for the resume re-mint (ACA-9). A no-op when nothing matches (e.g. after a restart)."""
        for tok in [t for t, p in self._pending.items() if p.action == action and p.args_json == args_json]:
            del self._pending[tok]

    def _sweep(self) -> None:
        now = time.monotonic()
        for tok in [t for t, p in self._pending.items() if p.expires_at < now]:
            del self._pending[tok]
