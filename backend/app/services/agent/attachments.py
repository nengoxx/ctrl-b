"""The attachment store, as the chat stack calls it (D68 / ATTACHMENTS_PLAN §3/§4).

`core.attachments` owns the store and knows nothing about `Settings`; this is the seam that binds the
workspace root and the `attachments:` tunables to it and hops the blocking filesystem work off the
event loop. It exists so the **two** claim sites — the chat POST (`api/agent.py`) and the steer drain
(`services/agent/session.py`, E7) — call ONE thing: a second call site that forgot the age bound, the
thread hop or the cap would be a claim with different rules, which is exactly how a transport
contract rots. S2 extends it the same way for the READ half (assembly, the estimator and the
`read_attachment` tool all come through here), which is also what keeps `core/attachments.py` the
only module that builds a path into the store (the S1 LOW-4 pin).

It also owns the model-facing FRAMING of an attachment (§4.2/§4.5) — the injection marker, the
degrade stubs and the dimensions notice — because assembly renders them, the estimator PRICES them,
and the two must never disagree about what a file costs the turn.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import replace
from typing import TYPE_CHECKING

from app.core.attachments import (
    PdfBounds,
    StoredRead,
    StoredReadError,
    claim_all,
    read_bytes,
    read_page,
    sidecar_name,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from app.config import AttachmentsCfg, Settings
    from app.domain.conversation import AttachmentPart


async def claim_attachments(
    settings: Settings, thread_id: str, attachment_ids: Sequence[str]
) -> list[AttachmentPart]:
    """Claim every staged id of one send into `thread_id`, returning the parts to persist.

    Raises `StoreWriteError(409, …)` on the first consumed/expired/unknown id — the caller decides
    what that means for its path (the POST refuses the send; the drain says so in a `notice` and
    persists the text it already holds). Empty in, empty out and no thread hop: the overwhelmingly
    common send carries no files and must cost nothing.

    This is also where the PDF extraction bounds are read off `Settings` (S4 §4.3) — the ONE place,
    because the store may not import config. They ride the same `to_thread` hop the claim already
    needed: extraction is `pypdf` on a file the claim just landed, which is exactly the blocking work
    this seam exists to keep off the event loop.
    """
    if not attachment_ids:
        return []
    cfg = settings.attachments
    return await asyncio.to_thread(
        claim_all,
        settings.home_dir(),
        thread_id,
        list(attachment_ids),
        max_age_s=cfg.staging_orphan_s,
        pdf_bounds=PdfBounds(max_pages=cfg.max_pdf_pages, max_chars=cfg.max_extracted_chars),
    )


# ── reads (assembly + the tool) ───────────────────────────────────────────────────────────────────


async def read_data_url(settings: Settings, thread_id: str, part: AttachmentPart) -> str | None:
    """One image part as an OpenAI `data:` URL, or `None` when the file is no longer there.

    Off the event loop (a 10 MB read plus its base64 expansion is not something to do on the loop) and
    through the store's own reader, so no path into a thread dir is built out here. The MIME is the
    part's — a fact the server sniffed at claim, never the client's header.
    """
    raw = await asyncio.to_thread(read_bytes, settings.home_dir(), thread_id, part.name)
    if raw is None:
        return None
    return f"data:{part.mime};base64,{base64.b64encode(raw).decode('ascii')}"


async def read_text_page(
    settings: Settings,
    thread_id: str,
    name: str,
    *,
    offset: int = 1,
    limit: int | None = None,
) -> StoredRead:
    """One page of a stored text file (D64 contract), raising `StoredReadError` on a refusal.

    The page budget is `attachments.max_inline_chars` — the SAME number the §4.2 injection is capped
    at, deliberately: "what one page holds" and "what the turn was handed" are one rule, so the
    continuation the marker names is the continuation the tool actually returns.
    """
    return await asyncio.to_thread(
        read_page,
        settings.home_dir(),
        thread_id,
        name,
        offset=offset,
        limit=limit,
        max_chars=settings.attachments.max_inline_chars,
    )


async def read_pdf_page(
    settings: Settings,
    thread_id: str,
    part: AttachmentPart,
    *,
    offset: int = 1,
    limit: int | None = None,
) -> StoredRead | None:
    """A PDF's EXTRACTED-TEXT sidecar as a page, or `None` when there is no sidecar yet (§4.3).

    S2 ships the reader; S4 ships the writer. That order is deliberate: once the sidecar exists it IS
    a text file, so the whole feed — this page, the §4.2 injection, the paged tool — is already the
    one text code path, and S4 adds extraction without touching a consumer.

    The page comes back under the PART's name, never the sidecar's — see the comment on the rewrite.
    """
    try:
        page = await read_text_page(settings, thread_id, sidecar_name(part.name), offset=offset, limit=limit)
    except StoredReadError:
        # "There is no sidecar" and "the sidecar is unreadable" are the same fact to every caller
        # here: the PDF has no text to show yet. The caller renders the honest stub for both.
        return None
    # The page was READ from the physical sidecar (`report.pdf.txt`) and is ABOUT the logical
    # attachment (`report.pdf`) — the split matters because every consumer NAMES the page: the §4.2
    # marker and the tool's continuation both render `read_attachment("<name>")`, and the sidecar is
    # not a name this conversation holds, so `read_attachment` would refuse the very call it advertised
    # (S2 MED-2). The page therefore travels under the addressable name; the physical one stops here.
    return replace(page, name=part.name)


# ── the model-facing framing (§4.2/§4.5) ──────────────────────────────────────────────────────────

#: The wire text of an ATTACHMENT-ONLY send (§7, R61's own sentence). The owner may send a photo with
#: no caption — the message then persists with no `TextPart` at all (S1), and this is what the model
#: is given in its place. Framing, not a prompt: it is the same class of text as the stubs above (a
#: fixed sentence the wire needs), so it lives beside them rather than in the Phase 18 registry, which
#: owns INSTRUCTIONS the owner may want to reword.
ATTACHMENT_ONLY_TEXT = "Please refer to the attached file(s)."


def inline_marker(read: StoredRead) -> str:
    """The §4.2 frame: a file's content is presented as tool OUTPUT in the D64 marker convention.

    `read_attachment("notes.txt") → lines 1–200 of 900; continue from offset 201:`

    NOT prose narrating a call ("I called read_attachment with…"): a small model shown a tool call
    rendered as text learns to imitate the text, and synthetic arguments teach a call shape that 400s
    (council O-M7). This is the OUTPUT half only — the vocabulary the model already knows from every
    real tool result — and the continuation names the exact call that reaches the rest.

    A page whose line was CUT (MED-1) says so in the same voice: coverage is never advertised over
    characters the model was not shown, so the marker names the cut, and the continuation — when the
    file has more lines — still points at the NEXT line, because the rest of a cut line is
    unreachable (no offset starts mid-line) and the wording must not suggest otherwise.
    """
    span = f"lines {read.first_line:,}–{read.last_line:,} of {read.lines:,}"
    head = f'read_attachment("{read.name}") → {span}'
    if read.line_truncated:
        head += (
            f" (line {read.last_line:,} is longer than one page — its first {len(read.text):,} "
            "characters are shown, the rest cannot be read)"
        )
    if read.complete or read.last_line >= read.lines:
        return f"{head}:"
    return f"{head}; continue from offset {read.last_line + 1}:"


def render_inline(read: StoredRead) -> str:
    """The marker plus the page itself — what a text attachment contributes to the user turn."""
    return f"{inline_marker(read)}\n{read.text}"


def image_stub(part: AttachmentPart) -> str:
    """What an image renders as when it is NOT sent this request (§4.5): past the per-request ceiling,
    or with `attachments.resend` off, or when the file has gone from the store.

    It deliberately does NOT point at `read_attachment`: that tool refuses image kinds by design (the
    model receives images through assembly, not through a tool), so naming it here would teach a call
    that can only ever come back as a refusal. What the model can actually do is say the image is no
    longer in front of it — so that is what this says.
    """
    dims = f", {part.width}×{part.height}" if part.width and part.height else ""
    return (
        f'[image "{part.name}"{dims} was attached earlier in this conversation and is not '
        "included again in this request — ask the owner to attach it again if you need to see it]"
    )


def document_stub(part: AttachmentPart) -> str:
    """What a text/PDF attachment renders as when its content is NOT inlined into the turn — a file
    the store can no longer read, or a PDF with no sidecar on disk (S4 writes one at claim, including
    for a PDF it could not read a word of, so this is now the crash-window shape rather than the
    ordinary one). Names the file, its kind, its size, and the ONE call that opens it.

    Deliberately one wording for both causes, and deliberately the same string the estimator prices
    (`priced_inline_chars`): a stub that read differently depending on WHY it is a stub would be a
    second thing to keep in sync for no gain to the model, which only needs to know the file is there
    and how to reach it."""
    return (
        f'[{part.kind} attachment "{part.name}" ({human_bytes(part.bytes)}) — its text is not '
        f'included in this message; call read_attachment("{part.name}") to read it]'
    )


def dimensions_notice(parts: Sequence[AttachmentPart]) -> str | None:
    """One line naming the PIXEL DIMENSIONS of the images actually sent, or `None` when none is known.

    **Main-seat amendment of §4.1's "resize notice"** (2026-09-01): the plan asked for
    original→sent dimensions, but the client downscales BEFORE upload, so the server never holds the
    original — and every `AttachmentPart` field is a server-constructed fact (E2), so quoting a
    client-claimed original would break exactly the property that makes these parts trustworthy. What
    IS known is what was stored, read from the header at claim, and that is what grounds the model's
    pixel reasoning ("is the text in this screenshot legible?"), so that is what this states.
    """
    rows = [f"{p.name}: {p.width}×{p.height}" for p in parts if p.width and p.height]
    if not rows:
        return None
    return "Attached images, as sent (pixel dimensions): " + "; ".join(rows)


def human_bytes(size: int) -> str:
    """A file size a model (and an owner) reads at a glance. One formatter, used by the stubs and by
    `read_attachment`'s manifest, so a file never describes itself two ways in one turn."""
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


# ── pricing (the estimator arm, §4.1 H3) ──────────────────────────────────────────────────────────


def priced_inline_chars(part: AttachmentPart, cfg: AttachmentsCfg) -> int:
    """What a NON-image attachment will cost the assembled request, in characters (§2 confirm N1).

    Priced from the PERSISTED FACT at READ time, never from a number baked into the row: `inline_chars`
    is the file's extracted length, and `min(that, max_inline_chars)` is what the injection will
    actually carry — so retuning the knob re-prices old rows instead of leaving stale prices on them.

    A part with no `inline_chars` (a PDF whose sidecar write did not land) is priced at its STUB,
    which is what the turn will really carry. A PDF that HAS one is priced exactly like a text file
    and needed no arm of its own here: S4 records the sidecar's length as `inline_chars` at claim, so
    the formula below started pricing PDFs for real without a line changing. The marker is priced by
    RENDERING it rather than by a constant beside it: one source, and it cannot drift from the frame
    assembly emits.

    The `min(…)` is EXACT because `max_inline_chars` is now a hard bound on a page (MED-1): before the
    cut, one oversized line was emitted whole, so a 10 MiB single-line file priced at the cap and cost
    the turn the whole file. The estimator needed no change — the read path did.
    """
    if part.inline_chars is None:
        return len(document_stub(part))
    return min(part.inline_chars, cfg.max_inline_chars) + _marker_cost(part.name)


def _marker_cost(name: str) -> int:
    """The §4.2 frame's own character cost for one file, measured on the real renderer. The shape fed
    in is the LONGEST the marker takes — a CUT line (`line_truncated`, S2 confirm LOW) plus the
    continuation clause, which co-occur on a multi-line file whose first line is oversized — keeping
    the estimate on the conservative side the way the rest of `estimate_tokens` is: a slight
    over-estimate compacts a little early, an under-estimate overflows a window. The interpolated
    counts' digit widths differ from a real page's by a few characters — noise beneath the
    `CHARS_PER_TOKEN` heuristic's own error, and now on the OVER side for every uncut page."""
    return len(
        inline_marker(
            StoredRead(name=name, text="", chars=0, lines=2, first_line=1, last_line=1, line_truncated=True)
        )
    )
