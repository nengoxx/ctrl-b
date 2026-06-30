"""Phase 7e-g — the optional agent auto-router (`AgentSelector`, D15 #8).

When `agent.auto_rotate` is on and no `/agent` is pinned, the chat endpoint picks the best-matching
specialist per turn via `KeywordAgentSelector` (token overlap of the user message against each
agent's `name + description`, the shared `core.textmatch` matcher). Off by default; an explicit
`/agent` or a thread-sticky agent always wins.

What's exercised:
  1. clear winner ≥ threshold is picked; 2. below-threshold → None; 3. a tie at the top → None;
  4. empty/all-stopword message → None; 5. `select_agent` resolves names + skips a malformed agent;
  6. the chat endpoint routes only when auto_rotate is on + nothing pins the agent (off → None /
     default; explicit `/agent` wins, the selector isn't consulted);
  7. the refactored `KeywordSkillSelector` still scores the same (the shared-matcher refactor).

Each workspace test runs in an isolated `$CTRLB_HOME`; the real config/db are never touched.
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


def _specialist(tmp: Path, slug: str, agent_yaml: dict) -> None:
    d = tmp / "agents" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "agent.yaml").write_text(yaml.safe_dump(agent_yaml), encoding="utf-8")
    (d / "SOUL.md").write_text("You are a specialist.\n", encoding="utf-8")


def _agent(name: str, desc: str = ""):
    from app.domain.agent import AgentDef

    return AgentDef(name=name, description=desc)


# ── 1–4: the keyword selector's decision logic (pure, no workspace) ───────────────────────────

def test_clear_winner_picked() -> None:
    from app.services.agent.selector import KeywordAgentSelector

    agents = [
        _agent("coder", "write and debug python code"),
        _agent("writer", "draft prose and articles"),
    ]
    picked = KeywordAgentSelector().select("help me debug my python code", agents)
    assert picked is not None and picked.name == "coder"


def test_below_threshold_none() -> None:
    from app.services.agent.selector import KeywordAgentSelector

    agents = [_agent("coder", "write and debug python code")]
    # Only one matching token ("python") < the default threshold of 2 → fall through.
    assert KeywordAgentSelector().select("python", agents) is None


def test_tie_at_top_none() -> None:
    from app.services.agent.selector import KeywordAgentSelector

    agents = [
        _agent("alpha", "deploy release to prod"),
        _agent("beta", "deploy release to prod"),
    ]
    # Both share {deploy, release} (≥2) — a tie at the top means don't guess.
    assert KeywordAgentSelector().select("deploy a release", agents) is None


def test_empty_message_none() -> None:
    from app.services.agent.selector import KeywordAgentSelector

    agents = [_agent("coder", "write and debug python code")]
    assert KeywordAgentSelector().select("please help me", agents) is None  # all stopwords


# ── 5: select_agent — name resolution + malformed-agent skip ──────────────────────────────────

def test_select_agent_resolves_and_skips_malformed() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            from app.services.agent.selector import KeywordAgentSelector, select_agent

            _specialist(tmp, "coder", {"description": "write and debug python code"})
            _specialist(tmp, "writer", {"description": "draft prose and articles"})
            _specialist(tmp, "broken", {"description": "matches python code too", "privilege": "bogus"})
            s = c.app.state.settings
            sel = KeywordAgentSelector()
            # "broken" would also match but fails to load (bad privilege) — skipped, not fatal.
            assert select_agent(s, sel, "debug my python code") == "coder"
            # Nothing matches strongly enough → None (the configured default takes over).
            assert select_agent(s, sel, "what is the weather today") is None


# ── 6: the chat endpoint gate (spy on _session, never drive the model) ────────────────────────

class _DummySession:
    """Stands in for `AgentSession` so the chat endpoint streams nothing (no LLM call) — we only
    assert which `agent_name` the endpoint resolved."""

    async def run_turn(self, *a, **k):  # async generator that yields nothing
        return
        yield  # pragma: no cover


@contextlib.contextmanager
def _capture_chat_session(agent_api):
    captured: dict[str, str | None] = {}
    orig = agent_api._session

    def spy(request, thread=None, agent_name=None, privilege=None):
        captured["agent_name"] = agent_name
        return _DummySession()

    agent_api._session = spy
    try:
        yield captured
    finally:
        agent_api._session = orig


def _chat_agent_name(c, text: str, agent: str | None = None) -> str | None:
    import app.api.agent as agent_api

    body: dict = {"text": text}
    if agent is not None:
        body["agent"] = agent
    with _capture_chat_session(agent_api) as cap:
        r = c.post("/api/agent/chat", json=body)
        assert r.status_code == 200, r.text
    return cap.get("agent_name")


def test_chat_routes_only_when_enabled() -> None:
    specialists = "server:\n  port: 5433\n"
    with _workspace(specialists) as (tmp, cfg):
        _specialist(tmp, "coder", {"description": "write and debug python code"})
        _specialist(tmp, "writer", {"description": "draft prose and articles"})

        # auto_rotate OFF (the default) → no routing; agent_name stays None (resolves to default).
        with _client() as c:
            assert c.app.state.settings.agent.auto_rotate is False
            assert _chat_agent_name(c, "debug my python code") is None

        # auto_rotate ON → the matching specialist is selected for the turn.
        cfg.write_text("server:\n  port: 5433\nagent:\n  auto_rotate: true\n", encoding="utf-8")
        with _client() as c:
            assert c.app.state.settings.agent.auto_rotate is True
            assert _chat_agent_name(c, "debug my python code") == "coder"
            # An explicit /agent wins — the selector is not consulted (no override of intent).
            assert _chat_agent_name(c, "debug my python code", agent="writer") == "writer"
            # No strong match → None (falls through to the configured default).
            assert _chat_agent_name(c, "what is the weather") is None


# ── 7: the shared-matcher refactor didn't change skill scoring ────────────────────────────────

def test_skill_selector_unchanged_after_refactor() -> None:
    from app.core.skills import Skill
    from app.services.agent.skills import KeywordSkillSelector

    skills = [
        Skill(name="backups", description="backup and restore data"),
        Skill(name="deploy", description="deploy a release to prod"),
    ]
    picked = KeywordSkillSelector().select("please run a backup and restore", skills)
    assert [s.name for s in picked] == ["backups"]
    # min_overlap is still honored (baked at construction, unlike the agent selector).
    assert KeywordSkillSelector(min_overlap=2).select("backup", skills) == []


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
