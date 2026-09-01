"""Composer attachments API — the staging PUT and the read mount (D68, ATTACHMENTS_PLAN §3/§8).

One route, and its SHAPE is the security control, exactly as it is on the media write path (D65 /
SECURITY_MODEL §2.7): **raw-body `PUT`, never multipart, never POST**. This app has no
application-layer auth — the tailnet is the boundary — so the attacker worth designing against is the
owner's own browser on another origin, and the only cross-origin request a page can fire without a
preflight is a CORS-SAFELISTED one (`GET`/`HEAD`/`POST`, `multipart/form-data` included). A
non-safelisted verb forces an `OPTIONS` preflight, this app mounts no CORS middleware and answers no
ACAO, and the write dies unsent. `test_attachments_d68.py` extends the D65 architecture guard over
this route too: adding CORS middleware or a POST/multipart upload here removes the same defence.
The whole surface's rules are SECURITY_MODEL §2.8, the §2.7 sibling this one was written from.

**Mint, not store-and-forget** (§3): the route admits the NAME before a single byte streams (a
refusable name never costs a 10 MB write), streams the body through the media ladder's counted
`UploadPart` (413 mid-body, from the counter — never `Content-Length`, which is a claim), sniffs the
landed BYTES, and answers with an opaque server-minted `attachment_id`. The id is the whole claim
credential: `POST /api/agent/chat` names ids and nothing else, and the server builds every
`AttachmentPart` itself (E2).

**The READ (S3, §8)** is the D65 media mount's discipline as a plain route, because a thread
directory is minted per conversation and cannot be a `StaticFiles` mount: the file is served only
when a persisted `AttachmentPart` of THAT thread names it, with the Content-Type the sniff recorded
(never guessed from the extension), `nosniff` on everything, and `Content-Disposition: attachment`
on every non-image kind so stored bytes can never be ACTIVE content in this origin. Read-only, and
every refusal is the same 404 — "not there" is all a prober may learn.

Thin by design — every mechanical piece lives in `app.core.attachments`, which in turn rides
`app.core.media`'s pipeline rather than re-implementing one (council E9/O-M9). The route builds NO
store paths of its own: `stored_file` is the store's own read resolver (the S1 LOW-4 pin).
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.responses import FileResponse

from app.api.media import admit_filename
from app.core.attachments import (
    ALLOWED_SUFFIXES,
    IMAGE_MIME,
    StagedFile,
    finish_staging,
    mint_id,
    prepare_staging,
    stored_file,
)
from app.core.media import StoreWriteError, UploadPart
from app.domain.conversation import AttachmentKind

router = APIRouter(tags=["attachments"])


class StagedAttachment(BaseModel):
    """What the mint answers with — the claim credential plus what the server learned from the bytes.

    `name` is the admitted CANDIDATE name, and the response says so by omission: there is no `path`
    and no URL here, because until the send claims this id there is no thread to store it under and
    therefore no final name to promise (confirm-round NEW 2). The client shows `name`, `kind` and the
    size in its chip and sends back `attachment_id`.
    """

    attachment_id: str
    name: str
    kind: AttachmentKind
    mime: str
    bytes: int
    width: int | None = None
    height: int | None = None
    #: The decoded character count of a text file — the fact S2's injection and the estimator price
    #: from. `None` for images and PDFs (a PDF's extracted length is S4's, at claim).
    inline_chars: int | None = None

    @classmethod
    def of(cls, staged: StagedFile) -> "StagedAttachment":
        return cls(
            attachment_id=staged.attachment_id,
            name=staged.name,
            kind=staged.kind,
            mime=staged.mime,
            bytes=staged.bytes,
            width=staged.width,
            height=staged.height,
            inline_chars=staged.chars,
        )


@router.put("/attachments/staging/{filename:path}", status_code=201)
async def stage_attachment(filename: str, request: Request) -> StagedAttachment:
    """Stage one file for the next send. **Raw body — never multipart, never POST** (see the module
    note; the verb IS the CORS control).

    `201` with the staged row · `404` a path-shaped name · `413` past `attachments.max_file_mb` ·
    `415` bytes that are not an image, a PDF or decodable text · `422` a name this surface may not
    create, or an empty body · `500` the store's own tree is in a shape it cannot write into.

    **The name is admitted BEFORE any byte streams** (O-conf rider): `admit_filename` is the media
    write path's own predicate — one rule, one pair of statuses — with this surface's extension tier
    passed in. A client whose picker produced `CON.png` learns so in one round trip instead of after
    a 10 MB upload.

    `{filename:path}` rather than `{filename}` for the D65 reason: a name carrying a separator must
    REACH this handler and get the 404, instead of falling through to something else that answers a
    different code and thereby says more about what lives here.

    The chunk writes are not hopped onto a thread (a buffered `write` is a memcpy); the ladder's ends
    — fsync, the sniff's whole-file decode, the link/unlink pair — are, exactly as `media_upload`
    does it. The `finally` is the zero-bytes guarantee: whatever happened, the `.part` is gone when
    the response is written (a crash instead of a return is what the boot sweep is for).
    """
    admit_filename(filename, allowed_suffixes=ALLOWED_SUFFIXES)
    cfg = request.app.state.settings.attachments
    part: UploadPart | None = None
    try:
        staging = await asyncio.to_thread(prepare_staging, request.app.state.settings.home_dir())
        part = await asyncio.to_thread(
            UploadPart.open,
            staging,
            max_bytes=cfg.max_bytes,
            cap_setting="attachments.max_file_mb",
        )
        async for chunk in request.stream():
            part.write(chunk)
        if part.received == 0:
            raise StoreWriteError(422, "the request body is empty")
        staged = await asyncio.to_thread(finish_staging, part, staging, mint_id(), filename)
        return StagedAttachment.of(staged)
    except StoreWriteError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    finally:
        if part is not None:
            await asyncio.to_thread(part.discard)


#: How a claimed attachment is cached. `immutable` is earned here in a way the media mount's stable
#: names never earn it (D65 serves `no-cache` for exactly that reason): a stored attachment is
#: collision-SUFFIXED at claim and is never rewritten, so `{thread_id}/{name}` addresses one
#: byte-string for the life of the thread. `private` because the tailnet is the boundary and no
#: shared cache may ever hold the owner's photographs.
_CACHE_CONTROL = "private, max-age=31536000, immutable"


@router.get("/attachments/{thread_id}/{name:path}")
async def read_attachment_file(thread_id: str, name: str, request: Request) -> FileResponse:
    """Serve one CLAIMED attachment — the bubble's `<img>` source and the owner's own download (§8).

    `404` for everything that is not exactly a file this thread persisted a part for: a name outside
    the store's dereference rules, a directory, a symlink, a file the claim landed but no message
    ever named (the crash-window leftover), a PDF's sidecar, an unknown thread. One answer, so a
    probe learns nothing about what the store holds.

    **The part is the authority, not the directory listing.** The Content-Type is the `mime` the
    SNIFF recorded at claim (`AttachmentPart.mime`) — never guessed from the extension, which is how
    an owner-supplied `notes.png` full of HTML would otherwise be served as same-origin `text/html`
    to an app with no auth. Images (and only sniffed image kinds — SVG is unreachable by
    construction, it is admitted nowhere) are served INLINE so a bubble can paint them; every other
    kind carries `Content-Disposition: attachment`, which makes the response inert whatever the byte
    content is. `nosniff` rides both, exactly as the media mount sets it.

    `{name:path}` for the D65 reason: a name carrying a separator must REACH this handler and get
    the 404, rather than falling through to something that answers a different code and thereby says
    more about what lives here.

    Read-only by construction — nothing here writes, moves or deletes; the claim stays the only
    writer into a thread dir (§3).
    """
    part = await request.app.state.messages.attachment_part(thread_id, name)
    if part is None:
        raise HTTPException(status_code=404, detail="not found")
    home = request.app.state.settings.home_dir()
    path = await asyncio.to_thread(stored_file, home, thread_id, name)
    if path is None:
        raise HTTPException(status_code=404, detail="not found")
    inline = part.kind == "image" and part.mime in set(IMAGE_MIME.values())
    return FileResponse(
        path,
        media_type=part.mime,
        # Starlette writes (and escapes) the whole `Content-Disposition` from `filename`; passing it
        # only for the non-inline kinds is what leaves an image with no disposition header at all.
        filename=None if inline else part.name,
        headers={"x-content-type-options": "nosniff", "cache-control": _CACHE_CONTROL},
    )
