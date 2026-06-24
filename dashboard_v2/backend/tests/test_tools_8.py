"""Phase 8a — utility tool registry + the Tools-tab API (`GET /api/tools`, `POST /api/tools/{name}`).

Exercises the `@tool` sugar (utility tools register as `category="utility"`, `ui_exposed=True`,
`agent_exposed=True` cards), the list endpoint (only utility cards — not actions/builtins/agent-only
utilities), and the **category-guarded** invoke facade (utility cards only; reuses ActionService so
the call is audited; never a second execution path). yt_captions / ip_info network boundaries are
mocked; dns_trace runs for real against localhost (dependency-free).

What's exercised:
  1. list        — GET /api/tools = exactly the util cards; excludes shutdown_host / web_search / task_plan.
  2. spec        — yt_captions registered utility/ui_exposed/agent_exposed, LOW, no-confirm; input_schema present.
  3. guard       — POST shutdown_host / web_search (not a card) / unknown → 404.
  4. validation  — POST dns_trace with missing args → 422.
  5. dns ok      — POST dns_trace localhost → OK, addresses non-empty; audited (event returned).
  6. dns fail    — an unresolvable host → ERROR ToolResult (data, not exception).
  7. ip ok       — mocked ip-api success → OK, geo fields + summary.
  8. ip fail     — mocked ip-api status=fail → ERROR.
  9. yt ok       — mocked transcript + title → OK, data.download.{filename,content}, segment_count.
 10. yt bad url  — POST a non-YouTube URL → 200 with an ERROR ToolResult.
 11. video-id    — extract_video_id table (watch / youtu.be / embed / shorts / invalid).

Each test boots the app on an isolated temp config/db; the real config is never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path


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


@contextlib.contextmanager
def _patch(obj, name, value):
    orig = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, orig)


# --- fakes for the mocked network boundaries -------------------------------------------------

class _FakeResp:
    def __init__(self, payload: dict):
        self._p = payload

    def raise_for_status(self) -> None:  # noqa: D401
        pass

    def json(self) -> dict:
        return self._p


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient(...) as an async context manager returning a fixed payload."""

    payload: dict = {}

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        return _FakeResp(self.payload)


class _FakeFetched:
    def to_raw_data(self):
        return [
            {"text": "hello there", "start": 0.0, "duration": 1.0},
            {"text": "general kenobi", "start": 1.0, "duration": 1.2},
        ]


# --- tests -----------------------------------------------------------------------------------

def test_list_returns_only_util_cards() -> None:
    with _workspace(), _client() as c:
        names = {t["name"] for t in c.get("/api/tools").json()}
        assert names == {"dns_trace", "ip_info", "yt_captions"}
        assert "shutdown_host" not in names  # an action, not a util card
        assert "web_search" not in names  # a utility but agent-only (not ui_exposed)
        assert "task_plan" not in names  # a builtin


def test_spec_shape() -> None:
    with _workspace(), _client() as c:
        spec = next(t for t in c.get("/api/tools").json() if t["name"] == "yt_captions")
        assert spec["category"] == "utility"
        assert spec["ui_exposed"] is True
        assert spec["agent_exposed"] is True
        assert spec["confirm"] is False
        assert spec["risk"] == "low"
        assert "url" in spec["input_schema"]["properties"]


def test_invoke_category_guard() -> None:
    with _workspace(), _client() as c:
        assert c.post("/api/tools/shutdown_host", json={"args": {}}).status_code == 404
        assert c.post("/api/tools/web_search", json={"args": {}}).status_code == 404
        assert c.post("/api/tools/nope", json={"args": {}}).status_code == 404


def test_invoke_validation_error() -> None:
    with _workspace(), _client() as c:
        assert c.post("/api/tools/dns_trace", json={"args": {}}).status_code == 422


def test_dns_trace_localhost_ok_and_audited() -> None:
    with _workspace(), _client() as c:
        r = c.post("/api/tools/dns_trace", json={"args": {"host": "localhost"}})
        assert r.status_code == 200
        body = r.json()
        assert body["result"]["state"] == "ok"
        assert body["result"]["data"]["addresses"]  # non-empty
        assert body["event"] is not None  # the invocation was audited


def test_dns_trace_resolve_failure() -> None:
    with _workspace(), _client() as c:
        r = c.post("/api/tools/dns_trace", json={"args": {"host": "no.such.host.invalid"}})
        assert r.status_code == 200  # failure is data, not an exception
        assert r.json()["result"]["state"] == "error"


def test_ip_info_mocked_ok() -> None:
    import app.services.tools.ip_info as mod

    payload = {
        "status": "success",
        "query": "1.1.1.1",
        "country": "Australia",
        "regionName": "Queensland",
        "city": "Brisbane",
        "isp": "Cloudflare",
        "org": "APNIC and Cloudflare DNS Resolver project",
        "as": "AS13335 Cloudflare, Inc.",
    }
    with _workspace(), _client() as c:
        with _patch(mod.httpx, "AsyncClient", type("FC", (_FakeAsyncClient,), {"payload": payload})):
            r = c.post("/api/tools/ip_info", json={"args": {"query": "1.1.1.1"}})
        body = r.json()["result"]
        assert body["state"] == "ok"
        assert body["data"]["city"] == "Brisbane"
        assert "status" not in body["data"]  # stripped
        assert "Brisbane" in body["summary"]


def test_ip_info_mocked_fail() -> None:
    import app.services.tools.ip_info as mod

    payload = {"status": "fail", "message": "invalid query", "query": "bogus"}
    with _workspace(), _client() as c:
        with _patch(mod.httpx, "AsyncClient", type("FC", (_FakeAsyncClient,), {"payload": payload})):
            r = c.post("/api/tools/ip_info", json={"args": {"query": "bogus"}})
        body = r.json()["result"]
        assert body["state"] == "error"
        assert "invalid query" in body["summary"]


def test_yt_captions_mocked_ok() -> None:
    import app.services.tools.yt_captions as mod

    async def _fake_title(video_id: str) -> str:
        return "Rick Astley - Never Gonna Give You Up"

    with _workspace(), _client() as c:
        with _patch(mod.YouTubeTranscriptApi, "fetch", lambda self, vid, **k: _FakeFetched()), \
             _patch(mod, "_fetch_title", _fake_title):
            r = c.post(
                "/api/tools/yt_captions",
                json={"args": {"url": "https://youtu.be/dQw4w9WgXcQ"}},
            )
        body = r.json()["result"]
        assert body["state"] == "ok"
        assert body["data"]["segment_count"] == 2
        # the agent reads `output` (never `data`) — transcript text must land there
        assert "hello there" in (body["output"] or "")
        dl = body["data"]["download"]
        assert dl["filename"].endswith("_captions.json")
        assert len(dl["content"]) == 2


def test_yt_captions_bad_url() -> None:
    with _workspace(), _client() as c:
        r = c.post("/api/tools/yt_captions", json={"args": {"url": "https://example.com/x"}})
        assert r.status_code == 200
        assert r.json()["result"]["state"] == "error"


def test_timeout_enforced() -> None:
    """A tool that runs past its `timeout_s` yields a clean TIMEOUT ToolResult (not a hang/crash).
    Tools with `timeout_s=None` are never wrapped — proven implicitly by the other tests passing."""
    import time as _time

    import app.services.tools.dns_trace as mod

    def _slow(host: str) -> dict:
        _time.sleep(1.0)  # the worker thread lingers; the await is cut at the deadline
        return {"host": host, "addresses": [], "ptr": None}

    with _workspace(), _client() as c:
        spec = c.app.state.actions.registry.get("dns_trace").spec
        with _patch(mod, "_resolve", _slow), _patch(spec, "timeout_s", 0.1):
            r = c.post("/api/tools/dns_trace", json={"args": {"host": "slow.example"}})
        assert r.status_code == 200
        assert r.json()["result"]["state"] == "timeout"


def test_extract_video_id_table() -> None:
    from app.services.tools.yt_captions import extract_video_id

    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/embed/xyz98765432") == "xyz98765432"
    assert extract_video_id("https://www.youtube.com/shorts/abc12345678") == "abc12345678"
    assert extract_video_id("https://example.com/not-youtube") is None


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
