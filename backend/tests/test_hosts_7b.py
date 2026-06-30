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
            assert "ssh_password" not in alpha            # secret never leaves the server
            assert alpha["services"][0]["name"] == "web"
            assert alpha["services"][0]["cmd"]["start"]["windows"] == "net start nginx"

            # --- add (201) + collision (409) ---
            r = c.post("/api/hosts", json={"name": "beta", "ip": "192.168.1.20", "os_type": "windows"})
            assert r.status_code == 201, r.text
            assert _host(c, "beta") is not None
            after_add = cfg.read_text(encoding="utf-8")
            assert "# my fleet" in after_add and "# trailing note" in after_add  # non-destructive add keeps all
            assert c.post("/api/hosts", json={"name": "Alpha", "ip": "1.2.3.4"}).status_code == 409

            # --- edit: change ip, blank password (keep), swap services (remove web, add db),
            #     re-submit web? no — only db now, so web should be deleted by the sync ---
            r = c.put("/api/hosts/alpha", json={
                "name": "alpha", "ip": "192.168.1.11", "ssh_username": "root",
                "ssh_password": "", "ssh_port": 22, "os_type": "linux", "role": "nas",
                "services": [{"name": "db", "kind": "postgres", "port": 5432}],
            })
            assert r.status_code == 200, r.text
            s = load_settings(cfg)
            assert s.computers["alpha"].ip == "192.168.1.11"
            assert s.computers["alpha"].ssh_password == "SECRET-A"        # blank kept the secret
            assert set(s.computers["alpha"].services) == {"db"}          # web removed, db added
            # Leading comments (the owner's style — attached to the following key) survive deletions.
            # (A comment physically trailing a *deleted* element is dropped with it — ruamel limitation.)
            assert "# my fleet" in cfg.read_text(encoding="utf-8")

            # --- rename: alpha -> gamma (id re-slugs, services carried, secret kept) ---
            r = c.put("/api/hosts/alpha", json={
                "name": "gamma node", "ip": "192.168.1.11", "ssh_password": "",
                "ssh_port": 22, "os_type": "linux",
                "services": [{"name": "db", "kind": "postgres", "port": 5432}],
            })
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


def test_multi_os_cmd_preserved() -> None:
    """Editing a service while submitting the full `cmd` it received keeps the other-OS commands."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            web = _host(c, "alpha")["services"][0]                 # carries both-OS start cmd
            r = c.put("/api/hosts/alpha", json={
                "name": "alpha", "ip": "192.168.1.10", "ssh_port": 22, "os_type": "linux",
                "ssh_password": "", "services": [web],             # echo the full service back
            })
            assert r.status_code == 200, r.text
            cmd = load_settings(cfg).computers["alpha"].services["web"].cmd
            assert cmd["start"]["windows"] == "net start nginx"    # other-OS entry survived
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
