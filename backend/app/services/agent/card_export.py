"""Character-card export (Phase 23 S9 / D79, ROLEPLAY_PLAN §15.2) — `card_import` read backwards.

`compose_card` turns a saved character — its `AgentDef`, its SOUL, the `card.json` sidecar the import
kept and the books it links — into the V3 card object plus its V2 projection. The route writes those
into a PNG carrier (`card_import.write_card_chunks`) or returns the V3 object as the JSON download.

**The CURRENT character wins** (ST exports the live character, `characters.js:1657-1666`); the sidecar
supplies everything we never mapped. Every live field is an explicit SET or DELETE over that base,
never a conditional overlay (Opus F1): the importer writes an empty field as ABSENT, so "absent on
the live side" means "empty now", not "keep the sidecar's".

**The SOUL rule** is the one place the export has to decide what a field WAS: SOUL.md fuses
`system_prompt` + `description` + `personality` (`compose_soul`), so the original three-way split is
restored only when the SOUL still equals that composition under the SOUL writer's own normalisation —
`write_text_eol` folds CRLF → LF and the text-mode read folds a lone CR, so the comparison folds both
(Opus F13; both dev cards carried CRLF and would silently take the lossy branch on a raw compare).
An edited SOUL is one text now, and it exports as the description (the RP-8 loss, stated honestly).

**`strip_executable` runs on the way OUT too**, on the envelope and on `data` apart, exactly as the
import runs it (Maya F1): the sidecar was stripped at import, but the live fields are owner-typed.

Pure: reads its arguments, returns dicts, writes nothing, raises nothing owner-shaped.
"""

from __future__ import annotations

import copy
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.services.agent.card_import import (
    MAPPED_FIELDS,
    CardImportError,
    Normalized,
    _envelope,
    compose_soul,
    strip_executable,
)
from app.services.agent.lorebook_export import book_out, merged_book

if TYPE_CHECKING:
    from app.domain.agent import AgentDef
    from app.services.agent.lorebooks import Lorebook

#: The three card fields SOUL.md is composed from, in `compose_soul`'s order.
SOUL_FIELDS = ("system_prompt", "description", "personality")

#: `{card field: AgentDef attribute}` — the import's verbatim mapping (`import_card`), inverted. With
#: `name` and `SOUL_FIELDS` this is every one of `MAPPED_FIELDS` (a test pins the union).
LIVE_FIELDS: dict[str, str] = {
    "first_mes": "greeting",
    "alternate_greetings": "alt_greetings",
    "mes_example": "example_dialogue",
    "scenario": "scenario",
    "post_history_instructions": "post_history",
}

#: The spec's required non-mapped keys, as the empty value a card with NO sidecar (the default agent,
#: a hand-made character) fills them with — a reader that indexes them must not meet `undefined`.
REQUIRED_EMPTY: dict[str, Any] = {
    "creator_notes": "",
    "tags": [],
    "creator": "",
    "character_version": "",
    "extensions": {},
    "group_only_greetings": [],
}

#: The keys only V3 has — the V2 projection drops them (ccv3 SPEC_V3 §"backfill", pinned SHA in R66 §0).
V3_ONLY = (
    "nickname",
    "creator_notes_multilingual",
    "source",
    "group_only_greetings",
    "creation_date",
    "modification_date",
    "assets",
)

#: The carrier IS the icon: `ccdefault:` names "the image this card rides in". A CHARX import's other
#: assets were never read, and a dangling `embeded://` URI makes Risu throw (R66 §2.4; Opus F4).
ICON_ASSETS: list[dict[str, str]] = [{"type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png"}]


@dataclass(frozen=True)
class ComposedCard:
    """One exported card: the V3 object (the JSON download and the `ccv3` chunk), its V2 projection
    (the `chara` chunk), and the filename stem the client names the download with."""

    v3: dict[str, Any]
    v2: dict[str, Any]
    stem: str


def _fold_newlines(text: str) -> str:
    """What the SOUL writer and reader together do to line endings: CRLF → LF (`write_text_eol`), then
    a lone CR → LF (a text-mode read's universal newlines)."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def soul_is_unedited(sidecar_data: dict[str, Any], soul: str) -> bool:
    """Whether `soul` (the stripped read `Settings._read_soul` performs) is still exactly what the
    import composed from the sidecar's three fields, under the writer's newline fold."""
    try:
        composed = compose_soul(sidecar_data)
    except CardImportError:  # a sidecar the import could never have written — treat it as edited
        return False
    return _fold_newlines(composed).strip() == _fold_newlines(soul).strip()


def _is_timestamp(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def compose_card(
    *,
    slug: str,
    agent: AgentDef,
    soul: str,
    sidecar: dict[str, Any] | None,
    books: list[tuple[str, Lorebook]],
    now: int | None = None,
) -> ComposedCard:
    """The card for one saved character (§15.2). `sidecar` is `card.json` (`None` when the agent has
    none); `books` are its EFFECTIVE linked books, in link order; `now` is the unix-seconds clock (a
    parameter so the composition is reproducible)."""
    stamp = int(time.time()) if now is None else now
    raw_data = sidecar.get("data") if sidecar else None
    has_sidecar = sidecar is not None and isinstance(raw_data, dict)
    data: dict[str, Any] = {}
    # The envelope's own unknown keys, back beside `data` where they arrived (R89/E-4).
    envelope: dict[str, Any] = {}
    if sidecar is not None and isinstance(raw_data, dict):
        data = copy.deepcopy(raw_data)
        envelope = {
            k: copy.deepcopy(v) for k, v in sidecar.items() if k not in ("spec", "spec_version", "data")
        }
    if not has_sidecar:
        for key, empty in REQUIRED_EMPTY.items():
            data.setdefault(key, copy.deepcopy(empty))

    # Identity (Maya F3): the authored name stays the name; a retitle is the V3 nickname — the
    # import's `nickname → title` read backwards.
    title = agent.title.strip()
    authored = data.get("name")
    if not (isinstance(authored, str) and authored.strip()):
        authored = title or slug
        data["name"] = authored
    name = authored.strip()
    if title and title != name:
        data["nickname"] = title
    else:
        data.pop("nickname", None)

    # The SOUL rule: an unedited SOUL keeps the sidecar's own three values (absent ones are filled
    # empty with every other mapped field below); an edited one is one text now.
    if not (has_sidecar and soul_is_unedited(data, soul)):
        data["system_prompt"] = ""
        data["description"] = soul
        data["personality"] = ""

    for card_key, attr in LIVE_FIELDS.items():
        value = getattr(agent, attr)
        data[card_key] = list(value) if isinstance(value, list) else value

    extensions = data.get("extensions")
    extensions = dict(extensions) if isinstance(extensions, dict) else {}
    loaded = [book for _, book in books]
    if not loaded:
        data.pop("character_book", None)
        extensions.pop("world", None)
    else:
        embedded = (
            book_out(loaded[0], dialect="spec")
            if len(loaded) == 1
            else merged_book(f"{name} lorebook", loaded)
        )
        if not embedded.get("name"):
            embedded["name"] = f"{name} lorebook"
        data["character_book"] = embedded
        extensions["world"] = embedded["name"]
    data["extensions"] = extensions

    if not _is_timestamp(data.get("creation_date")):
        data["creation_date"] = stamp
    data["modification_date"] = stamp
    data["assets"] = copy.deepcopy(ICON_ASSETS)

    # Every mapped field is present as a value — a spec reader indexes all of them.
    for key in MAPPED_FIELDS:
        data.setdefault(key, [] if key == "alternate_greetings" else "")

    clean_envelope, _ = strip_executable(envelope)
    clean_data, _ = strip_executable(data, root="/data")
    v3 = _envelope(Normalized("v3", clean_data, clean_envelope), clean_envelope, clean_data)
    v2_data = {k: v for k, v in clean_data.items() if k not in V3_ONLY}
    v2 = _envelope(Normalized("v2", v2_data, clean_envelope), clean_envelope, v2_data)
    return ComposedCard(v3=v3, v2=v2, stem=title or slug)
