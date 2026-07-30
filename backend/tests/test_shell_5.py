"""Phase 5 — guarded local shell (`run_shell` action + `POST /api/exec`, the `!` escape hatch).

Exercises the exec core (success / nonzero exit / kill-on-timeout / secret redaction / truncation),
the `permissions.decide` gate wired through `ActionService` (the agent's `run_shell` is denied below
FULL unless `shell.agent_exec_enabled`), and the user `!` endpoint (persists a tool_call + result
pair into the thread, audits an Event, and 403s when `shell.user_exec_enabled` is off).

What's exercised:
  Exec core (through ActionService at FULL — the user `!` path):
    1. success    — OK result, exit_code 0, stdout captured.
    2. nonzero    — ERROR result carrying the real exit code.
    3. timeout    — process killed after shell.timeout_s; ERROR with data.timed_out.
    4. redaction  — a config secret echoed by the command is masked in the output.
    5. truncation — output past shell.max_output_chars is clipped with a marker.
  Gate (decide + ActionService wiring of run_shell_allowed ← shell.agent_exec_enabled):
    6. decide     — DENY below FULL when not allowed · ALLOW at FULL · CONFIRM when allowed.
    7. agent off  — agent at CONFIRM with agent_exec off → DENIED result.
    8. agent on   — agent at CONFIRM with agent_exec on → needs_confirm (HIGH still gates).
  Endpoint (POST /api/exec):
    9. persists   — creates a thread, runs the command, stores assistant tool_call + tool result.
   10. user gate  — shell.user_exec_enabled off → 403, nothing run.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
The shell is the *host's* (powershell on Windows, bash elsewhere), so commands stay portable.
"""

from __future__ import annotations

import contextlib
import os
import platform
import tempfile
from pathlib import Path

from _async import run_async

from app.domain.event import ORIGIN_USER_CHAT

_WIN = platform.system().lower() == "windows"


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp, cfg
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _run(coro):
    return run_async(coro)


def _exec(c, command: str, *, privilege=None, agent_exec=False):
    """Run run_shell through the real ActionService. Defaults to the user `!` shape (FULL)."""
    from app.domain.enums import Actor, Privilege

    if agent_exec:
        c.app.state.settings.shell.agent_exec_enabled = True
    return _run(
        c.app.state.actions.invoke(
            "run_shell",
            {"command": command},
            origin=ORIGIN_USER_CHAT,
            actor=Actor.USER,
            privilege=privilege or Privilege.FULL,
        )
    )


# ── exec core ───────────────────────────────────────────────────────────────────────────────────


def test_exec_success_captures_stdout() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            out = _exec(c, "echo ctrlb-ok")
            assert out.result.state == RunState.OK
            assert out.result.data["exit_code"] == 0
            assert "ctrlb-ok" in (out.result.output or "")


def test_exec_nonzero_exit_is_error() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            out = _exec(c, "exit 7")
            assert out.result.state == RunState.ERROR
            assert out.result.data["exit_code"] == 7


def test_exec_timeout_kills_process() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.timeout_s = 0.5
            cmd = "Start-Sleep -Seconds 5" if _WIN else "sleep 5"
            out = _exec(c, cmd)
            assert out.result.state == RunState.ERROR
            assert out.result.data.get("timed_out") is True
            assert "killed" in out.result.summary


def test_exec_redacts_config_secret() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.open_terminal.api_key = "SUPERSECRET123"
            out = _exec(c, "echo SUPERSECRET123")
            assert "SUPERSECRET123" not in (out.result.output or "")
            assert "••••" in (out.result.output or "")


def test_exec_truncates_long_output() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.max_output_chars = 40
            out = _exec(c, "echo " + ("x" * 200))
            assert "[truncated]" in (out.result.output or "")
            # the body before the marker is bounded by the cap
            assert (out.result.output or "").split("\n…")[0][:200].count("x") <= 40


# ── gate ────────────────────────────────────────────────────────────────────────────────────────


def test_decide_gate_truth_table() -> None:
    from app.core.permissions import Decision, decide
    from app.domain.enums import Privilege

    with _workspace():
        with _client() as c:
            spec = c.app.state.actions.registry.get("run_shell").spec
            assert decide(spec, Privilege.CONFIRM, run_shell_allowed=False) == Decision.DENY
            assert decide(spec, Privilege.FULL, run_shell_allowed=False) == Decision.ALLOW
            assert decide(spec, Privilege.CONFIRM, run_shell_allowed=True) == Decision.CONFIRM


def test_agent_denied_without_optin() -> None:
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace():
        with _client() as c:
            out = _run(
                c.app.state.actions.invoke(
                    "run_shell",
                    {"command": "echo hi"},
                    origin=ORIGIN_USER_CHAT,
                    actor=Actor.AGENT,
                    privilege=Privilege.CONFIRM,
                )
            )
            assert out.result.state == RunState.DENIED


def test_agent_optin_still_confirms() -> None:
    from app.domain.enums import Actor, Privilege

    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.agent_exec_enabled = True
            out = _run(
                c.app.state.actions.invoke(
                    "run_shell",
                    {"command": "echo hi"},
                    origin=ORIGIN_USER_CHAT,
                    actor=Actor.AGENT,
                    privilege=Privilege.CONFIRM,
                )
            )
            assert out.needs_confirm is True  # HIGH risk still gates below FULL


# ── endpoint ──────────────────────────────────────────────────────────────────────────────────────


def test_endpoint_persists_command_and_result() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.user_exec_enabled = True  # `!` path is now OFF by default — enable it
            r = c.post("/api/exec", json={"command": "echo from-endpoint"})
            assert r.status_code == 200
            tid = r.json()["threadId"]
            msgs = c.get(f"/api/threads/{tid}/messages").json()
            calls = [p for m in msgs for p in m["parts"] if p["type"] == "tool_call"]
            results = [p for m in msgs for p in m["parts"] if p["type"] == "tool_result"]
            assert any(p["tool"] == "run_shell" for p in calls)
            assert results and results[0]["result"]["state"] == "ok"
            assert "from-endpoint" in (results[0]["result"]["output"] or "")


def test_endpoint_403_when_user_exec_disabled() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.user_exec_enabled = False
            r = c.post("/api/exec", json={"command": "echo nope"})
            assert r.status_code == 403


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
