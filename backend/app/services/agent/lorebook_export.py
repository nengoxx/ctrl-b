"""Lorebook export (Phase 23 S9 / D79, ROLEPLAY_PLAN §15.4) — `lorebook_import` read backwards.

One per-entry serializer, two dialects:

  * **`st`** — SillyTavern's standalone world-info object, `{"entries": {"<uid>": …}, "name", "description"}`.
    ST's own export is its raw internal object (R65 §5.2), and ST's import passes a native book through
    whole, so this is the shape the field downloads and re-uploads. `name`/`description` are inert
    there and lossless for us.
  * **`spec`** — the V2/V3 `character_book` a card embeds (`card_export` is the one caller). ST's
    extended model rides under `extensions` with ST's own crosswalk names, which is the only place the
    spec allows app data and the only place ST's card reader looks (R65 §5.2).

**The tables are the importer's.** The position and key-logic predicates read `_POSITIONS` / `_LOGIC`
directly, and every field name this module emits is one `_ALIASES` consumes on the way back in (pinned
by a test) — so the two directions cannot drift into two vocabularies. The per-dialect NAME choice is
the one thing an import table cannot say (it reads both spellings; a writer has to pick one), which is
why `_NAMES` exists at all.

**A stashed ST value is re-emitted only while it still tells the truth** (Maya F5 / Opus F11): the
importer records a collapsed ST position at `extensions.position` and a collapsed key logic at
`extensions.selectiveLogic`, and the export returns that original integer iff it still maps onto the
entry's CURRENT value — an entry the owner moved (or re-gated) is derived from what it is now.

Pure: reads models, returns plain dicts, writes nothing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, TypeGuard

from app.services.agent.lorebook_import import _ALIASES, _LOGIC, _POSITIONS, ST_EXTENSION_NAMES
from app.services.agent.lorebooks import Lorebook

if TYPE_CHECKING:
    from app.services.agent.lorebooks import LorebookEntry

Dialect = Literal["st", "spec"]

#: `{our field: (ST standalone name, spec name)}` for the fields whose name differs by dialect. Every
#: name here is one of `_ALIASES[field]` (a test pins it), so the importer reads back whatever we write.
_NAMES: dict[str, tuple[str, str]] = {
    "keys": ("key", "keys"),
    "secondary_keys": ("keysecondary", "secondary_keys"),
    "order": ("order", "insertion_order"),
    "case_sensitive": ("caseSensitive", "case_sensitive"),
    "whole_words": ("matchWholeWords", "match_whole_words"),
}

#: The derived ST position for each of ours when no truthful stashed integer exists: `head` → 1 (after
#: the character definitions — `_POSITIONS`' one exact landing, which is what our head block is) and
#: `tail` → 4 (at depth; our tail is the slot just before `post_history`, and at-depth-0 is ST's nearest).
_DERIVED_POSITION: dict[str, int] = {"head": 1, "tail": 4}
_AT_DEPTH = 4

#: Our logic → ST's `selectiveLogic`, from `_LOGIC`'s exact rows (the approximated ones have no inverse).
_DERIVED_LOGIC: dict[str, int] = {ours: st for st, (ours, note) in _LOGIC.items() if note is None}

#: Every stash key an exported entry does NOT re-emit verbatim, because the serializer writes the fact
#: itself: all the importer's aliases (a stale second spelling would contradict ours), the fields it
#: consumes outright, the id/index pair (re-derived under the no-collision rule), and `extensions`
#: (never emitted as-is in `st` — its keys are lifted to ST's names, `_st_entry`; the overlay base in `spec`).
_OWNED = frozenset(
    {
        *(name for names in _ALIASES.values() for name in names),
        *(name for pair in _NAMES.values() for name in pair),
        "content",
        "enabled",
        "disable",
        "constant",
        "selective",
        "selectiveLogic",
        "logic",
        "position",
        "priority",
        "uid",
        "id",
        "displayIndex",
        "extensions",
        # V3's regex flag: we always WRITE it (`false` — our keys are literals), so a stashed copy from a
        # card book (ST writes `true`) must never ride along, top-level or under `extensions` (review F6).
        "use_regex",
    }
)

#: `extensions` name → ST's own top-level name — `ST_EXTENSION_NAMES` reversed, for the lift below.
_ST_NAME_OF = {ext: st for st, ext in ST_EXTENSION_NAMES.items()}

#: `selective` is ALWAYS true on the way out — ST's shipped default ("all entries are selective now",
#: R65 §1.1) and exactly our semantics: with no secondary keys it gates nothing, with some they gate.
#: `bool(secondary_keys)` (§15.4's first wording) breaks the round trip: our importer reads an explicit
#: `selective: false` as "the gate was inert", leaves `keysecondary`/`selectiveLogic` UNconsumed, and a
#: re-import of our own export would grow two stash keys on every gate-less entry.
_SELECTIVE = True

#: The spec entry's own top-level fields a stash may still hold (V2 + V3's `character_book` entry);
#: everything else stashed on a spec entry is app data and goes under `extensions`.
_SPEC_TOP = ("name", "comment")

#: The spec book's own fields beyond name/description/entries — carried through at the book level.
_SPEC_BOOK_EXTRAS = ("scan_depth", "token_budget", "recursive_scanning", "extensions")


def _real_int(value: Any) -> TypeGuard[int]:
    """A JSON integer, not a bool (which Python calls an int) — the only shape a stashed ST enum is
    trusted in (Maya confirm (c))."""
    return isinstance(value, int) and not isinstance(value, bool)


def _extras(entry: LorebookEntry) -> dict[str, Any]:
    return dict(entry.model_extra or {})


def _stashed_extensions(extras: dict[str, Any]) -> dict[str, Any]:
    ext = extras.get("extensions")
    return dict(ext) if isinstance(ext, dict) else {}


def st_position(entry: LorebookEntry) -> int:
    """The ST position integer for `entry` — ONE predicate for both dialects (§15.4).

    The stashed `extensions.position` is re-emitted iff it is a real `_POSITIONS` integer that still
    maps onto the entry's current position: the owner never moved it, so the original is the truer
    answer (an ST position-0 entry stays 0, not 1). Otherwise it is derived from ours."""
    stashed = _stashed_extensions(_extras(entry)).get("position")
    if _real_int(stashed) and stashed in _POSITIONS and _POSITIONS[stashed][0] == entry.position:
        return stashed
    return _DERIVED_POSITION[entry.position]


def st_logic(entry: LorebookEntry) -> int:
    """The ST `selectiveLogic` for `entry` — the position predicate's twin (Opus F11): the stashed
    collapsed integer (1 NOT-ALL / 3 AND-ALL) iff it still maps onto the current logic, else ours."""
    stashed = _stashed_extensions(_extras(entry)).get("selectiveLogic")
    if _real_int(stashed) and stashed in _LOGIC and _LOGIC[stashed][0] == entry.logic:
        return stashed
    return _DERIVED_LOGIC[entry.logic]


def _stashed_depth(extras: dict[str, Any]) -> Any:
    """The entry's at-depth value wherever the import left it: ST standalone keeps it top-level, a
    card book under `extensions.depth`. `None` when neither holds one."""
    top = extras.get("depth")
    if top is not None:
        return top
    return _stashed_extensions(extras).get("depth")


def _entry_id(extras: dict[str, Any], index: int, used_ids: set[int], *, renumber: bool) -> int:
    """The entry's id under the no-collision rule (Opus F3): a stashed `uid`/`id` is kept only when it
    is a real int not already used in this output; otherwise the next free int. A merged book is
    renumbered outright (`renumber`) — its entries came from different books' id spaces."""
    if not renumber:
        for key in ("uid", "id"):
            candidate = extras.get(key)
            if _real_int(candidate) and candidate not in used_ids:
                used_ids.add(candidate)
                return candidate
    chosen = index if renumber and index not in used_ids else max(used_ids, default=-1) + 1
    used_ids.add(chosen)
    return chosen


def _display_index(extras: dict[str, Any], index: int, *, renumber: bool) -> Any:
    if renumber:
        return index
    top = extras.get("displayIndex")
    if top is not None:
        return top
    nested = _stashed_extensions(extras).get("display_index")
    return index if nested is None else nested


def entry_out(
    entry: LorebookEntry, index: int, *, dialect: Dialect, used_ids: set[int], renumber: bool = False
) -> dict[str, Any]:
    """One entry in `dialect`. `index` is its 0-based place in the output (the default id and
    display index); `used_ids` is the output's id set so far, which this call extends."""
    extras = _extras(entry)
    entry_id = _entry_id(extras, index, used_ids, renumber=renumber)
    display = _display_index(extras, index, renumber=renumber)
    position = st_position(entry)
    logic = st_logic(entry)
    depth = _stashed_depth(extras)
    if depth is None and position == _AT_DEPTH:
        depth = 0
    if dialect == "st":
        return _st_entry(entry, extras, entry_id, display, position, logic, depth)
    return _spec_entry(entry, extras, entry_id, display, position, logic, depth)


def _st_entry(
    entry: LorebookEntry,
    extras: dict[str, Any],
    entry_id: int,
    display: Any,
    position: int,
    logic: int,
    depth: Any,
) -> dict[str, Any]:
    """ST standalone: the stash re-emitted verbatim (ST reads its own field names at the top level),
    then the stashed `extensions` LIFTED to ST's top-level names, then our truth over both.

    The `extensions` dict itself is never emitted (ST standalone files carry none). For an ST-ORIGIN
    book it is only the importer's collapse record (`extensions.position`/`selectiveLogic`) — a
    mirror of facts ST keeps at the top level, which our truth re-derives. For a CARD-origin book
    (a spec `character_book`) it is the ONLY home of ST's extended model — `role`, `probability`,
    `group`, `exclude_recursion`, `scan_depth`, `sticky`, … — so each key is copied back to ST's own
    name through the reversed crosswalk (unknown keys under their own name), exactly as ST's
    `convertCharacterBook` reads a card book (review F1). A name the top-level stash already holds
    keeps the top-level value, and an `_OWNED` name (position, logic, flags, the id pair) stays
    governed by our truth."""
    out: dict[str, Any] = {"uid": entry_id}
    out.update({k: v for k, v in extras.items() if k not in _OWNED})
    for ext_key, value in _stashed_extensions(extras).items():
        name = _ST_NAME_OF.get(ext_key, ext_key)
        if name not in extras and name not in _OWNED:
            out[name] = value
    comment = extras.get("comment")
    if not isinstance(comment, str) and isinstance(extras.get("name"), str):
        out["comment"] = extras["name"]
    out.update(
        {
            _NAMES["keys"][0]: list(entry.keys),
            _NAMES["secondary_keys"][0]: list(entry.secondary_keys),
            "content": entry.content,
            "constant": entry.constant,
            "selective": _SELECTIVE,
            "selectiveLogic": logic,
            "disable": not entry.enabled,
            _NAMES["order"][0]: entry.order,
            "position": position,
            # Explicit booleans, never ST's `null` ("inherit the global"): the value is what the owner
            # has now, and a null would hand the decision back to whatever the importing install uses.
            _NAMES["case_sensitive"][0]: entry.case_sensitive,
            _NAMES["whole_words"][0]: entry.whole_words,
            "displayIndex": display,
        }
    )
    if depth is not None:
        out["depth"] = depth
    if entry.priority is not None:  # no ST home — kept only because it came from a V3 source
        out["priority"] = entry.priority
    return out


def _spec_entry(
    entry: LorebookEntry,
    extras: dict[str, Any],
    entry_id: int,
    display: Any,
    position: int,
    logic: int,
    depth: Any,
) -> dict[str, Any]:
    """A card's `character_book` entry: the spec's fields at the top level, ST's extended model under
    `extensions` — the stashed `extensions` OVERLAID with our truth, so a reader that trusts
    `extensions` first (ST, and our own importer) reads what the owner has now, never the mirror."""
    # Owned names a SOURCE planted under `extensions` (a card's own `use_regex`, …) are dropped first —
    # the serializer writes each of those facts itself; the overlay below then sets our truth for
    # position/selectiveLogic/the two flags, so nothing it writes is filtered away.
    extensions = {k: v for k, v in _stashed_extensions(extras).items() if k not in _OWNED}
    top: dict[str, Any] = {}
    for key, value in extras.items():
        if key in _OWNED:
            continue
        if key in _SPEC_TOP:
            top[key] = value
        else:
            extensions[ST_EXTENSION_NAMES.get(key, key)] = value
    extensions.update(
        {
            "position": position,
            "selectiveLogic": logic,
            "case_sensitive": entry.case_sensitive,
            _NAMES["whole_words"][1]: entry.whole_words,
            "display_index": display,
        }
    )
    if depth is not None:
        extensions["depth"] = depth
    out: dict[str, Any] = {
        "id": entry_id,
        _NAMES["keys"][1]: list(entry.keys),
        _NAMES["secondary_keys"][1]: list(entry.secondary_keys),
        "content": entry.content,
        "enabled": entry.enabled,
        "constant": entry.constant,
        "selective": _SELECTIVE,
        _NAMES["order"][1]: entry.order,
        _NAMES["case_sensitive"][1]: entry.case_sensitive,
        # The spec's two position values straddle the definitions; the real placement is the
        # `extensions.position` integer, which is what ST reads first (R65 §5.2).
        "position": "after_char",
        # CCv3 requires the field; our keys are literals, always.
        "use_regex": False,
        **top,
    }
    if entry.priority is not None:
        out["priority"] = entry.priority
    out["extensions"] = extensions
    return out


def book_out(book: Lorebook, *, dialect: Dialect, renumber: bool = False) -> dict[str, Any]:
    """The whole book in `dialect`. Only what we hold plus the stash — no invented ST template
    defaults (ST backfills missing fields itself, R65 §1.1)."""
    used: set[int] = set()
    entries = [
        entry_out(e, i, dialect=dialect, used_ids=used, renumber=renumber) for i, e in enumerate(book.entries)
    ]
    if dialect == "st":
        return {
            "entries": {str(e["uid"]): e for e in entries},
            "name": book.name,
            "description": book.description,
        }
    extras = book.model_extra or {}
    out: dict[str, Any] = {"name": book.name, "description": book.description}
    out.update({k: extras[k] for k in _SPEC_BOOK_EXTRAS if k in extras})
    if not isinstance(out.get("extensions"), dict):
        out["extensions"] = {}
    out["entries"] = entries
    return out


def merged_book(name: str, books: list[Lorebook]) -> dict[str, Any]:
    """N linked books as ONE spec book named `name`, entries concatenated in link order and renumbered
    (§15.2: the runtime already scans the linked set as one pool, §6.4)."""
    merged = Lorebook(name=name, entries=[e for b in books for e in b.entries])
    return book_out(merged, dialect="spec", renumber=True)
