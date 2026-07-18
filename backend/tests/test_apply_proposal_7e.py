"""Phase 7e-f-3 — the shared Approve-to-apply propose endpoint (`POST /api/agent/apply`).

A `memory`/`skill_manage` call whose auto-write switch is off returns an OK result carrying
`data["proposed"]` instead of writing; the chat bubble's Approve/Dismiss posts here. This exercises
the endpoint end-to-end against seeded thread state (a proposed call+result pair), reusing the same
`gate_*`/`apply_*` write path the tools use — the auto-write gate aside.

What's exercised:
  1. apply memory   — performs the write, response applied=True, result loses `proposed`/gains
                      `applied`, the persisted thread reflects it, a USER Event is recorded.
  2. apply skill    — writes the SKILL.md to the proposing agent's folder.
  3. dismiss        — no write; result marked `dismissed`, `proposed` cleared, persisted.
  4. gate denied    — master switch off → applied=False, proposal left pending (still has `proposed`).
  5. stale apply    — a memory replace whose `old_text` is now absent → ERROR, proposal kept pending.
  6. unknown call   — a call_id not in the thread → 404.
  7. not proposed   — a plain (non-proposal) result → 409.
  8. specialist     — the agent is resolved from the call's `message.agent`; a specialist writes its
                      own agents/<slug>/skills/ folder, not the global one.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async


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


def _run(coro):
    return run_async(coro)


def _seed_proposal(c, tool: str, args: dict, *, agent: str | None = "default") -> tuple[str, str]:
    """Persist a proposed call+result pair (as the tool would when auto-write is off) and return
    (thread_id, call_id). Mirrors the on-the-wire shape: an assistant tool_call + a `tool` result
    carrying `data["proposed"]`."""
    import uuid

    from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
    from app.domain.enums import Actor, RunState
    from app.domain.result import ToolResult

    threads, messages = c.app.state.threads, c.app.state.messages
    thread = _run(threads.create(Thread()))
    call_id = uuid.uuid4().hex
    _run(
        messages.add(
            Message(
                thread_id=thread.id,
                role="assistant",
                actor=Actor.AGENT,
                agent=agent,
                parts=[ToolCallPart(call_id=call_id, tool=tool, args=args, state=RunState.OK)],
            )
        )
    )
    _run(
        messages.add(
            Message(
                thread_id=thread.id,
                role="tool",
                actor=Actor.AGENT,
                parts=[
                    ToolResultPart(
                        call_id=call_id,
                        result=ToolResult(
                            state=RunState.OK, summary="proposed (not written)", data={"proposed": args}
                        ),
                    )
                ],
            )
        )
    )
    return thread.id, call_id


def _apply(c, thread_id: str, call_id: str, decision: str = "apply"):
    return c.post(
        "/api/agent/apply",
        json={"thread_id": thread_id, "call_id": call_id, "decision": decision},
    )


def _result_part(c, thread_id: str, call_id: str) -> dict:
    msgs = c.get(f"/api/threads/{thread_id}/messages").json()
    for m in msgs:
        for p in m["parts"]:
            if p["type"] == "tool_result" and p["call_id"] == call_id:
                return p["result"]
    raise AssertionError("result part not found")


def test_apply_memory_writes_and_audits() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            tid, cid = _seed_proposal(
                c, "memory", {"target": "memory", "action": "add", "content": "approved note"}
            )
            r = _apply(c, tid, cid)
            assert r.status_code == 200 and r.json()["applied"] is True
            assert "approved note" in (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            # persisted result: proposal cleared, applied marked
            res = _result_part(c, tid, cid)
            assert res["data"].get("applied") is True and "proposed" not in res["data"]
            # audited as a USER event
            events = c.get("/api/events").json()
            assert any(e["action"] == "memory" and e["actor"] == "user" for e in events)


def test_apply_skill_writes_to_agent_folder() -> None:
    body = "---\nname: triage\ndescription: triage\n---\n\nDo it.\n"
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            tid, cid = _seed_proposal(
                c, "skill_manage", {"action": "save", "name": "triage", "content": body}
            )
            r = _apply(c, tid, cid)
            assert r.json()["applied"] is True
            assert (tmp / "skills" / "triage" / "SKILL.md").is_file()


def test_dismiss_marks_resolved_without_writing() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            tid, cid = _seed_proposal(c, "memory", {"target": "memory", "action": "add", "content": "nope"})
            r = _apply(c, tid, cid, decision="dismiss")
            assert r.status_code == 200 and r.json()["applied"] is False
            res = _result_part(c, tid, cid)
            assert res["data"].get("dismissed") is True and "proposed" not in res["data"]
            assert not (tmp / "memories" / "MEMORY.md").exists()  # nothing written


def test_apply_gate_denied_keeps_proposal_pending() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.enabled = False  # master switch off → gate denies
            tid, cid = _seed_proposal(c, "memory", {"target": "memory", "action": "add", "content": "x"})
            r = _apply(c, tid, cid)
            assert r.status_code == 200 and r.json()["applied"] is False
            # proposal stays pending (still approvable/dismissable)
            assert "proposed" in _result_part(c, tid, cid)["data"]


def test_stale_apply_keeps_proposal_pending() -> None:
    with _workspace():
        with _client() as c:
            # replace against an old_text that isn't in the (empty) memory → write ERROR
            tid, cid = _seed_proposal(
                c, "memory", {"target": "memory", "action": "replace", "content": "y", "old_text": "absent"}
            )
            r = _apply(c, tid, cid)
            assert r.json()["applied"] is False
            assert r.json()["result"]["state"] == "error"
            assert "proposed" in _result_part(c, tid, cid)["data"]


def test_unknown_call_404() -> None:
    with _workspace():
        with _client() as c:
            tid, _cid = _seed_proposal(c, "memory", {"target": "memory", "action": "add", "content": "x"})
            assert _apply(c, tid, "does-not-exist").status_code == 404


def test_non_proposal_409() -> None:
    import uuid

    from app.domain.conversation import Message, Thread, ToolCallPart, ToolResultPart
    from app.domain.enums import Actor, RunState
    from app.domain.result import ToolResult

    with _workspace():
        with _client() as c:
            threads, messages = c.app.state.threads, c.app.state.messages
            thread = _run(threads.create(Thread()))
            cid = uuid.uuid4().hex
            _run(
                messages.add(
                    Message(
                        thread_id=thread.id,
                        role="assistant",
                        actor=Actor.AGENT,
                        agent="default",
                        parts=[ToolCallPart(call_id=cid, tool="ping_host", args={}, state=RunState.OK)],
                    )
                )
            )
            _run(
                messages.add(
                    Message(
                        thread_id=thread.id,
                        role="tool",
                        actor=Actor.AGENT,
                        parts=[
                            ToolResultPart(call_id=cid, result=ToolResult(state=RunState.OK, summary="ok"))
                        ],
                    )
                )
            )
            assert _apply(c, thread.id, cid).status_code == 409


def test_apply_gate_denied_records_a_user_event() -> None:
    """C3-M2 — a gate-denied apply is auditable: the owner clicked Approve and the write did NOT run,
    so a USER Event is recorded with the failure status (not left as a silent gap in the trail)."""
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.enabled = False  # master switch off → gate denies
            tid, cid = _seed_proposal(c, "memory", {"target": "memory", "action": "add", "content": "x"})
            assert _apply(c, tid, cid).json()["applied"] is False
            events = c.get("/api/events").json()
            # a USER-actor `memory` event exists whose status is NOT ok (the denial was audited)
            assert any(
                e["action"] == "memory" and e["actor"] == "user" and e["status"] != "ok" for e in events
            )


def test_apply_txn_failure_retries_rows_outside_txn_no_duplicate() -> None:
    """C3-M1 convergence — the write runs, then the atomic row-txn fails: the endpoint retries the row
    updates INDIVIDUALLY (outside the txn) so the proposal still resolves. A re-approve then 409s
    (nothing pending), so the memory append can NEVER be duplicated by a second click."""
    import contextlib as _ctx

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            tid, cid = _seed_proposal(
                c, "memory", {"target": "memory", "action": "add", "content": "once note"}
            )
            db = c.app.state.db
            orig = db.transaction
            calls = {"n": 0}

            @_ctx.asynccontextmanager
            async def flaky():
                calls["n"] += 1
                if calls["n"] == 1:
                    raise RuntimeError("simulated txn failure AFTER the successful write")
                    yield  # pragma: no cover — unreachable, keeps this an async generator
                else:
                    async with orig():
                        yield

            db.transaction = flaky  # type: ignore[method-assign]
            try:
                r = _apply(c, tid, cid)
            finally:
                db.transaction = orig  # type: ignore[method-assign]

            assert r.status_code == 200 and r.json()["applied"] is True
            assert calls["n"] == 1  # the txn was hit once (and raised); the retry ran outside it
            # the proposal RESOLVED despite the txn failure (rows persisted via the individual retry)
            res = _result_part(c, tid, cid)
            assert res["data"].get("applied") is True and "proposed" not in res["data"]
            # a re-approve is a 409 (no pending proposal) — a duplicate append is impossible
            assert _apply(c, tid, cid).status_code == 409
            # and the note was written EXACTLY once
            mem = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert mem.count("once note") == 1


def test_apply_resolves_specialist_agent() -> None:
    body = "---\nname: triage\ndescription: triage\n---\n\nDo it.\n"
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.put("/api/agents/coder", json={"agent": {}}).status_code == 200
            tid, cid = _seed_proposal(
                c, "skill_manage", {"action": "save", "name": "triage", "content": body}, agent="coder"
            )
            assert _apply(c, tid, cid).json()["applied"] is True
            assert (tmp / "agents" / "coder" / "skills" / "triage" / "SKILL.md").is_file()
            assert not (tmp / "skills" / "triage").exists()  # not the global folder


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
