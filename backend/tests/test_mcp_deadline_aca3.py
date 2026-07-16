"""ACA-3 · MCP session-handshake deadline (Slice 1 item 1).

Proves the per-operation deadline now wraps the WHOLE lifecycle — transport connect + the
`initialize()` handshake + the op (`list_tools`/`call_tool`) — in one `asyncio.timeout`, for both
`discover` and `call`, so a never-handshaking stdio server can't hang a turn (or startup). Also
proves: the effective bound is `call_timeout_s` if set else `connect_timeout_s` (ACA-3b); the
anyio cancel-scope `RuntimeError` from a mid-`initialize` timeout is normalized (never escapes);
and a non-timeout error still routes to a clean ERROR.

Runs via `python tests/test_mcp_deadline_aca3.py` or pytest. No network / real MCP server needed —
the real-subprocess cases use a stdio child that only sleeps (never speaks MCP), the rest stub
`_session` so the deadline fires deterministically and fast (bounds are 0.3–0.6 s)."""

from __future__ import annotations

import sys
import time
from contextlib import asynccontextmanager

from app.adapters.mcp_client import McpClient, _is_cancel_scope_error
from app.config import McpServerCfg
from app.core.tool import ToolRegistry
from app.domain.enums import RunState
from tests._async import run_async

# A cancel-scope subprocess would be flaky; a plain sleeper is the "never handshakes" stdio server.
_SLEEP_ARGS = ["-c", "import time; time.sleep(600)"]
_CANCEL_SCOPE_MSG = "Attempted to exit cancel scope in a different task than it was entered in"


def _stdio_cfg(**over) -> McpServerCfg:
    base = dict(name="hung", transport="stdio", command=sys.executable, args=_SLEEP_ARGS)
    base.update(over)
    return McpServerCfg(**base)  # type: ignore[arg-type]


# --- Fake sessions so the deadline / error paths fire deterministically ----------------------


class _HangSession:
    """A session whose ops never return — the `asyncio.timeout` must cut them off at the bound."""

    async def list_tools(self):
        import asyncio

        await asyncio.sleep(600)

    async def call_tool(self, name, args):
        import asyncio

        await asyncio.sleep(600)


class _HangClient(McpClient):
    @asynccontextmanager
    async def _session(self, server):  # type: ignore[override]
        yield _HangSession()


class _RaiseClient(McpClient):
    """`_session` entry raises a chosen exception (before any op) — models a handshake blowing up."""

    def __init__(self, servers, exc: BaseException) -> None:
        super().__init__(servers)
        self._exc = exc

    @asynccontextmanager
    async def _session(self, server):  # type: ignore[override]
        raise self._exc
        yield  # pragma: no cover — makes this a generator


# --- Unit: cancel-scope classifier ------------------------------------------------------------


def test_is_cancel_scope_error() -> None:
    assert _is_cancel_scope_error(RuntimeError(_CANCEL_SCOPE_MSG))
    assert not _is_cancel_scope_error(RuntimeError("some other runtime error"))
    assert not _is_cancel_scope_error(ValueError("nope"))
    # wrapped in a (Base)ExceptionGroup (anyio may surface the unwind that way)
    grp = ExceptionGroup("boom", [ValueError("x"), RuntimeError(_CANCEL_SCOPE_MSG)])
    assert _is_cancel_scope_error(grp)


# --- Real stdio subprocess: never-handshaking server ------------------------------------------


def test_discover_stdio_never_handshakes_times_out_fast() -> None:
    """discover against a stdio child that never speaks MCP → per-server error summary (isolation
    preserved, not raised); wall-clock within connect_timeout_s + cleanup margin, never hangs."""
    cfg = _stdio_cfg(connect_timeout_s=0.5)
    client = McpClient([cfg])
    reg = ToolRegistry()

    t0 = time.monotonic()
    summary = run_async(client.discover(reg))
    elapsed = time.monotonic() - t0

    assert elapsed < 5.0, f"discover hung/too slow: {elapsed:.2f}s"  # 0.5 bound + fixed ~2s SDK kill + slack
    assert len(summary) == 1
    row = summary[0]
    assert row["server"] == "hung"
    assert row["tools"] == 0
    assert "0.5s" in (row["error"] or ""), row
    assert reg.all() == []  # nothing registered from a dead server


def test_call_stdio_never_handshakes_times_out_fast() -> None:
    """call against the same hung stdio server → clean TIMEOUT ToolResult within bound + margin,
    including subprocess cleanup; no exception reaches the caller."""
    cfg = _stdio_cfg(connect_timeout_s=0.5)
    client = McpClient([cfg])

    t0 = time.monotonic()
    res = run_async(client.call(cfg, "whatever", {}))
    elapsed = time.monotonic() - t0

    assert elapsed < 5.0, f"call hung/too slow: {elapsed:.2f}s"  # 0.5 bound + fixed ~2s SDK kill + slack
    assert res.state is RunState.TIMEOUT, res
    assert "0.5s" in (res.error or ""), res
    assert res.summary == "whatever timed out"


# --- Bound selection: call_timeout_s honored / falls back -------------------------------------


def test_call_timeout_s_honored_when_set() -> None:
    """With call_timeout_s set, the call uses it (NOT connect_timeout_s) — ACA-3b. The effective
    bound shows in the error message and drives the wall-clock."""
    cfg = McpServerCfg(name="h", transport="stdio", command="x", connect_timeout_s=30.0, call_timeout_s=0.3)
    client = _HangClient([cfg])

    t0 = time.monotonic()
    res = run_async(client.call(cfg, "t", {}))
    elapsed = time.monotonic() - t0

    assert res.state is RunState.TIMEOUT, res
    assert "0.3s" in (res.error or ""), res  # the call budget, not the 30s connect budget
    assert elapsed < 2.0, f"used the wrong (longer) bound: {elapsed:.2f}s"


def test_call_falls_back_to_connect_timeout_when_unset() -> None:
    """call_timeout_s=None → the call budget falls back to connect_timeout_s."""
    cfg = McpServerCfg(name="h", transport="stdio", command="x", connect_timeout_s=0.4)
    assert cfg.call_timeout_s is None
    client = _HangClient([cfg])

    res = run_async(client.call(cfg, "t", {}))
    assert res.state is RunState.TIMEOUT, res
    assert "0.4s" in (res.error or ""), res


# --- Cancel-mid-initialize normalization (no RuntimeError escapes) -----------------------------


def test_call_cancel_scope_runtimeerror_normalized_to_timeout() -> None:
    """A timeout firing mid-`initialize()` can surface as the anyio cancel-scope RuntimeError. It
    must normalize to a TIMEOUT result, never bubble into the agent loop."""
    cfg = McpServerCfg(name="h", transport="stdio", command="x", connect_timeout_s=5.0)
    client = _RaiseClient([cfg], RuntimeError(_CANCEL_SCOPE_MSG))

    res = run_async(client.call(cfg, "t", {}))  # must NOT raise
    assert res.state is RunState.TIMEOUT, res
    assert "5.0s" in (res.error or ""), res


def test_discover_cancel_scope_runtimeerror_normalized() -> None:
    """Same hazard on the discovery path → a timed-out summary row, isolation preserved."""
    cfg = McpServerCfg(name="h", transport="stdio", command="x", connect_timeout_s=5.0)
    client = _RaiseClient([cfg], RuntimeError(_CANCEL_SCOPE_MSG))

    summary = run_async(client.discover(ToolRegistry()))  # must NOT raise
    assert summary == [{"server": "h", "tools": 0, "error": "discovery timed out after 5.0s"}]


# --- Non-timeout errors still route to a clean ERROR (not mislabeled TIMEOUT) ------------------


def test_call_generic_runtimeerror_is_error_not_timeout() -> None:
    """A plain RuntimeError (not the cancel-scope shape) is a real failure → ERROR, not TIMEOUT."""
    cfg = McpServerCfg(name="h", transport="stdio", command="x", connect_timeout_s=5.0)
    client = _RaiseClient([cfg], RuntimeError("connection reset by peer"))

    res = run_async(client.call(cfg, "t", {}))
    assert res.state is RunState.ERROR, res
    assert res.summary == "t failed"
    assert "connection reset" in (res.error or "")


def test_call_mcperror_is_unavailable() -> None:
    """The McpError config/transport-unsupported path stays ERROR/`unavailable` (regression guard)."""
    from app.adapters.mcp_client import McpError

    cfg = McpServerCfg(name="h", transport="stdio", command="x", connect_timeout_s=5.0)
    client = _RaiseClient([cfg], McpError("no command configured for stdio server"))

    res = run_async(client.call(cfg, "t", {}))
    assert res.state is RunState.ERROR, res
    assert res.summary == "t unavailable"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
