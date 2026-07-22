"""D3 Slice 3 — `resolve_vpn_candidates` parse/filter tests.

Mirrors `test_tailscale_6c2.py`'s harness (monkeypatch `_bin` + `run_capture` with a canned `Capture`)
so no real `tailscale` is needed — only `status --json` is read (one capture per call). Covers the lenient
parse + the exit-node/Location/foreign-suffix filters + the DNSName→HostName/IP fallback ladder + the
error rungs (BackendState, timeout, bad JSON) + missing-field leniency. Run:
`./.venv/bin/python tests/test_tailscale_d3s3.py`.
"""

from __future__ import annotations

import asyncio
import json

from app.config import TailscaleCfg
from app.core.proc import Capture
from app.services.actions import tailscale as ts

_SUFFIX = "lobster-vector.ts.net"


def _status(**extra) -> str:
    doc = {"BackendState": "Running", "CurrentTailnet": {"MagicDNSSuffix": _SUFFIX}}
    doc.update(extra)
    return json.dumps(doc)


def _patch(capture: Capture, *, has_bin=True):
    ts._bin_orig = ts._bin  # type: ignore[attr-defined]
    ts._cap_orig = ts.run_capture  # type: ignore[attr-defined]

    async def fake_capture(argv, *, timeout_s, cwd=None):
        return capture

    ts._bin = lambda: "/usr/bin/tailscale" if has_bin else None  # type: ignore[assignment]
    ts.run_capture = fake_capture  # type: ignore[assignment]


def _unpatch():
    ts._bin = ts._bin_orig  # type: ignore[attr-defined]
    ts.run_capture = ts._cap_orig  # type: ignore[attr-defined]


def _run(status_json: str, *, has_bin=True, code=0, timed_out=False):
    _patch(Capture(code, status_json, timed_out), has_bin=has_bin)
    try:
        return asyncio.new_event_loop().run_until_complete(ts.resolve_vpn_candidates(TailscaleCfg()))
    finally:
        _unpatch()


def _by_name(res: dict) -> dict:
    return {c["name"]: c for c in res["candidates"]}


def test_happy_self_and_peer():
    res = _run(
        _status(
            Self={
                "DNSName": f"emma.{_SUFFIX}.",
                "HostName": "emma",
                "TailscaleIPs": ["100.64.0.1"],
                "Online": True,
            },
            Peer={
                "nodekey:a": {
                    "DNSName": f"corsair.{_SUFFIX}.",
                    "HostName": "Corsair",
                    "TailscaleIPs": ["100.64.0.2"],
                    "Online": False,
                }
            },
        )
    )
    assert res["ok"] is True
    cands = _by_name(res)
    assert set(cands) == {"emma", "corsair"}
    assert cands["emma"] == {"name": "emma", "address": "emma", "hostname": "emma", "online": True}
    # HostName "Corsair" casefolds; Online absent-default handled; offline peer kept.
    assert cands["corsair"] == {
        "name": "corsair",
        "address": "corsair",
        "hostname": "corsair",
        "online": False,
    }


def test_exit_node_and_location_skipped():
    res = _run(
        _status(
            Peer={
                "k:1": {"DNSName": f"mullvad-us.{_SUFFIX}.", "ExitNodeOption": True},
                "k:2": {"DNSName": f"se-sto.{_SUFFIX}.", "Location": {"Country": "Sweden"}},
                "k:3": {"DNSName": f"keep.{_SUFFIX}.", "TailscaleIPs": ["100.64.0.9"]},
            }
        )
    )
    assert res["ok"] is True
    assert [c["name"] for c in res["candidates"]] == ["keep"]


def test_foreign_suffix_skipped():
    res = _run(
        _status(
            Peer={
                "k:1": {"DNSName": "stranger.other-tailnet.ts.net.", "TailscaleIPs": ["100.99.0.1"]},
                "k:2": {"DNSName": f"friend.{_SUFFIX}.", "TailscaleIPs": ["100.64.0.5"]},
            }
        )
    )
    assert [c["name"] for c in res["candidates"]] == ["friend"]


def test_trailing_dot_and_lowercasing():
    res = _run(_status(Self={"DNSName": f"Foo-BAR.{_SUFFIX}.", "HostName": "Foo-BAR"}))
    c = res["candidates"][0]
    assert c["name"] == "foo-bar"  # first dot-label, trailing dot stripped, lowercased
    assert c["address"] == "foo-bar"


def test_dnsname_empty_falls_back_to_hostname_and_ip():
    res = _run(
        _status(
            Peer={
                "k:1": {
                    "DNSName": "",
                    "HostName": "NAS",
                    "TailscaleIPs": ["100.64.0.7", "fd7a::1"],
                    "Online": True,
                }
            }
        )
    )
    c = res["candidates"][0]
    assert c["name"] == "nas"  # HostName casefolded
    assert c["address"] == "100.64.0.7"  # first (IPv4) TailscaleIP
    assert c["hostname"] == "nas"


def test_peer_without_dnsname_or_ips_skipped():
    res = _run(_status(Peer={"k:1": {"HostName": "ghost"}}))
    assert res["candidates"] == []


def test_backend_not_running():
    res = _run(json.dumps({"BackendState": "Stopped", "Self": {}}))
    assert res["ok"] is False
    assert "Stopped" in res["reason"]


def test_timeout():
    res = _run("", timed_out=True)
    assert res["ok"] is False
    assert res["reason"] == "tailscale not responding"


def test_bad_json():
    res = _run("not json at all")
    assert res["ok"] is False
    assert res["reason"] == "could not parse tailscale status"


def test_cli_missing():
    res = _run("", has_bin=False)
    assert res["ok"] is False
    assert res["reason"] == "tailscale CLI not found"


def test_missing_fields_leniency():
    # No Self, no CurrentTailnet, a Peer that is just {} — must not KeyError, yields no candidate.
    res = _run(json.dumps({"BackendState": "Running", "Peer": {"k:1": {}}}))
    assert res == {"ok": True, "candidates": []}


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
