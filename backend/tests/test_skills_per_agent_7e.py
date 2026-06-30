"""Phase 7e-f-1 — per-agent skills + inheritance (`available_skills`, D14).

A specialist's own `agents/<name>/skills/` is always available; the global `skills/` is inherited via
the agent's existing `skills` allowlist (`"*"` all · list subset · `[]` none) — no separate inherit
knob (the reuse decision). An own skill overrides an inherited one of the same name. The default/root
agent IS the global set (no own folder).

What's exercised:
  1. own always available + inherit all (`skills="*"`): specialist sees own + every global skill.
  2. inherit subset (`skills=[one]`): only the listed global skill inherited; own still present.
  3. inherit none (`skills=[]`): no global inherited; own still present.
  4. own overrides an inherited skill of the same name (the specialist's version wins).
  5. default agent: gets the global skills its own allowlist permits, with no own folder.
  6. resolve_skills still selects over the agent's effective set (invoked + keyword pick).

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

import yaml


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


def _skill(root: Path, name: str, *, desc: str = "", body: str = "do the thing") -> None:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {desc}\n---\n{body}\n", encoding="utf-8")


def _specialist(tmp: Path, slug: str, agent_yaml: dict) -> None:
    d = tmp / "agents" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "agent.yaml").write_text(yaml.safe_dump(agent_yaml), encoding="utf-8")
    (d / "SOUL.md").write_text("You are a specialist.\n", encoding="utf-8")


def _avail(c, agent_name: str | None) -> list[str]:
    from app.services.agent.skills import available_skills

    s = c.app.state.settings
    agent = s.resolve_agent(agent_name)
    return sorted(sk.name for sk in available_skills(c.app.state.skills, s, agent))


def test_own_always_available_and_inherit_all() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _skill(c.app.state.settings.skills_dir_path(), "globalA")
            _skill(c.app.state.settings.skills_dir_path(), "globalB")
            _specialist(tmp, "coder", {"skills": "*"})
            _skill(tmp / "agents" / "coder" / "skills", "coderown")
            assert _avail(c, "coder") == ["coderown", "globalA", "globalB"]


def test_inherit_subset() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _skill(c.app.state.settings.skills_dir_path(), "globalA")
            _skill(c.app.state.settings.skills_dir_path(), "globalB")
            _specialist(tmp, "coder", {"skills": ["globalA"]})
            _skill(tmp / "agents" / "coder" / "skills", "coderown")
            assert _avail(c, "coder") == ["coderown", "globalA"]  # globalB not inherited


def test_inherit_none_keeps_own() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _skill(c.app.state.settings.skills_dir_path(), "globalA")
            _specialist(tmp, "coder", {"skills": []})
            _skill(tmp / "agents" / "coder" / "skills", "coderown")
            assert _avail(c, "coder") == ["coderown"]  # no global, own still there


def test_own_overrides_inherited_same_name() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _skill(c.app.state.settings.skills_dir_path(), "shared", desc="GLOBAL version")
            _specialist(tmp, "coder", {"skills": "*"})
            _skill(tmp / "agents" / "coder" / "skills", "shared", desc="OWN version")
            from app.services.agent.skills import available_skills

            s = c.app.state.settings
            av = {sk.name: sk for sk in available_skills(c.app.state.skills, s, s.resolve_agent("coder"))}
            assert av["shared"].description == "OWN version"


def test_default_agent_gets_global_no_own() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            _skill(c.app.state.settings.skills_dir_path(), "globalA")
            _skill(c.app.state.settings.skills_dir_path(), "globalB")
            assert _avail(c, None) == ["globalA", "globalB"]  # default = the global set


def test_resolve_skills_over_available_set() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            from app.services.agent.skills import (
                KeywordSkillSelector,
                available_skills,
                resolve_skills,
            )

            _skill(c.app.state.settings.skills_dir_path(), "backups", desc="backup and restore data")
            _specialist(tmp, "coder", {"skills": "*"})
            _skill(tmp / "agents" / "coder" / "skills", "deploy", desc="deploy a release to prod")
            s = c.app.state.settings
            av = available_skills(c.app.state.skills, s, s.resolve_agent("coder"))
            # user-invoked /deploy always honored even if the message doesn't mention it
            inv = resolve_skills(av, KeywordSkillSelector(), "please run a backup now", invoked=["deploy"])
            names = [sk.name for sk in inv]
            assert "deploy" in names and "backups" in names  # invoked + keyword-selected


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
