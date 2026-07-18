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


# ── Adapter-bound tool classes (B6/C2-M3): categories + name-prefixes whose deadline is applied by
# their ADAPTER, not a per-spec `timeout_s`. Each maps to the (module, attribute) that OWNS the bound,
# so acceptance is keyed on a REAL adapter code path — NOT a blanket `category == "mcp"` string match.
# Fail-closed: `_covered` accepts ONLY what is listed here, and `test_adapter_bound_sources_apply_a_
# deadline` asserts every source resolves to a live symbol whose code actually wraps the call in a
# timeout. Add a category/prefix here only alongside its proof.
_ADAPTER_BOUND_CATEGORIES: dict[str, tuple[str, str]] = {
    # MCP tools (McpClient.call wraps connect+handshake+call_tool in `asyncio.timeout(bound)`).
    # NOTE: OpenAPI tools ALSO register category "mcp" but now carry their own `timeout_s` (B5), so
    # they are covered by the `timeout_s is not None` arm — the category arm is for genuine MCP tools.
    "mcp": ("app.adapters.mcp_client", "McpClient"),
}
_ADAPTER_BOUND_NAME_PREFIXES: dict[str, tuple[str, str]] = {
    # open-terminal tools: the OpenTerminalClient httpx client is built with `timeout=cfg.timeout_s`.
    "terminal_": ("app.adapters.openterminal", "OpenTerminalClient"),
}


def _covered(spec) -> bool:
    """A spec satisfies the deadline policy if it declares a bound, belongs to an adapter-bound tool
    class (MCP category / `terminal_*` prefix — each keyed on a real adapter code path in
    `_ADAPTER_BOUND_CATEGORIES`/`_ADAPTER_BOUND_NAME_PREFIXES`, proven by
    `test_adapter_bound_sources_apply_a_deadline`), or is documented in `ADAPTER_BOUNDED`."""
    return (
        spec.timeout_s is not None
        or spec.category in _ADAPTER_BOUND_CATEGORIES
        or any(spec.name.startswith(p) for p in _ADAPTER_BOUND_NAME_PREFIXES)
        or spec.name in ADAPTER_BOUNDED
    )


def test_every_registered_tool_has_a_deadline_or_is_documented() -> None:
    """Fail-closed policy walk: no registered tool is left with `timeout_s is None` unless it is
    triaged into `ADAPTER_BOUNDED` (or is an integration tool). A new unbounded tool fails here."""
    reg = build_registry()
    uncovered = sorted(t.spec.name for t in reg.all() if not _covered(t.spec))
    assert not uncovered, f"tools with no deadline and not documented in ADAPTER_BOUNDED: {uncovered}"


def test_adapter_bound_sources_apply_a_deadline() -> None:
    """B6(a): every adapter-bound acceptance in `_covered` must resolve to a REAL adapter code path
    that actually applies a deadline — so the mcp/terminal escape hatches can never degrade into a
    blanket string match. Assert each (module, attr) source imports + the symbol exists, then cite the
    timeout wrap by symbol presence in the source (`asyncio.timeout` for MCP; the httpx `timeout=` on
    the OpenTerminal client)."""
    import importlib
    import inspect

    # MCP: McpClient.call wraps the whole call lifecycle in `asyncio.timeout(bound)`.
    mod = importlib.import_module(_ADAPTER_BOUND_CATEGORIES["mcp"][0])
    mcp_client = getattr(mod, _ADAPTER_BOUND_CATEGORIES["mcp"][1])
    assert "asyncio.timeout" in inspect.getsource(mcp_client.call), (
        "McpClient.call no longer wraps in asyncio.timeout — the 'mcp' category acceptance is unproven"
    )

    # open-terminal: the OpenTerminalClient httpx client carries `timeout=self._cfg.timeout_s`.
    tmod = importlib.import_module(_ADAPTER_BOUND_NAME_PREFIXES["terminal_"][0])
    term_client = getattr(tmod, _ADAPTER_BOUND_NAME_PREFIXES["terminal_"][1])
    src = inspect.getsource(term_client)
    assert "timeout=" in src and "timeout_s" in src, (
        "OpenTerminalClient no longer sets an httpx timeout — the 'terminal_' prefix acceptance is unproven"
    )


def _fake_spec(name: str, *, category: str = "action", timeout_s=None):
    from pydantic import BaseModel

    from app.core.tool import ToolSpec

    class _NoArgs(BaseModel):
        pass

    return ToolSpec(name=name, title=name, input_model=_NoArgs, category=category, timeout_s=timeout_s)


def _discover_one_openapi_spec(call_timeout_s: float = 60.0):
    """Register a single OpenAPI operation through the REAL `OpenApiToolProvider.discover` path
    (fake httpx client, no network) and return its `ToolSpec` — so the walk exercises the dynamic
    OpenAPI construction, not a hand-built spec."""
    from app.adapters.openapi_tools import OpenApiToolProvider
    from app.config import OpenApiServerCfg
    from app.core.tool import ToolRegistry

    spec_doc = {"paths": {"/do": {"get": {"operationId": "do_it"}}}}

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return spec_doc

    class _FakeHttp:
        async def get(self, _url):
            return _FakeResp()

    server = OpenApiServerCfg(name="srv", base_url="http://x", call_timeout_s=call_timeout_s)
    provider = OpenApiToolProvider([server])
    provider._clients["srv"] = _FakeHttp()  # type: ignore[assignment]
    reg = ToolRegistry()
    run_async(provider.discover(reg))
    return reg.get("api__srv__do_it").spec


def test_dynamic_categories_are_adapter_bounded() -> None:
    """B6(b): the policy holds for DYNAMICALLY-registered tool classes that never appear in
    `build_registry()`. A fake MCP-category tool and a `terminal_*` tool with `timeout_s=None` are
    covered by their adapter class; a real OpenAPI operation (built via `discover`) must now carry its
    own `timeout_s` (B5) and is covered by the bound arm."""
    assert _covered(_fake_spec("mcp__web__search", category="mcp", timeout_s=None)), (
        "an MCP-category tool must be accepted as adapter-bounded"
    )
    assert _covered(_fake_spec("terminal_execute", timeout_s=None)), (
        "a terminal_* tool must be accepted as adapter-bounded"
    )
    openapi_spec = _discover_one_openapi_spec(call_timeout_s=42.0)
    assert openapi_spec.timeout_s == 42.0, "an OpenAPI operation must carry its server's call_timeout_s (B5)"
    assert _covered(openapi_spec)


def test_adapter_bounded_has_no_stale_entries() -> None:
    """B6(c): every `ADAPTER_BOUNDED` key must name a tool that actually exists in the registry — a
    renamed/removed tool leaving a dangling allowlist entry (a silent hole where a NEW tool of that
    name would be waved through unbounded) fails here."""
    reg = build_registry()
    known = {t.spec.name for t in reg.all()}
    stale = sorted(k for k in ADAPTER_BOUNDED if k not in known)
    assert not stale, f"ADAPTER_BOUNDED lists names not in the registry (stale allowlist entries): {stale}"


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
