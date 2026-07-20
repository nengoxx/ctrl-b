"""Phase 7b — hosts + services CRUD round-trip tests.

Runs as `python tests/test_hosts_7b.py` from backend/ (plain asserts + a __main__ runner) or under
pytest. Uses a **temp** CTRLB_CONFIG/CTRLB_DB (audit E3 — never the operator's real config.yaml).
Covers: list DTO (has_password, no secret, services), add (+409 collision), edit (blank password
kept, comments preserved, service add/remove synced, multi-OS cmd preserved), rename (re-keyed id,
services carried), delete, and 422 on bad input.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from app.config import load_settings

_SEED = """\
# my fleet
computers:
  alpha:
    ip: 192.168.1.10
    ssh_username: root
    ssh_password: SECRET-A
    ssh_port: 22
    os_type: linux
    role: nas
    appearance:
      frontier:
        image: rig4
        x: 42
        y: 61
    services:
      web:
        kind: nginx
        port: 80
        cmd:
          start:
            linux: systemctl start nginx
            windows: net start nginx
# trailing note
"""


def _client(tmp: Path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp / "config.yaml"
    cfg.write_text(_SEED, encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app()), cfg


def _host(c, hid):
    return next((h for h in c.get("/api/hosts").json() if h["id"] == hid), None)


def test_hosts_crud_roundtrip() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            # --- list DTO ---
            alpha = _host(c, "alpha")
            assert alpha is not None
            assert alpha["has_password"] is True
            assert "ssh_password" not in alpha  # secret never leaves the server
            assert alpha["services"][0]["name"] == "web"
            assert alpha["services"][0]["cmd"]["start"]["windows"] == "net start nginx"

            # --- add (201) + collision (409) ---
            r = c.post("/api/hosts", json={"name": "beta", "ip": "192.168.1.20", "os_type": "windows"})
            assert r.status_code == 201, r.text
            assert _host(c, "beta") is not None
            after_add = cfg.read_text(encoding="utf-8")
            assert (
                "# my fleet" in after_add and "# trailing note" in after_add
            )  # non-destructive add keeps all
            assert c.post("/api/hosts", json={"name": "Alpha", "ip": "1.2.3.4"}).status_code == 409

            # --- edit: change ip, blank password (keep), swap services (remove web, add db),
            #     re-submit web? no — only db now, so web should be deleted by the sync ---
            r = c.put(
                "/api/hosts/alpha",
                json={
                    "name": "alpha",
                    "ip": "192.168.1.11",
                    "ssh_username": "root",
                    "ssh_password": "",
                    "ssh_port": 22,
                    "os_type": "linux",
                    "role": "nas",
                    "services": [{"name": "db", "kind": "postgres", "port": 5432}],
                },
            )
            assert r.status_code == 200, r.text
            s = load_settings(cfg)
            assert s.computers["alpha"].ip == "192.168.1.11"
            assert s.computers["alpha"].ssh_password == "SECRET-A"  # blank kept the secret
            assert set(s.computers["alpha"].services) == {"db"}  # web removed, db added
            # Leading comments (the owner's style — attached to the following key) survive deletions.
            # (A comment physically trailing a *deleted* element is dropped with it — ruamel limitation.)
            assert "# my fleet" in cfg.read_text(encoding="utf-8")

            # --- rename: alpha -> gamma (id re-slugs, services carried, secret kept) ---
            r = c.put(
                "/api/hosts/alpha",
                json={
                    "name": "gamma node",
                    "ip": "192.168.1.11",
                    "ssh_password": "",
                    "ssh_port": 22,
                    "os_type": "linux",
                    "services": [{"name": "db", "kind": "postgres", "port": 5432}],
                },
            )
            assert r.status_code == 200, r.text
            assert r.json()["id"] == "gamma-node"
            s = load_settings(cfg)
            assert "alpha" not in s.computers and "gamma node" in s.computers
            assert s.computers["gamma node"].ssh_password == "SECRET-A"
            assert "db" in s.computers["gamma node"].services

            # --- delete ---
            assert c.delete("/api/hosts/gamma-node").status_code == 204
            assert _host(c, "gamma-node") is None
            assert c.delete("/api/hosts/gamma-node").status_code == 404

            # --- 422: missing ip ---
            assert c.post("/api/hosts", json={"name": "noip"}).status_code == 422
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_vpn_host_fields_roundtrip() -> None:
    """D47 Slice 1: `vpn_host` + `ssh_prefer_vpn` round-trip through create/update, the DTO exposes
    both (never a password), and an omitted field defaults to None/False and is absent from the file."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            # --- create WITH both fields ---
            r = c.post(
                "/api/hosts",
                json={
                    "name": "corsair",
                    "ip": "192.168.1.128",
                    "vpn_host": "corsair",  # MagicDNS name (generic — no vendor string in config/logic)
                    "ssh_prefer_vpn": True,
                    "os_type": "windows",
                },
            )
            assert r.status_code == 201, r.text
            dto = _host(c, "corsair")
            assert dto["vpn_host"] == "corsair"
            assert dto["ssh_prefer_vpn"] is True
            assert "ssh_password" not in dto  # unchanged: secret never leaves the server
            s = load_settings(cfg)
            assert s.computers["corsair"].vpn_host == "corsair"
            assert s.computers["corsair"].ssh_prefer_vpn is True

            # --- create WITHOUT them → None/False, and absent from the YAML entry ---
            assert c.post("/api/hosts", json={"name": "beta", "ip": "192.168.1.20"}).status_code == 201
            beta = _host(c, "beta")
            assert beta["vpn_host"] is None and beta["ssh_prefer_vpn"] is False
            after = load_settings(cfg).computers["beta"]
            assert after.vpn_host is None and after.ssh_prefer_vpn is False
            assert "vpn_host:" not in cfg.read_text(encoding="utf-8").split("beta:")[1].split("corsair:")[0]

            # --- update: set both on beta ---
            r = c.put(
                "/api/hosts/beta",
                json={"name": "beta", "ip": "192.168.1.20", "vpn_host": "beta-vpn", "ssh_prefer_vpn": True},
            )
            assert r.status_code == 200, r.text
            b2 = load_settings(cfg).computers["beta"]
            assert b2.vpn_host == "beta-vpn" and b2.ssh_prefer_vpn is True

            # --- OMIT-PRESERVES (Codex HIGH-2): an edit that DOESN'T send the fields keeps them ---
            # (the shipped MachineEditor never sends them — this edit must not wipe a configured VPN).
            r = c.put("/api/hosts/beta", json={"name": "beta", "ip": "192.168.1.21"})
            assert r.status_code == 200, r.text
            b3 = load_settings(cfg).computers["beta"]
            assert b3.ip == "192.168.1.21"  # the unrelated edit landed
            assert b3.vpn_host == "beta-vpn" and b3.ssh_prefer_vpn is True  # PRESERVED, not wiped

            # --- explicit null/false DOES clear (Slice-2 editor semantics) ---
            r = c.put(
                "/api/hosts/beta",
                json={"name": "beta", "ip": "192.168.1.21", "vpn_host": None, "ssh_prefer_vpn": False},
            )
            assert r.status_code == 200, r.text
            b4 = load_settings(cfg).computers["beta"]
            assert b4.vpn_host is None and b4.ssh_prefer_vpn is False  # explicitly cleared
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_multi_os_cmd_preserved() -> None:
    """Editing a service while submitting the full `cmd` it received keeps the other-OS commands."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            web = _host(c, "alpha")["services"][0]  # carries both-OS start cmd
            r = c.put(
                "/api/hosts/alpha",
                json={
                    "name": "alpha",
                    "ip": "192.168.1.10",
                    "ssh_port": 22,
                    "os_type": "linux",
                    "ssh_password": "",
                    "services": [web],  # echo the full service back
                },
            )
            assert r.status_code == 200, r.text
            cmd = load_settings(cfg).computers["alpha"].services["web"].cmd
            assert cmd["start"]["windows"] == "net start nginx"  # other-OS entry survived
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_appearance_passthrough_and_preserved() -> None:
    """The §9.9 per-host appearance blob (frontier F2) surfaces verbatim in GET /api/hosts, a host without
    one reports `{}`, and editing a host through the form PRESERVES an existing blob (the form doesn't manage
    `appearance`, so `_apply_fields` leaves the node's key untouched — no code, just verified here)."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            # --- pass-through: alpha's configured appearance surfaces unchanged ---
            alpha = _host(c, "alpha")
            assert alpha["appearance"] == {"frontier": {"image": "rig4", "x": 42, "y": 61}}

            # --- a host WITHOUT an appearance entry reports {} (not null/missing) ---
            r = c.post("/api/hosts", json={"name": "beta", "ip": "192.168.1.20"})
            assert r.status_code == 201, r.text
            assert _host(c, "beta")["appearance"] == {}

            # --- preserved across a form edit that doesn't touch appearance (change ip only) ---
            r = c.put(
                "/api/hosts/alpha",
                json={
                    "name": "alpha",
                    "ip": "192.168.1.99",
                    "ssh_username": "root",
                    "ssh_password": "",
                    "ssh_port": 22,
                    "os_type": "linux",
                    "role": "nas",
                    "services": [],
                },
            )
            assert r.status_code == 200, r.text
            assert s_appearance(load_settings(cfg)) == {"frontier": {"image": "rig4", "x": 42, "y": 61}}
            # and it still round-trips out through the DTO after the edit
            assert _host(c, "alpha")["appearance"] == {"frontier": {"image": "rig4", "x": 42, "y": 61}}
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def s_appearance(settings: object) -> dict:
    """The stored appearance blob for `alpha` (config layer), for the preservation assertion."""
    return settings.computers["alpha"].appearance  # type: ignore[attr-defined]


def test_self_flag_matches_server_hostname(monkeypatch) -> None:
    """`self` marks the fleet entry whose name equals the server's hostname (casefolded) — and nothing
    else. No matching entry (the default here: this test box isn't named alpha/bravo) → all false, the
    silent no-op the design specifies."""
    import app.api.hosts as hosts_api

    tmp = Path(tempfile.mkdtemp())
    try:
        client, _cfg = _client(tmp)
        with client as c:
            # default: the test machine's hostname matches no seeded entry → nobody is self
            assert all(h["self"] is False for h in c.get("/api/hosts").json())

            # the server IS one of its own fleet entries (emma's deployment shape) — case-insensitive
            monkeypatch.setattr(hosts_api, "_SELF_HOSTNAME", "Alpha".casefold())
            hosts = c.get("/api/hosts").json()
            assert _host(c, "alpha")["self"] is True
            assert sum(h["self"] for h in hosts) == 1
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
