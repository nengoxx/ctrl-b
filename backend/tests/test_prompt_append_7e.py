"""Phase 7e-a — system-prompt append layer + show-the-baked-default tests.

Covers the additive axis without disturbing the existing replace axis. `_assemble` is exercised
directly through `AgentSession` (constructed from `app.state` deps) so we verify the actual
message order: **base → global append → per-agent append → roster → skills note → history**.

7e-c update: per-agent appends now live on a **folder agent** (`agents/<name>/agent.yaml`), created
through the file-per-agent API (`PUT /api/agents/{name}`), not a `config.yaml` `agents[]` list (which
D14/D15 removed). The append behaviour is unchanged; only how an agent is defined moved. Each test
runs in an isolated `$CTRLB_HOME` temp workspace.

What's exercised:
  1. Baseline    — empty config → exactly one `system` message (the baked default).
  2. Global add  — `inference.system_prompt_append` → a 2nd `system` message after the base.
  3. Per-agent   — `AgentDef.prompt_append` on a folder agent → a 3rd message after global.
  4. Opt-out     — `inherit_append=False` on the agent → global is skipped (only per-agent).
  5. Replace+add — `inference.system_prompt` (replace) coexists with the append in the right slots.
  6. Whitespace  — a whitespace-only append is treated as empty (no extra `system` message).
  7. Clear       — clearing the global append via PUT="" falls back to no extra message.
  8. Built-in default agent picks up the global append (no folder agents at all).
  9. YAML        — multi-line append + the surrounding comments survive a round-trip to disk.
 10. GET shape  — the new fields round-trip (settings append + `GET /api/agents/{name}`).
 11. Two agents — each agent carries its own append; the right one is emitted per session.
 12. Endpoint   — `GET /api/agent/default-prompt` returns the baked text.

Writes go through the APIs on a **temp** workspace (audit E3); the real `config.yaml` is never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async
from test_roleplay_s0 import head  # the D70 head shape, derived in ONE place (§4.1)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    """An isolated `$CTRLB_HOME` temp workspace (config + db + agents/ all under it). Sets all three
    env knobs so a folder agent can never escape into the real project root."""
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


def _put_agent(c, name: str, **fields) -> None:
    """Create/update a folder agent via the file API (`agent.yaml` overrides). A new agent is
    scaffolded with a SOUL.md = the baked default, so its base prompt equals DEFAULT_SYSTEM_PROMPT."""
    r = c.put(f"/api/agents/{name}", json={"agent": fields})
    assert r.status_code == 200, r.text


def _session(c, agent_name: str | None = None):
    """Mirror `api.agent._session` without going through a request — same deps, optionally a named
    agent so we can test a configured agent's `prompt_append` / `inherit_append`."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(agent_name)
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        agent,
        skills=getattr(s, "skills", None),
        selector=getattr(s, "skill_selector", None),
    )


def _make_thread(c):
    """Create a thread with one user message so `_assemble` has *some* history (the new system
    messages live in front of it). Returns the Thread."""
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor

    s = c.app.state

    async def go():
        t = await s.threads.create(Thread())
        await s.messages.add(
            Message(thread_id=t.id, role="user", actor=Actor.USER, parts=[TextPart(text="hi")])
        )
        return t

    return run_async(go())


def _systems(messages: list[dict]) -> list[str]:
    """Return the leading run of `role=system` message contents — the ordered prefix of system
    blocks `_assemble` emits before any history. The order is what 7e-a's behaviour is about."""
    out: list[str] = []
    for m in messages:
        if m["role"] != "system":
            break
        out.append(m["content"])
    return out


def _assemble(c, thread, agent_name: str | None = None) -> list[dict]:
    return run_async(_session(c, agent_name)._assemble(thread))


def test_prompt_append_round_trip() -> None:
    """The canonical happy path: each step shifts the system-message prefix as predicted, in order."""
    with _workspace("# homelab\nserver:\n  port: 5433\n"):
        with _client() as c:
            thread = _make_thread(c)

            # 1. empty config → exactly one system message (the baked default)
            assert _systems(_assemble(c, thread)) == [head()]

            # 2. global append → emitted as a second system message, after the base
            r = c.put("/api/settings", json={"inference": {"system_prompt_append": "GLOBAL-X"}})
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread)) == [head(), "GLOBAL-X"]

            # 3. add a folder agent with prompt_append → three system messages (base, global, per-agent)
            _put_agent(c, "writer", prompt_append="AGENT-Y")
            c.put("/api/settings", json={"agent": {"default_agent": "writer"}})
            assert _systems(_assemble(c, thread, "writer")) == [head(), "GLOBAL-X", "AGENT-Y"]

            # 4. flip inherit_append=False → global is skipped; only per-agent appears
            _put_agent(c, "writer", prompt_append="AGENT-Y", inherit_append=False)
            assert _systems(_assemble(c, thread, "writer")) == [head(), "AGENT-Y"]

            # 5. replace axis (inference.system_prompt) coexists with the append — base becomes the
            #    override; the append still appears as its own message after it
            assert c.delete("/api/agents/writer").status_code == 200  # drop the writer agent
            r = c.put(
                "/api/settings",
                json={
                    "inference": {"system_prompt": "REPLACED-BASE"},
                    "agent": {"default_agent": ""},  # fall back to the default
                },
            )
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread)) == [head("REPLACED-BASE"), "GLOBAL-X"]


def test_whitespace_only_append_treated_as_empty() -> None:
    """`.strip()` defends against the user saving "   \\n  " in a textarea — the append should
    be silently treated as unset rather than emitting a useless blank system message."""
    with _workspace():
        with _client() as c:
            thread = _make_thread(c)
            r = c.put("/api/settings", json={"inference": {"system_prompt_append": "   \n\t  "}})
            assert r.status_code == 200, r.text
            _put_agent(c, "writer", prompt_append="\n  \n")
            c.put("/api/settings", json={"agent": {"default_agent": "writer"}})
            # neither whitespace-only value should produce a system message
            assert _systems(_assemble(c, thread, "writer")) == [head()]


def test_clear_global_append_falls_back() -> None:
    """Setting the global append then clearing it (PUT "") returns to a single system message —
    the editor's `[Restore default]` flow on the inline append field."""
    with _workspace():
        with _client() as c:
            thread = _make_thread(c)
            c.put("/api/settings", json={"inference": {"system_prompt_append": "X"}})
            assert _systems(_assemble(c, thread)) == [head(), "X"]

            r = c.put("/api/settings", json={"inference": {"system_prompt_append": ""}})
            assert r.status_code == 200, r.text
            assert _systems(_assemble(c, thread)) == [head()]


def test_builtin_default_agent_inherits_global_append() -> None:
    """The default/root agent has `inherit_append=True` — i.e. the global append applies out of the
    box, no folder agent needed."""
    with _workspace():
        with _client() as c:
            thread = _make_thread(c)
            c.put("/api/settings", json={"inference": {"system_prompt_append": "GLOBAL"}})
            # no folder agents → default_agent_def() → the default/root agent
            assert c.app.state.settings.resolve_agent(None).name == "default"
            assert _systems(_assemble(c, thread)) == [head(), "GLOBAL"]


def test_per_agent_append_is_isolated() -> None:
    """Two agents, each with their own `prompt_append`. Each session sees its own — the per-agent
    string never leaks across agents (a regression-guard for any future global-state shortcut)."""
    with _workspace():
        with _client() as c:
            thread = _make_thread(c)
            _put_agent(c, "a1", prompt_append="FROM-A1")
            _put_agent(c, "a2", prompt_append="FROM-A2")
            assert _systems(_assemble(c, thread, "a1")) == [head(), "FROM-A1"]
            assert _systems(_assemble(c, thread, "a2")) == [head(), "FROM-A2"]


def test_get_settings_reflects_new_fields() -> None:
    """The new fields round-trip so the Conf editor can read+write them: the global append via
    `GET /api/settings`, the per-agent append/inherit via `GET /api/agents/{name}`."""
    with _workspace():
        with _client() as c:
            body = c.get("/api/settings").json()
            assert body["inference"]["system_prompt_append"] == ""

            r = c.put("/api/settings", json={"inference": {"system_prompt_append": "GX"}})
            assert r.status_code == 200, r.text
            assert r.json()["settings"]["inference"]["system_prompt_append"] == "GX"
            assert c.get("/api/settings").json()["inference"]["system_prompt_append"] == "GX"

            _put_agent(c, "w", prompt_append="AY", inherit_append=False)
            agent = c.get("/api/agents/w").json()["agent"]
            assert agent["prompt_append"] == "AY"
            assert agent["inherit_append"] is False


def test_multiline_append_yaml_roundtrip() -> None:
    """The 7a ruamel writer must preserve multi-line append text (block scalar) AND the
    surrounding comments. Catches any quoting/escaping regression in the YAML round-trip path."""
    with _workspace("# homelab\nserver:\n  port: 5433\ninference:\n  default_mode: local\n") as (_t, cfg):
        with _client() as c:
            text = "line one\nline two\n  indented line\nline four"
            r = c.put("/api/settings", json={"inference": {"system_prompt_append": text}})
            assert r.status_code == 200, r.text

            # Comment + structure preserved on disk
            disk = cfg.read_text(encoding="utf-8")
            assert "# homelab" in disk
            assert "system_prompt_append" in disk
            # The append value survives byte-equivalent through a re-load + re-assemble
            from app.config import load_settings

            reloaded = load_settings(cfg)
            assert reloaded.inference.system_prompt_append == text
            # And the loop sees the exact stored content in the assembled messages
            thread = _make_thread(c)
            assert _systems(_assemble(c, thread)) == [head(), text]


def test_default_prompt_endpoint() -> None:
    """The endpoint that backs `[Load default]` / `[Restore default]` in the editor. D70: what it
    serves is the baked VOICE — the persona half alone, which is also what a new agent's SOUL.md is
    scaffolded with; the duties half is a registry prompt with its own editor row."""
    with _workspace():
        with _client() as c:
            from app.services.agent.prompts import REGISTRY
            from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

            r = c.get("/api/agent/default-prompt")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body == {"text": DEFAULT_SYSTEM_PROMPT}
            # Sanity-check the baked text actually contains something recognizable so a regression
            # to an empty/wrong constant is caught — and that it is the identity half only.
            assert "ctrl-b" in body["text"] and len(body["text"]) > 100
            assert REGISTRY["duties_agent"].default not in body["text"]


def test_static_prefix_is_cached_per_turn() -> None:
    """BE#1 — the invariant prompt prefix + tools are built ONCE per turn and reused byte-identically
    across loop iterations (a stable prefix is what lets the local KV cache / cloud prefix cache hit).
    Guards against a future edit reintroducing per-iteration jitter: on the SAME session, two assembles
    must yield an identical static head, `_static_prefix()` must return the very same list object, and
    `_tools()` must return the very same object."""
    with _workspace():
        with _client() as c:
            sess = _session(c)
            thread = _make_thread(c)
            run = run_async
            first = _systems(run(sess._assemble(thread)))  # iteration 1
            second = _systems(run(sess._assemble(thread)))  # iteration 2 — must match byte-for-byte
            assert first == second
            assert sess._static_prefix() is sess._static_prefix()  # memoized: same list object
            assert sess._tools() is sess._tools()  # tool schema rendered once, reused


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
