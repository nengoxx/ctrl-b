"""Lorebook import (Phase 23 / D70, ROLEPLAY_PLAN §6.5) — the three circulating book shapes, turned
into the one `Lorebook` the scan reads.

Pure service logic over a PARSED JSON value: it maps or refuses, and the caller writes (the same
division `card_import` keeps — the importer composes nothing and creates no file).

**The three shapes (R65 §5), sniffed from the value itself, never from a filename:**

  * the V3 envelope `{"spec": "lorebook_v3", "data": {…}}`;
  * ST's raw standalone export — a book object whose `entries` is a DICT keyed by uid;
  * a bare list of entries.

A V3 card's embedded `character_book` is a fourth ARRIVAL but not a fourth shape: it is the same
book object as the envelope's `data`, so it comes through this same function (§6.5).

**Two rules are load-bearing and both are RULED, never inferred:**

  * **The alias table** — V3/spec names win when both are present, ST's raw names are the fallback,
    and `matchWholeWords` ABSENT means TRUE (ST's shipped default, R65 §1.2 — its code default
    differs, and reading the code instead of the shipped config is how an importer silently changes
    every entry's matching).
  * **The position downgrade is never silent.** The field's books use positions 0–7 and v1 stores
    `head | tail` (§6.4), so every collapse gets a report line NAMING the entry and what was lost.
    The one exception is ST position 1 (after the character definitions), which is EXACTLY where our
    head block sits — that is a landing, not a downgrade.

Everything the table does not consume is stashed on the entry/book verbatim (`extra="allow"`), which
is why `name`/`comment`/`depth`/`role`/`probability`/`extensions` need no per-field handling: they
survive by not being touched.

`CardImportError` and the two JSON coercions are IMPORTED from `card_import` rather than
re-written: a refused import is one class with one status contract, and "hand-edited JSON coerces
rather than refuses" is one rule, not two implementations of one rule.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.agent.card_import import CardImportError, _string_list, _text
from app.services.agent.lorebooks import Lorebook, LorebookEntry

#: The V3 standalone-book discriminator, exactly (the `spec` field says what these bytes ARE — a
#: value we do not know names a format we cannot claim to have read, `card_import.normalize`'s rule).
BOOK_SPEC = "lorebook_v3"

#: `{our field: the source names, in PRECEDENCE order}` — the V3/spec name first, ST's raw name
#: second. Every listed name is CONSUMED whichever one wins: a source carrying both is writing the
#: same fact twice (ST does this for cards too), and stashing the loser would put a contradictory
#: second copy in the file the owner edits.
_ALIASES: dict[str, tuple[str, ...]] = {
    "keys": ("keys", "key"),
    "secondary_keys": ("secondary_keys", "keysecondary"),
    "order": ("order", "insertion_order"),
    "case_sensitive": ("case_sensitive", "caseSensitive"),
    "whole_words": ("whole_words", "matchWholeWords"),
}

#: `{source position: (our position, what was collapsed)}` — `None` = an exact landing, no report.
#: Both spellings the field ships: ST's numeric enum and V3's two strings. Position 1 / `after_char`
#: is the exact one because our head block sits after the character definitions, which is what that
#: position means.
_POSITIONS: dict[Any, tuple[str, str | None]] = {
    1: ("head", None),
    "after_char": ("head", None),
    0: ("head", "it sat BEFORE the character definitions, and our head block sits after them"),
    "before_char": ("head", "it sat BEFORE the character definitions, and our head block sits after them"),
    5: ("head", "it sat at the top of the example messages"),
    6: ("head", "it sat at the bottom of the example messages"),
    7: ("head", "it targeted a named injection outlet, which v1 has none of"),
    2: ("tail", "it was an author's note above the note text"),
    3: ("tail", "it was an author's note below the note text"),
    4: ("tail", "it was injected at a fixed depth and role in the history, both of which collapse"),
}

#: `{ST selectiveLogic: (our logic, what was approximated)}`. AND-ANY and NOT-ANY are ours exactly;
#: the two ALL variants have no v1 equivalent, so each lands on its ANY sibling WITH a report line —
#: the entry then activates more readily (AND-ALL) or less (NOT-ALL) than the author wrote.
_LOGIC: dict[int, tuple[str, str | None]] = {
    0: ("and_any", None),
    2: ("not_any", None),
    3: ("and_any", "AND-ALL (every secondary key had to hit) was approximated as AND-ANY"),
    1: ("not_any", "NOT-ALL (only all-of-them blocked) was approximated as NOT-ANY"),
}


@dataclass(frozen=True)
class ImportedBook:
    """One book, mapped, plus everything the import report shows: which SOURCE keys were read, which
    were kept verbatim as stash, and every approximation that was made along the way."""

    book: Lorebook
    mapped: list[str]
    stashed: list[str]
    warnings: list[str] = field(default_factory=list)


def import_book(raw: Any, *, default_name: str = "") -> ImportedBook:
    """Map one parsed book value onto `Lorebook`. Writes nothing.

    `default_name` is what the book is called when the source did not name it — the character's name
    for a card's embedded book, which is the only place a book arrives anonymous."""
    # Two namespaces, two sets: `name` is a BOOK field we read and an ENTRY field we stash, so one
    # shared set would silently swallow every entry's own name out of the provenance stash.
    book_read: set[str] = {"name", "description", "enabled", "entries"}
    entry_read: set[str] = set()
    warnings: list[str] = []
    body = _book_object(raw)

    raw_entries = body.get("entries")
    if isinstance(raw_entries, dict):
        # ST's raw standalone export keys its entries by uid. The KEYS are the uids, not data — the
        # values are the entries, in file order (JSON preserves it), which is the order the book's
        # author saw in their editor.
        items = list(raw_entries.values())
    elif isinstance(raw_entries, list):
        items = list(raw_entries)
    else:
        raise CardImportError(422, "the JSON is not a lorebook: it carries no `entries`")

    entries: list[LorebookEntry] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            warnings.append(f"entry {index} was not an object and was skipped")
            continue
        entries.append(_entry(item, index, entry_read, warnings))

    fields: dict[str, Any] = {
        "name": _text(body.get("name")).strip() or default_name,
        "description": _text(body.get("description")),
        "enabled": _flag(body.get("enabled"), True),
        "entries": entries,
    }
    extras = {k: v for k, v in body.items() if k not in book_read}
    book = Lorebook.model_validate({**extras, **fields})
    return ImportedBook(
        book=book,
        mapped=sorted({k for k in book_read if k in body} | {k for k in entry_read if _seen(items, k)}),
        stashed=sorted(set(extras) | _entry_extras(items, entry_read)),
        warnings=warnings,
    )


def _book_object(raw: Any) -> dict[str, Any]:
    """The book object inside whichever of the three shapes arrived (see the module docstring).

    A bare list is entries; a `spec`-carrying object is the V3 envelope and its `data` is the book;
    anything else that is an object IS the book (ST's raw export and a card's `character_book`)."""
    if isinstance(raw, list):
        return {"entries": raw}
    if not isinstance(raw, dict):
        raise CardImportError(422, "the JSON is not a lorebook: it is neither an object nor a list")
    spec = _text(raw.get("spec")).strip()
    if not spec:
        return raw
    if spec.casefold() != BOOK_SPEC:
        raise CardImportError(422, f"the lorebook declares an unknown spec {spec!r}")
    data = raw.get("data")
    if not isinstance(data, dict):
        raise CardImportError(422, f"the lorebook declares spec {spec!r} but carries no `data` object")
    return data


def _entry(raw: dict[str, Any], index: int, entry_read: set[str], warnings: list[str]) -> LorebookEntry:
    """One source entry under the alias table, with every approximation reported (§6.5)."""
    used: set[str] = set()

    def take(*names: str) -> Any:
        """The first present, non-null value among `names` — marking ALL of them consumed."""
        value: Any = None
        for n in names:
            if n in raw:
                used.add(n)
                if value is None and raw[n] is not None:
                    value = raw[n]
        return value

    label = _text(raw.get("comment") or raw.get("name")).strip() or f"entry {index}"

    # `enabled` and its inverse are read TOGETHER so a source carrying both stashes neither: the
    # spec's positive flag wins, ST's `disable` is the fallback, and absent means enabled.
    on, off = take("enabled"), take("disable")
    enabled = _flag(on, not _flag(off, False))

    # `selective` is read BEFORE the secondary keys, because it decides whether they gate at all.
    # When the source explicitly turns it off, the secondary keys AND the logic that would have
    # combined them were inert there — so NONE of them is consumed (all stashed verbatim, provenance
    # intact) and this entry gets no gate, which keeps its activation identical to what the author
    # saw. `selective` itself IS consumed either way: it was acted on. Anything else: the keys map,
    # the logic maps, and the gate is on.
    selective = take("selective")
    if selective is not None and not selective:
        secondary: list[str] = []
        logic = "and_any"  # the no-gate default — nothing was read, so nothing was approximated
        if _string_list(raw.get("keysecondary")) or _string_list(raw.get("secondary_keys")):
            warnings.append(
                f"{label}: the source marks it non-selective, so its secondary keys were kept as "
                f"provenance only and do not gate activation"
            )
    else:
        secondary = _string_list(take(*_ALIASES["secondary_keys"]))
        logic = _logic(take("logic"), take("selectiveLogic"), secondary, label, warnings)

    fields: dict[str, Any] = {
        "keys": _string_list(take(*_ALIASES["keys"])),
        "content": _text(take("content")),
        "enabled": enabled,
        "constant": _flag(take("constant"), False),
        "secondary_keys": secondary,
        "logic": logic,
        "case_sensitive": _flag(take(*_ALIASES["case_sensitive"]), False),
        # ABSENT ⇒ TRUE — ST's SHIPPED default (R65 §1.2), which its own code default contradicts.
        "whole_words": _flag(take(*_ALIASES["whole_words"]), True),
        "position": _position(raw, take("position"), label, warnings),
        "order": _int(take(*_ALIASES["order"]), 100),
        # Absent stays NULL rather than becoming a number: null MEANS "rank me by `order`" (§6.2),
        # and inventing a priority here would silently split the two ranks the author kept fused.
        "priority": _optional_int(take("priority")),
    }
    entry_read.update(used)
    extras = {k: v for k, v in raw.items() if k not in used}
    return LorebookEntry.model_validate({**extras, **fields})


def _position(raw: dict[str, Any], value: Any, label: str, warnings: list[str]) -> str:
    """The entry's position under the §6.5 downgrade rules.

    The source is the top-level `position` (ST's numeric enum or V3's strings), else
    `extensions.position` — the older placement, which is READ but not consumed, because the whole
    `extensions` tree is stash.

    Every collapse is reported, per entry, naming what was lost. `head` is the default and the
    fallback for a value this build does not know: a book must import, and the head is where an
    entry we cannot place is least surprising (it is the placement §6.4 calls the default)."""
    if value is None:
        extensions = raw.get("extensions")
        value = extensions.get("position") if isinstance(extensions, dict) else None
    if value is None or value in ("head", "tail"):  # absent, or already ours (a re-import)
        return value or "head"
    # The table is consulted only for the two shapes a position can BE (`bool` is an `int` and is not
    # one of them). Anything else — a hand-edited `{}` or `[]` — is unhashable, so asking the dict
    # about it would raise where the whole point of this function is that an unreadable position
    # downgrades rather than fails an import.
    known = _POSITIONS.get(value) if isinstance(value, int | str) and not isinstance(value, bool) else None
    if known is None:
        warnings.append(
            f"{label}: the position {value!r} is not one this build knows — it landed at the head"
        )
        return "head"
    position, collapsed = known
    if collapsed:
        warnings.append(f"{label}: {collapsed} — it landed at the {position}")
    return position


def _logic(explicit: Any, selective_logic: Any, secondary: list[str], label: str, warnings: list[str]) -> str:
    """The secondary gate's logic. Our own two values pass through (a re-import of our export);
    otherwise ST's numeric `selectiveLogic` maps per `_LOGIC`.

    With NO secondary keys the field is irrelevant — it is normalized to the default and NOTHING is
    reported, because nothing was lost: an approximation of a gate that does not exist is not one."""
    if not secondary:
        return "and_any"
    if isinstance(explicit, str) and explicit in ("and_any", "not_any"):
        return explicit
    if selective_logic is None:
        return "and_any"
    known = None if isinstance(selective_logic, bool) else _LOGIC.get(_int(selective_logic, -1))
    if known is None:
        warnings.append(
            f"{label}: the key logic {selective_logic!r} is not one this build knows — it uses AND-ANY"
        )
        return "and_any"
    logic, approximated = known
    if approximated:
        warnings.append(f"{label}: {approximated}")
    return logic


def _flag(value: Any, default: bool) -> bool:
    """A source flag. Absent/null ⇒ the caller's default; anything else is read for truthiness, the
    way the field's own importers read these (a `0`/`""` really does mean off in a hand-edited book)."""
    return default if value is None else bool(value)


def _int(value: Any, default: int) -> int:
    """A source integer, coerced. A book written by hand carries `"100"` as often as `100`."""
    if isinstance(value, bool) or value is None:
        return default
    try:
        return int(value)
    except TypeError, ValueError:
        return default


def _optional_int(value: Any) -> int | None:
    """An integer that keeps its NULL (see `priority`) — and treats an unusable value as absent
    rather than as a zero, because 0 is a real, very low priority and absent is not a priority."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except TypeError, ValueError:
        return None


def _seen(items: list[Any], key: str) -> bool:
    """Whether any source entry carried `key` — so the report names only fields the book really had."""
    return any(isinstance(item, dict) and key in item for item in items)


def _entry_extras(items: list[Any], consumed: set[str]) -> set[str]:
    """Every entry-level source key that was NOT read — the report's `stashed_keys` half that says
    what the books carry beyond v1 (`depth`, `role`, `probability`, `group`, `extensions`, …)."""
    out: set[str] = set()
    for item in items:
        if isinstance(item, dict):
            out |= {k for k in item if k not in consumed}
    return out
