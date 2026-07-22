"""Phase 7e-e — session_search (FTS5 over messages + the agent builtin tool, D15 #7).

Exercises the index/triggers (migration 3), the `MessageRepo.search` query, and the `session_search`
tool through the real `ActionService` (global scope, archived exclusion, redaction, sanitization).

What's exercised:
  Index / repo:
    1. finds matching user/assistant text across threads, with a highlighted snippet.
    2. reasoning parts are NOT indexed (the model's scratchpad isn't searchable).
    3. system/tool messages are NOT indexed (only user/assistant).
    4. archived (ephemeral subagent) threads excluded by default; include_archived opts in.
    5. an UPDATE re-syncs the index (old text gone, new text found).
    6. a word-less / FTS-operator query is sanitized — no crash, sensible result.
  Tool (through ActionService):
    7. returns ranked hits as OK with data["results"] + a formatted output.
    8. snippets are redacted against live config secrets (D15 #7).

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


def _thread(c, *, title=None, agent=None, archived=False):
    from app.domain.conversation import Thread

    t = Thread(title=title, agent=agent, archived=archived)
    _run(c.app.state.threads.create(t))
    return t


def _msg(c, thread_id, role, parts, *, agent=None):
    from app.domain.conversation import Message
    from app.domain.enums import Actor

    m = Message(
        thread_id=thread_id,
        role=role,
        parts=parts,
        actor=Actor.USER if role == "user" else Actor.AGENT,
        agent=agent,
    )
    _run(c.app.state.messages.add(m))
    return m


def _text(s):
    from app.domain.conversation import TextPart

    return [TextPart(text=s)]


def _invoke(c, args: dict):
    from app.domain.enums import Actor, Privilege

    return _run(
        c.app.state.actions.invoke("session_search", args, actor=Actor.AGENT, privilege=Privilege.CONFIRM)
    )


# ── index / repo ──────────────────────────────────────────────────────────────────────────────


def test_finds_across_threads_with_snippet() -> None:
    with _workspace():
        with _client() as c:
            t1 = _thread(c, title="fleet ops")
            t2 = _thread(c, title="media")
            _msg(c, t1.id, "user", _text("please wake corsair tonight"))
            _msg(c, t2.id, "assistant", _text("started jellyfin on the media box"))
            hits = _run(c.app.state.messages.search("jellyfin"))
            assert len(hits) == 1
            assert hits[0]["thread_id"] == t2.id and hits[0]["thread_title"] == "media"
            assert "jellyfin" in hits[0]["snippet"] and "«" in hits[0]["snippet"]


def test_reasoning_not_indexed() -> None:
    from app.domain.conversation import ReasoningPart, TextPart

    with _workspace():
        with _client() as c:
            t = _thread(c)
            _msg(c, t.id, "assistant", [ReasoningPart(text="zebrathought planning"), TextPart(text="done")])
            assert _run(c.app.state.messages.search("zebrathought")) == []
            assert len(_run(c.app.state.messages.search("done"))) == 1


def test_system_and_tool_not_indexed() -> None:
    with _workspace():
        with _client() as c:
            t = _thread(c)
            _msg(c, t.id, "system", _text("orangeconfig directive"))
            _msg(c, t.id, "tool", _text("orangeconfig output"))
            assert _run(c.app.state.messages.search("orangeconfig")) == []


def test_archived_excluded_by_default() -> None:
    with _workspace():
        with _client() as c:
            t = _thread(c, title="[subagent]", archived=True)
            _msg(c, t.id, "assistant", _text("violetdelegation result"))
            assert _run(c.app.state.messages.search("violetdelegation")) == []
            incl = _run(c.app.state.messages.search("violetdelegation", include_archived=True))
            assert len(incl) == 1


def test_update_resyncs_index() -> None:
    with _workspace():
        with _client() as c:
            t = _thread(c)
            m = _msg(c, t.id, "assistant", _text("indigooldvalue"))
            assert len(_run(c.app.state.messages.search("indigooldvalue"))) == 1
            m.parts = _text("indigonewvalue")
            _run(c.app.state.messages.update(m))
            assert _run(c.app.state.messages.search("indigooldvalue")) == []
            assert len(_run(c.app.state.messages.search("indigonewvalue"))) == 1


def test_operator_and_empty_query_safe() -> None:
    with _workspace():
        with _client() as c:
            t = _thread(c)
            _msg(c, t.id, "user", _text("wake corsair"))
            # FTS operators/quotes in the raw query must not throw — each word is sanitized to a
            # quoted literal term, so this is a safe (AND'd) search, not an FTS syntax error.
            assert isinstance(_run(c.app.state.messages.search('corsair OR "wake*')), list)
            # Quotes around a real term are stripped → the term still matches.
            assert len(_run(c.app.state.messages.search('"corsair"'))) == 1
            # No word characters → empty match → no results, no error.
            assert _run(c.app.state.messages.search("!!! ??? ...")) == []


# ── tool (through ActionService) ─────────────────────────────────────────────────────────────


def test_tool_returns_ranked_hits() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            t = _thread(c, title="ops")
            _msg(c, t.id, "user", _text("remember to reboot the nas on sunday"))
            out = _invoke(c, {"query": "nas sunday", "limit": 5})
            assert out.result.state == RunState.OK
            assert out.result.data["results"] and out.result.data["results"][0]["thread_title"] == "ops"
            assert "nas" in out.result.output


def test_tool_redacts_secret_in_snippet() -> None:
    from app.domain.enums import RunState

    with _workspace():
        with _client() as c:
            from app.config import ModelCfg, ProviderCfg

            c.app.state.settings.providers["local"] = ProviderCfg(
                base_url="http://x/v1", api_key="SUPERSECRETKEY", models={"m": ModelCfg()}
            )
            t = _thread(c)
            _msg(c, t.id, "assistant", _text("the password is SUPERSECRETKEY for now"))
            out = _invoke(c, {"query": "password"})
            assert out.result.state == RunState.OK
            snip = out.result.data["results"][0]["snippet"]
            assert "SUPERSECRETKEY" not in snip and "••••" in snip


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
