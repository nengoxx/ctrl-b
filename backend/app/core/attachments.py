"""Composer attachments — the durable per-thread file store (D68, ATTACHMENTS_PLAN §2/§3).

The owner attaches images, text files and PDFs to a chat message; the bytes land here and STAY, so
the agent can be asked about a file three turns later (owner ruling §0a-3). This module owns the
store and the transport's server half; `app/api/attachments.py` publishes the staging PUT and
`app/api/agent.py` claims what the send names.

**It is not a second media store — it RIDES the media persist pipeline** (council E9/O-M9). Every
mechanical piece is `app.core.media`'s, parameterised rather than copied: the bare-name admission
predicate (`admission_reason`), the atomic ladder (`UploadPart`: mkstemp → chmod → stream + count →
fsync → validate → link no-clobber → unlink → fsync_dir), the `.parts/` scratch dir and its sweep,
the regular-file/no-symlink dereference rule (`is_served_file`), and the magic-byte readers. What is
NEW here is exactly the transport and the kinds:

  * **Transport B — id-addressed staging + claim-by-rename** (§3, council-unanimous). `PUT
    /api/attachments/staging/{filename}` mints an opaque server-random id and lands the bytes at
    `staging/{id}-{filename}`; the chat POST then CLAIMS each id into `{thread_id}/`. The thread does
    not exist until that POST (`agent.py`'s lazy create), which is why the upload cannot be
    thread-addressed — id-addressed staging removes thread identity from the upload entirely.
  * **The staging filename IS the metadata carrier** (confirm-round NEW 2). No sidecar, no in-memory
    registry: the id is a fixed 32-hex prefix, the admitted CANDIDATE name is the rest, and every
    other fact (kind, mime, dimensions, size, character count) is re-derived from the BYTES at claim.
    One store of truth, and it survives a restart for free — which an in-memory map would not.
  * **The claim is the only writer into a thread dir** (§3, test-pinned). It resolves the FINAL
    collision-suffixed name there, links it, then unlinks the staging file — and the UNLINK is what
    makes a claim exclusive: two racers link two different names, exactly one unlink succeeds, and
    the loser removes what it linked and refuses. A consumed/expired/unknown id is a plain refusal
    (409): a chat POST retried after a lost response therefore re-attaches rather than double-claims
    (the accepted W10-class residual, §10).

**Kinds and admission** (§2): images are magic-byte sniffed (PNG/JPEG/GIF/WebP — **SVG is never an
image here**, it is active content and is not in the extension tier either); a PDF is its `%PDF-`
signature; text CANNOT be byte-authenticated, so it is an explicit extension allowlist plus a
bounded STRICT UTF-8 decode, and a decode failure is a refusal rather than a lossy store. A claimed
PDF also has its text EXTRACTED here, once, into a `.txt` sidecar beside it (§4.3) — after which it
is a text file to every reader, which is why the model feed needed no PDF branch of its own.

**Retention** (§2): deleting a thread deletes its directory, and the boot sweep reclaims (a) staging
files older than `attachments.staging_orphan_hours` and (b) files inside live thread dirs that no
persisted `AttachmentPart` references — the rename-then-insert crash window the confirm round found
(NEW 1), age-bounded so it can never race a claim in flight. Sidecars are referenced by nothing by
design, so the second arm learns them as DERIVED entries (`_with_sidecars`) instead.

Never imports `app.config` (the `core.media` rule): the workspace root and every tunable arrive as
arguments, which is what keeps this module testable against a temp dir and keeps the import edge
one-way.
"""

from __future__ import annotations

import codecs
import contextlib
import ntpath
import os
import re
import secrets
import time
from collections.abc import Collection, Container, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

from app.core.fsutil import atomic_write_text, fsync_dir
from app.core.media import (
    ALLOWED_TYPES,
    StoreWriteError,
    UploadPart,
    admission_reason,
    is_addressable_name,
    is_served_file,
    probe_gif,
    probe_image,
    require_real_dir,
    sweep_scratch_dir,
)
from app.domain.conversation import AttachmentKind, AttachmentPart

#: The workspace subdirectory holding the whole store (`$CTRLB_HOME/attachments/`).
ATTACHMENTS_DIRNAME = "attachments"
#: The ONE flat landing every upload streams into, beside the per-thread dirs. Flat because a staged
#: file belongs to no thread yet (§3) — and because it is the landing a future Android `share_target`
#: needs, which is the one shape decision made with a recorded follow-up in mind.
STAGING_DIRNAME = "staging"

#: The URL root of the staging surface. Declared HERE so the router and any future consumer read one
#: prefix (the `MEDIA_URL_ROOT` precedent).
ATTACHMENTS_URL_ROOT = "/api/attachments"

#: How many random bytes an `attachment_id` carries. 16 → 32 hex characters: unguessable, which is
#: what lets an id be the WHOLE claim credential (E2 — ids are server-minted, never client-authored).
_ID_BYTES = 16
_ID_RE = re.compile(r"^[0-9a-f]{32}$")
#: What separates the id from the candidate name in a staged file's name. The id is fixed-length hex,
#: so the split is unambiguous even when the owner's own filename contains the separator.
_ID_SEP = "-"

#: The sniffed image FORMAT → the Content-Type it is served/recorded as. Keyed by format rather than
#: by extension, because for images the BYTES decide (§2) and the extension is only ever a claim.
#: `gif` is here and deliberately absent from `media.ALLOWED_TYPES`: the media mount does not serve
#: GIFs, an attachment may be one.
IMAGE_MIME: dict[str, str] = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}

#: extension → Content-Type for the TEXT kinds — the one kind bytes cannot authenticate, so this
#: table plus a strict decode IS the admission rule (§2, E-sweep). Deliberately narrow: the owner
#: ruled configs and logs OUT of scope (§0a-1 — "the agent reads those itself"), so this is prose and
#: data the owner hands over, not the machine's own files.
TEXT_TYPES: dict[str, str] = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
}

PDF_SUFFIX = ".pdf"
PDF_MIME = "application/pdf"
#: A PDF's signature, at offset 0 (ISO 32000-1 §7.5.2). Strict placement on purpose: the spec allows
#: leading junk that readers tolerate, and tolerating it here would admit a file whose first bytes are
#: something else entirely.
PDF_MAGIC = b"%PDF-"

#: Extensions the MINT admits — the union of the three kinds' tiers, and the only parameter
#: `admission_reason` needs to serve this surface as well as the media one. Image extensions come
#: from the media allowlist plus `.gif`; the extension is not what BINDS an image (the bytes are),
#: but a name whose extension promises nothing we accept is refused before a single byte streams.
ALLOWED_SUFFIXES: frozenset[str] = frozenset(
    {*ALLOWED_TYPES, ".gif", *TEXT_TYPES, PDF_SUFFIX},
)

#: How far the collision walk goes before giving up (`photo.png` → `photo-1.png` → …). A structural
#: bound like `MAX_NAME_BYTES`, not a tunable: reaching it means a thread holds a thousand files of
#: one name, which is a refusal worth stating rather than a loop worth widening.
_MAX_COLLISION_SUFFIX = 999

#: How much of a text file is decoded per hop. The whole file is validated (a decode failure anywhere
#: is a refusal), but never held in memory at once.
_DECODE_CHUNK = 1 << 16

#: The refusal sentence a claim answers with. It NAMES THE FIX (§3): the id is gone, so re-attaching
#: the file is the only thing that can work, and a client told merely "409" would retry the send.
CLAIM_REFUSED = (
    "one of the attached files is no longer staged (it was already sent, or it expired) — "
    "re-attach the file and send again"
)


# ── paths ─────────────────────────────────────────────────────────────────────────────────────────


def attachments_root(home: Path) -> Path:
    """`$CTRLB_HOME/attachments/`. Takes the home path as an ARGUMENT — this module never imports
    `app.config` (the `core.media` rule)."""
    return home / ATTACHMENTS_DIRNAME


def staging_dir(home: Path) -> Path:
    return attachments_root(home) / STAGING_DIRNAME


def thread_dir(home: Path, thread_id: str) -> Path:
    """The directory one thread's attachments live in.

    **The only path builder for a thread dir in the whole app** — the claim, the sweep and the delete
    hook all come through here, and an architecture test pins that nothing outside this module calls
    it. That is what makes "the claim is the only writer" (§3) checkable rather than merely intended.

    The id is SERVER-owned (a row in `threads`), so the bare-name check here is defence in depth
    rather than input validation — but confinement is a rule, not a property of the directory
    (§10), and this is the one place a rule about the path can be stated once. `ntpath` decides the
    separator question whatever the server OS is: the hazard belongs to the path API, not to the
    platform (the closed OS-branch allowlist, ARCHITECTURE §6) — `delete_file`'s reasoning, reused.
    """
    if not is_addressable_name(thread_id) or "\\" in thread_id or ntpath.splitdrive(thread_id)[0]:
        raise StoreWriteError(500, f"{thread_id!r} is not a thread id this store can address")
    return attachments_root(home) / thread_id


def _real_root(home: Path) -> Path | None:
    """The store root when it is a REAL directory, else `None` — the housekeeping gate (S1 MED-1).

    Every path the retention functions below touch has the root as its ancestor, so a root that is a
    symlink relocates the whole walk: `sweep_thread_dirs` would read the link target's children,
    decide the ones it does not recognise are dead threads, and unlink aged files OUTSIDE
    `$CTRLB_HOME` entirely (reviewer-reproduced). Checking the root is therefore not one guard among
    several — it is the ancestor the per-child `is_symlink`/`is_served_file` checks already assume.

    `require_real_dir` is the SAME predicate the write path uses (`prepare_staging`, `claim`), reused
    rather than restated: one answer to "is this store tree in a shape we may touch". Root-only and
    one level deep, exactly like `ensure_media_dirs` — walking `$CTRLB_HOME`'s own ancestors would be
    TOCTOU theatre against someone who already has shell on the box (SECURITY_MODEL §1).

    Returns rather than raises, because housekeeping FAILS CLOSED: the callers are a boot sweep and a
    thread delete, and neither may fail over a store tree only an operator can fix. A missing root is
    not a refusal — `require_real_dir` passes on a path that does not exist, and the walks below
    already answer "nothing there" with 0.
    """
    root = attachments_root(home)
    try:
        require_real_dir(root)
    except StoreWriteError:
        return None
    return root


def prepare_staging(home: Path) -> Path:
    """Create (and shape-check) the staging dir, returning it.

    Lazily rather than at boot: the store has no registry to walk, so "does the tree exist" is a
    question only a write needs answered, and a first-run install that never attaches anything grows
    no empty folders. `require_real_dir` is the media write path's own guard (a symlink there would
    relocate every upload outside the workspace) applied to both rungs of the spine.
    """
    root = attachments_root(home)
    require_real_dir(root)
    root.mkdir(parents=True, exist_ok=True)
    staging = staging_dir(home)
    require_real_dir(staging)
    staging.mkdir(parents=False, exist_ok=True)
    return staging


# ── ids + the staged filename (the metadata carrier) ──────────────────────────────────────────────


def mint_id() -> str:
    """A fresh opaque `attachment_id` — 32 hex characters of CSPRNG (E2)."""
    return secrets.token_hex(_ID_BYTES)


def staged_name(attachment_id: str, filename: str) -> str:
    """The staging filename: the id, the separator, then the ADMITTED candidate name.

    Both halves are load-bearing. The id makes the file addressable by a claim that trusts nothing
    the client says; the candidate name is what the final (collision-suffixed) name is derived from
    at claim, when the thread — and therefore the collision — finally exists (confirm-round NEW 2:
    promising a final name at mint is impossible).
    """
    return f"{attachment_id}{_ID_SEP}{filename}"


def candidate_of(staged: str) -> str | None:
    """The candidate name inside a staged filename, or `None` when the name is not one of ours.

    The id is fixed-length hex, so this is a slice rather than a split — an owner's filename
    containing the separator cannot confuse it.
    """
    if len(staged) <= len(_ID_SEP) + 32 or staged[32] != _ID_SEP:
        return None
    if not _ID_RE.match(staged[:32]):
        return None
    return staged[33:] or None


# ── the sniff: what the bytes actually are ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Sniff:
    """What one stored file IS — the facts an `AttachmentPart` is built from (§2).

    Produced at MINT (so a refusal costs the client one round trip, not a whole send) and again at
    CLAIM (so the persisted part describes the bytes the store actually holds, never a claim made
    about them earlier).
    """

    kind: AttachmentKind
    mime: str
    width: int | None = None
    height: int | None = None
    #: The decoded character count, for `text` only — the `inline_chars` FACT (§2).
    chars: int | None = None


def _decoded_chars(path: Path) -> int | None:
    """The character count of a STRICT UTF-8 decode of the whole file, or `None` if it is not text.

    Incremental (`codecs`) so a multi-byte character split across two reads decodes correctly and so
    a 10 MB file is never materialised as one string — the cap already bounds the file, this bounds
    the memory. Strict: a decode failure is a REFUSAL (§2), because a text attachment whose bytes we
    had to guess at is a file the model would be shown wrongly.
    """
    decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
    chars = 0
    try:
        with path.open("rb") as f:
            while chunk := f.read(_DECODE_CHUNK):
                chars += len(decoder.decode(chunk))
            chars += len(decoder.decode(b"", final=True))
    except UnicodeDecodeError:
        return None
    except OSError:
        return None
    return chars


def sniff_file(path: Path, filename: str) -> Sniff:
    """Classify the stored bytes, or refuse them (`415`).

    **Bytes first, extension only where bytes cannot speak** (§2). An image is whatever the header
    says it is — so a photo saved as `notes.txt` is still an image, and an `.png` holding HTML is not
    one. A PDF is its signature. Only TEXT falls through to the extension table, because there is no
    byte pattern that means "text"; the strict decode is the second half of that rule and refuses
    what it cannot read.

    SVG is unreachable by construction rather than by a clause: it is in no tier here, so it is
    refused at the mint's name predicate, and nothing that arrives under another extension can sniff
    as an image (§8).
    """
    probe = probe_image(path)
    if probe.fmt is None:
        probe = probe_gif(path)
    if probe.fmt is not None and probe.fmt in IMAGE_MIME:
        return Sniff("image", IMAGE_MIME[probe.fmt], probe.width, probe.height)
    try:
        with path.open("rb") as f:
            head = f.read(len(PDF_MAGIC))
    except OSError:  # pragma: no cover — the file was written moments ago, in this process
        head = b""
    if head == PDF_MAGIC:
        return Sniff("pdf", PDF_MIME)
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_TYPES:
        chars = _decoded_chars(path)
        if chars is None:
            raise StoreWriteError(
                415,
                f"the {suffix} file is not valid UTF-8 text — a text attachment is stored and read "
                "as text, so one that cannot be decoded cannot be stored",
            )
        return Sniff("text", TEXT_TYPES[suffix], chars=chars)
    raise StoreWriteError(
        415,
        "the bytes are not an accepted attachment — images (PNG, JPEG, GIF, WebP), PDFs, and UTF-8 "
        f"text files ({', '.join(sorted(TEXT_TYPES))}) only",
    )


# ── the mint (the staging PUT's server half) ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class StagedFile:
    """What the mint answers with: the claim credential plus what the server learned from the bytes.

    `name` is the CANDIDATE (the admitted name as uploaded), never a promise about the final stored
    name — that is resolved at claim against the thread's directory (confirm-round NEW 2).
    """

    attachment_id: str
    name: str
    kind: AttachmentKind
    mime: str
    bytes: int
    width: int | None = None
    height: int | None = None
    chars: int | None = None


def finish_staging(part: UploadPart, staging: Path, attachment_id: str, filename: str) -> StagedFile:
    """The ladder's tail for a staged upload: seal → SNIFF the bytes → land under the staged name.

    The order is the media ladder's verbatim (D65/R55 §4.4) and it is the security control, not a
    style: the bytes are validated BEFORE the file has a name anything can address, so a refused
    upload leaves zero bytes and never a half-file the claim could later pick up. Blocking by
    construction (fsync, a whole-file decode, three link/unlink syscalls) — the route hops it onto a
    thread, exactly as `media_upload` does.
    """
    part.seal()
    sniff = sniff_file(part.path, filename)
    size = part.received
    part.land_new(staging / staged_name(attachment_id, filename))
    return StagedFile(
        attachment_id=attachment_id,
        name=filename,
        kind=sniff.kind,
        mime=sniff.mime,
        bytes=size,
        width=sniff.width,
        height=sniff.height,
        chars=sniff.chars,
    )


# ── the claim ─────────────────────────────────────────────────────────────────────────────────────


def _staged_path(staging: Path, attachment_id: str) -> Path | None:
    """The staged file for `attachment_id`, or `None` — unknown, consumed, or not a regular file.

    A directory scan rather than a constructed path, because only the SERVER knows the candidate name
    the id was minted with (the client's copy of it is a claim, and the whole point of an opaque id
    is that nothing else about the request has to be trusted). `is_served_file` is the media
    dereference rule: a symlink or a directory answering to the prefix is not a file we will open
    (§2, E9).
    """
    if not _ID_RE.match(attachment_id):
        return None
    prefix = f"{attachment_id}{_ID_SEP}"
    try:
        entries = list(staging.iterdir())
    except OSError:
        return None
    for p in entries:
        if p.name.startswith(prefix) and is_served_file(p):
            return p
    return None


def _name_is_free(directory: Path, name: str) -> bool:
    """Is `name` free for a claim — as a stored file AND as the sidecar a stored file would write?

    A claim reserves TWO entries in the thread dir: the file itself, and `sidecar_name(name)`, which
    is where this file's extracted text goes if it turns out to be a PDF. Checking only the first let
    a sidecar land on top of an attachment the owner had already sent (S4 MED-1, reviewer-reproduced):
    `report.pdf.txt` attached, then `report.pdf` — the second claim found `report.pdf` free, and the
    sidecar write then REPLACED the stored, part-referenced text file beside it.
    """
    return not (directory / name).exists() and not (directory / sidecar_name(name)).exists()


def _final_name(directory: Path, candidate: str) -> str:
    """The name this file will be stored under: the candidate, or the first `-N` suffix free of BOTH
    that name and its sidecar's.

    Resolved HERE, at claim, and not at mint: until the chat POST creates the thread there is no
    directory to collide in (confirm-round NEW 2). The walk is a plain check-then-act, and it does
    not need to be atomic — the LINK below is, and it is what actually decides the name.

    **The sidecar name is reserved UNIFORMLY, for every claim** (MED-1), not just for the PDFs that
    will actually write one: the kind is not known here. The sniff runs AFTER the move (S1's accepted
    ordering — the bytes are described where they finally live), so at naming time this file could be
    anything, and a rule that only applied to PDFs would have to be applied a syscall too late. The
    cost is an occasional extra collision suffix on a non-PDF whose `.txt` twin happens to be in the
    thread — ordinary name-mangling, and the same suffix the owner already sees when they attach the
    same photo twice.
    """
    if _name_is_free(directory, candidate):
        return candidate
    stem, suffix = Path(candidate).stem, Path(candidate).suffix
    for n in range(1, _MAX_COLLISION_SUFFIX + 1):
        name = f"{stem}-{n}{suffix}"
        if _name_is_free(directory, name):
            return name
    raise StoreWriteError(409, f"too many files named {candidate!r} in this conversation")


def claim(
    home: Path, thread_id: str, attachment_id: str, *, max_age_s: float, pdf_bounds: PdfBounds
) -> AttachmentPart:
    """Move one staged file into the thread's directory and describe it. Refuses with `409`.

    The whole contract of transport B lives in this function (§3):

      * the id must be UNCLAIMED (a staged file still answers to it) and YOUNG (younger than
        `attachments.staging_orphan_hours` — the same number the sweep reclaims by, so a file the
        sweep would take can never still be claimable);
      * the FINAL name is resolved against the thread dir now that it exists;
      * `os.link` gives the bytes that name no-clobber, and the following `os.unlink` of the staging
        file is what makes the claim EXCLUSIVE: two concurrent claimants link two different names,
        exactly one unlink succeeds, and the loser undoes its link and refuses. (`os.replace` — the
        plan's shorthand — would have clobbered whatever the resolved name already held, which is the
        one thing the collision suffix exists to prevent.)
      * the `AttachmentPart` is built from a FRESH sniff of the landed file, so the persisted facts
        describe the bytes the store actually holds;
      * a PDF has its text EXTRACTED here, once, into the sidecar the feed reads (S4 §4.3) — the
        claim is the only moment the bytes are new, and the sidecar is then read for the life of the
        thread. `pdf_bounds` carries the two `attachments:` knobs that bound it (the settings seam
        passes them in; this module never imports config).

    The rename cannot sit inside the message's SQLite transaction (confirm-round NEW 1), so a crash
    between this call and the insert leaves an unreferenced file in a live thread dir — reclaimed by
    `sweep_thread_dirs` below, which is the whole reason that arm exists.

    Blocking (directory scans, link/unlink, fsync, a whole-file decode): callers hop it onto a thread.
    """
    staging = staging_dir(home)
    source = _staged_path(staging, attachment_id)
    if source is None:
        raise StoreWriteError(409, CLAIM_REFUSED)
    try:
        st = source.stat()
    except OSError:
        raise StoreWriteError(409, CLAIM_REFUSED) from None
    if time.time() - st.st_mtime > max_age_s:
        # Expired rather than deleted — the sweep is a boot-time job, so freshness has to be a rule
        # the claim itself enforces or a staged file would stay claimable for as long as the process
        # happens to live.
        raise StoreWriteError(409, CLAIM_REFUSED)
    candidate = candidate_of(source.name)
    if candidate is None:  # pragma: no cover — `_staged_path` matched the id prefix already
        raise StoreWriteError(409, CLAIM_REFUSED)

    directory = thread_dir(home, thread_id)
    require_real_dir(directory)
    directory.mkdir(parents=True, exist_ok=True)
    name = _final_name(directory, candidate)
    # A suffixed name can outgrow the byte budget the mint admitted the candidate under, and a name
    # the app would refuse to MINT is not one it may create here either.
    reason = admission_reason(name, allowed_suffixes=ALLOWED_SUFFIXES)
    if reason is not None:
        raise StoreWriteError(409, reason)
    target = directory / name
    try:
        os.link(source, target)
    except FileNotFoundError:
        # The other claimant finished BEFORE our link (the mirror of the unlink race below): the
        # staged file it consumed is the one we resolved a syscall ago. Both orderings of the race
        # therefore end in the same refusal, and only one of the two claimants ever gets the bytes.
        raise StoreWriteError(409, CLAIM_REFUSED) from None
    except FileExistsError:
        # `_final_name` proved the name free a syscall ago; reaching here means something else took
        # it (or a dangling symlink occupies it), and the honest answer is the same refusal.
        raise StoreWriteError(409, CLAIM_REFUSED) from None
    try:
        source.unlink()
    except OSError:
        # Another claimant consumed the staging file between the link and here: the id is theirs, so
        # undo the copy this claim made and refuse. Exactly one of the two can reach this line
        # successfully — the unlink is the atomic claim.
        with contextlib.suppress(OSError):
            target.unlink()
        raise StoreWriteError(409, CLAIM_REFUSED) from None
    fsync_dir(directory)
    sniff = sniff_file(target, name)
    # `chars` is a TEXT fact (the strict decode at sniff); for a PDF the equivalent fact is the length
    # of the SIDECAR it reads through, which is what `_write_pdf_sidecar` answers with. Either way
    # `inline_chars` is the whole length of the part's inline source — never
    # `min(len, max_inline_chars)`, which is priced at READ (confirm N1) — so the estimator's
    # `priced_inline_chars` starts pricing PDFs for real with no change of its own.
    inline_chars = sniff.chars
    if sniff.kind == "pdf":
        inline_chars = _write_pdf_sidecar(directory, name, pdf_bounds)
    return AttachmentPart(
        kind=sniff.kind,
        name=name,
        mime=sniff.mime,
        path=f"{thread_id}/{name}",
        bytes=target.stat().st_size,
        width=sniff.width,
        height=sniff.height,
        inline_chars=inline_chars,
    )


def claim_all(
    home: Path,
    thread_id: str,
    attachment_ids: Sequence[str],
    *,
    max_age_s: float,
    pdf_bounds: PdfBounds,
) -> list[AttachmentPart]:
    """Claim every id of one send, in order. The FIRST refusal aborts the whole send (§3).

    All-or-nothing on the REFUSAL, not on the moves: an id that already claimed stays claimed, and
    its file is left in the thread dir for the sweep's referenced-set arm to reclaim. That is the
    same crash-window class the plan already accepts (NEW 1) rather than a rollback machine nothing
    else in this codebase carries — and the owner's remedy is the one the copy names: re-attach.
    """
    return [claim(home, thread_id, aid, max_age_s=max_age_s, pdf_bounds=pdf_bounds) for aid in attachment_ids]


# ── reading a stored file (S2 — the model feed's only door to the bytes) ──────────────────────────


#: What a PDF's extracted-text sidecar is called: the stored name plus this suffix, so `report.pdf`
#: reads back through `report.pdf.txt`. Declared HERE, with the rest of the store's naming, because S2
#: READS it (§4.3 — "resolve to the sidecar if present") and S4 WRITES it: two slices, one constant, no
#: convention to re-agree on. The suffix rides on the FULL name rather than replacing `.pdf` so it can
#: never collide with a `report.txt` the owner attached beside it.
#:
#: A sidecar is a file inside a live thread dir that no persisted `AttachmentPart` references, which
#: is exactly what `sweep_thread_dirs`' second arm reclaims once it ages past `staging_orphan_hours`
#: — so S4's obligation was to teach the sweep about it, or ship a file that deletes itself a day
#: later. `_with_sidecars` below is that: the referenced set grows a DERIVED entry per referenced
#: file, at the one place the sweep consumes it, so no caller has to remember the rule.
SIDECAR_SUFFIX = ".txt"


def sidecar_name(name: str) -> str:
    """The extracted-text sidecar's stored name for `name` (S4 writes it, S2 reads it).

    Takes a NAME or a store-relative PATH — the suffix rides on the end either way, which is what
    lets `_with_sidecars` derive `{thread}/{name}.txt` entries from the persisted `path`s without a
    second naming rule.
    """
    return f"{name}{SIDECAR_SUFFIX}"


# ── the sidecar's WRITER: PDF text extraction at claim (S4, §4.3) ─────────────────────────────────


@dataclass(frozen=True)
class PdfBounds:
    """How far one PDF extraction may go — the two `attachments:` knobs, as ONE argument (§4.3/§6).

    An object rather than two loose keywords on `claim`/`claim_all`: extraction is the dimension of
    this store most likely to grow another knob (a page RANGE, a per-kind opt-out, whatever OCR would
    need if it ever stops being out of scope), and the extend-don't-migrate directive says the next
    dimension should be an optional field with a default here rather than a fourth keyword threaded
    through two functions and the seam. The knobs still arrive as arguments — `core` never imports
    `app.config`, so `services/agent/attachments.py` is the one place they are read off `Settings`.

    **Both bounds are SOFT, and saying so is the ruling** (§0b-3, owner-ratified): they stop the
    ITERATION — no further page is extracted once either is reached — and they cannot kill one
    pathological `extract_text()` call, which is a single library call this code does not get to
    interrupt. `max_chars` is therefore a stopping rule, not a truncation: the page that crosses it
    rides WHOLE, because cutting a page mid-word would hand the model a fragment it was told nothing
    about. The bound the model actually sees is elsewhere and hard — `attachments.max_inline_chars`
    caps the injected page, and the §4.2 marker names exactly what it left behind.
    """

    max_pages: int
    max_chars: int


#: What a PDF's sidecar holds when nothing could be read out of it — a scan, an image-only export, or
#: a file that sniffed as a PDF and then would not parse (§4.3; OCR is out of scope). ONE wording for
#: every one of those, because the model can act on none of the differences: what it needs is that the
#: file is here, that its text is not, and that asking the owner is the way forward. It is the
#: sidecar's CONTENT, so it reaches the model through the ordinary §4.2 frame — a "lines 1–1 of 1"
#: page — rather than as a second kind of stub the estimator would have to know about.
NO_TEXT_SIDECAR = (
    "No text could be extracted from this PDF — it is most likely a scan or an image-only "
    "document. The file itself is stored unchanged; ask the owner what it contains.\n"
)


def _extract_pdf_text(path: Path, bounds: PdfBounds) -> str | None:
    """The text of a stored PDF, bounded by `bounds`, or `None` when there is none to be had.

    Page by page with the bound checked BEFORE each one, so the iteration stops rather than running
    a 900-page document to completion and throwing the tail away. Pages that yield nothing are
    skipped silently — a mixed document (a scanned cover, then real text) should read as its text.

    Newlines are normalised to LF and the ends trimmed: the sidecar is a TEXT file this store
    authors, and every reader downstream (`read_page`, the D64 paging, the §4.2 marker's line
    counts) is line-oriented, so a CR that arrived from a PDF's own layout would otherwise become a
    phantom line break in what the model is told it read.
    """
    try:
        reader = PdfReader(str(path))
        chunks: list[str] = []
        chars = 0
        for index, page in enumerate(reader.pages):
            if index >= bounds.max_pages or chars >= bounds.max_chars:
                break
            text = page.extract_text() or ""
            if not text:
                continue
            chunks.append(text)
            chars += len(text)
    except Exception:
        # pypdf raises a family of its own errors on a malformed, truncated or encrypted file, and a
        # hostile one can reach past them (a deep object graph is a RecursionError, a huge one a
        # MemoryError). Every outcome means the same thing to a claim that has already landed the
        # bytes: there is no text. Never `BaseException` — a cancellation is not an extraction result.
        return None
    text = "\n".join(chunks).replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    # …and the sidecar is a file this store AUTHORS, so it is made VALID here, at authorship (S4
    # MED-2, reviewer-reproduced). pypdf decodes a font's ToUnicode CMap with `surrogatepass`, so a
    # hostile — or merely broken — map hands back a LONE SURROGATE, which no UTF-8 writer will encode:
    # the sidecar write raised `UnicodeEncodeError` (not `OSError`, so `_write_pdf_sidecar`'s handler
    # never saw it) and failed the whole claim AFTER it had consumed the id. Sanitising rather than
    # refusing is the ruling — one hostile glyph must not discard a document's real text — and the two
    # rules do not conflict: the STRICT-decode refusal (§2) governs FOREIGN bytes the owner hands over,
    # while what this store writes it owes to be valid. The round trip is exactly what a strict reader
    # downstream would do with these bytes, so the bad glyph becomes U+FFFD and nothing else moves.
    text = text.encode("utf-8", "surrogatepass").decode("utf-8", "replace")
    return f"{text}\n" if text else None


def _publish_text_exclusive(path: Path, text: str) -> bool:
    """Write `text` durably and publish it at `path` NO-CLOBBER. `False` when the name was taken.

    `atomic_write_text`'s discipline with its LAST syscall swapped, and the swap is the point (MED-1):
    the house writer ends in `os.replace`, which overwrites whatever holds the name — and a sidecar
    may never do that, because `report.pdf.txt` can be a file the owner attached. So the durable half
    is the house writer's, REUSED on a temp sibling rather than restated (one mkstemp/fsync recipe in
    this codebase, still), and publication is the store's own `os.link` + `os.unlink` idiom — the same
    three syscalls the claim itself lands bytes with, for the same reason: a link either creates the
    name or raises, with no check-then-act window between the look and the write.

    Defence in depth rather than the primary guard: `_final_name` has already reserved this name for
    the file being claimed. Reaching `FileExistsError` therefore means something took it in the
    sub-millisecond window between that walk and here, and the answer is no sidecar at all (`False` →
    the §4.5 stub) — the temp goes, so what the window can leave behind is a claim without extracted
    text, never a clobbered attachment. `OSError` from the WRITE (a full disk, a directory pulled out
    from under us) still propagates to `_write_pdf_sidecar`'s handler, which is where "the sidecar
    could not be written" has always been answered.
    """
    tmp = path.with_name(f".tmp-{secrets.token_hex(8)}{SIDECAR_SUFFIX}")
    try:
        atomic_write_text(tmp, text)
        try:
            os.link(tmp, path)
        except OSError:
            return False
    finally:
        with contextlib.suppress(OSError):
            tmp.unlink()
    fsync_dir(path.parent)
    return True


def _write_pdf_sidecar(directory: Path, name: str, bounds: PdfBounds) -> int | None:
    """Extract one claimed PDF's text and write its sidecar; return the sidecar's character count.

    The ONE extraction site (`claim` is its only caller), and the ONE writer of a sidecar — which
    keeps the §3 "the claim is the only writer into a thread dir" property intact rather than
    bending it: this runs inside the store module, inside the claim, before the part exists.

    Durable through `atomic_write_text`, the house writer (D26/D57) — a temp sibling in the SAME
    directory, fsync'd — and published no-clobber by `_publish_text_exclusive` above, because a
    sidecar's name can be an attachment's name (MED-1). Same-dir matters here for the same reason it
    does there: a cross-volume link is not possible and a torn sidecar would be read as the file's text.

    `None` means "no sidecar" and therefore no `inline_chars`: the part then renders as the §4.5
    document stub, which is the honest description of a PDF whose text is not on disk. It is
    reserved for a WRITE that failed (a full disk, a directory pulled out from under us, a name taken
    under us) — an extraction that found nothing gets the `NO_TEXT_SIDECAR` one-liner instead, because
    "we looked and there is no text" is a fact worth telling the model, and the estimator prices it.
    """
    text = _extract_pdf_text(directory / name, bounds) or NO_TEXT_SIDECAR
    try:
        published = _publish_text_exclusive(directory / sidecar_name(name), text)
    except OSError:
        return None
    return len(text) if published else None


def stored_file(home: Path, thread_id: str, name: str) -> Path | None:
    """The path of one stored attachment, or `None` when it is not a file this store may open.

    PUBLIC because the S3 serving route needs the PATH itself rather than the bytes (it streams the
    file with `FileResponse`), and the route may not build one: every path into a thread dir is this
    module's (the S1 LOW-4 pin), so the read resolver is the seam a reader asks through — exactly as
    `read_bytes` and `read_page` do for their own shapes.

    The §2 dereference rule in one place, for READS this time: a bare name (no separator, no drive,
    not `.`/`..`), a resolved parent that is EXACTLY the resolved thread directory, and
    `is_served_file` — the media rule that answers "is this a regular, non-symlink file" — so a link
    planted inside a thread dir cannot make this read something outside it. Reusing those predicates
    rather than restating them is the point (E9: no second sanitizer).

    The name always comes from the server's OWN persisted `AttachmentPart`, so this is defence in
    depth rather than input validation — but the tool's `name` argument is model-authored, and a rule
    that is only true because of who calls it is exactly the one worth stating once.

    The two ANCESTORS are gated first (S2 LOW-3), with the housekeeping arms' own predicates: a
    symlinked ROOT relocates the whole store (`_real_root`, S1 MED-1), and a symlinked THREAD DIR makes
    the resolved-parent equality below VACUOUS — both sides resolve through the same link, so the
    check passes while the file read is outside the workspace entirely. The per-file checks stand
    unchanged; these guard the directories they hang from, exactly as `remove_thread_attachments` does.
    """
    if not is_addressable_name(name) or "\\" in name or ntpath.splitdrive(name)[0]:
        return None
    if _real_root(home) is None:
        return None
    try:
        directory = thread_dir(home, thread_id)
    except StoreWriteError:
        return None
    if directory.is_symlink():
        return None
    path = directory / name
    if not is_served_file(path):
        return None
    try:
        if path.resolve(strict=True).parent != directory.resolve(strict=True):
            return None
    except OSError:
        return None
    return path


def read_bytes(home: Path, thread_id: str, name: str) -> bytes | None:
    """One stored file's raw bytes, or `None` when it is gone/unreadable/not addressable.

    The assembly's image branch reads through here (§4.1) — the store owns file access, so nothing
    outside this module builds a path into a thread dir (the S1 LOW-4 pin). Whole-file by design: the
    caller is base64-encoding it for the wire, and `attachments.max_file_mb` already bounds it.
    """
    path = stored_file(home, thread_id, name)
    if path is None:
        return None
    try:
        return path.read_bytes()
    except OSError:
        return None


@dataclass(frozen=True)
class StoredRead:
    """One PAGE of a stored text file — the D64 read contract (§2.1), applied to the attachment store.

    The rules are D64's, because the model already knows them from `core_memory`: pages break only at
    LINE boundaries, `first_line`/`last_line` are 1-based inclusive, and `chars`/`lines` describe the
    WHOLE file so the marker can always say how much is left. One shape serves both consumers: the
    §4.2 injection at assembly and the `read_attachment` tool, so what the turn was given and what a
    paged re-read returns cannot describe themselves differently.

    **One D64 rule BENDS here** (S2 MED-1, main-seat ruling). D64 emits a line longer than the budget
    WHOLE, because a partial line would advertise coverage of characters the model never saw. That was
    written for topics the MODEL authored, where a mega-line does not occur; an attachment is FOREIGN —
    a minified `.json`, a one-line CSV export, a log with no newlines — so the whole-line rule made
    `max_inline_chars` advisory: one 10 MiB line rode into the prompt entire while the estimator priced
    the cap. An oversized first line is therefore CUT at the budget and `line_truncated` records it.
    The honesty D64 was protecting is kept where it belongs — in the MARKER, which states the cut
    rather than claiming coverage of the rest of the line.
    """

    name: str
    text: str
    chars: int  # the full decoded length on disk
    lines: int  # the file's total line count
    first_line: int
    last_line: int  # inclusive; 0 for the empty-file page
    #: Was this page's last line cut at `max_chars` (MED-1)? Facts-only, like every other field here —
    #: the framing layer (`inline_marker`, the tool's page head) turns it into the sentence the model
    #: reads, so the store never owns wording.
    line_truncated: bool = False

    @property
    def complete(self) -> bool:
        """Did this ONE page carry the whole file? A CUT line means no, whatever the line span says:
        the characters past the cut are on disk and the model was never shown them."""
        return self.first_line == 1 and self.last_line == self.lines and not self.line_truncated


class StoredReadError(Exception):
    """A read this store refuses, carrying the sentence the MODEL is shown (never a status code).

    Distinct from `StoreWriteError`: nothing here writes, so there is no HTTP status to carry and no
    ladder to unwind — the caller turns this straight into an ERROR `ToolResult` whose text names the
    call that would work instead (the D64 refusal discipline).
    """


def read_page(
    home: Path,
    thread_id: str,
    name: str,
    *,
    offset: int = 1,
    limit: int | None = None,
    max_chars: int,
) -> StoredRead:
    """One page of a stored TEXT file, starting at the 1-based line `offset` (D64 §2.1). Read-only.

    Raises `StoredReadError` for the two refusals the model can act on — a file this store cannot
    read, and an `offset` past the end (which states the real line count) — with the empty-file
    exception carved out at `offset=1` exactly as `core_memory.read_topic` carves it, so a blank
    attachment has a complete page rather than a refusal.

    Strict UTF-8: text is admitted only after a strict whole-file decode at claim (§2), so a failure
    here means the bytes changed underneath us, and guessing at them would show the model a file that
    is not the one on disk.

    `max_chars` is a HARD bound on the returned text (MED-1): a page's first line is emitted whole
    unless the line ALONE is over budget, in which case it is cut there and the page ends — see
    `StoredRead` for why the D64 whole-line rule bends for a foreign file.
    """
    if offset < 1:
        raise StoredReadError(f"`offset` is a 1-based line number — {offset} is not one.")
    path = stored_file(home, thread_id, name)
    if path is None:
        raise StoredReadError(f"no attachment named {name!r} on this conversation.")
    try:
        raw = path.read_bytes().decode("utf-8")
    except OSError:
        raise StoredReadError(f"{name} could not be read from the attachment store.") from None
    except UnicodeDecodeError:
        raise StoredReadError(f"{name} is no longer readable as UTF-8 text.") from None
    lines = raw.splitlines(keepends=True)  # endings KEPT: the page is an exact substring of the file
    if offset > len(lines) and not (offset == 1 and not lines):
        raise StoredReadError(
            f"{name} has {len(lines):,} line(s) — `offset` {offset:,} is past the end. "
            "Read from `offset` 1, or continue at the line the last page's marker named."
        )
    page: list[str] = []
    used = 0
    cut = False
    for line in lines[offset - 1 :]:
        if limit is not None and len(page) >= limit:
            break
        if page and used + len(line) > max_chars:  # a LATER line always breaks at its own boundary
            break
        if not page and len(line) > max_chars:
            # MED-1: the page's first line is over budget ALL BY ITSELF, so it is cut at the budget
            # and the page ENDS here — nothing may follow a line the model only half saw, and the
            # rest of it is unreachable (there is no offset that starts mid-line). This is the one
            # place `max_chars` stops being "where we break" and becomes a bound.
            page.append(line[:max_chars])
            used += max_chars
            cut = True
            break
        page.append(line)  # the first line of a page is otherwise emitted whole (D64)
        used += len(line)
    return StoredRead(
        name=name,
        text="".join(page),
        chars=len(raw),
        lines=len(lines),
        first_line=offset,
        last_line=offset + len(page) - 1,
        line_truncated=cut,
    )


# ── retention: the thread-delete hook + the boot sweep ─────────────────────────────────────────────


def remove_thread_attachments(home: Path, thread_id: str) -> int:
    """Delete one thread's attachment directory; return how many files went (§2 retention).

    Called by `ThreadRepo.delete`, so a deleted conversation leaves no bytes behind. Deliberately
    file-by-file rather than `rmtree`: the store only ever holds regular files this module created,
    so anything else in there is not ours to remove, and a directory that refuses to go (something
    unexpected inside it) is left standing rather than forced.

    An id this store cannot address is a plain 0, not a raise: a CLEANUP that finds nothing to clean
    has done its job, and the delete it rides must never fail over housekeeping. The write path
    (`claim`) keeps the opposite rule — it may never guess where to put bytes. A store ROOT that is
    not a real directory is the same 0 (`_real_root`, MED-1): the directory this would remove is only
    the thread's while the root above it is ours.
    """
    if _real_root(home) is None:
        return 0
    try:
        directory = thread_dir(home, thread_id)
    except StoreWriteError:
        return 0
    if directory.is_symlink():
        return 0
    try:
        entries = list(directory.iterdir())
    except OSError:  # no attachments on this thread — the common case
        return 0
    removed = 0
    for p in entries:
        if is_served_file(p):
            with contextlib.suppress(OSError):
                p.unlink()
                removed += 1
    with contextlib.suppress(OSError):
        directory.rmdir()
    return removed


def sweep_staging(home: Path, *, max_age_s: float) -> int:
    """Reclaim staged files older than `max_age_s`, plus any stranded upload temp; return the count.

    **The age bound is the point** (§2, E-sound): a first chat POST may not have arrived yet, so a
    YOUNG unclaimed staging file must survive this sweep — a client that uploaded three photos and
    then hit send while the app restarted must still be able to send them. Only the aged ones, which
    no send can claim any more (`claim` enforces the same number), are reclaimed.

    Fails CLOSED on a store root that is not a real directory (`_real_root`, MED-1) — a symlinked root
    would point this walk at someone else's files — and keeps the staging dir's own symlink check
    below: the root is the ancestor, that is the directory itself.
    """
    if _real_root(home) is None:
        return 0
    staging = staging_dir(home)
    if staging.is_symlink():
        return 0
    removed = sweep_scratch_dir(staging)  # the media ladder's own `.parts/` temps, same convention
    cutoff = time.time() - max_age_s
    try:
        entries = list(staging.iterdir())
    except OSError:  # nothing staged yet
        return removed
    for p in entries:
        if candidate_of(p.name) is None or not is_served_file(p):
            continue
        try:
            if p.stat().st_mtime > cutoff:
                continue
        except OSError:
            continue
        with contextlib.suppress(OSError):
            p.unlink()
            removed += 1
    return removed


def _with_sidecars(referenced: Collection[str]) -> set[str]:
    """The referenced set, plus the sidecar entry that belongs to each of its files (S4).

    A sidecar is real, live data that NOTHING references — no `AttachmentPart` names it, by design
    (S2 MED-2: the addressable name is the PDF's) — so without this the second sweep arm reclaims
    every extracted text a day after it was written, and the model silently loses the contents of a
    PDF the owner is still asking about.

    Derived for EVERY referenced path rather than only the `.pdf`-suffixed ones, because kind and
    extension are NOT paired in this store: `sniff_file` binds a PDF by its `%PDF-` signature, so a
    PDF the owner's picker named `contract.txt` is a `pdf` part with a `.txt` name and a
    `contract.txt.txt` sidecar. Filtering on the suffix would delete exactly those. The
    over-approximation costs one derived name per attachment and can only ever protect a file called
    `<referenced name>.txt`, which for a PDF IS its sidecar and for anything else is a crash-window
    orphan of that exact name — still reclaimed with the thread when it is deleted.

    Applied where `sweep_thread_dirs` consumes `referenced`, so both entry points (`sweep`, and any
    direct caller) inherit it: a retention rule callers have to remember is one a future caller
    forgets.
    """
    paths = set(referenced)
    return paths | {sidecar_name(p) for p in paths}


def sweep_thread_dirs(
    home: Path,
    *,
    live_thread_ids: Container[str],
    referenced: Collection[str],
    max_age_s: float,
) -> int:
    """Reconcile the per-thread dirs against what the DB actually references; return files removed.

    Two arms, one walk (§2 retention + the §3 crash window):

      * a directory whose THREAD ROW is gone (a delete that raced a crash, or a store predating the
        delete hook) — its files are no longer reachable by anything;
      * a file inside a LIVE thread dir that no persisted `AttachmentPart` references — the
        confirm-round's NEW 1 window: the claim renames, then the message insert commits, and a crash
        between the two leaves exactly this. The retry correctly refuses the consumed id, so nothing
        else will ever pick the file up.

    **Age-bounded, both arms** (the stated requirement): only files older than `max_age_s` are
    candidates, so a claim in flight — whose file exists for a moment before its message row does —
    can never be swept out from under itself. It is the same number the staging sweep uses, on
    purpose: one "how long may an unreferenced byte live" rule for the whole store, rather than a
    second knob that could disagree with the first.

    `referenced` holds store-relative paths (`{thread_id}/{name}`), which is exactly what
    `AttachmentPart.path` persists — the comparison needs no reconstruction on either side. It is
    widened by `_with_sidecars` HERE rather than by its callers, so a PDF's extracted text (which no
    part references, and which the second arm would otherwise reclaim a day after S4 wrote it)
    survives for every caller. The FIRST arm is deliberately untouched by that: a dead thread's
    sidecars are as unreachable as the files they describe, and go with them.

    Fails CLOSED on a store root that is not a real directory (`_real_root`, MED-1): this walk's first
    arm deletes what it does not recognise, so a symlinked root turns "a dead thread's leftovers" into
    "an aged file in whatever directory the link points at" — reviewer-reproduced. The per-directory
    `is_symlink` check below stands unchanged; it guards the children, this guards their ancestor.
    """
    root = _real_root(home)
    if root is None:
        return 0
    cutoff = time.time() - max_age_s
    referenced_set = _with_sidecars(referenced)
    removed = 0
    try:
        dirs = list(root.iterdir())
    except OSError:  # no store yet
        return 0
    for directory in dirs:
        if directory.name == STAGING_DIRNAME or directory.is_symlink() or not directory.is_dir():
            continue
        live = directory.name in live_thread_ids
        try:
            entries = list(directory.iterdir())
        except OSError:
            continue
        for p in entries:
            if not is_served_file(p):
                continue
            if live and f"{directory.name}/{p.name}" in referenced_set:
                continue
            try:
                if p.stat().st_mtime > cutoff:
                    continue
            except OSError:
                continue
            with contextlib.suppress(OSError):
                p.unlink()
                removed += 1
        with contextlib.suppress(OSError):
            directory.rmdir()  # only ever succeeds once the dir is genuinely empty
    return removed


def sweep(
    home: Path,
    *,
    live_thread_ids: Iterable[str],
    referenced: Collection[str],
    max_age_s: float,
) -> int:
    """Both sweep arms, as one boot-time call. Returns the total number of files reclaimed."""
    live = set(live_thread_ids)
    return sweep_staging(home, max_age_s=max_age_s) + sweep_thread_dirs(
        home, live_thread_ids=live, referenced=referenced, max_age_s=max_age_s
    )
