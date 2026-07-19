"""C2-L7 (D40 §9) — an INACTIVE skill contributes ZERO tokens to the assembled model payload.

The "skills add zero context until active" claim rests on exactly two mechanisms in `session.py`,
both driven by `_activate_skills`:

  * the skill's INSTRUCTIONS reach the model only via `_skills_note` (= `skills_prompt(active)`),
    appended to the system head by `_static_prefix`. An inactive skill ⇒ `_skills_note is None` ⇒
    the head carries none of its text.
  * the skill's tool NARROWING reaches the model only via `_tool_allow` (= `narrow_tools(active,
    agent.tools)`), consumed by `_tools()`. An inactive skill ⇒ `_tool_allow == agent.tools` ⇒ the
    toolset is byte-identical to the no-skills baseline (the skill neither narrows nor adds).

This pins both: with a skill present-but-inactive, its unique sentinel text is absent from the
serialized `messages` AND `tools`, and the toolset equals the no-skills baseline. The ACTIVE case is
included as the contrast — the same skill, once invoked, DOES inject its sentinel and DOES narrow —
so the pin proves the gate is activation, not absence.

Isolated `$CTRLB_HOME` workspace; the skill is written to `settings.skills_dir_path()` like
`test_resume_skills_c5m1.py`.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path

from _async import run_async

#: A string that appears ONLY inside the skill's instructions — its presence anywhere in the payload
#: means the skill leaked into context.
SENTINEL = "ZZZ_SKILL_SENTINEL_XYZZY"


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
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


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _run(coro):
    return run_async(coro)


def _write_skill(root: Path, name: str = "deploy") -> None:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: deploy a release build\nallowed_tools: [ping_host]\n---\n"
        f"{SENTINEL} follow these deployment steps carefully.\n",
        encoding="utf-8",
    )


def _skilled_session(c):
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        agent,
        skills=s.skills,
        selector=s.skill_selector,
        interactive=True,
    )


def _bare_session(c):
    """A baseline session with NO skills provider — the zero-skills reference toolset."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None)
    return AgentSession(s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True)


def _tool_names(tools: list[dict]) -> set[str]:
    return {t["function"]["name"] for t in tools}


def test_inactive_skill_contributes_zero_context() -> None:
    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path())

        # Baseline: no skills provider at all → the reference toolset.
        bare = _bare_session(c)
        bare._activate_skills("", None)
        baseline_tools = bare._tools()

        # Skill PRESENT but INACTIVE: a user message with no token overlap with the skill's
        # name/description, and no explicit `/deploy` invocation → the selector does not pick it.
        inactive = _skilled_session(c)
        inactive._activate_skills("please wake the corsair workstation", None)
        assert inactive._skills_note is None  # mechanism 1: no instructions injected
        assert inactive._tool_allow == inactive._agent.tools  # mechanism 2: no narrowing applied

        head_blob = json.dumps(inactive._static_prefix())
        tools_blob = json.dumps(inactive._tools())
        assert SENTINEL not in head_blob  # the skill's instructions are absent from the messages head
        assert SENTINEL not in tools_blob
        # The toolset is byte-identical to the no-skills baseline (the inactive skill neither
        # narrowed the set nor added its own tools).
        assert inactive._tools() == baseline_tools

        # Contrast — the SAME skill, ACTIVE (explicitly invoked): now its sentinel IS injected and
        # the toolset IS narrowed to the skill's `allowed_tools`. Proves the gate is activation.
        active = _skilled_session(c)
        active._activate_skills("deploy a release", ["deploy"])
        assert active._skills_note is not None and SENTINEL in active._skills_note
        assert SENTINEL in json.dumps(active._static_prefix())
        assert active._tool_allow == ["ping_host"]  # narrowed to the skill's allowlist
        active_names = _tool_names(active._tools())
        baseline_names = _tool_names(baseline_tools)
        # The narrowed set keeps the skill's tool (+ always-on core builtins) but is a STRICT subset of
        # the broad baseline — the narrowing dropped the fleet/action tools the skill didn't allow.
        assert "ping_host" in active_names
        assert active_names < baseline_names  # strictly fewer than the no-skills baseline
        assert baseline_names - active_names  # at least one non-core tool was dropped by narrowing


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
