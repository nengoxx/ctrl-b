"""D84 / CONVERSATIONS_PLAN Phase 27 S4 — ISS-50: another agent's turns read as DIALOGUE.

After `/agent emma` in Lynette's conversation, Emma's model used to read Lynette's lines as her own
assistant turns. `AgentSession._assemble` now folds each maximal RUN of owner `user` rows and FOREIGN
text-only rows (an assistant row whose `agent` is set and is not the answering agent) into ONE `user`
message — `Name: <text>` for a foreign member, the owner's text unprefixed, members separated by a
blank line (§8, the ON2 fold). A foreign row with tool calls stays an assistant `tool_calls` row and
bounds the runs around it; `agent IS NULL` is the conversation's own; the display name is the agent's
`title`, else its slug (a vanished agent → its slug).

Pinned here, one test per §10 S4 verify item, plus the byte-identical single-agent invariant (the
baseline J3 builds on, §12.1 ⑨) and strict user/assistant alternation for every history under test.

Config/db go to a temp `CTRLB_HOME` (the shared `home` fixture) — never the operator's real config.
"""

from __future__ import annotations

from pathlib import Path

from _async import run_async
from test_attachment_feed_d68 import _attach
from test_media_g5 import home, make_client, png_bytes

from app.adapters.inference import normalize_system_messages
from app.domain.conversation import (
    ErrorPart,
    Message,
    ReasoningPart,
    Role,
    TextPart,
    Thread,
    ToolCallPart,
    ToolResultPart,
)
from app.domain.enums import Actor, RunState
from app.domain.result import ToolResult
from app.services.agent.compaction import SUMMARY_PREFIX
from app.services.agent.session import _tool_content

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe


# ── harness ───────────────────────────────────────────────────────────────────────────────────────


def _agent_folder(home: Path, name: str, yaml: str = "") -> None:
    folder = home / "agents" / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "agent.yaml").write_text(yaml or "description: test agent\n", encoding="utf-8")


def _roster(home: Path) -> None:
    """Lynette (titled) is the conversation's home; Emma (untitled) answers after `/agent emma`."""
    _agent_folder(home, "lynette", "title: Lynette\n")
    _agent_folder(home, "emma")


def _thread(c, agent: str | None = "lynette") -> Thread:
    return run_async(c.app.state.threads.create(Thread(agent=agent)))


def _add(
    c,
    thread: Thread,
    role: Role,
    *parts,
    agent: str | None = None,
    actor: Actor | None = None,
    compacted: bool = False,
) -> Message:
    body = [TextPart(text=p) if isinstance(p, str) else p for p in parts]
    m = Message(
        thread_id=thread.id,
        role=role,
        parts=body,
        agent=agent,
        actor=actor or Actor.USER,
        compacted=compacted,
    )
    run_async(c.app.state.messages.add(m))
    return m


def _user(c, thread: Thread, *parts) -> Message:
    return _add(c, thread, "user", *parts)


def _said(c, thread: Thread, agent: str | None, *parts) -> Message:
    return _add(c, thread, "assistant", *parts, agent=agent, actor=Actor.AGENT)


def _session(c, responder: str | None):
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, s.settings.resolve_agent(responder)
    )


def _assembled(c, thread: Thread, responder: str | None = "emma") -> tuple[list[dict], list[dict]]:
    """`(the whole assembled payload, the part AFTER the static head — the part the fold owns)`, with
    alternation checked on every call: no two consecutive messages share a role (a call's `tool`
    results excepted).

    This is the PRE-normalization alternation, which is what S4 guarantees. On the wire,
    `normalize_system_messages` re-roles every later system line — the D68 dimensions notice, the tail
    lorebook block, the post-history instructions, the reflection nudge, the example messages — into a
    `user` message in place, so `user · <system-update>` can still sit back to back there. That is
    pre-existing (the singleton notice shape predates the fold) and the wire shape is J3's (the
    prompt-order session), not S4's; S4 only promises the fold never ADDS to it (one notice line per
    run — see the two-image test)."""
    session = _session(c, responder)
    out = run_async(session._assemble(thread))
    head = session._static_prefix()
    assert out[: len(head)] == head
    tail = out[len(head) :]
    for a, b in zip(tail, tail[1:], strict=False):
        assert a["role"] != b["role"] or a["role"] == "tool", f"two {a['role']} messages in a row: {tail}"
    return out, tail


def _history(c, thread: Thread, responder: str | None = "emma") -> list[dict]:
    return _assembled(c, thread, responder)[1]


def _u(content) -> dict:
    return {"role": "user", "content": content}


def _a(content: str) -> dict:
    return {"role": "assistant", "content": content}


# ── the fold (§8, ON2) ────────────────────────────────────────────────────────────────────────────


def test_B1_owner_foreign_owner_is_ONE_user_turn_then_the_responders_reply(home: Path) -> None:
    """B1's `[user] [Lynette] [user]`: the run reads as dialogue inside the owner's turn."""
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _user(c, t, "hi Lynette")
        _said(c, t, "lynette", "Hello, traveller.")
        _user(c, t, "Emma, what do you think?")
        _said(c, t, "emma", "I think she's right.")
        assert _history(c, t) == [
            _u("hi Lynette\n\nLynette: Hello, traveller.\n\nEmma, what do you think?"),
            _a("I think she's right."),
        ]


def test_a_foreign_row_right_before_the_responders_reply_folds_into_the_preceding_run(home: Path) -> None:
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _said(c, t, "lynette", "Welcome.")  # the home's greeting opens the run too
        _user(c, t, "tell me a story")
        _said(c, t, "lynette", "Once upon a time…")
        _said(c, t, "emma", "Let me continue it.")
        assert _history(c, t) == [
            _u("Lynette: Welcome.\n\ntell me a story\n\nLynette: Once upon a time…"),
            _a("Let me continue it."),
        ]


def test_a_foreign_row_at_the_TAIL_folds_into_the_tail_run(home: Path) -> None:
    """The last row before the new turn is foreign — it joins the owner's pending turn, so the
    payload still ends on a `user` message for the responder to answer."""
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _user(c, t, "first")
        _said(c, t, "emma", "reply one")
        _user(c, t, "second")
        _said(c, t, "lynette", "I'll take this one.")
        assert _history(c, t) == [
            _u("first"),
            _a("reply one"),
            _u("second\n\nLynette: I'll take this one."),
        ]


def test_an_owner_owner_run_from_a_failed_turn_merges(home: Path) -> None:
    """A send whose turn failed before any assistant row — and one whose reply persisted only an
    error (an assistant row that emits nothing) — leaves two owner rows back to back; they merge."""
    _roster(home)
    with make_client() as c:
        t = _thread(c, agent=None)
        _user(c, t, "are you there?")
        _user(c, t, "hello?")
        _said(c, t, "default", ErrorPart(message="upstream 502", retryable=True))
        _user(c, t, "third time")
        _said(c, t, "default", "Sorry — here now.")
        assert _history(c, t, responder=None) == [
            _u("are you there?\n\nhello?\n\nthird time"),
            _a("Sorry — here now."),
        ]


def test_an_image_in_a_run_keeps_its_part_in_member_order(home: Path) -> None:
    """D68's part array, merged: the text parts and the owner's image parts in member order, adjacent
    text coalesced (blank-line joined); the dimensions notice follows the merged turn."""
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _user(c, t, "before")
        _user(c, t, "look", _attach(home, t.id, "photo.png", png_bytes(12, 8)))
        _said(c, t, "lynette", "Pretty.")
        _user(c, t, "Emma?")
        _said(c, t, "emma", "Lovely light.")
        tail = _history(c, t)
        merged, notice = tail[0], tail[1]
        assert merged["role"] == "user"
        parts = merged["content"]
        assert [p["type"] for p in parts] == ["text", "image_url", "text"]
        assert parts[0] == {"type": "text", "text": "before\n\nlook"}
        assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
        assert parts[2] == {"type": "text", "text": "Lynette: Pretty.\n\nEmma?"}
        assert notice == {
            "role": "system",
            "content": "Attached images, as sent (pixel dimensions): photo.png: 12×8",
        }
        assert tail[2:] == [_a("Lovely light.")]


def test_a_foreign_tool_call_row_keeps_its_pairing_and_bounds_the_runs(home: Path) -> None:
    """Recorded, not renamed: Lynette's call stays an assistant `tool_calls` row with its `tool` result
    right after it (API validity), and the runs on either side of it stay separate."""
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _user(c, t, "check the fleet")
        _said(
            c, t, "lynette", "Checking.", ToolCallPart(call_id="c1", tool="fleet_status", state=RunState.OK)
        )
        _add(
            c,
            t,
            "tool",
            ToolResultPart(call_id="c1", result=ToolResult(state=RunState.OK, summary="all up")),
            actor=Actor.AGENT,
        )
        _said(c, t, "lynette", "All hosts are up.")
        _user(c, t, "thanks — Emma, anything to add?")
        _said(c, t, "emma", "Nothing to add.")
        tail = _history(c, t)
        assert tail[0] == _u("check the fleet")
        call = tail[1]
        assert call["role"] == "assistant" and call["content"] == "Checking."  # not prefixed
        assert [tc["id"] for tc in call["tool_calls"]] == ["c1"]
        assert tail[2]["role"] == "tool" and tail[2]["tool_call_id"] == "c1"
        assert tail[3:] == [
            _u("Lynette: All hosts are up.\n\nthanks — Emma, anything to add?"),
            _a("Nothing to add."),
        ]


def test_agent_NULL_is_the_conversations_own_never_folded(home: Path) -> None:
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _user(c, t, "hello")
        _said(c, t, None, "a legacy reply")
        _user(c, t, "and now?")
        assert _history(c, t) == [_u("hello"), _a("a legacy reply"), _u("and now?")]


def test_display_name_is_the_title_else_the_slug_and_a_vanished_agent_reads_as_its_slug(home: Path) -> None:
    _roster(home)
    _agent_folder(home, "nyx")  # on the roster, no title → slug
    _agent_folder(home, "broken", "model: [not, a, model]\n")  # unloadable → slug, never a failed turn
    with make_client() as c:
        t = _thread(c)
        _said(c, t, "lynette", "titled")
        _said(c, t, "nyx", "untitled")
        _said(c, t, "ghost", "deleted")  # no folder any more
        _said(c, t, "broken", "malformed")
        _user(c, t, "everyone spoke")
        assert _history(c, t) == [
            _u("Lynette: titled\n\nnyx: untitled\n\nghost: deleted\n\nbroken: malformed\n\neveryone spoke")
        ]


def test_a_foreign_error_only_or_reasoning_only_row_inside_a_run_is_transparent(home: Path) -> None:
    """A foreign row that carries no text (its turn failed, or only its scratchpad persisted) emits
    nothing — it neither joins the run nor breaks it."""
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _user(c, t, "hi Lynette")
        _said(c, t, "lynette", ErrorPart(message="upstream 502", retryable=True))
        _user(c, t, "still there?")
        _said(c, t, "lynette", ReasoningPart(text="she asked twice"))
        _said(c, t, "lynette", "Sorry — here.")
        _user(c, t, "Emma?")
        _said(c, t, "emma", "Here too.")
        assert _history(c, t) == [
            _u("hi Lynette\n\nstill there?\n\nLynette: Sorry — here.\n\nEmma?"),
            _a("Here too."),
        ]


def test_a_run_right_after_the_compaction_head_folds_after_the_summary(home: Path) -> None:
    """The persisted compaction summary is the only system row today and sorts to the head; the run
    that follows it is folded as usual and is not merged into it."""
    _roster(home)
    with make_client() as c:
        t = _thread(c)
        _add(c, t, "user", "long ago", compacted=True)
        _add(c, t, "assistant", "older", agent="lynette", actor=Actor.AGENT, compacted=True)
        summary = f"{SUMMARY_PREFIX}The owner and Lynette talked about the fleet."
        _add(c, t, "system", summary, actor=Actor.AGENT)
        _said(c, t, "lynette", "Where were we?")
        _user(c, t, "the fleet")
        _said(c, t, "emma", "All hosts are up.")
        tail = _history(c, t)
        assert tail[0] == {"role": "system", "content": summary}
        assert tail[1:] == [_u("Lynette: Where were we?\n\nthe fleet"), _a("All hosts are up.")]


def test_three_adjacent_owner_image_rows_under_the_ceiling_are_ONE_mixed_part_array(home: Path) -> None:
    """The ceiling still degrades the OLDEST image first (§4.1, council E5) — its member becomes the
    §4.5 stub inside the text — and the survivors keep their parts in member order; the notice names
    only what was sent, on ONE line after the merged turn."""
    _roster(home)
    with make_client() as c:
        c.app.state.settings.attachments.max_images_per_request = 2
        t = _thread(c, agent=None)
        for n in (1, 2, 3):
            _user(c, t, f"turn {n}", _attach(home, t.id, f"p{n}.png", png_bytes(n, n)))
        _said(c, t, "default", "Three pictures.")
        tail = _history(c, t, responder=None)
        assert [m["role"] for m in tail] == ["user", "system", "assistant"]
        parts = tail[0]["content"]
        assert [p["type"] for p in parts] == ["text", "image_url", "text", "image_url"]
        first = parts[0]["text"]
        assert first.startswith('turn 1\n\n[image "p1.png", 1×1 was attached earlier')
        assert first.endswith("\n\nturn 2")
        assert parts[2] == {"type": "text", "text": "turn 3"}
        assert all(p["image_url"]["url"].startswith("data:image/png;base64,") for p in parts[1::2])
        assert tail[1] == {
            "role": "system",
            "content": "Attached images, as sent (pixel dimensions): p2.png: 2×2\n"
            "Attached images, as sent (pixel dimensions): p3.png: 3×3",
        }
        assert tail[2] == _a("Three pictures.")


def test_a_run_of_two_image_turns_emits_ONE_notice_line_the_singleton_wire_shape(home: Path) -> None:
    """Regression (S4 review, Sol F1): one notice line PER MEMBER would re-role, through the real
    wire normalizer, into `user · user · user`. The run's notices ride ONE system line, so the
    multi-member wire shape is exactly the pre-existing single-image turn's (`user · user` — the
    re-roled notice — then the reply), never longer."""
    _roster(home)
    with make_client() as c:
        two = _thread(c, agent=None)
        _user(c, two, "first", _attach(home, two.id, "a.png", png_bytes(5, 4)))
        _user(c, two, "second", _attach(home, two.id, "b.png", png_bytes(7, 6)))
        _said(c, two, "default", "Two pictures.")
        out, tail = _assembled(c, two, responder=None)
        notices = [m for m in tail if m["role"] == "system"]
        assert notices == [
            {
                "role": "system",
                "content": "Attached images, as sent (pixel dimensions): a.png: 5×4\n"
                "Attached images, as sent (pixel dimensions): b.png: 7×6",
            }
        ]
        assert tail.index(notices[0]) == 1  # right after the merged turn

        one = _thread(c, agent=None)
        _user(c, one, "only", _attach(home, one.id, "c.png", png_bytes(3, 3)))
        _said(c, one, "default", "One picture.")
        single, _ = _assembled(c, one, responder=None)

        def wire_roles(payload: list[dict]) -> list[str]:
            return [m["role"] for m in normalize_system_messages(payload)]

        assert wire_roles(out) == wire_roles(single) == ["system", "user", "user", "assistant"]
        wire = normalize_system_messages(out)
        assert sum("<system-update>" in str(m["content"]) for m in wire) == 1
        assert "a.png: 5×4" in wire[2]["content"] and "b.png: 7×6" in wire[2]["content"]


# ── the invariant (§12.1 ⑨ — J3's baseline) ───────────────────────────────────────────────────────


def test_a_single_agent_history_assembles_BYTE_IDENTICAL_to_before_the_fold(home: Path) -> None:
    """No adjacent owner rows, no foreign rows: every run has ONE member, and `_fold_run` emits it
    exactly as the pre-fold loop did. The expected list is built by hand from the pre-fold rules —
    a plain user string, an image turn's part array + its notice right after it, the assistant text,
    a tool call with its result, a legacy NULL row — and compared with `==` on the whole payload.
    The default agent answers, so no roster lookup happens at all."""
    _roster(home)
    with make_client() as c:
        t = _thread(c, agent=None)
        _user(c, t, "hello")
        _said(c, t, "default", "hi there")
        _user(c, t, "status?")
        _said(c, t, "default", ToolCallPart(call_id="c9", tool="fleet_status", state=RunState.OK))
        _add(
            c,
            t,
            "tool",
            ToolResultPart(call_id="c9", result=ToolResult(state=RunState.OK, summary="all up")),
            actor=Actor.AGENT,
        )
        _said(c, t, "default", "All up.")
        _user(c, t, "look", _attach(home, t.id, "photo.png", png_bytes(4, 3)))
        _said(c, t, None, "a legacy reply")
        _user(c, t, "bye")

        session = _session(c, None)
        out = run_async(session._assemble(t))
        tail = out[len(session._static_prefix()) :]
        image = tail[6]["content"][1]
        assert image["type"] == "image_url"
        assert tail == [
            _u("hello"),
            _a("hi there"),
            _u("status?"),
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {"id": "c9", "type": "function", "function": {"name": "fleet_status", "arguments": "{}"}}
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "c9",
                "content": _tool_content(ToolResult(state=RunState.OK, summary="all up")),
            },
            _a("All up."),
            _u([{"type": "text", "text": "look"}, image]),
            {"role": "system", "content": "Attached images, as sent (pixel dimensions): photo.png: 4×3"},
            _a("a legacy reply"),
            _u("bye"),
        ]
        assert all(isinstance(m["content"], str) for i, m in enumerate(tail) if i not in (3, 6))
