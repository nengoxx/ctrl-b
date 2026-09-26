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
    every entry's matching). Above both sits `extensions.{position, selectiveLogic, case_sensitive,
    match_whole_words}`: where ST puts the real values when it writes a card's book, and what its
    own reader consults first (R87/RP-5) — unless the entry is already OURS (a top-level `head`/
    `tail` position), whose `extensions` is only the stale mirror it was first imported with.
  * **The position downgrade is never silent — and never a flood (ISS-22).** The field's books use
    positions 0–7 and v1 stores `head | tail` (§6.4), so every collapse is reported: ONE count line per
    downgrade class per book ("12 entries sat at a fixed depth … — landed at the tail"), because a
    per-entry line buried the report (216 of one real book's 218 lines were the same position-0 note).
    ST position 1 (after the character definitions) is EXACTLY where our head block sits — a landing,
    not a downgrade, so no line. The features v1 stores but does not run (probability, inclusion
    groups, recursion flags, per-entry scan depth, regex-looking keys) get one count line each too:
    they change behaviour, so they must not be silent either.

Everything the table does not consume is stashed on the entry/book verbatim (`extra="allow"`), which
is why `name`/`comment`/`depth`/`role`/`probability`/`extensions` need no per-field handling: they
survive by not being touched.

`CardImportError` and the two JSON coercions are IMPORTED from `card_import` rather than
re-written: a refused import is one class with one status contract, and "hand-edited JSON coerces
rather than refuses" is one rule, not two implementations of one rule.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.services.agent.card_import import CardImportError, _string_list, _text
from app.services.agent.lorebooks import Lorebook, LorebookEntry
from app.services.agent.macros import LITERAL_TEXT_OR_KEY, unrendered_note

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
    0: ("head", "sat BEFORE the character definitions, and our head block sits after them"),
    "before_char": ("head", "sat BEFORE the character definitions, and our head block sits after them"),
    5: ("head", "sat at the top of the example messages"),
    6: ("head", "sat at the bottom of the example messages"),
    7: ("head", "targeted a named injection outlet, which v1 has none of"),
    2: ("tail", "sat in the author's note, above its text"),
    3: ("tail", "sat in the author's note, below its text"),
    4: ("tail", "sat at a fixed depth and role in the history, both of which collapse"),
}

#: Our own two positions (§6.4). A source entry whose top-level `position` is one of them was written
#: by US, which is what makes it the provenance discriminator in `_entry`.
_OUR_POSITIONS = ("head", "tail")

#: `{ST selectiveLogic: (our logic, what was approximated)}`. AND-ANY and NOT-ANY are ours exactly;
#: the two ALL variants have no v1 equivalent, so each lands on its ANY sibling WITH a report line —
#: the entry then activates more readily (AND-ALL) or less (NOT-ALL) than the author wrote.
_LOGIC: dict[int, tuple[str, str | None]] = {
    0: ("and_any", None),
    2: ("not_any", None),
    3: ("and_any", "used AND-ALL (every secondary key had to hit), approximated as AND-ANY"),
    1: ("not_any", "used NOT-ALL (only all-of-them blocked), approximated as NOT-ANY"),
}

#: ST's native entry fields → their `extensions.*` names in a card book: ST's `originalWIDataKeyMap`
#: crosswalk as R65 §5.2 lists it. Named here, in the module that speaks ST's vocabulary: the import
#: reads the inert-feature fields through it (a card book keeps them under `extensions`), and
#: `lorebook_export` writes a spec book's app data under the same names.
ST_EXTENSION_NAMES: dict[str, str] = {
    "position": "position",
    "depth": "depth",
    "role": "role",
    "scanDepth": "scan_depth",
    "caseSensitive": "case_sensitive",
    "matchWholeWords": "match_whole_words",
    "group": "group",
    "groupWeight": "group_weight",
    "groupOverride": "group_override",
    "useGroupScoring": "use_group_scoring",
    "probability": "probability",
    "sticky": "sticky",
    "cooldown": "cooldown",
    "delay": "delay",
    "automationId": "automation_id",
    "vectorized": "vectorized",
    "excludeRecursion": "exclude_recursion",
    "preventRecursion": "prevent_recursion",
    "delayUntilRecursion": "delay_until_recursion",
    "outletName": "outlet_name",
    "triggers": "triggers",
    "ignoreBudget": "ignore_budget",
    "matchPersonaDescription": "match_persona_description",
    "matchCharacterDescription": "match_character_description",
    "matchCharacterPersonality": "match_character_personality",
    "matchCharacterDepthPrompt": "match_character_depth_prompt",
    "matchScenario": "match_scenario",
    "matchCreatorNotes": "match_creator_notes",
    "displayIndex": "display_index",
    "selectiveLogic": "selectiveLogic",
}

#: The report's count-line phrases for what an entry carries that v1 stores but does not RUN (ISS-22)
#: — each changes how the entry behaves in the source app, so its absence here must be said. Each
#: phrase follows "N entries" and is in the PAST tense (what the entry did in its source), which is
#: what lets one phrase serve "1 entry" and "12 entries" alike.
_NON_SELECTIVE = "carried secondary keys the source marks non-selective — kept as provenance only, they do not gate activation"
_INERT_PROBABILITY = "rolled a probability below 100 — v1 does not roll, so a key hit always activates them"
_INERT_GROUP = "belonged to an inclusion group — v1 has no groups, so every member can activate together"
_INERT_RECURSION = "carried a recursion flag — v1 does not scan recursively, so the flag does nothing"
_INERT_SCAN_DEPTH = "set their own scan depth — v1 scans `lorebooks.scan_depth` for every entry"
_INERT_REGEX = "had a regex-looking key — v1 matches keys as literal text"

#: ST's regex-key syntax (`parseRegexFromString`): a whole key written `/pattern/flags`.
_REGEX_KEY = re.compile(r"^/[\s\S]+?/[gimsuy]*$")


@dataclass(frozen=True)
class ImportedBook:
    """One book, mapped, plus everything the import report shows: which SOURCE keys were read, which
    were kept verbatim as stash, and every approximation that was made along the way."""

    book: Lorebook
    mapped: list[str]
    stashed: list[str]
    warnings: list[str] = field(default_factory=list)


@dataclass
class _Report:
    """What one book import says (ISS-22): a line per ENTRY only where it names a value the owner has
    to go and find (a position or key logic this build does not know), and otherwise ONE count line
    per class per book — first-seen order, so the report reads in the book's own order."""

    lines: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def count(self, phrase: str) -> None:
        self.counts[phrase] = self.counts.get(phrase, 0) + 1

    def render(self) -> list[str]:
        return [*self.lines, *(f"{_entries(n)} {phrase}" for phrase, n in self.counts.items())]


def _entries(n: int) -> str:
    return f"{n} entry" if n == 1 else f"{n} entries"


def import_book(raw: Any, *, default_name: str = "") -> ImportedBook:
    """Map one parsed book value onto `Lorebook`. Writes nothing.

    `default_name` is what the book is called when the source did not name it — the character's name
    for a card's embedded book, which is the only place a book arrives anonymous."""
    # Two namespaces, two sets: `name` is a BOOK field we read and an ENTRY field we stash, so one
    # shared set would silently swallow every entry's own name out of the provenance stash.
    book_read: set[str] = {"name", "description", "enabled", "entries"}
    entry_read: set[str] = set()
    report = _Report()
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
            report.lines.append(f"entry {index} was not an object and was skipped")
            continue
        entries.append(_entry(item, index, entry_read, report))

    fields: dict[str, Any] = {
        "name": _text(body.get("name")).strip() or default_name,
        "description": _text(body.get("description")),
        "enabled": _flag(body.get("enabled"), True),
        "entries": entries,
    }
    extras = {k: v for k, v in body.items() if k not in book_read}
    book = Lorebook.model_validate({**extras, **fields})
    # Keys too (R89/E-3): both key lists pass through the same macro renderer before the scan,
    # so a literal `{{time}}` key is an entry that silently never activates.
    texts = (t for e in entries for t in (*e.keys, *e.secondary_keys, e.content))
    warnings = report.render() + unrendered_note(texts, "the lorebook's entries", LITERAL_TEXT_OR_KEY)
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


def _entry(raw: dict[str, Any], index: int, entry_read: set[str], report: _Report) -> LorebookEntry:
    """One source entry under the alias table, with every approximation reported (§6.5, ISS-22)."""
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

    # ST's writer (`convertWorldInfoToCharacterBook`) mirrors a card-embedded entry's REAL placement,
    # logic and matching flags under `extensions` — `position` at the top is only its
    # `before_char`/`after_char` squash — and ST's own reader gives `extensions` precedence
    # (`world-info.js` `entry.extensions?.position ?? …`). So those four are read there FIRST (R87/
    # RP-5). Read, never consumed: the whole `extensions` tree stays stash verbatim.
    #
    # The ONE exception, decided here once per entry: a top-level `position` in OUR vocabulary
    # (`head`/`tail`) means the entry is already ours — exported or edited here — and its
    # `extensions` is the stale ST mirror it was imported with, riding along as stash. For such an
    # entry the TOP LEVEL wins for all four keys, or a re-import would silently revert the owner's
    # edits to what ST once said (the R87 review's O-3). No ST or V3 writer emits `head`/`tail`.
    ext = raw.get("extensions")
    ext = ext if isinstance(ext, dict) and raw.get("position") not in _OUR_POSITIONS else {}

    def take_ext(ext_key: str, *names: str) -> Any:
        """`extensions[ext_key]` when it carries a value, else `take(*names)` — whose names are
        consumed either way (the top level is the same fact written twice)."""
        top = take(*names)
        value = ext.get(ext_key)
        return top if value is None else value

    label = _text(raw.get("comment") or raw.get("name")).strip() or f"entry {index}"

    # The ST integers a downgrade collapsed, recorded where ST itself keeps them (`extensions.*`) so
    # our own export can return the original while it is still true (§15.4's importer amendment).
    collapsed: dict[str, int] = {}

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
            report.count(_NON_SELECTIVE)
    else:
        secondary = _string_list(take(*_ALIASES["secondary_keys"]))
        explicit_logic = take("logic")
        selective_logic = take_ext("selectiveLogic", "selectiveLogic")
        logic = _logic(explicit_logic, selective_logic, secondary, label, report)
        if secondary and explicit_logic not in ("and_any", "not_any"):
            number = None if isinstance(selective_logic, bool) else _int(selective_logic, -1)
            _record_collapse(collapsed, "selectiveLogic", number, _LOGIC)

    position = take_ext("position", "position")
    fields: dict[str, Any] = {
        "keys": _string_list(take(*_ALIASES["keys"])),
        "content": _text(take("content")),
        "enabled": enabled,
        "constant": _flag(take("constant"), False),
        "secondary_keys": secondary,
        "logic": logic,
        "case_sensitive": _flag(take_ext("case_sensitive", *_ALIASES["case_sensitive"]), False),
        # ABSENT ⇒ TRUE — ST's SHIPPED default (R65 §1.2), which its own code default contradicts.
        "whole_words": _flag(take_ext("match_whole_words", *_ALIASES["whole_words"]), True),
        "position": _position(position, label, report),
        "order": _int(take(*_ALIASES["order"]), 100),
        # Absent stays NULL rather than becoming a number: null MEANS "rank me by `order`" (§6.2),
        # and inventing a priority here would silently split the two ranks the author kept fused.
        "priority": _optional_int(take("priority")),
    }
    real_int = isinstance(position, int) and not isinstance(position, bool)
    _record_collapse(collapsed, "position", position if real_int else None, _POSITIONS)
    for phrase in _inert_features(raw, [*fields["keys"], *fields["secondary_keys"]]):
        report.count(phrase)
    entry_read.update(used)
    extras = {k: v for k, v in raw.items() if k not in used}
    source_ext = raw.get("extensions")
    if collapsed and (source_ext is None or isinstance(source_ext, dict)):
        mirror = dict(source_ext or {})
        for key, value in collapsed.items():
            # The source carried none there — never overwrite its own; an explicit null is no provenance either.
            if mirror.get(key) is None:
                mirror[key] = value
        extras["extensions"] = mirror
    return LorebookEntry.model_validate({**extras, **fields})


def _record_collapse(
    out: dict[str, int], key: str, number: int | None, table: dict[Any, tuple[str, str | None]]
) -> None:
    """Note `number` under `key` when it is an ST integer the downgrade `table` COLLAPSED (a row with a
    note — an exact landing loses nothing, so there is nothing to restore). The caller passes the
    integer exactly as its reader interpreted the source value, so only what was really collapsed is
    ever recorded."""
    row = table.get(number) if number is not None else None
    if number is not None and row is not None and row[1] is not None:
        out[key] = number


def _position(value: Any, label: str, report: _Report) -> str:
    """The entry's position under the §6.5 downgrade rules. The source is `extensions.position`
    (ST's numeric enum — the real placement of a card-embedded entry ST wrote), else the top-level
    `position` (ST's enum or V3's strings); the caller resolves that precedence.

    Every collapse is counted into its class's report line (ISS-22). `head` is the default and the
    fallback for a value this build does not know: a book must import, and the head is where an
    entry we cannot place is least surprising (it is the placement §6.4 calls the default)."""
    if value is None or value in _OUR_POSITIONS:  # absent, or already ours (a re-import)
        return value or "head"
    # The table is consulted only for the two shapes a position can BE (`bool` is an `int` and is not
    # one of them). Anything else — a hand-edited `{}` or `[]` — is unhashable, so asking the dict
    # about it would raise where the whole point of this function is that an unreadable position
    # downgrades rather than fails an import.
    known = _POSITIONS.get(value) if isinstance(value, int | str) and not isinstance(value, bool) else None
    if known is None:
        report.lines.append(
            f"{label}: the position {value!r} is not one this build knows — it landed at the head"
        )
        return "head"
    position, collapsed = known
    if collapsed:
        report.count(f"{collapsed} — landed at the {position}")
    return position


def _logic(explicit: Any, selective_logic: Any, secondary: list[str], label: str, report: _Report) -> str:
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
        report.lines.append(
            f"{label}: the key logic {selective_logic!r} is not one this build knows — it uses AND-ANY"
        )
        return "and_any"
    logic, approximated = known
    if approximated:
        report.count(approximated)
    return logic


def _inert_features(raw: dict[str, Any], keys: list[str]) -> list[str]:
    """The ISS-22 inert classes this source entry carries — read wherever the source keeps them: ST's
    standalone export at the top level, a card book ST wrote under `extensions` (its crosswalk names).
    Each class counts once per entry."""
    ext = raw.get("extensions")
    ext = ext if isinstance(ext, dict) else {}

    def read(st_name: str) -> Any:
        top = raw.get(st_name)
        return top if top is not None else ext.get(ST_EXTENSION_NAMES.get(st_name, st_name))

    out: list[str] = []
    probability, rolls = read("probability"), read("useProbability")
    if _number(probability) and probability < 100 and rolls is not False:
        out.append(_INERT_PROBABILITY)
    if isinstance(read("group"), str) and read("group").strip():
        out.append(_INERT_GROUP)
    if any(read(f) for f in ("excludeRecursion", "preventRecursion", "delayUntilRecursion")):
        out.append(_INERT_RECURSION)
    if _number(read("scanDepth")):
        out.append(_INERT_SCAN_DEPTH)
    if any(_REGEX_KEY.match(k) for k in keys):
        out.append(_INERT_REGEX)
    return out


def _number(value: Any) -> bool:
    """A JSON number (never a bool, which Python calls an int)."""
    return isinstance(value, int | float) and not isinstance(value, bool)


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
