"""Core Memory — the tier-2 long-term corpus (D57, CORE_MEMORY_PLAN §3/§5).

A **sibling subsystem** to the tier-1 file memory, not an extension of it: one shared,
Claude-Code-native markdown corpus (a `MEMORY.md` routing index + semantic topic files) that is
deliberately *not* injected whole. Only the bounded, rendered index rides the system head (S2); topic
bodies arrive as ordinary tool results (S3). `MemoryProvider`/`StoreSpec` is not a fit here (no query
param, store-keyed writes, one capped file per store), so the D27 "ADDING A STORE" checklist does
**not** apply — this slice adds no store.

S1 built the READ half: root resolution/validation, the scanner, the tolerant frontmatter parse, and
the index render/clamp/cache. S3 adds the WRITE half the `core_memory` tool drives — `read`/`search`
plus the four mutations — as methods here rather than in the tool file, so the corpus owns its own
invariants (confinement, CAS, the secret gate, the crash-tolerant two-file orderings) and the tool
stays a thin validate → call → frame shim. Everything is read from live `Settings` per call (the
`FileMemoryProvider`/`FileSkillProvider` contract) so a config edit or a hand-edited corpus applies
with no restart.

Mutations serialize on the **shared** `MemoryBackup.guard()` lock (the same instance tier 1 holds, so
one lock orders both tiers' writes) and commit through the D26 backup with a content-free subject.
Each individual file write is atomic (`core.fsutil.atomic_write_text`); a two-file mutation is
explicitly NOT a transaction — it is ordered so a retry repairs whatever half is missing (§5).

Two properties the acceptance families lean on: reading never modifies a file, and an invalid root is
one diagnostic, never fatal — the agent runs unaffected with no index.

**No tier-1 code path lives here** (§8-4): this module never imports `FileMemoryProvider` or touches
a tier-1 store file; the corpus's own `core/MEMORY.md` index is legitimately its to write. Pinned by
`test_arch_invariants_core_memory_d57.py`.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import yaml

from app.config import CoreMemoryCfg, Settings, config_path
from app.core.fsutil import atomic_write_text
from app.core.memory import STORES, MemoryBackup
from app.db import db_path
from app.services.agent.memory_backup import NoopBackup
from app.services.agent.skills import FRONTMATTER_RE

log = logging.getLogger(__name__)

#: The agent-facing tool's registered name. Defined here, on the subsystem, so the session's exposure
#: gate (§5's schema-set half) can name it without importing the tool module.
CORE_MEMORY_TOOL = "core_memory"

#: Per-entry clamp for one rendered index line (~150 chars — Claude's own guidance, §3). A module
#: constant rather than a `CoreMemoryCfg` field: plan §6.1 is normative about the five tunables the
#: Conf disclosure edits, and this is a rendering invariant of the index, not a deployment knob.
_ENTRY_CHAR_LIMIT = 150

#: Frontmatter `type` values Claude writes (§3). Anything else — including a missing key — degrades
#: to untyped, which is still a perfectly valid topic.
_TOPIC_TYPES = frozenset({"user", "feedback", "project", "reference"})

#: The corpus index filename. Excluded from the topic scan at EVERY depth (R37 §3 — Claude excludes
#: by basename, not just the root's), and the routing source for the rendered block.
_INDEX_NAME = "MEMORY.md"

#: Directory basename a copied Claude corpus uses for its own logs — foreign, never a topic tree.
_EXCLUDED_DIR = "logs"

#: Tier-1 store filenames (D27 `STORES`), read from the registry so a new store extends this for
#: free. A core root that would put its index or scan tree on top of one of these is refused.
_TIER1_FILENAMES = frozenset(spec.filename for spec in STORES)

#: One index line: `- [Title](file.md) — hook` (the hook separator is optional and free-form).
_INDEX_LINK = re.compile(r"^\s*[-*+]\s+\[([^\]]*)\]\(\s*([^)\s]*)\s*\)\s*(.*)$")

#: Control characters (incl. newlines) in foreign-written text → one space before render.
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")

#: Markdown link syntax inside a title/hook — escaped so a description can't forge a link (incl. an
#: `<autolink>`) or break the entry it sits in (§3: the index carries foreign text).
_LINK_SYNTAX = re.compile(r"([\\\[\]()<>])")

#: Characters a link target may not carry: control chars would enter the system block raw, and
#: `()[]\<>` would break the rendered `[title](path)` structure around an otherwise-valid filename.
_TARGET_BAD = re.compile(r"[\x00-\x1f\x7f()\[\]\\<>]")

#: `search` rendering invariants (module constants for the same reason as `_ENTRY_CHAR_LIMIT`: they
#: shape one result's excerpt, they are not deployment knobs — the caps in `CoreMemoryCfg` bound what
#: the model may consume, and the whole hit list is clamped to `topic_char_limit`).
_EXCERPT_LINES = 3  # matching lines shown per topic
_EXCERPT_CHARS = 200  # per matching line

#: Characters a slugified `create` name keeps. Everything else collapses to a single `-`, so the
#: derived filename can never carry a path separator, a dot component or a `:` (§5 confinement).
_SLUG_BAD = re.compile(r"[^a-z0-9]+")

#: Reserved Windows device names, matched on a component's STEM (the text before its first dot) and
#: case-insensitively — `con.md`, `NUL.md` and `aux.foo.md` all open a DEVICE rather than a file on
#: Windows, so they are not the same address on every platform a corpus is copied to (S3 review).
_WIN_DEVICES = frozenset(
    {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
)

#: How `core_memory_tool._hits_result` joins two rendered `search` hits. Lives here because `search`
#: charges each hit against `topic_char_limit` using the EXACT arithmetic of the rendering below.
_HIT_JOINER = "\n\n"


class CoreMemoryError(RuntimeError):
    """A corpus operation that can't proceed for a reason the model can fix — a stale/ambiguous CAS
    match, a path outside the corpus, a duplicate topic, a write carrying a configured secret. The
    tool turns it into a steering ERROR `ToolResult`, never a crash (the `MemoryWriteError` shape,
    re-derived for tier 2 rather than shared: §8-4 forbids a cross-tier code path)."""


@dataclass(frozen=True)
class CoreTopic:
    """One parsed topic file. `path` is posix-relative to the corpus root (the id everything else —
    index links, `read`/`search` — addresses it by). `nested` records WHERE the name/description were
    found (nested `metadata.*` vs top-level), which is the vote `create` counts to match neighbours
    deterministically (§3)."""

    path: str
    name: str
    description: str
    type: str | None  # one of `_TOPIC_TYPES`, or None (untyped, still valid)
    nested: bool = False  # the copied-Claude shape: `metadata: {name, description, type}`


@dataclass(frozen=True)
class CoreRead:
    """One `read` result: the topic text clamped to `topic_char_limit` CHARACTERS (chars, not bytes —
    R40 §19-3; plain `str` slicing never splits a codepoint), plus the content hash that is `delete`'s
    expected-state token (council Codex-3) and the full on-disk length so the model can see what was
    cut."""

    path: str
    text: str
    content_hash: str
    chars: int  # the full decoded length on disk
    truncated: bool


@dataclass(frozen=True)
class CoreHit:
    """One `search` hit: the topic path plus its matching lines, each clamped."""

    path: str
    lines: tuple[str, ...]


@dataclass
class _WriteOutcome:
    """What one mutation's blocking half produced: the paths the D26 commit must cover, plus the
    edited topic's resulting length (what `update`/`remove` report). One shape for all three
    mutations so `_guarded` — the shielded critical section — has exactly one signature."""

    paths: list[Path] = field(default_factory=list)
    chars: int = 0


@dataclass
class RecallBudget:
    """The per-LOGICAL-TURN recall budget (§4, council Codex-11). Mutable and threaded exactly like
    the session's prompt stamps: the session owns one, `ActionService.invoke` carries it onto the
    `InvocationContext`, and every `read`/`search` adds the length of its COMPLETE framed output.
    The limit itself is not stored — it is read live from `CoreMemoryCfg.recall_char_limit` at check
    time, so an owner edit applies mid-turn like every other cap.

    It survives a suspend/resume because the resumed session SEEDS `used` from the persisted
    core-memory results of the same logical turn (`AgentSession._seed_recall`) — a confirmation
    round-trip must not hand the model a fresh allowance."""

    used: int = 0


@dataclass(frozen=True)
class CoreScan:
    """One corpus scan. `entries` is the *routing* view — the index's own links, in index order,
    with dangling/duplicate ones already dropped (the index is never repaired on read, §3);
    `topics` is everything parseable that was found, indexed or not (S3's `search` sees all of it)."""

    root: Path | None = None
    topics: tuple[CoreTopic, ...] = ()
    entries: tuple[tuple[str, str, str], ...] = ()  # (title, path, hook)
    skipped: int = 0
    anomalies: tuple[str, ...] = ()


@dataclass(frozen=True)
class CoreStatus:
    """The read-only status line S4's Conf endpoint serves: is it on, where does it live, what did
    the last scan see, and how much of the index cap the rendered block occupies."""

    enabled: bool
    root: str | None
    topics: int
    skipped: int
    anomalies: tuple[str, ...]
    index_chars: int
    index_char_limit: int
    index_pct: int


_EMPTY_SCAN = CoreScan()


class CoreMemoryCorpus:
    """Read access to the tier-2 corpus. Stateless across turns except for the scan cache: paths,
    caps and enablement all resolve from live `Settings` at each call, so a Conf edit or a
    hand-edited topic file applies with no restart (the same contract as `FileMemoryProvider`).

    The render sits on the synchronous per-turn path, so it is cached behind the **scan signature**
    (every candidate path + its mtime/size): the per-turn cost is a stat sweep, and parse/render only
    happen when the corpus actually changed — which is also the hand-edit reload boundary."""

    def __init__(self, settings: Settings, backup: MemoryBackup | None = None) -> None:
        self._settings = settings
        #: The D26 git backup — the SAME instance the tier-1 provider holds (`main.py`), so its one
        #: process-wide lock serializes writes across BOTH tiers. `NoopBackup` (lock only, no git)
        #: when none is injected, exactly like `FileMemoryProvider`, so serialization still holds.
        self._backup: MemoryBackup = backup or NoopBackup()
        self._scan_cache: tuple[object, CoreScan] | None = None
        self._index_cache: tuple[object, str] | None = None
        #: warn-once registries — an invalid root or an unreadable file must not spam every turn.
        self._warned: set[str] = set()
        #: Full re-parses since construction (the cache-effectiveness number S5 measures by hand).
        self.parses = 0

    # ── config ────────────────────────────────────────────────────────────────────────────────────

    @property
    def _cfg(self) -> CoreMemoryCfg:
        return self._settings.memory.longterm.core

    @property
    def settings(self) -> Settings:
        """The live `Settings` this corpus reads. Public so the tool can resolve its registry framing
        against the SAME object (there is no second settings source to drift from)."""
        return self._settings

    def auto_write(self) -> bool:
        """Whether the agent may mutate the corpus (council Codex-6). Tier 2 honours the EXISTING
        `memory.auto_write` switch rather than growing a second one — off means mutations are denied
        with a steering error; reads are unaffected."""
        return bool(self._settings.memory.auto_write)

    def recall_char_limit(self) -> int:
        """The per-turn recall cap the `RecallBudget` is measured against, read live (§4)."""
        return self._cfg.recall_char_limit

    def enabled(self) -> bool:
        """Whether tier 2 is Core Memory right now. `backend` is the only tier-2 switch; the memory
        master switch still gates it, since the whole slot lives inside the `memory:` section."""
        mem = self._settings.memory
        return bool(mem.enabled) and mem.longterm.backend == "core"

    # ── root resolution ───────────────────────────────────────────────────────────────────────────

    def root(self) -> Path | None:
        """The validated, symlink-resolved corpus root — or None, with one diagnostic, when the
        configured root is refused (§3). Never raises: a bad root degrades to "no corpus", which the
        agent experiences as an absent index, not an error."""
        root, why = validated_root(self._settings)
        if why is not None:
            raw = self._cfg.root.strip()
            self._warn_once(f"root:{raw}:{why}", "core memory disabled: root %r %s", raw, why)
        return root

    # ── scan ──────────────────────────────────────────────────────────────────────────────────────

    def scan(self) -> CoreScan:
        """The corpus as the reader sees it, cached on the scan signature. Cheap on a hit (one stat
        sweep); a changed/added/removed file re-parses. Independent of `enabled()` so S4's status
        endpoint can report a corpus the owner has not switched on yet."""
        root = self.root()
        if root is None or not root.is_dir():
            return _EMPTY_SCAN
        files, index_file, signature, errors = self._sweep(root)
        # Errors join the key: an unreadable dir's contents were never stat'd, so its appearance or
        # recovery can change nothing in `signature` — the error set is the only signal (confirm round).
        key = (str(root), signature, tuple(errors))
        if self._scan_cache is not None and self._scan_cache[0] == key:
            return self._scan_cache[1]
        scan = self._parse(root, files, index_file, errors)
        self.parses += 1
        self._scan_cache = (key, scan)
        return scan

    def _sweep(self, root: Path) -> tuple[list[tuple[str, Path]], Path | None, tuple, list[str]]:
        """Stat-only pass: the candidate topic files (posix-relative path + absolute path), the root
        index if present, the signature the caches key on, and any IO trouble (surfaced as anomalies
        — an unreadable subtree must not read as "covered"). Exclusions happen here so an excluded
        tree costs nothing: every basename `MEMORY.md` case-insensitively (only the exact-case root
        `MEMORY.md` is *the* index, so two case variants can never race), any dotted or `logs` path
        component, and **symlinks of any kind** (never followed — a corpus is a plain tree; §5's
        confinement rule applied to the read side, and it also makes the walk loop-free)."""
        found: list[tuple[str, Path]] = []
        errors: list[str] = []
        index_file: Path | None = None
        stack = [root]
        while stack:
            current = stack.pop()
            try:
                entries = list(os.scandir(current))
            except OSError:
                errors.append(f"unreadable directory: {current.relative_to(root).as_posix()}")
                continue
            for entry in entries:
                try:
                    if entry.name.startswith("."):
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name != _EXCLUDED_DIR:
                            stack.append(Path(entry.path))
                        continue
                    is_file = entry.is_file(follow_symlinks=False)
                except OSError:  # a stat that fails mid-walk (permissions flipping, network fs)
                    errors.append(f"unreadable entry: {Path(entry.path).relative_to(root).as_posix()}")
                    continue
                if not is_file or not entry.name.lower().endswith(".md"):
                    continue
                path = Path(entry.path)
                if entry.name.lower() == _INDEX_NAME.lower():
                    if path.parent == root and entry.name == _INDEX_NAME:
                        index_file = path
                    continue  # a nested (or case-variant) MEMORY.md is a foreign index, not a topic
                found.append((path.relative_to(root).as_posix(), path))
        found.sort()
        signature = tuple(
            (rel, *_stamp(path)) for rel, path in [*found, (_INDEX_NAME, index_file or root / _INDEX_NAME)]
        )
        return found, index_file, signature, errors

    def _parse(
        self, root: Path, files: list[tuple[str, Path]], index_file: Path | None, errors: list[str]
    ) -> CoreScan:
        """Parse the index + every candidate topic into a `CoreScan`. The index is the routing source
        and is never repaired here: a dangling or duplicate link is dropped from the rendered view and
        reported as an anomaly, and a topic nobody links to stays scannable (S3 `search`) while also
        counting as one."""
        raw_index = _read_text(index_file) if index_file else ""
        if raw_index is None:
            errors = [*errors, "unreadable index: MEMORY.md"]
            raw_index = ""
        links = _parse_index(raw_index)
        linked = {target for _title, target, _hook in links}
        topics: list[CoreTopic] = []
        skipped = 0
        anomalies: list[str] = list(errors)
        for rel, path in files:
            topic = self._parse_topic(path, rel, indexed=rel in linked)
            if topic is None:
                skipped += 1
                continue
            topics.append(topic)
        by_path = {topic.path: topic for topic in topics}
        entries: list[tuple[str, str, str]] = []
        seen: set[str] = set()
        for title, target, hook in links:
            topic = by_path.get(target)
            if topic is None:
                anomalies.append(f"dangling index link: {target}")
                continue
            if target in seen:
                anomalies.append(f"duplicate index link: {target}")
                continue
            seen.add(target)
            # The path must survive rendering intact — it is what S3's `read` is addressed by. A path
            # that can't fit an entry line even with a one-char title ("- […](path)") is unroutable.
            if len(target) + 7 > _ENTRY_CHAR_LIMIT:
                anomalies.append(f"index link path too long: {target}")
                continue
            entries.append((title or topic.name, target, hook or topic.description))
        anomalies.extend(f"topic not in the index: {t.path}" for t in topics if t.path not in seen)
        return CoreScan(root, tuple(topics), tuple(entries), skipped, tuple(anomalies))

    def _parse_topic(self, path: Path, rel: str, indexed: bool) -> CoreTopic | None:
        """One topic file, tolerantly (§3): `name`/`description`/`type` from top-level **or** nested
        `metadata.*`, top-level winning on conflict (it is Claude's own canonical shape, so the rule
        is deterministic); an unknown/missing `type` degrades to untyped. A file with no parseable
        frontmatter is still a topic when the index links it, and is otherwise skipped — logged once,
        never fatal. Nothing here writes: a CRLF file parses and stays byte-identical."""
        raw = _read_text(path)
        if raw is None:
            self._warn_file(rel, "unreadable")
            return None
        meta = _frontmatter(raw)
        if meta is None:
            if not indexed:
                self._warn_file(rel, "no frontmatter and not in the index")
                return None
            meta = {}
        nested = _nested_of(meta)
        name, description = _identity_of(meta, nested, rel)
        kind = _pick(meta, nested, "type")
        return CoreTopic(
            path=rel,
            name=name,
            description=description,
            type=kind if kind in _TOPIC_TYPES else None,
            # The shape vote (§3): nested only when the identity keys were found ONLY under
            # `metadata.*`. Top-level wins on conflict when reading, so it wins as a vote too, and a
            # file carrying neither key votes top-level — which is also the tie default.
            nested=not _has_any(meta, ("name", "description")) and _has_any(nested, ("name", "description")),
        )

    def _warn_file(self, rel: str, why: str) -> None:
        self._warn_once(f"file:{rel}:{why}", "core memory: skipping %s — %s", rel, why)

    def _warn_once(self, key: str, msg: str, *args: object) -> None:
        """Log once per key — an invalid root or a bad file must not spam every turn. Bounded: at 512
        keys the registry rolls over (a rare duplicate log, never unbounded growth)."""
        if key in self._warned:
            return
        if len(self._warned) >= 512:
            self._warned.clear()
        self._warned.add(key)
        log.warning(msg, *args)

    # ── render ────────────────────────────────────────────────────────────────────────────────────

    def render_index(self) -> str:
        """The rendered index block, or "" when the feature is off / the corpus has nothing to route.
        Cached alongside the scan (the render is per-turn work, council M3). S2 wraps this in the
        `core_memory_policy` framing and injects it; nothing here is injected on its own."""
        if not self.enabled():
            return ""
        scan = self.scan()
        if not scan.entries:
            return ""
        cap = self._cfg.index_char_limit
        key = (self._scan_cache[0] if self._scan_cache else None, cap)
        if self._index_cache is not None and self._index_cache[0] == key:
            return self._index_cache[1]
        block = _fit(
            [_entry_line(title, path, hook) for title, path, hook in scan.entries],
            cap,
        )
        self._index_cache = (key, block)
        return block

    def status(self) -> CoreStatus:
        """Everything S4's read-only status endpoint needs — derived, never stored (settings GET
        carries no derived data, council M8). Root + scan report even while the slot is off — the
        Conf line can preview a copied-in corpus before the owner switches it on; only the rendered
        block (what would enter the head) is gated on `enabled()`."""
        enabled = self.enabled()
        root = self.root()
        scan = self.scan()
        block = self.render_index()
        cap = self._cfg.index_char_limit
        return CoreStatus(
            enabled=enabled,
            root=str(root) if root else None,
            topics=len(scan.topics),
            skipped=scan.skipped,
            anomalies=scan.anomalies,
            index_chars=len(block),
            index_char_limit=cap,
            index_pct=_pct(len(block), cap),
        )

    # ── confinement (§5, council Codex-2) ─────────────────────────────────────────────────────────

    def _root_or_raise(self) -> Path:
        root = self.root()
        if root is None:
            raise CoreMemoryError("core memory has no usable root — check `memory.longterm.core.root`.")
        return root

    def _confine(self, raw: str, root: Path | None = None) -> tuple[Path, str]:
        """One tool-supplied path → `(absolute file, corpus-relative posix path)`, or a steering
        `CoreMemoryError`. EVERY operation goes through here: a normalized relative `.md` path, no
        `MEMORY.md` at any case, no dotted or `logs` component, no absolute/`..`/`:`/structural
        characters, and **no symlink anywhere on the way down** (each component is checked as the walk
        descends, so a symlinked directory can't smuggle the target out of the corpus). The resolved
        result must still be strictly inside the root before any IO touches it."""
        root = root or self._root_or_raise()
        rel = topic_path(raw)
        if rel is None:
            raise CoreMemoryError(
                f"{raw!r} is not a topic path — give a relative path inside the corpus ending in "
                "`.md` (no `..`, no absolute path, and `MEMORY.md` is the index, not a topic)."
            )
        current = root
        for part in rel.split("/"):
            current = current / part
            if current.is_symlink():
                raise CoreMemoryError(f"{rel} passes through a symlink — refused.")
        resolved = _resolved(current)
        if not _strictly_inside(resolved, root):
            raise CoreMemoryError(f"{rel} resolves outside the corpus — refused.")
        return current, rel

    # ── recall (§5: read + search) ────────────────────────────────────────────────────────────────

    def read_topic(self, raw_path: str) -> CoreRead:
        """One topic, clamped to `topic_char_limit` characters. Read-only: nothing here writes, and
        the returned `content_hash` (sha256 of the file's raw bytes) is what `delete` must echo back.

        ONE read of the bytes, hashed and decoded from that single buffer: reading the text and then
        re-opening the file to hash it would let a write landing between the two hand the model
        version A's text with version B's delete token — a stale delete that passes the CAS gate."""
        path, rel = self._confine(raw_path)
        try:
            data = path.read_bytes()
        except OSError:
            raise CoreMemoryError(f"no topic at {rel} — check the index.") from None
        try:
            raw = data.decode("utf-8")
        except UnicodeDecodeError:
            raise CoreMemoryError(
                f"{rel} is not readable as UTF-8 text — fix the file by hand before reading it."
            ) from None
        cap = self._cfg.topic_char_limit
        return CoreRead(
            path=rel,
            text=raw[:cap],  # characters, not bytes — `str` slicing never splits a codepoint
            content_hash=hashlib.sha256(data).hexdigest(),
            chars=len(raw),
            truncated=len(raw) > cap,
        )

    def search(self, query: str) -> tuple[CoreHit, ...]:
        """Literal, case-insensitive grep over topic bodies **and** frontmatter (§5): a line matches
        when it contains the whole query, or every whitespace-separated token of it. Deliberately not
        BM25 and not embeddings — this exists to find a fact the index hook never mentions, so it
        searches every parseable topic, indexed or not. Excerpts are clamped per line and per topic,
        and the whole hit list is clamped to `topic_char_limit` so one search can never outweigh a
        read.

        Synchronous, like the rest of the read side (the per-turn index render already reads files on
        the event loop) — and deliberately so: the scan cache is only ever touched from the loop
        thread, which is what keeps the shared singleton re-entrancy-safe. Only the mutations take a
        thread hop, and they never read the cache from inside it."""
        needle = query.strip().lower()
        if not needle:
            return ()
        tokens = needle.split()
        scan = self.scan()
        root = scan.root
        if root is None:
            return ()
        room = self._cfg.topic_char_limit
        hits: list[CoreHit] = []
        for topic in scan.topics:
            raw = _read_text(root / topic.path)
            if raw is None:
                continue
            lines: list[str] = []
            for line in raw.splitlines():
                text = line.strip()
                low = text.lower()
                if not text or not (needle in low or all(t in low for t in tokens)):
                    continue
                lines.append(text if len(text) <= _EXCERPT_CHARS else _clip(text, _EXCERPT_CHARS))
                if len(lines) >= _EXCERPT_LINES:
                    break
            if not lines:
                continue
            hit = CoreHit(path=topic.path, lines=tuple(lines))
            # The EXACT cost of this hit as `_hits_result` will render it (`render_hit` is the shared
            # definition, so the accounting can't drift from the rendering) plus the joiner it will
            # need. An oversized hit is SKIPPED rather than ending the scan: one fat topic early in
            # the walk must not hide every small match after it.
            cost = len(render_hit(hit)) + (len(_HIT_JOINER) if hits else 0)
            if cost > room:
                continue
            room -= cost
            hits.append(hit)
        return tuple(hits)

    # ── mutations (§5: create / update / remove / delete) ─────────────────────────────────────────

    async def create(self, name: str, description: str, kind: str | None, content: str) -> str:
        """A new topic + its index line. Structured fields only — the service renders the frontmatter
        (council Codex-8), matching the neighbours' shape (§3), and the path is derived from `name` so
        the model never picks a location either.

        Ordering (§5, council Codex-4): topic first, index line second, each write atomic on its own.
        A retry that finds the exact topic already on disk with no index line completes the index half
        (and one that finds both simply reports it done) — idempotent repair, explicitly not a
        transaction."""
        root = self._root_or_raise()
        rel = _slug(name)
        if rel is None:
            raise CoreMemoryError(f"{name!r} has no usable filename — give a plain descriptive name.")
        path, rel = self._confine(rel, root)
        # The neighbour-shape vote is decided HERE, on the event-loop thread, because it reads the
        # scan cache — every cache mutation stays single-threaded (the S2 re-entrancy note), and the
        # thread hop below owns nothing but file IO.
        text = _render_topic(name, description, kind, content, nested=self._new_shape(rel))
        outcome = await self._guarded(
            lambda: self._create_blocking(root, path, rel, name, description, text),
            _commit_msg("create", rel),
        )
        written = outcome.paths
        # Say what actually happened — a repairing retry writes only the half that was missing, and
        # reporting "created" for a no-op would have the model announce work it did not do.
        if path in written:
            return f"created {rel}" + (" and listed it in the index" if len(written) > 1 else "")
        if written:
            return f"completed the index entry for {rel}"
        return f"{rel} was already present with this content — nothing changed"

    async def update(self, raw_path: str, old_text: str, new_text: str) -> str:
        """Replace the unique occurrence of `old_text` in one topic (the expected-prior-state rule)."""
        return await self._edit(raw_path, old_text, new_text, "update")

    async def remove(self, raw_path: str, old_text: str) -> str:
        """Delete the unique occurrence of `old_text` from one topic."""
        return await self._edit(raw_path, old_text, "", "remove")

    async def delete(self, raw_path: str, content_hash: str) -> str:
        """A whole topic + its index line, gated on the `content_hash` `read` returned (council
        Codex-3: a description token both fails CAS — a body can change under an unchanged description
        — and is unusable on a copied corpus whose descriptions outrun the read cap).

        Ordering (§5): index line first, topic second — a retry completes either remainder."""
        root = self._root_or_raise()
        path, rel = self._confine(raw_path, root)
        await self._guarded(
            lambda: self._delete_blocking(root, path, rel, content_hash), _commit_msg("delete", rel)
        )
        return f"deleted {rel} and removed its index line"

    async def _edit(self, raw_path: str, old_text: str, new_text: str, action: str) -> str:
        """The shared body of `update`/`remove`: one CAS'd substring edit of one topic file. The index
        is touched only when the edit changed the topic's own IDENTITY (its effective frontmatter
        name/description), which is what the index line renders — an ordinary body edit is the single
        atomic write it always was."""
        root = self._root_or_raise()
        path, rel = self._confine(raw_path, root)
        if not old_text:
            raise CoreMemoryError("`old_text` is required — copy it verbatim from the topic you read.")
        outcome = await self._guarded(
            lambda: self._edit_blocking(root, path, rel, old_text, new_text), _commit_msg(action, rel)
        )
        return f"{action}d {rel} — now {outcome.chars:,} chars"

    async def _guarded(self, blocking: Callable[[], _WriteOutcome], msg: str) -> _WriteOutcome:
        """Run one mutation's WHOLE critical section — acquire the shared guard, do the file work in a
        thread, commit through the D26 backup, release — as a task an outer cancel cannot interrupt.

        Without this, `ActionService._execute`'s per-tool `asyncio.wait_for` deadline (or a Stop)
        cancels the coroutine that is *awaiting* the thread hop: `async with self._backup.guard()`
        unwinds and RELEASES the lock while the worker thread keeps writing (Python threads are not
        cancellable), so the next writer — either tier, it is one shared lock — reads a corpus mid-
        write. The session's `_persist_shielded` (`session.py`, the C3-H1 dual shield) defeats exactly
        this class of cancel and this mirrors its asyncio-native half: run the section as its OWN
        `asyncio.ensure_future` task, `await asyncio.shield(...)`, and on `CancelledError` await the
        task a SECOND time so it always runs to completion (and is never left detached) before the
        cancellation propagates. The `anyio.CancelScope(shield=True)` half of that idiom is the
        session's alone — it exists for the Starlette/TaskGroup scope shape a corpus call never owns."""

        async def _critical() -> _WriteOutcome:
            async with self._backup.guard():
                outcome = await asyncio.to_thread(blocking)
                await self._backup.commit(outcome.paths, msg)
                return outcome

        task = asyncio.ensure_future(_critical())
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task  # uncancellable by the outer cancel — let the guard-holding write finish
            raise

    # ── the blocking halves (one `to_thread` hop each, under the guard — the SYS-16 rule) ─────────

    def _create_blocking(
        self, root: Path, path: Path, rel: str, name: str, description: str, text: str
    ) -> _WriteOutcome:
        # Anything already AT this path that isn't byte-identical to what we would write is a
        # duplicate, unreadable included (`_read_text` yields None there — never a reason to clobber
        # it). Byte-identical means the crash-retry case: skip the write, finish the index half.
        occupied = path.exists()
        if occupied and _read_text(path) != text:
            raise CoreMemoryError(
                f"{rel} already exists with different content — read it and `update` it instead of "
                "creating a second topic for the same thing."
            )
        written: list[Path] = []
        if not occupied:
            # Gate the STRUCTURED fields raw before the rendered text (R40 §7.4's spirit):
            # `yaml.safe_dump` folds a long or multi-line scalar, so a secret pasted into
            # `description` could be unrecognizable in the rendered file alone. Both gates sit
            # INSIDE the actually-writing branch (confirm round): gating before byte-identity is
            # known would turn a crash-repair into a refusal over content this call did not write.
            self._guard_secrets("\n".join((name, description, text)))
            atomic_write_text(path, text)
            written.append(path)
        # OVERRULE (S3 review): the byte-identical retry path is deliberately NOT secret-gated. It
        # writes nothing — the file on disk is the owner's, already there, and re-gating it would
        # turn a crash-repair into a refusal over content this call did not introduce.
        index = root / _INDEX_NAME
        raw = _index_raw(root)
        if not any(target == rel for _title, target, _hook in _parse_index(raw)):
            merged = _append_entry(raw, _entry_line(name, rel, description))
            self._guard_secrets(merged)
            atomic_write_text(index, merged)
            written.append(index)
        return _WriteOutcome(written, len(text))

    def _edit_blocking(self, root: Path, path: Path, rel: str, old_text: str, new_text: str) -> _WriteOutcome:
        raw = _read_text(path)
        if raw is None:
            raise CoreMemoryError(f"no topic at {rel} — check the index.")
        merged = _cas(raw, rel, old_text, new_text)
        self._guard_secrets(merged)
        # An edit that moved the topic's EFFECTIVE name/description moved what the index line renders,
        # so the routing text the head carries would otherwise go stale (S3 review). Resolve both
        # identities the way the reader resolves them and re-render that one line — the merged index is
        # gated too, since a new name/description is new content entering the block.
        before, after = _identity(raw, rel), _identity(merged, rel)
        index_text = _relabel(_index_raw(root), rel, before, after) if before != after else None
        if index_text is not None:
            self._guard_secrets(index_text)
        atomic_write_text(path, merged)
        written = [path]
        # Topic first, index second — the `create` ordering, for the same reason. RECORDED DELIBERATE
        # RESIDUAL: a crash between the two leaves the OLD title/hook on the index line. That is
        # cosmetic routing text, not data loss (the topic is correct and still addressable by the same
        # path), so the two-file repair machinery is deliberately NOT extended to it. Note the residual
        # does not self-heal: once the line has diverged, `_relabel`'s hand-written-hook rule reads the
        # divergence as an owner-chosen hook and keeps it — a later metadata edit moves the title but
        # leaves the hook until the owner edits `MEMORY.md`. Protecting a real hand-written note is
        # worth more than auto-repairing a stale one (pinned by the S3 fault-injection test).
        if index_text is not None:
            index = root / _INDEX_NAME
            atomic_write_text(index, index_text)
            written.append(index)
        return _WriteOutcome(written, len(merged))

    def _delete_blocking(self, root: Path, path: Path, rel: str, content_hash: str) -> _WriteOutcome:
        raw = _index_raw(root)
        listed = any(target == rel for _title, target, _hook in _parse_index(raw))
        if not path.exists() and not listed:
            raise CoreMemoryError(
                f"no topic at {rel} — nothing to delete (if you just deleted it, it is already gone)."
            )
        if path.exists():
            # The expected-state gate, checked BEFORE either step so a stale token changes nothing.
            actual = _content_hash(path)
            if actual != content_hash.strip().lower():
                raise CoreMemoryError(
                    f"{rel} has changed since you read it — its content hash no longer matches the "
                    "one you sent. Read it again and re-check before deleting."
                )
        written: list[Path] = []
        if listed:  # index line first (§5): a retry then completes whichever half is left
            index = root / _INDEX_NAME
            # OVERRULE (S3 review): no secret gate on this write. `_drop_entry` only REMOVES lines, so
            # the result is a strict subset of an index that already passed the gate — a removal
            # cannot introduce a secret, and gating it would make `delete` refusable by a leak that is
            # already on disk (the one operation that would clean it up).
            atomic_write_text(index, _drop_entry(raw, rel))
            written.append(index)
        if path.exists():
            _remove_file(path)
            written.append(path)
        return _WriteOutcome(written)

    # ── write-side rails ──────────────────────────────────────────────────────────────────────────

    def _guard_secrets(self, text: str) -> None:
        """§5 / council Opus-H3: refuse a write whose COMPLETE resulting file content contains a value
        the owner configured as a secret. Evaluated post-merge, never on the delta — Claude's own edit
        tool scans only the replacement string, so a secret assembled across two edits slips a local
        check (R40 §7.4). A containment check on KNOWN values, not a scanner (shape detection is an
        explicit non-goal), and a recorded D27 divergence: tier 1 trusts curated memory, a shared
        long-term corpus gets the rail. Blank/whitespace-only config fields are skipped — they would
        otherwise match every file. The refusal never echoes the value."""
        for value in self._settings.secret_values():
            if value.strip() and value in text:
                raise CoreMemoryError(
                    "that write contains a value configured as a secret (an API key, password or "
                    "token). Core memory never stores credentials — write a pointer to where the "
                    "secret lives instead."
                )

    def _new_shape(self, rel: str) -> bool:
        """Frontmatter shape for a NEW topic (§3): directory majority → corpus majority → top-level on
        a tie (or an empty corpus). Deterministic by construction, so a copied Claude corpus keeps
        being written the way it is written and a ctrl-b-born one stays top-level."""
        topics = self.scan().topics
        directory = PurePosixPath(rel).parent
        same_dir = [t for t in topics if PurePosixPath(t.path).parent == directory]
        for pool in (same_dir, list(topics)):
            nested = sum(1 for t in pool if t.nested)
            if nested * 2 != len(pool):  # a strict majority exists in this pool
                return nested * 2 > len(pool)
        return False


# ── module helpers ────────────────────────────────────────────────────────────────────────────────


def validated_root(settings: Settings) -> tuple[Path | None, str | None]:
    """The resolved corpus root, or (None, why-refused) (§3). Never raises. Module-level so tier 1
    can hold the same invariant from its side: `FileMemoryProvider._agent_memory_dir` yields to an
    active corpus root, because `AgentDef.memory_dir` makes the reserved tier-1 set dynamic and a
    static refusal here cannot see agents configured *after* the root validated (S1 review)."""
    raw = settings.memory.longterm.core.root.strip()
    memories = settings.memories_dir_path()
    if not raw:
        return None, "empty"
    configured = Path(raw).expanduser()
    candidate = configured if configured.is_absolute() else memories / configured
    try:
        root = candidate.resolve()
        memories_r = memories.resolve()
    except OSError:
        return None, "unresolvable"
    # A relative root addresses a place *inside* the memory dir; `..`/`.` escapes are refused
    # rather than silently clamped. An absolute root may live anywhere (documented as unversioned)
    # and is held to the containment rules below alone.
    if not configured.is_absolute() and not _strictly_inside(root, memories_r):
        return None, "not inside the memory dir"
    # The `_safe_root` spirit (D26): never scan a tree that holds the workspace, the config or the db.
    for sensitive in (settings.home_dir(), config_path(), db_path()):
        try:
            if sensitive.resolve().is_relative_to(root):
                return None, "contains $CTRLB_HOME, config.yaml or the db"
        except OSError:
            continue
    # Tier-1 overlap (council Codex-1): `root: "."` would make core's index the root agent's
    # MEMORY.md, and a root at/under `agents/` would capture a specialist's stores. Both directions,
    # store paths symlink-resolved — a root at/under a store file is as wrong as one containing it.
    for name in _TIER1_FILENAMES:
        store = _resolved(memories_r / name)
        if store.is_relative_to(root) or root.is_relative_to(store):
            return None, "overlaps a tier-1 store file"
    agents_root = _resolved(memories_r / "agents")
    if root.is_relative_to(agents_root) or agents_root.is_relative_to(root):
        return None, "overlaps the tier-1 per-agent memory tree"
    return root, None


def _resolved(path: Path) -> Path:
    try:
        return path.resolve()
    except OSError:
        return path


def _strictly_inside(path: Path, root: Path) -> bool:
    """`path` is a proper descendant of `root` (equality is not enough — a relative core root must be
    a non-empty strict child of the memory dir, else its index IS the root agent's MEMORY.md)."""
    return path != root and path.is_relative_to(root)


def _stamp(path: Path) -> tuple[int, int, int, int]:
    """(mtime_ns, size, ino, ctime_ns) for the scan signature, or a sentinel for an absent/unreadable
    file. Size catches a same-tick rewrite; inode + ctime catch a sync tool replacing a file while
    faithfully preserving mtime and size (ctime is kernel-stamped — userspace can't preserve it)."""
    try:
        st = path.stat()
    except OSError:
        return (-1, -1, -1, -1)
    return (st.st_mtime_ns, st.st_size, st.st_ino, st.st_ctime_ns)


def _read_text(path: Path) -> str | None:
    """The file's text, or None when it can't be read as UTF-8 (skipped, never fatal). Read-only by
    construction: no newline translation is written back anywhere, so a CRLF file stays CRLF."""
    try:
        return path.read_text(encoding="utf-8")
    except OSError, UnicodeDecodeError, ValueError:
        return None


def _frontmatter(raw: str) -> dict | None:
    """The `---`-fenced YAML frontmatter as a mapping, or None when there is none / it is unparseable
    / it is not a mapping. Shares `FRONTMATTER_RE` with the skills reader — one definition of what a
    frontmatter block is."""
    match = FRONTMATTER_RE.match(raw)
    if not match:
        return None
    try:
        parsed = yaml.safe_load(match.group(1))
    # Beyond YAMLError: pathological YAML raises RecursionError (~2k nested sequences) or
    # ValueError (a 10k-digit int) — a poisoned copied-in topic must degrade, not fail the turn.
    except yaml.YAMLError, RecursionError, ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _nested_of(meta: dict) -> dict:
    """The copied-Claude `metadata:` sub-mapping, or `{}` when there is none (or it isn't a mapping)."""
    nested = meta.get("metadata")
    return nested if isinstance(nested, dict) else {}


def _identity_of(meta: dict, nested: dict, rel: str) -> tuple[str, str]:
    """A topic's EFFECTIVE `(name, description)`: top-level frontmatter winning over nested
    `metadata.*` (§3), with the filename stem standing in for a missing name."""
    return _pick(meta, nested, "name") or PurePosixPath(rel).stem, _pick(meta, nested, "description")


def _identity(raw: str, rel: str) -> tuple[str, str]:
    """The same identity, resolved from a topic file's TEXT — the one definition the scan's routing
    view and an edit's index-freshness check both read, so they can never disagree about what a
    topic is called."""
    meta = _frontmatter(raw) or {}
    return _identity_of(meta, _nested_of(meta), rel)


def _index_raw(root: Path) -> str:
    """The corpus index's text for a MUTATION to merge against: `""` when the file is absent, and a
    steering `CoreMemoryError` when it EXISTS but cannot be read (S3 review).

    Never `_read_text(...) or ""`: collapsing an unreadable index into the empty string would have
    `create` append its entry to nothing and REPLACE the owner's file, and would have `delete`
    conclude the topic was never listed. A corpus index we cannot read is a hand-fix, not a rewrite."""
    index = root / _INDEX_NAME
    if not index.exists():
        return ""
    raw = _read_text(index)
    if raw is None:
        raise CoreMemoryError(
            "the corpus index is unreadable — fix `MEMORY.md` by hand before writing to core memory."
        )
    return raw


def _pick(meta: dict, nested: dict, key: str) -> str:
    """`key` from the top-level frontmatter, else from nested `metadata.*` — top-level wins on
    conflict (§3). Non-string scalars are coerced; anything structural reads as absent."""
    for source in (meta, nested):
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float, bool)):
            return str(value)
    return ""


def _parse_index(raw: str) -> list[tuple[str, str, str]]:
    """The index's `- [Title](file.md) — hook` lines, in file order, as (title, path, hook). A link
    that isn't a plain relative `.md` path inside the corpus (a URL, an absolute path, a `..` escape)
    is dropped here — it can never name a topic, so it would only ever render as a dangling one."""
    out: list[tuple[str, str, str]] = []
    for line in raw.splitlines():
        match = _INDEX_LINK.match(line)
        if not match:
            continue
        title, target, hook = match.groups()
        rel = _link_target(target)
        if rel is None:
            continue
        out.append((title.strip(), rel, _clean_hook(hook)))
    return out


def _clean_hook(raw: str) -> str:
    """One index line's hook, stripped of the `— `/`- `/`: ` separator that introduces it. One
    definition, so a line's hook can be compared against the one a description would render."""
    return raw.strip().lstrip("—–-:").strip()


def _relabel(raw: str, rel: str, before: tuple[str, str], after: tuple[str, str]) -> str | None:
    """The index text with `rel`'s entry re-rendered for its topic's NEW `(name, description)`, or
    `None` when `rel` has no index line (nothing to keep in sync — an unindexed topic is legitimate).

    An OWNER-WRITTEN hook survives a rename: a hook that differs from what the OLD description would
    have rendered was chosen by hand, so only the title moves. Every other line — trailing blanks and
    a missing final newline included — is untouched (confirm round: only the ONE matched line is
    rewritten, its own ending preserved). Endings DO normalize to LF end-to-end, which is §3's
    sanctioned first-write behavior (`_read_text` reads universal-newline, the atomic writer forces
    LF) — the contract violation was the old splitlines/join rebuild dropping trailing blanks."""
    # What the OLD description WOULD have rendered as, clamp included — the yardstick for "custom".
    stock_line = _INDEX_LINK.match(_entry_line(before[0], rel, before[1]))
    stock = _clean_hook(stock_line.group(3)) if stock_line else ""
    out: list[str] = []
    hit = False
    for line in raw.splitlines(keepends=True):
        content = line.rstrip("\r\n")
        match = _INDEX_LINK.match(content)
        if match is None or _link_target(match.group(2)) != rel:
            out.append(line)
            continue
        hook = _clean_hook(match.group(3))
        custom = bool(hook) and hook not in {stock, _normalize(before[1])}
        out.append(_entry_line(after[0], rel, hook if custom else after[1]) + line[len(content) :])
        hit = True
    return "".join(out) if hit else None


def _link_target(target: str) -> str | None:
    """Normalize an index link to a corpus-relative posix path, or None when it can't be one. `:` is
    refused outright — it admits every URI scheme (`mailto:x.md` would render as a live URI even
    though a colon is a legal POSIX filename char) and Windows drive letters with it."""
    text = target.strip().split("#", 1)[0].split("?", 1)[0]
    if not text or ":" in text or text.startswith(("/", "~")) or _TARGET_BAD.search(text):
        return None
    parts = [p for p in PurePosixPath(text).parts if p != "."]
    if not parts or any(p == ".." for p in parts) or not parts[-1].lower().endswith(".md"):
        return None
    return "/".join(parts)


def topic_path(raw: str) -> str | None:
    """A tool-supplied path normalized to a corpus-relative posix topic path, or None when it can
    never name one. Shares `_link_target`'s vocabulary (one definition of "a path that can address a
    topic" for index links and tool arguments alike) and adds the SCAN's own exclusions, so the tool
    can only ever address something the reader would also see: no `MEMORY.md` at any depth or case, no
    dotted component (`.consolidate-lock`, `.git/…`), no `logs/` tree."""
    rel = _link_target(raw)
    if rel is None:
        return None
    parts = rel.split("/")
    if any(part.startswith(".") or part == _EXCLUDED_DIR for part in parts):
        return None
    if parts[-1].lower() == _INDEX_NAME.lower():
        return None
    # Windows path ALIASES (S3 review). The Win32 layer strips a trailing dot or space from a path
    # component, so `dir./x.md` and `dir /x.md` open the same file `dir/x.md` does — three tool paths
    # for one topic, each of which the confinement check would bless — and a reserved device stem
    # opens a DEVICE, not a file. Refused on every platform so a corpus addresses identically wherever
    # it is copied. LEXICAL closure only: the filesystem-identity comparison (open both, compare
    # st_dev/st_ino) the review proposed is OVERRULED — this is a single-user tailnet corpus, and a
    # rule the model can also read back out of the error beats a stat-time equivalence check.
    if any(p.endswith((".", " ")) or p.split(".", 1)[0].lower() in _WIN_DEVICES for p in parts):
        return None
    # The check above runs on the CANONICAL components, but `_link_target` strips the whole argument
    # first — laundering a trailing space/dot typo on the FINAL component into the canonical path
    # (confirm round). Re-check the semi-raw form so `"x.md "` is refused as the alias it is, not
    # silently adopted; other whitespace tails (`\n`, `\t`) stay benign canonicalization — Win32
    # strips only dots and spaces.
    if any(p != p.rstrip(". ") for p in raw.split("#", 1)[0].split("?", 1)[0].lstrip().split("/")):
        return None
    return rel


def _slug(name: str) -> str | None:
    """`create`'s derived filename: the topic name lowercased to `[a-z0-9-]+.md`. The model supplies
    a NAME, never a path (§5's structured-create rule extended to the location), so nothing it can
    write is a traversal, a dotfile or a second `MEMORY.md` — the confinement check that follows is
    the belt, this is the braces.

    Clamped so the result is ROUTABLE: `_parse` drops an index link whose target cannot fit an entry
    line (the 7 chars of `- [x](…)` around it), so an unclamped long name would create a topic the
    index can never list — findable only by `search`."""
    stem = _SLUG_BAD.sub("-", name.strip().lower()).strip("-")
    room = _ENTRY_CHAR_LIMIT - 7 - len(".md")
    if len(stem) > room:
        stem = stem[:room].rstrip("-")  # the cut can expose a trailing separator — never keep one
    return f"{stem}.md" if stem else None


def _has_any(meta: dict, keys: tuple[str, ...]) -> bool:
    return any(key in meta for key in keys)


def _content_hash(path: Path) -> str:
    """sha256 (lowercase hex) of a topic's RAW BYTES — `read`'s expected-state token for `delete`.
    Bytes, not decoded text: it is the file's identity, so a CRLF→LF normalization is a change."""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return ""


def _cas(raw: str, rel: str, old_text: str, new_text: str) -> str:
    """The compare-and-swap edit (§5): `old_text` must occur EXACTLY ONCE in the file's current text.
    Zero matches ⇒ stale, more than one ⇒ ambiguous; either way a steering error and no write — never
    a silent overwrite. The same rule tier 1 proved as F6, re-derived here rather than imported (§8-4
    forbids a cross-tier code path).

    Matching runs on the DECODED text and stays exact-Unicode with no normalization fallback (§3);
    substring replacement is also what preserves unknown frontmatter, key order and comments by
    construction — nothing here re-serializes the file."""
    if old_text == new_text:
        raise CoreMemoryError(
            f"that changes nothing — `new_text` equals `old_text` in {rel}. Send the text you "
            "actually want there, or use `remove` if the passage should go away."
        )
    count = _occurrences(raw, old_text)
    if count == 0:
        raise CoreMemoryError(
            f"`old_text` is not in {rel} — it has changed since you read it, or the text was not "
            "copied verbatim. Read the topic again and retry against what is actually there."
        )
    if count > 1:
        raise CoreMemoryError(
            f"`old_text` matches {count} places in {rel} — include more surrounding text so it "
            "identifies exactly one passage."
        )
    return raw.replace(old_text, new_text, 1)


def _occurrences(raw: str, needle: str) -> int:
    """OVERLAPPING occurrences of `needle`. `str.count` counts non-overlapping ones (`"aaa".count("aa")`
    is 1), which would let a genuinely ambiguous `old_text` read as unique and be replaced at the
    first of two valid positions (S3 review) — the exact silent-overwrite the CAS exists to prevent.
    Advance by ONE from each hit, not by the match length."""
    count, i = 0, raw.find(needle)
    while i != -1:
        count += 1
        i = raw.find(needle, i + 1)
    return count


def _render_topic(name: str, description: str, kind: str | None, content: str, *, nested: bool) -> str:
    """A new topic file: service-rendered frontmatter + the body (council Codex-8 — the model never
    supplies raw YAML). `nested` picks the copied-Claude `metadata:` shape over the top-level one;
    the values go through `yaml.safe_dump`, so a name carrying a colon, a quote or a newline is
    quoted rather than able to forge structure."""
    fields: dict[str, object] = {"name": name.strip(), "description": description.strip()}
    if kind in _TOPIC_TYPES:
        fields["type"] = kind
    meta = {"metadata": fields} if nested else fields
    front = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, default_flow_style=False)
    return f"---\n{front}---\n\n{content.strip()}\n"


def render_hit(hit: CoreHit) -> str:
    """One `search` hit as the tool renders it: the topic path, then each matching line indented.
    Public because it is shared with `core_memory_tool._hits_result` — the ONE definition of a hit's
    rendered size, so `search`'s cap accounting and the body the model receives cannot drift apart
    (the corpus can't import the tool; the tool imports the corpus)."""
    return "\n".join([hit.path, *(f"  {line}" for line in hit.lines)])


def render_hits(hits: Sequence[CoreHit]) -> str:
    """The whole hit list as the tool's result body."""
    return _HIT_JOINER.join(render_hit(hit) for hit in hits)


def _append_entry(raw: str, line: str) -> str:
    """Add one rendered entry to the index text, preserving everything already there (a copied index
    keeps its heading and its ordering). Creates the file's content from nothing when it is absent."""
    body = raw.rstrip("\n")
    return f"{body}\n{line}\n" if body else f"{line}\n"


def _drop_entry(raw: str, rel: str) -> str:
    """Remove exactly the index lines that link `rel` — every other line survives byte-for-byte."""
    kept = [
        line
        for line in raw.splitlines()
        if not ((m := _INDEX_LINK.match(line)) and _link_target(m.group(2)) == rel)
    ]
    body = "\n".join(kept).rstrip("\n")
    return f"{body}\n" if body else ""


def _remove_file(path: Path) -> None:
    """Delete a topic file. A named module function so the fault-injection tests can fail exactly
    this step (the family-3 charter fault-injects between EVERY topic/index step)."""
    path.unlink()


def _commit_msg(action: str, rel: str) -> str:
    """A content-free D26 commit subject (the tier-1 rule): which action, which file, never the text."""
    return f"core memory: {action} {rel}"


def _normalize(text: str) -> str:
    """Foreign, model-written text made safe to sit in a rendered index line (§3/council Codex-13):
    control characters and newlines collapse to spaces, markdown link syntax is escaped so a
    description can neither forge a link nor break the entry around it."""
    return _LINK_SYNTAX.sub(r"\\\1", " ".join(_CONTROL.sub(" ", text).split()))


def _entry_line(title: str, path: str, hook: str) -> str:
    """One clamped index entry. The path always survives intact — it is what S3's `read` is
    addressed by (`_parse` already dropped any path that can't fit) — so the clamp bites the title
    first, then the hook, and a hook with no room is dropped whole rather than displacing anything."""
    title = _normalize(title)
    title_room = _ENTRY_CHAR_LIMIT - len(path) - 6  # "- [" + "](" + ")"
    if len(title) > title_room:
        title = _clip(title, title_room)
    prefix = f"- [{title}]({path})"
    hook = _normalize(hook)
    room = _ENTRY_CHAR_LIMIT - len(prefix) - 3  # " — "
    if not hook or room < 2:
        return prefix
    return f"{prefix} — {hook if len(hook) <= room else _clip(hook, room)}"


def _clip(text: str, limit: int) -> str:
    """`text` cut to `limit` chars ending in an ellipsis. Trailing backslashes are stripped so the
    cut can never end in a live escape (a clamped title ending `\\` would escape the `]` after it)."""
    return text[: max(limit - 1, 0)].rstrip("\\") + "…"


def _pct(length: int, cap: int) -> int:
    return round(100 * length / cap) if cap > 0 else 0


def _header(listed: int, chars: int, cap: int) -> str:
    """The Hermes-style usage header the tier-1 blocks carry, so the model sees index cap pressure
    the same way it sees memory cap pressure."""
    plural = "" if listed == 1 else "s"
    return f"## Core memory index ({listed} topic{plural} — {_pct(chars, cap)}% — {chars:,}/{cap:,})"


def _truncation_note(omitted: int) -> str:
    plural = "" if omitted == 1 else "s"
    return f"> {omitted} more topic{plural} not listed — the index is at its cap."


def _fit(lines: list[str], cap: int) -> str:
    """Assemble header + entries (+ the truncation note) within `cap`. Truncation is soft and drops
    whole entries from the end — never an error, and the note is reserved *inside* the cap rather
    than appended past it. The header's own length feeds back into the numbers it prints, so it is
    settled by a short fixpoint (only the digit count can move)."""
    kept = len(lines)
    running = 0
    for i, line in enumerate(lines):  # greedy pre-trim so the exact loop below starts close
        running += len(line) + 1
        if running > cap:
            kept = i
            break
    while True:
        block = _assemble(lines[:kept], len(lines) - kept, cap)
        if len(block) <= cap:
            return block
        if kept == 0:  # a cap too small for even header + note: the hard cap still wins (§3)
            return block[:cap]
        kept -= 1


def _assemble(kept: list[str], omitted: int, cap: int) -> str:
    parts = [*kept, *([_truncation_note(omitted)] if omitted else [])]
    size = sum(len(p) + 1 for p in parts)
    block = ""
    # The header prints the block's own length, which includes the header — a fixpoint. Iterate to
    # stability; at a digit/percent boundary it can oscillate by one, in which case the printed
    # number is off by one char (the cap itself is still enforced above).
    for _ in range(6):
        block = "\n".join([_header(len(kept), size, cap), *parts])
        if len(block) == size:
            break
        size = len(block)
    return block
