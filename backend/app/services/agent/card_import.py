"""Character-card import (Phase 23 / D70, ROLEPLAY_PLAN §5) — a V1/V2/V3 card in one of the three
locked containers, turned into the agent fields the rest of the app already persists.

Everything here is pure service logic over BYTES: it reads, refuses or maps, and hands back what the
API layer writes through the writes that already exist (agent scaffold + SOUL.md + the media ladder).
Nothing in this module creates a file except the avatar, and that goes through `UploadPart`.

**Sniffing is by MAGIC BYTES, never by extension or content-type** (§5.2, R66 §1): the field's
"JPEG cards" are zips glued behind a JPEG, and a card's filename is whatever a phone's downloads
folder made of it. Three containers, and the third is the fallback:

  * **PNG/APNG** — the card is a base64 `tEXt` chunk. `ccv3` (V3) beats `chara` (V1/V2) when both
    are present, which is spec-normative; both shipping readers agree and compare the keyword
    case-insensitively. The PNG itself is the avatar.
  * **CHARX** — a zip whose `card.json` sits at the root, with assets addressed `embeded://…`
    (the spec's OWN misspelling — resolved as spelled, plus the two spellings ST also tolerates).
    **We read `card.json` and the icon asset, and NOTHING else.** That is §7's structural handling
    of executable content: Risu's module member — the thing whose scripts its importer folds into
    `triggerscript`/`customScripts` — is never opened, so there is no payload to strip.
  * **JSON** — the plain card object, discriminated by `spec`; no `spec` key ⇒ the V1 heuristic.

**The strip pass is a normalized-key DENYLIST applied recursively before stashing** (§7, Emma F7):
prose categories cannot drive a sanitizer, so `strip_executable` names the keys and reports the
exact paths it removed. It is written to be reused verbatim by a future export — strip-on-import
AND on export is the field's own precedent.

**Every cap is config** (§5.3, Emma F8 → `roleplay.card_import`): no magic numbers here.

Non-goals, recorded so they are not mistaken for gaps: WEBP-EXIF cards (one importer in the field),
`.byaf`, V3 multi-asset routing (sprites/emotions/user icons — the extras are stashed with a report
line), and the embedded `character_book`, which rides the `card` stash until S3's book import lands.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import re
import struct
import zipfile
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.core.media import (
    HEAD_BYTES,
    StoreWriteError,
    UploadPart,
    admission_reason,
    signature_format,
    suffix_for_format,
)
from app.services.agent.skills import valid_skill_slug

if TYPE_CHECKING:
    from collections.abc import Collection
    from pathlib import Path

    from app.config import CardImportCfg


class CardImportError(Exception):
    """A refused import, carrying the STATUS the route answers with and the sentence it says.

    The `StoreWriteError` shape deliberately, but NOT that class: an avatar failure is a
    `StoreWriteError` the route degrades to a report warning (§5.4) while a card failure refuses the
    whole import, so the two have to be catchable apart. The status is decided where the rule lives:
    `413` a cap, `415` not a card container we read, `422` a container we read whose card is
    unusable, `409` a name that cannot be minted."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ── the containers ────────────────────────────────────────────────────────────────────────────────

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
ZIP_SIGNATURE = b"PK\x03\x04"

#: The `tEXt` keywords a card rides in, in PRECEDENCE order: `ccv3` wins when both are present
#: (SPEC_V3 — "if the application detects both … *SHOULD* use the `ccv3` chunk"). Compared casefolded,
#: like both shipping readers do.
CARD_KEYWORDS = ("ccv3", "chara")

#: `card.json` at the root of the zip — the spec's MUST, and the only member we look for by name.
CHARX_CARD = "card.json"

#: The in-zip asset URI prefixes. `embeded://` is the spec's own spelling and is normative; the other
#: two are what ST tolerates for Risu's and V3-PNG's variants. Anything else (http, data, ccdefault)
#: names something outside this container and is ignored.
ASSET_PREFIXES = ("embeded://", "embedded://", "__asset:")


@dataclass(frozen=True)
class Container:
    """What one upload turned out to BE: which container carried it, the raw card object, the image
    that container offers as the avatar (`None` when it offers none), and the notes the reader wants
    the import report to show."""

    kind: str
    card: dict[str, Any]
    image: bytes | None = None
    notes: list[str] = field(default_factory=list)


def read_container(body: bytes, cfg: CardImportCfg) -> Container:
    """Sniff `body` and read the card out of it — magic bytes only (§5.2).

    A body that is none of the three is a `415`: it is not that the card is broken, it is that this
    is not a container we read."""
    if body.startswith(PNG_SIGNATURE):
        return _read_png(body, cfg)
    if body.startswith(ZIP_SIGNATURE):
        return _read_charx(body, cfg)
    return _read_json(body, cfg)


def _read_png(body: bytes, cfg: CardImportCfg) -> Container:
    chunks = _png_text_chunks(body)
    present = [k for k in CARD_KEYWORDS if k in chunks]
    if not present:
        raise CardImportError(415, "this PNG carries no character card (no `ccv3` or `chara` tEXt chunk)")
    notes = []
    if len(present) > 1:
        # The spec's downgrade note, pointed the useful way: we took the NEWER one, and saying so is
        # what stops "why did my V2 edits not apply" being a mystery.
        notes.append("the card carried both `ccv3` and `chara` metadata; the V3 chunk was used")
    return Container("png", _decode_card_json(chunks[present[0]], cfg, base64_encoded=True), body, notes)


def _png_text_chunks(body: bytes) -> dict[str, bytes]:
    """Every `tEXt` chunk as `{keyword casefolded: value}` — hand-parsed with `struct`, the house
    precedent (`probe_image` reads PNG the same way, and a decoder dependency for four bytes of
    keyword would be a strange thing to add).

    A chunk is `length(4) type(4) data crc(4)`; `tEXt` data is `keyword\\0value` in Latin-1 (PNG
    §11.3.4.3). The FIRST occurrence of a keyword wins (ST takes the first index) and a truncated or
    over-long chunk simply ends the walk: what we found up to there is what the file actually holds.
    """
    chunks: dict[str, bytes] = {}
    i = len(PNG_SIGNATURE)
    while i + 8 <= len(body):
        (length,) = struct.unpack(">I", body[i : i + 4])
        ctype = body[i + 4 : i + 8]
        start = i + 8
        end = start + length
        if end + 4 > len(body):
            break
        if ctype == b"tEXt":
            keyword, sep, value = body[start:end].partition(b"\x00")
            if sep:
                chunks.setdefault(keyword.decode("latin-1").strip().casefold(), value)
        if ctype == b"IEND":
            break
        i = end + 4
    return chunks


def _read_charx(body: bytes, cfg: CardImportCfg) -> Container:
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except (zipfile.BadZipFile, OSError) as exc:
        raise CardImportError(422, "the file starts like a zip but is not a readable CHARX") from exc
    with archive:
        _check_zip_bounds(archive, cfg)
        raw = _zip_member(archive, CHARX_CARD, cfg.max_card_json_bytes)
        if raw is None:
            raise CardImportError(422, f"the CHARX file has no `{CHARX_CARD}` at its root")
        card = _decode_card_json(raw, cfg)
        image, notes = _charx_icon(archive, card, cfg)
    return Container("charx", card, image, notes)


def _check_zip_bounds(archive: zipfile.ZipFile, cfg: CardImportCfg) -> None:
    """The container's own bounds, checked against the DECLARED sizes before a single byte is
    decompressed — which is the whole point of a zip-bomb guard — and over EVERY member, read or not:
    what is being bounded is the archive, not our appetite for it.

    Entry paths are checked here too. We extract nothing to disk, so a traversal name cannot escape
    anywhere; it is refused because an archive carrying one is hostile or broken, and answering that
    honestly at the door beats reading a card out of it."""
    infos = archive.infolist()
    if len(infos) > cfg.charx_max_entries:
        raise CardImportError(
            413,
            f"the CHARX file has more than roleplay.card_import.charx_max_entries "
            f"({cfg.charx_max_entries}) members",
        )
    total = 0
    for info in infos:
        if unsafe_entry(info.filename):
            raise CardImportError(422, f"the CHARX file has an unsafe entry path: {info.filename!r}")
        if info.file_size > cfg.charx_max_entry_bytes:
            raise CardImportError(
                413,
                f"a CHARX member is larger than roleplay.card_import.charx_max_entry_bytes "
                f"({cfg.charx_max_entry_bytes} bytes)",
            )
        total += info.file_size
    if total > cfg.charx_max_total_bytes:
        raise CardImportError(
            413,
            f"the CHARX file expands to more than roleplay.card_import.charx_max_total_bytes "
            f"({cfg.charx_max_total_bytes} bytes)",
        )


def unsafe_entry(name: str) -> bool:
    """Is this zip member path one we refuse to read? Public because it states a rule, not a detail.

    The spec's own separator is `/` and its own advice is ASCII names. Absolute paths, drive
    qualifiers and `..` segments are the three ways a name addresses something other than what it
    appears to; `\\` is refused because `ntpath` would read it as a separator we did not normalize.
    An empty name is not a member."""
    if not name or name.startswith("/") or "\\" in name:
        return True
    if re.match(r"^[A-Za-z]:", name):
        return True
    return ".." in name.split("/")


def _zip_member(archive: zipfile.ZipFile, name: str, cap: int) -> bytes | None:
    """One member's bytes, or `None` when it is not in the archive. Reads at most `cap + 1` — the
    declared-size check ran already, and this is the guard for a header that LIED about it."""
    try:
        with archive.open(name) as f:
            data = f.read(cap + 1)
    except KeyError:
        return None
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:  # corrupt/encrypted member
        raise CardImportError(422, f"the CHARX member {name!r} could not be read") from exc
    if len(data) > cap:
        raise CardImportError(413, f"the CHARX member {name!r} is larger than its configured cap")
    return data


def _charx_icon(
    archive: zipfile.ZipFile, card: dict[str, Any], cfg: CardImportCfg
) -> tuple[bytes | None, list[str]]:
    """The card's avatar out of the zip: the `icon` asset named `main`, else the first icon (ST's own
    pick order). Everything else the card declares is a V3 multi-asset non-goal (§5.4) — counted into
    a report line rather than silently ignored, and never read."""
    assets = [a for a in _asset_list(card) if isinstance(a, dict)]
    icons = [a for a in assets if _text(a.get("type")).strip().casefold() == "icon"]
    chosen = next((a for a in icons if _text(a.get("name")).strip().casefold() == "main"), None)
    chosen = chosen or (icons[0] if icons else None)
    notes: list[str] = []
    extras = len(assets) - (1 if chosen is not None else 0)
    if extras > 0:
        notes.append(f"{extras} further card asset(s) were not imported — v1 imports the avatar only")
    if chosen is None:
        return None, notes
    member = _asset_path(_text(chosen.get("uri")))
    if member is None:
        notes.append("the card's icon asset lives outside the file, so no avatar was imported")
        return None, notes
    data = _zip_member(archive, member, cfg.charx_max_entry_bytes)
    if data is None:
        notes.append(f"the card's icon asset {member!r} is missing from the file")
    return data, notes


def _asset_list(card: dict[str, Any]) -> list[Any]:
    """The card's `assets`, under either shape — V3 keeps it in `data`, an off-spec card flat. Read
    here rather than after normalization because the ZIP is only open during the read."""
    data = card.get("data")
    block = data if isinstance(data, dict) else card
    assets = block.get("assets")
    return assets if isinstance(assets, list) else []


def _asset_path(uri: str) -> str | None:
    """The in-zip path an asset URI names, or `None` for a URI that names something else."""
    for prefix in ASSET_PREFIXES:
        if uri.startswith(prefix):
            member = uri[len(prefix) :].lstrip("/")
            return None if unsafe_entry(member) else member
    return None


def _read_json(body: bytes, cfg: CardImportCfg) -> Container:
    if len(body) > cfg.max_card_json_bytes:
        raise CardImportError(
            413,
            f"the card JSON is larger than roleplay.card_import.max_card_json_bytes "
            f"({cfg.max_card_json_bytes} bytes)",
        )
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CardImportError(415, _UNRECOGNIZED) from exc
    if not isinstance(parsed, dict):
        raise CardImportError(415, _UNRECOGNIZED)
    return Container("json", parsed)


#: The one sentence for "we do not read this": stated once so the three sniff arms cannot drift into
#: three different answers to the same question.
_UNRECOGNIZED = "not a recognized character card container (PNG/APNG with a card chunk, CHARX, or card JSON)"


def _decode_card_json(raw: bytes, cfg: CardImportCfg, *, base64_encoded: bool = False) -> dict[str, Any]:
    """The card object out of one container's payload, capped and validated.

    The cap is on the DECODED bytes: that is what ends up in `agent.yaml` and on the wire, so it is
    what has to be bounded — a base64 chunk is a third larger than what it carries."""
    if base64_encoded:
        try:
            raw = base64.b64decode(raw, validate=False)
        except (binascii.Error, ValueError) as exc:
            raise CardImportError(422, "the card metadata is not valid base64") from exc
    if len(raw) > cfg.max_card_json_bytes:
        raise CardImportError(
            413,
            f"the card JSON is larger than roleplay.card_import.max_card_json_bytes "
            f"({cfg.max_card_json_bytes} bytes)",
        )
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CardImportError(422, "the card metadata is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise CardImportError(422, "the card metadata is not a character card object")
    return parsed


# ── the normalization ladder ──────────────────────────────────────────────────────────────────────

#: The card fields this importer MAPS (§3.1/§5.3). Everything else the card carries — known metadata
#: (`creator_notes`/`tags`/`creator`/`character_version`), `extensions`, `character_book`, `assets`
#: and anything a future spec adds — is stash, verbatim and post-strip. Order is report order.
MAPPED_FIELDS = (
    "name",
    "system_prompt",
    "description",
    "personality",
    "first_mes",
    "alternate_greetings",
    "mes_example",
    "scenario",
    "post_history_instructions",
)

#: The V1 sniff: a flat object SHAPED like a card (R66 §1.6 — Risu's content-shaped test, which is
#: the tolerant one). `name` plus at least one of these.
_V1_BODY = ("description", "personality", "first_mes")


def normalize(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """`(fields, extras)` — the card's field map under the V1→V2→V3 ladder, plus the top-level keys
    that are not part of it.

    A `spec`-carrying card keeps its fields under `data` (V2 and V3 alike); no `spec` key is the V1
    heuristic, where the object IS the field map. The flat V1 MIRROR that ST writes beside `data` is
    dropped rather than stashed: it is redundant by construction (V2 wins on conflict, and a
    divergence only ever warned), so keeping it would duplicate the persona prose into `agent.yaml`.
    """
    spec = _text(raw.get("spec")).strip()
    if spec:
        data = raw.get("data")
        if not isinstance(data, dict):
            raise CardImportError(422, f"the card declares spec {spec!r} but carries no `data` object")
        return data, {k: v for k, v in raw.items() if k != "data" and k not in MAPPED_FIELDS}
    if not (_text(raw.get("name")).strip() and any(_text(raw.get(k)).strip() for k in _V1_BODY)):
        raise CardImportError(
            422,
            "the JSON is not a character card: no `spec` field, and not the V1 shape either "
            "(a `name` plus a description, personality or first message)",
        )
    return raw, {}


# ── the strip pass (§7, Emma F7) ──────────────────────────────────────────────────────────────────

#: The executable-content key DENYLIST, casefolded. Concrete keys rather than a prose category,
#: because a category cannot drive a sanitizer: `customScripts` is Risu's LIVE field (the older
#: `regex_scripts` name is gone), `triggerscript`/`virtualscript` are the other two script carriers,
#: and `lowLevelAccess` is the flag that widens what they may do. Matched at ANY depth — V3 permits
#: nesting and the canonical home is `extensions.risuai.*`, but nothing guarantees it stays there.
#:
#: CHARX's own code carrier is handled STRUCTURALLY instead (the confirm-round F7 correction): the
#: reader above opens `card.json` and the icon asset only, so a module member is never read at all.
SCRIPT_KEYS = frozenset({"customscripts", "triggerscript", "virtualscript", "lowlevelaccess"})


def strip_executable(tree: Any) -> tuple[Any, list[str]]:
    """`(cleaned, removed_paths)` — `tree` with every denylisted key removed at any depth, and the
    EXACT dotted paths that were removed, for the import report.

    ONE function over every shape (V1/V2/V3/raw extensions), and written to be reused verbatim on a
    future export — strip-on-import AND on export is the field's precedent, and a second
    implementation for the other direction is how the two drift. Inert unknown extension data
    survives untouched (P4): this removes code, not foreignness."""
    removed: list[str] = []
    return _strip(tree, "", removed), removed


def _strip(node: Any, path: str, removed: list[str]) -> Any:
    if isinstance(node, dict):
        out: dict[Any, Any] = {}
        for key, value in node.items():
            here = f"{path}.{key}" if path else str(key)
            if isinstance(key, str) and key.casefold() in SCRIPT_KEYS:
                removed.append(here)
                continue
            out[key] = _strip(value, here, removed)
        return out
    if isinstance(node, list):
        return [_strip(v, f"{path}[{i}]", removed) for i, v in enumerate(node)]
    return node


# ── the slug mint ─────────────────────────────────────────────────────────────────────────────────

#: What the agent-name grammar (`valid_skill_slug`) does not admit, collapsed to one separator.
_NON_SLUG = re.compile(r"[^a-z0-9_-]+")
_DASH_RUN = re.compile(r"-{2,}")
#: `SKILL_SLUG`'s own budget: a leading `[a-z0-9]` plus 63 more.
_MAX_SLUG = 64
#: What a card whose name survives as nothing is called. A card with an emoji for a name is a real
#: thing; refusing the import over it would be the wrong answer to a cosmetic problem.
FALLBACK_SLUG = "character"


def mint_slug(name: str, taken: Collection[str]) -> str:
    """A folder slug for this card's name: casefolded, everything outside the grammar collapsed to
    `-`, runs collapsed, edges trimmed — then suffix-walked past anything already taken (existing
    agents AND the default agent's own name, which is not a folder but is not free either)."""
    base = _slugify(name)
    if not valid_skill_slug(base):
        base = FALLBACK_SLUG
    if base not in taken:
        return base
    for n in range(2, 1000):
        stem = base[: _MAX_SLUG - len(str(n)) - 1].strip("-_") or FALLBACK_SLUG
        candidate = f"{stem}-{n}"
        if candidate not in taken:
            return candidate
    raise CardImportError(409, f"too many agents are already named like {base!r}")


def _slugify(name: str) -> str:
    slug = _DASH_RUN.sub("-", _NON_SLUG.sub("-", name.strip().casefold())).strip("-_")
    return slug[:_MAX_SLUG].strip("-_")


# ── the mapping ───────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ImportedCard:
    """One card, mapped: what to call the agent, what its `agent.yaml` and `SOUL.md` hold, the image
    the container offered, and everything the import report shows."""

    container: str
    slug: str
    #: The card's own name, verbatim — the `title` when it differs from the slug.
    name: str
    soul: str
    fields: dict[str, Any]
    image: bytes | None
    post_history: str
    mapped: list[str]
    stashed: list[str]
    stripped: list[str]
    warnings: list[str]


def import_card(
    body: bytes, cfg: CardImportCfg, *, taken: Collection[str], default_tools: Collection[str]
) -> ImportedCard:
    """Read, strip and map one uploaded card. Writes nothing — the caller lands the avatar and the
    files (§5.1: the importer COMPOSES the existing writes, it does not grow a second write path)."""
    container = read_container(body, cfg)
    fields_map, extras = normalize(container.card)
    name = _text(fields_map.get("name")).strip()
    slug = mint_slug(name, taken)

    stash_raw = {**extras, **{k: v for k, v in fields_map.items() if k not in MAPPED_FIELDS}}
    stash, stripped = strip_executable(stash_raw)

    greeting = _text(fields_map.get("first_mes"))
    example_dialogue = _text(fields_map.get("mes_example"))
    scenario = _text(fields_map.get("scenario"))
    post_history = _text(fields_map.get("post_history_instructions"))
    alt_greetings = _string_list(fields_map.get("alternate_greetings"))

    # Written EXPLICITLY, never left to the `"*"` default (§5.5): our default is the WIDEST value, so
    # relying on it would invert ruling 8's minimal-tools posture. `privilege` is the opposite case —
    # its own default IS the answer (CONFIRM), so nothing is written for it.
    fields: dict[str, Any] = {"duties": "conversational", "tools": list(default_tools)}
    if name and name != slug:
        fields["title"] = name
    # An empty field is ABSENT, not written blank (ruling 10): `agent.yaml` stays as small as the
    # card was, and the owner opens a file that says only what their character actually sets.
    # `AgentDef.description` is deliberately NOT among these (§5.3): it is the auto-router's "when to
    # pick me", and a card's description is persona prose. An imported character is reached by an
    # explicit pick until the owner writes a routing line themselves.
    for key, value in (
        ("greeting", greeting),
        ("alt_greetings", alt_greetings),
        ("example_dialogue", example_dialogue),
        ("scenario", scenario),
        ("post_history", post_history),
        ("card", stash),
    ):
        if value:
            fields[key] = value

    warnings = list(container.notes)
    if "character_book" in stash:
        warnings.append(
            "the card's embedded lorebook is stashed on `card.character_book`; it becomes a real "
            "lorebook when book import lands"
        )
    return ImportedCard(
        container=container.kind,
        slug=slug,
        name=name,
        soul=compose_soul(fields_map),
        fields=fields,
        image=container.image,
        post_history=post_history,
        mapped=[k for k in MAPPED_FIELDS if fields_map.get(k)],
        stashed=sorted(stash),
        stripped=stripped,
        warnings=warnings,
    )


def compose_soul(fields: dict[str, Any]) -> str:
    """The card → SOUL.md recipe, NORMATIVE (§5.3, Emma F4): `system_prompt` + blank line +
    `description` + blank line + `personality`, in that order, empty fields skipped, NO labels or
    headers added.

    Bare concatenation because the field's cards carry finished prose — framing the author did not
    write is editorializing. `{{original}}` and the other macros stay verbatim: the macro pass runs
    at ASSEMBLY, not at import."""
    parts = [_text(fields.get(k)).strip() for k in ("system_prompt", "description", "personality")]
    return "\n\n".join(p for p in parts if p)


def _text(value: Any) -> str:
    """A card field as text. Cards are hand-edited JSON and the field's own importers coerce rather
    than refuse (`data.description || ''`): a number or a bool becomes its string, a structure
    becomes nothing, and an absent field is empty."""
    if isinstance(value, str):
        return value
    if value is None or isinstance(value, dict | list):
        return ""
    return str(value)


def _string_list(value: Any) -> list[str]:
    """`alternate_greetings` as a list. The field really does ship as an array, as a bare string, and
    as garbage (ST accepts all three); garbage yields nothing rather than a refusal."""
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [_text(v) for v in value if _text(v).strip()]
    return []


# ── the avatar (§5.4) ─────────────────────────────────────────────────────────────────────────────

#: How many `-2`, `-3`… names the landing walks before giving up. The 409 walk is the media client's
#: own idiom; the bound exists so a pathological library cannot spin here.
_NAME_TRIES = 50


def land_avatar(directory: Path, data: bytes, slug: str, *, max_bytes: int) -> str:
    """Put the card's image into the `agents/avatars` library and return the LANDED FILENAME.

    Through the existing ladder, whole (§5.4): `UploadPart.open` → `write` → `finish`, so the probe
    and the closed type allowlist decide whether these bytes may be stored — this function never
    validates an image itself. The NAME is minted here (the card's slug plus the extension its
    signature claims) and `finish`'s own probe is the authority on whether the two agree: a signature
    that lied costs a 415, not a mislabelled file.

    `409` — the name is taken — walks to the next suffix exactly as the gallery's client does. Each
    attempt is a fresh part: the ladder's temp is consumed by its landing, and re-opening is cheaper
    than reasoning about a half-used one."""
    suffix = suffix_for_format(signature_format(data[:HEAD_BYTES]))
    if suffix is None:
        raise CardImportError(415, "the card's image is not an accepted image format")
    for n in range(1, _NAME_TRIES + 1):
        name = f"{slug}{suffix}" if n == 1 else f"{slug}-{n}{suffix}"
        reason = admission_reason(name)
        if reason is not None:  # pragma: no cover — the slug grammar is a subset of the admitted one
            raise CardImportError(422, reason)
        part = UploadPart.open(directory, max_bytes=max_bytes)
        try:
            part.write(data)
            part.finish(directory / name, "agents", "avatars")
            return name
        except StoreWriteError as exc:
            if exc.status != 409:
                raise
        finally:
            part.discard()
    raise CardImportError(409, f"the avatars library already holds {_NAME_TRIES} images named {slug!r}")
