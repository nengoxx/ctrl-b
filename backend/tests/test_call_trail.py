"""D77 — THE CALL TRAIL: the store (`services/call_trail.py`) and the browser's write route
(`POST /api/voice/live/trail`). The relay's half is pinned beside the relay, in `test_voice_live_s1.py`
§13.

The arms, by what they defend:

* **the store** — JSONL on disk (one compact object per line, appended); the directory made lazily;
  the call id as the PATH GUARD (a malformed one is a `ValueError`, never a filename); retention by
  count, pruned when a NEW call's first line lands and never by a second append to the same call; and
  a failing disk logged once and swallowed — a trail must never end a call.
* **the route** — the feature does not exist while `voice.live.debug` is off (404); the JSON-only rail
  that makes the cross-origin write die at the preflight (SECURITY_MODEL §2.7/§2.11 — 415 for any
  safelisted body shape, a missing type included); the bounds (413 on the body, 422 on an entry, on the
  count, on the id); and the stored line — `src: "client"` stamped, the rest verbatim.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import voice as voice_api
from app.config import Settings
from app.services.call_trail import TRAIL_MAX_BODY_BYTES, CallTrail

CALL = "0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b"
URL = "/api/voice/live/trail"


def _call(n: int) -> str:
    return f"{n:08x}-1b3d-4e5f-8a9b-0c1d2e3f4a5b"


def _read(root: Path, call: str = CALL) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (root / f"{call}.jsonl").read_text(encoding="utf-8").splitlines()]


# ── the store ─────────────────────────────────────────────────────────────────────────────────────


def test_append_writes_compact_jsonl_and_makes_the_directory(tmp_path: Path) -> None:
    root = tmp_path / "calls"
    trail = CallTrail(root)
    assert not root.exists()  # lazily — nothing exists until a line lands
    trail.append(CALL, [{"t": 1, "ev": "a", "text": "héllo"}], keep=20)
    trail.append(CALL, [{"t": 2, "ev": "b"}, {"t": 3, "ev": "c"}], keep=20)
    raw = (root / f"{CALL}.jsonl").read_text(encoding="utf-8")
    assert raw == '{"t":1,"ev":"a","text":"héllo"}\n{"t":2,"ev":"b"}\n{"t":3,"ev":"c"}\n'
    if os.name != "nt":  # the owner's transcripts: owner-only on disk
        assert (root.stat().st_mode & 0o777) == 0o700
        assert ((root / f"{CALL}.jsonl").stat().st_mode & 0o777) == 0o600


@pytest.mark.parametrize("bad", ["../escape", CALL.upper(), CALL + "\n", "", "x" * 36, f"{CALL}.jsonl"])
def test_append_rejects_a_malformed_call_id(tmp_path: Path, bad: str) -> None:
    with pytest.raises(ValueError):
        CallTrail(tmp_path / "calls").append(bad, [{"t": 1, "ev": "a"}], keep=20)
    assert not (tmp_path / "calls").exists()


def test_a_new_call_prunes_to_the_newest_keep(tmp_path: Path) -> None:
    root = tmp_path / "calls"
    trail = CallTrail(root)
    now = time.time()
    for n in range(5):
        trail.append(_call(n), [{"t": n, "ev": "x"}], keep=10)
        os.utime(root / f"{_call(n)}.jsonl", (now - 100 + n, now - 100 + n))  # 0 oldest … 4 newest
    trail.append(_call(9), [{"t": 9, "ev": "x"}], keep=3)  # a NEW call's first line: prune
    assert sorted(p.stem for p in root.glob("*.jsonl")) == sorted([_call(3), _call(4), _call(9)])


def test_a_prune_never_deletes_the_call_it_just_created_on_an_mtime_tie(tmp_path: Path) -> None:
    """The S3 code round, F5: `keep=1`, an older trail with the SAME mtime as the new file — the new
    call's file survives, the other goes."""
    root = tmp_path / "calls"
    trail = CallTrail(root)
    trail.append(_call(0), [{"t": 0, "ev": "x"}], keep=10)
    trail.append(_call(1), [{"t": 1, "ev": "x"}], keep=10)
    tie = time.time()
    for n in (0, 1):
        os.utime(root / f"{_call(n)}.jsonl", (tie, tie))
    trail.append(_call(2), [{"t": 2, "ev": "x"}], keep=1)  # NEW call, ties with both survivors
    assert {p.stem for p in root.glob("*.jsonl")} == {_call(2)}


def test_a_second_append_to_the_same_call_does_not_prune(tmp_path: Path) -> None:
    root = tmp_path / "calls"
    trail = CallTrail(root)
    for n in range(4):
        trail.append(_call(n), [{"t": n, "ev": "x"}], keep=10)
    trail.append(_call(0), [{"t": 99, "ev": "y"}], keep=1)  # an EXISTING call: no prune, whatever keep says
    assert len(list(root.glob("*.jsonl"))) == 4


def test_a_write_error_is_swallowed_and_logged_once(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    blocker = tmp_path / "calls"
    blocker.write_text("a FILE where the directory should be", encoding="utf-8")
    trail = CallTrail(blocker)
    caplog.set_level(logging.WARNING, logger="app.services.call_trail")
    trail.append(CALL, [{"t": 1, "ev": "a"}], keep=20)  # does not raise
    trail.append(CALL, [{"t": 2, "ev": "b"}], keep=20)
    assert len([r for r in caplog.records if r.name == "app.services.call_trail"]) == 1


# ── the route ─────────────────────────────────────────────────────────────────────────────────────


def _app(tmp_path: Path, *, debug: bool = True, keep: int = 20) -> TestClient:
    app = FastAPI()
    app.state.settings = Settings.model_validate({"voice": {"live": {"debug": debug, "trail_keep": keep}}})
    app.state.call_trail = CallTrail(tmp_path / "calls")
    app.include_router(voice_api.router, prefix="/api")
    return TestClient(app)


def _batch(entries: list[dict[str, Any]], call: str = CALL) -> dict[str, Any]:
    return {"call_id": call, "entries": entries}


def test_the_route_does_not_exist_while_debug_is_off(tmp_path: Path) -> None:
    res = _app(tmp_path, debug=False).post(URL, json=_batch([{"t": 1, "ev": "sig"}]))
    assert (res.status_code, res.json()["detail"]) == (404, "call trail is off")
    assert not (tmp_path / "calls").exists()


def test_a_batch_is_stored_stamped_client_with_its_extras_verbatim(tmp_path: Path) -> None:
    entries = [
        {"t": 1700000000123, "ev": "sig", "leg": 2, "gen": 0, "type": "final", "textLen": 17},
        {
            "t": 1700000000200,
            "ev": "capture",
            "leg": 2,
            "gen": 0,
            "cfg": {"floor_dbfs": -45},
            "ecCaps": [True, "all"],
        },
        # a client cannot pass itself off as the relay
        {"t": 1700000000300, "ev": "sample", "src": "relay", "level": -52.5, "noise": None},
    ]
    res = _app(tmp_path).post(URL, json=_batch(entries))
    assert (res.status_code, res.content) == (204, b"")
    lines = _read(tmp_path / "calls")
    assert [line["src"] for line in lines] == ["client"] * 3
    assert lines[0] == {"src": "client", **entries[0]}
    assert lines[1]["cfg"] == {"floor_dbfs": -45} and lines[1]["ecCaps"] == [True, "all"]
    assert (lines[2]["level"], lines[2]["noise"]) == (-52.5, None)
    assert list(lines[0])[0] == "src"  # the stamp leads the line, for the eye reading the file


def test_the_route_prunes_by_the_live_keep(tmp_path: Path) -> None:
    client = _app(tmp_path, keep=2)
    for n in range(4):
        assert client.post(URL, json=_batch([{"t": n, "ev": "x"}], _call(n))).status_code == 204
    assert len(list((tmp_path / "calls").glob("*.jsonl"))) == 2


@pytest.mark.parametrize(
    "content_type",
    [
        None,
        "text/plain",
        "text/plain;charset=UTF-8",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
    ],
)
def test_only_a_json_body_is_taken_the_preflight_rail(tmp_path: Path, content_type: str | None) -> None:
    """Every body a cross-origin page can send WITHOUT a preflight — a form, text/plain, or a typeless
    Blob (no Content-Type at all) — is refused before it is read (SECURITY_MODEL §2.7/§2.11)."""
    body = json.dumps(_batch([{"t": 1, "ev": "sig"}])).encode()
    headers = {} if content_type is None else {"content-type": content_type}
    res = _app(tmp_path).post(URL, content=body, headers=headers)
    assert res.status_code == 415
    assert not (tmp_path / "calls").exists()


def test_an_oversized_body_is_413(tmp_path: Path) -> None:
    filler = [{"t": i, "ev": "x", "pad": "p" * 1500} for i in range(60)]  # each entry fits; the body does not
    body = json.dumps(_batch(filler)).encode()
    assert len(body) > TRAIL_MAX_BODY_BYTES
    res = _app(tmp_path).post(URL, content=body, headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert not (tmp_path / "calls").exists()


def test_an_entry_past_2kb_is_422_naming_its_index(tmp_path: Path) -> None:
    entries = [{"t": 1, "ev": "ok"}, {"t": 2, "ev": "big", "blob": "b" * 2100}]
    res = _app(tmp_path).post(URL, json=_batch(entries))
    assert res.status_code == 422
    assert "entry 1" in res.json()["detail"]
    assert not (tmp_path / "calls").exists()  # all-or-nothing: the good entry is not written either


@pytest.mark.parametrize(
    "body",
    [
        _batch([{"t": i, "ev": "x"} for i in range(201)]),  # > 200 entries
        _batch([]),  # an empty batch
        _batch([{"t": 1, "ev": "x"}], "../../etc/passwd"),  # the id is the path guard
        _batch([{"t": 1, "ev": "x"}], CALL.upper()),
        {"entries": [{"t": 1, "ev": "x"}]},  # no id
        _batch([{"ev": "x"}]),  # no t
        _batch([{"t": 1, "ev": ""}]),  # empty ev
        _batch([{"t": 1, "ev": "e" * 49}]),  # ev past 48
        [1, 2, 3],  # not an object
    ],
)
def test_bad_shapes_are_422_and_write_nothing(tmp_path: Path, body: Any) -> None:
    res = _app(tmp_path).post(URL, json=body)
    assert res.status_code == 422
    assert not (tmp_path / "calls").exists()
    # the rendered detail never echoes the submitted value (the `validation_detail` rule)
    assert "etc/passwd" not in res.text


def test_the_real_app_mounts_the_store_under_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """End to end on `create_app`: the lifespan builds the ONE store under `$CTRLB_HOME/calls/` (the
    conftest points `CTRLB_HOME` at a per-test temp), and the route is mounted under `/api`."""
    from app.config import home_path
    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text("server:\n  poll_seconds: 5\nvoice:\n  live:\n    debug: true\n", encoding="utf-8")
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    with TestClient(create_app()) as c:
        assert c.app.state.call_trail.root == home_path() / "calls"  # type: ignore[attr-defined]
        assert c.post(URL, json=_batch([{"t": 1, "ev": "sig"}])).status_code == 204
    assert _read(home_path() / "calls") == [{"src": "client", "t": 1, "ev": "sig"}]
