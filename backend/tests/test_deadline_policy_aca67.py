"""ACA-6/ACA-7 (Slice 1 items 2–3) — the per-tool deadline policy + the timeout-normalizer guard.

Two guarantees, one file:

  ACA-6 (normalizer guard): `ActionService._execute`'s timeout arm catches BOTH our own `wait_for`
  firing (a spec bound is set) AND a `TimeoutError` raised *inside* a tool with no spec bound
  (`socket.timeout` IS `TimeoutError` since 3.10). The un-bounded case formats `{timeout:.0f}` on a
  `None`, which would `TypeError` inside the handler and escape un-normalized. Tests drive both
  shapes through the real `ActionService`.

  ACA-7 (backstop deadlines + policy): every SSH-backed fleet action declares the shared
  `SSH_ACTION_TIMEOUT_S` backstop (paramiko's timeout doesn't cover `getaddrinfo`); and the whole
  registry obeys the policy "every tool declares `timeout_s` OR is documented in `ADAPTER_BOUNDED`
  (or is a dynamically-registered integration tool)". The walk test is fail-closed: a new tool with
  no bound that isn't triaged into the allowlist fails here.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async

from app.core.tool import ADAPTER_BOUNDED
from app.services.actions import build_registry
from app.services.actions._common import SSH_ACTION_TIMEOUT_S

# The SSH-backed fleet actions that reach a host over paramiko (via ssh.run_command /
# run_service_command) — the ones whose only pre-fix bound was paramiko's DNS-blind `timeout=10`.
SSH_BACKED_ACTIONS = {
    "reboot_host",
    "shutdown_host",
    "restart_service",
    "start_service",
    "stop_service",
}


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "computers: {}\n"):
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


# ── ACA-6: the timeout-normalizer guard ──────────────────────────────────────────────────────────


def _register_stub(registry, name: str, fn, *, timeout_s):
    """Register a throwaway LOW-risk tool (auto-runs at FULL) into the shared registry. The caller
    removes it in a finally so it can't leak into the registry-walk test."""
    from pydantic import BaseModel

    from app.core.tool import FunctionTool, ToolSpec

    class _NoArgs(BaseModel):
        pass

    spec = ToolSpec(name=name, title=name, input_model=_NoArgs, timeout_s=timeout_s)
    registry.register(FunctionTool(spec=spec, fn=fn))


def test_in_tool_timeout_with_no_spec_bound_normalizes_cleanly() -> None:
    """A tool that raises `TimeoutError` itself while its spec sets no `timeout_s` → a clean TIMEOUT
    ToolResult whose summary neither crashes nor contains the literal 'None' (the ACA-6 guard)."""
    from app.domain.enums import Actor, Privilege, RunState

    async def _raises_timeout(inp, ctx):  # noqa: ARG001
        raise TimeoutError("socket operation timed out")  # what socket.timeout raises from inside a tool

    with _workspace(), _client() as c:
        reg = c.app.state.actions.registry
        _register_stub(reg, "_stub_intimeout", _raises_timeout, timeout_s=None)
        try:
            out = run_async(
                c.app.state.actions.invoke("_stub_intimeout", {}, actor=Actor.USER, privilege=Privilege.FULL)
            )
        finally:
            reg.remove("_stub_intimeout")

    assert out.result is not None
    assert out.result.state == RunState.TIMEOUT
    assert "None" not in (out.result.summary or "")
    assert "no spec deadline" in (out.result.summary or "")


def test_wait_for_fires_with_a_numeric_message() -> None:
    """A hanging tool WITH a spec bound → `wait_for` fires and the summary carries the numeric
    deadline ('timed out after …s'), not the no-bound wording."""
    import asyncio

    from app.domain.enums import Actor, Privilege, RunState

    async def _hangs(inp, ctx):  # noqa: ARG001
        await asyncio.sleep(30)

    with _workspace(), _client() as c:
        reg = c.app.state.actions.registry
        _register_stub(reg, "_stub_hang", _hangs, timeout_s=0.2)
        try:
            out = run_async(
                c.app.state.actions.invoke("_stub_hang", {}, actor=Actor.USER, privilege=Privilege.FULL)
            )
        finally:
            reg.remove("_stub_hang")

    assert out.result is not None
    assert out.result.state == RunState.TIMEOUT
    assert "timed out after" in (out.result.summary or "")
    assert "no spec deadline" not in (out.result.summary or "")


# ── ACA-7: SSH backstops + the registry-wide deadline policy ──────────────────────────────────────


def test_ssh_backed_actions_declare_the_shared_backstop() -> None:
    reg = build_registry()
    for name in SSH_BACKED_ACTIONS:
        spec = reg.get(name).spec
        assert spec.timeout_s == SSH_ACTION_TIMEOUT_S, (
            f"{name} must declare the shared SSH backstop (getaddrinfo isn't covered by paramiko)"
        )


def _covered(spec) -> bool:
    """A spec satisfies the deadline policy if it declares a bound, is a dynamically-registered
    integration tool (MCP/OpenAPI → category 'mcp'; open-terminal → `terminal_*`; both adapter-
    bounded), or is documented in `ADAPTER_BOUNDED`."""
    return (
        spec.timeout_s is not None
        or spec.category == "mcp"
        or spec.name.startswith("terminal_")
        or spec.name in ADAPTER_BOUNDED
    )


def test_every_registered_tool_has_a_deadline_or_is_documented() -> None:
    """Fail-closed policy walk: no registered tool is left with `timeout_s is None` unless it is
    triaged into `ADAPTER_BOUNDED` (or is an integration tool). A new unbounded tool fails here."""
    reg = build_registry()
    uncovered = sorted(t.spec.name for t in reg.all() if not _covered(t.spec))
    assert not uncovered, f"tools with no deadline and not documented in ADAPTER_BOUNDED: {uncovered}"


def test_adapter_bounded_entries_do_not_also_declare_a_bound() -> None:
    """A tool listed in `ADAPTER_BOUNDED` should NOT also set `timeout_s` — that would be a
    contradiction (documented as adapter-bounded yet carrying a spec bound). Keeps the allowlist from
    rotting into stale entries as tools gain explicit deadlines."""
    reg = build_registry()
    for name in ADAPTER_BOUNDED:
        with contextlib.suppress(KeyError):
            spec = reg.get(name).spec
            assert spec.timeout_s is None, (
                f"{name} is in ADAPTER_BOUNDED but declares timeout_s={spec.timeout_s}; "
                "drop it from the allowlist (it now carries its own bound)"
            )


if __name__ == "__main__":
    for k, v in sorted(globals().items()):
        if k.startswith("test_") and callable(v):
            v()
            print(f"ok  {k}")
