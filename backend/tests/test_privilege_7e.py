"""A1 / D16 — per-session privilege override (`ChatRequest.privilege` + `resolve_session_agent`).

The privilege ladder (`core/permissions.decide`) and the per-agent / global-default layers
(`AgentDef.privilege` ← `agent.defaults.privilege`) already exist; A1 adds only the per-session
override + its plumbing. This covers the new bits in isolation (no live model):

  1. validator    — `ChatRequest.privilege` coerces an unknown/blank level to None (lenient, like mode).
  2. override     — `resolve_session_agent` copies the resolved agent with the session privilege.
  3. no override  — None leaves the resolved agent's own privilege untouched.
  4. precedence   — per-session beats per-agent (a specialist's configured privilege).
  5. no clamp     — the session may *raise* (readonly agent → full) or *lower* it.
  6. decide flips — the override changes the gate: a HIGH-risk tool CONFIRMs at `confirm`, ALLOWs at `full`.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path


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


def test_validator_coerces_unknown_and_blank() -> None:
    from app.api.agent import ChatRequest, ResumeRequest

    assert ChatRequest(text="x").privilege is None
    assert ChatRequest(text="x", privilege="").privilege is None
    assert ChatRequest(text="x", privilege="bogus").privilege is None
    assert ChatRequest(text="x", privilege="full").privilege.value == "full"

    # ResumeRequest carries the session level across a confirm round-trip (A1/D16) with the same gate.
    assert ResumeRequest(thread_id="t", call_id="c").privilege is None
    assert ResumeRequest(thread_id="t", call_id="c", privilege="junk").privilege is None
    assert ResumeRequest(thread_id="t", call_id="c", privilege="readonly").privilege.value == "readonly"


def test_override_applies_and_none_is_unchanged() -> None:
    from app.api.agent import resolve_session_agent
    from app.config import Settings
    from app.domain.enums import Privilege

    s = Settings()
    default_priv = s.default_agent_def().privilege
    assert resolve_session_agent(s, None, None).privilege == default_priv      # unchanged
    assert resolve_session_agent(s, None, Privilege.FULL).privilege == Privilege.FULL


def test_session_beats_per_agent_and_does_not_clamp() -> None:
    from app.api.agent import resolve_session_agent
    from app.config import Settings
    from app.domain.enums import Privilege

    # A specialist whose own privilege is READONLY — the session override wins in both directions.
    with _workspace() as tmp:
        agents = tmp / "agents" / "locked"
        agents.mkdir(parents=True)
        (agents / "agent.yaml").write_text("privilege: readonly\n", encoding="utf-8")
        s = Settings.model_validate({})  # loads from the temp $CTRLB_HOME
        assert s.resolve_agent("locked").privilege == Privilege.READONLY
        # raise it
        assert resolve_session_agent(s, "locked", Privilege.FULL).privilege == Privilege.FULL
        # lower an otherwise-permissive call (no clamp either way)
        assert resolve_session_agent(s, "locked", Privilege.READONLY).privilege == Privilege.READONLY


def test_override_changes_the_gate_decision() -> None:
    from app.api.agent import resolve_session_agent
    from app.config import Settings
    from app.core.permissions import Decision, decide
    from app.domain.enums import Privilege
    from app.services.actions import build_registry

    s = Settings()
    spec = build_registry().get("reboot_host").spec  # a HIGH-risk / confirm action
    confirm_agent = resolve_session_agent(s, None, Privilege.CONFIRM)
    full_agent = resolve_session_agent(s, None, Privilege.FULL)
    assert decide(spec, confirm_agent.privilege) is Decision.CONFIRM
    assert decide(spec, full_agent.privilege) is Decision.ALLOW


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
