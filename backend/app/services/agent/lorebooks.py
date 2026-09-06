"""Lorebooks (Phase 23 / D70, ROLEPLAY_PLAN §6) — the owner-authored reference corpus a turn pulls
from by KEY MATCH, before the first token is generated.

The whole subsystem in one line: scan what was just said, activate the entries whose keys hit, fit
them into a character budget, and emit them as at most two framed system blocks. Nothing here is
model-decided and nothing here is a tool — that is deliberately the OTHER lane (§6.8: Core Memory is
model-decided, mid-turn and visible in the transcript; lorebooks are code-decided, pre-first-token
and invisible). Activation adds TEXT and nothing else (§7).

**Model + storage + scan live in ONE module**, matching `card_import.py` rather than the
`core/skills.py` + `services/agent/skills.py` split: `Skill` is split out because it is a PORT
(`SkillProvider`/`SkillSelector` are Protocols with more than one implementation), while a
`Lorebook` is a plain file-backed record with exactly one reader. `config.py` never needs the model
(`LorebooksCfg` holds slugs), so nothing pulls it toward `domain/`.

Four rules worth stating where they are implemented, because each one was a ruling:

  * **`extra="allow"` on both models (P5).** The field's books carry a dozen fields we do not
    implement (recursion, min-activations, probability, inclusion groups, timed effects, at-depth
    placement). They are stashed verbatim so a re-export loses nothing and adopting one later costs
    no migration — never silently dropped.
  * **One GLOBAL budget pass, then partition (§6.4, Emma F10).** Eviction is decided across BOTH
    positions together — a head entry and a tail entry compete for the same characters — and only
    the survivors are split into their two blocks. Doing it per-position would let a book's tail
    half evict nothing while its head half starved.
  * **Framing chars do not count against the budget.** The budget bounds the OWNER's text; the
    framing is a constant the registry owns, and charging for it would make an owner's 4000
    characters mean something different after a prompt edit.
  * **Keys are LITERALS in v1** — `re.escape`d, never patterns. A book that arrives with a regex key
    matches it as text rather than compiling author-supplied input into the scan of every turn.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError

from app.config import dealias_mapping, edit_config_yaml, sync_mapping

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence
    from pathlib import Path

    from app.services.agent.macros import Macros

log = logging.getLogger(__name__)

#: What a book file is called under `$CTRLB_HOME/lorebooks/` (§6.1). One suffix, named once, so the
#: writer, the scan and the slug listing cannot disagree about what a book file looks like.
BOOK_SUFFIX = ".yaml"


class LorebookEntry(BaseModel):
    """One entry: the text, the keys that summon it, and the flags that decide how they match.

    Field names are V3's deliberately (§6.2) — an import from the dominant format is then mostly a
    rename, and our own export is readable by the tools the owner already uses. `extra="allow"`
    keeps everything else the source carried.
    """

    model_config = {"extra": "allow"}

    keys: list[str] = Field(default_factory=list)  # any hit activates (per the flags below)
    content: str = ""
    enabled: bool = True
    constant: bool = False  # always active, no scan needed
    #: The optional SECOND gate: with `logic: and_any` one of these must also hit, with `not_any`
    #: none may. Empty ⇒ no gate at all, and `logic` is then irrelevant.
    secondary_keys: list[str] = Field(default_factory=list)
    logic: Literal["and_any", "not_any"] = "and_any"
    case_sensitive: bool = False
    #: ST's SHIPPED default, not its code default (R65 §1.2's correction) — a key matches on word
    #: boundaries unless the author turned that off.
    whole_words: bool = True
    position: Literal["head", "tail"] = "head"
    order: int = 100  # render order among the activated entries (lower first)
    #: Eviction order under the budget (higher survives). `None` → `order` stands in, which is V3's
    #: own split: one number ranks the render, the other ranks the sacrifice, and a book that never
    #: set them apart still ranks correctly with one.
    priority: int | None = None


class Lorebook(BaseModel):
    """One book. The slug is the FILENAME, never a field — the same rule agents and skills follow,
    so renaming the file renames the book and there is no second name to drift."""

    model_config = {"extra": "allow"}

    name: str = ""
    description: str = ""
    enabled: bool = True
    entries: list[LorebookEntry] = Field(default_factory=list)


# ── storage (§6.1) ────────────────────────────────────────────────────────────────────────────────


def book_path(directory: Path, slug: str) -> Path:
    """`<directory>/<slug>.yaml`. The caller validates the slug (`valid_skill_slug`) — this never
    sees a name the API layer has not already refused."""
    return directory / f"{slug}{BOOK_SUFFIX}"


def book_slugs(directory: Path) -> list[str]:
    """Every book slug on disk, sorted. Cheap (a glob, no parse) — it answers "what names are
    taken?" for the import mint and "what can I list?" for the API."""
    if not directory.is_dir():
        return []
    return sorted(p.stem for p in directory.glob(f"*{BOOK_SUFFIX}") if p.is_file())


def load_book(directory: Path, slug: str) -> Lorebook | None:
    """One book, or `None` when the file is absent or unreadable.

    A listed book whose file is missing or malformed must NEVER fail a turn (§6.3): the owner
    attached a book, and the worst that may cost them is the entries it would have contributed.
    So the failure is a log line and a skip, here, once — every caller inherits it.

    Read with PyYAML (the same 1.1 reader `load_settings` and `_load_agent_folder` use) precisely
    because the writer quotes for that reader: a book whose key is `no` or `23:00` round-trips only
    if both ends agree on which YAML this is."""
    p = book_path(directory, slug)
    if not p.is_file():
        log.warning("lorebook %r: no file at %s — skipping", slug, p)
        return None
    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise ValueError("the file is not a mapping")
        return Lorebook.model_validate(raw)
    except OSError, UnicodeDecodeError, yaml.YAMLError, ValidationError, ValueError:
        log.warning("lorebook %r: could not be read — skipping", slug, exc_info=True)
        return None


def load_books(directory: Path, slugs: Iterable[str]) -> list[Lorebook]:
    """The ENABLED books among `slugs`, in order, skipping whatever could not be read. A disabled
    book is skipped here rather than inside the scan so "off" costs nothing per entry."""
    out: list[Lorebook] = []
    for slug in slugs:
        book = load_book(directory, slug)
        if book is not None and book.enabled:
            out.append(book)
    return out


def list_books(directory: Path) -> list[tuple[str, Lorebook]]:
    """`(slug, book)` for every readable book on disk, sorted by slug — the listing endpoint's
    source. An unreadable file is omitted rather than raised: one broken book must not take the
    manager down with it."""
    out: list[tuple[str, Lorebook]] = []
    for slug in book_slugs(directory):
        book = load_book(directory, slug)
        if book is not None:
            out.append((slug, book))
    return out


def save_book(directory: Path, slug: str, book: Lorebook) -> None:
    """Write `<slug>.yaml` through `edit_config_yaml`, the ONE YAML chokepoint (§6.1) — atomic, 0600,
    comment-preserving, and YAML-1.1-quoted on the way out.

    The quoting guard is not incidental here: entry keys are exactly the ambiguous class (`no`,
    `on`, `23:00`), and an unquoted `no` reloads as the boolean False — a key that can never match
    again. `sync_mapping` rather than `deep_set` because a save is a FULL REPLACE: an entry the
    editor deleted really disappears, while every untouched line keeps its quoting and the owner's
    comments. `dealias_mapping` first, exactly as `_scaffold_agent` does and for the same reason —
    a hand-written book may share one node between two keys via an anchor, and the loader hands
    both back as the same object."""
    directory.mkdir(parents=True, exist_ok=True)
    fields = book.model_dump(mode="json")
    edit_config_yaml(lambda doc: sync_mapping(dealias_mapping(doc), fields), book_path(directory, slug))


def delete_book(directory: Path, slug: str) -> bool:
    """Remove a book file, returning whether it was there. Idempotent (the caller 404s on False)."""
    p = book_path(directory, slug)
    if not p.is_file():
        return False
    p.unlink()
    return True


def active_slugs(*sources: Iterable[str]) -> list[str]:
    """The turn's active book slugs: the global list ∪ the agent's, order-preserving and deduped —
    the field's bind-twice-counts-once rule (§6.3). Blank entries are dropped."""
    out: list[str] = []
    seen: set[str] = set()
    for source in sources:
        for slug in source:
            name = slug.strip()
            if name and name not in seen:
                seen.add(name)
                out.append(name)
    return out


# ── the scan (§6.3) ───────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Haystack:
    """The turn's scanned text, folded once. Chat text only — no tool outputs, no attachment bodies
    (§6.3: the field's default corpus is what was SAID). Casefolding once here rather than per key
    is the whole reason this is an object: a 209-entry book asks hundreds of questions of it."""

    raw: str
    folded: str

    @classmethod
    def of(cls, texts: Sequence[str]) -> Haystack:
        joined = "\n".join(t for t in texts if t)
        return cls(joined, joined.casefold())

    def hit(self, key: str, *, case_sensitive: bool, whole_words: bool) -> bool:
        """Whether `key` — a LITERAL, never a pattern — appears in the scanned text.

        `whole_words` uses `(?<!\\w)…(?!\\w)` rather than `\\b`: a key may legitimately start or end
        with punctuation (`"!!"`, `"<START>"`), and `\\b` next to a non-word character asserts the
        opposite of what the author meant, so such a key could never match at all."""
        needle = key.strip()
        if not needle:  # an empty key would match everything — it activates nothing instead
            return False
        hay = self.raw if case_sensitive else self.folded
        if not case_sensitive:
            needle = needle.casefold()
        if not whole_words:
            return needle in hay
        return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", hay) is not None


@dataclass(frozen=True)
class Activated:
    """One entry that activated, with its content already macro-rendered (the render is what the
    budget measures and what the block emits, so it happens once, here)."""

    entry: LorebookEntry
    content: str
    index: int  # activation order — the last tie-break, so eviction is deterministic

    @property
    def rank(self) -> tuple[int, int, int]:
        """The eviction key, lowest first: `priority` (null ⇒ `order`, V3's split), then `order`,
        then LAST-activated. The third term only decides a full tie and exists so two identical
        entries evict in a defined order rather than by dict iteration luck."""
        entry = self.entry
        return (entry.priority if entry.priority is not None else entry.order, entry.order, -self.index)


def _gate_passes(entry: LorebookEntry, hay: Haystack, macros: Macros) -> bool:
    """The optional SECOND gate (§6.3). No secondary keys ⇒ no gate, and `logic` is then irrelevant
    — which is also why the importer normalizes it away in that case."""
    if not entry.secondary_keys:
        return True
    hits = any(
        hay.hit(macros.render(k), case_sensitive=entry.case_sensitive, whole_words=entry.whole_words)
        for k in entry.secondary_keys
    )
    return hits if entry.logic == "and_any" else not hits


def activate(books: Iterable[Lorebook], hay: Haystack, macros: Macros) -> list[Activated]:
    """The entries this turn summons, in book-then-file order.

    An entry activates iff `enabled` ∧ (`constant` ∨ a key hits) ∧ its secondary gate passes (§6.3).
    The macro pass (§4.3) runs over BOTH the keys and the content BEFORE either is used: `{{char}}`
    in a key is what the author wrote, so it must be the character's name that is scanned for, and
    an entry whose content renders to nothing is dropped (the V3 MUST that each entry render once —
    an empty render is not a render)."""
    out: list[Activated] = []
    for book in books:
        for entry in book.entries:
            if not entry.enabled:
                continue
            if not entry.constant and not any(
                hay.hit(macros.render(k), case_sensitive=entry.case_sensitive, whole_words=entry.whole_words)
                for k in entry.keys
            ):
                continue
            if not _gate_passes(entry, hay, macros):
                continue
            content = macros.render(entry.content).strip()
            if content:
                out.append(Activated(entry, content, len(out)))
    return out


def _evict(activated: list[Activated], budget_chars: int) -> list[Activated]:
    """The ONE global budget pass (§6.4 ②), over BOTH positions together: while the activated
    content exceeds `budget_chars`, drop the lowest-ranked entry.

    V3's eviction model, not ST's refusal (R65 §1.10 — ST is the outlier there): going over budget
    means the least important entries do not make it, never that the turn fails. Framing is not
    measured (see the module docstring)."""
    survivors = list(activated)
    total = sum(len(a.content) for a in survivors)
    while total > budget_chars and survivors:
        victim = min(survivors, key=lambda a: a.rank)
        survivors.remove(victim)
        total -= len(victim.content)
    return survivors


def scan(
    books: Iterable[Lorebook], hay: Haystack, macros: Macros, *, budget_chars: int
) -> tuple[list[str], list[str]]:
    """`(head contents, tail contents)` — the rendered entry texts this turn emits, in `order`.

    The §6.4 pipeline, whole and in its fixed sequence: activate → ONE global budget pass →
    partition by position → sort by `order` within each. The caller frames them (the framing is a
    registry prompt, and resolving it here would stamp a prompt on a turn that emitted nothing)."""
    survivors = _evict(activate(books, hay, macros), budget_chars)
    ordered = sorted(survivors, key=lambda a: (a.entry.order, a.index))
    return (
        [a.content for a in ordered if a.entry.position == "head"],
        [a.content for a in ordered if a.entry.position == "tail"],
    )


def block(intro: str, contents: Sequence[str]) -> str | None:
    """One framed block: the registry framing, then the entries (L-8 — an override reframes the
    block, it can never drop the owner's text underneath). `None` when nothing activated for this
    position, which is what makes a scan miss cost zero prompt bytes."""
    if not contents:
        return None
    return "\n\n".join([intro, *contents])
