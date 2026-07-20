"""Slice 8 / D44 W1 — the approval policy core (backend).

Covers the persisted-approval rung that downgrades a *risk-derived* CONFIRM to ALLOW and NOTHING
else (SLICE8_PLAN §3, §7 invariants). Three layers, no live model / no real config.yaml:

  1. pure policy    — `canonical_str` / `glob_escape` / `approval_match` / `decide(approved=)`.
  2. gate consult   — `ActionService.invoke` reads live `settings.tool_overrides[..].approvals`,
                      passes `approved=`, and stamps the audit marker on the executed Event.
  3. R1             — `run_shell` pinned `confirm=True` is un-approvable; its `decide()` outcomes
                      are byte-identical across the pin.

Fixtures follow `test_privilege_7e.py` (temp-config `_workspace`) + `test_confirm_recovery_j3.py`
(TestClient ActionService). CTRLB_CONFIG/CTRLB_DB temp paths only — never the real config.yaml.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from pydantic import BaseModel, ValidationError


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _run(coro):
    from _async import run_async

    return run_async(coro)


class _In(BaseModel):
    pass


def _spec(risk, *, confirm: bool = False, name: str = "probe", category: str = "action"):
    """A synthesized ToolSpec for pure `decide()` rungs (post-R1 there is no real HIGH+confirm=False
    action, so the ladder is exercised on constructed specs rather than the live registry)."""
    from app.core.tool import ToolSpec

    return ToolSpec(name=name, title=name, input_model=_In, risk=risk, confirm=confirm, category=category)


# ── canonical_str: the one match form ──────────────────────────────────────────────────────────
def test_canonical_str_scalar_forms() -> None:
    from app.core.permissions import canonical_str

    assert canonical_str("ls") == "ls"
    assert canonical_str(True) == "true"  # bool BEFORE int — not "1"
    assert canonical_str(False) == "false"
    assert canonical_str(5) == "5"
    assert canonical_str(1.5) == "1.5"
    assert canonical_str(None) == "null"  # an omitted optional is pinnable (F1)
    assert canonical_str([1, 2]) is None  # non-scalar → not matchable
    assert canonical_str({"a": 1}) is None


# ── glob_escape: literal round-trip ────────────────────────────────────────────────────────────
def test_glob_escape_matches_literal_only() -> None:
    import fnmatch

    from app.core.permissions import glob_escape

    pat = glob_escape("a*b?[c")  # every metachar bracketed
    assert fnmatch.fnmatchcase("a*b?[c", pat)  # the literal string matches
    assert not fnmatch.fnmatchcase("axb?[c", pat)  # the `*` did NOT act as a wildcard


# ── approval_match: OR across rules, AND within a rule ─────────────────────────────────────────
def _rule(args=None):
    from app.config import ApprovalRule

    return ApprovalRule(args=args)


def test_match_or_across_rules_and_within_rule() -> None:
    from app.core.permissions import approval_match

    rules = [_rule({"command": "ls"}), _rule({"command": "df", "cwd": "/tmp"})]
    # OR: either rule can satisfy.
    assert approval_match(rules, {"command": "ls"}) is rules[0]
    assert approval_match(rules, {"command": "df", "cwd": "/tmp"}) is rules[1]
    # AND within: rule[1] needs BOTH fields — one wrong field ⇒ no match, and no earlier rule fits.
    assert approval_match(rules, {"command": "df", "cwd": "/etc"}) is None
    assert approval_match(rules, {"command": "df"}) is None


def test_match_whole_action_grant() -> None:
    from app.core.permissions import approval_match

    assert approval_match([_rule(None)], {"command": "anything"}) is not None  # None args = whole-action
    assert approval_match([_rule({})], {}) is not None  # {} args = whole-action


def test_match_unknown_field_and_nonscalar_are_inert() -> None:
    from app.core.permissions import approval_match

    # A field the call didn't send ⇒ the rule can't match (fail closed).
    assert approval_match([_rule({"missing": "*"})], {"command": "ls"}) is None
    # A non-scalar arg value ⇒ canonical_str is None ⇒ inert (even against `*`).
    assert approval_match([_rule({"items": "*"})], {"items": [1, 2]}) is None


def test_match_unlisted_field_is_unconstrained() -> None:
    from app.core.permissions import approval_match

    # A rule pinning only `command` matches regardless of other args (the Conf widening semantics).
    rule = [_rule({"command": "ls"})]
    assert approval_match(rule, {"command": "ls"}) is not None
    assert approval_match(rule, {"command": "ls", "cwd": "/"}) is not None


def test_match_glob_forms() -> None:
    from app.core.permissions import approval_match

    rule = [_rule({"command": "ls*"})]
    assert approval_match(rule, {"command": "ls"}) is not None
    assert approval_match(rule, {"command": "ls -la"}) is not None
    assert approval_match(rule, {"command": "df"}) is None


def test_match_escaped_literal_star() -> None:
    from app.core.permissions import approval_match, glob_escape

    # A Conf/bubble rule that pins a value CONTAINING a `*` glob-escapes it → matches that exact string.
    rule = [_rule({"command": glob_escape("rm *")})]
    assert approval_match(rule, {"command": "rm *"}) is not None
    assert approval_match(rule, {"command": "rm foo"}) is None  # `*` is literal, not a wildcard


def test_match_canonical_scalar_patterns() -> None:
    from app.core.permissions import approval_match

    assert approval_match([_rule({"flag": "true"})], {"flag": True}) is not None
    assert approval_match([_rule({"flag": "false"})], {"flag": True}) is None
    assert approval_match([_rule({"n": "5"})], {"n": 5}) is not None
    assert approval_match([_rule({"r": "1.5"})], {"r": 1.5}) is not None


def test_match_null_pinned_field_is_exact_F1() -> None:
    """F1: a bubble rule captured from `{command:X}` pins the omitted `cwd` as `"null"`, so it matches
    ONLY cwd-omitted calls and NOT `{command:X, cwd:"/"}`. A rule pinning ONLY `command` DOES match
    both (the deliberate Conf widening)."""
    from app.core.permissions import approval_match

    # invoke passes `model_dump(mode="json")`, so an omitted optional is PRESENT as None → "null".
    exact = [_rule({"command": "rm", "cwd": "null"})]  # bubble args-exact (cwd was omitted → null)
    assert approval_match(exact, {"command": "rm", "cwd": None}) is not None  # cwd omitted → "null"
    assert approval_match(exact, {"command": "rm", "cwd": "/"}) is None  # cwd set ⇒ not the null grant

    wide = [_rule({"command": "rm"})]  # Conf partial rule (cwd unconstrained)
    assert approval_match(wide, {"command": "rm", "cwd": None}) is not None
    assert approval_match(wide, {"command": "rm", "cwd": "/"}) is not None


# ── decide(approved=): the ladder ──────────────────────────────────────────────────────────────
def test_decide_ladder() -> None:
    from app.core.permissions import Decision, decide
    from app.domain.enums import Privilege, Risk

    high = _spec(Risk.HIGH)  # HIGH, confirm=False
    med = _spec(Risk.MED)
    forced = _spec(Risk.HIGH, confirm=True)  # designer forced-confirm rung

    # READONLY + rule → still DENIED (DENY branch precedes all confirm logic; invariant 1).
    assert decide(high, Privilege.READONLY, approved=True) is Decision.DENY
    # spec.confirm=True + rule → still CONFIRM (un-downgradable below FULL; invariant 2).
    assert decide(forced, Privilege.CONFIRM, approved=True) is Decision.CONFIRM
    # MED @ CONFIRM + rule → ALLOW.
    assert decide(med, Privilege.CONFIRM, approved=True) is Decision.ALLOW
    # HIGH-no-confirm @ CONFIRM + rule → ALLOW.
    assert decide(high, Privilege.CONFIRM, approved=True) is Decision.ALLOW
    # No match → the normal risk decision (CONFIRM at this privilege).
    assert decide(med, Privilege.CONFIRM) is Decision.CONFIRM
    assert decide(high, Privilege.CONFIRM) is Decision.CONFIRM


def test_decide_full_is_byte_identical() -> None:
    """FULL-privilege outcomes are unchanged by `approved` (invariant 7)."""
    from app.core.permissions import decide
    from app.domain.enums import Privilege, Risk

    for spec in (_spec(Risk.LOW), _spec(Risk.MED), _spec(Risk.HIGH), _spec(Risk.HIGH, confirm=True)):
        assert decide(spec, Privilege.FULL, approved=True) == decide(spec, Privilege.FULL)


def test_decide_low_unchanged() -> None:
    from app.core.permissions import Decision, decide
    from app.domain.enums import Privilege, Risk

    assert decide(_spec(Risk.LOW), Privilege.CONFIRM) is Decision.ALLOW
    assert decide(_spec(Risk.LOW), Privilege.CONFIRM, approved=True) is Decision.ALLOW


# ── config schema: ApprovalRule ────────────────────────────────────────────────────────────────
def test_approval_rule_forbids_extra_and_coerces_scalars() -> None:
    from app.config import ApprovalRule

    # extra="forbid" (review H1): a typo'd key must 422, not silently become a whole-action grant.
    try:
        ApprovalRule(arg={"command": "ls"})  # typo: `arg` not `args`
    except ValidationError:
        pass
    else:
        raise AssertionError("ApprovalRule must forbid unknown keys")

    # F8: an unquoted YAML scalar coerces to its canonical string form, so it stays matchable.
    assert ApprovalRule(args={"port": 5}).args == {"port": "5"}
    assert ApprovalRule(args={"on": True}).args == {"on": "true"}
    assert ApprovalRule(args={"r": 1.5}).args == {"r": "1.5"}
    assert ApprovalRule(args=None).args is None


# ── gate consult through ActionService.invoke ──────────────────────────────────────────────────
def _set_approvals(actions, name: str, approvals) -> None:
    """Mutate the LIVE shared settings the gate reads (deps.settings IS app.state.settings)."""
    from app.config import ToolOverride

    actions._deps.settings.tool_overrides[name] = ToolOverride(approvals=approvals)


def test_invoke_med_executes_with_matching_rule_and_stamps_marker() -> None:
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        args = {"service_id": "ghost"}
        # No rule yet → MED confirm at CONFIRM.
        out0 = _run(actions.invoke("restart_service", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM))
        assert out0.needs_confirm

        _set_approvals(actions, "restart_service", [ApprovalRule(args={"service_id": "ghost"})])
        out = _run(actions.invoke("restart_service", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM))
        assert not out.needs_confirm  # the approval downgraded CONFIRM → ALLOW, it ran
        assert out.event is not None
        assert "[auto-allowed:" in out.event.summary  # the mandatory audit marker (D44 §6)
        assert "service_id=ghost" in out.event.summary


def test_invoke_marker_whole_action_reads_any_args() -> None:
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        _set_approvals(actions, "restart_service", [ApprovalRule(args=None)])  # whole-action grant
        out = _run(
            actions.invoke(
                "restart_service", {"service_id": "ghost"}, actor=Actor.AGENT, privilege=Privilege.CONFIRM
            )
        )
        assert not out.needs_confirm
        assert out.event is not None and "[auto-allowed: any args]" in out.event.summary


def test_invoke_confirm_true_rule_still_confirms() -> None:
    """reboot_host is `confirm=True` — a matching rule can never downgrade it (invariant 2)."""
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        _set_approvals(actions, "reboot_host", [ApprovalRule(args=None)])
        out = _run(
            actions.invoke("reboot_host", {"host_id": "nope"}, actor=Actor.AGENT, privilege=Privilege.CONFIRM)
        )
        assert out.needs_confirm  # forced-confirm outranks the approval


def test_invoke_readonly_rule_still_denied() -> None:
    """A matching rule can never resurrect a DENY (invariant 1)."""
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        _set_approvals(actions, "reboot_host", [ApprovalRule(args=None)])
        out = _run(
            actions.invoke(
                "reboot_host", {"host_id": "nope"}, actor=Actor.AGENT, privilege=Privilege.READONLY
            )
        )
        assert not out.needs_confirm
        assert out.result is not None and out.result.state.value == "denied"
        assert "[auto-allowed:" not in out.result.summary  # never marked (it did NOT auto-run)


def test_invoke_no_match_confirms() -> None:
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        _set_approvals(actions, "restart_service", [ApprovalRule(args={"service_id": "other"})])
        out = _run(
            actions.invoke(
                "restart_service", {"service_id": "ghost"}, actor=Actor.AGENT, privilege=Privilege.CONFIRM
            )
        )
        assert out.needs_confirm  # the rule didn't match these args


# ── liveness: a revoke wins from the next invoke (invariant 4) ─────────────────────────────────
def test_liveness_grant_then_revoke() -> None:
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    with _workspace(), _client() as c:
        actions = c.app.state.actions
        args = {"service_id": "ghost"}
        _set_approvals(actions, "restart_service", [ApprovalRule(args={"service_id": "ghost"})])
        granted = _run(
            actions.invoke("restart_service", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM)
        )
        assert not granted.needs_confirm  # rule applies

        actions._deps.settings.tool_overrides["restart_service"].approvals = None  # revoke, in place
        revoked = _run(
            actions.invoke("restart_service", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM)
        )
        assert revoked.needs_confirm  # the next invoke is confirmation-gated again


# ── R1: run_shell is un-approvable; decide() outcomes byte-identical across the pin ────────────
def test_run_shell_decide_unchanged_across_pin() -> None:
    from app.core.permissions import Decision, decide
    from app.domain.enums import Privilege
    from app.services.actions import build_registry

    spec = build_registry().get("run_shell").spec
    assert spec.confirm is True  # R1 pin in place
    # The truth table asserted by test_shell_5 — unchanged (HIGH ≡ confirm below FULL).
    assert decide(spec, Privilege.CONFIRM, run_shell_allowed=False) is Decision.DENY
    assert decide(spec, Privilege.FULL, run_shell_allowed=False) is Decision.ALLOW
    assert decide(spec, Privilege.CONFIRM, run_shell_allowed=True) is Decision.CONFIRM
    # …and un-approvable: an approval can NOT downgrade the forced confirm.
    assert decide(spec, Privilege.CONFIRM, run_shell_allowed=True, approved=True) is Decision.CONFIRM


def test_run_shell_unapprovable_through_invoke() -> None:
    from app.config import ApprovalRule
    from app.domain.enums import Actor, Privilege

    # agent_exec on so run_shell isn't DENY'd below FULL — proving the forced-confirm (not the gate) wins.
    cfg = "server:\n  port: 5433\nshell:\n  enabled: true\n  agent_exec_enabled: true\n"
    with _workspace(cfg), _client() as c:
        actions = c.app.state.actions
        _set_approvals(actions, "run_shell", [ApprovalRule(args={"command": "echo hi"})])
        out = _run(
            actions.invoke(
                "run_shell", {"command": "echo hi"}, actor=Actor.AGENT, privilege=Privilege.CONFIRM
            )
        )
        assert out.needs_confirm  # the matching rule is inert against a forced-confirm tool


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
