"""Phase 7e-d-2 — file memory write path (`FileMemoryProvider.write` + the `memory` builtin tool).

Exercises the write surface the read path (7e-d-1) feeds: the provider's `write` (add/replace/remove,
`§` formatting, cap enforcement, old_text matching) and the `memory` tool driven through the real
`ActionService` (gating, the `auto_write` kill switch's propose-only mode, cap → ERROR result, audit
Event, per-agent isolation).

What's exercised:
  Provider:
    1. add        — `§`-delimited entry; a second add appends without clobbering the first.
    2. replace    — first occurrence of old_text swapped for content.
    3. remove     — first occurrence of old_text deleted, blank runs collapsed.
    4. not found  — replace/remove with an absent old_text raises MemoryWriteError.
    5. over cap   — a write past the (live) char cap raises MemoryCapError.
  Tool (through ActionService):
    6. add        — OK result, file written, an audit Event recorded.
    7. propose    — auto_write off → OK "proposed" result with data["proposed"], nothing written.
    8. user gate  — target=user with user_profile_enabled off → DENIED.
    9. master off — memory.enabled off → DENIED.
   10. cap error  — a too-long add → ERROR result (not a crash) steering to consolidate.
   11. isolation  — a specialist writes its own agents/<slug>/memories/MEMORY.md, root untouched.

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
from pathlib import Path


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
    return asyncio.get_event_loop().run_until_complete(coro)


def _agent(c, name: str | None = None):
    return c.app.state.settings.resolve_agent(name)


def _invoke(c, args: dict, *, agent_name: str | None = None):
    from app.domain.enums import Actor, Privilege

    return _run(
        c.app.state.actions.invoke(
            "memory", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM, agent=_agent(c, agent_name)
        )
    )


# ── provider ──────────────────────────────────────────────────────────────────────────────────


def test_add_formats_and_appends() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _agent(c)
            prov.write(agent, "memory", "add", "first note")
            prov.write(agent, "memory", "add", "second note")
            body = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert "§ first note" in body and "§ second note" in body
            assert body.index("first note") < body.index("second note")


def test_replace_swaps_first_occurrence() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _agent(c)
            prov.write(agent, "memory", "add", "alpha beta")
            prov.write(agent, "memory", "replace", "gamma", old_text="beta")
            body = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert "alpha gamma" in body and "beta" not in body


def test_remove_deletes_substring() -> None:
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _agent(c)
            prov.write(agent, "memory", "add", "keep this drop that")
            prov.write(agent, "memory", "remove", "", old_text=" drop that")
            body = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert "keep this" in body and "drop that" not in body


def test_old_text_not_found_raises() -> None:
    from app.services.agent.memory import MemoryWriteError

    with _workspace():
        with _client() as c:
            prov, agent = c.app.state.memory, _agent(c)
            prov.write(agent, "memory", "add", "alpha")
            try:
                prov.write(agent, "memory", "replace", "x", old_text="nope")
            except MemoryWriteError:
                pass
            else:
                raise AssertionError("expected MemoryWriteError for absent old_text")


def test_over_cap_raises() -> None:
    from app.services.agent.memory import MemoryCapError

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.memory_char_limit = 10
            prov, agent = c.app.state.memory, _agent(c)
            try:
                prov.write(agent, "memory", "add", "this note is well over ten characters")
            except MemoryCapError:
                pass
            else:
                raise AssertionError("expected MemoryCapError over the char cap")


def test_remove_while_over_cap_succeeds() -> None:
    """F1: once a store is over cap (here via the uncapped manual overwrite), a `remove` that shrinks
    it must still succeed even if it stays over cap — the over-cap state must not trap the edits that
    resolve it."""
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.memory_char_limit = 20
            prov, agent = c.app.state.memory, _agent(c)
            prov.overwrite(agent, "memory", "§ alpha entry\n\n§ beta entry\n\n§ gamma entry")
            prov.write(agent, "memory", "remove", "", old_text="§ beta entry\n\n")
            body = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert "beta" not in body and "alpha" in body and "gamma" in body
            assert len(body.strip()) > 20  # still over the 20-char cap, yet the shrink went through


def test_shrinking_replace_while_over_cap_succeeds() -> None:
    """F1: a `replace` that shrinks an over-cap store is allowed even if the result is still over cap."""
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.memory_char_limit = 10
            prov, agent = c.app.state.memory, _agent(c)
            prov.overwrite(agent, "memory", "§ a very long first entry here\n\n§ second entry")
            prov.write(agent, "memory", "replace", "shorter", old_text="a very long first entry here")
            body = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert "shorter" in body and "a very long first entry here" not in body


def test_growing_replace_over_cap_still_raises() -> None:
    """F1 boundary: an edit that *grows* the store past the cap is still rejected."""
    from app.services.agent.memory import MemoryCapError

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.memory_char_limit = 20
            prov, agent = c.app.state.memory, _agent(c)
            prov.write(agent, "memory", "add", "tiny")
            try:
                prov.write(agent, "memory", "replace", "x" * 40, old_text="tiny")
            except MemoryCapError:
                pass
            else:
                raise AssertionError("expected MemoryCapError for a growing replace over the cap")


def test_remove_cleans_orphan_marker() -> None:
    """F3a: removing an entry by its text (not its `§` marker) must not leave a lone `§` bullet."""
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            prov, agent = c.app.state.memory, _agent(c)
            prov.write(agent, "memory", "add", "first fact")
            prov.write(agent, "memory", "add", "second fact")
            prov.write(agent, "memory", "remove", "", old_text="second fact")
            body = (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert "second fact" not in body and "first fact" in body
            assert not any(line.strip() == "§" for line in body.splitlines())  # no orphaned marker


# ── tool (through ActionService) ────────────────────────────────────────────────────────────────


def test_tool_add_writes_and_audits() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            out = _invoke(c, {"target": "memory", "action": "add", "content": "remember this"})
            assert out.result.state == RunState.OK
            assert "remember this" in (tmp / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert out.event is not None and out.event.action == "memory"  # auto-audited


def test_tool_auto_write_off_proposes_without_writing() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.auto_write = False
            out = _invoke(c, {"target": "memory", "action": "add", "content": "proposed note"})
            assert out.result.state == RunState.OK
            assert "proposed" in out.result.summary
            assert out.result.data["proposed"]["content"] == "proposed note"
            assert not (tmp / "memories" / "MEMORY.md").exists()  # nothing written


def test_tool_user_target_gated() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.user_profile_enabled = False
            out = _invoke(c, {"target": "user", "action": "add", "content": "x"})
            assert out.result.state == RunState.DENIED


def test_tool_master_switch_off_denies() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.enabled = False
            out = _invoke(c, {"target": "memory", "action": "add", "content": "x"})
            assert out.result.state == RunState.DENIED


def test_tool_over_cap_returns_error() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.memory_char_limit = 10
            out = _invoke(c, {"target": "memory", "action": "add", "content": "way too long to fit"})
            assert out.result.state == RunState.ERROR
            assert "cap" in (out.result.error or "")


def test_tool_specialist_writes_own_file() -> None:
    from app.domain.enums import RunState

    with _workspace() as (tmp, _cfg):
        with _client() as c:
            assert c.put("/api/agents/coder", json={"agent": {}}).status_code == 200
            out = _invoke(c, {"target": "memory", "action": "add", "content": "coder note"}, agent_name="coder")
            assert out.result.state == RunState.OK
            assert "coder note" in (tmp / "agents" / "coder" / "memories" / "MEMORY.md").read_text(encoding="utf-8")
            assert not (tmp / "memories" / "MEMORY.md").exists()  # root untouched


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
