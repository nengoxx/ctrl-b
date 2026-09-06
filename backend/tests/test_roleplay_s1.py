"""Phase 23 / D70 slice S1 — greeting seeding, example dialogue, per-agent voice (§4.2 / §8.5).

Three behaviours land here, all on the seams S0 left:

  1. **Greeting** — the agent's `first_mes` persisted as a REAL assistant turn (`actor=AGENT` + the
     resolved agent name) at exactly two INTERACTIVE creation seams: the explicit new-thread
     endpoint (①) and the chat endpoint's auto-created thread AFTER routing resolves (②).
     Automation and subagent threads never seed (③) — pinned both structurally (the helper has two
     call sites) and functionally (creating a thread the way they do seeds nothing).
  2. **Example dialogue** — `<START>`-delimited blocks parsed into
     `{role:"system", name:"example_user"|"example_assistant"}` pseudo-messages that ride the CACHED
     head, last, and survive `normalize_system_messages` as marked `user` turns keeping their side.
     (The normalizer's boundary rule itself is pinned where the function lives:
     `test_inference_sysmsg.test_a_named_system_message_terminates_the_leading_run`.)
  3. **Voice** — the TTS request resolves the named agent's `AgentDef.voice`; absent ⇒ the global
     chain; a non-empty-but-invalid id reports through the existing error path, never silently
     falls back. The three FE entry points (read-aloud, auto-TTS, read-along) share ONE request
     function — `requestTts` in `frontend/src/lib/audioController.ts`, called by `synthWhole`
     (whole-message) and `synthChunk` (chunked + read-along) — so resolving here covers all three.

The head-shape helpers come from `test_roleplay_s0` (one source of truth for the head, per §10-S1);
the voice stub comes from `test_voice_6a`. Writes go through the APIs on a **temp** workspace.
"""

from __future__ import annotations

from pathlib import Path

from _async import run_async
from test_roleplay_s0 import (
    _agent,
    _assemble,
    _client,
    _make_thread,
    _session,
    _soul,
    _systems,
    _workspace,
    head,
)
from test_voice_6a import _StubVoice

from app.services.agent.examples import example_messages
from app.services.agent.macros import Macros

BACKEND = Path(__file__).resolve().parents[1]

_ROUTING_CONFIG = "server:\n  port: 5433\nagent:\n  auto_rotate: true\n"


def _messages(c, thread_id: str) -> list[dict]:
    r = c.get(f"/api/threads/{thread_id}/messages")
    assert r.status_code == 200, r.text
    return r.json()


def _new_thread(c, agent: str | None = None) -> dict:
    body = None if agent is None else {"agent": agent}
    r = c.post("/api/threads", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ── 1. greeting seeding ─────────────────────────────────────────────────────────────────────────


def test_seam_one_pins_the_agent_and_seeds_a_real_assistant_turn() -> None:
    """§4.2 ruling 11 + F5 ①: the explicit endpoint takes a selected agent, persists it on the
    thread, and seeds the greeting as an ORDINARY assistant message — `actor=agent` + the agent
    name, which is what makes attribution and the who-line read correctly.

    COMPACTION, BY DESIGN (§4.2 coverage audit): being ordinary history means a long thread's
    compactor MAY fold this row into its summary, exactly like any other old turn. The identity
    lives in the head's persona, not in the greeting — so this is correct, and nobody should
    later "fix" it by making the seeded row immune to compaction.
    """
    with _workspace(), _client() as c:
        _agent(c, "nyx", greeting="You found the archive. Mind the dust.")
        thread = _new_thread(c, "nyx")
        assert thread["agent"] == "nyx"  # pinned: every turn here runs as nyx, no per-turn routing
        msgs = _messages(c, thread["id"])
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["actor"] == "agent"
        assert msgs[0]["agent"] == "nyx"
        assert msgs[0]["parts"] == [{"type": "text", "text": "You found the archive. Mind the dust."}]
        assert msgs[0]["compacted"] is False  # an ordinary row — see the compaction note above


def test_a_thread_created_with_no_agent_is_the_pre_d70_endpoint() -> None:
    """No body at all (every existing client) and an explicit `null` alike: unpinned, unseeded."""
    with _workspace(), _client() as c:
        _agent(c, "nyx", greeting="Hello.")
        for thread in (_new_thread(c), c.post("/api/threads", json={"agent": None}).json()):
            assert thread["agent"] is None
            assert _messages(c, thread["id"]) == []


def test_an_empty_greeting_seeds_nothing() -> None:
    """Ruling 10's zero-cost coexistence: an agent with no greeting pins the thread and writes no
    message — including a greeting that only becomes empty once its macros render."""
    with _workspace(), _client() as c:
        _agent(c, "plain")
        _agent(c, "ghost", greeting="{{original}}")  # renders to nothing outside a persona text
        for name in ("plain", "ghost"):
            thread = _new_thread(c, name)
            assert thread["agent"] == name
            assert _messages(c, thread["id"]) == []


def test_the_greeting_is_macro_substituted_at_seed_time() -> None:
    """§4.3's vocabulary, resolved when the conversation opens — the stored row carries the values
    that were true then, like every other persisted turn."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"roleplay": {"persona": {"name": "Emma"}}}).status_code == 200
        _agent(c, "nyx", title="Nyx the Archivist", greeting="I am {{char}}. Welcome, {{user}}.")
        thread = _new_thread(c, "nyx")
        assert _messages(c, thread["id"])[0]["parts"][0]["text"] == "I am Nyx the Archivist. Welcome, Emma."


def test_an_unknown_selected_agent_resolves_gracefully() -> None:
    """The house rule for every agent lookup: a since-deleted name lands on the default agent
    rather than 500ing or pinning the thread to something that isn't there."""
    with _workspace(), _client() as c:
        thread = _new_thread(c, "gone")
        assert thread["agent"] == c.app.state.settings.DEFAULT_AGENT_NAME
        assert _messages(c, thread["id"]) == []  # the default agent ships no greeting


def test_seam_two_seeds_the_auto_created_chat_thread_after_routing() -> None:
    """F5 ②: the chat endpoint's own thread seeds only once `_auto_route_agent` has decided — the
    ROUTED specialist's greeting, not the default agent's."""
    from test_agent_selector_7eg import _capture_chat_session

    import app.api.agent as agent_api

    with _workspace(_ROUTING_CONFIG), _client() as c:
        _agent(c, "coder", description="write and debug python code", greeting="Show me the traceback.")
        _agent(c, "writer", description="draft prose and articles", greeting="What are we writing?")
        with _capture_chat_session(agent_api) as cap:
            r = c.post("/api/agent/chat", json={"text": "debug my python code"})
            assert r.status_code == 200, r.text
        assert cap["agent_name"] == "coder"
        tid = r.json()["threadId"]
        msgs = _messages(c, tid)
        assert [(m["role"], m["agent"]) for m in msgs] == [("assistant", "coder")]
        assert msgs[0]["parts"][0]["text"] == "Show me the traceback."


def test_seam_two_never_seeds_a_thread_it_did_not_create() -> None:
    """Only the auto-created thread seeds: chatting into an existing conversation must not drop a
    greeting into the middle of it."""
    from test_agent_selector_7eg import _capture_chat_session

    import app.api.agent as agent_api

    with _workspace(_ROUTING_CONFIG), _client() as c:
        _agent(c, "coder", description="write and debug python code", greeting="Show me the traceback.")
        tid = _new_thread(c)["id"]  # no agent → nothing seeded at creation
        with _capture_chat_session(agent_api):
            r = c.post("/api/agent/chat", json={"text": "debug my python code", "thread_id": tid})
            assert r.status_code == 200, r.text
        assert _messages(c, tid) == []


def test_headless_threads_never_seed() -> None:
    """F5 ③: automation and subagent threads carry no greeting. Pinned twice, because either half
    alone is weak — the structural half proves no headless path can reach the helper even after a
    refactor, the functional half proves the creation shape those paths use writes no message."""
    src = (BACKEND / "app").rglob("*.py")
    callers = {p.relative_to(BACKEND).as_posix() for p in src if "seed_greeting" in p.read_text("utf-8")}
    assert callers == {"app/services/agent/greeting.py", "app/api/agent.py"}, (
        f"greeting seeding reached a new call site: {sorted(callers)} — §4.2 rules automation and "
        "subagent threads out, so a third caller needs a plan amendment first"
    )

    with _workspace(), _client() as c:
        from app.domain.conversation import Thread

        _agent(c, "nyx", greeting="Hello, traveller.")
        s = c.app.state
        # Exactly what `automations/runner._thread_for` and `agent/subagents` do: an archived thread
        # created straight on the repo, agent-pinned, with no seeding step anywhere near it.
        thread = run_async(s.threads.create(Thread(title="[automation] nightly", agent="nyx", archived=True)))
        assert run_async(s.messages.list(thread.id)) == []


# ── 2. example dialogue: the parse ──────────────────────────────────────────────────────────────


def _parsed(raw: str, char: str = "Nyx", user: str = "Emma") -> list[tuple[str, str]]:
    return [(m["name"], m["content"]) for m in example_messages(raw, Macros(char=char, user=user))]


def test_start_blocks_parse_into_side_marked_turns() -> None:
    raw = "<START>\n{{user}}: Are you awake?\n{{char}}: Mostly.\n<START>\n{{char}}: Again?"
    assert _parsed(raw) == [
        ("example_user", "Are you awake?"),
        ("example_assistant", "Mostly."),
        ("example_assistant", "Again?"),
    ]
    assert all(m["role"] == "system" for m in example_messages(raw, Macros(char="Nyx", user="Emma")))


def test_a_field_with_no_start_marker_is_one_block() -> None:
    """ST prepends `<START>\\n` when the string doesn't begin with one (R64 §1.3), so an unmarked
    field is well-formed input — and so is text sitting BEFORE the first marker."""
    assert _parsed("{{user}}: hi\n{{char}}: mm.") == [("example_user", "hi"), ("example_assistant", "mm.")]
    assert _parsed("{{char}}: one\n<START>\n{{char}}: two") == [
        ("example_assistant", "one"),
        ("example_assistant", "two"),
    ]


def test_an_empty_or_marker_only_field_yields_nothing() -> None:
    for raw in ("", "   \n  ", "<START>", "<START>\n<START>\n"):
        assert _parsed(raw) == []


def test_unlabelled_lines_ride_with_the_turn_they_belong_to() -> None:
    """ST accumulates lines and flushes at the NEXT speaker line: a multi-line reply keeps its
    continuation, and a block's preamble rides with its first labelled turn instead of vanishing."""
    assert _parsed("<START>\n{{char}}: Mostly.\nThe dust settles.") == [
        ("example_assistant", "Mostly.\nThe dust settles.")
    ]
    assert _parsed("<START>\n[the archive, at night]\n{{user}}: hi") == [
        ("example_user", "[the archive, at night]\nhi")
    ]


def test_a_block_with_no_speaker_line_survives_as_the_characters_turn() -> None:
    """Our one deliberate departure from ST, which drops such a block entirely: the owner's text
    survives verbatim and visibly instead of disappearing from the prompt with no signal."""
    assert _parsed("<START>\nShe never answers the first time.") == [
        ("example_assistant", "She never answers the first time.")
    ]


def test_speaker_lines_are_matched_on_the_RESOLVED_names() -> None:
    """The macro pass runs first (ST's order), so the parser sees `Emma:` / `Nyx:` — an author who
    writes the resolved names directly is parsed identically, and a later mention of a name inside
    a line is never mistaken for a label."""
    assert _parsed("<START>\nEmma: hi\nNyx: Emma asked. Nyx: is not a new line here.") == [
        ("example_user", "hi"),
        ("example_assistant", "Emma asked. Nyx: is not a new line here."),
    ]
    assert _parsed("<START>\n{{user}}: hi", char="Nyx", user="the patron") == [("example_user", "hi")]


def test_the_longest_resolved_prefix_wins() -> None:
    """S1 Emma round MED-2 (her executable repro): with user `Ann` and character `Ann:archivist`,
    fixed user-first matching filed the character's line under `example_user` (its label starts
    with `Ann:`). Longest resolved prefix decides — order-independent for every distinct pair."""
    assert _parsed("<START>\nAnn: U\nAnn:archivist: A", char="Ann:archivist", user="Ann") == [
        ("example_user", "U"),
        ("example_assistant", "A"),
    ]
    # …and the mirrored lengths too: a user name that extends the character's.
    assert _parsed("<START>\nNyx: A\nNyx:junior: U", char="Nyx", user="Nyx:junior") == [
        ("example_assistant", "A"),
        ("example_user", "U"),
    ]


def test_identical_names_stay_user_first_as_the_documented_limit() -> None:
    """Identical resolved user/char names are inherently ambiguous — no rule can recover the side.
    The stable order files every turn as `example_user`; pinned so the limit is a choice, not
    drift."""
    assert _parsed("<START>\nSam: one\nSam: two", char="Sam", user="Sam") == [
        ("example_user", "one"),
        ("example_user", "two"),
    ]


# ── 3. example dialogue: where the pseudo-messages sit ──────────────────────────────────────────


_EXAMPLES = "<START>\n{{user}}: Are you awake?\n{{char}}: Mostly."


def test_the_examples_sit_last_in_the_head_before_the_history() -> None:
    with _workspace(), _client() as c:
        _agent(c, "nyx", example_dialogue=_EXAMPLES)
        _soul(c, "nyx", "You are Nyx.")
        messages = _assemble(c, _make_thread(c), "nyx")
        assert _systems(messages) == [head("You are Nyx."), "Are you awake?", "Mostly."]
        assert [(m.get("name"), m["role"]) for m in messages[1:3]] == [
            ("example_user", "system"),
            ("example_assistant", "system"),
        ]
        assert [m["role"] for m in messages[3:]] == ["user"]  # then the live history, unmoved


def test_the_examples_ride_the_cached_head() -> None:
    """Turn-stable: they are built with the head, once, and reused byte-identically — a per-call
    re-render would churn the prefix cache the head exists to hold still."""
    with _workspace(), _client() as c:
        _agent(c, "nyx", example_dialogue=_EXAMPLES)
        s = _session(c, "nyx")
        assert s._static_prefix() is s._static_prefix()
        assert s._static_prefix()[-1] == {"role": "system", "name": "example_assistant", "content": "Mostly."}


def test_an_empty_example_field_adds_nothing_to_the_head() -> None:
    with _workspace(), _client() as c:
        _agent(c, "nyx")
        _soul(c, "nyx", "You are Nyx.")
        assert _systems(_assemble(c, _make_thread(c), "nyx")) == [head("You are Nyx.")]


def test_the_examples_reach_the_wire_as_marked_user_turns_keeping_their_side() -> None:
    """End-to-end through the wire shaper: the head still coalesces, the examples do not merge into
    it, and each keeps its `example_user`/`example_assistant` name."""
    from app.adapters.inference import normalize_system_messages

    with _workspace(), _client() as c:
        assert (
            c.put("/api/settings", json={"inference": {"system_prompt_append": "EXTRA"}}).status_code == 200
        )
        _agent(c, "nyx", example_dialogue=_EXAMPLES)
        _soul(c, "nyx", "You are Nyx.")
        wire = normalize_system_messages(_assemble(c, _make_thread(c), "nyx"))
        assert [m["role"] for m in wire] == ["system", "user", "user", "user"]
        assert wire[0]["content"] == head("You are Nyx.") + "\n\nEXTRA"
        assert [m["name"] for m in wire[1:3]] == ["example_user", "example_assistant"]
        # The side rides IN the frame (MED-1): strict templates ignore JSON `name`.
        assert wire[1]["content"] == '<system-update name="example_user">\nAre you awake?\n</system-update>'


# ── 4. per-agent voice resolution (§8.5, ruling 21) ─────────────────────────────────────────────


class _AppVoice(_StubVoice):
    """`_StubVoice` mounted on a REAL app: the lifespan drains every adapter on shutdown, so the
    stand-in needs the one method the client surface has beyond the router's."""

    async def aclose(self) -> None:
        return None


def _tts(c, **body) -> None:
    r = c.post("/api/voice/tts", json={"text": "hello", **body})
    assert r.status_code == 200, r.text


def test_the_agents_voice_is_what_the_tts_call_speaks_in() -> None:
    with _workspace(), _client() as c:
        stub = _AppVoice()
        c.app.state.voice = stub
        _agent(c, "nyx", voice="af_nova")
        _agent(c, "plain")
        _agent(c, "spacey", voice="   ")
        _tts(c, agent="nyx")
        _tts(c, agent="plain")  # no voice set ⇒ the global `voice.tts` chain decides
        _tts(c)  # no agent at all (every pre-D70 client) ⇒ likewise
        _tts(c, agent="nyx", voice="explicit")  # an explicit request voice is the most specific
        # MED-3: a non-empty value is passed AS-IS — never trimmed, never silently defaulted; a
        # whitespace id errors upstream like any other bad id ("" alone means absent).
        _tts(c, agent="spacey")
        assert [call["voice"] for call in stub.calls] == ["af_nova", None, None, "explicit", "   "]


def test_an_invalid_voice_id_reports_through_the_existing_error_path() -> None:
    """F6: nothing validates a voice id — no registry can enumerate a voice server's — so a bad one
    is passed through and surfaces as the same 502 a bad GLOBAL voice does. No silent fallback."""
    from app.adapters.voice import VoiceError

    class _PickyVoice(_AppVoice):
        async def synthesize(self, *, text, voice=None, audio_format=None, prefer=None):
            if voice not in (None, "af_nova"):
                raise VoiceError("unknown voice 'no_such_voice'")
            return await super().synthesize(text=text, voice=voice, audio_format=audio_format, prefer=prefer)

    with _workspace(), _client() as c:
        c.app.state.voice = _PickyVoice()
        _agent(c, "broken", voice="no_such_voice")
        r = c.post("/api/voice/tts", json={"text": "hello", "agent": "broken"})
        assert r.status_code == 502
        assert "unknown voice" in r.json()["detail"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
