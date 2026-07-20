"""Permission policy — a pure decision over (spec, privilege) (DESIGN.md §3).

No I/O, trivially testable. The same function gates UI actions today and the agent toolset
(Phase 4). Headless callers (`interactive=False`) translate CONFIRM into notify-and-park / the
automation fallback upstream — that policy isn't decided here.

Phase 2 UI actions run at `Privilege.CONFIRM`, which yields exactly: wake/ping → ALLOW,
shutdown (risk=HIGH, confirm=True) → CONFIRM.

Slice 8 / D44 adds a persisted-approval rung: an owner-authored allow-only rule that matched the
call (`approval_match` below, consulted by `ActionService.invoke`) sets `decide(approved=True)`,
which downgrades a *risk-derived* CONFIRM to ALLOW — and NOTHING else. The precedence ladder is
*ordered-deny-overrides*: policy DENY (structurally first) > designer forced-confirm
(`spec.confirm=True`, un-downgradable below FULL — `approved` is ignored) > persisted approval
(risk CONFIRM→ALLOW) > the normal risk decision. An approval can never resurrect a DENY nor force
a CONFIRM/DENY (allow-only by construction). `canonical_str`/`glob_escape`/`approval_match` are
the single (backend-only) implementation of the match — the FE never serializes rules (§5).
"""

from __future__ import annotations

import fnmatch
import json
from enum import StrEnum
from typing import TYPE_CHECKING

from app.core.tool import ToolSpec
from app.domain.enums import Privilege, Risk

if TYPE_CHECKING:
    from collections.abc import Iterable

    from app.config import ApprovalRule


class Decision(StrEnum):
    ALLOW = "allow"
    CONFIRM = "confirm"
    DENY = "deny"


#: The canonical form of `None` (an omitted/null optional). A NUL-prefixed sentinel, NOT the plain
#: `"null"`: a plain-string arg canonicalizes as-is, so `"null"` as the None form made a None-pinning
#: rule also match a call passing the literal string `"null"` (post-audit MED-2 — invariant 5 was
#: false). No JSON/YAML-authored *text* value realistically contains a NUL, so the two forms can no
#: longer collide. Also a glob no-op (no `*?[`), so `exact_arg_pins` pins it verbatim. Remaining,
#: documented limitation: canonicalization is type-blind for a field typed `int | str`, where `5` and
#: `"5"` still share a form — no tool has such a field today.
NONE_CANON = "\x00null"


def canonical_str(value: object) -> str | None:
    """The one canonical form an arg value is matched in (D44). `str` as-is; other scalars via JSON
    encoding (`true`/`false`/`5`/`1.5`); `None` → `NONE_CANON` (an omitted optional must be pinnable —
    review F1); non-scalar (list/dict/other) → `None`, i.e. not matchable. `bool` is tested before
    `int` because `isinstance(True, int)` is True — a bool must encode as `true`/`false`, not `1`."""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return json.dumps(value)  # true / false
    if isinstance(value, int | float):
        return json.dumps(value)  # 5 / 1.5
    if value is None:
        return NONE_CANON
    return None  # list/dict/other — not expressible as a scalar pattern


def glob_escape(s: str) -> str:
    """Escape the fnmatch metacharacters (`*`, `?`, `[`) so `s` matches as a literal (bracket form,
    like `glob.escape`). Beside `canonical_str` because W2's server-side args-exact rule construction
    escapes each pinned value through here — one source of truth (no FE/JS float-vs-escape divergence,
    review H3)."""
    return s.translate({ord("*"): "[*]", ord("?"): "[?]", ord("["): "[[]"})


def exact_arg_pins(args: dict[str, object]) -> dict[str, str] | None:
    """The args-EXACT pin map for a bubble grant (D44 W2), built from a *validated*
    `model_dump(mode="json")`: every top-level field → `glob_escape(canonical_str(value))`, so a value
    containing `*?[` matches literally. `None` pins as `NONE_CANON` *unescaped* — the sentinel is a
    literal produced by this module, not user text, so it must never be rewritten by the escaper (it
    holds no metacharacters today; bypassing keeps that from becoming a silent dependency). The pin
    map is `None` when ANY field is non-scalar (list/dict) — inexpressible / never-matching. THE one
    computation shared by two W2 call sites: `always_eligible` (a suspend emits `pins is not None`)
    and the grant write (`ApprovalRule(args=pins)`). Value-based, NOT model-based: an optional
    non-scalar field that is `None` on THIS call pins as `NONE_CANON` and stays eligible — only a call
    actually carrying a list/dict (e.g. `spawn_subagents.tasks`) is ineligible."""
    pins: dict[str, str] = {}
    for field, value in args.items():
        canon = canonical_str(value)
        if canon is None:
            return None  # a non-scalar field — the rule can't be expressed as scalar patterns
        pins[field] = canon if value is None else glob_escape(canon)
    return pins


def approval_match(rules: Iterable[ApprovalRule], args: dict[str, object]) -> ApprovalRule | None:
    """The first rule that matches `args`, else None (D44). OR across rules; AND within a rule — a
    rule matches iff EVERY `(field, pattern)` entry does: `field in args`, `canonical_str` non-None,
    `fnmatch.fnmatchcase(canon, pattern)`. `args: None` = whole-action grant (matches any call);
    `args: {}` is the EMPTY AND — it matches only a call whose validated dump is itself empty (a
    zero-field tool). The two are NOT interchangeable (post-audit LOW-1): conflating them made an
    "exact" grant on a zero-field tool a whole-action grant that would silently widen if the tool ever
    gained a field. Fields a rule does NOT list are unconstrained by design (the Conf widening semantics —
    bubble-written rules pin every field, §5, so exact grants stay exact). `fnmatchcase`, not
    `fnmatch` — no OS-dependent case folding in a security matcher (review L2; deliberate divergence
    from the `core/tool.py`/`skills.py` display sites)."""
    for rule in rules:
        patterns = rule.args
        if patterns is None:
            return rule  # whole-action grant
        if not patterns:
            if not args:
                return rule  # the empty AND — satisfied only by a call with no args at all
            continue
        if all(
            field in args
            and (canon := canonical_str(args[field])) is not None
            and fnmatch.fnmatchcase(canon, pattern)
            for field, pattern in patterns.items()
        ):
            return rule
    return None


def decide(
    spec: ToolSpec,
    privilege: Privilege,
    *,
    interactive: bool = True,  # noqa: ARG001 — headless mapping is applied by the caller
    run_shell_allowed: bool = False,
    approved: bool = False,
) -> Decision:
    if spec.name == "run_shell" and not run_shell_allowed and privilege != Privilege.FULL:
        return Decision.DENY
    if privilege == Privilege.READONLY and spec.category == "action" and spec.risk != Risk.LOW:
        return Decision.DENY
    if spec.confirm:  # designer forced-confirm — un-downgradable below FULL (approval ignored; D44)
        return Decision.ALLOW if privilege == Privilege.FULL else Decision.CONFIRM
    if spec.risk == Risk.HIGH:
        return Decision.ALLOW if privilege == Privilege.FULL or approved else Decision.CONFIRM
    if spec.risk == Risk.MED:
        if privilege in (Privilege.AUTO_LOW, Privilege.FULL) or approved:
            return Decision.ALLOW
        return Decision.CONFIRM
    return Decision.ALLOW  # low risk
