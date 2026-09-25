"""The CALL TRAIL (D77) — an append-only, per-call JSONL record of a live call, for diagnosis.

Every decision that matters in a live call is made in the BROWSER (the relative gate's floor, the leak
probe's verdicts, the ear hold, the transcript gate's drops, the route readbacks) and the relay sees
only the wire — so until this module there was no record of a call anywhere, and the owner narrated
phone sessions from memory. The trail is written by BOTH halves into one file per call, keyed by the
`call_id` the client mints: the relay's lines (`src: "relay"`, `services/voice_live.py`) and the
browser's (`src: "client"`, through `POST /api/voice/live/trail`). The main seat reads
`$CTRLB_HOME/calls/<call_id>.jsonl` after the fact.

**Debug data, and shaped like it.** Gated by `voice.live.debug` (off by default — the same knob that
turns the on-screen readout on); no fsync, because a lost tail on a power cut is a lost diagnostic,
not lost data; and a write failure (disk full, a read-only mount) is logged ONCE and swallowed —
a trail must never end a call. Retention is by count (`voice.live.trail_keep`), pruned when a NEW
call's first line lands, so the directory cannot grow without bound however many calls are made.

**The filename is the path-traversal guard.** `call_id` comes off the wire (the relay's `start`
control, the trail route's body), so it is validated against ONE canonical-UUID pattern before it
becomes a path — defined here, imported by both callers, never re-spelled.

Synchronous on purpose (tiny appends): both async callers go through `asyncio.to_thread`, so the
relay's audio pump never waits on a disk. The lock is what lets the two writers — the relay's thread
and the route's — share one file without interleaving inside a line.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from typing import TYPE_CHECKING, Any

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


def valid_call_id(value: object) -> bool:
    """Is `value` a call id this store will turn into a filename?"""
    return isinstance(value, str) and CALL_ID_RE.fullmatch(value) is not None


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
        #: once per batch for the rest of the call.
        self._warned = False

    @property
    def root(self) -> Path:
        return self._root

    def append(self, call_id: str, lines: Iterable[Mapping[str, Any]], *, keep: int) -> None:
        """Append `lines` to `<root>/<call_id>.jsonl`, one compact JSON object per line.

        Raises `ValueError` for a malformed `call_id` (a caller bug or a hostile id — never a path).
        Every I/O failure is swallowed after the one warning. When this append CREATED the file, the
        directory is pruned to the newest `keep` trails by mtime — a second append to the same call
        never prunes, so a long call cannot delete its own history mid-flight.
        """
        if not valid_call_id(call_id):
            raise ValueError("call_id must be a canonical lowercase UUID")
        payload = "".join(
            json.dumps(line, separators=(",", ":"), ensure_ascii=False) + "\n" for line in lines
        ).encode("utf-8")
        if not payload:
            return
        path = self._root / f"{call_id}.jsonl"
        with self._lock:
            try:
                self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
                created = not path.exists()
                # 0o600: the lines carry the owner's transcripts. O_APPEND, one batch per open; the
                # buffered writer loops a short `write(2)` to completion or raises (the S3 code round,
                # F3 — a bare `os.write` may return early and would truncate a line in silence).
                fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
                with os.fdopen(fd, "ab") as f:
                    f.write(payload)
                if created:
                    self._prune(keep, current=path)
            except OSError:
                if not self._warned:
                    self._warned = True
                    log.warning(
                        "call trail: cannot write under %s (further failures are silent)",
                        self._root,
                        exc_info=True,
                    )

    def _prune(self, keep: int, *, current: Path) -> None:
        """Keep `current` plus the newest `keep - 1` OTHER trails by mtime; unlink the rest (best-effort,
        per file). `current` is never a candidate (the S3 code round, F5): on a coarse-mtime filesystem
        the file just created can tie with an older one, and a tie must not delete the live call."""
        others = sorted((p for p in self._root.glob("*.jsonl") if p != current), key=_mtime, reverse=True)
        for stale in others[max(keep - 1, 0) :]:
            try:
                stale.unlink()
            except OSError:
                log.debug("call trail: could not prune %s", stale.name, exc_info=True)


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:  # vanished between the glob and the stat — sorts last, then unlink misses it
        return 0.0
