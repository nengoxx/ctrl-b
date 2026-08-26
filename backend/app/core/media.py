"""Owner-supplied media — the namespace-generic art library (D52/G5; GACHA_PLAN §5.4 + §10.4).

The owner drops image files into `$CTRLB_HOME/media/<ns>/<role>/` from any machine (SSH/SMB) — and,
per **D65**, uploads them from the app itself. This module lists and describes what is on disk, and
since S1 it also owns the PERSIST PIPELINE (`UploadPart` below); `app/api/media.py` publishes the
index, mounts the hardened static surface, and routes the writes into it.

**A typed write API is RULED, and its SHAPE is the security control (D65, 2026-08-24 — superseding
§5.4's "there is no write API and there must never be one here"; the routes and the persist pipeline
are BUILT as of MEDIA_MANAGER_PLAN's S1, and what follows is the contract they satisfy).** The
app has no application-layer auth — the tailnet IS the
boundary (SECURITY_MODEL §1) — so the realistic attacker was never a tailnet peer but the owner's own
browser on another origin, and the only cross-origin request a page can fire without a preflight is a
CORS-SAFELISTED one (`GET`/`HEAD`/`POST`, `multipart/form-data` included). Hence: **raw-body
`PUT`/`DELETE`, never multipart, never POST** — a non-safelisted verb forces an `OPTIONS` preflight
that this app answers with no ACAO, so a cross-origin write dies unsent. Writes land only inside
registered role dirs, `probe_image` below validates the BYTES before the file reaches its final name,
and a rejected upload leaves zero bytes. Full reasoning: SECURITY_MODEL §2.7 + MEDIA_MANAGER_PLAN §1.
Everything the READ side does is unchanged by that reversal.

**Namespace-generic by construction** (council M9): `gacha` is the first namespace, and the next
art-bearing theme is a row in `MEDIA_NAMESPACES` — not a new route, not a new mount class. Nothing in
this module or in the API layer knows what a "capsule card" is.

**Drop-in = assignment** (the G1-eyeball re-rule): the role FOLDER a file lands in is what binds it to
a consumer. Ordering INSIDE a role is the LIBRARY collation (`ROLE_COLLATION` = `library-v1`, D65):
the owner's persisted `media.namespaces.<ns>.roles.<role>.files` list first, then everything else on
disk by `sort_key`, then the role's unlisted BUNDLED ids as the fallback tier. `list_role` is the one
implementation of that rule (council H2) and the wire carries the whole truth — `listed`, `hidden`
and `focal` on every row — so a client resolver never needs a config side-channel.

**No decoder dependency.** User files get no server-side re-encode and no Pillow (a new runtime dep
AND an untrusted-decoder surface, §10.4). `probe_image` below is a stdlib magic-byte + dimension
reader: it gives the format allowlist its ground truth (the byte header, never the extension) and
hands the Conf gallery the numbers it warns on before the phone tries to decode ~51 MB of bitmap.
The WARNING is the client's to make (MEDIA_PLAN §5) — this module ships facts, plus the one verdict
that needs the bytes (`unusable_reason`); "too big" is per-role policy the front-end registry holds.
"""

from __future__ import annotations

import contextlib
import ntpath
import os
import re
import stat
import struct
import tempfile
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Literal
from urllib.parse import quote

from pydantic import BaseModel, Field, computed_field, model_validator

from app.core.fsutil import fsync_dir

#: The workspace subdirectory holding every namespace (`$CTRLB_HOME/media/`).
MEDIA_DIRNAME = "media"

#: The URL root both halves of the surface hang off: `<root>/<ns>` is the JSON index and
#: `<root>/<ns>/files/<role>/<file>` is the static mount. Declared HERE so the router, the mount
#: registration and the `url` in every index entry can never drift into three different prefixes.
#: The prefix is SPLIT on purpose (§10.4 detail ②) — one shared prefix invites route-order collisions.
MEDIA_URL_ROOT = "/api/media"
MEDIA_FILES_SEGMENT = "files"


@dataclass(frozen=True)
class MediaRole:
    """One role FOLDER's registry facts. An OBJECT rather than a bare name in a tuple (D65), because
    a role is about to grow more per-role dimensions and the alternative — a sibling `{role: ids}`
    map beside a name list — is exactly the shape the 2026-06-24 extend-don't-migrate directive
    bans: every new dimension would be a new top-level map plus new read/merge code. Here the next
    one is an additive field with a default. Migrated while it was still cheap (one field).

    `bundled` = the ids of the art this role SHIPS — the entries a theme's own module can paint with
    no owner file present, addressable by a stable name. D65 makes those first-class library entries:
    the collation emits an unlisted bundled id as a fallback-tier row and a listed one as a full
    mixed citizen, and the client maps id → its Vite-hashed asset (the server never sees the URL, so
    it emits no `url` for them). **Order is the theme's own** — for a dealt pool it IS the deal.

    The list is hand-written HERE and DERIVED on the front end (`theme-engine/mediaRegistry.ts`, from
    `defaultRoster()` / `ART` — the H1 import-direction rider), because only the FE modules know
    which bundled assets exist. A drift test holds the two in step; see the mirror guard in
    `frontend/tests/theme-engine/mediaRegistry.test.ts`. **An asset with no stable name gets NO id**
    (gacha's oracle scene, frontier's hero vista): inventing one would create a second identity space
    that no ladder could resolve.
    """

    bundled: tuple[str, ...] = ()


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
GACHA_ROLES: dict[str, MediaRole] = {
    # The cast the roster deals to hosts, positionally. Its bundled ids are the `defaultRoster()`
    # entry names (themes/gacha/roster.ts) — the portraits a fresh install shows. `rook` is the TAIL
    # entry and joined the list in the S6 owner round: the file always shipped, the manifest comment
    # always claimed it was "bundled for the gallery", and it was in no role's list on either side of
    # the mirror — so it appeared in no gallery and could not be reached, reordered or retired.
    "characters": MediaRole(bundled=("pegasus", "atlas", "3", "4", "lyra", "rook")),
    # The pickup-carousel slides: `defaultRoster().scenes` (themes/gacha/roster.ts), in the order the
    # carousel deals them — the FIRST member opens the banner. `banner` leads and joined at the
    # 2026-08-26 owner ruling: the file is what the fleet BACKDROP's ladder ends on, and until then it
    # reached the carousel only as a fixed slide's fallback, so it was in no role's list and therefore in
    # no gallery — the same defect `rook` and the oracle backdrop were fixed for at S6. First keeps a
    # fresh install's carousel identical to what always shipped (banner opens, b2/b3 follow).
    "banner": MediaRole(bundled=("banner", "b2", "b3")),
    # The transition cutout: `defaultRoster().pools.reel`, DERIVED from the entries carrying a
    # `cutout` field — today exactly `lyra`, which is why she stays last in the cast.
    "reel": MediaRole(bundled=("lyra",)),
    # The operator backdrop, which `defaultRoster().pools.oracle` now carries as an ordinary pool
    # member. It used to be listed nowhere on the reasoning that scene art no pin addresses is the last
    # rung of a ladder rather than a library entry — and the consequence was that the one picture the
    # role paints was invisible in its own gallery and could not be replaced from the app at all (the
    # S6 owner ruling: shipped art is an ordinary entry, visible, reorderable and hideable).
    "oracle": MediaRole(bundled=("oracle",)),
}

#: The gacha `slots` pin keys (§5.2) — and since 2026-08-26 ("W6") the only pin keys anywhere. Both are
#: SEATS: a cross-role binding of one CHARACTER into a surface the cast does not own. `wallpaper` is here
#: with its folder gone, and the two are deliberately independent: a pin key names a SLOT the client
#: resolver fills, and `Settings._known_media_namespaces_roles_and_slots` validates it against this tuple
#: alone (never against `roles`).
#:
#: **`reel_figure` was REMOVED 2026-08-26** (owner ruling, "W6" — *order is the only priority system,
#: app-wide*). It was not a seat but an OVERRIDE of the `reel` folder's own first-wins pick, i.e. a second
#: way to say what the library order already said, in a second place. The transition cutout is now simply
#: the first image in that folder's gallery. Same wave took frontier's `hero` and the kit's
#: `background`/`brand` (`FRONTIER_SLOTS`/`KIT_SLOTS` below, both empty now).
#:
#: (**`hero` went one ruling earlier**, at "W5": the pickup carousel's first slide has no art of its own to
#: bind — it deals the `banner` role's first member.)
#:
#: Clean removals on the `wallpaper`-role precedent above: media v2 has never shipped to prod, so no config
#: on disk holds any of these pins (both live configs verified). A hand-authored leftover is an unknown slot
#: key, which is a load/PUT error rather than a knob that silently does nothing — deliberately loud.
GACHA_SLOTS: tuple[str, ...] = ("wallpaper", "oracle")

#: The frontier role folders (D53 / MEDIA_PLAN §3). `rigs` and `hero` are POOLS (the badlands cards and
#: the map cover); `stack` is the NAMED role — its three layers bind by filename STEM
#: (`cube`/`platform-mid`/`platform-base`), so the drop-in IS the binding and no pin exists for it.
FRONTIER_ROLES: dict[str, MediaRole] = {
    # The bundled rig pool, addressed by asset KEY: `present()` names position i's rig as
    # `RIG_KEYS[i % 6]` and the consumer paints `assets[key]` when the owner has dropped none
    # (themes/frontier/art.ts).
    "rigs": MediaRole(bundled=("rig1", "rig2", "rig3", "rig4", "rig5", "rig6")),
    # The badlands map cover — `ART.hero`, under the stem the manifest already addresses it by
    # (`HERO_KEY`, themes/frontier/art.ts). Listed for the same reason the gacha oracle now is: art
    # nothing names is art the owner cannot see, reorder or replace.
    "hero": MediaRole(bundled=("hero",)),
    # The three layers, by the KEY a stem must match (`STACK_KEYS`, themes/frontier/ownerArt.ts).
    # Each key has its own bundled layer, so a partial drop composites owner over bundled.
    "stack": MediaRole(bundled=("cube", "platform-mid", "platform-base")),
}

#: The frontier `slots` pin keys — NONE since 2026-08-26 ("W6"). It carried exactly one, `hero`, an
#: override of the map-cover pool's own first-wins pick; the owner ruled ORDER the only priority system,
#: so the cover is whichever image sits first in that folder's gallery. The named role never had one (its
#: stems ARE its bindings). Empty rather than absent: "this namespace offers no pin" is a real answer the
#: config validator states, and an omitted field would read as a forgotten one.
FRONTIER_SLOTS: tuple[str, ...] = ()

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
#: **The KIT ITSELF ships no fallback art** (§3): a service with no dropped file keeps its icon-less
#: row, and the shared background/brand layers simply do not mount. What that does NOT mean is that
#: every list here is empty — `service-banners` carries cosmos's twelve-banner ROTATION, which the
#: theme deals across a host's service rows (S6). The set belongs to cosmos and the ROLE belongs to
#: the kit, and it is listed here because a role is where the owner manages the art it paints: before
#: this, those twelve pictures lived in a private front-end array outside the media system, visible in
#: no gallery and impossible to reorder or retire. Per-service owner files are unaffected — they bind
#: by stem and still win their own row, whatever the rotation says.
KIT_ROLES: dict[str, MediaRole] = {
    "services": MediaRole(),
    # Spelled out rather than generated, because this table is PARSED by the cross-language drift
    # guard (frontend/tests/theme-engine/mediaRegistry.test.ts) and a comprehension would read to it
    # as "no bundled ids" — the one thing a mirror guard must never be able to be talked out of.
    "service-banners": MediaRole(
        bundled=(
            "banner-01",
            "banner-02",
            "banner-03",
            "banner-04",
            "banner-05",
            "banner-06",
            "banner-07",
            "banner-08",
            "banner-09",
            "banner-10",
            "banner-11",
            "banner-12",
        )
    ),
    "hosts": MediaRole(),
    "background": MediaRole(),
    "brand": MediaRole(),
}

#: The kit `slots` pin keys — NONE since 2026-08-26 ("W6"). The two POOLS carried one each
#: (`background`, `brand`); both were overrides of a first-wins pick the library order already expresses,
#: and the owner ruled that order is the only priority system. Empty for the reason `FRONTIER_SLOTS` is.
KIT_SLOTS: tuple[str, ...] = ()


@dataclass(frozen=True)
class MediaNamespace:
    """One namespace's registry row: the role FOLDERS on disk plus the `slots` pin KEYS its config may
    bind. Both belong here because both are namespace facts the ns-generic `media.<ns>` config model
    validates against (MEDIA_PLAN §4) — a slot key typed on a per-namespace pydantic class would be the
    banned sibling shape, and a typo in either is only visible if this registry is the authority.

    `roles` is an ORDER-PRESERVING map (D65): iteration yields the role names in declaration order —
    which is what the ensure-dir walk, the mount and the gallery's section order all read — while the
    VALUE carries that role's own facts (`MediaRole`). Every consumer that only wants names keeps
    iterating this exactly as it iterated the old tuple."""

    roles: dict[str, MediaRole]
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
#: server can never disagree about what "default order" means (§5.4's ruling). **Re-versioned
#: `library-v1` at D65** (MEDIA_MANAGER_PLAN §2.3, Opus sweep ①) because the RULE changed, not merely
#: the code: a role is now `files` entries in the owner's order, then unlisted disk files, then the
#: role's unlisted BUNDLED ids as a fallback tier. The tie-break INSIDE tier ② is unchanged and still
#: casefold-natural — see `sort_key`, which is that half and keeps its own name.
ROLE_COLLATION = "library-v1"


# ── the library's per-item models (config AND wire — one definition) ──────────────────────────────


class MediaFocal(BaseModel):
    """The framing point of one library item (D65 / MEDIA_MANAGER_PLAN §5): where in the picture the
    subject is, so a cover crop can keep it on screen.

    Stored per ITEM in config and echoed on the index row, which is why the model lives HERE rather
    than in `config.py`: two definitions of one shape is exactly the drift the wire/config split
    invites. `config.py` imports the media registry from this module already (the one-way
    core→config edge), so the item models ride the same import.

    `rev` KEYS the point to the file's `revision` (Opus M2): owner files are mutable IN PLACE under a
    stable name, so an SSH overwrite would leave a focal point describing a picture that is gone. A
    `rev` that does not match the file's current revision reads as UNSET — the client says "framing
    was reset — the file changed" rather than cropping to the wrong spot. An empty `rev` therefore
    degrades the same way (it matches no revision), which is what makes the field safely additive.
    """

    model_config = {"extra": "allow"}

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    rev: str = ""


class MediaItem(BaseModel):
    """ONE entry in a role's `files` list — the library's unit of PRIORITY (D65 §2.2).

    `files` replaced the old `order: [names]` because the list grew dimensions: the entry carries its
    own `hidden`, `focal` and `key` today and `z` (zoom) tomorrow, and the alternative — a
    `hidden: {name: bool}` map beside an `order:` list beside a `focal: {name: …}` map — is the
    sibling shape the 2026-06-24 extend-don't-migrate directive bans.

    **Identity is a discriminated union** (Emma #10): exactly one of `name` (a file in the role
    folder) or `bundled` (a registry id from `MediaRole.bundled`). Both, or neither, is a 422 — a
    listed entry that named two things would make "which picture is this" a question with two
    answers, and one that named nothing would occupy a priority slot for no picture. Uniqueness of
    `(kind, id)` within a role is checked one level up, in `Settings`, which is where the role's
    registry row is in scope.

    `key` is the METADATA BINDING override (§2.2's permanent rule): an item binds to a named-role key
    by this field when it has one, else by its filename stem — so "drop a file in and it binds" keeps
    working forever for SSH drops while an upload can bind explicitly.
    """

    model_config = {"extra": "allow"}

    name: str | None = None
    bundled: str | None = None
    key: str | None = None
    #: Excluded from RESOLUTION everywhere, still in the library (dimmed in the gallery, "In use" off).
    #: The mechanism for retiring one entry of an all-entries role, where order cannot exclude.
    #: **Not the same treatment as `unusable`** (§2.2): an unusable file HOLDS its position — the
    #: shipped `cycleAt` rule, so one bad drop cannot re-deal the fleet — while `hidden` is a
    #: set-membership question the client filters on. The index emits hidden rows MARKED, never
    #: dropped, so the gallery can show what the resolution skips.
    hidden: bool = False
    focal: MediaFocal | None = None

    @model_validator(mode="after")
    def _exactly_one_identity(self) -> "MediaItem":
        if (self.name is None) == (self.bundled is None):
            raise ValueError(
                "a media `files` entry needs exactly one of `name` (a file in the role folder) or "
                "`bundled` (an id from that role's bundled art)"
            )
        return self

    @property
    def identity(self) -> tuple[str, str]:
        """`(kind, id)` — the uniqueness key a role's list is checked against."""
        return ("bundled", self.bundled) if self.bundled is not None else ("name", self.name or "")


# ── the index's wire models ───────────────────────────────────────────────────────────────────────


class MediaFile(BaseModel):
    """One entry of a role's LIBRARY, as the index reports it: a servable file on disk, or — since
    D65 — a BUNDLED id the client maps to its own Vite-hashed asset.

    ONE row type for both, deliberately (§2.3): the gallery, the pins and every theme ladder consume
    one ordered list per role, and a second row type would fork all three. A bundled row carries its
    id in `bundled` and `name`, and NOTHING the server could only learn from bytes (`file`, `url`,
    `revision`, `format`, the dimensions) — the server has never seen that asset and must not invent
    a URL for it."""

    #: The filename STEM — what a `slots` pin names, and the entry name the client resolver deals.
    #: Two files sharing a stem (`lyra.png` + `lyra.webp`) are a foot-gun the owner can see in the
    #: gallery; a pin then resolves to whichever comes first in this role's order. On a BUNDLED row
    #: this is the bundled ID, for exactly that reason: a pin addresses one identity space.
    name: str
    #: The filename inside the role folder (what a config `files` entry's `name` holds). Empty on a
    #: bundled row — there is no file.
    file: str
    #: The absolute, percent-encoded URL of the static mount's copy — the client never builds paths.
    #: Empty on a bundled row: the asset is the CLIENT's, hashed by its own build, so the id is the
    #: only thing the server can honestly say about it.
    url: str
    #: The registry id when this row IS a bundled entry, `None` for a file on disk. The client maps it
    #: to its own asset (`defaultRoster()` / `ART`); no server-side URL exists.
    bundled: str | None = None
    #: True when this row came from the owner's `files` list, False when the collation APPENDED it —
    #: an unlisted file on disk, or an unlisted bundled id (the fallback tier). Ladders read it to keep
    #: today's semantics exactly: a fallback bundled row participates only where the ladder already
    #: fell through to bundled art, which is what makes the config-pure migration paint-parity-free
    #: (§2.3 ④, Emma confirm E2).
    listed: bool = False
    #: Excluded from resolution by the owner, still shown (dimmed) in the gallery. The server only
    #: REPORTS it — skipping hidden rows is the client resolver's job, and `unusable` (below) keeps the
    #: opposite treatment: it holds its position. Never fold the two predicates together (§2.2).
    hidden: bool = False
    #: The item's framing point, echoed from config so a paint site never reads config (§2.4's resolver
    #: purity). `None` = unset; a `rev` that disagrees with `revision` below is treated as unset by the
    #: client, which is what makes an in-place file replacement safe.
    focal: MediaFocal | None = None
    #: The item's explicit named-role BINDING key, echoed from config; `None` = it binds by its stem
    #: (§2.2's permanent fallback rule — "drop a file in and it binds" is the shipped contract of a
    #: named role and keeps working forever for SSH drops). On the wire for the same reason every other
    #: per-item fact is: the whole truth rides the index, so a resolver never reads config and the
    #: detail panel can NAME which of the two bound this file. Always `None` on a bundled row.
    key: str | None = None
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
    #: **`unreadable` means "these bytes are not an allowlisted image"** (defect #7): truncated,
    #: corrupt — or a perfectly valid GIF/HEIC/TIFF/SVG, which this surface does not serve. The
    #: renderer must say both halves; claiming "unreadable file" about a readable-but-unsupported
    #: format sent the owner hunting for a corruption that was never there.
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
    #: role -> its whole LIBRARY, already in the ruled order (the owner's `files` entries, then
    #: unlisted disk files, then unlisted bundled ids as the fallback tier — `library-v1`).
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


#: Appended to every `ensure_media_dirs` refusal (defect #6). The shape check runs ONCE, at startup —
#: the namespace is either mounted or not for the life of the process — so "fix the folder" is only
#: half the remedy and the half that is silent is the one that leaves the owner stuck.
_RESTART_NOTE = " This is checked at startup, so restart ctrl-b once the folder is fixed."


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

    Every refusal reason ends with `_RESTART_NOTE` (defect #6): this is a BOOT-TIME check, so fixing
    the tree does not re-enable anything until the backend restarts — and a message that omits that
    leaves the owner staring at a folder they just repaired and a namespace that is still disabled.
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
        health[ns] = NamespaceHealth(
            ns=ns, ok=not reason, reason=f"{reason}{_RESTART_NOTE}" if reason else ""
        )
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
    """What the first bytes of a file actually say. `fmt is None` = not an allowlisted image.

    **`width`/`height` are the PAINTED dimensions** — what a browser will actually lay the picture out
    as, not the raw frame header's numbers. The two differ for exactly one shipped case: a JPEG whose
    EXIF says it is rotated a quarter turn (orientations 5-8), where every engine paints the frame
    transposed and `_probe_jpeg` therefore reports it transposed. See `_exif_orientation`.
    """

    fmt: str | None = None
    width: int | None = None
    height: int | None = None


#: JPEG start-of-frame markers carry the dimensions; 0xC4/0xC8/0xCC are Huffman/arithmetic tables that
#: share the 0xC0-0xCF range and must be skipped like any other segment.
_JPEG_SOF = {*range(0xC0, 0xD0)} - {0xC4, 0xC8, 0xCC}
#: Standalone markers with no length field.
_JPEG_STANDALONE = {0x01, 0xD8, *range(0xD0, 0xD8)}
#: The application segment EXIF lives in (TIFF/EP §4.6.4). A conforming writer puts it first.
_JPEG_APP1 = 0xE1
#: The EXIF orientations that ROTATE a quarter turn, and therefore transpose the painted size. The
#: other four (1 identity, 2/4 mirrors, 3 half turn) keep the frame's own proportions.
_EXIF_TRANSPOSED = frozenset({5, 6, 7, 8})
#: TIFF field types, and how many bytes one value of each occupies. Orientation is specified SHORT and
#: is written LONG by enough encoders to be worth reading properly — a LONG read as a SHORT is right by
#: accident on a little-endian file and reads 0 on a big-endian one, which would silently drop the tag.
_TIFF_VALUE_BYTES = {3: 2, 4: 4}
#: The tag itself (0x0112).
_TIFF_ORIENTATION = 0x0112
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

    The dimensions it reports are the PAINTED ones — see `Probe`.
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

    **The EXIF orientation is read on the way past** (Emma's S4 review #3), and the dimensions come
    back TRANSPOSED for the quarter-turn orientations. The SOF carries the frame as STORED; every
    browser paints it as EXIF says to, so a phone's portrait photo dropped in over SSH has a 4000x3000
    frame header and lays out 3000x4000. Nothing cared until the focal point: `focalPosition` computes
    which axis a window crops from the file's aspect, so an untransposed report makes it move the
    picture along the axis that is not cropping and leave the one that is. UPLOADS are immune (the
    export re-encodes at the painted orientation and strips EXIF, R54 §3.5) — SSH drops are not, and
    they are an ordinary supported path.

    It costs no extra I/O: the APP1 sits AHEAD of the SOF, so the walk has to read past it either way.
    A nonconforming file that puts its SOF first simply reports untransposed, which is what it did
    before.
    """
    buf = head
    #: The EXIF orientation, if an APP1 carrying one was passed before the frame header.
    orientation: int | None = None

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
            # The quarter turns. 1-4 are identity/flips/180, which keep the frame's own proportions;
            # 5-8 rotate, and a rotated frame is laid out with its axes swapped.
            return Probe("jpeg", h, w) if orientation in _EXIF_TRANSPOSED else Probe("jpeg", w, h)
        if m == _JPEG_APP1 and orientation is None:
            # Reading the body is what the walk was about to do anyway on its way to the SOF, and it
            # stays inside `need`'s `_JPEG_SCAN_LIMIT` cap — no new unbounded read.
            if not need(i + length):
                return Probe()
            orientation = _exif_orientation(buf[i + 2 : i + length])
        i += length
    return Probe()


def _exif_orientation(seg: bytes) -> int | None:
    """The EXIF orientation in one APP1 segment BODY (everything after the 2-byte length), or `None`
    for anything this cannot read with certainty.

    Every step is bounded by `len(seg)` and every failure is `None`, on the same terms the rest of this
    reader works on: the input is a file the owner wrote behind our back, and the caller is a listing
    endpoint. `None` means "report the frame as stored", which is exactly what happened before this
    existed — so a segment we cannot parse costs nothing and changes nothing.

    The structure (TIFF 6.0 §2 through the EXIF profile): `Exif\\0\\0`, then a TIFF header — a byte-order
    mark, the 0x002A magic, and IFD0's offset FROM THE TIFF HEADER — then IFD0 itself: a 2-byte entry
    count and 12-byte entries of `tag · type · COUNT · value-or-offset`.

    **That last field is a value only while the field FITS in it** — otherwise it is an offset into the
    TIFF block, which is why the count is read and not skipped. Orientation is specified as a single
    SHORT, so this requires `count == 1` and reads the value inline (TIFF pads a short value to the
    left of the field, i.e. at its low addresses, in both byte orders). Anything else is a writer this
    reader will not second-guess.
    """
    if not seg.startswith(b"Exif\x00\x00"):
        return None
    tiff = seg[6:]
    if len(tiff) < 8 or tiff[:2] not in (b"II", b"MM"):
        return None
    endian: Literal["little", "big"] = "little" if tiff[:2] == b"II" else "big"
    if int.from_bytes(tiff[2:4], endian) != 0x2A:
        return None
    ifd = int.from_bytes(tiff[4:8], endian)
    # An offset inside the header it is measured from is not an IFD; one past the segment is not there.
    if ifd < 8 or ifd + 2 > len(tiff):
        return None
    entry = ifd + 2
    for _ in range(int.from_bytes(tiff[ifd : ifd + 2], endian)):
        if entry + 12 > len(tiff):
            return None
        if int.from_bytes(tiff[entry : entry + 2], endian) == _TIFF_ORIENTATION:
            width = _TIFF_VALUE_BYTES.get(int.from_bytes(tiff[entry + 2 : entry + 4], endian))
            # THE COUNT decides whether those last four bytes are a value AT ALL. TIFF stores a field
            # inline only while it fits in them; at any other count they hold an OFFSET into the TIFF
            # block instead — and an offset that happens to land in 1..8 would transpose the picture
            # for a number that was never an orientation (a LONG at count 2 whose offset field reads
            # 6 is the probed case). Orientation is specified as a SINGLE SHORT, so `count == 1` is
            # both the inline rule and the spec: two orientations is a writer bug, and choosing one
            # of them is exactly the guessing this reader does not do.
            if width is None or int.from_bytes(tiff[entry + 4 : entry + 8], endian) != 1:
                return None
            value = int.from_bytes(tiff[entry + 8 : entry + 8 + width], endian)
            # 1-8 is the whole defined range; anything else is a writer bug, and guessing at it would
            # transpose a picture for no reason the owner could ever find.
            return value if 1 <= value <= 8 else None
        entry += 12
    return None


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


def describe_file(
    path: Path,
    ns: str,
    role: str,
    *,
    listed: bool = False,
    hidden: bool = False,
    focal: MediaFocal | None = None,
    key: str | None = None,
) -> MediaFile:
    """One directory entry, probed and judged — FACTS plus the one verdict that needs the bytes.

    The judgement stops here on purpose (MEDIA_PLAN §5): what the header says, how big it is, and
    whether the mount could serve it at all. Whether it is *too* big is per-role policy the client
    owns — this ships the numbers it decides on.

    The four keyword facts come from the owner's `files` ENTRY, not from the file: they are what the
    collation knows and the filesystem does not (D65). They default to "not listed, not hidden, no
    framing, bound by stem", which is exactly an unlisted drop.
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
        listed=listed,
        hidden=hidden,
        focal=focal,
        key=key,
    )


def bundled_row(
    bundled: str, *, listed: bool = False, hidden: bool = False, focal: MediaFocal | None = None
) -> MediaFile:
    """One BUNDLED id as an index row (D65 §2.3). No `file`, no `url`, no `revision`, no probe facts:
    the asset belongs to the client's build and the server has never seen it. The id rides in both
    `bundled` (what it IS) and `name` (how a pin addresses it — one identity space, §2.3)."""
    return MediaFile(
        name=bundled, file="", url="", bundled=bundled, listed=listed, hidden=hidden, focal=focal
    )


def list_role(home: Path, ns: str, role: str, files: Sequence[MediaItem] | None = None) -> list[MediaFile]:
    """A role's whole LIBRARY in the ruled order — the ONE collation chokepoint (council H2), the rule
    named on the wire as `library-v1`:

      1. the owner's `files` entries, in list order. A `name` is resolved against the directory and a
         DANGLING one simply drops (self-heal: deleting a file is a delete plus a config write, and a
         failure between them must not leave a 404 in the roster). A `bundled` id becomes a row.
      2. then every remaining file on disk, by `sort_key` — today's rule, unchanged.
      3. then the role's remaining BUNDLED ids, as the FALLBACK TIER: present so the gallery can show
         them and the pins can offer them, `listed=False` so a ladder keeps falling through to them
         exactly as it falls through to bundled art today. That is what makes the config-pure
         migration paint-parity-free (§2.3/§2.4) — the fallback tier IS today's semantics.

    Only allowlisted EXTENSIONS are listed at all, so the gallery can never show a row the mount would
    404 — and a stray `notes.txt` beside the art is simply invisible rather than an error. Symlinks
    that escape the role folder are dropped for the same reason: the mount rejects them
    (`follow_symlink=False`), so advertising them would be a lie. `.part` uploads in flight are
    invisible by the same gate (their extension is not in the allowlist).

    A `bundled` entry naming an id this role does not SHIP drops like a dangling filename: config
    validation refuses one, so reaching here means the registry row shrank under a config that named
    it, and a row the client cannot map to an asset would paint nothing at a real priority slot.
    """
    directory = role_dir(home, ns, role)
    try:
        entries = [p for p in directory.iterdir() if p.suffix.lower() in ALLOWED_TYPES]
    except OSError:  # the owner deleted the folder under us — an empty role, not a 500
        entries = []
    on_disk: dict[str, Path] = {p.name: p for p in entries if is_served_file(p)}
    row = MEDIA_NAMESPACES.get(ns)
    ships = row.roles[role].bundled if row is not None and role in row.roles else ()

    out: list[MediaFile] = []
    listed_ids: set[str] = set()
    for item in files or ():
        if item.bundled is not None:
            if item.bundled in ships and item.bundled not in listed_ids:
                listed_ids.add(item.bundled)
                out.append(bundled_row(item.bundled, listed=True, hidden=item.hidden, focal=item.focal))
            continue
        path = on_disk.pop(item.name or "", None)
        if path is None:
            continue
        out.append(
            describe_file(path, ns, role, listed=True, hidden=item.hidden, focal=item.focal, key=item.key)
        )
    out += [describe_file(p, ns, role) for p in sorted(on_disk.values(), key=lambda p: sort_key(p.name))]
    out += [bundled_row(b) for b in ships if b not in listed_ids]
    return out


def disabled_index(ns: str, reason: str) -> MediaIndex:
    """The payload for a namespace that is not mounted (W2). Same shape, empty roles, and the reason —
    so every consumer keeps working and the one that can act on it is told."""
    return MediaIndex(ns=ns, disabled=True, reason=reason)


def build_index(
    home: Path,
    ns: str,
    *,
    files: dict[str, list[MediaItem]] | None = None,
    slots: dict[str, str] | None = None,
) -> MediaIndex:
    """The whole `GET /api/media/{ns}` payload. `files`/`slots` come from the owner's config
    (`media.namespaces.<ns>`, projected by `Settings.media_overrides`) — this module never reads
    settings itself, so a second namespace is one registry row plus its own config block."""
    files = files or {}
    row = MEDIA_NAMESPACES.get(ns)
    return MediaIndex(
        ns=ns,
        roles={role: list_role(home, ns, role, files.get(role)) for role in (row.roles if row else ())},
        slots=dict(slots or {}),
    )


# ── the write path (D65): the two filename tiers, then the persist pipeline ───────────────────────
#
# **Two tiers, one home** (MEDIA_MANAGER_PLAN §3). They answer different questions and only one of
# them is a gate on the owner:
#
#   * `is_addressable_name` — the ADDRESSABLE tier, read by `Settings`: can a config `files` entry
#     name this file at all? It is defence-in-depth (the value is only ever matched against a
#     directory listing), so it stays as permissive as the index is. Defect #8 re-ruled: the `\`
#     clause is GONE, because a backslash is an ordinary POSIX filename character and the index
#     serves such a file happily — the old check made a currently-painting drop impossible to
#     REORDER, with an opaque 422. `is_served_file` is untouched.
#   * `admission_reason` — the ADMISSION tier, read by the write route: may this be a NEW name we
#     create? Strict, cross-platform, and it REJECTS WITH A REASON rather than sanitising (a
#     sanitiser invents a name the client did not ask for, and the client's own minter already
#     guarantees uniqueness — §2.5).
#
# The asymmetry is deliberate: the app never has to be able to CREATE every name it can SERVE.


def is_addressable_name(name: str) -> bool:
    """Can a config `files` entry name this? Non-blank, not `.`/`..`, and no `/` — the value names a
    file INSIDE one role folder and is only ever matched against that folder's listing."""
    return bool(name.strip()) and name not in (".", "..") and "/" not in name


#: The POSIX/NTFS filename budget every mainstream filesystem shares. Measured in UTF-8 BYTES because
#: that is what the filesystem counts — a 100-character name of 3-byte code points is 300 bytes.
MAX_NAME_BYTES = 255

#: Characters no NEW upload may carry. `<>:"|?*` are illegal on NTFS (a name the owner could never
#: sync to their Windows box), C0/DEL make a filename unprintable in every listing they would compare
#: it against, and U+FFFD is the replacement character — its presence means a decode already lost the
#: real name upstream, so accepting it would persist a corruption.
_ADMISSION_FORBIDDEN = frozenset('<>:"|?*') | {"\ufffd"} | frozenset(chr(c) for c in (*range(0x20), 0x7F))


def admission_reason(filename: str) -> str | None:
    """Why this filename may not be CREATED, or `None` when it may (MEDIA_MANAGER_PLAN §3).

    Every clause returns the sentence the client shows, because "422" alone tells the owner nothing
    about a name their own picker produced. Ordered from structural to cosmetic so the first failure
    is the most explanatory one.
    """
    if not filename:
        return "the filename is empty"
    if "/" in filename or "\\" in filename:
        return "a filename cannot contain a path separator"
    if filename in (".", ".."):
        return "that name addresses a directory, not a file"
    # NFC is REQUIRED rather than applied (§3: reject with the reason, never sanitise). macOS hands
    # out decomposed names; storing one makes the file's stem unequal to the key every client-side
    # comparison normalises to NFC first (`lib/media.ts#normalizeMediaKey`), so it would bind to
    # nothing while looking identical in every listing.
    if unicodedata.normalize("NFC", filename) != filename:
        return "the filename is not in Unicode NFC form"
    if any(c in _ADMISSION_FORBIDDEN for c in filename):
        return 'the filename contains a character that is not allowed (< > : " | ? * or a control character)'
    if filename.startswith("."):
        return "a filename cannot start with a dot"
    if filename[-1] in ". ":
        return "a filename cannot end with a dot or a space"
    # Windows reserves these device names WITH ANY EXTENSION (`CON.png`), and `ntpath.isreserved`
    # is the stdlib's own answer — a hand-written list would rot the moment it disagreed with it.
    if ntpath.isreserved(filename):
        return "that name is reserved by Windows"
    if len(filename.encode("utf-8")) > MAX_NAME_BYTES:
        return f"the filename is longer than {MAX_NAME_BYTES} bytes"
    if Path(filename).suffix.lower() not in ALLOWED_TYPES:
        return "only " + ", ".join(sorted(ALLOWED_TYPES)) + " files are accepted"
    return None


class MediaWriteError(Exception):
    """A refused write, carrying the STATUS the route answers with and the sentence it says.

    The status is decided where the rule lives (here), not re-derived from an exception type in the
    API layer: the ladder below is the contract (`413` cap · `415` bytes/extension · `409` name
    exists), and splitting it across two files is how those three answers drift.
    """

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


#: The app-owned scratch directory for in-flight uploads, one per role folder, plus the temp naming
#: inside it. **The DIRECTORY is what keeps the boot sweep off OWNER TERRITORY** (Emma MED-2): a name
#: convention alone is a guess about who created a file — an owner may legitimately drop
#: `.ctrlb-upload-x.part` into a role folder — so the sweep only ever looks inside `.parts/` and never
#: at the role dir itself, i.e. never at anything the index or the mount can see.
#:
#: **Inside `.parts/` the naming convention IS the contract** (scoped honestly, main-seat ruling on
#: Emma's residual): this directory is DECLARED app-owned scratch, and a file the owner puts in it
#: matching `PART_PREFIX`+`PART_SUFFIX` exactly is swept like any other stranded temp. Discriminating
#: further would mean creation-evidence bookkeeping (inode manifests) that nothing else in this
#: codebase carries for its own scratch dirs. What IS pinned by test: the sweep reaches exactly the
#: convention names and nothing else in there.
#:
#: Invisible to both halves of the read surface by construction: `.parts` is not an allowlisted
#: extension (so the index skips it and the mount 404s the directory itself), and anything inside it
#: is three path segments deep, which the mount's two-segment shape gate refuses. It sits INSIDE the
#: role dir so `os.link` from it stays a same-filesystem, atomic operation.
PARTS_DIRNAME = ".parts"
PART_PREFIX = ".ctrlb-upload-"
PART_SUFFIX = ".part"


def _require_real_scratch_dir(parts: Path) -> None:
    """Refuse to write into a `.parts` that is a SYMLINK or a non-directory (Emma's 0.99 probe).

    `mkdir(exist_ok=True)` accepts an existing symlink, and `mkstemp` then follows it: the temp would
    be created, chmod'd and unlinked wherever the link points — outside the registered tree entirely,
    which is the one thing "writes land only inside registered role dirs" (D65) must mean. The sweep
    already refuses a symlinked `.parts`; this is the same rule at the other end, and both ends need
    it because a guard on the cleanup path protects nothing during the write.

    `lstat`-based (`is_symlink`), and deliberately no more: this is the SAME shape check
    `ensure_media_dirs` runs over the media spine at boot, one level down, and with it the same
    accepted reasoning — someone able to swap a real directory for a link between this check and the
    mkstemp already has shell on the box, and a shell user owns everything the app could protect
    (SECURITY_MODEL §1). TOCTOU theatre would buy nothing over that.

    **500, not 4xx**: nothing about the REQUEST is wrong — the server's own tree is in a shape it
    cannot write into, and only an operator can fix it. (The disabled-namespace precedent one layer
    up answers 404, and that is right there because the namespace is genuinely not being served;
    here the namespace is healthy and listing, so "not found" would be a lie.) The message names the
    path in the `ensure_media_dirs` voice, because the whole value of it is being enough to act on.
    """
    if parts.is_symlink():
        raise MediaWriteError(
            500,
            f"'{parts}' is a symlink; the media tree must be real directories (an upload would "
            "otherwise be written outside the media folder). Replace it with a directory, then retry.",
        )
    if parts.exists() and not parts.is_dir():
        raise MediaWriteError(
            500,
            f"'{parts}' is a file, but a directory is needed there for uploads in flight. "
            "Move or rename it, then retry.",
        )


class UploadPart:
    """The `.part` file one upload streams into, and the ladder that turns it into a media file.

    The order is the security control (D65 / R55 §4.4), not an implementation detail:

        mkstemp `.part` in the role's `.parts/` → chmod 0644 → stream + COUNT (413) → fsync → probe
        the BYTES (415) → `os.link` no-clobber (409) → unlink the temp → `fsync_dir`

    Every property that matters falls out of that order. The bytes are validated **before the file
    has its final name**, so a rejected upload leaves ZERO bytes and never a half-file in the roster.
    The temp lives in a scratch dir INSIDE the destination directory, so `os.link` is a
    same-filesystem operation that either creates the name or raises `FileExistsError` — which is the
    whole concurrency story: no lock, no check-then-act window, and the 409 the client retries with
    its next suffix (§2.5). The directory fsync is what makes the new NAME durable, not its contents.

    Not a context manager: the route needs `write()` calls interleaved with `await`s on the request
    stream, and `discard()` is idempotent — it is called in the route's `finally` whatever happened.
    """

    def __init__(self, path: Path, file: IO[bytes], max_bytes: int) -> None:
        self.path = path
        self.received = 0
        self._file: IO[bytes] | None = file
        self._max_bytes = max_bytes

    @classmethod
    def open(cls, directory: Path, *, max_bytes: int) -> "UploadPart":
        # `parents=False`: the role dir is the registry's to create (`ensure_media_dirs` at boot), and
        # a write must not resurrect a tree the owner deleted or the health check refused — only the
        # scratch dir inside it is this code's to make.
        parts = directory / PARTS_DIRNAME
        _require_real_scratch_dir(parts)
        parts.mkdir(parents=False, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=str(parts), prefix=PART_PREFIX, suffix=PART_SUFFIX)
        part = cls(Path(name), os.fdopen(fd, "wb"), max_bytes)
        # `mkstemp` creates at 0600 (right for a secret, wrong for art the mount has to read back
        # under whatever user it runs as). Set the mode on the FD where the platform supports it, so
        # nothing can swap the path between the create and the chmod; `os.supports_fd` is a
        # capability probe, deliberately not an OS branch (the closed allowlist, ARCHITECTURE §6).
        try:
            if os.chmod in os.supports_fd:
                os.chmod(part._file.fileno(), 0o644)  # type: ignore[union-attr]  # just opened
            else:  # pragma: no cover — POSIX runs the fd path; Windows ignores the mode bits anyway
                os.chmod(part.path, 0o644)
        except OSError:  # a filesystem with no mode bits (exFAT/SMB) — the write is still valid
            pass
        return part

    def write(self, chunk: bytes) -> None:
        """Append one streamed chunk, counting as it goes.

        The COUNTER is the cap, never `Content-Length`: a header is a claim, and a chunked body has
        none at all. The detail names the LIMIT (a config value the owner set) and never the size
        actually received.
        """
        if self._file is None:  # pragma: no cover — the route never writes after finish/discard
            raise RuntimeError("upload part is closed")
        self.received += len(chunk)
        if self.received > self._max_bytes:
            raise MediaWriteError(
                413, f"the upload is larger than media.write.max_bytes ({self._max_bytes} bytes)"
            )
        self._file.write(chunk)

    def finish(self, target: Path, ns: str, role: str) -> MediaFile:
        """Durably link the streamed bytes to their final name and describe the result."""
        file = self._file
        if file is None:  # pragma: no cover — same
            raise RuntimeError("upload part is closed")
        file.flush()
        os.fsync(file.fileno())
        file.close()
        self._file = None

        probe = probe_image(self.path)
        expected = ALLOWED_TYPES.get(target.suffix.lower())
        if expected is None or probe.fmt != expected[1]:
            # The mount serves the Content-Type the EXTENSION claims under `nosniff`, so a mismatch
            # is a guaranteed broken image — refused at the door rather than listed as `unusable`
            # (an SSH drop has no door; an upload does).
            raise MediaWriteError(
                415,
                f"the bytes are {probe.fmt or 'not an accepted image format'}, which does not match "
                f"the {target.suffix.lower()} extension",
            )
        try:
            os.link(self.path, target)
        except FileExistsError:
            raise MediaWriteError(409, f"{target.name} already exists") from None
        self.discard()
        fsync_dir(target.parent)
        return describe_file(target, ns, role)

    def discard(self) -> None:
        """Close and remove the temp file. Idempotent, and never raises: it runs in the route's
        `finally`, where a second failure would replace the real one."""
        if self._file is not None:
            with contextlib.suppress(OSError):
                self._file.close()
            self._file = None
        with contextlib.suppress(OSError):
            self.path.unlink()


def delete_file(directory: Path, filename: str) -> bool:
    """Remove one owner file. `True` = removed, `False` = there is nothing here to remove (404).

    Gated by `is_served_file`, the SAME predicate the index and the mount use: a delete may only
    reach something this surface would serve, so a symlink, a directory, a `.part` in flight and a
    file that was never there are all one indistinguishable "no" — the answer a probe should get.
    Deliberately NOT gated by `admission_reason`: that tier decides what may be CREATED, and this one
    answers "may this be removed", which is a wider question — an SSH drop the app would refuse to
    MINT (a decomposed name, an NTFS-illegal one) must still be deletable.

    **Wider, with one honest exception: names the path API would REINTERPRET** (Emma MED-1). `\\` and
    a drive qualifier (`C:foo.png`, `D:x.png`) are separators to `ntpath`, so `directory / name` would
    resolve somewhere the request never named — the same file under a different spelling on the same
    drive, or another drive's working directory entirely. Those names are refused here whatever the
    server OS is, because the hazard belongs to the path API rather than to the platform (the
    server-OS branch allowlist is closed, ARCHITECTURE §6). The practical consequence, stated so it is
    a rule and not a surprise: a file dropped under such a name over SSH is deletable over SSH only.

    Touches no config (§3). Delete-then-config-write is the client's composition, and a cleanup that
    never happens leaves a dangling `files` entry that `list_role` drops.
    """
    if not is_addressable_name(filename) or "\\" in filename:
        return False
    if ntpath.splitdrive(filename)[0]:  # `C:foo.png` — a drive-relative alias, not a bare name
        return False
    if Path(filename).suffix.lower() not in ALLOWED_TYPES:
        return False
    path = directory / filename
    if not is_served_file(path):
        return False
    try:
        path.unlink()
    except OSError:
        return False
    fsync_dir(path.parent)
    return True


def sweep_part_files(home: Path, namespaces: Iterable[str]) -> int:
    """Empty the `.parts/` scratch dir of every REGISTERED role — the temps a crash stranded.

    Called once at app construction. Nothing else can clean them: the pipeline unlinks its own temp
    in `finally`, so anything still there outlived the process that made it.

    **It cannot reach OWNER TERRITORY, by construction** (Emma MED-2): the only paths it looks at are
    inside a directory this module creates for its own scratch files, so nothing the index or the
    mount can see is ever a candidate — including a file named `.ctrlb-upload-x.part` in the role
    folder itself, which the owner is entitled to drop there.

    **Inside `.parts/`, the naming convention is the contract** (scoped honestly, main-seat ruling on
    Emma's residual): the directory is DECLARED app-owned scratch, so a file an owner puts there
    matching the prefix AND suffix exactly is swept like any other stranded temp. What is enforced —
    and pinned by test — is the SURFACE: deletion reaches exactly the convention names and nothing
    else in that directory. Going further would mean creation-evidence bookkeeping (an inode
    manifest) that nothing else in this codebase carries for its own scratch dirs.

    A `.parts` that is a SYMLINK is refused rather than walked (it would relocate the sweep somewhere
    else entirely — the `ensure_media_dirs` reasoning, one level down); the WRITE path refuses the
    same shape (`_require_real_scratch_dir`), because a guard only on the cleanup path protects
    nothing while an upload is running. A namespace whose tree failed the boot check is not passed in.
    """
    removed = 0
    for ns in namespaces:
        row = MEDIA_NAMESPACES.get(ns)
        if row is None:
            continue
        for role in row.roles:
            parts = role_dir(home, ns, role) / PARTS_DIRNAME
            if parts.is_symlink():
                continue
            try:
                entries = list(parts.iterdir())
            except OSError:  # no `.parts/` yet, or it is not a directory — nothing to sweep
                continue
            for p in entries:
                if p.name.startswith(PART_PREFIX) and p.name.endswith(PART_SUFFIX):
                    with contextlib.suppress(OSError):
                        p.unlink()
                        removed += 1
    return removed
