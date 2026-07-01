"""6c-2 — Tailscale Serve status parsing + serve command (DECISIONS D20).

Covers the brittle bits the live happy-path test didn't: the `serve status --json` port matching, and
`resolve_status` across available/serving/off/logged-out/CLI-missing — by monkeypatching the subprocess
core (`run_capture`) so no real `tailscale` is needed. Run: `./.venv/Scripts/python.exe tests/test_tailscale_6c2.py`.
"""

from __future__ import annotations

import asyncio

from app.config import TailscaleCfg
from app.core.proc import Capture
from app.services.actions import tailscale as ts

# Real shapes captured from the host (corsair), trimmed.
_STATUS_RUNNING = '{"BackendState":"Running","Self":{"DNSName":"corsair.lobster-vector.ts.net."}}'
_STATUS_STOPPED = '{"BackendState":"Stopped","Self":{}}'
_SERVE_ON = (
    '{"TCP":{"443":{"HTTPS":true}},"Web":{"corsair.lobster-vector.ts.net:443":'
    '{"Handlers":{"/":{"Proxy":"http://127.0.0.1:5173"}}}}}'
)
_SERVE_OFF = "{}"


def test_serves_port():
    assert ts._serves_port(_SERVE_ON, 5173) is True
    assert ts._serves_port(_SERVE_ON, 5190) is False  # different port → not ours
    assert ts._serves_port(_SERVE_OFF, 5173) is False  # serve off
    assert ts._serves_port("", 5173) is False  # empty output
    assert ts._serves_port("not json", 5173) is False  # malformed → False, never raises


def _patch(monkeypatch_pairs, *, has_bin=True):
    """Stub `_bin` + `run_capture` with a queue of canned (output) per call (status, then serve)."""
    outputs = list(monkeypatch_pairs)
    ts._bin_orig = ts._bin  # type: ignore[attr-defined]
    ts._cap_orig = ts.run_capture  # type: ignore[attr-defined]

    async def fake_capture(argv, *, timeout_s, cwd=None):
        return outputs.pop(0)

    ts._bin = lambda: "/usr/bin/tailscale" if has_bin else None  # type: ignore[assignment]
    ts.run_capture = fake_capture  # type: ignore[assignment]


def _unpatch():
    ts._bin = ts._bin_orig  # type: ignore[attr-defined]
    ts.run_capture = ts._cap_orig  # type: ignore[attr-defined]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_status_serving():
    _patch([Capture(0, _STATUS_RUNNING, False), Capture(0, _SERVE_ON, False)])
    try:
        st = _run(ts.resolve_status(TailscaleCfg(target_port=5173)))
    finally:
        _unpatch()
    assert st["available"] and st["serving"]
    assert st["url"] == "https://corsair.lobster-vector.ts.net"
    assert st["reason"] is None


def test_status_available_not_serving():
    _patch([Capture(0, _STATUS_RUNNING, False), Capture(0, _SERVE_OFF, False)])
    try:
        st = _run(ts.resolve_status(TailscaleCfg(target_port=5173)))
    finally:
        _unpatch()
    assert st["available"] and not st["serving"]
    assert st["url"] == "https://corsair.lobster-vector.ts.net"  # prospective URL still shown


def test_status_logged_out():
    _patch([Capture(0, _STATUS_STOPPED, False)])
    try:
        st = _run(ts.resolve_status(TailscaleCfg()))
    finally:
        _unpatch()
    assert not st["available"] and not st["serving"]
    assert "Stopped" in (st["reason"] or "")


def test_status_cli_missing():
    _patch([], has_bin=False)
    try:
        st = _run(ts.resolve_status(TailscaleCfg()))
    finally:
        _unpatch()
    assert not st["available"]
    assert st["reason"] == "tailscale CLI not found"


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
