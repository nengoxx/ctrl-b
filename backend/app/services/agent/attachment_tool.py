"""read_attachment — the agent's way back to a file the owner attached (D68 / ATTACHMENTS_PLAN §4.4).

A built-in, agent-only, READ-ONLY tool (no Utils card, no host button). Attachments are durable
(owner ruling §0a-3: "check that file again", "remember this file from a couple of turns ago"), and
this is the door: a text file whose §4.2 injection was truncated pages on from the offset the marker
named, and a file whose turn has since been COMPACTED away is still reachable by the exact name the
summary preserved (§4.5). Called with no `name` at all it lists what this conversation holds — the
discovery affordance that makes the post-compaction and resumed-session re-read possible (O-H2).

**Confinement is the server's, never the model's** (§4.4, council O-M6/E8): the conversation comes
from `InvocationContext.thread_id`, which `ActionService` stamps from the session driving the turn,
and the tool FAILS CLOSED when it is absent rather than guessing at a thread. The `name` argument is
matched against the thread's own persisted `AttachmentPart`s — so what is addressable is exactly what
this conversation was sent, and every path into the store is built by `core/attachments.py`.

Paging is the D64 contract, deliberately identical to `core_memory`'s: 1-based `offset`, an optional
`limit`, and a PARTIAL page that states which lines of how many it carried and names the call that
continues it. One convention for every paged read the model does.

LOW risk, read-only → auto-runs under the agent's CONFIRM privilege, like `session_search`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.core.attachments import StoredReadError
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.agent.attachments import human_bytes, read_pdf_page, read_text_page

if TYPE_CHECKING:
    from app.core.attachments import StoredRead
    from app.domain.conversation import AttachmentPart

TOOL_NAME = "read_attachment"


class ReadAttachmentInput(BaseModel):
    name: str = Field(
        default="",
        description=(
            "The attachment's filename, EXACTLY as it appears in the conversation (e.g. "
            "`notes.txt`). Leave it out to list the files attached to this conversation."
        ),
    )
    offset: int = Field(
        default=1,
        ge=1,
        description=(
            "The 1-based line to start the page at. Default 1. A page that does not reach the end of "
            "the file says so and names the offset to continue at."
        ),
    )
    limit: int | None = Field(
        default=None,
        ge=1,
        description=(
            "At most this many lines. Optional — a page always stops at the size limit anyway, so "
            "leave it out unless you want a smaller peek."
        ),
    )


@action(
    TOOL_NAME,
    title="Read attachment",
    description=(
        "Read a file the owner attached to this conversation. Call it with no `name` to list what is "
        "attached (name, kind and size); call it with a filename to read that file's text — paged, "
        "with `offset`/`limit`, exactly as a long file's inline preview tells you to continue. Use it "
        "when a file's content was cut short, when the owner refers to something they attached "
        "earlier, or when a summary of the earlier conversation mentions a filename you can no longer "
        "see. Images are not read here — you are shown them directly when they are sent."
    ),
    icon="paperclip",
    category="builtin",
    risk=Risk.LOW,
    read_only=True,  # opens a stored file, changes nothing → retry-safe + parallel-eligible
    ui_exposed=False,
    core=True,  # the §4.2 injection marker NAMES this call, so it must never be missing from a turn
)
async def read_attachment(inp: ReadAttachmentInput, ctx: InvocationContext) -> ToolResult:
    """Read a file attached to this conversation, or list what is attached. Paged (`offset`/`limit`)
    like every other long read; images are shown to you directly and are not read here."""
    deps = ctx.require_deps()
    if deps.messages is None:  # no conversation store wired (a bare tool test) — nothing to address
        return ToolResult(state=RunState.DENIED, summary="attachments are not available")
    if ctx.thread_id is None:
        # FAIL CLOSED (§4.4): this run has no conversation of its own — a Utils-card invocation, or a
        # future call site that forgot to thread the id. Guessing at a thread would be reading someone
        # else's files, so the honest answer is that there is nothing here to read.
        return ToolResult(
            state=RunState.DENIED,
            summary="read_attachment: no conversation to read from",
            error="this run is not attached to a conversation, so it has no attached files.",
        )
    files = _thread_attachments(await deps.messages.list(ctx.thread_id))
    if not inp.name.strip():
        return _manifest(files)
    part = next((p for p in files if p.name == inp.name.strip()), None)
    if part is None:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"read_attachment: no file named {inp.name!r}",
            error=(
                f"this conversation has no attachment named {inp.name!r}. "
                "Call read_attachment with no `name` to see what is attached."
            ),
        )
    if part.kind == "image":
        # Honest refusal BY KIND: images reach the model through assembly (§4.1), never as tool
        # output, so this can only ever answer "not here" — and saying why is what stops the model
        # from trying a second spelling of the same call.
        return ToolResult(
            state=RunState.ERROR,
            summary=f"read_attachment: {part.name} is an image",
            error=(
                f"{part.name} is an image — images are shown to you directly in the conversation, "
                "they are not read through this tool. If you cannot see it above, ask the owner to "
                "attach it again."
            ),
        )
    settings = deps.settings
    if part.kind == "pdf":
        page = await read_pdf_page(settings, ctx.thread_id, part, offset=inp.offset, limit=inp.limit)
        if page is None:
            # S2 ships this reader; S4 ships the extraction that fills it. Until then the answer is a
            # fact, not a failure: the file is here, its text is not.
            return ToolResult(
                state=RunState.OK,
                summary=f"read_attachment: {part.name} has no extracted text",
                output=(
                    f"{part.name} ({human_bytes(part.bytes)}) is attached, but no text has been "
                    "extracted from it. Ask the owner what it contains, or what they want done with it."
                ),
            )
        return _page_result(page)
    try:
        page = await read_text_page(settings, ctx.thread_id, part.name, offset=inp.offset, limit=inp.limit)
    except StoredReadError as exc:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"read_attachment: {part.name} refused",
            error=str(exc),
        )
    return _page_result(page)


def _thread_attachments(messages: list) -> list[AttachmentPart]:
    """Every file this conversation holds, oldest first, deduped by stored name.

    Read from the PERSISTED parts (including compacted messages — the repo's default) rather than from
    the directory: the parts carry the kind and the size as server-established facts, and the whole
    reason this listing exists is that a compacted turn's files must still be findable (O-H2). The
    store's collision suffix makes a name unique within a thread, so the dedup only ever collapses the
    same file listed twice."""
    seen: dict[str, AttachmentPart] = {}
    for m in messages:
        for p in m.attachments():
            seen.setdefault(p.name, p)
    return list(seen.values())


def _manifest(files: list[AttachmentPart]) -> ToolResult:
    """The no-`name` listing: what this conversation has, in the vocabulary the read call takes."""
    if not files:
        return ToolResult(state=RunState.OK, summary="no files are attached to this conversation")
    lines = [f"{p.name} · {p.kind} · {human_bytes(p.bytes)}" for p in files]
    return ToolResult(
        state=RunState.OK,
        summary=f"{len(files)} file(s) attached to this conversation",
        output="\n".join(lines),
    )


def _page_result(read: StoredRead) -> ToolResult:
    """One page as a `ToolResult` — the D64 shape (`core_memory._read_result`'s, applied here).

    A page that carried the whole file gets a plain head. Any other page is marked PARTIAL and states
    the FACTS — which lines of how many, how many characters of how many, whether a line was CUT at
    the page budget (MED-1: a page's oversized first line stops at the cap, and the rest of that line
    is unreachable), and the exact call that continues it — because the owner's ruling is that the
    model must always know what it read and where the cap sits (§0b-3)."""
    span = f"lines {read.first_line:,}-{read.last_line:,} of {read.lines:,}"
    if read.complete:
        return ToolResult(
            state=RunState.OK,
            summary=f"read {read.name} ({len(read.text):,} chars)",
            output=f"{read.name}\n\n{read.text}",
        )
    head = f"{read.name} (PARTIAL: {span} — {len(read.text):,} of {read.chars:,} chars)"
    if read.line_truncated:
        head += (
            f" · line {read.last_line:,} is longer than one page: its first {len(read.text):,} "
            "characters are shown and the rest cannot be read"
        )
    if read.last_line < read.lines:
        head += f" · continue: read_attachment offset={read.last_line + 1}"
    return ToolResult(
        state=RunState.OK,
        summary=f"read {read.name} {span} ({len(read.text):,} chars)",
        output=f"{head}\n\n{read.text}",
    )
