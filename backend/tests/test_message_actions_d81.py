"""D81 — chat message actions: regenerate + reply alternates · delete · edit.

`messages` is ALWAYS the active transcript; a displaced reply is MOVED (as raw rows) into
`message_alternates` (db migration 7) and moved back on a swap. So the properties worth pinning are the
ones the design leans on:

  1. the stash round trip is LOSSLESS (raw rows byte-equal, an unknown `meta` key survives, FTS follows,
     ids + ts order hold with an owner steer interleaved);
  2. an error-only reply is discarded, an open call is CANCELLED and its token revoked;
  3. the four routes hold the turn marker (busy 409), refuse a rolling automation thread (403), and
     refuse a stale / anchorless / folded tail with the named 409s;
  4. delete resolves the UNIT server-side (user row · reply · owner pair) and leaves `_assemble` valid;
     the tail's shown variant goes with its neighbor restored; an anchor delete cascades its alternates;
  5. edit rewrites the text only, stamps `meta.edited` with foreign keys preserved, reindexes FTS;
  6. the `meta.skills` rider: `run_turn` persists explicit skills and `regenerate` re-activates them;
  7. `history_payload` hangs `reply: {ids, n, count}` on the tail's host row only.

The loop itself is replaced by a scripted `_drive` (no model); everything runs on a temp `$CTRLB_HOME`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import tempfile
from pathlib import Path

import pytest
from _async import run_async


@contextlib.contextmanager
def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("server:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _run(coro):
    return run_async(coro)


class _Thread:
    """Builds a thread row by row. Rows take the default wall-clock `ts` — exactly like production
    writes (and like the scripted take below), so order is creation order; `rowid` breaks any tie."""

    def __init__(self, c, *, agent: str | None = None) -> None:
        from app.domain.conversation import Thread

        self.c = c
        self.state = c.app.state
        self.thread = _run(self.state.threads.create(Thread(agent=agent)))
        self.id = self.thread.id

    def add(self, role: str, *parts, actor=None, **kw):
        from app.domain.conversation import Message
        from app.domain.enums import Actor

        if actor is None:
            actor = Actor.USER if role == "user" else Actor.AGENT
        m = Message(
            thread_id=self.id,
            role=role,
            parts=list(parts),
            actor=actor,
            **kw,
        )
        _run(self.state.messages.add(m))
        return m

    def user(self, text: str, **kw):
        from app.domain.conversation import TextPart

        return self.add("user", TextPart(text=text), **kw)

    def say(self, text: str, **kw):
        from app.domain.conversation import TextPart

        return self.add("assistant", TextPart(text=text), agent=kw.pop("agent", "default"), **kw)

    def call(self, tool: str, state="ok", args=None, **kw):
        """An assistant tool-call row + its `tool` result row (unless the call is still open)."""
        import uuid

        from app.domain.conversation import ToolCallPart, ToolResultPart
        from app.domain.enums import RunState
        from app.domain.result import ToolResult

        cid = uuid.uuid4().hex
        st = RunState(state)
        a = self.add(
            "assistant",
            ToolCallPart(call_id=cid, tool=tool, args=args or {}, state=st),
            agent=kw.pop("agent", "default"),
            **kw,
        )
        if st in (RunState.OK, RunState.ERROR):
            t = self.add(
                "tool", ToolResultPart(call_id=cid, result=ToolResult(state=st, summary="done")), **kw
            )
            return a, t, cid
        return a, None, cid

    def ids(self) -> list[str]:
        return [m.id for m in _run(self.state.messages.list(self.id))]

    def floor(self) -> list[dict]:
        r = self.c.get(f"/api/threads/{self.id}/messages")
        assert r.status_code == 200, r.text
        return r.json()


def _alt_rows(c, thread_id: str) -> list[dict]:
    rows = _run(
        c.app.state.db.query(
            "SELECT anchor_id, n, rows FROM message_alternates WHERE thread_id = ? ORDER BY n", (thread_id,)
        )
    )
    return [dict(r) for r in rows]


def _reply(floor: list[dict]) -> tuple[str, dict] | None:
    hosts = [(m["id"], m["reply"]) for m in floor if "reply" in m]
    assert len(hosts) <= 1, "the annotation rides ONE host row"
    return hosts[0] if hosts else None


def _fts(c, word: str) -> set[str]:
    return {h["message_id"] for h in _run(c.app.state.messages.search(word, limit=50))}


@pytest.fixture
def scripted_drive(monkeypatch):
    """Replace `AgentSession._drive` with a scripted take: persists ONE assistant row whose text names
    the session's agent (or nothing, when `persist` is flipped off) and emits the minimal event run."""
    from app.domain.conversation import Message, TextPart
    from app.domain.enums import Actor
    from app.services.agent.session import AgentEvent, AgentSession

    ctl = {"persist": True, "text": "a fresh take", "agents": []}

    async def _drive(self, thread, *, mode=None, **kw):
        ctl["agents"].append(self._agent.name)
        if ctl["persist"]:
            m = Message(
                thread_id=thread.id,
                role="assistant",
                actor=Actor.AGENT,
                agent=self._agent.name,
                parts=[TextPart(text=ctl["text"])],
            )
            await self._messages.add(m)
            yield AgentEvent("message.start", {"messageId": m.id, "role": "assistant"})
            yield AgentEvent("message.end", {"messageId": m.id})
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})

    monkeypatch.setattr(AgentSession, "_drive", _drive)
    return ctl


def _regen(c, thread_id: str, message_id: str, **extra):
    return c.post(
        "/api/agent/regenerate",
        json={"thread_id": thread_id, "message_id": message_id, "stream": False, **extra},
    )


# ── 0. schema ──────────────────────────────────────────────────────────────────────────────────


def test_migration_7_adds_the_alternates_table() -> None:
    from app.db import MIGRATIONS

    assert MIGRATIONS[-1][0] == 7
    with _client() as c:
        assert _run(c.app.state.db.schema_version()) == 7
        cols = {r["name"] for r in _run(c.app.state.db.query("PRAGMA table_info(message_alternates)"))}
        assert cols == {"id", "thread_id", "anchor_id", "n", "rows", "created_at"}


# ── 1. the stash round trip ────────────────────────────────────────────────────────────────────


def test_stash_and_swap_back_is_byte_lossless_and_fts_follows() -> None:
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        t = _Thread(c)
        t.user("tell me about zebras")
        a1, t1, _ = t.call("ping_host", args={"host_id": "emma"})
        a2 = t.say("zebrafinch answer")
        # A meta key this build does not model must survive the round trip untouched.
        _run(
            c.app.state.db.execute(
                "UPDATE messages SET meta = json_set(COALESCE(meta, '{}'), '$.future_key', 42) WHERE id = ?",
                (a2.id,),
            )
        )
        before = _run(c.app.state.messages.raw_rows([a1.id, t1.id, a2.id]))
        assert _fts(c, "zebrafinch") == {a2.id}

        alts = AlternatesRepo(c.app.state.messages)
        tail = _run(alts.tail_reply(t.id))
        assert tail.ids == [a1.id, t1.id, a2.id] and tail.host.id == a2.id
        displaced, revoked = _run(alts.stash_tail(t.id, tail))
        assert revoked == [] and displaced is not None
        assert len(t.ids()) == 1  # only the anchor is left
        assert _fts(c, "zebrafinch") == set()  # the index followed the move out
        assert [(r["n"], r["rows"] is None) for r in _alt_rows(c, t.id)] == [(1, False), (2, True)]

        a3 = t.say("second take")  # what the regenerate would have produced
        assert _run(alts.position(t.id, tail.anchor.id)) == (2, 2)
        _run(alts.select(t.id, _run(alts.tail_reply(t.id)), 1))

        assert _run(c.app.state.messages.raw_rows([a1.id, t1.id, a2.id])) == before
        assert json.loads(before[-1]["meta"])["future_key"] == 42
        assert _fts(c, "zebrafinch") == {a2.id}
        assert a3.id not in t.ids()
        assert _run(alts.position(t.id, tail.anchor.id)) == (1, 2)


def test_an_interleaved_steer_is_never_displaced_and_order_survives() -> None:
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        t = _Thread(c)
        u = t.user("do the thing")
        a1 = t.say("working on it")
        s = t.user("also do the other thing", steer=True)
        a2 = t.say("done both")
        original = t.ids()
        assert original == [u.id, a1.id, s.id, a2.id]

        alts = AlternatesRepo(c.app.state.messages)
        tail = _run(alts.tail_reply(t.id))
        assert tail.anchor.id == u.id and tail.ids == [a1.id, a2.id]  # the steer is not the anchor
        _run(alts.stash_tail(t.id, tail))
        assert t.ids() == [u.id, s.id]  # the owner's steer stays put
        t.say("a new take")
        _run(alts.select(t.id, _run(alts.tail_reply(t.id)), 1))
        assert t.ids() == original  # restored rows land exactly where they were generated


def test_an_error_only_reply_is_discarded_not_stashed() -> None:
    from app.domain.conversation import ErrorPart
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        t = _Thread(c)
        u = t.user("hi")
        t.add("assistant", ErrorPart(message="backend down", retryable=True), agent="default")
        alts = AlternatesRepo(c.app.state.messages)
        _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        assert t.ids() == [u.id] and _alt_rows(c, t.id) == []  # nothing to come back to

        # …and a junk take displaced AFTER a real one keeps the real one, the new take at N/N.
        t.say("a real answer")
        _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        t.add("assistant", ErrorPart(message="backend down again", retryable=True), agent="default")
        _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        assert [(r["n"], r["rows"] is None) for r in _alt_rows(c, t.id)] == [(1, False), (2, True)]


def test_selecting_away_from_a_junk_take_discards_it_and_collapses() -> None:
    from app.domain.conversation import ErrorPart
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        t = _Thread(c)
        u = t.user("hi")
        good = t.say("a real answer")
        alts = AlternatesRepo(c.app.state.messages)
        _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        t.add("assistant", ErrorPart(message="boom", retryable=True), agent="default")
        _run(alts.select(t.id, _run(alts.tail_reply(t.id)), 1))
        assert t.ids() == [u.id, good.id]
        assert _alt_rows(c, t.id) == []  # one survivor is no longer an alternate


# ── 2. the regenerate route ────────────────────────────────────────────────────────────────────


def test_regenerate_stashes_drives_and_the_arrows_swap(scripted_drive) -> None:
    with _client() as c:
        t = _Thread(c)
        t.user("write a haiku")
        first = t.say("old pond")
        host, reply = _reply(t.floor())
        assert host == first.id and reply == {"ids": [first.id], "n": 1, "count": 1}

        r = _regen(c, t.id, first.id)
        assert r.status_code == 200, r.text
        assert r.json()["state"] == "completed"
        floor = t.floor()
        new_host, reply = _reply(floor)
        assert floor[-1]["id"] == new_host and floor[-1]["parts"][0]["text"] == "a fresh take"
        assert reply == {"ids": [new_host], "n": 2, "count": 2}

        # ‹ back to the first take — the floor answers, with the original id restored.
        r = c.put(f"/api/threads/{t.id}/messages/{new_host}/alternate", json={"n": 1})
        assert r.status_code == 200, r.text
        host, reply = _reply(r.json()["messages"])
        assert host == first.id and reply == {"ids": [first.id], "n": 1, "count": 2}
        # the same n again is a no-op; out of range is 422
        assert c.put(f"/api/threads/{t.id}/messages/{first.id}/alternate", json={"n": 1}).status_code == 200
        assert c.put(f"/api/threads/{t.id}/messages/{first.id}/alternate", json={"n": 3}).status_code == 422
        # a stale host (the displaced take's id) is the frozen 409
        r = c.put(f"/api/threads/{t.id}/messages/{new_host}/alternate", json={"n": 2})
        assert r.status_code == 409 and r.json()["detail"] == "the conversation changed"

        # delete the SHOWN variant: its neighbor comes back and the stash collapses
        r = c.delete(f"/api/threads/{t.id}/messages/{first.id}")
        assert r.status_code == 200, r.text
        host, reply = _reply(r.json()["messages"])
        assert host == new_host and reply == {"ids": [new_host], "n": 1, "count": 1}
        assert _alt_rows(c, t.id) == []


def test_regenerate_speaks_as_the_agent_that_gave_the_displaced_reply(scripted_drive) -> None:
    with _client() as c:
        t = _Thread(c)
        t.user("hello")
        first = t.say("greetings", agent="seraphina")
        seen: list = []
        from app.api import agent as agent_api

        real = agent_api._session

        def _spy(request, thread=None, agent_name=None, privilege=None):
            seen.append(agent_name)
            return real(request, thread, agent_name=agent_name, privilege=privilege)

        agent_api._session = _spy
        try:
            assert _regen(c, t.id, first.id).status_code == 200
        finally:
            agent_api._session = real
        assert seen == ["seraphina"]


def test_a_regenerate_that_persists_nothing_restores_the_last_take(scripted_drive) -> None:
    with _client() as c:
        t = _Thread(c)
        u = t.user("hello")
        first = t.say("hi there")
        scripted_drive["persist"] = False  # stopped before its first row landed
        assert _regen(c, t.id, first.id).status_code == 200
        assert t.ids() == [u.id, first.id]
        assert _alt_rows(c, t.id) == []
        assert _reply(t.floor()) == (first.id, {"ids": [first.id], "n": 1, "count": 1})


def test_regenerate_cancels_an_open_call_and_revokes_its_token(scripted_drive) -> None:
    with _client() as c:
        t = _Thread(c)
        t.user("reboot emma")
        parked, _, cid = t.call("reboot_host", state="awaiting_confirm", args={"host_id": "emma"})
        revoked: list = []
        c.app.state.actions.revoke_pending = lambda tool, args: revoked.append((tool, args))
        assert _reply(t.floor())[0] == parked.id  # a parked reply still offers retry

        assert _regen(c, t.id, parked.id).status_code == 200
        assert revoked == [("reboot_host", {"host_id": "emma"})]
        stashed = json.loads(_alt_rows(c, t.id)[0]["rows"])
        call = json.loads(stashed[0]["parts"])[0]
        assert call["call_id"] == cid and call["state"] == "cancelled"


def test_regenerate_refusals(scripted_drive) -> None:
    from app.services.agent.turns import release, reserve

    with _client() as c:
        # greeting-only thread: no anchor, nothing to regenerate
        g = _Thread(c)
        greet = g.say("Welcome, traveller.")
        assert _reply(g.floor()) is None
        r = _regen(c, g.id, greet.id)
        assert r.status_code == 409 and "no reply" in r.json()["detail"]

        # owner-only tail (an !exec pair after the anchor) — nothing of the agent's to redo
        from app.domain.enums import Actor

        o = _Thread(c)
        o.user("run it")
        pair, _, _ = o.call("run_shell", actor=Actor.USER, agent=None)
        assert _reply(o.floor()) is None
        assert _regen(c, o.id, pair.id).status_code == 409

        # stale id + busy + compacted
        t = _Thread(c)
        u = t.user("q")
        a = t.say("a")
        r = _regen(c, t.id, u.id)
        assert r.status_code == 409 and r.json()["detail"] == "the conversation changed"
        handle = reserve(c.app.state.turns, t.id, "chat")
        try:
            r = _regen(c, t.id, a.id)
            assert r.status_code == 409 and "already running" in r.json()["detail"]
        finally:
            release(c.app.state.turns, handle)
        _run(c.app.state.db.execute("UPDATE messages SET compacted = 1 WHERE id = ?", (u.id,)))
        r = _regen(c, t.id, a.id)
        assert r.status_code == 409 and "folded" in r.json()["detail"]
        assert _reply(t.floor()) is None
        assert (
            c.post("/api/agent/regenerate", json={"thread_id": "nope", "message_id": "x"}).status_code == 404
        )


def test_every_action_refuses_a_rolling_automation_thread(scripted_drive) -> None:
    with _client() as c:
        t = _Thread(c)
        t.user("q")
        a = t.say("a")

        class _Owned:
            async def rolling_owner(self, thread_id):
                return "auto-1" if thread_id == t.id else None

        c.app.state.automations = _Owned()
        base = f"/api/threads/{t.id}/messages/{a.id}"
        assert _regen(c, t.id, a.id).status_code == 403
        assert c.put(f"{base}/alternate", json={"n": 1}).status_code == 403
        assert c.delete(base).status_code == 403
        assert c.patch(base, json={"text": "x"}).status_code == 403
        assert t.ids()[-1] == a.id  # nothing moved


def test_the_sync_routes_are_busy_409_under_a_live_turn() -> None:
    from app.services.agent.turns import release, reserve

    with _client() as c:
        t = _Thread(c)
        t.user("q")
        a = t.say("a")
        base = f"/api/threads/{t.id}/messages/{a.id}"
        handle = reserve(c.app.state.turns, t.id, "chat")
        try:
            assert c.put(f"{base}/alternate", json={"n": 1}).status_code == 409
            assert c.delete(base).status_code == 409
            assert c.patch(base, json={"text": "x"}).status_code == 409
        finally:
            release(c.app.state.turns, handle)
        assert not c.app.state.turns  # every route released its own marker


# ── 3. the meta.skills rider ───────────────────────────────────────────────────────────────────


def test_run_turn_persists_explicit_skills_and_regenerate_reactivates_them() -> None:
    from app.services.agent.session import AgentSession

    with _client() as c:
        s = c.app.state
        d = s.settings.skills_dir_path() / "deploy"
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(
            "---\nname: deploy\ndescription: ship a release\nallowed_tools: [ping_host]\n---\nShip it.\n",
            encoding="utf-8",
        )

        def _session():
            sess = AgentSession(
                s.threads,
                s.messages,
                s.inference,
                s.settings,
                s.actions,
                s.settings.resolve_agent(None),
                skills=s.skills,
                selector=s.skill_selector,
            )

            async def _noop(thread, *, mode=None, **kw):
                return
                yield

            sess._drive = _noop  # type: ignore[method-assign]
            return sess

        t = _Thread(c)

        async def _drain(agen):
            return [e async for e in agen]

        _run(_drain(_session().run_turn(t.thread, "unrelated words", skills=["deploy"])))
        anchor = _run(s.messages.list(t.id))[-1]
        assert anchor.skills == ["deploy"]
        plain = t.user("no skills here")
        assert plain.skills is None and _run(s.messages.get(plain.id)).skills is None

        from app.services.conversation import TailReply

        sess = _session()
        _run(_drain(sess.regenerate(t.thread, TailReply(anchor=anchor, rows=[]))))
        assert sess._skills_note is not None and "deploy" in sess._skills_note
        assert sess._tool_allow == ["ping_host"]


# ── 4. delete ──────────────────────────────────────────────────────────────────────────────────


def test_delete_resolves_the_unit_and_leaves_the_context_valid() -> None:
    from app.api.agent import _build_session
    from app.domain.conversation import Message, TextPart
    from app.domain.enums import Actor
    from app.services.conversation import resolve_unit

    with _client() as c:
        t = _Thread(c)
        greet = t.say("Welcome.")
        u1 = t.user("check the fleet")
        a1, t1, cid = t.call("ping_host", args={"host_id": "emma"})
        a2 = t.say("emma is up")
        xa, xt, _ = t.call("run_shell", actor=Actor.USER, agent=None)  # the owner's !exec pair
        u2 = t.user("thanks")
        a3 = t.say("any time")
        msgs = _run(c.app.state.messages.list(t.id))

        reply = resolve_unit(msgs, t1.id)
        assert reply.kind == "reply" and [m.id for m in reply.rows] == [a1.id, t1.id, a2.id]
        assert reply.anchor.id == u1.id and not reply.tail
        pair = resolve_unit(msgs, xt.id)
        assert pair.kind == "pair" and [m.id for m in pair.rows] == [xa.id, xt.id]
        assert resolve_unit(msgs, u1.id).kind == "user"
        g = resolve_unit(msgs, greet.id)
        assert g.kind == "reply" and g.anchor is None and [m.id for m in g.rows] == [greet.id]
        assert resolve_unit(msgs, a3.id).tail
        assert resolve_unit(msgs, "missing") is None

        r = c.delete(f"/api/threads/{t.id}/messages/{t1.id}")  # tapping ANY row of the reply
        assert r.status_code == 200, r.text
        assert [m["id"] for m in r.json()["messages"]] == [greet.id, u1.id, xa.id, xt.id, u2.id, a3.id]

        # the assembled context holds no orphan and no synthesized "skipped" for the deleted call
        session = _build_session(c.app.state, t.thread)
        wire = _run(session._assemble(t.thread))
        blob = json.dumps(wire)
        assert cid not in blob and "skipped" not in blob

        # a system/summary row has no delete
        sysrow = Message(thread_id=t.id, role="system", actor=Actor.AGENT, parts=[TextPart(text="summary")])
        _run(c.app.state.messages.add(sysrow))
        assert c.delete(f"/api/threads/{t.id}/messages/{sysrow.id}").status_code == 422
        assert c.delete(f"/api/threads/{t.id}/messages/nope").status_code == 404


def test_deleting_an_older_reply_takes_its_frozen_stash_and_an_anchor_cascades(scripted_drive) -> None:
    with _client() as c:
        t = _Thread(c)
        u1 = t.user("first question")
        a1 = t.say("first answer")
        assert _regen(c, t.id, a1.id).status_code == 200  # u1 now has 2 takes
        take2 = t.ids()[-1]
        t.user("second question")
        t.say("second answer")
        assert len(_alt_rows(c, t.id)) == 2  # frozen: u1 is no longer the tail
        r = c.delete(f"/api/threads/{t.id}/messages/{take2}")
        assert r.status_code == 200
        assert _alt_rows(c, t.id) == [] and a1.id not in t.ids() and take2 not in t.ids()

        t2 = _Thread(c)
        v = t2.user("q")
        b = t2.say("b1")
        assert _regen(c, t2.id, b.id).status_code == 200
        assert len(_alt_rows(c, t2.id)) == 2
        assert c.delete(f"/api/threads/{t2.id}/messages/{v.id}").status_code == 200
        assert _alt_rows(c, t2.id) == []  # the anchor FK cascade
        assert v.id not in t2.ids() and len(t2.ids()) == 1  # its (live) reply stays
        assert u1.id in t.ids()


# ── 5. edit ────────────────────────────────────────────────────────────────────────────────────


def test_edit_replaces_the_text_only_and_stamps_meta() -> None:
    from app.domain.conversation import AttachmentPart, ReasoningPart, TextPart, ToolCallPart

    with _client() as c:
        t = _Thread(c)
        att = AttachmentPart(kind="image", name="p.png", mime="image/png", path=f"{t.id}/p.png")
        u = t.add("user", TextPart(text="oldword one"), TextPart(text=" two"), att)
        _run(c.app.state.db.execute("UPDATE messages SET meta = '{\"future\": 1}' WHERE id = ?", (u.id,)))
        r = c.patch(f"/api/threads/{t.id}/messages/{u.id}", json={"text": "brandnew words"})
        assert r.status_code == 200, r.text
        row = next(m for m in r.json()["messages"] if m["id"] == u.id)
        assert [p["type"] for p in row["parts"]] == ["text", "attachment"]
        assert row["parts"][0]["text"] == "brandnew words" and row["edited"] is not None
        meta = json.loads(_run(c.app.state.messages.raw_rows([u.id]))[0]["meta"])
        assert meta["future"] == 1 and "edited" in meta
        assert _fts(c, "brandnew") == {u.id} and _fts(c, "oldword") == set()

        a = t.add(
            "assistant",
            ReasoningPart(text="thinking"),
            TextPart(text="draft"),
            ToolCallPart(call_id="c1", tool="ping_host", state="ok"),
            agent="default",
        )
        r = c.patch(f"/api/threads/{t.id}/messages/{a.id}", json={"text": "final"})
        row = next(m for m in r.json()["messages"] if m["id"] == a.id)
        assert [(p["type"], p.get("text")) for p in row["parts"]] == [
            ("reasoning", "thinking"),
            ("text", "final"),
            ("tool_call", None),
        ]
        # an identical text is a no-op (no stamp)
        b = t.say("same")
        r = c.patch(f"/api/threads/{t.id}/messages/{b.id}", json={"text": "same"})
        assert next(m for m in r.json()["messages"] if m["id"] == b.id)["edited"] is None


def test_edit_refusals() -> None:
    from app.domain.conversation import AttachmentPart

    with _client() as c:
        t = _Thread(c)
        u = t.user("q")
        call, res, _ = t.call("ping_host")
        base = f"/api/threads/{t.id}/messages"
        assert c.patch(f"{base}/{res.id}", json={"text": "x"}).status_code == 422  # a tool row
        assert c.patch(f"{base}/{call.id}", json={"text": "x"}).status_code == 422  # no text to edit
        assert c.patch(f"{base}/{u.id}", json={"text": "  "}).status_code == 422  # blank, no attachment
        assert c.patch(f"{base}/nope", json={"text": "x"}).status_code == 404

        att = AttachmentPart(kind="image", name="p.png", mime="image/png", path=f"{t.id}/p.png")
        photo = t.add("user", att)  # attachment-only rows may be captioned…
        r = c.patch(f"{base}/{photo.id}", json={"text": "a caption"})
        row = next(m for m in r.json()["messages"] if m["id"] == photo.id)
        assert [p["type"] for p in row["parts"]] == ["text", "attachment"]
        r = c.patch(f"{base}/{photo.id}", json={"text": ""})  # …and uncaptioned again
        assert [p["type"] for p in next(m for m in r.json()["messages"] if m["id"] == photo.id)["parts"]] == [
            "attachment"
        ]

        _run(c.app.state.db.execute("UPDATE messages SET compacted = 1 WHERE id = ?", (u.id,)))
        r = c.patch(f"{base}/{u.id}", json={"text": "rewrite history"})
        assert r.status_code == 409 and "folded" in r.json()["detail"]


def test_replace_text_positions() -> None:
    from app.domain.conversation import AttachmentPart, ReasoningPart, TextPart
    from app.services.conversation import replace_text

    att = AttachmentPart(kind="text", name="a.txt", mime="text/plain", path="t/a.txt")
    assert [type(p).__name__ for p in replace_text([att], "hi")] == ["TextPart", "AttachmentPart"]
    out = replace_text([ReasoningPart(text="r"), TextPart(text="a"), TextPart(text="b")], "z")
    assert [(type(p).__name__, getattr(p, "text", None)) for p in out] == [
        ("ReasoningPart", "r"),
        ("TextPart", "z"),
    ]


# ── fix wave 1 (review №1) ─────────────────────────────────────────────────────────────────────


def test_a_ts_tie_with_an_owner_row_keeps_its_order_across_a_swap() -> None:
    """Maya MED-2: order is `ts, rowid`, so rows sharing a `ts` are ordered by rowid — the carrier keeps
    the rowid and the restore reuses it (a fresh one would sort the agent rows after the steer)."""
    from datetime import datetime, timezone

    from app.domain.conversation import Message, TextPart
    from app.domain.enums import Actor
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        t = _Thread(c)
        u = t.user("go")
        same = datetime.now(timezone.utc)
        rows = [
            Message(
                thread_id=t.id,
                role="assistant",
                actor=Actor.AGENT,
                agent="default",
                ts=same,
                parts=[TextPart(text="a1")],
            ),
            Message(
                thread_id=t.id,
                role="user",
                actor=Actor.USER,
                steer=True,
                ts=same,
                parts=[TextPart(text="steer")],
            ),
            Message(
                thread_id=t.id,
                role="assistant",
                actor=Actor.AGENT,
                agent="default",
                ts=same,
                parts=[TextPart(text="a2")],
            ),
        ]
        for m in rows:
            _run(c.app.state.messages.add(m))
        original = t.ids()
        assert original == [u.id, *(m.id for m in rows)]
        alts = AlternatesRepo(c.app.state.messages)
        _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        t.say("another take")
        _run(alts.select(t.id, _run(alts.tail_reply(t.id)), 1))
        assert t.ids() == original


def test_edit_text_is_bounded_by_the_existing_upload_ceiling() -> None:
    """Maya MED-1: the edit body has a ceiling, derived from the one existing per-element bound."""
    from pydantic import ValidationError

    from app.api.agent import _EDIT_MAX_CHARS, EditMessageRequest
    from app.config import AttachmentsCfg

    assert _EDIT_MAX_CHARS == AttachmentsCfg().max_file_mb * 1024 * 1024
    EditMessageRequest(text="x" * _EDIT_MAX_CHARS)
    with pytest.raises(ValidationError):
        EditMessageRequest(text="x" * (_EDIT_MAX_CHARS + 1))


def test_deleting_a_user_row_leaves_its_reply_joining_the_previous_turn(scripted_drive) -> None:
    """Opus LOW-3, RULED AS DESIGNED (ST parity — delete exactly what you tapped): the deleted
    question's answer stays and becomes part of the previous anchor's tail reply (its live take)."""
    with _client() as c:
        t = _Thread(c)
        t.user("first")
        a1 = t.say("take one")
        assert _regen(c, t.id, a1.id).status_code == 200
        take2 = t.ids()[-1]
        u2 = t.user("second")
        a2 = t.say("answer two")
        r = c.delete(f"/api/threads/{t.id}/messages/{u2.id}")
        assert r.status_code == 200
        host, reply = _reply(r.json()["messages"])
        assert host == a2.id and reply == {"ids": [take2, a2.id], "n": 2, "count": 2}


def test_regenerate_scans_lorebooks_from_the_anchor_not_a_leftover_steer() -> None:
    """Opus LOW-4: the resume window is NAMED on the anchor — a trailing steer is not the incoming."""
    from test_roleplay_s0 import _agent, _session
    from test_roleplay_s3 import _book

    from app.services.conversation import split_tail

    with _client() as c:
        _book(c, "sea", {"name": "Sea", "entries": [{"keys": ["kraken"], "content": "KRAKEN-LORE"}]})
        _agent(c, "sera", lorebooks=["sea"])
        assert c.put("/api/settings", json={"lorebooks": {"scan_depth": 0}}).status_code == 200
        t = _Thread(c, agent="sera")
        u = t.user("tell me of the kraken")
        t.say("it sleeps", agent="sera")
        t.user("never mind, anything else", steer=True)

        plain = _session(c, "sera")
        _run(plain._activate_lorebooks(t.thread, "", resume=True))
        assert plain._lorebook_head is None  # the default resume rule anchors on the steer

        sess = _session(c, "sera")

        async def _noop(thread, *, mode=None, **kw):
            return
            yield

        sess._drive = _noop  # type: ignore[method-assign]
        tail = split_tail(_run(c.app.state.messages.list(t.id)))
        assert tail.anchor.id == u.id

        async def _drain():
            return [e async for e in sess.regenerate(t.thread, tail)]

        _run(_drain())
        assert sess._lorebook_head is not None and "KRAKEN-LORE" in sess._lorebook_head


def test_an_answerless_anchor_is_retried_by_its_own_id(scripted_drive) -> None:
    """Opus LOW-5: with no agent row after the anchor, `message_id` = the anchor → take 1; naming the
    anchor while a reply exists is stale."""
    from app.domain.conversation import ErrorPart

    with _client() as c:
        t = _Thread(c)
        u = t.user("hello")
        err = t.add("assistant", ErrorPart(message="down", retryable=True), agent="default")
        r = _regen(c, t.id, u.id)  # a reply exists → the anchor id is stale
        assert r.status_code == 409 and r.json()["detail"] == "the conversation changed"
        scripted_drive["persist"] = False
        assert _regen(c, t.id, err.id).status_code == 200  # error dropped, nothing persisted
        assert t.ids() == [u.id] and _reply(t.floor()) is None
        scripted_drive["persist"] = True
        assert _regen(c, t.id, u.id).status_code == 200
        host, reply = _reply(t.floor())
        assert reply == {"ids": [host], "n": 1, "count": 1}


def test_a_raise_before_the_stash_leaves_every_take_intact(scripted_drive, monkeypatch) -> None:
    """Opus MED-1: the stash runs inside the generator's `try`, AFTER the activations — a raise in the
    lorebook load touches nothing, the reply keeps its annotation, and a retry is not refused."""
    from app.services.agent.session import AgentSession

    with _client() as c:
        t = _Thread(c)
        t.user("hello")
        a1 = t.say("take one")
        assert _regen(c, t.id, a1.id).status_code == 200
        before_ids, before_alts = t.ids(), _alt_rows(c, t.id)
        host = _reply(t.floor())[0]

        async def _boom(self, *a, **kw):
            raise RuntimeError("book load failed")

        real = AgentSession._activate_lorebooks
        monkeypatch.setattr(AgentSession, "_activate_lorebooks", _boom)
        r = _regen(c, t.id, host)
        assert r.status_code == 200 and r.json()["state"] == "error"
        assert t.ids() == before_ids and _alt_rows(c, t.id) == before_alts
        assert _reply(t.floor()) == (host, {"ids": [host], "n": 2, "count": 2})
        monkeypatch.setattr(AgentSession, "_activate_lorebooks", real)
        assert _regen(c, t.id, host).status_code == 200


def test_a_cancel_mid_drive_restores_the_take_that_was_on_screen(scripted_drive, monkeypatch) -> None:
    """Maya LOW (a REAL cancellation) + Opus LOW-1: the owner is on 1/3, taps retry, and the turn is
    cancelled mid-`_drive` before any row lands → take 1 is back (not the newest), still 1/3."""
    from app.api.agent import _build_session
    from app.services.agent.session import AgentSession
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        t = _Thread(c)
        t.user("hello")
        a1 = t.say("take one")
        assert _regen(c, t.id, a1.id).status_code == 200
        assert _regen(c, t.id, t.ids()[-1]).status_code == 200
        r = c.put(f"/api/threads/{t.id}/messages/{t.ids()[-1]}/alternate", json={"n": 1})
        assert _reply(r.json()["messages"]) == (a1.id, {"ids": [a1.id], "n": 1, "count": 3})

        started = asyncio.Event()

        async def _blocking(self, thread, *, mode=None, **kw):
            started.set()
            await asyncio.Event().wait()
            yield  # unreachable — makes this an async generator

        monkeypatch.setattr(AgentSession, "_drive", _blocking)
        alts = AlternatesRepo(c.app.state.messages)
        session = _build_session(c.app.state, t.thread)
        tail = _run(alts.tail_reply(t.id))

        async def _scenario():
            async def _consume():
                async for _ in session.regenerate(t.thread, tail):
                    pass

            task = asyncio.create_task(_consume())
            await started.wait()
            ids = [m.id for m in await c.app.state.messages.list(t.id)]
            assert a1.id not in ids  # stashed mid-drive
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        _run(_scenario())
        assert _reply(t.floor()) == (a1.id, {"ids": [a1.id], "n": 1, "count": 3})


def test_a_failure_mid_stash_or_mid_delete_rolls_back_exactly(scripted_drive, monkeypatch) -> None:
    """Maya LOW: an exception inside a move leaves the transcript AND the stash byte-identical — no
    lost row, no duplicate or lost alternate."""
    from app.services.conversation import AlternatesRepo, MessageRepo, resolve_unit

    with _client() as c:
        t = _Thread(c)
        t.user("hello")
        a1 = t.say("take one")
        assert _regen(c, t.id, a1.id).status_code == 200  # 2 takes, take 2 live
        alts = AlternatesRepo(c.app.state.messages)
        live = t.ids()[-1]
        snap = (_run(c.app.state.messages.raw_rows(t.ids())), _alt_rows(c, t.id))

        async def _fail(*a, **kw):
            raise RuntimeError("injected")

        real_resequence = AlternatesRepo._resequence
        monkeypatch.setattr(AlternatesRepo, "_resequence", _fail)  # after the take is deleted + stored
        with pytest.raises(RuntimeError):
            _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        assert (_run(c.app.state.messages.raw_rows(t.ids())), _alt_rows(c, t.id)) == snap
        monkeypatch.setattr(AlternatesRepo, "_resequence", real_resequence)

        real_delete = MessageRepo.delete_ids

        async def _delete_then_fail(self, ids):
            await real_delete(self, ids)
            raise RuntimeError("injected")

        monkeypatch.setattr(MessageRepo, "delete_ids", _delete_then_fail)
        unit = resolve_unit(_run(c.app.state.messages.list(t.id)), live)
        with pytest.raises(RuntimeError):
            _run(alts.delete_unit(t.id, unit))
        assert (_run(c.app.state.messages.raw_rows(t.ids())), _alt_rows(c, t.id)) == snap


def test_an_occupied_rowid_gets_a_fresh_one_and_order_holds() -> None:
    """Wave 2: a row written AFTER the stash may take a stashed row's rowid (SQLite reuses the top one).
    The restore then mints a fresh rowid — no duplicate, nothing lost — and `ts, rowid` order is still
    right, because the occupier's `ts` is later than every stashed row's."""
    from app.services.conversation import AlternatesRepo

    with _client() as c:
        db = c.app.state.db
        t = _Thread(c)
        u = t.user("go")
        a1 = t.say("first")
        a2 = t.say("second")
        before = {r["id"]: r["rowid"] for r in _run(c.app.state.messages.raw_rows([a1.id, a2.id]))}
        alts = AlternatesRepo(c.app.state.messages)
        _run(alts.stash_tail(t.id, _run(alts.tail_reply(t.id))))
        steer = t.user("while it thought", steer=True)
        _run(db.execute("UPDATE messages SET rowid = ? WHERE id = ?", (before[a1.id], steer.id)))
        t.say("another take")
        _run(alts.select(t.id, _run(alts.tail_reply(t.id)), 1))

        after = {r["id"]: r["rowid"] for r in _run(c.app.state.messages.raw_rows(t.ids()))}
        assert after[steer.id] == before[a1.id]  # the occupier keeps what it holds
        assert after[a1.id] != before[a1.id]  # its own was taken → a fresh one (a2 may cascade the same way)
        assert len(set(after.values())) == len(after)  # no duplicate rowid
        assert t.ids() == [u.id, a1.id, a2.id, steer.id]  # ts settles it; nothing lost
