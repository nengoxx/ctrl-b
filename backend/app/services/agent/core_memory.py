"""Core Memory — the tier-2 long-term corpus, read side (D57, CORE_MEMORY_PLAN §3).

A **sibling subsystem** to the tier-1 file memory, not an extension of it: one shared,
Claude-Code-native markdown corpus (a `MEMORY.md` routing index + semantic topic files) that is
deliberately *not* injected whole. Only the bounded, rendered index rides the system head (S2); topic
bodies arrive as ordinary tool results (S3). `MemoryProvider`/`StoreSpec` is not a fit here (no query
param, store-keyed writes, one capped file per store), so the D27 "ADDING A STORE" checklist does
**not** apply — this slice adds no store.

This slice (S1) is the READ half and has no write path at all: root resolution/validation, the
scanner, the tolerant frontmatter parse, and the index render/clamp/cache. Everything is read from
live `Settings` per call (the `FileMemoryProvider`/`FileSkillProvider` contract) so a config edit or
a hand-edited corpus applies with no restart.

Two properties the acceptance families lean on: reading never modifies a file (there is no writer
here), and an invalid root is one diagnostic, never fatal — the agent runs unaffected with no index.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import yaml

from app.config import CoreMemoryCfg, Settings, config_path
from app.core.memory import STORES
from app.db import db_path
from app.services.agent.skills import FRONTMATTER_RE

log = logging.getLogger(__name__)

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


@dataclass(frozen=True)
class CoreTopic:
    """One parsed topic file. `path` is posix-relative to the corpus root (the id everything else —
    index links, S3's `read`/`search` — addresses it by)."""

    path: str
    name: str
    description: str
    type: str | None  # one of `_TOPIC_TYPES`, or None (untyped, still valid)


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

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
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
        nested = meta.get("metadata")
        nested = nested if isinstance(nested, dict) else {}
        name = _pick(meta, nested, "name") or PurePosixPath(rel).stem
        kind = _pick(meta, nested, "type")
        return CoreTopic(
            path=rel,
            name=name,
            description=_pick(meta, nested, "description"),
            type=kind if kind in _TOPIC_TYPES else None,
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
        out.append((title.strip(), rel, hook.strip().lstrip("—–-:").strip()))
    return out


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
