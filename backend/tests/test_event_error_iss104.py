"""ISS-104 — the audit row carries the failure REASON (`Event.error`, migration 9).

A fleet action that fails tells the caller why in `ToolResult.error`; until ISS-104 the event row kept
only `summary`/`output`, so the stored history, the live frame and the "action failed" notification
built from it said "failed to shut down box" with no reason. What's pinned here, through the REAL
`invoke` and the real `shutdown_host` (only `ssh.run_command` is faked):

  1. The sudo-authentication branch (`shutdown.py`'s `_SUDO_FAILED` match — untested until now):
     the response's `result.error` AND its `event.error`, the stored row's `error`, and the column
     itself exist after the migration ladder.
  2. The egress funnel covers the new field: a config secret echoed in the adapter's error is masked
     in the result and in the stored row (`redact_result` runs before the row is built — ISS-98).
  3. The bound: an `error` longer than `EVENT_ERROR_CHARS` is stored clipped (`clip`'s marker), while
     the result returned to the caller keeps the whole (masked) reason.
  4. An OK outcome stores `error` = None (the ok path is unchanged).
  5. The `/api/agent/apply` failure event (outside the funnel — it masks with `redact_result` itself)
     stores the masked reason under the same bound.

Each test runs against its own temp config/db (`CTRLB_CONFIG`/`CTRLB_DB`); the real config is never read.
"""

from __future__ import annotations

import contextlib

import yaml
from _async import run_async
from test_apply_proposal_7e import _apply, _seed_proposal

from app.adapters import ssh
from app.adapters.ssh import SshResult
from app.core.redact import _MASK, TRUNCATION_MARKER
from app.domain.enums import Actor, Privilege
from app.domain.event import ORIGIN_USER_CHAT
from app.services.action_service import EVENT_ERROR_CHARS

PASSWORD = "box-ssh-PASSWORD-77"
SECRET = "tok-ABCDEF123456"  # 16 chars — above the default redaction floor
_CONFIG = {
    "server": {"port": 5433},
    "open_terminal": {"api_key": SECRET},
    "computers": {
        "box": {"ip": "192.168.1.50", "ssh_username": "root", "ssh_password": PASSWORD, "os_type": "linux"}
    },
}


@contextlib.contextmanager
def _app(tmp_path, monkeypatch, answer: SshResult):
    """The real app on a temp config/db, with `ssh.run_command` answering `answer` for every call."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text(yaml.safe_dump(_CONFIG), encoding="utf-8")
    monkeypatch.setenv("CTRLB_HOME", str(tmp_path))
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    monkeypatch.setattr(ssh, "run_command", lambda **_kw: answer)
    with TestClient(create_app()) as c:
        yield c


def _stored(c, event_id: str):
    (row,) = [e for e in run_async(c.app.state.events.recent(50)) if e.id == event_id]
    return row


def _shutdown(c):
    """`shutdown_host` through the real gate at FULL (no confirm round) — returns the outcome."""
    out = run_async(
        c.app.state.actions.invoke(
            "shutdown_host",
            {"host_id": "box"},
            origin=ORIGIN_USER_CHAT,
            actor=Actor.AGENT,
            privilege=Privilege.FULL,
        )
    )
    assert out.result is not None and out.event is not None
    return out


def test_a_sudo_failure_stores_its_reason_on_the_event(tmp_path, monkeypatch) -> None:
    """The owner's path: POST the action, confirm it, and the reason rides the response's result, the
    response's event and the stored row (the audit's reproduction, now with the field)."""
    sudo_refused = SshResult(
        ok=True, stderr="Sorry, try again.\nsudo: 3 incorrect password attempts", kind="ok"
    )
    with _app(tmp_path, monkeypatch, sudo_refused) as c:
        cols = {r["name"] for r in run_async(c.app.state.db.query("PRAGMA table_info(events)"))}
        assert "error" in cols  # migration 9 applied
        first = c.post("/api/actions/shutdown_host", json={"args": {"host_id": "box"}}).json()
        assert first["needs_confirm"] is True
        body = c.post(
            "/api/actions/shutdown_host",
            json={"args": {"host_id": "box"}, "confirm_token": first["confirm_token"]},
        ).json()
        result, event = body["result"], body["event"]
        assert result["state"] == "error" and result["summary"] == "failed to shut down box"
        assert result["error"].startswith("sudo could not authenticate")
        assert event["error"] == result["error"]
        row = _stored(c, event["id"])
        assert row.error == result["error"]
        assert PASSWORD not in (row.error or "") + (row.summary or "") + (row.output or "")
        listed = [e for e in c.get("/api/events").json() if e["id"] == event["id"]]
        assert listed and listed[0]["error"] == result["error"]  # the history read carries it too


def test_a_secret_in_the_reason_is_masked_in_the_result_and_the_row(tmp_path, monkeypatch) -> None:
    """The adapter echoes a config secret the action itself does not know about (it masks only the host
    password) — the funnel masks it before the row is built, so the stored `error` is clean too."""
    leaky = SshResult(ok=False, error=f"connect refused (key {SECRET}, pw {PASSWORD})", kind="ssh")
    with _app(tmp_path, monkeypatch, leaky) as c:
        out = _shutdown(c)
        assert out.result.error and SECRET not in out.result.error and PASSWORD not in out.result.error
        assert _MASK in out.result.error  # it WAS there, and was masked
        row = _stored(c, out.event.id)
        assert row.error == out.result.error


def test_a_long_reason_is_stored_bounded(tmp_path, monkeypatch) -> None:
    """`_record` bounds the stored `error` with `clip` (the catch-all `str(exc)` and an adapter's raw
    error have no length limit of their own); the caller's result keeps the whole reason."""
    long_error = "x" * (EVENT_ERROR_CHARS + 500)
    with _app(tmp_path, monkeypatch, SshResult(ok=False, error=long_error, kind="ssh")) as c:
        out = _shutdown(c)
        assert out.result.error == long_error  # the returned result is not cut
        row = _stored(c, out.event.id)
        assert row.error == "x" * EVENT_ERROR_CHARS + TRUNCATION_MARKER
        assert out.event.error == row.error  # the live frame carries the same bounded text


def test_an_ok_outcome_stores_no_error(tmp_path, monkeypatch) -> None:
    with _app(tmp_path, monkeypatch, SshResult(ok=True, stdout="", kind="ok")) as c:
        out = _shutdown(c)
        assert out.result.state == "ok"
        assert _stored(c, out.event.id).error is None


def test_a_failed_apply_stores_its_masked_reason_bounded(tmp_path, monkeypatch) -> None:
    """The Approve-to-apply endpoint records its own USER event (it bypasses `_record`): the reason it
    stores is the endpoint's already-masked `written.error`, clipped with the funnel's constant."""
    import app.api.agent as agent_api
    from app.domain.enums import RunState
    from app.domain.result import ToolResult

    reason = f"stale: {SECRET} " + "y" * EVENT_ERROR_CHARS

    async def failed_apply(*_a, **_kw):
        return ToolResult(state=RunState.ERROR, summary="memory replace failed", error=reason)

    monkeypatch.setattr(agent_api, "apply_proposal", failed_apply)
    with _app(tmp_path, monkeypatch, SshResult(ok=True, kind="ok")) as c:
        tid, cid = _seed_proposal(c, "memory", {"target": "memory", "action": "add", "content": "x"})
        body = _apply(c, tid, cid).json()
        assert body["applied"] is False and SECRET not in body["result"]["error"]
        (row,) = [e for e in run_async(c.app.state.events.recent(50)) if e.action == "memory"]
        assert row.error is not None and SECRET not in row.error and _MASK in row.error
        assert row.error.endswith(TRUNCATION_MARKER) and len(row.error) == EVENT_ERROR_CHARS + len(
            TRUNCATION_MARKER
        )
