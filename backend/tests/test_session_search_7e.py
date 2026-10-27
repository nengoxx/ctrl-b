"""Phase 7e-e — session_search (FTS5 over messages + the agent builtin tool, D15 #7).

Exercises the index/triggers (migration 3), the `MessageRepo.search` query, and the `session_search`
tool through the real `ActionService` (global scope, archived exclusion, redaction, sanitization).

What's exercised:
  Index / repo:
    1. finds matching user/assistant text across threads, returning the row's raw text (no cut).
    2. reasoning parts are NOT indexed (the model's scratchpad isn't searchable).
    3. system/tool messages are NOT indexed (only user/assistant).
    4. archived (ephemeral subagent) threads excluded by default; include_archived opts in.
    5. an UPDATE re-syncs the index (old text gone, new text found).
    6. a word-less / FTS-operator query is sanitized — no crash, sensible result.
  Tool (through ActionService):
    7. returns ranked hits as OK with data["results"] + a formatted output.
    8. snippets are redacted against live config secrets (D15 #7).
    9. ISS-118: the whole row is redacted BEFORE the excerpt is cut — a query term inside a secret,
       and a secret at either window edge, stay masked; the window/marks/cap are cut in Python
       (`_excerpt`), anchored across diacritics; user rows are attributed to the owner (C).

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import json
import tempfile
from pathlib import Path

import pytest
from _async import run_async

from app.domain.event import ORIGIN_USER_CHAT


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("CTRLB_HOME", str(tmp))
        mp.setenv("CTRLB_CONFIG", str(cfg))
        mp.setenv("CTRLB_DB", str(tmp / "t.db"))
        yield tmp, cfg


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
        c.app.state.actions.invoke(
            "session_search", args, origin=ORIGIN_USER_CHAT, actor=Actor.AGENT, privilege=Privilege.CONFIRM
        )
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
            # The repo returns the row's whole RAW text — the tool redacts it before cutting (ISS-118).
            assert hits[0]["text"] == "started jellyfin on the media box"
            assert "snippet" not in hits[0]


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


def _with_key(c, key: str) -> None:
    from app.config import ModelCfg, ProviderCfg

    c.app.state.settings.providers["local"] = ProviderCfg(
        base_url="http://x/v1", api_key=key, models={"m": ModelCfg()}
    )


def _exposed(out) -> str:
    """Everything a hit exposes: the model's text + the results the tool row / UI / audit carry
    (`data["query"]` is left out — it echoes the model's own query back, it discloses nothing)."""
    return out.result.output + json.dumps(out.result.data["results"], ensure_ascii=False)


def test_tool_masks_a_secret_the_query_hits() -> None:
    """ISS-118: a query term INSIDE a secret must not split it — the old FTS `snippet()` put `«»`
    around the matched token, which broke the secret into pieces `redact` no longer recognised."""
    key = "sk-LIVEKEY0123456789"
    with _workspace():
        with _client() as c:
            _with_key(c, key)
            t = _thread(c)
            _msg(c, t.id, "user", _text(f"my key is {key} keep it"))
            for query in ("sk", "LIVEKEY0123456789"):
                out = _invoke(c, {"query": query})
                assert len(out.result.data["results"]) == 1, query  # the hit is still returned
                assert "LIVEKEY" not in _exposed(out), query
                assert "••••" in out.result.data["results"][0]["snippet"], query


def test_tool_masks_a_secret_at_either_excerpt_edge() -> None:
    """ISS-118: a multi-token secret at either window edge — FTS5 cut on token boundaries, so the
    leading `…` left the key's tail and the trailing `…` its head; neither matched `redact`."""
    key = "sk-proj-ABCD1234-EFGH5678"
    lead = " ".join([key, *(f"w{i}" for i in range(8)), "leadtarget"])
    trail = " ".join(["trailtarget", *(f"v{i}" for i in range(8)), key, "tail"])
    with _workspace():
        with _client() as c:
            _with_key(c, key)
            t = _thread(c)
            _msg(c, t.id, "user", _text(lead))
            _msg(c, t.id, "user", _text(trail))
            for query in ("leadtarget", "trailtarget"):
                out = _invoke(c, {"query": query})
                assert len(out.result.data["results"]) == 1, query
                exposed = _exposed(out)
                assert "ABCD1234" not in exposed and "EFGH5678" not in exposed, query


def test_tool_excerpt_windows_and_marks() -> None:
    """The excerpt is cut in Python: the 12-word window with the most distinct query terms, `…` at
    each cut edge, `«»` around the matched words; the raw row `text` never reaches `data`."""
    from app.services.agent.session_search import _EXCERPT_WORDS

    words = [f"pad{i}" for i in range(40)]
    words[20] = "amberterm"
    words[24] = "cobaltterm"
    words[2] = "cobaltterm"  # a lone hit early: the window holding BOTH terms must win over it
    with _workspace():
        with _client() as c:
            t = _thread(c)
            _msg(c, t.id, "user", _text(" ".join(words)))
            out = _invoke(c, {"query": "amberterm cobaltterm"})
            hit = out.result.data["results"][0]
            snip = hit["snippet"]
            assert snip.startswith("…") and snip.endswith("…")
            assert "«amberterm»" in snip and "«cobaltterm»" in snip
            assert "pad3 " not in snip  # the window sits around the pair, not the early lone hit
            assert len(snip.strip("…").split()) == _EXCERPT_WORDS
            assert "text" not in hit
            assert snip in out.result.output


def test_tool_excerpt_caps_a_spaceless_blob() -> None:
    """A long whitespace-free row is ONE word to the window — the character cap bounds it."""
    from app.services.agent.session_search import _EXCERPT_CHARS

    blob = "-".join(f"chunk{i}" for i in range(800)) + "-needleterm"
    assert len(blob) > 6000 and " " not in blob
    with _workspace():
        with _client() as c:
            t = _thread(c)
            _msg(c, t.id, "user", _text(blob))
            out = _invoke(c, {"query": "needleterm"})
            results = out.result.data["results"]
            assert len(results) == 1  # the hit is still returned
            assert len(results[0]["snippet"]) <= _EXCERPT_CHARS + 1
            assert "\n" not in out.result.output  # a plain slice: `_format`'s list stays one line per hit


def test_tool_excerpt_anchors_across_diacritics() -> None:
    """FTS5 `unicode61` matches `cafe` ⇄ `café`; `fts_tokens` folds the same way, so the excerpt
    anchors (and marks) the word the index matched rather than falling back to the head."""
    head = " ".join(f"pad{i}" for i in range(20))
    with _workspace():
        with _client() as c:
            t = _thread(c)
            _msg(c, t.id, "user", _text(f"{head} we met at the Café yesterday"))
            _msg(c, t.id, "user", _text(f"{head} the cafe was closed"))
            for query, word in (("cafe", "«Café»"), ("café", "«cafe»")):
                out = _invoke(c, {"query": query})
                snips = [r["snippet"] for r in out.result.data["results"]]
                assert len(snips) == 2, query
                assert any(word in s for s in snips), (query, snips)
                assert all(s.startswith("…") for s in snips), (query, snips)


def test_tool_attributes_user_rows_to_the_owner() -> None:
    """A user row is the owner's own words — never labelled with the thread's agent (ISS-118 C)."""
    with _workspace():
        with _client() as c:
            t = _thread(c, title="chat", agent="maia")
            _msg(c, t.id, "user", _text("tangerineword from me"))
            _msg(c, t.id, "assistant", _text("tangerineword from the agent"), agent="maia")
            out = _invoke(c, {"query": "tangerineword"})
            lines = out.result.output.splitlines()
            assert len(lines) == 2
            assert any("· owner: «tangerineword» from me" in ln for ln in lines), lines
            assert any("· maia: «tangerineword» from the agent" in ln for ln in lines), lines


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
