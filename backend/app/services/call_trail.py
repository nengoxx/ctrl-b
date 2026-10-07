"""The CALL TRAIL (D77) — an append-only, per-call JSONL record of a live call, for diagnosis.

Every decision that matters in a live call is made in the BROWSER (the relative gate's floor, the leak
probe's verdicts, the ear hold, the transcript gate's drops, the route readbacks) and the relay sees
only the wire — so until this module there was no record of a call anywhere, and the owner narrated
phone sessions from memory. The trail is written by BOTH halves into one file per call, keyed by the
`call_id` the client mints: the relay's lines (`src: "relay"`, `services/voice_live.py`) and the
browser's (`src: "client"`, through `POST /api/voice/live/trail`). The main seat reads
`$CTRLB_HOME/calls/<call_id>.jsonl` after the fact — a CALL's trail; a streaming DICTATION's lives one
directory down, `$CTRLB_HOME/calls/dictation/<call_id>.jsonl` (Phase 26 S1, ISS-41).

**Debug data, and shaped like it.** Gated by `voice.live.debug` (off by default — the same knob that
turns the on-screen readout on); no fsync, because a lost tail on a power cut is a lost diagnostic,
not lost data; and a write failure (disk full, a read-only mount) is logged ONCE and swallowed —
a trail must never end a call. Retention is by count (`voice.live.trail_keep`), pruned when a NEW
call's first line lands, so the directory cannot grow without bound however many calls are made — and
PER MODE DIRECTORY (Phase 26 S1, ISS-41): every debug dictation writes a trail of its own, so under one
shared count a dictation-heavy sitting pruned the call trails it was meant to sit beside. Each mode's
directory keeps its own newest `trail_keep`, and neither can evict the other's.

**The filename is the path-traversal guard.** `call_id` comes off the wire (the relay's `start`
control, the trail route's body), so it is validated against ONE canonical-UUID pattern before it
becomes a path — defined here, imported by both callers, never re-spelled.

Synchronous on purpose (tiny appends): both async callers go through `asyncio.to_thread`, so the
relay's audio pump never waits on a disk. The lock is what lets the two writers — the relay's thread
and the route's — share one file without interleaving inside a line.

**The capture (Phase 26 S6-ii, ASR_PLAN §6.1; SECURITY_MODEL §2.12).** Under the SAME gate the relay
also records what the ear hears: one `<call_id>-<leg>.wav` per leg BESIDE its trail, the relay's
received stream after the anti-aliased resampler (16 kHz pcm16 mono). It lives here, not in a store of
its own (the session-64 placement ruling), because it reuses every rail the trail already has — the
path guard, the per-level 0700 mkdir, the 0600 file, the warn-once, the off-loop batching of its caller —
and, above all, the RETENTION: a pruned trail takes its captures with it (`_prune`), so the count bound
is the trail's and there is no second sweep. The file is written header-first with both sizes all-ones
(`core/audio.pcm16_wav_header(None, …)`, ruling H1) as `<name>.wav.part`, and finalized at leg end by
patching the 44 bytes and renaming — a crash leaves an importable `.part`. Created `O_EXCL` (ruling
H12): a reused (call id, leg) records nothing rather than overwrite another leg's audio.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import sys
import threading
from typing import TYPE_CHECKING, Any, BinaryIO, Literal, get_args

from app.core.audio import pcm16_wav_header
from app.core.fsutil import fsync_dir

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping
    from pathlib import Path

log = logging.getLogger(__name__)

#: A canonical lowercase UUID — what `crypto.randomUUID()` mints. ONE spelling for the three places
#: that validate a call id: this store (the path guard), the relay's `start` parse and the trail
#: route's body model (pydantic takes the string; Python callers use `CALL_ID_RE.fullmatch`, never
#: `match`, because `$` would admit a trailing newline).
CALL_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
CALL_ID_RE = re.compile(CALL_ID_PATTERN)

#: The trail route's wire bounds (D77). Not config: they bound what one debug POST may cost, and the
#: client's own flush budget (32 KiB — the browser's keepalive quota is ~64 KiB per origin across
#: in-flight requests) sits well inside them. A whole body past `TRAIL_MAX_BODY_BYTES` is a 413; one
#: entry past `TRAIL_MAX_ENTRY_BYTES` (serialized) is a 422 naming its index; a batch is at most
#: `TRAIL_MAX_ENTRIES` lines.
TRAIL_MAX_BODY_BYTES = 64 * 1024
TRAIL_MAX_ENTRY_BYTES = 2048
TRAIL_MAX_ENTRIES = 200

#: What a live leg serves — `start.mode` on the relay's wire (S11) and `mode` on the trail route's body
#: (Phase 26 S1). ONE vocabulary, owned HERE because the store turns it into a directory: `call` is the
#: root (every pre-S1 trail stays where it is), any other mode is the subdirectory of that name. The
#: relay and the route import it; neither re-spells it.
LiveMode = Literal["call", "dictation"]
LIVE_MODES: tuple[LiveMode, ...] = get_args(LiveMode)


#: `start.leg`'s accepted range — the client's per-call reconnect ordinal (D77). Bounded like every
#: other number the relay takes off the wire; a million legs is far past any real call. Owned HERE since
#: S6-ii because a leg also becomes part of a FILE NAME (a capture's): the relay's `start` parse and
#: `open_capture`'s path guard share this one spelling.
MAX_LEG = 1_000_000

#: The suffix a capture carries while its leg runs (or after a crash): `<call_id>-<leg>.wav.part`.
CAPTURE_PART_SUFFIX = ".part"

#: `O_BINARY` where it exists (Windows): a capture is raw bytes, and a text-mode descriptor would
#: translate every 0x0A in the audio. 0 elsewhere.
_O_BINARY = getattr(os, "O_BINARY", 0)


def valid_call_id(value: object) -> bool:
    """Is `value` a call id this store will turn into a filename?"""
    return isinstance(value, str) and CALL_ID_RE.fullmatch(value) is not None


def capture_name(call_id: str, leg: int) -> str:
    """A finalized capture's file name — `<call_id>-<leg>.wav`, the trail's stem plus the leg (the one
    spelling, shared with `tools/asr_corpus.py`)."""
    return f"{call_id}-{leg}.wav"


class CallTrail:
    """Append-only per-call JSONL under `$CTRLB_HOME/calls/` — debug data, see D77.

    Holds no settings: `keep` is passed to every `append` (read live from `voice.live.trail_keep` by
    the caller, the `LiveSessionSlots` precedent), so one instance lives for the process and a Conf
    edit needs no rebuild.
    """

    def __init__(self, root: Path) -> None:
        self._root = root
        self._lock = threading.Lock()
        #: ONE warning per process for a failing disk — a trail that cannot write says so once, not
        #: once per batch for the rest of the call. Shared by the captures: same disk, same warning.
        self._warned = False
        #: Its own lock (S6-ii wave 1): trail and capture failures land on different worker threads, and
        #: `_lock` is held around the trail write that may be the one failing.
        self._warn_lock = threading.Lock()
        #: THE PRUNE GUARD (S6-ii wave 1, ruled): the `(directory, stem)` of every capture writer still
        #: OPEN in this process — `_prune` never takes such a call, so a long leg whose trail fell out of
        #: `trail_keep` (possible with `max_sessions > 1`) is not deleted under its own open file. Held
        #: by the WRITER's lifetime, not by a `.part` on disk, which would make a crashed `.part` immortal.
        self._open_stems: set[tuple[Path, str]] = set()

    @property
    def root(self) -> Path:
        return self._root

    def _directory(self, call_id: str, mode: LiveMode) -> Path:
        """The mode's directory for `call_id` — raising `ValueError` on a malformed id or mode (a caller
        bug or a hostile value — never a path)."""
        if not valid_call_id(call_id):
            raise ValueError("call_id must be a canonical lowercase UUID")
        if mode not in LIVE_MODES:
            raise ValueError(f"mode must be one of {', '.join(LIVE_MODES)}")
        return self._root if mode == "call" else self._root / mode

    def _make_dirs(self, directory: Path) -> None:
        # Each level made owner-only in its own step: `mkdir(parents=True)` applies `mode` to the
        # LEAF alone, so a dictation arriving first would otherwise leave the root at the umask.
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory != self._root:
            directory.mkdir(mode=0o700, exist_ok=True)

    def warn_once(self, what: str) -> None:
        """Log ONE warning per process for a failing disk (with the traceback), then stay silent."""
        with self._warn_lock:
            if self._warned:
                return
            self._warned = True
            # The traceback when there is one (an `OSError` caught); a degrade with no exception has none.
            log.warning(
                "%s under %s (further failures are silent)",
                what,
                self._root,
                exc_info=sys.exception() is not None,
            )

    def append(
        self,
        call_id: str,
        lines: Iterable[Mapping[str, Any]],
        *,
        keep: int,
        mode: LiveMode = "call",
    ) -> None:
        """Append `lines` to `<root>/<call_id>.jsonl` (a call) or `<root>/<mode>/<call_id>.jsonl` (any
        other mode), one compact JSON object per line.

        Raises `ValueError` for a malformed `call_id` or a `mode` outside `LIVE_MODES` (a caller bug or
        a hostile value — never a path). Every I/O failure is swallowed after the one warning. When this
        append CREATED the file, ITS directory is pruned to the newest `keep` trails by mtime — a second
        append to the same call never prunes, so a long call cannot delete its own history mid-flight,
        and a dictation's prune never reaches a call's trail (or the reverse).
        """
        directory = self._directory(call_id, mode)
        payload = "".join(
            json.dumps(line, separators=(",", ":"), ensure_ascii=False) + "\n" for line in lines
        ).encode("utf-8")
        if not payload:
            return
        path = directory / f"{call_id}.jsonl"
        with self._lock:
            try:
                self._make_dirs(directory)
                created = not path.exists()
                # 0o600: the lines carry the owner's transcripts. O_APPEND, one batch per open; the
                # buffered writer loops a short `write(2)` to completion or raises (the S3 code round,
                # F3 — a bare `os.write` may return early and would truncate a line in silence).
                fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | _O_BINARY, 0o600)
                with os.fdopen(fd, "ab") as f:
                    f.write(payload)
                if created:
                    self._prune(directory, keep, current=path)
            except OSError:
                self.warn_once("call trail: cannot write")

    def open_capture(
        self, call_id: str, leg: int, *, rate: int, mode: LiveMode = "call"
    ) -> CaptureWriter | None:
        """Create this leg's capture, `<dir>/<call_id>-<leg>.wav.part`, header-first (ruling H1), and return
        its writer — or `None`, after a warning, when it cannot (the leg then simply records no audio).

        `O_EXCL` on the `.part` and a refusal when the finalized `.wav` already exists (ruling H12): a
        reused (call id, leg) — a client bug or a replayed `start` — never appends to, or overwrites,
        another leg's audio; that hit warns EVERY time (it is a fact about one leg, not a failing disk).
        Any other `OSError` is the trail's warn-once. Raises `ValueError` for a malformed id, mode or leg."""
        directory = self._directory(call_id, mode)
        if not isinstance(leg, int) or isinstance(leg, bool) or not 0 <= leg <= MAX_LEG:
            raise ValueError(f"leg must be an integer 0–{MAX_LEG}")
        final = directory / capture_name(call_id, leg)
        part = final.with_name(final.name + CAPTURE_PART_SUFFIX)
        with self._lock:
            try:
                self._make_dirs(directory)
                fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _O_BINARY, 0o600)
            except FileExistsError:
                log.warning("call capture: leg %d already has a capture — this leg records no audio", leg)
                return None
            except OSError:
                self.warn_once("call capture: cannot create")
                return None
            f = os.fdopen(fd, "wb")
            try:
                # The `.part` exclusivity alone cannot see a FINALIZED twin (the rename freed the name).
                if final.exists():
                    f.close()
                    part.unlink()
                    log.warning("call capture: leg %d already has a capture — this leg records no audio", leg)
                    return None
                f.write(pcm16_wav_header(None, rate))
                f.flush()
            except OSError:
                f.close()
                with contextlib.suppress(OSError):
                    part.unlink()
                self.warn_once("call capture: cannot create")
                return None
            key = (directory, call_id)
            self._open_stems.add(key)
        return CaptureWriter(self, f, part, final, rate, key)

    def _release(self, key: tuple[Path, str]) -> None:
        """A capture writer closed — its call is prunable again (the prune guard)."""
        with self._lock:
            self._open_stems.discard(key)

    def _prune(self, directory: Path, keep: int, *, current: Path) -> None:
        """Keep `current` plus the newest `keep - 1` OTHER trails in `directory` by mtime; unlink the
        rest (best-effort, per file). `current` is never a candidate (the S3 code round, F5): on a
        coarse-mtime filesystem the file just created can tie with an older one, and a tie must not
        delete the live call. The glob is NON-recursive on purpose — the call root holds the mode
        subdirectories, and their trails are theirs to keep (Phase 26 S1).

        A pruned trail TAKES ITS CAPTURES (Phase 26 S6-ii, ruling H3): every `<stem>-<leg>.wav` and
        `.wav.part` beside it, unlinked first so a failure leaves the trail that explains them rather
        than an orphan nothing would ever prune. Captures never count toward `keep` — the count bound is
        the trail's (worst case ≈ keep × legs × 1.9 MB/min per mode, SECURITY_MODEL §2.12). The stem is
        a canonical UUID (no glob metacharacters), so the patterns match that call's files only. A call
        with a capture writer still OPEN in this process is skipped whole (the prune guard).

        Retention runs ONLY here — when a NEW trail file is created, i.e. when the next debug leg of a new
        call starts. With `debug` off nothing is pruned: the last kept trails and their audio stay until
        removed by hand (SECURITY_MODEL §2.12)."""
        others = sorted((p for p in directory.glob("*.jsonl") if p != current), key=_mtime, reverse=True)
        for stale in others[max(keep - 1, 0) :]:
            if (directory, stale.stem) in self._open_stems:
                continue  # a leg of this call is still recording: never delete under an open writer
            captures = [
                *directory.glob(f"{stale.stem}-*.wav"),
                *directory.glob(f"{stale.stem}-*.wav{CAPTURE_PART_SUFFIX}"),
            ]
            for victim in (*captures, stale):
                try:
                    victim.unlink()
                except OSError:
                    log.debug("call trail: could not prune %s", victim.name, exc_info=True)


class CaptureWriter:
    """ONE leg's raw-audio capture (`CallTrail.open_capture`) — sync, called off the loop by the relay's
    ordered batches (`asyncio.to_thread`), one writer per leg, never shared.

    Debug data, shaped like the trail: no fsync of the audio (a lost second on a power cut is a lost
    diagnostic), and a write failure is the trail's warn-once — the capture DEGRADES (stops writing,
    keeps its importable `.part`), the leg never notices. `samples` counts what reached the file."""

    def __init__(
        self, trail: CallTrail, f: BinaryIO, part: Path, final: Path, rate: int, key: tuple[Path, str]
    ) -> None:
        self._trail = trail
        self._key = key
        self._f = f
        self._part = part
        self._final = final
        self._rate = rate
        self.samples = 0
        self._failed = False
        self._closed = False

    @property
    def name(self) -> str:
        """The finalized file's name — what the trail's `capture_open` and `leg_end` lines record."""
        return self._final.name

    @property
    def failed(self) -> bool:
        return self._failed

    def append(self, pcm: bytes) -> None:
        """Append one batch of 16 kHz pcm16 (already header-sized by `open_capture`)."""
        if self._failed or self._closed or not pcm:
            return
        try:
            self._f.write(pcm)
            self._f.flush()
        except OSError:
            self._degrade("call capture: cannot write")
            return
        self.samples += len(pcm) // 2

    def finalize(self) -> None:
        """Patch the two sizes (the whole 44-byte header, rewritten) and rename `.part` → `.wav` (ruling
        H1), then a best-effort directory fsync through `core/fsutil` so the new name survives. A degraded
        capture is only closed: its `.part`, header still all-ones, is what the corpus tool imports.
        Idempotent."""
        if self._closed:
            return
        self._closed = True
        try:
            if not self._failed:
                self._f.seek(0)
                self._f.write(pcm16_wav_header(self.samples, self._rate))
                self._f.flush()
            self._f.close()
            if not self._failed:
                os.replace(self._part, self._final)
                fsync_dir(self._final.parent)
        except OSError:
            self._failed = True
            with contextlib.suppress(OSError):
                self._f.close()
            self._trail.warn_once("call capture: cannot finalize")
        finally:
            self._trail._release(self._key)  # noqa: SLF001 — the writer's own store

    def _degrade(self, what: str) -> None:
        self._failed = True
        self._trail.warn_once(what)


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:  # vanished between the glob and the stat — sorts last, then unlink misses it
        return 0.0
