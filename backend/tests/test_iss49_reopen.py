"""ISS-49 — `PUT /api/threads/{id}/opening`: a pick on a FRESH thread re-seats its opening.

`/new` mints a thread pinned to the default and seeds its greeting (D70 §4.2 seam ①, ISS-31); picking
another agent before saying anything must replace BOTH — the pin and the greeting — or the picked
agent's model reads the first agent's greeting as its own turn. The properties pinned here:

  1. the re-seat is whole: new pin, the new agent's greeting (or none), `updated_at` advanced, the old
     row gone from `messages` and from the FTS index;
  2. the refusals: an owner turn (a user row OR an `actor=user` exec row) → 409; an EDITED opening →
     409 unless `discard_edited`; a name that does not resolve to ITSELF → 422 (never the root
     fallback); the turn marker → 409 busy; same pin → a 200 no-op that re-seeds nothing;
  3. it is ONE transaction: a seed that raises leaves the old pin and the old greeting in place.

Everything runs on a temp `$CTRLB_HOME` (the S0 workspace harness).
"""

from __future__ import annotations

import pytest
from _async import run_async
from test_roleplay_s0 import _agent, _client, _workspace


def _run(coro):
    return run_async(coro)


def _new_thread(c, agent: str) -> dict:
    r = c.post("/api/threads", json={"agent": agent})
    assert r.status_code == 200, r.text
    return r.json()


def _messages(c, thread_id: str) -> list[dict]:
    r = c.get(f"/api/threads/{thread_id}/messages")
    assert r.status_code == 200, r.text
    return r.json()


def _reopen(c, thread_id: str, agent: str, **extra):
    return c.put(f"/api/threads/{thread_id}/opening", json={"agent": agent, **extra})


def _pin(c, thread_id: str) -> str | None:
    thread = _run(c.app.state.threads.get(thread_id))
    assert thread is not None
    return thread.agent


def _fts(c, word: str) -> set[str]:
    return {h["message_id"] for h in _run(c.app.state.messages.search(word, limit=50))}


def _add(c, thread_id: str, role: str, text: str, *, actor) -> None:
    from app.domain.conversation import Message, TextPart

    _run(
        c.app.state.messages.add(
            Message(thread_id=thread_id, role=role, actor=actor, parts=[TextPart(text=text)])
        )
    )


def test_a_greeting_only_thread_is_reseated_whole() -> None:
    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Lynette pours the teacup.")
        _agent(c, "emma", greeting="Emma waves hello.")
        thread = _new_thread(c, "lynette")
        tid = thread["id"]
        (old,) = _messages(c, tid)
        assert _fts(c, "teacup") == {old["id"]}

        r = _reopen(c, tid, "emma")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["thread"]["id"] == tid
        assert body["thread"]["agent"] == "emma"
        assert body["thread"]["updated_at"] > thread["updated_at"]  # a reload hydrates this thread
        (greet,) = body["messages"]
        assert greet["id"] != old["id"]
        assert greet["agent"] == "emma"  # the who-line reads the row's own agent
        assert greet["actor"] == "agent"
        assert greet["parts"] == [{"type": "text", "text": "Emma waves hello."}]
        assert _messages(c, tid) == body["messages"]  # the floor IS the durable state
        assert _pin(c, tid) == "emma"
        assert _fts(c, "teacup") == set()  # the old greeting left the index with its row


def test_an_empty_pinned_thread_is_pinned_and_seeded() -> None:
    """The old agent greeted nobody (no greeting text): only the pin changes, then the seed lands."""
    with _workspace(), _client() as c:
        _agent(c, "plain")
        _agent(c, "nyx", greeting="Mind the dust.")
        tid = _new_thread(c, "plain")["id"]
        assert _messages(c, tid) == []

        r = _reopen(c, tid, "nyx")
        assert r.status_code == 200, r.text
        assert r.json()["thread"]["agent"] == "nyx"
        (greet,) = _messages(c, tid)
        assert greet["agent"] == "nyx"


def test_a_reseated_greeting_is_not_unread() -> None:
    """The re-seat's seed lifts `seen_at` like the other greeting seams (D84 §3, §12.3 L2): the owner is
    looking at this thread — its new opening never dots it unread."""
    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        _agent(c, "emma", greeting="Hello.")
        tid = _new_thread(c, "lynette")["id"]
        assert _reopen(c, tid, "emma").status_code == 200
        (row,) = c.get("/api/threads", params={"agent": "emma"}).json()
        assert row["id"] == tid and row["unread"] is False


def test_a_target_with_no_greeting_or_switched_off_leaves_the_thread_empty() -> None:
    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        _agent(c, "plain")
        _agent(c, "mute", greeting="Never shown.", greeting_enabled=False)
        for target in ("plain", "mute"):
            tid = _new_thread(c, "lynette")["id"]
            r = _reopen(c, tid, target)
            assert r.status_code == 200, r.text
            assert r.json()["messages"] == []
            assert _messages(c, tid) == []
            assert _pin(c, tid) == target


def test_the_same_pin_is_a_no_op_even_after_the_greeting_text_changed() -> None:
    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        thread = _new_thread(c, "lynette")
        tid = thread["id"]
        before = _messages(c, tid)
        _agent(c, "lynette", greeting="Coffee?")  # edited in the agent editor since — `/new` is that door

        r = _reopen(c, tid, "lynette")
        assert r.status_code == 200, r.text
        assert r.json()["messages"] == before
        assert r.json()["thread"]["updated_at"] == thread["updated_at"]  # nothing written
        assert _messages(c, tid) == before


def test_an_owner_turn_makes_the_thread_not_fresh() -> None:
    """Both halves of the predicate (`is_owner_turn`, the twin of the client's `isUserTurn`): a user row,
    and the `!cmd` exec pair's assistant row stamped `actor=user` (`count_user_messages` would miss it)."""
    from app.domain.enums import Actor

    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        _agent(c, "emma", greeting="Hello.")
        for role in ("user", "assistant"):
            tid = _new_thread(c, "lynette")["id"]
            _add(c, tid, role, "ls -la" if role == "assistant" else "hi", actor=Actor.USER)
            before = _messages(c, tid)

            r = _reopen(c, tid, "emma")
            assert r.status_code == 409, r.text
            assert (
                r.json()["detail"] == "this conversation has started — the pick applies from the next reply"
            )
            assert _messages(c, tid) == before
            assert _pin(c, tid) == "lynette"


def test_an_edited_greeting_needs_the_discard_confirm() -> None:
    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        _agent(c, "emma", greeting="Hello.")
        tid = _new_thread(c, "lynette")["id"]
        (greet,) = _messages(c, tid)
        r = c.patch(f"/api/threads/{tid}/messages/{greet['id']}", json={"text": "Tea, with honey?"})
        assert r.status_code == 200, r.text
        edited = _messages(c, tid)
        assert edited[0]["edited"]

        r = _reopen(c, tid, "emma")
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == "the greeting here was edited — pick again to confirm discarding it"
        assert _messages(c, tid) == edited
        assert _pin(c, tid) == "lynette"

        r = _reopen(c, tid, "emma", discard_edited=True)
        assert r.status_code == 200, r.text
        (fresh,) = _messages(c, tid)
        assert fresh["agent"] == "emma"
        assert not fresh.get("edited")


def test_an_unknown_name_is_422_and_nothing_changes() -> None:
    """`resolve_agent` folds an unknown folder to the ROOT — a typo must never wipe the greeting."""
    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        tid = _new_thread(c, "lynette")["id"]
        before = _messages(c, tid)

        r = _reopen(c, tid, "emmma")
        assert r.status_code == 422, r.text
        assert _messages(c, tid) == before
        assert _pin(c, tid) == "lynette"
        assert _reopen(c, tid, "").status_code == 422  # the body's own floor (min_length=1)
        assert _reopen(c, "no-such-thread", "lynette").status_code == 404


def test_the_root_by_name_passes_the_strict_compare() -> None:
    from app.config import Settings

    with _workspace(), _client() as c:
        root = c.app.state.settings.default_agent_def()
        assert root.name == Settings.DEFAULT_AGENT_NAME  # what makes "default" resolve to ITSELF
        _agent(c, "lynette", greeting="Tea?")
        tid = _new_thread(c, "lynette")["id"]

        r = _reopen(c, tid, Settings.DEFAULT_AGENT_NAME)
        assert r.status_code == 200, r.text
        assert r.json()["thread"]["agent"] == Settings.DEFAULT_AGENT_NAME
        assert all(m["agent"] != "lynette" for m in _messages(c, tid))


def test_a_held_turn_marker_is_the_busy_409() -> None:
    from app.services.agent.turns import release, reserve

    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        _agent(c, "emma", greeting="Hello.")
        tid = _new_thread(c, "lynette")["id"]
        handle = reserve(c.app.state.turns, tid, "chat")
        try:
            assert _reopen(c, tid, "emma").status_code == 409
        finally:
            release(c.app.state.turns, handle)
        assert not c.app.state.turns  # the route released nothing it did not hold
        assert _pin(c, tid) == "lynette"
        assert _reopen(c, tid, "emma").status_code == 200  # and it never leaked its own marker


def test_a_seed_that_raises_rolls_back_the_whole_reseat(monkeypatch) -> None:
    """ONE transaction (SYS-1): the delete and the re-pin already ran when the seed fails — both undo."""
    import app.api.agent as agent_api

    with _workspace(), _client() as c:
        _agent(c, "lynette", greeting="Tea?")
        _agent(c, "emma", greeting="Hello.")
        tid = _new_thread(c, "lynette")["id"]
        before = _messages(c, tid)

        async def _fail(*a, **kw):
            raise RuntimeError("injected")

        monkeypatch.setattr(agent_api, "seed_greeting", _fail)
        with pytest.raises(RuntimeError):
            _reopen(c, tid, "emma")
        assert _messages(c, tid) == before
        assert _pin(c, tid) == "lynette"
        assert not c.app.state.turns  # released on the way out


@pytest.mark.parametrize("role", ["user", "assistant"])
def test_is_owner_turn_matches_the_client_predicate(role: str) -> None:
    from app.domain.conversation import Message, TextPart
    from app.domain.enums import Actor
    from app.services.conversation import is_owner_turn

    def m(actor):
        return Message(thread_id="t", role=role, actor=actor, parts=[TextPart(text="x")])

    assert is_owner_turn(m(Actor.USER))
    assert is_owner_turn(m(Actor.AGENT)) is (role == "user")
