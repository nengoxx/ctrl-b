"""Owner-supplied media — the namespace-generic read-only library (D52/G5; GACHA_PLAN §5.4 + §10.4).

The owner drops image files into `$CTRLB_HOME/media/<ns>/<role>/` from any machine (SSH/SMB) and the
app serves them read-only. **There is no write API and there must never be one here** (§5.4 ruled
option (b)): the app has no application-layer auth — the tailnet IS the boundary (SECURITY_MODEL §1) —
so an upload endpoint would be reachable by anything on the tailnet. This module lists and describes
what is on disk; `app/api/media.py` publishes it and mounts the hardened static surface.

**Namespace-generic by construction** (council M9): `gacha` is the first namespace, and the next
art-bearing theme is a row in `MEDIA_NAMESPACES` — not a new route, not a new mount class. Nothing in
this module or in the API layer knows what a "capsule card" is.

**Drop-in = assignment** (the G1-eyeball re-rule): the role FOLDER a file lands in is what binds it to
a consumer. Ordering INSIDE a role is `ROLE_COLLATION` by default, overridden per role by the Conf
gallery's persisted `media.<ns>.roles.<role>.order` (§5.4's 2026-08-04 ruling).

**No decoder dependency.** User files get no server-side re-encode and no Pillow (a new runtime dep
AND an untrusted-decoder surface, §10.4). `probe_image` below is a stdlib magic-byte + dimension
reader: it gives the format allowlist its ground truth (the byte header, never the extension) and
hands the Conf gallery the numbers it warns on before the phone tries to decode ~51 MB of bitmap.
The WARNING is the client's to make (MEDIA_PLAN §5) — this module ships facts, plus the one verdict
that needs the bytes (`unusable_reason`); "too big" is per-role policy the front-end registry holds.
"""

from __future__ import annotations

import re
import stat
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Literal
from urllib.parse import quote

from pydantic import BaseModel, Field, computed_field

#: The workspace subdirectory holding every namespace (`$CTRLB_HOME/media/`).
MEDIA_DIRNAME = "media"

#: The URL root both halves of the surface hang off: `<root>/<ns>` is the JSON index and
#: `<root>/<ns>/files/<role>/<file>` is the static mount. Declared HERE so the router, the mount
#: registration and the `url` in every index entry can never drift into three different prefixes.
#: The prefix is SPLIT on purpose (§10.4 detail ②) — one shared prefix invites route-order collisions.
MEDIA_URL_ROOT = "/api/media"
MEDIA_FILES_SEGMENT = "files"

#: The gacha role folders (§5.4). `oracle` has its own folder for symmetry (the G5-brief default).
#: Order matters only for the ensure-dir walk and for how the Conf gallery lists sections.
#:
#: **`wallpaper` was REMOVED at G6.3** (owner ruling 2026-08-06: "just having the background in the kit
#: is the better approach — no duplicated systems"). The fleet backdrop now falls back to the SHARED
#: `kit/background` pool, so a second drop folder for the same picture is a second home for one idea.
#: What survives is the theme-SPECIFIC half: the `wallpaper` PIN below, which sources from `characters`
#: — that is gacha's own mechanism (bind a cast portrait to the backdrop) and the kit has no equivalent.
#: A clean removal, not a deprecation: media v2 has never shipped to prod, so there is no owner data to
#: migrate and no compat branch to carry (the no-legacy-seams rule).
GACHA_ROLES: tuple[str, ...] = ("characters", "banner", "reel", "oracle")

#: The gacha `slots` pin keys (§5.2) — the cross-role bindings the Conf gallery offers. `wallpaper` is
#: still here with its folder gone, and the two are deliberately independent: a pin key names a SLOT the
#: client resolver fills, and `Settings._known_media_namespaces_roles_and_slots` validates it against
#: this tuple alone (never against `roles`), so a pin whose options come from another role is an
#: ordinary shape here — `reel_figure` has always been one.
GACHA_SLOTS: tuple[str, ...] = ("wallpaper", "hero", "oracle", "reel_figure")

#: The frontier role folders (D53 / MEDIA_PLAN §3). `rigs` and `hero` are POOLS (the badlands cards and
#: the map cover); `stack` is the NAMED role — its three layers bind by filename STEM
#: (`cube`/`platform-mid`/`platform-base`), so the drop-in IS the binding and no pin exists for it.
FRONTIER_ROLES: tuple[str, ...] = ("rigs", "hero", "stack")

#: The frontier `slots` pin keys. Only `hero`: a pool with a first-wins default that the owner may
#: override by name (the kit pins are the same shape). The named role gets none.
FRONTIER_SLOTS: tuple[str, ...] = ("hero",)

#: The kit role folders (D53 M3, extended by the Kit Art System). They belong to no theme: every theme's
#: service rows read them, so the namespace is the kit's rather than any theme's.
#:
#:   * `services` / `service-banners` — NAMED, keyed by the SERVICE identity (`kind`, else `name`);
#:   * `hosts` — NAMED, keyed by the MACHINE's name;
#:   * `background` — a POOL (the shared whole-app backdrop), with a pin below;
#:   * `brand` — a POOL (the app bar's mark), with a pin below. Added at G6.3 on the owner's ruling; it
#:     is the `background` shape exactly, and deliberately so — the server's job for both is "list this
#:     folder, honour one pin", and the only thing that differs is which surface paints the result.
#:
#: The three named roles' keys are DATA-DERIVED — a file binds to the service or the machine whose
#: identity its stem matches — which is why there is no key list here: those live in `config.yaml`, not
#: in this registry. They get no pin for the same reason the frontier stack has none: the filename IS the
#: binding. Only the pools need one.
KIT_ROLES: tuple[str, ...] = ("services", "service-banners", "hosts", "background", "brand")

#: The kit `slots` pin keys — one per POOL, and each is the same shape as the frontier hero pin: a
#: first-wins default the owner may override by name.
KIT_SLOTS: tuple[str, ...] = ("background", "brand")


@dataclass(frozen=True)
class MediaNamespace:
    """One namespace's registry row: the role FOLDERS on disk plus the `slots` pin KEYS its config may
    bind. Both belong here because both are namespace facts the ns-generic `media.<ns>` config model
    validates against (MEDIA_PLAN §4) — a slot key typed on a per-namespace pydantic class would be the
    banned sibling shape, and a typo in either is only visible if this registry is the authority."""

    roles: tuple[str, ...]
    slots: tuple[str, ...] = ()


#: ns -> its row. The single registry the ensure-dir, the mounts, the index and the config all read.
#: A new namespace is exactly this one row: everything downstream walks the dict (M1a made that true).
MEDIA_NAMESPACES: dict[str, MediaNamespace] = {
    "gacha": MediaNamespace(roles=GACHA_ROLES, slots=GACHA_SLOTS),
    "frontier": MediaNamespace(roles=FRONTIER_ROLES, slots=FRONTIER_SLOTS),
    "kit": MediaNamespace(roles=KIT_ROLES, slots=KIT_SLOTS),
}

#: extension -> (Content-Type served, magic-byte format name expected inside).
#:
#: A CLOSED ALLOWLIST, and the reason the mount subclasses StaticFiles (§10.4): `FileResponse` guesses
#: the type from the extension, so an owner-dropped `evil.html` would be served as same-origin
#: `text/html` — stored XSS with full API access on a boundary that has no auth. No SVG for the same
#: reason (it is active content, same-origin). Nothing outside this table is served or even listed.
ALLOWED_TYPES: dict[str, tuple[str, str]] = {
    ".png": ("image/png", "png"),
    ".jpg": ("image/jpeg", "jpeg"),
    ".jpeg": ("image/jpeg", "jpeg"),
    ".webp": ("image/webp", "webp"),
}

#: The ONE deterministic collation, named on the wire (`MediaIndex.collation`) so the client and the
#: server can never disagree about what "default order" means (§5.4's ruling). See `sort_key`.
ROLE_COLLATION = "casefold-natural"


# ── the index's wire models ───────────────────────────────────────────────────────────────────────


class MediaFile(BaseModel):
    """One servable file in a role folder, as the index reports it."""

    #: The filename STEM — what a `slots` pin names, and the entry name the client resolver deals.
    #: Two files sharing a stem (`lyra.png` + `lyra.webp`) are a foot-gun the owner can see in the
    #: gallery; a pin then resolves to whichever comes first in this role's order.
    name: str
    #: The filename inside the role folder (what the config's `order` list holds).
    file: str
    #: The absolute, percent-encoded URL of the static mount's copy — the client never builds paths.
    url: str
    #: The format read from the file's MAGIC BYTES, not its extension. `None` = unreadable, or bytes
    #: that are not in the allowlist at all (an `.png` that is really HTML).
    format: str | None = None
    size_bytes: int = 0
    #: An opaque change token for THESE BYTES (`mtime_ns:size:ino:ctime_ns`), from the stat the size
    #: already needed. Inode + ctime are what catch a sync tool that replaces a file while faithfully
    #: preserving mtime and size (same recipe as the memory scan's `_stamp`); ino stays meaningful on
    #: Windows, where st_ctime is the creation time.
    #: The URL cannot carry it: owner files are mutable IN PLACE under a stable name, which is exactly
    #: what makes the name unusable as an identity — and the URL has to stay stable anyway, or the SW's
    #: media cache would miss on every poll. A consumer that remembers something about a file (the reel
    #: figure's failure latch) keys on (url, revision) so replacing the file clears what was remembered.
    revision: str = ""
    width: int | None = None
    height: int | None = None
    #: WHY, machine-readable — `None` when the file is fine. The two verdicts here are the ones only
    #: the server can reach, because only it read the bytes; the gallery turns them into sentences.
    #: SIZE-derived advisories are deliberately NOT here (MEDIA_PLAN §5): "too big" is per-ROLE policy
    #: (an icon is oversized at kilobytes, a wallpaper only at megapixels) and one global constant
    #: served neither, so the client derives them from the numbers above against its registry's bounds.
    #: Named apart from `MediaIndex.reason` below, which is about the whole NAMESPACE.
    unusable_reason: Literal["unreadable", "format-mismatch"] | None = None

    #: The file cannot be used: unreadable bytes, or a format that disagrees with the extension. The
    #: latter really is fatal rather than pedantic — the mount serves the Content-Type the EXTENSION
    #: says with `nosniff`, so a JPEG named `.png` is a guaranteed broken image in the browser.
    #: COMPUTED from the reason so the pair cannot drift (Codex M1b LOW-1): the reason IS the verdict,
    #: and the boolean stays on the wire because it is the field every renderer branches on.
    @computed_field
    @property
    def unusable(self) -> bool:
        return self.unusable_reason is not None


class MediaIndex(BaseModel):
    """`GET /api/media/{ns}` — everything a theme needs in ONE query (§5.2's pinned read path).

    Roster ENTRIES are `roles["characters"]` (the role re-rule superseded the flat entry list), and
    host->entry ASSIGNMENT is deliberately absent: it depends on the client's fleet display order, so
    it lives in the client resolver (§5.3) and cannot be computed here without duplicating it.
    """

    ns: str
    #: The name of the default ordering rule, so the client can state the same contract it consumes.
    collation: str = ROLE_COLLATION
    #: The namespace's tree is not servable and is NOT MOUNTED (W2) — a symlink on its spine, a file
    #: where a role folder belongs, or a mkdir that failed. The theme falls back to its bundled art
    #: (`roles` is empty), and the Conf gallery shows `reason` instead of an empty grid, which is the
    #: difference between "you have not dropped anything in yet" and "the app cannot read your folder".
    disabled: bool = False
    reason: str = ""
    #: role -> files, already in the RULED order (config order first, then the collation).
    roles: dict[str, list[MediaFile]] = Field(default_factory=dict)
    #: The §5.2 `slots` pins as configured, echoed verbatim — a dangling pin is the client resolver's
    #: problem to degrade from, not something to silently drop here (it would hide the owner's typo).
    slots: dict[str, str] = Field(default_factory=dict)


# ── paths ─────────────────────────────────────────────────────────────────────────────────────────


def media_root(home: Path) -> Path:
    """`$CTRLB_HOME/media/`. Takes the home path as an ARGUMENT so this module never imports
    `app.config` — which is what lets `config.py` import the role registry from here."""
    return home / MEDIA_DIRNAME


def ns_dir(home: Path, ns: str) -> Path:
    return media_root(home) / ns


def role_dir(home: Path, ns: str, role: str) -> Path:
    return ns_dir(home, ns) / role


@dataclass(frozen=True)
class NamespaceHealth:
    """Whether one namespace's tree is servable, and if not, what an operator has to fix."""

    ns: str
    ok: bool
    #: Operator-facing, and it NAMES THE PATH — the whole value of the check is that the one sentence
    #: is enough to act on. Empty when `ok`.
    reason: str = ""


def ensure_media_dirs(home: Path) -> dict[str, NamespaceHealth]:
    """Create every namespace's role folders and report whether each namespace came out servable.

    **DEGRADE, NEVER BRICK** (ruled, Codex W2). The first cut raised on a bad layout — and it runs
    inside `create_app()`, i.e. AFTER the exit-78 config preflight, so the exception surfaced as a plain
    uvicorn failure that `Restart=on-failure` retries: an art folder with the wrong shape would have
    crash-looped the whole panel every 5 seconds. Nothing here is worth the control plane. A namespace
    that cannot be served is simply NOT MOUNTED, its index says so with the reason, and everything else
    boots normally.

    A namespace is refused when:

      * any path on its spine (`media/`, `media/<ns>/`, a role dir) is a SYMLINK. A symlink there does
        not "escape" containment — it RELOCATES the root, and every check downstream then approves the
        link's target, publishing it read-only to the whole tailnet. Nobody needs to alias an art folder
        badly enough to make that a supported shape.
      * a REGULAR FILE occupies one of those names (`mkdir` would raise `FileExistsError`, which is how
        this was found).
      * `mkdir` fails for any other reason (permissions, a full disk, a vanished mount).

    Scope, deliberately: this is a BOOT-TIME shape check, not a live guard. Someone who can swap a real
    directory for a symlink afterwards already has shell on the box, and a shell user owns everything
    the app could protect — the trust boundary is the tailnet, not the filesystem (SECURITY_MODEL §1).
    Re-checking per request would buy nothing and cost a stat on every image.

    Symlinked FILES inside a role are a different question and are handled where they are reachable:
    the mount's `lookup_path` and the index's listing both require a regular file (W1).
    """
    root = media_root(home)
    health: dict[str, NamespaceHealth] = {}
    for ns, row in MEDIA_NAMESPACES.items():
        reason = ""
        for path in (root, ns_dir(home, ns), *(role_dir(home, ns, role) for role in row.roles)):
            if path.is_symlink():
                reason = (
                    f"'{path}' is a symlink; the media tree must be real directories (a link here "
                    "would publish its target read-only to the whole tailnet). Replace it with a "
                    "directory, or move the files in."
                )
                break
            if path.exists() and not path.is_dir():
                reason = f"'{path}' is a file, but a directory is needed there. Move or rename it."
                break
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                reason = f"'{path}' could not be created: {exc.strerror or type(exc).__name__}."
                break
        health[ns] = NamespaceHealth(ns=ns, ok=not reason, reason=reason)
    return health


def is_served_file(path: Path) -> bool:
    """The ONE rule for "will this surface serve that?" — read by the mount's `lookup_path` AND by the
    index's listing, so what is advertised and what is served cannot drift apart (Codex R2; the two had
    grown separate copies of it).

    `lstat`, not `stat`: the question is what the component IS, not what it points at. A symlink whose
    target is elsewhere INSIDE the namespace passes Starlette's containment and the mount's shape gate
    (`characters/x.png -> ../private/secret.png`), so this is the check that stops it — and rejecting
    non-regular files disposes of directories and fifos in the same line. Owner drops are real files;
    a link is not a supported shape at any level of this tree.

    The NAME belongs to the same rule, and that is why it is checked here rather than in `file_url`: a
    filename whose bytes are not UTF-8 — a raw-byte name from a tar or an SMB client, which Python
    hands back surrogate-escaped — cannot be percent-encoded into a URL, and the mount could not
    receive one either (a request path is decoded UTF-8-with-replacement, so those bytes are not
    addressable at all). It is unservable by construction, so this gate refuses it and the contract
    stays exactly true; the alternative was one undecodable drop raising `UnicodeEncodeError` out of
    the index and taking the whole namespace's listing down with it (degrade, never brick).

    Any `OSError` (a dangling link, a revoked permission, a vanished mount) is a plain False: the caller
    is either a listing walking a directory the owner writes to behind our back, or a 404 path where
    "not there" is the only thing a probe should be able to learn.
    """
    try:
        path.name.encode("utf-8")
        return stat.S_ISREG(path.lstat().st_mode)
    except OSError, UnicodeEncodeError:
        return False


def file_url(ns: str, role: str, filename: str) -> str:
    """The mount URL for one file. Percent-encoded per segment — owner filenames really do carry
    spaces and `#` (the owner's own drops live in a folder called `banner images`)."""
    return f"{MEDIA_URL_ROOT}/{ns}/{MEDIA_FILES_SEGMENT}/{quote(role)}/{quote(filename)}"


# ── the collation ─────────────────────────────────────────────────────────────────────────────────

_DIGITS = re.compile(r"(\d+)")


def sort_key(filename: str) -> tuple[tuple[object, ...], str]:
    """`ROLE_COLLATION` = casefold-natural: split into digit and non-digit runs, casefold the text
    runs, compare the digit runs NUMERICALLY (`2.png` before `10.png`), and break ties on the exact
    filename so two names differing only in case have a stable, reproducible order.

    Natural rather than plain lexicographic because the zero-UI escape hatch the owner was promised is
    "name them `01-foo`, `02-bar`" — and the moment there are ten of them, plain sorting betrays it.

    Each run becomes `(0, number)` or `(1, text)`. The leading tag is what keeps the tuples mutually
    comparable whatever shape two names have — a text run is never compared against a number — and
    numbers-before-text agrees with ordinary lexicographic order, where `01-foo` precedes `banner`.
    Its one visible consequence, stated so it is a rule and not a surprise: where two names differ in
    KIND at the same position the digit run wins, so `a1.png` sorts before `a.png`. The raw filename
    rides OUTSIDE the run tuple, purely as the tie-break for names that differ only in case.
    """
    parts: list[object] = []
    for run in _DIGITS.split(filename):
        if not run:
            continue
        parts.append((0, int(run)) if run.isdigit() else (1, run.casefold()))
    return tuple(parts), filename


# ── the magic-byte + dimension reader (stdlib, no decoder) ────────────────────────────────────────


@dataclass(frozen=True)
class Probe:
    """What the first bytes of a file actually say. `fmt is None` = not an allowlisted image."""

    fmt: str | None = None
    width: int | None = None
    height: int | None = None


#: JPEG start-of-frame markers carry the dimensions; 0xC4/0xC8/0xCC are Huffman/arithmetic tables that
#: share the 0xC0-0xCF range and must be skipped like any other segment.
_JPEG_SOF = {*range(0xC0, 0xD0)} - {0xC4, 0xC8, 0xCC}
#: Standalone markers with no length field.
_JPEG_STANDALONE = {0x01, 0xD8, *range(0xD0, 0xD8)}
#: How far into a JPEG the SOF hunt may run before giving up. A conforming file puts SOF within a few KB
#: (EXIF thumbnails and ICC profiles are the only things ahead of it), so this only ever bites a
#: malformed one — where an unbounded walk would be paid on every index request.
_JPEG_SCAN_LIMIT = 1 << 20
#: How much of it is read per hop. Bounded CHUNKS rather than the byte-at-a-time resync the first cut
#: used (Codex F8): a malformed drop made the scan a million single-byte reads inside a request.
_JPEG_CHUNK = 1 << 16
#: Enough for a whole PNG IHDR chunk (8 + 13 + 4 = 25 bytes after the 8-byte signature) and for every
#: WebP flavor's first chunk header, so one read answers both.
_HEAD_BYTES = 40
_PNG_IHDR_END = 33
#: The smallest SOF segment that actually contains what we read from it: the 2-byte length itself plus
#: precision(1) + height(2) + width(2). A real SOFn is >= 11 (it also carries per-component bytes); this
#: is deliberately the PARSER's minimum, not the format's, because that is the claim being checked.
_JPEG_SOF_MIN_LEN = 7
#: Per-flavor minimum WebP chunk payload — again the parser's own reach, not the format's: the bytes
#: each branch below indexes into. A chunk declaring less than this does not contain the canvas size,
#: so reading it anyway would report a size from bytes outside the chunk (Codex R1).
_WEBP_MIN_CHUNK = {b"VP8 ": 10, b"VP8L": 5, b"VP8X": 10}


def probe_image(path: Path) -> Probe:
    """Format + pixel dimensions from the file HEADER alone — no decode, no third-party dep.

    Reading the header rather than trusting the extension is the whole point: the mount serves the
    Content-Type the extension claims, so the index has to be the thing that notices when the bytes
    disagree. Any I/O or parse failure degrades to `Probe()`, never an exception — the caller is a
    listing endpoint walking a directory the owner writes to behind our back.

    **A format claim requires the COMPLETE required header** (Codex F3). A signature alone is not a
    format: an 8-byte PNG signature, a bare `\xff\xd8\xff`, or `RIFF....WEBP` with nothing after it are
    all truncated files that no browser will render, and reporting them usable would put a permanently
    broken image in the roster with nothing to explain it. Signature-only ⇒ `Probe()` ⇒ the index marks
    the file unusable with a warning, which is the one place the owner can act on it.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            head = f.read(_HEAD_BYTES)
            if head.startswith(b"\x89PNG\r\n\x1a\n"):
                # The IHDR chunk is mandatory, must be FIRST, and is fixed-size (PNG spec §11.2.2): an
                # 8-byte length+type, 13 data bytes, 4 CRC bytes. Requiring the WHOLE chunk — declared
                # length included — is what separates a real header from a file that stops inside it.
                if (
                    len(head) >= _PNG_IHDR_END
                    and head[8:12] == b"\x00\x00\x00\x0d"
                    and head[12:16] == b"IHDR"
                ):
                    w, h = struct.unpack(">II", head[16:24])
                    return Probe("png", w, h)
                return Probe()
            if head.startswith(b"\xff\xd8\xff"):
                return _probe_jpeg(f, head)
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                return _probe_webp(head, size)
    except OSError:
        return Probe()
    return Probe()


def _probe_jpeg(f: IO[bytes], head: bytes) -> Probe:
    """Walk the marker chain to the first SOF segment. JPEG is the one format whose size is not at a
    fixed offset — EXIF/ICC segments of arbitrary length sit in front of it.

    Reaching a real SOFn is the format claim: a stream that ends, runs past `_JPEG_SCAN_LIMIT`, or
    carries a malformed segment length yields `Probe()` (unusable), never a bare `Probe("jpeg")`.
    """
    buf = head

    def need(end: int) -> bool:
        """Ensure `buf` holds at least `end` bytes, reading in chunks. False = EOF or past the cap."""
        nonlocal buf
        while len(buf) < end:
            if len(buf) >= _JPEG_SCAN_LIMIT:
                return False
            more = f.read(_JPEG_CHUNK)
            if not more:
                return False
            buf += more
        return True

    i = 2
    while i < _JPEG_SCAN_LIMIT:
        # In a conforming stream `buf[i]` IS the 0xFF of the next marker; `find` only does work on a
        # malformed one, and then it does it a chunk at a time instead of a byte at a time.
        if not need(i + 1):
            return Probe()
        j = buf.find(b"\xff", i)
        if j < 0:
            i = len(buf)
            if not need(i + 1):
                return Probe()
            continue
        k = j + 1
        while True:  # marker prefixes may repeat as padding
            if not need(k + 1):
                return Probe()
            if buf[k] != 0xFF:
                break
            k += 1
        m = buf[k]
        i = k + 1
        if m in _JPEG_STANDALONE:
            continue
        if not need(i + 2):
            return Probe()
        length = int.from_bytes(buf[i : i + 2], "big")
        if length < 2:
            return Probe()
        if m in _JPEG_SOF:
            # segment body: precision(1) · height(2) · width(2), right after the length field. Two
            # separate things must hold about the DECLARED length, and the first cut only checked one:
            #   · it must CONTAIN the fields being read (Codex R1) — a SOF announcing `length: 2` is
            #     just the length field, so the "dimensions" after it belong to whatever follows, and
            #     parsing them anyway reads past the segment and reports a size the file never gave;
            #   · the segment must fit in what we can read (Codex W3) — a file that stops inside the
            #     frame header it announced is truncated, whatever its first seven bytes say.
            if length < _JPEG_SOF_MIN_LEN or not need(i + length):
                return Probe()
            h = int.from_bytes(buf[i + 3 : i + 5], "big")
            w = int.from_bytes(buf[i + 5 : i + 7], "big")
            return Probe("jpeg", w, h)
        i += length
    return Probe()


def _probe_webp(head: bytes, size: int) -> Probe:
    """The three WebP flavors keep the canvas size in three different places (RFC 9649 §2.5).

    A COMPLETE chunk header of a known flavor is the format claim: `RIFF....WEBP` followed by nothing,
    by an unknown fourcc, or by a truncated chunk yields `Probe()` (unusable).

    `payload` is the first chunk's data: bytes 0-3 `RIFF`, 4-7 the RIFF size, 8-11 `WEBP`, 12-15 the
    chunk fourcc, 16-19 the chunk size, and the payload from 20 on.

    The two DECLARED lengths must also be internally consistent with the file (Codex W3): the RIFF size
    counts everything after its own 8-byte header, and the first chunk has to fit inside it. A file
    announcing more than it contains is truncated — the commonest half-finished `scp`. This is the
    limit of the checking on purpose: the allowlist plus an honest advisory is the whole job here, the
    browser is the real decoder, and the client already degrades on its `onerror`.
    """
    if len(head) < 20:
        return Probe()
    riff_size = int.from_bytes(head[4:8], "little")
    chunk_size = int.from_bytes(head[16:20], "little")
    if riff_size + 8 > size or chunk_size + 12 > riff_size:
        return Probe()
    fourcc, payload = head[12:16], head[20:]
    if chunk_size < _WEBP_MIN_CHUNK.get(fourcc, 0):
        return Probe()
    if fourcc == b"VP8 " and len(payload) >= 10 and payload[3:6] == b"\x9d\x01\x2a":
        # lossy: the 3-byte frame tag, the sync code, then 14-bit width and height
        w, h = struct.unpack("<HH", payload[6:10])
        return Probe("webp", w & 0x3FFF, h & 0x3FFF)
    if fourcc == b"VP8L" and len(payload) >= 5 and payload[0] == 0x2F:
        # lossless: a signature byte, then 14 bits of width-1 and 14 of height-1
        (bits,) = struct.unpack("<I", payload[1:5])
        return Probe("webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if fourcc == b"VP8X" and len(payload) >= 10:
        # extended: 4 flag bytes, then canvas width-1 and height-1 as 3-byte little-endians
        w = int.from_bytes(payload[4:7], "little") + 1
        h = int.from_bytes(payload[7:10], "little") + 1
        return Probe("webp", w, h)
    return Probe()


# ── the listing ───────────────────────────────────────────────────────────────────────────────────


def describe_file(path: Path, ns: str, role: str) -> MediaFile:
    """One directory entry, probed and judged — FACTS plus the one verdict that needs the bytes.

    The judgement stops here on purpose (MEDIA_PLAN §5): what the header says, how big it is, and
    whether the mount could serve it at all. Whether it is *too* big is per-role policy the client
    owns — this ships the numbers it decides on.
    """
    ext_type = ALLOWED_TYPES.get(path.suffix.lower())
    probe = probe_image(path)
    try:
        st = path.stat()
        size, revision = st.st_size, f"{st.st_mtime_ns}:{st.st_size}:{st.st_ino}:{st.st_ctime_ns}"
    except OSError:
        size, revision = 0, ""
    reason: Literal["unreadable", "format-mismatch"] | None = None
    if probe.fmt is None:
        reason = "unreadable"
    elif ext_type is not None and probe.fmt != ext_type[1]:
        # Served as the extension's type under `nosniff` ⇒ the browser refuses it. Broken, not merely
        # untidy: the owner has to rename the file, and the gallery is where they find that out.
        reason = "format-mismatch"
    return MediaFile(
        name=path.stem,
        file=path.name,
        url=file_url(ns, role, path.name),
        format=probe.fmt,
        size_bytes=size,
        revision=revision,
        width=probe.width,
        height=probe.height,
        unusable_reason=reason,
    )


def list_role(home: Path, ns: str, role: str, order: list[str] | None = None) -> list[MediaFile]:
    """A role folder's servable files in the RULED order: the owner's persisted `order` first (names
    that are actually still on disk), then everything else by `sort_key`.

    Only allowlisted EXTENSIONS are listed at all, so the gallery can never show a row the mount would
    404 — and a stray `notes.txt` beside the art is simply invisible rather than an error. Symlinks
    that escape the role folder are dropped for the same reason: the mount rejects them
    (`follow_symlink=False`), so advertising them would be a lie.
    """
    directory = role_dir(home, ns, role)
    try:
        entries = [p for p in directory.iterdir() if p.suffix.lower() in ALLOWED_TYPES]
    except OSError:  # the owner deleted the folder under us — an empty role, not a 500
        return []
    files: dict[str, Path] = {p.name: p for p in entries if is_served_file(p)}
    pinned = [files.pop(name) for name in (order or []) if name in files]
    rest = sorted(files.values(), key=lambda p: sort_key(p.name))
    return [describe_file(p, ns, role) for p in (*pinned, *rest)]


def disabled_index(ns: str, reason: str) -> MediaIndex:
    """The payload for a namespace that is not mounted (W2). Same shape, empty roles, and the reason —
    so every consumer keeps working and the one that can act on it is told."""
    return MediaIndex(ns=ns, disabled=True, reason=reason)


def build_index(
    home: Path,
    ns: str,
    *,
    order: dict[str, list[str]] | None = None,
    slots: dict[str, str] | None = None,
) -> MediaIndex:
    """The whole `GET /api/media/{ns}` payload. `order`/`slots` come from the owner's config
    (`media.<ns>`) — this module never reads settings itself, so a second namespace is one registry
    row plus its own config block."""
    order = order or {}
    row = MEDIA_NAMESPACES.get(ns)
    return MediaIndex(
        ns=ns,
        roles={role: list_role(home, ns, role, order.get(role)) for role in (row.roles if row else ())},
        slots=dict(slots or {}),
    )
