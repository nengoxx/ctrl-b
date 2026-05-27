"""Permission policy — a pure decision over (spec, privilege) (DESIGN.md §3).

No I/O, trivially testable. The same function gates UI actions today and the agent toolset
(Phase 4). Headless callers (`interactive=False`) translate CONFIRM into notify-and-park / the
automation fallback upstream — that policy isn't decided here.

Phase 2 UI actions run at `Privilege.CONFIRM`, which yields exactly: wake/ping → ALLOW,
shutdown (risk=HIGH, confirm=True) → CONFIRM.
"""

from __future__ import annotations

from enum import StrEnum

from app.core.tool import ToolSpec
from app.domain.enums import Privilege, Risk


class Decision(StrEnum):
    ALLOW = "allow"
    CONFIRM = "confirm"
    DENY = "deny"


def decide(
    spec: ToolSpec,
    privilege: Privilege,
    *,
    interactive: bool = True,  # noqa: ARG001 — headless mapping is applied by the caller
    run_shell_allowed: bool = False,
) -> Decision:
    if spec.name == "run_shell" and not run_shell_allowed and privilege != Privilege.FULL:
        return Decision.DENY
    if privilege == Privilege.READONLY and spec.category == "action" and spec.risk != Risk.LOW:
        return Decision.DENY
    if spec.confirm or spec.risk == Risk.HIGH:
        return Decision.ALLOW if privilege == Privilege.FULL else Decision.CONFIRM
    if spec.risk == Risk.MED:
        if privilege in (Privilege.AUTO_LOW, Privilege.FULL):
            return Decision.ALLOW
        return Decision.CONFIRM
    return Decision.ALLOW  # low risk
