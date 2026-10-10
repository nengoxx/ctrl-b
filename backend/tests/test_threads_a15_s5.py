"""D84 / Phase 27 S5 — the 7e-g auto-router (`agent.auto_rotate`) retires (CONVERSATIONS_PLAN R10, R24, §9).

What is pinned here:

  1. a config still carrying the retired keys LOADS (no migration, no config-shape bump — R24): `AgentCfg`
     is `extra="allow"`, so the keys ride `model_extra` inert and round-trip through `model_dump` (the
     recorded residual, §9 — key hygiene belongs to the J2 config de-bloat, not to this slice);
  2. the app boots on such a config with no router wired, and the settings PUT treats the retired keys
     exactly as it treats any other unknown `agent.*` key: accepted, persisted, echoed back, read by
     nothing — no new rejection, no new acceptance;
  3. the chat route's agent: `body.agent` set → that agent (the responder); unset → `None`, which
     `_build_session` resolves to the thread's pin — even on an unpinned legacy row with the old switch
     ON and a specialist whose description matches the message (nothing routes any more).

Every case runs in a temp `$CTRLB_HOME`; the real config/db are never touched.
"""

from __future__ import annotations

import importlib.util

import yaml
from _async import run_async
from test_roleplay_s0 import _agent, _client, _workspace
from test_roleplay_s1 import _capture_chat_session

_OLD_KEYS = "server:\n  port: 5433\nagent:\n  auto_rotate: true\n  auto_rotate_min_overlap: 3\n"


def test_a_config_with_the_retired_keys_loads_and_round_trips_them_inert() -> None:
    from app.config import AgentCfg, Settings, load_settings

    with _workspace(_OLD_KEYS) as (_tmp, cfg):
        settings = load_settings(cfg)
    assert "auto_rotate" not in AgentCfg.model_fields
    assert "auto_rotate_min_overlap" not in AgentCfg.model_fields
    assert settings.agent.model_extra == {"auto_rotate": True, "auto_rotate_min_overlap": 3}
    dumped = settings.model_dump(mode="json")
    assert dumped["agent"]["auto_rotate"] is True  # round-trips verbatim — never rewritten, never dropped
    assert dumped["agent"]["auto_rotate_min_overlap"] == 3
    assert Settings.model_validate(dumped).agent.model_extra == settings.agent.model_extra
    yaml.safe_dump(dumped)  # the persisted shape still serializes


def test_the_router_is_gone_from_the_app_and_the_tree() -> None:
    assert importlib.util.find_spec("app.services.agent.selector") is None
    with _workspace(_OLD_KEYS), _client() as c:
        assert not hasattr(c.app.state, "agent_selector")
        agent = c.get("/api/settings").json()["agent"]
        assert (agent["auto_rotate"], agent["auto_rotate_min_overlap"]) == (True, 3)  # echoed, inert


def test_the_settings_put_treats_a_retired_key_as_any_unknown_key() -> None:
    """Both land the same way an unrelated unknown key does: 200, written to disk, read by nothing. The
    former `ge=1` int bound is gone with the field — a junk value is no longer a 422."""
    with _workspace(_OLD_KEYS) as (_tmp, cfg), _client() as c:
        r = c.put("/api/settings", json={"agent": {"auto_rotate": False, "zz_unknown_knob": 5}})
        assert r.status_code == 200, r.text
        assert c.put("/api/settings", json={"agent": {"auto_rotate_min_overlap": "junk"}}).status_code == 200
        on_disk = yaml.safe_load(cfg.read_text(encoding="utf-8"))["agent"]
        assert on_disk == {"auto_rotate": False, "auto_rotate_min_overlap": "junk", "zz_unknown_knob": 5}


def _chat_agent_name(c, thread_id: str, agent: str | None = None) -> str | None:
    import app.api.agent as agent_api

    body: dict = {"text": "debug my python code", "thread_id": thread_id}
    if agent is not None:
        body["agent"] = agent
    with _capture_chat_session(agent_api) as cap:
        r = c.post("/api/agent/chat", json=body)
        assert r.status_code == 200, r.text
    return cap["agent_name"]


def test_the_chat_route_runs_body_agent_or_the_threads_pin_and_never_routes() -> None:
    from app.domain.conversation import Thread

    with _workspace(_OLD_KEYS), _client() as c:
        _agent(c, "coder", description="write and debug python code")
        _agent(c, "writer", description="draft prose and articles")
        threads = c.app.state.threads
        pinned = run_async(threads.create(Thread(agent="writer")))
        # An UNPINNED legacy row, written through the repo — the one shape the old router reached (O25).
        legacy = run_async(threads.create(Thread()))
        for thread in (pinned, legacy):
            assert _chat_agent_name(c, thread.id, agent="coder") == "coder"  # set → the responder
            assert _chat_agent_name(c, thread.id) is None  # unset → `_build_session` takes the pin


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
