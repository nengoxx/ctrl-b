"""Phase 23 S8 / D78 — the owner-persona LIBRARY (ROLEPLAY_PLAN §14.1 + the §14.4 amendments).

What's pinned:
  1. The router   — `POST /api/personas` mints the slug server-side (Emma A-2) and refuses a taken
                    one with 409 (the hosts rule); `PUT` renames without moving the slug; `DELETE`
                    does not cascade, and the link it leaves dangling resolves to the default.
  2. The shape    — library keys are slugs on `RoleplayCfg`; the agent editor's PUT checks the
                    link's SHAPE only (an unknown slug is legal, A-4).
  3. The resolver — `resolve_persona`'s rungs (agent link → default → none, each only when it
                    resolves) and its once-per-(agent, slug) warning for a dangling link.

Writes go through the APIs on a **temp** workspace; the real `config.yaml` is never touched.
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from pathlib import Path

import pytest
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


def _library(cfg: Path) -> dict:
    return (yaml.safe_load(cfg.read_text(encoding="utf-8")).get("roleplay") or {}).get("personas") or {}


def _put_agent(c, name: str, **fields):
    return c.put(f"/api/agents/{name}", json={"agent": fields})


def _user(c, agent_name: str) -> str:
    from app.services.agent.macros import macros_for

    s = c.app.state.settings
    return macros_for(s.resolve_agent(agent_name), s).user


# ── 1. the router ───────────────────────────────────────────────────────────────────────────────


def test_post_mints_the_slug_server_side_and_writes_the_entry() -> None:
    with _workspace() as (_tmp, cfg), _client() as c:
        r = c.post("/api/personas", json={"name": "The DM", "description": "Runs the table."})
        assert r.status_code == 201, r.text
        assert r.json() == {"slug": "the-dm", "name": "The DM", "description": "Runs the table."}
        assert _library(cfg) == {"the-dm": {"name": "The DM", "description": "Runs the table."}}
        # reads stay on the settings document
        body = c.get("/api/settings").json()["roleplay"]
        assert body["personas"] == {"the-dm": {"name": "The DM", "description": "Runs the table."}}


def test_a_name_that_mints_to_nothing_gets_the_fallback_slug() -> None:
    with _workspace(), _client() as c:
        r = c.post("/api/personas", json={"name": "✨"})
        assert r.status_code == 201 and r.json()["slug"] == "persona"


def test_post_refuses_a_taken_slug_and_an_empty_name() -> None:
    """Two names that collapse to one slug are refused, never overwritten (Emma A-2, the hosts 409)."""
    with _workspace() as (_tmp, cfg), _client() as c:
        assert c.post("/api/personas", json={"name": "Ari", "description": "first"}).status_code == 201
        r = c.post("/api/personas", json={"name": "ARI"})
        assert r.status_code == 409 and "detail" in r.json()
        assert _library(cfg)["ari"] == {"name": "Ari", "description": "first"}
        assert c.post("/api/personas", json={"name": "   "}).status_code == 422


def test_put_renames_without_moving_the_slug_and_keeps_unmanaged_fields() -> None:
    """The slug is identity, the name display (D78 / R90 §3.1): a rename keeps every link. A field
    the form does not manage (a later `avatar`, `extra=allow`) stays on the node."""
    with _workspace() as (_tmp, cfg), _client() as c:
        slug = c.post("/api/personas", json={"name": "Ari", "description": "old"}).json()["slug"]
        assert _put_agent(c, "nyx", persona=slug).status_code == 200
        text = cfg.read_text(encoding="utf-8").replace("name: Ari", "name: Ari\n      avatar: ari.png")
        cfg.write_text(text, encoding="utf-8")

        r = c.put(f"/api/personas/{slug}", json={"name": "Arisu", "description": ""})
        assert r.status_code == 200, r.text
        assert r.json() == {"slug": "ari", "name": "Arisu", "description": ""}
        assert _library(cfg) == {"ari": {"name": "Arisu", "avatar": "ari.png"}}
        assert _user(c, "nyx") == "Arisu"


def test_put_and_delete_404_on_an_unknown_slug() -> None:
    with _workspace(), _client() as c:
        assert c.put("/api/personas/nobody", json={"name": "X"}).status_code == 404
        assert c.delete("/api/personas/nobody").status_code == 404


def test_delete_does_not_cascade_and_the_dangling_link_resolves_to_the_default() -> None:
    with _workspace() as (tmp, cfg), _client() as c:
        dm = c.post("/api/personas", json={"name": "The DM"}).json()["slug"]
        ari = c.post("/api/personas", json={"name": "Ari"}).json()["slug"]
        assert c.put("/api/settings", json={"roleplay": {"default_persona": ari}}).status_code == 200
        assert _put_agent(c, "nyx", persona=dm).status_code == 200
        assert _user(c, "nyx") == "The DM"

        assert c.delete(f"/api/personas/{dm}").status_code == 204
        assert set(_library(cfg)) == {"ari"}
        on_disk = yaml.safe_load((tmp / "agents" / "nyx" / "agent.yaml").read_text(encoding="utf-8"))
        assert on_disk["persona"] == "the-dm"  # the link is kept, not cleared
        assert _user(c, "nyx") == "Ari"

        # deleting the default dangles it too — nothing resolves, `{{user}}` is the literal again
        assert c.delete(f"/api/personas/{ari}").status_code == 204
        assert c.get("/api/settings").json()["roleplay"]["default_persona"] == "ari"
        assert _user(c, "nyx") == "User"


# ── 2. the shape ────────────────────────────────────────────────────────────────────────────────


def test_roleplay_cfg_pins_every_library_key_to_a_slug() -> None:
    from pydantic import ValidationError

    from app.config import RoleplayCfg

    RoleplayCfg.model_validate({"personas": {"ari": {}, "the-dm": {}, "a_b": {}, "x2": {}}})
    for bad in ("Ari", "-ari", "a b", "", "a/b"):
        with pytest.raises(ValidationError):
            RoleplayCfg.model_validate({"personas": {bad: {}}})
    # a dangling default is not a schema error
    assert RoleplayCfg.model_validate({"default_persona": "nobody"}).default_persona == "nobody"


def test_the_agent_put_checks_the_persona_shape_only() -> None:
    with _workspace(), _client() as c:
        assert _put_agent(c, "nyx", persona="not-in-the-library").status_code == 200
        assert _put_agent(c, "nyx", persona="").status_code == 200
        r = _put_agent(c, "nyx", persona="Not A Slug")
        assert r.status_code == 422 and "persona" in r.json()["detail"]


def test_the_agent_dto_carries_the_link() -> None:
    with _workspace(), _client() as c:
        assert _put_agent(c, "nyx", persona="ari").status_code == 200
        assert c.get("/api/agents/nyx").json()["agent"]["persona"] == "ari"


# ── 3. the resolver ─────────────────────────────────────────────────────────────────────────────


def _settings(personas: dict, default: str = ""):
    from app.config import Settings

    return Settings.model_validate({"roleplay": {"personas": personas, "default_persona": default}})


def test_resolve_persona_walks_its_rungs() -> None:
    from app.domain.agent import AgentDef
    from app.services.agent.persona import resolve_persona

    lib = {"ari": {"name": "Ari"}, "dm": {"name": "The DM", "description": "Runs it."}}
    s = _settings(lib, "ari")
    linked = resolve_persona(AgentDef(name="nyx", persona="dm"), s)
    assert linked is not None and linked[0] == "dm" and linked[1].description == "Runs it."
    fallback = resolve_persona(AgentDef(name="nyx"), s)
    assert fallback is not None and fallback[0] == "ari"
    dangling = resolve_persona(AgentDef(name="nyx", persona="gone"), s)
    assert dangling is not None and dangling[0] == "ari"
    assert resolve_persona(AgentDef(name="nyx"), _settings(lib)) is None
    assert resolve_persona(AgentDef(name="nyx", persona="gone"), _settings(lib, "gone-too")) is None


def test_a_dangling_link_warns_once_per_agent_and_slug(caplog: pytest.LogCaptureFixture) -> None:
    from app.domain.agent import AgentDef
    from app.services.agent import persona as mod

    mod._DANGLING_WARNED.clear()
    s = _settings({"ari": {"name": "Ari"}}, "ari")
    with caplog.at_level(logging.WARNING, logger=mod.__name__):
        for _ in range(3):
            mod.resolve_persona(AgentDef(name="nyx", persona="gone"), s)
        mod.resolve_persona(AgentDef(name="lyn", persona="gone"), s)
    lines = [r.getMessage() for r in caplog.records if r.name == mod.__name__]
    assert len(lines) == 2
    assert "'nyx'" in lines[0] and "'gone'" in lines[0]
    assert "'lyn'" in lines[1]


def test_the_settings_put_refuses_the_library_so_a_stale_map_cannot_resurrect_a_delete() -> None:
    """A deep-merge can only ADD (Emma S8 F1): a client echoing `roleplay.personas` through the generic
    settings PUT after another client's DELETE would bring the persona back. Refused with 422."""
    with _workspace() as (_tmp, cfg), _client() as c:
        slug = c.post("/api/personas", json={"name": "Ari", "description": "me"}).json()["slug"]
        stale = c.get("/api/settings").json()["roleplay"]  # what a lagging client would hold
        assert slug in stale["personas"]
        assert c.delete(f"/api/personas/{slug}").status_code == 204
        r = c.put("/api/settings", json={"roleplay": {"personas": stale["personas"]}})
        assert r.status_code == 422
        assert "/api/personas" in r.json()["detail"]
        assert slug not in _library(cfg)
        assert slug not in c.app.state.settings.roleplay.personas
        # …while the scalar beside it still rides the ordinary PUT (dangling is legal, A-4).
        assert c.put("/api/settings", json={"roleplay": {"default_persona": slug}}).status_code == 200
        assert c.app.state.settings.roleplay.default_persona == slug
