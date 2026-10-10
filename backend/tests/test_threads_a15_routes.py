"""D84 / Phase 27 S2 — conversations per agent: the routes (CONVERSATIONS_PLAN §3, §4, §10 "S2").

S2a (this half) pins the thread routes and the mint/greeting path:

  1. `GET /api/threads` — `agent=` is an EXACT home match with the five summary fields merged into
     every row; `limit` 1..200 (default 50); the `before` keyset cursor pages without skipping or
     repeating under an equal `updated_at`, and a malformed one is a 422 through the safe renderer; an
     off-roster slug (`..`, `/etc` included) lists `[]`; without `agent=` the list is today's shape;
  2. `PATCH /api/threads/{id}` — rename round-trip + clear, the 120-character cap, `extra="forbid"`,
     `seen_at` monotonic + clamped to now, a naive `seen_at` a 422, an archived id a 404;
  3. `DELETE /api/threads/{id}` — 409 under a running turn, 403 an automation's rolling conversation,
     404 an archived or unknown id, and the cascade (messages, the attachment dir, the steer queue, the
     routing entry);
  4. chat / `!cmd` — a SUPPLIED unknown `thread_id` is a 404, an absent one still mints; seam ② pins the
     configured default (else the root) whatever `body.agent` says, seeds the HOME's greeting, and the
     turn answers as `body.agent`; seam ① pins the RESOLVED agent (§12.4 Q2);
  5. `updated_at` moves on the owner's send (chat) and on a `!cmd` pair; a greeted mint is not unread;
  6. the chat stream head carries the home `agent` (SSE and buffered).

The loop is a scripted `_drive` (no model); every case runs on a temp `$CTRLB_HOME`.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from _async import run_async

from app.domain.conversation import Message, TextPart, Thread
from app.domain.enums import Actor

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
SUMMARY_KEYS = {"label", "preview", "running", "awaiting", "unread"}


@contextlib.contextmanager
def _client(config: str = "server:\n  port: 5433\n", agents: dict[str, str] | None = None):
    """A fresh app on a temp workspace. `agents` = `{slug: agent.yaml text}` folders put on the roster."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config, encoding="utf-8")
    for name, yaml_text in (agents or {}).items():
        folder = tmp / "agents" / name
        folder.mkdir(parents=True)
        (folder / "agent.yaml").write_text(yaml_text or "description: x\n", encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _thread(c, **kw) -> Thread:
    return run_async(c.app.state.threads.create(Thread(**kw)))


def _get(c, thread_id: str) -> Thread:
    t = run_async(c.app.state.threads.get(thread_id))
    assert t is not None
    return t


def _msgs(c, thread_id: str) -> list[Message]:
    return run_async(c.app.state.messages.list(thread_id))


def _say(c, thread_id: str, text: str, *, role: str = "assistant", agent: str | None = "default"):
    m = Message(
        thread_id=thread_id,
        role=role,
        actor=Actor.AGENT if role == "assistant" else Actor.USER,
        agent=agent if role == "assistant" else None,
        parts=[TextPart(text=text)],
    )
    return run_async(c.app.state.messages.add(m))


@pytest.fixture
def scripted(monkeypatch):
    """`AgentSession._drive` replaced by a scripted take: records the answering agent and persists ONE
    assistant row in its name (unless `persist` is flipped off), then the minimal event run."""
    from app.services.agent.session import AgentEvent, AgentSession

    ctl: dict = {"persist": True, "agents": []}

    async def _drive(self, thread, *, mode=None, **kw):
        ctl["agents"].append(self._agent.name)
        if ctl["persist"]:
            m = Message(
                thread_id=thread.id,
                role="assistant",
                actor=Actor.AGENT,
                agent=self._agent.name,
                parts=[TextPart(text="a reply")],
            )
            await self._messages.add(m)
            yield AgentEvent("message.start", {"messageId": m.id, "role": "assistant"})
            yield AgentEvent("message.end", {"messageId": m.id})
        yield AgentEvent("done", {"threadId": thread.id, "state": "completed"})

    monkeypatch.setattr(AgentSession, "_drive", _drive)
    return ctl


def _chat(c, **body):
    return c.post("/api/agent/chat", json={"text": "hello", "stream": False, **body})


def _assert_safe_422(r) -> None:
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert isinstance(detail, list) and detail
    for e in detail:
        assert set(e) == {"loc", "msg", "type"}  # the safe renderer's shape — never `input`


# ── 1. GET /api/threads ────────────────────────────────────────────────────────────────────────


def test_the_agent_filter_is_an_exact_home_match_with_the_summary_fields() -> None:
    with _client(agents={"nyx": "", "nyx2": ""}) as c:
        a = _thread(c, agent="nyx", title="mine")
        _thread(c, agent="nyx2")
        _thread(c, agent="default")
        rows = c.get("/api/threads", params={"agent": "nyx"}).json()
        assert [r["id"] for r in rows] == [a.id]  # not a prefix match
        assert SUMMARY_KEYS <= set(rows[0]) and rows[0]["label"] == "mine"
        assert rows[0]["running"] is False and rows[0]["unread"] is False

        plain = c.get("/api/threads").json()  # today's shape: every row, no summary keys
        assert len(plain) == 3 and all(not (SUMMARY_KEYS & set(r)) for r in plain)

        root = c.get("/api/threads", params={"agent": "default"}).json()  # the root is on the roster
        assert len(root) == 1 and SUMMARY_KEYS <= set(root[0])


def test_running_reflects_a_live_turn() -> None:
    import asyncio

    from app.services.agent.turns import release, reserve

    with _client(agents={"nyx": ""}) as c:
        t = _thread(c, agent="nyx")
        handle = reserve(c.app.state.turns, t.id, "chat")
        try:
            # a reserved-but-unspawned marker is not a live turn (the `turn_status` predicate)
            assert c.get("/api/threads", params={"agent": "nyx"}).json()[0]["running"] is False

            async def _spin() -> None:
                handle.task = asyncio.get_running_loop().create_future()  # type: ignore[assignment]

            run_async(_spin())
            assert c.get("/api/threads", params={"agent": "nyx"}).json()[0]["running"] is True
        finally:
            release(c.app.state.turns, handle)


def test_limit_bounds_and_the_default_page() -> None:
    with _client() as c:
        for _ in range(51):
            _thread(c, agent="default")
        for bad in (0, 201):
            _assert_safe_422(c.get("/api/threads", params={"agent": "default", "limit": bad}))
        assert len(c.get("/api/threads", params={"agent": "default"}).json()) == 50
        assert len(c.get("/api/threads", params={"agent": "default", "limit": 200}).json()) == 51
        assert len(c.get("/api/threads").json()) == 51  # no default page without `agent=`
        assert len(c.get("/api/threads", params={"limit": 3}).json()) == 3  # an explicit one is honoured


def test_cursor_paging_under_an_equal_updated_at_neither_skips_nor_repeats() -> None:
    with _client() as c:
        made = {_thread(c, agent="default", created_at=T0, updated_at=T0).id for _ in range(5)}
        seen: list[str] = []
        params: dict = {"agent": "default", "limit": 2}
        while True:
            page = c.get("/api/threads", params=params).json()
            if not page:
                break
            seen += [r["id"] for r in page]
            last = page[-1]
            params = {**params, "before": f"{last['updated_at']},{last['id']}"}  # httpx encodes the `+`
        assert len(seen) == len(set(seen)) == 5 and set(seen) == made
        assert seen == sorted(made, reverse=True)  # `updated_at DESC, id DESC` — the id breaks the tie
        # the same cursor with a `+00:00` offset (what `_iso` stores) pages identically
        first = c.get("/api/threads", params={"agent": "default", "limit": 2}).json()
        cur = f"{T0.isoformat()},{first[-1]['id']}"
        nxt = c.get("/api/threads", params={"agent": "default", "limit": 2, "before": cur}).json()
        assert [r["id"] for r in nxt] == seen[2:4]


@pytest.mark.parametrize(
    "before",
    [
        "garbage",
        "2026-10-01T12:00:00+00:00,",
        ",abc",
        "2026-10-01T12:00:00,abc",
        "not-a-date,abc",
        "0001-01-01T00:00:00+23:59,x",  # aware, but before year 1 in UTC — an OverflowError, not a 500
        "9999-12-31T23:59:59-23:59,x",  # aware, but past year 9999 in UTC
    ],
)
def test_a_malformed_cursor_is_a_safe_422(before: str) -> None:
    with _client() as c:
        _assert_safe_422(c.get("/api/threads", params={"agent": "default", "before": before}))
        _assert_safe_422(c.get("/api/threads", params={"before": before}))
        r = c.get("/api/threads", params={"agent": "default", "before": before})
        assert before not in r.text  # the input is never echoed back


@pytest.mark.parametrize("slug", ["ghost", "..", "/etc", "nyx-", "NYX"])
def test_an_off_roster_slug_lists_nothing(slug: str) -> None:
    with _client(agents={"nyx": ""}) as c:
        _thread(c, agent=slug)  # an orphaned home (a deleted agent) — listed nowhere
        r = c.get("/api/threads", params={"agent": slug})
        assert r.status_code == 200 and r.json() == []


# ── 2. PATCH /api/threads/{id} ─────────────────────────────────────────────────────────────────


def test_rename_round_trip_and_clear() -> None:
    with _client() as c:
        t = _thread(c, agent="default")
        _say(c, t.id, "first line of the ask\nsecond", role="user")
        r = c.patch(f"/api/threads/{t.id}", json={"title": "  Trip plans  "})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "Trip plans" and r.json()["label"] == "Trip plans"
        assert SUMMARY_KEYS <= set(r.json())
        assert _get(c, t.id).title == "Trip plans"
        for cleared in ("", None):
            c.patch(f"/api/threads/{t.id}", json={"title": "x"})
            r = c.patch(f"/api/threads/{t.id}", json={"title": cleared})
            assert r.status_code == 200 and r.json()["title"] is None
            assert r.json()["label"] == "first line of the ask"  # labelled from the first user row
        # an absent `title` leaves it alone (per-item update object)
        c.patch(f"/api/threads/{t.id}", json={"title": "kept"})
        assert c.patch(f"/api/threads/{t.id}", json={}).json()["title"] == "kept"


def test_patch_validation_is_a_safe_422() -> None:
    with _client() as c:
        t = _thread(c, agent="default")
        _assert_safe_422(c.patch(f"/api/threads/{t.id}", json={"title": "x" * 121}))
        assert c.patch(f"/api/threads/{t.id}", json={"title": "x" * 120}).status_code == 200
        _assert_safe_422(c.patch(f"/api/threads/{t.id}", json={"agent": "nyx"}))  # extra="forbid"
        _assert_safe_422(c.patch(f"/api/threads/{t.id}", json={"seen_at": "2026-10-01T12:00:00"}))  # naive
        for extreme in ("0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"):  # overflow in UTC
            _assert_safe_422(c.patch(f"/api/threads/{t.id}", json={"seen_at": extreme}))


def test_seen_is_monotonic_and_clamped_to_now() -> None:
    with _client() as c:
        t = _thread(c, agent="default", created_at=T0, updated_at=T0)
        _say(c, t.id, "a reply")  # newer than seen_at (= created_at) → unread
        assert c.get("/api/threads", params={"agent": "default"}).json()[0]["unread"] is True

        later = datetime.now(UTC)  # after the reply's ts, before the server's clamp
        r = c.patch(f"/api/threads/{t.id}", json={"seen_at": later.isoformat()})
        assert r.status_code == 200 and r.json()["unread"] is False
        assert datetime.fromisoformat(r.json()["seen_at"]) == later

        back = c.patch(f"/api/threads/{t.id}", json={"seen_at": T0.isoformat()})  # never backwards
        assert datetime.fromisoformat(back.json()["seen_at"]) == later

        future = datetime.now(UTC) + timedelta(days=1)
        before = datetime.now(UTC)
        r = c.patch(f"/api/threads/{t.id}", json={"seen_at": future.isoformat()})
        stored = datetime.fromisoformat(r.json()["seen_at"])
        assert before <= stored <= datetime.now(UTC)  # clamped to the present
        _say(c, t.id, "landed after the write")  # a reply after the clamp is still unread
        assert c.get("/api/threads", params={"agent": "default"}).json()[0]["unread"] is True


def test_seen_moved_calls_the_publish_seam_only_when_it_moved(monkeypatch) -> None:
    import app.api.agent as agent_api

    calls: list[str] = []
    monkeypatch.setattr(agent_api, "_publish_seen", lambda state, thread: calls.append(thread.id))
    with _client() as c:
        t = _thread(c, agent="default", created_at=T0, updated_at=T0)
        at = (T0 + timedelta(minutes=1)).isoformat()
        c.patch(f"/api/threads/{t.id}", json={"seen_at": at})
        c.patch(f"/api/threads/{t.id}", json={"seen_at": at})  # a no-op write publishes nothing
        c.patch(f"/api/threads/{t.id}", json={"title": "x"})
        assert calls == [t.id]


def test_patch_an_archived_or_unknown_thread_is_a_404() -> None:
    with _client() as c:
        archived = _thread(c, agent="default", archived=True)
        assert c.patch(f"/api/threads/{archived.id}", json={"title": "x"}).status_code == 404
        assert c.patch("/api/threads/nope", json={"title": "x"}).status_code == 404
        assert _get(c, archived.id).title is None


# ── 3. DELETE /api/threads/{id} ────────────────────────────────────────────────────────────────


def test_delete_cascades_rows_attachments_and_the_in_memory_entries() -> None:
    from app.core.attachments import attachments_root
    from app.services.agent.compaction import compaction_state_for
    from app.services.agent.routing import routing_state_for
    from app.services.agent.steering import SteerEntry, enqueue

    with _client() as c:
        s = c.app.state
        t = _thread(c, agent="default")
        keep = _thread(c, agent="default")
        _say(c, t.id, "q", role="user")
        _say(c, t.id, "a")
        d = attachments_root(s.settings.home_dir()) / t.id
        d.mkdir(parents=True)
        (d / "photo.png").write_bytes(b"\x89PNG")
        enqueue(s, t.id, SteerEntry(kind="message", text="queued"), 5)
        routing_state_for(s, t.id).fallback_remaining = 2  # a live episode — `prune` would keep it
        compaction_state_for(s, t.id).consecutive_failures = 1  # a live residual — `prune` would keep it
        s.steer_harvests[t.id] = {"entries": [], "turn_id": "old", "ts": 0.0}

        r = c.delete(f"/api/threads/{t.id}")
        assert r.status_code == 200 and r.json() == {"deleted": True}
        assert run_async(s.threads.get(t.id)) is None and _msgs(c, t.id) == []
        assert not d.exists()
        for per_thread in (s.steer_queues, s.routing_state, s.compaction_state, s.steer_harvests):
            assert t.id not in per_thread
        assert not s.turns  # the marker was released
        assert run_async(s.threads.get(keep.id)) is not None
        assert c.delete(f"/api/threads/{t.id}").status_code == 404  # gone → 404 on a re-run


def test_delete_refusals() -> None:
    from app.services.agent.turns import release, reserve

    with _client() as c:
        s = c.app.state
        busy = _thread(c, agent="default")
        handle = reserve(s.turns, busy.id, "chat")
        try:
            r = c.delete(f"/api/threads/{busy.id}")
            assert r.status_code == 409 and "already running" in r.json()["detail"]
        finally:
            release(s.turns, handle)

        archived = _thread(c, agent="default", archived=True)  # a fresh automation run (E10)
        assert c.delete(f"/api/threads/{archived.id}").status_code == 404
        assert c.delete("/api/threads/nope").status_code == 404

        rolling = _thread(c, agent="default", archived=True)

        class _Owned:
            async def rolling_owner(self, thread_id):
                return "auto-1" if thread_id == rolling.id else None

        s.automations = _Owned()
        assert c.delete(f"/api/threads/{rolling.id}").status_code == 403
        for kept in (busy, archived, rolling):
            assert run_async(s.threads.get(kept.id)) is not None
        assert not s.turns  # every refusal released its marker


# ── 4. chat / exec: 404-not-mint, seam ② pins the home ─────────────────────────────────────────


def test_chat_and_exec_404_on_an_unknown_supplied_thread_and_mint_on_an_absent_one(scripted) -> None:
    with _client() as c:
        c.app.state.settings.shell.user_exec_enabled = True
        r = _chat(c, thread_id="deleted-elsewhere")
        assert r.status_code == 404 and r.json()["detail"] == "unknown thread 'deleted-elsewhere'"
        r = c.post("/api/exec", json={"command": "echo hi", "thread_id": "deleted-elsewhere"})
        assert r.status_code == 404
        assert c.get("/api/threads").json() == []  # nothing was minted

        r = _chat(c)
        assert r.status_code == 200, r.text
        assert _get(c, r.json()["threadId"]).agent == "default"  # no configured default → the root
        r = c.post("/api/exec", json={"command": "echo hi"})
        assert r.status_code == 200, r.text
        assert _get(c, r.json()["threadId"]).agent == "default"


def test_seam_two_pins_the_configured_default_and_greets_as_it(scripted) -> None:
    config = "server:\n  port: 5433\nagent:\n  default_agent: nyx\n"
    agents = {"nyx": "greeting: Welcome home.\n", "lyn": "greeting: Lynette here.\n"}
    with _client(config, agents) as c:
        c.app.state.settings.shell.user_exec_enabled = True
        r = _chat(c, agent="lyn")  # the RESPONDER — never the home
        assert r.status_code == 200, r.text
        t = _get(c, r.json()["threadId"])
        assert t.agent == "nyx"
        msgs = _msgs(c, t.id)
        assert [(m.role, m.agent) for m in msgs] == [
            ("assistant", "nyx"),
            ("user", None),
            ("assistant", "lyn"),
        ]
        assert msgs[0].parts[0].text == "Welcome home."  # type: ignore[union-attr]
        assert t.seen_at == msgs[0].ts  # seam ② lifts `seen_at` to its own greeting (L2)
        assert scripted["agents"] == ["lyn"]  # the turn answered as `body.agent`
        # the greeted mint is not unread for its own greeting; the responder's reply is
        row = c.get("/api/threads", params={"agent": "nyx"}).json()[0]
        assert row["id"] == t.id and row["unread"] is True

        r = c.post("/api/exec", json={"command": "echo hi"})
        assert _get(c, r.json()["threadId"]).agent == "nyx"
        assert r.json()["agent"] == "nyx"  # the `!cmd` mint names its HOME on the wire (H6)
        r = c.post("/api/exec", json={"command": "echo hi", "thread_id": t.id})
        assert r.json()["agent"] == "nyx"  # …and an exec into an existing conversation names its own


def test_seam_one_pins_the_resolved_agent_never_a_dead_slug() -> None:
    """§12.4 Q2 (ISS-51's rungs): an unknown slug pins the configured default — else the root — and its
    greeting row speaks as the same agent."""
    config = "server:\n  port: 5433\nagent:\n  default_agent: nyx\n"
    with _client(config, {"nyx": "greeting: Welcome home.\n"}) as c:
        t = c.post("/api/threads", json={"agent": "gone"}).json()
        assert t["agent"] == "nyx"
        assert [m.agent for m in _msgs(c, t["id"])] == ["nyx"]

    root_greets = "server:\n  port: 5433\nagent:\n  defaults:\n    greeting: Root hello.\n"
    with _client(root_greets) as c:
        t = c.post("/api/threads", json={"agent": "gone"}).json()
        assert t["agent"] == "default"
        assert [m.agent for m in _msgs(c, t["id"])] == ["default"]


def test_a_bodyless_create_pins_the_home_and_greets_as_it() -> None:
    """D84: every mint is pinned — no body, `null` or `""` mints for the configured default (else the
    root), greeted as it, `seen_at` lifted to the greeting."""
    config = "server:\n  port: 5433\nagent:\n  default_agent: nyx\n"
    with _client(config, {"nyx": "greeting: Welcome home.\n"}) as c:
        for r in (
            c.post("/api/threads"),
            c.post("/api/threads", json={"agent": None}),
            c.post("/api/threads", json={"agent": ""}),
        ):
            t = _get(c, r.json()["id"])
            assert t.agent == "nyx"
            (greeting,) = _msgs(c, t.id)
            assert greeting.agent == "nyx" and t.seen_at == greeting.ts

    root_greets = "server:\n  port: 5433\nagent:\n  defaults:\n    greeting: Root hello.\n"
    with _client(root_greets) as c:
        t = _get(c, c.post("/api/threads").json()["id"])
        assert t.agent == "default"
        assert [m.agent for m in _msgs(c, t.id)] == ["default"]


# ── 5. updated_at + the greeting's seen ────────────────────────────────────────────────────────


def test_updated_at_moves_on_the_owner_send_and_on_an_exec_pair(scripted) -> None:
    scripted["persist"] = False  # no assistant row — the only touch is the owner's own
    with _client() as c:
        c.app.state.settings.shell.user_exec_enabled = True
        t = _thread(c, agent="default", created_at=T0, updated_at=T0)
        assert _chat(c, thread_id=t.id).status_code == 200
        (user_row,) = _msgs(c, t.id)
        assert _get(c, t.id).updated_at == user_row.ts

        x = _thread(c, agent="default", created_at=T0, updated_at=T0)
        assert c.post("/api/exec", json={"command": "echo hi", "thread_id": x.id}).status_code == 200
        pair = _msgs(c, x.id)
        assert len(pair) == 2 and _get(c, x.id).updated_at == pair[-1].ts


def test_a_greeting_seeded_with_threads_is_not_unread() -> None:
    from app.services.agent.greeting import seed_greeting

    with _client(agents={"nyx": "greeting: Hi.\n"}) as c:
        s = c.app.state
        nyx = s.settings.resolve_agent("nyx")
        lifted = _thread(c, agent="nyx", created_at=T0, updated_at=T0)
        plain = _thread(c, agent="nyx", created_at=T0, updated_at=T0)
        run_async(seed_greeting(s.messages, s.settings, lifted, nyx, threads=s.threads))
        run_async(seed_greeting(s.messages, s.settings, plain, nyx))
        rows = {r["id"]: r for r in c.get("/api/threads", params={"agent": "nyx"}).json()}
        assert rows[lifted.id]["unread"] is False
        assert rows[plain.id]["unread"] is True  # without the lift the greeting reads as a reply

        minted = c.post("/api/threads", json={"agent": "nyx"}).json()  # seam ① passes `threads`
        assert c.get("/api/threads", params={"agent": "nyx"}).json()[0]["id"] == minted["id"]
        assert c.get("/api/threads", params={"agent": "nyx"}).json()[0]["unread"] is False


# ── 6. the stream head ─────────────────────────────────────────────────────────────────────────


def test_the_stream_head_carries_the_home_agent(scripted) -> None:
    config = "server:\n  port: 5433\nagent:\n  default_agent: nyx\n"
    with _client(config, {"nyx": "", "lyn": ""}) as c:
        buffered = _chat(c, agent="lyn").json()
        assert buffered["agent"] == "nyx" and buffered["state"] == "completed"

        r = c.post("/api/agent/chat", json={"text": "hi", "agent": "lyn", "stream": True})
        assert r.headers["content-type"].startswith("text/event-stream")
        frames = [blk for blk in r.text.replace("\r\n", "\n").split("\n\n") if blk.strip()]
        first = dict(ln.split(": ", 1) for ln in frames[0].splitlines() if ": " in ln)
        assert first["event"] == "thread"
        head = json.loads(first["data"])
        assert set(head) == {"threadId", "title", "agent"} and head["agent"] == "nyx"
