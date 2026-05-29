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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
