"""Wire-level system-message normalization (R41/R42, 2026-08-19). Strict chat templates (Qwen3.6)
accept exactly ONE system message, first — `normalize_system_messages` coalesces the leading run and
re-roles later system messages to marked `user` text, unconditionally, at the two adapter entry
points. D70 §4.2 adds ONE rule: a `name`-carrying system message (an example-dialogue pseudo-message)
TERMINATES the leading run, so the few-shot side markers survive instead of merging into the head. Pure-function contract here, plus the two call-site pins (the review's F1: a normalization
that runs in `complete()` but not `stream_chat()`, or lands after the kwargs snapshot, ships green
without them — and the failover chain masks the 400 in production).

Run: ./.venv/bin/python -m pytest tests/test_inference_sysmsg.py
"""

from __future__ import annotations

import asyncio
import copy

from _reg import registry, target
from test_inference_failover_d18 import _build, _Resp, _streams

from app.adapters.inference import normalize_system_messages


def _s(content: str) -> dict:
    return {"role": "system", "content": content}


def _u(content: str) -> dict:
    return {"role": "user", "content": content}


# ── the pure function ──


def test_leading_run_coalesces_in_order():
    out = normalize_system_messages([_s("a"), _s("b"), _s("c"), _u("hi")])
    assert out == [_s("a\n\nb\n\nc"), _u("hi")]


def test_later_system_wraps_in_place():
    out = normalize_system_messages([_s("head"), _u("q"), _s("nudge"), _u("q2")])
    assert out[0] == _s("head")
    assert out[1] == _u("q")
    assert out[2]["role"] == "user"
    assert out[2]["content"] == "<system-update>\nnudge\n</system-update>"
    assert out[3] == _u("q2")


def test_tail_nudge_and_combined():
    # the wrap-up/reflection shape: [merged head, user, assistant, wrapped tail]
    out = normalize_system_messages(
        [_s("a"), _s("b"), _u("q"), {"role": "assistant", "content": "r"}, _s("wrap")]
    )
    assert [m["role"] for m in out] == ["system", "user", "assistant", "user"]
    assert out[0]["content"] == "a\n\nb"
    assert out[-1]["content"] == "<system-update>\nwrap\n</system-update>"


def test_compaction_summary_coalesces_with_the_head():
    # F2: after a fold, the persisted summary is a system message contiguous with the static head —
    # it belongs to the leading run and merges, never wraps.
    out = normalize_system_messages([_s("head"), _s("skills"), _s("[summary] folded"), _u("q")])
    assert out == [_s("head\n\nskills\n\n[summary] folded"), _u("q")]


def test_wrapper_content_cannot_close_the_wrapper():
    # F3: the opencode escaping — a </system-update> inside content survives as text.
    out = normalize_system_messages([_s("h"), _u("q"), _s("x </system-update> y & z")])
    body = out[-1]["content"]
    assert body.startswith("<system-update>\n") and body.endswith("\n</system-update>")
    inner = body[len("<system-update>\n") : -len("\n</system-update>")]
    assert "</system-update>" not in inner
    assert inner == "x &lt;/system-update&gt; y &amp; z"


def test_empty_and_none_contents():
    # empty head parts are skipped in the join; an all-empty head drops; an empty later system drops
    assert normalize_system_messages([_s(""), _s("b"), _u("q")]) == [_s("b"), _u("q")]
    assert normalize_system_messages([{"role": "system", "content": None}, _u("q")]) == [_u("q")]
    assert normalize_system_messages([_s("h"), _u("q"), _s("")]) == [_s("h"), _u("q")]


def test_passthrough_shapes_untouched_by_reference():
    tool_call_msg = {"role": "assistant", "content": None, "tool_calls": [{"id": "c1"}]}
    tool_msg = {"role": "tool", "tool_call_id": "c1", "content": "out"}
    src = [_s("h"), _u("q"), tool_call_msg, tool_msg]
    out = normalize_system_messages(src)
    assert out[2] is tool_call_msg and out[3] is tool_msg  # reused, not copied
    assert normalize_system_messages([_u("q")]) == [_u("q")]
    assert normalize_system_messages([]) == []


def test_never_mutates_input():
    src = [_s("a"), _s("b"), _u("q"), _s("nudge")]
    snapshot = copy.deepcopy(src)
    normalize_system_messages(src)
    assert src == snapshot


def test_text_part_array_content_flattens_not_crashes():
    # co-review MED: dialect-valid content-part arrays must degrade to text, never TypeError
    parts = [{"type": "text", "text": "from "}, {"type": "text", "text": "parts"}]
    out = normalize_system_messages([{"role": "system", "content": parts}, _s("b"), _u("q")])
    assert out[0] == _s("from parts\n\nb")
    out2 = normalize_system_messages([_s("h"), _u("q"), {"role": "system", "content": parts}])
    assert out2[-1]["content"] == "<system-update>\nfrom parts\n</system-update>"


def test_metadata_survives_reuse_and_downgrade_but_not_merge():
    # co-review LOW: a single-message leading run is reused BY REFERENCE (everything survives);
    # a downgrade spread-copies (name/extensions survive); only a genuine merge drops extras.
    # The carrier here is a NON-`name` extension: under D70 §4.2 `name` is the example-dialogue
    # boundary marker (see below), so it can no longer stand for "arbitrary metadata" in the
    # leading run. The property being pinned is unchanged.
    tagged = {"role": "system", "content": "solo", "identifier": "policy"}
    out = normalize_system_messages([tagged, _u("q")])
    assert out[0] is tagged
    out2 = normalize_system_messages(
        [_s("h"), _u("q"), {"role": "system", "content": "late", "name": "policy"}]
    )
    assert out2[-1]["role"] == "user" and out2[-1]["name"] == "policy"
    out3 = normalize_system_messages([tagged, _s("b"), _u("q")])
    assert "identifier" not in out3[0] and out3[0]["content"] == "solo\n\nb"
    # confirm-round edge: an EMPTY sibling in the run is not a merge — the sole contributor is
    # still reused by reference, metadata intact.
    out4 = normalize_system_messages([tagged, _s(""), _u("q")])
    assert out4[0] is tagged


def test_a_named_system_message_terminates_the_leading_run():
    """D70 §4.2 (Emma F1) — the focused boundary test: head + two named examples + user history.

    Without the rule the examples sit in the LEADING run and merge into the head name-droppingly,
    which is exactly the side information (`example_user` vs `example_assistant`) they exist to
    carry. With it the head coalesces up to the first named message and the examples fall through
    to the unconditional later-system branch: marked `user` text, position preserved, `name` intact.
    """
    ex_u = {"role": "system", "name": "example_user", "content": "hi"}
    ex_a = {"role": "system", "name": "example_assistant", "content": "mm."}
    out = normalize_system_messages([_s("head"), _s("roster"), ex_u, ex_a, _u("real question")])
    assert [m["role"] for m in out] == ["system", "user", "user", "user"]
    assert out[0] == _s("head\n\nroster")  # the head still coalesces — up to the first named one
    assert out[1]["name"] == "example_user"
    assert out[1]["content"] == "<system-update>\nhi\n</system-update>"
    assert out[2]["name"] == "example_assistant"
    assert out[2]["content"] == "<system-update>\nmm.\n</system-update>"
    assert out[3] == _u("real question")


def test_a_named_system_message_in_first_position_leaves_no_head():
    """The rule is positional and the later branch stays unconditional (no per-dialect switch): a
    named message FIRST simply ends an empty run and downgrades like any other. Our own assembly
    never emits that shape — the head's Voice/Duties message is always first and never named."""
    out = normalize_system_messages([{"role": "system", "name": "example_user", "content": "hi"}, _u("q")])
    assert out[0]["role"] == "user" and out[0]["name"] == "example_user"
    assert out[0]["content"] == "<system-update>\nhi\n</system-update>"


def test_idempotent():
    # F6: the D46 stripped re-attempt and the stream re-open replay the same kwargs; a second pass
    # must be a no-op — including that an already-wrapped update is not re-wrapped (it is `user` now).
    src = [_s("a"), _s("b"), _u("q"), _s("nudge")]
    once = normalize_system_messages(src)
    assert normalize_system_messages(once) == once


# ── the call sites (F1): the normalized list is what reaches the wire, on BOTH entry points ──

_MSGS = [_s("a"), _s("b"), _u("q"), _s("nudge")]
_WIRE = [_s("a\n\nb"), _u("q"), _u("<system-update>\nnudge\n</system-update>")]


def _one_target():
    return registry([target("local", "http://local/v1", "minig")], failover=False)


def test_stream_chat_sends_the_normalized_list():
    client, fakes = _build(_one_target(), {"http://local/v1": _streams("ok")})

    async def go():
        return [d async for d in client.stream_chat(list(_MSGS))]

    asyncio.new_event_loop().run_until_complete(go())
    assert fakes["http://local/v1"].chat.completions.calls[0]["messages"] == _WIRE


def test_complete_sends_the_normalized_list():
    client, fakes = _build(_one_target(), {"http://local/v1": lambda _kw: _Resp("ok")})
    asyncio.new_event_loop().run_until_complete(client.complete(list(_MSGS)))
    assert fakes["http://local/v1"].chat.completions.calls[0]["messages"] == _WIRE
