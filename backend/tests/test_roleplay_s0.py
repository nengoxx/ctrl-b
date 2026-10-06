"""Phase 23 / D70 slice S0 — the assembly core (ROLEPLAY_PLAN §3.1/§3.2/§4).

The restructure this pins is UNIVERSAL (P3): every agent's head is now ONE leading system message
carrying two `## `-labelled sections — the Voice (the unchanged Class-A persona chain) and the
Duties (a registry text selected by `AgentDef.duties`). The load-bearing assertion is
`test_the_head_is_the_only_thing_that_moved`: for an agent using none of the new fields, the
assembled prompt differs from the pre-D70 one by exactly that head — same appends, same roster,
same tail.

What's exercised:
  1. Head shape   — two labelled sections; everything around them unmoved; nothing added at the tail.
  2. Duties       — both selector values; the text is registry-resolved; a bad value 422s.
  3. Semantics    — a SOUL.md persona now KEEPS a duties section (the deliberate change, §4.1).
  4. F13          — `inference.system_prompt` is the fallback VOICE, duties appended after, and both
                    append axes still ride in their own messages.
  5. Emissions    — scenario (before the roster), the owner persona (after it), post_history (after
                    the history); each empty ⇒ absent (ruling 10).
  6. Macros       — `{{char}}`, the two `{{user}}` rungs (D78), `{{original}}`'s once-rule + its
                    configured-prompt-else-empty meaning (R87/RP-1) + its empty post-history meaning;
                    the case fold and comment strip (RP-2/RP-3); unmatched tokens pass through;
                    the ST/CCv3 feature macros (ISS-28): their list forms, seeds, dice, the fixed
                    clock, the idle humanizer, the scoped comment, the cache-warning predicate.
  7. Data model   — the new `AgentDef` fields persist + round-trip; the ones S2+ owns stay inert.
  8. Config       — `roleplay:` defaults, round-trip, and validation.

Writes go through the APIs on a **temp** workspace; the real `config.yaml` is never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from _async import run_async

_ROSTER_CONFIG = "server:\n  port: 5433\ncomputers:\n  testbox:\n    ip: 192.0.2.1\n"


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    """An isolated `$CTRLB_HOME` temp workspace (config + db + agents/ all under it)."""
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


def head(voice: str | None = None, duties: str = "duties_agent") -> str:
    """The one leading system message an agent's head is now made of (§4.1) — the registry-owned
    Voice heading + the resolved persona, then the Duties heading + the selected duties text.

    Public because three other modules pin the system prefix and must not each re-derive the shape:
    `test_prompt_append_7e`, `test_memory_7e`, `test_core_memory_d57`.
    """
    from app.services.agent.prompts import REGISTRY
    from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

    body = DEFAULT_SYSTEM_PROMPT if voice is None else voice
    return (
        f"{REGISTRY['voice_heading'].default}\n{body}\n\n"
        f"{REGISTRY['duties_heading'].default}\n{REGISTRY[duties].default}"
    )


def _put_agent(c, name: str, **fields):
    return c.put(f"/api/agents/{name}", json={"agent": fields})


def _agent(c, name: str, **fields) -> None:
    r = _put_agent(c, name, **fields)
    assert r.status_code == 200, r.text


def _soul(c, name: str, content: str) -> None:
    assert c.put(f"/api/agents/{name}/soul", json={"content": content}).status_code == 200


def _persona(c, name: str, description: str = "", *, default: bool = False) -> str:
    """Add a library persona through its router (D78) and return the minted slug; `default` also
    points `roleplay.default_persona` at it through the ordinary settings PUT."""
    r = c.post("/api/personas", json={"name": name, "description": description})
    assert r.status_code == 201, r.text
    slug = r.json()["slug"]
    if default:
        assert c.put("/api/settings", json={"roleplay": {"default_persona": slug}}).status_code == 200
    return slug


def _session(c, agent_name: str | None = None):
    """Mirror `api.agent._session` without going through a request."""
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        s.settings.resolve_agent(agent_name),
        skills=getattr(s, "skills", None),
        selector=getattr(s, "skill_selector", None),
    )


def _make_thread(c):
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
    """The LEADING run of `system` contents — the static head, in order."""
    out: list[str] = []
    for m in messages:
        if m["role"] != "system":
            break
        out.append(m["content"])
    return out


def _assemble(c, thread, agent_name: str | None = None) -> list[dict]:
    return run_async(_session(c, agent_name)._assemble(thread))


# ── 1. the head shape ───────────────────────────────────────────────────────────────────────────


def test_the_head_is_the_only_thing_that_moved() -> None:
    """The load-bearing S0 pin (§10-S0): for an agent using NONE of the new fields, the assembled
    prompt differs from the pre-D70 one by exactly the restructured head — the appends still ride
    as their own messages in the same slots, the roster is still last in the head, and the tail
    still carries the history and nothing else."""
    with _workspace(_ROSTER_CONFIG), _client() as c:
        assert (
            c.put("/api/settings", json={"inference": {"system_prompt_append": "GLOBAL-X"}}).status_code
            == 200
        )
        _agent(c, "writer", prompt_append="AGENT-Y")
        _soul(c, "writer", "")  # no persona → the baked Voice, like the default agent

        messages = _assemble(c, _make_thread(c), "writer")
        systems = _systems(messages)
        assert systems[0] == head()
        assert systems[1:3] == ["GLOBAL-X", "AGENT-Y"]
        assert "testbox" in systems[3] and len(systems) == 4
        # …and the tail is untouched: the history, then nothing.
        assert [m["role"] for m in messages[4:]] == ["user"]


def test_the_head_is_two_labelled_sections_in_one_message() -> None:
    """Not two messages, not an unlabelled blob: ONE system message whose two `## ` sections are
    registry framings (P6 — no literal headings in code)."""
    with _workspace(), _client() as c:
        from app.services.agent.prompts import REGISTRY
        from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

        block = _systems(_assemble(c, _make_thread(c)))[0]
        assert block.count("## ") == 2
        assert block.startswith(REGISTRY["voice_heading"].default + "\n" + DEFAULT_SYSTEM_PROMPT)
        assert REGISTRY["duties_heading"].default + "\n" in block
        assert REGISTRY["duties_agent"].default in block


def test_the_baked_voice_is_the_identity_half_only() -> None:
    """D70 shrank `DEFAULT_SYSTEM_PROMPT` to identity: the tool discipline it used to fuse in now
    lives in `duties_agent`, so a SOUL.md persona can replace the Voice without taking the
    discipline with it (§4.1)."""
    from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

    assert "ctrl-b" in DEFAULT_SYSTEM_PROMPT
    for gone in ("task_plan", "web_search", "confirm"):
        assert gone not in DEFAULT_SYSTEM_PROMPT


# ── 2. the duties selector ──────────────────────────────────────────────────────────────────────


def test_duties_selector_picks_the_registry_text() -> None:
    with _workspace(), _client() as c:
        from app.services.agent.prompts import REGISTRY

        _agent(c, "talker", duties="conversational")
        _soul(c, "talker", "")
        _agent(c, "doer", duties="agent")
        _soul(c, "doer", "")

        assert _systems(_assemble(c, _make_thread(c), "talker"))[0] == head(duties="duties_conversational")
        assert _systems(_assemble(c, _make_thread(c), "doer"))[0] == head()
        # the two texts are genuinely different, and neither leaks into the other's head
        assert REGISTRY["duties_conversational"].default not in head()


def test_an_unknown_duties_value_is_refused_at_the_boundary() -> None:
    with _workspace(), _client() as c:
        assert _put_agent(c, "bogus", duties="butler").status_code == 422


def test_a_duties_override_reaches_the_head() -> None:
    """The whole point of the registry: the owner tunes the duties text like any other prompt."""
    with _workspace(), _client() as c:
        c.app.state.settings.prompts.clear()
        from app.config import PromptOverride

        c.app.state.settings.prompts["duties_agent"] = PromptOverride(override="Do as asked.")
        assert _systems(_assemble(c, _make_thread(c)))[0].endswith("Do as asked.")


def test_a_soul_persona_now_keeps_its_duties() -> None:
    """The deliberate semantic change (§4.1): a SOUL.md specialist used to lose every technical
    instruction; the Voice/Duties split means it keeps the duties half."""
    with _workspace(), _client() as c:
        _agent(c, "nyx")
        _soul(c, "nyx", "You are Nyx, a quiet archivist.")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You are Nyx, a quiet archivist.")


# ── 3. F13 — the fallback voice + both append axes ──────────────────────────────────────────────


def test_the_fallback_override_is_the_voice_and_duties_ride_after_it() -> None:
    """Emma F13, recorded: `inference.system_prompt` used to replace the whole fused prompt and is
    now the fallback VOICE only, with the duties text appended after it. No compatibility branch —
    this golden IS the new contract, alongside both append axes."""
    with _workspace(), _client() as c:
        assert (
            c.put(
                "/api/settings",
                json={
                    "inference": {"system_prompt": "REPLACED-BASE", "system_prompt_append": "GLOBAL-X"},
                },
            ).status_code
            == 200
        )
        _agent(c, "writer", prompt_append="AGENT-Y")
        _soul(c, "writer", "")

        assert _systems(_assemble(c, _make_thread(c), "writer")) == [
            head("REPLACED-BASE"),
            "GLOBAL-X",
            "AGENT-Y",
        ]


# ── 4. the three emissions (each empty ⇒ absent) ────────────────────────────────────────────────


def test_scenario_sits_between_the_head_and_the_roster() -> None:
    with _workspace(_ROSTER_CONFIG), _client() as c:
        _agent(c, "nyx", scenario="The archive is quiet tonight.")
        _soul(c, "nyx", "You are Nyx.")
        systems = _systems(_assemble(c, _make_thread(c), "nyx"))
        assert systems[0] == head("You are Nyx.")
        assert systems[1] == "The archive is quiet tonight."
        assert "testbox" in systems[2]


def test_an_empty_scenario_emits_nothing() -> None:
    with _workspace(), _client() as c:
        _agent(c, "nyx", scenario="   \n ")
        _soul(c, "nyx", "You are Nyx.")
        assert _systems(_assemble(c, _make_thread(c), "nyx")) == [head("You are Nyx.")]


def test_the_owner_persona_follows_the_roster_and_carries_its_framing() -> None:
    with _workspace(_ROSTER_CONFIG), _client() as c:
        from app.services.agent.prompts import REGISTRY

        _persona(c, "Emma", "I am Emma.", default=True)
        systems = _systems(_assemble(c, _make_thread(c)))
        assert "testbox" in systems[1]
        assert systems[2] == REGISTRY["persona_intro"].default + "\n\nI am Emma."


def test_the_owner_persona_renders_its_macros() -> None:
    """`{{user}}` in the description reads as the persona NAME (the ST convention; the S0 hold-out
    was reversed on the owner's real persona, which opens with the token). Rendered with the same
    pass as every other field — unknown tokens still pass through literally."""
    with _workspace(_ROSTER_CONFIG), _client() as c:
        from app.services.agent.prompts import REGISTRY

        _persona(c, "Ari", "{{user}} is tall. {{unknown}} stays.", default=True)
        systems = _systems(_assemble(c, _make_thread(c)))
        assert systems[2] == REGISTRY["persona_intro"].default + "\n\nAri is tall. {{unknown}} stays."


def test_an_empty_owner_persona_emits_nothing() -> None:
    with _workspace(_ROSTER_CONFIG), _client() as c:
        systems = _systems(_assemble(c, _make_thread(c)))
        assert len(systems) == 2 and "testbox" in systems[1]


def test_post_history_rides_after_the_history() -> None:
    """The operational last word: after the whole history, ahead of the ephemeral reflection nudge."""
    with _workspace(), _client() as c:
        _agent(c, "nyx", post_history="Stay in character.")
        _soul(c, "nyx", "You are Nyx.")
        messages = _assemble(c, _make_thread(c), "nyx")
        assert [m["role"] for m in messages] == ["system", "user", "system"]
        assert messages[-1]["content"] == "Stay in character."


def test_an_empty_post_history_emits_nothing() -> None:
    with _workspace(), _client() as c:
        _agent(c, "nyx", post_history="  ")
        _soul(c, "nyx", "You are Nyx.")
        assert [m["role"] for m in _assemble(c, _make_thread(c), "nyx")] == ["system", "user"]


# ── 5. macros (§4.3) ────────────────────────────────────────────────────────────────────────────


def test_char_is_the_title_then_the_slug() -> None:
    with _workspace(), _client() as c:
        _agent(c, "nyx")
        _soul(c, "nyx", "You are {{char}}.")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You are nyx.")

        _agent(c, "nyx", title="Nyx the Archivist")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You are Nyx the Archivist.")


def test_user_walks_its_two_rungs() -> None:
    """The resolved persona's name → the literal "User" (ruling 7 as D78 left it): the persona is
    the agent's own link, else `roleplay.default_persona` — both walked by `resolve_persona`."""
    with _workspace(), _client() as c:
        _agent(c, "nyx")
        _soul(c, "nyx", "You serve {{user}}.")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You serve User.")

        _persona(c, "Emma", default=True)
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You serve Emma.")

        patron = _persona(c, "the Archivist's patron")
        _agent(c, "nyx", persona=patron)
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You serve the Archivist's patron.")


def test_macros_run_over_the_scenario_and_the_post_history_too() -> None:
    with _workspace(), _client() as c:
        _persona(c, "Emma", default=True)
        _agent(
            c,
            "nyx",
            title="Nyx",
            scenario="{{char}} meets {{user}} in the stacks.",
            post_history="Answer {{user}} as {{char}}.",
        )
        _soul(c, "nyx", "You are {{char}}.")
        messages = _assemble(c, _make_thread(c), "nyx")
        assert _systems(messages)[1] == "Nyx meets Emma in the stacks."
        assert messages[-1]["content"] == "Answer Emma as Nyx."


def test_text_without_macros_is_untouched() -> None:
    """The leave-literal-on-miss rule is what makes a universal pass safe: an unknown token and a
    bare brace both survive, so existing SOUL.md text renders byte-identically."""
    with _workspace(), _client() as c:
        text = 'Reply with {"ok": true} and never {{improvise}}.'
        _agent(c, "nyx")
        _soul(c, "nyx", text)
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head(text)


def test_original_is_the_configured_system_prompt_else_nothing_and_duties_always_ride() -> None:
    """§4.1 as amended by R87/RP-1: `{{original}}` is V2's "the prompt the frontend would have
    used" — the owner's configured `inference.system_prompt`, else nothing. Never the baked
    assistant identity, and never a consumer of the Duties section, which always rides as its own
    section. The card field's convention puts the token at offset 0, so that is the shape pinned."""
    with _workspace(), _client() as c:
        from app.services.agent.session import DEFAULT_SYSTEM_PROMPT

        _agent(c, "nyx", title="Nyx")
        _soul(c, "nyx", "{{original}}\n\nWrite {{char}}'s replies in third person.\n\nNyx is a witch.")
        block = _systems(_assemble(c, _make_thread(c), "nyx"))[0]
        assert block == head("Write Nyx's replies in third person.\n\nNyx is a witch.")
        assert DEFAULT_SYSTEM_PROMPT not in block

        assert (
            c.put("/api/settings", json={"inference": {"system_prompt": "FALLBACK VOICE"}}).status_code == 200
        )
        block = _systems(_assemble(c, _make_thread(c), "nyx"))[0]
        assert block == head("FALLBACK VOICE\n\nWrite Nyx's replies in third person.\n\nNyx is a witch.")


def test_original_is_substituted_once() -> None:
    """`safe_substitute` replaces every occurrence, so the once-rule is explicit: the FIRST token
    takes the configured prompt, later ones render empty — whatever case each is written in."""
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"inference": {"system_prompt": "FALLBACK"}}).status_code == 200
        _agent(c, "nyx")
        _soul(c, "nyx", "{{Original}}\n\nAnd again: {{original}}")
        block = _systems(_assemble(c, _make_thread(c), "nyx"))[0]
        assert block == head("FALLBACK\n\nAnd again:")


def test_a_malformed_brace_run_is_not_a_token() -> None:
    """The S0 Emma round's MED. A `{{original}}` inside a longer brace run must not count as the
    once-rule's "first", which would blank a REAL token later in the text and silently delete the
    value the owner asked for there."""
    from app.services.agent.macros import Macros

    m = Macros(char="Nyx", user="User")
    assert m.render("{{{{original}}", original="HEAD") == "{{{{original}}"
    assert m.render("{{{{char}}") == "{{{{char}}"
    assert m.render("{{{{Char}}") == "{{{{Char}}"  # the case fold walks TOKENS too
    # The run does not steal "first": the real token still substitutes, a second real one blanks.
    assert m.render("{{{{original}} {{original}}", original="HEAD") == "{{{{original}} HEAD"
    assert m.render("{{original}} {{original}}", original="HEAD") == "HEAD "


def test_a_configured_system_prompt_carrying_the_token_leaves_no_literal() -> None:
    """The configured prompt is rendered with `original=""` before it is substituted, so one that
    itself says `{{original}}` cannot leave the literal sitting in a character's head."""
    with _workspace(), _client() as c:
        assert (
            c.put(
                "/api/settings", json={"inference": {"system_prompt": "{{original}}FALLBACK VOICE"}}
            ).status_code
            == 200
        )
        _agent(c, "nyx")
        _soul(c, "nyx", "You are Nyx.\n\n{{original}}")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You are Nyx.\n\nFALLBACK VOICE")


def test_an_agent_without_its_own_persona_never_substitutes_the_prompt_into_itself() -> None:
    """The R87 review's O-5: with no SOUL of its own (the root agent here), the Voice IS the configured
    prompt, so `{{original}}` inside it must render empty — substituting a text into itself printed
    it twice ("Be terse. Be terse.")."""
    with _workspace(), _client() as c:
        prompt = "{{original}}Be terse."
        assert c.put("/api/settings", json={"inference": {"system_prompt": prompt}}).status_code == 200
        assert _systems(_assemble(c, _make_thread(c)))[0] == head("Be terse.")


def test_the_configured_prompt_renders_its_own_macros_for_the_character() -> None:
    """`{{original}}`'s value is the configured prompt RENDERED — so a `{{char}}` in the owner's
    operator framing names the character whose SOUL pulled it in."""
    with _workspace(), _client() as c:
        prompt = "Write {{char}}'s next reply."
        assert c.put("/api/settings", json={"inference": {"system_prompt": prompt}}).status_code == 200
        _agent(c, "nyx", title="Nyx")
        _soul(c, "nyx", "{{original}}\n\nNyx is a witch.")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head(
            "Write Nyx's next reply.\n\nNyx is a witch."
        )


def test_a_soul_of_only_the_token_with_nothing_configured_keeps_both_sections() -> None:
    """The O-4 ruling, recorded: `{{original}}` alone with no configured prompt renders an EMPTY Voice
    body under its heading — the two-section shape stands (P3/R64 §5.4); nothing falls back."""
    with _workspace(), _client() as c:
        _agent(c, "nyx")
        _soul(c, "nyx", "{{original}}")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("")


def test_vocabulary_names_fold_in_any_ascii_case() -> None:
    """R87/RP-2: the field resolves macro names case-insensitively (ST lower-cases before the lookup)
    and real cards write `{{Char}}`/`{{User}}` — including example dialogue, whose speaker parse runs
    on the RENDERED names, so an unfolded `{{User}}:` collapsed a whole block into one frame."""
    from app.services.agent.macros import Macros

    m = Macros(char="Nyx", user="Emma")
    assert m.render("{{Char}} greets {{USER}}; {{uSeR}} nods.") == "Nyx greets Emma; Emma nods."
    assert m.render("{{ORIGINAL}}!", original="HEAD") == "HEAD!"
    # Outside the vocabulary a name keeps the case it was typed in — it renders literally anyway.
    assert m.render("{{LastMessage}} {{Persona}}") == "{{LastMessage}} {{Persona}}"


def test_the_case_fold_cannot_bind_a_unicode_look_alike() -> None:
    """The registry grammar stays NOFLAG (ASCII identifiers), and the fold only lowers names that
    grammar already matched — so a name spelled with a character that CASE-FOLDS onto ASCII (the
    long s, the Kelvin sign) is not a token and survives exactly as typed."""
    from app.services.agent.macros import Macros

    m = Macros(char="Nyx", user="Emma")
    for text in ("{{uſer}}", "{{ſections}}", "{{\u212achar}}", "{{cHar\u0130}}"):
        assert m.render(text) == text, text


def test_an_author_comment_renders_as_nothing_and_an_unclosed_one_stays_visible() -> None:
    """R87/RP-3: `{{// …}}` is the note the author hid from the model — ST renders it empty (first
    `}}` closes it, across lines). A `{{//` that never closes is not a comment; it stays visible,
    the typo-is-visible rule."""
    from app.services.agent.macros import Macros

    m = Macros(char="Nyx", user="Emma")
    assert m.render("Hi {{// keep it short\n and warm}}{{char}}.") == "Hi Nyx."
    assert m.render("A {{//one}}B{{// two}}C") == "A BC"
    assert m.render("Oops {{// never closed {{char") == "Oops {{// never closed {{char"
    assert m.render("Oops {{// never closed") == "Oops {{// never closed"


def test_the_comment_strip_and_case_fold_reach_the_assembled_head() -> None:
    """Every surface renders through `Macros.render`, so both pre-passes reach the head for free."""
    with _workspace(), _client() as c:
        _agent(c, "nyx", title="Nyx")
        _soul(c, "nyx", "{{// author note}}You are {{Char}}.")
        assert _systems(_assemble(c, _make_thread(c), "nyx"))[0] == head("You are Nyx.")


def test_unrendered_names_every_macro_this_build_leaves_literal() -> None:
    """The importers' report source: case-insensitive, deduped, sorted; the vocabulary, the feature
    macros (ISS-28) and the stripped comment are never listed, and ST's arg forms
    (`{{datetimeformat …}}`) are named by their name."""
    from app.services.agent.macros import unrendered, unrendered_note

    texts = [
        "{{Char}} at {{lastMessage}}",
        "{{datetimeformat YYYY}} {{DATETIMEFORMAT::x}} {{// hidden}} {{ date }} {{random:a,b}}",
        "{{user}} {{time}} {{Pick::a::b}} {{roll:d6}} {{idleDuration}} {{time_UTC+2}} {{hidden_key:k}}",
    ]
    assert unrendered(texts) == ["date", "datetimeformat", "lastmessage"]
    # A vocabulary name renders ONLY as a bare token — padded with whitespace it is literal, so it is
    # named (the R87 review's O-6).
    assert unrendered(["{{ char }}", "{{user }}", "{{original}}"]) == ["char", "user"]
    assert unrendered(["{{char}} {{Original}} {{// x}}", "plain"]) == []
    assert unrendered_note(["{{char}}"], "the card's text") == []
    (line,) = unrendered_note(texts, "the card's text")
    assert "the card's text" in line and line.endswith("{{date}}, {{datetimeformat}}, {{lastmessage}}")


def test_original_in_the_post_history_renders_as_nothing() -> None:
    """ctrl-b's own default post-history text is empty, so the token stands for nothing there — and
    it never drags the Duties section down to the tail."""
    with _workspace(), _client() as c:
        _agent(c, "nyx", post_history="{{original}}Stay in character.")
        _soul(c, "nyx", "You are Nyx.")
        messages = _assemble(c, _make_thread(c), "nyx")
        assert messages[-1]["content"] == "Stay in character."

        _agent(c, "nyx", post_history="{{original}}")
        assert [m["role"] for m in _assemble(c, _make_thread(c), "nyx")] == ["system", "user"]


# ── 5b. the feature macros (ISS-28) ─────────────────────────────────────────────────────────────

#: The fixed clock every time arm reads: Tuesday 2026-10-06, 15:05 in emma's zone (CEST, UTC+2).
_FIXED = datetime(2026, 10, 6, 15, 5, tzinfo=ZoneInfo("Europe/Madrid"))


def _m(*, thread: str = "t1", salt: str = "s1", user: str = "Emma", **kw):
    from app.services.agent.macros import Macros

    return Macros(char="Nyx", user=user, thread=thread, salt=salt, now=kw.pop("now", _FIXED), **kw)


@pytest.mark.parametrize(
    ("text", "allowed"),
    [
        ("{{random:a,b,c}}", {"a", "b", "c"}),  # the corpus's form (every owner `{{random`)
        ("{{random::a::b}}", {"a", "b"}),  # ST's new-engine form
        ("{{random:a::b}}", {"a", "b"}),  # one argument: `::` wins over commas
        ("{{random::a,b}}", {"a", "b"}),  # …and a lone `::` argument splits on commas
        ("{{random a, b}}", {"a", "b"}),  # the whitespace separator
        ("{{random: x\\, y , z }}", {"x, y", "z"}),  # `\,` is a literal comma; items trimmed
        ("{{Random:  spaced  ,  out  }}", {"spaced", "out"}),  # the corpus's `{{Random:` spelling
        ("{{random:I see {{user}}., I wave at {{User}}.}}", {"I see Emma.", "I wave at Emma."}),
        ("{{random:{{user}},{{CHAR}}}}", {"Emma", "Nyx"}),  # nested flush against the outer `}}`
        ("{{random}}", {""}),  # no items → nothing (ST)
        ("{{random:}}", {""}),
    ],
)
def test_random_reads_every_list_form(text: str, allowed: set[str]) -> None:
    for salt in ("s1", "s2", "s3", "s4", "s5"):
        assert _m(salt=salt).render(text) in allowed


def test_random_is_stable_within_a_turn_and_rerolls_across_turns() -> None:
    """D2's seed: the same salt (one turn) renders the same choice at every render site; a new salt
    (the next turn) can choose again; two occurrences in one field are independent."""
    text = "{{random:a,b,c,d,e,f,g,h}}"
    assert {_m(salt="turn").render(text) for _ in range(5)} == {_m(salt="turn").render(text)}
    assert len({_m(salt=f"s{i}").render(text) for i in range(40)}) > 1
    pairs = [_m(salt=f"s{i}").render(f"{text}|{text}").split("|") for i in range(40)]
    assert any(a != b for a, b in pairs)


def test_pick_is_stable_per_thread_and_position() -> None:
    """`pick` takes no salt (ST/Risu parity): every turn of a thread picks the same item, a different
    thread or a second occurrence can pick another, and a persona rename (a different `{{user}}`
    elsewhere in the field) does not reshuffle it — the seed is the occurrence, not the offset."""
    text = "{{pick:a,b,c,d,e,f,g,h}}"
    assert len({_m(salt=f"s{i}").render(text) for i in range(10)}) == 1
    assert len({_m(thread=f"t{i}").render(text) for i in range(40)}) > 1
    assert any(len(set(_m(thread=f"t{i}").render(f"{text}|{text}").split("|"))) == 2 for i in range(40))
    field = "{{user}} sees " + text
    for i in range(10):
        emma = _m(thread=f"t{i}", user="Emma").render(field).removeprefix("Emma sees ")
        assert _m(thread=f"t{i}", user="Ariadne").render(field).removeprefix("Ariadne sees ") == emma


def test_roll_follows_the_droll_grammar_and_a_bad_formula_stays_literal() -> None:
    from app.services.agent.macros import ROLL_MAX_DICE

    for salt in ("s1", "s2", "s3"):
        m = _m(salt=salt)
        assert 1 <= int(m.render("{{roll:6}}")) <= 6  # digits only = 1dN
        assert 1 <= int(m.render("{{roll:d6}}")) <= 6
        assert 3 <= int(m.render("{{roll:2d6+1}}")) <= 13
        assert -2 <= int(m.render("{{ROLL:1D2-3}}")) <= -1
        assert m.render(f"{{{{roll:{ROLL_MAX_DICE}d1}}}}") == str(ROLL_MAX_DICE)
    m = _m()
    for bad in (
        "{{roll:abc}}",
        "{{roll:0}}",
        "{{roll:d0}}",
        "{{roll:2d}}",
        "{{roll:1d6*2}}",
        "{{roll}}",
        f"{{{{roll:{ROLL_MAX_DICE + 1}d6}}}}",  # the cap: a visible literal, never a stalled turn
        "{{roll:" + "9" * 5000 + "}}",  # past int()'s digit limit — malformed, not a crash
    ):
        assert m.render(bad) == bad, bad


def test_reverse_and_the_ccv3_author_notes() -> None:
    m = _m()
    assert m.render("{{reverse:stressed}}") == "desserts"
    assert m.render("{{reverse:{{user}}}}") == "ammE"
    assert m.render("a{{comment: the author's aside}}b{{hidden_key:dragon}}c{{Comment}}d") == "abcd"


@pytest.mark.parametrize(
    ("text", "want"),
    [
        ("A{{//}}hidden\nacross lines{{///}}B", "AB"),  # multi-line scoped span
        ("A{{// note}}B", "AB"),  # an opener with no closer is the single form
        ("A{{///}}B", "A{{///}}B"),  # an ORPHAN closer stays literal (ST parity)
        ("A{{//}}x{{//}}y{{///}}z{{///}}B", "AB"),  # nested pairs, stack-matched
        ("A{{//}}x{{//}}y{{///}}B", "AxB"),  # an unmatched outer opener falls to the single form
        ("A{{//}}{{random:a,b}} {{time}}{{///}}B", "AB"),  # the body never renders
        ("{{//}} SECRET {{// todo}} more {{///}}", ""),  # a note inside a scope never pairs (ST)
        ("A{{// a note}}x{{///}}B", "Ax{{///}}B"),  # only the bare `{{//}}` opens: orphan closer
        ("A{{// }}x{{///}}B", "AB"),  # whitespace is no argument — still the bare opener
    ],
)
def test_the_scoped_comment_strips_before_the_single_form(text: str, want: str) -> None:
    assert _m().render(text) == want


def test_the_time_macros_read_the_fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """The server-zone clock through the `_now()` monkeypatch point (the default a bare `Macros`
    captures); moment's `en` formats, with explicit English names."""
    from app.config import Settings
    from app.domain.agent import AgentDef
    from app.services.agent import macros

    monkeypatch.setattr(macros, "_now", lambda: _FIXED)
    m = macros.Macros(char="Nyx", user="Emma")
    assert m.render("{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}") == (
        "3:05 PM|October 6, 2026|Tuesday|15:05|2026-10-06"
    )
    assert m.render("{{time::UTC+2}}|{{time_UTC-5}}|{{Time_utc+0}}|{{time::utc+9}}") == (
        "3:05 PM|8:05 AM|1:05 PM|10:05 PM"
    )
    for bad in (
        "{{time::UTC+99}}",
        "{{time::Madrid}}",
        "{{date::x}}",
        "{{isodate:1}}",
        "{{idle_duration:x}}",
    ):
        assert m.render(bad) == bad, bad
    late = _m(now=datetime(2027, 1, 3, 0, 30, tzinfo=ZoneInfo("Europe/Madrid")))
    assert late.render("{{time}} {{date}} {{weekday}}") == "12:30 AM January 3, 2027 Sunday"
    assert _m(now=_FIXED.replace(hour=12, minute=0)).render("{{time}}") == "12:00 PM"
    assert macros.macros_for(AgentDef(name="nyx"), Settings()).now == _FIXED  # the default read


def test_the_legacy_time_rewrite_touches_only_a_valid_offset() -> None:
    """ISS-28 wave 1 (Opus LOW-1 + LOW-3c): `{{time_UTC±N}}` is rewritten ONLY when the handler would
    render the offset, and never inside a longer brace run — anything else survives byte-identical.
    The offset is clamped to real zones' |N| ≤ 14 (moment reads |N| ≥ 16 as minutes)."""
    from app.services.agent.macros import UTC_OFFSET_MAX

    m = _m()
    assert UTC_OFFSET_MAX == 14
    for text in (
        "{{time_UTC+99}}",
        "{{time_UTC+15}}",
        "{{{{time_UTC+2}}",
        "{{time::UTC+15}}",
        "{{time::UTC-99}}",
    ):
        assert m.render(text) == text, text
    assert m.render("{{time_UTC-5}}|{{time::UTC+14}}|{{time_utc-14}}") == "8:05 AM|3:05 AM|11:05 PM"


@pytest.mark.parametrize(
    ("seconds", "want"),
    [
        (0, "a few seconds"),
        (44, "a few seconds"),
        (45, "a minute"),
        (89, "a minute"),
        (90, "2 minutes"),
        (44 * 60, "44 minutes"),
        (45 * 60, "an hour"),
        (89 * 60, "an hour"),
        (90 * 60, "2 hours"),
        (21 * 3600, "21 hours"),
        (22 * 3600, "a day"),
        (36 * 3600, "2 days"),
        (25 * 86400, "25 days"),
        (26 * 86400, "a month"),
        (45 * 86400, "a month"),
        (46 * 86400, "2 months"),
        (319 * 86400, "10 months"),
        (320 * 86400, "a year"),
        (547 * 86400, "a year"),
        (548 * 86400, "2 years"),
    ],
)
def test_idle_duration_humanizes_at_moments_thresholds(seconds: int, want: str) -> None:
    assert _m(idle=timedelta(seconds=seconds)).render("{{idle_duration}}") == want
    assert _m(idle=timedelta(seconds=seconds)).render("{{idleDuration}}") == want


def test_idle_duration_with_no_earlier_message_is_just_now() -> None:
    assert _m().render("{{idle_duration}}") == "just now"


def test_a_unicode_look_alike_never_binds_a_feature_macro() -> None:
    """`re.A`: without it the Kelvin sign case-folds onto `k` and the long s onto `s`."""
    m = _m()
    for text in ("{{weeKday}}", "{{iſodate}}", "{{hidden_Key:x}}", "{{reverſe:ab}}"):
        assert m.render(text) == text, text


def test_text_without_a_feature_macro_is_byte_identical() -> None:
    m = _m()
    for text in ("{ random }", "{{randomly}}", "{{timeDiff::a::b}}", "{{{{time}}", "{{ time }}", "{{//"):
        assert m.render(text) == text, text
    # Hostile runs a card can carry stay literal in LINEAR time (both were quadratic in review: an
    # unclosed `{{//` rescanned to the end per opener; a backtracking separator/argument).
    for text in ("{{//" * 50_000, "{{random" + " " * 200_000 + "x", "{{random:" + "x, " * 100_000):
        assert m.render(text) == text


def test_per_turn_in_is_the_cache_warning_predicate() -> None:
    """ONE predicate both importers call: the per-turn names, canonical, sorted — never `pick`,
    `reverse` or a comment, never a macro inside a comment, never a padded (literal) one."""
    from app.services.agent.macros import PER_TURN, per_turn_in, per_turn_note

    assert {"random", "roll", "time", "date", "weekday", "isotime", "isodate", "idle_duration"} <= PER_TURN
    assert not {"pick", "reverse", "comment", "hidden_key", "char", "user", "original"} & PER_TURN
    assert per_turn_in("{{Random:a,b}} {{idleDuration}} {{time_UTC+1}} {{roll:6}}") == [
        "idle_duration",
        "random",
        "roll",
        "time",
    ]
    assert per_turn_in("{{pick:a,b}} {{reverse:x}} {{// {{time}} }} {{//}}{{date}}{{///}} {{ time }}") == []
    assert per_turn_note(["{{pick:a}}", "plain"], ("entry", "entries")) == []
    assert per_turn_note(["{{date}}"], ("field", "fields")) == [
        "1 field uses a per-turn macro ({{date}}) — the prompt cache re-prefills every turn it is active"
    ]
    assert per_turn_note(["{{random:a}}", "x", "{{time}} {{random:b}}"], ("entry", "entries")) == [
        "2 entries use a per-turn macro ({{random}}, {{time}}) — the prompt cache re-prefills every turn "
        "they are active"
    ]


# ── 6. the data model ───────────────────────────────────────────────────────────────────────────


def test_the_new_agent_fields_persist_and_round_trip() -> None:
    import yaml

    fields = {
        "duties": "conversational",
        "greeting": "Hello, traveller.",
        "alt_greetings": ["Oh. You again.", "Mm?"],
        "example_dialogue": "<START>\n{{user}}: hi\n{{char}}: mm.",
        "scenario": "The archive at night.",
        "post_history": "Stay in character.",
        "persona": "patron",
        "avatar": "nyx-portrait",
        "background": "nyx-stacks",
        "voice": "af_nova",
        "lorebooks": ["the-archive"],
    }
    with _workspace() as (tmp, _cfg), _client() as c:
        _agent(c, "nyx", **fields)
        stored = c.get("/api/agents/nyx").json()["agent"]
        for key, value in fields.items():
            assert stored[key] == value, key
        # …and they are on DISK as ordinary agent.yaml keys, not folded into some nested object
        on_disk = yaml.safe_load((tmp / "agents" / "nyx" / "agent.yaml").read_text(encoding="utf-8"))
        assert on_disk["duties"] == "conversational" and on_disk["lorebooks"] == ["the-archive"]
        resolved = c.app.state.settings.resolve_agent("nyx")
        assert resolved.voice == "af_nova"


def test_an_old_agent_yaml_carrying_a_card_stash_still_loads() -> None:
    """R87/RP-8 removed `AgentDef.card` — the provenance moved to the `card.json` sidecar. Files
    written before that (two dev agents, pre-release) keep their `card:` key, and `extra="allow"`
    loads it as an inert extra: the agent resolves, the API serves it, and no prompt changes."""
    with _workspace() as (tmp, _cfg), _client() as c:
        _agent(c, "nyx", title="Nyx")
        _soul(c, "nyx", "You are Nyx.")
        thread = _make_thread(c)
        before = _assemble(c, thread, "nyx")
        (tmp / "agents" / "nyx" / "agent.yaml").write_text(
            "title: Nyx\ncard:\n  creator: someone\n", encoding="utf-8"
        )
        resolved = c.app.state.settings.resolve_agent("nyx")
        assert resolved.title == "Nyx" and (resolved.model_extra or {})["card"] == {"creator": "someone"}
        assert c.get("/api/agents/nyx").status_code == 200
        assert _assemble(c, thread, "nyx") == before


def test_a_bare_agent_defaults_every_new_field() -> None:
    with _workspace(), _client() as c:
        _agent(c, "plain")
        a = c.get("/api/agents/plain").json()["agent"]
        assert a["duties"] == "agent"
        assert a["greeting"] == a["example_dialogue"] == a["scenario"] == a["post_history"] == ""
        assert a["persona"] == a["avatar"] == a["background"] == a["voice"] == ""
        assert a["alt_greetings"] == [] and a["lorebooks"] == [] and "card" not in a


def test_the_fields_later_slices_own_stay_out_of_the_prompt() -> None:
    """`alt_greetings`/avatar/background/voice/lorebooks are STORED and fed to NO prompt — the
    assembled payload is identical with and without them.

    S1 narrowed this: `greeting` and `example_dialogue` were on the list until S1 gave them their
    behaviour (a seeded message and the few-shot pseudo-messages, pinned in `test_roleplay_s1.py`).
    Everything left here belongs to S2–S4, and `voice` never joins a prompt at all — it is read at
    the TTS request, not at assembly."""
    with _workspace(), _client() as c:
        _agent(c, "nyx")
        _soul(c, "nyx", "You are Nyx.")
        thread = _make_thread(c)
        before = _assemble(c, thread, "nyx")
        _agent(
            c,
            "nyx",
            alt_greetings=["Mm?"],
            avatar="nyx-portrait",
            background="nyx-stacks",
            voice="af_nova",
            lorebooks=["the-archive"],
        )
        assert _assemble(c, thread, "nyx") == before


# ── 7. the config section ───────────────────────────────────────────────────────────────────────


def test_roleplay_config_defaults() -> None:
    with _workspace(), _client() as c:
        body = c.get("/api/settings").json()["roleplay"]
        assert body == {
            "enabled": False,
            "default_tools": ["web_search"],
            "personas": {},
            "default_persona": "",
            # S2's additive nested object (§5.3, Emma F8) — the importer's caps. Re-pinned rather
            # than loosened: this arm's whole value is that it enumerates the section, so a field a
            # later slice adds has to be declared here on purpose.
            "card_import": {
                "max_bytes": 15_000_000,
                "max_card_json_bytes": 2_000_000,
                "charx_max_entries": 500,
                "charx_max_entry_bytes": 15_000_000,
                "charx_max_total_bytes": 50_000_000,
            },
        }


def test_roleplay_config_round_trips_through_disk() -> None:
    from app.config import load_settings

    yaml_text = (
        "server:\n  port: 5433\n"
        "roleplay:\n"
        "  enabled: true\n"
        "  default_tools: [web_search, ping_host]\n"
        "  personas:\n"
        "    emma:\n"
        "      name: Emma\n"
        "      description: I run a small homelab.\n"
        "  default_persona: emma\n"
    )
    with _workspace(yaml_text) as (_tmp, cfg), _client() as c:
        s = load_settings(cfg)
        assert s.roleplay.enabled is True
        assert s.roleplay.default_tools == ["web_search", "ping_host"]
        assert s.roleplay.personas["emma"].name == "Emma"
        assert s.roleplay.personas["emma"].description == "I run a small homelab."
        assert s.roleplay.default_persona == "emma"
        # the scalar default rides the ordinary settings PUT through the ruamel round-trip; a
        # dangling slug is legal there (the D75 rule, Emma A-4) — nothing checks it exists
        assert c.put("/api/settings", json={"roleplay": {"default_persona": "nobody"}}).status_code == 200
        assert load_settings(cfg).roleplay.default_persona == "nobody"
        assert load_settings(cfg).roleplay.personas["emma"].name == "Emma"  # the library is untouched
        assert load_settings(cfg).roleplay.enabled is True  # untouched siblings survive


def test_a_bad_roleplay_value_is_refused() -> None:
    with _workspace(), _client() as c:
        assert c.put("/api/settings", json={"roleplay": {"default_tools": 5}}).status_code == 422
        assert (
            c.put("/api/settings", json={"roleplay": {"personas": {"emma": {"name": []}}}}).status_code == 422
        )
        # a library key is a slug (D78) — it rides a URL path and an agent.yaml value
        assert c.put("/api/settings", json={"roleplay": {"personas": {"Not A Slug": {}}}}).status_code == 422


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
