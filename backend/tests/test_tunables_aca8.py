"""ACA-8 — the chat-path tunables are config-driven, not hardcoded (Slice 1 item 4).

Before: `subagents._CHILD_TIMEOUT_S = 180.0` and `KeywordSkillSelector()` built bare with its
`min_overlap=1, max_skills=2` defaults, while the *agent* selector's threshold was already
config-driven (`agent.auto_rotate_min_overlap`). These pin the fix: the three new `AgentCfg`
knobs (a) default to the old hardcoded values (no behavior change) and (b) actually flow through
to the constructed skill selector and the `spawn_subagents` orchestrator.

Nuance mirrored from `config.py`: `subagent_child_timeout_s` is read LIVE per fan-out (a Conf edit
applies without a restart), while `skill_min_overlap`/`skill_max_active` are baked into the selector
at construction (a restart picks up a change) — the selector's long-standing shape.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async

from app.domain.event import ORIGIN_USER_CHAT


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


# ── defaults preserved: the config Field defaults equal the old hardcoded constants ────────────
def test_defaults_match_the_old_hardcoded_values() -> None:
    from app.config import AgentCfg

    cfg = AgentCfg()
    assert cfg.subagent_child_timeout_s == 180.0  # was subagents._CHILD_TIMEOUT_S
    assert cfg.skill_min_overlap == 1  # was KeywordSkillSelector(min_overlap=1, ...)
    assert cfg.skill_max_active == 2  # was KeywordSkillSelector(..., max_skills=2)


def test_agentcfg_bounds() -> None:
    import pytest
    from pydantic import ValidationError

    from app.config import AgentCfg

    with pytest.raises(ValidationError):
        AgentCfg(subagent_child_timeout_s=0)  # gt=0
    with pytest.raises(ValidationError):
        AgentCfg(skill_min_overlap=0)  # ge=1
    with pytest.raises(ValidationError):
        AgentCfg(skill_max_active=0)  # ge=1


# ── skill selector: main.py bakes the configured values into app.state.skill_selector ──────────
def test_skill_selector_wired_from_config() -> None:
    cfg = "agent:\n  skill_min_overlap: 3\n  skill_max_active: 5\n"
    with _workspace(cfg), _client() as c:
        sel = c.app.state.skill_selector
        assert sel._min == 3
        assert sel._max == 5


# ── subagents: spawn_subagents builds its orchestrator with the LIVE config timeout ────────────
def test_spawn_subagents_passes_config_child_timeout() -> None:
    from app.domain.enums import Actor, Privilege
    from app.services.agent import subagents

    captured: dict = {}

    class _FakeOrch:
        def __init__(self, *, per_agent, global_sem, child_timeout_s) -> None:
            captured["timeout"] = child_timeout_s

        async def run_many(self, deps, children, *, depth, parent_origin):  # noqa: ANN001, ANN202
            return []

    with _workspace("agent:\n  subagent_child_timeout_s: 5.5\n"), _client() as c:
        orig = subagents.ParallelOrchestrator
        subagents.ParallelOrchestrator = _FakeOrch  # type: ignore[misc]
        try:
            _run(
                c.app.state.actions.invoke(
                    "spawn_subagents",
                    {"tasks": [{"task": "a"}, {"task": "b"}]},
                    origin=ORIGIN_USER_CHAT,
                    actor=Actor.AGENT,
                    privilege=Privilege.FULL,  # bypass the MED-risk confirm gate for the test
                )
            )
        finally:
            subagents.ParallelOrchestrator = orig  # type: ignore[misc]
        assert captured["timeout"] == 5.5


def test_parallel_orchestrator_stores_timeout() -> None:
    from app.services.agent.subagents import ParallelOrchestrator

    orch = ParallelOrchestrator(per_agent=2, global_sem=None, child_timeout_s=7.0)
    assert orch._timeout == 7.0


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
