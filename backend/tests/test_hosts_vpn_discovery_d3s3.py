"""D3 Slice 3 — GET /api/hosts/vpn-discovery endpoint tests.

TestClient over a temp CTRLB_CONFIG/CTRLB_DB (audit E3 — never the real config.yaml), copying
`test_hosts_7b.py`'s fixture. `resolve_vpn_candidates` is stubbed (no real tailscale) so we exercise
the join/fallback/response-contract logic only. Covers: label match fills `proposed` + `current`
reflects the stored `vpn_host`; unmatched host listed; unique-HostName fallback yields a proposal;
ambiguous HostName (shared by two candidates) yields NO proposal; the corsair/corsair-1 case where the
label match wins; tailscale disabled → 403; and the not-ok CLI-failure envelope passthrough.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import app.api.hosts as hosts_api

_ORIG_RESOLVE = hosts_api.resolve_vpn_candidates

_SEED = """\
computers:
  corsair:
    ip: 192.168.1.128
    vpn_host: corsair-old
  alpha:
    ip: 192.168.1.10
  laptop:
    ip: 192.168.1.50
  printer:
    ip: 192.168.1.60
  ghost:
    ip: 192.168.1.99
"""

_SEED_DISABLED = _SEED + "tailscale:\n  enabled: false\n"


def _client(tmp: Path, seed: str = _SEED):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp / "config.yaml"
    cfg.write_text(seed, encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app()), cfg


def _stub(result):
    async def fake(cfg):
        return result

    hosts_api.resolve_vpn_candidates = fake  # type: ignore[assignment]


def _cand(name, address, hostname, online=True):
    return {"name": name, "address": address, "hostname": hostname, "online": online}


def test_join_match_fallback_and_contract() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        _stub(
            {
                "ok": True,
                "candidates": [
                    _cand("corsair", "corsair", "corsair", online=True),
                    _cand("corsair-1", "corsair-1", "corsair", online=False),  # shares HostName "corsair"
                    _cand("alpha", "alpha", "alpha", online=True),
                    _cand("lp-9931", "lp-9931", "laptop", online=True),  # unique HostName fallback
                    _cand("prn-a", "prn-a", "printer", online=True),  # ambiguous HostName "printer"
                    _cand("prn-b", "prn-b", "printer", online=False),
                ],
            }
        )
        client, _cfg = _client(tmp)
        with client as c:
            body = c.get("/api/hosts/vpn-discovery").json()
        assert body["ok"] is True
        results = {r["name"]: r for r in body["results"]}

        # corsair: label match WINS over the shared-HostName ambiguity → proposes the label "corsair",
        # and `current` reflects the stored vpn_host.
        assert results["corsair"]["proposed"] == "corsair"
        assert results["corsair"]["current"] == "corsair-old"
        assert results["corsair"]["online"] is True
        assert results["corsair"]["id"] == "corsair"

        # alpha: plain label match; no stored vpn_host → current null.
        assert results["alpha"]["proposed"] == "alpha"
        assert results["alpha"]["current"] is None

        # laptop: no label match, but HostName "laptop" is unique → fallback proposes "lp-9931".
        assert results["laptop"]["proposed"] == "lp-9931"

        # printer: only an ambiguous HostName ("printer" shared by two candidates) → NO proposal.
        assert "printer" not in results
        assert "printer" in body["unmatched"]

        # ghost: no candidate at all → unmatched.
        assert "ghost" in body["unmatched"]
        # matched hosts never appear in unmatched
        assert set(body["unmatched"]) == {"printer", "ghost"}
    finally:
        hosts_api.resolve_vpn_candidates = _ORIG_RESOLVE  # type: ignore[assignment]
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_tailscale_disabled_403() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        _stub({"ok": True, "candidates": []})  # never reached
        client, _cfg = _client(tmp, _SEED_DISABLED)
        with client as c:
            r = c.get("/api/hosts/vpn-discovery")
        assert r.status_code == 403
    finally:
        hosts_api.resolve_vpn_candidates = _ORIG_RESOLVE  # type: ignore[assignment]
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_fill_style_full_put_preserves_other_fields() -> None:
    """Pins the contract the frontend fill relies on (audit MED-1): the hosts PUT is NOT a PATCH —
    `_apply_fields` omit-preserves only vpn_host/ssh_prefer_vpn, so the fill sends the FULL host body
    (blank ssh_password = keep secret; tags [] = untouched). A fill-shaped PUT must set vpn_host and
    leave mac / os_type / ssh_username / ssh_port / role / services / password intact in the YAML."""
    tmp = Path(tempfile.mkdtemp())
    seed = """\
computers:
  rig:
    ip: 192.168.1.20
    mac: aa:bb:cc:dd:ee:ff
    ssh_username: gamer
    ssh_password: sekrit
    ssh_port: 2222
    os_type: windows
    role: rig
    services:
      sunshine:
        port: 47990
"""
    try:
        client, cfg = _client(tmp, seed)
        with client as c:
            r = c.put(
                "/api/hosts/rig",
                json={
                    "name": "rig",
                    "ip": "192.168.1.20",
                    "vpn_host": "rig",  # the discovered fill
                    "ssh_prefer_vpn": False,
                    "mac": "aa:bb:cc:dd:ee:ff",
                    "ssh_username": "gamer",
                    "ssh_password": "",  # blank → keep the stored secret
                    "ssh_port": 2222,
                    "os_type": "windows",
                    "role": "rig",
                    "tags": [],
                    "services": [
                        {
                            "name": "sunshine",
                            "kind": None,
                            "port": 47990,
                            "path": "",
                            "autostart": False,
                            "cmd": {},
                        }
                    ],
                },
            )
            assert r.status_code == 200, r.text
        text = cfg.read_text(encoding="utf-8")
        assert "vpn_host: rig" in text
        assert "aa:bb:cc:dd:ee:ff" in text
        assert "os_type: windows" in text
        assert "ssh_username: gamer" in text
        assert "ssh_password: sekrit" in text  # blank password kept the secret
        assert "ssh_port: 2222" in text
        assert "role: rig" in text
        assert "sunshine" in text  # service survived
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_cli_failure_envelope_passthrough() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        _stub({"ok": False, "reason": "tailscale CLI not found"})
        client, _cfg = _client(tmp)
        with client as c:
            r = c.get("/api/hosts/vpn-discovery")
        assert r.status_code == 200
        assert r.json() == {"ok": False, "reason": "tailscale CLI not found"}
    finally:
        hosts_api.resolve_vpn_candidates = _ORIG_RESOLVE  # type: ignore[assignment]
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
