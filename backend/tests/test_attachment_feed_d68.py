"""D68 / ATTACHMENTS_PLAN S2 — the model feed: what an attachment actually costs, looks like, and
survives as, on its way to a model.

The §9-S2 obligation list, one test each: the assembly branch (images as `image_url` parts, text
files injected as D64-framed tool OUTPUT, the dimensions notice) · the per-turn read cache (council
E5) · the per-request image ceiling degrading OLDEST-first + `resend: false` · the estimator arm
(H3 — priced from the persisted facts at READ, off the live knobs) · the per-hop modality strip with
the **two-hop test in BOTH capability directions** (§5's pin) · `read_attachment` + the server-owned
`InvocationContext.thread_id` (fail-closed, name-addressed, paged, manifest-on-no-name) · the
compaction manifest + the summarizer instruction that preserves the names.

S4 turns the PDF arms real: the fixtures here are parseable documents (`pdf_with_text`, borrowed from
the store suite rather than restated), so "a PDF is injected/paged/priced like a text file" is now
proven from the CLAIM's own extraction rather than from a hand-planted sidecar — and the two "no
text" shapes it introduced (a document nothing could be read out of, and a sidecar that is gone) are
pinned as the honest one-liner and the §4.5 stub respectively.

And the no-regression half, which matters as much: a thread with no attachments assembles to plain
STRING content with no extra lines, and an image-free payload is handed to the wire as the very same
list object it arrived as.

Config/db go to a temp `CTRLB_HOME`/`CTRLB_CONFIG`/`CTRLB_DB` (the shared `home` fixture) — never the
operator's real config.yaml. Image fixtures are HEADER BYTES (the `test_media_g5` convention).
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from _async import run_async
from _reg import registry, target
from test_attachments_d68 import bounds, pdf_with_text
from test_media_g5 import home, make_client, png_bytes

from app.adapters.inference import IMAGE_PART_NAME_KEY, image_part
from app.config import AttachmentsCfg
from app.core.attachments import (
    NO_TEXT_SIDECAR,
    claim,
    mint_id,
    prepare_staging,
    sidecar_name,
    staged_name,
    thread_dir,
)
from app.domain.conversation import AttachmentPart, Message, TextPart, Thread
from app.domain.event import ORIGIN_USER_CHAT
from app.services.agent.attachments import ATTACHMENT_ONLY_TEXT, priced_inline_chars
from app.services.agent.compaction import _render_transcript, estimate_tokens

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe


# ── harness ───────────────────────────────────────────────────────────────────────────────────────


def _attach(home: Path, thread_id: str, name: str, body: bytes) -> AttachmentPart:
    """Land one file in a thread the way a send does — stage the bytes, then CLAIM them — so every
    part under test is a server-built one describing bytes that are really on disk."""
    staging = prepare_staging(home)
    aid = mint_id()
    (staging / staged_name(aid, name)).write_bytes(body)
    return claim(home, thread_id, aid, max_age_s=3600, pdf_bounds=bounds())


def _thread(c) -> Thread:
    return run_async(c.app.state.threads.create(Thread()))


def _say(c, thread: Thread, text: str = "", *parts: AttachmentPart, role: str = "user") -> Message:
    """Persist one message with `text` (omitted entirely when blank — the attachment-only shape)."""
    body: list = [TextPart(text=text)] if text else []
    body += list(parts)
    m = Message(thread_id=thread.id, role=role, parts=body)
    run_async(c.app.state.messages.add(m))
    return m


def _session(c):
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads, s.messages, s.inference, s.settings, s.actions, s.settings.resolve_agent(None)
    )


def _assemble(c, thread: Thread, session=None) -> list[dict]:
    return run_async((session or _session(c))._assemble(thread))


def _user_turns(messages: list[dict]) -> list[dict]:
    return [m for m in messages if m["role"] == "user"]


def _invoke(c, thread_id: str | None, **args):
    """Run `read_attachment` through the real `ActionService` — which is also the pin that
    `thread_id` is a first-class invoke parameter (D68 §4.4), not something the tool reads elsewhere."""
    outcome = run_async(
        c.app.state.actions.invoke("read_attachment", args, origin=ORIGIN_USER_CHAT, thread_id=thread_id)
    )
    assert outcome.result is not None
    return outcome.result


TEXT = b"".join(f"line {i}\n".encode() for i in range(1, 401))  # 400 lines, ~2.8 KB


# ── A. the assembly branch (§4.1/§4.2/§4.5) ───────────────────────────────────────────────────────


def test_a_thread_with_NO_attachments_assembles_exactly_as_before(home: Path) -> None:
    """The no-regression pin: every content stays a plain STRING and nothing new is appended, so an
    existing thread's prompt — and the prefix cache built on it — is untouched by this slice."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "hello")
        _say(c, thread, "hi there", role="assistant")
        messages = _assemble(c, thread)
        assert all(isinstance(m["content"], str) for m in messages)
        assert messages[-2:] == [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]


def test_an_image_rides_as_an_image_url_part_beside_the_text(home: Path) -> None:
    """§4.1: the ONE place content stops being a string — the OpenAI parts list, text first."""
    with make_client() as c:
        thread = _thread(c)
        photo = _attach(home, thread.id, "photo.png", png_bytes(12, 8))
        _say(c, thread, "look at this", photo)
        turn = _user_turns(_assemble(c, thread))[0]
        assert turn["content"][0] == {"type": "text", "text": "look at this"}
        part = turn["content"][1]
        assert part["type"] == "image_url"
        expected = base64.b64encode(png_bytes(12, 8)).decode()
        assert part["image_url"]["url"] == f"data:image/png;base64,{expected}"


def test_the_dimensions_notice_states_what_was_actually_SENT(home: Path) -> None:
    """The main-seat amendment of §4.1's resize notice: the server never holds the pre-upload
    original (the client downscales first) and `AttachmentPart` is facts-only, so the notice names the
    STORED dimensions — grounding the model's pixel reasoning in something we actually know."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "look", _attach(home, thread.id, "photo.png", png_bytes(1600, 1200)))
        messages = _assemble(c, thread)
        assert messages[-1] == {
            "role": "system",
            "content": "Attached images, as sent (pixel dimensions): photo.png: 1600×1200",
        }


def test_a_text_file_is_INJECTED_as_tool_output_not_as_prose(home: Path) -> None:
    """§4.2 (council O-M7): the D64 marker convention — output framing, never a narrated call."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "read this", _attach(home, thread.id, "notes.txt", b"alpha\nbeta\n"))
        turn = _user_turns(_assemble(c, thread))[0]
        assert isinstance(turn["content"], str)  # no images ⇒ still a plain string
        assert 'read_attachment("notes.txt") → lines 1–2 of 2:\nalpha\nbeta\n' in turn["content"]
        assert "called" not in turn["content"].lower()


def test_a_TRUNCATED_text_file_names_the_call_that_continues_it(home: Path) -> None:
    """The owner's ratification condition (§0b-3/§0b-4): the cap is always visible AND reachable."""
    with make_client() as c:
        c.app.state.settings.attachments.max_inline_chars = 40
        thread = _thread(c)
        _say(c, thread, "read this", _attach(home, thread.id, "notes.txt", TEXT))
        body = _user_turns(_assemble(c, thread))[0]["content"]
        assert 'read_attachment("notes.txt") → lines 1–5 of 400; continue from offset 6:' in body
        assert "line 6" not in body


def test_an_OVERSIZED_SINGLE_LINE_is_CUT_at_the_cap_and_priced_as_it_is_sent(home: Path) -> None:
    """S2 MED-1: D64 emits an over-budget line WHOLE, which made `max_inline_chars` advisory — one
    minified `.json` put its whole self in the prompt while the estimator priced the cap. The line is
    cut now, and the two halves of that regression are pinned together: what assembly EMITS is bounded
    by the cap, and what the estimator PRICES is within the frame's own length of it (before the fix
    the residual was the entire file)."""
    cap = 1000
    with make_client() as c:
        c.app.state.settings.attachments.max_inline_chars = cap
        thread = _thread(c)
        part = _attach(home, thread.id, "min.json", b"x" * 50_000 + b"\n")
        _say(c, thread, "read this", part)
        body = _user_turns(_assemble(c, thread))[0]["content"]
        block = body.split("\n\n", 1)[1]  # the caption, then the file's framed block
        marker, page = block.split("\n", 1)

        assert len(page) == cap and "x" * (cap + 1) not in page  # the cap is a BOUND, not a hint
        assert "line 1 is longer than one page" in marker and "first 1,000 characters are shown" in marker
        priced = priced_inline_chars(part, c.app.state.settings.attachments)
        # CONSERVATIVE again (S2 confirm LOW): the price COVERS the emitted block — `_marker_cost`
        # renders the marker's longest form (cut clause + continuation), so the residual is the
        # frame's unused clauses plus digit-width noise, on the over side, never the file.
        assert 0 <= priced - len(block) <= 128


def test_an_oversized_FIRST_line_ENDS_the_page_and_the_continuation_names_LINE_2(home: Path) -> None:
    """Nothing may follow a line the model only half saw — so the page stops at the cut, and the
    continuation names the NEXT line, because the rest of the cut line is unreachable (no offset
    starts mid-line) and the marker must not pretend otherwise."""
    with make_client() as c:
        c.app.state.settings.attachments.max_inline_chars = 40
        thread = _thread(c)
        _say(c, thread, "read", _attach(home, thread.id, "min.json", b"x" * 100 + b"\nsecond line\n"))
        body = _user_turns(_assemble(c, thread))[0]["content"]
        assert "lines 1–1 of 2 (line 1 is longer than one page" in body
        assert "; continue from offset 2:" in body
        assert "second line" not in body


def test_a_PDF_renders_the_stub_that_names_the_read_call(home: Path) -> None:
    """The stub is what a PDF with NO sidecar on disk renders as. Since S4 that is the crash-window
    shape rather than the ordinary one — the claim writes a sidecar for every PDF, including one it
    could not read a word of — so the case is reached the way it really happens: the file is gone."""
    with make_client() as c:
        thread = _thread(c)
        pdf = _attach(home, thread.id, "report.pdf", pdf_with_text([["some text"]]))
        (thread_dir(home, thread.id) / sidecar_name(pdf.name)).unlink()
        _say(c, thread, "see", pdf)
        body = _user_turns(_assemble(c, thread))[0]["content"]
        assert 'pdf attachment "report.pdf"' in body
        assert 'call read_attachment("report.pdf") to read it' in body


def test_a_CLAIMED_pdf_is_INJECTED_with_the_text_the_claim_extracted(home: Path) -> None:
    """S4 end to end through the feed: the claim extracted the text, and the §4.2 branch that was
    written for text files inlines it with no PDF arm of its own — once the sidecar exists it IS a
    text file, which is the whole reason S2 could ship the reader a slice early.

    Under the PDF's OWN name (S2 MED-2): the page is READ from `report.pdf.txt` and is ABOUT
    `report.pdf`, and only the latter is a name this conversation holds."""
    with make_client() as c:
        thread = _thread(c)
        pdf = _attach(home, thread.id, "report.pdf", pdf_with_text([["extracted body"]]))
        _say(c, thread, "see", pdf)
        body = _user_turns(_assemble(c, thread))[0]["content"]
        assert 'read_attachment("report.pdf") → lines 1–1 of 1:\nextracted body' in body
        assert sidecar_name(pdf.name) not in body


def test_a_PDF_WITH_NO_TEXT_says_so_IN_THE_TURN(home: Path) -> None:
    """§4.3's failure copy is the sidecar's CONTENT, so it rides the ordinary frame: the model is
    told, in the same shape as any other file's page, that this one has nothing to read."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "see", _attach(home, thread.id, "scan.pdf", pdf_with_text([[]])))
        body = _user_turns(_assemble(c, thread))[0]["content"]
        assert 'read_attachment("scan.pdf") → lines 1–1 of 1:' in body
        assert NO_TEXT_SIDECAR.strip() in body


def test_the_ceiling_degrades_the_OLDEST_images_first(home: Path) -> None:
    """§4.1's per-assembled-request ceiling (council E5): history accumulation is otherwise
    unbounded. The newest survive; the oldest become the §4.5 stub."""
    with make_client() as c:
        c.app.state.settings.attachments.max_images_per_request = 2
        thread = _thread(c)
        for n in (1, 2, 3):
            _say(c, thread, f"turn {n}", _attach(home, thread.id, f"p{n}.png", png_bytes(n, n)))
        turns = _user_turns(_assemble(c, thread))
        assert isinstance(turns[0]["content"], str) and 'image "p1.png"' in turns[0]["content"]
        assert turns[1]["content"][1]["type"] == "image_url"
        assert turns[2]["content"][1]["type"] == "image_url"


def test_resend_off_sends_only_THIS_turn_s_images(home: Path) -> None:
    """§4.5: `resend: true` is the default (dropping history images breaks follow-ups), and off it
    is the current logical turn — `turn_start_index`, the same boundary the rest of the loop uses."""
    with make_client() as c:
        c.app.state.settings.attachments.resend = False
        thread = _thread(c)
        _say(c, thread, "first", _attach(home, thread.id, "old.png", png_bytes(4, 4)))
        _say(c, thread, "ok", role="assistant")
        _say(c, thread, "second", _attach(home, thread.id, "new.png", png_bytes(6, 6)))
        turns = _user_turns(_assemble(c, thread))
        assert 'image "old.png", 4×4 was attached earlier' in turns[0]["content"]
        assert turns[1]["content"][1]["type"] == "image_url"


def test_an_image_the_store_has_LOST_degrades_instead_of_crashing(home: Path) -> None:
    with make_client() as c:
        thread = _thread(c)
        photo = _attach(home, thread.id, "photo.png", png_bytes(3, 3))
        _say(c, thread, "look", photo)
        (home / "attachments" / thread.id / "photo.png").unlink()
        turn = _user_turns(_assemble(c, thread))[0]
        assert isinstance(turn["content"], str) and 'image "photo.png"' in turn["content"]


def test_an_ATTACHMENT_ONLY_send_gets_a_wire_text_of_its_own(home: Path) -> None:
    """§7: the message persists with no `TextPart` at all, so assembly supplies the wire text — an
    empty string would be an empty turn to a strict chat template."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "", _attach(home, thread.id, "photo.png", png_bytes(2, 2)))
        turn = _user_turns(_assemble(c, thread))[0]
        assert turn["content"][0] == {"type": "text", "text": ATTACHMENT_ONLY_TEXT}


def test_each_file_is_READ_ONCE_PER_TURN_however_many_iterations_run(home: Path, monkeypatch) -> None:
    """Council E5, the whole reason the cache exists: `_assemble` runs once per loop ITERATION, and a
    thread of photos would otherwise re-read and re-base64 tens of megabytes on every model call."""
    import app.services.agent.attachments as seam

    reads = {"n": 0}
    real = seam.read_bytes

    def counting(*a, **kw):
        reads["n"] += 1
        return real(*a, **kw)

    monkeypatch.setattr(seam, "read_bytes", counting)
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "look", _attach(home, thread.id, "photo.png", png_bytes(9, 9)))
        session = _session(c)
        first = _assemble(c, thread, session)
        second = _assemble(c, thread, session)
        assert first == second  # byte-identical across iterations — the prefix stays cacheable
        assert reads["n"] == 1


# ── B. the estimator arm (§4.1 H3) ────────────────────────────────────────────────────────────────


def _msg(*parts) -> Message:
    return Message(thread_id="t", role="user", parts=list(parts))


def test_attachments_price_ABOVE_the_same_history_without_them() -> None:
    """H3 was an explicit slice item because skipping it is SILENT: with no arm, a thread of photos
    and documents sails past the compaction trigger and overflows the window instead of folding."""
    cfg = AttachmentsCfg(image_tokens=1000, max_inline_chars=16000)
    plain = [_msg(TextPart(text="look"))]
    withfiles = [
        _msg(
            TextPart(text="look"),
            AttachmentPart(kind="image", name="p.png", mime="image/png", path="t/p.png", width=8, height=8),
            AttachmentPart(kind="text", name="n.txt", mime="text/plain", path="t/n.txt", inline_chars=4000),
        )
    ]
    assert estimate_tokens(plain, cfg) == estimate_tokens(plain)  # old rows: untouched, defaults agree
    assert estimate_tokens(withfiles, cfg) > estimate_tokens(plain, cfg) + 1000


def test_the_price_follows_THE_CONFIGURED_NUMBERS_not_a_baked_constant() -> None:
    """Confirm N1: nothing is priced into the persisted row, so retuning a knob re-prices old rows."""
    img = [_msg(AttachmentPart(kind="image", name="p.png", mime="image/png", path="t/p.png"))]
    cheap = estimate_tokens(img, AttachmentsCfg(image_tokens=100))
    dear = estimate_tokens(img, AttachmentsCfg(image_tokens=900))
    assert dear - cheap == 800

    doc = [
        _msg(AttachmentPart(kind="text", name="n.txt", mime="text/plain", path="t/n.txt", inline_chars=9000))
    ]
    small = estimate_tokens(doc, AttachmentsCfg(max_inline_chars=1000))
    large = estimate_tokens(doc, AttachmentsCfg(max_inline_chars=5000))
    assert large - small == 1000  # 4000 more characters injected, at the shared chars/token ratio


def test_a_PDF_with_no_extracted_text_is_priced_at_its_STUB() -> None:
    """The honest price of what the turn will really carry — not of a sidecar that does not exist."""
    pdf = AttachmentPart(kind="pdf", name="r.pdf", mime="application/pdf", path="t/r.pdf", bytes=2048)
    priced = estimate_tokens([_msg(pdf)], AttachmentsCfg()) - estimate_tokens([_msg()], AttachmentsCfg())
    assert 0 < priced < 80  # a stub, not a whole document


def test_an_EXTRACTED_pdf_is_priced_like_the_text_file_it_now_is(home: Path) -> None:
    """S4's half of H3, and it took no estimator change: the claim records the sidecar's length as
    `inline_chars`, and `priced_inline_chars` — written for text files, priced at READ off the live
    knobs — starts pricing PDFs for real. Pinned against the STUB price so the difference is the
    document, not a rounding."""
    with make_client() as c:
        thread = _thread(c)
        cfg = c.app.state.settings.attachments
        pdf = _attach(home, thread.id, "report.pdf", pdf_with_text([["x" * 90] * 20]))
        stub = pdf.model_copy(update={"inline_chars": None})
        assert pdf.inline_chars and pdf.inline_chars > 1500
        assert priced_inline_chars(pdf, cfg) >= pdf.inline_chars
        assert priced_inline_chars(pdf, cfg) > priced_inline_chars(stub, cfg) + 1000


# ── C. the per-hop modality strip (§5) ────────────────────────────────────────────────────────────


class _Stream:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        return self._items.pop(0)

    async def close(self):
        pass


class _Delta:
    def __init__(self, content=""):
        self.content = content
        self.reasoning_content = None
        self.tool_calls = []
        self.model_extra = None


class _Chunk:
    def __init__(self, delta):
        self.choices = [type("Ch", (), {"delta": delta})()]


class _Resp:
    def __init__(self, content):
        self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]


class _Completions:
    def __init__(self, behavior):
        self._behavior = behavior
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._behavior(kwargs)


class _Client:
    def __init__(self, behavior):
        self.chat = type("Chat", (), {"completions": _Completions(behavior)})()


def _build(reg, behaviors: dict[str, object]):
    from app.adapters.inference import InferenceClient

    client = InferenceClient(reg)
    fakes = {url: _Client(b) for url, b in behaviors.items()}
    client._client = lambda ep: fakes[ep.base_url]  # type: ignore[assignment]
    return client, fakes


def _down(_kw):
    raise RuntimeError("backend down")


def _payload() -> list[dict]:
    return [
        {"role": "system", "content": "head"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "look at this"},
                image_part("data:image/png;base64,AAA", "photo.jpg"),
            ],
        },
    ]


def _sent(fake) -> list[dict]:
    return fake.chat.completions.calls[-1]["messages"]


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


VISION = target("vision", "http://v/v1", input_modalities=["text", "image"])
PLAIN = target("plain", "http://p/v1")  # no `input_modalities` at all ⇒ text-only (the default)


def test_a_NON_VISION_fallback_never_receives_the_image(home: Path) -> None:
    """§5's pin, direction 1: the vision primary dies, and the text-only hop gets opencode's in-band
    ERROR — naming the file — in the image's place."""
    client, fakes = _build(
        registry([VISION, PLAIN]),
        {"http://v/v1": _down, "http://p/v1": lambda _kw: _Stream([_Chunk(_Delta("ok"))])},
    )
    source = _payload()
    _run(_collect(client, source))
    parts = _sent(fakes["http://p/v1"])[1]["content"]
    assert not any(p["type"] == "image_url" for p in parts)
    assert parts[1] == {
        "type": "text",
        "text": 'ERROR: Cannot read "photo.jpg" (this model does not support image input). Inform the user.',
    }


def test_a_VISION_fallback_after_a_text_only_primary_still_gets_THE_REAL_IMAGE(home: Path) -> None:
    """§5's pin, direction 2 — the one that proves the source list was never MUTATED: had the first
    hop's strip edited in place, the vision hop behind it would be blind."""
    client, fakes = _build(
        registry([PLAIN, VISION]),
        {"http://p/v1": _down, "http://v/v1": lambda _kw: _Stream([_Chunk(_Delta("ok"))])},
    )
    source = _payload()
    _run(_collect(client, source))
    parts = _sent(fakes["http://v/v1"])[1]["content"]
    assert parts[1]["image_url"] == {"url": "data:image/png;base64,AAA"}
    assert source[1]["content"][1][IMAGE_PART_NAME_KEY] == "photo.jpg"  # the caller's list is intact


def test_our_private_name_key_NEVER_REACHES_THE_WIRE(home: Path) -> None:
    """It exists only so the stub can name the file; a provider must never see an unknown key."""
    client, fakes = _build(registry([VISION]), {"http://v/v1": lambda _kw: _Stream([_Chunk(_Delta("ok"))])})
    _run(_collect(client, _payload()))
    for part in _sent(fakes["http://v/v1"])[1]["content"]:
        assert IMAGE_PART_NAME_KEY not in part


def test_the_BUFFERED_path_strips_on_the_same_rule(home: Path) -> None:
    """`complete` (the summarizer's path) carries the strip in its own `attempt`, not by luck."""
    client, fakes = _build(registry([PLAIN]), {"http://p/v1": lambda _kw: _Resp("done")})
    assert _run(client.complete(_payload())) == "done"
    parts = _sent(fakes["http://p/v1"])[1]["content"]
    assert parts[1]["type"] == "text" and "photo.jpg" in parts[1]["text"]


def test_an_image_free_payload_is_handed_over_UNCHANGED(home: Path) -> None:
    """No image parts ⇒ the same list object, so every text-only turn costs exactly what it did."""
    from app.adapters.inference import drop_unsupported_modalities

    messages = [{"role": "user", "content": "hi"}]
    assert drop_unsupported_modalities(messages, PLAIN) is messages
    assert drop_unsupported_modalities(messages, VISION) is messages


async def _collect(client, messages):
    return [d async for d in client.stream_chat(messages)]


# ── D. read_attachment + InvocationContext.thread_id (§4.4) ───────────────────────────────────────


def test_the_tool_FAILS_CLOSED_without_a_thread(home: Path) -> None:
    """§4.4 (council O-M6/E8): the conversation is the SERVER's to supply. A run that has none — a
    Utils-card invocation, a future call site that forgot — refuses instead of guessing at a thread."""
    with make_client() as c:
        result = _invoke(c, None)
        assert result.state.value == "denied"
        assert "not attached to a conversation" in (result.error or "")


def test_no_name_returns_THE_MANIFEST_including_a_compacted_turn_s_files(home: Path) -> None:
    """The discovery affordance (O-H2): the whole point is that a folded-away turn's files are still
    findable, so the listing reads the PERSISTED parts, compacted messages included."""
    with make_client() as c:
        thread = _thread(c)
        old = _say(c, thread, "old", _attach(home, thread.id, "notes.txt", b"hi"))
        old.compacted = True
        run_async(c.app.state.messages.update(old))
        _say(c, thread, "new", _attach(home, thread.id, "photo.png", png_bytes(5, 5)))
        result = _invoke(c, thread.id)
        assert result.state.value == "ok" and (result.output or "").splitlines() == [
            "notes.txt · text · 2 B",
            f"photo.png · image · {len(png_bytes(5, 5))} B",
        ]


def test_a_text_file_pages_with_the_D64_CONTRACT(home: Path) -> None:
    """The same offset/limit/continue-marker shape `core_memory` uses — one convention for every
    paged read the model does (§4.4)."""
    with make_client() as c:
        c.app.state.settings.attachments.max_inline_chars = 40
        thread = _thread(c)
        _say(c, thread, "read", _attach(home, thread.id, "notes.txt", TEXT))
        first = _invoke(c, thread.id, name="notes.txt")
        assert "PARTIAL: lines 1-5 of 400" in (first.output or "")
        assert "continue: read_attachment offset=6" in (first.output or "")
        second = _invoke(c, thread.id, name="notes.txt", offset=6, limit=2)
        assert "line 6\nline 7\n" in (second.output or "")
        assert "line 8" not in (second.output or "")
        past = _invoke(c, thread.id, name="notes.txt", offset=999)
        assert past.state.value == "error" and "past the end" in (past.error or "")


def test_the_TOOL_returns_the_BOUNDED_page_of_an_oversized_line(home: Path) -> None:
    """MED-1's other consumer: the tool result is capped the same way the injection is (one page
    rule), and its PARTIAL head states the cut — the model is told exactly what it holds, and is not
    pointed at an offset that could never reach the rest of that line."""
    with make_client() as c:
        c.app.state.settings.attachments.max_inline_chars = 40
        thread = _thread(c)
        _say(c, thread, "read", _attach(home, thread.id, "wide.txt", b"x" * 500 + b"\n"))
        out = _invoke(c, thread.id, name="wide.txt").output or ""
        assert "wide.txt (PARTIAL: lines 1-1 of 1 — 40 of 501 chars)" in out
        assert "line 1 is longer than one page: its first 40 characters are shown" in out
        assert "x" * 40 in out and "x" * 41 not in out
        assert "continue: read_attachment" not in out  # there is no further line to name


def test_an_IMAGE_refuses_honestly_by_kind(home: Path) -> None:
    """Images reach the model through assembly, never as tool output — so this can only ever answer
    "not here", and saying WHY is what stops a second spelling of the same call."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "look", _attach(home, thread.id, "photo.png", png_bytes(5, 5)))
        result = _invoke(c, thread.id, name="photo.png")
        assert result.state.value == "error" and "shown to you directly" in (result.error or "")


def test_a_PDF_whose_sidecar_is_GONE_says_SO_rather_than_failing(home: Path) -> None:
    """The tool's counterpart of the stub above: no sidecar on disk is a FACT about the file, not an
    error — and it stays a fact, because extraction happened once at claim and no read rebuilds it
    (the §10-class residual: the remedy is re-attaching the file)."""
    with make_client() as c:
        thread = _thread(c)
        pdf = _attach(home, thread.id, "report.pdf", pdf_with_text([["some text"]]))
        sidecar = thread_dir(home, thread.id) / sidecar_name(pdf.name)
        sidecar.unlink()
        _say(c, thread, "see", pdf)
        result = _invoke(c, thread.id, name="report.pdf")
        assert result.state.value == "ok" and "no text has been extracted" in (result.output or "")
        assert not sidecar.exists()  # the read did not re-extract


def test_a_PDF_the_claim_EXTRACTED_reads_back_through_the_tool(home: Path) -> None:
    with make_client() as c:
        thread = _thread(c)
        pdf = _attach(home, thread.id, "report.pdf", pdf_with_text([["the extracted body"]]))
        _say(c, thread, "see", pdf)
        assert "the extracted body" in (_invoke(c, thread.id, name="report.pdf").output or "")


def test_a_PDF_with_NO_TEXT_reads_back_as_the_one_liner(home: Path) -> None:
    """The §4.3 failure copy through the tool: an OK result carrying the one thing the model can act
    on, rather than a refusal it would try a second spelling of."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "see", _attach(home, thread.id, "scan.pdf", pdf_with_text([[]])))
        result = _invoke(c, thread.id, name="scan.pdf")
        assert result.state.value == "ok" and NO_TEXT_SIDECAR.strip() in (result.output or "")


def test_a_PDF_s_CONTINUATION_names_a_call_that_actually_works(home: Path) -> None:
    """S2 MED-2: the page's physical source is the sidecar, but `read_attachment` addresses a
    conversation's PARTS — so a head naming `report.pdf.txt` would hand the model a call this very
    tool refuses. It names the PDF, and the sidecar is never spoken aloud."""
    with make_client() as c:
        c.app.state.settings.attachments.max_inline_chars = 40
        thread = _thread(c)
        # 12 real lines of extracted text — enough to page at a 40-character budget.
        pdf = _attach(home, thread.id, "report.pdf", pdf_with_text([[f"line {i}" for i in range(1, 13)]]))
        _say(c, thread, "see", pdf)
        out = _invoke(c, thread.id, name="report.pdf").output or ""
        assert out.startswith("report.pdf (PARTIAL: lines 1-5 of 12")
        assert "continue: read_attachment offset=6" in out
        assert "line 1\n" in out and "line 6" not in out  # …while the bytes came from the sidecar
        assert sidecar_name(pdf.name) not in out
        # and the physical name is exactly what this tool refuses, which is why the head avoids it
        assert _invoke(c, thread.id, name=sidecar_name(pdf.name)).state.value == "error"


def test_a_name_THIS_conversation_does_not_hold_is_refused(home: Path) -> None:
    """Name-addressed against the thread's OWN persisted parts: what is addressable is exactly what
    this conversation was sent — another thread's file has no name here."""
    with make_client() as c:
        mine, theirs = _thread(c), _thread(c)
        _attach(home, theirs.id, "secret.txt", b"not yours")
        _say(c, mine, "hi", _attach(home, mine.id, "notes.txt", b"mine"))
        result = _invoke(c, mine.id, name="secret.txt")
        assert result.state.value == "error"
        assert "no attachment named" in (result.error or "") and "no `name`" in (result.error or "")


@pytest.mark.parametrize("bad", ["../../etc/passwd", "notes.txt/../notes.txt", "/etc/passwd"])
def test_a_path_shaped_name_reaches_nothing(home: Path, bad: str) -> None:
    """Two rails, either of which suffices: the name is matched against persisted parts, and the
    store's own reader refuses anything that is not a bare name inside the thread dir."""
    with make_client() as c:
        thread = _thread(c)
        _say(c, thread, "hi", _attach(home, thread.id, "notes.txt", b"mine"))
        assert _invoke(c, thread.id, name=bad).state.value == "error"


def test_the_SESSION_hands_its_thread_to_every_tool_call(home: Path) -> None:
    """The plumbing, end to end: a real turn asks for `read_attachment`, and the manifest comes back
    — which it only can if the session stamped `thread_id` on the invocation (fail-closed otherwise)."""
    from app.adapters.inference import ChatDelta, ToolCallRequest

    with make_client() as c:
        thread = _thread(c)
        _attach(home, thread.id, "notes.txt", b"hi")
        session = _session(c)
        replies = [
            [ChatDelta(tool_calls=[ToolCallRequest(id="r1", name="read_attachment", arguments="{}")])],
            [ChatDelta(text="there is one file")],
        ]
        calls = {"n": 0}

        async def fake_stream(messages, **kw):
            idx = min(calls["n"], len(replies) - 1)
            calls["n"] += 1
            for delta in replies[idx]:
                yield delta

        session._inference.stream_chat = fake_stream  # type: ignore[assignment]
        # The file has to be on a persisted user turn for the manifest to list it (facts, not a scan).
        _say(c, thread, "what is attached?", _attach(home, thread.id, "photo.png", png_bytes(3, 3)))
        events = run_async(_drain(session, thread))
        results = [e for e in events if e.event == "tool.result"]
        assert results and "photo.png · image" in (results[0].data["result"]["output"] or "")


async def _drain(session, thread) -> list:
    return [ev async for ev in session.run_turn(thread, "what is attached?")]


# ── E. the compaction manifest (§4.5) ─────────────────────────────────────────────────────────────


def test_the_folded_transcript_carries_the_exact_filenames(home: Path) -> None:
    """Compaction is where a file's identity would otherwise be LOST: the bytes never enter the
    transcript and `_assemble` skips compacted turns, so the names are the whole handle that survives
    (council O-H2/E6). An attachment-only turn renders a line too — it used to vanish entirely."""
    with make_client() as c:
        thread = _thread(c)
        img = _attach(home, thread.id, "photo 1.png", png_bytes(2, 2))
        txt = _attach(home, thread.id, "notes.txt", b"hi")
        spoken = _say(c, thread, "look at this", img, txt)
        silent = _say(c, thread, "", _attach(home, thread.id, "report.pdf", b"%PDF-1.7\n"))
        rendered = _render_transcript([spoken, silent])
        assert rendered.splitlines() == [
            "User: look at this [attached: photo 1.png (image), notes.txt (text)]",
            "User:  [attached: report.pdf (pdf)]",
        ]
        assert base64.b64encode(png_bytes(2, 2)).decode() not in rendered  # never the bytes


def test_the_summarizer_PROMPT_asks_for_the_names_verbatim(home: Path) -> None:
    """…and the template that reads that transcript is told to keep them, through the Phase 18
    registry (so the edit is stamped and the owner can reword it)."""
    with make_client() as c:
        thread = _thread(c)
        msg = _say(c, thread, "look", _attach(home, thread.id, "notes.txt", b"hi"))
        session = _session(c)
        captured: dict = {}

        async def fake_complete(payload, **kw):
            captured["payload"] = payload
            return "a summary"

        session._compactor._inference.complete = fake_complete  # type: ignore[assignment]
        run_async(session._compactor._summarize([msg]))
        system, transcript = captured["payload"][0]["content"], captured["payload"][1]["content"]
        assert "keep those filenames VERBATIM" in system
        assert "[attached: notes.txt (text)]" in transcript
