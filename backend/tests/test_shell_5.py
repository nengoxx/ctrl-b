"""Phase 5 — guarded local shell (`run_shell` action + `POST /api/exec`, the `!` escape hatch).

Exercises the exec core (success / nonzero exit / kill-on-timeout / secret redaction / truncation),
the `permissions.run_shell_gate` → `decide` gate wired through `ActionService` (keyed on the ACTOR at
EVERY privilege — ISS-87; `shell.enabled` decided before any bubble — ISS-102), and the user `!`
endpoint (persists a tool_call + result pair into the thread, audits an Event, and 403s naming the
closing key when the USER gate is shut).

What's exercised:
  Exec core (through ActionService at FULL — the user `!` path):
    1. success    — OK result, exit_code 0, stdout captured.
    2. nonzero    — ERROR result carrying the real exit code.
    3. timeout    — process killed after shell.timeout_s; ERROR with data.timed_out.
    4. redaction  — a config secret echoed by the command is masked in the output.
    5. truncation — output past shell.max_output_chars is clipped with a marker.
  Gate (run_shell_gate + decide + the ActionService wiring):
    6. the gate table — `shell.enabled` closes it for every actor; USER ← user_exec_enabled; every
       other actor ← agent_exec_enabled.
    7. decide     — DENY whenever not allowed (FULL included) · ALLOW at FULL · CONFIRM when allowed.
    8. agent off  — agent at CONFIRM / FULL with agent_exec off → DENIED naming the key, nothing run.
    9. agent on   — agent at CONFIRM → needs_confirm (HIGH still gates); at FULL → runs unasked.
   10. enabled off — no bubble first (ISS-102); a token minted before a flip redeems to DENIED.
   11. the USER doors — `!` (FULL) and the generic action shape (CONFIRM) follow user_exec_enabled.
  Endpoint (POST /api/exec):
   12. persists   — creates a thread, runs the command, stores assistant tool_call + tool result.
   13. user gate  — shell.user_exec_enabled off / shell.enabled off → 403 naming the key, nothing run.

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
    """Run run_shell through the real ActionService. Defaults to the user `!` shape (USER @ FULL),
    which the chokepoint gates on `shell.user_exec_enabled` — so the helper opens that door."""
    from app.domain.enums import Actor, Privilege

    c.app.state.settings.shell.user_exec_enabled = True
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


def test_run_shell_gate_table() -> None:
    """The ONE predicate every gate site reads: `shell.enabled` closes it for everyone; USER is the
    owner's own door (`user_exec_enabled`); every other actor is a model or the scheduler
    (`agent_exec_enabled`) — and the flag of the other door is irrelevant."""
    from app.config import ShellCfg
    from app.core.permissions import run_shell_gate
    from app.domain.enums import Actor

    for actor in Actor:
        for user in (False, True):
            for agent in (False, True):
                off = ShellCfg(enabled=False, user_exec_enabled=user, agent_exec_enabled=agent)
                assert run_shell_gate(off, actor) == "shell.enabled"
    for agent in (False, True):
        assert run_shell_gate(ShellCfg(user_exec_enabled=False, agent_exec_enabled=agent), Actor.USER) == (
            "shell.user_exec_enabled"
        )
        assert run_shell_gate(ShellCfg(user_exec_enabled=True, agent_exec_enabled=agent), Actor.USER) is None
    for actor in (Actor.AGENT, Actor.AUTOMATION, Actor.SYSTEM):
        for user in (False, True):
            closed = ShellCfg(user_exec_enabled=user, agent_exec_enabled=False)
            assert run_shell_gate(closed, actor) == "shell.agent_exec_enabled"
            assert run_shell_gate(ShellCfg(user_exec_enabled=user, agent_exec_enabled=True), actor) is None


def test_decide_gate_truth_table() -> None:
    from app.core.permissions import Decision, decide
    from app.domain.enums import Privilege

    with _workspace():
        with _client() as c:
            spec = c.app.state.actions.registry.get("run_shell").spec
            for approved in (False, True):  # an approval never resurrects a DENY nor skips the confirm
                assert (
                    decide(spec, Privilege.CONFIRM, run_shell_allowed=False, approved=approved)
                    == Decision.DENY
                )
                assert (
                    decide(spec, Privilege.FULL, run_shell_allowed=False, approved=approved) == Decision.DENY
                )
                assert (
                    decide(spec, Privilege.FULL, run_shell_allowed=True, approved=approved) == Decision.ALLOW
                )
                assert (
                    decide(spec, Privilege.CONFIRM, run_shell_allowed=True, approved=approved)
                    == Decision.CONFIRM
                )


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


def _invoke(c, command: str, *, actor, privilege, token=None):
    return _run(
        c.app.state.actions.invoke(
            "run_shell",
            {"command": command},
            origin=ORIGIN_USER_CHAT,
            actor=actor,
            privilege=privilege,
            confirm_token=token,
        )
    )


def _touch(path: Path) -> str:
    """A command that creates `path` — its absence after a DENIED run proves nothing executed."""
    return f"New-Item -ItemType File -Path '{path}'" if _WIN else f"touch '{path}'"


def test_iss87_agent_at_full_is_denied_when_agent_exec_off() -> None:
    """ISS-87: a FULL agent used to run `run_shell` unasked with the toggle OFF — the gate now binds at
    every privilege, decided before anything runs."""
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.shell.agent_exec_enabled = False
            sentinel = tmp / "iss87-ran"
            out = _invoke(c, _touch(sentinel), actor=Actor.AGENT, privilege=Privilege.FULL)
            assert out.needs_confirm is False
            assert out.result.state == RunState.DENIED
            assert "shell.agent_exec_enabled" in out.result.summary
            assert not sentinel.exists()


def test_agent_at_full_runs_unasked_when_agent_exec_on() -> None:
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.agent_exec_enabled = True
            out = _invoke(c, "echo full-ok", actor=Actor.AGENT, privilege=Privilege.FULL)
            assert out.needs_confirm is False
            assert out.result.state == RunState.OK
            assert "full-ok" in (out.result.output or "")


def test_iss102_shell_disabled_denies_before_any_bubble() -> None:
    """ISS-102: `shell.enabled: false` used to bubble a confirm first and deny only after the owner
    approved; it is now decided at the gate — no bubble, a DENIED naming the key."""
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.agent_exec_enabled = True
            c.app.state.settings.shell.enabled = False
            out = _invoke(c, "echo hi", actor=Actor.AGENT, privilege=Privilege.CONFIRM)
            assert out.needs_confirm is False
            assert out.result.state == RunState.DENIED
            assert "shell.enabled" in out.result.summary


def test_user_bang_shape_is_gated_at_the_chokepoint() -> None:
    """The `!` shape (USER @ FULL) is gated by `user_exec_enabled` at `invoke` too, not only by the
    endpoint's up-front 403 — and the agent toggle is irrelevant to it."""
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            shell = c.app.state.settings.shell
            shell.user_exec_enabled, shell.agent_exec_enabled = True, False
            ok = _invoke(c, "echo bang-ok", actor=Actor.USER, privilege=Privilege.FULL)
            assert ok.result.state == RunState.OK
            shell.user_exec_enabled, shell.agent_exec_enabled = False, True
            sentinel = tmp / "bang-ran"
            out = _invoke(c, _touch(sentinel), actor=Actor.USER, privilege=Privilege.FULL)
            assert out.result.state == RunState.DENIED
            assert "shell.user_exec_enabled" in out.result.summary
            assert not sentinel.exists()


def test_confirm_then_disable_redeems_to_denied() -> None:
    """A token minted while the gate was open is redeemed after a flip: the redemption re-enters
    `invoke`, which re-decides on LIVE settings → DENIED, nothing run. (This is what licenses dropping
    `_run`'s own `shell.enabled` check — every route into `_run` is `invoke`.)"""
    from app.domain.enums import Actor, Privilege, RunState

    for flip in ("enabled", "agent_exec_enabled"):
        with _workspace() as (tmp, _cfg):
            with _client() as c:
                shell = c.app.state.settings.shell
                shell.agent_exec_enabled = True
                sentinel = tmp / f"redeemed-{flip}"
                cmd = _touch(sentinel)
                first = _invoke(c, cmd, actor=Actor.AGENT, privilege=Privilege.CONFIRM)
                assert first.needs_confirm is True and first.confirm_token
                setattr(shell, flip, False)
                out = _invoke(
                    c, cmd, actor=Actor.AGENT, privilege=Privilege.CONFIRM, token=first.confirm_token
                )
                assert out.needs_confirm is False
                assert out.result.state == RunState.DENIED
                assert f"shell.{flip}" in out.result.summary
                assert not sentinel.exists()


def test_user_at_confirm_follows_the_user_door() -> None:
    """The third door — USER @ CONFIRM, the `POST /api/actions/run_shell` shape (that route now 404s a
    hidden tool, ISS-88, but the actor mapping is what binds any USER caller)."""
    from app.domain.enums import Actor, Privilege, RunState

    with _workspace():
        with _client() as c:
            shell = c.app.state.settings.shell
            shell.user_exec_enabled, shell.agent_exec_enabled = True, False
            asked = _invoke(c, "echo hi", actor=Actor.USER, privilege=Privilege.CONFIRM)
            assert asked.needs_confirm is True
            shell.user_exec_enabled, shell.agent_exec_enabled = False, True
            out = _invoke(c, "echo hi", actor=Actor.USER, privilege=Privilege.CONFIRM)
            assert out.needs_confirm is False
            assert out.result.state == RunState.DENIED
            assert "shell.user_exec_enabled" in out.result.summary


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
            assert "shell.user_exec_enabled" in r.json()["detail"]


def test_endpoint_403_names_shell_enabled() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.shell.user_exec_enabled = True
            c.app.state.settings.shell.enabled = False
            r = c.post("/api/exec", json={"command": "echo nope"})
            assert r.status_code == 403
            assert "shell.enabled" in r.json()["detail"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
