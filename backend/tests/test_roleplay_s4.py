"""Phase 23 / D70 slice S4 (BE half) — the `GET /agents` SUMMARY MAP (§10-S4, Emma F12).

One compact per-agent projection beside the names, so the gallery, the composer's agent picker, the
who-line avatar and the backdrop share ONE always-on read instead of fetching every agent in full.

What is pinned here: the map holds the root default AND every specialist; the five showcase fields
come straight off the loaded `AgentDef`; the RESOLVED default is always a key (so `default` can be
looked up in the map); media stays unresolved (ids, not URLs — that join is the media index's); and a
specialist whose folder will not load degrades to a name-only row rather than 500ing the route.

The 7d contract of the route (names + resolved default) is pinned where it always was —
`test_agents_7d`. Everything runs on a temp `$CTRLB_HOME` workspace.
"""

from __future__ import annotations

from test_roleplay_s0 import _agent, _client, _workspace

_FIELDS = {"title", "description", "avatar", "background", "voice"}


def _listing(c) -> dict:
    r = c.get("/api/agents")
    assert r.status_code == 200, r.text
    return r.json()


def test_the_map_carries_the_default_and_every_specialist() -> None:
    with _workspace(), _client() as c:
        # a fresh workspace: the root default is the whole map
        assert set(_listing(c)["summaries"]) == {"default"}

        _agent(
            c,
            "lynette",
            title="Lynette",
            description="the detective",
            avatar="lynette.png",
            background="cafe.webp",
            voice="af_sky",
        )
        body = _listing(c)
        assert set(body["summaries"]) == {"default", "lynette"}
        assert body["summaries"]["lynette"] == {
            "title": "Lynette",
            "description": "the detective",
            "avatar": "lynette.png",  # a LIBRARY ENTRY NAME, never a URL — the index owns that join
            "background": "cafe.webp",
            "voice": "af_sky",
        }
        # every specialist is listed, and the map answers for each of them
        assert set(body["agents"]) <= set(body["summaries"])


def test_the_resolved_default_is_always_a_key() -> None:
    """The `default` key points INTO the map — that is what lets a consumer resolve "no agent named"
    to a summary without a second read."""
    with _workspace() as (_tmp, _cfg), _client() as c:
        assert _listing(c)["default"] in _listing(c)["summaries"]

        _agent(c, "ops", title="Ops Bot")
        assert c.put("/api/settings", json={"agent": {"default_agent": "ops"}}).status_code == 200
        body = _listing(c)
        assert body["default"] == "ops"
        assert body["summaries"][body["default"]]["title"] == "Ops Bot"


def test_the_default_row_carries_the_configured_default_title() -> None:
    """The root agent's display name is `agent.default_title`, not a folder field — the map has to
    show what `default_agent_def()` resolves, or the picker's default row would read as untitled."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"agent": {"default_title": "Atlas"}}).status_code == 200
        assert _listing(c)["summaries"]["default"]["title"] == "Atlas"


def test_the_summary_is_exactly_the_showcase_fields() -> None:
    """Not a whole `AgentDef` dump: the prompt, the tools, the limits and the card stash stay behind
    `GET /agents/{name}`, which is what keeps this read cheap enough to be always-on."""
    with _workspace(), _client() as c:
        _agent(c, "ops", title="Ops Bot", privilege="full")
        for summary in _listing(c)["summaries"].values():
            assert set(summary) == _FIELDS


def test_an_unloadable_specialist_degrades_instead_of_500ing() -> None:
    """`resolve_agent`'s posture, applied to a list: a folder that will not load keeps its ROW (with
    empty fields) rather than taking the route down or vanishing from a map `agents` still names."""
    with _workspace() as (tmp, _cfg), _client() as c:
        _agent(c, "broken", title="Broken")
        (tmp / "agents" / "broken" / "agent.yaml").write_text("title: [unclosed\n", encoding="utf-8")
        body = _listing(c)
        assert body["agents"] == ["broken"]
        assert body["summaries"]["broken"] == dict.fromkeys(_FIELDS, "")


def test_an_unloadable_CONFIGURED_DEFAULT_degrades_too() -> None:
    """The same posture at the TAIL of the payload. The per-agent loop swallows the loader error, but
    the closing `resolve_agent(None)` re-loads the CONFIGURED default — so naming a malformed agent as
    the default used to take the whole route down (a yaml ParserError, 500) even though its degraded
    row was already sitting in the map. `default` keeps naming it; a configured name with no row at
    all falls back to the root default, which is seeded first and always has one."""
    with _workspace() as (tmp, _cfg), _client() as c:
        _agent(c, "broken", title="Broken")
        assert c.put("/api/settings", json={"agent": {"default_agent": "broken"}}).status_code == 200
        (tmp / "agents" / "broken" / "agent.yaml").write_text("title: [unclosed\n", encoding="utf-8")
        body = _listing(c)
        assert body["agents"] == ["broken"]
        assert body["summaries"]["broken"] == dict.fromkeys(_FIELDS, "")
        assert body["default"] == "broken"  # its degraded row IS a row — `default` may point at it

        # …and the other arm: a configured default that `list_agent_names` skips (a folder whose name
        # is not a valid slug) has no row to point at, so `default` falls back to the root agent.
        odd = tmp / "agents" / "Not A Slug"
        odd.mkdir()
        (odd / "agent.yaml").write_text("title: [unclosed\n", encoding="utf-8")
        r = c.put("/api/settings", json={"agent": {"default_agent": "Not A Slug"}})
        assert r.status_code == 200, r.text
        body = _listing(c)
        assert body["default"] == "default"
        assert body["default"] in body["summaries"]
