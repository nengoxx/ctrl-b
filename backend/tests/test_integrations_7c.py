"""Phase 7c — integrations. 7c-a (scalar configs hot-apply) here; 7c-b (MCP/OpenAPI + rediscover)
appended in that slice. Runs via `python tests/test_integrations_7c.py` or pytest. Temp config only
(audit E3)."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_SEED = """\
# fleet config
inference:
  local:
    base_url: http://x/v1
    model: m
searxng:
  base_url: http://old-searx:8888
embeddings:
  base_url: http://old-emb/v1
  api_key: EMB-SECRET
  model: e
open_terminal:
  base_url: http://old-term:9999
  api_key: TERM-SECRET
"""


def _client(tmp: Path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp / "config.yaml"
    cfg.write_text(_SEED, encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app()), cfg


def test_scalar_integrations_hot_apply() -> None:
    """A PUT changing searxng/embeddings/open_terminal rebuilds the live adapter clients (and the
    Deps handles) without a restart, and keeps echoed-masked secrets intact."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            old_searx = c.app.state.searxng
            r = c.put("/api/settings", json={
                "searxng": {"base_url": "http://new-searx:9"},
                "embeddings": {"base_url": "http://new-emb/v1"},
                "open_terminal": {"base_url": "http://new-term:1"},
            })
            assert r.status_code == 200, r.text
            # client rebuilt (new instance) + repointed on app.state AND deps
            assert c.app.state.searxng is not old_searx
            assert c.app.state.searxng._cfg.base_url == "http://new-searx:9"
            assert c.app.state.deps.searxng is c.app.state.searxng
            assert c.app.state.embeddings._cfg.base_url == "http://new-emb/v1"
            assert c.app.state.open_terminal._cfg.base_url == "http://new-term:1"
            # secrets not wiped on disk (we didn't send them; deep-merge leaves them)
            from app.config import load_settings

            s = load_settings(cfg)
            assert s.embeddings.api_key == "EMB-SECRET"
            assert s.open_terminal.api_key == "TERM-SECRET"
            assert "# fleet config" in cfg.read_text(encoding="utf-8")  # comment preserved
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


_SEED_MCP = """\
# integrations
mcp_servers:
  - name: web-tools
    url: http://192.168.1.160:3003/mcp
    risk: low
    headers:
      X-Api-Key: REAL-MCP-KEY
# end
"""


def _client_mcp(tmp: Path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp / "config.yaml"
    cfg.write_text(_SEED_MCP, encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app()), cfg


def test_mcp_crud_and_dirty() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client_mcp(tmp)
        with client as c:
            from app.config import load_settings

            # add a server → 201, dirty flips, persisted
            r = c.post("/api/integrations/mcp", json={"name": "extra", "url": "http://h:1/mcp", "risk": "med"})
            assert r.status_code == 201, r.text
            assert r.json()["status"]["dirty"] is True
            assert any(s.name == "extra" for s in load_settings(cfg).mcp_servers)
            assert "# integrations" in cfg.read_text(encoding="utf-8")  # comment preserved
            # duplicate → 409
            assert c.post("/api/integrations/mcp", json={"name": "extra", "url": "http://h:2"}).status_code == 409

            # update web-tools risk, echo the masked header key back → real secret kept
            masked = c.get("/api/settings").json()["mcp_servers"]
            wt = next(s for s in masked if s["name"] == "web-tools")
            r = c.put("/api/integrations/mcp/web-tools", json={**wt, "risk": "high"})
            assert r.status_code == 200, r.text
            s = load_settings(cfg)
            wt2 = next(s2 for s2 in s.mcp_servers if s2.name == "web-tools")
            assert wt2.risk == "high"
            assert wt2.headers["X-Api-Key"] == "REAL-MCP-KEY"  # masked echo didn't clobber it
            assert "# end" in cfg.read_text(encoding="utf-8")

            # delete + 404
            assert c.delete("/api/integrations/mcp/extra").status_code == 200
            assert not any(s2.name == "extra" for s2 in load_settings(cfg).mcp_servers)
            assert c.delete("/api/integrations/mcp/nope").status_code == 404
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_rediscover_busy_409_and_empty_ok() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  poll_seconds: 5\n", encoding="utf-8")  # no servers → discover is a no-op
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        from fastapi.testclient import TestClient

        from app.main import create_app

        with TestClient(create_app()) as c:
            c.app.state.active_turns = 1
            assert c.post("/api/integrations/rediscover").status_code == 409  # busy
            c.app.state.active_turns = 0
            c.app.state.integrations_dirty = True
            r = c.post("/api/integrations/rediscover")  # no servers → fast, clears dirty
            assert r.status_code == 200, r.text
            assert r.json()["dirty"] is False
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


def test_registry_remove_category() -> None:
    from pydantic import BaseModel

    from app.core.tool import FunctionTool, ToolRegistry, ToolSpec

    class _In(BaseModel):
        pass

    reg = ToolRegistry()
    for name, cat in [("a", "mcp"), ("b", "mcp"), ("c", "action")]:
        reg.register(FunctionTool(spec=ToolSpec(name=name, title=name, category=cat, input_model=_In), fn=None))  # type: ignore[arg-type]
    assert reg.remove_category("mcp") == 2
    assert {t.spec.name for t in reg.all()} == {"c"}
    assert reg.remove("c") is True and reg.remove("c") is False


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
